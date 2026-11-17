// Verification. Pure: no node:* imports. Three-state verdicts; the key inside the artifact is never trusted for identity.

import { canonicalJson } from "./canonical.js";
import { keyId, verifyText } from "./keys.js";
import { isAcceptableOrigin, subjectDigest } from "./sign.js";
import {
  ALG,
  FORMAT_VERSION,
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
}

/** How far in the future a `signedAt` may sit before it is called malformed (clock skew allowance). */
export const FUTURE_SKEW_MS = 5 * 60 * 1000;

export const KID_PATTERN = /^[0-9a-f]{16}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

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

function invalid(reason: InvalidReason, detail: string, kid?: string, origin?: string): VerifyResult {
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
  const paths = new Set<string>();
  for (const subject of sig.subjects as unknown[]) {
    if (!isRecord(subject)) return "a subject entry is not an object";
    if (typeof subject.path !== "string" || subject.path === "") return "a subject has no path";
    if (typeof subject.sha256 !== "string" || !SHA256_PATTERN.test(subject.sha256)) {
      return "a subject digest is not 64 lowercase hex characters";
    }
    if (paths.has(subject.path)) return "two subjects share a path";
    paths.add(subject.path);
  }
  return undefined;
}

/** The signed bytes: canonical JSON of the signature object without `sig`. */
export function signedBytesOf(signature: PlumblineSignature): string {
  const { sig: _sig, ...rest } = signature;
  void _sig;
  return canonicalJson(rest);
}

/** Resolves a signer in the trust store, and refuses a trust entry whose own kid is not derived from its key. */
export async function resolveTrusted(
  trust: TrustStore,
  kid: string,
  origin: string,
): Promise<{ entry: TrustEntry } | { poisoned: true } | undefined> {
  const entry = trust.find(kid, origin);
  if (!entry) return undefined;
  try {
    if (entry.kid === kid && (await keyId(entry.publicKey)) === kid) return { entry };
  } catch {
    // an unreadable key in a trust entry is the same defect as a mismatched one
  }
  return { poisoned: true };
}

/** `verified` needs the signer in the trust store; an unknown signer is `unverifiable`, whatever the math says. */
export async function verifySignature(
  signature: PlumblineSignature,
  files: SubjectFile[],
  trust: TrustStore,
  options: VerifyOptions = {},
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

  // 3. every signed path is present and its digest matches; unsigned files are ignored
  const byPath = new Map<string, SubjectFile>();
  for (const file of files) byPath.set(file.path, file);
  for (const subject of signature.subjects) {
    const file = byPath.get(subject.path);
    if (!file) return invalid("tampered", "A file named in the signature is missing from the files being checked.", kid, origin);
    if ((await subjectDigest(file.content)) !== subject.sha256) {
      return invalid("tampered", "A signed file differs from the version that was signed.", kid, origin);
    }
  }

  // 4. time
  if (now.getTime() >= Date.parse(signature.expiresAt)) {
    return invalid("expired", "The signature has expired and must be renewed by the publisher.", kid, origin);
  }
  if (Date.parse(signature.signedAt) > now.getTime() + FUTURE_SKEW_MS) {
    return invalid("malformed", "The signature claims to have been made in the future.", kid, origin);
  }

  const signed = signedBytesOf(signature);

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
  if (published && published.kid === kid) {
    try {
      consistent =
        (await keyId(published.publicKey)) === kid && (await verifyText(published.publicKey, signed, signature.sig));
    } catch {
      consistent = false;
    }
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
