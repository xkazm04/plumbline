// The three drift detectors. Each returns findings and never throws: a thing that cannot be read is a finding, not
// silence and not a crash. Severity rules (docs/gate-and-watch.md):
//   grounding  changed or unreadable source: warn.
//   runtime    changed or missing vendored file: block (copy-do-not-change); upstream ahead or unreachable: info.
//   peer       changed definition, a links.json that appeared, changed or went away, or a changed signer kid: block;
//              unreachable, or links.json not checkable: warn.

import { readFile } from "node:fs/promises";
import { KID_PATTERN, PEER_LINKS_ABSENT, type DriftFinding, type PlumblineLock } from "../core/types.js";
import { hashBytes } from "../net/canonical.js";
import { locatePeerFile, type Fetcher } from "../net/locate.js";
import { SafeFetchError, type SafeFetchOptions } from "../net/safe-fetch.js";
import { UPSTREAM_COMMITS_URL, UPSTREAM_REPO, short, underRoot } from "./lock.js";

export interface DetectorEnv {
  root: string;
  fetch: Fetcher;
  fetchOptions: SafeFetchOptions;
  upstreamUrl?: string;
}

export const why = (error: unknown): string => {
  if (error instanceof SafeFetchError) {
    switch (error.code) {
      case "timeout":
        return "the request timed out";
      case "body-too-large":
        return "the response was over the byte ceiling";
      case "blocked-address":
        return "the address is private or loopback, which Plumbline refuses to contact";
      case "insecure-scheme":
        return "the address is not https";
      case "dns-failed":
        return "the name did not resolve";
      case "too-many-redirects":
        return "it redirected too many times";
      case "bad-url":
        return "it is not a valid URL";
      case "network":
        return "the connection failed";
    }
  }
  return "it could not be read";
};

const get = (env: DetectorEnv, url: string, extra: SafeFetchOptions = {}) => env.fetch(url, { ...env.fetchOptions, ...extra });

/**
 * The state of a peer's `links.json` at its site base: the SHA-256 of its exact bytes, or PEER_LINKS_ABSENT when the
 * peer answers 404 or 410. The runtime fetches it for every peer network it loads and lays it over that network's
 * links, so it is as much the peer's code as its network definition. Throws a sentence-bearing Error ("it ...") when
 * it cannot be read.
 */
export async function peerLinksState(env: DetectorEnv, base: string): Promise<string> {
  let response;
  try {
    response = await get(env, `${base}links.json`);
  } catch (error) {
    throw new Error(`could not be fetched (${why(error)})`);
  }
  if (response.status === 404 || response.status === 410) return PEER_LINKS_ABSENT;
  if (!response.ok) throw new Error(`answered HTTP ${response.status}`);
  return hashBytes(response.bytes);
}

/** Hashes a local file under the root, or an https document through safeFetch. Throws a sentence-bearing Error when unreadable. */
export async function hashRef(env: DetectorEnv, ref: string): Promise<string> {
  if (/^https?:\/\//i.test(ref)) {
    let response;
    try {
      response = await get(env, ref);
    } catch (error) {
      throw new Error(`could not be fetched (${why(error)})`);
    }
    if (!response.ok) throw new Error(`could not be fetched (HTTP ${response.status})`);
    return hashBytes(response.bytes);
  }
  return hashLocal(env, ref);
}

/** Hashes a local file under the root. Throws an Error whose message completes the sentence "it ...". */
export async function hashLocal(env: DetectorEnv, ref: string): Promise<string> {
  const full = underRoot(env.root, ref);
  if (full === null) throw new Error("is outside the site root, so it was not read");
  try {
    return await hashBytes(new Uint8Array(await readFile(full)));
  } catch (error) {
    throw new Error((error as NodeJS.ErrnoException).code === "ENOENT" ? "was not found" : "could not be read");
  }
}

export async function detectGrounding(lock: PlumblineLock, env: DetectorEnv): Promise<DriftFinding[]> {
  const out: DriftFinding[] = [];
  for (const source of lock.grounding.sources) {
    let actual: string;
    try {
      actual = await hashRef(env, source.ref);
    } catch (error) {
      out.push({
        kind: "grounding",
        severity: "warn",
        ref: source.ref,
        expected: source.sha256,
        summary: `A grounding source could not be checked: it ${(error as Error).message}.`,
      });
      continue;
    }
    if (actual !== source.sha256) {
      out.push({
        kind: "grounding",
        severity: "warn",
        ref: source.ref,
        expected: source.sha256,
        actual,
        summary: "A grounding source changed since the lock was written; the agent now answers from different facts.",
      });
    }
  }
  return out;
}

export async function detectRuntime(lock: PlumblineLock, env: DetectorEnv): Promise<DriftFinding[]> {
  const out: DriftFinding[] = [];
  // (a) the vendored runtime is copy-do-not-change, so any difference is a block.
  for (const [file, expected] of Object.entries(lock.runtime.files)) {
    let actual: string;
    try {
      actual = await hashLocal(env, file);
    } catch (error) {
      const message = (error as Error).message;
      out.push({
        kind: "runtime",
        severity: "block",
        ref: file,
        expected,
        summary: message.startsWith("was not found")
          ? "A vendored runtime file is missing; the runtime is copy-do-not-change."
          : `A vendored runtime file could not be checked: it ${message}.`,
      });
      continue;
    }
    if (actual !== expected) {
      out.push({
        kind: "runtime",
        severity: "block",
        ref: file,
        expected,
        actual,
        summary: "A vendored runtime file differs from the locked copy; the runtime is copy-do-not-change.",
      });
    }
  }
  // (b) ask GitHub for the newest upstream commit. Failure to ask is info, never silence and never block.
  out.push(...(await detectUpstream(lock, env)));
  return out;
}

async function detectUpstream(lock: PlumblineLock, env: DetectorEnv): Promise<DriftFinding[]> {
  const url = env.upstreamUrl ?? UPSTREAM_COMMITS_URL;
  const couldNot = (reason: string): DriftFinding[] => [
    { kind: "runtime", severity: "info", ref: UPSTREAM_REPO, summary: `Could not check upstream: ${reason}.` },
  ];
  let response;
  try {
    response = await get(env, url, { headers: { accept: "application/vnd.github+json" } });
  } catch (error) {
    return couldNot(why(error));
  }
  if (response.status === 403 || response.status === 429) {
    const reset = response.headers["x-ratelimit-reset"];
    const limited = response.status === 429 || response.headers["x-ratelimit-remaining"] === "0" || response.headers["retry-after"] !== undefined;
    return couldNot(limited ? `GitHub rate-limited the request${reset ? ` until epoch ${reset}` : ""}` : "GitHub refused the request (HTTP 403)");
  }
  if (!response.ok) return couldNot(`GitHub answered HTTP ${response.status}`);
  let sha: unknown;
  try {
    const parsed: unknown = JSON.parse(response.text());
    sha = Array.isArray(parsed) ? (parsed[0] as { sha?: unknown } | undefined)?.sha : undefined;
  } catch {
    sha = undefined;
  }
  if (typeof sha !== "string" || !/^[0-9a-f]{7,40}$/.test(sha)) return couldNot("GitHub's answer was not a commit listing");
  const locked = lock.runtime.commit;
  if (!/^[0-9a-f]{7,40}$/.test(locked)) {
    return [
      {
        kind: "runtime",
        severity: "info",
        ref: UPSTREAM_REPO,
        actual: short(sha),
        summary: `The lock records no runtime commit, so upstream cannot be compared; the newest upstream commit is ${short(sha)}.`,
      },
    ];
  }
  if (sha.startsWith(locked) || locked.startsWith(sha)) return [];
  return [
    {
      kind: "runtime",
      severity: "info",
      ref: UPSTREAM_REPO,
      expected: short(locked),
      actual: short(sha),
      summary: `Upstream is ahead: the lock holds ${short(locked)} and the newest upstream commit is ${short(sha)}.`,
    },
  ];
}

export async function detectPeers(lock: PlumblineLock, env: DetectorEnv): Promise<DriftFinding[]> {
  const results = await Promise.all(Object.entries(lock.peers).map(([url, record]) => checkPeer(url, record, env)));
  return results.flat();
}

async function checkPeer(url: string, record: PlumblineLock["peers"][string], env: DetectorEnv): Promise<DriftFinding[]> {
  const out: DriftFinding[] = [];
  let located;
  let response;
  try {
    located = await locatePeerFile(url, env.fetch, env.fetchOptions);
    response = await get(env, located.fileUrl);
  } catch (error) {
    return [{ kind: "peer", severity: "warn", ref: url, summary: `A peer could not be reached (${why(error)}), so it was not checked.` }];
  }
  if (!response.ok) {
    return [{ kind: "peer", severity: "warn", ref: url, summary: `A peer's network definition answered HTTP ${response.status}, so it was not checked.` }];
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
  // The peer's links.json: the runtime lays it over the peer network's links, so one that appears, changes or goes
  // away changes what the peer does. A lock written before links were tracked has no record: say so, never pass.
  if (record.links === undefined) {
    out.push({
      kind: "peer",
      severity: "warn",
      ref: url,
      summary: "The lock does not record this peer's links.json, so a links file it adds or changes is not seen; re-lock to track it.",
    });
  } else {
    let links: string | undefined;
    try {
      links = await peerLinksState(env, located.base);
    } catch (error) {
      out.push({ kind: "peer", severity: "warn", ref: url, summary: `A peer's links.json could not be checked: it ${(error as Error).message}.` });
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
  // The peer's signer, when it publishes a plumbline.signature.json. Only the kid is compared here; verifying the
  // signature needs a trust store, which is the verifier's job (src/core).
  let kid: string | undefined;
  let signatureProblem: string | undefined;
  try {
    const sig = await get(env, `${located.base}plumbline.signature.json`);
    if (sig.ok) {
      try {
        const parsed = JSON.parse(sig.text()) as { kid?: unknown };
        // a kid outside its exact pattern is treated as none: a stranger's string never reaches a finding
        if (typeof parsed.kid === "string" && KID_PATTERN.test(parsed.kid)) kid = parsed.kid;
        else signatureProblem = "its plumbline.signature.json has no valid kid";
      } catch {
        signatureProblem = "its plumbline.signature.json is not valid JSON";
      }
    } else if (sig.status !== 404 && sig.status !== 410) signatureProblem = `its signature request answered HTTP ${sig.status}`;
  } catch (error) {
    signatureProblem = `its signature could not be fetched (${why(error)})`;
  }
  if (kid !== undefined && record.kid !== undefined && kid !== record.kid) {
    out.push({
      kind: "peer",
      severity: "block",
      ref: url,
      expected: record.kid,
      actual: kid,
      summary: "A peer is now signed by a different key than the one the lock recorded.",
    });
  } else if (kid !== undefined && record.kid === undefined) {
    out.push({ kind: "peer", severity: "info", ref: url, actual: kid, summary: "A peer that was unsigned when locked now publishes a signature; re-lock to record its key." });
  } else if (kid === undefined && record.kid !== undefined) {
    out.push({
      kind: "peer",
      severity: "warn",
      ref: url,
      expected: record.kid,
      summary: `A peer that was signed when locked no longer shows a usable signature${signatureProblem ? ` (${signatureProblem})` : " (none is published)"}.`,
    });
  }
  return out;
}
