// The Desk's fetcher: the browser's own fetch, shaped like safeFetch's response so the gate, the locator and the drift
// detector run unchanged. A browser needs no SSRF guard: same-origin and CORS rules decide what a page may read, and
// the page cannot reach a private address for anyone but the visitor. What it keeps from safeFetch:
//   - https only, with http allowed for localhost, *.localhost and 127.0.0.1 (local checks);
//   - the same body ceiling (MAX_BODY_BYTES, from the pure net/fetch-types module) and one absolute timeout;
//   - no cookies or credentials, no referrer.
// Failures throw SafeFetchError with safeFetch's codes, so describeFetchError in the gate words them. A response the
// browser will not let the page read (no CORS header, offline, refused) is a TypeError from fetch: it becomes code
// "network", and the gate reports that adapter `unavailable`, never `pass`. A browser follows up to 20 redirects
// itself, so safeFetch's limit of 3 is not enforced here.

import { DEFAULT_TIMEOUT_MS, MAX_BODY_BYTES, MAX_RUNTIME_FILE_BYTES, SafeFetchError } from "./lib/plumbline/net/fetch-types.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);
// a name under .localhost (RFC 6761: loopback; browsers resolve it to loopback themselves), so a rehearsal can name its sites
const LOOPBACK_NAME = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.localhost$/;

/**
 * The Desk's one address rule: what it may fetch is https, or plain http on localhost, *.localhost and 127.0.0.1 only (local
 * checks). desk.js's target check and its pattern for addresses shown to the model, and this fetcher, all ask here.
 *
 * :param value: An address, as text.
 * :return: The parsed URL when the Desk may fetch it, else null.
 */
export function fetchableUrl(value) {
  if (typeof value !== "string") return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol === "https:") return url;
  return url.protocol === "http:" && (LOOPBACK_HOSTS.has(url.hostname) || LOOPBACK_NAME.test(url.hostname)) ? url : null;
}

async function readCapped(response, limit, controller) {
  if (!response.body || typeof response.body.getReader !== "function") {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > limit) throw new SafeFetchError("body-too-large", "body over the ceiling");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      controller.abort();
      throw new SafeFetchError("body-too-large", "body over the ceiling");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

/**
 * Make a fetcher with safeFetch's signature over a fetch implementation (the browser's by default).
 *
 * :param fetchImpl: A WHATWG fetch.
 * :return: async (url, options) => SafeFetchResponse-shaped object.
 */
export function makeBrowserFetcher(fetchImpl = (...args) => globalThis.fetch(...args)) {
  return async function browserFetch(url, options = {}) {
    try {
      new URL(url);
    } catch {
      throw new SafeFetchError("bad-url", "not a valid URL");
    }
    const target = fetchableUrl(String(url));
    if (target === null) throw new SafeFetchError("insecure-scheme", "only https is fetched");
    // a runtime file (only the runtime-drift check asks) may be larger than a network definition; nothing else may
    const ceiling = options.ceiling === "runtime" ? MAX_RUNTIME_FILE_BYTES : MAX_BODY_BYTES;
    const limit = Math.min(Number.isFinite(options.maxBytes) ? options.maxBytes : ceiling, ceiling);
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      let response;
      try {
        response = await fetchImpl(target.href, {
          method: "GET",
          credentials: "omit",
          cache: "no-store",
          redirect: "follow",
          referrerPolicy: "no-referrer",
          headers: { ...(options.headers || {}) },
          signal: controller.signal,
        });
      } catch {
        if (timedOut) throw new SafeFetchError("timeout", "timed out");
        throw new SafeFetchError("network", "the browser could not read the address (offline, refused, or no cross-origin read allowed)");
      }
      let bytes;
      try {
        bytes = await readCapped(response, limit, controller);
      } catch (error) {
        if (error instanceof SafeFetchError) throw error;
        if (timedOut) throw new SafeFetchError("timeout", "timed out");
        throw new SafeFetchError("network", "the body could not be read");
      }
      const headers = {};
      response.headers.forEach((value, name) => {
        headers[name.toLowerCase()] = value;
      });
      return {
        status: response.status,
        ok: response.ok,
        url: response.url || target.href,
        redirects: response.redirected ? 1 : 0,
        headers,
        bytes,
        text: () => new TextDecoder().decode(bytes),
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Registers nothing. agent-manifest.json lists this module in actions.modules so that the Desk's signature covers it
 * (core's signedPathsOf signs every module named there), and the runtime imports each listed module and requires this
 * export (runtime/action-transport.js loadActionModule). The Desk's actions are registered by site-actions.js only.
 */
export function registerActions() {}
