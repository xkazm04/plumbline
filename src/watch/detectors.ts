// The watch's Node driver: it reads files under the root and fetches through safeFetch, and decide.ts says what each
// read means. Each detector returns findings and never throws: a thing that cannot be read is a finding, not silence
// and not a crash. Severity rules: decide.ts and docs/gate-and-watch.md.

import { SIGNATURE_FILE, PEER_LINKS_ABSENT, type DriftFinding, type PeerRecord } from "../core/types.js";
import { hashBytes } from "../net/canonical.js";
import { describeFetchError } from "../net/fetch-types.js";
import { locatePeerFile, type Fetcher } from "../net/locate.js";
import type { SafeFetchOptions } from "../net/safe-fetch.js";
import {
  coverageFindings,
  groundingFinding,
  isRuntimeVia,
  peerFindings,
  pendingPeerFindings,
  readSignatureKid,
  runtimeFinding,
  signatureExpiryFinding,
  type LinksRead,
  type Lock,
  type Observed,
  type PeerObservation,
  type SignatureRead,
} from "./decide.js";
import { discover } from "./discover.js";
import { ReadProblem, UPSTREAM_COMMITS_URL, UPSTREAM_REPO, readUnderRoot, short, viaCommitsUrl } from "./lock.js";

export interface DetectorEnv {
  root: string;
  fetch: Fetcher;
  fetchOptions: SafeFetchOptions;
  upstreamUrl?: string;
  now: Date;
}

/** The fetch-error sentence the watch puts in parentheses (the shared table in net/fetch-types). */
export const why = (error: unknown): string => describeFetchError(error, "it could not be read");

const get = (env: DetectorEnv, url: string, extra: SafeFetchOptions = {}) => env.fetch(url, { ...env.fetchOptions, ...extra });

/**
 * The state of a peer's `links.json` at its site base: the SHA-256 of its exact bytes, or PEER_LINKS_ABSENT when the
 * peer answers 404 or 410. The runtime fetches it for every peer network it loads and lays it over that network's
 * links, so it is as much the peer's code as its network definition.
 */
export async function readPeerLinks(env: DetectorEnv, base: string): Promise<LinksRead> {
  let response;
  try {
    response = await get(env, `${base}links.json`);
  } catch (error) {
    return { problem: `could not be fetched (${why(error)})` };
  }
  if (response.status === 404 || response.status === 410) return { state: PEER_LINKS_ABSENT };
  if (!response.ok) return { problem: `answered HTTP ${response.status}` };
  return { state: await hashBytes(response.bytes) };
}

/** A peer's signer kid, by the one rule init and the watch share (decide.ts readSignatureKid). */
export async function peerKid(env: DetectorEnv, base: string): Promise<SignatureRead> {
  try {
    const sig = await get(env, `${base}${SIGNATURE_FILE}`);
    return readSignatureKid({ status: sig.status, text: sig.ok ? sig.text() : "" });
  } catch (error) {
    return readSignatureKid({ error: why(error) });
  }
}

/** Hashes a local file under the root. Throws a ReadProblem whose message completes the sentence "it ...". */
export async function hashLocal(env: DetectorEnv, ref: string): Promise<string> {
  return hashBytes(await readUnderRoot(env.root, ref));
}

/** Hashes a local file under the root, or an https document through safeFetch. Throws an Error ("it ...") when unreadable. */
export async function hashRef(env: DetectorEnv, ref: string): Promise<string> {
  const seen = await observeRef(env, ref);
  if (!seen.ok) throw new ReadProblem(seen.sentence, seen.missing);
  return seen.sha256;
}

async function observeLocal(env: DetectorEnv, ref: string): Promise<Observed> {
  try {
    return { ok: true, sha256: await hashLocal(env, ref) };
  } catch (error) {
    const problem = error instanceof ReadProblem ? error : new ReadProblem("could not be read");
    return { ok: false, missing: problem.missing, sentence: problem.message };
  }
}

async function observeRef(env: DetectorEnv, ref: string): Promise<Observed> {
  if (!/^https?:\/\//i.test(ref)) return observeLocal(env, ref);
  let response;
  try {
    response = await get(env, ref);
  } catch (error) {
    return { ok: false, missing: false, sentence: `could not be fetched (${why(error)})` };
  }
  if (!response.ok) return { ok: false, missing: false, sentence: `could not be fetched (HTTP ${response.status})` };
  return { ok: true, sha256: await hashBytes(response.bytes) };
}

export async function detectGrounding(lock: Lock, env: DetectorEnv): Promise<DriftFinding[]> {
  const out: DriftFinding[] = [];
  for (const source of lock.grounding.sources) {
    const finding = groundingFinding(source, await observeRef(env, source.ref));
    if (finding) out.push(finding);
  }
  return out;
}

export async function detectRuntime(lock: Lock, env: DetectorEnv): Promise<DriftFinding[]> {
  const out: DriftFinding[] = [];
  // (a) the vendored runtime is copy-do-not-change, so any difference is a block.
  for (const [file, expected] of Object.entries(lock.runtime.files)) {
    const finding = runtimeFinding(file, expected, await observeLocal(env, file));
    if (finding) out.push(finding);
  }
  // (b) ask GitHub whether the runtime's source moved on. Failure to ask is info, never silence and never block.
  out.push(...(await detectUpstream(lock, env)));
  return out;
}

/** The newest commit a GitHub listing names, or why it could not be read. */
async function newestCommit(env: DetectorEnv, url: string): Promise<{ sha: string } | { reason: string }> {
  let response;
  try {
    response = await get(env, url, { headers: { accept: "application/vnd.github+json" } });
  } catch (error) {
    return { reason: why(error) };
  }
  if (response.status === 403 || response.status === 429) {
    const reset = response.headers["x-ratelimit-reset"];
    const limited = response.status === 429 || response.headers["x-ratelimit-remaining"] === "0" || response.headers["retry-after"] !== undefined;
    return { reason: limited ? `GitHub rate-limited the request${reset ? ` until epoch ${reset}` : ""}` : "GitHub refused the request (HTTP 403)" };
  }
  if (!response.ok) return { reason: `GitHub answered HTTP ${response.status}` };
  let sha: unknown;
  try {
    const parsed: unknown = JSON.parse(response.text());
    sha = Array.isArray(parsed) ? (parsed[0] as { sha?: unknown } | undefined)?.sha : undefined;
  } catch {
    sha = undefined;
  }
  if (typeof sha !== "string" || !/^[0-9a-f]{7,40}$/.test(sha)) return { reason: "GitHub's answer was not a commit listing" };
  return { sha };
}

/**
 * Which upstream the runtime check asks. A lock whose runtime records `via` (the repository the copy was really taken
 * from: for the Desk, cognizant-ai-labs/agentic-web's skills/agentify-website/runtime, see site/runtime/NOTICE) is
 * checked against that folder: the newest commit that touched it now, against the newest that had touched it at the
 * copied commit. Equal means the folder has not changed since the copy, whatever else the repository did. A lock with
 * no `via` is checked against nsdeploy's newest commit, as before.
 */
async function detectUpstream(lock: Lock, env: DetectorEnv): Promise<DriftFinding[]> {
  const via = lock.runtime.via;
  if (via !== undefined && isRuntimeVia(via)) {
    const couldNot = (reason: string): DriftFinding[] => [{ kind: "runtime", severity: "info", ref: via.repo, summary: `Could not check upstream: ${reason}.` }];
    const [now, atCopy] = await Promise.all([newestCommit(env, viaCommitsUrl(via)), newestCommit(env, viaCommitsUrl(via, via.commit))]);
    if ("reason" in now) return couldNot(now.reason);
    if ("reason" in atCopy) return couldNot(atCopy.reason);
    if (now.sha === atCopy.sha) return [];
    return [
      {
        kind: "runtime",
        severity: "info",
        ref: via.repo,
        expected: short(via.commit),
        actual: short(now.sha),
        summary: `Upstream is ahead: the runtime folder in ${via.repo} changed after the copy (copied at ${short(via.commit)}; the folder's newest commit is ${short(now.sha)}).`,
      },
    ];
  }
  const couldNot = (reason: string): DriftFinding[] => [{ kind: "runtime", severity: "info", ref: UPSTREAM_REPO, summary: `Could not check upstream: ${reason}.` }];
  const newest = await newestCommit(env, env.upstreamUrl ?? UPSTREAM_COMMITS_URL);
  if ("reason" in newest) return couldNot(newest.reason);
  const { sha } = newest;
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

/** What the watch sees of one peer now: its definition, its links.json (when the lock records it) and its signer. */
async function observePeer(url: string, record: PeerRecord, env: DetectorEnv): Promise<PeerObservation> {
  let located;
  let response;
  try {
    located = await locatePeerFile(url, env.fetch, env.fetchOptions);
    response = await get(env, located.fileUrl);
  } catch (error) {
    return { definition: { ok: false, reason: why(error) }, signature: { none: true } };
  }
  if (!response.ok) return { definition: { ok: false, status: response.status }, signature: { none: true } };
  const sha256 = await hashBytes(response.bytes);
  const links = record.links !== undefined ? await readPeerLinks(env, located.base) : undefined;
  const signature = await peerKid(env, located.base);
  return { definition: { ok: true, sha256 }, ...(links !== undefined ? { links } : {}), signature };
}

export async function detectPeers(lock: Lock, env: DetectorEnv): Promise<DriftFinding[]> {
  const results = await Promise.all(
    Object.entries(lock.peers).map(async ([url, record]) => peerFindings(url, record, await observePeer(url, record, env))),
  );
  return [...results.flat(), ...pendingPeerFindings(lock)];
}

/** What the site names now that the lock does not cover (decide.ts coverageFindings), plus what could not be read to tell. */
export async function detectCoverage(lock: Lock, env: DetectorEnv): Promise<DriftFinding[]> {
  const found = await discover(env.root);
  return [...found.findings, ...coverageFindings(lock, { refs: found.refs, peers: found.peers })];
}

/** The site's own signature: warn before it expires, block once it has (decide.ts signatureExpiryFinding). */
export async function detectSignature(env: DetectorEnv): Promise<DriftFinding[]> {
  let text: string | undefined;
  try {
    text = new TextDecoder("utf-8").decode(await readUnderRoot(env.root, SIGNATURE_FILE));
  } catch (error) {
    if (error instanceof ReadProblem && error.missing) return [];
    return [{ kind: "grounding", severity: "warn", ref: SIGNATURE_FILE, summary: `The site's signature file could not be read to check its expiry: it ${error instanceof ReadProblem ? error.message : "could not be read"}.` }];
  }
  const finding = signatureExpiryFinding(text, env.now);
  return finding ? [finding] : [];
}
