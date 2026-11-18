// Watch: three drift detectors (grounding, runtime, peer) against plumbline.lock.json, plus what the lock does not cover
// and the site's own signature expiry. Dry-run by default: it reports. With `init` and no lock it writes the lock and
// nothing else; `runRelock` rewrites it after a person reviewed the drift. Opening, editing and closing the drift issue is
// the Action's job (action/action.yml with `issues: true`), never this library's.

import { LOCK_FILE, type DriftFinding } from "../core/types.js";
import { DEFAULT_TIMEOUT_MS, safeFetch } from "../net/safe-fetch.js";
import { captureLock } from "./capture.js";
import { lockChanges, type Lock, type LockChanges, type LockState, type WatchReport } from "./decide.js";
import { detectCoverage, detectGrounding, detectPeers, detectRuntime, detectSignature, type DetectorEnv } from "./detectors.js";
import { readLock, replaceLock, writeLock, type LockRead, type WatchDeps } from "./lock.js";

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

/**
 * Check the site against its lock. A lock that is absent, unreadable or unusable is a lock state with its own sentence
 * (`lockState`, `lockSummary`), not a drift finding: no drift was checked, which the CLI never reports as clean.
 */
export async function runWatch(options: WatchOptions, deps: WatchDeps = {}): Promise<WatchReport> {
  const env = envOf(options, deps);
  const read = await readLock(options.root);

  if (read.kind === "missing" && options.init === true) {
    const { lock, findings } = await captureLock(env, {
      now: env.now,
      ...(deps.extraSources !== undefined ? { extraSources: deps.extraSources } : {}),
      ...(deps.runtimeDir !== undefined ? { runtimeDir: deps.runtimeDir } : {}),
    });
    await writeLock(options.root, lock);
    return { findings };
  }

  const signature = await detectSignature(env);
  if (read.kind !== "ok") return { ...stateOf(read), findings: signature };

  const [grounding, runtime, peer, coverage] = await Promise.all([
    detectGrounding(read.lock, env),
    detectRuntime(read.lock, env),
    detectPeers(read.lock, env),
    detectCoverage(read.lock, env),
  ]);
  const findings: DriftFinding[] = [...grounding, ...runtime, ...peer, ...coverage, ...signature];
  return { lockState: "found", findings };
}

export interface RelockReport {
  /** What the lock held before: `found`, or why there was none to compare with. */
  previous: LockState;
  changes: LockChanges;
  /** What could not be captured (a peer held as pending, a source that is gone), as `--init` reports it. */
  findings: DriftFinding[];
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
  const { lock, findings } = await captureLock(env, {
    now: env.now,
    extraSources,
    dropSources,
    ...(deps.runtimeDir !== undefined ? { runtimeDir: deps.runtimeDir } : {}),
  });
  for (const ref of dropSources.filter((r) => !held.includes(r))) {
    findings.push({ kind: "grounding", severity: "info", ref, summary: "This ref was not in the lock, so there was nothing to drop." });
  }
  await replaceLock(options.root, lock);
  return { previous: stateOf(read).lockState, changes: lockChanges(before, lock), findings };
}
