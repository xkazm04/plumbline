// Records the MCP fixtures ONCE, by hand (never a test, never CI): initialize, notifications/initialized and every
// tools/list page from the two public no-auth servers below, through the BUILT guarded POST (dist/net/safe-fetch.js
// safePost, driven by dist/net/mcp-http.js listMcpTools), so the real path is what records.
//
//   npm run build && node scripts/record-mcp-fixture.mjs
//
// Writes src/test/fixtures/mcp/<host>/: each answer's exact bytes (NN-<method>.body), answers.json (per request: the
// method, the HTTP status, the content type, whether a session id header was present and its length, the byte size),
// and README.md. The session id's value is never written. Refuses to overwrite a host that is already recorded. Sends
// nothing to any other address. Approved by the operator on 2026-11-21 (the first POST this repository sends to a
// third party).

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { safePost } = await import(new URL("../dist/net/safe-fetch.js", import.meta.url).href);
const { listMcpTools } = await import(new URL("../dist/net/mcp-http.js", import.meta.url).href);

const SERVERS = ["https://mcp.deepwiki.com/mcp", "https://learn.microsoft.com/api/mcp"];
const TIMEOUT_MS = 30_000; // a recording, by hand: generous, so a slow answer is recorded rather than lost

for (const url of SERVERS) {
  const host = new URL(url).host;
  const dir = path.join(ROOT, "src", "test", "fixtures", "mcp", host);
  if (existsSync(dir)) {
    console.log(`${host}: already recorded (${path.relative(ROOT, dir)}); not sending anything`);
    continue;
  }
  const answers = [];
  const started = new Date();
  const recordingPost = async (target, body, options) => {
    const t0 = Date.now();
    try {
      const response = await safePost(target, body, options);
      const n = String(answers.length + 1).padStart(2, "0");
      const file = `${n}-${body.method.replace(/\//g, "-")}.body`;
      const sid = response.headers["mcp-session-id"];
      answers.push({
        file,
        method: body.method,
        ...(body.method === "tools/list" && body.cursor !== undefined ? { cursorLength: body.cursor.length } : {}),
        status: response.status,
        contentType: response.headers["content-type"] ?? null,
        sessionIdPresent: sid !== undefined,
        ...(sid !== undefined ? { sessionIdLength: sid.length } : {}),
        bytes: response.bytes.length,
        ms: Date.now() - t0,
        bytesOf: response.bytes,
      });
      return response;
    } catch (error) {
      answers.push({ method: body.method, error: `${error?.name ?? "Error"} ${error?.code ?? ""}`.trim(), ms: Date.now() - t0 });
      throw error;
    }
  };
  const result = await listMcpTools(url, { post: recordingPost, timeoutMs: TIMEOUT_MS });
  mkdirSync(dir, { recursive: true });
  for (const a of answers) {
    if (a.bytesOf !== undefined) writeFileSync(path.join(dir, a.file), a.bytesOf);
    delete a.bytesOf;
  }
  const outcome = result.ok ? { ok: true, protocol: result.protocol, tools: result.tools.length } : result;
  writeFileSync(path.join(dir, "answers.json"), `${JSON.stringify({ url, recordedAt: started.toISOString(), outcome, answers }, null, 2)}\n`);
  const lines = [
    `# MCP fixture: ${host}`,
    "",
    `- URL: ${url}`,
    `- Recorded: ${started.toISOString()} (UTC), recorded by scripts/record-mcp-fixture.mjs through the built safePost.`,
    `- Outcome: ${result.ok ? `listed ${result.tools.length} tools; protocol version negotiated ${result.protocol}` : `not listed: ${JSON.stringify(result)}`}`,
    "",
    "| file | request | status | content type | session id header | bytes | ms |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...answers.map((a) =>
      a.error !== undefined
        ? `| (none) | ${a.method} | ${a.error} | | | | ${a.ms} |`
        : `| ${a.file} | ${a.method} | ${a.status} | ${a.contentType ?? "(none)"} | ${a.sessionIdPresent ? `present (${a.sessionIdLength} characters, value not recorded)` : "absent"} | ${a.bytes} | ${a.ms} |`,
    ),
    "",
    "Each `.body` file is the answer's exact bytes. `answers.json` holds the same table for the tests.",
    "",
  ];
  writeFileSync(path.join(dir, "README.md"), lines.join("\n"));
  console.log(`${host}: ${lines[4].slice(2)}`);
}
