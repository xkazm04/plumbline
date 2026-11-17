// File I/O for the CLI. Core never touches the disk; everything that does lives here.

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { CliError } from "./args.js";
import type { PlumblineKey, PrivateKeyFile, SubjectFile, TrustEntry, TrustStore } from "../core/index.js";
import {
  ALG,
  FORMAT_VERSION,
  KEY_TYPE,
  PRIVATE_KEY_FILE,
  PRIVATE_KEY_TYPE,
  derivePublicKey,
  isIsoUtc,
  isKid,
  isPrivateKeyFile,
  isPublicKey,
  isSafeSubjectPath,
  spreadRevocations,
} from "../core/index.js";

// The private key file format is core's (the Desk reads it too); re-exported for the CLI's modules.
export { PRIVATE_KEY_FILE, PRIVATE_KEY_TYPE, type PrivateKeyFile };

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}

/** Reads a file as text, or returns undefined when it does not exist. Any other failure is an I/O error. */
export async function readTextIfPresent(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (isEnoent(error)) return undefined;
    throw new CliError(`cannot read ${file}: ${(error as Error).message}`);
  }
}

export async function readJsonFile(file: string, what: string): Promise<unknown> {
  const text = await readTextIfPresent(file);
  if (text === undefined) throw new CliError(`${what} not found: ${file}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new CliError(`${what} is not valid JSON: ${file}`);
  }
}

export async function readPrivateKeyFile(file: string): Promise<PrivateKeyFile> {
  const value = await readJsonFile(file, "private key file");
  if (!isPrivateKeyFile(value)) throw new CliError(`not a Plumbline private key file: ${file}`);
  return { type: PRIVATE_KEY_TYPE, version: FORMAT_VERSION, alg: ALG, kid: value.kid, privateKey: value.privateKey };
}

/** The public key record of a private key file. Core only reads `kid` from it when signing. */
export async function keyRecordOf(privateFile: PrivateKeyFile, now: Date): Promise<PlumblineKey> {
  let publicKey: string;
  try {
    publicKey = await derivePublicKey(privateFile.privateKey);
  } catch {
    throw new CliError("the private key in the file is not a valid Ed25519 PKCS#8 key");
  }
  return {
    type: KEY_TYPE,
    version: FORMAT_VERSION,
    alg: ALG,
    kid: privateFile.kid,
    publicKey,
    createdAt: now.toISOString(),
  };
}

/**
 * A site-relative posix path resolved under `root`. Core's subject-path rule decides (isSafeSubjectPath): only
 * `[A-Za-z0-9._/-]`, relative, no empty, `.` or `..` segment. The message never quotes the refused path.
 */
export function resolveUnder(root: string, relative: string): string {
  if (!isSafeSubjectPath(relative)) {
    throw new CliError("unsafe path (must be relative, inside the site root, and use only A-Z a-z 0-9 . _ / -)");
  }
  return path.join(root, ...relative.split("/"));
}

/** Reads a file's exact bytes, or returns undefined when it does not exist. Any other failure is an I/O error. */
export async function readBytesIfPresent(file: string): Promise<Uint8Array | undefined> {
  try {
    return new Uint8Array(await readFile(file));
  } catch (error) {
    if (isEnoent(error)) return undefined;
    throw new CliError(`cannot read ${file}: ${(error as Error).message}`);
  }
}

/**
 * A subject is the file's exact bytes, as a web server would serve them: no parse, no decode, no newline change.
 * Returns undefined when the file does not exist.
 */
export async function loadSubject(root: string, relative: string): Promise<SubjectFile | undefined> {
  const bytes = await readBytesIfPresent(resolveUnder(root, relative));
  return bytes === undefined ? undefined : { path: relative, content: bytes };
}

/**
 * Writes a file so a reader never sees half of it: the text goes to a temporary file beside it, which is then renamed
 * over the target. The folder is created when missing.
 */
export async function writeFileAtomic(file: string, text: string): Promise<void> {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(temp, text, "utf8");
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw new CliError(`cannot write ${file}: ${(error as Error).message}`);
  }
}

/** A verifier's `plumbline.trust.json` as read: the parsed file, kept whole, and its entries as core reads them. */
export interface TrustFile {
  file: string;
  /** The parsed file with every member it carries, known or not, so a write changes only what it means to change. */
  raw: Record<string, unknown> & { version: 1; entries: Record<string, unknown>[] };
  /**
   * The entries, held to their patterns, with spreadRevocations applied: a kid revoked at ANY origin is revoked at
   * every origin, and so is every key adopted through a rotation from it (the rule the Desk applies too). Index i is
   * `raw.entries[i]`.
   */
  entries: TrustEntry[];
}

/** Reads a trust file. `missingIsEmpty`: a file that does not exist is an empty store (for `trust`, which creates it). */
export async function readTrustFile(file: string, options: { missingIsEmpty?: boolean } = {}): Promise<TrustFile> {
  if (options.missingIsEmpty && (await readTextIfPresent(file)) === undefined) {
    return { file, raw: { version: 1, entries: [] }, entries: [] };
  }
  const value = (await readJsonFile(file, "trust store")) as { version?: unknown; entries?: unknown } | null;
  if (typeof value !== "object" || value === null || Array.isArray(value) || value.version !== 1 || !Array.isArray(value.entries)) {
    throw new CliError(`not a Plumbline trust store: ${file}`);
  }
  const read: TrustEntry[] = [];
  for (const raw of value.entries as unknown[]) {
    const e = raw as Record<string, unknown> | null;
    // kid and publicKey are held to their exact patterns; the message never quotes what failed.
    if (
      typeof e !== "object" ||
      e === null ||
      Array.isArray(e) ||
      !isKid(e.kid) ||
      typeof e.origin !== "string" ||
      !isPublicKey(e.publicKey) ||
      (e.revokedAt !== undefined && !isIsoUtc(e.revokedAt)) ||
      (e.adoptedVia !== undefined && !isKid(e.adoptedVia))
    ) {
      throw new CliError(`a trust store entry is malformed: ${file}`);
    }
    read.push({
      kid: e.kid,
      origin: e.origin,
      publicKey: e.publicKey,
      ...(typeof e.revokedAt === "string" ? { revokedAt: e.revokedAt } : {}),
      ...(typeof e.adoptedVia === "string" ? { adoptedVia: e.adoptedVia } : {}),
    });
  }
  return { file, raw: value as TrustFile["raw"], entries: spreadRevocations(read) };
}

/** core's lookup over a list of entries. */
export function trustStoreOf(entries: readonly TrustEntry[]): TrustStore {
  return { find: (kid, origin) => entries.find((e) => e.kid === kid && e.origin === origin) };
}

/**
 * Copies `revokedAt` from `entries` (the trust file's entries after a revocation was applied, same order) into the
 * file's raw entries, keeping every other member, and returns how many entries changed. Writes nothing.
 */
export function markRevoked(trust: TrustFile, entries: readonly TrustEntry[]): number {
  let changed = 0;
  trust.raw.entries.forEach((raw, i) => {
    const at = entries[i]?.revokedAt;
    if (at !== undefined && raw.revokedAt !== at) {
      raw.revokedAt = at;
      changed += 1;
    }
  });
  trust.entries = [...entries];
  return changed;
}

/** Appends an entry to the trust file in memory (both views). Writes nothing. */
export function appendEntry(trust: TrustFile, entry: TrustEntry): void {
  trust.raw.entries.push({ ...entry });
  trust.entries = [...trust.entries, entry];
}

export async function writeTrustFile(trust: TrustFile): Promise<void> {
  await writeFileAtomic(trust.file, JSON.stringify(trust.raw, null, 2) + "\n");
}
