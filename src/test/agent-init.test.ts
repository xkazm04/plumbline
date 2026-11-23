// `plumbline agent init` (src/cli/agent-command.ts, src/agent/discover.ts): declaring and locking an agent from the
// files three agent hosts keep. In-process with an injected lister and fetcher; no network.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { serverTarget, toolsParts, toolsRecord } from "../core/agent-tools.js";
import { sha256Hex } from "../core/canonical.js";
import { AGENT_FILE, AGENT_LOCK_FILE, type AgentDeclaration, type AgentLock } from "../core/types.js";
import { CliError } from "../cli/args.js";
import { parseAgentLock, parseDeclaration } from "../agent/lock.js";
import { globMatch } from "../agent/glob.js";
import { frontMatterModel, unwrapGuard } from "../agent/discover.js";
import { agent, allFiles, json, read, repo, spy, TOOLS_A } from "./agent-helpers.js";

const SECRET = "sk-SECRET-TOKEN-0123456789";

function declared(dir: string): AgentDeclaration {
  const parsed = parseDeclaration(read(dir, AGENT_FILE));
  assert.ok(parsed.ok, "the declaration init wrote reads back");
  return parsed.value;
}
function locked(dir: string): AgentLock {
  const parsed = parseAgentLock(read(dir, AGENT_LOCK_FILE));
  assert.ok(parsed.ok, "the lock init wrote reads back");
  return parsed.value;
}
function noSecret(dir: string, out: string, files = [AGENT_FILE, AGENT_LOCK_FILE, ".gitignore"]): void {
  assert.ok(!out.includes(SECRET), "a secret reached the output");
  for (const rel of files) if (existsSync(path.join(dir, rel))) assert.ok(!read(dir, rel).includes(SECRET), `a secret reached ${rel}`);
}

test("glob matcher: * is one segment, ** any depth (none included)", () => {
  assert.ok(globMatch(".claude/agents/**", ".claude/agents/a.md"));
  assert.ok(globMatch(".claude/agents/**", ".claude/agents/x/y/a.md"));
  assert.ok(globMatch("**/SKILL.md", "SKILL.md"));
  assert.ok(globMatch(".claude/skills/*/SKILL.md", ".claude/skills/x/SKILL.md"));
  assert.equal(globMatch(".claude/skills/*/SKILL.md", ".claude/skills/x/y/SKILL.md"), false);
  assert.ok(globMatch("docs/*.md", "docs/a.b.md"));
  assert.equal(globMatch("docs/*.md", "docs/a.txt"), false);
  assert.equal(globMatch("CLAUDE.md", "x/CLAUDE.md"), false);
});

test("front matter model and guard unwrapping", () => {
  assert.equal(frontMatterModel("---\nname: r\nmodel: 'claude-sonnet'\n---\nbody"), "claude-sonnet");
  assert.equal(frontMatterModel("---\r\nmodel: opus\r\n---\r\n"), "opus");
  assert.equal(frontMatterModel("no front matter\nmodel: x"), undefined);
  assert.deepEqual(unwrapGuard("plumbline", ["guard", "--lock", "l", "--server", "s", "--", "npx", "-y", "x"]), { command: "npx", args: ["-y", "x"] });
  assert.equal(unwrapGuard("npx", ["guard"]), undefined);
});

test("Claude Code only: servers, files and models are declared; secrets, settings.local.json and worktrees never", async () => {
  const dir = repo({
    "CLAUDE.md": "# rules\n",
    ".mcp.json": json({
      mcpServers: {
        files: { command: "npx", args: ["-y", "@example/files"], env: { TOKEN: SECRET } },
        docs: { type: "http", url: "https://docs.example/mcp", headers: { Authorization: `Bearer ${SECRET}` } },
        old: { type: "sse", url: "https://old.example/sse" },
      },
    }),
    ".claude/settings.json": json({ model: "claude-opus-5-5", env: { KEY: SECRET } }),
    ".claude/settings.local.json": json({ env: { KEY: SECRET } }),
    ".claude/agents/reviewer.md": "---\nname: reviewer\nmodel: claude-sonnet-5\n---\nReview.\n",
    ".claude/worktrees/w1/CLAUDE.md": "another checkout\n",
    ".claude/commands/ship.md": "ship it\n",
    "src/app.ts": "export {};\n",
  });
  const s = spy({ PLUMBLINE_DOCS_AUTHORIZATION: "Bearer the-variable-value" });
  const { code, out } = await agent(s.deps, "init", "--root", dir);
  assert.equal(code, 0);
  const d = declared(dir);
  assert.equal(d.version, 2);
  assert.deepEqual(d.files, ["CLAUDE.md", ".mcp.json", ".claude/settings.json", ".claude/agents/**", ".claude/commands/**"]);
  assert.deepEqual(d.models, { default: "claude-opus-5-5", reviewer: "claude-sonnet-5" });
  assert.deepEqual(d.mcp, {
    docs: { transport: "http", url: "https://docs.example/mcp", auth: { Authorization: "PLUMBLINE_DOCS_AUTHORIZATION" }, from: "claude" },
    files: { transport: "stdio", command: "npx", args: ["-y", "@example/files"], from: "claude" },
    old: { transport: "http", url: "https://old.example/sse", from: "claude" },
  });
  const l = locked(dir);
  assert.equal(l.previous, undefined, "a first lock has no previous");
  assert.equal(l.declaration, await sha256Hex(read(dir, AGENT_FILE)));
  assert.deepEqual(Object.keys(l.files).sort(), [".claude/agents/reviewer.md", ".claude/commands/ship.md", ".claude/settings.json", ".mcp.json", "CLAUDE.md"]);
  assert.ok(!Object.keys(l.files).some((f) => f.includes("settings.local") || f.includes("worktrees")));
  assert.equal(l.mcp?.files?.tools, undefined, "a stdio server is not observed at init");
  assert.equal(l.mcp?.files?.target, await serverTarget({ transport: "stdio", command: "npx", args: ["-y", "@example/files"] }));
  assert.deepEqual(l.mcp?.docs?.tools, toolsRecord((await toolsParts(TOOLS_A)).parts));
  assert.deepEqual(s.listerCalls.sort(), ["https://docs.example/mcp", "https://old.example/sse"]);
  assert.match(out, /Locked: 3 MCP servers \(1 stdio, 2 http\), 5 files, 2 models, 0 peers/);
  assert.match(out, /1 stdio server will be observed by the guard/);
  assert.match(out, /SSE server; it is declared as http/);
  assert.match(out, /"command":"plumbline","args":\["guard","--lock","plumbline.agent.lock.json","--server","files","--","npx","-y","@example\/files"\]/);
  assert.match(out, /Next: approve the lock \(plumbline approve --key/);
  assert.match(read(dir, ".gitignore"), /^\.plumbline\/$/m);
  assert.match(out, /Added \.plumbline\/ to \.gitignore/);
  noSecret(dir, out);
});

test("VS Code only: servers under `servers` with type stdio and http", async () => {
  const dir = repo({
    ".vscode/mcp.json": json({
      servers: {
        git: { type: "stdio", command: "uvx", args: ["mcp-server-git"], env: { T: SECRET } },
        learn: { type: "http", url: "https://learn.example/api/mcp", headers: { "X-Key": SECRET } },
      },
    }),
    ".gitignore": "node_modules/\n.plumbline/\n",
  });
  const s = spy();
  const { code, out } = await agent(s.deps, "init", "--root", dir);
  assert.equal(code, 0);
  const d = declared(dir);
  assert.deepEqual(d.files, [".vscode/mcp.json"]);
  assert.equal(d.models, undefined);
  assert.deepEqual(d.mcp, {
    git: { transport: "stdio", command: "uvx", args: ["mcp-server-git"], from: "vscode" },
    learn: { transport: "http", url: "https://learn.example/api/mcp", auth: { "X-Key": "PLUMBLINE_LEARN_X_KEY" }, from: "vscode" },
  });
  assert.equal(read(dir, ".gitignore"), "node_modules/\n.plumbline/\n", "an ignored .plumbline/ is not added twice");
  noSecret(dir, out);
});

test("Cursor only: remote servers by url, no type", async () => {
  const dir = repo({
    ".cursor/mcp.json": json({ mcpServers: { wiki: { url: "https://wiki.example/mcp", headers: { a: SECRET } }, local: { command: "node", args: ["server.js"] } } }),
  });
  const s = spy();
  const { code, out } = await agent(s.deps, "init", "--root", dir);
  assert.equal(code, 0);
  assert.deepEqual(declared(dir).mcp, {
    local: { transport: "stdio", command: "node", args: ["server.js"], from: "cursor" },
    wiki: { transport: "http", url: "https://wiki.example/mcp", auth: { a: "PLUMBLINE_WIKI_A" }, from: "cursor" },
  });
  noSecret(dir, out);
});

test("all three hosts: one name for two targets is kept per host; the same server in two hosts once", async () => {
  const dir = repo({
    ".mcp.json": json({ mcpServers: { github: { command: "npx", args: ["gh-a"] }, same: { command: "x" } } }),
    ".cursor/mcp.json": json({ mcpServers: { github: { command: "npx", args: ["gh-b"] }, same: { command: "x" } } }),
    ".vscode/mcp.json": json({ servers: { other: { type: "http", url: "https://o.example/mcp" }, plain: { type: "http", url: "http://localhost:3000/mcp" } } }),
  });
  const s = spy();
  const { code, out } = await agent(s.deps, "init", "--root", dir);
  assert.equal(code, 0);
  const d = declared(dir);
  assert.deepEqual(Object.keys(d.mcp ?? {}).sort(), ["claude:github", "cursor:github", "other", "same"]);
  assert.deepEqual(d.mcp?.["cursor:github"], { transport: "stdio", command: "npx", args: ["gh-b"], from: "cursor" });
  assert.match(out, /names a different server in another host, so it is declared as claude:github/);
  assert.match(out, /plain is not declared: it is a local address \(your own server\): not locked/);
  assert.deepEqual(d.files, [".mcp.json", ".cursor/mcp.json", ".vscode/mcp.json"]);
});

test("none at all: an empty repository gets an empty declaration and a lock", async () => {
  const dir = repo();
  const { code, out } = await agent(spy().deps, "init", "--root", dir);
  assert.equal(code, 0);
  assert.deepEqual(declared(dir), { type: "plumbline-agent", version: 2, files: [] });
  assert.deepEqual(locked(dir).files, {});
  assert.match(out, /Locked: 0 MCP servers \(0 stdio, 0 http\), 0 files, 0 models, 0 peers/);
});

test("an already-wrapped .mcp.json is declared with the command the guard runs, and not wrapped again", async () => {
  const wrapped = { command: "plumbline", args: ["guard", "--lock", "plumbline.agent.lock.json", "--server", "files", "--", "npx", "-y", "files"], env: { T: SECRET } };
  const dir = repo({ ".mcp.json": json({ mcpServers: { files: wrapped } }) });
  const { code, out } = await agent(spy().deps, "init", "--root", dir, "--wrap");
  assert.equal(code, 0);
  assert.deepEqual(declared(dir).mcp, { files: { transport: "stdio", command: "npx", args: ["-y", "files"], from: "claude" } });
  assert.match(out, /files already runs the guard/);
  assert.equal(existsSync(path.join(dir, ".mcp.json.plumbline-backup")), false, "nothing to wrap, so no backup");
  noSecret(dir, out);
});

test("--wrap writes the backup first, wraps each stdio entry keeping env, and locks the wrapped file", async () => {
  const original = json({ mcpServers: { files: { command: "npx", args: ["-y", "files"], env: { T: SECRET } }, docs: { type: "http", url: "https://d.example/mcp" } } });
  const dir = repo({ ".mcp.json": original });
  const { code, out } = await agent(spy().deps, "init", "--root", dir, "--wrap");
  assert.equal(code, 0);
  assert.equal(read(dir, ".mcp.json.plumbline-backup"), original);
  const host = JSON.parse(read(dir, ".mcp.json")) as { mcpServers: Record<string, Record<string, unknown>> };
  assert.deepEqual(host.mcpServers.files, { command: "plumbline", args: ["guard", "--lock", "plumbline.agent.lock.json", "--server", "files", "--", "npx", "-y", "files"], env: { T: SECRET } });
  assert.deepEqual(host.mcpServers.docs, { type: "http", url: "https://d.example/mcp" });
  assert.equal(locked(dir).files[".mcp.json"], await sha256Hex(read(dir, ".mcp.json")), "the lock holds the wrapped file");
  assert.deepEqual(declared(dir).mcp?.files, { transport: "stdio", command: "npx", args: ["-y", "files"], from: "claude" });
  assert.match(out, /Put the guard in front of 1 stdio server/);
  noSecret(dir, out);
});

test("--wrap refuses when a backup exists, before writing anything", async () => {
  const dir = repo({ ".mcp.json": json({ mcpServers: { files: { command: "npx" } } }), ".mcp.json.plumbline-backup": "earlier" });
  await assert.rejects(agent(spy().deps, "init", "--root", dir, "--wrap"), (e: unknown) => e instanceof CliError && /plumbline-backup exists/.test(e.message));
  assert.equal(read(dir, ".mcp.json.plumbline-backup"), "earlier");
  assert.equal(existsSync(path.join(dir, AGENT_FILE)), false);
  assert.equal(existsSync(path.join(dir, AGENT_LOCK_FILE)), false);
});

test("init refuses over an existing declaration; a host file that is not JSON is refused", async () => {
  const dir = repo({ [AGENT_FILE]: "{}" });
  await assert.rejects(agent(spy().deps, "init", "--root", dir), (e: unknown) => e instanceof CliError && /edit it, then plumbline agent relock/.test(e.message));
  const bad = repo({ ".vscode/mcp.json": "{ // comment\n}" });
  await assert.rejects(agent(spy().deps, "init", "--root", bad), (e: unknown) => e instanceof CliError && /not JSON/.test(e.message));
});

test("an http server that cannot be read is locked without tools, with a warn; a refused one says so", async () => {
  const dir = repo({ ".mcp.json": json({ mcpServers: { a: { type: "http", url: "https://a.example/mcp" }, b: { type: "http", url: "https://b.example/mcp" } } }) });
  const s = spy();
  s.lists.set("https://a.example/mcp", { ok: false, reason: "the request timed out" });
  s.lists.set("https://b.example/mcp", { ok: false, refused: "it is a private or loopback address" });
  const { code, out } = await agent(s.deps, "init", "--root", dir, "--json");
  assert.equal(code, 0);
  const result = JSON.parse(out) as { findings: { code: string; ref: string }[] };
  assert.deepEqual(result.findings.map((f) => [f.code, f.ref]), [["server-unreachable", "a"], ["server-refused", "b"]]);
  assert.equal(locked(dir).mcp?.a?.tools, undefined);
});

test("a declared file whose name a lock cannot hold is refused (exit 2), naming the glob", async () => {
  const dir = repo({ ".claude/skills/My Skill/SKILL.md": "x" });
  await assert.rejects(agent(spy().deps, "init", "--root", dir), (e: unknown) => e instanceof CliError && /outside \[A-Za-z0-9._\/-\].*\.claude\/skills\/\*\*/.test(e.message));
  assert.equal(existsSync(path.join(dir, AGENT_FILE)), false);
});

test("every file init writes is free of every secret in the fixture (byte search)", async () => {
  const dir = repo({
    ".mcp.json": json({ mcpServers: { s: { command: "c", env: { A: SECRET } }, h: { type: "http", url: "https://h.example/mcp", headers: { B: SECRET } } } }),
    ".cursor/mcp.json": json({ mcpServers: { r: { url: "https://r.example/mcp", headers: { C: SECRET } } } }),
    ".claude/settings.local.json": json({ token: SECRET }),
  });
  const before = new Set(allFiles(dir));
  const { out } = await agent(spy().deps, "init", "--root", dir, "--json");
  const written = allFiles(dir).filter((f) => !before.has(f));
  assert.deepEqual(written.sort(), [".gitignore", AGENT_FILE, AGENT_LOCK_FILE].sort());
  noSecret(dir, out, written);
});
