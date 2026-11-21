// A fake stdio MCP server for the guard's tests: newline-delimited JSON-RPC on stdin/stdout, no network, no dependency.
// Its behaviour is one JSON argument (argv[2]):
//   tools        the tool list it advertises (default: one tool "echo")
//   toolsAfter   the list after the host sends `fake/change` (it then sends notifications/tools/list_changed)
//   pageSize     tools per tools/list page (default: all on one page); nextCursor is the next offset as a string
//   garbage      a line that is not JSON, written before the answer to `initialize`
//   oversize     bytes of one line written as the answer to tools/list (a valid JSON string padded to that size)
//   exitOn       { method, code }: exit with that code on receiving that method
//   endCode      the exit code when stdin closes (default 0)
//   ignoreEnd    keep running after stdin closes (to test the guard's shutdown)
// `fake/calls` answers with the names of every tools/call it received, so a test can see what was forwarded.

const config = JSON.parse(process.argv[2] ?? "{}");
let tools = config.tools ?? [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }];
const pageSize = config.pageSize ?? Infinity;
const calls = [];
let buffer = "";

const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");

function handle(message) {
  const { id, method, params } = message;
  if (config.exitOn && method === config.exitOn.method) process.exit(config.exitOn.code);
  if (method === "initialize") {
    if (config.garbage) process.stdout.write(config.garbage + "\n");
    return send({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: true } }, serverInfo: { name: "fake", version: "1" } } });
  }
  if (method === "tools/list") {
    if (config.oversize) return process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result: { pad: "x".repeat(config.oversize) } }) + "\n");
    const start = params?.cursor === undefined ? 0 : Number(params.cursor);
    const page = tools.slice(start, start + pageSize);
    const next = start + pageSize < tools.length ? { nextCursor: String(start + pageSize) } : {};
    return send({ jsonrpc: "2.0", id, result: { tools: page, ...next } });
  }
  if (method === "tools/call") {
    calls.push(params?.name);
    return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "called" }] } });
  }
  if (method === "fake/calls") return send({ jsonrpc: "2.0", id, result: { calls } });
  if (method === "fake/change") {
    tools = config.toolsAfter ?? [];
    send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
    return send({ jsonrpc: "2.0", id, result: {} });
  }
  if (id !== undefined) send({ jsonrpc: "2.0", id, result: {} });
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (let nl = buffer.indexOf("\n"); nl !== -1; nl = buffer.indexOf("\n")) {
    const line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + 1);
    if (line.trim() !== "") handle(JSON.parse(line));
  }
});
process.stdin.on("end", () => {
  if (config.ignoreEnd) {
    setInterval(() => undefined, 1000);
    return;
  }
  process.exit(config.endCode ?? 0);
});
