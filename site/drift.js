// The Desk's drift reader: the browser half of `plumbline watch`. It reads a site's PUBLISHED plumbline.lock.json and
// re-checks what a browser can check live, with the same hashing and the same severities as src/watch/detectors.ts.
//
// Why a separate detector: src/watch/detectors.ts and lock.ts import node:fs and node:path (they read a local root)
// and safe-fetch.js, so they cannot load in a browser. What this module reuses is the pure part: the document
// fingerprints of net/canonical.js (hashBytes, hashDocument) and the peer locator of net/locate.js. What differs:
//   - "local" lock references (runtime files, grounding paths) are resolved against the lock's own URL, because a
//     browser can only read what the site publishes. A lock written from a different root than the published folder
//     shows its files as missing; the summary says so.
//   - the upstream nsdeploy commit check is not run here (the page says so); the CLI's watch does it.
// Severities (docs/gate-and-watch.md): grounding changed or unreadable: warn. Runtime changed or missing: block.
// Peer changed or now signed by another key: block; unreachable: warn; newly signed: info; signature gone: warn.

import { LOCK_FILE, SIGNATURE_FILE, FORMAT_VERSION } from "./lib/plumbline/core/index.js";
import { hashBytes, hashDocument } from "./lib/plumbline/net/canonical.js";
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
    if (!isObject(p) || !isHex(p.sha256) || typeof p.checkedAt !== "string" || (p.kid !== undefined && typeof p.kid !== "string")) {
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
  const actual = await hashDocument(response.text());
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
  let kid;
  let problem;
  try {
    const sig = await fetcher(`${located.base}${SIGNATURE_FILE}`, options);
    if (sig.ok) {
      try {
        const parsed = JSON.parse(sig.text());
        if (typeof parsed.kid === "string") kid = parsed.kid;
        else problem = `its ${SIGNATURE_FILE} has no kid`;
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

/**
 * Read a site's published lock and re-check it.
 *
 * :param target: The site address.
 * :param fetcher: The Desk's fetcher.
 * :param options: Fetch options, such as timeoutMs.
 * :return: {target, base, lockUrl, lockFound, findings}. Findings use the DriftFinding wire shape; peer findings for
 *   an unreachable peer are also listed in unreachablePeers, for the page's wording.
 */
export async function readDrift(target, fetcher, options = {}) {
  const base = await siteBase(target, fetcher, options);
  const lockUrl = `${base}${LOCK_FILE}`;
  const noLock = (summary) => ({ target, base, lockUrl, lockFound: false, unreachablePeers: [], findings: [{ kind: "grounding", severity: "warn", ref: LOCK_FILE, summary }] });
  let response;
  try {
    response = await fetcher(lockUrl, options);
  } catch (error) {
    return noLock(`The lock could not be fetched (${why(error)}), so no drift was checked.`);
  }
  if (response.status === 404 || response.status === 410) return noLock("no lock: this site publishes no plumbline.lock.json, so there is nothing to compare against.");
  if (!response.ok) return noLock(`The lock request answered HTTP ${response.status}, so no drift was checked.`);
  let lock;
  try {
    lock = JSON.parse(response.text());
  } catch {
    return noLock("The lock cannot be used: the lock file is not valid JSON, so no drift was checked.");
  }
  const problem = lockProblem(lock);
  if (problem !== null) return noLock(`The lock cannot be used: ${problem}, so no drift was checked.`);
  const lockBase = new URL("./", response.url || lockUrl).href;
  const [grounding, runtime, peers] = await Promise.all([
    detectGrounding(lock, lockBase, fetcher, options),
    detectRuntime(lock, lockBase, fetcher, options),
    Promise.all(Object.entries(lock.peers).map(([url, record]) => checkPeer(url, record, fetcher, options))).then((r) => r.flat()),
  ]);
  const unreachablePeers = peers.filter((f) => f[UNREACHABLE] === true).map((f) => f.ref);
  return { target, base, lockUrl, lockFound: true, unreachablePeers, findings: [...grounding, ...runtime, ...peers] };
}
