// The gate runner without a default fetcher: runs the validator port, Agent Atlas and Agent Customs against a site and
// reports pass | fail | unavailable per adapter. The caller passes the fetcher: `index.ts` passes safeFetch (Node, with
// the SSRF guard), the Desk passes a wrapper around the browser's `fetch` (same-origin and CORS rules apply there).
// No node:* import here and no import of ../net/safe-fetch.js, so this module can be loaded by a browser.
// An unreachable adapter is `unavailable`, never `pass`. The report's state is the worst finding: fail, then
// unavailable, then pass. Adapters run independently, each with its own deadline; one failing or hanging never hides
// the others.

import type { GateFinding, GateReport } from "../core/types.js";
import type { Fetcher } from "../net/locate.js";
import { atlasAdapter } from "./adapter-atlas.js";
import { customsAdapter } from "./adapter-customs.js";
import { validatorAdapter } from "./adapter-validator.js";
import { finding, makeContext, worst, type Adapter, type PinnedCustomsKey } from "./context.js";

/** The options a fetcher accepts (safeFetch's options in Node), named without importing safe-fetch. */
export type FetchOptions = NonNullable<Parameters<Fetcher>[1]>;

export const ALL_ADAPTERS = ["validator", "atlas", "customs"] as const;
export type AdapterName = (typeof ALL_ADAPTERS)[number];

export interface GateOptions {
  /** A site base URL or a network URL. */
  target: string;
  /** Which adapters to run; default is all of them. */
  adapters?: AdapterName[];
  /** Absolute timeout per fetch in milliseconds. */
  timeoutMs?: number;
}

/** What the runner needs from its caller. Unlike GateDeps in index.ts, the fetcher and the default timeout are required. */
export interface GateRunDeps {
  fetch: Fetcher;
  /** Used when options.timeoutMs is absent. */
  defaultTimeoutMs: number;
  /** Merged into every fetch call. */
  fetchOptions?: FetchOptions;
  now?: () => Date;
  atlasBase?: string;
  customsBase?: string;
  /** `null` trusts the key published beside the receipts instead of the key pinned in this build. */
  customsPinnedKey?: PinnedCustomsKey | null;
}

const REGISTRY: Record<AdapterName, Adapter> = {
  validator: validatorAdapter,
  atlas: atlasAdapter,
  customs: customsAdapter,
};

/** Each adapter may make a handful of fetches, so its own deadline is a few times the per-fetch timeout. */
const ADAPTER_DEADLINE_FACTOR = 5;

export async function runGateWith(options: GateOptions, deps: GateRunDeps): Promise<GateReport> {
  const timeoutMs = options.timeoutMs ?? deps.defaultTimeoutMs;
  // UAT-10: the report says when the gate ran, so a badge drawn later is dated by the check, not by the drawing
  const checkedAt = (deps.now ?? (() => new Date()))().toISOString();
  const wanted = [...new Set(options.adapters ?? ALL_ADAPTERS)].filter((a) => a in REGISTRY);
  const ctx = makeContext({
    target: options.target,
    fetch: deps.fetch,
    fetchOptions: { timeoutMs, ...(deps.fetchOptions ?? {}) },
    now: deps.now ?? (() => new Date()),
    ...(deps.atlasBase !== undefined ? { atlasBase: deps.atlasBase } : {}),
    ...(deps.customsBase !== undefined ? { customsBase: deps.customsBase } : {}),
    ...(deps.customsPinnedKey !== undefined ? { customsPinnedKey: deps.customsPinnedKey } : {}),
  });

  const findings: GateFinding[] = await Promise.all(
    wanted.map(async (name): Promise<GateFinding> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
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
  return { target: options.target, state, findings, checkedAt };
}
