// Which files a site signs. Pure: no node:* imports, so the CLI and the Desk share one rule.
//
// The rule follows what the reference runtime FETCHES, not what a reader might expect it to: it loads each network
// from `networks[].hocon` exactly as the manifest writes it (engine.js `_compile`: `resolveUrl(base, entry.hocon)`),
// and it lays the site's `links.json` over every network's links (`_loadPublishedLinks`). So the signed path of a
// network is the `hocon` value itself, and `links.json` is signed whenever the site has one. `plumbline.lock.json` is
// a published file the Desk reads, so it is signed whenever it exists too.

import { LINKS_FILE, LOCK_FILE, MANIFEST_FILE, SUBJECT_PATH_PATTERN } from "./types.js";

export { LINKS_FILE, LOCK_FILE, MANIFEST_FILE };

/** Which optional site files exist beside the manifest. */
export interface SitePresence {
  /** The site publishes `links.json`. */
  links: boolean;
  /** The site publishes `plumbline.lock.json`. */
  lock: boolean;
}

/**
 * A subject path: relative, `/`-separated, only `[A-Za-z0-9._/-]`, and no segment empty, `.` or `..`. So no absolute
 * path, no URL (`:` is not allowed), no backslash, no percent-escape and no way out of the site base.
 */
export function isSafeSubjectPath(path: unknown): path is string {
  if (typeof path !== "string" || path === "" || !SUBJECT_PATH_PATTERN.test(path)) return false;
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/**
 * The signed path for one `networks[].hocon` value: the value as written, with one leading `./` removed (the runtime
 * resolves `./x` and `x` to the same address). Throws when the value is not a safe site-relative path: an absolute URL
 * or path, a `..` or `.` segment, a backslash, or any character outside `[A-Za-z0-9._/-]`. The runtime would fetch such
 * a file from somewhere a signature cannot pin, so it is refused rather than skipped. The message names the entry's
 * index, never its text.
 */
export function networkPathOf(hocon: string, index = 0): string {
  const path = hocon.startsWith("./") ? hocon.slice(2) : hocon;
  if (!isSafeSubjectPath(path)) {
    throw new Error(
      `the manifest's networks[${index}].hocon is not a safe site-relative path (absolute URLs and paths, "..", backslashes ` +
        "and characters outside A-Z a-z 0-9 . _ / - are refused)",
    );
  }
  return path;
}

/**
 * The site-relative paths a signature must cover, in this order: `agent-manifest.json`; each `networks[].hocon` the
 * manifest names, exactly as written (one leading `./` removed), each once, in manifest order; `links.json` when the
 * site has one; `plumbline.lock.json` when the site has one. Entries without a string `hocon` are skipped (the runtime
 * cannot load them either). A manifest that is not an object yields the manifest path alone (plus links and lock).
 * Throws (networkPathOf) when a `hocon` is not a safe site-relative path. The caller loads the files and refuses a
 * named one that is missing; signSubjects sorts the subjects.
 */
export function signedPathsOf(manifest: unknown, presence: SitePresence): string[] {
  // A caller still passing the old boolean would silently drop links.json from the set: refuse it loudly instead.
  if (typeof presence !== "object" || presence === null || typeof presence.links !== "boolean" || typeof presence.lock !== "boolean") {
    throw new TypeError("signedPathsOf takes { links: boolean, lock: boolean } as its second argument");
  }
  const paths: string[] = [MANIFEST_FILE];
  const networks =
    typeof manifest === "object" && manifest !== null && !Array.isArray(manifest)
      ? (manifest as { networks?: unknown }).networks
      : undefined;
  if (Array.isArray(networks)) {
    networks.forEach((entry: unknown, index: number) => {
      const hocon = typeof entry === "object" && entry !== null ? (entry as { hocon?: unknown }).hocon : undefined;
      if (typeof hocon !== "string") return;
      const file = networkPathOf(hocon, index);
      if (!paths.includes(file)) paths.push(file);
    });
  }
  if (presence.links && !paths.includes(LINKS_FILE)) paths.push(LINKS_FILE);
  if (presence.lock && !paths.includes(LOCK_FILE)) paths.push(LOCK_FILE);
  return paths;
}

/**
 * Reads a manifest's bytes the way the runtime does (`resp.json()`: UTF-8 decode, a leading BOM dropped, then
 * JSON.parse). Returns undefined when they are not JSON; signedPathsOf then yields the manifest path alone, and the
 * runtime could not load such a site either.
 */
export function parseManifest(content: Uint8Array | string): unknown {
  try {
    const text = typeof content === "string" ? content.replace(/^\uFEFF/, "") : new TextDecoder("utf-8").decode(content);
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
