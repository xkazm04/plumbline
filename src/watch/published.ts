// The watch of a PUBLISHED lock: a site's plumbline.lock.json read from its address, and what a reader of published
// files can re-check live (grounding sources, runtime files, peers, pending peers). Pure, fetcher-injected: no node:*
// import, so the CLI's `watch --url` (through safeFetch) and the Desk's drift reader (site/drift.js, through the page's
// fetcher) run this one reader, and decide.ts says what every read means. scripts/build-site.mjs copies it into
// site/lib/plumbline/watch/.
//
// What differs from the watch of a checkout (src/watch/index.ts) is I/O only:
//   - lock references (runtime files, grounding paths) resolve against the lock's own URL, because a reader of a
//     published site can only read what it publishes. A lock written from another root than the published folder shows
//     its files as missing.
//   - the lock is a stranger's document, so its addresses are destinations a stranger chose: a peer address is held to
//     decide.ts peerAddressProblem, an absolute grounding ref and the network file a peer's own manifest names to
//     destinationProblem, before anything is fetched; a refusal is a warn that never quotes the address.
//   - a folder cannot be listed and the upstream is not asked here, so the added-runtime-file, coverage and upstream
//     checks are the checkout's (the CLI says so in words; the Desk's page says so).
// Every hash is SHA-256 of the exact bytes fetched (hashBytes), as the checkout's watch does.
//
// A lock that cannot be used is a lock state, not a drift finding (findings stay []): `absent` only for a 404 or 410,
// `refused` (the Desk only: `networkIsRefusal`) when the browser was refused, `unreadable` for another answer, a fetch
// error or a timeout, `unusable` for one that is not JSON or not the lock's shape. Each comes with lockSummary.

import { LOCK_FILE, type DriftFinding, type LockState } from "../core/types.js";
import type { SafeFetchOptions, SafeFetchResponse } from "../net/fetch-types.js";
import { locateTarget, type Fetcher } from "../net/locate.js";
import { groundingFindingsWithAnchors } from "./anchors.js";
import { externalFinding, observeExternal, type ExternalObservation } from "./external.js";
import {
  destinationProblem,
  lockProblem,
  peerAddressProblem,
  peerFindings,
  pendingPeerFindings,
  type PendingObservation,
  refusedPeerFinding,
  runtimeFinding,
  type Lock,
  type Observed,
} from "./decide.js";
import { describeWatchError, observePeer, observePublished, type Describe } from "./observe.js";

export interface PublishedOptions {
  /** Passed to every fetch. */
  fetchOptions?: SafeFetchOptions;
  /** The sentence for a fetch error. Default describeWatchError (the shared table). */
  why?: Describe;
  /**
   * True for a reader whose `network` failure means it was refused (a browser: CORS, offline). The lock is then
   * `refused`, never `unreadable`. The CLI leaves it false: for safeFetch a network failure is the connection failing.
   */
  networkIsRefusal?: boolean;
  /** The site base when the caller already worked it out. */
  base?: string;
  /** The lock as the caller already fetched it, so the bytes a signature check read are the bytes drift compares. */
  lockFetch?: { response: SafeFetchResponse } | { error: unknown };
}

export interface PublishedReading {
  target: string;
  base: string;
  lockUrl: string;
  lockFound: boolean;
  lockState: LockState;
  /** Present when lockState is not `found`: why no drift was checked. */
  lockSummary?: string;
  /** Peers whose network definition could not be read (a refused network file is not unreachable: nobody asked). */
  unreachablePeers: string[];
  /** In the DriftFinding wire shape. */
  findings: DriftFinding[];
}

/** The sentence for a lock the browser was refused (CORS or a network failure): never "publishes no lock". */
export const LOCK_REFUSED = "Could not read this site's plumbline.lock.json (the browser was refused)";

const isSafeFetchError = (error: unknown, code: string): boolean =>
  typeof error === "object" && error !== null && (error as { name?: unknown }).name === "SafeFetchError" && (error as { code?: unknown }).code === code;

/** Where a site's published files live: the folder that holds its agent-manifest.json, else a best guess. */
export async function siteBase(target: string, fetcher: Fetcher, options: SafeFetchOptions = {}): Promise<string> {
  try {
    const located = await locateTarget(target, fetcher, options);
    if (located.ok) return located.base;
  } catch {
    // fall through to the guess below; the lock fetch reports the failure
  }
  const url = new URL(target);
  url.search = "";
  url.hash = "";
  if (!url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1);
  return url.toString();
}

/** A lock reference resolved against the lock's URL, or null when it would leave the site's folder. */
export function publishedUrl(ref: string, base: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith("/") || ref.includes("\\")) return null;
  if (ref.split("/").some((segment) => segment === "..")) return null;
  const url = new URL(ref, base);
  return url.href.startsWith(base) ? url.href : null;
}

const OUTSIDE: Observed = { ok: false, missing: false, sentence: "is outside the published site, so a browser cannot check it" };

/** An absolute grounding ref the address rule refuses: never fetched, and the sentence does not quote it. */
const refusedRef = (problem: string): Observed => ({
  ok: false,
  missing: false,
  sentence: `was not fetched, because ${problem}, which a published lock may not point a browser at`,
});

interface Ctx {
  fetcher: Fetcher;
  fetchOptions: SafeFetchOptions;
  why: Describe;
}

async function groundingOf(lock: Lock, base: string, ctx: Ctx): Promise<DriftFinding[]> {
  const all: Observed[] = [];
  const read = { fetchOptions: ctx.fetchOptions, why: ctx.why };
  for (const source of lock.grounding.sources) {
    let seen: Observed;
    if (/^[a-z][a-z0-9+.-]*:/i.test(source.ref)) {
      // an absolute ref is a destination a stranger chose: held to the rule a lock's peers are (decide.ts)
      const problem = destinationProblem(source.ref);
      seen = problem === null ? await observePublished(ctx.fetcher, source.ref, read) : refusedRef(problem);
    } else {
      const url = publishedUrl(source.ref, base);
      seen = url === null ? OUTSIDE : await observePublished(ctx.fetcher, url, read);
    }
    all.push(seen);
  }
  // a changed page with anchors is re-read for the facts the network states, and the ones gone are checked against what
  // the networks among these sources state now (anchors.ts); the CLI counts the same
  return groundingFindingsWithAnchors(lock.grounding.sources, all);
}

async function runtimeOf(lock: Lock, base: string, ctx: Ctx): Promise<DriftFinding[]> {
  const out: DriftFinding[] = [];
  for (const [file, expected] of Object.entries(lock.runtime.files)) {
    const url = publishedUrl(file, base);
    const seen = url === null ? OUTSIDE : await observePublished(ctx.fetcher, url, { fetchOptions: { ...ctx.fetchOptions, ceiling: "runtime" }, why: ctx.why });
    const finding = runtimeFinding(file, expected, seen);
    if (finding) out.push(finding);
  }
  return out;
}

async function peerOf(url: string, record: Lock["peers"][string], ctx: Ctx): Promise<{ findings: DriftFinding[]; unreachable: boolean }> {
  const problem = peerAddressProblem(url);
  if (problem !== null) return { findings: [refusedPeerFinding(url, problem)], unreachable: false };
  // the reads every watch makes (observe.ts), with the network file the peer's manifest names held to the address
  // rule before it is fetched
  const seen = await observePeer(url, ctx.fetcher, { fetchOptions: ctx.fetchOptions, why: ctx.why, links: record.links !== undefined, guard: destinationProblem, ...(record.kid !== undefined ? { lockedKid: record.kid } : {}) });
  return { findings: peerFindings(url, record, seen), unreachable: !seen.definition.ok && seen.definition.refused === undefined };
}

/**
 * Read a site's published lock and re-check it.
 *
 * :param target: the site address (a site, network or manifest address, as the gate reads it).
 * :param fetcher: safeFetch (the CLI) or the page's fetcher (the Desk).
 * :return: the reading; for any lock state but `found`, lockSummary says why no drift was checked and findings is [].
 */
export async function readPublishedLock(target: string, fetcher: Fetcher, options: PublishedOptions = {}): Promise<PublishedReading> {
  const fetchOptions = options.fetchOptions ?? {};
  const why = options.why ?? describeWatchError;
  const base = options.base || (await siteBase(target, fetcher, fetchOptions));
  const lockUrl = `${base}${LOCK_FILE}`;
  const noLock = (lockState: LockState, lockSummary: string): PublishedReading => ({
    target,
    base,
    lockUrl,
    lockFound: false,
    lockState,
    lockSummary,
    unreachablePeers: [],
    findings: [],
  });
  let response: SafeFetchResponse;
  try {
    const given = options.lockFetch;
    if (given !== undefined && "response" in given && given.response) response = given.response;
    else if (given !== undefined && "error" in given && given.error !== undefined) throw given.error;
    else response = await fetcher(lockUrl, fetchOptions);
  } catch (error) {
    if (options.networkIsRefusal === true && isSafeFetchError(error, "network")) return noLock("refused", `${LOCK_REFUSED}, so no drift was checked.`);
    return noLock("unreadable", `The lock could not be fetched (${why(error)}), so no drift was checked.`);
  }
  if (response.status === 404 || response.status === 410) return noLock("absent", "no lock: this site publishes no plumbline.lock.json, so there is nothing to compare against.");
  if (!response.ok) return noLock("unreadable", `The lock request answered HTTP ${response.status}, so no drift was checked.`);
  let lock: unknown;
  try {
    lock = JSON.parse(response.text());
  } catch {
    return noLock("unusable", "The lock cannot be used: the lock file is not valid JSON, so no drift was checked.");
  }
  const problem = lockProblem(lock);
  if (problem !== null) return noLock("unusable", `The lock cannot be used: ${problem}, so no drift was checked.`);
  const checked = lock as Lock;
  const lockBase = new URL("./", response.url || lockUrl).href;
  const ctx: Ctx = { fetcher, fetchOptions, why };
  const [grounding, runtime, peers] = await Promise.all([
    groundingOf(checked, lockBase, ctx),
    runtimeOf(checked, lockBase, ctx),
    Promise.all(Object.entries(checked.peers).map(([url, record]) => peerOf(url, record, ctx).then((r) => ({ url, ...r })))),
  ]);
  const unreachablePeers = peers.filter((p) => p.unreachable).map((p) => p.url);
  // external definitions (external.ts): addresses a stranger chose, held to the peers' rule before anything is fetched
  const externalOut: DriftFinding[] = [];
  for (const [url, record] of Object.entries(checked.external ?? {})) {
    const problem = peerAddressProblem(url);
    const seen: ExternalObservation = problem !== null ? { ok: false, refused: problem } : await observeExternal(url, record.kind, fetcher, { fetchOptions, why });
    const finding = externalFinding(url, record, seen);
    if (finding) externalOut.push(finding);
  }
  // a pending peer is never contacted by a reader of a published lock (it was never pinned); one the address rule
  // refuses says so in the rule's words, as the checkout's watch does (UAT-3, REC-2)
  const today: Record<string, PendingObservation> = {};
  for (const url of Object.keys(checked.pendingPeers ?? {})) {
    const problem = peerAddressProblem(url);
    if (problem !== null) today[url] = { notContacted: problem };
  }
  const peerOut = [...peers.flatMap((p) => p.findings), ...pendingPeerFindings(checked, today), ...externalOut];
  return { target, base, lockUrl, lockFound: true, lockState: "found", unreachablePeers, findings: [...grounding, ...runtime, ...peerOut] };
}
