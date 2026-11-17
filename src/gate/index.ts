// Gate: runs the validator port, Agent Atlas and Agent Customs against a site and reports
// pass | fail | unavailable per adapter. An unreachable adapter is `unavailable`, never `pass`.
// The report's state is the worst finding: fail, then unavailable, then pass. Adapters run independently, each with
// its own deadline; one failing or hanging never hides the others. Every fetch goes through safeFetch.

import type { GateFinding, GateReport } from "../core/types.js";
import { safeFetch, DEFAULT_TIMEOUT_MS, type SafeFetchOptions } from "../net/safe-fetch.js";
import type { Fetcher } from "../net/locate.js";
import { atlasAdapter } from "./adapter-atlas.js";
import { customsAdapter } from "./adapter-customs.js";
import { validatorAdapter } from "./adapter-validator.js";
import { finding, makeContext, worst, type Adapter, type PinnedCustomsKey } from "./context.js";

export interface GateOptions {
  /** A site base URL or a network URL. */
  target: string;
  /** Which adapters to run; default is all of them. */
  adapters?: ("validator" | "atlas" | "customs")[];
  /** Absolute timeout per fetch in milliseconds. */
  timeoutMs?: number;
}

/** Injection points for tests and for pointing the gate at a different Atlas or Customs host. Production passes none. */
export interface GateDeps {
  fetch?: Fetcher;
  /** Merged into every safeFetch call (tests pass `allowInsecureLoopbackForTests` here). */
  fetchOptions?: SafeFetchOptions;
  now?: () => Date;
  atlasBase?: string;
  customsBase?: string;
  /** `null` trusts the key published beside the receipts instead of the key pinned in this build. */
  customsPinnedKey?: PinnedCustomsKey | null;
}

export const ALL_ADAPTERS = ["validator", "atlas", "customs"] as const;

const REGISTRY: Record<(typeof ALL_ADAPTERS)[number], Adapter> = {
  validator: validatorAdapter,
  atlas: atlasAdapter,
  customs: customsAdapter,
};

/** Each adapter may make a handful of fetches, so its own deadline is a few times the per-fetch timeout. */
const ADAPTER_DEADLINE_FACTOR = 5;

export async function runGate(options: GateOptions, deps: GateDeps = {}): Promise<GateReport> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const wanted = [...new Set(options.adapters ?? ALL_ADAPTERS)].filter((a) => a in REGISTRY);
  const ctx = makeContext({
    target: options.target,
    fetch: deps.fetch ?? safeFetch,
    fetchOptions: { timeoutMs, ...(deps.fetchOptions ?? {}) },
    now: deps.now ?? (() => new Date()),
    ...(deps.atlasBase !== undefined ? { atlasBase: deps.atlasBase } : {}),
    ...(deps.customsBase !== undefined ? { customsBase: deps.customsBase } : {}),
    ...(deps.customsPinnedKey !== undefined ? { customsPinnedKey: deps.customsPinnedKey } : {}),
  });

  const findings: GateFinding[] = await Promise.all(
    wanted.map(async (name): Promise<GateFinding> => {
      let timer: NodeJS.Timeout | undefined;
      const deadline = new Promise<GateFinding>((resolve) => {
        timer = setTimeout(
          () => resolve(finding(name, "unavailable", `The ${name} adapter did not finish in time, so it has no verdict.`)),
          timeoutMs * ADAPTER_DEADLINE_FACTOR,
        );
      });
      try {
        return await Promise.race([REGISTRY[name](ctx), deadline]);
      } catch {
        return finding(name, "unavailable", `The ${name} adapter failed unexpectedly, so it has no verdict.`);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }),
  );

  // Nothing checked is not a pass.
  const state = findings.length === 0 ? "unavailable" : worst(findings.map((f) => f.state));
  return { target: options.target, state, findings };
}
