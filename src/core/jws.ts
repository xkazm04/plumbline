// A Plumbline signature as a detached JWS (RFC 7515, Appendix F), so a verifier that speaks JWS can check it.
// Pure: no node:* imports. The profile (docs/jws-profile.md):
//   protected header  exactly {"alg":"EdDSA","kid":"<the Plumbline kid>"} (RFC 8037's EdDSA with an Ed25519 key),
//                     serialised with canonicalJson, so the header bytes are fixed for a kid;
//   payload           the UTF-8 bytes of the statement the native `sig` covers: unsignedBytesOf(signature), the
//                     canonical JSON of plumbline.signature.json without `sig` (signedBytesOf in verify.ts);
//   serialisation     compact and detached: BASE64URL(header) || ".." || BASE64URL(signature). The verifier rebuilds
//                     the payload from the signature document it already reads.
// The native plumbline.signature.json stays the wire format; nothing new is published by default. Converting needs the
// private key: a JWS signs BASE64URL(header) "." BASE64URL(payload), not the payload itself, and an Ed25519 signature
// cannot be moved from one message to another. Verifying goes through verifyStatement, the native pipeline with the
// math swapped, so the same trust store gives the same three verdicts.

import { base64UrlToBytes, bytesToBase64Url, canonicalJson, unsignedBytesOf, utf8 } from "./canonical.js";
import { signText, verifyText } from "./keys.js";
import { KID_PATTERN, type PlumblineSignature, type SubjectFile, type TrustStore, type VerifyResult } from "./types.js";
import { invalid, verifyStatement, type VerifyOptions } from "./verify.js";

export const JWS_ALG = "EdDSA" as const;

/** The protected header of this profile: nothing but the algorithm and the kid. */
export interface PlumblineJwsHeader {
  alg: typeof JWS_ALG;
  kid: string;
}

const b64 = (text: string): string => bytesToBase64Url(utf8(text));

/** The JWS signing input for a statement under a kid: BASE64URL(header) "." BASE64URL(payload). */
export function jwsSigningInput(statement: object, kid: string): { header: string; input: string } {
  const header = b64(canonicalJson({ alg: JWS_ALG, kid }));
  return { header, input: `${header}.${b64(unsignedBytesOf(statement))}` };
}

/**
 * Signs a statement (a plumbline.signature.json, with or without its `sig`) as a detached compact JWS with the
 * Ed25519 key of `kid`. The caller has checked that the key is that kid's (the CLI's export-jws does).
 */
export async function signDetachedJws(statement: PlumblineSignature | Omit<PlumblineSignature, "sig">, privateKey: string): Promise<string> {
  const { header, input } = jwsSigningInput(statement, statement.kid);
  return `${header}..${await signText(privateKey, input)}`;
}

/** Header members that would put a key, or rules this profile does not know, inside the artifact. Each is refused. */
const REFUSED_MEMBERS = ["jwk", "jku", "x5c", "x5u", "x5t", "x5t#S256", "crit", "b64"];

/** A detached compact JWS, read: its header (as sent) and signature, or the problem with it. Never throws. */
export function parseDetachedJws(text: string): { header: string; signature: string; kid: string } | { problem: string } {
  const parts = text.trim().split(".");
  if (parts.length !== 3) return { problem: "it is not a compact JWS (three parts separated by dots)" };
  const [header, payload, signature] = parts as [string, string, string];
  if (payload !== "") return { problem: "it carries a payload; this profile's JWS is detached (the payload part is empty)" };
  if (!/^[A-Za-z0-9_-]+$/.test(header) || !/^[A-Za-z0-9_-]+$/.test(signature)) return { problem: "a part is not base64url" };
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(base64UrlToBytes(header)));
  } catch {
    return { problem: "its protected header is not JSON" };
  }
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) return { problem: "its protected header is not a JSON object" };
  const h = decoded as Record<string, unknown>;
  if (h.alg !== JWS_ALG) return { problem: "its algorithm is not EdDSA" };
  if (typeof h.kid !== "string" || !KID_PATTERN.test(h.kid)) return { problem: "its kid is not 16 lowercase hex characters" };
  if (REFUSED_MEMBERS.some((m) => Object.hasOwn(h, m))) {
    return { problem: "its header carries a key or a rule this profile refuses (jwk, jku, x5c, x5u, x5t, crit or b64): a verifier never takes the key from the artifact" };
  }
  return { header, signature, kid: h.kid };
}

/**
 * Verifies a plumbline.signature.json through a detached JWS instead of its native `sig`: the same files, the same
 * trust store, the same checks in the same order and the same three verdicts as verifySignature. The JWS header's kid
 * must be the statement's. A JWS that cannot be read is `invalid malformed`, with a detail in Plumbline's words.
 */
export async function verifyDetachedJws(
  signature: PlumblineSignature,
  jws: string,
  files: SubjectFile[],
  trust: TrustStore,
  options: VerifyOptions = {},
): Promise<VerifyResult> {
  const raw = signature as unknown as Record<string, unknown> | null;
  const kid = raw && typeof raw.kid === "string" && KID_PATTERN.test(raw.kid) ? raw.kid : undefined;
  const parsed = parseDetachedJws(jws);
  if ("problem" in parsed) return invalid("malformed", `The JWS is malformed: ${parsed.problem}.`, kid);
  if (parsed.kid !== kid) return invalid("malformed", "The JWS names another kid than the signature document it is checked against.", kid);
  // The statement's own `sig` plays no part: the JWS signature stands in its place, and the signed bytes exclude it.
  const statement = { ...signature, sig: parsed.signature };
  return verifyStatement(statement, files, trust, options, (publicKey, signed) => verifyText(publicKey, `${parsed.header}.${b64(signed)}`, parsed.signature));
}
