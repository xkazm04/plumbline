// The DNS half of the second channel (./dns-txt.ts): one TXT lookup of `_plumbline.<host>`, bounded in time. Node only.
// It asks the system's configured resolver for a public name's TXT record; it connects to no address the site chose,
// so the fetch rules (safeFetch) do not apply, and nothing from the answer but a kid in its exact pattern is kept.

import dns from "node:dns";
import net from "node:net";
import { dnsNameFor, dnsVerdict, parseTxt, type DnsCheck } from "./dns-txt.js";
import { DEFAULT_TIMEOUT_MS } from "./fetch-types.js";

/** A TXT lookup: each record as its chunks. Tests inject one; production uses the system resolver. */
export type TxtResolver = (name: string) => Promise<string[][]>;

/**
 * The resolver's own limits: 4 s per try, 2 tries. Derivation: a TXT answer of a few dozen bytes comes back in tens of
 * milliseconds from a working resolver; 2 x 4 s keeps the lookup under safeFetch's 10 s default per request
 * (net/fetch-types.ts DEFAULT_TIMEOUT_MS), which also bounds the whole call below.
 */
const RESOLVER_TIMEOUT_MS = 4_000;
const RESOLVER_TRIES = 2;

const defaultResolver: TxtResolver = async (name) => {
  const resolver = new dns.promises.Resolver({ timeout: RESOLVER_TIMEOUT_MS, tries: RESOLVER_TRIES });
  try {
    return await resolver.resolveTxt(name);
  } finally {
    resolver.cancel();
  }
};

/** Answers that mean "there is no such record", as opposed to "the lookup failed". */
const NO_RECORD = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);

/**
 * Asks DNS what key ids `_plumbline.<host>` names, and compares them with `kid`. Never throws: a failure is
 * `could not ask` with a reason in Plumbline's words. An IP literal or a single-label host has no DNS name to ask.
 */
export async function askDns(host: string, kid: string, resolver: TxtResolver = defaultResolver, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<DnsCheck> {
  const bare = host.startsWith("[") ? host.slice(1, -1) : host;
  if (net.isIP(bare) !== 0) return { name: host, state: "could not ask", why: "the address is an IP literal, which has no DNS name" };
  if (!bare.includes(".") || bare === "localhost" || bare.endsWith(".localhost")) {
    return { name: host, state: "could not ask", why: "the host is not a public DNS name" };
  }
  const name = dnsNameFor(bare);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const records = await Promise.race([
      resolver(name),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })), timeoutMs);
      }),
    ]);
    return dnsVerdict(name, kid, parseTxt(records));
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && NO_RECORD.has(code)) return { name, state: "no record" };
    const why = code === "ETIMEOUT" || code === "ETIMEDOUT" ? "the lookup timed out" : code === "ECONNREFUSED" ? "the resolver refused the query" : "the lookup failed";
    return { name, state: "could not ask", why };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
