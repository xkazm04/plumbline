// Reading, checking and writing plumbline.lock.json (the PlumblineLock shape in core/types.ts), and the helpers every
// detector shares: resolving a lock reference under the site root without letting it leave the root.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { FORMAT_VERSION, KID_PATTERN, LOCK_FILE, PEER_LINKS_ABSENT, type DriftFinding, type PlumblineLock } from "../core/types.js";
import type { Fetcher } from "../net/locate.js";
import type { SafeFetchOptions } from "../net/safe-fetch.js";

/** Injection points for tests; production passes none. */
export interface WatchDeps {
  fetch?: Fetcher;
  /** Merged into every safeFetch call (tests pass `allowLocal` here). */
  fetchOptions?: SafeFetchOptions;
  now?: () => Date;
  /** `init` only: extra grounding sources to lock, as paths under the root or https URLs. */
  extraSources?: string[];
  /** `init` only: the vendored runtime folder relative to the root; default is `runtime`, then `site/runtime`. */
  runtimeDir?: string;
  /** The upstream commits endpoint for the runtime check. */
  upstreamUrl?: string;
}

export const UPSTREAM_REPO = "cognizant-ai-lab/nsdeploy";
export const UPSTREAM_COMMITS_URL = `https://api.github.com/repos/${UPSTREAM_REPO}/commits?per_page=1`;

export type LockRead =
  | { kind: "ok"; lock: PlumblineLock }
  | { kind: "missing" }
  | { kind: "malformed"; why: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isHex = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

/** Checks a parsed lock against the PlumblineLock shape; returns a reason sentence when it does not fit. */
export function lockProblem(value: unknown): string | null {
  if (!isObject(value)) return "the lock is not a JSON object";
  if (value.version !== FORMAT_VERSION) return "the lock has an unknown version";
  const { runtime, grounding, peers } = value;
  if (!isObject(runtime) || runtime.source !== "nsdeploy" || typeof runtime.commit !== "string" || !isObject(runtime.files)) {
    return "the lock's runtime section is malformed";
  }
  if (!Object.values(runtime.files).every(isHex)) return "the lock's runtime file hashes are malformed";
  if (!isObject(grounding) || !Array.isArray(grounding.sources) || typeof grounding.builtAt !== "string") {
    return "the lock's grounding section is malformed";
  }
  if (!grounding.sources.every((s) => isObject(s) && typeof s.ref === "string" && isHex(s.sha256))) {
    return "the lock's grounding sources are malformed";
  }
  if (!isObject(peers)) return "the lock's peers section is malformed";
  for (const p of Object.values(peers)) {
    if (
      !isObject(p) ||
      !isHex(p.sha256) ||
      typeof p.checkedAt !== "string" ||
      (p.kid !== undefined && (typeof p.kid !== "string" || !KID_PATTERN.test(p.kid))) ||
      (p.links !== undefined && !isHex(p.links) && p.links !== PEER_LINKS_ABSENT)
    ) {
      return "the lock's peer entries are malformed";
    }
  }
  return null;
}

export async function readLock(root: string): Promise<LockRead> {
  let text: string;
  try {
    text = await readFile(join(root, LOCK_FILE), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
    return { kind: "malformed", why: "the lock file could not be read" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "malformed", why: "the lock file is not valid JSON" };
  }
  const problem = lockProblem(parsed);
  return problem === null ? { kind: "ok", lock: parsed as PlumblineLock } : { kind: "malformed", why: problem };
}

/** Writes the lock, refusing to overwrite one that exists. */
export async function writeLock(root: string, lock: PlumblineLock): Promise<void> {
  const path = join(root, LOCK_FILE);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(lock, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

/** A path under the root for a lock reference, or null when the reference would leave the root. */
export function underRoot(root: string, ref: string): string | null {
  if (isAbsolute(ref) || /^[a-z][a-z0-9+.-]*:/i.test(ref)) return null;
  const full = resolve(root, ref);
  const rel = relative(resolve(root), full);
  if (rel === "" || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) return null;
  return full;
}

export const short = (sha: string): string => sha.slice(0, 7);

export function lockMalformedFinding(why: string): DriftFinding {
  return { kind: "grounding", severity: "warn", ref: LOCK_FILE, summary: `The lock cannot be used: ${why}, so no drift was checked.` };
}
