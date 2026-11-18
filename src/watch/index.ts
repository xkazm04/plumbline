// Watch: three drift detectors (grounding, runtime, peer) against plumbline.lock.json, plus what the lock does not cover
// and the site's own signature expiry. Dry-run by default: it reports. With `init` and no lock it writes the lock and
// nothing else; `runRelock` rewrites it after a person reviewed the drift. Opening, editing and closing the drift issue is
// the Action's job (action/action.yml with `issues: true`), never this library's.

import { LOCK_FILE, SIGNATURE_FILE, type DriftFinding } from "../core/types.js";
import { DEFAULT_TIMEOUT_MS, safeFetch } from "../net/safe-fetch.js";
import type { FactCoverage } from "./anchors.js";
import { captureLock } from "./capture.js";
import { lockChanges, signatureExpiryFinding, type Lock, type LockChanges, type LockState, type WatchReport } from "./decide.js";
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

async function captureFirstLock(env: DetectorEnv, options: WatchOptions, deps: WatchDeps): Promise<{ findings: DriftFinding[]; coverage: FactCoverage }> {
  const { lock, findings, coverage } = await captureLock(env, {
    now: env.now,
    ...(deps.externals !== undefined ? { externals: deps.externals } : {}),
    ...(deps.extraSources !== undefined ? { extraSources: deps.extraSources } : {}),
    ...(deps.runtimeDir !== undefined ? { runtimeDir: deps.runtimeDir } : {}),
  });
  await writeLock(options.root, lock);
  return { findings, coverage };
}

/**
 * `init` and `watch --init`: write the first lock when there is none, and say what it watches (the facts the networks
 * state, per page given with --source: anchors.ts FactCoverage, for the publisher's own terminal). Null when a lock is
 * already there: it is never rewritten here.
 */
export async function runInit(options: WatchOptions, deps: WatchDeps = {}): Promise<{ findings: DriftFinding[]; coverage: FactCoverage } | null> {
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
}

/**
 * `watch --relock`: after a person reviewed the drift, rewrite plumbline.lock.json from the current state and say what
 * changed. Every grounding ref the previous lock held is captured again (with the extra sources), so a `--source` given
 * at init is not dropped; one that is gone now is a finding and leaves the lock. A ref in `deps.dropSources`
 * (`--drop`) is left out, and the change list shows it removed. The lock is a signed file, so the caller reminds the
 * publisher to sign again.
 */
export async function runRelock(options: WatchOptions, deps: WatchDeps = {}): Promise<RelockReport> {
  const env = envOf(options, deps);
  const read = await readLock(options.root);
  const before: Lock | undefined = read.kind === "ok" ? read.lock : undefined;
  const held = before?.grounding.sources.map((s) => s.ref) ?? [];
  const extraSources = [...held, ...(deps.extraSources ?? [])];
  const dropSources = [...new Set(deps.dropSources ?? [])];
  // every external definition the previous lock held is captured again, with the new ones, less what --drop names
  const externals = [...Object.entries(before?.external ?? {}).map(([url, e]) => ({ kind: e.kind, url })), ...(deps.externals ?? [])].filter(
    (e) => !dropSources.includes(e.url),
  );
  const { lock, findings, coverage } = await captureLock(env, {
    now: env.now,
    externals,
    extraSources,
    ...(before !== undefined ? { previous: before } : {}),
    dropSources,
    ...(deps.runtimeDir !== undefined ? { runtimeDir: deps.runtimeDir } : {}),
  });
  for (const ref of dropSources.filter((r) => !held.includes(r) && !(r in (before?.external ?? {})))) {
    findings.push({ kind: "grounding", severity: "info", ref, summary: "This ref was not in the lock, so there was nothing to drop." });
  }
  await replaceLock(options.root, lock);
  return { previous: stateOf(read).lockState, changes: lockChanges(before, lock), findings, coverage };
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
