// The film's stand-in MCP server (stdio, newline-delimited JSON-RPC, no network, no dependency). It advertises the
// tools in tools.json next to it, read at every tools/list, so the walk changes a tool by rewriting that file: the way
// an upstream server update reaches a team without anyone editing the repository.
import { readFileSync } from "node:fs";
const tools = () => JSON.parse(readFileSync(new URL("./tools.json", import.meta.url), "utf8"));
const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  for (let i; (i = buf.indexOf("\n")) >= 0; ) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const { id, method, params } = JSON.parse(line);
    if (method === "initialize") send({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "harbour-notes", version: "1.4.0" } } });
    else if (method === "tools/list") send({ jsonrpc: "2.0", id, result: { tools: tools() } });
    else if (method === "tools/call") send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `ran ${params?.name}` }] } });
    else if (id !== undefined) send({ jsonrpc: "2.0", id, result: {} });
  }
});
process.stdin.on("end", () => process.exit(0));
