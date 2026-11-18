// safeFetch: the ONE function through which Plumbline fetches an address it does not own.
//
// Rules, each enforced before or while connecting (docs/gate-and-watch.md lists them for readers):
//   1. https only. http and loopback addresses are accepted solely behind the explicit `allowLocal` option, which
//      defaults to false: the loopback test server, and `plumbline gate --allow-local` for a site on this machine.
//      Even then every private range stays refused (rule 2), and http to a public address is still refused.
//   2. The hostname is resolved here, with node:dns, and EVERY resolved address must be public. Private,
//      loopback, link-local, multicast, unique-local, documentation, benchmarking and reserved ranges are refused, in
//      v4 and v6, including the v6 forms that carry a v4 address inside: v4-mapped, v4-compatible, v4-translated
//      (refused with the rest of ::/8), NAT64, 6to4 and ISATAP. The table is ./address.ts (pure, shared with the Desk).
//   3. The connection is made to the address that was checked, through a `lookup` that returns it: there is no
//      second resolution, so a DNS answer that changes between check and connect cannot bypass rule 2.
//   4. At most 3 redirects, each hop re-validated from rule 1 (scheme, resolution, ranges). Custom headers are
//      dropped when a hop changes origin.
//   5. The body is capped at a byte ceiling; a larger body aborts the request with its own error.
//   6. One absolute timeout covers DNS, connect, redirects and body together; it trips with its own error. A redirect's
//      body is never read: its connection is closed as soon as the Location is known, so nothing outlives the call.
// No cookies, no credentials, no `accept-encoding` (so no decompression bomb): the cap counts the bytes on the wire.

import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

import { isBlockedAddress } from "./address.js";
import { MAX_BODY_BYTES, MAX_RUNTIME_FILE_BYTES, MAX_REDIRECTS, DEFAULT_TIMEOUT_MS, SafeFetchError, type SafeFetchErrorCode, type ResolvedAddress, type SafeFetchOptions, type SafeFetchResponse } from "./fetch-types.js";

export { MAX_BODY_BYTES, MAX_REDIRECTS, DEFAULT_TIMEOUT_MS, SafeFetchError };
export type { SafeFetchErrorCode, ResolvedAddress, SafeFetchOptions, SafeFetchResponse };

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// ---- address classification: the one table, in the pure ./address.js (the Desk's drift reader reads it too) ----

export { isBlockedAddress };

// ---- the fetch itself ------------------------------------------------------------------------------------

const defaultResolver = async (hostname: string): Promise<ResolvedAddress[]> => {
  const found = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return found.map((f) => ({ address: f.address, family: f.family }));
};

interface Hop {
  status: number;
  headers: Record<string, string>;
  bytes: Uint8Array;
}

function lowerHeaders(raw: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue;
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
  }
  return out;
}

export async function safeFetch(url: string, options: SafeFetchOptions = {}): Promise<SafeFetchResponse> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // a runtime or signed code file may exceed a network definition's ceiling, only when the caller says so
  const ceiling = options.ceiling === "runtime" ? MAX_RUNTIME_FILE_BYTES : MAX_BODY_BYTES;
  const maxBytes = Math.min(options.maxBytes ?? ceiling, ceiling);
  const maxRedirects = Math.min(options.maxRedirects ?? MAX_REDIRECTS, MAX_REDIRECTS);
  const allowLocal = options.allowLocal === true;
  const resolver = options.resolver ?? defaultResolver;

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const aborted = new Promise<never>((_, reject) => {
    abort.signal.addEventListener("abort", () => reject(new SafeFetchError("timeout", `timed out after ${timeoutMs} ms`)), {
      once: true,
    });
  });
  aborted.catch(() => undefined); // the race below consumes it; this stops an unhandled rejection after success

  const hop = async (target: URL, headers: Record<string, string>): Promise<Hop> => {
    if (target.protocol !== "https:" && target.protocol !== "http:") {
      throw new SafeFetchError("insecure-scheme", `refused scheme ${target.protocol}`);
    }
    if (target.protocol === "http:" && !allowLocal) throw new SafeFetchError("insecure-scheme", "refused http: only https is fetched");
    const host = target.hostname.startsWith("[") ? target.hostname.slice(1, -1) : target.hostname;
    if (host === "") throw new SafeFetchError("bad-url", "no host");

    let addresses: ResolvedAddress[];
    const literal = net.isIP(host);
    if (literal !== 0) addresses = [{ address: host, family: literal }];
    else {
      try {
        addresses = await Promise.race([resolver(host), aborted]);
      } catch (error) {
        if (error instanceof SafeFetchError) throw error;
        throw new SafeFetchError("dns-failed", `could not resolve ${host}`);
      }
    }
    if (addresses.length === 0) throw new SafeFetchError("dns-failed", `${host} resolved to no address`);
    for (const a of addresses) {
      if (isBlockedAddress(a.address, allowLocal)) {
        throw new SafeFetchError("blocked-address", `refused ${host}: it resolves to a non-public address`);
      }
    }
    if (target.protocol === "http:" && !addresses.every((a) => isBlockedAddress(a.address, false))) {
      throw new SafeFetchError("insecure-scheme", "refused http to a public address");
    }
    const pinned = addresses[0] as ResolvedAddress;

    return await new Promise<Hop>((resolve, reject) => {
      const lib = target.protocol === "https:" ? https : http;
      const request = lib.request(
        {
          method: "GET",
          hostname: host,
          port: target.port === "" ? undefined : Number(target.port),
          path: `${target.pathname}${target.search}`,
          agent: false,
          signal: abort.signal,
          headers: { host: target.host, "user-agent": "plumbline", "accept-encoding": "identity", ...headers },
          ...(literal === 0 && target.protocol === "https:" ? { servername: host } : {}),
          // Rule 3: the connection goes to the address checked above; nothing is resolved a second time.
          lookup: ((_host: string, opts: dns.LookupOptions, cb: (...args: unknown[]) => void) => {
            if (opts.all) cb(null, [{ address: pinned.address, family: pinned.family }]);
            else cb(null, pinned.address, pinned.family);
          }) as never,
        },
        (response) => {
          const status = response.statusCode ?? 0;
          const responseHeaders = lowerHeaders(response.headers);
          if (REDIRECT_STATUSES.has(status) && responseHeaders.location !== undefined) {
            // A redirect's body is never read. Close its connection here instead of draining it: a drain outlives
            // this call's timer (cleared when safeFetch returns), so a host whose redirect body never ends would hold
            // the socket, and the process, open past rule 6's timeout. The destroy's own "aborted" error is expected.
            resolve({ status, headers: responseHeaders, bytes: new Uint8Array(0) });
            response.on("error", () => undefined);
            request.destroy();
            return;
          }
          const declared = Number(responseHeaders["content-length"] ?? "");
          if (Number.isFinite(declared) && declared > maxBytes) {
            request.destroy();
            reject(new SafeFetchError("body-too-large", `body is ${declared} bytes, over the ${maxBytes} byte ceiling`));
            return;
          }
          const chunks: Buffer[] = [];
          let total = 0;
          response.on("data", (chunk: Buffer) => {
            total += chunk.length;
            if (total > maxBytes) {
              request.destroy();
              reject(new SafeFetchError("body-too-large", `body passed the ${maxBytes} byte ceiling`));
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () => resolve({ status, headers: responseHeaders, bytes: new Uint8Array(Buffer.concat(chunks)) }));
          response.on("error", (error) => reject(new SafeFetchError("network", error.message)));
        },
      );
      request.on("error", (error: NodeJS.ErrnoException) => {
        if (abort.signal.aborted) reject(new SafeFetchError("timeout", `timed out after ${timeoutMs} ms`));
        else reject(new SafeFetchError("network", error.code ?? error.message));
      });
      request.end();
    });
  };

  try {
    let current: URL;
    try {
      current = new URL(url);
    } catch {
      throw new SafeFetchError("bad-url", "not a URL");
    }
    let headers = { ...(options.headers ?? {}) };
    for (let redirects = 0; ; redirects += 1) {
      const result = await hop(current, headers);
      const location = result.headers.location;
      if (REDIRECT_STATUSES.has(result.status) && location !== undefined) {
        if (redirects >= maxRedirects) throw new SafeFetchError("too-many-redirects", `more than ${maxRedirects} redirects`);
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          throw new SafeFetchError("bad-url", "redirect to something that is not a URL");
        }
        if (next.origin !== current.origin) headers = {};
        current = next;
        continue;
      }
      const bytes = result.bytes;
      return {
        status: result.status,
        ok: result.status >= 200 && result.status < 300,
        url: current.toString(),
        redirects,
        headers: result.headers,
        bytes,
        text: () => new TextDecoder("utf-8").decode(bytes),
      };
    }
  } catch (error) {
    if (error instanceof SafeFetchError) throw error;
    if (abort.signal.aborted) throw new SafeFetchError("timeout", `timed out after ${timeoutMs} ms`);
    throw new SafeFetchError("network", error instanceof Error ? error.message : "request failed");
  } finally {
    clearTimeout(timer);
  }
}
