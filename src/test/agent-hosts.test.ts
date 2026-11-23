// Servers and host files (format version 2): host config wins for a server declared `from` a host file (relock re-syncs
// it, check says host-changed), the first relock of a version 1 declaration, and which host entries init does not
// declare (a query string, a local address). In-process with an injected lister; no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { serverTarget, toolsParts, toolsRecord } from "../core/agent-tools.js";
import { AGENT_FILE, AGENT_LOCK_FILE, AGENT_PENDING_TYPE, type AgentDeclaration, type AgentLock, type AgentReport } from "../core/types.js";
import { parseAgentLock, parseDeclaration } from "../agent/lock.js";
import { GuardFilter, type GuardAction } from "../guard/filter.js";
import { guardPolicy } from "../guard/policy.js";
import { agent, approve, json, person, read, repo, spy, write } from "./agent-helpers.js";

const OLD = { command: "npx", args: ["@playwright/mcp@0.0.80"] };
const NEW = { command: "npx", args: ["@playwright/mcp@0.0.85"] };
const TOOLS = Array.from({ length: 24 }, (_, i) => ({ name: `browser_tool_${i + 1}`, description: `Tool ${i + 1}.`, inputSchema: { type: "object" } }));

const declared = (dir: string): AgentDeclaration => {
  const parsed = parseDeclaration(read(dir, AGENT_FILE));
  assert.ok(parsed.ok, "the declaration reads back");
  return parsed.value;
};
const lockOf = (dir: string): AgentLock => JSON.parse(read(dir, AGENT_LOCK_FILE)) as AgentLock;
const codes = (r: AgentReport): string[] => r.findings.map((f) => `${f.severity} ${f.code} ${f.ref}`);

async function pending(server: string, run: { command: string; args: string[] }, tools: Record<string, unknown>[]): Promise<string> {
  const target = await serverTarget({ transport: "stdio", ...run });
  return json({ type: AGENT_PENDING_TYPE, version: 1, server, target, observedAt: "2026-11-23T09:00:00.000Z", tools });
}

async function check(deps: ReturnType<typeof spy>["deps"], dir: string, ...extra: string[]): Promise<AgentReport> {
  const { out } = await agent(deps, "check", "--root", dir, "--offline", "--json", ...extra);
  return JSON.parse(out) as AgentReport;
}

/** What the guard shows the host for a tools/list, under a policy decided from this lock. */
async function guardShows(dir: string, run: { command: string; args: string[] }, tools: Record<string, unknown>[]): Promise<string[]> {
  const decision = await guardPolicy({
    lockText: read(dir, AGENT_LOCK_FILE),
    parseLock: parseAgentLock,
    server: "playwright",
    command: run.command,
    args: run.args,
    require: "locked",
    approval: async () => ({ state: "verified" }),
  });
  assert.equal(decision.policy.mode, "enforce", "the guard enforces the lock for the command the host runs");
  const filter = new GuardFilter({ policy: decision.policy, label: "playwright" });
  filter.fromHost(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
  const actions: GuardAction[] = await filter.fromServer(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools } }));
  const toHost = actions.filter((a): a is Extract<GuardAction, { kind: "to-host" }> => a.kind === "to-host");
  const result = (JSON.parse(toHost[0]!.line) as { result: { tools: { name: string }[] } }).result;
  return result.tools.map((t) => t.name);
}

test("the field trial's bump: check says host-changed, relock re-syncs the declaration and takes the guard's tools, the guard passes them", async () => {
  const dir = repo({ "CLAUDE.md": "# rules\n", ".mcp.json": json({ mcpServers: { playwright: OLD } }) });
  const s = spy();
  assert.equal((await agent(s.deps, "init", "--root", dir)).code, 0);
  assert.deepEqual(declared(dir).mcp?.playwright, { transport: "stdio", ...OLD, from: "claude" });
  write(dir, { ".plumbline/pending/playwright.json": await pending("playwright", OLD, TOOLS) });
  await agent(s.deps, "relock", "--root", dir);
  await approve(dir, await person());
  assert.equal(Object.keys(lockOf(dir).mcp?.playwright?.tools ?? {}).length, 24);

  // the bump: the host file moves to 0.0.85; the guard (refusing every tool) still writes what it saw for the new command
  write(dir, { ".mcp.json": json({ mcpServers: { playwright: NEW } }), ".plumbline/pending/playwright.json": await pending("playwright", NEW, TOOLS) });
  const before = await check(s.deps, dir);
  assert.ok(codes(before).includes("block host-changed playwright"), "check names the host file's new command before relock");
  const finding = before.findings.find((f) => f.code === "host-changed")!;
  assert.match(finding.summary, /The host file runs a command the declaration does not record for this MCP server: plumbline agent relock re-syncs the declaration from it\./);
  assert.ok(!finding.summary.includes("0.0.85"), "a finding is a fixed sentence");

  const { code, out } = await agent(s.deps, "relock", "--root", dir);
  assert.equal(code, 0);
  assert.deepEqual(declared(dir).mcp?.playwright, { transport: "stdio", ...NEW, from: "claude" }, "host config wins");
  const lock = lockOf(dir);
  assert.equal(lock.mcp?.playwright?.target, await serverTarget({ transport: "stdio", ...NEW }));
  assert.deepEqual(lock.mcp?.playwright?.tools, toolsRecord((await toolsParts(TOOLS)).parts), "the guard's observation of the new command is taken");
  assert.match(out, /Rewrote plumbline\.agent\.json from the host files/);
  assert.match(out, /  declaration: 1 server re-synced from \.mcp\.json\n    playwright: command npx @playwright\/mcp@0\.0\.80 -> npx @playwright\/mcp@0\.0\.85/);
  assert.match(out, /server playwright \(from what the guard saw\): tools 0 added, 0 removed, 0 changed/);
  assert.ok(!out.includes("kept from the earlier lock"));
  assert.match(out, /commits plumbline\.agent\.json, plumbline\.agent\.lock\.json and/);

  // the guard in front of the new command passes all 24 tools; check finds the host and the declaration in step
  assert.equal((await guardShows(dir, NEW, TOOLS)).length, 24);
  const after = await check(s.deps, dir);
  assert.ok(!codes(after).some((c) => c.includes("host-changed")), "nothing left to re-sync");
  // a relock with nothing to re-sync leaves the declaration's bytes alone
  const bytes = read(dir, AGENT_FILE);
  const again = await agent(s.deps, "relock", "--root", dir);
  assert.equal(read(dir, AGENT_FILE), bytes);
  assert.ok(!again.out.includes("re-synced"));
});

test("re-sync: a host entry gone is removed, a new one added with from, a hand-declared server untouched; check says each", async () => {
  const dir = repo({ ".mcp.json": json({ mcpServers: { a: { command: "a" }, b: { command: "b" } } }) });
  const s = spy();
  await agent(s.deps, "init", "--root", dir);
  const d = declared(dir);
  // a server declared by hand, and one by hand under a name the host file will take for something else
  write(dir, { [AGENT_FILE]: json({ ...d, mcp: { ...d.mcp, mine: { transport: "stdio", command: "mine" }, c: { transport: "stdio", command: "hand-c" } } }) });
  await agent(s.deps, "relock", "--root", dir);
  write(dir, { ".mcp.json": json({ mcpServers: { a: { command: "a" }, c: { command: "host-c" }, d: { type: "http", url: "https://d.example/mcp" } } }) });

  const report = await check(s.deps, dir);
  assert.deepEqual(codes(report).filter((c) => c.includes("host-changed")), ["block host-changed b", "block host-changed d"]);
  assert.match(report.findings.find((f) => f.ref === "b" && f.code === "host-changed")!.summary, /no longer declares it/);
  assert.match(report.findings.find((f) => f.ref === "d" && f.code === "host-changed")!.summary, /declares an MCP server the declaration does not record/);

  const { out } = await agent(s.deps, "relock", "--root", dir);
  assert.deepEqual(declared(dir).mcp, {
    a: { transport: "stdio", command: "a", from: "claude" },
    mine: { transport: "stdio", command: "mine" },
    c: { transport: "stdio", command: "hand-c" },
    d: { transport: "http", url: "https://d.example/mcp", from: "claude" },
  });
  assert.match(out, /declaration: 2 servers re-synced from \.mcp\.json\n    b: removed \(no longer in the host file\)\n    d: added \(https:\/\/d\.example\/mcp\)/);
  assert.match(out, /declaration: c in \.mcp\.json is not added: a server declared by hand has its name/);
  assert.match(out, /server removed: b/);
  assert.match(out, /server added: d/);
  assert.ok(!codes(await check(s.deps, dir)).some((c) => c.includes("host-changed")));
});

test("the first relock of a version 1 declaration marks from only for servers identical to a host entry, and says how many stay by hand", async () => {
  const dir = repo({ ".mcp.json": json({ mcpServers: { same: { command: "s", args: ["1"] }, bumped: { command: "b", args: ["2"] }, web: { url: "https://w.example/mcp" } } }) });
  const s = spy();
  await agent(s.deps, "init", "--root", dir);
  const v1 = {
    type: "plumbline-agent",
    version: 1,
    files: [".mcp.json"],
    mcp: {
      same: { transport: "stdio", command: "s", args: ["1"] },
      bumped: { transport: "stdio", command: "b", args: ["1"] },
      web: { transport: "http", url: "https://w.example/mcp" },
      own: { transport: "stdio", command: "own" },
    },
  };
  write(dir, { [AGENT_FILE]: json(v1) });
  // a version 1 declaration has no from: check compares nothing with the host files
  assert.ok(!codes(await check(s.deps, dir)).some((c) => c.includes("host-changed")));

  const { out } = await agent(s.deps, "relock", "--root", dir, "--json");
  const result = JSON.parse(out) as { declaration: { written: boolean; migrated: { marked: number; hand: number } } };
  assert.deepEqual(result.declaration.migrated, { marked: 2, hand: 2 });
  assert.equal(result.declaration.written, true);
  const d = declared(dir);
  assert.equal(d.version, 2);
  assert.deepEqual(d.mcp, {
    same: { transport: "stdio", command: "s", args: ["1"], from: "claude" },
    bumped: { transport: "stdio", command: "b", args: ["1"] },
    web: { transport: "http", url: "https://w.example/mcp", from: "claude" },
    own: { transport: "stdio", command: "own" },
  });
  assert.deepEqual(Object.keys(d), ["type", "version", "files", "mcp"], "members keep their order");

  // the text form says the same
  write(dir, { [AGENT_FILE]: json(v1) });
  const text = await agent(s.deps, "relock", "--root", dir);
  assert.match(text.out, /declaration: version 2; 2 servers now re-synced from their host file, 2 servers stay declared by hand \(not identical to a host entry\)/);
});

test("init: a query-string address is not declared and points at auth; a local address has its own reason", async () => {
  const dir = repo({
    ".mcp.json": json({
      mcpServers: {
        tokened: { type: "http", url: "https://t.example/mcp?api_key=SECRET-IN-QUERY" },
        bare: { type: "http", url: "https://b.example/mcp?" },
        loop: { type: "http", url: "http://127.0.0.1:8080/mcp" },
        loop6: { type: "http", url: "http://[::1]:8080/mcp" },
        named: { type: "http", url: "http://localhost:3000/mcp" },
        lan: { type: "http", url: "https://10.0.0.5/mcp" },
        plain: { type: "http", url: "http://public.example/mcp" },
        creds: { type: "http", url: "https://u:p@c.example/mcp" },
      },
    }),
  });
  const s = spy();
  const { code, out } = await agent(s.deps, "init", "--root", dir);
  assert.equal(code, 0);
  assert.equal(declared(dir).mcp, undefined, "none of them is declared");
  assert.deepEqual(s.listerCalls, []);
  assert.match(out, /tokened is not declared: its address has a query string, which may carry a token: move the key into the entry's headers, which init declares as auth/);
  assert.match(out, /bare is not declared: its address has a query string/);
  for (const name of ["loop", "loop6", "named", "lan"]) assert.match(out, new RegExp(`${name} is not declared: it is a local address \\(your own server\\): not locked\\.`));
  assert.match(out, /plain is not declared: its address is not https\./);
  assert.match(out, /creds is not declared: its address carries credentials/);
  assert.ok(!out.includes("SECRET-IN-QUERY") && !read(dir, AGENT_FILE).includes("SECRET-IN-QUERY"), "the query is never copied");
});

test("re-sync of headers: a host entry that starts sending a header gains auth; a variable the person renamed is kept", async () => {
  const dir = repo({ ".mcp.json": json({ mcpServers: { docs: { type: "http", url: "https://docs.example/mcp" } } }) });
  const s = spy();
  await agent(s.deps, "init", "--root", dir);
  write(dir, { ".mcp.json": json({ mcpServers: { docs: { type: "http", url: "https://docs.example/mcp", headers: { "X-API-Key": "host-value-never-read" } } } }) });
  const report = await check(s.deps, dir);
  assert.match(report.findings.find((f) => f.code === "host-changed" && f.ref === "docs")!.summary, /sends headers the declaration's auth does not name/);
  const { out } = await agent(s.deps, "relock", "--root", dir);
  assert.match(out, /    docs: auth none -> X-API-Key from PLUMBLINE_DOCS_X_API_KEY/);
  assert.deepEqual(declared(dir).mcp?.docs, { transport: "http", url: "https://docs.example/mcp", auth: { "X-API-Key": "PLUMBLINE_DOCS_X_API_KEY" }, from: "claude" });

  // the person names their own variable: the header still comes from the host file, the variable stays theirs
  const d = declared(dir);
  write(dir, { [AGENT_FILE]: json({ ...d, mcp: { docs: { transport: "http", url: "https://docs.example/mcp", auth: { "X-API-Key": "MY_DOCS_KEY" }, from: "claude" } } }) });
  assert.ok(!codes(await check(s.deps, dir)).some((c) => c.includes("host-changed")));
  await agent(s.deps, "relock", "--root", dir);
  assert.equal((declared(dir).mcp?.docs as { auth?: Record<string, string> }).auth?.["X-API-Key"], "MY_DOCS_KEY");
  assert.ok(!allText(dir).includes("host-value-never-read"));
});

const allText = (dir: string): string => [AGENT_FILE, AGENT_LOCK_FILE].map((rel) => read(dir, rel)).join("\n");
