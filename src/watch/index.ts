// Watch: three drift detectors (grounding, runtime, peer) against plumbline.lock.json. WP2 implements it.
// Dry-run by default: it reports; opening a PR or issue is a separate, explicit step through `gh`.

import type { DriftReport } from "../core/types.js";

export interface WatchOptions {
  /** The site checkout the lock lives in. */
  root: string;
  /** Write plumbline.lock.json when there is none, instead of reporting it missing. */
  init?: boolean;
  timeoutMs?: number;
}

export async function runWatch(_options: WatchOptions): Promise<DriftReport> {
  throw new Error("not implemented: runWatch (WP2)");
}
