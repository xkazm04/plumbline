// The signing commands: keygen, sign, verify, rotate, revoke. Exit 0 clean, 1 findings, 2 usage or I/O error.
// The verifier's trust-store commands (trust, adopt) are in trust-command.ts.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CliError, UsageError, nowFrom, parseArgs, required, type ParsedArgs } from "./args.js";
import {
  PRIVATE_KEY_FILE,
  PRIVATE_KEY_TYPE,
  keyRecordOf,
  loadSubject,
  markRevoked,
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
  REVOCATION_FILE,
  ROTATION_FILE,
  SIGNATURE_FILE,
  applyRevocationText,
  generateKey,
  isAcceptableOrigin,
  isSafeSubjectPath,
  parseManifest,
  revokeKey,
  rotateKey,
  signSubjects,
  signedPathsOf,
  verifySignature,
  type PlumblineKey,
  type PlumblineRevocation,
  type PlumblineSignature,
  type SubjectFile,
  type VerifyResult,
} from "../core/index.js";
import { safeFetch, SafeFetchError } from "../net/safe-fetch.js";

export type Out = (line: string) => void;

/** Each signing command's own usage line, printed after the message on a usage error (index.ts). */
export const USAGE = {
  keygen: "usage: plumbline keygen --out <dir> [--now <iso>] [--json]",
  sign: "usage: plumbline sign --root <site dir> --key <plumbline.private.json> --origin <https origin> [--days N] [--now <iso>] [--json]",
  verify:
    "usage: plumbline verify --trust <plumbline.trust.json> (--root <site dir> [--origin <https origin>] | --url <https site base> [--allow-local]) [--now <iso>] [--json]",
  rotate: "usage: plumbline rotate --root <site dir> --old-key <old private file> --new-key <new private file> [--now <iso>] [--json]",
  revoke: "usage: plumbline revoke --root <site dir> --key <private file> [--reason <text>] [--now <iso>] [--json]",
  trust: "usage: plumbline trust --key <plumbline-key.json> --origin <https origin> --file <plumbline.trust.json> [--yes] [--json]",
  adopt: "usage: plumbline adopt --root <site dir> --trust <plumbline.trust.json> --origin <https origin> [--yes] [--json]",
} as const;

export const ORIGIN_RULE =
  "--origin must be an https:// origin with no path and no trailing slash, like https://example.com (http only for localhost and 127.0.0.1)";

export const KEY_CUSTODY_WARNINGS = [
  "Back up the private key file and never commit it: key loss is identity loss, and a leaked key lets anyone sign as you.",
  "A key held in browser memory is exposed to every script running on that origin; keep signing keys out of the page.",
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
  emit(
    args,
    out,
    { kid: key.kid, privateKeyFile: privatePath, publicKeyRecord: publicPath, warnings: KEY_CUSTODY_WARNINGS },
    [
      `kid ${key.kid}`,
      `private key: ${privatePath}`,
      `public record: ${publicPath}`,
      ...KEY_CUSTODY_WARNINGS.map((w) => `WARNING: ${w}`),
    ],
  );
  return 0;
}

export async function sign(argv: string[], out: Out): Promise<number> {
  const args = parseArgs(argv, ["root", "key", "origin", "days", "now"]);
  const root = required(args, "root");
  const origin = required(args, "origin");
  const keyPath = required(args, "key");
  if (!isAcceptableOrigin(origin)) throw new UsageError(ORIGIN_RULE);
  const now = nowFrom(args) ?? new Date();
  let lifetimeDays = DEFAULT_LIFETIME_DAYS;
  const days = args.values.get("days");
  if (days !== undefined) {
    lifetimeDays = Number(days);
    if (!Number.isFinite(lifetimeDays) || lifetimeDays <= 0) throw new UsageError("--days must be a positive number");
  }
  const privateFile = await readPrivateKeyFile(keyPath);
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
  emit(
    args,
    out,
    { kid: signature.kid, origin, signatureFile: target, expiresAt: signature.expiresAt, subjects: signature.subjects.map((s) => s.path) },
    [`signed ${signature.subjects.length} files as ${signature.kid} for ${origin}, expires ${signature.expiresAt}`, `wrote ${target}`],
  );
  return 0;
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
): Promise<RevocationReport> {
  const outcome = await applyRevocationText(text, trust.entries);
  if (!outcome.applied) return { file, applied: false, recorded: false, results: outcome.results };
  const changed = markRevoked(trust, outcome.entries);
  if (record && changed > 0) await writeTrustFile(trust);
  const recorded = record && changed > 0;
  return {
    file,
    applied: true,
    recorded,
    ...(recorded ? { trustFile: trust.file, recordedEntries: changed } : {}),
    results: outcome.results,
  };
}

/** The lines a revocation report prints, before the verdict line. `record`: whether the caller writes the trust file. */
export function revocationLines(report: RevocationReport, trust: TrustFile, record: boolean): string[] {
  const lines = [
    report.applied
      ? `revocation applied: ${REVOCATION_FILE} revokes a trusted key, so nothing that key signs is accepted`
      : `revocation not applied: ${REVOCATION_FILE} is present but changes nothing for this trust store`,
    ...report.results.map((r) => `  ${formatResult(r)}`),
  ];
  if (!report.applied) return lines;
  if (report.recorded) {
    const n = report.recordedEntries ?? 0;
    lines.push(`revocation recorded in ${trust.file} (${n} ${n === 1 ? "entry" : "entries"})`);
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

/** One site file as `verify` reads it: its exact bytes, absent (no file, or HTTP 404/410), or unreadable. */
type SiteRead = { state: "present"; bytes: Uint8Array } | { state: "absent" } | { state: "unknown"; why: string };

/** Where `verify` reads a site from: a folder on disk, or a site base fetched through safeFetch. */
interface SiteSource {
  /** The folder or the base URL, for messages. */
  where: string;
  /** The path or URL of one site file, for messages and reports. */
  label(rel: string): string;
  read(rel: string): Promise<SiteRead>;
}

function localSite(root: string): SiteSource {
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
 * A site base fetched through safeFetch: https only (http and loopback with `allowLocal`), every address checked after
 * DNS, a capped body and an absolute timeout. Each file is its exact bytes as served; 404 and 410 mean absent; any
 * other answer or a failure is `unknown`, never absent.
 */
function remoteSite(base: URL, allowLocal: boolean): SiteSource {
  const urlOf = (rel: string): string => new URL(rel, base).toString();
  return {
    where: base.toString(),
    label: urlOf,
    async read(rel) {
      if (!isSafeSubjectPath(rel)) return { state: "absent" }; // never fetched: it could leave the site base
      try {
        const response = await safeFetch(urlOf(rel), { allowLocal });
        if (response.ok) return { state: "present", bytes: response.bytes };
        if (response.status === 404 || response.status === 410) return { state: "absent" };
        return { state: "unknown", why: `HTTP ${response.status}` };
      } catch (error) {
        if (error instanceof SafeFetchError) return { state: "unknown", why: `${error.code}: ${error.message}` };
        throw error;
      }
    },
  };
}

/** `--url`: an https site base (http only with --allow-local), its query and fragment dropped, read as a folder. */
function siteBaseOf(text: string, allowLocal: boolean): URL {
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

const decode = (bytes: Uint8Array): string => new TextDecoder("utf-8").decode(bytes);

export async function verify(argv: string[], out: Out): Promise<number> {
  const args = parseArgs(argv, ["root", "url", "trust", "now", "origin"], ["allow-local"]);
  const root = args.values.get("root");
  const url = args.values.get("url");
  if ((root === undefined) === (url === undefined)) throw new UsageError("give exactly one of --root and --url");
  if (url !== undefined && args.values.has("origin")) {
    throw new UsageError("--url checks the files as the URL's own origin; leave out --origin");
  }
  if (root !== undefined && args.flags.has("allow-local")) throw new UsageError("--allow-local goes with --url");
  const allowLocal = args.flags.has("allow-local");
  const base = url !== undefined ? siteBaseOf(url, allowLocal) : undefined;
  const expectedOrigin = base !== undefined ? base.origin : args.values.get("origin");
  if (base === undefined && expectedOrigin !== undefined && !isAcceptableOrigin(expectedOrigin)) {
    throw new UsageError("--origin must be an https:// origin with no path and no trailing slash, like https://example.com");
  }
  const trustPath = required(args, "trust");
  const trust = await readTrustFile(trustPath);
  if (allowLocal) process.stderr.write("WARNING: --allow-local: http and loopback addresses are allowed for this run (private ranges stay refused)\n");
  const site = base !== undefined ? remoteSite(base, allowLocal) : localSite(root as string);

  // Files the site did not serve cleanly (an error, not a 404): a verified verdict is never claimed over them.
  const unread: string[] = [];

  // 1. A revocation first: an accepted one is recorded in the trust file, so the key stays dead without it.
  let revocation: RevocationReport | undefined;
  const revocationRead = await site.read(REVOCATION_FILE);
  if (revocationRead.state === "present") {
    revocation = await applyRevocationToTrust(site.label(REVOCATION_FILE), decode(revocationRead.bytes), trust, true);
  } else if (revocationRead.state === "unknown") unread.push(REVOCATION_FILE);

  // 2. The signature.
  const sigRead = await site.read(SIGNATURE_FILE);
  if (sigRead.state === "absent") throw new CliError(`${SIGNATURE_FILE} not found in ${site.where}`);
  if (sigRead.state === "unknown") throw new CliError(`cannot fetch ${SIGNATURE_FILE} from ${site.where} (${sigRead.why})`);
  let signature: unknown;
  try {
    signature = JSON.parse(decode(sigRead.bytes));
  } catch {
    signature = undefined;
  }

  let result: VerifyResult;
  if (signature === undefined) {
    result = { verdict: "invalid", reason: "malformed", detail: "The signature file is not valid JSON." };
  } else {
    // 3. Every signed file as exact bytes, plus links.json and the lock whenever they exist, signed or not: an
    // unsigned one is `tampered`, because the runtime (links) and the Desk (lock) read them.
    const files: SubjectFile[] = [];
    let unreadSubjects = 0;
    const subjects = (signature as { subjects?: unknown } | null)?.subjects;
    if (Array.isArray(subjects)) {
      for (const subject of subjects) {
        const rel = (subject as { path?: unknown } | null)?.path;
        if (typeof rel !== "string" || files.some((f) => f.path === rel)) continue;
        const read = await site.read(rel);
        if (read.state === "present") files.push({ path: rel, content: read.bytes });
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
    result = await verifySignature(signature as PlumblineSignature, files, trustStoreOf(trust.entries), {
      ...(now ? { now } : {}),
      ...(publishedKey ? { publishedKey } : {}),
      ...(expectedOrigin !== undefined ? { expectedOrigin } : {}),
    });
    // A file that could not be read might be the one that makes the difference: not verified, and not tampered either.
    if (unread.length > 0 && (result.verdict === "verified" || result.reason === "tampered")) {
      result = {
        verdict: "unverifiable",
        ...(result.kid ? { kid: result.kid } : {}),
        ...(result.origin ? { origin: result.origin } : {}),
        detail: `The site did not serve ${unread.join(", ")} (an error, not a 404), so whether the signature covers everything the runtime loads, and whether its key has been revoked, cannot be told.`,
      };
    }
  }

  const lines = revocation ? revocationLines(revocation, trust, true) : [];
  // A published rotation is the way to an unknown signer that an old trusted key named: point at adopt, never adopt here.
  if (result.verdict === "unverifiable" && root !== undefined && (await readTextIfPresent(path.join(root, ROTATION_FILE))) !== undefined) {
    lines.push(
      `hint: ${ROTATION_FILE} is present; if you trust the key it rotates from, check it with plumbline adopt --root ${root} --trust ${trustPath} --origin <origin>`,
    );
  }
  // The verdict line stays last, so a reader of the text output finds it in the same place with or without a revocation.
  lines.push(formatResult(result));
  emit(args, out, { results: [result], ...(revocation ? { revocation } : {}) }, lines);
  return result.verdict === "verified" ? 0 : 1;
}

export async function rotate(argv: string[], out: Out): Promise<number> {
  const args = parseArgs(argv, ["root", "old-key", "new-key", "now"]);
  const root = required(args, "root");
  const oldPath = required(args, "old-key");
  const newPath = required(args, "new-key");
  const now = nowFrom(args) ?? new Date();
  const oldFile = await readPrivateKeyFile(oldPath);
  const newFile = await readPrivateKeyFile(newPath);
  let statement;
  try {
    statement = await rotateKey({
      oldPrivateKey: oldFile.privateKey,
      oldKey: await keyRecordOf(oldFile, now),
      newKey: await keyRecordOf(newFile, now),
      now,
    });
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(`cannot rotate: ${(error as Error).message}`);
  }
  const target = path.join(root, ROTATION_FILE);
  await mkdir(root, { recursive: true });
  await writeFile(target, JSON.stringify(statement, null, 2) + "\n", "utf8");
  emit(args, out, { from: statement.from, to: statement.to, rotationFile: target }, [
    `rotation ${statement.from} -> ${statement.to}`,
    `wrote ${target}`,
    "next: publish the new key record, then run sign with the new key so the site is signed by it.",
  ]);
  return 0;
}

export async function revoke(argv: string[], out: Out): Promise<number> {
  const args = parseArgs(argv, ["root", "key", "reason", "now"]);
  const root = required(args, "root");
  const keyPath = required(args, "key");
  const now = nowFrom(args) ?? new Date();
  const reason = args.values.get("reason");
  const privateFile = await readPrivateKeyFile(keyPath);
  let statement: PlumblineRevocation;
  try {
    statement = await revokeKey({
      privateKey: privateFile.privateKey,
      key: await keyRecordOf(privateFile, now),
      now,
      ...(reason !== undefined ? { reason } : {}),
    });
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(`cannot revoke: ${(error as Error).message}`);
  }
  const target = path.join(root, REVOCATION_FILE);
  await mkdir(root, { recursive: true });
  await writeFile(target, JSON.stringify(statement, null, 2) + "\n", "utf8");
  emit(args, out, { kid: statement.kid, revokedAt: statement.revokedAt, revocationFile: target }, [
    `revoked ${statement.kid} at ${statement.revokedAt}`,
    `wrote ${target}`,
    "next: publish it at the site base, make a NEW key with keygen, re-sign the site with it, and re-establish trust " +
      "with your verifiers through the first-contact ceremony. Never rotate from the revoked key: verifiers refuse it.",
  ]);
  return 0;
}
