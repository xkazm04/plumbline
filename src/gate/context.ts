// What every gate adapter shares: the target, one memoised address resolution, a fetcher with the caller's options
// applied, and a clock. Adapters never fetch except through `ctx.fetch`, which is safeFetch in production.

import type { GateFinding, GateState } from "../core/types.js";
import { locateTarget, type Fetcher, type Located } from "../net/locate.js";
import { describeFetchError, type SafeFetchOptions } from "../net/fetch-types.js";

export const ATLAS_BASE = "https://agent-atlas-phi.vercel.app";
export const CUSTOMS_BASE = "https://montbaga.github.io/agent-customs/";

export interface GateContext {
  target: string;
  fetch: (url: string, options?: SafeFetchOptions) => ReturnType<Fetcher>;
  /** Resolves the target once; every adapter that needs the manifest or the network addresses shares the answer. */
  locate(): Promise<Located>;
  now(): Date;
  atlasBase: string;
  customsBase: string;
  /** The Agent Customs public key this build trusts. `null` trusts the key published beside the receipts. */
  customsPinnedKey: PinnedCustomsKey | null;
}

export interface PinnedCustomsKey {
  keyId: string;
  publicKey: { crv: string; kty: string; x: string; y: string };
}

export type Adapter = (ctx: GateContext) => Promise<GateFinding>;

export function finding(adapter: string, state: GateState, summary: string): GateFinding {
  return { adapter, state, summary };
}

/** One sentence naming why a fetch failed: the table every caller shares (src/net/fetch-types.ts). */
export { describeFetchError };

const RANK: Record<GateState, number> = { pass: 0, unavailable: 1, fail: 2 };

/** The worst of several states: fail, then unavailable, then pass. */
export function worst(states: GateState[]): GateState {
  let out: GateState = "pass";
  for (const s of states) if (RANK[s] > RANK[out]) out = s;
  return out;
}

// ---- what a gate report says in words: "partly checked" is not "not checked" (UAT-9) ----

/** The checkers' names in a sentence. */
const CHECKER_NAMES: Record<string, string> = { validator: "validator", atlas: "Atlas", customs: "Customs" };
const nameOf = (adapter: string): string => CHECKER_NAMES[adapter] ?? adapter;
const andList = (names: string[]): string => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/**
 * The site itself could not be reached, by the adapters' own sentences ("the target could not be reached (<why>)":
 * Plumbline's words, never the site's): the cause, or null. Derived from the findings; nothing new on the wire.
 */
export function siteUnreachable(report: { findings: readonly GateFinding[] }): string | null {
  for (const f of report.findings) {
    if (f.state !== "unavailable") continue;
    const m = /the target could not be reached \(([^)]{1,120})\)/.exec(f.summary);
    if (m?.[1] !== undefined) return m[1];
  }
  return null;
}

/**
 * One sentence for what a gate report checked, the same on every surface (the CLI headline, the Action summary, the
 * scan, the Desk): "checked by 1 of 3 (validator pass); Atlas and Customs had no verdict" when some checker answered;
 * "the site could not be reached (<why>); nothing was checked, so this is not a pass" when the site itself did not
 * answer; "nothing was checked: every checker was unavailable, so this is not a pass" when no checker answered. The
 * state and the exit codes are the report's, unchanged (guardrail 6); this only words them.
 */
export function gateSentence(report: { findings: readonly GateFinding[] }): string {
  const checked = report.findings.filter((f) => f.state !== "unavailable");
  const missing = report.findings.filter((f) => f.state === "unavailable");
  const down = siteUnreachable(report);
  const total = report.findings.length;
  const by = checked.length > 0 ? `checked by ${checked.length} of ${total} (${checked.map((f) => `${nameOf(f.adapter)} ${f.state}`).join(", ")})` : "";
  if (down !== null) return checked.length > 0 ? `the site could not be reached (${down}); ${by}` : `the site could not be reached (${down}); nothing was checked, so this is not a pass`;
  if (checked.length === 0) return "nothing was checked: every checker was unavailable, so this is not a pass";
  return missing.length === 0 ? by : `${by}; ${andList(missing.map((f) => nameOf(f.adapter)))} had no verdict`;
}

export function makeContext(args: {
  target: string;
  fetch: Fetcher;
  fetchOptions: SafeFetchOptions;
  now: () => Date;
  atlasBase?: string;
  customsBase?: string;
  customsPinnedKey?: PinnedCustomsKey | null;
}): GateContext {
  const doFetch: GateContext["fetch"] = (url, options) => args.fetch(url, { ...args.fetchOptions, ...options });
  let located: Promise<Located> | undefined;
  return {
    target: args.target,
    fetch: doFetch,
    locate: () => (located ??= locateTarget(args.target, doFetch)),
    now: args.now,
    atlasBase: args.atlasBase ?? ATLAS_BASE,
    customsBase: (args.customsBase ?? CUSTOMS_BASE).replace(/\/*$/, "/"),
    customsPinnedKey: args.customsPinnedKey === undefined ? PINNED_CUSTOMS_KEY : args.customsPinnedKey,
  };
}

/**
 * Agent Customs' public key as first seen on 2026-11-17 at
 * https://montbaga.github.io/agent-customs/.well-known/agent-customs-key.json (key id -DC99sDa-qJjBp2N). Pinned in
 * source so a receipt host cannot swap the key and the receipts together; a published key that differs makes the
 * adapter `unavailable` (key changed, update Plumbline), never `pass`.
 */
export const PINNED_CUSTOMS_KEY: PinnedCustomsKey = {
  keyId: "-DC99sDa-qJjBp2N",
  publicKey: {
    crv: "P-256",
    kty: "EC",
    x: "Wzq2yNI2mFX6Iz-GBeV7LKacVokiI396oifQRocfzxo",
    y: "qdaCQ4K-07HN5yiq8CfFVUgRVtJm5uszNMsjuBqWQic",
  },
};
