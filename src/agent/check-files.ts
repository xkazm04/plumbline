// `agent check`, the files part: what changed among the files the declaration matches since the lock. Node: reads the
// checkout. Owned by the files work (line endings, links): hashing goes through one rule shared with build.ts.
//
// A file is hashed by the lock's own rule (src/agent/text-hash.ts): `text-lf` for a version 2 lock, exact bytes for a
// version 1 lock (no `hashing`), so an older lock reads as it was written. A link the lock records (`links`) that is not
// in the checkout now (absent, or dangling) is one `link-absent` warn: its files were not checked, so they are neither
// removed nor clean. A link replaced by a real folder holding the same files is compared like any folder: clean.

import { readFile, stat } from "node:fs/promises";
import { type AgentDeclaration, type AgentFinding, type AgentLock } from "../core/types.js";
import { CliError } from "../cli/args.js";
import { repoPath } from "./build.js";
import { matchFiles } from "./discover.js";
import { byPath } from "./glob.js";
import { declaredFileHash } from "./text-hash.js";

/** A repository file's exact bytes, or undefined when it is absent. Any other read failure: exit 2. */
export async function readBytesIfPresent(root: string, rel: string): Promise<Uint8Array | undefined> {
  try {
    return new Uint8Array(await readFile(repoPath(root, rel)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new CliError(`${rel} could not be read`);
  }
}

/** True when `rel` is the link `link` or sits under it. */
const under = (rel: string, link: string): boolean => rel === link || rel.startsWith(`${link}/`);

/**
 * The links the lock records that lead nowhere now (the path is absent, or a link whose target is gone), outermost only:
 * a link inside an absent link is covered by it.
 */
async function absentLinks(root: string, lock: AgentLock): Promise<string[]> {
  const absent: string[] = [];
  for (const link of [...(lock.links ?? [])].sort(byPath)) {
    if (absent.some((outer) => under(link, outer))) continue;
    try {
      await stat(repoPath(root, link));
    } catch {
      absent.push(link);
    }
  }
  return absent;
}

export async function fileFindings(root: string, lock: AgentLock, declaration: AgentDeclaration | undefined): Promise<AgentFinding[]> {
  const out: AgentFinding[] = [];
  const now = new Map<string, Uint8Array>();
  const absent = await absentLinks(root, lock);
  for (const link of absent) {
    out.push({ severity: "warn", code: "link-absent", ref: link, summary: "A link the lock records is not in the checkout, so the files under it were not checked." });
  }
  const unchecked = (rel: string): boolean => absent.some((link) => under(rel, link));
  if (declaration !== undefined) {
    const matched = await matchFiles(root, declaration.files);
    for (const rel of matched.paths) {
      const bytes = await readBytesIfPresent(root, rel);
      if (bytes !== undefined) now.set(rel, bytes);
    }
    for (const glob of matched.unsafeGlobs) {
      out.push({ severity: "block", code: "file-added", ref: glob, summary: "A file whose name a lock cannot hold (outside [A-Za-z0-9._/-]) matches this glob; rename it or narrow the glob." });
    }
  } else {
    for (const rel of Object.keys(lock.files)) {
      if (unchecked(rel)) continue;
      const bytes = await readBytesIfPresent(root, rel);
      if (bytes !== undefined) now.set(rel, bytes);
    }
  }
  for (const rel of [...new Set([...Object.keys(lock.files), ...now.keys()])].sort(byPath)) {
    const held = lock.files[rel];
    const bytes = now.get(rel);
    if (held === undefined) out.push({ severity: "block", code: "file-added", ref: rel, summary: "A file the declaration matches is not in the lock." });
    else if (bytes === undefined) {
      if (!unchecked(rel)) out.push({ severity: "block", code: "file-removed", ref: rel, summary: "A file the lock holds is no longer in the repository (or no longer matched)." });
    } else if ((await declaredFileHash(bytes, lock.hashing)) !== held) out.push({ severity: "block", code: "file-changed", ref: rel, summary: "A file the lock holds changed since the lock was written." });
  }
  return out;
}
