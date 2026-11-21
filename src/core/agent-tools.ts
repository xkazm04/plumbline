// MCP tool definitions as the agent lock pins them, and the one decision the guard and `agent check` share. Pure: no
// node:* imports, so it runs in Node and in a browser.
//
// A tool's definition hash is SHA-256 of canonicalJson(the tool restricted to MCP_TOOL_DEFINITION_KEYS), keyed by
// SHA-256 of its name. Names are a server's own words: they are hashed, never stored or quoted. A repeated name's later
// occurrences are keyed by SHA-256 of `name\0<n>` (n = 2, 3, ...), as the site lock keys a repeated A2A skill id
// (UAT-36), so a duplicate can neither overwrite nor hide its twin.

import { canonicalJson, sha256Hex } from "./canonical.js";
import { MCP_TOOL_DEFINITION_KEYS, type McpServerDecl } from "./types.js";

/** A tool object restricted to the keys that define it, in a fixed order; keys the server did not send are left out. */
export function toolDefinition(tool: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of MCP_TOOL_DEFINITION_KEYS) if (Object.hasOwn(tool, key) && tool[key] !== undefined) out[key] = tool[key];
  return out;
}

export interface ToolPart {
  /** SHA-256 of the name (or of `name\0<n>` for a later occurrence). */
  key: string;
  /** SHA-256 of canonicalJson(toolDefinition(tool)). */
  definition: string;
  /** The position in the list given, so a caller can map a decision back to the tool object it received. */
  index: number;
}

export interface ToolsParts {
  parts: ToolPart[];
  /** Entries that are not tools: not an object, or no string `name`. Counted, never quoted. */
  problems: number;
}

/** The parts of a tool list (every page, in order). An entry that is not an object with a string name is a problem. */
export async function toolsParts(tools: readonly unknown[]): Promise<ToolsParts> {
  const parts: ToolPart[] = [];
  const seen = new Map<string, number>();
  let problems = 0;
  for (let index = 0; index < tools.length; index++) {
    const tool = tools[index];
    if (tool === null || typeof tool !== "object" || Array.isArray(tool) || typeof (tool as Record<string, unknown>).name !== "string") {
      problems++;
      continue;
    }
    const name = (tool as Record<string, unknown>).name as string;
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    let definition: string;
    try {
      definition = await sha256Hex(canonicalJson(toolDefinition(tool as Record<string, unknown>)));
    } catch {
      problems++; // a value canonical JSON refuses (a non-finite number)
      continue;
    }
    parts.push({ key: await sha256Hex(n === 1 ? name : `${name}\u0000${n}`), definition, index });
  }
  return { parts, problems };
}

/** The `tools` record a lock holds, from parts. */
export function toolsRecord(parts: readonly ToolPart[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of parts) out[p.key] = p.definition;
  return out;
}

export interface ToolsDecision {
  /** Indexes (into the list given) of tools whose definition matches the lock: these may be shown and called. */
  pass: number[];
  /** Indexes of tools the lock holds under the same name with a different definition. */
  changed: number[];
  /** Indexes of tools the lock does not hold. */
  unpinned: number[];
  /** How many tools the lock holds that the server no longer lists. */
  removed: number;
}

/**
 * The guard's and the check's one decision: which observed tools match the approved lock. A lock with no `tools`
 * (never observed) passes nothing: every observed tool is unpinned.
 */
export function toolsDecision(locked: Readonly<Record<string, string>> | undefined, observed: readonly ToolPart[]): ToolsDecision {
  const decision: ToolsDecision = { pass: [], changed: [], unpinned: [], removed: 0 };
  const held = locked ?? {};
  const present = new Set<string>();
  for (const part of observed) {
    present.add(part.key);
    if (!Object.hasOwn(held, part.key)) decision.unpinned.push(part.index);
    else if (held[part.key] === part.definition) decision.pass.push(part.index);
    else decision.changed.push(part.index);
  }
  for (const key of Object.keys(held)) if (!present.has(key)) decision.removed++;
  return decision;
}

/** True when nothing differs: every observed tool passes and none the lock holds is missing. */
export function toolsUnchanged(decision: ToolsDecision): boolean {
  return decision.changed.length === 0 && decision.unpinned.length === 0 && decision.removed === 0;
}

/**
 * AgentMcpRecord.target: SHA-256 of canonicalJson({command, args}) for stdio (args omitted when absent) or of
 * canonicalJson({url}) for http. A different command or address is a different server, whatever its name.
 */
export async function serverTarget(server: McpServerDecl): Promise<string> {
  if (server.transport === "stdio") {
    return sha256Hex(canonicalJson(server.args === undefined ? { command: server.command } : { command: server.command, args: server.args }));
  }
  return sha256Hex(canonicalJson({ url: server.url }));
}
