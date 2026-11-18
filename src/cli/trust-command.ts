// The verifier's trust-store commands. Neither ever adds trust on its own: each prints what it would add and changes
// nothing until the person confirms with --yes.
//
//   plumbline trust (--key <plumbline-key.json> --origin <origin> | --url <site base> [--allow-local] [--require-dns])
//                   --file <plumbline.trust.json> [--yes] [--json]
//     First contact: checks that the record's kid is derived from its key, prints the kid to compare out of band, and
//     with --yes appends { kid, origin, publicKey }. Without --yes: exit 1, nothing written. With --url the record is
//     fetched from the site's .well-known/ through safeFetch and the origin is the URL's own, and DNS is asked too
//     (`_plumbline.<host>` TXT, src/net/dns.ts): agrees, disagrees, no record or could not ask. DNS adds no trust: a
//     disagreement refuses --yes (never overridden silently), and --require-dns refuses --yes unless DNS agrees.
//   plumbline dns --key <plumbline-key.json> [--origin <origin>] [--json]
//     Prints the TXT record a publisher adds so verifiers can check the kid through a second channel.
//   plumbline adopt (--root <site dir> --origin <origin> | --url <site base> [--allow-local])
//                   --trust <plumbline.trust.json> [--yes] [--json]
//     A published rotation, one statement or a chain: core's walkRotationChain from the newest key the trust file holds
//     for the origin, then with --yes each successor's adoptRotation entry ({ kid, origin, publicKey, adoptedVia }) is
//     appended. A chain that breaks or does not verify is refused (exit 1) and the statement where it stopped is named.
// Exit 0 when the entry was added or was already there, 1 when nothing was added, 2 on a usage or I/O error.

import { CliError, UsageError, parseArgs, required, type ParsedArgs } from "./args.js";
import {
  ORIGIN_RULE,
  applyRevocationToTrust,
  decode,
  emit,
  formatResult,
  localSite,
  remoteSite,
  revocationLines,
  siteBaseOf,
  type Out,
  type RevocationReport,
  type SiteSource,
} from "./commands.js";
import { appendEntry, readJsonFile, readTrustFile, writeTrustFile } from "./files.js";
import { askDns, type TxtResolver } from "../net/dns.js";
import { DNS_LABEL, describeDns, dnsNameFor, txtRecordFor, type DnsCheck } from "../net/dns-txt.js";
import {
  KEY_FILE,
  REVOCATION_FILE,
  ROTATION_FILE,
  isAcceptableOrigin,
  isDerivedKid,
  isKid,
  isPublicKey,
  statementsOf,
  walkRotationChain,
  type TrustEntry,
  type VerifyResult,
} from "../core/index.js";

export const FIRST_CONTACT_WARNING =
  "Compare this kid, character by character, with the one the publisher gave you out of band (in person, on a call, " +
  "in a signed message or a repository you already trust), never with one the site itself shows: a key trusted on the " +
  "site's own word trusts whoever controls the site today.";

const CONFIRM = "nothing added: confirm out of band, then rerun with --yes";

/** The sentence `trust` refuses a revoked key with; `adopt` uses it for a revoked successor too. */
function revokedSentence(file: string, kid: string): string {
  return `${file} records key ${kid} as revoked; a revoked key is never trusted again: ask the publisher for its new key`;
}

/**
 * Where a trust-store command reads the site from: `--url <site base>` (through safeFetch; the origin is the URL's
 * own, so `--origin` is refused beside it) or the command's local option. `--allow-local` goes with `--url` only.
 */
function siteOf(args: ParsedArgs, local: "root" | "key"): { site?: SiteSource; base?: URL; origin: string } {
  const url = args.values.get("url");
  const allowLocal = args.flags.has("allow-local");
  if ((url === undefined) === (args.values.get(local) === undefined)) throw new UsageError(`give exactly one of --${local} and --url`);
  if (url === undefined) {
    if (allowLocal) throw new UsageError("--allow-local goes with --url");
    const origin = required(args, "origin");
    if (!isAcceptableOrigin(origin)) throw new UsageError(ORIGIN_RULE);
    return { ...(local === "root" ? { site: localSite(required(args, "root")) } : {}), origin };
  }
  if (args.values.has("origin")) throw new UsageError("--url binds the origin to the URL's own; leave out --origin");
  const base = siteBaseOf(url, allowLocal);
  if (!isAcceptableOrigin(base.origin)) throw new UsageError("--url must name an https origin (http only for localhost and 127.0.0.1)");
  if (allowLocal) process.stderr.write("WARNING: --allow-local: http and loopback addresses are allowed for this run (private ranges stay refused)\n");
  return { site: remoteSite(base, allowLocal), base, origin: base.origin };
}

/** Reads one file the command cannot do without: absent or unreadable is exit 2. */
/** True when the site's plumbline-revocation.json names `kid` (any statement of it; unverified: it only takes away). */
async function siteRevokes(site: SiteSource, kid: string): Promise<boolean> {
  const read = await site.read(REVOCATION_FILE);
  if (read.state !== "present") return false;
  let value: unknown;
  try {
    value = JSON.parse(decode(read.bytes));
  } catch {
    return false;
  }
  const listed = statementsOf(value);
  return "statements" in listed && listed.statements.some((s) => typeof s === "object" && s !== null && (s as { kid?: unknown }).kid === kid);
}

async function readRequired(site: SiteSource, rel: string): Promise<string> {
  const read = await site.read(rel);
  if (read.state === "absent") throw new CliError(`${rel} not found in ${site.where}`);
  if (read.state === "unknown") throw new CliError(`cannot fetch ${rel} from ${site.where} (${read.why})`);
  return decode(read.bytes);
}

export const DNS_USAGE = "usage: plumbline dns --key <plumbline-key.json> [--origin <https origin>] [--json]";

/** The sentence `trust --yes` refuses with when DNS names other keys for the host. */
export const DNS_DISAGREES =
  "nothing added: DNS names another key for this host, and a disagreement is never overridden here. Ask the publisher which kid is theirs (during a rotation they publish both); if you confirmed this kid out of band and know why DNS differs, add the record you checked with trust --key <file> --origin <origin> --yes";

/**
 * What `trust` does once the record checks out, in order: an entry already there is left as it is; without --yes
 * nothing is added; a DNS disagreement refuses --yes (never overridden silently); --require-dns refuses --yes unless
 * DNS agrees; otherwise the entry is added. DNS that agrees adds no trust of its own: --yes is still the person's.
 */
export function trustDecision(input: { already: boolean; yes: boolean; requireDns: boolean; dns?: DnsCheck }):
  | { action: "already" | "add"; refusedBy?: undefined }
  | { action: "refuse"; line: string; refusedBy?: "dns" } {
  const { already, yes, requireDns, dns } = input;
  if (already) return { action: "already" };
  if (!yes) return { action: "refuse", line: CONFIRM };
  if (dns?.state === "disagrees") return { action: "refuse", line: DNS_DISAGREES, refusedBy: "dns" };
  if (requireDns && dns?.state !== "agrees") {
    return { action: "refuse", line: `nothing added: --require-dns needs DNS to agree, and for ${dns?.name ?? "this host"} it says: ${dns?.state ?? "could not ask"}`, refusedBy: "dns" };
  }
  return { action: "add" };
}

/** Injection points for tests; production passes none. */
export interface TrustDeps {
  resolveTxt?: TxtResolver;
}

export async function trust(argv: string[], out: Out, deps: TrustDeps = {}): Promise<number> {
  const args = parseArgs(argv, ["key", "origin", "file", "url"], ["yes", "allow-local", "require-dns"]);
  const file = required(args, "file");
  const requireDns = args.flags.has("require-dns");
  if (requireDns && args.values.get("url") === undefined) throw new UsageError("--require-dns goes with --url: DNS is asked for the site's host");
  const { site, base, origin } = siteOf(args, "key");

  // The record is only a convenience: the kid is still compared out of band, so fetching it from the site adds no trust.
  let record: unknown;
  let source: string;
  if (site !== undefined) {
    source = site.label(KEY_FILE);
    try {
      record = JSON.parse(await readRequired(site, KEY_FILE));
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw new CliError(`key record is not valid JSON: ${source}`);
    }
  } else {
    source = required(args, "key");
    record = await readJsonFile(source, "key record");
  }
  const r = record as Record<string, unknown> | null;
  if (typeof r !== "object" || r === null || Array.isArray(r) || !isKid(r.kid) || !isPublicKey(r.publicKey)) {
    throw new CliError(`not a Plumbline key record (a kid of 16 lowercase hex and a 32-byte base64url publicKey): ${source}`);
  }
  const { kid, publicKey } = r as { kid: string; publicKey: string };
  if (!(await isDerivedKid(kid, publicKey))) throw new CliError(`the key record's kid is not derived from its public key, so it is refused: ${source}`);

  const store = await readTrustFile(file, { missingIsEmpty: true });
  // A revocation recorded for this kid anywhere is final: never trusted again, at any origin.
  if (store.entries.some((e) => e.kid === kid && e.revokedAt !== undefined)) throw new CliError(revokedSentence(file, kid));
  const already = store.entries.some((e) => e.kid === kid && e.origin === origin);
  const entry: TrustEntry = { kid, origin, publicKey };
  const yes = args.flags.has("yes");
  // the second channel: what DNS says about this kid for the site's host (--url only). It adds no trust either way.
  const dns: DnsCheck | undefined = base !== undefined ? await askDns(base.hostname, kid, deps.resolveTxt) : undefined;
  const lines = [`kid ${kid} for ${origin}`, `public key ${publicKey}`, ...(dns !== undefined ? [describeDns(dns)] : []), `WARNING: ${FIRST_CONTACT_WARNING}`];
  let added = false;
  // UAT-7 (INE-L1-10): a site that publishes a revocation of the very key it offers is not trusted with it. A
  // revocation only ever takes trust away, so it is honoured unverified here, as the Desk does; --yes cannot override it.
  const revokedBySite = site !== undefined && (await siteRevokes(site, kid));
  const decision: ReturnType<typeof trustDecision> = revokedBySite
    ? { action: "refuse", line: `nothing added: ${site?.label(REVOCATION_FILE)} revokes this very key, so it is not trusted. Ask the publisher for their new key id through another channel.` }
    : trustDecision({ already, yes, requireDns, ...(dns !== undefined ? { dns } : {}) });
  const refusedBy = revokedBySite ? "revocation" : decision.refusedBy;
  let code: number;
  if (decision.action === "already") {
    lines.push(`already trusted: ${file} has this key for ${origin}; nothing to add`);
    code = 0;
  } else if (decision.action === "refuse") {
    lines.push(decision.line);
    code = 1;
  } else {
    appendEntry(store, entry);
    await writeTrustFile(store);
    added = true;
    lines.push(`added to ${file}`);
    code = 0;
  }
  emit(
    args,
    out,
    {
      kid,
      origin,
      publicKey,
      trustFile: file,
      added,
      alreadyTrusted: already,
      warning: FIRST_CONTACT_WARNING,
      ...(site !== undefined ? { keyRecord: source } : {}),
      ...(dns !== undefined ? { dns } : {}),
      ...(refusedBy !== undefined ? { refusedBy } : {}),
    },
    lines,
  );
  return code;
}

/**
 * `plumbline dns --key <plumbline-key.json> [--origin <origin>]`: the TXT record to publish at `_plumbline.<host>`, for
 * a key record whose kid is derived from its key. It writes nothing and asks nothing.
 */
export async function dnsRecord(argv: string[], out: Out): Promise<number> {
  const args = parseArgs(argv, ["key", "origin"]);
  const source = required(args, "key");
  const origin = args.values.get("origin");
  if (origin !== undefined && !isAcceptableOrigin(origin)) throw new UsageError(ORIGIN_RULE);
  const r = (await readJsonFile(source, "key record")) as Record<string, unknown> | null;
  if (typeof r !== "object" || r === null || Array.isArray(r) || !isKid(r.kid) || !isPublicKey(r.publicKey)) {
    throw new CliError(`not a Plumbline key record (a kid of 16 lowercase hex and a 32-byte base64url publicKey): ${source}`);
  }
  const kid = r.kid as string;
  if (!(await isDerivedKid(kid, r.publicKey as string))) throw new CliError(`the key record's kid is not derived from its public key, so it is refused: ${source}`);
  const name = origin !== undefined ? dnsNameFor(new URL(origin).hostname) : `${DNS_LABEL}.<your host>`;
  const record = txtRecordFor(kid);
  emit(args, out, { name, type: "TXT", value: record, kid }, [
    `${name} TXT "${record}"`,
    "Publish it in the site's DNS zone. During a planned rotation, publish one record per key until verifiers have moved. After a revocation, publish the new key's record alone and remove the revoked kid's: a record that still names it vouches for the stolen key.",
    "It is a second channel, not proof: an attacker of the web host alone cannot change it; one who holds your DNS or registrar can.",
  ]);
  return 0;
}

export async function adopt(argv: string[], out: Out): Promise<number> {
  const args = parseArgs(argv, ["root", "trust", "origin", "url"], ["yes", "allow-local"]);
  const trustPath = required(args, "trust");
  const { site: maybeSite, origin } = siteOf(args, "root");
  const site = maybeSite as SiteSource;
  const yes = args.flags.has("yes");
  const store = await readTrustFile(trustPath);

  // A revocation published beside the rotation is applied first: a rotation from a revoked key is never honoured. It is
  // written to the trust file only with --yes; without it, adopt changes nothing (verify records it). One that could
  // not be read (an error, not a 404) refuses the adoption: it might revoke the key the rotation comes from.
  let revocation: RevocationReport | undefined;
  const revocationRead = await site.read(REVOCATION_FILE);
  if (revocationRead.state === "unknown") {
    throw new CliError(`cannot fetch ${REVOCATION_FILE} from ${site.where} (${revocationRead.why}), so nothing is adopted: whether the rotating key is revoked cannot be told`);
  }
  if (revocationRead.state === "present") {
    revocation = await applyRevocationToTrust(site.label(REVOCATION_FILE), decode(revocationRead.bytes), store, yes);
  }

  // UAT-17 (TOM-L1-09): a site that publishes no rotation is a verdict (exit 1, `refusedBy: "no-rotation"`), not an I/O
  // error: "this seller did not rotate" is the answer a person asked for. One that cannot be fetched stays exit 2.
  const rotationRead = await site.read(ROTATION_FILE);
  if (rotationRead.state === "absent") {
    const result: VerifyResult = {
      verdict: "unverifiable",
      origin,
      detail: `This site publishes no ${ROTATION_FILE} (${site.where}), so there is no rotation to adopt: a signer you do not trust yet is a first contact (plumbline trust), or a question for the publisher out of band.`,
    };
    const noRotationLines = revocation ? revocationLines(revocation, store, yes) : [];
    noRotationLines.push(formatResult(result), "nothing adopted: there is no rotation to adopt");
    emit(args, out, { ...(revocation ? { revocation } : {}), results: [result], origin, trustFile: trustPath, added: false, refusedBy: "no-rotation" }, noRotationLines);
    return 1;
  }
  if (rotationRead.state === "unknown") throw new CliError(`cannot fetch ${ROTATION_FILE} from ${site.where} (${rotationRead.why})`);
  const text = decode(rotationRead.bytes);
  let parsed: unknown;
  let notJson = false;
  try {
    parsed = JSON.parse(text);
  } catch {
    notJson = true;
  }
  const listed = notJson ? undefined : statementsOf(parsed);
  const lines = revocation ? revocationLines(revocation, store, yes) : [];
  const refuse = (results: VerifyResult[], extra: string[] = [], report: Record<string, unknown> = {}): number => {
    lines.push(...results.map(formatResult), ...extra, "nothing adopted: only a rotation signed by a key you already trust, unrevoked, for this origin is adopted");
    emit(args, out, { ...(revocation ? { revocation } : {}), results, ...report, added: false }, lines);
    return 1;
  };
  if (listed === undefined) return refuse([{ verdict: "invalid", reason: "malformed", origin, detail: "The rotation file is not valid JSON." }]);
  if ("problem" in listed) return refuse([{ verdict: "invalid", reason: "malformed", origin, detail: `The rotation file is malformed: ${listed.problem}.` }]);

  const walk = await walkRotationChain(listed.statements, store.entries, origin);
  const results = walk.hops.length > 0 ? walk.hops.map((h) => h.result) : [walk.result];
  const chainReport = { chainLength: listed.statements.length, ...(walk.brokenAt !== undefined ? { brokenAt: walk.brokenAt } : {}) };
  if (walk.brokenAt !== undefined || walk.result.verdict !== "verified") {
    const extra: string[] = [];
    if (walk.brokenAt !== undefined && listed.statements.length > 1) {
      extra.push(`the rotation chain stops at statement ${walk.brokenAt} of ${listed.statements.length} (0 is the oldest): nothing in it is adopted`);
    }
    const last = walk.hops[walk.hops.length - 1];
    if (last !== undefined && last.result.reason === "revoked" && last.result.kid === last.to) extra.push(revokedSentence(trustPath, last.to));
    return refuse(results, extra, chainReport);
  }

  for (const hop of walk.hops) lines.push(`rotation ${hop.from} -> ${hop.to} for ${origin}`, `  ${formatResult(hop.result)}`);
  const newest = walk.newest as string;
  const toAdd = walk.entries;
  for (const entry of toAdd) lines.push(`successor ${entry.kid} public key ${entry.publicKey}`);
  // UAT-15 (INE-L2-2): a second, different successor of one key is how a stolen key looks, so it is never adopted
  const forks = toAdd.flatMap((entry) =>
    store.entries
      .filter((e) => e.origin === origin && e.adoptedVia === entry.adoptedVia && e.kid !== entry.kid)
      .map((e) => ({ of: entry.adoptedVia as string, trusted: e.kid, offered: entry.kid })),
  );
  for (const f of forks) {
    lines.push(
      `WARNING: ${trustPath} already holds ${f.trusted} as the successor of ${f.of} for ${origin}, and this rotation names a different successor, ${f.offered}. ` +
        `Two successors of one key is how a stolen key looks: ask the publisher out of band which key is theirs. If the key's holder really did rotate twice, remove ${f.trusted} from ${trustPath} first.`,
    );
  }
  let added = false;
  let code: number;
  if (forks.length > 0) {
    lines.push(`nothing adopted: ${forks.map((f) => f.offered).join(", ")} would be a second successor of ${[...new Set(forks.map((f) => f.of))].join(", ")}${yes ? " (--yes does not adopt one)" : ""}`);
    code = 1;
  } else if (toAdd.length === 0) {
    lines.push(`already trusted: ${trustPath} has ${newest} for ${origin}; nothing to add`);
    code = 0;
  } else if (!yes) {
    lines.push("nothing adopted: adopting a successor is your decision; rerun with --yes to add it");
    code = 1;
  } else {
    for (const entry of toAdd) appendEntry(store, entry);
    await writeTrustFile(store);
    added = true;
    for (const entry of toAdd) lines.push(`adopted ${entry.kid} for ${origin} into ${trustPath}, recorded as adopted via ${entry.adoptedVia}`);
    code = 0;
  }
  const first = walk.hops[0];
  emit(
    args,
    out,
    {
      ...(revocation ? { revocation } : {}),
      results,
      ...chainReport,
      ...(first !== undefined ? { from: first.from } : {}),
      to: newest,
      origin,
      trustFile: trustPath,
      added,
      alreadyTrusted: toAdd.length === 0,
      // UAT-17 (TOM-L1-10): `adopted` only once something was; until then the offered keys are `successors`
      ...(added ? { adopted: toAdd.map((e) => e.kid) } : toAdd.length > 0 ? { successors: toAdd.map((e) => e.kid) } : {}),
      ...(forks.length > 0 ? { forks, refusedBy: "fork" } : {}),
    },
    lines,
  );
  return code;
}
