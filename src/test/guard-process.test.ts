// The guard's process layer (src/guard/process.ts) with the fake stdio MCP server (src/test/fixtures/guard/), in this
// process: the host side is a pair of streams, the server a real child spawned with this node. No network.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parsePending } from "../agent/pending.js";
import { toolsParts, toolsRecord } from "../core/agent-tools.js";
import { GuardFilter, type GuardPolicy } from "../guard/filter.js";
import { runGuardProcess } from "../guard/process.js";
import { resolveCommand } from "../guard/spawn.js";

const FAKE_SERVER = fileURLToPath(new URL("../../src/test/fixtures/guard/fake-server.mjs", import.meta.url));
const MARKER = "SECRET-DESCRIPTION-MARKER";
const tool = (name: string, description = "d"): Record<string, unknown> => ({ name, description, inputSchema: { type: "object" } });
const lockOf = async (tools: Record<string, unknown>[]): Promise<Record<string, string>> => toolsRecord((await toolsParts(tools)).parts);

const dirs: string[] = [];
process.on("exit", () => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const scratch = (): string => {
  const d = mkdtempSync(path.join(tmpdir(), "plumbline-guard-"));
  dirs.push(d);
  return d;
};

interface Session {
  send: (message: unknown) => void;
  sendRaw: (text: string) => void;
  /** The next message from the guard whose id is `id`. */
  answer: (id: number | string) => Promise<Record<string, unknown>>;
  end: () => void;
  exit: Promise<number>;
  stderr: string[];
  out: string[];
}

function guarded(config: Record<string, unknown>, policy: GuardPolicy, extra: { strict?: boolean; pendingFile?: string; maxMessageBytes?: number; command?: string; args?: string[] } = {}): Session {
  const input = new PassThrough();
  const output = new PassThrough();
  const stderr: string[] = [];
  const out: string[] = [];
  const waiters: { id: unknown; resolve: (m: Record<string, unknown>) => void }[] = [];
  const seen: Record<string, unknown>[] = [];
  let buffer = "";
  output.setEncoding("utf8").on("data", (chunk: string) => {
    buffer += chunk;
    for (let nl = buffer.indexOf("\n"); nl !== -1; nl = buffer.indexOf("\n")) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      out.push(line);
      const m = JSON.parse(line) as Record<string, unknown>;
      const w = waiters.findIndex((x) => x.id === m.id);
      if (w !== -1) waiters.splice(w, 1)[0]?.resolve(m);
      else seen.push(m);
    }
  });
  const filter = new GuardFilter({ policy, label: "fake", ...(extra.strict ? { strict: true } : {}) });
  const exit = runGuardProcess({
    command: extra.command ?? process.execPath,
    args: extra.args ?? [FAKE_SERVER, JSON.stringify(config)],
    filter,
    server: "fake",
    target: "b".repeat(64),
    ...(extra.pendingFile === undefined ? {} : { pendingFile: extra.pendingFile }),
    input,
    output,
    stderr: (line) => stderr.push(line),
    ...(extra.maxMessageBytes === undefined ? {} : { maxMessageBytes: extra.maxMessageBytes }),
  });
  return {
    send: (m) => input.write(JSON.stringify(m) + "\n"),
    sendRaw: (t) => input.write(t),
    answer: (id) => {
      const i = seen.findIndex((m) => m.id === id);
      if (i !== -1) return Promise.resolve(seen.splice(i, 1)[0] as Record<string, unknown>);
      return new Promise((resolve) => waiters.push({ id, resolve }));
    },
    end: () => input.end(),
    exit,
    stderr,
    out,
  };
}

const rpc = (id: number, method: string, params?: unknown) => ({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
const names = (m: Record<string, unknown>): string[] => ((m.result as { tools: { name: string }[] }).tools).map((t) => t.name);

test("end to end: hidden tools are not listed, a call to one is refused and never reaches the server", async () => {
  const dir = scratch();
  const pendingFile = path.join(dir, "pending", "fake.json");
  const tools = [tool("a"), tool("b", MARKER), tool(MARKER)];
  const s = guarded({ tools }, { mode: "enforce", tools: await lockOf([tool("a"), tool("b")]) }, { pendingFile });
  s.send(rpc(1, "initialize", {}));
  await s.answer(1);
  s.send(rpc(2, "tools/list"));
  assert.deepEqual(names(await s.answer(2)), ["a"]);
  s.send(rpc(3, "tools/call", { name: "b", arguments: {} }));
  assert.equal(((await s.answer(3)).error as { code: number }).code, -32601);
  s.send(rpc(4, "tools/call", { name: "a", arguments: {} }));
  assert.ok((await s.answer(4)).result);
  s.send(rpc(5, "fake/calls"));
  assert.deepEqual((await s.answer(5)).result, { calls: ["a"] });
  s.end();
  assert.equal(await s.exit, 0);
  // the observation: every tool the server listed, restricted to the defining keys
  const pending = parsePending(readFileSync(pendingFile, "utf8"));
  assert.ok(pending);
  assert.equal(pending.server, "fake");
  assert.deepEqual(pending.tools, tools);
  assert.deepEqual(readFileSync(pendingFile, "utf8").endsWith("\n"), true);
  // the server's own words are never on stderr
  assert.equal(s.stderr.length, 1);
  assert.doesNotMatch(s.stderr.join("\n"), new RegExp(MARKER));
  assert.match(s.stderr[0] as string, /2 tools hidden \(1 changed, 1 not in the lock/);
});

test("pagination and list_changed through the process", async () => {
  const s = guarded({ tools: [tool("a"), tool("b"), tool("c")], pageSize: 2, toolsAfter: [tool("a", MARKER), tool("c")] }, { mode: "enforce", tools: await lockOf([tool("a"), tool("b"), tool("c")]) });
  s.send(rpc(1, "tools/list"));
  const p1 = await s.answer(1);
  assert.deepEqual(names(p1), ["a", "b"]);
  s.send(rpc(2, "tools/list", { cursor: (p1.result as { nextCursor: string }).nextCursor }));
  assert.deepEqual(names(await s.answer(2)), ["c"]);
  s.send(rpc(3, "fake/change"));
  await s.answer(3);
  assert.ok(s.out.some((l) => l.includes("notifications/tools/list_changed")));
  s.send(rpc(4, "tools/list"));
  const p3 = await s.answer(4);
  assert.deepEqual(names(p3), ["c"]);
  s.end();
  assert.equal(await s.exit, 0);
});

test("a server line that is not JSON is not forwarded, said on stderr without quoting it, and counted", async () => {
  const s = guarded({ garbage: `starting ${MARKER}` }, { mode: "enforce", tools: undefined });
  s.send(rpc(1, "initialize", {}));
  await s.answer(1);
  s.end();
  await s.exit;
  assert.ok(s.out.every((l) => !l.includes(MARKER)));
  assert.equal(s.stderr.length, 1);
  assert.match(s.stderr[0] as string, /a line from the server is not JSON.*\(1 so far\)/);
  assert.doesNotMatch(s.stderr[0] as string, new RegExp(MARKER));
});

test("a message over the ceiling closes both sides with a stderr line, from either side", async () => {
  const fromServer = guarded({ oversize: 5000 }, { mode: "enforce", tools: undefined }, { maxMessageBytes: 4096 });
  fromServer.send(rpc(1, "tools/list"));
  assert.equal(await fromServer.exit, 1);
  assert.match(fromServer.stderr.join("\n"), /a message from the server is larger than 4096 bytes; both sides are closed/);
  assert.equal(fromServer.out.filter((l) => l.includes('"pad"')).length, 0);

  const fromHost = guarded({}, { mode: "enforce", tools: undefined }, { maxMessageBytes: 4096 });
  fromHost.sendRaw('{"jsonrpc":"2.0","id":1,"method":"ping","params":{"x":"' + "y".repeat(5000));
  assert.equal(await fromHost.exit, 1);
  assert.match(fromHost.stderr.join("\n"), /a message from the host is larger than 4096 bytes/);
});

test("the server's exit code is the guard's; an open request is answered when the server exits", async () => {
  const s = guarded({ exitOn: { method: "tools/call", code: 7 } }, { mode: "enforce", tools: await lockOf([tool("echo", "Echo")]) });
  s.send(rpc(1, "tools/list"));
  await s.answer(1);
  s.send(rpc(2, "tools/call", { name: "echo" }));
  assert.ok((await s.answer(2)).error);
  assert.equal(await s.exit, 7);
});

test("stdin closing ends the server and the guard; a server that ignores it is stopped", async () => {
  // each server answers once before stdin closes: a server still starting when the 2 s grace runs out (a loaded test
  // machine) is stopped by a signal, which is the stubborn case, not this one
  const s = guarded({ endCode: 3 }, { mode: "enforce", tools: undefined });
  s.send(rpc(1, "initialize", {}));
  await s.answer(1);
  s.end();
  assert.equal(await s.exit, 3);
  const stubborn = guarded({ ignoreEnd: true }, { mode: "enforce", tools: undefined });
  stubborn.send(rpc(1, "initialize", {}));
  await stubborn.answer(1);
  stubborn.end();
  assert.equal(await stubborn.exit, 1); // ended by a signal
});

test("--strict: drift stops the server and the guard exits 1, the open request answered", async () => {
  const s = guarded({ tools: [tool("a", MARKER)] }, { mode: "enforce", tools: await lockOf([tool("a")]) }, { strict: true });
  s.send(rpc(1, "tools/list"));
  const answer = await s.answer(1);
  assert.match((answer.error as { message: string }).message, /--strict/);
  assert.equal(await s.exit, 1);
});

test("refuse-all still relays: initialize answers, the list is empty, a call is refused", async () => {
  const s = guarded({}, { mode: "refuse", reason: "lock-absent" });
  s.send(rpc(1, "initialize", {}));
  assert.ok((await s.answer(1)).result);
  s.send(rpc(2, "tools/list"));
  assert.deepEqual(names(await s.answer(2)), []);
  s.send(rpc(3, "tools/call", { name: "echo" }));
  assert.ok((await s.answer(3)).error);
  s.send(rpc(4, "fake/calls"));
  assert.deepEqual((await s.answer(4)).result, { calls: [] });
  s.end();
  assert.equal(await s.exit, 0);
});

test("a command that cannot be started exits 2 with a stderr line", async () => {
  const s = guarded({}, { mode: "enforce", tools: undefined }, { command: path.join(scratch(), "no-such-server"), args: [] });
  assert.equal(await s.exit, 2);
  assert.match(s.stderr.join("\n"), /could not be started/);
});

test("Windows: npx resolves to node and npm's npx-cli.js; an npm cmd-shim to its script; another batch file is refused", { skip: process.platform !== "win32" }, async () => {
  const npx = resolveCommand("npx", ["-y", "pkg"]);
  assert.equal(npx.ok, true);
  if (npx.ok) {
    assert.match(npx.file, /node(\.exe)?$/i);
    assert.match(npx.args[0] as string, /node_modules[\\/]npm[\\/]bin[\\/]npx-cli\.js$/);
    assert.deepEqual(npx.args.slice(1), ["-y", "pkg"]);
  }
  // an npm cmd-shim of a package bin, on PATH: the guard runs the fake server through it
  const bin = scratch();
  mkdirSync(path.join(bin, "node_modules", "fake", "bin"), { recursive: true });
  writeFileSync(path.join(bin, "node_modules", "fake", "bin", "fake.mjs"), readFileSync(FAKE_SERVER));
  writeFileSync(path.join(bin, "fake-mcp.cmd"), '@ECHO off\r\nGOTO start\r\n:start\r\nSETLOCAL\r\nSET "_prog=node"\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\fake\\bin\\fake.mjs" %*\r\n');
  writeFileSync(path.join(bin, "other.cmd"), "@echo off\r\necho hi\r\n");
  const env = { ...process.env, PATH: `${bin};${process.env.PATH ?? process.env.Path ?? ""}`, Path: `${bin};${process.env.Path ?? process.env.PATH ?? ""}` };
  const shim = resolveCommand("fake-mcp", ["{}"], env);
  assert.equal(shim.ok && shim.args[0], path.join(bin, "node_modules", "fake", "bin", "fake.mjs"));
  assert.equal(resolveCommand("other", [], env).ok, false);
  // and the real npx starts with no shell (offline: --version reads nothing from the network)
  const r = resolveCommand("npx", ["--version"]);
  assert.ok(r.ok);
  const { spawnSync } = await import("node:child_process");
  if (r.ok) assert.match(spawnSync(r.file, r.args, { encoding: "utf8" }).stdout, /^\d+\.\d+\.\d+/);
  assert.equal(existsSync(FAKE_SERVER), true);
});

test("POSIX: the command is spawned as given", { skip: process.platform === "win32" }, () => {
  assert.deepEqual(resolveCommand("npx", ["-y", "pkg"]), { ok: true, file: "npx", args: ["-y", "pkg"] });
});
