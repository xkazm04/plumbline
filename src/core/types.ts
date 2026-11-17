// The wire contract of Plumbline. Every identifier here is exact: the CLI, the gate, the watch and
// the Desk all read these names, and docs/signature-format.md is written from them (WP1 owns that doc).
// Absent-value convention: an absent optional field is OMITTED, never `null`. Canonical JSON drops
// `undefined` keys but would keep `null`, and that would change the signed bytes.

export const FORMAT_VERSION = 1 as const;
export const ALG = "Ed25519" as const;
export const SIGNATURE_TYPE = "plumbline-signature" as const;
export const KEY_TYPE = "plumbline-key" as const;
export const ROTATION_TYPE = "plumbline-rotation" as const;
export const REVOCATION_TYPE = "plumbline-revocation" as const;

/** Default signature lifetime in days. Illustrative: the publisher sets the real one. */
export const DEFAULT_LIFETIME_DAYS = 90;

// File names, relative to the site base.
export const SIGNATURE_FILE = "plumbline.signature.json" as const;
export const KEY_FILE = ".well-known/plumbline-key.json" as const;
export const ROTATION_FILE = "plumbline-rotation.json" as const;
export const REVOCATION_FILE = "plumbline-revocation.json" as const;
export const LOCK_FILE = "plumbline.lock.json" as const;
/** The site's manifest: always signed, and the signed copy names the network files that must be signed too. */
export const MANIFEST_FILE = "agent-manifest.json" as const;
/** The runtime lays this file over every network's links, so it is signed whenever the site publishes one. */
export const LINKS_FILE = "links.json" as const;

/** A key id: the first 16 lowercase hex characters of SHA-256 of the raw public key. */
export const KID_PATTERN = /^[0-9a-f]{16}$/;
/** base64url (no padding) of exactly 32 bytes: 43 characters, the last carrying 2 bits, so one of 16. */
export const PUBLIC_KEY_PATTERN = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
/** A lowercase hex SHA-256. */
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;
/**
 * The characters a subject path may use. A path is also relative (no leading `/`), and no segment is empty, `.` or
 * `..` (see isSafeSubjectPath in signed-paths.ts).
 */
export const SUBJECT_PATH_PATTERN = /^[A-Za-z0-9._/-]+$/;
/** The value of `peers[url].links` in the lock when the peer published no links.json (HTTP 404 or 410). */
export const PEER_LINKS_ABSENT = "absent" as const;

/** Three states, never two: first contact with a signer nobody has met is `unverifiable`. */
export const VERDICTS = ["verified", "invalid", "unverifiable"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const INVALID_REASONS = ["bad-signature", "tampered", "expired", "kid-mismatch", "malformed", "revoked"] as const;
export type InvalidReason = (typeof INVALID_REASONS)[number];

/** `unavailable` (an adapter could not be reached) is never `pass`. */
export const GATE_STATES = ["pass", "fail", "unavailable"] as const;
export type GateState = (typeof GATE_STATES)[number];

export const DRIFT_KINDS = ["grounding", "runtime", "peer"] as const;
export type DriftKind = (typeof DRIFT_KINDS)[number];

export const SEVERITIES = ["info", "warn", "block"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** One signed file: its path relative to the site base and the SHA-256 (hex) of its EXACT bytes as served. */
export interface SubjectDigest {
  path: string;
  sha256: string;
}

/** `plumbline.signature.json`. `sig` is base64url Ed25519 over canonicalJson(the object without `sig`). */
export interface PlumblineSignature {
  type: typeof SIGNATURE_TYPE;
  version: typeof FORMAT_VERSION;
  alg: typeof ALG;
  /** First 16 hex chars of SHA-256 of the raw 32-byte public key. Derived from the key, never claimed. */
  kid: string;
  /** The https origin the files are published from. */
  origin: string;
  signedAt: string;
  expiresAt: string;
  subjects: SubjectDigest[];
  sig: string;
}

/** `.well-known/plumbline-key.json`. A verifier NEVER trusts this about itself: it resolves `kid` in its trust store. */
export interface PlumblineKey {
  type: typeof KEY_TYPE;
  version: typeof FORMAT_VERSION;
  alg: typeof ALG;
  kid: string;
  /** base64url of the raw 32-byte public key. */
  publicKey: string;
  createdAt: string;
}

/** `plumbline-rotation.json`: the old key names its successor. Key loss is identity loss, so rotation is designed in. */
export interface PlumblineRotation {
  type: typeof ROTATION_TYPE;
  version: typeof FORMAT_VERSION;
  from: string;
  to: string;
  toPublicKey: string;
  signedAt: string;
  /** base64url Ed25519 by the OLD key over canonicalJson(the object without `sig`). */
  sig: string;
}

/**
 * `plumbline-revocation.json`: a key declares itself dead. Signed by the REVOKED key, so anyone holding it may revoke it
 * (the safe direction). A verifier accepts it only under the public key it ALREADY trusts for `kid`; once accepted, every
 * signature and every rotation by that key is `invalid` / `revoked`, whatever their dates.
 */
export interface PlumblineRevocation {
  type: typeof REVOCATION_TYPE;
  version: typeof FORMAT_VERSION;
  alg: typeof ALG;
  /** The revoked key's kid. */
  kid: string;
  revokedAt: string;
  /** A note for people; omitted when absent, never `null`. */
  reason?: string;
  /** base64url Ed25519 by the REVOKED key over canonicalJson(the object without `sig`). */
  sig: string;
}

/**
 * `plumbline.lock.json`, written by `watch --init`, read by the three drift detectors. Every hash is SHA-256 of the
 * exact bytes. `peers[url].links` is the hash of the peer's `links.json` at the same base, or `"absent"` when the peer
 * published none; a lock written before 2026-11-17 has no `links` member.
 */
export interface PlumblineLock {
  version: typeof FORMAT_VERSION;
  runtime: { source: "nsdeploy"; commit: string; files: Record<string, string> };
  grounding: { sources: { ref: string; sha256: string }[]; builtAt: string };
  peers: Record<string, PeerRecord>;
}

export interface PeerRecord {
  sha256: string;
  /** SHA-256 of the peer's links.json, or PEER_LINKS_ABSENT. */
  links?: string;
  kid?: string;
  checkedAt: string;
}

/**
 * A file handed to sign or verify: its path relative to the site base and its EXACT bytes as served. Pass the bytes
 * you fetched or read (`Uint8Array`), untouched: no JSON parse, no text decode (a decoder drops a BOM and replaces
 * invalid sequences), no newline change. A string is accepted for text you already hold and is hashed as its UTF-8
 * bytes with no normalisation. Anything else is refused with a TypeError.
 */
export interface SubjectFile {
  path: string;
  content: Uint8Array | string;
}

/** What the verifier already holds about who to trust. Local, mutable, explicit. */
export interface TrustEntry {
  kid: string;
  origin: string;
  /** base64url raw 32-byte public key the entry was adopted with. */
  publicKey: string;
  /** Set once a revocation by this key has been accepted. A revoked key is dead for everything, whatever the dates. */
  revokedAt?: string;
  /**
   * The kid of the key whose verified rotation statement this entry was adopted through (see adoptRotation). A
   * revocation of that key, or of any key up the chain, revokes this entry too. Absent for an entry made by first
   * contact.
   */
  adoptedVia?: string;
}
export interface TrustStore {
  find(kid: string, origin: string): TrustEntry | undefined;
}

export interface VerifyResult {
  verdict: Verdict;
  /** Present only when verdict is `invalid`. */
  reason?: InvalidReason;
  kid?: string;
  origin?: string;
  /** A sentence for a person; never copied from the inspected files. */
  detail?: string;
}

export interface GateFinding {
  adapter: string;
  state: GateState;
  summary: string;
}
export interface GateReport {
  target: string;
  /** The worst adapter state: fail, then unavailable, then pass. */
  state: GateState;
  findings: GateFinding[];
}

export interface DriftFinding {
  kind: DriftKind;
  severity: Severity;
  ref: string;
  expected?: string;
  actual?: string;
  summary: string;
}
export interface DriftReport {
  findings: DriftFinding[];
}
