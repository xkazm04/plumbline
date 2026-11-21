// The guard's pure decision (src/guard/filter.ts) and policy (src/guard/policy.ts), without processes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { serverTarget, toolsParts, toolsRecord } from "../core/agent-tools.js";
import type { AgentLock } from "../core/types.js";
import type { Parsed } from "../agent/lock.js";
import {
  ALL_REFUSED_MESSAGE,
  GUARD_REFUSALS,
  GUARD_REFUSED_CODE,
  GuardFilter,
  REFUSAL_SENTENCES,
  STOPPED_MESSAGE,
  TOOL_REFUSED_MESSAGE,
  type GuardAction,
  type GuardPolicy,
} from "../guard/filter.js";
import { guardPolicy, type ApprovalOutcome } from "../guard/policy.js";

const MARKER = "SECRET-DESCRIPTION-MARKER";
const tool = (name: string, description = "d"): Record<string, unknown> => ({ name, description, inputSchema: { type: "object" } });
const lockOf = async (tools: Record<string, unknown>[]): Promise<Record<string, string>> => toolsRecord((await toolsParts(tools)).parts);

const req = (id: number | string, method: string, params?: unknown): string => JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
const res = (id: number | string, result: unknown): string => JSON.stringify({ jsonrpc: "2.0", id, result });
const call = (id: number, name: string): string => req(id, "tools/call", { name, arguments: {} });

const of = <K extends GuardAction["kind"]>(actions: GuardAction[], kind: K): Extract<GuardAction, { kind: K }>[] =>
  actions.filter((a): a is Extract<GuardAction, { kind: K }> => a.kind === kind);
const hostJson = (actions: GuardAction[]): Record<string, unknown>[] => of(actions, "to-host").map((a) => JSON.parse(a.line) as Record<string, unknown>);
const stderr = (actions: GuardAction[]): string => of(actions, "stderr").map((a) => a.line).join("\n");

/** Lists through the filter: the host asks, the server answers with `tools`. */
async function list(filter: GuardFilter, id: number, tools: unknown[], cursor?: string, nextCursor?: string): Promise<GuardAction[]> {
  const forwarded = filter.fromHost(req(id, "tools/list", cursor === undefined ? undefined : { cursor }));
  assert.equal(of(forwarded, "to-server").length, 1);
  return filter.fromServer(res(id, { tools, ...(nextCursor === undefined ? {} : { nextCursor }) }));
}
const listedNames = (actions: GuardAction[]): string[] =>
  ((hostJson(actions)[0]?.result as { tools: { name: string }[] }).tools).map((t) => t.name);

test("a list keeps the tools that match the lock and hides changed and unpinned ones; drift is counted on stderr", async () => {
  const locked = await lockOf([tool("a"), tool("b"), tool("gone")]);
  const filter = new GuardFilter({ policy: { mode: "enforce", tools: locked }, label: "docs", pendingPath: "/p/docs.json" });
  const actions = await list(filter, 1, [tool("a"), tool("b", MARKER), tool("zzfresh", MARKER)]);
  assert.deepEqual(listedNames(actions), ["a"]);
  const line = stderr(actions);
  assert.match(line, /2 tools hidden \(1 changed, 1 not in the lock, 0 not a tool\), 1 in the lock no longer listed/);
  assert.match(line, /plumbline agent relock/);
  assert.doesNotMatch(line, new RegExp(`${MARKER}|zzfresh`));
  const pending = of(actions, "pending");
  assert.equal(pending.length, 1);
  assert.deepEqual(pending[0]?.tools.map((t) => t.name), ["a", "b", "zzfresh"]);
});

test("a list that matches the lock says nothing and still writes the observation", async () => {
  const filter = new GuardFilter({ policy: { mode: "enforce", tools: await lockOf([tool("a")]) }, label: "s" });
  const actions = await list(filter, 1, [tool("a")]);
  assert.deepEqual(listedNames(actions), ["a"]);
  assert.equal(stderr(actions), "");
  assert.equal(of(actions, "pending").length, 1);
  // unchanged: the server's own line is forwarded as sent
  assert.equal(of(actions, "to-host")[0]?.line.includes('"tools":[{'), true);
});

test("pages accumulate: each page is filtered, the observation and drift line come once at the end, nextCursor kept", async () => {
  const filter = new GuardFilter({ policy: { mode: "enforce", tools: await lockOf([tool("a"), tool("c")]) }, label: "s" });
  const p1 = await list(filter, 1, [tool("a"), tool("b")], undefined, "2");
  assert.deepEqual(listedNames(p1), ["a"]);
  assert.equal((hostJson(p1)[0]?.result as { nextCursor?: string }).nextCursor, "2");
  assert.equal(of(p1, "pending").length, 0);
  assert.equal(stderr(p1), "");
  // a name repeated on a later page is keyed by its occurrence, so the twin of a passing tool is not passed by it
  const p2 = await list(filter, 2, [tool("c"), tool("a", MARKER)], "2");
  assert.deepEqual(listedNames(p2), ["c"]);
  assert.deepEqual(of(p2, "pending")[0]?.tools.map((t) => t.name), ["a", "b", "c", "a"]);
  assert.match(stderr(p2), /2 tools hidden \(0 changed, 2 not in the lock/);
  // the name "a" has a hidden twin: a call by that name is refused
  assert.equal(hostJson(filter.fromHost(call(3, "a")))[0]?.error !== undefined, true);
  assert.equal(of(filter.fromHost(call(4, "c")), "to-server").length, 1);
});

test("a call to a hidden tool, or before any list, is answered locally with the fixed error and not forwarded", async () => {
  const filter = new GuardFilter({ policy: { mode: "enforce", tools: await lockOf([tool("a")]) }, label: "s" });
  const early = filter.fromHost(call(1, "a"));
  assert.equal(of(early, "to-server").length, 0);
  assert.deepEqual(hostJson(early)[0], { jsonrpc: "2.0", id: 1, error: { code: GUARD_REFUSED_CODE, message: TOOL_REFUSED_MESSAGE } });
  await list(filter, 2, [tool("a"), tool("hidden", MARKER)]);
  const hidden = filter.fromHost(call(3, "hidden"));
  assert.equal(of(hidden, "to-server").length, 0);
  assert.equal((hostJson(hidden)[0]?.error as { code: number }).code, GUARD_REFUSED_CODE);
  assert.doesNotMatch(JSON.stringify(hidden), new RegExp(MARKER));
  assert.deepEqual(of(filter.fromHost(call(4, "a")), "to-server").map((a) => a.line), [call(4, "a")]);
  // a call as a notification (no id) is dropped, never forwarded
  assert.deepEqual(filter.fromHost(JSON.stringify({ jsonrpc: "2.0", method: "tools/call", params: { name: "hidden" } })), []);
  assert.equal(filter.counts.callsRefused, 3);
});

test("list_changed passes through and makes every tool uncallable until the next list, which is filtered again", async () => {
  const filter = new GuardFilter({ policy: { mode: "enforce", tools: await lockOf([tool("a"), tool("b")]) }, label: "s" });
  await list(filter, 1, [tool("a"), tool("b")]);
  assert.equal(of(filter.fromHost(call(2, "b")), "to-server").length, 1);
  await filter.fromServer(res(2, {}));
  const note = JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
  assert.deepEqual(of(await filter.fromServer(note), "to-host").map((a) => a.line), [note]);
  assert.equal(of(filter.fromHost(call(3, "b")), "to-server").length, 0);
  const again = await list(filter, 4, [tool("a"), tool("b", MARKER)]);
  assert.deepEqual(listedNames(again), ["a"]);
  assert.equal(of(filter.fromHost(call(5, "b")), "to-server").length, 0);
  assert.equal(of(filter.fromHost(call(6, "a")), "to-server").length, 1);
});

test("other traffic passes as sent: requests, responses, server requests, errors to tools/list", async () => {
  const filter = new GuardFilter({ policy: { mode: "enforce", tools: undefined }, label: "s" });
  const init = req(1, "initialize", { protocolVersion: "2025-06-18" });
  assert.deepEqual(filter.fromHost(init), [{ kind: "to-server", line: init }]);
  const answer = res(1, { capabilities: {} });
  assert.deepEqual(await filter.fromServer(answer), [{ kind: "to-host", line: answer }]);
  const sampling = req("s1", "sampling/createMessage", {});
  assert.deepEqual(await filter.fromServer(sampling), [{ kind: "to-host", line: sampling }]);
  const reply = res("s1", { content: {} });
  assert.deepEqual(filter.fromHost(reply), [{ kind: "to-server", line: reply }]);
  filter.fromHost(req(2, "tools/list"));
  const failed = JSON.stringify({ jsonrpc: "2.0", id: 2, error: { code: -1, message: "x" } });
  assert.deepEqual(await filter.fromServer(failed), [{ kind: "to-host", line: failed }]);
});

test("a lock that never observed the server passes nothing: every tool is unpinned", async () => {
  const filter = new GuardFilter({ policy: { mode: "enforce", tools: undefined }, label: "s" });
  const actions = await list(filter, 1, [tool("a")]);
  assert.deepEqual(listedNames(actions), []);
  assert.match(stderr(actions), /1 tool hidden \(0 changed, 1 not in the lock/);
  assert.equal(of(actions, "pending").length, 1);
});

test("refuse-all: each reason has its own fixed stderr line, lists are empty, calls refused, the protocol still flows", async () => {
  const sentences = new Set<string>();
  for (const reason of GUARD_REFUSALS) {
    const filter = new GuardFilter({ policy: { mode: "refuse", reason }, label: "docs" });
    const [line] = filter.startLines();
    assert.equal(line, `plumbline guard: docs: ${REFUSAL_SENTENCES[reason]}`);
    assert.match(line as string, /every tool/);
    sentences.add(REFUSAL_SENTENCES[reason]);
    const listed = await list(filter, 1, [tool("a")], undefined, "1");
    assert.deepEqual(listedNames(listed), []);
    assert.equal((hostJson(listed)[0]?.result as { nextCursor?: string }).nextCursor, "1");
    const refused = filter.fromHost(call(2, "a"));
    assert.equal(of(refused, "to-server").length, 0);
    assert.equal((hostJson(refused)[0]?.error as { message: string }).message, ALL_REFUSED_MESSAGE);
    assert.equal(of(filter.fromHost(req(3, "ping")), "to-server").length, 1);
  }
  assert.equal(sentences.size, GUARD_REFUSALS.length);
});

test("--strict: drift in a completed list answers every open host request with an error and stops", async () => {
  const filter = new GuardFilter({ policy: { mode: "enforce", tools: await lockOf([tool("a")]) }, label: "s", strict: true });
  filter.fromHost(req(7, "resources/list"));
  const actions = await list(filter, 1, [tool("a", MARKER)]);
  const answers = hostJson(actions);
  assert.deepEqual(answers.map((a) => a.id).sort(), [1, 7]);
  for (const a of answers) assert.equal((a.error as { message: string }).message, STOPPED_MESSAGE);
  assert.deepEqual(of(actions, "stop"), [{ kind: "stop", exitCode: 1 }]);
  assert.match(stderr(actions), /--strict: the server is stopped/);
  assert.equal(filter.isStopped, true);
  assert.deepEqual(filter.fromHost(req(8, "ping")), []);
});

test("--strict without drift does not stop", async () => {
  const filter = new GuardFilter({ policy: { mode: "enforce", tools: await lockOf([tool("a")]) }, label: "s", strict: true });
  const actions = await list(filter, 1, [tool("a")]);
  assert.equal(of(actions, "stop").length, 0);
});

test("a line that is not JSON, or repeats a key, is a protocol error: not forwarded, counted, never quoted", async () => {
  const filter = new GuardFilter({ policy: { mode: "enforce", tools: undefined }, label: "s" });
  const a = await filter.fromServer(`log: ${MARKER}`);
  assert.equal(of(a, "to-host").length, 0);
  assert.match(stderr(a), /not JSON .* not forwarded \(1 so far\)/);
  assert.doesNotMatch(stderr(a), new RegExp(MARKER));
  filter.fromHost(req(1, "tools/list"));
  const dup = '{"jsonrpc":"2.0","id":1,"result":{"tools":[],"tools":[{"name":"x"}]}}';
  assert.equal(of(await filter.fromServer(dup), "to-host").length, 0);
  assert.equal(filter.counts.serverProtocolErrors, 2);
  assert.equal(of(filter.fromHost('{"method":"tools/call","params":{"name":"a","name":"b"},"id":2}'), "to-server").length, 0);
  assert.equal(filter.counts.hostProtocolErrors, 1);
});

test("a batch from the host: the refused call is answered, the rest forwarded; a batch from the server is filtered per item", async () => {
  const filter = new GuardFilter({ policy: { mode: "enforce", tools: await lockOf([tool("a")]) }, label: "s" });
  const actions = filter.fromHost(JSON.stringify([JSON.parse(req(1, "tools/list")), JSON.parse(call(2, "a")), JSON.parse(req(3, "ping"))]));
  const forwarded = JSON.parse(of(actions, "to-server")[0]?.line as string) as { id: number }[];
  assert.deepEqual(forwarded.map((m) => m.id), [1, 3]);
  const answered = JSON.parse(of(actions, "to-host")[0]?.line as string) as { id: number }[];
  assert.deepEqual(answered.map((m) => m.id), [2]);
  const back = await filter.fromServer(JSON.stringify([JSON.parse(res(1, { tools: [tool("a"), tool("b")] })), JSON.parse(res(3, {}))]));
  const relayed = JSON.parse(of(back, "to-host")[0]?.line as string) as { id: number; result: { tools?: { name: string }[] } }[];
  assert.deepEqual(relayed[0]?.result.tools?.map((t) => t.name), ["a"]);
  assert.equal(relayed[1]?.id, 3);
});

test("entries that are not tools are hidden and counted as such", async () => {
  const filter = new GuardFilter({ policy: { mode: "enforce", tools: await lockOf([tool("a")]) }, label: "s" });
  const actions = await list(filter, 1, [tool("a"), "junk", { description: MARKER }]);
  assert.deepEqual(listedNames(actions), ["a"]);
  assert.match(stderr(actions), /2 tools hidden \(0 changed, 0 not in the lock, 2 not a tool\)/);
  assert.deepEqual(of(actions, "pending")[0]?.tools.map((t) => t.name), ["a"]);
});

// ---- policy

const lockText = (mcp: unknown): string => JSON.stringify({ mcp });
const parseLock = (text: string): Parsed<AgentLock> => {
  try {
    const v = JSON.parse(text) as AgentLock;
    return { ok: true, value: v };
  } catch {
    return { ok: false, problem: "x" };
  }
};

async function policyOf(over: { lockText?: string | undefined; server?: string; command?: string; args?: string[]; require?: "locked" | "approved"; approval?: ApprovalOutcome | "throws" }): Promise<GuardPolicy> {
  const target = await serverTarget({ transport: "stdio", command: "node", args: ["s.js"] });
  const text = "lockText" in over ? over.lockText : lockText({ docs: { transport: "stdio", target, tools: { k: "v" } } });
  const decision = await guardPolicy({
    lockText: text,
    parseLock,
    server: over.server ?? "docs",
    command: over.command ?? "node",
    args: over.args ?? ["s.js"],
    require: over.require ?? "locked",
    approval: async () => {
      if (over.approval === "throws") throw new Error("x");
      return over.approval ?? { state: "verified" };
    },
  });
  return decision.policy;
}

test("policy: each way the lock cannot be used refuses all tools; a usable one enforces its tools", async () => {
  assert.deepEqual(await policyOf({}), { mode: "enforce", tools: { k: "v" } });
  assert.deepEqual(await policyOf({ lockText: undefined }), { mode: "refuse", reason: "lock-absent" });
  assert.deepEqual(await policyOf({ lockText: "not json" }), { mode: "refuse", reason: "lock-unusable" });
  assert.deepEqual(await policyOf({ server: "other" }), { mode: "refuse", reason: "server-absent" });
  assert.deepEqual(await policyOf({ server: "toString" }), { mode: "refuse", reason: "server-absent" });
  assert.deepEqual(await policyOf({ lockText: lockText({ docs: { transport: "http", target: "x" } }) }), { mode: "refuse", reason: "server-not-stdio" });
  assert.deepEqual(await policyOf({ args: ["other.js"] }), { mode: "refuse", reason: "server-target-changed" });
  assert.deepEqual(await policyOf({ command: "evil" }), { mode: "refuse", reason: "server-target-changed" });
});

test("policy --require approved: the four approval states map as shared-deps says; an error is never verified", async () => {
  assert.equal((await policyOf({ require: "approved" })).mode, "enforce");
  assert.deepEqual(await policyOf({ require: "approved", approval: { state: "absent" } }), { mode: "refuse", reason: "lock-unapproved" });
  assert.deepEqual(await policyOf({ require: "approved", approval: { state: "invalid", reason: "tampered" } }), { mode: "refuse", reason: "lock-changed-after-approval" });
  assert.deepEqual(await policyOf({ require: "approved", approval: { state: "invalid", reason: "bad-signature" } }), { mode: "refuse", reason: "approval-invalid" });
  assert.deepEqual(await policyOf({ require: "approved", approval: { state: "unverifiable" } }), { mode: "refuse", reason: "approval-unverifiable" });
  assert.deepEqual(await policyOf({ require: "approved", approval: "throws" }), { mode: "refuse", reason: "approval-unverifiable" });
  // locked mode never asks for the approval
  assert.equal((await policyOf({ require: "locked", approval: "throws" })).mode, "enforce");
});

test("policy: no arguments matches a lock that recorded args omitted or empty", async () => {
  for (const args of [undefined, []]) {
    const target = await serverTarget(args === undefined ? { transport: "stdio", command: "srv" } : { transport: "stdio", command: "srv", args });
    const d = await guardPolicy({ lockText: lockText({ s: { transport: "stdio", target } }), parseLock, server: "s", command: "srv", args: [], require: "locked", approval: async () => ({ state: "verified" }) });
    assert.equal(d.policy.mode, "enforce");
    assert.equal(d.target, target);
  }
});
