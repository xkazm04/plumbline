// Reading a Streamable HTTP MCP server's tool list: initialize, notifications/initialized, tools/list (every page),
// through the guarded POST (WP1 builds this; WP0 stub with final signatures). The request bodies are built here and
// nowhere else; a caller never supplies one.

export type McpListResult =
  | { ok: true; tools: Record<string, unknown>[]; protocol: string }
  | { ok: false; refused: string }
  | { ok: false; status: number }
  | { ok: false; reason: string };

/** What `agent init|check|relock` are given, so tests inject it and never touch the network. */
export type McpToolLister = (url: string) => Promise<McpListResult>;

export interface ListMcpToolsOptions {
  allowLocal?: boolean;
  timeoutMs?: number;
}

export async function listMcpTools(url: string, options: ListMcpToolsOptions = {}): Promise<McpListResult> {
  void url;
  void options;
  return { ok: false, reason: "reading an MCP server over HTTP is not built yet (WP1)" };
}
