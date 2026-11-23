// `plumbline agent check` (src/agent/check.ts): each finding code it produces, the approval mapping, --offline making no
// network call, and the exit codes. In-process with an injected lister and fetcher; one spawned run with no network.
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { serverTarget } from "../core/agent-tools.js";
import { agentState, reportExit, stateExit } from "../agent/check-state.js";
import {
  AGENT_APPROVAL_FILE,
  AGENT_CODES,
  AGENT_FILE,
  AGENT_LOCK_FILE,
  AGENT_NOT_CHECKED_CODES,
  AGENT_PENDING_TYPE,
  type AgentCode,
  type AgentDeclaration,
  type AgentFinding,
  type AgentReport,
} from "../core/types.js";
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
  assert.match(text.out, /State: pass: the agent matches its approved lock\./);
  assert.doesNotMatch(text.out, /Next:/, "nothing to do when the state is pass");
  assert.equal(report.state, "pass");
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
  // not observed is not checked: unavailable, exit 0 under the default --fail-on fail (never folded into fail)
  assert.equal(report.state, "unavailable");
  assert.equal(code, 0);
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

// --- states and --fail-on (docs/agent-lock.md, "States and exit codes") ---

const finding = (severity: AgentFinding["severity"], code: AgentCode): AgentFinding => ({ severity, code, ref: "x", summary: "s" });
const reportOf = (findings: AgentFinding[]): AgentReport => ({ state: agentState(findings), findings, approval: "verified", checkedAt: "2026-11-21T10:00:00.000Z" });

test("the exit table: each not-checked code alone is unavailable (exit 0, 1 under --fail-on unavailable); with a block, fail (1 both); clean, pass (0)", () => {
  assert.equal(AGENT_NOT_CHECKED_CODES.length, 6);
  for (const code of AGENT_NOT_CHECKED_CODES) {
    const alone = reportOf([finding("warn", code)]);
    assert.equal(alone.state, "unavailable", code);
    assert.equal(reportExit(alone), 0, `${code}: default --fail-on fail`);
    assert.equal(reportExit(alone, "fail"), 0, code);
    assert.equal(reportExit(alone, "unavailable"), 1, `${code}: --fail-on unavailable`);
    const withBlock = reportOf([finding("warn", code), finding("block", "file-changed")]);
    assert.equal(withBlock.state, "fail", code);
    assert.equal(reportExit(withBlock, "fail"), 1, code);
    assert.equal(reportExit(withBlock, "unavailable"), 1, code);
  }
  const clean = reportOf([]);
  assert.equal(clean.state, "pass");
  assert.equal(reportExit(clean, "fail"), 0);
  assert.equal(reportExit(clean, "unavailable"), 0);
  // --offline's info findings say what was not looked at by choice: still pass
  assert.equal(reportOf([finding("info", "server-unreachable"), finding("info", "peer-unreachable")]).state, "pass");
  // any other warn (the guard saw a stdio server's tools drift) and every block code: fail
  for (const code of AGENT_CODES.filter((c) => !(AGENT_NOT_CHECKED_CODES as readonly string[]).includes(c))) {
    assert.equal(agentState([finding("block", code)]), "fail", code);
    assert.equal(agentState([finding("warn", code)]), "fail", code);
  }
  assert.deepEqual([stateExit("pass"), stateExit("unavailable"), stateExit("fail")], [0, 0, 1]);
  assert.deepEqual([stateExit("pass", "unavailable"), stateExit("unavailable", "unavailable"), stateExit("fail", "unavailable")], [0, 1, 1]);
});

/** check, both ways: the exit under the default and under --fail-on unavailable, and the --json report. */
async function bothWays(f: Fixture, ...extra: string[]): Promise<{ codes: [number, number]; report: AgentReport }> {
  const byDefault = await check(f, ...extra);
  const strict = await check(f, ...extra, "--fail-on", "unavailable");
  assert.equal(strict.report.state, byDefault.report.state);
  return { codes: [byDefault.code, strict.code], report: byDefault.report };
}

test("check end to end: each not-checked code it produces alone is unavailable, exit 0 then 1; with a block, 1 both; --json carries state", async () => {
  // server-not-observed: a stdio server the guard never ran (offline: nothing else is contacted)
  let f = await fixture(false);
  let r = await bothWays(f, "--offline");
  assert.equal(r.report.state, "unavailable");
  assert.deepEqual(r.codes, [0, 1]);

  f = await fixture();
  // server-unreachable: a remote server that answers 401 (the trial's), and one that answers 503
  for (const status of [401, 503]) {
    f.s.lists.set("https://docs.example/mcp", { ok: false, status });
    r = await bothWays(f);
    assert.deepEqual(codes(r.report), ["warn server-unreachable docs"], String(status));
    assert.equal(r.report.state, "unavailable");
    assert.deepEqual(r.codes, [0, 1]);
  }
  // server-refused
  f.s.lists.set("https://docs.example/mcp", { ok: false, refused: "it is a private or loopback address" });
  r = await bothWays(f);
  assert.deepEqual(codes(r.report), ["warn server-refused docs"]);
  assert.deepEqual(r.codes, [0, 1]);
  f.s.lists.delete("https://docs.example/mcp");
  // peer-unreachable
  f.s.cards.set(PEER, 404);
  r = await bothWays(f);
  assert.deepEqual(codes(r.report), [`warn peer-unreachable ${PEER}`]);
  assert.equal(r.report.state, "unavailable");
  assert.deepEqual(r.codes, [0, 1]);
  // with a block beside it: fail, exit 1 both ways
  write(f.dir, { "CLAUDE.md": "# rules, edited\n" });
  r = await bothWays(f);
  assert.equal(r.report.state, "fail");
  assert.deepEqual(r.codes, [1, 1]);
  // (server-auth-missing and link-absent come from the servers and files parts; the table above covers their state)
});

test("a clean check is pass and exit 0 under both --fail-on values; a bad --fail-on is a usage error (exit 2)", async () => {
  const f = await fixture();
  const r = await bothWays(f);
  assert.equal(r.report.state, "pass");
  assert.deepEqual(r.codes, [0, 0]);
  const dir = repo();
  assert.equal(run("agent", "check", "--root", dir, "--offline", "--fail-on", "warn").code, 2);
  const bad = run("agent", "check", "--root", dir, "--offline", "--fail-on", "sometimes");
  assert.equal(bad.code, 2);
  assert.match(bad.err, /--fail-on takes fail or unavailable/);
  assert.equal(run("agent", "check", "--root", dir, "--offline", "--fail-on").code, 2, "--fail-on with no value");
  assert.equal(run("agent", "relock", "--root", dir, "--fail-on", "fail").code, 2, "--fail-on is check's alone");
  // an absent lock checked nothing: exit 1 whatever --fail-on says
  assert.equal(run("agent", "check", "--root", dir, "--offline", "--fail-on", "fail").code, 1);
});

test("Next lines by state: a 401 is told about its key, an unobserved stdio server about the guard, never to approve a verified lock", async () => {
  const f = await fixture();
  // a remote server that answers 401: unavailable; set a key, never relock or approve
  f.s.lists.set("https://docs.example/mcp", { ok: false, status: 401 });
  let { out } = await agent(f.s.deps, "check", "--root", f.dir);
  assert.match(out, /Approval: verified, by Alice/);
  assert.match(out, /State: unavailable: nothing that was checked differs from the approved lock, but 1 MCP server was not checked\./);
  assert.match(out, /Next: check that each MCP server that could not be read answers at its address; one that answers HTTP 401 or 403 needs a key/);
  assert.doesNotMatch(out, /relock|plumbline approve/, "a server that was not checked is not a change to relock, and the approval verifies");
  f.s.lists.delete("https://docs.example/mcp");

  // verified approval with an unreachable peer and a server: one line each, still no approval advice
  f.s.cards.set(PEER, 404);
  f.s.lists.set("https://docs.example/mcp", { ok: false, status: 503 });
  ({ out } = await agent(f.s.deps, "check", "--root", f.dir));
  assert.match(out, /but 1 MCP server and 1 A2A peer were not checked\./);
  assert.match(out, /Next: check that each A2A peer that could not be read serves its card/);
  assert.equal((out.match(/^Next:/gm) ?? []).length, 2);
  assert.doesNotMatch(out, /plumbline approve/);
  f.s.cards.delete(PEER);
  f.s.lists.delete("https://docs.example/mcp");

  // an unobserved stdio server: put the guard in place, then relock; not "approve this lock"
  const g = await fixture(false);
  ({ out } = await agent(g.s.deps, "check", "--root", g.dir, "--offline"));
  assert.match(out, /State: unavailable: .*1 MCP server was not checked\./);
  assert.match(out, /Next: run the agent once with the guard in place \(plumbline agent wrap\)/);
  assert.equal((out.match(/^Next:/gm) ?? []).length, 1);
  assert.doesNotMatch(out, /approve --key/);

  // unapproved: the approval is what failed, so the advice is to approve, not to review a change
  rmSync(path.join(f.dir, AGENT_APPROVAL_FILE));
  ({ out } = await agent(f.s.deps, "check", "--root", f.dir));
  assert.match(out, /Approval: absent\./);
  assert.match(out, /State: fail: 1 change to block\. Any finding fails the check\./);
  assert.doesNotMatch(out, /\b0 warnings\b/, "a zero count is not shown");
  assert.match(out, /Next: a person reviews the lock and approves it \(plumbline approve --key <your key file>\)\./);
  assert.doesNotMatch(out, /review what changed/);

  // a change: review, relock, approve
  await approve(f.dir, f.alice);
  write(f.dir, { "CLAUDE.md": "# rules, edited\n" });
  ({ out } = await agent(f.s.deps, "check", "--root", f.dir));
  assert.match(out, /Next: review what changed; if it is intended, plumbline agent relock/);
});
