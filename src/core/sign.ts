// Signing. Pure: no node:* imports.

import { canonicalJson, sha256Hex } from "./canonical.js";
import { keyIdOfPrivate, signText } from "./keys.js";
import {
  ALG,
  DEFAULT_LIFETIME_DAYS,
  FORMAT_VERSION,
  SIGNATURE_TYPE,
  type PlumblineKey,
  type PlumblineSignature,
  type SubjectDigest,
  type SubjectFile,
} from "./types.js";

export interface SignOptions {
  privateKey: string;
  key: PlumblineKey;
  origin: string;
  files: SubjectFile[];
  now?: Date;
  lifetimeDays?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * An origin is `https://host[:port]` with no path, query or fragment. `http` is accepted only for the two loopback
 * hosts `localhost` and `127.0.0.1`, which exist for tests.
 */
export function isAcceptableOrigin(origin: unknown): origin is string {
  if (typeof origin !== "string") return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
}

/** SHA-256 hex of a subject: a string is hashed as UTF-8 bytes, anything else as its canonical JSON. */
export async function subjectDigest(content: unknown): Promise<string> {
  return sha256Hex(typeof content === "string" ? content : canonicalJson(content));
}

export async function signSubjects(options: SignOptions): Promise<PlumblineSignature> {
  const { privateKey, key, origin, files } = options;
  if (!isAcceptableOrigin(origin)) {
    throw new Error("origin must be an https:// origin with no path (http only for localhost and 127.0.0.1)");
  }
  if (!Array.isArray(files) || files.length === 0) throw new Error("nothing to sign: no files given");
  const seen = new Set<string>();
  for (const file of files) {
    if (typeof file.path !== "string" || file.path === "") throw new Error("every file needs a non-empty path");
    if (seen.has(file.path)) throw new Error("two files share a path");
    seen.add(file.path);
  }
  const lifetimeDays = options.lifetimeDays ?? DEFAULT_LIFETIME_DAYS;
  if (!Number.isFinite(lifetimeDays) || lifetimeDays <= 0) throw new Error("lifetimeDays must be a positive number");
  const derived = await keyIdOfPrivate(privateKey);
  if (key.kid !== derived) throw new Error("the key record's kid does not belong to the private key");

  const subjects: SubjectDigest[] = [];
  for (const file of files) subjects.push({ path: file.path, sha256: await subjectDigest(file.content) });
  subjects.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const now = options.now ?? new Date();
  const unsigned = {
    type: SIGNATURE_TYPE,
    version: FORMAT_VERSION,
    alg: ALG,
    kid: derived,
    origin,
    signedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + lifetimeDays * DAY_MS).toISOString(),
    subjects,
  };
  const sig = await signText(privateKey, canonicalJson(unsigned));
  return { ...unsigned, sig };
}
