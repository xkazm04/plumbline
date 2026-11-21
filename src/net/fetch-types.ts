// The pure half of safeFetch: its limits, its error class and its option and response shapes. No node:* import, so
// the gate's context and the browser build can use them; safe-fetch.ts re-exports all of it.

/**
 * The body ceiling, in bytes: 512 KiB.
 *
 * Derivation. The largest real network definition among the example sites of cognizant-ai-labs/agentic-web is
 * examples/sites/pizza_restaurant_website_assistant_static/pizza_restaurant_website_assistant.network.json at
 * 41,156 bytes (measured 2026-11-17 from the repository's file tree, read-only; the next largest is 9,370 bytes, and
 * the six `*.network.json` files in the tree are all smaller). The ceiling is that measurement plus an order of
 * magnitude: 41,156 x 10 = 411,560, rounded up to 512 KiB = 524,288 bytes. Everything else this tool fetches is
 * smaller than a network definition (an Agent Atlas check is about 10 KB, a signed receipt about 1 KB, the receipt index
 * about 5 KB, a GitHub commit listing of one entry about 6 KB), so one ceiling serves all callers. A caller may pass
 * a LOWER `maxBytes`; it may not raise it past this number.
 */
export const MAX_BODY_BYTES = 524_288;

/**
 * The ceiling for one file of a published runtime, read ONLY by the Desk's runtime-drift check and only when the caller
 * says so (`ceiling: "runtime"`). Derivation: the largest file of the vendored reference runtime is
 * runtime/generated/agent-runner.bundle.js at 1,573,971 bytes (measured 2026-11-17, THIRD_PARTY.md); with headroom for
 * an upstream that grows it, 4 MiB = 4,194,304 bytes. Without this the Desk reported that bundle as `block` on every
 * reading of its own drift, because 512 KiB is a network definition's ceiling, not a runtime file's.
 */
export const MAX_RUNTIME_FILE_BYTES = 4_194_304;

/** Redirects followed before giving up. The brief's limit is 3. */
export const MAX_REDIRECTS = 3;

/** Default absolute timeout for one safeFetch call, covering every hop. */
export const DEFAULT_TIMEOUT_MS = 10_000;

export type SafeFetchErrorCode =
  | "bad-url"
  | "insecure-scheme"
  | "blocked-address"
  | "dns-failed"
  | "too-many-redirects"
  | "body-too-large"
  | "timeout"
  | "network"
  | "redirect-refused";

/** Every refusal or failure is one of these, so callers can tell a policy refusal from a network failure. */
export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;
  constructor(code: SafeFetchErrorCode, message: string) {
    super(message);
    this.name = "SafeFetchError";
    this.code = code;
  }
}

export interface ResolvedAddress {
  address: string;
  family: number;
}

export interface SafeFetchOptions {
  headers?: Record<string, string>;
  /** Absolute timeout in milliseconds for the whole call. */
  timeoutMs?: number;
  /** Body ceiling in bytes; clamped to MAX_BODY_BYTES (to MAX_RUNTIME_FILE_BYTES with `ceiling: "runtime"`). */
  maxBytes?: number;
  /** `runtime`: the caller reads a published runtime or signed code file, which may be larger than a network definition. */
  ceiling?: "runtime";
  /** Redirects to follow; clamped to MAX_REDIRECTS. */
  maxRedirects?: number;
  /**
   * Accept http and loopback addresses (127/8, ::1 and their mapped forms). Every private range (10/8, 172.16/12,
   * 192.168/16, 169.254/16, fc00::/7 and the rest) stays refused, and http to a public address stays refused. Defaults
   * to false. Set by tests and by `plumbline gate --allow-local`; never by the Action.
   */
  allowLocal?: boolean;
  /** Replaces DNS resolution (tests inject one; production uses node:dns). */
  resolver?: (hostname: string) => Promise<ResolvedAddress[]>;
}

export interface SafeFetchResponse {
  status: number;
  /** True for 2xx. */
  ok: boolean;
  /** The address finally fetched, after redirects. */
  url: string;
  redirects: number;
  /** Header names are lowercased. */
  headers: Record<string, string>;
  bytes: Uint8Array;
  /** The body decoded as UTF-8. */
  text(): string;
}

/**
 * One sentence naming why a fetch failed, for the gate, the watch and the Desk alike. Ours, never the remote's words.
 * An error is read by its `name` and `code` as well as by class, so a SafeFetchError from another copy of this module
 * (the browser build, a test) is worded the same.
 *
 * :param fallback: the sentence for anything that is not a SafeFetchError.
 */
export function describeFetchError(error: unknown, fallback = "the request failed"): string {
  const code =
    error instanceof SafeFetchError
      ? error.code
      : typeof error === "object" && error !== null && (error as { name?: unknown }).name === "SafeFetchError"
        ? (error as { code?: unknown }).code
        : undefined;
  switch (code) {
    case "timeout":
      return "the request timed out";
    case "body-too-large":
      return "the response was larger than the byte ceiling";
    case "blocked-address":
      return "the address resolves to a private or loopback range, which Plumbline refuses to contact";
    case "insecure-scheme":
      return "the address is not https";
    case "too-many-redirects":
      return "the address redirected too many times";
    case "dns-failed":
      return "the name did not resolve";
    case "bad-url":
      return "the address is not a valid URL";
    case "network":
      return "the connection failed";
    case "redirect-refused":
      return "the address answered a POST with a redirect, which Plumbline never follows";
    default:
      return fallback;
  }
}

/**
 * The address rule's sentence for a refusal of the address itself (not https, a private or loopback address, not a
 * URL), in the words the watch's published reader uses for the same rule (watch/decide.ts peerAddressProblem), or
 * undefined for any other failure. So a peer refused by safeFetch in the CLI and one refused by the Desk's check read
 * the same (UAT-3, REC-2).
 */
export function addressProblemOf(error: unknown): string | undefined {
  const code =
    typeof error === "object" && error !== null && (error as { name?: unknown }).name === "SafeFetchError" ? (error as { code?: unknown }).code : undefined;
  return code === "insecure-scheme" ? "it is not an https address" : code === "blocked-address" ? "it is a private or loopback address" : code === "bad-url" ? "it is not a valid URL" : undefined;
}

// ---- the guarded POST (MCP only) --------------------------------------------------------------------------------

/** The MCP protocol version Plumbline asks for in `initialize` (the revision the vendored runtime's mcp.js speaks). */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

/** `clientInfo.version` in `initialize`: Plumbline's own version, fixed here so no caller supplies text for the body. */
export const MCP_CLIENT_VERSION = "0.1.0";

/**
 * The ceiling of one MCP answer (initialize, or one tools/list page), in bytes: 64 KiB.
 *
 * Derivation. The two recorded servers (src/test/fixtures/mcp/, 2026-11-21, scripts/record-mcp-fixture.mjs) answered
 * tools/list with 4,950 bytes (learn.microsoft.com, 3 tools) and 1,779 bytes (mcp.deepwiki.com, 3 tools), each in one
 * page. The ceiling is the larger times ten, 49,500, rounded up to a power-of-two KiB: 64 KiB = 65,536 bytes. The
 * larger recorded initialize answer (4,258 bytes, mcp.deepwiki.com) is under it by the same order. A server whose one
 * page is larger (a server with a hundred tools in one page) is refused with the ceiling's sentence, not read in part;
 * re-derive from a recording of such a server if one is to be watched.
 */
export const MAX_MCP_BODY_BYTES = 65_536;

/**
 * The longest `Mcp-Session-Id` Plumbline stores and sends back: 2,048 characters. Derivation: the one recorded server
 * that issued a session id (learn.microsoft.com, 2026-11-21) issued 200 characters; times ten, 2,000, rounded up to a
 * power of two, 2,048. mcp.deepwiki.com issued none.
 */
export const MAX_MCP_SESSION_ID_LENGTH = 2_048;

/**
 * The longest `nextCursor` Plumbline sends back: 2,048 characters. Derivation: neither recorded server paginated (each
 * answered tools/list in one page, no nextCursor), so no cursor was measured. A cursor is, like the session id, an
 * opaque token the server issues and Plumbline returns unchanged, so it takes the session id's ceiling (200 measured
 * characters times ten, rounded up to 2,048).
 */
export const MAX_MCP_CURSOR_LENGTH = MAX_MCP_SESSION_ID_LENGTH;

/**
 * The most tools/list pages one listing reads: 8. Derivation: neither recorded server paginated, so the page count
 * is derived from the byte ceilings instead. A whole tool list is held to the ceiling of one network definition
 * (MAX_BODY_BYTES, 512 KiB, derived above from the largest real network): 524,288 / MAX_MCP_BODY_BYTES (65,536) = 8
 * pages, so a listing never reads more than a network definition could weigh.
 */
export const MAX_MCP_PAGES = MAX_BODY_BYTES / MAX_MCP_BODY_BYTES;

/**
 * The only bodies the guarded POST sends: a closed set, serialised inside safePost. No member carries text a caller
 * wrote: `id` is a request number, and `cursor` is the opaque string the server itself returned as `nextCursor`
 * (length-capped by MAX_MCP_CURSOR_LENGTH).
 */
export type McpRequestBody =
  | { method: "initialize"; id: number }
  | { method: "notifications/initialized" }
  | { method: "tools/list"; id: number; cursor?: string };

export interface SafePostOptions {
  /** Absolute timeout in milliseconds for the whole call (DNS, connect, request, response). */
  timeoutMs?: number;
  /** Body ceiling in bytes; clamped to MAX_MCP_BODY_BYTES. */
  maxBytes?: number;
  /** As SafeFetchOptions.allowLocal: http and loopback only, every private range still refused. */
  allowLocal?: boolean;
  /** Replaces DNS resolution (tests inject one; production uses node:dns). */
  resolver?: (hostname: string) => Promise<ResolvedAddress[]>;
  /**
   * The protocol version the server answered `initialize` with, sent as `MCP-Protocol-Version` on every later request
   * (never on `initialize`). Must be a date (YYYY-MM-DD).
   */
  protocolVersion?: string;
  /** The `Mcp-Session-Id` the server issued at `initialize`: visible ASCII (0x21 to 0x7E), at most MAX_MCP_SESSION_ID_LENGTH. */
  sessionId?: string;
  /**
   * Called with the bytes so far after each chunk; true ends the read there (the connection is closed). An SSE response
   * may stay open after the event that answers the request, so the reader says when it has that event.
   */
  complete?: (bytes: Uint8Array, headers: Record<string, string>) => boolean;
}

/** A session id the server issued is sent back only if it is visible ASCII and within the length cap (MCP spec). */
export function isValidMcpSessionId(value: string): boolean {
  return value.length >= 1 && value.length <= MAX_MCP_SESSION_ID_LENGTH && /^[\x21-\x7e]+$/.test(value);
}

/** A protocol version is a date, YYYY-MM-DD. */
export function isValidMcpProtocolVersion(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
