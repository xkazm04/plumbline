// Remote servers that need a key (format version 2, the idea note's D-4): a declared http server's `auth` names an
// environment variable per header; init declares it from a host entry's header NAMES, check and relock read the values
// at list time and send them to that one server through the guarded POST, and no value ever reaches an output or a file.
// A loopback MCP server that answers 401 without its X-API-Key stands in for the field trial's remote server; no network.
import assert from "node:assert/strict";
import type http from "node:http";
import { test } from "node:test";
import { AGENT_FILE, AGENT_LOCK_FILE, type AgentDeclaration, type AgentReport } from "../core/types.js";
import type { AgentDeps } from "../agent/build.js";
import { parseDeclaration } from "../agent/lock.js";
import { listMcpTools } from "../net/mcp-http.js";
import { safePost } from "../net/safe-fetch.js";
import { agent, allFiles, json, read, repo, spy } from "./agent-helpers.js";
import { loopbackServer, type TestServer } from "./net-helpers.js";

/** The key the person sets in the environment (a stand-in; searched for in every output and file). */
const KEY = "pl-test-key-7f3a9c0e1d5b";
/** What the host file itself holds for the header (init never reads it; searched for too). */
const HOST_VALUE = "host-file-header-value-4e2d";
const VARIABLE = "PLUMBLINE_GRINEX_X_API_KEY";
const TOOLS = [
  { name: "orders", description: "List orders.", inputSchema: { type: "object" } },
  { name: "refund", description: "Refund an order.", inputSchema: { type: "object" } },
];

interface Seen {
  headers: http.IncomingHttpHeaders;
  method: string | undefined;
}

/** A Streamable HTTP MCP server on loopback that answers 401 unless X-API-Key is KEY. Records every request's headers. */
async function keyedServer(): Promise<{ server: TestServer; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = await loopbackServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (c: string) => (body += c));
    req.on("end", () => {
      const message = JSON.parse(body) as { id?: number; method: string };
      seen.push({ headers: req.headers, method: message.method });
      if (req.headers["x-api-key"] !== KEY) {
        res.writeHead(401, { "content-type": "application/json" }).end('{"error":"unauthorized"}');
        return;
      }
      if (message.method === "notifications/initialized") {
        res.writeHead(202).end();
        return;
      }
      const result = message.method === "initialize" ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "grinex", version: "1" } } : { tools: TOOLS };
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    });
  });
  return { server, seen };
}

/** Dependencies whose lister is the real listMcpTools (guarded POST), aimed at the loopback server whatever the declared address. */
function keyedDeps(server: TestServer, env: NodeJS.ProcessEnv): AgentDeps {
  const base = spy(env).deps;
  return { ...base, lister: (_url, auth) => listMcpTools(`${server.url}/mcp`, { allowLocal: true, ...(auth !== undefined ? { auth } : {}) }) };
}

/** Runs `fn` with process.stderr captured; returns what it wrote. */
async function capturingStderr<T>(fn: () => Promise<T>): Promise<{ value: T; err: string }> {
  const write = process.stderr.write.bind(process.stderr);
  let err = "";
  process.stderr.write = ((chunk: string | Uint8Array) => {
    err += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    return { value: await fn(), err };
  } finally {
    process.stderr.write = write;
  }
}

const declared = (dir: string): AgentDeclaration => {
  const parsed = parseDeclaration(read(dir, AGENT_FILE));
  assert.ok(parsed.ok);
  return parsed.value;
};

test("auth: init declares the header from its name only; unset -> server-auth-missing and no request; set -> listed with the key; no value anywhere", async () => {
  const { server, seen } = await keyedServer();
  try {
    const dir = repo({ "CLAUDE.md": "# rules\n", ".mcp.json": json({ mcpServers: { grinex: { type: "http", url: "https://grinex.example/mcp", headers: { "X-API-Key": HOST_VALUE } } } }) });
    const outputs: string[] = [];
    const run = async (env: NodeJS.ProcessEnv, ...argv: string[]): Promise<{ code: number; out: string }> => {
      const { value, err } = await capturingStderr(() => agent(keyedDeps(server, env), ...argv));
      outputs.push(value.out, err);
      return value;
    };

    // init, with the variable unset: declared with auth, the variable printed, the server never asked
    const init = await run({}, "init", "--root", dir);
    assert.equal(init.code, 0);
    assert.deepEqual(declared(dir).mcp?.grinex, { transport: "http", url: "https://grinex.example/mcp", auth: { "X-API-Key": VARIABLE }, from: "claude" });
    assert.match(init.out, /\.mcp\.json: grinex sends 1 header; its value is never read\. Set PLUMBLINE_GRINEX_X_API_KEY \(X-API-Key\) in the environment/);
    assert.match(init.out, /\[warn\] server-auth-missing grinex: An MCP server over HTTP was not contacted: the environment variable PLUMBLINE_GRINEX_X_API_KEY it names for a header is unset/);
    assert.equal(seen.length, 0, "no request without the key");

    // check, unset: warn (not checked), state unavailable, still no request
    const unset = await run({}, "check", "--root", dir, "--json");
    const report = JSON.parse(unset.out) as AgentReport;
    assert.deepEqual(report.findings.filter((f) => f.ref === "grinex").map((f) => `${f.severity} ${f.code}`), ["warn server-auth-missing"]);
    assert.equal(seen.length, 0);
    // a value with a line break is refused before anything is sent (it would split the request's headers)
    const crlf = JSON.parse((await run({ [VARIABLE]: `${KEY}\r\nX-Evil: 1` }, "check", "--root", dir, "--json")).out) as AgentReport;
    assert.ok(crlf.findings.some((f) => f.code === "server-auth-missing" && f.ref === "grinex"));
    assert.equal(seen.length, 0, "a CR/LF value is never sent");

    // relock with the variable set: the server answers, its tools are locked; the key went on every request
    const env = { [VARIABLE]: KEY };
    const relock = await run(env, "relock", "--root", dir, "--json");
    assert.equal(relock.code, 0);
    assert.equal(Object.keys(JSON.parse(read(dir, AGENT_LOCK_FILE)).mcp.grinex.tools).length, 2);
    assert.deepEqual(seen.map((s) => s.method), ["initialize", "notifications/initialized", "tools/list"]);
    for (const s of seen) {
      assert.equal(s.headers["x-api-key"], KEY);
      assert.equal(s.headers["content-type"], "application/json", "auth never overrides the POST's own headers");
      assert.equal(s.headers["user-agent"], "plumbline");
    }
    // check with the key, text and --json: the tools match, nothing about grinex
    const text = await run(env, "check", "--root", dir);
    assert.ok(!/grinex/.test(text.out), text.out);
    const withKey = JSON.parse((await run(env, "check", "--root", dir, "--json")).out) as AgentReport;
    assert.deepEqual(withKey.findings.filter((f) => f.ref === "grinex"), []);
    await run(env, "relock", "--root", dir);

    // the key and the host file's value appear in no output (stdout, stderr, --json) and no file but the host's own
    for (const o of outputs) {
      assert.ok(!o.includes(KEY), "the key reached an output");
      assert.ok(!o.includes(HOST_VALUE), "the host file's header value reached an output");
    }
    for (const rel of allFiles(dir)) {
      const body = read(dir, rel);
      assert.ok(!body.includes(KEY), `the key reached ${rel}`);
      if (rel !== ".mcp.json") assert.ok(!body.includes(HOST_VALUE), `the host file's header value reached ${rel}`);
    }
  } finally {
    await server.close();
  }
});

test("init --json lists the auth variables; two headers each get a variable; a header Plumbline sets itself is not declared", async () => {
  const dir = repo({
    ".mcp.json": json({
      mcpServers: {
        grinex: { type: "http", url: "https://grinex.example/mcp", headers: { "X-API-Key": HOST_VALUE, "X-Tenant": HOST_VALUE } },
        cookie: { type: "http", url: "https://c.example/mcp", headers: { Cookie: HOST_VALUE } },
      },
    }),
  });
  const s = spy();
  const { out } = await agent(s.deps, "init", "--root", dir, "--json");
  const result = JSON.parse(out) as { auth: { server: string; header: string; variable: string }[]; skipped: { server: string; why: string }[] };
  assert.deepEqual(result.auth.map((a) => `${a.server} ${a.header} ${a.variable}`), ["grinex X-API-Key PLUMBLINE_GRINEX_X_API_KEY", "grinex X-Tenant PLUMBLINE_GRINEX_X_TENANT"]);
  assert.deepEqual(result.skipped.map((x) => x.server), ["cookie"]);
  assert.match(result.skipped[0]!.why, /a header Plumbline does not send as auth/);
  assert.deepEqual(s.listerCalls, [], "no variable set: nothing contacted");
  assert.ok(!out.includes(HOST_VALUE));
  for (const rel of allFiles(dir)) if (rel !== ".mcp.json") assert.ok(!read(dir, rel).includes(HOST_VALUE), rel);
});

test("safePost: auth goes to the one request; a CR/LF value or a header it sets itself is refused before sending, naming no value", async () => {
  const { server, seen } = await keyedServer();
  try {
    const url = `${server.url}/mcp`;
    const ok = await safePost(url, { method: "initialize", id: 1 }, { allowLocal: true, auth: { "X-API-Key": KEY } });
    assert.equal(ok.status, 200);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.headers["x-api-key"], KEY);

    const bad = `${KEY}\r\nX-Evil: 1`;
    await assert.rejects(safePost(url, { method: "initialize", id: 1 }, { allowLocal: true, auth: { "X-API-Key": bad } }), (e: unknown) => {
      assert.ok(e instanceof TypeError);
      assert.ok(!e.message.includes(KEY), "the refusal names no value");
      return true;
    });
    for (const name of ["Content-Type", "accept", "Host", "User-Agent", "Accept-Encoding", "Content-Length", "Mcp-Session-Id", "MCP-Protocol-Version", "Cookie", "Connection", "bad header"]) {
      await assert.rejects(safePost(url, { method: "initialize", id: 1 }, { allowLocal: true, auth: { [name]: "x" } }), TypeError, name);
    }
    await assert.rejects(safePost(url, { method: "initialize", id: 1 }, { allowLocal: true, auth: { "X-Key": "a", "x-key": "b" } }), TypeError);
    assert.equal(seen.length, 1, "nothing refused was sent");

    // through the lister: a fixed reason, never the value
    const listed = await listMcpTools(url, { allowLocal: true, auth: { "X-API-Key": bad } });
    assert.deepEqual(listed, { ok: false, reason: "an auth header or value is one Plumbline does not send" });
    // without the key the server's 401 is a status, as before
    assert.deepEqual(await listMcpTools(url, { allowLocal: true }), { ok: false, status: 401 });
    assert.equal(seen.length, 2);
  } finally {
    await server.close();
  }
});
