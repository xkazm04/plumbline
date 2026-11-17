// Shared test helpers for the gate, watch and net tests (WP2): fixtures, a scripted fetcher, a loopback server.

import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Fetcher } from "../net/locate.js";
import { SafeFetchError, type SafeFetchResponse } from "../net/safe-fetch.js";

/** Reads a recorded fixture. The tests run from a build folder, so the path is taken from this module's URL. */
export function fixture(name: string): string {
  return readFileSync(new URL(`../../src/test/fixtures/wp2/${name}`, import.meta.url), "utf8");
}

export interface Route {
  status?: number;
  body?: string | object;
  headers?: Record<string, string>;
  /** Throws instead of answering. */
  error?: SafeFetchError;
}

export function response(url: string, route: Route): SafeFetchResponse {
  const status = route.status ?? 200;
  const text = typeof route.body === "string" ? route.body : route.body === undefined ? "" : JSON.stringify(route.body);
  const bytes = new TextEncoder().encode(text);
  return { status, ok: status >= 200 && status < 300, url, redirects: 0, headers: route.headers ?? {}, bytes, text: () => text };
}

export interface ScriptedFetch {
  fetch: Fetcher;
  calls: string[];
}

/** A fetcher that answers from a table; an address not in the table is a network failure, like a closed port. */
export function scripted(routes: Record<string, Route>): ScriptedFetch {
  const calls: string[] = [];
  const fetch: Fetcher = async (url) => {
    calls.push(url);
    const route = routes[url];
    if (route === undefined) throw new SafeFetchError("network", "ECONNREFUSED");
    if (route.error) throw route.error;
    return response(url, route);
  };
  return { fetch, calls };
}

export interface TestServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

export async function loopbackServer(handler: http.RequestListener): Promise<TestServer> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

const scratch: string[] = [];
process.on("exit", () => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** A scratch copy of the fixture site (src/test/fixtures/wp2/site) that a test may edit freely. */
export function copySite(): string {
  const dir = mkdtempSync(join(tmpdir(), "plumbline-wp2-"));
  scratch.push(dir);
  cpSync(fileURLToPath(new URL("../../src/test/fixtures/wp2/site", import.meta.url)), dir, { recursive: true });
  return dir;
}
