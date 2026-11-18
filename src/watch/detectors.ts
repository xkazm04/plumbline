// The watch's Node driver: it reads files under the root and fetches through safeFetch, and decide.ts says what each
// read means. Each detector returns findings and never throws: a thing that cannot be read is a finding, not silence
// and not a crash. Severity rules: decide.ts and docs/gate-and-watch.md.

import { join } from "node:path";
import { SIGNATURE_FILE, type DriftFinding } from "../core/types.js";
import { hashBytes } from "../net/canonical.js";
import type { Fetcher } from "../net/locate.js";
import type { SafeFetchOptions } from "../net/safe-fetch.js";
import { groundingFindingWithAnchors } from "./anchors.js";
import { externalFinding, observeExternal } from "./external.js";
import {
  addedRuntimeFinding,
  coverageFindings,
  isRuntimeVia,
  peerFindings,
  pendingPeerFindings,
  runtimeFinding,
  runtimeFolder,
  signatureExpiryFinding,
  type Lock,
  type Observed,
} from "./decide.js";
import { discover } from "./discover.js";
import { ReadProblem, UPSTREAM_COMMITS_URL, UPSTREAM_REPO, listFiles, readUnderRoot, short, toPosix, underRoot, viaCommitsUrl } from "./lock.js";
import { describeWatchError, observePeer, observePublished } from "./observe.js";

export interface DetectorEnv {
  root: string;
  fetch: Fetcher;
  fetchOptions: SafeFetchOptions;
  upstreamUrl?: string;
  now: Date;
}

/** The fetch-error sentence the watch puts in parentheses (the shared table in net/fetch-types, through observe.ts). */
export const why = describeWatchError;

const get = (env: DetectorEnv, url: string, extra: SafeFetchOptions = {}) => env.fetch(url, { ...env.fetchOptions, ...extra });

/** Hashes a local file under the root. Throws a ReadProblem whose message completes the sentence "it ...". */
export async function hashLocal(env: DetectorEnv, ref: string): Promise<string> {
  return hashBytes(await readUnderRoot(env.root, ref));
}

/** Hashes a local file under the root, or an https document through safeFetch. Throws an Error ("it ...") when unreadable. */
export async function hashRef(env: DetectorEnv, ref: string): Promise<string> {
  return (await readRef(env, ref)).sha256;
}

/** A local file under the root, or an https document through safeFetch: its hash and bytes. Throws ("it ...") when unreadable. */
export async function readRef(env: DetectorEnv, ref: string): Promise<{ sha256: string; bytes: Uint8Array }> {
  const seen = await observeRef(env, ref);
  if (!seen.ok) throw new ReadProblem(seen.sentence, seen.missing);
  return { sha256: seen.sha256, bytes: seen.bytes ?? new Uint8Array(0) };
}

async function observeLocal(env: DetectorEnv, ref: string): Promise<Observed> {
  try {
    const bytes = await readUnderRoot(env.root, ref);
    return { ok: true, sha256: await hashBytes(bytes), bytes };
  } catch (error) {
    const problem = error instanceof ReadProblem ? error : new ReadProblem("could not be read");
    return { ok: false, missing: problem.missing, sentence: problem.message };
  }
}

async function observeRef(env: DetectorEnv, ref: string): Promise<Observed> {
  if (!/^https?:\/\//i.test(ref)) return observeLocal(env, ref);
  return observePublished(env.fetch, ref, { fetchOptions: env.fetchOptions });
}

export async function detectGrounding(lock: Lock, env: DetectorEnv): Promise<DriftFinding[]> {
  const out: DriftFinding[] = [];
  for (const source of lock.grounding.sources) {
    const finding = await groundingFindingWithAnchors(source, await observeRef(env, source.ref));
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
  // (a2) and so is a file added beside the locked ones: list the locked runtime folder for what the lock does not hold.
  const folder = runtimeFolder(lock.runtime.files);
  if (folder !== null && underRoot(env.root, folder) !== null) {
    const added = (await listFiles(join(env.root, folder))).map((full) => toPosix(env.root, full)).filter((ref) => !(ref in lock.runtime.files));
    for (const ref of added.sort()) out.push(addedRuntimeFinding(ref, await observeLocal(env, ref)));
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

export async function detectPeers(lock: Lock, env: DetectorEnv): Promise<DriftFinding[]> {
  const results = await Promise.all(
    Object.entries(lock.peers).map(async ([url, record]) =>
      peerFindings(url, record, await observePeer(url, env.fetch, { fetchOptions: env.fetchOptions, links: record.links !== undefined })),
    ),
  );
  return [...results.flat(), ...pendingPeerFindings(lock)];
}

/** Each external agent definition the lock holds (external.ts): changed is block, unreadable is warn. */
export async function detectExternal(lock: Lock, env: DetectorEnv): Promise<DriftFinding[]> {
  const out: DriftFinding[] = [];
  for (const [url, record] of Object.entries(lock.external ?? {})) {
    const finding = externalFinding(url, record, await observeExternal(url, record.kind, env.fetch, { fetchOptions: env.fetchOptions }));
    if (finding) out.push(finding);
  }
  return out;
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
