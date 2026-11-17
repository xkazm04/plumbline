// The signing commands: keygen, sign, verify, rotate, revoke. Exit 0 clean, 1 findings, 2 usage or I/O error.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CliError, nowFrom, parseArgs, required, type ParsedArgs } from "./args.js";
import {
  PRIVATE_KEY_FILE,
  PRIVATE_KEY_TYPE,
  keyRecordOf,
  loadSubject,
  readJsonFile,
  readPrivateKeyFile,
  readTextIfPresent,
  type PrivateKeyFile,
} from "./files.js";
import {
  ALG,
  DEFAULT_LIFETIME_DAYS,
  FORMAT_VERSION,
  KEY_FILE,
  REVOCATION_FILE,
  ROTATION_FILE,
  SIGNATURE_FILE,
  applyRevocation,
  generateKey,
  isAcceptableOrigin,
  revokeKey,
  rotateKey,
  signSubjects,
  signedPathsOf,
  verifySignature,
  type PlumblineKey,
  type PlumblineRevocation,
  type PlumblineSignature,
  type SubjectFile,
  type TrustEntry,
  type TrustStore,
  type VerifyResult,
} from "../core/index.js";

export type Out = (line: string) => void;

const MANIFEST_FILE = "agent-manifest.json";
const LINKS_FILE = "links.json";

function isIsoUtc(text: string): boolean {
  const ms = Date.parse(text);
  return Number.isFinite(ms) && new Date(ms).toISOString() === text;
}

export const KEY_CUSTODY_WARNINGS = [
  "Back up the private key file and never commit it: key loss is identity loss, and a leaked key lets anyone sign as you.",
  "A key held in browser memory is exposed to every script running on that origin; keep signing keys out of the page.",
] as const;

function emit(args: ParsedArgs, out: Out, json: unknown, lines: string[]): void {
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
  const now = nowFrom(args) ?? new Date();
  let lifetimeDays = DEFAULT_LIFETIME_DAYS;
  const days = args.values.get("days");
  if (days !== undefined) {
    lifetimeDays = Number(days);
    if (!Number.isFinite(lifetimeDays) || lifetimeDays <= 0) throw new CliError("--days must be a positive number");
  }
  const privateFile = await readPrivateKeyFile(required(args, "key"));

  const manifest = await loadSubject(root, MANIFEST_FILE, true);
  if (!manifest) throw new CliError(`${MANIFEST_FILE} not found in ${root}`);
  const links = await loadSubject(root, LINKS_FILE, true);
  // Which files are signed is core's signedPathsOf, the one rule the CLI and the Desk share.
  const files: SubjectFile[] = [];
  for (const rel of signedPathsOf(manifest.content, links !== undefined)) {
    if (rel === MANIFEST_FILE) files.push(manifest);
    else if (rel === LINKS_FILE && links) files.push(links);
    else {
      const loaded = await loadSubject(root, rel, true);
      if (!loaded) throw new CliError(`network file named by the manifest is missing: ${rel}`);
      files.push(loaded);
    }
  }

  let signature: PlumblineSignature;
  try {
    signature = await signSubjects({
      privateKey: privateFile.privateKey,
      key: await keyRecordOf(privateFile, now),
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

/** The CLI's trust store: the entries are kept so a revocation can be applied to them in memory. */
interface CliTrustStore extends TrustStore {
  entries: TrustEntry[];
}

async function readTrustStore(file: string): Promise<CliTrustStore> {
  const value = (await readJsonFile(file, "trust store")) as { version?: unknown; entries?: unknown } | null;
  if (typeof value !== "object" || value === null || value.version !== 1 || !Array.isArray(value.entries)) {
    throw new CliError(`not a Plumbline trust store: ${file}`);
  }
  const entries: TrustEntry[] = [];
  for (const raw of value.entries as unknown[]) {
    const e = raw as Record<string, unknown> | null;
    if (
      !e ||
      typeof e.kid !== "string" ||
      typeof e.origin !== "string" ||
      typeof e.publicKey !== "string" ||
      (e.revokedAt !== undefined && (typeof e.revokedAt !== "string" || !isIsoUtc(e.revokedAt)))
    ) {
      throw new CliError(`a trust store entry is malformed: ${file}`);
    }
    entries.push({
      kid: e.kid,
      origin: e.origin,
      publicKey: e.publicKey,
      ...(typeof e.revokedAt === "string" ? { revokedAt: e.revokedAt } : {}),
    });
  }
  return { entries, find: (kid, origin) => entries.find((e) => e.kid === kid && e.origin === origin) };
}

/** What `verify` did with a `plumbline-revocation.json` it found in the site root. */
interface RevocationReport {
  file: string;
  /** True when the revocation verified under a trusted key and that key's entries were marked revoked in memory. */
  applied: boolean;
  /** One result per trust entry for the revoked kid; one result when no entry matched or the file was unreadable. */
  results: VerifyResult[];
}

/**
 * Reads `plumbline-revocation.json` from the site root when present and applies it, in memory, to every trust entry
 * for the revoked kid (a revocation names no origin: the key is dead everywhere). The trust file on disk is never
 * written. A revocation that does not verify under the trusted key changes nothing.
 */
async function applyRevocationFile(root: string, trust: CliTrustStore): Promise<RevocationReport | undefined> {
  const file = path.join(root, REVOCATION_FILE);
  const text = await readTextIfPresent(file);
  if (text === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      file,
      applied: false,
      results: [{ verdict: "invalid", reason: "malformed", detail: "The revocation file is not valid JSON." }],
    };
  }
  const revocation = parsed as PlumblineRevocation;
  const kid = (parsed as { kid?: unknown } | null)?.kid;
  const matching = trust.entries.map((e, i) => [e, i] as const).filter(([e]) => e.kid === kid);
  if (matching.length === 0) {
    const { entry: _none, ...result } = await applyRevocation(revocation, undefined);
    void _none;
    return { file, applied: false, results: [result] };
  }
  const results: VerifyResult[] = [];
  let applied = false;
  for (const [entry, index] of matching) {
    const { entry: revoked, ...result } = await applyRevocation(revocation, entry);
    results.push(result);
    if (result.verdict === "verified" && revoked) {
      trust.entries[index] = revoked;
      applied = true;
    }
  }
  return { file, applied, results };
}

export function formatResult(result: VerifyResult): string {
  const parts: string[] = [result.verdict];
  if (result.reason) parts.push(result.reason);
  if (result.kid) parts.push(`kid=${result.kid}`);
  if (result.origin) parts.push(`origin=${result.origin}`);
  const head = parts.join(" ");
  return result.detail ? `${head} - ${result.detail}` : head;
}

export async function verify(argv: string[], out: Out): Promise<number> {
  const args = parseArgs(argv, ["root", "trust", "now", "origin"]);
  const root = required(args, "root");
  const expectedOrigin = args.values.get("origin");
  if (expectedOrigin !== undefined && !isAcceptableOrigin(expectedOrigin)) {
    throw new CliError("--origin must be an https:// origin with no path and no trailing slash, like https://example.com");
  }
  const trust = await readTrustStore(required(args, "trust"));
  const revocation = await applyRevocationFile(root, trust);
  const sigText = await readTextIfPresent(path.join(root, SIGNATURE_FILE));
  if (sigText === undefined) throw new CliError(`${SIGNATURE_FILE} not found in ${root}`);

  let result: VerifyResult;
  let signature: unknown;
  try {
    signature = JSON.parse(sigText);
  } catch {
    signature = undefined;
  }
  if (signature === undefined) {
    result = { verdict: "invalid", reason: "malformed", detail: "The signature file is not valid JSON." };
  } else {
    const files: SubjectFile[] = [];
    const subjects = (signature as { subjects?: unknown } | null)?.subjects;
    if (Array.isArray(subjects)) {
      for (const subject of subjects) {
        const rel = (subject as { path?: unknown } | null)?.path;
        if (typeof rel !== "string") continue;
        let loaded: SubjectFile | undefined;
        try {
          loaded = await loadSubject(root, rel, false);
        } catch (error) {
          // an unsafe path in a signature must never read outside the root; it simply is not a present file
          if (!(error instanceof CliError)) throw error;
        }
        if (loaded) files.push(loaded);
      }
    }
    let publishedKey: PlumblineKey | undefined;
    const keyText = await readTextIfPresent(path.join(root, ...KEY_FILE.split("/")));
    if (keyText !== undefined) {
      try {
        const parsed: unknown = JSON.parse(keyText);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) publishedKey = parsed as PlumblineKey;
      } catch {
        publishedKey = undefined;
      }
    }
    const now = nowFrom(args);
    result = await verifySignature(signature as PlumblineSignature, files, trust, {
      ...(now ? { now } : {}),
      ...(publishedKey ? { publishedKey } : {}),
      ...(expectedOrigin !== undefined ? { expectedOrigin } : {}),
    });
  }
  // The verdict line stays last, so a reader of the text output finds it in the same place with or without a revocation.
  const lines = revocation
    ? [
        revocation.applied
          ? `revocation applied: ${REVOCATION_FILE} revokes a trusted key, so nothing that key signs is accepted`
          : `revocation not applied: ${REVOCATION_FILE} is present but changes nothing for this trust store`,
        ...revocation.results.map((r) => `  ${formatResult(r)}`),
        formatResult(result),
      ]
    : [formatResult(result)];
  emit(args, out, { results: [result], ...(revocation ? { revocation } : {}) }, lines);
  return result.verdict === "verified" ? 0 : 1;
}

export async function rotate(argv: string[], out: Out): Promise<number> {
  const args = parseArgs(argv, ["root", "old-key", "new-key", "now"]);
  const root = required(args, "root");
  const now = nowFrom(args) ?? new Date();
  const oldFile = await readPrivateKeyFile(required(args, "old-key"));
  const newFile = await readPrivateKeyFile(required(args, "new-key"));
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
  const now = nowFrom(args) ?? new Date();
  const reason = args.values.get("reason");
  const privateFile = await readPrivateKeyFile(required(args, "key"));
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
