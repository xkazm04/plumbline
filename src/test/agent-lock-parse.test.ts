// Reading the agent declaration and the agent lock (src/agent/lock.ts): each refusal is a fixed sentence that never
// quotes the value it refused. No network, no files.
import assert from "node:assert/strict";
import { test } from "node:test";
import { isSafeGlob, isServerName, parseAgentLock, parseDeclaration } from "../agent/lock.js";

const H = "a".repeat(64);
const H2 = "b".repeat(64);
const AT = "2026-11-21T10:00:00.000Z";

const declaration = {
  type: "plumbline-agent",
  version: 1,
  files: ["CLAUDE.md", ".claude/agents/**", ".claude/skills/*/SKILL.md"],
  models: { default: "claude-opus-5-5", reviewer: "us.anthropic.claude-sonnet:0" },
  mcp: {
    files: { transport: "stdio", command: "npx", args: ["-y", "server"] },
    "cursor:docs": { transport: "http", url: "https://mcp.example/mcp" },
  },
  peers: ["https://peer.example/.well-known/agent-card.json"],
};

const lock = {
  type: "plumbline-agent-lock",
  version: 1,
  previous: H2,
  declaration: H,
  files: { "CLAUDE.md": H, ".claude/agents/r.md": H2 },
  models: { default: "claude-opus-5-5" },
  mcp: {
    files: { transport: "stdio", target: H },
    docs: { transport: "http", target: H2, tools: { [H]: H2 }, observedAt: AT },
  },
  peers: { "https://peer.example/card.json": { kind: "a2a-card", sha256: H, parts: { [H]: H2 }, signatures: 0, checkedAt: AT } },
  lockedAt: AT,
};

const decl = (patch: Record<string, unknown>) => JSON.stringify({ ...declaration, ...patch });
const lk = (patch: Record<string, unknown>) => JSON.stringify({ ...lock, ...patch });

function refused(result: { ok: boolean; problem?: string }, secret?: string): string {
  assert.equal(result.ok, false);
  const problem = (result as { problem: string }).problem;
  assert.ok(problem.length > 0);
  if (secret !== undefined) assert.ok(!problem.includes(secret), "the problem quotes the refused value");
  return problem;
}

test("a well-formed declaration and lock are read; a BOM is allowed; optional members may be absent", () => {
  const d = parseDeclaration(JSON.stringify(declaration));
  assert.ok(d.ok);
  assert.deepEqual(d.value, declaration);
  assert.ok(parseDeclaration("\uFEFF" + JSON.stringify({ type: "plumbline-agent", version: 1, files: [] })).ok);
  const l = parseAgentLock(JSON.stringify(lock));
  assert.ok(l.ok);
  assert.deepEqual(l.value, lock);
  const { previous: _p, models: _m, mcp: _c, peers: _r, ...first } = lock;
  assert.ok(parseAgentLock(JSON.stringify(first)).ok);
});

test("not JSON, not an object and a repeated key are refused", () => {
  assert.match(refused(parseDeclaration("{not json")), /not JSON/);
  assert.match(refused(parseDeclaration("[]")), /not a JSON object/);
  assert.match(refused(parseDeclaration('{"type":"plumbline-agent","version":1,"files":[],"files":["X"]}')), /repeats a key/);
  assert.match(refused(parseAgentLock("nope")), /not JSON/);
  const dup = JSON.stringify(lock).replace('"lockedAt"', `"declaration":"${H2}","lockedAt"`);
  assert.match(refused(parseAgentLock(dup)), /repeats a key/);
});

test("a wrong type or version is refused", () => {
  assert.match(refused(parseDeclaration(decl({ type: "plumbline-agent-lock" }))), /type is not plumbline-agent/);
  assert.match(refused(parseDeclaration(decl({ version: 3 }))), /unknown version/);
  assert.match(refused(parseAgentLock(lk({ type: "plumbline-agent" }))), /type is not plumbline-agent-lock/);
  assert.match(refused(parseAgentLock(lk({ version: "1" }))), /unknown version/);
  // a site lock is not an agent lock
  assert.equal(parseAgentLock(JSON.stringify({ version: 1, runtime: {} })).ok, false);
});

test("an unknown key is refused at the top level and inside each member the format defines", () => {
  assert.match(refused(parseDeclaration(decl({ extra: "SECRET-VALUE" })), "SECRET-VALUE"), /top-level key/);
  assert.match(refused(parseDeclaration(decl({ mcp: { s: { transport: "stdio", command: "x", env: { TOKEN: "SECRET-VALUE" } } } })), "SECRET-VALUE"), /key the format does not define/);
  assert.match(refused(parseDeclaration(decl({ mcp: { s: { transport: "http", url: "https://a.example/", headers: { a: "b" } } } }))), /key the format does not define/);
  assert.match(refused(parseAgentLock(lk({ extra: 1 }))), /top-level key/);
  assert.match(refused(parseAgentLock(lk({ mcp: { s: { transport: "stdio", target: H, note: "x" } } }))), /key the format does not define/);
  assert.match(refused(parseAgentLock(lk({ peers: { "https://p.example/": { kind: "a2a-card", sha256: H, checkedAt: AT, x: 1 } } }))), /key the format does not define/);
});

test("a bad hash is refused wherever one is expected", () => {
  assert.match(refused(parseAgentLock(lk({ declaration: "ABC" }))), /declaration is not a SHA-256/);
  assert.match(refused(parseAgentLock(lk({ previous: H.toUpperCase() }))), /previous is not a SHA-256/);
  assert.match(refused(parseAgentLock(lk({ files: { "CLAUDE.md": "deadbeef" } }))), /file hash/);
  assert.match(refused(parseAgentLock(lk({ mcp: { s: { transport: "stdio", target: "x" } } }))), /target/);
  assert.match(refused(parseAgentLock(lk({ mcp: { s: { transport: "http", target: H, tools: { name: H }, observedAt: AT } } }))), /tools/);
  assert.match(refused(parseAgentLock(lk({ peers: { "https://p.example/": { kind: "a2a-card", sha256: "x", checkedAt: AT } } }))), /sha256/);
});

test("an unsafe repository path or glob is refused, without quoting it", () => {
  for (const path of ["../outside", "/etc/passwd", "a//b", "a/./b", "C:/x", "a\\b", "with space.md", "%2e%2e/x", ""]) {
    refused(parseAgentLock(lk({ files: { [path]: H } })), path === "" ? undefined : path);
  }
  for (const glob of ["../*", "/abs/**", "a/**b", "a/./*", "x y/*", ""]) {
    refused(parseDeclaration(decl({ files: [glob] })), glob === "" ? undefined : glob);
  }
  assert.ok(isSafeGlob(".claude/**"));
  assert.ok(isSafeGlob(".claude/skills/*/SKILL.md"));
  assert.equal(isSafeGlob("a/**x/b"), false);
  assert.match(refused(parseDeclaration(decl({ files: ["CLAUDE.md", "CLAUDE.md"] }))), /repeats a files entry/);
  assert.match(refused(parseDeclaration(decl({ files: "CLAUDE.md" }))), /files is not a list/);
});

test("http servers and peers take https addresses without credentials only", () => {
  refused(parseDeclaration(decl({ mcp: { s: { transport: "http", url: "http://plain.example/mcp" } } })), "plain.example");
  refused(parseDeclaration(decl({ mcp: { s: { transport: "http", url: "https://u:pw@cred.example/mcp" } } })), "cred.example");
  refused(parseDeclaration(decl({ peers: ["ftp://p.example/"] })), "p.example");
  refused(parseDeclaration(decl({ peers: ["https://p.example/", "https://p.example/"] })));
  refused(parseAgentLock(lk({ peers: { "http://p.example/": { kind: "a2a-card", sha256: H, checkedAt: AT } } })), "p.example");
  refused(parseAgentLock(lk({ peers: { "https://p.example/": { kind: "mcp-tools", sha256: H, checkedAt: AT } } })));
});

test("times are UTC ISO; observedAt goes with tools", () => {
  assert.match(refused(parseAgentLock(lk({ lockedAt: "2026-11-21" }))), /lockedAt/);
  assert.match(refused(parseAgentLock(lk({ mcp: { s: { transport: "http", target: H, tools: {} } } }))), /observedAt/);
  assert.match(refused(parseAgentLock(lk({ mcp: { s: { transport: "stdio", target: H, observedAt: AT } } }))), /observedAt but no tools/);
  assert.match(refused(parseAgentLock(lk({ peers: { "https://p.example/": { kind: "a2a-card", sha256: H, checkedAt: "yesterday" } } }))), /checkedAt/);
});

test("server names, model labels and model ids keep to their patterns", () => {
  assert.ok(isServerName("github"));
  assert.ok(isServerName("cursor:github"));
  assert.equal(isServerName("a:b:c"), false);
  assert.equal(isServerName("__proto__"), false);
  assert.equal(isServerName(".hidden"), false);
  refused(parseDeclaration(decl({ mcp: { "my server": { transport: "stdio", command: "x" } } })), "my server");
  refused(parseDeclaration(decl({ mcp: { s: { transport: "stdio", command: "" } } })));
  refused(parseDeclaration(decl({ mcp: { s: { transport: "stdio", command: "x", args: [1] } } })));
  refused(parseDeclaration(decl({ mcp: { s: { transport: "sse", url: "https://a.example/" } } })));
  refused(parseDeclaration(decl({ models: { "bad label": "m" } })), "bad label");
  refused(parseDeclaration(decl({ models: { default: "has space" } })), "has space");
  refused(parseDeclaration(decl({ models: { default: 5 } })));
  refused(parseAgentLock(lk({ models: { default: "" } })));
});

test("version 2: a server's from and auth, the lock's hashing and links; version 1 refuses them", () => {
  const v2mcp = {
    files: { transport: "stdio", command: "npx", args: ["-y", "server"], from: "claude" },
    docs: { transport: "http", url: "https://mcp.example/mcp", from: "cursor", auth: { "X-API-Key": "PLUMBLINE_DOCS_X_API_KEY", "X-Tenant": "TENANT" } },
  };
  assert.equal(parseDeclaration(decl({ version: 2, mcp: v2mcp })).ok, true);
  // version 1 knows neither key
  assert.match(refused(parseDeclaration(decl({ version: 1, mcp: { s: { transport: "stdio", command: "x", from: "claude" } } }))), /key the format does not define/);
  assert.match(refused(parseDeclaration(decl({ version: 1, mcp: { s: { transport: "http", url: "https://a.example/", auth: { A: "B" } } } }))), /key the format does not define/);
  // from is one of the three hosts; auth only on http
  assert.match(refused(parseDeclaration(decl({ version: 2, mcp: { s: { transport: "stdio", command: "x", from: "zed" } } }))), /from is not claude, cursor or vscode/);
  assert.match(refused(parseDeclaration(decl({ version: 2, mcp: { s: { transport: "stdio", command: "x", auth: { A: "B" } } } }))), /key the format does not define/);
  // auth: header tokens Plumbline does not set itself, env names, no repeats, a bound
  const http = (auth: unknown) => decl({ version: 2, mcp: { s: { transport: "http", url: "https://a.example/", auth } } });
  assert.match(refused(parseDeclaration(http({ "Content-Type": "X" }))), /one Plumbline sets itself/);
  assert.match(refused(parseDeclaration(http({ "mcp-session-id": "X" }))), /one Plumbline sets itself/);
  assert.match(refused(parseDeclaration(http({ "User-Agent": "X" }))), /one Plumbline sets itself/);
  assert.match(refused(parseDeclaration(http({ "Bad Header": "X" }))), /not a header token/);
  assert.match(refused(parseDeclaration(http({ "X-Key": "1BAD" }))), /environment variable name/);
  assert.match(refused(parseDeclaration(http({ "X-Key": "A", "x-key": "B" }))), /names one auth header twice/);
  assert.match(refused(parseDeclaration(http({}))), /no header or more than/);
  assert.match(refused(parseDeclaration(http(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`X-H${i}`, `E${i}`]))))), /no header or more than/);
  // the lock: version 2 requires hashing; links are safe paths, unique
  assert.equal(parseAgentLock(lk({ version: 2, hashing: "text-lf", links: [".claude/skills/a"] })).ok, true);
  assert.match(refused(parseAgentLock(lk({ version: 2 }))), /hashing is not a rule/);
  assert.match(refused(parseAgentLock(lk({ version: 2, hashing: "exact" }))), /hashing is not a rule/);
  assert.match(refused(parseAgentLock(lk({ version: 1, hashing: "text-lf" }))), /top-level key/);
  assert.match(refused(parseAgentLock(lk({ version: 2, hashing: "text-lf", links: ["../out"] }))), /links is not/);
  assert.match(refused(parseAgentLock(lk({ version: 2, hashing: "text-lf", links: [] }))), /links is not/);
  assert.match(refused(parseAgentLock(lk({ version: 2, hashing: "text-lf", links: ["a", "a"] }))), /repeats a link/);
});
