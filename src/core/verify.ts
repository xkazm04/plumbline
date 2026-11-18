// Verification. Pure: no node:* imports. Three-state verdicts; the key inside the artifact is never trusted for identity.

import { unsignedBytesOf } from "./canonical.js";
import { isDerivedKid, verifyText } from "./keys.js";
import { isAcceptableOrigin, subjectDigest } from "./sign.js";
import { isSafeSubjectPath, parseManifest, signedPathsOf } from "./signed-paths.js";
import {
  ALG,
  FORMAT_VERSION,
  KID_PATTERN,
  LINKS_FILE,
  LOCK_FILE,
  MANIFEST_FILE,
  MAX_SUBJECTS,
  PUBLIC_KEY_PATTERN,
  SHA256_PATTERN,
  SIGNATURE_TYPE,
  type InvalidReason,
  type PlumblineKey,
  type PlumblineSignature,
  type SubjectFile,
  type TrustEntry,
  type TrustStore,
  type VerifyResult,
} from "./types.js";

export interface VerifyOptions {
  now?: Date;
  /** The key record fetched beside the signature. Used only to say "the math holds but the signer is unknown". */
  publishedKey?: PlumblineKey;
  /**
   * The origin the files were actually fetched from (or are being checked as). When given and the signature's `origin`
   * differs, a result that is not already `invalid` becomes `unverifiable`: the files may be genuine, but they are not
   * attested for this origin. Absent, the signature's own `origin` is used and nothing changes.
   */
  expectedOrigin?: string;
}

/** How far in the future a `signedAt` may sit before it is called malformed (clock skew allowance). */
export const FUTURE_SKEW_MS = 5 * 60 * 1000;

export { KID_PATTERN, PUBLIC_KEY_PATTERN };
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isKid(value: unknown): value is string {
  return typeof value === "string" && KID_PATTERN.test(value);
}

/** base64url of exactly 32 bytes, the only form a raw Ed25519 public key takes on the wire. */
export function isPublicKey(value: unknown): value is string {
  return typeof value === "string" && PUBLIC_KEY_PATTERN.test(value);
}

export function isIsoUtc(text: unknown): text is string {
  if (typeof text !== "string") return false;
  const ms = Date.parse(text);
  return Number.isFinite(ms) && new Date(ms).toISOString() === text;
}

export function isBase64Url(text: unknown): text is string {
  return typeof text === "string" && BASE64URL_PATTERN.test(text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The one constructor of an `invalid` result, shared by signatures, rotations and revocations. */
export function invalid(reason: InvalidReason, detail: string, kid?: string, origin?: string): VerifyResult {
  return {
    verdict: "invalid",
    reason,
    ...(kid !== undefined ? { kid } : {}),
    ...(origin !== undefined ? { origin } : {}),
    detail,
  };
}

/** Returns a problem sentence, or undefined when the signature object has the exact shape of the format. */
function shapeProblem(sig: unknown): string | undefined {
  if (!isRecord(sig)) return "the signature is not an object";
  if (sig.type !== SIGNATURE_TYPE) return "the document type is not plumbline-signature";
  if (sig.version !== FORMAT_VERSION) return "the format version is not supported";
  if (sig.alg !== ALG) return "the algorithm is not Ed25519";
  if (typeof sig.kid !== "string" || !KID_PATTERN.test(sig.kid)) return "the kid is not 16 lowercase hex characters";
  if (!isAcceptableOrigin(sig.origin)) return "the origin is not an https origin without a path";
  if (!isIsoUtc(sig.signedAt)) return "signedAt is not a UTC ISO timestamp";
  if (!isIsoUtc(sig.expiresAt)) return "expiresAt is not a UTC ISO timestamp";
  if (Date.parse(sig.expiresAt) <= Date.parse(sig.signedAt)) return "expiresAt is not after signedAt";
  if (!isBase64Url(sig.sig)) return "the signature value is not base64url";
  if (!Array.isArray(sig.subjects) || sig.subjects.length === 0) return "the subject list is missing or empty";
  if (sig.subjects.length > MAX_SUBJECTS) return `the subject list names more than ${MAX_SUBJECTS} files`;
  const paths = new Set<string>();
  for (const subject of sig.subjects as unknown[]) {
    if (!isRecord(subject)) return "a subject entry is not an object";
    if (typeof subject.path !== "string" || subject.path === "") return "a subject has no path";
    if (!isSafeSubjectPath(subject.path)) return "a subject path is not a safe site-relative path";
    if (typeof subject.sha256 !== "string" || !SHA256_PATTERN.test(subject.sha256)) {
      return "a subject digest is not 64 lowercase hex characters";
    }
    if (paths.has(subject.path)) return "two subjects share a path";
    paths.add(subject.path);
  }
  return undefined;
}

/** The signed bytes: canonical JSON of the signature object without `sig` (core's unsignedBytesOf). Throws on a value canonical JSON refuses. */
export function signedBytesOf(signature: PlumblineSignature): string {
  return unsignedBytesOf(signature);
}

/** Resolves a signer in the trust store, and refuses a trust entry whose own kid is not derived from its key. */
export async function resolveTrusted(
  trust: TrustStore,
  kid: string,
  origin: string,
): Promise<{ entry: TrustEntry } | { poisoned: true } | undefined> {
  const entry = trust.find(kid, origin);
  if (!entry) return undefined;
  // an unreadable key in a trust entry is the same defect as a mismatched one
  if (entry.kid === kid && (await isDerivedKid(kid, entry.publicKey))) return { entry };
  return { poisoned: true };
}

/** The `invalid` / `revoked` result for anything signed by a key whose trust entry carries `revokedAt`. */
export function revokedResult(what: string, kid: string, origin: string): VerifyResult {
  return invalid(
    "revoked",
    `The key that made this ${what} has been revoked by its holder, so nothing it signs is accepted, whatever the dates.`,
    kid,
    origin,
  );
}

/** `verified` needs the signer in the trust store; an unknown signer is `unverifiable`, whatever the math says. */
export async function verifySignature(
  signature: PlumblineSignature,
  files: SubjectFile[],
  trust: TrustStore,
  options: VerifyOptions = {},
): Promise<VerifyResult> {
  const result = await verifyAgainstTrust(signature, files, trust, options);
  const expected = options.expectedOrigin;
  if (expected === undefined || result.verdict === "invalid" || signature.origin === expected) return result;
  // An invalid result stays invalid (tampering is tampering wherever it is served). Anything else is not attested here.
  return {
    verdict: "unverifiable",
    kid: signature.kid,
    origin: signature.origin,
    detail: "The files may be genuine but are not attested for the origin they were checked as: the signature names a different origin (see the result's origin field).",
  };
}

async function verifyAgainstTrust(
  signature: PlumblineSignature,
  files: SubjectFile[],
  trust: TrustStore,
  options: VerifyOptions,
): Promise<VerifyResult> {
  // 1. shape
  const problem = shapeProblem(signature);
  if (problem !== undefined) {
    const raw = signature as unknown as Record<string, unknown> | null;
    const kid = raw && typeof raw.kid === "string" && KID_PATTERN.test(raw.kid) ? raw.kid : undefined;
    const origin = raw && isAcceptableOrigin(raw.origin) ? raw.origin : undefined;
    return invalid("malformed", `The signature file is malformed: ${problem}.`, kid, origin);
  }
  const { kid, origin } = signature;
  const now = options.now ?? new Date();

  // 2. identity: resolve the signer in the verifier's own trust store
  const trusted = await resolveTrusted(trust, kid, origin);
  if (trusted && "poisoned" in trusted) {
    return invalid(
      "kid-mismatch",
      "A trust store entry for this signer does not match its own key id, so the trust store itself is defective.",
      kid,
      origin,
    );
  }
  // 2b. a revoked key is dead for everything; its holder (or a thief) can backdate signedAt, so dates do not matter
  if (trusted && trusted.entry.revokedAt !== undefined) return revokedResult("signature", kid, origin);

  // 3. every signed path is present and its exact bytes match
  const byPath = new Map<string, SubjectFile>();
  for (const file of files) byPath.set(file.path, file);
  for (const subject of signature.subjects) {
    const file = byPath.get(subject.path);
    if (!file) return invalid("tampered", "A file named in the signature is missing from the files being checked.", kid, origin);
    if ((await subjectDigest(file.content)) !== subject.sha256) {
      return invalid("tampered", "A signed file differs from the version that was signed.", kid, origin);
    }
  }

  // 3b. the signature covers every file the runtime loads: the networks the SIGNED manifest names, and links.json and
  // plumbline.lock.json whenever they are present. Other unsigned files are ignored.
  const coverage = coverageProblem(signature, byPath);
  if (coverage !== undefined) return invalid(coverage.reason, coverage.detail, kid, origin);

  // 4. time
  if (now.getTime() >= Date.parse(signature.expiresAt)) {
    return invalid("expired", "The signature has expired and must be renewed by the publisher.", kid, origin);
  }
  if (Date.parse(signature.signedAt) > now.getTime() + FUTURE_SKEW_MS) {
    return invalid("malformed", "The signature claims to have been made in the future.", kid, origin);
  }

  let signed: string;
  try {
    signed = signedBytesOf(signature);
  } catch {
    return invalid("malformed", "The signature carries a value canonical JSON cannot encode (a non-finite number).", kid, origin);
  }

  // 5. a signer the verifier already trusts: the TRUST STORE's key decides
  if (trusted) {
    return (await verifyText(trusted.entry.publicKey, signed, signature.sig))
      ? {
          verdict: "verified",
          kid,
          origin,
          detail: "The files match a signature made by a key this verifier already trusts for this origin.",
        }
      : invalid("bad-signature", "The signature does not verify under the trusted key for this signer.", kid, origin);
  }

  // 6. a stranger: never verified. Say whether the math holds under the published key, for the person deciding.
  const published = options.publishedKey;
  let consistent = false;
  if (published && isRecord(published) && published.kid === kid && (await isDerivedKid(kid, published.publicKey))) {
    consistent = await verifyText(published.publicKey, signed, signature.sig);
  }
  return {
    verdict: "unverifiable",
    kid,
    origin,
    detail: consistent
      ? "The signature is internally consistent but the signer is unknown: this verifier has no trust entry for the key, so it proves nothing about who published the files."
      : "The signer is unknown to this verifier and the signature cannot be checked: no published key record matching it was supplied, or the record did not verify.",
  };
}

/**
 * Why the signature does not cover what the runtime would load, or undefined when it does. The manifest's own digest
 * has already been checked, so the network list read here is the signed one.
 */
function coverageProblem(
  signature: PlumblineSignature,
  byPath: Map<string, SubjectFile>,
): { reason: InvalidReason; detail: string } | undefined {
  const signedPaths = new Set(signature.subjects.map((s) => s.path));
  const manifest = byPath.get(MANIFEST_FILE);
  if (!signedPaths.has(MANIFEST_FILE) || !manifest) {
    return {
      reason: "tampered",
      detail: "The signature does not cover agent-manifest.json, so it cannot say which network files the site loads.",
    };
  }
  let required: string[];
  try {
    required = signedPathsOf(parseManifest(manifest.content), { links: byPath.has(LINKS_FILE), lock: byPath.has(LOCK_FILE) });
  } catch {
    return {
      reason: "malformed",
      detail: "The signed manifest names a network file that is not a safe site-relative path, so no signature can pin what the runtime loads.",
    };
  }
  for (const path of required) {
    if (signedPaths.has(path)) continue;
    if (path === LINKS_FILE) {
      return {
        reason: "tampered",
        detail: "A links.json is present but not signed; the runtime lays it over the network's links, so it would change what the signed site does.",
      };
    }
    if (path === LOCK_FILE) {
      return { reason: "tampered", detail: "A plumbline.lock.json is present but not signed, so the drift baseline it carries is not attested." };
    }
    return { reason: "tampered", detail: "A file the signed manifest makes the runtime load (a network, an action module, a bridge, a catalogue, an action page or a coded-tools bundle) is not covered by the signature, so the runtime would load it unsigned." };
  }
  return undefined;
}
