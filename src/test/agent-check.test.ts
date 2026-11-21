// `plumbline agent check` (src/agent/check.ts): each finding code it produces, the approval mapping, --offline making no
// network call, and the exit codes. In-process with an injected lister and fetcher; one spawned run with no network.
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { serverTarget } from "../core/agent-tools.js";
import { AGENT_APPROVAL_FILE, AGENT_FILE, AGENT_LOCK_FILE, AGENT_PENDING_TYPE, type AgentDeclaration, type AgentReport } from "../core/types.js";
import { agent, approve, approversText, json, person, read, repo, spy, TOOLS_A, write, type Spy } from "./agent-helpers.js";
import { run } from "./cli-helpers.js";

const PEER = "https://peer.example/.well-known/agent-card.json";
const STDIO = { transport: "stdio" as const, command: "npx", args: ["-y", "files"] };

interface Fixture {
  dir: string;
  s: Spy;
  alice: Awaited<ReturnType<typeof person>>;
}

/** The guard's pending file for the stdio server `files`, holding `tools`. */
async function pending(tools: Record<string, unknown>[]): Promise<string> {
  return json({ type: AGENT_PENDING_TYPE, version: 1, server: "files", target: await serverTarget(STDIO), observedAt: "2026-11-21T11:00:00.000Z", tools });
}

/**
 * A repository with a stdio and an http server, a model and a peer, locked and approved by Alice. With `observe` the
 * guard has seen the stdio server before the relock (its tools are locked) and check is clean.
 */
async function fixture(observe = true): Promise<Fixture> {
  const dir = repo({
    "CLAUDE.md": "# rules\n",
    ".mcp.json": json({ mcpServers: { files: { command: "npx", args: ["-y", "files"] }, docs: { type: "http", url: "https://docs.example/mcp" } } }),
    ".claude/settings.json": json({ model: "claude-opus-5-5" }),
  });
  const alice = await person();
  const s = spy({ PLUMBLINE_APPROVERS: approversText([alice.entry]) });
  assert.equal((await agent(s.deps, "init", "--root", dir)).code, 0);
  editDeclaration(dir, (d) => ({ ...d, peers: [PEER] }));
  if (observe) write(dir, { ".plumbline/pending/files.json": await pending([{ name: "read" }, { name: "write", description: "w" }, { name: "gone" }]) });
  assert.equal((await agent(s.deps, "relock", "--root", dir)).code, 0);
  await approve(dir, alice);
  return { dir, s, alice };
}

function editDeclaration(dir: string, edit: (d: AgentDeclaration) => AgentDeclaration): void {
  write(dir, { [AGENT_FILE]: json(edit(JSON.parse(read(dir, AGENT_FILE)) as AgentDeclaration)) });
}

async function check(f: Fixture, ...extra: string[]): Promise<{ code: number; report: AgentReport }> {
  const { code, out } = await agent(f.s.deps, "check", "--root", f.dir, "--json", ...extra);
  return { code, report: JSON.parse(out) as AgentReport };
}

const codes = (r: AgentReport): string[] => r.findings.map((x) => `${x.severity} ${x.code} ${x.ref}`);

test("a locked, approved and unchanged agent is clean: exit 0, approval verified, approvedBy named", async () => {
  const f = await fixture();
  const { code, report } = await check(f);
  assert.deepEqual(codes(report), []);
  assert.equal(code, 0);
  assert.equal(report.approval, "verified");
  assert.deepEqual(report.approvedBy, { kid: f.alice.entry.kid, label: "Alice" });
  const text = await agent(f.s.deps, "check", "--root", f.dir);
  assert.match(text.out, /Approval: verified, by Alice/);
  assert.match(text.out, /The agent matches its approved lock/);
});

test("file-changed, file-added, file-removed and declaration-changed", async () => {
  const f = await fixture();
  write(f.dir, { "CLAUDE.md": "# rules, edited\n", ".claude/agents/new.md": "x" });
  rmSync(path.join(f.dir, ".claude", "settings.json"));
  let r = await check(f);
  assert.deepEqual(codes(r.report), ["block file-removed .claude/settings.json", "block file-changed CLAUDE.md"]);
  assert.equal(r.code, 1);
  editDeclaration(f.dir, (d) => ({ ...d, files: [...d.files, ".claude/agents/**"] }));
  r = await check(f);
  assert.deepEqual(codes(r.report).slice(0, 2), ["block declaration-changed plumbline.agent.json", "block file-added .claude/agents/new.md"]);
});

test("model-changed: a changed id, an added label and a removed label", async () => {
  const f = await fixture();
  editDeclaration(f.dir, (d) => ({ ...d, models: { reviewer: "claude-sonnet-5" } }));
  const { report } = await check(f, "--offline");
  assert.deepEqual(codes(report).filter((c) => c.includes("model-changed")), ["block model-changed default", "block model-changed reviewer"]);
  editDeclaration(f.dir, (d) => ({ ...d, models: { default: "claude-haiku-5" } }));
  assert.deepEqual(codes((await check(f, "--offline")).report).filter((c) => c.includes("model-changed")), ["block model-changed default"]);
});

test("server-added, server-removed and server-target-changed", async () => {
  const f = await fixture();
  editDeclaration(f.dir, (d) => ({
    ...d,
    mcp: { files: { ...STDIO, args: ["-y", "files@2"] }, extra: { transport: "stdio", command: "uvx" } },
  }));
  const { report } = await check(f, "--offline");
  assert.deepEqual(codes(report).filter((c) => c.includes("server-")), ["block server-removed docs", "block server-added extra", "block server-target-changed files"]);
});

test("server-not-observed (warn), and the guard's pending file: tool-added/changed/removed as warn, local", async () => {
  const f = await fixture(false);
  let { report, code } = await check(f, "--offline");
  // --offline: info only for the http server and the peer; the unobserved stdio server is a warn
  assert.deepEqual(codes(report), ["info server-unreachable docs", "warn server-not-observed files", "info peer-unreachable " + PEER]);
  assert.equal(code, 1);
  // the guard saw it: relock takes it, then the guard sees a change
  write(f.dir, { ".plumbline/pending/files.json": await pending([{ name: "read" }, { name: "write", description: "w" }, { name: "gone" }]) });
  ({ report } = await check(f, "--offline"));
  assert.ok(codes(report).includes("warn tool-added files"), "a never-observed lock: every tool the guard saw is added");
  assert.equal((await agent(f.s.deps, "relock", "--root", f.dir)).code, 0);
  await approve(f.dir, f.alice);
  write(f.dir, { ".plumbline/pending/files.json": await pending([{ name: "read" }, { name: "write", description: "CHANGED" }, { name: "new" }]) });
  ({ report } = await check(f, "--offline"));
  const tools = report.findings.filter((x) => x.code.startsWith("tool-"));
  assert.deepEqual(tools.map((x) => `${x.severity} ${x.code}`), ["warn tool-changed", "warn tool-added", "warn tool-removed"]);
  assert.deepEqual(tools[0]?.counts, { toolsAdded: 1, toolsRemoved: 1, toolsChanged: 1 });
  assert.ok(tools.every((x) => !/CHANGED|"new"|\bread\b|\bwrite\b/.test(x.summary)), "a tool's own words are never in a summary");
  assert.match(tools[0]!.summary, /The guard saw locally/);
});

test("http tools: tool-changed, tool-added, tool-removed block with counts; unreachable and refused warn", async () => {
  const f = await fixture();
  f.s.lists.set("https://docs.example/mcp", { ok: true, protocol: "2025-06-18", tools: [{ ...TOOLS_A[0]!, description: "Search, now also deletes." }, { name: "delete_all" }] });
  let { report } = await check(f);
  const tools = report.findings.filter((x) => x.code.startsWith("tool-"));
  assert.deepEqual(tools.map((x) => `${x.severity} ${x.code} ${x.ref}`), ["block tool-changed docs", "block tool-added docs", "block tool-removed docs"]);
  assert.deepEqual(tools[0]?.counts, { toolsAdded: 1, toolsRemoved: 1, toolsChanged: 1 });
  assert.ok(!JSON.stringify(report).includes("deletes") && !JSON.stringify(report).includes("delete_all"));
  f.s.lists.set("https://docs.example/mcp", { ok: false, status: 503 });
  ({ report } = await check(f));
  assert.ok(codes(report).includes("warn server-unreachable docs"));
  f.s.lists.set("https://docs.example/mcp", { ok: false, refused: "it is a private or loopback address" });
  ({ report } = await check(f));
  assert.ok(codes(report).includes("warn server-refused docs"));
});

test("peers: peer-changed (block) when the card changed or the declaration differs; peer-unreachable (warn)", async () => {
  const f = await fixture();
  f.s.cards.set(PEER, new TextEncoder().encode(JSON.stringify({ name: "peer", skills: [{ id: "a", name: "A" }, { id: "c" }] })));
  let { report } = await check(f);
  const changed = report.findings.find((x) => x.code === "peer-changed");
  assert.equal(changed?.severity, "block");
  assert.match(changed!.summary, /skills: 1 added, 1 removed, 0 changed/);
  f.s.cards.set(PEER, 404);
  ({ report } = await check(f));
  assert.ok(codes(report).includes(`warn peer-unreachable ${PEER}`));
  editDeclaration(f.dir, (d) => ({ ...d, peers: ["https://other.example/card.json"] }));
  ({ report } = await check(f, "--offline"));
  assert.ok(codes(report).includes("block peer-changed https://other.example/card.json"));
  assert.ok(codes(report).includes(`block peer-changed ${PEER}`));
});

test("--offline makes no lister and no fetcher call, and says what it did not check", async () => {
  const f = await fixture();
  f.s.listerCalls.length = 0;
  f.s.fetchCalls.length = 0;
  const { out } = await agent(f.s.deps, "check", "--root", f.dir, "--offline");
  assert.deepEqual(f.s.listerCalls, []);
  assert.deepEqual(f.s.fetchCalls, []);
  assert.match(out, /Offline: 1 MCP server over HTTP and 1 A2A peer were not contacted/);
});

test("approval: absent, tampered (lock changed after approval), invalid, unverifiable", async () => {
  const f = await fixture();
  rmSync(path.join(f.dir, AGENT_APPROVAL_FILE));
  let r = await check(f, "--offline");
  assert.equal(r.report.approval, "absent");
  assert.ok(codes(r.report).includes(`block lock-unapproved ${AGENT_LOCK_FILE}`));

  await approve(f.dir, f.alice);
  write(f.dir, { [AGENT_LOCK_FILE]: read(f.dir, AGENT_LOCK_FILE).replace('"lockedAt"', '"lockedAt" ') });
  r = await check(f, "--offline");
  assert.equal(r.report.approval, "invalid");
  const unapproved = r.report.findings.find((x) => x.code === "lock-unapproved");
  assert.match(unapproved!.summary, /changed after it was approved/);

  await approve(f.dir, f.alice);
  const approval = JSON.parse(read(f.dir, AGENT_APPROVAL_FILE)) as Record<string, string>;
  write(f.dir, { [AGENT_APPROVAL_FILE]: json({ ...approval, sig: approval.sig!.slice(0, -4) + "AAAA" }) });
  r = await check(f, "--offline");
  assert.equal(r.report.approval, "invalid");
  assert.ok(codes(r.report).includes(`block approval-invalid ${AGENT_APPROVAL_FILE}`));

  await approve(f.dir, f.alice);
  const bob = await person("Bob");
  const s = { ...f.s, deps: { ...f.s.deps, env: { PLUMBLINE_APPROVERS: approversText([bob.entry]) } } };
  r = await check({ ...f, s }, "--offline");
  assert.equal(r.report.approval, "unverifiable");
  assert.ok(codes(r.report).includes(`block approval-unverifiable ${AGENT_APPROVAL_FILE}`));
  const home = repo();
  const none = { ...f.s, deps: { ...f.s.deps, env: { PLUMBLINE_HOME: home } } };
  r = await check({ ...f, s: none }, "--offline");
  assert.equal(r.report.approval, "unverifiable");
  assert.match(r.report.findings.find((x) => x.code === "approval-unverifiable")!.summary, /no approvers file was found/);
});

test("lock-absent and lock-unusable block (exit 1); nothing else is checked", async () => {
  const dir = repo({ "CLAUDE.md": "x" });
  const s = spy();
  let { code, out } = await agent(s.deps, "check", "--root", dir, "--json");
  assert.equal(code, 1);
  assert.deepEqual(codes(JSON.parse(out) as AgentReport), [`block lock-absent ${AGENT_LOCK_FILE}`]);
  write(dir, { [AGENT_LOCK_FILE]: '{"type":"plumbline-agent-lock","version":1}' });
  ({ code, out } = await agent(s.deps, "check", "--root", dir, "--json"));
  assert.equal(code, 1);
  const r = JSON.parse(out) as AgentReport;
  assert.deepEqual(codes(r), [`block lock-unusable ${AGENT_LOCK_FILE}`, `block lock-unapproved ${AGENT_LOCK_FILE}`]);
  assert.deepEqual(s.listerCalls, []);
});

test("spawned with no network: absent lock exits 1, an unknown option exits 2", () => {
  const dir = repo();
  const absent = run("agent", "check", "--root", dir, "--offline");
  assert.equal(absent.code, 1, absent.err);
  assert.match(absent.out, /lock-absent/);
  assert.match(absent.out, /Next: plumbline agent init/);
  assert.equal(run("agent", "check", "--root", dir, "--bogus").code, 2);
  assert.equal(run("agent", "frobnicate").code, 2);
  const init = run("agent", "init", "--root", dir);
  assert.equal(init.code, 0, init.err);
  const again = run("agent", "init", "--root", dir);
  assert.equal(again.code, 2);
  assert.match(again.err, /exists: edit it, then plumbline agent relock/);
});
