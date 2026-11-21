// Core: canonical bytes, keys, signing, verification, rotation, revocation and the signed-file rule. The signatures
// are the contract WP2 (gate, watch) and WP3 (the Desk) build against. Pure: no node:* imports anywhere under
// src/core, so the same modules run in Node 22 and in a browser through WebCrypto (globalThis.crypto.subtle).

export * from "./types.js";
export { canonicalJson, unsignedBytesOf, sha256Hex, utf8, bytesToHex, bytesToBase64Url, base64UrlToBytes } from "./canonical.js";
export { keyId, isDerivedKid, generateKey, derivePublicKey, keyIdOfPrivate, isPrivateKeyFile, type GeneratedKey } from "./keys.js";
export { signSubjects, subjectDigest, isAcceptableOrigin, type SignOptions } from "./sign.js";
export { verifySignature, invalid, isKid, isPublicKey, isIsoUtc, signerChangeDetail, FUTURE_SKEW_MS, type VerifyOptions } from "./verify.js";
export { rotateKey, verifyRotation, adoptRotation, walkRotationChain, statementsOf, type RotateOptions, type RotationHop, type RotationWalk } from "./rotate.js";
export { revokeKey, applyRevocation, applyRevocationText, spreadRevocations, type RevokeOptions, type RevocationOutcome } from "./revoke.js";
export { signedPathsOf, networkPathOf, codePathOf, isSafeSubjectPath, parseManifest, type SitePresence } from "./signed-paths.js";
export { countDuplicateKeys, duplicateKeys } from "./json-keys.js";
export { JWS_ALG, jwsSigningInput, parseDetachedJws, signDetachedJws, verifyDetachedJws, type PlumblineJwsHeader } from "./jws.js";
export { approveLock, verifyApproval, parseApprovers, approversKidProblem, approvalShapeProblem, MAX_APPROVER_LABEL, type ApproveOptions, type ApprovalVerdict } from "./approve.js";
