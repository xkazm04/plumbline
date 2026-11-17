// Core: canonical bytes, keys, signing, verification, rotation, revocation and the signed-file rule. The signatures
// are the contract WP2 (gate, watch) and WP3 (the Desk) build against. Pure: no node:* imports anywhere under
// src/core, so the same modules run in Node 22 and in a browser through WebCrypto (globalThis.crypto.subtle).

export * from "./types.js";
export { canonicalJson, sha256Hex, utf8, bytesToHex, bytesToBase64Url, base64UrlToBytes } from "./canonical.js";
export { keyId, generateKey, derivePublicKey, keyIdOfPrivate, type GeneratedKey } from "./keys.js";
export { signSubjects, subjectDigest, isAcceptableOrigin, type SignOptions } from "./sign.js";
export { verifySignature, isKid, isPublicKey, FUTURE_SKEW_MS, type VerifyOptions } from "./verify.js";
export { rotateKey, verifyRotation, adoptRotation, type RotateOptions } from "./rotate.js";
export { revokeKey, applyRevocation, spreadRevocations, type RevokeOptions } from "./revoke.js";
export { signedPathsOf, networkPathOf, isSafeSubjectPath, parseManifest, type SitePresence } from "./signed-paths.js";
export { countDuplicateKeys } from "./json-keys.js";
