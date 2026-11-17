// `watch --init` and `watch --relock`: capture the current state into a lock. What is captured, and where from:
//   runtime.files    every file under the vendored runtime folder (`runtime/`, else `site/runtime/`, or deps.runtimeDir),
//                    keyed by path relative to the root with `/` separators. Every hash here is SHA-256 of exact bytes.
//   runtime.commit   the nsdeploy commit the runtime README or NOTICE names ("nsdeploy commit `53a787c`"), else "unknown".
//   runtime.via      when the NOTICE or README says the copy was taken from another repository's folder
//                    ("<owner>/<repo> `<path>` at commit <sha>", as site/runtime/NOTICE does for agentic-web), that
//                    repository, folder and commit; omitted otherwise. The upstream check then asks that folder.
//   grounding        what discover.ts names (the root's agent files and every manifest-named network file), plus
//                    the extra sources (--source, and on --relock every ref the previous lock held).
//   peers            every peer discover.ts names, fetched through safeFetch: the hash of its network definition, the
//                    state of its links.json and its signer kid. A peer that cannot be captured goes into
//                    `pendingPeers` with the time, and every watch reports it until a re-lock fills it in.
// Anything else that cannot be captured is NOT written to the lock and comes back as a finding, so a lock with a gap
// is never mistaken for a complete one.

import { readdir } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";
import { FORMAT_VERSION, type DriftFinding } from "../core/types.js";
import { hashBytes } from "../net/canonical.js";
import { locatePeerFile } from "../net/locate.js";
import { SafeFetchError } from "../net/safe-fetch.js";
import type { Lock, PendingPeer, RuntimeVia } from "./decide.js";
import { hashLocal, hashRef, peerKid, readPeerLinks, why, type DetectorEnv } from "./detectors.js";
import { discover } from "./discover.js";
import { readUnderRoot } from "./lock.js";

const COMMIT = /nsdeploy commit\s+`?([0-9a-f]{7,40})`?/i;
/** "cognizant-ai-labs/agentic-web `skills/agentify-website/runtime` at commit 7817c1f..." (site/runtime/NOTICE). */
const VIA = /\b([A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100})\s+`([A-Za-z0-9._/-]+)`\s+at commit\s+`?([0-9a-f]{7,40})\b/;

async function listFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(full)));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

const toPosix = (root: string, full: string): string => relative(root, full).split(sep).join(posix.sep);

/** The nsdeploy commit and, when there is one, the repository folder the runtime copy was really taken from. */
export function runtimeProvenance(texts: string[]): { commit?: string; via?: RuntimeVia } {
  let commit: string | undefined;
  let via: RuntimeVia | undefined;
  for (const text of texts) {
    commit ??= COMMIT.exec(text)?.[1];
    const found = VIA.exec(text);
    if (via === undefined && found?.[1] && found[2] && found[3] && !found[2].split("/").some((s) => s === "" || s === "." || s === "..")) {
      via = { repo: found[1], path: found[2], commit: found[3] };
    }
  }
  return { ...(commit !== undefined ? { commit } : {}), ...(via !== undefined ? { via } : {}) };
}

export async function captureLock(
  env: DetectorEnv,
  options: { extraSources?: string[]; runtimeDir?: string; now: Date },
): Promise<{ lock: Lock; findings: DriftFinding[] }> {
  const findings: DriftFinding[] = [];
  const { root } = env;

  // runtime
  let runtimeRoot: string | undefined;
  for (const candidate of options.runtimeDir !== undefined ? [options.runtimeDir] : ["runtime", "site/runtime"]) {
    if ((await listFiles(join(root, candidate))).length > 0) {
      runtimeRoot = candidate;
      break;
    }
  }
  const files: Record<string, string> = {};
  let commit = "unknown";
  let via: RuntimeVia | undefined;
  if (runtimeRoot === undefined) {
    findings.push({ kind: "runtime", severity: "info", ref: "runtime", summary: "No vendored runtime folder was found, so no runtime files were locked." });
  } else {
    for (const full of (await listFiles(join(root, runtimeRoot))).sort()) {
      const ref = toPosix(root, full);
      try {
        files[ref] = await hashLocal(env, ref);
      } catch (error) {
        findings.push({ kind: "runtime", severity: "warn", ref, summary: `A runtime file could not be locked: it ${(error as Error).message}.` });
      }
    }
    const texts: string[] = [];
    for (const name of ["README.md", "NOTICE", "NOTICE.md"]) {
      try {
        texts.push(new TextDecoder("utf-8").decode(await readUnderRoot(root, `${runtimeRoot}/${name}`)));
      } catch {
        // try the next candidate
      }
    }
    const provenance = runtimeProvenance(texts);
    if (provenance.commit !== undefined) commit = provenance.commit;
    via = provenance.via;
    if (commit === "unknown") {
      findings.push({ kind: "runtime", severity: "info", ref: runtimeRoot, summary: "The runtime folder does not name an nsdeploy commit, so the lock records \"unknown\"." });
    }
  }

  // grounding
  const found = await discover(root);
  findings.push(...found.findings);
  const refs = [...new Set([...found.refs, ...(options.extraSources ?? [])])];
  const sources: { ref: string; sha256: string }[] = [];
  for (const ref of refs) {
    try {
      sources.push({ ref, sha256: await hashRef(env, ref) });
    } catch (error) {
      findings.push({ kind: "grounding", severity: "warn", ref, summary: `A grounding source could not be locked: it ${(error as Error).message}.` });
    }
  }
  if (refs.length === 0) {
    findings.push({ kind: "grounding", severity: "info", ref: ".", summary: "No grounding sources were found at the root; pass --source to lock some." });
  }

  // peers
  const peers: Lock["peers"] = {};
  const pendingPeers: Record<string, PendingPeer> = {};
  for (const url of found.peers) {
    try {
      const { fileUrl, base } = await locatePeerFile(url, env.fetch, env.fetchOptions);
      const response = await env.fetch(fileUrl, env.fetchOptions);
      if (!response.ok) throw new Error(`answered HTTP ${response.status}`);
      const links = await readPeerLinks(env, base);
      if ("problem" in links) throw new Error(`its links.json ${links.problem}`);
      const signature = await peerKid(env, base);
      peers[url] = {
        sha256: await hashBytes(response.bytes),
        links: links.state,
        ...("kid" in signature ? { kid: signature.kid } : {}),
        checkedAt: options.now.toISOString(),
      };
    } catch (error) {
      const detail = error instanceof SafeFetchError ? why(error) : error instanceof Error ? error.message : "it could not be fetched";
      pendingPeers[url] = { since: options.now.toISOString() };
      findings.push({ kind: "peer", severity: "warn", ref: url, summary: `A peer could not be captured, so the lock holds it as pending and every watch reports it (${detail}).` });
    }
  }

  return {
    lock: {
      version: FORMAT_VERSION,
      runtime: { source: "nsdeploy", commit, files, ...(via !== undefined ? { via } : {}) },
      grounding: { sources, builtAt: options.now.toISOString() },
      peers,
      ...(Object.keys(pendingPeers).length > 0 ? { pendingPeers } : {}),
    },
    findings,
  };
}
