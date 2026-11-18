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

/**
 * The most statements one `plumbline-rotation.json` (a chain) or `plumbline-revocation.json` (a list) may hold; a file
 * with more is malformed. Derivation: a publisher rotates or revokes a handful of times in a site's life (a yearly
 * planned rotation for a decade is 10 statements); 64 is that order of magnitude with room to spare, and 64 statements
 * of about 300 bytes each (measured 2026-11-18 as the CLI writes them: a revocation with a 10-character reason is 269
 * bytes, a rotation 313) is about 20 KB, far under the 512 KiB fetch ceiling. The cap bounds the signature checks one
 * untrusted file can ask a verifier for.
 */
export const MAX_STATEMENTS_PER_FILE = 64;

/**
 * The most subjects one signature may list; a signature with more is malformed, and `verify --url` fetches none of
 * them. Derivation: the Plumbline Desk signs 6 files (measured 2026-11-18, site/plumbline.signature.json), and a site's
 * manifest, networks, action modules, pages and bundle are tens of files at most; 256 is an order of magnitude above a
 * large real site, while a hostile 512 KiB signature could otherwise list thousands of paths for a verifier to fetch.
 */
export const MAX_SUBJECTS = 256;

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

/** The CLI's private key file name. It belongs in the publisher's private custody, never in the site. */
export const PRIVATE_KEY_FILE = "plumbline.private.json" as const;
export const PRIVATE_KEY_TYPE = "plumbline-private-key" as const;

/**
 * `plumbline.private.json`, the CLI's private key file (the Desk reads and writes the same format). `privateKey` is
 * base64url PKCS#8. Never published, never committed (`*.private.json` is git-ignored).
 */
export interface PrivateKeyFile {
  type: typeof PRIVATE_KEY_TYPE;
  version: typeof FORMAT_VERSION;
  alg: typeof ALG;
  kid: string;
  privateKey: string;
}

/**
 * One rotation statement: the old key names its successor. Key loss is identity loss, so rotation is designed in.
 * `plumbline-rotation.json` holds one statement, or a chain of them (RotationFileBody).
 */
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
 * What `plumbline-rotation.json` holds: one statement (every file written before 2026-11-18, and the first rotation a
 * site makes), or a JSON array of 1..MAX_STATEMENTS_PER_FILE statements in chain order, oldest first, where each
 * statement's `from` is the previous statement's `to` (each is signed by the previous key). Every statement is the
 * unchanged PlumblineRotation; the array adds no member of its own.
 */
export type RotationFileBody = PlumblineRotation | PlumblineRotation[];

/**
 * What `plumbline-revocation.json` holds: one statement (every file written before 2026-11-18, and a site's first
 * revocation), or a JSON array of 1..MAX_STATEMENTS_PER_FILE statements, oldest first, one per revoked key, so a second
 * revocation never unpublishes the first. Every statement is the unchanged PlumblineRevocation.
 */
export type RevocationFileBody = PlumblineRevocation | PlumblineRevocation[];

/**
 * `plumbline.lock.json`, written by `watch --init`, read by the three drift detectors. Every hash is SHA-256 of the
 * exact bytes. `peers[url].links` is the hash of the peer's `links.json` at the same base, or `"absent"` when the peer
 * published none; a lock written before 2026-11-17 has no `links` member.
 */
/**
 * The repository the vendored runtime was copied from when it is not nsdeploy itself: `repo` is `owner/name`, `path`
 * the folder in it, `commit` the commit the copy was taken at (the Desk's runtime is cognizant-ai-labs/agentic-web's
 * `skills/agentify-website/runtime`, nsdeploy's runtime with edits; site/runtime/NOTICE). The watch asks this upstream.
 */
export interface RuntimeVia {
  repo: string;
  path: string;
  commit: string;
}

/** A peer that could not be captured when the lock was written: it stays in the lock, and every watch reports it. */
export interface PendingPeer {
  since: string;
}

export interface PlumblineLock {
  version: typeof FORMAT_VERSION;
  runtime: { source: "nsdeploy"; commit: string; files: Record<string, string>; via?: RuntimeVia };
  grounding: { sources: GroundingSource[]; builtAt: string };
  peers: Record<string, PeerRecord>;
  pendingPeers?: Record<string, PendingPeer>;
  /** Since 2026-11-18: agent definitions from outside this spec the site depends on, keyed by their https address. */
  external?: Record<string, ExternalRecord>;
}

/**
 * The kinds of external agent definition a lock may hold. `a2a-card`: an A2A Agent Card (JSON, fetched with a GET).
 * `mcp-tools`: an MCP server's tool list; reserved, this build neither captures nor checks it (it needs a JSON-RPC POST,
 * docs/gate-and-watch.md), and a lock that holds one is reported as not checked.
 */
export const EXTERNAL_KINDS = ["a2a-card", "mcp-tools"] as const;
export type ExternalKind = (typeof EXTERNAL_KINDS)[number];

/** `external[url]`: what was captured of one external agent definition. */
export interface ExternalRecord {
  kind: ExternalKind;
  /** SHA-256 of the exact bytes fetched. */
  sha256: string;
  /**
   * Per part, SHA-256 of canonicalJson(the part), keyed by SHA-256 of its id (for an A2A card, each skill by its `id`),
   * so a change can be counted without quoting it. Omitted when the definition has no parts or could not be read as one.
   */
  parts?: Record<string, string>;
  /**
   * Since 2026-11-18 (UAT-17, TOM-L1-13): for an A2A card read as one, how many JWS signatures it carried when locked
   * (a non-negative integer; counted, never verified). Omitted when it could not be read as a card, and in every lock
   * written before.
   */
  signatures?: number;
  checkedAt: string;
}

/** One grounding source the lock holds: its ref, the SHA-256 of its exact bytes, and the facts anchored on it. */
export interface GroundingSource {
  ref: string;
  sha256: string;
  /**
   * Since 2026-11-18: SHA-256 of each literal the network's instructions state that this page states too (a price, a
   * time, a date, a phone number, an e-mail address, a percentage; src/watch/anchors.ts), sorted. When the page
   * changes, the watch counts how many are no longer on it. Omitted when there are none, for the network and manifest
   * files themselves, and in every lock written before.
   */
  anchors?: string[];
  /**
   * Since 2026-11-18 (MAR-RC-1): where on the page each anchor's fact is. Keyed by an anchor (a member of `anchors`),
   * the sorted SHA-256 of "<literal>\n<place>" for each place the network's fact is stated in: a place is the nearest
   * heading and, in a table row, the row's first cell (src/watch/anchors.ts). A watch then tells a value that moved (still
   * on the page, but not where it was) from one still in place, and an anchor with no entry is reported as not checked
   * for where it is. Omitted when no anchor's place could be told, and in every lock written before.
   */
  places?: Record<string, string[]>;
}

export interface PeerRecord {
  sha256: string;
  /** SHA-256 of the peer's links.json, or PEER_LINKS_ABSENT. */
  links?: string;
  kid?: string;
  /**
   * Since 2026-11-18 (TOM-RC-1): present only when `kid` is absent. The kid the lock recorded for this peer before a
   * person accepted, with `watch --relock --accept-signer <peer>`, that it publishes no signature now. A later signature
   * by any other key is a signer change from this kid, which a relock refuses until a person names the peer again; a
   * signature by this kid again is recorded as `kid`. Compared, never verified: it is not a trust decision.
   */
  formerKid?: string;
  /**
   * The definition in outline (since 2026-11-18), so a changed peer can be said in counts: agents added, removed and
   * changed, outbound hosts added and removed, the front agent changed or not. Omitted when the definition could not be
   * outlined (not JSON, a repeated key) and in every lock written before; a watch then says to re-lock to see what
   * changed. Never a stranger's words: names and hosts are hashed.
   */
  outline?: PeerOutline;
  checkedAt: string;
}

/**
 * `peers[url].outline`. Every string is a lowercase hex SHA-256: `agents` maps SHA-256 of an agent's name to SHA-256 of
 * canonicalJson(that agent); `hosts` is the sorted set of SHA-256 of each outbound host (the host of every http(s)
 * address in an agent's `tools`, and of every `link_labels` key, lowercased); `front` is SHA-256 of the front agent's
 * name, omitted when the network has none.
 */
export interface PeerOutline {
  agents: Record<string, string>;
  hosts: string[];
  front?: string;
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
  /**
   * Since 2026-11-18 (UAT-23, INE-L1-11): when this verifier added the entry (`trust`, `adopt`), a UTC ISO timestamp.
   * Absent in an entry written before, or by hand. Informational: no verdict reads it.
   */
  addedAt?: string;
  /**
   * Since 2026-11-18 (UAT-23, INE-L1-12): when this verifier recorded `revokedAt` in its trust file. `revokedAt` is the
   * revocation's own time (for a key revoked by cascade, the time of the key it was adopted through), so a key adopted
   * after that time can read revoked "before" it was adopted; this says when the revocation was learned here. Absent
   * when `revokedAt` is, and in an entry written before. Informational: no verdict reads it.
   */
  revokedRecordedAt?: string;
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
  /**
   * When the gate ran: a UTC ISO timestamp taken as the run started (UAT-10). Every gate run writes it; a report written
   * before 2026-11-18 has none. The badge's date is this one, never the day it is drawn.
   */
  checkedAt?: string;
  /**
   * The site's signature, checked as `plumbline verify --url` checks it, against the trust file the gate was given
   * (`gate --trust <file>`). Absent when the gate was not asked to check it: then no surface may read the report as
   * saying anything about the signature. It never changes `state` or the exit code (three states stay three).
   */
  signature?: VerifyResult;
}

/**
 * Since 2026-11-18 (UAT-17, TOM-L1-07): why a drift finding was written, from this closed list, so a script can sort
 * findings without matching sentences. The sentence (`summary`) stays beside it. Each code fixes what `expected` and
 * `actual` hold (a hash, a kid, a date or a short commit) and is listed with its kind and severity in
 * docs/gate-and-watch.md ("Reason codes"). Grouped by what they are about:
 *   the publisher's files:   grounding-*, runtime-*, upstream-*, signature-*, network-*
 *   the lock's peers:        peer-*, signer-*
 *   external definitions:    external-*
 *   capture (init, relock):  capture-*, and what a relock or `--init` was asked to do and could not: not-added,
 *                            accept-*, drop-*
 *   the published reader:    url-not-checked
 */
export const DRIFT_CODES = [
  // grounding sources
  "grounding-changed",
  "grounding-stale-fact",
  "grounding-line-endings",
  "grounding-unreadable",
  "grounding-not-locked",
  // the vendored runtime and its upstream
  "runtime-changed",
  "runtime-line-endings",
  "runtime-missing",
  "runtime-unreadable",
  "runtime-added",
  "upstream-ahead",
  "upstream-no-commit",
  "upstream-unchecked",
  // the site's own signature
  "signature-expired",
  "signature-expiring",
  "signature-unreadable",
  "signature-not-covering",
  // the site's network files, as discovery reads them
  "network-path-unsafe",
  "network-not-json",
  // peers
  "peer-changed",
  "peer-unreachable",
  "peer-refused",
  "peer-pending",
  "peer-not-locked",
  "allowed-peer-unused",
  "peer-links-untracked",
  "peer-links-unreadable",
  "peer-links-appeared",
  "peer-links-changed",
  "peer-links-gone",
  // a peer's signer
  "signer-rotated-verified",
  "signer-rotation-published",
  "signer-rotation-unverified",
  "signer-no-rotation",
  "signer-gone",
  "signer-unreadable",
  "signer-back",
  "signer-first",
  // external agent definitions (an A2A Agent Card)
  "external-changed",
  "external-unreachable",
  "external-refused",
  "external-unsupported",
  // capture: what init, watch --init and a relock could not capture, or kept
  "capture-runtime-absent",
  "capture-runtime-unreadable",
  "capture-runtime-commit-unknown",
  "capture-source-unreadable",
  "capture-source-no-text",
  "capture-source-dropped-named",
  "capture-page-no-fact",
  "capture-stale-kept",
  "capture-no-sources",
  "capture-line-endings",
  "capture-signer-kept",
  "capture-signer-unrecorded",
  "capture-peer-kept",
  "capture-peer-pending",
  "capture-external-kept",
  "capture-external-unreadable",
  "capture-external-no-outline",
  // asked for and not done
  "not-added",
  "accept-unknown",
  "accept-signer-unused",
  "drop-unknown",
  // the published reader
  "url-not-checked",
] as const;
export type DriftCode = (typeof DRIFT_CODES)[number];

/**
 * Since 2026-11-18 (UAT-17, DEV-L1-11): the counts a changed definition's sentence says, as numbers. For a peer's
 * network (`peer-changed`) with an outline on both sides: agents and outbound hosts added, removed and changed, and
 * whether the front agent changed. For an A2A card (`external-changed`) with parts on both sides: skills added, removed
 * and changed, and how many JWS signatures it carries now (counted, never verified). Omitted when the sentence says
 * what changed is not told.
 */
export interface DriftCounts {
  agentsAdded?: number;
  agentsRemoved?: number;
  agentsChanged?: number;
  hostsAdded?: number;
  hostsRemoved?: number;
  frontChanged?: boolean;
  skillsAdded?: number;
  skillsRemoved?: number;
  skillsChanged?: number;
  signatures?: number;
}

export interface DriftFinding {
  kind: DriftKind;
  severity: Severity;
  /** Since 2026-11-18 (UAT-17): every finding this build writes carries one; a report written before has none. */
  code: DriftCode;
  ref: string;
  expected?: string;
  actual?: string;
  summary: string;
  /** Since 2026-11-18 (UAT-17): see DriftCounts. */
  counts?: DriftCounts;
}

/**
 * Since 2026-11-18 (UAT-17, TOM-L1-07): what a watch found for one thing the lock holds from someone else, so an
 * inventory has a row for every peer, pending peer and external definition, a clean one included.
 *   unchanged       checked, and no finding says it changed or was not checked (an `info` may stand)
 *   changed         a finding says its definition, links.json, signer or card changed (`signer-first` included)
 *   partly-checked  its definition was checked, its links.json or signer was not
 *   not-checked     it could not be reached, or its address is not contacted
 *   pending         the lock holds it as pending: it was never captured
 */
export const RECORD_STATES = ["unchanged", "changed", "partly-checked", "not-checked", "pending"] as const;
export type RecordState = (typeof RECORD_STATES)[number];

export interface WatchedRecord {
  /** Which member of the lock: `peers`, `pendingPeers` or `external`. */
  part: "peer" | "pending" | "external";
  /** The address, as the lock keys it. */
  ref: string;
  /** For `external`: its kind (`a2a-card`, `mcp-tools`). */
  externalKind?: ExternalKind;
  /** The pinned SHA-256 (of the network definition, or of the external definition's bytes). Absent for `pending`. */
  sha256?: string;
  /** The signer kid the lock recorded for a peer; absent when it recorded none. */
  kid?: string;
  /** The kid a peer had before a person accepted that it stopped signing (PeerRecord.formerKid). */
  formerKid?: string;
  /** For an A2A card: the JWS signatures it carried when locked (ExternalRecord.signatures), when the lock records it. */
  signatures?: number;
  /** When the lock recorded it: the record's `checkedAt`, or a pending peer's `since`. */
  lockedAt: string;
  state: RecordState;
  /** The codes of this report's findings for this ref, in report order; empty when there are none. */
  codes: DriftCode[];
}
/**
 * Where the lock stands for one report. `found`: read and checked. `absent`: none (a missing file, or a site that
 * answers 404 or 410). `refused`: the browser was refused (the Desk only). `unreadable`: it could not be read.
 * `unusable`: not JSON, or not the lock's shape. Anything but `found` means no drift was checked, which is never a clean
 * report: it is a lock state with its own sentence, not a drift finding.
 */
export const LOCK_STATES = ["found", "absent", "refused", "unreadable", "unusable"] as const;
export type LockState = (typeof LOCK_STATES)[number];

export interface DriftReport {
  findings: DriftFinding[];
  lockState?: LockState;
  /** Present when lockState is not `found`: why no drift was checked. */
  lockSummary?: string;
  /** Since 2026-11-18 (UAT-17): when the watch ran, a UTC ISO timestamp. Every watch this build runs writes it. */
  checkedAt?: string;
  /**
   * Since 2026-11-18 (UAT-17): one row per peer, pending peer and external definition the lock holds, sorted by part and
   * ref. Present when lockState is `found`.
   */
  records?: WatchedRecord[];
}
