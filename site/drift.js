// The Desk's drift reader: the browser half of `plumbline watch`. It reads a site's PUBLISHED plumbline.lock.json and
// re-checks what a browser can check live. The reader itself is watch/published.js, compiled from
// src/watch/published.ts: the code the CLI's `plumbline watch --url` runs, so the two never disagree. What each read
// MEANS (the lock's shape rule, every finding and severity) is watch/decide.js, which the CLI's watch of a checkout
// uses too. This file only gives the reader the browser's I/O:
//   - the error sentence (why): a browser's "network" failure is the browser refusing to read it (CORS, offline), and
//     a lock the browser was refused is the lock state "refused", never "publishes no lock";
//   - the page's fetcher (fetcher.js), passed in by the caller.
// What published.js does for a stranger's lock, here as in the CLI: lock references resolve against the lock's own
// URL; a peer address that is not https, carries credentials, a query or a fragment, or names localhost, a single-label
// host or an IP literal in a range safeFetch refuses (net/address.js, the one table) is never contacted and is a warn
// that does not quote it; the same rule, less the query, holds the lock's absolute grounding refs and the network file a
// peer's own manifest names. The upstream runtime check, the coverage check (it lists the site's root) and the
// signature-expiry check are the CLI's watch of a checkout; the page says so.
//
// A lock that cannot be used is a lock state, not a drift finding (findings stay []): "absent" only for a 404 or 410,
// "refused" when the browser was refused, "unreadable" for another answer or a timeout, "unusable" for one that is not
// JSON or not the lock's shape. Each comes with lockSummary, the sentence that says why no drift was checked.

import { describeFetchError } from "./lib/plumbline/net/fetch-types.js";
import { lockProblem } from "./lib/plumbline/watch/decide.js";
import { LOCK_REFUSED, publishedUrl, readPublishedLock, siteBase } from "./lib/plumbline/watch/published.js";

export { LOCK_REFUSED, lockProblem, publishedUrl, siteBase };

/** The words the reader uses for a file the browser was refused (UAT-29: the page then names the header to ask for). */
export const BROWSER_REFUSED = "the browser could not read it";

/** The fetch-error sentence, from the shared table; a browser's "network" failure is the browser refusing to read it. */
function why(error) {
  if (error && error.name === "SafeFetchError" && error.code === "network") return BROWSER_REFUSED;
  return describeFetchError(error, "it could not be read");
}

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
 *   unreachablePeers lists the peers that could not be reached, for the page's wording.
 */
export async function readDrift(target, fetcher, options = {}) {
  const { base, lockFetch, ...fetchOptions } = options;
  return readPublishedLock(target, fetcher, {
    fetchOptions,
    why,
    networkIsRefusal: true,
    ...(base ? { base } : {}),
    ...(lockFetch ? { lockFetch } : {}),
  });
}

/**
 * The runtime imports every module the manifest lists in actions.modules and requires this export
 * (runtime/action-transport.js). drift.js registers no action of its own: it is listed so the Desk's signature covers
 * the code its website tools run.
 */
export function registerActions() {}
