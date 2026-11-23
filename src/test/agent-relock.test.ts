// `plumbline agent relock` (src/agent/build.ts, src/cli/agent-command.ts): the chain, the stale approval, what is kept
// when a server or peer cannot be read, and which pending file is taken. In-process; no network.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { serverTarget, toolsParts, toolsRecord } from "../core/agent-tools.js";
import { sha256Hex } from "../core/canonical.js";
import { AGENT_APPROVAL_FILE, AGENT_FILE, AGENT_LOCK_FILE, AGENT_PENDING_TYPE, type AgentDeclaration, type AgentLock } from "../core/types.js";
import { CliError } from "../cli/args.js";
import { agent, approve, CARD, json, LATER, person, read, repo, spy, TOOLS_A, write } from "./agent-helpers.js";

const STDIO = { transport: "stdio" as const, command: "npx", args: ["-y", "files"] };
const PEER = "https://peer.example/card.json";

async function pendingText(tools: Record<string, unknown>[], target?: string): Promise<string> {
  return json({ type: AGENT_PENDING_TYPE, version: 1, server: "files", target: target ?? (await serverTarget(STDIO)), observedAt: "2026-11-21T11:00:00.000Z", tools });
}

async function initialised(): Promise<{ dir: string; s: ReturnType<typeof spy> }> {
  const dir = repo({
    "CLAUDE.md": "# rules\n",
    ".mcp.json": json({ mcpServers: { files: { command: "npx", args: ["-y", "files"] }, docs: { type: "http", url: "https://docs.example/mcp" } } }),
  });
  const s = spy();
  assert.equal((await agent(s.deps, "init", "--root", dir)).code, 0);
  const d = JSON.parse(read(dir, AGENT_FILE)) as AgentDeclaration;
  write(dir, { [AGENT_FILE]: json({ ...d, peers: [PEER] }) });
  return { dir, s };
}

const lockOf = (dir: string): AgentLock => JSON.parse(read(dir, AGENT_LOCK_FILE)) as AgentLock;

test("relock chains to the lock it replaces (previous = SHA-256 of its exact bytes) and removes the stale approval", async () => {
  const { dir, s } = await initialised();
  const firstBytes = read(dir, AGENT_LOCK_FILE);
  await approve(dir, await person());
  const { code, out } = await agent({ ...s.deps, now: LATER }, "relock", "--root", dir);
  assert.equal(code, 0);
  const lock = lockOf(dir);
  assert.equal(lock.previous, await sha256Hex(firstBytes));
  assert.equal(lock.declaration, await sha256Hex(read(dir, AGENT_FILE)));
  assert.equal(lock.lockedAt, LATER.toISOString());
  assert.ok(lock.peers?.[PEER], "the declared peer is locked");
  assert.equal(lock.peers?.[PEER]?.sha256, await sha256Hex(CARD));
  assert.equal(existsSync(path.join(dir, AGENT_APPROVAL_FILE)), false);
  assert.match(out, /the approval covered the old lock; approve the new one/);
  assert.match(out, /plumbline.agent.json changed since the last lock/);
  assert.match(out, /peer added: https:\/\/peer.example\/card.json/);
  // a second relock chains to the first relock
  const secondBytes = read(dir, AGENT_LOCK_FILE);
  await agent(s.deps, "relock", "--root", dir);
  assert.equal(lockOf(dir).previous, await sha256Hex(secondBytes));
});

test("an http server or a peer that cannot be read now keeps its record, with a warn", async () => {
  const { dir, s } = await initialised();
  await agent(s.deps, "relock", "--root", dir);
  const before = lockOf(dir);
  s.lists.set("https://docs.example/mcp", { ok: false, reason: "the request timed out" });
  s.cards.set(PEER, 500);
  const { code, out } = await agent({ ...s.deps, now: LATER }, "relock", "--root", dir, "--json");
  assert.equal(code, 0);
  const after = lockOf(dir);
  assert.deepEqual(after.mcp?.docs, before.mcp?.docs, "the http server's record is kept");
  assert.deepEqual(after.peers?.[PEER], before.peers?.[PEER], "the peer's record is kept");
  const result = JSON.parse(out) as { findings: { severity: string; code: string; summary: string }[] };
  assert.deepEqual(result.findings.map((f) => `${f.severity} ${f.code}`), ["warn server-unreachable", "warn peer-unreachable"]);
  assert.match(result.findings[0]!.summary, /keeps its earlier tools/);
  assert.match(result.findings[1]!.summary, /keeps its earlier record/);
});

test("a pending file for another target is ignored; one for this target is taken, its tool names listed (printable)", async () => {
  const { dir, s } = await initialised();
  write(dir, { ".plumbline/pending/files.json": await pendingText([{ name: "read" }], "f".repeat(64)) });
  await agent(s.deps, "relock", "--root", dir);
  assert.equal(lockOf(dir).mcp?.files?.tools, undefined, "a pending file for another command is not taken");

  const tools = [{ name: "read", description: "r" }, { name: "evil\u001b[31m‮", description: "x" }];
  write(dir, { ".plumbline/pending/files.json": await pendingText(tools) });
  const { out } = await agent(s.deps, "relock", "--root", dir);
  const lock = lockOf(dir);
  assert.deepEqual(lock.mcp?.files?.tools, toolsRecord((await toolsParts(tools)).parts));
  assert.equal(lock.mcp?.files?.observedAt, "2026-11-21T11:00:00.000Z");
  assert.match(out, /server files \(from what the guard saw\): tools 2 added, 0 removed, 0 changed \(added read, evil\?\[31m\?\)/);
  assert.ok(!out.includes("\u001b") && !out.includes("‮"), "control and bidi characters are replaced");

  // a later relock without a pending file keeps the locked tools; a changed definition is listed by name, a removed one by count
  write(dir, { ".plumbline/pending/files.json": await pendingText([{ name: "read", description: "r2" }]) });
  const second = await agent(s.deps, "relock", "--root", dir);
  assert.match(second.out, /tools 0 added, 1 removed, 1 changed \(changed read \[description\]\)/, "the changed key is named, never the text");
  // http tools are counted, never named
  assert.match(second.out, /server docs \(listed now\): tools 0 added, 0 removed, 0 changed/);
  assert.ok(!second.out.includes(TOOLS_A[0]!.name), "a remote server's tool names are never printed");
});

test("a stdio server with no pending file keeps its locked tools; a changed command drops them", async () => {
  const { dir, s } = await initialised();
  write(dir, { ".plumbline/pending/files.json": await pendingText([{ name: "read" }]) });
  await agent(s.deps, "relock", "--root", dir);
  const held = lockOf(dir).mcp?.files?.tools;
  assert.ok(held);
  write(dir, { ".plumbline/pending/files.json": "not json" });
  await agent(s.deps, "relock", "--root", dir);
  assert.deepEqual(lockOf(dir).mcp?.files?.tools, held, "an unreadable pending file is not taken; the tools are kept");
  const d = JSON.parse(read(dir, AGENT_FILE)) as AgentDeclaration;
  write(dir, { [AGENT_FILE]: json({ ...d, mcp: { ...d.mcp, files: { ...STDIO, args: ["-y", "files@2"] } } }) });
  await agent(s.deps, "relock", "--root", dir);
  assert.equal(lockOf(dir).mcp?.files?.tools, undefined, "another command is another server: not yet observed");
});

test("relock refuses with no lock or an unusable declaration (exit 2 through CliError)", async () => {
  const dir = repo();
  await assert.rejects(agent(spy().deps, "relock", "--root", dir), (e: unknown) => e instanceof CliError && /run plumbline agent init/.test(e.message));
  const { dir: d2, s } = await initialised();
  write(d2, { [AGENT_FILE]: '{"type":"plumbline-agent","version":1,"files":[],"files":[]}' });
  await assert.rejects(agent(s.deps, "relock", "--root", d2), (e: unknown) => e instanceof CliError && /repeats a key/.test(e.message));
});
