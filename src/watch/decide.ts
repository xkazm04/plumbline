// The watch's decisions with no I/O: the lock's shape rule, and what each thing a detector read means as a finding.
// No node:* import and no fetch, so it runs in Node (src/watch, the CLI's watch) and in the browser (site/drift.js, the
// Desk's drift reader, through scripts/build-site.mjs). Each driver keeps its own I/O rules (the CLI reads files under a
// root and fetches through safeFetch; the Desk reads what the site publishes through the page's fetcher) and hands
// the result here, so one severity policy serves both (docs/gate-and-watch.md):
//   grounding  changed or unreadable source: warn. A file the lock should cover and does not: warn.
//   runtime    changed or missing vendored file: block (copy-do-not-change).
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
  type DriftFinding,
  type DriftReport,
  type PeerRecord,
  type PlumblineLock,
  type RuntimeVia,
  type PendingPeer,
  type LockState,
} from "../core/types.js";

// ---- the lock and report members (the wire contract now lives in core/types.ts; these names stay for callers) ----

export { LOCK_STATES } from "../core/types.js";
export type { LockState, RuntimeVia, PendingPeer } from "../core/types.js";
export type LockRuntime = PlumblineLock["runtime"];
export type Lock = PlumblineLock;
export type WatchReport = DriftReport;

// ---- the lock's shape ----

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isHex = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
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
  const { runtime, grounding, peers, pendingPeers } = value;
  if (!isObject(runtime) || runtime.source !== "nsdeploy" || typeof runtime.commit !== "string" || !isObject(runtime.files)) {
    return "the lock's runtime section is malformed";
  }
  if (!Object.values(runtime.files).every(isHex)) return "the lock's runtime file hashes are malformed";
  if (runtime.via !== undefined && !isRuntimeVia(runtime.via)) return "the lock's runtime source (via) is malformed";
  if (!isObject(grounding) || !Array.isArray(grounding.sources) || typeof grounding.builtAt !== "string") {
    return "the lock's grounding section is malformed";
  }
  if (!grounding.sources.every((s) => isObject(s) && typeof s.ref === "string" && isHex(s.sha256))) {
    return "the lock's grounding sources are malformed";
  }
  if (!isObject(peers)) return "the lock's peers section is malformed";
  for (const p of Object.values(peers)) {
    if (
      !isObject(p) ||
      !isHex(p.sha256) ||
      typeof p.checkedAt !== "string" ||
      (p.kid !== undefined && (typeof p.kid !== "string" || !KID_PATTERN.test(p.kid))) ||
      (p.links !== undefined && !isHex(p.links) && p.links !== PEER_LINKS_ABSENT)
    ) {
      return "the lock's peer entries are malformed";
    }
  }
  if (pendingPeers !== undefined) {
    if (!isObject(pendingPeers) || !Object.values(pendingPeers).every((p) => isObject(p) && typeof p.since === "string")) {
      return "the lock's pending peers are malformed";
    }
  }
  return null;
}

// ---- what a read means ----

/** One thing a driver tried to read and hash: its SHA-256, or a sentence completing "it ..." saying why not. */
export type Observed = { ok: true; sha256: string } | { ok: false; missing: boolean; sentence: string };

export function groundingFinding(source: { ref: string; sha256: string }, seen: Observed): DriftFinding | null {
  if (!seen.ok) {
    return { kind: "grounding", severity: "warn", ref: source.ref, expected: source.sha256, summary: `A grounding source could not be checked: it ${seen.sentence}.` };
  }
  if (seen.sha256 === source.sha256) return null;
  return {
    kind: "grounding",
    severity: "warn",
    ref: source.ref,
    expected: source.sha256,
    actual: seen.sha256,
    summary: "A grounding source changed since the lock was written; the agent now answers from different facts.",
  };
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
  /** The network definition: hashed, or unreachable with a sentence for the parentheses. */
  definition: { ok: true; sha256: string } | { ok: false; status?: number; reason?: string };
  /** Read only when the lock records `links`. */
  links?: LinksRead;
  signature: SignatureRead;
}

export function peerFindings(url: string, record: PeerRecord, seen: PeerObservation): DriftFinding[] {
  const def = seen.definition;
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
      summary: "A peer's network definition changed since the lock was written; it runs in the visitor's browser, so a changed one is changed code.",
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
    out.push({ kind: "peer", severity: "block", ref: url, expected: record.kid, actual: kid, summary: "A peer is now signed by a different key than the one the lock recorded." });
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

/** A peer the lock holds as pending: it could not be captured, so it is not watched until a re-lock fills it in. */
export function pendingPeerFindings(lock: Lock): DriftFinding[] {
  return Object.entries(lock.pendingPeers ?? {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([url, pending]): DriftFinding => {
      // only a date is quoted, and only one in its exact form: a lock can come from a stranger (the Desk)
      const since = /^\d{4}-\d{2}-\d{2}/.test(pending.since) ? ` (pending since ${pending.since.slice(0, 10)})` : "";
      return {
        kind: "peer",
        severity: "warn",
        ref: url,
        summary: `A peer could not be captured when the lock was written${since}, so it is not watched; run watch --relock once it answers.`,
      };
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

// ---- a lock written by a stranger (the Desk) ----

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function publicIpv4(host: string): boolean {
  const m = IPV4.exec(host);
  if (!m) return true;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  return true;
}

/**
 * Why a peer address taken from a lock someone else published is not fetched, or null when it may be. The keys of a
 * fetched lock's `peers` are destinations a stranger chose, so they are held to more than the page's fetcher allows:
 * https, no credentials, query or fragment, and a public host name (no `localhost`, no single-label intranet name, no
 * private or loopback IPv4 literal, no IPv6 literal). The sentence never quotes the address.
 */
export function peerAddressProblem(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return "it is not a valid URL";
  }
  if (url.protocol !== "https:") return "it is not an https address";
  if (url.username || url.password) return "it carries credentials";
  if (url.search || url.hash) return "it carries a query or a fragment";
  const host = url.hostname.toLowerCase();
  if (host.startsWith("[")) return "it is an IP literal, not a public host name";
  if (host === "localhost" || host.endsWith(".localhost") || !host.includes(".")) return "it is not a public host name";
  if (!publicIpv4(host)) return "it is a private or loopback address";
  return null;
}

/** The finding for a lock peer the Desk refuses to contact. */
export function refusedPeerFinding(url: string, problem: string): DriftFinding {
  return { kind: "peer", severity: "warn", ref: url, summary: `A peer in this lock was not contacted: ${problem}, which a published lock may not point a browser at.` };
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
