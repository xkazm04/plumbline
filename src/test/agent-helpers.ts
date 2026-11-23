// Shared helpers for the agent lock tests: fixture repositories in temp folders, an injected MCP lister and fetcher that
// count their calls, a person's key and approval. No network; keys live only in memory and temp folders. Not a test
// file itself.

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { approveLock } from "../core/approve.js";
import { generateKey } from "../core/keys.js";
import { AGENT_APPROVAL_FILE, AGENT_LOCK_FILE, APPROVERS_TYPE, type AgentLock, type ApproverEntry } from "../core/types.js";
import type { AgentDeps } from "../agent/build.js";
import { runAgent } from "../cli/agent-command.js";
import type { McpListResult } from "../net/mcp-http.js";
import type { SafeFetchResponse } from "../net/fetch-types.js";

export const NOW = new Date("2026-11-21T10:00:00.000Z");
export const LATER = new Date("2026-11-22T10:00:00.000Z");

const scratch: string[] = [];
process.on("exit", () => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** A fresh folder holding `files` (repository-relative path to text). Removed when the test process exits. */
export function repo(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), "plumbline-agent-"));
  scratch.push(dir);
  write(dir, files);
  return dir;
}

export function write(dir: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(dir, ...rel.split("/"));
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
}

export const read = (dir: string, rel: string): string => readFileSync(path.join(dir, ...rel.split("/")), "utf8");
export const json = (value: unknown): string => JSON.stringify(value, null, 2);

/** Every file under `dir`, repository-relative. */
export function allFiles(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(rel === "" ? dir : path.join(dir, rel))) {
    const child = rel === "" ? name : `${rel}/${name}`;
    if (statSync(path.join(dir, child)).isDirectory()) out.push(...allFiles(dir, child));
    else out.push(child);
  }
  return out;
}

/** A tool list a lister returns. */
export const TOOLS_A = [
  { name: "search", description: "Search the docs.", inputSchema: { type: "object" } },
  { name: "fetch", description: "Fetch one page.", inputSchema: { type: "object" } },
];

export interface Spy {
  deps: AgentDeps;
  listerCalls: string[];
  fetchCalls: string[];
  /** What the lister answers per url (default: TOOLS_A). */
  lists: Map<string, McpListResult>;
  /** What the fetcher answers per url (default: the sample card). */
  cards: Map<string, Uint8Array | number | Error>;
}

export const CARD = new TextEncoder().encode(JSON.stringify({ name: "peer", skills: [{ id: "a", name: "A" }, { id: "b", name: "B" }] }));

/** Dependencies with a lister and fetcher that record each call and never touch the network. */
export function spy(env: NodeJS.ProcessEnv = {}, now = NOW): Spy {
  const listerCalls: string[] = [];
  const fetchCalls: string[] = [];
  const lists = new Map<string, McpListResult>();
  const cards = new Map<string, Uint8Array | number | Error>();
  const deps: AgentDeps = {
    lister: async (url) => {
      listerCalls.push(url);
      return lists.get(url) ?? { ok: true, tools: TOOLS_A.map((t) => ({ ...t })), protocol: "2025-06-18" };
    },
    fetcher: async (url) => {
      fetchCalls.push(url);
      const answer = cards.get(url) ?? CARD;
      if (answer instanceof Error) throw answer;
      const status = typeof answer === "number" ? answer : 200;
      const bytes = typeof answer === "number" ? new Uint8Array() : answer;
      const response: SafeFetchResponse = { status, ok: status >= 200 && status < 300, url, redirects: 0, headers: {}, bytes, text: () => new TextDecoder().decode(bytes) };
      return response;
    },
    now,
    env,
  };
  return { deps, listerCalls, fetchCalls, lists, cards };
}

/** Runs `plumbline agent ...` in-process; returns the exit code and what it printed. */
export async function agent(deps: AgentDeps, ...argv: string[]): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const code = await runAgent(argv, (line) => lines.push(line), deps);
  return { code, out: lines.join("\n") };
}

/** A person allowed to approve: their private key (memory only) and their approvers entry. */
export async function person(label = "Alice"): Promise<{ privateKey: string; entry: ApproverEntry }> {
  const { key, privateKey } = await generateKey(NOW);
  return { privateKey, entry: { kid: key.kid, publicKey: key.publicKey, label, addedAt: NOW.toISOString() } };
}

/** The approvers file's text, as CI passes it in PLUMBLINE_APPROVERS. */
export const approversText = (entries: ApproverEntry[]): string => JSON.stringify({ type: APPROVERS_TYPE, version: 1, approvers: entries });

/** Signs the repository's current lock as `who`, writing the approval file. */
export async function approve(dir: string, who: { privateKey: string }): Promise<void> {
  const bytes = read(dir, AGENT_LOCK_FILE);
  const lock = JSON.parse(bytes) as AgentLock;
  const approval = await approveLock({ privateKey: who.privateKey, lockBytes: bytes, lock, now: NOW });
  write(dir, { [AGENT_APPROVAL_FILE]: json(approval) });
}

/** The playwright-like tools list (src/test/fixtures/mcp/playwright-like): marked by name, by destructiveHint, by openWorldHint; one readOnly open-world tool unmarked. */
export const PLAYWRIGHT_TOOLS = (): Record<string, unknown>[] =>
  JSON.parse(readFileSync(new URL("../../src/test/fixtures/mcp/playwright-like/tools.json", import.meta.url), "utf8")) as Record<string, unknown>[];

/** An environment whose PATH holds a fake `plumbline` (plumbline.cmd for Windows, an executable `plumbline` for POSIX), so the short form resolves whatever this machine's PATH holds. */
export function plumblineOnPath(): NodeJS.ProcessEnv {
  const dir = mkdtempSync(path.join(tmpdir(), "plumbline-bin-"));
  scratch.push(dir);
  writeFileSync(path.join(dir, "plumbline.cmd"), "@echo off\r\n");
  writeFileSync(path.join(dir, "plumbline"), "#!/bin/sh\n", { mode: 0o755 });
  return { PATH: dir };
}
