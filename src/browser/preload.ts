// A peer checked before its definition runs: the signature verdict at the peer's site (three states, against the
// caller's trust entries) and, when the caller's lock holds the peer, whether its definition and links.json still match
// the pins. Pure and fetcher-injected: no node:* import, so the Desk runs it in the browser (scripts/build-site.mjs copies
// it to site/lib/plumbline/browser/) and a runtime's preload hook could call it (docs/proposals/runtime-preload-hook.md).
//
// It reads, as exact bytes and in this order: the peer's network file (located through the peer's manifest, as the
// watch does), its plumbline-revocation.json (applied to the caller's entries in memory only), its
// plumbline.signature.json, every file the signature lists, links.json and plumbline.lock.json, and its key record. A
// file it could not read (an error, not a 404) is never read as absent: a `verified` result is withdrawn to
// `unverifiable`, and so is a `tampered` one that could rest on the unread file, the rule `verify --url` follows.
//
// What it decides: nothing. `refuse` says what a caller that enforces would do (an `invalid` signature, or a definition
// that differs from the caller's lock); an unsigned or unknown peer is `unverifiable`, which is not a reason to refuse.

import { LINKS_FILE, LOCK_FILE, KEY_FILE, MAX_SUBJECTS, REVOCATION_FILE, SIGNATURE_FILE, type DriftFinding, type PlumblineKey, type PlumblineLock, type PlumblineSignature, type SubjectFile, type TrustEntry, type VerifyResult } from "../core/types.js";
import { applyRevocationText } from "../core/revoke.js";
import { isSafeSubjectPath } from "../core/signed-paths.js";
import { subjectDigest } from "../core/sign.js";
import { verifySignature } from "../core/verify.js";
import type { SafeFetchOptions } from "../net/fetch-types.js";
import { locatePeerFile, type Fetcher } from "../net/locate.js";
import { destinationProblem, peerAddressProblem, peerFindings } from "../watch/decide.js";
import { describeWatchError, observePeer, type Describe } from "../watch/observe.js";

/** What the caller's lock says about the peer now. */
export const PRELOAD_LOCK_STATES = ["matches", "differs", "unread", "not-locked"] as const;
export type PreloadLockState = (typeof PRELOAD_LOCK_STATES)[number];

export interface PreloadCheck {
  peer: string;
  /** The peer's signature against the caller's trust entries: verified, invalid (with a reason) or unverifiable. */
  signature: VerifyResult;
  /** True when the peer publishes a signature file at all. */
  signed: boolean;
  lock: PreloadLockState;
  /** The lock comparison's findings (decide.ts peerFindings), when the lock holds the peer. */
  lockFindings?: DriftFinding[];
  /** What a caller that enforces would do: an `invalid` signature, or a definition that differs from the lock. */
  refuse: boolean;
  /** Set when the address itself is refused before anything is fetched (decide.ts peerAddressProblem). */
  refused?: string;
}

export interface PreloadOptions {
  /** The caller's trust entries (a revocation the peer publishes is applied to a copy, never written back). */
  trust: TrustEntry[];
  fetcher: Fetcher;
  /** The caller's own lock, when it has one: a peer it pins is compared with the pin. */
  lock?: PlumblineLock;
  now?: Date;
  fetchOptions?: SafeFetchOptions;
  /** The sentence for a fetch error (default: the watch's). */
  why?: Describe;
}

type Read = { state: "present"; bytes: Uint8Array } | { state: "absent" } | { state: "unknown"; why: string };

async function read(fetcher: Fetcher, url: string, options: SafeFetchOptions, why: Describe): Promise<Read> {
  try {
    const response = await fetcher(url, options);
    if (response.ok) return { state: "present", bytes: response.bytes };
    if (response.status === 404 || response.status === 410) return { state: "absent" };
    return { state: "unknown", why: `HTTP ${response.status}` };
  } catch (error) {
    return { state: "unknown", why: why(error) };
  }
}

const decode = (bytes: Uint8Array): string => new TextDecoder("utf-8").decode(bytes);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The peer's signature at its site base, by the rules of `verify --url`, against the caller's entries. */
async function signatureAt(base: string, options: PreloadOptions, why: Describe): Promise<{ signature: VerifyResult; signed: boolean }> {
  const fetchOptions = options.fetchOptions ?? {};
  const unread: string[] = [];
  let entries = options.trust;
  const revocation = await read(options.fetcher, `${base}${REVOCATION_FILE}`, fetchOptions, why);
  if (revocation.state === "present") entries = (await applyRevocationText(decode(revocation.bytes), entries)).entries;
  else if (revocation.state === "unknown") unread.push(REVOCATION_FILE);

  const sig = await read(options.fetcher, `${base}${SIGNATURE_FILE}`, fetchOptions, why);
  if (sig.state === "absent") return { signed: false, signature: { verdict: "unverifiable", detail: "The peer publishes no signature, so who published its definition cannot be told." } };
  if (sig.state === "unknown") return { signed: false, signature: { verdict: "unverifiable", detail: `The peer's signature could not be read (${sig.why}).` } };
  let signature: unknown;
  try {
    signature = JSON.parse(decode(sig.bytes));
  } catch {
    return { signed: true, signature: { verdict: "invalid", reason: "malformed", detail: "The peer's signature file is not valid JSON." } };
  }

  const files: SubjectFile[] = [];
  let unreadSubjects = 0;
  const subjects = isRecord(signature) ? signature.subjects : undefined;
  if (Array.isArray(subjects) && subjects.length <= MAX_SUBJECTS) {
    for (const subject of subjects) {
      const rel = isRecord(subject) ? subject.path : undefined;
      if (typeof rel !== "string" || !isSafeSubjectPath(rel) || files.some((f) => f.path === rel)) continue;
      const r = await read(options.fetcher, `${base}${rel}`, { ...fetchOptions, ceiling: "runtime" }, why);
      if (r.state === "present") files.push({ path: rel, content: r.bytes });
      else if (r.state === "unknown") unreadSubjects += 1;
    }
  }
  for (const rel of [LINKS_FILE, LOCK_FILE]) {
    if (files.some((f) => f.path === rel)) continue;
    const r = await read(options.fetcher, `${base}${rel}`, fetchOptions, why);
    if (r.state === "present") files.push({ path: rel, content: r.bytes });
    else if (r.state === "unknown") unread.push(rel);
  }
  if (unreadSubjects > 0) unread.push(`${unreadSubjects} signed ${unreadSubjects === 1 ? "file" : "files"}`);
  let publishedKey: PlumblineKey | undefined;
  const key = await read(options.fetcher, `${base}${KEY_FILE}`, fetchOptions, why);
  if (key.state === "present") {
    try {
      const parsed: unknown = JSON.parse(decode(key.bytes));
      if (isRecord(parsed)) publishedKey = parsed as unknown as PlumblineKey;
    } catch {
      publishedKey = undefined;
    }
  }
  const store = { find: (kid: string, origin: string) => entries.find((e) => e.kid === kid && e.origin === origin) };
  let result = await verifySignature(signature as PlumblineSignature, files, store, {
    expectedOrigin: new URL(base).origin,
    ...(options.now ? { now: options.now } : {}),
    ...(publishedKey ? { publishedKey } : {}),
  });
  if (unread.length > 0 && (result.verdict === "verified" || result.reason === "tampered")) {
    // a file that was read and does not match its signed digest is tampering whatever else is unread
    let readMismatch = false;
    for (const s of (signature as PlumblineSignature).subjects ?? []) {
      const f = files.find((x) => x.path === s.path);
      if (f && (await subjectDigest(f.content)) !== s.sha256) readMismatch = true;
    }
    if (result.verdict === "verified" || !readMismatch) {
      result = {
        verdict: "unverifiable",
        ...(result.kid ? { kid: result.kid } : {}),
        ...(result.origin ? { origin: result.origin } : {}),
        detail: `The peer did not serve ${unread.join(", ")} (an error, not a 404), so whether its signature covers everything the runtime loads cannot be told.`,
      };
    }
  }
  return { signed: true, signature: result };
}

/**
 * Checks a peer before its network is loaded.
 *
 * :param peerUrl: the peer's network address, as a network or links.json names it.
 * :return: the signature verdict, the lock comparison and what an enforcing caller would do. Never throws.
 */
export async function checkPeerBeforeLoad(peerUrl: string, options: PreloadOptions): Promise<PreloadCheck> {
  const why = options.why ?? describeWatchError;
  const addressProblem = peerAddressProblem(peerUrl);
  if (addressProblem !== null) {
    return {
      peer: peerUrl,
      signature: { verdict: "unverifiable", detail: `The peer was not contacted: ${addressProblem}.` },
      signed: false,
      lock: options.lock?.peers[peerUrl] !== undefined ? "unread" : "not-locked",
      refuse: false,
      refused: addressProblem,
    };
  }
  let base: string;
  try {
    base = (await locatePeerFile(peerUrl, options.fetcher, options.fetchOptions ?? {})).base;
  } catch {
    base = new URL("./", peerUrl).href;
  }
  const { signature, signed } = await signatureAt(base, options, why);

  let lock: PreloadLockState = "not-locked";
  let lockFindings: DriftFinding[] | undefined;
  const record = options.lock?.peers[peerUrl];
  if (record !== undefined) {
    const seen = await observePeer(peerUrl, options.fetcher, { fetchOptions: options.fetchOptions ?? {}, why, links: record.links !== undefined, guard: destinationProblem });
    lockFindings = peerFindings(peerUrl, record, seen);
    const linksUnread = seen.links !== undefined && "problem" in seen.links;
    lock = !seen.definition.ok || linksUnread ? "unread" : lockFindings.some((f) => f.severity === "block") ? "differs" : "matches";
  }
  return {
    peer: peerUrl,
    signature,
    signed,
    lock,
    ...(lockFindings !== undefined ? { lockFindings } : {}),
    refuse: signature.verdict === "invalid" || lock === "differs",
  };
}
