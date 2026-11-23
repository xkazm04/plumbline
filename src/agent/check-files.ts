// `agent check`, the files part: what changed among the files the declaration matches since the lock. Node: reads the
// checkout. Owned by the files work (line endings, links): hashing goes through one rule shared with build.ts.

import { readFile } from "node:fs/promises";
import { sha256Hex } from "../core/canonical.js";
import { type AgentDeclaration, type AgentFinding, type AgentLock } from "../core/types.js";
import { CliError } from "../cli/args.js";
import { repoPath } from "./build.js";
import { matchFiles } from "./discover.js";
import { byPath } from "./glob.js";

/** A repository file's exact bytes, or undefined when it is absent. Any other read failure: exit 2. */
export async function readBytesIfPresent(root: string, rel: string): Promise<Uint8Array | undefined> {
  try {
    return new Uint8Array(await readFile(repoPath(root, rel)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new CliError(`${rel} could not be read`);
  }
}

export async function fileFindings(root: string, lock: AgentLock, declaration: AgentDeclaration | undefined): Promise<AgentFinding[]> {
  const out: AgentFinding[] = [];
  const now = new Map<string, Uint8Array>();
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
      const bytes = await readBytesIfPresent(root, rel);
      if (bytes !== undefined) now.set(rel, bytes);
    }
  }
  for (const rel of [...new Set([...Object.keys(lock.files), ...now.keys()])].sort(byPath)) {
    const held = lock.files[rel];
    const bytes = now.get(rel);
    if (held === undefined) out.push({ severity: "block", code: "file-added", ref: rel, summary: "A file the declaration matches is not in the lock." });
    else if (bytes === undefined) out.push({ severity: "block", code: "file-removed", ref: rel, summary: "A file the lock holds is no longer in the repository (or no longer matched)." });
    else if ((await sha256Hex(bytes)) !== held) out.push({ severity: "block", code: "file-changed", ref: rel, summary: "A file the lock holds changed since the lock was written." });
  }
  return out;
}
