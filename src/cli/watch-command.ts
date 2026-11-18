// plumbline watch [--root <dir>] [--init | --relock [--drop <ref>]...] [--source <ref>]... [--timeout <ms>] [--json]
// plumbline watch --url <site> [--allow-local] [--timeout <ms>] [--json]
// Dry-run: it reports, and with --init (and no lock yet) writes plumbline.lock.json, nothing else. --relock rewrites the
// lock from the current state after a person reviewed the drift, prints what changed and reminds that the lock is a
// signed file. --drop (with --relock only, repeatable) leaves a grounding ref out of the new lock; it is listed as
// removed. --url reads a site's PUBLISHED lock through safeFetch and re-checks it as the Desk does
// (src/watch/published.ts, the code the Desk runs); what needs the checkout (added runtime files, coverage, upstream) is
// said, in an info finding, not to be checked.
// Exit 0: no finding of severity warn or block (info alone is clean), or --relock wrote the lock. 1: at least one warn
// or block, or no lock could be used (absent, unreadable or unusable: nothing was checked, which is never clean).
// 2: usage or I/O error.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { RESIGN_REMINDER, type WatchReport } from "../watch/decide.js";
import { factCoverageCounts, factCoverageLines } from "../watch/anchors.js";
import { firstSignerWords, RelockRefused, runInit, runRelock, runWatch, runWatchUrl, type RelockRefusal, type RelockReport, type SignerChange } from "../watch/index.js";
import { readTrustFile } from "./files.js";
import { LOCK_FILE, SIGNATURE_FILE, type TrustEntry } from "../core/types.js";
import { readLock } from "../watch/lock.js";
import { ArgsError, parseArgs, repeated } from "./args.js";
import { parseExternalArg } from "../watch/external.js";
import type { ExternalKind } from "../core/types.js";
import { ALLOW_LOCAL_WARNING, isHttpUrl } from "./gate-command.js";
import { printable } from "./diff-command.js";

const USAGE =
  "usage: plumbline watch [--root <dir>] [--init | --relock [--drop <ref>]... [--accept-signer <peer>]... [--accept <ref>]...] [--source <path-or-https-url>]... [--external a2a-card=<https url>]... [--trust <trust file>] [--timeout <ms>] [--json]\n" +
  "       plumbline watch --url <https site address> [--allow-local] [--timeout <ms>] [--json]\n";

/** The refusal for a missing or empty value of each value-taking flag (for --timeout, also a bad one). */
const BAD_VALUE = {
  root: "--root takes a folder",
  source: "--source takes a path or an https URL",
  drop: "--drop takes a grounding ref the lock holds",
  timeout: "--timeout takes a positive number of milliseconds",
  url: "--url takes an http(s) site address, such as https://site.example/",
  external: "--external takes a2a-card=<https url>",
  accept: "--accept-signer and --accept take a ref: a peer address, a grounding ref, an external address or a runtime file",
  trust: "--trust takes a trust file (plumbline.trust.json)",
} as const;

/** The watch's own sentence for each refusal of the shared parser. It takes no positionals, so none is `extra`. */
function usageSentence(error: ArgsError): string {
  if (error.reason !== "missing") return `unknown argument ${error.arg}`;
  return Object.hasOwn(BAD_VALUE, error.arg) ? BAD_VALUE[error.arg as keyof typeof BAD_VALUE] : error.message;
}

function refuse(sentence: string): 2 {
  process.stderr.write(`${sentence}\n${USAGE}`);
  return 2;
}

export async function runWatchCommand(argv: string[]): Promise<number> {
  let args;
  try {
    args = parseArgs(argv, ["root", "timeout", "url", "trust"], ["init", "relock", "allow-local"], { repeatable: ["source", "drop", "external", "accept-signer", "accept"] });
  } catch (error) {
    if (error instanceof ArgsError) return refuse(usageSentence(error));
    throw error;
  }
  const { json } = args;
  const init = args.flags.has("init");
  const relock = args.flags.has("relock");
  const extraSources = repeated(args, "source");
  const dropSources = repeated(args, "drop");
  const externalArgs = repeated(args, "external");
  const acceptSigners = repeated(args, "accept-signer");
  const accept = repeated(args, "accept");
  const trustPath = args.values.get("trust");

  const rootValue = args.values.get("root");
  if (rootValue === "") return refuse(BAD_VALUE.root);
  const root = rootValue === undefined ? process.cwd() : resolve(rootValue);
  if (extraSources.includes("")) return refuse(BAD_VALUE.source);
  if (dropSources.includes("")) return refuse(BAD_VALUE.drop);

  let timeoutMs: number | undefined;
  const timeoutValue = args.values.get("timeout");
  if (timeoutValue !== undefined) {
    const n = Number(timeoutValue);
    if (!Number.isFinite(n) || n <= 0) return refuse(BAD_VALUE.timeout);
    timeoutMs = n;
  }

  const url = args.values.get("url");
  const allowLocal = args.flags.has("allow-local");
  if (url !== undefined) {
    if (rootValue !== undefined || init || relock || extraSources.length > 0 || dropSources.length > 0 || externalArgs.length > 0) {
      return refuse("--url reads a published site; --root, --init, --relock, --source, --drop and --external work on a checkout");
    }
    if (!isHttpUrl(url)) return refuse(BAD_VALUE.url);
    if (allowLocal) process.stderr.write(`${ALLOW_LOCAL_WARNING}\n`);
    let report;
    try {
      report = await runWatchUrl({ url, ...(timeoutMs !== undefined ? { timeoutMs } : {}), ...(allowLocal ? { allowLocal } : {}) });
    } catch (error) {
      process.stderr.write(`watch failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
      return 2;
    }
    return printReport(report, json);
  }
  if (allowLocal) return refuse("--allow-local goes with --url: a checkout is read from disk");

  if (init && relock) return refuse("--init and --relock do not go together: --init writes a first lock, --relock replaces one");
  if (dropSources.length > 0 && !relock) return refuse("--drop goes with --relock: it takes a ref out of the lock --relock writes");
  if (dropSources.some((ref) => extraSources.includes(ref))) return refuse("--source and --drop name the same ref");
  if ((acceptSigners.length > 0 || accept.length > 0) && !relock) return refuse("--accept-signer and --accept go with --relock: they name what the relock accepts");
  if (acceptSigners.includes("") || accept.includes("")) return refuse(BAD_VALUE.accept);
  if (trustPath === "") return refuse(BAD_VALUE.trust);
  // --trust (UAT-4): opt-in; the watch never needs a trust store. It only lets a peer's rotation be checked.
  let trust: TrustEntry[] | undefined;
  if (trustPath !== undefined) {
    try {
      trust = (await readTrustFile(trustPath)).entries;
    } catch (error) {
      process.stderr.write(`watch failed: ${error instanceof Error ? error.message : "the trust file could not be read"}\n`);
      return 2;
    }
  }
  const externals: { kind: ExternalKind; url: string }[] = [];
  for (const arg of externalArgs) {
    const parsed = parseExternalArg(arg);
    if ("problem" in parsed) return refuse(parsed.problem);
    externals.push(parsed);
  }
  if (externals.length > 0 && !init && !relock) return refuse("--external goes with --init or --relock: it adds a definition to the lock they write");
  const options = { root, init, ...(timeoutMs !== undefined ? { timeoutMs } : {}) };

  if (relock) {
    let result;
    try {
      result = await runRelock(options, { extraSources, dropSources, externals, acceptSigners, accept, ...(trust !== undefined ? { trust } : {}) });
    } catch (error) {
      if (error instanceof RelockRefused) return printRefusal(error.refusal, rootValue ?? ".", json, trust !== undefined);
      process.stderr.write(`watch failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
      return 2;
    }
    // UAT-12 (DEV-L1-04): the reminder to sign again only where there is a signature to keep
    process.stdout.write(relockOutput(result, json, existsSync(join(root, SIGNATURE_FILE))));
    return 0;
  }

  if (init) {
    let written;
    try {
      written = await runInit(options, { extraSources, externals, ...(trust !== undefined ? { trust } : {}) });
    } catch (error) {
      process.stderr.write(`watch failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
      return 2;
    }
    if (written !== null) {
      // UAT-14 (TOM-L1-14): --init says it wrote the lock, and its JSON carries lockState like every other report
      if (json) {
        const first = written.firstSigners !== undefined ? { firstSigners: written.firstSigners } : {};
        process.stdout.write(`${JSON.stringify({ lock: "written", lockState: "found", findings: written.findings, facts: factCoverageCounts(written.coverage), ...first }, null, 2)}\n`);
      } else {
        process.stdout.write(`watch: wrote ${LOCK_FILE} (${await lockCounts(root)})\n`);
        for (const line of factCoverageLines(written.coverage)) process.stdout.write(`${line}\n`);
        for (const f of written.firstSigners ?? []) process.stdout.write(`signer  peer ${f.peer}: ${firstSignerWords(f)}\n`);
        for (const f of written.findings) process.stdout.write(`${f.severity.padEnd(5)} ${f.kind} ${f.ref}: ${f.summary}\n`);
      }
      return exitOf({ findings: written.findings });
    }
  }

  let report;
  try {
    report = await runWatch(options, { extraSources, externals, ...(trust !== undefined ? { trust } : {}) });
  } catch (error) {
    process.stderr.write(`watch failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    return 2;
  }
  if (init) {
    // UAT-14 (TOM-L1-05): a lock is already there, and --init never rewrites one. Each --source and --external it
    // could not add is said, naming the relock that does; then this is the ordinary watch of that lock.
    const notAdded: WatchReport["findings"] = [
      ...extraSources.map((ref) => ({ kind: "grounding" as const, severity: "info" as const, ref, summary: `Not added: a lock was already there, and --init never rewrites one; add it with watch --relock --source ${ref} after a review.` })),
      ...externals.map((e) => ({ kind: "peer" as const, severity: "info" as const, ref: e.url, summary: `Not added: a lock was already there, and --init never rewrites one; add it with watch --relock --external ${e.kind}=${e.url} after a review.` })),
    ];
    const kept = { ...report, findings: [...notAdded, ...report.findings] };
    if (json) {
      process.stdout.write(`${JSON.stringify({ lock: "kept", ...kept }, null, 2)}\n`);
      return exitOf(kept);
    }
    process.stdout.write(`watch: kept the ${LOCK_FILE} that is there (--init never rewrites a lock; accept changes with watch --relock after a review)\n`);
    return printReport(kept, false);
  }
  return printReport(report, json);
}

/**
 * What a relock that wrote the lock prints (exported so the UAT harness prints the same): the change list, each signer
 * change a person accepted (UAT-4, TOM-RC-1) and each first signer recorded (TOM-RC-4), the facts the lock watches, the
 * findings and the reminder to sign again; with --json the same in one object, the facts as counts only. UAT-12
 * (DEV-L1-04): `siteSigned` is whether the site publishes plumbline.signature.json; a site with none is not told to sign
 * again (its lock is not a signed file there), and its --json has no `reminder`.
 */
export function relockOutput(result: RelockReport, json: boolean, siteSigned = true): string {
  const { coverage, ...rest } = result;
  // --json carries what the lock watches in counts by kind; the literals are for the publisher's terminal only
  if (json) return `${JSON.stringify({ relocked: true, ...rest, facts: factCoverageCounts(coverage), ...(siteSigned ? { reminder: RESIGN_REMINDER } : {}) }, null, 2)}\n`;
  const lines = [`relock: wrote plumbline.lock.json (the previous lock was ${result.previous})`];
  const { added, removed, changed } = result.changes;
  for (const ref of added) lines.push(`added   ${ref}`);
  for (const ref of removed) lines.push(`removed ${ref}`);
  for (const ref of changed) lines.push(`changed ${ref}`);
  // a signer a person accepted (UAT-4), with what the --trust file says of it, in the change list
  for (const c of result.signers ?? []) {
    lines.push(
      c.to === undefined
        ? `signer  peer ${c.peer}: ${c.from} -> none (${c.how}; the lock remembers ${c.from}, so a later signature by another key is refused until a person names this peer)`
        : `signer  peer ${c.peer}: ${c.from} -> ${c.to} (${c.how}; ${c.backing ?? ""})`,
    );
  }
  // a first signer, of a peer first seen (a relisted one included) or recorded unsigned before (TOM-RC-4)
  for (const f of result.firstSigners ?? []) lines.push(`signer  peer ${f.peer}: ${firstSignerWords(f)}`);
  if (added.length + removed.length + changed.length === 0) lines.push("no ref changed");
  lines.push(...factCoverageLines(coverage));
  for (const f of result.findings) lines.push(`${f.severity.padEnd(5)} ${f.kind} ${f.ref}: ${f.summary}`);
  if (siteSigned) lines.push(RESIGN_REMINDER);
  return `${lines.join("\n")}\n`;
}

/**
 * The commands a refused relock suggests (TOM-RC-3): one per peer, so no single printed line accepts two signers. With
 * one peer pending it is `--accept-signer <peer>` (a relock that accepts everything else too, as a plain one would);
 * with more, each is narrowed to its peer (`--accept <peer> --accept-signer <peer>`), since naming one signer still
 * leaves the relock refused for the others. Without a trust file, `--trust <your trust file>` is added, so the relock
 * says whether that file backs the new key (a peer that publishes no signature now has no new key to back).
 */
export function refusalCommands(peers: readonly { peer: string; to?: string }[], rootArg: string, trustGiven: boolean): string[] {
  return peers.map((p) => {
    const narrow = peers.length > 1 ? `--accept ${p.peer} ` : "";
    const trust = !trustGiven && p.to !== undefined ? " --trust <your trust file>" : "";
    return `plumbline watch --root ${rootArg} --relock ${narrow}--accept-signer ${p.peer}${trust}`;
  });
}

/**
 * What a relock refused for a signer change prints (UAT-4; exported so the UAT harness prints the same): each peer named
 * with the kid the lock recorded and what it is signed by now, or that it publishes no signature, then one command per
 * peer that a person runs after deciding (TOM-RC-3). CI never passes --accept-signer.
 */
export function signerRefusalOutput(peers: readonly SignerChange[], rootArg: string, json: boolean, trustGiven: boolean): string {
  const commands = refusalCommands(peers, rootArg, trustGiven);
  if (json) return `${JSON.stringify({ relocked: false, refused: "signer", peers, commands }, null, 2)}\n`;
  const lines = ["relock refused: a peer's signer is not the one the lock recorded, and a relock does not accept a signer change unless a person names the peer. Nothing was written."];
  for (const p of peers) {
    lines.push(
      p.to === undefined
        ? `  peer ${p.peer}: the lock recorded ${p.from}; ${p.how} (it answers 404 or 410 for its signature)`
        : `  peer ${p.peer}: the lock recorded ${p.from}; it is now signed by ${p.to} (${p.how})`,
    );
  }
  lines.push(
    peers.length === 1
      ? "Decide first whether you accept the change (verify --url; adopt for a published rotation; for a different key with no rotation, or no signature, ask the publisher out of band). Then run:"
      : "Decide each peer on its own first (verify --url; adopt for a published rotation; for a different key with no rotation, or no signature, ask the publisher out of band). Each command accepts only its peer; a plain relock accepts the rest once no signer change is pending:",
  );
  for (const c of commands) lines.push(`  ${c}`);
  return `${lines.join("\n")}\n`;
}

/** A relock that wrote nothing (UAT-4): a signer change exits 1; --drop naming a peer is a usage error, exit 2. */
function printRefusal(refusal: RelockRefusal, rootArg: string, json: boolean, trustGiven: boolean): 1 | 2 {
  if (refusal.refused === "drop-peer") {
    return refuse(`--drop takes a grounding ref or an external definition the lock holds; ${refusal.refs.join(", ")} ${refusal.refs.length === 1 ? "is a peer, which leaves" : "are peers, which leave"} the lock when no network names ${refusal.refs.length === 1 ? "it" : "them"}: remove ${refusal.refs.length === 1 ? "it" : "them"} from the site's network (or links.json), then relock`);
  }
  process.stdout.write(signerRefusalOutput(refusal.peers, rootArg, json, trustGiven));
  return 1;
}

/** Prints a watch report and returns its exit code: 1 for a lock that was not found or any warn or block, else 0. */
/**
 * The report in a terminal, or as one JSON document. UAT-16: a ref can come from a stranger's published lock (watch
 * --url), so every text line has its control characters (C0, C1, DEL, the bidi controls) replaced, as `plumbline diff`
 * does (printable); JSON escapes them itself.
 */
function printReport(report: WatchReport, json: boolean): 0 | 1 {
  const noLock = report.lockState !== undefined && report.lockState !== "found";
  if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    if (noLock) process.stdout.write(`lock  ${report.lockState}: ${printable(report.lockSummary ?? "")}\n`);
    else if (report.findings.length === 0) process.stdout.write("watch: no drift\n");
    for (const f of report.findings) process.stdout.write(`${f.severity.padEnd(5)} ${f.kind} ${printable(f.ref)}: ${printable(f.summary)}\n`);
  }
  return exitOf(report);
}

/** What a lock just written holds, in the words init uses: "N grounding sources, N runtime files, N peers, N pending". */
async function lockCounts(root: string): Promise<string> {
  const read = await readLock(root);
  const lock = read.kind === "ok" ? read.lock : undefined;
  const n = (o: object | undefined) => Object.keys(o ?? {}).length;
  return `${lock?.grounding.sources.length ?? 0} grounding sources, ${n(lock?.runtime.files)} runtime files, ${n(lock?.peers)} peers, ${n(lock?.pendingPeers)} pending${lock?.external !== undefined ? `, ${n(lock.external)} external` : ""}`;
}

function exitOf(report: WatchReport): 0 | 1 {
  const noLock = report.lockState !== undefined && report.lockState !== "found";
  return noLock || report.findings.some((f) => f.severity === "warn" || f.severity === "block") ? 1 : 0;
}
