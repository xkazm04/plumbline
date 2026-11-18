// Reading and writing plumbline.lock.json (the PlumblineLock shape in core/types.ts, with the optional members in
// decide.ts), and the one way the watch reads a file under the site root: lexically under it AND, after every
// symlink and junction is resolved, still under the root's real path.

import { mkdir, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { LOCK_FILE, type ExternalKind } from "../core/types.js";
import type { Fetcher } from "../net/locate.js";
import type { SafeFetchOptions } from "../net/safe-fetch.js";
import { lockProblem, type Lock, type RuntimeVia } from "./decide.js";

export { lockProblem } from "./decide.js";

/** Injection points for tests; production passes none. */
export interface WatchDeps {
  fetch?: Fetcher;
  /** Merged into every safeFetch call (tests pass `allowLocal` here). */
  fetchOptions?: SafeFetchOptions;
  now?: () => Date;
  /** `init` and `relock`: extra grounding sources to lock, as paths under the root or https URLs. */
  extraSources?: string[];
  /** `init` and `relock`: external agent definitions to lock (`--external a2a-card=<url>`). */
  externals?: { kind: ExternalKind; url: string }[];
  /** `relock`: grounding refs (and external addresses) to leave out of the new lock, even ones the previous lock held or the site names. */
  dropSources?: string[];
  /** `init` and `relock`: the vendored runtime folder relative to the root; default is `runtime`, then `site/runtime`. */
  runtimeDir?: string;
  /** The upstream commits endpoint for the runtime check of a lock with no `runtime.via` (nsdeploy). */
  upstreamUrl?: string;
}

export const UPSTREAM_REPO = "cognizant-ai-lab/nsdeploy";
export const UPSTREAM_COMMITS_URL = `https://api.github.com/repos/${UPSTREAM_REPO}/commits?per_page=1`;

/**
 * The GitHub listing of the newest commit that touched the runtime folder in the repository it was copied from: on
 * the default branch, or (with `at`) as of that commit. Every part was pattern-checked by isRuntimeVia, so nothing in
 * it can leave the API's path or add a query member.
 */
export function viaCommitsUrl(via: RuntimeVia, at?: string): string {
  return `https://api.github.com/repos/${via.repo}/commits?${at !== undefined ? `sha=${at}&` : ""}path=${via.path}&per_page=1`;
}

export type LockRead =
  | { kind: "ok"; lock: Lock }
  | { kind: "missing" }
  | { kind: "unreadable"; why: string }
  | { kind: "malformed"; why: string };

/** A file under the root that could not be read. `message` completes the sentence "it ...". */
export class ReadProblem extends Error {
  readonly missing: boolean;
  constructor(message: string, missing = false) {
    super(message);
    this.name = "ReadProblem";
    this.missing = missing;
  }
}

const OUTSIDE = "is outside the site root, so it was not read";

/** A path under the root for a lock reference, or null when the reference would leave the root (lexically). */
export function underRoot(root: string, ref: string): string | null {
  if (isAbsolute(ref) || /^[a-z][a-z0-9+.-]*:/i.test(ref)) return null;
  const full = resolve(root, ref);
  const rel = relative(resolve(root), full);
  if (rel === "" || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) return null;
  return full;
}

function inside(realRoot: string, real: string): boolean {
  const rel = relative(realRoot, real);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * The exact bytes of a file under the root. The reference must stay under the root lexically, and its real path
 * (every symlink and junction resolved) must stay under the root's real path, so a committed link that points out of
 * the site is never read. Throws a ReadProblem.
 */
export async function readUnderRoot(root: string, ref: string): Promise<Uint8Array> {
  const full = underRoot(root, ref);
  if (full === null) throw new ReadProblem(OUTSIDE);
  let real: string;
  try {
    real = await realpath(full);
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    throw new ReadProblem(missing ? "was not found" : "could not be read", missing);
  }
  const realRoot = await realpath(root).catch(() => resolve(root));
  if (!inside(realRoot, real)) throw new ReadProblem(OUTSIDE);
  try {
    return new Uint8Array(await readFile(real));
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    throw new ReadProblem(missing ? "was not found" : "could not be read", missing);
  }
}

export async function readLock(root: string): Promise<LockRead> {
  let bytes: Uint8Array;
  try {
    bytes = await readUnderRoot(root, LOCK_FILE);
  } catch (error) {
    if (error instanceof ReadProblem && error.missing) return { kind: "missing" };
    return { kind: "unreadable", why: `the lock file ${error instanceof ReadProblem ? error.message : "could not be read"}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8").decode(bytes));
  } catch {
    return { kind: "malformed", why: "the lock file is not valid JSON" };
  }
  const problem = lockProblem(parsed);
  return problem === null ? { kind: "ok", lock: parsed as Lock } : { kind: "malformed", why: problem };
}

const serialise = (lock: Lock): string => `${JSON.stringify(lock, null, 2)}\n`;

/** Writes the lock, refusing to overwrite one that exists (`--init`). */
export async function writeLock(root: string, lock: Lock): Promise<void> {
  const path = join(root, LOCK_FILE);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serialise(lock), { encoding: "utf8", flag: "wx" });
}

/** Replaces the lock (`--relock`): written beside it, then renamed over it, so a failed write leaves the old one. */
export async function replaceLock(root: string, lock: Lock): Promise<void> {
  const path = join(root, LOCK_FILE);
  const temp = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temp, serialise(lock), { encoding: "utf8", flag: "wx" });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}

export const short = (sha: string): string => sha.slice(0, 7);

/** Every regular file under a folder, recursively (a link is not followed); nothing when the folder cannot be read. */
export async function listFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(full)));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

/** A path under the root as a lock key: relative to the root, with `/` separators. */
export const toPosix = (root: string, full: string): string => relative(root, full).split(sep).join(posix.sep);
