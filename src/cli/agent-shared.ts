// Shared by the agent subcommands (init, check, relock, wrap): the root, small text helpers, the backup suffix and the
// .gitignore line.

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { repoPath } from "../agent/build.js";
import { CliError } from "./args.js";

/** The suffix of the copy --wrap keeps of each host file it edits. */
export const BACKUP_SUFFIX = ".plumbline-backup";
/** The line init adds to .gitignore (the guard's pending files are local, never committed). */
export const GITIGNORE_LINE = ".plumbline/";

export function rootOf(given: string | undefined): string {
  const root = path.resolve(given ?? ".");
  if (!existsSync(root)) throw new CliError("--root is not a folder that exists");
  return root;
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
export const jsonText = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** Adds `.plumbline/` to the repository's .gitignore when no line already ignores it. True when it was added. */
export async function ensureGitignore(root: string): Promise<boolean> {
  const file = repoPath(root, ".gitignore");
  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new CliError(".gitignore could not be read");
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  if (lines.some((l) => [".plumbline", ".plumbline/", "/.plumbline", "/.plumbline/"].includes(l))) return false;
  await writeFile(file, `${text}${text === "" || text.endsWith("\n") ? "" : "\n"}${GITIGNORE_LINE}\n`);
  return true;
}
