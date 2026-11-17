// safeFetch: the ONE function through which Plumbline fetches an address it does not own.
//
// Rules, each enforced before or while connecting (docs/gate-and-watch.md lists them for readers):
//   1. https only. http is accepted solely for the loopback test server, behind the explicit
//      `allowInsecureLoopbackForTests` option, which defaults to false.
//   2. The hostname is resolved here, with node:dns, and EVERY resolved address must be public. Private,
//      loopback, link-local, multicast, unique-local, documentation and reserved ranges are refused, in v4 and v6,
//      including v4-mapped, v4-compatible, NAT64 and 6to4 v6 forms that carry a v4 address inside.
//   3. The connection is made to the address that was checked, through a `lookup` that returns it: there is no
//      second resolution, so a DNS answer that changes between check and connect cannot bypass rule 2.
//   4. At most 3 redirects, each hop re-validated from rule 1 (scheme, resolution, ranges). Custom headers are
//      dropped when a hop changes origin.
//   5. The body is capped at a byte ceiling; a larger body aborts the request with its own error.
//   6. One absolute timeout covers DNS, connect, redirects and body together; it trips with its own error.
// No cookies, no credentials, no `accept-encoding` (so no decompression bomb): the cap counts the bytes on the wire.

import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

import { MAX_BODY_BYTES, MAX_REDIRECTS, DEFAULT_TIMEOUT_MS, SafeFetchError, type SafeFetchErrorCode, type ResolvedAddress, type SafeFetchOptions, type SafeFetchResponse } from "./fetch-types.js";

export { MAX_BODY_BYTES, MAX_REDIRECTS, DEFAULT_TIMEOUT_MS, SafeFetchError };
export type { SafeFetchErrorCode, ResolvedAddress, SafeFetchOptions, SafeFetchResponse };

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// ---- address classification ------------------------------------------------------------------------------

function parseIPv4(text: string): number[] | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

function parseIPv6(input: string): number[] | null {
  let s = input;
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  if (s.includes(".")) {
    const lastColon = s.lastIndexOf(":");
    const v4 = parseIPv4(s.slice(lastColon + 1));
    if (!v4) return null;
    s = `${s.slice(0, lastColon + 1)}${(((v4[0] ?? 0) << 8) | (v4[1] ?? 0)).toString(16)}:${(((v4[2] ?? 0) << 8) | (v4[3] ?? 0)).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const groupsOf = (part: string): string[] => (part === "" ? [] : part.split(":"));
  const head = groupsOf(halves[0] ?? "");
  const rest = halves.length === 2 ? groupsOf(halves[1] ?? "") : [];
  let groups: string[];
  if (halves.length === 1) {
    if (head.length !== 8) return null;
    groups = head;
  } else {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    groups = [...head, ...Array<string>(fill).fill("0"), ...rest];
  }
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    bytes.push(n >> 8, n & 0xff);
  }
  return bytes;
}

function isBlockedIPv4(b: number[], allowLoopback: boolean): boolean {
  const [a = 0, c = 0, d = 0] = b;
  if (a === 127) return !allowLoopback;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && c >= 64 && c <= 127) return true; // 100.64.0.0/10 carrier-grade NAT
  if (a === 169 && c === 254) return true; // 169.254.0.0/16 link-local, includes cloud metadata 169.254.169.254
  if (a === 172 && c >= 16 && c <= 31) return true; // 172.16.0.0/12
  if (a === 192 && c === 0 && d === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 192 && c === 0 && d === 2) return true; // 192.0.2.0/24 documentation
  if (a === 192 && c === 168) return true; // 192.168.0.0/16
  if (a === 198 && (c === 18 || c === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a === 198 && c === 51 && d === 100) return true; // 198.51.100.0/24 documentation
  if (a === 203 && c === 0 && d === 113) return true; // 203.0.113.0/24 documentation
  if (a >= 224) return true; // 224.0.0.0/4 multicast and 240.0.0.0/4 reserved, includes broadcast
  return false;
}

function isBlockedIPv6(b: number[], allowLoopback: boolean): boolean {
  const at = (i: number): number => b[i] ?? 0;
  const zeroFrom = (from: number, to: number): boolean => {
    for (let i = from; i < to; i += 1) if (at(i) !== 0) return false;
    return true;
  };
  if (zeroFrom(0, 15) && at(15) === 1) return !allowLoopback; // ::1
  if (zeroFrom(0, 12)) return true; // :: and ::/96 (v4-compatible, reserved)
  if (zeroFrom(0, 10) && at(10) === 0xff && at(11) === 0xff) return isBlockedIPv4([at(12), at(13), at(14), at(15)], allowLoopback); // ::ffff:a.b.c.d
  if (at(0) === 0 && at(1) === 0x64 && at(2) === 0xff && at(3) === 0x9b) {
    // 64:ff9b::/96 NAT64 carries a v4 address; 64:ff9b:1::/48 is local-use and refused outright.
    return zeroFrom(4, 12) ? isBlockedIPv4([at(12), at(13), at(14), at(15)], allowLoopback) : true;
  }
  if (at(0) === 0x20 && at(1) === 0x02) return isBlockedIPv4([at(2), at(3), at(4), at(5)], allowLoopback); // 2002::/16 6to4
  if (at(0) === 0x20 && at(1) === 0x01 && at(2) === 0 && at(3) === 0) return true; // 2001::/32 Teredo
  if (at(0) === 0x20 && at(1) === 0x01 && at(2) === 0x0d && at(3) === 0xb8) return true; // 2001:db8::/32 documentation
  if (at(0) === 0x01 && at(1) === 0 && zeroFrom(2, 8)) return true; // 100::/64 discard-only
  if ((at(0) & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
  if (at(0) === 0xfe && (at(1) & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (at(0) === 0xfe && (at(1) & 0xc0) === 0xc0) return true; // fec0::/10 deprecated site-local
  if (at(0) === 0xff) return true; // ff00::/8 multicast
  return false;
}

/**
 * True when connecting to this literal address must be refused. An unparseable address is refused too: when in
 * doubt the answer is no. `allowLoopback` exists for the test server only.
 */
export function isBlockedAddress(address: string, allowLoopback = false): boolean {
  const bare = address.startsWith("[") && address.endsWith("]") ? address.slice(1, -1) : address;
  const family = net.isIP(bare.split("%")[0] ?? "");
  if (family === 4) {
    const parsed = parseIPv4(bare);
    return parsed === null ? true : isBlockedIPv4(parsed, allowLoopback);
  }
  if (family === 6) {
    const parsed = parseIPv6(bare);
    return parsed === null ? true : isBlockedIPv6(parsed, allowLoopback);
  }
  return true;
}

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
  const maxBytes = Math.min(options.maxBytes ?? MAX_BODY_BYTES, MAX_BODY_BYTES);
  const maxRedirects = Math.min(options.maxRedirects ?? MAX_REDIRECTS, MAX_REDIRECTS);
  const testMode = options.allowInsecureLoopbackForTests === true;
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
    if (target.protocol === "http:" && !testMode) throw new SafeFetchError("insecure-scheme", "refused http: only https is fetched");
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
      if (isBlockedAddress(a.address, testMode)) {
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
            response.resume();
            resolve({ status, headers: responseHeaders, bytes: new Uint8Array(0) });
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
