// Putting the guard in place (src/cli/agent-wrap.ts, src/guard/spawn.ts whichPosix, src/agent/discover.ts guardForm):
// the short form when `plumbline` resolves on PATH, the absolute form when it does not, `agent wrap` on an existing
// declaration (wrap, then relock with the chain kept), and the absolute form read back as wrapped. PATH is always the
// test's own (an empty one, or a folder holding a fake plumbline), never this machine's. No network.
import assert from "node:assert/strict";
import { chmodSync, existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { sha256Hex } from "../core/canonical.js";
import { AGENT_FILE, AGENT_LOCK_FILE, type AgentDeclaration, type AgentLock } from "../core/types.js";
import { CliError } from "../cli/args.js";
import { guardForm, unwrapGuard } from "../agent/discover.js";
import { whichPosix } from "../guard/spawn.js";
import { cliEntry, guardLauncher, launcherSentence } from "../cli/agent-wrap.js";
import { agent, json, plumblineOnPath, read, repo, spy, write } from "./agent-helpers.js";

const SECRET = "sk-SECRET-TOKEN-0123456789";
const GUARD = ["guard", "--lock", "plumbline.agent.lock.json", "--server", "files", "--", "npx", "-y", "files"];
const HOST = { mcpServers: { files: { command: "npx", args: ["-y", "files"], env: { T: SECRET } }, docs: { type: "http", url: "https://d.example/mcp" } } };

type Host = { mcpServers: Record<string, { command?: string; args?: string[]; env?: Record<string, string> }> };
const hostOf = (dir: string): Host => JSON.parse(read(dir, ".mcp.json")) as Host;
const lockOf = (dir: string): AgentLock => JSON.parse(read(dir, AGENT_LOCK_FILE)) as AgentLock;

/** A repository initialised without --wrap: a declaration and a lock exist, the stdio entry is not wrapped. */
async function initialised(): Promise<string> {
  const dir = repo({ "CLAUDE.md": "# rules\n", ".mcp.json": json(HOST) });
  assert.equal((await agent(spy().deps, "init", "--root", dir)).code, 0);
  return dir;
}

test("whichPosix: a name with a / as given, else the first executable file of that name on PATH; empty PATH entries skipped", () => {
  const exec = new Set(["/usr/local/bin/plumbline", "/opt/x/plumbline", "/bin/tool"]);
  const isExec = (f: string): boolean => exec.has(f);
  assert.equal(whichPosix("plumbline", { PATH: "/usr/bin:/usr/local/bin:/opt/x" }, isExec), "/usr/local/bin/plumbline");
  assert.equal(whichPosix("plumbline", { PATH: "::/usr/bin" }, isExec), undefined);
  assert.equal(whichPosix("plumbline", {}, isExec), undefined);
  assert.equal(whichPosix("/bin/tool", {}, isExec), "/bin/tool");
  assert.equal(whichPosix("./tool", { PATH: "/bin" }, isExec), undefined);
  assert.deepEqual(
    (() => {
      const seen: string[] = [];
      whichPosix("p", { PATH: "/a::/b" }, (f) => (seen.push(f), false));
      return seen;
    })(),
    ["/a/p", "/b/p"],
  );
});

test("whichPosix on real files: an executable file is found, one without an execute bit is not", { skip: process.platform === "win32" ? "Windows has no execute bits (statSync reports none); the injected test above covers the rule" : false }, () => {
  const dir = repo();
  writeFileSync(path.join(dir, "plumbline"), "#!/bin/sh\n");
  chmodSync(path.join(dir, "plumbline"), 0o644);
  assert.equal(whichPosix("plumbline", { PATH: dir }), undefined);
  chmodSync(path.join(dir, "plumbline"), 0o755);
  assert.equal(whichPosix("plumbline", { PATH: dir }), path.posix.join(dir, "plumbline"));
});

test("the launcher: plumbline when it resolves on PATH, else this node and this CLI's entry, with the sentence", () => {
  assert.deepEqual(guardLauncher(plumblineOnPath()), { command: "plumbline", prefix: [], short: true });
  assert.equal(launcherSentence(guardLauncher(plumblineOnPath())), undefined);
  const absolute = guardLauncher({});
  assert.deepEqual(absolute, { command: process.execPath, prefix: [cliEntry()], short: false });
  assert.match(cliEntry().replaceAll("\\", "/"), /\/dist\/cli\/index\.js$/);
  assert.ok(path.isAbsolute(cliEntry()));
  assert.match(launcherSentence(absolute)!, /plumbline is not on PATH, so each wrapped entry runs the guard as .*: paths on this machine/);
  assert.match(launcherSentence(absolute)!, /npm link in its checkout, or install it\), then run plumbline agent wrap\./);
  assert.equal(guardLauncher({ PATH: "" }, "linux", "/x/dist/cli/index.js", "/usr/bin/node").command, "/usr/bin/node");
});

test("guardForm and unwrapGuard read the absolute form as wrapped (either separator); node with another script is not wrapped", () => {
  const win = ["C:\\Program Files\\nodejs\\node.exe", ["C:\\work\\plumbline\\dist\\cli\\index.js", ...GUARD]] as const;
  const posix = ["/usr/local/bin/node", ["/home/a/plumbline/dist/cli/index.js", ...GUARD]] as const;
  assert.equal(guardForm(win[0], win[1]), "absolute");
  assert.equal(guardForm(posix[0], posix[1]), "absolute");
  assert.equal(guardForm("plumbline", GUARD), "short");
  assert.deepEqual(unwrapGuard(win[0], win[1]), { command: "npx", args: ["-y", "files"] });
  assert.deepEqual(unwrapGuard(posix[0], posix[1]), { command: "npx", args: ["-y", "files"] });
  assert.equal(guardForm("/usr/bin/node", ["/srv/server.js", ...GUARD]), undefined);
  assert.equal(guardForm("/usr/bin/python", ["/a/dist/cli/index.js", ...GUARD]), undefined);
  assert.equal(guardForm("/usr/bin/node", ["/a/dist/cli/index.js", "watch"]), undefined);
  assert.equal(guardForm("/usr/bin/node", ["/a/mydist/cli/index.js", ...GUARD]), undefined);
});

test("agent wrap on an existing declaration: plumbline off PATH writes the absolute form with its sentence, then relocks with the chain kept", async () => {
  const dir = await initialised();
  const oldLock = read(dir, AGENT_LOCK_FILE);
  const declaration = read(dir, AGENT_FILE);
  const { code, out } = await agent(spy().deps, "wrap", "--root", dir);
  assert.equal(code, 0);
  assert.equal(read(dir, ".mcp.json.plumbline-backup"), json(HOST), "the backup is the host file as it was");
  const host = hostOf(dir);
  assert.deepEqual(host.mcpServers.files, { command: process.execPath, args: [cliEntry(), ...GUARD], env: { T: SECRET } }, "env kept");
  assert.deepEqual(host.mcpServers.docs, HOST.mcpServers.docs);
  const lock = lockOf(dir);
  assert.equal(lock.previous, await sha256Hex(oldLock), "the new lock's previous is the old lock's hash");
  assert.equal(lock.files[".mcp.json"], await sha256Hex(read(dir, ".mcp.json")), "the lock covers the edited host file");
  assert.equal(read(dir, AGENT_FILE), declaration, "the declaration is unchanged: the guarded command is the same");
  assert.match(out, /Put the guard in front of 1 stdio server; the earlier 1 file kept as \.mcp\.json\.plumbline-backup:/);
  assert.match(out, /plumbline is not on PATH/);
  assert.match(out, /file changed: \.mcp\.json/);
  assert.match(out, /Commit \.mcp\.json with the new lock/);
  assert.ok(!out.includes(SECRET), "env is never printed");

  // wrapped once: a second wrap has nothing to do and writes nothing
  rmSync(path.join(dir, ".mcp.json.plumbline-backup"));
  const lockBytes = read(dir, AGENT_LOCK_FILE);
  const again = await agent(spy().deps, "wrap", "--root", dir);
  assert.equal(again.code, 0);
  assert.match(again.out, /already runs the guard \(1 entry\); nothing was written and the lock is unchanged/);
  assert.equal(read(dir, AGENT_LOCK_FILE), lockBytes);
  assert.equal(existsSync(path.join(dir, ".mcp.json.plumbline-backup")), false);
});

test("discover reads the absolute form as wrapped: init declares the guarded command and does not wrap it again", async () => {
  const wrapped = { command: process.execPath, args: [cliEntry(), ...GUARD], env: { T: SECRET } };
  const dir = repo({ ".mcp.json": json({ mcpServers: { files: wrapped } }) });
  const { code, out } = await agent(spy().deps, "init", "--root", dir, "--wrap");
  assert.equal(code, 0);
  assert.deepEqual((JSON.parse(read(dir, AGENT_FILE)) as AgentDeclaration).mcp, { files: { transport: "stdio", command: "npx", args: ["-y", "files"] } });
  assert.match(out, /files already runs the guard/);
  assert.equal(existsSync(path.join(dir, ".mcp.json.plumbline-backup")), false, "nothing to wrap, so no backup");
});

test("agent wrap with plumbline on PATH writes the short form, and rewrites an absolute-form entry to it", async () => {
  const dir = await initialised();
  await agent(spy().deps, "wrap", "--root", dir);
  assert.equal(hostOf(dir).mcpServers.files!.command, process.execPath);
  rmSync(path.join(dir, ".mcp.json.plumbline-backup"));
  const before = read(dir, AGENT_LOCK_FILE);
  const { code, out } = await agent(spy(plumblineOnPath()).deps, "wrap", "--root", dir, "--json");
  assert.equal(code, 0);
  assert.deepEqual(hostOf(dir).mcpServers.files, { command: "plumbline", args: GUARD, env: { T: SECRET } });
  const result = JSON.parse(out) as { wrapped: string[]; shortened: { file: string; server: string }[]; launcher: string; relocked: boolean; relock: { previous: string; files: { changed: string[] } } };
  assert.deepEqual(result.wrapped, [".mcp.json"]);
  assert.deepEqual(result.shortened, [{ file: ".mcp.json", server: "files" }]);
  assert.equal(result.launcher, "plumbline");
  assert.equal(result.relock.previous, await sha256Hex(before));
  assert.deepEqual(result.relock.files.changed, [".mcp.json"]);

  const fresh = await initialised();
  const text = await agent(spy(plumblineOnPath()).deps, "wrap", "--root", fresh);
  assert.deepEqual(hostOf(fresh).mcpServers.files, { command: "plumbline", args: GUARD, env: { T: SECRET } });
  assert.doesNotMatch(text.out, /not on PATH/);
});

test("agent wrap refuses before writing: no declaration, no lock, or a backup that exists", async () => {
  await assert.rejects(agent(spy().deps, "wrap", "--root", repo({ ".mcp.json": json(HOST) })), (e: unknown) => e instanceof CliError && /run plumbline agent init --wrap/.test(e.message));
  const noLock = await initialised();
  rmSync(path.join(noLock, AGENT_LOCK_FILE));
  await assert.rejects(agent(spy().deps, "wrap", "--root", noLock), (e: unknown) => e instanceof CliError && /no agent lock/.test(e.message));
  assert.equal(read(noLock, ".mcp.json"), json(HOST));
  const dir = await initialised();
  write(dir, { ".mcp.json.plumbline-backup": "earlier" });
  const lock = read(dir, AGENT_LOCK_FILE);
  await assert.rejects(agent(spy().deps, "wrap", "--root", dir), (e: unknown) => e instanceof CliError && /plumbline-backup exists/.test(e.message));
  assert.equal(read(dir, ".mcp.json.plumbline-backup"), "earlier");
  assert.equal(read(dir, ".mcp.json"), json(HOST));
  assert.equal(read(dir, AGENT_LOCK_FILE), lock);
});

test("init's hint points at agent wrap, never at deleting its files; off PATH it shows the absolute form and says why", async () => {
  const dir = repo({ ".mcp.json": json(HOST) });
  const { out } = await agent(spy().deps, "init", "--root", dir);
  assert.match(out, /run plumbline agent wrap \(it keeps a backup and relocks\)/);
  assert.doesNotMatch(out, /after removing/);
  assert.ok(out.includes(JSON.stringify(process.execPath).slice(1, -1)), "the absolute form is shown");
  assert.match(out, /plumbline is not on PATH/);
});
