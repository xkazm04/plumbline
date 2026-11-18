// Keys: identity derivation and Ed25519 primitives over WebCrypto. Pure: no node:* imports.

import { base64UrlToBytes, bytesToBase64Url, sha256Hex, webCrypto } from "./canonical.js";
import {
  ALG,
  FORMAT_VERSION,
  KEY_TYPE,
  KID_PATTERN,
  PRIVATE_KEY_TYPE,
  PUBLIC_KEY_PATTERN,
  type PlumblineKey,
  type PrivateKeyFile,
} from "./types.js";

export const RAW_PUBLIC_KEY_BYTES = 32;

/** The first 16 hex chars of SHA-256 of the raw 32-byte public key (base64url). Identity is derived, never claimed. */
export async function keyId(publicKey: string): Promise<string> {
  const raw = base64UrlToBytes(publicKey);
  if (raw.length !== RAW_PUBLIC_KEY_BYTES) throw new Error("a raw Ed25519 public key is 32 bytes");
  return (await sha256Hex(raw)).slice(0, 16);
}

/**
 * True only when `kid` is a well-formed kid, `publicKey` is the base64url of exactly 32 bytes, and `kid` is the key id
 * derived from it. Never throws. The one identity check signatures (trust entries), rotations (the successor), revocations
 * (the trusted entry) and the CLI's first-contact `trust` share.
 */
export async function isDerivedKid(kid: unknown, publicKey: unknown): Promise<boolean> {
  if (typeof kid !== "string" || !KID_PATTERN.test(kid) || typeof publicKey !== "string" || !PUBLIC_KEY_PATTERN.test(publicKey)) {
    return false;
  }
  try {
    return (await keyId(publicKey)) === kid;
  } catch {
    return false;
  }
}

export interface GeneratedKey {
  key: PlumblineKey;
  /** base64url PKCS#8 private key. The caller decides where it goes; core never writes it anywhere. */
  privateKey: string;
}

export async function generateKey(now: Date = new Date()): Promise<GeneratedKey> {
  const subtle = webCrypto();
  const pair = (await subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  const publicKey = bytesToBase64Url(new Uint8Array(await subtle.exportKey("raw", pair.publicKey)));
  const privateKey = bytesToBase64Url(new Uint8Array(await subtle.exportKey("pkcs8", pair.privateKey)));
  return {
    key: {
      type: KEY_TYPE,
      version: FORMAT_VERSION,
      alg: ALG,
      kid: await keyId(publicKey),
      publicKey,
      createdAt: now.toISOString(),
    },
    privateKey,
  };
}

async function importPrivate(privateKey: string): Promise<CryptoKey> {
  return webCrypto().importKey("pkcs8", base64UrlToBytes(privateKey) as BufferSource, "Ed25519", true, ["sign"]);
}

/** The base64url raw public key that belongs to a base64url PKCS#8 private key. */
export async function derivePublicKey(privateKey: string): Promise<string> {
  const jwk = await webCrypto().exportKey("jwk", await importPrivate(privateKey));
  if (typeof jwk.x !== "string") throw new Error("the private key has no public half");
  return jwk.x;
}

/** The kid of the key pair a private key belongs to. */
export async function keyIdOfPrivate(privateKey: string): Promise<string> {
  return keyId(await derivePublicKey(privateKey));
}

/** Ed25519 signature over UTF-8 text, base64url. */
export async function signText(privateKey: string, text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const sig = await webCrypto().sign("Ed25519", await importPrivate(privateKey), bytes as BufferSource);
  return bytesToBase64Url(new Uint8Array(sig));
}

/** True only when `sig` is a valid Ed25519 signature of the UTF-8 text under the raw public key. Never throws. */
export async function verifyText(publicKey: string, text: string, sig: string): Promise<boolean> {
  try {
    const subtle = webCrypto();
    const key = await subtle.importKey("raw", base64UrlToBytes(publicKey) as BufferSource, "Ed25519", false, ["verify"]);
    const sigBytes = base64UrlToBytes(sig);
    return await subtle.verify("Ed25519", key, sigBytes as BufferSource, new TextEncoder().encode(text) as BufferSource);
  } catch {
    return false;
  }
}


/**
 * True when a parsed value has the exact shape of a private key file (`plumbline.private.json`): the type, version and
 * algorithm strings, a string kid and a string key. It does not check that the kid belongs to the key; keyIdOfPrivate
 * does that, and signing refuses a mismatch. The one shape test the CLI and the Desk share. Pure.
 */
export function isPrivateKeyFile(value: unknown): value is PrivateKeyFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const o = value as Record<string, unknown>;
  return (
    o.type === PRIVATE_KEY_TYPE &&
    o.version === FORMAT_VERSION &&
    o.alg === ALG &&
    typeof o.kid === "string" &&
    typeof o.privateKey === "string"
  );
}
