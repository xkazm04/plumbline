// The committed tool definitions (format version 2): `plumbline.agent.tools/<pendingFileName(server)>.json`, what the
// lock's `mcp[server].tools` hashes, so a review sees how a definition changed (docs/agent-lock.md, "Reviewing a
// relock"). Marks for a harder look (D-9). Node: reads and writes the checkout.
//
// Authority: the lock's hashes. A definitions file is a copy for people; `agent check` blocks when it disagrees with
// the lock (`definitions-mismatch`), and says when a server with tools has none (`definitions-absent`, info: a version 1
// lock, or a server whose tools were kept from a lock written before these files). The folder is never matched by
// declaration globs (src/agent/discover.ts, isNeverLocked).
//
// Third-party text: descriptions and schemas are a server's own words. They are written JSON-escaped (control, C1 and
// bidi characters as \uXXXX, so a diff view shows them as escapes) and never printed by Plumbline; only key names
// (`description`, `inputSchema`, ...) and the caller's own tool names (through printable) reach a terminal.

import { mkdir, readdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { toolDefinition, toolsParts, toolsRecord } from "../core/agent-tools.js";
import { canonicalJson } from "../core/canonical.js";
import { countDuplicateKeys } from "../core/json-keys.js";
import {
  AGENT_FORMAT_VERSION,
  AGENT_TOOLS_DIR,
  AGENT_TOOLS_TYPE,
  MCP_TOOL_DEFINITION_KEYS,
  type AgentFinding,
  type AgentLock,
  type AgentToolsFile,
} from "../core/types.js";
import { byPath } from "./glob.js";
import { pendingFileName } from "./pending.js";

/** Why a tool deserves a harder look: an annotation the server sent, or its name. Advisory; never a severity. */
export const TOOL_MARKS = ["destructive", "open-world", "name"] as const;
export type ToolMark = (typeof TOOL_MARKS)[number];

/** D-9: a name that says the tool runs code, a shell or deletes. Coarse on purpose (it also marks `retrieval`). */
const MARKED_NAME = /unsafe|exec|eval|shell|run_code|delete|drop/i;

const MEMBERS = new Set(["type", "version", "server", "tools"]);
const DEFINITION_KEYS = new Set<string>(MCP_TOOL_DEFINITION_KEYS);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const full = (root: string, rel: string): string => path.join(root, ...rel.split("/"));
const codeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The repository-relative definitions file of a server. */
export function definitionsPathOf(server: string): string {
  return `${AGENT_TOOLS_DIR}/${pendingFileName(server)}`;
}

/** Tools (objects with a string name, as toolsParts keeps them) restricted to the defining keys, sorted by name, then occurrence. */
function sortedDefinitions(tools: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return tools
    .filter((t) => typeof t.name === "string")
    .map((t, index) => ({ t: toolDefinition(t), index }))
    .sort((a, b) => codeUnits(a.t.name as string, b.t.name as string) || a.index - b.index)
    .map((x) => x.t);
}

/**
 * Characters written as \uXXXX inside the file's strings: C0 is escaped by JSON.stringify already; DEL and C1, the bidi
 * controls (as printable replaces them), zero-width characters, the line and paragraph separators and the BOM, so no
 * diff view renders a description in a way its bytes do not say.
 */
const ESCAPED = /[\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g;

/** A definitions file's exact text: pretty JSON (two spaces), LF, a trailing newline. */
export function definitionsText(server: string, tools: readonly Record<string, unknown>[]): string {
  const doc: AgentToolsFile = { type: AGENT_TOOLS_TYPE, version: AGENT_FORMAT_VERSION, server, tools: sortedDefinitions(tools) };
  return `${JSON.stringify(doc, null, 2).replace(ESCAPED, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)}\n`;
}

type Loaded = { absent: true } | { unreadable: true } | { tools: Record<string, unknown>[] };

/** A server's definitions file: absent, not one (not JSON, a repeated key, another type, version or server, a member or key this format does not define), or its tools. */
async function loadDefinitions(root: string, server: string): Promise<Loaded> {
  let text: string;
  try {
    text = await readFile(full(root, definitionsPathOf(server)), "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { absent: true } : { unreadable: true };
  }
  let value: unknown;
  try {
    const body = text.replace(/^﻿/, "");
    value = JSON.parse(body);
    if (countDuplicateKeys(body) > 0) return { unreadable: true };
  } catch {
    return { unreadable: true };
  }
  if (!isObject(value) || Object.keys(value).some((k) => !MEMBERS.has(k))) return { unreadable: true };
  if (value.type !== AGENT_TOOLS_TYPE || value.version !== AGENT_FORMAT_VERSION || value.server !== server || !Array.isArray(value.tools)) return { unreadable: true };
  for (const tool of value.tools) {
    if (!isObject(tool) || typeof tool.name !== "string" || Object.keys(tool).some((k) => !DEFINITION_KEYS.has(k))) return { unreadable: true };
  }
  return { tools: value.tools as Record<string, unknown>[] };
}

/** The accepted definitions a server's file holds, or undefined when there is none that reads as one. */
export async function readDefinitions(root: string, server: string): Promise<Record<string, unknown>[] | undefined> {
  const loaded = await loadDefinitions(root, server);
  return "tools" in loaded ? loaded.tools : undefined;
}

/**
 * Writes one definitions file per server in `definitions` (each list sorted by name, then occurrence; pretty JSON, LF,
 * a trailing newline) and removes the files of servers `lock` no longer holds with tools. A server kept from the earlier
 * lock (absent from `definitions`) keeps its file as it is. Returns the repository-relative paths written or removed,
 * sorted.
 */
export async function writeDefinitions(root: string, lock: AgentLock, definitions: Readonly<Record<string, Record<string, unknown>[]>>): Promise<string[]> {
  const touched: string[] = [];
  const keep = new Set<string>();
  for (const [server, record] of Object.entries(lock.mcp ?? {})) if (record.tools !== undefined) keep.add(pendingFileName(server));
  for (const server of Object.keys(definitions).sort(byPath)) {
    if (lock.mcp?.[server]?.tools === undefined) continue;
    const rel = definitionsPathOf(server);
    await mkdir(full(root, AGENT_TOOLS_DIR), { recursive: true });
    await writeFile(full(root, rel), definitionsText(server, definitions[server]!));
    touched.push(rel);
  }
  let names: string[];
  try {
    names = await readdir(full(root, AGENT_TOOLS_DIR));
  } catch {
    return touched.sort(byPath);
  }
  for (const name of names) {
    if (!name.endsWith(".json") || keep.has(name)) continue;
    await rm(full(root, `${AGENT_TOOLS_DIR}/${name}`), { force: true });
    touched.push(`${AGENT_TOOLS_DIR}/${name}`);
  }
  if (names.length > 0 && (await readdir(full(root, AGENT_TOOLS_DIR))).length === 0) await rmdir(full(root, AGENT_TOOLS_DIR));
  return touched.sort(byPath);
}

/** `definitions-mismatch` (block) and `definitions-absent` (info) findings for a lock's servers. */
export async function definitionsFindings(root: string, lock: AgentLock): Promise<AgentFinding[]> {
  const findings: AgentFinding[] = [];
  for (const server of Object.keys(lock.mcp ?? {}).sort(byPath)) {
    const held = lock.mcp![server]!.tools;
    if (held === undefined) continue;
    const loaded = await loadDefinitions(root, server);
    if ("absent" in loaded) {
      findings.push({
        severity: "info",
        code: "definitions-absent",
        ref: server,
        summary: `The lock holds this server's tools but there is no ${definitionsPathOf(server)} beside it, so a review cannot see their definitions; the next relock that observes its tools writes one.`,
      });
      continue;
    }
    if ("unreadable" in loaded) {
      findings.push({ severity: "block", code: "definitions-mismatch", ref: server, summary: `${definitionsPathOf(server)} cannot be read as a definitions file, so it does not show what the lock holds.` });
      continue;
    }
    const { parts, problems } = await toolsParts(loaded.tools);
    const record = toolsRecord(parts);
    const same = problems === 0 && Object.keys(record).length === Object.keys(held).length && Object.entries(held).every(([k, v]) => record[k] === v);
    if (!same) {
      findings.push({
        severity: "block",
        code: "definitions-mismatch",
        ref: server,
        summary: `${definitionsPathOf(server)} differs from the tool hashes the lock holds, so it does not show what the lock holds (edited by hand, or not written with the lock): restore it from version control (relock writes it again only when it observes the server's tools).`,
      });
    }
  }
  return findings;
}

/** A value's comparable form: canonical JSON, or plain JSON for a value canonical JSON refuses. */
function comparable(value: unknown): string {
  try {
    return canonicalJson(value);
  } catch {
    return JSON.stringify(value);
  }
}

/** Tools by name and occurrence (`name`, then `name\0<n>`), as the lock keys them. */
function byOccurrence(tools: readonly Record<string, unknown>[]): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  const seen = new Map<string, number>();
  for (const tool of tools) {
    if (typeof tool.name !== "string") continue;
    const n = (seen.get(tool.name) ?? 0) + 1;
    seen.set(tool.name, n);
    out.set(n === 1 ? tool.name : `${tool.name}\u0000${n}`, tool);
  }
  return out;
}

/**
 * Per tool name, the defining keys whose values differ between the accepted and the new definitions (in
 * MCP_TOOL_DEFINITION_KEYS order; a key one side lacks counts). Tools are matched by name and occurrence; a tool on one
 * side only is not listed (it is added or removed, not changed); a repeated name lists the keys of every occurrence.
 */
export function changedKeys(before: readonly Record<string, unknown>[] | undefined, after: readonly Record<string, unknown>[]): Record<string, string[]> {
  if (before === undefined) return {};
  const earlier = byOccurrence(before);
  const out: Record<string, string[]> = {};
  for (const [key, tool] of byOccurrence(after)) {
    const old = earlier.get(key);
    if (old === undefined) continue;
    const a = toolDefinition(old);
    const b = toolDefinition(tool);
    const differ = MCP_TOOL_DEFINITION_KEYS.filter((k) => k !== "name" && (Object.hasOwn(a, k) !== Object.hasOwn(b, k) || (Object.hasOwn(a, k) && comparable(a[k]) !== comparable(b[k]))));
    if (differ.length === 0) continue;
    const name = tool.name as string;
    const merged = new Set([...(out[name] ?? []), ...differ]);
    out[name] = MCP_TOOL_DEFINITION_KEYS.filter((k) => merged.has(k));
  }
  return out;
}

/**
 * The marks of one tool definition (D-9): `destructive` when annotations.destructiveHint is true; `open-world` when
 * openWorldHint is true and readOnlyHint is not; `name` when the name matches MARKED_NAME. Annotations are the server's
 * own claims: a tool without a mark is not thereby safe.
 */
export function toolMarks(tool: Record<string, unknown>): ToolMark[] {
  const notes = isObject(tool.annotations) ? tool.annotations : {};
  const marks: ToolMark[] = [];
  if (notes.destructiveHint === true) marks.push("destructive");
  if (notes.openWorldHint === true && notes.readOnlyHint !== true) marks.push("open-world");
  if (typeof tool.name === "string" && MARKED_NAME.test(tool.name)) marks.push("name");
  return marks;
}
