// Key rotation: the old key names its successor. Pure: no node:* imports.

import { canonicalJson } from "./canonical.js";
import { keyId, keyIdOfPrivate, signText, verifyText } from "./keys.js";
import { KID_PATTERN, isBase64Url, isIsoUtc, resolveTrusted, revokedResult } from "./verify.js";
import {
  FORMAT_VERSION,
  ROTATION_TYPE,
  type InvalidReason,
  type PlumblineKey,
  type PlumblineRotation,
  type TrustStore,
  type VerifyResult,
} from "./types.js";

export interface RotateOptions {
  oldPrivateKey: string;
  oldKey: PlumblineKey;
  newKey: PlumblineKey;
  now?: Date;
}

export async function rotateKey(options: RotateOptions): Promise<PlumblineRotation> {
  const { oldPrivateKey, oldKey, newKey } = options;
  if ((await keyId(newKey.publicKey)) !== newKey.kid) {
    throw new Error("the new key's kid is not derived from its public key");
  }
  if ((await keyIdOfPrivate(oldPrivateKey)) !== oldKey.kid) {
    throw new Error("the old key's kid does not belong to the old private key");
  }
  if (oldKey.kid === newKey.kid) throw new Error("the new key is the old key: a rotation must name a different key");
  const unsigned = {
    type: ROTATION_TYPE,
    version: FORMAT_VERSION,
    from: oldKey.kid,
    to: newKey.kid,
    toPublicKey: newKey.publicKey,
    signedAt: (options.now ?? new Date()).toISOString(),
  };
  return { ...unsigned, sig: await signText(oldPrivateKey, canonicalJson(unsigned)) };
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
  if (typeof r !== "object" || r === null || Array.isArray(r)) return "the rotation statement is not an object";
  const o = r as Record<string, unknown>;
  if (o.type !== ROTATION_TYPE) return "the document type is not plumbline-rotation";
  if (o.version !== FORMAT_VERSION) return "the format version is not supported";
  if (typeof o.from !== "string" || !KID_PATTERN.test(o.from)) return "from is not a kid";
  if (typeof o.to !== "string" || !KID_PATTERN.test(o.to)) return "to is not a kid";
  if (!isBase64Url(o.toPublicKey)) return "toPublicKey is not base64url";
  if (!isIsoUtc(o.signedAt)) return "signedAt is not a UTC ISO timestamp";
  if (!isBase64Url(o.sig)) return "the signature value is not base64url";
  return undefined;
}

/**
 * Checks a rotation statement against the old key the verifier already trusts for `origin`. `verified` means the
 * caller may adopt `rotation.to` / `rotation.toPublicKey` for that origin. The result's `kid` is always the signer
 * (`from`), as it is for signatures; the key to adopt is read from the statement the caller already holds.
 */
export async function verifyRotation(
  rotation: PlumblineRotation,
  trust: TrustStore,
  origin: string,
): Promise<VerifyResult> {
  const problem = shapeProblem(rotation);
  if (problem !== undefined) return invalid("malformed", `The rotation statement is malformed: ${problem}.`, undefined, origin);
  const { from, to, toPublicKey, sig } = rotation;

  const trusted = await resolveTrusted(trust, from, origin);
  if (trusted && "poisoned" in trusted) {
    return invalid(
      "kid-mismatch",
      "A trust store entry for the old key does not match its own key id, so the trust store itself is defective.",
      from,
      origin,
    );
  }
  // A rotation from a revoked key is never honoured: whoever holds a leaked key could otherwise name their own successor.
  if (trusted && trusted.entry.revokedAt !== undefined) return revokedResult("rotation", from, origin);

  let derivedTo: string | undefined;
  try {
    derivedTo = await keyId(toPublicKey);
  } catch {
    derivedTo = undefined;
  }
  if (derivedTo !== to) {
    return invalid("kid-mismatch", "The new key id in the statement is not derived from the new public key it carries.", from, origin);
  }
  if (from === to) return invalid("malformed", "The rotation names the same key as its successor.", from, origin);

  if (!trusted) {
    return {
      verdict: "unverifiable",
      kid: from,
      origin,
      detail:
        "The old key that signed this rotation is unknown to this verifier, so the statement cannot be checked and the new key must not be adopted on its word.",
    };
  }
  const { sig: _sig, ...unsigned } = rotation;
  void _sig;
  return (await verifyText(trusted.entry.publicKey, canonicalJson(unsigned), sig))
    ? { verdict: "verified", kid: from, origin, detail: "A key this verifier already trusts for this origin named its successor." }
    : invalid("bad-signature", "The rotation statement does not verify under the trusted old key.", from, origin);
}
