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
  | "network";

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
  /** Body ceiling in bytes; clamped to MAX_BODY_BYTES. */
  maxBytes?: number;
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
