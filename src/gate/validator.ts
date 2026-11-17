// The `validator` adapter.
//
// HONESTY NOTE. This is Plumbline's OWN port of the reference runtime's validation rules, not the reference code.
// The reference lives in cognizant-ai-labs/agentic-web (skills/agentify-website/runtime/generated/validation.gen.mjs,
// transpiled from neuro_san/kernel/validation.py, plus the manifest checks in scripts/build_network.mjs). It is a
// transpiler output that imports a sibling graph module and is not published on npm, and the repository law here is
// that we do not execute code fetched from a third party. So the rules are re-implemented below, in about a hundred
// lines, from reading those files on 2026-11-17, and the adapter's finding says "port" in its summary.
//
// What is ported, rule for rule (the spec's "parse and validate: malformed networks, duplicate or missing agent
// references, an invalid front agent", and the manifest rule that `networks[].name|front_man|hocon` are required):
//   - validate_shape: `tools` must be a non-empty array and every agent needs a `name`.
//   - validate_front_man: a front agent must exist: the first agent that has `instructions` and no `class` or
//     `toolbox`, else the first agent.
//   - validate_missing_nodes: every entry in an agent's `tools` must be an MCP reference, a remote agent address, a
//     declared link slot (`link_slots`, as the browser kernel exempts them), or the name of an agent in this network.
//   - manifest: each `networks[]` entry has non-empty `name`, `front_man` and `hocon`, and `front_man` agrees with
//     the front agent found in the network (build_network.mjs checkManifest).
// What is ours and NOT in the reference rules: duplicate agent names are reported (the spec lists them; the
// reference only keeps the last), `tools` entries that are not arrays are reported, and a manifest or network file with
// duplicate keys anywhere fails: the reference runtime's HOCON reader merges them where JSON.parse keeps the last, so
// such a file means something different from what this port (or any JSON reader) sees.
// What is NOT ported: HOCON parsing, `{token}` replacement-string expansion before validation, partner checks, the
// action-tool checks, and every check Agent Atlas and Agent Customs run (those are their adapters).
//
// Findings carry codes, and the summary is built from the codes and counts only: an inspected site's own words
// (agent names, references) are never copied into a summary.

import { countDuplicateKeys } from "../core/json-keys.js";

export type IssueCode =
  | "duplicate-keys"
  | "manifest-no-networks"
  | "manifest-entry-incomplete"
  | "manifest-front-man-mismatch"
  | "network-not-an-object"
  | "network-no-tools-array"
  | "network-empty-tools"
  | "agent-without-name"
  | "agent-tools-not-an-array"
  | "duplicate-agent-name"
  | "no-front-agent"
  | "missing-reference";

export interface Issue {
  code: IssueCode;
  count: number;
}

const ISSUE_TEXT: Record<IssueCode, string> = {
  "duplicate-keys":
    "duplicate keys: the reference runtime merges them, so the file means something different from what a JSON reader sees",
  "manifest-no-networks": "the manifest lists no networks",
  "manifest-entry-incomplete": "a manifest network entry lacks a name, front_man or hocon",
  "manifest-front-man-mismatch": "a manifest front_man names a different agent than the network's front agent",
  "network-not-an-object": "the network definition is not a JSON object",
  "network-no-tools-array": "the network has no tools array",
  "network-empty-tools": "the network's tools array is empty",
  "agent-without-name": "an agent has no name",
  "agent-tools-not-an-array": "an agent's tools entry is not an array",
  "duplicate-agent-name": "two agents share a name",
  "no-front-agent": "the network has no front agent",
  "missing-reference": "an agent references a tool that does not exist",
};

export function describeIssues(issues: Issue[]): string {
  return issues.map((i) => `${i.count} x ${ISSUE_TEXT[i.code]}`).join("; ");
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const nameOf = (agent: unknown): string | null => (isObject(agent) && typeof agent.name === "string" ? agent.name.trim() : null);

function isMcpRef(ref: string): boolean {
  if (!ref.startsWith("http://") && !ref.startsWith("https://")) return false;
  const lowered = ref.toLowerCase();
  return lowered.includes("/mcp/") || lowered.endsWith("/mcp") || lowered.includes("//mcp.") || lowered.includes(".mcp.");
}

const isExternalAgent = (ref: string): boolean => ref.startsWith("http://") || ref.startsWith("https://") || ref.startsWith("/");

/** The front agent's name by the reference's rule, or null when the network has none. */
export function findFrontAgent(config: Json): string | null {
  const tools = config.tools;
  if (!Array.isArray(tools)) return null;
  for (const agent of tools) {
    if (isObject(agent) && agent.instructions && !agent.class && !agent.toolbox) return nameOf(agent);
  }
  return tools.length > 0 ? nameOf(tools[0]) : null;
}

/** Validates one parsed network definition. An empty result means the ported rules found nothing wrong. */
export function validateNetworkDefinition(config: unknown): Issue[] {
  const counts = new Map<IssueCode, number>();
  const add = (code: IssueCode): void => void counts.set(code, (counts.get(code) ?? 0) + 1);
  if (!isObject(config)) {
    add("network-not-an-object");
    return flatten(counts);
  }
  const tools = config.tools;
  if (!Array.isArray(tools)) {
    add("network-no-tools-array");
    return flatten(counts);
  }
  if (tools.length === 0) {
    add("network-empty-tools");
    return flatten(counts);
  }
  const names = new Set<string>();
  for (const agent of tools) {
    const name = nameOf(agent);
    if (name === null || name === "") add("agent-without-name");
    else if (names.has(name)) add("duplicate-agent-name");
    else names.add(name);
  }
  const front = findFrontAgent(config);
  if (front === null || front === "") add("no-front-agent");
  const slots = isObject(config.link_slots) ? new Set(Object.keys(config.link_slots)) : new Set<string>();
  for (const agent of tools) {
    if (!isObject(agent) || agent.tools === undefined || agent.tools === null) continue;
    if (!Array.isArray(agent.tools)) {
      add("agent-tools-not-an-array");
      continue;
    }
    for (const ref of agent.tools) {
      if (typeof ref !== "string" || isMcpRef(ref)) continue;
      if (isExternalAgent(ref) && !names.has(ref)) continue;
      if (slots.has(ref) || names.has(ref)) continue;
      add("missing-reference");
    }
  }
  return flatten(counts);
}

/** The manifest rules: the entries of `networks` that apply, each with name, front_man and hocon. */
export function validateManifestEntries(manifest: unknown, requestedName?: string): Issue[] {
  const counts = new Map<IssueCode, number>();
  const add = (code: IssueCode): void => void counts.set(code, (counts.get(code) ?? 0) + 1);
  const list = isObject(manifest) ? manifest.networks : undefined;
  if (!Array.isArray(list) || list.length === 0) {
    add("manifest-no-networks");
    return flatten(counts);
  }
  for (const entry of list) {
    if (requestedName !== undefined && isObject(entry) && entry.name !== requestedName) continue;
    const complete =
      isObject(entry) &&
      ["name", "front_man", "hocon"].every((k) => typeof entry[k] === "string" && (entry[k] as string).trim() !== "");
    if (!complete) add("manifest-entry-incomplete");
  }
  return flatten(counts);
}

/** The manifest's front_man must equal the front agent the network yields (build_network.mjs checkManifest). */
export function frontManAgrees(entryFrontMan: string | undefined, config: unknown): boolean {
  if (entryFrontMan === undefined || !isObject(config)) return true;
  const front = findFrontAgent(config);
  return front === null || front === entryFrontMan;
}

/** The duplicate-key rule on a file's text (a manifest or a network definition). Text that is not JSON yields nothing. */
export function duplicateKeyIssues(text: string): Issue[] {
  let count = 0;
  try {
    count = countDuplicateKeys(text);
  } catch {
    return [];
  }
  return count > 0 ? [{ code: "duplicate-keys", count }] : [];
}

function flatten(counts: Map<IssueCode, number>): Issue[] {
  return [...counts.entries()].map(([code, count]) => ({ code, count }));
}

export function mergeIssues(...lists: Issue[][]): Issue[] {
  const counts = new Map<IssueCode, number>();
  for (const list of lists) for (const i of list) counts.set(i.code, (counts.get(i.code) ?? 0) + i.count);
  return flatten(counts);
}
