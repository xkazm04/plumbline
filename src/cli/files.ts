// File I/O for the CLI. Core never touches the disk; everything that does lives here.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { CliError } from "./args.js";
import type { PlumblineKey, SubjectFile } from "../core/index.js";
import { ALG, FORMAT_VERSION, KEY_TYPE, derivePublicKey, isSafeSubjectPath } from "../core/index.js";

export const PRIVATE_KEY_FILE = "plumbline.private.json";
export const PRIVATE_KEY_TYPE = "plumbline-private-key";

export interface PrivateKeyFile {
  type: typeof PRIVATE_KEY_TYPE;
  version: typeof FORMAT_VERSION;
  alg: typeof ALG;
  kid: string;
  /** base64url PKCS#8. */
  privateKey: string;
}

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
  const o = value as Record<string, unknown>;
  if (
    typeof value !== "object" ||
    value === null ||
    o.type !== PRIVATE_KEY_TYPE ||
    o.version !== FORMAT_VERSION ||
    o.alg !== ALG ||
    typeof o.kid !== "string" ||
    typeof o.privateKey !== "string"
  ) {
    throw new CliError(`not a Plumbline private key file: ${file}`);
  }
  return { type: PRIVATE_KEY_TYPE, version: FORMAT_VERSION, alg: ALG, kid: o.kid, privateKey: o.privateKey };
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
