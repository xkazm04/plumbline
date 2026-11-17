// File I/O for the CLI. Core never touches the disk; everything that does lives here.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { CliError } from "./args.js";
import type { PlumblineKey, SubjectFile } from "../core/index.js";
import { ALG, FORMAT_VERSION, KEY_TYPE, derivePublicKey } from "../core/index.js";

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

/** A site-relative posix path resolved under `root`; absolute paths, backslashes and `..` are refused. */
export function resolveUnder(root: string, relative: string): string {
  if (
    relative === "" ||
    relative.includes("\\") ||
    relative.includes("\0") ||
    relative.startsWith("/") ||
    /^[A-Za-z]:/.test(relative) ||
    relative.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    throw new CliError(`unsafe path (must be relative, inside the site root): ${relative}`);
  }
  return path.join(root, ...relative.split("/"));
}

/**
 * A path ending `.json` is parsed (and canonicalised when hashed); any other path is raw UTF-8 text. When verifying,
 * a `.json` file that no longer parses is handed over as text, so it fails the digest as `tampered`.
 */
export async function loadSubject(root: string, relative: string, strict: boolean): Promise<SubjectFile | undefined> {
  const text = await readTextIfPresent(resolveUnder(root, relative));
  if (text === undefined) return undefined;
  if (!relative.endsWith(".json")) return { path: relative, content: text };
  try {
    return { path: relative, content: JSON.parse(text) };
  } catch {
    if (strict) throw new CliError(`${relative} is not valid JSON`);
    return { path: relative, content: text };
  }
}

/** `x.hocon` names `x.network.json`; any other path is used as written. */
export function networkFileFor(hocon: string): string {
  return hocon.endsWith(".hocon") ? `${hocon.slice(0, -".hocon".length)}.network.json` : hocon;
}
