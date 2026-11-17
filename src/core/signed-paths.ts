// Which files a site signs. Pure: no node:* imports, so the CLI and the Desk share one rule.

export const MANIFEST_FILE = "agent-manifest.json" as const;
export const LINKS_FILE = "links.json" as const;

/** `x.hocon` names `x.network.json`; any other path is used as written. */
export function networkFileFor(hocon: string): string {
  return hocon.endsWith(".hocon") ? `${hocon.slice(0, -".hocon".length)}.network.json` : hocon;
}

/**
 * The site-relative paths a signature covers, in this order: `agent-manifest.json`; each `networks[].hocon` the manifest
 * names, mapped `.hocon` -> `.network.json` (any other path as written), each once, in manifest order; `links.json` when
 * the site has one. Entries without a string `hocon` are skipped. A manifest that is not an object yields the manifest
 * path alone (plus links). The caller loads the files, refuses a named one that is missing, and checks every path is
 * safe; signSubjects sorts the subjects.
 */
export function signedPathsOf(manifest: unknown, hasLinks: boolean): string[] {
  const paths: string[] = [MANIFEST_FILE];
  const networks =
    typeof manifest === "object" && manifest !== null && !Array.isArray(manifest)
      ? (manifest as { networks?: unknown }).networks
      : undefined;
  if (Array.isArray(networks)) {
    for (const entry of networks) {
      const hocon = typeof entry === "object" && entry !== null ? (entry as { hocon?: unknown }).hocon : undefined;
      if (typeof hocon !== "string") continue;
      const file = networkFileFor(hocon);
      if (!paths.includes(file)) paths.push(file);
    }
  }
  if (hasLinks && !paths.includes(LINKS_FILE)) paths.push(LINKS_FILE);
  return paths;
}
