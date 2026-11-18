// The watch's decisions with no I/O: the lock's shape rule, and what each thing a detector read means as a finding.
// No node:* import and no fetch, so it runs in Node (src/watch, the CLI's watch) and in the browser (site/drift.js, the
// Desk's drift reader, through scripts/build-site.mjs). Each driver keeps its own I/O rules (the CLI reads files under a
// root and fetches through safeFetch; the Desk reads what the site publishes through the page's fetcher) and hands
// the result here, so one severity policy serves both (docs/gate-and-watch.md):
//   grounding  changed or unreadable source: warn. A file the lock should cover and does not: warn.
//   runtime    changed, missing or added vendored file: block (copy-do-not-change). Added is the CLI's alone.
//   peer       changed definition, a links.json that appeared, changed or went away, or a changed signer kid: block;
//              unreachable, links.json not checkable or not recorded, signature gone, pending since init, or named by
//              a network and not in the lock: warn; newly signed: info.
//   signature  the site's own plumbline.signature.json: expired: block; expiring within 14 days: warn (kind grounding,
//              ref plumbline.signature.json; there is no fourth drift kind on the wire).

import {
  FORMAT_VERSION,
  KID_PATTERN,
  LOCK_FILE,
  PEER_LINKS_ABSENT,
  SIGNATURE_FILE,
  SUBJECT_PATH_PATTERN,
  type DriftFinding,
  type DriftReport,
  type PeerRecord,
  type PlumblineLock,
  type RuntimeVia,
  type PendingPeer,
  type LockState,
} from "../core/types.js";
import { isBlockedAddress, parseIPv4 } from "../net/address.js";
import { describeOutlineDiff, diffOutlines, isPeerOutline, outlineUnchanged, type PeerOutline } from "./outline.js";
import { isExternalRecord } from "./external.js";

// ---- the lock and report members (the wire contract now lives in core/types.ts; these names stay for callers) ----

export { LOCK_STATES } from "../core/types.js";
export type { LockState, RuntimeVia, PendingPeer } from "../core/types.js";
export type LockRuntime = PlumblineLock["runtime"];
export type Lock = PlumblineLock;
export type WatchReport = DriftReport;

// ---- the lock's shape ----

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isHex = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
// owner/name, as GitHub allows them; a name of "." or ".." is not a repository and would climb the API's path.
const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/;
const COMMIT = /^[0-9a-f]{7,40}$/;
const isSafePath = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9._/-]+$/.test(v) && v.split("/").every((s) => s !== "" && s !== "." && s !== "..");

/** True for a `runtime.via` the watch may turn into a GitHub API address: nothing in it can leave that API's path. */
export function isRuntimeVia(v: unknown): v is RuntimeVia {
  return isObject(v) && typeof v.repo === "string" && REPO.test(v.repo) && isSafePath(v.path) && typeof v.commit === "string" && COMMIT.test(v.commit);
}

/** Checks a parsed lock against the lock's shape; returns a reason sentence when it does not fit. */
export function lockProblem(value: unknown): string | null {
  if (!isObject(value)) return "the lock is not a JSON object";
  if (value.version !== FORMAT_VERSION) return "the lock has an unknown version";
  const { runtime, grounding, peers, pendingPeers, external } = value;
  if (!isObject(runtime) || runtime.source !== "nsdeploy" || typeof runtime.commit !== "string" || !isObject(runtime.files)) {
    return "the lock's runtime section is malformed";
  }
  if (!Object.values(runtime.files).every(isHex)) return "the lock's runtime file hashes are malformed";
  if (runtime.via !== undefined && !isRuntimeVia(runtime.via)) return "the lock's runtime source (via) is malformed";
  if (!isObject(grounding) || !Array.isArray(grounding.sources) || typeof grounding.builtAt !== "string") {
    return "the lock's grounding section is malformed";
  }
  if (
    !grounding.sources.every(
      (s) => isObject(s) && typeof s.ref === "string" && isHex(s.sha256) && (s.anchors === undefined || (Array.isArray(s.anchors) && s.anchors.every(isHex))),
    )
  ) {
    return "the lock's grounding sources are malformed";
  }
  if (!isObject(peers)) return "the lock's peers section is malformed";
  for (const p of Object.values(peers)) {
    if (
      !isObject(p) ||
      !isHex(p.sha256) ||
      typeof p.checkedAt !== "string" ||
      (p.kid !== undefined && (typeof p.kid !== "string" || !KID_PATTERN.test(p.kid))) ||
      (p.links !== undefined && !isHex(p.links) && p.links !== PEER_LINKS_ABSENT) ||
      (p.outline !== undefined && !isPeerOutline(p.outline))
    ) {
      return "the lock's peer entries are malformed";
    }
  }
  if (external !== undefined && !(isObject(external) && Object.values(external).every(isExternalRecord))) {
    return "the lock's external entries are malformed";
  }
  if (pendingPeers !== undefined) {
    if (!isObject(pendingPeers) || !Object.values(pendingPeers).every((p) => isObject(p) && typeof p.since === "string")) {
      return "the lock's pending peers are malformed";
    }
  }
  return null;
}

// ---- what a read means ----

/**
 * One thing a driver tried to read and hash: its SHA-256 (and its bytes, for a re-read of a grounding page's anchors;
 * never serialised), or a sentence completing "it ..." saying why not.
 */
export type Observed = { ok: true; sha256: string; bytes?: Uint8Array } | { ok: false; missing: boolean; sentence: string };

/**
 * What a changed page still states of the facts the lock watches on it (its anchors: facts the network stated that the
 * page stated too when the lock was written; anchors.ts): how many of its `total` anchors are on it now and, when the
 * networks could be read now, how many of the ones gone the networks still state (`stillStated`, with their kinds in
 * words, "1 price"); or the sentence ("it ...") for why it could not be reduced to text.
 */
export type AnchorCheck = { total: number; present: number; stillStated?: { count: number; kinds: string } } | { total: number; problem: string };

/** What a changed grounding source is: a network definition, another agent file (manifest, links.json), or a page. */
export type SourceRole = "network" | "agent" | "page";

/** The remedy once a change has been reviewed. */
const RELOCK = "review the change, then re-lock (watch --relock)";

/**
 * The finding for one grounding source. The severity is `warn` whatever the anchors say: a count is a reading aid, never
 * a reason to soften or harden it. Each changed-page sentence says which of three things the facts show (UAT-1): a fact
 * the network still states is gone from the page (the stale fact); none of the watched facts changed; or the network no
 * longer states the gone fact either (both sides changed: re-lock).
 */
export function groundingFinding(source: { ref: string; sha256: string }, seen: Observed, anchors?: AnchorCheck, role?: SourceRole): DriftFinding | null {
  if (!seen.ok) {
    return { kind: "grounding", severity: "warn", ref: source.ref, expected: source.sha256, summary: `A grounding source could not be checked: it ${seen.sentence}.` };
  }
  if (seen.sha256 === source.sha256) return null;
  const changed = "A grounding source changed since the lock was written";
  const facts = (n: number) => `${n} fact${n === 1 ? "" : "s"}`;
  let summary: string;
  if (anchors === undefined || anchors.total === 0) {
    summary =
      role === "page"
        ? `${changed}; the lock watches no fact the network states on it, so whether the network now states an old fact is not checked: ${RELOCK}.`
        : role === undefined
          ? `${changed}; the agent now answers from different facts.`
          : `${changed}; the agent now answers from different facts: ${RELOCK}.`;
  } else if ("problem" in anchors) {
    summary = `${changed}; its ${facts(anchors.total)} the network states could not be checked: it ${anchors.problem}.`;
  } else if (anchors.present === anchors.total) {
    summary =
      anchors.total === 1
        ? `${changed}; the 1 fact the lock watches on it (a fact the network states) is still on it, so what changed is something the lock does not watch.`
        : `${changed}; all ${facts(anchors.total)} the lock watches on it (facts the network states) are still on it, so what changed is something the lock does not watch.`;
  } else {
    const gone = anchors.total - anchors.present;
    const them = gone === 1 ? "it" : "them";
    const head = `${changed}; ${gone} of ${facts(anchors.total)} the lock watches on it (facts the network states) ${gone === 1 ? "is" : "are"} no longer on it`;
    const still = anchors.stillStated;
    summary =
      still === undefined
        ? `${head}, so the network may now state an old fact.`
        : still.count === 0
          ? `${head}, and the network no longer states ${them} either, so no stale fact is left: ${RELOCK}.`
          : still.count === gone
            ? `${head}, and the network still states ${them} (${still.kinds}), so the agent may now answer with an old fact.`
            : `${head}; the network still states ${still.count} of them (${still.kinds}), so the agent may now answer with an old fact.`;
  }
  return { kind: "grounding", severity: "warn", ref: source.ref, expected: source.sha256, actual: seen.sha256, summary };
}

export function runtimeFinding(file: string, expected: string, seen: Observed): DriftFinding | null {
  if (!seen.ok) {
    return {
      kind: "runtime",
      severity: "block",
      ref: file,
      expected,
      summary: seen.missing
        ? "A vendored runtime file is missing where the lock says (removed, or the lock was written from another folder); the runtime is copy-do-not-change."
        : `A vendored runtime file could not be checked: it ${seen.sentence}.`,
    };
  }
  if (seen.sha256 === expected) return null;
  return {
    kind: "runtime",
    severity: "block",
    ref: file,
    expected,
    actual: seen.sha256,
    summary: "A vendored runtime file differs from the locked copy; the runtime is copy-do-not-change.",
  };
}

/**
 * The vendored runtime folder a lock covers: the deepest folder that holds every `runtime.files` key (`runtime`, or
 * `site/runtime`), or null when there are no files or one sits at the root (the root is never listed as a runtime
 * folder). The CLI's watch lists it for files the lock does not hold (addedRuntimeFinding); the Desk cannot list a
 * folder, so this stays the CLI's.
 */
export function runtimeFolder(files: Record<string, string>): string | null {
  const dirs = Object.keys(files).map((f) => f.split("/").slice(0, -1));
  if (dirs.length === 0) return null;
  let common = dirs[0] ?? [];
  for (const d of dirs) {
    let n = 0;
    while (n < common.length && n < d.length && common[n] === d[n]) n += 1;
    common = common.slice(0, n);
  }
  return common.length === 0 ? null : common.join("/");
}

/** A file in the runtime folder that the lock does not hold: added after the lock was written. */
export function addedRuntimeFinding(file: string, seen: Observed): DriftFinding {
  return {
    kind: "runtime",
    severity: "block",
    ref: file,
    ...(seen.ok ? { actual: seen.sha256 } : {}),
    summary: "A file was added to the vendored runtime folder after the lock was written; the runtime is copy-do-not-change. Remove it, or review it and run watch --relock to accept it.",
  };
}

/** What a peer's plumbline.signature.json says about its signer: a kid in its exact pattern, nothing, or a problem. */
export type SignatureRead = { kid: string } | { none: true } | { problem: string };

/**
 * The one rule for when a peer's signer kid counts, for init and for every watch (CLI and Desk). A kid outside its
 * exact pattern is treated as none: a stranger's string never reaches the lock or a finding.
 *
 * :param answer: the HTTP status and body text of `<base>plumbline.signature.json`, or `{ error }` with a sentence
 *   when the request failed.
 */
export function readSignatureKid(answer: { status: number; text: string } | { error: string }): SignatureRead {
  if ("error" in answer) return { problem: `its signature could not be fetched (${answer.error})` };
  if (answer.status === 404 || answer.status === 410) return { none: true };
  if (answer.status < 200 || answer.status > 299) return { problem: `its signature request answered HTTP ${answer.status}` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer.text);
  } catch {
    return { problem: `its ${SIGNATURE_FILE} is not valid JSON` };
  }
  const kid = isObject(parsed) ? parsed.kid : undefined;
  if (typeof kid === "string" && KID_PATTERN.test(kid)) return { kid };
  return { problem: `its ${SIGNATURE_FILE} has no valid kid` };
}

/** The state of a peer's links.json: its hash or PEER_LINKS_ABSENT, or a sentence completing "it ..." saying why not. */
export type LinksRead = { state: string } | { problem: string };

/** What a driver saw of one locked peer. */
export interface PeerObservation {
  /**
   * The network definition: hashed; unreachable, with an HTTP status or a sentence for the parentheses; or `refused`,
   * when the network file the peer's manifest names is an address the driver will not contact (the Desk: a sentence
   * from destinationProblem, which never quotes it).
   */
  definition:
    | { ok: true; sha256: string; outline?: PeerOutline | null }
    | {
        ok: false;
        status?: number;
        reason?: string;
        refused?: string;
        /**
         * The peer's own address is one Plumbline does not contact (not https, a private or loopback address, not a
         * URL), as peerAddressProblem words it ("it is not an https address"): the CLI's safeFetch refused it. Read
         * as the Desk's refusal is, so one situation has one sentence on every surface (UAT-3, REC-2).
         */
        addressProblem?: string;
      };
  /** Read only when the lock records `links`. */
  links?: LinksRead;
  signature: SignatureRead;
  /** Read only when the peer is signed by another key than the locked one (UAT-4). */
  rotation?: PeerRotation;
}

/** What a peer signed by another key than the locked one publishes about it: see observe.ts readPeerRotation. */
export interface PeerRotation {
  /** Its plumbline-rotation.json holds a statement from the kid the lock recorded. */
  fromLocked: boolean;
  /** With `--trust`: the chain verifies from a key the trust file holds for the peer's origin, to the new kid. */
  verified?: boolean;
}

/**
 * How a signer change reads (UAT-4): a rotation verified against the caller's trust file, a rotation statement that is
 * published but not verified here (or does not verify), or a different key with no rotation published. Each is still
 * `block`: a relock refuses it until a person names the peer with --accept-signer.
 */
export function signerChangeWords(rotation: PeerRotation | undefined): string {
  if (rotation?.verified === true) return "it rotated from the key the lock recorded, verified against your trust file";
  if (rotation?.fromLocked === true) {
    return rotation.verified === false
      ? "a rotation statement from the locked key is published, and it does not verify against your trust file"
      : "a rotation statement from the locked key is published (not verified here)";
  }
  return "a different key, with no rotation published";
}

export function peerFindings(url: string, record: PeerRecord, seen: PeerObservation): DriftFinding[] {
  const def = seen.definition;
  if (!def.ok && def.refused !== undefined) {
    return [{ kind: "peer", severity: "warn", ref: url, summary: `A peer's network file was not contacted: ${def.refused}, which a peer's manifest may not point a browser at.` }];
  }
  if (!def.ok && def.addressProblem !== undefined) return [refusedPeerFinding(url, def.addressProblem)];
  if (!def.ok) {
    return [
      {
        kind: "peer",
        severity: "warn",
        ref: url,
        summary:
          def.status !== undefined
            ? `A peer's network definition answered HTTP ${def.status}, so it was not checked.`
            : `A peer could not be reached (${def.reason ?? "it could not be read"}), so it was not checked.`,
      },
    ];
  }
  const out: DriftFinding[] = [];
  if (def.sha256 !== record.sha256) {
    out.push({
      kind: "peer",
      severity: "block",
      ref: url,
      expected: record.sha256,
      actual: def.sha256,
      summary: `A peer's network definition changed since the lock was written; it runs in the visitor's browser, so a changed one is changed code. ${whatChanged(record.outline, def.outline)}`,
    });
  }
  // The peer's links.json: the runtime lays it over the peer network's links, so one that appears, changes or goes
  // away changes what the peer does. A lock written before links were tracked has no record: say so, never pass.
  if (record.links === undefined) {
    out.push({
      kind: "peer",
      severity: "warn",
      ref: url,
      summary: "The lock does not record this peer's links.json, so a links file it adds or changes is not seen; re-lock to track it.",
    });
  } else if (seen.links !== undefined) {
    if ("problem" in seen.links) {
      out.push({ kind: "peer", severity: "warn", ref: url, summary: `A peer's links.json could not be checked: it ${seen.links.problem}.` });
    } else if (seen.links.state !== record.links) {
      const appeared = record.links === PEER_LINKS_ABSENT;
      const gone = seen.links.state === PEER_LINKS_ABSENT;
      out.push({
        kind: "peer",
        severity: "block",
        ref: url,
        expected: record.links,
        actual: seen.links.state,
        summary: appeared
          ? "A peer now publishes a links.json it did not have when locked; the runtime lays it over the peer's links, so this is changed code."
          : gone
            ? "A peer's links.json is gone since the lock was written; the peer's links now resolve differently."
            : "A peer's links.json changed since the lock was written; the runtime lays it over the peer's links, so this is changed code.",
      });
    }
  }
  // The peer's signer. Only the kid is compared; verifying the signature needs a trust store (src/core's job).
  const sig = seen.signature;
  const kid = "kid" in sig ? sig.kid : undefined;
  if (kid !== undefined && record.kid !== undefined && kid !== record.kid) {
    out.push({
      kind: "peer",
      severity: "block",
      ref: url,
      expected: record.kid,
      actual: kid,
      summary: `A peer is now signed by a different key than the one the lock recorded: ${signerChangeWords(seen.rotation)}. A relock refuses it until a person decides: watch --relock --accept-signer <this peer>.`,
    });
  } else if (kid !== undefined && record.kid === undefined) {
    out.push({ kind: "peer", severity: "info", ref: url, actual: kid, summary: "A peer that was unsigned when locked now publishes a signature; re-lock to record its key." });
  } else if (kid === undefined && record.kid !== undefined) {
    const problem = "problem" in sig ? sig.problem : undefined;
    out.push({
      kind: "peer",
      severity: "warn",
      ref: url,
      expected: record.kid,
      summary: `A peer that was signed when locked no longer shows a usable signature${problem ? ` (${problem})` : " (none is published)"}.`,
    });
  }
  return out;
}

/**
 * What changed in a peer's definition, in counts and fixed words (outline.ts): never a name, an instruction or an
 * address. The severity is the caller's and stays `block` whatever this says: changed bytes are changed code.
 */
export function whatChanged(locked: PeerOutline | undefined, now: PeerOutline | null | undefined): string {
  if (locked === undefined) return "The lock holds no outline of this peer, so what changed is not told; after a review, re-lock to record one.";
  if (now === undefined || now === null) {
    return "Its definition now cannot be outlined (it is not JSON, or it repeats a key the runtime would merge), so what changed is not told.";
  }
  const diff = diffOutlines(locked, now);
  if (outlineUnchanged(diff)) return "Formatting or non-agent content only: no agent, outbound host or front agent changed.";
  return `In outline: ${describeOutlineDiff(diff)}.`;
}

/**
 * What a watch saw of a pending peer today: it answers (a relock would capture it), it still cannot be read (why), or
 * its address is one Plumbline does not contact. Undefined when it was not asked.
 */
export type PendingObservation = { answers: true } | { answers: false; why: string } | { notContacted: string };

/** What a watch saw of a pending peer today, from an observation of it (observe.ts observePeer). */
export function pendingObservation(seen: PeerObservation): PendingObservation {
  const def = seen.definition;
  if (def.ok) return seen.links !== undefined && "problem" in seen.links ? { answers: false, why: `its links.json ${seen.links.problem}` } : { answers: true };
  if (def.addressProblem !== undefined) return { notContacted: def.addressProblem };
  if (def.refused !== undefined) return { notContacted: `its network file ${def.refused.replace(/^it /, "")}` };
  return { answers: false, why: def.status !== undefined ? `it answered HTTP ${def.status}` : (def.reason ?? "it could not be read") };
}

/**
 * A peer the lock holds as pending: it could not be captured, so it is not watched until a re-lock fills it in. With
 * what this watch saw of it today, the sentence says why it is still pending (UAT-3, TOM-L2-05): it answers now (so
 * re-lock), it still cannot be read (the cause), or its address is not contacted (the address rule's words).
 */
export function pendingPeerFindings(lock: Lock, today: Record<string, PendingObservation> = {}): DriftFinding[] {
  return Object.entries(lock.pendingPeers ?? {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([url, pending]): DriftFinding => {
      // only a date is quoted, and only one in its exact form: a lock can come from a stranger (the Desk)
      const since = /^\d{4}-\d{2}-\d{2}/.test(pending.since) ? ` (pending since ${pending.since.slice(0, 10)})` : "";
      const now = Object.hasOwn(today, url) ? today[url] : undefined;
      const tail =
        now === undefined
          ? "run watch --relock once it answers"
          : "notContacted" in now
            ? `it was not contacted now either: ${now.notContacted}, an address Plumbline does not contact`
            : now.answers
              ? "it answers now: review it, then run watch --relock to capture it"
              : `it still cannot be read (${now.why}); run watch --relock once it answers`;
      return { kind: "peer", severity: "warn", ref: url, summary: `A peer could not be captured when the lock was written${since}, so it is not watched; ${tail}.` };
    });
}

/**
 * What the site names now that the lock does not cover: a grounding file `watch --init` would lock (the root's agent
 * files and every network file the manifest names) that is not in `grounding.sources`, and a peer a network or
 * links.json names that is neither in `peers` nor pending. Without this a clean watch hides a new partner.
 */
export function coverageFindings(lock: Lock, named: { refs: string[]; peers: string[] }): DriftFinding[] {
  const locked = new Set(lock.grounding.sources.map((s) => s.ref));
  const peers = new Set([...Object.keys(lock.peers), ...Object.keys(lock.pendingPeers ?? {})]);
  const out: DriftFinding[] = [];
  for (const ref of [...new Set(named.refs)].sort()) {
    if (locked.has(ref)) continue;
    out.push({ kind: "grounding", severity: "warn", ref, summary: "A file the site names is not in the lock, so a change to it is not seen; review it and run watch --relock." });
  }
  for (const url of [...new Set(named.peers)].sort()) {
    if (peers.has(url)) continue;
    out.push({ kind: "peer", severity: "warn", ref: url, summary: "A network names a peer the lock does not cover, so its code is not watched; review it and run watch --relock." });
  }
  return out;
}

/** Days before the site's own signature expires that the watch starts to warn. */
export const SIGNATURE_WARN_DAYS = 14;

/**
 * The site's own plumbline.signature.json, read for its expiry: `block` once expired (a verifier answers `invalid
 * expired`), `warn` within SIGNATURE_WARN_DAYS, nothing before that. No signature file is no finding: signing is the
 * publisher's choice. A file that is there and carries no readable `expiresAt` is a `warn`.
 *
 * :param text: the file's text, or undefined when there is none.
 */
export function signatureExpiryFinding(text: string | undefined, now: Date): DriftFinding | null {
  if (text === undefined) return null;
  let expiresAt: unknown;
  try {
    const parsed: unknown = JSON.parse(text.replace(/^﻿/, ""));
    expiresAt = isObject(parsed) ? parsed.expiresAt : undefined;
  } catch {
    expiresAt = undefined;
  }
  const ms = typeof expiresAt === "string" ? Date.parse(expiresAt) : Number.NaN;
  if (!Number.isFinite(ms)) {
    return { kind: "grounding", severity: "warn", ref: SIGNATURE_FILE, summary: "The site's signature file has no readable expiry, so the watch cannot say when it lapses." };
  }
  const when = new Date(ms).toISOString();
  if (ms <= now.getTime()) {
    return {
      kind: "grounding",
      severity: "block",
      ref: SIGNATURE_FILE,
      actual: when.slice(0, 10),
      summary: `The site's signature expired on ${when.slice(0, 10)}; verifiers now answer invalid (expired) until the site is signed again.`,
    };
  }
  const days = Math.ceil((ms - now.getTime()) / 86_400_000);
  if (days > SIGNATURE_WARN_DAYS) return null;
  return {
    kind: "grounding",
    severity: "warn",
    ref: SIGNATURE_FILE,
    actual: when.slice(0, 10),
    summary: `The site's signature expires on ${when.slice(0, 10)}, in ${days} day${days === 1 ? "" : "s"}; sign the site again before then.`,
  };
}

/**
 * Whether the site's own plumbline.signature.json still covers its files: each subject's SHA-256 against the hash of
 * the file at that path now (exact bytes, as `sign` hashed them). No trust store is needed: the signature's own subject
 * list is compared with the files, not verified (that is `verify`). A file that differs or is gone means every verifier
 * answers invalid (tampered): `block`, as an expired signature is (UAT-2, MAR-L2-03). Null when every subject matches,
 * or when there is no signature file or no subject list to compare (the expiry check reports an unreadable file).
 *
 * :param subjects: the signature's `subjects` as parsed (anything; only well-formed entries are compared).
 * :param read: the hash of the file at a subject path now, or null when it is missing or cannot be read.
 */
export async function signatureCoverageFinding(subjects: unknown, read: (path: string) => Promise<string | null>): Promise<DriftFinding | null> {
  if (!Array.isArray(subjects)) return null;
  const entries = subjects.filter((s): s is { path: string; sha256: string } => isObject(s) && typeof s.path === "string" && SUBJECT_PATH_PATTERN.test(s.path) && isSafePath(s.path) && isHex(s.sha256));
  if (entries.length === 0) return null;
  const differ: string[] = [];
  for (const s of entries) if ((await read(s.path)) !== s.sha256) differ.push(s.path);
  if (differ.length === 0) return null;
  const named = differ.length <= 3 ? differ.join(", ") : `${differ.slice(0, 3).join(", ")} and ${differ.length - 3} more`;
  return {
    kind: "grounding",
    severity: "block",
    ref: SIGNATURE_FILE,
    summary: `The site's signature no longer covers its files: ${differ.length} of ${entries.length} signed file${entries.length === 1 ? "" : "s"} ${differ.length === 1 ? "differs" : "differ"} from the signed version or ${differ.length === 1 ? "is" : "are"} missing (${named}), so verifiers now answer invalid (tampered) until the site is signed again (plumbline sign).`,
  };
}

// ---- a lock written by a stranger (the Desk) ----

/**
 * The host part of the rule, for a parsed https address: a public host name, never `localhost`, a single-label
 * intranet name, an IPv6 literal, or an IPv4 literal in any range safeFetch refuses (net/address.ts: one table).
 */
function hostProblem(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (host.startsWith("[")) return "it is an IP literal, not a public host name";
  if (host === "localhost" || host.endsWith(".localhost") || !host.includes(".")) return "it is not a public host name";
  if (parseIPv4(host) !== null && isBlockedAddress(host)) return "it is a private or loopback address";
  return null;
}

function parsed(address: string): URL | string {
  try {
    return new URL(address);
  } catch {
    return "it is not a valid URL";
  }
}

/**
 * Why an address taken from a document someone else published (a lock's https grounding ref, the network file a
 * peer's manifest names) is not fetched by the Desk, or null when it may be: https, no credentials, and a public host
 * (hostProblem). The sentence never quotes the address. peerAddressProblem adds the rule for a lock's peer keys.
 */
export function destinationProblem(address: string): string | null {
  const url = parsed(address);
  if (typeof url === "string") return url;
  if (url.protocol !== "https:") return "it is not an https address";
  if (url.username || url.password) return "it carries credentials";
  return hostProblem(url);
}

/**
 * Why a peer address taken from a lock someone else published is not fetched, or null when it may be. The keys of a
 * fetched lock's `peers` are destinations a stranger chose, so they are held to more than the page's fetcher allows:
 * destinationProblem's rule, and no query or fragment. The sentence never quotes the address.
 */
export function peerAddressProblem(address: string): string | null {
  const url = parsed(address);
  if (typeof url === "string") return url;
  if (url.protocol !== "https:") return "it is not an https address";
  if (url.username || url.password) return "it carries credentials";
  if (url.search || url.hash) return "it carries a query or a fragment";
  return hostProblem(url);
}

/** The finding for a lock peer that is not contacted by the address rule: the Desk's check, or safeFetch's refusal in the CLI. */
export function refusedPeerFinding(url: string, problem: string): DriftFinding {
  return { kind: "peer", severity: "warn", ref: url, summary: `A peer in this lock was not contacted: ${problem}, an address Plumbline does not contact, so it was not checked.` };
}

// ---- re-lock: what changed between two locks ----

export interface LockChanges {
  added: string[];
  removed: string[];
  changed: string[];
}

/**
 * The refs that differ between the lock a person reviewed and the one `--relock` writes, each labelled with its part
 * (`grounding <ref>`, `runtime <file>`, `peer <url>`, `pending <url>`, `runtime commit`, `runtime via`). Sorted.
 */
export function lockChanges(before: Lock | undefined, after: Lock): LockChanges {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  const compare = (label: string, a: Record<string, string>, b: Record<string, string>) => {
    for (const [k, v] of Object.entries(b)) {
      if (!(k in a)) added.push(`${label} ${k}`);
      else if (a[k] !== v) changed.push(`${label} ${k}`);
    }
    for (const k of Object.keys(a)) if (!(k in b)) removed.push(`${label} ${k}`);
  };
  const ground = (l: Lock | undefined) => Object.fromEntries((l?.grounding.sources ?? []).map((s) => [s.ref, s.sha256]));
  const peer = (l: Lock | undefined) =>
    Object.fromEntries(Object.entries(l?.peers ?? {}).map(([u, p]) => [u, `${p.sha256} ${p.links ?? ""} ${p.kid ?? ""}`]));
  compare("grounding", ground(before), ground(after));
  compare("runtime", before?.runtime.files ?? {}, after.runtime.files);
  compare("peer", peer(before), peer(after));
  const ext = (l: Lock | undefined) => Object.fromEntries(Object.entries(l?.external ?? {}).map(([u, e]) => [u, `${e.kind} ${e.sha256}`]));
  compare("external", ext(before), ext(after));
  compare("pending", Object.fromEntries(Object.keys(before?.pendingPeers ?? {}).map((u) => [u, ""])), Object.fromEntries(Object.keys(after.pendingPeers ?? {}).map((u) => [u, ""])));
  if (before !== undefined && before.runtime.commit !== after.runtime.commit) changed.push("runtime commit");
  const via = (l: Lock | undefined) => (l?.runtime.via ? `${l.runtime.via.repo} ${l.runtime.via.path} ${l.runtime.via.commit}` : "");
  if (via(before) !== via(after)) {
    if (via(before) === "") added.push("runtime via");
    else if (via(after) === "") removed.push("runtime via");
    else changed.push("runtime via");
  }
  return { added: added.sort(), removed: removed.sort(), changed: changed.sort() };
}

/** The reminder `--relock` prints: the lock is a signed file. */
export const RESIGN_REMINDER = `${LOCK_FILE} is a signed file: sign the site again (plumbline sign) and commit both, or its signature reads invalid (tampered).`;
