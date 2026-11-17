// Watch: three drift detectors (grounding, runtime, peer) against plumbline.lock.json.
// Dry-run by default: it reports. With `init` and no lock it writes the lock and nothing else. Opening a PR or an
// issue is the workflow template's job through `gh` (action/templates/plumbline-watch.yml), never this library's.

import { LOCK_FILE, type DriftFinding, type DriftReport } from "../core/types.js";
import { DEFAULT_TIMEOUT_MS, safeFetch } from "../net/safe-fetch.js";
import { captureLock } from "./capture.js";
import { detectGrounding, detectPeers, detectRuntime, type DetectorEnv } from "./detectors.js";
import { lockMalformedFinding, readLock, writeLock, type WatchDeps } from "./lock.js";

export type { WatchDeps } from "./lock.js";

export interface WatchOptions {
  /** The site checkout the lock lives in. */
  root: string;
  /** Write plumbline.lock.json when there is none, instead of reporting it missing. */
  init?: boolean;
  timeoutMs?: number;
}

export async function runWatch(options: WatchOptions, deps: WatchDeps = {}): Promise<DriftReport> {
  const env: DetectorEnv = {
    root: options.root,
    fetch: deps.fetch ?? safeFetch,
    fetchOptions: { timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS, ...(deps.fetchOptions ?? {}) },
    ...(deps.upstreamUrl !== undefined ? { upstreamUrl: deps.upstreamUrl } : {}),
  };
  const read = await readLock(options.root);

  if (read.kind === "malformed") return { findings: [lockMalformedFinding(read.why)] };

  if (read.kind === "missing") {
    if (options.init !== true) {
      return { findings: [{ kind: "grounding", severity: "warn", ref: LOCK_FILE, summary: "no lock" }] };
    }
    const now = (deps.now ?? (() => new Date()))();
    const { lock, findings } = await captureLock(env, {
      now,
      ...(deps.extraSources !== undefined ? { extraSources: deps.extraSources } : {}),
      ...(deps.runtimeDir !== undefined ? { runtimeDir: deps.runtimeDir } : {}),
    });
    await writeLock(options.root, lock);
    return { findings };
  }

  const [grounding, runtime, peer] = await Promise.all([
    detectGrounding(read.lock, env),
    detectRuntime(read.lock, env),
    detectPeers(read.lock, env),
  ]);
  const findings: DriftFinding[] = [...grounding, ...runtime, ...peer];
  return { findings };
}
