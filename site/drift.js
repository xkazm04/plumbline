// The Desk's drift reader: the browser half of `plumbline watch`. It reads a site's PUBLISHED plumbline.lock.json and
// re-checks what a browser can check live. What each read MEANS (the lock's shape rule and every finding and severity)
// comes from src/watch/decide.ts, the I/O-free module the CLI's watch uses too, so the two never disagree; this file is
// only the browser's I/O. What differs from the CLI's driver:
//   - "local" lock references (runtime files, grounding paths) are resolved against the lock's own URL, because a
//     browser can only read what the site publishes. A lock written from a different root than the published folder
//     shows its files as missing; the summary says so.
//   - the lock is a stranger's document, so its peer addresses are destinations a stranger chose: one that is not
//     https, carries credentials, a query or a fragment, or names localhost, a single-label host or an IP literal in a
//     range safeFetch refuses (net/address.js, the one table) is never contacted (decide.ts peerAddressProblem) and is
//     a warn that does not quote it. The same rule, less the query, holds the lock's absolute grounding refs and the
//     network file a peer's own manifest names (decide.ts destinationProblem).
//   - what is read of a published file or a peer, and in what order, is watch/observe.js, the code the CLI's watch
//     runs; only the fetcher, the error sentence (why) and the address guard are the browser's.
//   - the upstream runtime check, the coverage check (it lists the site's root) and the signature-expiry check are the
//     CLI's; the page says so.
// Every hash is SHA-256 of the exact bytes fetched (hashBytes), as the CLI's watch does.
//
// A lock that cannot be used is a lock state, not a drift finding (findings stay []): "absent" only for a 404 or 410,
// "refused" when the browser was refused (CORS, offline; never reported as a site that publishes no lock),
// "unreadable" for another answer or a timeout, "unusable" for one that is not JSON or not the lock's shape. Each comes
// with lockSummary, the sentence that says why no drift was checked.

import { LOCK_FILE } from "./lib/plumbline/core/index.js";
import { describeFetchError } from "./lib/plumbline/net/fetch-types.js";
import { locateTarget } from "./lib/plumbline/net/locate.js";
import {
  destinationProblem,
  groundingFinding,
  lockProblem,
  peerAddressProblem,
  peerFindings,
  pendingPeerFindings,
  refusedPeerFinding,
  runtimeFinding,
} from "./lib/plumbline/watch/decide.js";
import { observePeer, observePublished } from "./lib/plumbline/watch/observe.js";

export { lockProblem };

// Marks a finding for an unreachable peer. A symbol key, so it never reaches JSON (the wire shape stays exact).
const UNREACHABLE = Symbol("unreachable");

/** Where a site's published files live: the folder that holds its agent-manifest.json, else a best guess. */
export async function siteBase(target, fetcher, options = {}) {
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
export function publishedUrl(ref, base) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith("/") || ref.includes("\\")) return null;
  if (ref.split("/").some((segment) => segment === "..")) return null;
  const url = new URL(ref, base);
  return url.href.startsWith(base) ? url.href : null;
}

/** The fetch-error sentence, from the shared table; a browser's "network" failure is the browser refusing to read it. */
function why(error) {
  if (error && error.name === "SafeFetchError" && error.code === "network") return "the browser could not read it";
  return describeFetchError(error, "it could not be read");
}

const OUTSIDE = { ok: false, missing: false, sentence: "is outside the published site, so a browser cannot check it" };

/** An absolute grounding ref the address rule refuses: never fetched, and the sentence does not quote it. */
const refusedRef = (problem) => ({ ok: false, missing: false, sentence: `was not fetched, because ${problem}, which a published lock may not point a browser at` });

async function detectGrounding(lock, base, fetcher, options) {
  const out = [];
  for (const source of lock.grounding.sources) {
    let seen;
    if (/^[a-z][a-z0-9+.-]*:/i.test(source.ref)) {
      // an absolute ref is a destination a stranger chose: held to the rule a lock's peers are (decide.ts)
      const problem = destinationProblem(source.ref);
      seen = problem === null ? await observePublished(fetcher, source.ref, { fetchOptions: options, why }) : refusedRef(problem);
    } else {
      const url = publishedUrl(source.ref, base);
      seen = url === null ? OUTSIDE : await observePublished(fetcher, url, { fetchOptions: options, why });
    }
    const finding = groundingFinding(source, seen);
    if (finding) out.push(finding);
  }
  return out;
}

async function detectRuntime(lock, base, fetcher, options) {
  const out = [];
  for (const [file, expected] of Object.entries(lock.runtime.files)) {
    const url = publishedUrl(file, base);
    const finding = runtimeFinding(file, expected, url === null ? OUTSIDE : await observePublished(fetcher, url, { fetchOptions: { ...options, ceiling: "runtime" }, why }));
    if (finding) out.push(finding);
  }
  return out;
}

async function checkPeer(url, record, fetcher, options) {
  const problem = peerAddressProblem(url);
  if (problem !== null) return [refusedPeerFinding(url, problem)];
  // the reads the CLI's watch makes (watch/observe.js), with the network file the peer's manifest names held to the
  // address rule before it is fetched
  const seen = await observePeer(url, fetcher, { fetchOptions: options, why, links: record.links !== undefined, guard: destinationProblem });
  const findings = peerFindings(url, record, seen);
  // An unreachable peer is also listed in unreachablePeers, for the page's wording. A symbol key, so it never reaches
  // JSON (the wire shape stays exact). A refused network file is not unreachable: the Desk chose not to ask.
  if (!seen.definition.ok && seen.definition.refused === undefined) for (const f of findings) f[UNREACHABLE] = true;
  return findings;
}

/** The sentence for a lock the browser was refused (CORS or a network failure): never "publishes no lock" (D6). */
export const LOCK_REFUSED = "Could not read this site's plumbline.lock.json (the browser was refused)";

/**
 * Read a site's published lock and re-check it.
 *
 * :param target: The site address.
 * :param fetcher: The Desk's fetcher.
 * :param options: Fetch options, such as timeoutMs; `base`, the site base when the caller already worked it out; and
 *   `lockFetch`, the lock as the caller already fetched it ({response} or {error}), so the bytes a signature check read
 *   are the bytes drift compares.
 * :return: {target, base, lockUrl, lockFound, lockState, lockSummary, unreachablePeers, findings}. lockState is "found",
 *   "absent" (404 or 410: the only "no lock"), "refused" (the browser could not read it), "unreadable" (another HTTP
 *   answer or a timeout) or "unusable" (not JSON, or not the lock's shape); for any but "found", lockSummary says why
 *   no drift was checked and findings is empty (a lock state is not drift). Findings use the DriftFinding wire shape;
 *   peer findings for an unreachable peer are also listed in unreachablePeers, for the page's wording.
 */
export async function readDrift(target, fetcher, options = {}) {
  const { base: givenBase, lockFetch, ...fetchOptions } = options;
  const base = givenBase || (await siteBase(target, fetcher, fetchOptions));
  const lockUrl = `${base}${LOCK_FILE}`;
  const noLock = (lockState, lockSummary) => ({ target, base, lockUrl, lockFound: false, lockState, lockSummary, unreachablePeers: [], findings: [] });
  let response;
  try {
    if (lockFetch && lockFetch.response) response = lockFetch.response;
    else if (lockFetch && lockFetch.error) throw lockFetch.error;
    else response = await fetcher(lockUrl, fetchOptions);
  } catch (error) {
    if (error && error.name === "SafeFetchError" && error.code === "network") return noLock("refused", `${LOCK_REFUSED}, so no drift was checked.`);
    return noLock("unreadable", `The lock could not be fetched (${why(error)}), so no drift was checked.`);
  }
  if (response.status === 404 || response.status === 410) return noLock("absent", "no lock: this site publishes no plumbline.lock.json, so there is nothing to compare against.");
  if (!response.ok) return noLock("unreadable", `The lock request answered HTTP ${response.status}, so no drift was checked.`);
  let lock;
  try {
    lock = JSON.parse(response.text());
  } catch {
    return noLock("unusable", "The lock cannot be used: the lock file is not valid JSON, so no drift was checked.");
  }
  const problem = lockProblem(lock);
  if (problem !== null) return noLock("unusable", `The lock cannot be used: ${problem}, so no drift was checked.`);
  const lockBase = new URL("./", response.url || lockUrl).href;
  const [grounding, runtime, peers] = await Promise.all([
    detectGrounding(lock, lockBase, fetcher, fetchOptions),
    detectRuntime(lock, lockBase, fetcher, fetchOptions),
    Promise.all(Object.entries(lock.peers).map(([url, record]) => checkPeer(url, record, fetcher, fetchOptions))).then((r) => [...r.flat(), ...pendingPeerFindings(lock)]),
  ]);
  const unreachablePeers = peers.filter((f) => f[UNREACHABLE] === true).map((f) => f.ref);
  return { target, base, lockUrl, lockFound: true, lockState: "found", unreachablePeers, findings: [...grounding, ...runtime, ...peers] };
}

/**
 * The runtime imports every module the manifest lists in actions.modules and requires this export
 * (runtime/action-transport.js). drift.js registers no action of its own: it is listed so the Desk's signature covers
 * the code its website tools run.
 */
export function registerActions() {}

