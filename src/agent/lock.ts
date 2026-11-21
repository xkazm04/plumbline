// Reading the agent declaration and the agent lock (WP2 builds this; WP0 stub with final signatures). Pure: no node:*.
// A document is refused when it is not JSON, repeats a key inside one object (countDuplicateKeys), is not the type and
// version it claims, or holds a field that breaks its pattern; the problem is a fixed sentence, never a quoted value.

import type { AgentDeclaration, AgentLock } from "../core/types.js";

export type Parsed<T> = { ok: true; value: T } | { ok: false; problem: string };

export function parseDeclaration(text: string): Parsed<AgentDeclaration> {
  void text;
  return { ok: false, problem: "the agent declaration reader is not built yet (WP2)" };
}

export function parseAgentLock(text: string): Parsed<AgentLock> {
  void text;
  return { ok: false, problem: "the agent lock reader is not built yet (WP2)" };
}
