// The Desk's drift reader: the browser half of `plumbline watch`. It reads a site's PUBLISHED plumbline.lock.json and
// re-checks what a browser can check live, with the same hashing and the same severities as src/watch/detectors.ts.
//
// Why a separate detector: src/watch/detectors.ts and lock.ts import node:fs and node:path (they read a local root)
// and safe-fetch.js, so they cannot load in a browser. What this module reuses is the pure part: the byte fingerprint
// of net/canonical.js (hashBytes) and the peer locator of net/locate.js. What differs:
//   - "local" lock references (runtime files, grounding paths) are resolved against the lock's own URL, because a
//     browser can only read what the site publishes. A lock written from a different root than the published folder
//     shows its files as missing; the summary says so.
//   - the upstream nsdeploy commit check is not run here (the page says so); the CLI's watch does it.
// Severities (docs/gate-and-watch.md): grounding changed or unreadable: warn. Runtime changed or missing: block.
// Peer changed, its links.json appeared, changed or went away, or it is now signed by another key: block; unreachable,
// links.json not readable or not recorded: warn; newly signed: info; signature gone: warn. Every hash is SHA-256 of the
// exact bytes fetched (hashBytes), as the CLI's watch does. A peer kid outside its pattern is never quoted.
//
// "No lock" is said only for a 404 or 410 (lockState "absent"). A lock the browser was refused (CORS, offline) is
// lockState "refused" and says so; the Desk never reports a refused read as a site that publishes no lock.

import { KID_PATTERN, LOCK_FILE, PEER_LINKS_ABSENT, SIGNATURE_FILE, FORMAT_VERSION } from "./lib/plumbline/core/index.js";
import { hashBytes } from "./lib/plumbline/net/canonical.js";
import { locatePeerFile, locateTarget } from "./lib/plumbline/net/locate.js";

// Marks a finding for an unreachable peer. A symbol key, so it never reaches JSON (the wire shape stays exact).
const UNREACHABLE = Symbol("unreachable");

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isHex = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

/** The same shape rules as src/watch/lock.ts lockProblem. */
export function lockProblem(value) {
  if (!isObject(value)) return "the lock is not a JSON object";
  if (value.version !== FORMAT_VERSION) return "the lock has an unknown version";
  const { runtime, grounding, peers } = value;
  if (!isObject(runtime) || runtime.source !== "nsdeploy" || typeof runtime.commit !== "string" || !isObject(runtime.files)) {
    return "the lock's runtime section is malformed";
  }
  if (!Object.values(runtime.files).every(isHex)) return "the lock's runtime file hashes are malformed";
  if (!isObject(grounding) || !Array.isArray(grounding.sources) || typeof grounding.builtAt !== "string") {
    return "the lock's grounding section is malformed";
  }
  if (!grounding.sources.every((s) => isObject(s) && typeof s.ref === "string" && isHex(s.sha256))) {
    return "the lock's grounding sources are malformed";
  }
  if (!isObject(peers)) return "the lock's peers section is malformed";
  for (const p of Object.values(peers)) {
    if (
      !isObject(p) ||
      !isHex(p.sha256) ||
      typeof p.checkedAt !== "string" ||
      (p.kid !== undefined && (typeof p.kid !== "string" || !KID_PATTERN.test(p.kid))) ||
      (p.links !== undefined && !isHex(p.links) && p.links !== PEER_LINKS_ABSENT)
    ) {
      return "the lock's peer entries are malformed";
    }
  }
  return null;
}

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

function why(error) {
  if (error && error.name === "SafeFetchError") {
    switch (error.code) {
      case "timeout":
        return "the request timed out";
      case "body-too-large":
        return "the response was over the byte ceiling";
      case "insecure-scheme":
        return "the address is not https";
      case "bad-url":
        return "it is not a valid URL";
      default:
        return "the browser could not read it";
    }
  }
  return "it could not be read";
}

async function hashPublished(fetcher, url, options) {
  let response;
  try {
    response = await fetcher(url, options);
  } catch (error) {
    return { ok: false, missing: false, sentence: `could not be fetched (${why(error)})` };
  }
  if (response.status === 404 || response.status === 410) return { ok: false, missing: true, sentence: `is not published (HTTP ${response.status})` };
  if (!response.ok) return { ok: false, missing: false, sentence: `could not be fetched (HTTP ${response.status})` };
  return { ok: true, sha256: await hashBytes(response.bytes) };
}

async function detectGrounding(lock, base, fetcher, options) {
  const out = [];
  for (const source of lock.grounding.sources) {
    const url = /^https:\/\//i.test(source.ref) ? source.ref : publishedUrl(source.ref, base);
    if (url === null) {
      out.push({ kind: "grounding", severity: "warn", ref: source.ref, expected: source.sha256, summary: "A grounding source is outside the published site, so a browser cannot check it." });
      continue;
    }
    const got = await hashPublished(fetcher, url, options);
    if (!got.ok) {
      out.push({ kind: "grounding", severity: "warn", ref: source.ref, expected: source.sha256, summary: `A grounding source could not be checked: it ${got.sentence}.` });
    } else if (got.sha256 !== source.sha256) {
      out.push({
        kind: "grounding",
        severity: "warn",
        ref: source.ref,
        expected: source.sha256,
        actual: got.sha256,
        summary: "A grounding source changed since the lock was written; the agent now answers from different facts.",
      });
    }
  }
  return out;
}

async function detectRuntime(lock, base, fetcher, options) {
  const out = [];
  for (const [file, expected] of Object.entries(lock.runtime.files)) {
    const url = publishedUrl(file, base);
    if (url === null) {
      out.push({ kind: "runtime", severity: "block", ref: file, expected, summary: "A locked runtime file is outside the published site, so a browser cannot check it." });
      continue;
    }
    const got = await hashPublished(fetcher, url, options);
    if (!got.ok) {
      out.push({
        kind: "runtime",
        severity: "block",
        ref: file,
        expected,
        summary: got.missing
          ? "A vendored runtime file is not published where the lock says (removed, or the lock was written from another folder); the runtime is copy-do-not-change."
          : `A vendored runtime file could not be checked: it ${got.sentence}.`,
      });
    } else if (got.sha256 !== expected) {
      out.push({
        kind: "runtime",
        severity: "block",
        ref: file,
        expected,
        actual: got.sha256,
        summary: "A vendored runtime file differs from the locked copy; the runtime is copy-do-not-change.",
      });
    }
  }
  return out;
}

async function checkPeer(url, record, fetcher, options) {
  const out = [];
  let located;
  let response;
  try {
    located = await locatePeerFile(url, fetcher, options);
    response = await fetcher(located.fileUrl, options);
  } catch (error) {
    return [{ kind: "peer", severity: "warn", ref: url, summary: `This peer could not be reached (${why(error)}), so it was not checked.`, [UNREACHABLE]: true }];
  }
  if (!response.ok) {
    return [{ kind: "peer", severity: "warn", ref: url, summary: `This peer could not be reached: its network definition answered HTTP ${response.status}.`, [UNREACHABLE]: true }];
  }
  const actual = await hashBytes(response.bytes);
  if (actual !== record.sha256) {
    out.push({
      kind: "peer",
      severity: "block",
      ref: url,
      expected: record.sha256,
      actual,
      summary: "A peer's network definition changed since the lock was written; it runs in the visitor's browser, so a changed one is changed code.",
    });
  }
  // The peer's links.json at its site base: the runtime lays it over the peer network's links, so one that appears,
  // changes or goes away changes what the peer does. 404 or 410 is "absent"; a readable answer is hashed; anything
  // else is unreadable. A lock written before links were tracked has no record: say so, never pass.
  if (record.links === undefined) {
    out.push({ kind: "peer", severity: "warn", ref: url, summary: "The lock does not record this peer's links.json, so a links file it adds or changes is not seen; re-lock to track it." });
  } else {
    let links;
    try {
      const answer = await fetcher(`${located.base}links.json`, options);
      if (answer.status === 404 || answer.status === 410) links = PEER_LINKS_ABSENT;
      else if (answer.ok) links = await hashBytes(answer.bytes);
      else out.push({ kind: "peer", severity: "warn", ref: url, summary: `A peer's links.json could not be checked: it answered HTTP ${answer.status}.` });
    } catch (error) {
      out.push({ kind: "peer", severity: "warn", ref: url, summary: `A peer's links.json could not be checked: it could not be fetched (${why(error)}).` });
    }
    if (links !== undefined && links !== record.links) {
      const appeared = record.links === PEER_LINKS_ABSENT;
      const gone = links === PEER_LINKS_ABSENT;
      out.push({
        kind: "peer",
        severity: "block",
        ref: url,
        expected: record.links,
        actual: links,
        summary: appeared
          ? "A peer now publishes a links.json it did not have when locked; the runtime lays it over the peer's links, so this is changed code."
          : gone
            ? "A peer's links.json is gone since the lock was written; the peer's links now resolve differently."
            : "A peer's links.json changed since the lock was written; the runtime lays it over the peer's links, so this is changed code.",
      });
    }
  }
  let kid;
  let problem;
  try {
    const sig = await fetcher(`${located.base}${SIGNATURE_FILE}`, options);
    if (sig.ok) {
      try {
        const parsed = JSON.parse(sig.text());
        // a kid outside its exact pattern is treated as none: a stranger's string never reaches a finding
        if (parsed && typeof parsed.kid === "string" && KID_PATTERN.test(parsed.kid)) kid = parsed.kid;
        else problem = `its ${SIGNATURE_FILE} has no valid kid`;
      } catch {
        problem = `its ${SIGNATURE_FILE} is not valid JSON`;
      }
    } else if (sig.status !== 404 && sig.status !== 410) problem = `its signature request answered HTTP ${sig.status}`;
  } catch (error) {
    problem = `its signature could not be fetched (${why(error)})`;
  }
  if (kid !== undefined && record.kid !== undefined && kid !== record.kid) {
    out.push({ kind: "peer", severity: "block", ref: url, expected: record.kid, actual: kid, summary: "A peer is now signed by a different key than the one the lock recorded." });
  } else if (kid !== undefined && record.kid === undefined) {
    out.push({ kind: "peer", severity: "info", ref: url, actual: kid, summary: "A peer that was unsigned when locked now publishes a signature; re-lock to record its key." });
  } else if (kid === undefined && record.kid !== undefined) {
    out.push({
      kind: "peer",
      severity: "warn",
      ref: url,
      expected: record.kid,
      summary: `A peer that was signed when locked no longer shows a usable signature${problem ? ` (${problem})` : " (none is published)"}.`,
    });
  }
  return out;
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
 * :return: {target, base, lockUrl, lockFound, lockState, findings}. lockState is "found", "absent" (404 or 410: the
 *   only "no lock"), "refused" (the browser could not read it), "unreadable" (another HTTP answer or a timeout) or
 *   "unusable" (not JSON, or not the lock's shape). Findings use the DriftFinding wire shape; peer findings for an
 *   unreachable peer are also listed in unreachablePeers, for the page's wording.
 */
export async function readDrift(target, fetcher, options = {}) {
  const { base: givenBase, lockFetch, ...fetchOptions } = options;
  const base = givenBase || (await siteBase(target, fetcher, fetchOptions));
  const lockUrl = `${base}${LOCK_FILE}`;
  const noLock = (lockState, summary) => ({ target, base, lockUrl, lockFound: false, lockState, unreachablePeers: [], findings: [{ kind: "grounding", severity: "warn", ref: LOCK_FILE, summary }] });
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
    Promise.all(Object.entries(lock.peers).map(([url, record]) => checkPeer(url, record, fetcher, fetchOptions))).then((r) => r.flat()),
  ]);
  const unreachablePeers = peers.filter((f) => f[UNREACHABLE] === true).map((f) => f.ref);
  return { target, base, lockUrl, lockFound: true, lockState: "found", unreachablePeers, findings: [...grounding, ...runtime, ...peers] };
}
