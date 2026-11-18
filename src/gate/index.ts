// Gate: runs the validator port, Agent Atlas and Agent Customs against a site and reports
// pass | fail | unavailable per adapter. An unreachable adapter is `unavailable`, never `pass`.
// The report's state is the worst finding: fail, then unavailable, then pass. Adapters run independently, each with
// its own deadline; one failing or hanging never hides the others. Every fetch goes through safeFetch.
// The runner itself is in run.ts (no node:* imports, so the Desk can load it in a browser with its own fetcher);
// this module binds it to safeFetch and safeFetch's default timeout.

import type { GateReport } from "../core/types.js";
import { safeFetch, DEFAULT_TIMEOUT_MS, type SafeFetchOptions } from "../net/safe-fetch.js";
import type { Fetcher } from "../net/locate.js";
import type { PinnedCustomsKey } from "./context.js";
import { runGateWith, type GateOptions } from "./run.js";

export { ALL_ADAPTERS, type GateOptions } from "./run.js";
export { gateSentence, siteUnreachable } from "./context.js";

/** Injection points for tests and for pointing the gate at a different Atlas or Customs host. Production passes none. */
export interface GateDeps {
  fetch?: Fetcher;
  /** Merged into every safeFetch call (tests and `gate --allow-local` pass `allowLocal` here). */
  fetchOptions?: SafeFetchOptions;
  now?: () => Date;
  atlasBase?: string;
  customsBase?: string;
  /** `null` trusts the key published beside the receipts instead of the key pinned in this build. */
  customsPinnedKey?: PinnedCustomsKey | null;
}

export async function runGate(options: GateOptions, deps: GateDeps = {}): Promise<GateReport> {
  return runGateWith(options, {
    fetch: deps.fetch ?? safeFetch,
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
    ...(deps.fetchOptions !== undefined ? { fetchOptions: deps.fetchOptions } : {}),
    ...(deps.now !== undefined ? { now: deps.now } : {}),
    ...(deps.atlasBase !== undefined ? { atlasBase: deps.atlasBase } : {}),
    ...(deps.customsBase !== undefined ? { customsBase: deps.customsBase } : {}),
    ...(deps.customsPinnedKey !== undefined ? { customsPinnedKey: deps.customsPinnedKey } : {}),
  });
}
