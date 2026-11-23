// A minimal agent host for the walk: starts one stdio MCP server exactly as .mcp.json names it (wrapped by the guard
// or not), lists its tools, optionally calls one, and prints what the host saw. No network, no dependency.
// usage: node host.mjs <repo> <server> [toolToCall]
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const [repo, server, call] = process.argv.slice(2);
const entry = JSON.parse(readFileSync(path.join(repo, ".mcp.json"), "utf8")).mcpServers[server];
const child = spawn(entry.command, entry.args ?? [], { cwd: repo, stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
const waiting = new Map();
child.stdout.setEncoding("utf8");
child.stdout.on("data", (c) => {
  buf += c;
  for (let i; (i = buf.indexOf("\n")) >= 0; ) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const m = JSON.parse(line);
    if (m.id !== undefined && waiting.has(m.id)) waiting.get(m.id)(m), waiting.delete(m.id);
  }
});
let stderr = "";
child.stderr.on("data", (c) => (stderr += c));
let next = 1;
const rpc = (method, params) => new Promise((resolve) => { const id = next++; waiting.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "walk-host", version: "1" } });
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
const list = await rpc("tools/list", {});
const tools = list.result?.tools ?? [];
console.log(`host sees ${tools.length} tool(s) from ${server}:`);
for (const t of tools) console.log(`  ${t.name}  ${t.description}`);
if (call) {
  const r = await rpc("tools/call", { name: call, arguments: { query: "budget" } });
  console.log(r.error ? `call ${call}: refused: ${r.error.message}` : `call ${call}: ${r.result?.content?.[0]?.text ?? "ok"}`);
}
child.stdin.end();
await new Promise((r) => child.on("exit", r));
if (stderr.trim()) console.log(`server stderr:\n${stderr.trim().split("\n").map((l) => "  " + l).join("\n")}`);
