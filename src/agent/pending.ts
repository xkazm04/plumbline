// The guard's observation file, .plumbline/pending/<server>.json (WP3 builds this; WP0 stub with final signatures).
// Pure: no node:* imports. Written by the guard, read by `agent relock`; local, git-ignored, never signed.

import type { AgentPending } from "../core/types.js";

/** The pending document for what a server advertised; tools are restricted to MCP_TOOL_DEFINITION_KEYS. */
export function pendingFor(server: string, target: string, tools: readonly Record<string, unknown>[], now: Date): AgentPending {
  void server;
  void target;
  void tools;
  void now;
  throw new Error("pendingFor is not built yet (WP3)");
}

/** A pending document, or null when the text is not one (not JSON, a repeated key, a wrong type or shape). */
export function parsePending(text: string): AgentPending | null {
  void text;
  return null;
}
