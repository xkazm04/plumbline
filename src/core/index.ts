// Core: canonical bytes, keys, signing, verification, rotation. WP1 implements every function below;
// the signatures are the contract WP2 (gate, watch) and WP3 (the Desk) build against. Pure: no node:* imports
// here, so the same module runs in Node 22 and in a browser through WebCrypto.

import type {
  PlumblineKey,
  PlumblineRotation,
  PlumblineSignature,
  SubjectFile,
  TrustStore,
  VerifyResult,
} from "./types.js";

export * from "./types.js";

const TODO = (what: string): never => {
  throw new Error(`not implemented: ${what} (WP1)`);
};

/** Sorted keys, no whitespace, `undefined` keys dropped, UTF-8. Byte-identical to Agent Customs' canonicalJson. */
export function canonicalJson(_value: unknown): string {
  return TODO("canonicalJson");
}

/** Lowercase hex SHA-256 of a string (UTF-8) or bytes. */
export async function sha256Hex(_data: string | Uint8Array): Promise<string> {
  return TODO("sha256Hex");
}

/** The first 16 hex chars of SHA-256 of the raw 32-byte public key (base64url). Identity is derived, never claimed. */
export async function keyId(_publicKey: string): Promise<string> {
  return TODO("keyId");
}

export interface GeneratedKey {
  key: PlumblineKey;
  /** base64url PKCS#8 private key. The caller decides where it goes; core never writes it anywhere. */
  privateKey: string;
}

export async function generateKey(_now?: Date): Promise<GeneratedKey> {
  return TODO("generateKey");
}

export interface SignOptions {
  privateKey: string;
  key: PlumblineKey;
  origin: string;
  files: SubjectFile[];
  now?: Date;
  lifetimeDays?: number;
}

export async function signSubjects(_options: SignOptions): Promise<PlumblineSignature> {
  return TODO("signSubjects");
}

export interface VerifyOptions {
  now?: Date;
  /** The key record fetched beside the signature. Used only to say "the math holds but the signer is unknown". */
  publishedKey?: PlumblineKey;
}

/** `verified` needs the signer in the trust store; an unknown signer is `unverifiable`, whatever the math says. */
export async function verifySignature(
  _signature: PlumblineSignature,
  _files: SubjectFile[],
  _trust: TrustStore,
  _options?: VerifyOptions,
): Promise<VerifyResult> {
  return TODO("verifySignature");
}

export interface RotateOptions {
  oldPrivateKey: string;
  oldKey: PlumblineKey;
  newKey: PlumblineKey;
  now?: Date;
}

export async function rotateKey(_options: RotateOptions): Promise<PlumblineRotation> {
  return TODO("rotateKey");
}

/** Checks a rotation statement against the old key the verifier already trusts; returns the new key to adopt. */
export async function verifyRotation(
  _rotation: PlumblineRotation,
  _trust: TrustStore,
  _origin: string,
): Promise<VerifyResult> {
  return TODO("verifyRotation");
}
