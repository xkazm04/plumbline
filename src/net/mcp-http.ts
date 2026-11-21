// Reading a Streamable HTTP MCP server's tool list: initialize, notifications/initialized, tools/list (every page),
// through the guarded POST (safe-fetch.ts safePost). The request bodies are the closed set McpRequestBody, built by
// safePost and nowhere else; a caller never supplies one.
//
// Rules:
//   - An answer is read as JSON (`application/json`) or as an event stream (`text/event-stream`, the `data:` lines of
//     the event that carries the request's JSON-RPC id; every other event is ignored). Any other content type fails.
//   - Strict UTF-8; a repeated key in one object fails closed (core/json-keys.ts: JSON.parse keeps the last, another
//     reader may keep the first, so the tool list would mean two things).
//   - Every failure is one fixed sentence of ours. A server's own words (an error message, a tool's name or
//     description, a header) are never copied into a reason; the tools come back raw for the caller to restrict.
//   - One absolute deadline covers the whole listing, DEFAULT_TIMEOUT_MS (10 s) unless the caller passes one. Measured
//     on the recording (2026-11-21, src/test/fixtures/mcp/*/README.md): the three requests took 2,041 ms in all at
//     mcp.deepwiki.com (744 + 663 + 634) and 941 ms at learn.microsoft.com, so 10 s is about five times the slower
//     listing. Pages are capped (MAX_MCP_PAGES, derived in fetch-types.ts), and
//     a cursor the server already returned ends the listing as a failure rather than a loop.
//   - No DELETE of the session afterwards: the three requests above are all Plumbline sends to a server.

import { countDuplicateKeys } from "../core/json-keys.js";
import {
  DEFAULT_TIMEOUT_MS,
  MAX_MCP_CURSOR_LENGTH,
  MAX_MCP_PAGES,
  MAX_MCP_SESSION_ID_LENGTH,
  addressProblemOf,
  describeFetchError,
  isValidMcpSessionId,
  type McpRequestBody,
  type SafeFetchResponse,
  type SafePostOptions,
} from "./fetch-types.js";
import { safePost } from "./safe-fetch.js";

export type McpListResult =
  | { ok: true; tools: Record<string, unknown>[]; protocol: string }
  | { ok: false; refused: string }
  | { ok: false; status: number }
  | { ok: false; reason: string };

/** What `agent init|check|relock` are given, so tests inject it and never touch the network. */
export type McpToolLister = (url: string) => Promise<McpListResult>;

/** The guarded POST's shape (safePost); tests inject a replay of recorded answers. */
export type McpPost = (url: string, body: McpRequestBody, options: SafePostOptions) => Promise<SafeFetchResponse>;

export interface ListMcpToolsOptions {
  allowLocal?: boolean;
  /** One absolute deadline for the whole listing (every request), in milliseconds. Defaults to DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Replaces safePost (tests replay recorded answers through it). */
  post?: McpPost;
}

/**
 * The protocol revisions whose tools/list Plumbline reads. Plumbline asks for 2025-06-18; a server may answer with an
 * older revision it speaks (the tools/list shape is the same in each), or the newer 2025-11-25.
 */
export const MCP_READ_VERSIONS: readonly string[] = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];

// The fixed sentences: ours, whatever the server said.
const R_TYPE = "the server's answer is neither JSON nor an event stream";
const R_UTF8 = "the server's answer is not UTF-8 text";
const R_RPC = "the server's answer is not a JSON-RPC response to the request";
const R_DUP = "the server's answer repeats a key in one object, so it reads two ways";
const R_VERSION = "the server did not answer initialize with a protocol version Plumbline reads";
const R_SESSION = `the server issued a session id that is not 1 to ${MAX_MCP_SESSION_ID_LENGTH} visible ASCII characters`;
const R_TOOLS = "the server's tools/list answer has no list of tool objects";
const R_CURSOR = `the server's tools/list cursor is not a string of 1 to ${MAX_MCP_CURSOR_LENGTH} characters`;
const R_LOOP = "the server's tools/list returned a cursor it had already returned";
const R_PAGES = `the server's tool list runs past ${MAX_MCP_PAGES} pages`;
const R_TIMEOUT = "the request timed out";
const rpcError = (method: string): string => `the server answered ${method} with a JSON-RPC error`;

type Failure = { ok: false; refused: string } | { ok: false; status: number } | { ok: false; reason: string };
type Read = { ok: true; message: Record<string, unknown> } | Failure;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const isEventStream = (headers: Record<string, string>): boolean => /^\s*text\/event-stream\b/i.test(headers["content-type"] ?? "");
const isJson = (headers: Record<string, string>): boolean => /^\s*application\/json\b/i.test(headers["content-type"] ?? "");

/** The `data:` payloads of an event stream's complete events (each event's data lines joined by "\n"). */
export function sseEvents(text: string, options: { partial?: boolean } = {}): string[] {
  const normal = text.replace(/\r\n?/g, "\n");
  const blocks = normal.split("\n\n");
  // the last block is complete only when the stream ended (a reader that stops early passes partial: true)
  if (options.partial === true) blocks.pop();
  const out: string[] = [];
  for (const block of blocks) {
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line === "data" || line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (data.length > 0) out.push(data.join("\n"));
  }
  return out;
}

/** The JSON-RPC response with `id` in one payload, or undefined when the payload is something else (ignored). */
function responseIn(payload: string, id: number): Record<string, unknown> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return undefined;
  }
  return isObject(value) && value.id === id && ("result" in value || "error" in value) ? value : undefined;
}

/** An SSE reader's stop rule: the event answering `id` has arrived whole. */
const answered =
  (id: number) =>
  (bytes: Uint8Array, headers: Record<string, string>): boolean =>
    isEventStream(headers) && sseEvents(new TextDecoder("utf-8").decode(bytes), { partial: true }).some((p) => responseIn(p, id) !== undefined);

/** The JSON-RPC response to request `id` in one answer, or the failure. */
function readAnswer(response: SafeFetchResponse, id: number, method: string): Read {
  if (!response.ok) return { ok: false, status: response.status };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(response.bytes);
  } catch {
    return { ok: false, reason: R_UTF8 };
  }
  let payload: string | undefined;
  if (isEventStream(response.headers)) {
    payload = sseEvents(text).find((p) => responseIn(p, id) !== undefined);
  } else if (isJson(response.headers)) {
    payload = text.replace(/^﻿/, "");
  } else return { ok: false, reason: R_TYPE };
  if (payload === undefined) return { ok: false, reason: R_RPC };
  let message: unknown;
  try {
    message = JSON.parse(payload);
  } catch {
    return { ok: false, reason: R_RPC };
  }
  if (countDuplicateKeys(payload) > 0) return { ok: false, reason: R_DUP };
  if (!isObject(message) || message.jsonrpc !== "2.0" || message.id !== id) return { ok: false, reason: R_RPC };
  if ("error" in message) return { ok: false, reason: rpcError(method) };
  if (!isObject(message.result)) return { ok: false, reason: R_RPC };
  return { ok: true, message: message.result };
}

/** A thrown guarded-POST error as a result: an address refusal is `refused`, anything else a fixed `reason`. */
function failureOf(error: unknown): Failure {
  const refused = addressProblemOf(error);
  return refused !== undefined ? { ok: false, refused } : { ok: false, reason: describeFetchError(error) };
}

/**
 * Lists an MCP server's tools over Streamable HTTP: initialize, notifications/initialized, then tools/list following
 * `nextCursor` (at most MAX_MCP_PAGES pages). The tools are returned raw; `protocol` is the revision the server
 * answered initialize with (one of MCP_READ_VERSIONS).
 */
export async function listMcpTools(url: string, options: ListMcpToolsOptions = {}): Promise<McpListResult> {
  const post = options.post ?? safePost;
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const base: SafePostOptions = options.allowLocal === true ? { allowLocal: true } : {};

  const send = async (body: McpRequestBody, extra: SafePostOptions): Promise<SafeFetchResponse | Failure> => {
    const left = deadline - Date.now();
    if (left <= 0) return { ok: false, reason: R_TIMEOUT };
    try {
      return await post(url, body, { ...base, ...extra, timeoutMs: left });
    } catch (error) {
      return failureOf(error);
    }
  };

  // 1. initialize
  const init = await send({ method: "initialize", id: 1 }, { complete: answered(1) });
  if (!isResponse(init)) return init;
  const initResponse = init;
  const initRead = readAnswer(initResponse, 1, "initialize");
  if (!initRead.ok) return initRead;
  const protocol = initRead.message.protocolVersion;
  if (typeof protocol !== "string" || !MCP_READ_VERSIONS.includes(protocol)) return { ok: false, reason: R_VERSION };
  const sessionId = initResponse.headers["mcp-session-id"];
  if (sessionId !== undefined && !isValidMcpSessionId(sessionId)) return { ok: false, reason: R_SESSION };
  const session: SafePostOptions = { protocolVersion: protocol, ...(sessionId !== undefined ? { sessionId } : {}) };

  // 2. notifications/initialized (a 202 with no body; any 2xx will do)
  const note = await send({ method: "notifications/initialized" }, session);
  if (!isResponse(note)) return note;
  if (!note.ok) return { ok: false, status: note.status };

  // 3. tools/list, every page
  const tools: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; ; page += 1) {
    if (page >= MAX_MCP_PAGES) return { ok: false, reason: R_PAGES };
    const id = page + 2;
    const answer = await send({ method: "tools/list", id, ...(cursor !== undefined ? { cursor } : {}) }, { ...session, complete: answered(id) });
    if (!isResponse(answer)) return answer;
    const read = readAnswer(answer, id, "tools/list");
    if (!read.ok) return read;
    const list = read.message.tools;
    if (!Array.isArray(list) || !list.every(isObject)) return { ok: false, reason: R_TOOLS };
    tools.push(...(list as Record<string, unknown>[]));
    const next = read.message.nextCursor;
    if (next === undefined || next === null) break;
    if (typeof next !== "string" || next.length === 0 || next.length > MAX_MCP_CURSOR_LENGTH) return { ok: false, reason: R_CURSOR };
    if (seen.has(next)) return { ok: false, reason: R_LOOP };
    seen.add(next);
    cursor = next;
  }
  return { ok: true, tools, protocol };
}

function isResponse(value: SafeFetchResponse | Failure): value is SafeFetchResponse {
  return "bytes" in value;
}
