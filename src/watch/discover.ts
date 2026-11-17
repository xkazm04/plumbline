// What a site names right now, read from its root: the grounding files `watch --init` locks and the peers its networks
// and links.json point at. `--init` and `--relock` capture these; every watch compares them with the lock, so a new
// network file or a new partner is a finding instead of something only a manual diff would show.
//
//   grounding refs  agent-manifest.json, links.json and every `*.network.json` at the root, then every network file the
//                   manifest names (`networks[].hocon`, at exactly that path, by core's networkPathOf: the rule `sign`
//                   uses, so an unsafe one is a finding and is never read).
//   peers           read from EVERY network file above (root `*.network.json` and manifest-named ones alike): the keys
//                   of `link_labels` and the `http(s)` entries of an agent's `tools` that are not MCP endpoints; plus
//                   the `http(s)` values in links.json.
// Every file is read through readUnderRoot, so nothing outside the root's real path is read.

import { readdir } from "node:fs/promises";
import { networkPathOf, parseManifest } from "../core/signed-paths.js";
import { LINKS_FILE, MANIFEST_FILE, type DriftFinding } from "../core/types.js";
import { readUnderRoot } from "./lock.js";

export interface Discovered {
  /** Root agent files, sorted, then manifest-named network files in manifest order; each once. */
  refs: string[];
  /** Root `*.network.json` files and manifest-named network files: where peers are read from. */
  networks: string[];
  /** Every peer address, sorted, each once. */
  peers: string[];
  /** What could not be read or would not be read, each saying so. */
  findings: DriftFinding[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isHttp = (v: unknown): v is string => typeof v === "string" && /^https?:\/\//i.test(v);

function isMcp(ref: string): boolean {
  const l = ref.toLowerCase();
  return l.includes("/mcp/") || l.endsWith("/mcp") || l.includes("//mcp.") || l.includes(".mcp.");
}

async function readJson(root: string, ref: string): Promise<{ ok: true; value: unknown } | { ok: false; missing: boolean }> {
  let bytes: Uint8Array;
  try {
    bytes = await readUnderRoot(root, ref);
  } catch {
    return { ok: false, missing: true };
  }
  const value = parseManifest(bytes);
  return value === undefined ? { ok: false, missing: false } : { ok: true, value };
}

export async function discover(root: string): Promise<Discovered> {
  const findings: DriftFinding[] = [];
  const rootNames = (await readdir(root).catch(() => [] as string[]))
    .filter((n) => n === MANIFEST_FILE || n === LINKS_FILE || n.endsWith(".network.json"))
    .sort();
  // The network files the manifest names, at the path the runtime fetches. A `hocon` that is not a safe site-relative
  // path is never resolved; it is a finding that names the entry, not its text.
  const named: string[] = [];
  const manifest = await readJson(root, MANIFEST_FILE);
  const networks = manifest.ok && isObject(manifest.value) && Array.isArray(manifest.value.networks) ? manifest.value.networks : [];
  networks.forEach((entry: unknown, index: number) => {
    const hocon = isObject(entry) ? entry.hocon : undefined;
    if (typeof hocon !== "string") return;
    try {
      named.push(networkPathOf(hocon, index));
    } catch {
      findings.push({
        kind: "grounding",
        severity: "warn",
        ref: MANIFEST_FILE,
        summary: `A network file could not be locked: the manifest's networks[${index}].hocon is not a safe site-relative path, so it was not read.`,
      });
    }
  });
  const refs = [...new Set([...rootNames, ...named])];
  const networkRefs = [...new Set([...rootNames.filter((n) => n.endsWith(".network.json")), ...named])];

  const peers = new Set<string>();
  for (const ref of networkRefs) {
    const network = await readJson(root, ref);
    if (!network.ok) {
      // a missing named file is the grounding check's finding; a file that is there and not JSON hides its peers
      if (!network.missing) {
        findings.push({ kind: "peer", severity: "warn", ref, summary: "A network file is not JSON, so the peers it names could not be collected." });
      }
      continue;
    }
    const value = network.value;
    if (!isObject(value)) continue;
    if (isObject(value.link_labels)) for (const k of Object.keys(value.link_labels)) if (isHttp(k)) peers.add(k);
    if (Array.isArray(value.tools)) {
      for (const agent of value.tools) {
        if (!isObject(agent) || !Array.isArray(agent.tools)) continue;
        for (const t of agent.tools) if (isHttp(t) && !isMcp(t)) peers.add(t);
      }
    }
  }
  const links = await readJson(root, LINKS_FILE);
  if (links.ok && isObject(links.value) && isObject(links.value.networks)) {
    for (const group of Object.values(links.value.networks)) if (isObject(group)) for (const v of Object.values(group)) if (isHttp(v)) peers.add(v);
  }
  return { refs, networks: networkRefs, peers: [...peers].sort(), findings };
}
