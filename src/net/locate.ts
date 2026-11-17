// Finds a site's manifest and network definitions from the address a person gives, and a peer's network file from a
// peer's network address. Every fetch goes through the injected fetcher, which is safeFetch in production.
//
// Addresses follow Agent Atlas' reading (checked against its live /api/check output on 2026-11-17): a site address,
// a network address ("site address plus network name", no extension), the address of an agent-manifest.json, or the
// address of a `<name>.network.json`. The manifest's `networks[].hocon` is authoritative for where a network's JSON is.

import type { SafeFetchOptions, SafeFetchResponse } from "./fetch-types.js";

export type Fetcher = (url: string, options?: SafeFetchOptions) => Promise<SafeFetchResponse>;

export const MANIFEST_NAME = "agent-manifest.json";

export interface NetworkRef {
  name: string;
  /** Site base plus the network name, no extension: the address a caller links to and Agent Customs stamps. */
  networkUrl: string;
  /** Where the network definition JSON is published. */
  fileUrl: string;
  frontMan?: string;
}

export type Located =
  | {
      ok: true;
      base: string;
      manifestUrl?: string;
      manifest?: unknown;
      /** The manifest as served, decoded as UTF-8; present whenever `manifest` is. */
      manifestText?: string;
      networks: NetworkRef[];
      /** Set when the address named one network; `networks` then holds only that one, or nothing when it is absent. */
      requestedName?: string;
    }
  | { ok: false; reason: "no-manifest" | "manifest-unreadable" | "bad-target"; status?: number };

function dirOf(url: URL): string {
  const copy = new URL(url.toString());
  copy.search = "";
  copy.hash = "";
  copy.pathname = copy.pathname.slice(0, copy.pathname.lastIndexOf("/") + 1);
  return copy.toString();
}

function withSlash(url: URL): string {
  const copy = new URL(url.toString());
  copy.search = "";
  copy.hash = "";
  if (!copy.pathname.endsWith("/")) copy.pathname = `${copy.pathname}/`;
  return copy.toString();
}

function lastSegment(url: URL): string {
  const parts = url.pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function parseJson(response: SafeFetchResponse): unknown {
  try {
    return JSON.parse(response.text());
  } catch {
    return undefined;
  }
}

function networksOf(manifest: unknown, manifestUrl: string, base: string): NetworkRef[] {
  if (typeof manifest !== "object" || manifest === null) return [];
  const list = (manifest as { networks?: unknown }).networks;
  if (!Array.isArray(list)) return [];
  const out: NetworkRef[] = [];
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue;
    const { name, hocon, front_man: frontMan } = entry as Record<string, unknown>;
    if (typeof name !== "string" || name === "" || typeof hocon !== "string" || hocon === "") continue;
    let fileUrl: string;
    try {
      fileUrl = new URL(hocon, manifestUrl).toString();
    } catch {
      continue;
    }
    out.push({ name, networkUrl: `${base}${name}`, fileUrl, ...(typeof frontMan === "string" ? { frontMan } : {}) });
  }
  return out;
}

async function loadManifest(
  manifestUrl: string,
  base: string,
  fetcher: Fetcher,
  options: SafeFetchOptions,
  requestedName?: string,
): Promise<Located> {
  const response = await fetcher(manifestUrl, options);
  if (response.status === 404 || response.status === 410) return { ok: false, reason: "no-manifest", status: response.status };
  if (!response.ok) return { ok: false, reason: "manifest-unreadable", status: response.status };
  const manifest = parseJson(response);
  if (manifest === undefined) return { ok: false, reason: "manifest-unreadable", status: response.status };
  let networks = networksOf(manifest, manifestUrl, base);
  if (requestedName !== undefined) networks = networks.filter((n) => n.name === requestedName);
  return {
    ok: true,
    base,
    manifestUrl,
    manifest,
    manifestText: response.text(),
    networks,
    ...(requestedName !== undefined ? { requestedName } : {}),
  };
}

/** Throws SafeFetchError when the network fails; returns `ok: false` for an HTTP answer that says there is no manifest. */
export async function locateTarget(target: string, fetcher: Fetcher, options: SafeFetchOptions = {}): Promise<Located> {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return { ok: false, reason: "bad-target" };
  }
  const path = url.pathname;
  if (path.endsWith(`/${MANIFEST_NAME}`)) {
    return loadManifest(url.toString(), dirOf(url), fetcher, options);
  }
  if (path.endsWith(".network.json")) {
    const name = lastSegment(url).slice(0, -".network.json".length);
    const base = dirOf(url);
    return {
      ok: true,
      base,
      networks: [{ name, networkUrl: `${base}${name}`, fileUrl: url.toString() }],
      requestedName: name,
    };
  }
  if (path === "" || path.endsWith("/")) {
    const base = withSlash(url);
    return loadManifest(`${base}${MANIFEST_NAME}`, base, fetcher, options);
  }
  // No trailing slash and no file name: a site folder or a network address. Try it as a site first.
  const asSite = withSlash(url);
  const first = await loadManifest(`${asSite}${MANIFEST_NAME}`, asSite, fetcher, options);
  if (first.ok) return first;
  const parent = dirOf(url);
  return loadManifest(`${parent}${MANIFEST_NAME}`, parent, fetcher, options, lastSegment(url));
}

/** Where a peer's network definition lives, for the address a caller links to. */
export async function locatePeerFile(peerUrl: string, fetcher: Fetcher, options: SafeFetchOptions = {}): Promise<{ fileUrl: string; base: string }> {
  const url = new URL(peerUrl);
  if (url.pathname.endsWith(".json")) return { fileUrl: url.toString(), base: dirOf(url) };
  const base = dirOf(url);
  const name = lastSegment(url);
  const manifest = await fetcher(`${base}${MANIFEST_NAME}`, options);
  if (manifest.ok) {
    const parsed = parseJson(manifest);
    const found = networksOf(parsed, `${base}${MANIFEST_NAME}`, base).find((n) => n.name === name);
    if (found) return { fileUrl: found.fileUrl, base };
  }
  return { fileUrl: `${base}${name}.network.json`, base };
}
