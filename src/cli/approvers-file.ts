// Where the approvers file (the agent trust store) comes from, for `agent check`, `guard --require approved`, `audit`
// and `approver add`. Node, CLI layer.
//
// The approvers file is held OUTSIDE the repository it governs (guard-input-custody, docs/agent-lock.md "Approval and
// audit"): a pull request that could add an approver could approve itself. So the order is: `--approvers <file>` when
// given; else the environment variable PLUMBLINE_APPROVERS (the file's JSON TEXT, for CI, from a repository variable a
// pull request cannot edit); else $PLUMBLINE_HOME/approvers.json (PLUMBLINE_HOME defaults to <home>/.config/plumbline).
// A file that resolves inside the repository root being checked is refused with a fixed sentence. A problem sentence
// never quotes the file's content.

import { realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { approversKidProblem, parseApprovers } from "../core/approve.js";
import { APPROVERS_FILE, type ApproverEntry } from "../core/types.js";
import { readTextIfPresent } from "./files.js";

/** The environment variable that carries the approvers file's JSON text (CI). */
export const APPROVERS_ENV = "PLUMBLINE_APPROVERS" as const;
/** The environment variable naming Plumbline's user-level folder. */
export const HOME_ENV = "PLUMBLINE_HOME" as const;

export type ApproversSource =
  | { ok: true; approvers: ApproverEntry[]; source: "file" | "env" | "default"; path?: string }
  | { ok: false; absent: true; looked: string }
  | { ok: false; problem: string; source: "file" | "env" | "default" };

/** The fixed sentence for an approvers file inside the repository it would govern. */
export const APPROVERS_IN_REPOSITORY =
  "the approvers file sits inside the repository it governs, so a change to the repository could add an approver: keep it outside (the default is $PLUMBLINE_HOME/approvers.json) or pass it in PLUMBLINE_APPROVERS";

/** $PLUMBLINE_HOME, or <home>/.config/plumbline when it is unset or empty. */
export function plumblineHome(env: NodeJS.ProcessEnv): string {
  const home = env[HOME_ENV];
  return home !== undefined && home.trim() !== "" ? path.resolve(home) : path.join(os.homedir(), ".config", "plumbline");
}

/** $PLUMBLINE_HOME/approvers.json. */
export function defaultApproversPath(env: NodeJS.ProcessEnv): string {
  return path.join(plumblineHome(env), APPROVERS_FILE);
}

async function realOrResolved(file: string): Promise<string> {
  try {
    return await realpath(file);
  } catch {
    // the file may not exist yet (approver add): resolve its folder when that exists
    try {
      return path.join(await realpath(path.dirname(path.resolve(file))), path.basename(file));
    } catch {
      return path.resolve(file);
    }
  }
}

/** True when `file` resolves to `root` or inside it (symlinks resolved; case folded on Windows). */
export async function isInside(root: string, file: string): Promise<boolean> {
  const fold = (p: string): string => (process.platform === "win32" ? p.toLowerCase() : p);
  const relative = path.relative(fold(await realOrResolved(root)), fold(await realOrResolved(file)));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function parsed(text: string, source: "file" | "env" | "default", file?: string): Promise<ApproversSource> {
  let approvers: ApproverEntry[];
  try {
    approvers = parseApprovers(text).approvers;
  } catch (error) {
    return { ok: false, problem: `not an approvers file: ${(error as Error).message}`, source };
  }
  const kid = await approversKidProblem(approvers);
  if (kid !== undefined) return { ok: false, problem: `not an approvers file: ${kid}`, source };
  return { ok: true, approvers, source, ...(file !== undefined ? { path: file } : {}) };
}

/**
 * The approvers to verify against: from `file` (`--approvers`), else PLUMBLINE_APPROVERS, else the default path.
 * `repoRoot`, when given, is the repository being checked: a file inside it is refused. An unreadable file (other than
 * a missing one) throws CliError (exit 2).
 */
export async function resolveApprovers(file: string | undefined, env: NodeJS.ProcessEnv, repoRoot?: string): Promise<ApproversSource> {
  const fromEnv = env[APPROVERS_ENV];
  if (file === undefined && fromEnv !== undefined && fromEnv.trim() !== "") return parsed(fromEnv, "env");
  const source = file !== undefined ? "file" : "default";
  const target = file ?? defaultApproversPath(env);
  if (repoRoot !== undefined && (await isInside(repoRoot, target))) return { ok: false, problem: APPROVERS_IN_REPOSITORY, source };
  const text = await readTextIfPresent(target);
  if (text === undefined) return { ok: false, absent: true, looked: target };
  return parsed(text, source, target);
}
