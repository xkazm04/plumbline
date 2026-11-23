// The committed tool definitions (format version 2): `plumbline.agent.tools/<pendingFileName(server)>.json`, what the
// lock's `mcp[server].tools` hashes, so a review sees how a definition changed (docs/agent-lock.md, "Reviewing a
// relock"). Marks for a harder look (D-9). Owned by the review work; WP0 commits these signatures as stubs.

import type { AgentFinding, AgentLock } from "../core/types.js";

/** Why a tool deserves a harder look: an annotation the server sent, or its name. Advisory; never a severity. */
export const TOOL_MARKS = ["destructive", "open-world", "name"] as const;
export type ToolMark = (typeof TOOL_MARKS)[number];

/** The repository-relative definitions file of a server. */
export function definitionsPathOf(_server: string): string {
  throw new Error("definitionsPathOf is not built yet");
}

/** The accepted definitions a server's file holds, or undefined when there is none that reads as one. */
export async function readDefinitions(_root: string, _server: string): Promise<Record<string, unknown>[] | undefined> {
  return undefined;
}

/**
 * Writes one definitions file per server in `definitions` (each list sorted by name, then occurrence; pretty JSON, LF,
 * a trailing newline) and removes the files of servers `lock` no longer holds. Returns the repository-relative paths
 * written or removed, sorted.
 */
export async function writeDefinitions(_root: string, _lock: AgentLock, _definitions: Readonly<Record<string, Record<string, unknown>[]>>): Promise<string[]> {
  return [];
}

/** `definitions-mismatch` (block) and `definitions-absent` (info) findings for a lock's servers. */
export async function definitionsFindings(_root: string, _lock: AgentLock): Promise<AgentFinding[]> {
  return [];
}

/** Per tool name, the defining keys whose values differ between the accepted and the new definitions. */
export function changedKeys(_before: readonly Record<string, unknown>[] | undefined, _after: readonly Record<string, unknown>[]): Record<string, string[]> {
  return {};
}

/** The marks of one tool definition. */
export function toolMarks(_tool: Record<string, unknown>): ToolMark[] {
  return [];
}
