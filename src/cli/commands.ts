// The signing commands: keygen, sign, verify, rotate, revoke. Exit 0 clean, 1 findings, 2 usage or I/O error.
// The verifier's trust-store commands (trust, adopt) are in trust-command.ts.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CliError, UsageError, nowFrom, parseArgs, required, type ParsedArgs } from "./args.js";
import {
  PRIVATE_KEY_FILE,
  PRIVATE_KEY_TYPE,
  keyRecordOf,
  loadSubject,
  markRevoked,
  privateKeyInRootProblem,
  readPrivateKeyFile,
  readTextIfPresent,
  readTrustFile,
  trustStoreOf,
  writeTrustFile,
  type PrivateKeyFile,
  type TrustFile,
} from "./files.js";
import {
  ALG,
  DEFAULT_LIFETIME_DAYS,
  FORMAT_VERSION,
  KEY_FILE,
  LINKS_FILE,
  LOCK_FILE,
  MANIFEST_FILE,
  MAX_STATEMENTS_PER_FILE,
  MAX_SUBJECTS,
  REVOCATION_FILE,
  REVOCATION_TYPE,
  ROTATION_FILE,
  ROTATION_TYPE,
  SIGNATURE_FILE,
  applyRevocationText,
  generateKey,
  isAcceptableOrigin,
  isPrivateKeyFile,
  isKid,
  isIsoUtc,
  signerChangeDetail,
  isSafeSubjectPath,
  parseManifest,
  revokeKey,
  rotateKey,
  signSubjects,
  signedPathsOf,
  statementsOf,
  verifySignature,
  signDetachedJws,
  verifyDetachedJws,
  type PlumblineKey,
  type PlumblineRevocation,
  type PlumblineRotation,
  type PlumblineSignature,
  type SubjectFile,
  type VerifyResult,
  subjectDigest,
} from "../core/index.js";
import { DEFAULT_TIMEOUT_MS, safeFetch, SafeFetchError, type SafeFetchOptions } from "../net/safe-fetch.js";
import { unsignedBytesOf } from "../core/canonical.js";
import { verifyText } from "../core/keys.js";

export type Out = (line: string) => void;

/** Each signing command's own usage line, printed after the message on a usage error (index.ts). */
export const USAGE = {
  keygen: "usage: plumbline keygen --out <dir> [--now <iso>] [--json]",
  sign: "usage: plumbline sign --root <site dir> (--key <plumbline.private.json> | --key-env <NAME>) --origin <https origin> [--days N] [--now <iso>] [--json]",
  verify:
    "usage: plumbline verify --trust <plumbline.trust.json> (--root <site dir> [--origin <https origin>] | --url <https site base> [--allow-local] [--timeout <seconds>]) [--jws <detached JWS file>] [--now <iso>] [--json]",
  "export-jws": "usage: plumbline export-jws --root <site dir> --key <plumbline.private.json> [--out <file>] [--json]",
  rotate: "usage: plumbline rotate --root <site dir> --old-key <old private file> --new-key <new private file> [--now <iso>] [--json] (a planned change of key only; after a leak, use revoke)",
  revoke: "usage: plumbline revoke --root <site dir> --key <private file> [--reason <text>] [--now <iso>] [--json]",
  trust:
    "usage: plumbline trust --file <plumbline.trust.json> (--key <plumbline-key.json> --origin <https origin> | --url <https site base> [--allow-local] [--require-dns]) [--yes] [--json]",
  adopt:
    "usage: plumbline adopt --trust <plumbline.trust.json> (--root <site dir> --origin <https origin> | --url <https site base> [--allow-local]) [--yes] [--json]",
} as const;

export const ORIGIN_RULE =
  "--origin must be an https:// origin with no path and no trailing slash, like https://example.com (http only for localhost, *.localhost and 127.0.0.1)";

/**
 * What keygen says about the key it wrote. The CLI writes a key file, so only the file's custody is said here; the
 * browser-memory warning belongs to the Desk, which holds a key in a page (site/strings.js keeps its own copy).
 */
export const KEY_CUSTODY_WARNINGS = [
  "Back up the private key file and never commit it: key loss is identity loss, and a leaked key lets anyone sign as you.",
] as const;

export function emit(args: ParsedArgs, out: Out, json: unknown, lines: string[]): void {
  if (args.json) out(JSON.stringify(json));
  else for (const line of lines) out(line);
}

async function writeNew(file: string, text: string, mode: number): Promise<void> {
  try {
    await writeFile(file, text, { flag: "wx", mode });
  } catch (error) {
    if ((error as { code?: string }).code === "EEXIST") throw new CliError(`refusing to overwrite ${file}`);
    throw new CliError(`cannot write ${file}: ${(error as Error).message}`);
  }
}

async function exists(file: string): Promise<boolean> {
  return (await readTextIfPresent(file)) !== undefined;
}

export async function keygen(argv: string[], out: Out): Promise<number> {
  const args = parseArgs(argv, ["out", "now"]);
  const dir = required(args, "out");
  const privatePath = path.join(dir, PRIVATE_KEY_FILE);
  const publicPath = path.join(dir, ...KEY_FILE.split("/"));
  if ((await exists(privatePath)) || (await exists(publicPath))) {
    throw new CliError(`refusing to overwrite an existing key in ${dir}`);
  }
  // keygen's layout puts .well-known/ under --out, which invites --out <site root>; the private key would then be published
  const looksLikeSite = (await exists(path.join(dir, MANIFEST_FILE))) || (await exists(path.join(dir, SIGNATURE_FILE)));
  const { key, privateKey } = await generateKey(nowFrom(args));
  const privateFile: PrivateKeyFile = {
    type: PRIVATE_KEY_TYPE,
    version: FORMAT_VERSION,
    alg: ALG,
    kid: key.kid,
    privateKey,
  };
  await mkdir(path.dirname(publicPath), { recursive: true });
  await writeNew(privatePath, JSON.stringify(privateFile, null, 2) + "\n", 0o600);
  await writeNew(publicPath, JSON.stringify(key, null, 2) + "\n", 0o644);
  const warnings: string[] = [...KEY_CUSTODY_WARNINGS];
  if (looksLikeSite) {
    warnings.unshift(
      `${dir} looks like a site folder (it holds ${MANIFEST_FILE} or ${SIGNATURE_FILE}): move ${PRIVATE_KEY_FILE} out of it before you publish, or the key is published with the site; sign refuses a key inside the site root.`,
    );
  }
  emit(
    args,
    out,
    { kid: key.kid, privateKeyFile: privatePath, publicKeyRecord: publicPath, warnings },
    [`kid ${key.kid}`, `private key: ${privatePath}`, `public record: ${publicPath}`, ...warnings.map((w) => `WARNING: ${w}`)],
  );
  return 0;
}

/**
 * The warnings `sign --key-env` prints for CI: the key arrives in the environment, so its custody is the CI's secret
 * store. Plumbline reads it once, never prints it and never writes it to disk.
 */
export const CI_KEY_WARNINGS = [
  "The signing key came from the environment: keep it in the CI's secret store, give only the signing job access to it, and never echo it in a step.",
  "A key in a CI secret can sign as you from any workflow that can read the secret: limit who can change those workflows, and revoke the key (plumbline revoke) if one was ever exposed.",
] as const;

/**
 * The private key for `sign`: from `--key <file>` (refused when it sits in the site root) or from `--key-env <NAME>`
 * (the JSON of a plumbline.private.json in that environment variable, for a CI secret). A refusal names the file or the
 * variable, never its content.
 */
async function signingKeyOf(args: ParsedArgs, root: string): Promise<{ privateFile: PrivateKeyFile; fromEnv?: string }> {
  const keyPath = args.values.get("key");
  const keyEnv = args.values.get("key-env");
  if ((keyPath === undefined) === (keyEnv === undefined)) throw new UsageError("give exactly one of --key and --key-env");
  if (keyPath !== undefined) {
    // A private key inside the folder that gets published is a published key (p-1c7bd9).
    const inRoot = await privateKeyInRootProblem(root, keyPath);
    if (inRoot !== undefined) throw new CliError(`refusing to sign: ${inRoot}`);
    return { privateFile: await readPrivateKeyFile(keyPath) };
  }
  const name = keyEnv as string;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new UsageError("--key-env takes the NAME of an environment variable");
  const text = process.env[name];
  if (text === undefined || text.trim() === "") throw new CliError(`the environment variable ${name} is not set or is empty`);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CliError(`the environment variable ${name} does not hold a Plumbline private key file (it is not JSON)`);
  }
  if (!isPrivateKeyFile(value)) throw new CliError(`the environment variable ${name} does not hold a Plumbline private key file`);
  // the root must still not hold a private key file of its own: a folder deploy would publish it
  if ((await readTextIfPresent(path.join(root, PRIVATE_KEY_FILE))) !== undefined) {
    throw new CliError(`refusing to sign: the site root ${root} holds a ${PRIVATE_KEY_FILE}, so publishing the folder publishes a private key`);
  }
  return { privateFile: { type: PRIVATE_KEY_TYPE, version: FORMAT_VERSION, alg: ALG, kid: value.kid, privateKey: value.privateKey }, fromEnv: name };
}

export async function sign(argv: string[], out: Out): Promise<number> {
  const args = parseArgs(argv, ["root", "key", "key-env", "origin", "days", "now"]);
  const root = required(args, "root");
  const origin = required(args, "origin");
  if (!isAcceptableOrigin(origin)) throw new UsageError(ORIGIN_RULE);
  const now = nowFrom(args) ?? new Date();
  let lifetimeDays = DEFAULT_LIFETIME_DAYS;
  const days = args.values.get("days");
  if (days !== undefined) {
    lifetimeDays = Number(days);
    if (!Number.isFinite(lifetimeDays) || lifetimeDays <= 0) throw new UsageError("--days must be a positive number");
  }
  const { privateFile, fromEnv } = await signingKeyOf(args, root);
  const keyRecord = await keyRecordOf(privateFile, now);

  // A key the site itself has revoked must never sign again: the publisher learns it here, not from its verifiers.
  // Only a revocation that verifies under THIS key counts (one by another key, or one that is not JSON, revokes
  // nothing here); the revocation of an earlier key, published beside a site signed by its replacement, is normal.
  const revocationText = await readTextIfPresent(path.join(root, REVOCATION_FILE));
  if (revocationText !== undefined) {
    const self = { kid: privateFile.kid, origin, publicKey: keyRecord.publicKey };
    if ((await applyRevocationText(revocationText, [self])).applied) {
      throw new CliError(
        `this key (${privateFile.kid}) is revoked by the site's ${REVOCATION_FILE}, so verifiers refuse everything it signs: ` +
          "make a new key with plumbline keygen, sign with it, and re-establish trust through the first-contact ceremony",
      );
    }
  }

  const manifest = await loadSubject(root, MANIFEST_FILE);
  if (!manifest) throw new CliError(`${MANIFEST_FILE} not found in ${root}`);
  const parsed = parseManifest(manifest.content);
  if (parsed === undefined) throw new CliError(`${MANIFEST_FILE} is not valid JSON`);
  const links = await loadSubject(root, LINKS_FILE);
  const lock = await loadSubject(root, LOCK_FILE);
  // Which files are signed is core's signedPathsOf, the one rule the CLI and the Desk share. Every subject is the
  // file's exact bytes; the lock is signed when it exists, so run `watch --init` BEFORE `sign`.
  let paths: string[];
  try {
    paths = signedPathsOf(parsed, { links: links !== undefined, lock: lock !== undefined });
  } catch (error) {
    throw new CliError(`cannot sign: ${(error as Error).message}`);
  }
  const files: SubjectFile[] = [];
  for (const rel of paths) {
    if (rel === MANIFEST_FILE) files.push(manifest);
    else if (rel === LINKS_FILE && links) files.push(links);
    else if (rel === LOCK_FILE && lock) files.push(lock);
    else {
      const loaded = await loadSubject(root, rel);
      if (!loaded) throw new CliError(`a file the manifest makes the runtime load is missing: ${rel}`);
      files.push(loaded);
    }
  }

  let signature: PlumblineSignature;
  try {
    signature = await signSubjects({
      privateKey: privateFile.privateKey,
      key: keyRecord,
      origin,
      files,
      now,
      lifetimeDays,
    });
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(`cannot sign: ${(error as Error).message}`);
  }
  const target = path.join(root, SIGNATURE_FILE);
  await writeFile(target, JSON.stringify(signature, null, 2) + "\n", "utf8");
  // First-contact verifiers fetch the site's key record: after a rotation or a new key the old one may still be there.
  const keyRecordState = await publishedKeyRecordState(root, keyRecord);
  const lines = [`signed ${signature.subjects.length} files as ${signature.kid} for ${origin}, expires ${signature.expiresAt}`, `wrote ${target}`];
  if (fromEnv !== undefined) for (const w of CI_KEY_WARNINGS) lines.push(`NOTE: ${w}`);
  // UAT-15 (INE-L1-02): a key adopted through a key the site revokes is revoked with it at every verifier that adopted it
  const throughRevoked = await revokedPredecessors(root, signature.kid);
  for (const x of throughRevoked) {
    lines.push(
      `WARNING: this key (${signature.kid}) is named in ${ROTATION_FILE} as the successor of ${x.kid}, and ${REVOCATION_FILE} ` +
        (x.verified ? `revokes ${x.kid}` : `holds a revocation of ${x.kid} (not checked here: this command does not have ${x.kid}'s public key)`) +
        `: a verifier that adopted ${signature.kid} through ${x.kid} revokes ${signature.kid} with it and refuses this signature (invalid revoked). ` +
        "If that key was revoked after a leak, make a new key with plumbline keygen, sign with it, and re-establish trust through the first-contact ceremony.",
    );
  }
  if (keyRecordState === "absent") {
    lines.push(
      `WARNING: ${root} publishes no ${KEY_FILE}; first-contact verifiers need this key's record (keygen wrote it beside the private key): publish it, unless the site serves it from elsewhere`,
    );
  } else if (keyRecordState === "mismatch") {
    lines.push(
      `WARNING: the ${KEY_FILE} in ${root} is not the record of the key that signed (${signature.kid}); publish this key's record, or first-contact verifiers will be shown the wrong key`,
    );
  }
  emit(
    args,
    out,
    {
      kid: signature.kid,
      origin,
      signatureFile: target,
      expiresAt: signature.expiresAt,
      subjects: signature.subjects.map((s) => s.path),
      keyRecord: keyRecordState,
      ...(fromEnv !== undefined ? { keyFrom: "env", custody: [...CI_KEY_WARNINGS] } : {}),
      ...(throughRevoked.length > 0 ? { adoptedThroughRevoked: throughRevoked.map((x) => x.kid) } : {}),
    },
    lines,
  );
  return 0;
}

/** Whether the root's published key record is the signing key's: `match`, `mismatch` (another key, or unreadable) or `absent`. */
async function publishedKeyRecordState(root: string, key: PlumblineKey): Promise<"match" | "mismatch" | "absent"> {
  const text = await readTextIfPresent(path.join(root, ...KEY_FILE.split("/")));
  if (text === undefined) return "absent";
  try {
    const record = JSON.parse(text) as { kid?: unknown; publicKey?: unknown } | null;
    return record !== null && record.kid === key.kid && record.publicKey === key.publicKey ? "match" : "mismatch";
  } catch {
    return "mismatch";
  }
}

/** What `verify` and `adopt` did with a `plumbline-revocation.json` found beside the site. */
export interface RevocationReport {
  /** The path or URL it was read from. */
  file: string;
  /** True when the revocation verified under a trusted key and that key's entries were marked revoked. */
  applied: boolean;
  /** True when the accepted revocation was written to the trust file (false when the file already carried it). */
  recorded: boolean;
  /** The trust file written, and how many of its entries gained `revokedAt`, when `recorded`. */
  trustFile?: string;
  recordedEntries?: number;
  /** Each entry that gained `revokedAt` (UAT-8), with the key a cascaded one was adopted through. */
  recordedKeys?: { kid: string; origin: string; adoptedVia?: string }[];
  /** One result per trust entry for the revoked kid; one result when no entry matched or the file was unreadable. */
  results: VerifyResult[];
}

/**
 * Applies a revocation's text to the trust file with core's applyRevocationText (to every trust entry for the revoked
 * kid: a revocation names no origin, and it spreads down every adoptedVia chain), and, when `record` is true and it
 * verified, writes the result to the trust file at once, so the key stays dead after the revocation file is gone. A
 * revocation that does not verify under the trusted key changes nothing. `trust.entries` is updated in memory either way.
 */
export async function applyRevocationToTrust(
  file: string,
  text: string,
  trust: TrustFile,
  record: boolean,
  now: Date = new Date(),
): Promise<RevocationReport> {
  const outcome = await applyRevocationText(text, trust.entries);
  if (!outcome.applied) return { file, applied: false, recorded: false, results: outcome.results };
  // which entries gain revokedAt now, by kid and origin, and the key a cascaded one was adopted through (UAT-8)
  const before = trust.raw.entries.map((raw) => raw.revokedAt);
  const newly = outcome.entries
    .filter((e, i) => e.revokedAt !== undefined && before[i] !== e.revokedAt)
    .map((e) => ({ kid: e.kid, origin: e.origin, ...(e.adoptedVia !== undefined && outcome.entries.some((p) => p.kid === e.adoptedVia && p.revokedAt === e.revokedAt) ? { adoptedVia: e.adoptedVia } : {}) }));
  const changed = markRevoked(trust, outcome.entries, now);
  if (record && changed > 0) await writeTrustFile(trust);
  const recorded = record && changed > 0;
  return {
    file,
    applied: true,
    recorded,
    ...(recorded ? { trustFile: trust.file, recordedEntries: changed, recordedKeys: newly } : {}),
    results: outcome.results,
  };
}

/** The lines a revocation report prints, before the verdict line. `record`: whether the caller writes the trust file. */
export function revocationLines(report: RevocationReport, trust: TrustFile, record: boolean): string[] {
  const lines = [
    report.applied
      ? `revocation applied: ${REVOCATION_FILE} revokes a trusted key, so nothing that key signs is accepted`
      : `revocation not applied: ${REVOCATION_FILE} is present but changes nothing for this trust store`,
    // UAT-8 (INE-L1-07): the word "verified" is never set beside a revoked kid; what verified is the statement
    ...report.results.map((r) =>
      r.verdict === "verified" && r.kid !== undefined
        ? `  the revocation statement verified under the trusted key ${r.kid}${r.origin ? ` (${r.origin})` : ""}: that key is revoked`
        : `  ${formatResult(r)}`,
    ),
  ];
  if (!report.applied) return lines;
  if (report.recorded) {
    const n = report.recordedEntries ?? 0;
    // each key that died, and through which key a cascaded one died (UAT-8, INE-L1-01)
    const named = (report.recordedKeys ?? []).map((k) => `${k.kid} for ${k.origin}${k.adoptedVia !== undefined ? ` (adopted through revoked key ${k.adoptedVia})` : ""}`);
    lines.push(`revocation recorded in ${trust.file} (${n} ${n === 1 ? "entry" : "entries"}${named.length > 0 ? `: ${named.join("; ")}` : ""})`);
  } else if (record) lines.push(`revocation already recorded in ${trust.file}`);
  else lines.push(`revocation applied in memory only; nothing was written to ${trust.file}`);
  return lines;
}

export function formatResult(result: VerifyResult): string {
  const parts: string[] = [result.verdict];
  if (result.reason) parts.push(result.reason);
  if (result.kid) parts.push(`kid=${result.kid}`);
  if (result.origin) parts.push(`origin=${result.origin}`);
  const head = parts.join(" ");
  return result.detail ? `${head} - ${result.detail}` : head;
}

/**
 * One site file as `verify`, `adopt` and `trust` read it: its exact bytes, absent (no file, or HTTP 404/410), or
 * unreadable. `overCeiling`: it was refused because it is larger than the byte ceiling for one file.
 */
export type SiteRead = { state: "present"; bytes: Uint8Array } | { state: "absent" } | { state: "unknown"; why: string; overCeiling?: true };

/** How one file is read: `subject` files (signed code and networks) may be as large as a runtime file. */
export interface ReadOptions {
  subject?: boolean;
}

/** Where `verify`, `adopt` and `trust` read a site from: a folder on disk, or a site base fetched through safeFetch. */
export interface SiteSource {
  /** The folder or the base URL, for messages. */
  where: string;
  /** The path or URL of one site file, for messages and reports. */
  label(rel: string): string;
  read(rel: string, options?: ReadOptions): Promise<SiteRead>;
}

export function localSite(root: string): SiteSource {
  return {
    where: root,
    label: (rel) => path.join(root, ...rel.split("/")),
    async read(rel) {
      let loaded: SubjectFile | undefined;
      try {
        loaded = await loadSubject(root, rel);
      } catch (error) {
        // an unsafe path in a signature must never read outside the root; it simply is not a present file
        if (error instanceof CliError && !isSafeSubjectPath(rel)) return { state: "absent" };
        throw error;
      }
      return loaded ? { state: "present", bytes: loaded.content as Uint8Array } : { state: "absent" };
    },
  };
}

/**
 * The overall time `verify --url` (and `adopt`, `trust` by URL) may spend fetching one site, in seconds, unless
 * `--timeout` says otherwise. Derivation: a real site is about 10 files (the Desk signs 6, plus the signature, the key
 * record, the revocation, links.json and the lock), each answering in well under a second; 60 s is several times that
 * on a slow link, and it bounds a hostile site that answers every file at the 10 s per-file limit.
 */
export const SITE_DEADLINE_SECONDS = 60;

/**
 * The options safeFetch gets for one signed file: the runtime-file ceiling (`MAX_RUNTIME_FILE_BYTES`, 4 MiB, in
 * src/net/fetch-types.ts), because a signed action module or coded-tools bundle can be larger than the 512 KiB a
 * network definition needs. `ceiling: "runtime"` is the option the Desk's fetcher already reads (site/fetcher.js);
 * safeFetch honours it once src/net adds it (until then it keeps the 512 KiB ceiling, and a larger file is reported as
 * over the ceiling, never as absent).
 */
type SubjectFetchOptions = SafeFetchOptions & { ceiling?: "runtime" };

/**
 * A site base fetched through safeFetch: https only (http and loopback with `allowLocal`), every address checked after
 * DNS, a capped body and an absolute timeout per file, and one overall deadline (`deadlineMs` from the first read) for
 * every file together. Each file is its exact bytes as served; 404 and 410 mean absent; any other answer, a failure or
 * a passed deadline is `unknown`, never absent.
 */
export function remoteSite(base: URL, allowLocal: boolean, deadlineMs: number = SITE_DEADLINE_SECONDS * 1000): SiteSource {
  const urlOf = (rel: string): string => new URL(rel, base).toString();
  let deadline: number | undefined;
  return {
    where: base.toString(),
    label: urlOf,
    async read(rel, options = {}) {
      if (!isSafeSubjectPath(rel)) return { state: "absent" }; // never fetched: it could leave the site base
      deadline ??= Date.now() + deadlineMs;
      const left = deadline - Date.now();
      if (left <= 0) return { state: "unknown", why: "the overall time limit for this site passed" };
      const fetchOptions: SubjectFetchOptions = {
        allowLocal,
        timeoutMs: Math.min(DEFAULT_TIMEOUT_MS, left),
        ...(options.subject ? { ceiling: "runtime" as const } : {}),
      };
      try {
        const response = await safeFetch(urlOf(rel), fetchOptions);
        if (response.ok) return { state: "present", bytes: response.bytes };
        if (response.status === 404 || response.status === 410) return { state: "absent" };
        return { state: "unknown", why: `HTTP ${response.status}` };
      } catch (error) {
        if (error instanceof SafeFetchError) {
          return { state: "unknown", why: `${error.code}: ${error.message}`, ...(error.code === "body-too-large" ? { overCeiling: true as const } : {}) };
        }
        throw error;
      }
    },
  };
}

/** `--url`: an https site base (http only with --allow-local), its query and fragment dropped, read as a folder. */
export function siteBaseOf(text: string, allowLocal: boolean): URL {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new UsageError("--url must be an https:// address of the site base, like https://example.com/");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && allowLocal)) {
    throw new UsageError("--url must be an https:// address of the site base (http only with --allow-local, for a site on this machine)");
  }
  url.search = "";
  url.hash = "";
  if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`;
  return url;
}

export const decode = (bytes: Uint8Array): string => new TextDecoder("utf-8").decode(bytes);

/** `--timeout <seconds>` for a site read by URL: a positive number, at most an hour. */
function deadlineOf(args: ParsedArgs): number {
  const raw = args.values.get("timeout");
  if (raw === undefined) return SITE_DEADLINE_SECONDS * 1000;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 3600) {
    throw new UsageError("--timeout must be a number of seconds, more than 0 and at most 3600");
  }
  return seconds * 1000;
}

/**
 * `plumbline verify`. `options.quiet`: the caller (`gate --trust`, UAT-10) already printed the --allow-local warning, so
 * it is not printed twice.
 */
export async function verify(argv: string[], out: Out, options: { quiet?: boolean } = {}): Promise<number> {
  const args = parseArgs(argv, ["root", "url", "trust", "now", "origin", "timeout", "jws"], ["allow-local"]);
  const root = args.values.get("root");
  // --jws: the signature is checked through a detached JWS (core/jws.ts) instead of its native sig; same trust store,
  // same files, same verdicts. The JWS file is always local: it is the verifier's copy of what the publisher exported.
  const jwsPath = args.values.get("jws");
  let jws: string | undefined;
  if (jwsPath !== undefined) {
    try {
      jws = await readFile(jwsPath, "utf8");
    } catch {
      throw new CliError(`cannot read the JWS file ${jwsPath}`);
    }
  }
  const url = args.values.get("url");
  if ((root === undefined) === (url === undefined)) throw new UsageError("give exactly one of --root and --url");
  if (url !== undefined && args.values.has("origin")) {
    throw new UsageError("--url checks the files as the URL's own origin; leave out --origin");
  }
  if (root !== undefined && args.flags.has("allow-local")) throw new UsageError("--allow-local goes with --url");
  if (root !== undefined && args.values.has("timeout")) throw new UsageError("--timeout goes with --url");
  const allowLocal = args.flags.has("allow-local");
  const deadlineMs = deadlineOf(args);
  const base = url !== undefined ? siteBaseOf(url, allowLocal) : undefined;
  const expectedOrigin = base !== undefined ? base.origin : args.values.get("origin");
  if (base === undefined && expectedOrigin !== undefined && !isAcceptableOrigin(expectedOrigin)) {
    throw new UsageError("--origin must be an https:// origin with no path and no trailing slash, like https://example.com");
  }
  const trustPath = required(args, "trust");
  // UAT-23 (INE-L1-12): a trust file that is not there is an empty one, so a first verify is a verdict (unverifiable:
  // nothing is trusted yet) that names how to make one, never an I/O error
  const trustAbsent = (await readTextIfPresent(trustPath)) === undefined;
  const trust = await readTrustFile(trustPath, { missingIsEmpty: true });
  if (allowLocal && options.quiet !== true) process.stderr.write("WARNING: --allow-local: http and loopback addresses are allowed for this run (private ranges stay refused)\n");
  const site = base !== undefined ? remoteSite(base, allowLocal, deadlineMs) : localSite(root as string);

  // Files the site did not serve cleanly (an error, not a 404): a verified verdict is never claimed over them.
  const unread: string[] = [];

  // 1. A revocation first: an accepted one is recorded in the trust file, so the key stays dead without it.
  let revocation: RevocationReport | undefined;
  const revocationRead = await site.read(REVOCATION_FILE);
  if (revocationRead.state === "present") {
    revocation = await applyRevocationToTrust(site.label(REVOCATION_FILE), decode(revocationRead.bytes), trust, true, nowFrom(args) ?? new Date());
  } else if (revocationRead.state === "unknown") unread.push(REVOCATION_FILE);

  // 2. The signature.
  // UAT-7 (REC-3, TOM-L1-06, INE-L1-04): a site with no signature, or one whose signature cannot be read, is a verdict
  // (`unverifiable`, exit 1, a JSON verdict), as on the Desk, never an I/O error; and whatever the revocation above
  // recorded is printed with it, never written silently.
  const sigRead = await site.read(SIGNATURE_FILE);
  let signature: unknown;
  if (sigRead.state === "present") {
    try {
      signature = JSON.parse(decode(sigRead.bytes));
    } catch {
      signature = undefined;
    }
  }

  let result: VerifyResult;
  if (sigRead.state === "absent") {
    result = { verdict: "unverifiable", detail: `This site publishes no ${SIGNATURE_FILE} (${site.where}), so nothing can be verified.` };
  } else if (sigRead.state === "unknown") {
    // a site that could not be read is an I/O error (exit 2), not a verdict; what the revocation recorded is said first
    if (revocation) for (const line of revocationLines(revocation, trust, true)) process.stderr.write(`${line}\n`);
    throw new CliError(`cannot fetch ${SIGNATURE_FILE} from ${site.where} (${sigRead.why})`);
  } else if (signature === undefined) {
    result = { verdict: "invalid", reason: "malformed", detail: "The signature file is not valid JSON." };
  } else {
    // 3. Every signed file as exact bytes, plus links.json and the lock whenever they exist, signed or not: an
    // unsigned one is `tampered`, because the runtime (links) and the Desk (lock) read them.
    const files: SubjectFile[] = [];
    let unreadSubjects = 0;
    let oversizeSubjects = 0;
    const subjects = (signature as { subjects?: unknown } | null)?.subjects;
    // A signature listing more files than any real site is malformed (core's shape check says so): none is fetched.
    if (Array.isArray(subjects) && subjects.length <= MAX_SUBJECTS) {
      for (const subject of subjects) {
        const rel = (subject as { path?: unknown } | null)?.path;
        if (typeof rel !== "string" || files.some((f) => f.path === rel)) continue;
        const read = await site.read(rel, { subject: true });
        if (read.state === "present") files.push({ path: rel, content: read.bytes });
        else if (read.state === "unknown" && read.overCeiling) oversizeSubjects += 1;
        else if (read.state === "unknown") unreadSubjects += 1;
      }
    }
    for (const rel of [LINKS_FILE, LOCK_FILE]) {
      if (files.some((f) => f.path === rel)) continue;
      const read = await site.read(rel);
      if (read.state === "present") files.push({ path: rel, content: read.bytes });
      else if (read.state === "unknown") unread.push(rel);
    }
    if (unreadSubjects > 0) unread.push(`${unreadSubjects} signed ${unreadSubjects === 1 ? "file" : "files"}`);

    let publishedKey: PlumblineKey | undefined;
    const keyRead = await site.read(KEY_FILE);
    if (keyRead.state === "present") {
      try {
        const parsed: unknown = JSON.parse(decode(keyRead.bytes));
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) publishedKey = parsed as PlumblineKey;
      } catch {
        publishedKey = undefined;
      }
    }
    const now = nowFrom(args);
    const verifyOptions = {
      ...(now ? { now } : {}),
      ...(publishedKey ? { publishedKey } : {}),
      ...(expectedOrigin !== undefined ? { expectedOrigin } : {}),
    };
    result =
      jws !== undefined
        ? await verifyDetachedJws(signature as PlumblineSignature, jws, files, trustStoreOf(trust.entries), verifyOptions)
        : await verifySignature(signature as PlumblineSignature, files, trustStoreOf(trust.entries), verifyOptions);
    // A file that could not be read might be the one that makes the difference: not verified, and not tampered either.
    // But a file that WAS read and does not match its signed digest is proof of tampering whatever else is unread: keep
    // `tampered` then (the Desk's rule too, site/desk.js).
    let readMismatch = false;
    if (result.reason === "tampered") {
      const signed = (signature as PlumblineSignature).subjects ?? [];
      for (const s of signed) {
        const f = files.find((x) => x.path === s.path);
        if (f && (await subjectDigest(f.content as Uint8Array | string)) !== s.sha256) { readMismatch = true; break; }
      }
    }
    if ((unread.length > 0 || oversizeSubjects > 0) && (result.verdict === "verified" || (result.reason === "tampered" && !readMismatch))) {
      const parts: string[] = [];
      if (unread.length > 0) parts.push(`The site did not serve ${unread.join(", ")} (an error, not a 404)`);
      if (oversizeSubjects > 0) {
        const n = `${oversizeSubjects} signed ${oversizeSubjects === 1 ? "file is" : "files are"} over the size ceiling for one fetched file`;
        parts.push(parts.length > 0 ? n : n.charAt(0).toUpperCase() + n.slice(1));
      }
      const revocationUnknown = unread.includes(REVOCATION_FILE) ? ", and whether its key has been revoked," : "";
      result = {
        verdict: "unverifiable",
        ...(result.kid ? { kid: result.kid } : {}),
        ...(result.origin ? { origin: result.origin } : {}),
        detail: `${parts.join(", and ")}, so whether the signature covers everything the runtime loads${revocationUnknown} cannot be told.`,
      };
    }
  }

  const lines = revocation ? revocationLines(revocation, trust, true) : [];
  if (trustAbsent) {
    const first = base !== undefined ? `plumbline trust --file ${trustPath} --url ${base.toString()}${allowLocal ? " --allow-local" : ""}` : `plumbline trust --file ${trustPath} --key <the publisher's plumbline-key.json> --origin <origin>`;
    lines.push(`note: there is no trust file at ${trustPath}, so nothing is trusted yet and no signature can verify; make one by a first contact, after you confirm the key out of band: ${first}`);
  }
  // The rotation the site publishes, if any: its statements' `from` kids, held to their pattern.
  const rotationRead = await site.read(ROTATION_FILE);
  let rotationFrom: string[] = [];
  if (rotationRead.state === "present") {
    try {
      const listed = statementsOf(JSON.parse(decode(rotationRead.bytes)));
      if ("statements" in listed) rotationFrom = listed.statements.map((s) => (s as { from?: unknown } | null)?.from).filter(isKid);
    } catch {
      rotationFrom = [];
    }
  }
  // UAT-8 (TOM-L2-03): a signer this file does not trust for the origin while it trusts another key there is a swapped
  // signer, said as such (the trusted key, the signer, and whether a rotation from the trusted key is published)
  const sigOrigin = (signature as { origin?: unknown } | undefined)?.origin;
  // UAT-17 (TOM-L1-02): the same fact as a field, so a script tells a rotation from a bare signer change without the sentence
  let signerChange: { trusted: string[]; signer: string; rotation: "published" | "none"; rotationFrom?: string } | undefined;
  if (result.verdict === "unverifiable" && result.kid !== undefined && (expectedOrigin === undefined || sigOrigin === expectedOrigin) && typeof sigOrigin === "string") {
    const swapped = signerChangeDetail(trust.entries, result.kid, sigOrigin, rotationFrom);
    if (swapped !== undefined) {
      result = { ...result, detail: swapped };
      const signer = result.kid as string;
      const trusted = trust.entries.filter((e) => e.origin === sigOrigin && e.kid !== signer && e.revokedAt === undefined && isKid(e.kid)).map((e) => e.kid);
      const from = trusted.find((k) => rotationFrom.includes(k));
      signerChange = { trusted, signer, rotation: from !== undefined ? "published" : "none", ...(from !== undefined ? { rotationFrom: from } : {}) };
    }
  }
  // A published rotation is the way to an unknown signer that an old trusted key named: point at adopt, never adopt here.
  // Read through the same source as everything else, so `--url` gets the hint too (p-58cf7d). Not for a rotation from
  // a key this file records as revoked: adopt refuses it (UAT-8, INE-L1-15).
  const fromRevoked = rotationFrom.some((k) => trust.entries.some((e) => e.kid === k && e.revokedAt !== undefined));
  let hint: { code: "rotation-published"; rotationFrom: string[]; command: string } | undefined;
  if (result.verdict === "unverifiable" && rotationRead.state === "present" && !fromRevoked) {
    const how =
      base !== undefined
        ? `plumbline adopt --url ${base.toString()} --trust ${trustPath}${allowLocal ? " --allow-local" : ""}`
        : `plumbline adopt --root ${root} --trust ${trustPath} --origin ${expectedOrigin ?? "<origin>"}`;
    lines.push(`hint: ${ROTATION_FILE} is present; if you trust a key it rotates from, check it with ${how}`);
    hint = { code: "rotation-published", rotationFrom, command: how };
  }
  // The verdict line stays last, so a reader of the text output finds it in the same place with or without a revocation.
  // A verified line carries its limit and the signature's expiry, so it can be pasted into a note as it is (UAT-8).
  const expires = (signature as { expiresAt?: unknown } | undefined)?.expiresAt;
  lines.push(
    result.verdict === "verified" && typeof expires === "string" && isIsoUtc(expires)
      ? `${formatResult(result)} The signature is valid until ${expires.slice(0, 10)}. Verified means these files are the publisher's and unchanged, not that the site is safe, honest or correct.`
      : formatResult(result),
  );
  emit(args, out, { results: [result], ...(revocation ? { revocation } : {}), ...(trustAbsent ? { trustFileAbsent: true } : {}), ...(signerChange !== undefined ? { signerChange } : {}), ...(hint !== undefined ? { hint } : {}) }, lines);
  return result.verdict === "verified" ? 0 : 1;
}

/**
 * `plumbline export-jws --root <site> --key <private file> [--out <file>]`: the site's plumbline.signature.json as a
 * detached JWS (core/jws.ts, docs/jws-profile.md), signed by the key that made it. It needs the private key, because a
 * JWS signs its header with the payload. It refuses a key whose kid is not the signature's, and a signature that does
 * not verify under that key (sign again first), so it never vouches for a statement the key did not make. The native
 * file is not changed and nothing is published.
 */
export async function exportJws(argv: string[], out: Out): Promise<number> {
  const args = parseArgs(argv, ["root", "key", "out"]);
  const root = required(args, "root");
  const keyPath = required(args, "key");
  const inRoot = await privateKeyInRootProblem(root, keyPath);
  if (inRoot !== undefined) throw new CliError(`refusing to export: ${inRoot}`);
  const text = await readTextIfPresent(path.join(root, SIGNATURE_FILE));
  if (text === undefined) throw new CliError(`${SIGNATURE_FILE} not found in ${root}: sign the site first`);
  let signature: PlumblineSignature;
  try {
    signature = JSON.parse(text) as PlumblineSignature;
  } catch {
    throw new CliError(`${SIGNATURE_FILE} is not valid JSON`);
  }
  const privateFile = await readPrivateKeyFile(keyPath);
  const record = await keyRecordOf(privateFile, new Date());
  // UAT-15 (INE-L1-16): a key the site revokes exports nothing, as sign and rotate refuse it
  await refuseRevoked(
    root,
    record,
    (kid) =>
      `this key (${kid}) is revoked by the site's ${REVOCATION_FILE}, so verifiers refuse everything it signs, a JWS included: ` +
      "make a new key with plumbline keygen, sign the site with it, and export with that key",
  );
  if (typeof signature !== "object" || signature === null || signature.kid !== record.kid) {
    throw new CliError(`${SIGNATURE_FILE} was not made by this key (its kid is not ${record.kid}); export with the key that signed it`);
  }
  let statement: string;
  try {
    statement = unsignedBytesOf(signature);
  } catch {
    throw new CliError(`${SIGNATURE_FILE} carries a value canonical JSON cannot encode`);
  }
  if (typeof signature.sig !== "string" || !(await verifyText(record.publicKey, statement, signature.sig))) {
    throw new CliError(`${SIGNATURE_FILE} does not verify under this key, so it is not exported; sign the site again first`);
  }
  const jws = await signDetachedJws(signature, privateFile.privateKey);
  const target = args.values.get("out");
  if (target !== undefined) await writeNew(target, `${jws}\n`, 0o644);
  emit(args, out, { jws, kid: record.kid, ...(target !== undefined ? { file: target } : {}) }, target !== undefined ? [`wrote ${target} (detached JWS, EdDSA, kid ${record.kid})`] : [jws]);
  return 0;
}

/** The origin of the self-check entry rotate and revoke apply a revocation file to: a revocation names no origin. */
const SELF_ORIGIN = "https://self.invalid";

/**
 * The statements an existing `plumbline-rotation.json` or `plumbline-revocation.json` holds, so a new one is appended
 * and never overwrites them: one statement or a list (statementsOf), each an object of the expected `type` whose kid
 * fields (`fields`) hold well-formed kids. Anything else is refused (exit 2) rather than overwritten: it may be the
 * only copy of a statement the publisher made.
 */
function existingStatements(file: string, text: string, type: string, fields: readonly string[]): Record<string, unknown>[] {
  const refuse = (): never => {
    throw new CliError(`refusing to overwrite ${file}: it holds neither a ${type} statement nor a list of them; move it aside, keeping any statement in it`);
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return refuse();
  }
  const listed = statementsOf(parsed);
  if ("problem" in listed) return refuse();
  for (const s of listed.statements) {
    const o = s as Record<string, unknown> | null;
    if (typeof o !== "object" || o === null || Array.isArray(o) || o.type !== type || fields.some((f) => !isKid(o[f]))) return refuse();
  }
  return listed.statements as Record<string, unknown>[];
}

/** Refuses (exit 2) when the site's revocation file holds a revocation of `key` that verifies under that key. */
/** The rotation statements the root's plumbline-rotation.json holds whose kids are well formed; [] when none or unreadable. */
async function rotationsIn(root: string): Promise<{ from: string; to: string; toPublicKey?: string }[]> {
  const text = await readTextIfPresent(path.join(root, ROTATION_FILE));
  if (text === undefined) return [];
  try {
    const listed = statementsOf(JSON.parse(text));
    if ("problem" in listed) return [];
    return listed.statements.flatMap((s) => {
      const o = s as { from?: unknown; to?: unknown; toPublicKey?: unknown } | null;
      return o !== null && isKid(o.from) && isKid(o.to) ? [{ from: o.from, to: o.to, ...(typeof o.toPublicKey === "string" ? { toPublicKey: o.toPublicKey } : {}) }] : [];
    });
  } catch {
    return [];
  }
}

/**
 * UAT-15 (INE-L1-02): the keys the root's rotation file names as the predecessor of `kid` and that the root's revocation
 * file revokes. `verified`: the revocation verifies under that key's public key, found in the chain (an earlier
 * statement's `toPublicKey`) or in the root's own key record; otherwise the file only names it (not checked here).
 */
async function revokedPredecessors(root: string, kid: string): Promise<{ kid: string; verified: boolean }[]> {
  const chain = await rotationsIn(root);
  const from = [...new Set(chain.filter((s) => s.to === kid).map((s) => s.from))];
  if (from.length === 0) return [];
  const text = await readTextIfPresent(path.join(root, REVOCATION_FILE));
  if (text === undefined) return [];
  let named: string[] = [];
  try {
    const listed = statementsOf(JSON.parse(text));
    if (!("problem" in listed)) named = listed.statements.map((s) => (s as { kid?: unknown } | null)?.kid).filter(isKid);
  } catch {
    return [];
  }
  const record = await readTextIfPresent(path.join(root, ...KEY_FILE.split("/")));
  const out: { kid: string; verified: boolean }[] = [];
  for (const x of from.filter((k) => named.includes(k))) {
    let publicKey = chain.find((s) => s.to === x)?.toPublicKey;
    if (publicKey === undefined && record !== undefined) {
      try {
        const r = JSON.parse(record) as { kid?: unknown; publicKey?: unknown };
        if (r.kid === x && typeof r.publicKey === "string") publicKey = r.publicKey;
      } catch {
        // no usable key record
      }
    }
    if (publicKey === undefined) {
      out.push({ kid: x, verified: false });
      continue;
    }
    if ((await applyRevocationText(text, [{ kid: x, origin: SELF_ORIGIN, publicKey }])).applied) out.push({ kid: x, verified: true });
  }
  return out;
}

/** What `rotate` says every time (UAT-15, INE-L1-02): it is for a planned change, never the response to a leak. */
export const ROTATE_IS_PLANNED =
  "rotate is for a planned change of key, not for a leak: after a leak, revoke the leaked key (plumbline revoke) and make a new key, because a verifier that adopted a successor through the leaked key revokes that successor with it.";

async function refuseRevoked(root: string, key: PlumblineKey, sentence: (kid: string) => string): Promise<void> {
  const text = await readTextIfPresent(path.join(root, REVOCATION_FILE));
  if (text === undefined) return;
  if ((await applyRevocationText(text, [{ kid: key.kid, origin: SELF_ORIGIN, publicKey: key.publicKey }])).applied) {
    throw new CliError(sentence(key.kid));
  }
}

export async function rotate(argv: string[], out: Out): Promise<number> {
  const args = parseArgs(argv, ["root", "old-key", "new-key", "now"]);
  const root = required(args, "root");
  const oldPath = required(args, "old-key");
  const newPath = required(args, "new-key");
  const now = nowFrom(args) ?? new Date();
  for (const keyPath of [oldPath, newPath]) {
    const inRoot = await privateKeyInRootProblem(root, keyPath);
    if (inRoot !== undefined) throw new CliError(`refusing to rotate: ${inRoot}`);
  }
  const oldFile = await readPrivateKeyFile(oldPath);
  const newFile = await readPrivateKeyFile(newPath);
  const oldKey = await keyRecordOf(oldFile, now);
  const newKey = await keyRecordOf(newFile, now);

  // A rotation from a key the site has revoked is refused by every verifier (p-a4ae28), and a successor the site has
  // revoked is never trusted again: the publisher learns it here. Only a revocation that verifies under that key counts.
  await refuseRevoked(
    root,
    oldKey,
    (kid) =>
      `the old key (${kid}) is revoked by the site's ${REVOCATION_FILE}, so every verifier refuses a rotation from it: ` +
      "make a new key with plumbline keygen, sign with it, and re-establish trust through the first-contact ceremony",
  );
  await refuseRevoked(
    root,
    newKey,
    (kid) => `the new key (${kid}) is revoked by the site's ${REVOCATION_FILE}, and a revoked key is never trusted again: rotate to a key that is not revoked`,
  );

  let statement: PlumblineRotation;
  try {
    statement = await rotateKey({ oldPrivateKey: oldFile.privateKey, oldKey, newKey, now });
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(`cannot rotate: ${(error as Error).message}`);
  }

  // The file keeps the chain (p-86391a): a verifier several rotations behind follows it from the newest key it trusts.
  const target = path.join(root, ROTATION_FILE);
  const existingText = await readTextIfPresent(target);
  let chain: Record<string, unknown>[] = [];
  if (existingText !== undefined) {
    chain = existingStatements(target, existingText, ROTATION_TYPE, ["from", "to"]);
    const last = chain[chain.length - 1] as { from: string; to: string };
    if (last.from === statement.from && last.to === statement.to) {
      emit(args, out, { from: statement.from, to: statement.to, rotationFile: target, written: false, chainLength: chain.length }, [
        `already published: ${target} already ends with the rotation ${statement.from} -> ${statement.to}; nothing written`,
      ]);
      return 0;
    }
    if (last.to !== statement.from) {
      throw new CliError(
        `refusing to rotate: ${target} holds a rotation chain that ends at key ${last.to}, and this rotation starts from ${statement.from}; ` +
          `a chain continues from its newest key so verifiers can follow it: rotate from ${last.to}, or, if that chain belongs to an identity you retired, move ${ROTATION_FILE} aside first`,
      );
    }
    if (chain.some((s) => s.from === statement.to || s.to === statement.to)) {
      throw new CliError(`refusing to rotate: the new key ${statement.to} already appears in the chain in ${target}, and a chain never returns to a key it left`);
    }
    if (chain.length >= MAX_STATEMENTS_PER_FILE) {
      throw new CliError(`refusing to rotate: ${target} already holds ${chain.length} statements, the most one file may hold`);
    }
  }
  const body = chain.length === 0 ? statement : [...chain, statement];
  await mkdir(root, { recursive: true });
  await writeFile(target, JSON.stringify(body, null, 2) + "\n", "utf8");
  const chainLength = chain.length + 1;
  emit(args, out, { from: statement.from, to: statement.to, rotationFile: target, written: true, chainLength }, [
    `rotation ${statement.from} -> ${statement.to}`,
    chainLength === 1 ? `wrote ${target}` : `appended to ${target} (a chain of ${chainLength} rotations; verifiers follow it from the newest key they trust)`,
    "next: publish the new key record, then run sign with the new key so the site is signed by it.",
    `NOTE: ${ROTATE_IS_PLANNED}`,
  ]);
  return 0;
}

export async function revoke(argv: string[], out: Out): Promise<number> {
  const args = parseArgs(argv, ["root", "key", "reason", "now"]);
  const root = required(args, "root");
  const keyPath = required(args, "key");
  const now = nowFrom(args) ?? new Date();
  const reason = args.values.get("reason");
  // A key kept inside the site may well be the leak being revoked: revoking is never refused, but the person is told.
  const inRoot = await privateKeyInRootProblem(root, keyPath);
  const privateFile = await readPrivateKeyFile(keyPath);
  const key = await keyRecordOf(privateFile, now);
  let statement: PlumblineRevocation;
  try {
    statement = await revokeKey({
      privateKey: privateFile.privateKey,
      key,
      now,
      ...(reason !== undefined ? { reason } : {}),
    });
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(`cannot revoke: ${(error as Error).message}`);
  }

  // Every revocation the site ever made stays published (p-c30007): a second one is appended, never written over the
  // first, so a verifier that missed the first still finds it.
  const target = path.join(root, REVOCATION_FILE);
  const existingText = await readTextIfPresent(target);
  let list: Record<string, unknown>[] = [];
  if (existingText !== undefined) {
    list = existingStatements(target, existingText, REVOCATION_TYPE, ["kid"]);
    const self = { kid: key.kid, origin: SELF_ORIGIN, publicKey: key.publicKey };
    if ((await applyRevocationText(existingText, [self])).applied) {
      emit(args, out, { kid: key.kid, revocationFile: target, written: false, revocations: list.length }, [
        `already revoked: ${target} already holds a revocation of ${key.kid} made by this key; nothing written`,
      ]);
      return 0;
    }
    if (list.length >= MAX_STATEMENTS_PER_FILE) {
      throw new CliError(`refusing to revoke: ${target} already holds ${list.length} statements, the most one file may hold`);
    }
  }
  const body = list.length === 0 ? statement : [...list, statement];
  await mkdir(root, { recursive: true });
  await writeFile(target, JSON.stringify(body, null, 2) + "\n", "utf8");
  const revocations = list.length + 1;
  // UAT-15 (INE-L1-02): a successor the site already published for this key dies with it at every verifier that adopted
  // it through this key, so it is not the key to re-sign with
  const successors = [...new Set((await rotationsIn(root)).filter((r) => r.from === key.kid).map((r) => r.to))];
  emit(
    args,
    out,
    { kid: statement.kid, revokedAt: statement.revokedAt, revocationFile: target, written: true, revocations, ...(successors.length > 0 ? { successors } : {}) },
    [
      `revoked ${statement.kid} at ${statement.revokedAt}`,
      revocations === 1 ? `wrote ${target}` : `appended to ${target} (${revocations} revocations; every one stays published)`,
      ...(inRoot !== undefined ? [`WARNING: ${inRoot}`] : []),
      ...successors.map(
        (s) =>
          `WARNING: ${ROTATION_FILE} names ${s} as the successor of ${statement.kid}. A verifier that adopted ${s} through ${statement.kid} revokes ${s} with this revocation (it follows the chain a key was adopted through), so ${s} is not the key to re-sign with: make another key with plumbline keygen.`,
      ),
      // UAT-15 (INE-L1-13): said every time, not only in the docs
      `This revocation is final: every verifier that reads it refuses ${statement.kid} from then on, whatever the dates, and never trusts it again; there is no un-revoke. Tell your verifiers directly as well: one that never fetches this file keeps trusting the key.`,
      // UAT-15 (INE-L1-05): the DNS record is a second channel, and it must stop vouching for the revoked key
      "next: publish it at the site base, make a NEW key with keygen, re-sign the site with it, replace the site's _plumbline TXT record so it names the new kid alone " +
        "(plumbline dns --key <the new key record> --origin <origin>), and re-establish trust with your verifiers through the first-contact ceremony. " +
        "Never rotate from the revoked key: verifiers refuse it.",
    ],
  );
  return 0;
}
