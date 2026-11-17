// Core: canonical bytes, keys, signing, verification, rotation. The signatures are the contract WP2 (gate, watch)
// and WP3 (the Desk) build against. Pure: no node:* imports anywhere under src/core, so the same modules run in
// Node 22 and in a browser through WebCrypto (globalThis.crypto.subtle).

export * from "./types.js";
export { canonicalJson, sha256Hex, utf8, bytesToHex, bytesToBase64Url, base64UrlToBytes } from "./canonical.js";
export { keyId, generateKey, derivePublicKey, keyIdOfPrivate, type GeneratedKey } from "./keys.js";
export { signSubjects, subjectDigest, isAcceptableOrigin, type SignOptions } from "./sign.js";
export { verifySignature, FUTURE_SKEW_MS, type VerifyOptions } from "./verify.js";
export { rotateKey, verifyRotation, type RotateOptions } from "./rotate.js";
