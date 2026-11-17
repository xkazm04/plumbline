// Which files a site signs. Pure: no node:* imports, so the CLI and the Desk share one rule.
//
// The rule follows what the reference runtime FETCHES, not what a reader might expect it to: it loads each network
// from `networks[].hocon` exactly as the manifest writes it (engine.js `_compile`: `resolveUrl(base, entry.hocon)`),
// and it lays the site's `links.json` over every network's links (`_loadPublishedLinks`). So the signed path of a
// network is the `hocon` value itself, and `links.json` is signed whenever the site has one. `plumbline.lock.json` is
// a published file the Desk reads, so it is signed whenever it exists too.
//
// The manifest also names CODE the runtime loads, and that is signed at its own path the same way:
//   actions.module, actions.modules[]  imported as ES modules (action-transport.js `loadActionModule`:
//                                      `import(sameOriginAsset(base, path))` for `module` and each of `modules`);
//   actions.bridge                     the HTML the runtime frames for partner sites (action-transport.js:139);
//   coded_tools.bundle                 the executable bundle of coded tools (engine.js `_compile`, line 207).
// Not covered, and docs/signature-format.md says so: modules those files import in turn, the page's own scripts and
// the runtime folder (the HTTPS origin and the watch's runtime lock cover those), and the manifest's other action
// sources, `actions.catalog` and `actions.pages[]`.

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
 * The signed path for one code file the manifest names (`actions.module`, `actions.modules[i]`, `actions.bridge`,
 * `coded_tools.bundle`): the same rule as a network's `hocon` (networkPathOf). `field` names the manifest field in
 * the error; the value itself is never quoted.
 */
export function codePathOf(value: string, field: string): string {
  const path = value.startsWith("./") ? value.slice(2) : value;
  if (!isSafeSubjectPath(path)) {
    throw new Error(
      `the manifest's ${field} is not a safe site-relative path (absolute URLs and paths, "..", backslashes ` +
        "and characters outside A-Z a-z 0-9 . _ / - are refused)",
    );
  }
  return path;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The code files the manifest makes the runtime load, as [field, value] pairs, in this order: `actions.module`, each
 * string in `actions.modules`, `actions.bridge`, `coded_tools.bundle`. Values that are not strings are skipped (the
 * runtime cannot load them either).
 */
function codeFieldsOf(manifest: Record<string, unknown>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const actions = manifest.actions;
  if (isRecord(actions)) {
    if (typeof actions.module === "string") out.push(["actions.module", actions.module]);
    if (Array.isArray(actions.modules)) {
      actions.modules.forEach((value: unknown, index: number) => {
        if (typeof value === "string") out.push([`actions.modules[${index}]`, value]);
      });
    }
    if (typeof actions.bridge === "string") out.push(["actions.bridge", actions.bridge]);
    // the runtime also loads these as action sources (action-transport.js loadActionModule): a discovered-actions
    // catalog, and pages whose forms become actions. Same rule: what the manifest makes the runtime load is signed.
    if (typeof actions.catalog === "string") out.push(["actions.catalog", actions.catalog]);
    if (Array.isArray(actions.pages)) {
      actions.pages.forEach((value: unknown, index: number) => {
        if (typeof value === "string") out.push([`actions.pages[${index}]`, value]);
      });
    }
  }
  const coded = manifest.coded_tools;
  if (isRecord(coded) && typeof coded.bundle === "string") out.push(["coded_tools.bundle", coded.bundle]);
  return out;
}

/**
 * The site-relative paths a signature must cover, in this order: `agent-manifest.json`; each `networks[].hocon` the
 * manifest names, exactly as written (one leading `./` removed), in manifest order; the code files it names
 * (`actions.module`, `actions.modules[]`, `actions.bridge`, `actions.catalog`, `actions.pages[]`, `coded_tools.bundle`, by the same rule); `links.json`
 * when the site has one; `plumbline.lock.json` when the site has one. Each path once. Entries without a string value
 * are skipped (the runtime cannot load them either). A manifest that is not an object yields the manifest path alone
 * (plus links and lock). Throws when a named path is not a safe site-relative path; the message names the field (and
 * the entry index), never the value. The caller loads the files and refuses a named one that is missing;
 * signSubjects sorts the subjects.
 */
export function signedPathsOf(manifest: unknown, presence: SitePresence): string[] {
  // A caller still passing the old boolean would silently drop links.json from the set: refuse it loudly instead.
  if (typeof presence !== "object" || presence === null || typeof presence.links !== "boolean" || typeof presence.lock !== "boolean") {
    throw new TypeError("signedPathsOf takes { links: boolean, lock: boolean } as its second argument");
  }
  const paths: string[] = [MANIFEST_FILE];
  const add = (file: string): void => {
    if (!paths.includes(file)) paths.push(file);
  };
  if (isRecord(manifest)) {
    const networks = manifest.networks;
    if (Array.isArray(networks)) {
      networks.forEach((entry: unknown, index: number) => {
        const hocon = typeof entry === "object" && entry !== null ? (entry as { hocon?: unknown }).hocon : undefined;
        if (typeof hocon !== "string") return;
        add(networkPathOf(hocon, index));
      });
    }
    for (const [field, value] of codeFieldsOf(manifest)) add(codePathOf(value, field));
  }
  if (presence.links) add(LINKS_FILE);
  if (presence.lock) add(LOCK_FILE);
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
