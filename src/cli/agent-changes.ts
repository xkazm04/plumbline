// How `agent relock` words what a new lock changes for each server: tool counts; for a stdio server's pending file, the
// names of tools added and changed (the caller's own servers, for its own terminal, through printable), which defining
// keys changed (`description`, `inputSchema`, ...: never the text, which is in the committed definitions file), and the
// marks for a harder look (D-9) with a count. A remote (http) server's tool names are never printed: its review is
// counts and key names only.

import { toolsParts } from "../core/agent-tools.js";
import type { AgentLock } from "../core/types.js";
import { type Built, type ServerChange } from "../agent/build.js";
import { changedKeys, readDefinitions, toolMarks, type ToolMark } from "../agent/definitions.js";
import { printable } from "./diff-command.js";

const SOURCE_WORDS: Record<ServerChange["source"], string> = {
  pending: "from what the guard saw",
  listed: "listed now",
  kept: "kept from the earlier lock",
  none: "not yet observed",
};

/** One tool a relock adds or changes: its name (raw: printed only through printable, only for pending), its marks, and for a changed tool the defining keys that changed (absent when there was no earlier definitions file to compare). */
export interface ReviewedTool {
  name: string;
  marks: ToolMark[];
  keys?: string[];
}

export interface ServerReview {
  added: ReviewedTool[];
  changed: ReviewedTool[];
}

/**
 * The review of each server whose tools this build observed (Built.definitions): which tools are added or changed
 * against the earlier lock (the same baseline as the change counts in build.ts: the earlier record under this name when
 * its transport is the same, even for another command or address, so a version bump reads as the tools it changed),
 * their marks, and the changed keys against the committed definitions file. Reads the
 * definitions files, so it runs BEFORE writeDefinitions replaces them.
 */
export async function reviewServers(root: string, old: AgentLock, built: Built): Promise<Record<string, ServerReview>> {
  const reviews: Record<string, ServerReview> = {};
  for (const [server, after] of Object.entries(built.definitions)) {
    const prev = old.mcp?.[server];
    const now = built.lock.mcp?.[server];
    const held = prev !== undefined && now !== undefined && prev.transport === now.transport ? (prev.tools ?? {}) : {};
    const accepted = await readDefinitions(root, server);
    const keys = changedKeys(accepted, after);
    // the accepted definition of a changed tool, by name (a repeated name: its first occurrence), for `escalated`
    const acceptedByName = new Map<string, Record<string, unknown>>();
    for (const t of accepted ?? []) if (typeof t.name === "string" && !acceptedByName.has(t.name)) acceptedByName.set(t.name, t);
    const review: ServerReview = { added: [], changed: [] };
    for (const part of (await toolsParts(after)).parts) {
      const tool = after[part.index]!;
      const name = tool.name as string;
      if (!Object.hasOwn(held, part.key)) review.added.push({ name, marks: toolMarks(tool) });
      else if (held[part.key] !== part.definition) review.changed.push({ name, marks: toolMarks(tool, acceptedByName.get(name)), ...(keys[name] !== undefined ? { keys: keys[name] } : {}) });
    }
    reviews[server] = review;
  }
  return reviews;
}

const marksText = (t: ReviewedTool): string => (t.marks.length > 0 ? `marked: ${t.marks.join(", ")}` : "");

function namedTool(t: ReviewedTool): string {
  const notes = [...(t.keys !== undefined && t.keys.length > 0 ? [t.keys.join(", ")] : []), ...(t.marks.length > 0 ? [marksText(t)] : [])];
  return notes.length > 0 ? `${printable(t.name)} [${notes.join("; ")}]` : printable(t.name);
}

function markedCount(tools: readonly ReviewedTool[], what: string): string | undefined {
  const marked = tools.filter((t) => t.marks.length > 0).length;
  if (marked === 0) return undefined;
  return `    ${marked} of ${tools.length} ${what} tool${tools.length === 1 ? "" : "s"} ${marked === 1 ? "is" : "are"} marked for a harder look.`;
}

/** Per changed key, how many changed tools it differs in, as `description (2 tools), inputSchema (1 tool)`. */
function keyCounts(changed: readonly ReviewedTool[]): string | undefined {
  const counts = new Map<string, number>();
  for (const t of changed) for (const k of t.keys ?? []) counts.set(k, (counts.get(k) ?? 0) + 1);
  if (counts.size === 0) return undefined;
  return [...counts].map(([k, n]) => `${k} (${n} tool${n === 1 ? "" : "s"})`).join(", ");
}

/** The lines relock prints for one server: the counts line, then (when any) how many added or changed tools are marked. */
export function serverLines(s: ServerChange, review?: ServerReview): string[] {
  const base = `  server ${s.server} (${SOURCE_WORDS[s.source]}): tools ${s.added} added, ${s.removed} removed, ${s.changed} changed`;
  const lines: string[] = [];
  if (s.source === "pending") {
    const added = review?.added.map(namedTool) ?? (s.addedNames ?? []).map(printable);
    const changed = review?.changed.map(namedTool) ?? (s.changedNames ?? []).map(printable);
    const names = [...(added.length > 0 ? [`added ${added.join(", ")}`] : []), ...(changed.length > 0 ? [`changed ${changed.join(", ")}`] : [])];
    lines.push(names.length > 0 ? `${base} (${names.join("; ")})` : base);
  } else {
    lines.push(base);
    const keys = review !== undefined ? keyCounts(review.changed) : undefined;
    if (keys !== undefined) lines.push(`    changed keys: ${keys}`);
  }
  if (review !== undefined) {
    for (const line of [markedCount(review.added, "added"), markedCount(review.changed, "changed")]) if (line !== undefined) lines.push(line);
  }
  return lines;
}
