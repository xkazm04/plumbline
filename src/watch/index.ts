// Watch: three drift detectors (grounding, runtime, peer) against plumbline.lock.json, plus what the lock does not cover
// and the site's own signature expiry. Dry-run by default: it reports. With `init` and no lock it writes the lock and
// nothing else; `runRelock` rewrites it after a person reviewed the drift. Opening, editing and closing the drift issue is
// the Action's job (action/action.yml with `issues: true`), never this library's.

import { LOCK_FILE, SIGNATURE_FILE, type DriftFinding, type TrustEntry } from "../core/types.js";
import { DEFAULT_TIMEOUT_MS, safeFetch } from "../net/safe-fetch.js";
import type { FactCoverage } from "./anchors.js";
import { captureLock } from "./capture.js";
import { lockChanges, signatureExpiryFinding, signerChangeWords, type Lock, type LockChanges, type LockState, type WatchReport } from "./decide.js";
import { readPeerRotation } from "./observe.js";
import { locatePeerFile } from "../net/locate.js";
import { detectCoverage, detectExternal, detectGrounding, detectPeers, detectRuntime, detectSignature, type DetectorEnv } from "./detectors.js";
import { readLock, replaceLock, writeLock, type LockRead, type WatchDeps } from "./lock.js";
import { describeWatchError } from "./observe.js";
import { readPublishedLock } from "./published.js";

export type { WatchDeps } from "./lock.js";
export type { LockChanges, LockState, WatchReport } from "./decide.js";

export interface WatchOptions {
  /** The site checkout the lock lives in. */
  root: string;
  /** Write plumbline.lock.json when there is none, instead of reporting it missing. */
  init?: boolean;
  timeoutMs?: number;
}

function envOf(options: WatchOptions, deps: WatchDeps): DetectorEnv {
  return {
    root: options.root,
    fetch: deps.fetch ?? safeFetch,
    fetchOptions: { timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS, ...(deps.fetchOptions ?? {}) },
    ...(deps.upstreamUrl !== undefined ? { upstreamUrl: deps.upstreamUrl } : {}),
    ...(deps.trust !== undefined ? { trust: deps.trust } : {}),
    now: (deps.now ?? (() => new Date()))(),
  };
}

/** The lock state a read stands for, and the sentence for one that could not be used. */
function stateOf(read: LockRead): { lockState: LockState; lockSummary?: string } {
  switch (read.kind) {
    case "ok":
      return { lockState: "found" };
    case "missing":
      return { lockState: "absent", lockSummary: `no lock: there is no ${LOCK_FILE} in the root, so no drift was checked; write one with watch --init.` };
    case "unreadable":
      return { lockState: "unreadable", lockSummary: `The lock cannot be read: ${read.why}, so no drift was checked.` };
    case "malformed":
      return { lockState: "unusable", lockSummary: `The lock cannot be used: ${read.why}, so no drift was checked.` };
  }
}

async function captureFirstLock(env: DetectorEnv, options: WatchOptions, deps: WatchDeps): Promise<InitReport> {
  const { lock, findings, coverage } = await captureLock(env, {
    now: env.now,
    ...(deps.externals !== undefined ? { externals: deps.externals } : {}),
    ...(deps.extraSources !== undefined ? { extraSources: deps.extraSources } : {}),
    ...(deps.runtimeDir !== undefined ? { runtimeDir: deps.runtimeDir } : {}),
  });
  await writeLock(options.root, lock);
  // every peer is first seen: its signer is said, so no first key is recorded without a line (TOM-RC-4)
  const firstSigners = Object.entries(lock.peers).flatMap(([peer, r]): FirstSigner[] =>
    r.kid === undefined ? [] : [{ peer, kid: r.kid, was: "added", backing: backingOf(env.trust, peer, r.kid) }],
  );
  return { findings, coverage, ...(firstSigners.length > 0 ? { firstSigners } : {}) };
}

/** What `init` and `watch --init` wrote: what could not be captured, what the lock watches, and the signers it records. */
export interface InitReport {
  findings: DriftFinding[];
  coverage: FactCoverage;
  firstSigners?: FirstSigner[];
}

/**
 * `init` and `watch --init`: write the first lock when there is none, and say what it watches (the facts the networks
 * state, per page given with --source: anchors.ts FactCoverage, for the publisher's own terminal). Null when a lock is
 * already there: it is never rewritten here.
 */
export async function runInit(options: WatchOptions, deps: WatchDeps = {}): Promise<InitReport | null> {
  const read = await readLock(options.root);
  if (read.kind !== "missing") return null;
  return captureFirstLock(envOf(options, deps), options, deps);
}

/**
 * Check the site against its lock. A lock that is absent, unreadable or unusable is a lock state with its own sentence
 * (`lockState`, `lockSummary`), not a drift finding: no drift was checked, which the CLI never reports as clean.
 */
export async function runWatch(options: WatchOptions, deps: WatchDeps = {}): Promise<WatchReport> {
  const env = envOf(options, deps);
  const read = await readLock(options.root);

  if (read.kind === "missing" && options.init === true) return { findings: (await captureFirstLock(env, options, deps)).findings };

  const signature = await detectSignature(env);
  if (read.kind !== "ok") return { ...stateOf(read), findings: signature };

  const [grounding, runtime, peer, external, coverage] = await Promise.all([
    detectGrounding(read.lock, env),
    detectRuntime(read.lock, env),
    detectPeers(read.lock, env),
    detectExternal(read.lock, env),
    detectCoverage(read.lock, env),
  ]);
  const findings: DriftFinding[] = [...grounding, ...runtime, ...peer, ...external, ...coverage, ...signature];
  return { lockState: "found", findings };
}

export interface RelockReport {
  /** What the lock held before: `found`, or why there was none to compare with. */
  previous: LockState;
  changes: LockChanges;
  /** What could not be captured (a peer held as pending, a source that is gone), as `--init` reports it. */
  findings: DriftFinding[];
  /** What the new lock watches: the facts the networks state, per page (anchors.ts). Its literals go to the terminal only. */
  coverage: FactCoverage;
  /** The signer changes a person accepted with --accept-signer (UAT-4), each with its backing. */
  signers?: SignerChange[];
  /**
   * The signers this lock records for a peer that had none recorded (TOM-RC-4): a peer the lock did not hold (first
   * seen, a relisted one included: the lock keeps no record of a peer it dropped), or one recorded unsigned before.
   */
  firstSigners?: FirstSigner[];
}

export type SignerBacking = "backed by your trust file" | "not backed by your trust file" | "not checked: no --trust file given";

/** A peer whose signer the relock would change, and what the peer publishes about it (UAT-4, TOM-RC-1). */
export interface SignerChange {
  peer: string;
  /** The kid the lock recorded, or (`formerKid`) the one it last recorded before the peer stopped signing. */
  from: string;
  /** The kid it is signed by now; omitted when it publishes no signature now (404 or 410). */
  to?: string;
  /** decide.ts signerChangeWords (verified rotation, published rotation, or a different key with none), or NO_SIGNATURE_NOW. */
  how: string;
  /** For an accepted one with a new kid: what the --trust file says of it. */
  backing?: SignerBacking;
}

/** A signer recorded for a peer the lock held no signer for (TOM-RC-4), and why it had none. */
export interface FirstSigner {
  peer: string;
  kid: string;
  /** `added`: the lock did not hold the peer (first seen, or relisted); `unsigned`: the lock recorded it unsigned. */
  was: "added" | "unsigned";
  backing: SignerBacking;
}

/** How a change to no signature reads, in a refusal and in the change list. */
export const NO_SIGNATURE_NOW = "it publishes no signature now";

/**
 * A relock that wrote nothing (UAT-4): `signer`, a peer's signer changed and no --accept-signer names it (exit 1, each
 * peer named, and the command a person runs after deciding); `drop-peer`, --drop named a peer, which --drop does not
 * take (a peer leaves the lock when no network names it).
 */
export type RelockRefusal = { refused: "signer"; peers: SignerChange[] } | { refused: "drop-peer"; refs: string[] };

/** Thrown by runRelock when it refuses: nothing was written. */
export class RelockRefused extends Error {
  readonly refusal: RelockRefusal;
  constructor(refusal: RelockRefusal) {
    super(refusal.refused === "signer" ? "a peer signer changed and no --accept-signer names it" : "--drop named a peer");
    this.name = "RelockRefused";
    this.refusal = refusal;
  }
}

/**
 * `watch --relock`: after a person reviewed the drift, rewrite plumbline.lock.json from the current state and say what
 * changed. Every grounding ref the previous lock held is captured again (with the extra sources), so a `--source` given
 * at init is not dropped; one that is gone now is a finding and leaves the lock. A ref in `deps.dropSources`
 * (`--drop`) is left out, and the change list shows it removed. The lock is a signed file, so the caller reminds the
 * publisher to sign again.
 *
 * UAT-4 (the owner's decided design): a peer now signed by another key than the one the lock recorded is never
 * re-pinned by a plain relock: the relock REFUSES, writes nothing and names each such peer, until every one is named
 * in `deps.acceptSigners` (`--accept-signer`) or the site stops naming it. The same holds for a recorded signer whose
 * peer publishes no signature now (404 or 410), and for a peer accepted as no longer signing that is signed again by a
 * key other than the one it last had (TOM-RC-1: `formerKid`); a signature that cannot be read keeps the recorded kid
 * (capture.ts). `deps.accept` (`--accept <ref>`) narrows the
 * relock to the named refs: everything else keeps the previous lock's record and keeps reporting. With `deps.trust`
 * an accepted signer is said to be backed by the trust file or not (an unbacked one is still accepted when named). The
 * lock never pins a peer's public key: only its kid, as before.
 */
export async function runRelock(options: WatchOptions, deps: WatchDeps = {}): Promise<RelockReport> {
  const env = envOf(options, deps);
  const read = await readLock(options.root);
  const before: Lock | undefined = read.kind === "ok" ? read.lock : undefined;
  const held = before?.grounding.sources.map((s) => s.ref) ?? [];
  const extraSources = [...held, ...(deps.extraSources ?? [])];
  const dropSources = [...new Set(deps.dropSources ?? [])];
  // --drop takes grounding refs and external definitions; a peer leaves the lock when no network names it
  const dropPeers = dropSources.filter(
    (r) => before !== undefined && (r in before.peers || r in (before.pendingPeers ?? {})) && !held.includes(r) && !(r in (before.external ?? {})),
  );
  if (dropPeers.length > 0) throw new RelockRefused({ refused: "drop-peer", refs: dropPeers });
  // every external definition the previous lock held is captured again, with the new ones, less what --drop names
  const externals = [...Object.entries(before?.external ?? {}).map(([url, e]) => ({ kind: e.kind, url })), ...(deps.externals ?? [])].filter(
    (e) => !dropSources.includes(e.url),
  );
  const captured = await captureLock(env, {
    now: env.now,
    externals,
    extraSources,
    ...(before !== undefined ? { previous: before } : {}),
    dropSources,
    ...(deps.runtimeDir !== undefined ? { runtimeDir: deps.runtimeDir } : {}),
  });
  const { findings, coverage } = captured;
  const accept = deps.accept !== undefined && deps.accept.length > 0 ? new Set(deps.accept) : undefined;
  const lock = accept !== undefined && before !== undefined ? narrowed(before, captured.lock, accept, findings) : captured.lock;

  // The signer changes this relock would write, and whether a person named each one (UAT-4). Once the lock recorded a
  // signer for a peer, only a person moves it (TOM-RC-1): to another kid, to no signature (the peer answers 404 or 410
  // for it), or, for a peer accepted as no longer signing, to a kid other than the one it last had. A peer this lock
  // did not hold, or held as never signed, has its first signer recorded and said (TOM-RC-4).
  const acceptSigners = new Set(deps.acceptSigners ?? []);
  const changes: SignerChange[] = [];
  const firstSigners: FirstSigner[] = [];
  for (const [url, record] of Object.entries(lock.peers)) {
    const prev = before?.peers[url];
    const was = prev?.kid ?? prev?.formerKid;
    if (prev === undefined || was === undefined) {
      if (record.kid !== undefined) firstSigners.push({ peer: url, kid: record.kid, was: prev === undefined ? "added" : "unsigned", backing: backingOf(env.trust, url, record.kid) });
      continue;
    }
    if (record.kid === was) continue;
    if (record.kid === undefined) {
      // still unsigned after a person accepted that it stopped signing: nothing changes
      if (prev.kid === undefined) continue;
      changes.push({ peer: url, from: was, how: NO_SIGNATURE_NOW });
      continue;
    }
    const base = await locatePeerBase(url, env);
    const rotation =
      base === null ? undefined : await readPeerRotation(env.fetch, base, was, record.kid, { fetchOptions: env.fetchOptions, ...(env.trust !== undefined ? { trust: env.trust } : {}) });
    changes.push({ peer: url, from: was, to: record.kid, how: signerChangeWords(rotation) });
  }
  const unnamed = changes.filter((c) => !acceptSigners.has(c.peer));
  if (unnamed.length > 0) throw new RelockRefused({ refused: "signer", peers: unnamed });
  for (const c of changes) if (c.to !== undefined) c.backing = backingOf(env.trust, c.peer, c.to, c.how);
  for (const ref of [...acceptSigners].filter((p) => !changes.some((c) => c.peer === p))) {
    findings.push({ kind: "peer", severity: "info", ref, summary: "Named with --accept-signer, but this relock changes no signer for it, so there was nothing to accept." });
  }
  for (const ref of dropSources.filter((r) => !held.includes(r) && !(r in (before?.external ?? {})))) {
    findings.push({ kind: "grounding", severity: "info", ref, summary: "This ref was not in the lock, so there was nothing to drop." });
  }
  await replaceLock(options.root, lock);
  return {
    previous: stateOf(read).lockState,
    changes: lockChanges(before, lock),
    findings,
    coverage,
    ...(changes.length > 0 ? { signers: changes } : {}),
    ...(firstSigners.length > 0 ? { firstSigners } : {}),
  };
}

/** The previous lock with only the accepted refs taken from the new capture (`--accept`); the rest keep their records. */
function narrowed(before: Lock, after: Lock, accept: Set<string>, findings: DriftFinding[]): Lock {
  const sources = before.grounding.sources.filter((s) => !accept.has(s.ref));
  for (const s of after.grounding.sources) if (accept.has(s.ref)) sources.push(s);
  const peers = { ...before.peers };
  const pendingPeers = { ...(before.pendingPeers ?? {}) };
  for (const url of accept) {
    const now = after.peers[url];
    const pending = after.pendingPeers?.[url];
    if (now !== undefined) {
      peers[url] = now;
      delete pendingPeers[url];
    } else if (pending !== undefined) {
      if (!(url in peers)) pendingPeers[url] = pending;
    } else {
      delete peers[url];
      delete pendingPeers[url];
    }
  }
  const external = { ...(before.external ?? {}) };
  for (const url of accept) {
    const now = after.external?.[url];
    if (now !== undefined) external[url] = now;
    else delete external[url];
  }
  const files = { ...before.runtime.files };
  for (const file of accept) {
    const now = after.runtime.files[file];
    if (now !== undefined) files[file] = now;
    else delete files[file];
  }
  const known = new Set([
    ...before.grounding.sources.map((s) => s.ref),
    ...after.grounding.sources.map((s) => s.ref),
    ...Object.keys(before.peers),
    ...Object.keys(after.peers),
    ...Object.keys(before.pendingPeers ?? {}),
    ...Object.keys(after.pendingPeers ?? {}),
    ...Object.keys(before.external ?? {}),
    ...Object.keys(after.external ?? {}),
    ...Object.keys(before.runtime.files),
    ...Object.keys(after.runtime.files),
  ]);
  for (const ref of accept) {
    if (!known.has(ref)) findings.push({ kind: "grounding", severity: "info", ref, summary: "Named with --accept, but neither the lock nor the site holds this ref, so there was nothing to accept." });
  }
  const out: Lock = {
    version: before.version,
    runtime: { ...before.runtime, files },
    grounding: { sources: sources.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0)), builtAt: after.grounding.builtAt },
    peers,
  };
  if (Object.keys(pendingPeers).length > 0) out.pendingPeers = pendingPeers;
  if (Object.keys(external).length > 0) out.external = external;
  return out;
}

/** What a --trust file says of a peer's signer: it holds the kid for the peer's origin, or a verified rotation leads to it. */
function backingOf(trust: readonly TrustEntry[] | undefined, peer: string, kid: string, how = ""): SignerBacking {
  if (trust === undefined) return "not checked: no --trust file given";
  const origin = originOf(peer);
  const backed = trust.some((e) => e.kid === kid && e.origin === origin && e.revokedAt === undefined) || how.startsWith("it rotated from the key the lock recorded, verified");
  return backed ? "backed by your trust file" : "not backed by your trust file";
}

/** The words after "signer  peer <url>: " for a first signer (TOM-RC-4), for init, watch --init and the relock. */
export function firstSignerWords(f: FirstSigner): string {
  return f.was === "added"
    ? `first seen, recorded ${f.kid}; compared with no earlier key (the lock keeps no record of a peer it no longer holds, so a peer named again is first seen too); ${f.backing}`
    : `recorded ${f.kid}, its first signer (the lock recorded it unsigned); ${f.backing}`;
}

const originOf = (url: string): string => {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
};

/** The site base a peer's manifest lives at (net/locate.ts), or null when it cannot be found now. */
async function locatePeerBase(url: string, env: DetectorEnv): Promise<string | null> {
  try {
    return (await locatePeerFile(url, env.fetch, env.fetchOptions)).base;
  } catch {
    return null;
  }
}

/**
 * What `watch --url` does not check, in words, as one `info` finding (info is clean: it never fails a run). Each of these
 * needs the site's checkout, which a reader of published files does not have: a folder cannot be listed over HTTP, the
 * coverage check reads what the site's root names, and the upstream check is the checkout's (it also spends GitHub's
 * unauthenticated quota, which a scan of many sites would exhaust). And the lock is the host's word until a signature
 * the caller trusts covers it.
 */
export const NOT_CHECKED_FROM_URL =
  "Not checked from a published site: a file added to the vendored runtime folder, whether the lock covers every file and peer the site names, and the runtime's upstream (each needs the site's checkout: watch --root); nor whether a signature you trust covers this lock (verify --url with your trust file).";

export interface UrlWatchOptions {
  /** The site address: a site, network or manifest address, as the gate reads it. */
  url: string;
  timeoutMs?: number;
  /** http and loopback for a site on this machine; private ranges stay refused (safeFetch's allowLocal). */
  allowLocal?: boolean;
}

/**
 * `watch --url`: re-check a site's PUBLISHED lock, as the Desk does, through safeFetch. The reader is
 * src/watch/published.ts, the code the Desk's drift reader runs; the CLI adds the site's own signature expiry (read from
 * the published plumbline.signature.json, as the checkout's watch reads it from disk) and, when a lock was found, the
 * sentence naming what was not checked. Lock states and their sentences are the published reader's; `refused` is the
 * browser's and never comes from here (for safeFetch a network failure is the connection failing: `unreadable`).
 */
export async function runWatchUrl(options: UrlWatchOptions, deps: WatchDeps = {}): Promise<WatchReport> {
  const fetch = deps.fetch ?? safeFetch;
  const fetchOptions = {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(options.allowLocal === true ? { allowLocal: true } : {}),
    ...(deps.fetchOptions ?? {}),
  };
  const now = (deps.now ?? (() => new Date()))();
  const reading = await readPublishedLock(options.url, fetch, { fetchOptions });
  const signature = await publishedSignatureExpiry(reading.base, fetch, fetchOptions, now);
  if (reading.lockState !== "found") {
    return { lockState: reading.lockState, ...(reading.lockSummary !== undefined ? { lockSummary: reading.lockSummary } : {}), findings: signature };
  }
  const notChecked: DriftFinding = { kind: "grounding", severity: "info", ref: LOCK_FILE, summary: NOT_CHECKED_FROM_URL };
  return { lockState: "found", findings: [...reading.findings, ...signature, notChecked] };
}

/** The published signature's expiry, by the rule the checkout's watch applies to the file on disk (decide.ts). */
async function publishedSignatureExpiry(base: string, fetch: NonNullable<WatchDeps["fetch"]>, fetchOptions: object, now: Date): Promise<DriftFinding[]> {
  let text: string | undefined;
  try {
    const response = await fetch(`${base}${SIGNATURE_FILE}`, fetchOptions);
    if (response.status === 404 || response.status === 410) return [];
    if (!response.ok) {
      return [{ kind: "grounding", severity: "warn", ref: SIGNATURE_FILE, summary: `The site's signature file could not be read to check its expiry: it answered HTTP ${response.status}.` }];
    }
    text = response.text();
  } catch (error) {
    return [{ kind: "grounding", severity: "warn", ref: SIGNATURE_FILE, summary: `The site's signature file could not be read to check its expiry: it could not be fetched (${describeWatchError(error)}).` }];
  }
  const finding = signatureExpiryFinding(text, now);
  return finding ? [finding] : [];
}
