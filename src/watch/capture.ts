// `watch --init`: capture the current state into a PlumblineLock. What is captured, and where it comes from:
//   runtime.files    every file under the vendored runtime folder (`runtime/`, else `site/runtime/`, or deps.runtimeDir),
//                    keyed by path relative to the root with `/` separators. Every hash here is SHA-256 of exact bytes.
//   runtime.commit   the nsdeploy commit the runtime README or NOTICE names ("nsdeploy commit `53a787c`"), else "unknown".
//   grounding        agent-manifest.json, links.json and every `*.network.json` at the root, plus deps.extraSources.
//   peers            every partner network address the root's network definitions and links.json point at: the keys of
//                    `link_labels`, `http(s)` entries in an agent's `tools` that are not MCP endpoints, and the `http(s)`
//                    values in links.json. Each is fetched through safeFetch; its hash, the hash of its links.json at
//                    the same base (or "absent" on 404/410) and its signer kid are recorded.
// Anything that cannot be captured is NOT written to the lock and comes back as a finding, so a lock with a gap is
// never mistaken for a complete one.

import { readdir, readFile } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";
import { FORMAT_VERSION, KID_PATTERN, type DriftFinding, type PlumblineLock } from "../core/types.js";
import { hashBytes } from "../net/canonical.js";
import { locatePeerFile } from "../net/locate.js";
import { SafeFetchError } from "../net/safe-fetch.js";
import { hashLocal, hashRef, peerLinksState, why, type DetectorEnv } from "./detectors.js";

const COMMIT = /nsdeploy commit\s+`?([0-9a-f]{7,40})`?/i;

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

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isHttp = (v: unknown): v is string => typeof v === "string" && /^https?:\/\//i.test(v);

function isMcp(ref: string): boolean {
  const l = ref.toLowerCase();
  return l.includes("/mcp/") || l.endsWith("/mcp") || l.includes("//mcp.") || l.includes(".mcp.");
}

export async function captureLock(
  env: DetectorEnv,
  options: { extraSources?: string[]; runtimeDir?: string; now: Date },
): Promise<{ lock: PlumblineLock; findings: DriftFinding[] }> {
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
    for (const name of ["README.md", "NOTICE", "NOTICE.md"]) {
      try {
        const found = COMMIT.exec(await readFile(join(root, runtimeRoot, name), "utf8"));
        if (found?.[1]) {
          commit = found[1];
          break;
        }
      } catch {
        // try the next candidate
      }
    }
    if (commit === "unknown") {
      findings.push({ kind: "runtime", severity: "info", ref: runtimeRoot, summary: "The runtime folder does not name an nsdeploy commit, so the lock records \"unknown\"." });
    }
  }

  // grounding
  const rootNames = (await readdir(root).catch(() => [])).filter((n) => n === "agent-manifest.json" || n === "links.json" || n.endsWith(".network.json")).sort();
  const refs = [...new Set([...rootNames, ...(options.extraSources ?? [])])];
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
  const peerUrls = new Set<string>();
  for (const name of rootNames.filter((n) => n.endsWith(".network.json"))) {
    const network = await readJson(join(root, name));
    if (!isObject(network)) continue;
    if (isObject(network.link_labels)) for (const k of Object.keys(network.link_labels)) if (isHttp(k)) peerUrls.add(k);
    if (Array.isArray(network.tools)) {
      for (const agent of network.tools) {
        if (!isObject(agent) || !Array.isArray(agent.tools)) continue;
        for (const t of agent.tools) if (isHttp(t) && !isMcp(t)) peerUrls.add(t);
      }
    }
  }
  const links = await readJson(join(root, "links.json"));
  if (isObject(links) && isObject(links.networks)) {
    for (const group of Object.values(links.networks)) if (isObject(group)) for (const v of Object.values(group)) if (isHttp(v)) peerUrls.add(v);
  }
  const peers: PlumblineLock["peers"] = {};
  for (const url of [...peerUrls].sort()) {
    try {
      const { fileUrl, base } = await locatePeerFile(url, env.fetch, env.fetchOptions);
      const response = await env.fetch(fileUrl, env.fetchOptions);
      if (!response.ok) throw new Error(`answered HTTP ${response.status}`);
      let links: string;
      try {
        links = await peerLinksState(env, base);
      } catch (error) {
        throw new Error(`its links.json ${(error as Error).message}`);
      }
      let kid: string | undefined;
      try {
        const sig = await env.fetch(`${base}plumbline.signature.json`, env.fetchOptions);
        if (sig.ok) {
          const parsed = JSON.parse(sig.text()) as { kid?: unknown };
          // a kid outside its exact pattern is not recorded: a stranger's string never reaches the lock or a finding
          if (typeof parsed.kid === "string" && KID_PATTERN.test(parsed.kid)) kid = parsed.kid;
        }
      } catch {
        // an unsigned or unreachable signature file means no kid is recorded
      }
      peers[url] = {
        sha256: await hashBytes(response.bytes),
        links,
        ...(kid !== undefined ? { kid } : {}),
        checkedAt: options.now.toISOString(),
      };
    } catch (error) {
      const detail = error instanceof SafeFetchError ? why(error) : error instanceof Error ? error.message : "it could not be fetched";
      findings.push({ kind: "peer", severity: "warn", ref: url, summary: `A peer could not be locked, so it is not in the lock (${detail}).` });
    }
  }

  return {
    lock: {
      version: FORMAT_VERSION,
      runtime: { source: "nsdeploy", commit, files },
      grounding: { sources, builtAt: options.now.toISOString() },
      peers,
    },
    findings,
  };
}
