// Signing. Pure: no node:* imports.

import { canonicalJson, sha256Hex } from "./canonical.js";
import { keyIdOfPrivate, signText } from "./keys.js";
import { isSafeSubjectPath, parseManifest, signedPathsOf } from "./signed-paths.js";
import {
  ALG,
  DEFAULT_LIFETIME_DAYS,
  FORMAT_VERSION,
  LINKS_FILE,
  LOCK_FILE,
  MANIFEST_FILE,
  MAX_SUBJECTS,
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

/**
 * SHA-256 hex of a subject's EXACT bytes: a `Uint8Array` as it is, a string as its UTF-8 bytes. No parse, no
 * re-serialisation, no newline or BOM change. Why bytes and not canonical JSON: the reference runtime parses network
 * files with its own HOCON reader, which MERGES duplicate keys where JSON.parse keeps the last one, so two files with
 * one canonical JSON can run differently. Only the bytes the runtime receives pin what it runs. Throws a TypeError for
 * any other content (a parsed object is a caller bug, not a file).
 */
export async function subjectDigest(content: Uint8Array | string): Promise<string> {
  if (typeof content !== "string" && !(content instanceof Uint8Array)) {
    throw new TypeError("a subject's content is its exact bytes (Uint8Array) or its text (string), never a parsed value");
  }
  return sha256Hex(content);
}

/** The paths a file set must cover, from its own manifest. Throws when the set has no manifest or names an unsafe one. */
function requiredPathsOf(files: SubjectFile[]): string[] {
  const manifest = files.find((f) => f.path === MANIFEST_FILE);
  if (!manifest) throw new Error(`nothing to sign without ${MANIFEST_FILE}: it names the files a signature must cover`);
  const has = (path: string): boolean => files.some((f) => f.path === path);
  return signedPathsOf(parseManifest(manifest.content), { links: has(LINKS_FILE), lock: has(LOCK_FILE) });
}

export async function signSubjects(options: SignOptions): Promise<PlumblineSignature> {
  const { privateKey, key, origin, files } = options;
  if (!isAcceptableOrigin(origin)) {
    throw new Error("origin must be an https:// origin with no path (http only for localhost and 127.0.0.1)");
  }
  if (!Array.isArray(files) || files.length === 0) throw new Error("nothing to sign: no files given");
  // a verifier calls a longer subject list malformed (MAX_SUBJECTS): never make a signature that cannot verify
  if (files.length > MAX_SUBJECTS) throw new Error(`a signature covers at most ${MAX_SUBJECTS} files`);
  const seen = new Set<string>();
  for (const file of files) {
    if (!isSafeSubjectPath(file.path)) {
      throw new Error("every file needs a safe site-relative path: only A-Z a-z 0-9 . _ / -, no empty, '.' or '..' segment");
    }
    if (seen.has(file.path)) throw new Error("two files share a path");
    seen.add(file.path);
  }
  // A signature that leaves out a file the runtime loads would never verify: refuse to make one.
  for (const required of requiredPathsOf(files)) {
    if (!seen.has(required)) throw new Error(`the files do not include ${required}, which a signature of this site must cover`);
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
