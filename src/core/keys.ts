// Keys: identity derivation and Ed25519 primitives over WebCrypto. Pure: no node:* imports.

import { base64UrlToBytes, bytesToBase64Url, sha256Hex, webCrypto } from "./canonical.js";
import { ALG, FORMAT_VERSION, KEY_TYPE, type PlumblineKey } from "./types.js";

export const RAW_PUBLIC_KEY_BYTES = 32;

/** The first 16 hex chars of SHA-256 of the raw 32-byte public key (base64url). Identity is derived, never claimed. */
export async function keyId(publicKey: string): Promise<string> {
  const raw = base64UrlToBytes(publicKey);
  if (raw.length !== RAW_PUBLIC_KEY_BYTES) throw new Error("a raw Ed25519 public key is 32 bytes");
  return (await sha256Hex(raw)).slice(0, 16);
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

