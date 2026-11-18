// Preloaded (node --import) into CLI processes the tests spawn, so a spawned gate or watch cannot reach the network:
// every name lookup fails as if the name did not exist. Literal addresses never resolve, and the tests use only
// private ones (refused before any connection) or the loopback test server. Not a test file itself.

import dns from "node:dns";

const refuse = (hostname: unknown): NodeJS.ErrnoException => {
  const error: NodeJS.ErrnoException = new Error(`no network in tests: refused to resolve ${String(hostname)}`);
  error.code = "ENOTFOUND";
  return error;
};

dns.promises.lookup = (async (hostname: string) => {
  throw refuse(hostname);
}) as typeof dns.promises.lookup;

dns.lookup = ((hostname: string, ...rest: unknown[]) => {
  const callback = rest[rest.length - 1];
  if (typeof callback === "function") process.nextTick(() => (callback as (e: Error) => void)(refuse(hostname)));
}) as typeof dns.lookup;

// DNS beyond lookup: the TXT query `trust --url` makes for the second channel (src/net/dns.ts). Refused too, so a
// spawned CLI never asks a real resolver.
const refuseQuery = async (hostname: unknown): Promise<never> => {
  const error: NodeJS.ErrnoException = new Error(`no network in tests: refused to query ${String(hostname)}`);
  error.code = "ECONNREFUSED";
  throw error;
};
dns.promises.Resolver.prototype.resolveTxt = refuseQuery as typeof dns.promises.Resolver.prototype.resolveTxt;
dns.promises.resolveTxt = refuseQuery as typeof dns.promises.resolveTxt;
