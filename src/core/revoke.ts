// Revocation: a key declares itself dead. Pure: no node:* imports.
//
// Why revocation and not rotation after a leak: a rotation is signed by the old key, so whoever holds a leaked key can
// publish a rotation to a key of their own and it verifies. A revocation is also signed by the old key, but it can only
// ever take trust away, never hand it to anyone, so anyone holding the key may publish it: that is the safe direction.

import { canonicalJson } from "./canonical.js";
import { keyId, keyIdOfPrivate, signText, verifyText } from "./keys.js";
import { KID_PATTERN, isBase64Url, isIsoUtc } from "./verify.js";
import {
  ALG,
  FORMAT_VERSION,
  REVOCATION_TYPE,
  type InvalidReason,
  type PlumblineKey,
  type PlumblineRevocation,
  type TrustEntry,
  type VerifyResult,
} from "./types.js";

export interface RevokeOptions {
  /** base64url PKCS#8 private key of the key being revoked. */
  privateKey: string;
  /** The public key record of the key being revoked. */
  key: PlumblineKey;
  now?: Date;
  /** A note for people. Omitted from the statement when absent. */
  reason?: string;
}

export async function revokeKey(options: RevokeOptions): Promise<PlumblineRevocation> {
  const { privateKey, key, reason } = options;
  if ((await keyIdOfPrivate(privateKey)) !== key.kid) {
    throw new Error("the key record's kid does not belong to the private key");
  }
  if (reason !== undefined && (typeof reason !== "string" || reason.trim() === "")) {
    throw new Error("a reason, when given, must be a non-empty string");
  }
  const unsigned = {
    type: REVOCATION_TYPE,
    version: FORMAT_VERSION,
    alg: ALG,
    kid: key.kid,
    revokedAt: (options.now ?? new Date()).toISOString(),
    ...(reason !== undefined ? { reason } : {}),
  };
  return { ...unsigned, sig: await signText(privateKey, canonicalJson(unsigned)) };
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

function shapeProblem(r: unknown): string | undefined {
  if (typeof r !== "object" || r === null || Array.isArray(r)) return "the revocation is not an object";
  const o = r as Record<string, unknown>;
  if (o.type !== REVOCATION_TYPE) return "the document type is not plumbline-revocation";
  if (o.version !== FORMAT_VERSION) return "the format version is not supported";
  if (o.alg !== ALG) return "the algorithm is not Ed25519";
  if (typeof o.kid !== "string" || !KID_PATTERN.test(o.kid)) return "the kid is not 16 lowercase hex characters";
  if (!isIsoUtc(o.revokedAt)) return "revokedAt is not a UTC ISO timestamp";
  if (o.reason !== undefined && typeof o.reason !== "string") return "the reason is not a string";
  if (!isBase64Url(o.sig)) return "the signature value is not base64url";
  return undefined;
}

/**
 * Checks a revocation against the trust entry the verifier ALREADY holds for its `kid` (never against a key that arrives
 * with the statement). `verified` returns the entry with `revokedAt` set; the caller replaces its entry with it, and from
 * then on verifySignature and verifyRotation answer `invalid` / `revoked` for that key. No entry (the verifier never
 * trusted the key) is `unverifiable`, and a revocation that does not verify under the trusted key is `invalid`.
 * A revocation carries no origin: it applies to every trust entry for that kid, so call it once per entry.
 */
export async function applyRevocation(
  revocation: PlumblineRevocation,
  entry: TrustEntry | undefined,
): Promise<VerifyResult & { entry?: TrustEntry }> {
  const problem = shapeProblem(revocation);
  if (problem !== undefined) {
    return invalid("malformed", `The revocation is malformed: ${problem}.`, undefined, entry?.origin);
  }
  const { kid } = revocation;
  if (entry === undefined || entry.kid !== kid) {
    return {
      verdict: "unverifiable",
      kid,
      ...(entry !== undefined ? { origin: entry.origin } : {}),
      detail: "The revoked key is not one this verifier trusts, so the revocation cannot be checked and changes nothing here.",
    };
  }
  let derived: string | undefined;
  try {
    derived = await keyId(entry.publicKey);
  } catch {
    derived = undefined;
  }
  if (derived !== entry.kid) {
    return invalid(
      "kid-mismatch",
      "The trust store entry for this key does not match its own key id, so the trust store itself is defective.",
      kid,
      entry.origin,
    );
  }
  const { sig, ...unsigned } = revocation;
  if (!(await verifyText(entry.publicKey, canonicalJson(unsigned), sig))) {
    return invalid(
      "bad-signature",
      "The revocation does not verify under the key this verifier trusts for it, so it was not made by that key and is refused.",
      kid,
      entry.origin,
    );
  }
  // Keep the earliest revocation time seen; the time is informational, since a revoked key is dead whatever the dates.
  const revokedAt =
    entry.revokedAt !== undefined && Date.parse(entry.revokedAt) <= Date.parse(revocation.revokedAt)
      ? entry.revokedAt
      : revocation.revokedAt;
  return {
    verdict: "verified",
    kid,
    origin: entry.origin,
    detail: "A key this verifier trusts has revoked itself: nothing signed by it is accepted any more.",
    entry: { ...entry, revokedAt },
  };
}
