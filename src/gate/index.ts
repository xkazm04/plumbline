// Gate: runs the reference validator, Agent Atlas and Agent Customs against a site and reports
// pass | fail | unavailable per adapter. WP2 implements it. An unreachable adapter is `unavailable`, never `pass`.

import type { GateReport } from "../core/types.js";

export interface GateOptions {
  /** A site base URL or a network URL. */
  target: string;
  /** Which adapters to run; default is all of them. */
  adapters?: ("validator" | "atlas" | "customs")[];
  /** Absolute timeout per fetch in milliseconds. */
  timeoutMs?: number;
}

export async function runGate(_options: GateOptions): Promise<GateReport> {
  throw new Error("not implemented: runGate (WP2)");
}
