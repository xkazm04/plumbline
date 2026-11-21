// The guard's observation file, .plumbline/pending/<server>.json: what a stdio MCP server advertised in its last
// complete tools/list, every page, each tool restricted to MCP_TOOL_DEFINITION_KEYS. Written by `plumbline guard`,
// read by `agent relock`; local, git-ignored, never signed. Pure: no node:* imports.
//
// It holds a server's own words (names, descriptions) because relock must hash them; nothing that reads it prints them
// except relock's own-repository change list. A document is refused (null) when it is not JSON, repeats a key inside one
// object, is not this type and version, carries a member this format does not define, or a tool that is not an object
// with a string `name` and only defining keys.

import { toolDefinition } from "../core/agent-tools.js";
import { countDuplicateKeys } from "../core/json-keys.js";
import { AGENT_FORMAT_VERSION, AGENT_PENDING_TYPE, MCP_TOOL_DEFINITION_KEYS, type AgentPending } from "../core/types.js";

const HEX = /^[0-9a-f]{64}$/;
/** UTC ISO 8601 as Date.toISOString writes it (the guard's own clock). */
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const MEMBERS = new Set(["type", "version", "server", "target", "observedAt", "tools"]);
const DEFINITION_KEYS = new Set<string>(MCP_TOOL_DEFINITION_KEYS);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The pending file's name for a server, `<encoded>.json` in the pending folder: the server name with every `:` replaced
 * by `__`, since a lock may name a server `<host>:<name>` and `:` cannot be in a Windows file name. The document's
 * `server` member keeps the real name.
 */
export function pendingFileName(server: string): string {
  return `${server.replaceAll(":", "__")}.json`;
}

/**
 * The pending document for what a server advertised; tools are restricted to MCP_TOOL_DEFINITION_KEYS, in the order
 * received. The caller passes only entries that are tools (an object with a string `name`: the ones toolsParts keeps),
 * so the document it writes is one parsePending reads back.
 */
export function pendingFor(server: string, target: string, tools: readonly Record<string, unknown>[], now: Date): AgentPending {
  return {
    type: AGENT_PENDING_TYPE,
    version: AGENT_FORMAT_VERSION,
    server,
    target,
    observedAt: now.toISOString(),
    tools: tools.map(toolDefinition),
  };
}

/** A pending document, or null when the text is not one (not JSON, a repeated key, a wrong type or shape). */
export function parsePending(text: string): AgentPending | null {
  let value: unknown;
  try {
    const body = text.replace(/^﻿/, "");
    value = JSON.parse(body);
    if (countDuplicateKeys(body) > 0) return null;
  } catch {
    return null;
  }
  if (!isObject(value)) return null;
  if (Object.keys(value).some((k) => !MEMBERS.has(k))) return null;
  if (value.type !== AGENT_PENDING_TYPE || value.version !== AGENT_FORMAT_VERSION) return null;
  if (typeof value.server !== "string" || value.server === "") return null;
  if (typeof value.target !== "string" || !HEX.test(value.target)) return null;
  if (typeof value.observedAt !== "string" || !ISO.test(value.observedAt) || Number.isNaN(Date.parse(value.observedAt))) return null;
  if (!Array.isArray(value.tools)) return null;
  for (const tool of value.tools) {
    if (!isObject(tool) || typeof tool.name !== "string") return null;
    if (Object.keys(tool).some((k) => !DEFINITION_KEYS.has(k))) return null;
  }
  return {
    type: AGENT_PENDING_TYPE,
    version: AGENT_FORMAT_VERSION,
    server: value.server,
    target: value.target,
    observedAt: value.observedAt,
    tools: value.tools as Record<string, unknown>[],
  };
}
