// The ecosystem scan's driver (Node): for each address of a list, the gate report, the published lock's drift report
// (the reader `watch --url` runs) and whether a signature and a key record are published (presence and kid only).
// Sites are scanned one at a time, with a fixed pause between them and one absolute deadline per site: every fetch for a
// site goes through a fetcher that gives it at most the time left, and refuses one asked after the deadline.
// Every fetch is safeFetch's (or a test's injected fetcher). The report's shape and the HTML are ./report.ts.

import { KEY_FILE, SIGNATURE_FILE, KID_PATTERN, type VerifyResult } from "../core/types.js";
import { runGate, type GateOptions } from "../gate/index.js";
import type { Fetcher } from "../net/locate.js";
import { DEFAULT_TIMEOUT_MS, SafeFetchError, safeFetch, type SafeFetchOptions } from "../net/safe-fetch.js";
import { runWatchUrl } from "../watch/index.js";
import { siteBase } from "../watch/published.js";
import { attentionOf, disclosureFor, SCAN_SCHEMA, SCAN_VERSION, driftStateOf, summarise, type PublishedFile, type ScanReport, type SiteResult } from "./report.js";

/**
 * One absolute deadline per site, in milliseconds. Derivation: the gate's adapters run side by side, each with its own
 * deadline of 5 x the 10 s per-fetch timeout (src/gate/run.ts), so 50 s; the published lock's reads are bounded like
 * `verify --url`'s 60 s site deadline (src/cli/commands.ts SITE_DEADLINE_SECONDS); two more reads (signature, key
 * record) are 10 s each at most. 50 + 60 + 20 = 130 s, rounded down to 120 s because the gate and the watch share the
 * same few manifest reads. Measured 2026-11-18 over the seed list: the Desk took 12.1 s (its lock names 34 runtime
 * files, read one by one), Agent Atlas 1.4 s and Agent Customs 2.2 s.
 */
export const SITE_DEADLINE_MS = 120_000;

/**
 * The fixed pause between two sites, in milliseconds. Derivation: a site gets a few dozen requests per scan (the Desk's
 * lock names 34 runtime files), and Agent Atlas, a free public service, gets one check per site; 2 s between sites keeps
 * Atlas under 30 checks a minute whatever the list holds, and a list of 10 sites waits 18 s in all.
 */
export const DELAY_MS = 2_000;

/**
 * The most addresses one list may hold. Derivation: at the typical ~10 s a site takes plus the 2 s pause, 200 sites is
 * about 40 minutes, and even at the 120 s deadline each it stays under the 6 hours a GitHub Actions job may run.
 */
export const MAX_SITES = 200;

/**
 * The addresses of a list file: one per line, `#` starts a comment, blank lines skipped, each https, each once. With
 * `allowLocal` (UAT-21, the script's --allow-local) an http address is taken too: safeFetch then reaches only loopback
 * over http and still refuses private ranges.
 */
export function parseList(text: string, options: { allowLocal?: boolean } = {}): { addresses: string[]; problems: string[] } {
  const addresses: string[] = [];
  const problems: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/#.*$/, "").trim();
    if (line === "") return;
    let url: URL;
    try {
      url = new URL(line);
    } catch {
      problems.push(`line ${i + 1} is not a URL`);
      return;
    }
    if ((url.protocol !== "https:" && !(options.allowLocal === true && url.protocol === "http:")) || url.username || url.password) {
      problems.push(`line ${i + 1} is not an https address without credentials${options.allowLocal === true ? " (or an http one, with --allow-local)" : ""}`);
      return;
    }
    if (!addresses.includes(url.toString())) addresses.push(url.toString());
  });
  if (addresses.length > MAX_SITES) problems.push(`the list holds ${addresses.length} addresses; a scan takes at most ${MAX_SITES}`);
  return { addresses, problems };
}

/** A fetcher that gives each fetch at most the time left before `deadline` (epoch ms), and refuses one asked after it. */
export function deadlineFetcher(fetch: Fetcher, deadline: number, clock: () => number = Date.now): Fetcher {
  return async (url: string, options: SafeFetchOptions = {}) => {
    const left = deadline - clock();
    if (left <= 0) throw new SafeFetchError("timeout", "the site's deadline passed");
    return fetch(url, { ...options, timeoutMs: Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, left) });
  };
}

/** A Plumbline file at the site base: published, absent or unknown, and the kid only when it is in its exact pattern. */
async function publishedFile(fetch: Fetcher, url: string): Promise<PublishedFile> {
  let response;
  try {
    response = await fetch(url, {});
  } catch {
    return { state: "unknown" };
  }
  if (response.status === 404 || response.status === 410) return { state: "absent" };
  if (!response.ok) return { state: "unknown" };
  let kid: unknown;
  try {
    const parsed: unknown = JSON.parse(response.text());
    kid = typeof parsed === "object" && parsed !== null ? (parsed as { kid?: unknown }).kid : undefined;
  } catch {
    kid = undefined;
  }
  return { state: "published", ...(typeof kid === "string" && KID_PATTERN.test(kid) ? { kid } : {}) };
}

export interface ScanDeps {
  fetch?: Fetcher;
  /** Merged into every fetch (tests pass `allowLocal`). */
  fetchOptions?: SafeFetchOptions;
  now?: () => Date;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
  siteDeadlineMs?: number;
  delayMs?: number;
  /** The gate's checkers (UAT-11, --adapters); absent, all three. A checker left out is never asked. */
  adapters?: GateOptions["adapters"];
  /** Called after each site, for progress on stderr. */
  onSite?: (result: SiteResult, index: number, total: number) => void;
  /**
   * UAT-20 (PRI-L1-05): the operator's own signature check, for an operator who holds her clients' keys in a trust file:
   * the script passes `plumbline verify --url` against that file (cli/gate-command.ts checkSignature). Absent, the scan
   * trusts no key and a published signature is `unverifiable` here, as before.
   */
  verifySignature?: (address: string) => Promise<VerifyResult>;
  /** UAT-21: http and loopback allowed for a site on this machine (recorded in the report's settings and disclosure). */
  allowLocal?: boolean;
}

/** One site: the gate, the published lock's drift, the signature and key record's presence. Never throws. */
export async function scanSite(address: string, deps: ScanDeps = {}): Promise<SiteResult> {
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const deadline = started + (deps.siteDeadlineMs ?? SITE_DEADLINE_MS);
  const base = deps.fetch ?? safeFetch;
  const extra = { ...(deps.allowLocal === true ? { allowLocal: true } : {}), ...(deps.fetchOptions ?? {}) };
  const fetch = deadlineFetcher((url, options) => base(url, { ...options, ...extra }), deadline, clock);
  const now = deps.now ?? (() => new Date());
  const gate = await runGate({ target: address, ...(deps.adapters !== undefined ? { adapters: deps.adapters } : {}) }, { fetch, now });
  const watch = await runWatchUrl({ url: address }, { fetch, now });
  const siteRoot = await siteBase(address, fetch);
  const signature = await publishedFile(fetch, `${siteRoot}${SIGNATURE_FILE}`);
  const keyRecord = await publishedFile(fetch, `${siteRoot}${KEY_FILE}`);
  const elapsedMs = clock() - started;
  const drift = driftStateOf(watch);
  // UAT-20: the operator's trust file decides the verdict when one was given; without it nothing is verified
  const checked = deps.verifySignature !== undefined ? await deps.verifySignature(address) : undefined;
  const verdict = checked !== undefined ? { verdict: checked.verdict, signatureCheck: checked } : signature.state === "published" ? { verdict: "unverifiable" as const } : {};
  return {
    address,
    gate,
    watch,
    drift,
    signature,
    keyRecord,
    ...verdict,
    elapsedMs,
    deadlinePassed: clock() >= deadline,
    // UAT-19: how soon a person looks at it, so the report lists the sites worst first
    attention: attentionOf({ gate, watch, drift, ...(verdict.verdict !== undefined ? { verdict: verdict.verdict } : {}) }),
  };
}

/** Every address of the list, one at a time, with the fixed pause between them; the report with its summary. */
export async function scanList(addresses: string[], version: string, deps: ScanDeps = {}): Promise<ScanReport> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const delayMs = deps.delayMs ?? DELAY_MS;
  const now = deps.now ?? (() => new Date());
  const scannedAt = now().toISOString();
  const sites: SiteResult[] = [];
  for (const [i, address] of addresses.entries()) {
    if (i > 0) await sleep(delayMs);
    const result = await scanSite(address, deps);
    sites.push(result);
    deps.onSite?.(result, i, addresses.length);
  }
  return {
    schema: SCAN_SCHEMA,
    version: SCAN_VERSION,
    scannedAt,
    tool: { name: "plumbline", version },
    disclosure: disclosureFor(deps.adapters, { trust: deps.verifySignature !== undefined, allowLocal: deps.allowLocal === true }),
    settings: {
      siteDeadlineMs: deps.siteDeadlineMs ?? SITE_DEADLINE_MS,
      delayMs,
      ...(deps.adapters !== undefined ? { adapters: [...deps.adapters] } : {}),
      ...(deps.verifySignature !== undefined ? { trust: true as const } : {}),
      ...(deps.allowLocal === true ? { allowLocal: true as const } : {}),
    },
    summary: summarise(sites),
    sites,
  };
}
