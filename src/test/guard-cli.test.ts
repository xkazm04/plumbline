// `plumbline guard` (src/cli/guard-command.ts): in process with injected readers, and spawned as the built CLI. The
// spawned tests that need a real agent lock reader (WP2's parseAgentLock) skip until it is merged into this tree.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseAgentLock, type Parsed } from "../agent/lock.js";
import { parsePending } from "../agent/pending.js";
import { serverTarget, toolsParts, toolsRecord } from "../core/agent-tools.js";
import type { ApprovalVerdict } from "../core/approve.js";
import type { AgentLock, ApproverEntry } from "../core/types.js";
import { guardCommand, isFileSafeName, LOCKED_MODE_WARNING, type ApproversSource, type GuardDeps } from "../cli/guard-command.js";
import { CLI, NO_NETWORK, scratchDir } from "./cli-helpers.js";

const FAKE_SERVER = fileURLToPath(new URL("../../src/test/fixtures/guard/fake-server.mjs", import.meta.url));
const MARKER = "SECRET-DESCRIPTION-MARKER";
const ECHO = { name: "echo", description: "Echo", inputSchema: { type: "object" } };
const config = (c: Record<string, unknown>): string => JSON.stringify(c);

async function lockFor(server: string, args: string[], tools: Record<string, unknown>[] | undefined): Promise<AgentLock> {
  const target = await serverTarget({ transport: "stdio", command: process.execPath, args });
  return {
    type: "plumbline-agent-lock",
    version: 1,
    declaration: "0".repeat(64),
    files: {},
    mcp: { [server]: { transport: "stdio", target, ...(tools === undefined ? {} : { tools: toolsRecord((await toolsParts(tools)).parts), observedAt: "2026-11-21T00:00:00.000Z" }) } },
    lockedAt: "2026-11-21T00:00:00.000Z",
  };
}

/** Reads the lock as JSON with no checks: the guard's own logic under test, not WP2's reader. */
const looseParse = (text: string): Parsed<AgentLock> => {
  try {
    return { ok: true, value: JSON.parse(text) as AgentLock };
  } catch {
    return { ok: false, problem: "x" };
  }
};

interface Ran {
  code: number;
  stderr: string[];
  out: Record<string, unknown>[];
}

/** Runs guardCommand in process: sends `messages`, waits for an answer to each request, then closes stdin. */
async function runInProcess(argv: string[], messages: Record<string, unknown>[], over: Partial<GuardDeps> = {}): Promise<Ran> {
  const input = new PassThrough();
  const output = new PassThrough();
  const stderr: string[] = [];
  const out: Record<string, unknown>[] = [];
  let buffer = "";
  let expected = messages.filter((m) => m.id !== undefined).length;
  let done: () => void = () => undefined;
  const allAnswered = new Promise<void>((r) => (done = r));
  if (expected === 0) done();
  output.setEncoding("utf8").on("data", (c: string) => {
    buffer += c;
    for (let nl = buffer.indexOf("\n"); nl !== -1; nl = buffer.indexOf("\n")) {
      out.push(JSON.parse(buffer.slice(0, nl)) as Record<string, unknown>);
      buffer = buffer.slice(nl + 1);
      if (--expected === 0) done();
    }
  });
  const deps: GuardDeps = {
    parseLock: looseParse,
    verifyApproval: async () => ({ state: "verified" }),
    resolveApprovers: async () => ({ ok: true, approvers: [], source: "default" }),
    env: process.env,
    input,
    output,
    stderr: (l) => stderr.push(l),
    ...over,
  };
  const running = guardCommand(argv, deps);
  for (const m of messages) {
    input.write(JSON.stringify(m) + "\n");
    // one at a time: each request is answered before the next is sent
    if (m.id !== undefined) await new Promise<void>((r) => {
      const check = (): void => (out.some((o) => o.id === m.id) ? r() : void setTimeout(check, 5));
      check();
    });
  }
  await allAnswered;
  input.end();
  return { code: await running, stderr, out };
}

const rpc = (id: number, method: string, params?: unknown) => ({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
const listed = (r: Ran, id: number): string[] => ((r.out.find((o) => o.id === id)?.result as { tools: { name: string }[] }).tools).map((t) => t.name);

test("guard in --require locked: says so once, hides drift, writes the pending file beside the lock", async () => {
  const dir = scratchDir();
  const args = [FAKE_SERVER, config({ tools: [ECHO, { name: "extra", description: MARKER }] })];
  const lockFile = path.join(dir, "plumbline.agent.lock.json");
  writeFileSync(lockFile, JSON.stringify(await lockFor("docs", args, [ECHO])));
  const r = await runInProcess(["--lock", lockFile, "--server", "docs", "--", process.execPath, ...args], [rpc(1, "tools/list"), rpc(2, "tools/call", { name: "extra" })]);
  assert.equal(r.code, 0);
  assert.deepEqual(listed(r, 1), ["echo"]);
  assert.ok(r.out.find((o) => o.id === 2)?.error);
  assert.equal(r.stderr[0], LOCKED_MODE_WARNING);
  assert.equal(r.stderr.filter((l) => l === LOCKED_MODE_WARNING).length, 1);
  assert.doesNotMatch(r.stderr.join("\n"), new RegExp(`${MARKER}|extra`));
  // locked mode never checked an approval, so nothing it says calls the lock approved
  assert.match(r.stderr.join("\n"), /the server's tools differ from the agent lock: 1 tool hidden/);
  assert.doesNotMatch(r.stderr.join("\n") + JSON.stringify(r.out), /approved agent lock/);
  const pending = parsePending(readFileSync(path.join(dir, ".plumbline", "pending", "docs.json"), "utf8"));
  assert.equal(pending?.target, await serverTarget({ transport: "stdio", command: process.execPath, args }));
  assert.deepEqual(pending?.tools.map((t) => t.name), ["echo", "extra"]);
});

test("guard refuses every tool when the lock is absent, or the command is not the locked one, saying why", async () => {
  const dir = scratchDir();
  const args = [FAKE_SERVER, config({ tools: [ECHO] })];
  const absent = await runInProcess(["--lock", path.join(dir, "none.json"), "--server", "docs", "--", process.execPath, ...args], [rpc(1, "tools/list")]);
  assert.deepEqual(listed(absent, 1), []);
  assert.match(absent.stderr.join("\n"), /the agent lock could not be read, so every tool of this server is refused/);
  const lockFile = path.join(dir, "lock.json");
  writeFileSync(lockFile, JSON.stringify(await lockFor("docs", [FAKE_SERVER, "{}"], [ECHO])));
  const moved = await runInProcess(["--lock", lockFile, "--server", "docs", "--pending", path.join(dir, "p"), "--", process.execPath, ...args], [rpc(1, "tools/list")]);
  assert.deepEqual(listed(moved, 1), []);
  assert.match(moved.stderr.join("\n"), /is not the one the agent lock records/);
  assert.equal(existsSync(path.join(dir, "p", "docs.json")), true);
});

test("guard --require approved: no warning line; absent, tampered and unverifiable approvals refuse; verified passes", async () => {
  const dir = scratchDir();
  const args = [FAKE_SERVER, config({ tools: [ECHO] })];
  const lockFile = path.join(dir, "plumbline.agent.lock.json");
  writeFileSync(lockFile, JSON.stringify(await lockFor("docs", args, [ECHO])));
  const argv = ["--lock", lockFile, "--server", "docs", "--require", "approved", "--", process.execPath, ...args];

  const absent = await runInProcess(argv, [rpc(1, "tools/list")]);
  assert.deepEqual(listed(absent, 1), []);
  assert.match(absent.stderr.join("\n"), /has no approval/);
  assert.ok(!absent.stderr.includes(LOCKED_MODE_WARNING));

  writeFileSync(path.join(dir, "plumbline.agent.approval.json"), JSON.stringify({ kid: "k" }));
  let seenRoot: string | undefined;
  let seenBytes: Uint8Array | undefined;
  const verified = await runInProcess(argv, [rpc(1, "tools/list")], {
    resolveApprovers: async (_f, _e, root): Promise<ApproversSource> => {
      seenRoot = root;
      return { ok: true, approvers: [] as ApproverEntry[], source: "default" };
    },
    verifyApproval: async (bytes): Promise<ApprovalVerdict> => {
      seenBytes = bytes;
      return { state: "verified" };
    },
  });
  assert.deepEqual(listed(verified, 1), ["echo"]);
  assert.equal(seenRoot, dir);
  assert.equal(Buffer.from(seenBytes as Uint8Array).toString("utf8"), readFileSync(lockFile, "utf8"));

  const tampered = await runInProcess(argv, [rpc(1, "tools/list")], { verifyApproval: async () => ({ state: "invalid", reason: "tampered" }) });
  assert.match(tampered.stderr.join("\n"), /changed after it was approved/);
  const noStore = await runInProcess(argv, [rpc(1, "tools/list")], { resolveApprovers: async () => ({ ok: false, absent: true, looked: "x" }) });
  assert.deepEqual(listed(noStore, 1), []);
  assert.match(noStore.stderr.join("\n"), /cannot be verified/);
});

test("guard usage: the command after --, a known --require, --approvers only with approved, no --json", async () => {
  const deps = { input: new PassThrough(), output: new PassThrough() } as Partial<GuardDeps>;
  const base = ["--lock", "l", "--server", "s"];
  await assert.rejects(runInProcess(base, [], deps), /needs the server's command after --/);
  await assert.rejects(runInProcess([...base, "--require", "maybe", "--", "x"], [], deps), /--require takes locked or approved/);
  await assert.rejects(runInProcess([...base, "--approvers", "a", "--", "x"], [], deps), /--approvers goes with --require approved/);
  await assert.rejects(runInProcess([...base, "--json", "--", "x"], [], deps), /no --json/);
  await assert.rejects(runInProcess(["--server", "s", "--", "x"], [], deps), /missing --lock/);
});

test("a host-prefixed server name writes its pending file with the colon encoded; the document keeps the real name", async () => {
  const dir = scratchDir();
  const args = [FAKE_SERVER, config({ tools: [ECHO] })];
  const lockFile = path.join(dir, "plumbline.agent.lock.json");
  writeFileSync(lockFile, JSON.stringify(await lockFor("claude:docs", args, [ECHO])));
  const r = await runInProcess(["--lock", lockFile, "--server", "claude:docs", "--", process.execPath, ...args], [rpc(1, "tools/list")]);
  assert.deepEqual(listed(r, 1), ["echo"]);
  const pending = parsePending(readFileSync(path.join(dir, ".plumbline", "pending", "claude__docs.json"), "utf8"));
  assert.equal(pending?.server, "claude:docs");
});

test("a server name that cannot be a file name writes no pending file and says so", () => {
  for (const bad of ["", ".", "..", "a/b", "a\\b", "c:x", "x\u0000", "trail."]) assert.equal(isFileSafeName(bad), false, JSON.stringify(bad));
  for (const good of ["docs", "my-server_1", "github.com"]) assert.equal(isFileSafeName(good), true);
});

// ---- the built CLI, spawned

function spawnGuard(args: string[], messages: Record<string, unknown>[]): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", NO_NETWORK, CLI, "guard", ...args]);
    let out = "";
    let err = "";
    let answered = 0;
    const wanted = messages.filter((m) => m.id !== undefined).length;
    child.stdout.setEncoding("utf8").on("data", (d: string) => {
      out += d;
      answered = out.split("\n").filter((l) => l.trim() !== "").length;
      if (answered >= wanted) child.stdin.end();
    });
    child.stderr.setEncoding("utf8").on("data", (d: string) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out, err }));
    for (const m of messages) child.stdin.write(JSON.stringify(m) + "\n");
    if (wanted === 0) child.stdin.end();
  });
}

test("CLI: no lock refuses all tools, relays, exits with the server's code, prints nothing but protocol on stdout", async () => {
  const dir = scratchDir();
  const r = await spawnGuard(["--lock", path.join(dir, "none.json"), "--server", "docs", "--", process.execPath, FAKE_SERVER, config({ endCode: 4 })], [rpc(1, "tools/list")]);
  assert.equal(r.code, 4);
  const lines = r.out.trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
  assert.deepEqual(lines.map((l) => l.id), [1]);
  assert.deepEqual((lines[0]?.result as { tools: unknown[] }).tools, []);
  assert.match(r.err, /could not be read, so every tool of this server is refused/);
});

test("CLI: a usage error exits 2 and writes nothing on stdout", async () => {
  const r = await spawnGuard(["--lock", "x", "--server", "s"], []);
  assert.equal(r.code, 2);
  assert.equal(r.out, "");
});

// WP2's reader decides whether a lock written here is usable; until it is merged these wait.
const readerBuilt = parseAgentLock(JSON.stringify({ type: "plumbline-agent-lock", version: 1, declaration: "0".repeat(64), files: {}, lockedAt: "2026-11-21T00:00:00.000Z" })).ok;

test("CLI e2e with a real lock: hides a changed tool, refuses the call, writes the pending file", { skip: readerBuilt ? false : "awaits WP2's parseAgentLock (merge per shared-deps.md)" }, async () => {
  const dir = scratchDir();
  const args = [FAKE_SERVER, config({ tools: [ECHO, { ...ECHO, name: "second", description: MARKER }] })];
  const lockFile = path.join(dir, "plumbline.agent.lock.json");
  writeFileSync(lockFile, JSON.stringify(await lockFor("docs", args, [ECHO, { ...ECHO, name: "second" }]), null, 2) + "\n");
  const r = await spawnGuard(["--lock", lockFile, "--server", "docs", "--", process.execPath, ...args], [rpc(1, "tools/list"), rpc(2, "tools/call", { name: "second" })]);
  assert.equal(r.code, 0);
  const lines = r.out.trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
  assert.deepEqual((lines.find((l) => l.id === 1)?.result as { tools: { name: string }[] }).tools.map((t) => t.name), ["echo"]);
  assert.equal((lines.find((l) => l.id === 2)?.error as { code: number }).code, -32601);
  assert.match(r.err, /1 tool hidden \(1 changed/);
  assert.doesNotMatch(r.err, new RegExp(`${MARKER}|second`));
  mkdirSync(dir, { recursive: true });
  assert.ok(parsePending(readFileSync(path.join(dir, ".plumbline", "pending", "docs.json"), "utf8")));
});

test("CLI e2e with a real lock and --strict: drift exits 1", { skip: readerBuilt ? false : "awaits WP2's parseAgentLock (merge per shared-deps.md)" }, async () => {
  const dir = scratchDir();
  const args = [FAKE_SERVER, config({ tools: [{ ...ECHO, description: MARKER }] })];
  const lockFile = path.join(dir, "plumbline.agent.lock.json");
  writeFileSync(lockFile, JSON.stringify(await lockFor("docs", args, [ECHO]), null, 2) + "\n");
  const r = await spawnGuard(["--lock", lockFile, "--server", "docs", "--strict", "--", process.execPath, ...args], [rpc(1, "tools/list")]);
  assert.equal(r.code, 1);
  assert.doesNotMatch(r.err, new RegExp(MARKER));
});
