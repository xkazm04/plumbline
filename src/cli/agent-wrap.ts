// Putting the guard in front of stdio servers: the wrapped host entry, how it is shown, applying it to host files, and
// `plumbline agent wrap` (on an existing declaration).
//
// The launcher (D-8): a wrapped entry runs `plumbline guard ...` when `plumbline` resolves on PATH (the environment the
// command was given: Windows by PATH and PATHEXT, POSIX by PATH and the execute bit), else the absolute form
// `<this node> <this CLI's dist/cli/index.js> guard ...`, which starts on this machine whatever PATH holds, and says why
// and how to get the short form. Either form is recognised as wrapped (src/agent/discover.ts, guardForm), so an entry
// is never wrapped twice; `agent wrap` rewrites an absolute-form entry to the short form once `plumbline` is on PATH.

import { existsSync } from "node:fs";
import { copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serverTarget } from "../core/agent-tools.js";
import { AGENT_FILE, AGENT_LOCK_FILE, type McpServerDecl } from "../core/types.js";
import { repoPath, type AgentDeps } from "../agent/build.js";
import { readBytesIfPresent } from "../agent/check.js";
import { discoverHosts, guardForm, type HostDiscovery, type HostServer } from "../agent/discover.js";
import { byPath } from "../agent/glob.js";
import { parseAgentLock, parseDeclaration } from "../agent/lock.js";
import { whichPosix, whichWindows } from "../guard/spawn.js";
import { CliError } from "./args.js";
import type { Out } from "./commands.js";
import { printable } from "./diff-command.js";
import { relock } from "./agent-relock.js";
import { BACKUP_SUFFIX, jsonText, plural } from "./agent-shared.js";

type StdioDecl = Extract<McpServerDecl, { transport: "stdio" }>;
type Wrappable = HostServer & { decl: StdioDecl };

/** How a wrapped entry starts the guard: `command`, then `prefix`, then `guard ...`. */
export interface GuardLauncher {
  command: string;
  prefix: string[];
  /** True for `plumbline` (found on PATH); false for the absolute form. */
  short: boolean;
}

/** The CLI entry beside this module (dist/cli/index.js when built), as an absolute path. */
export function cliEntry(): string {
  const here = fileURLToPath(import.meta.url);
  return path.join(path.dirname(here), `index${path.extname(here)}`);
}

/** The launcher for `env`: `plumbline` when it resolves on PATH there, else this node and this CLI's entry. */
export function guardLauncher(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform, entry: string = cliEntry(), execPath: string = process.execPath): GuardLauncher {
  const found = platform === "win32" ? whichWindows("plumbline", env) : whichPosix("plumbline", env);
  return found !== undefined ? { command: "plumbline", prefix: [], short: true } : { command: execPath, prefix: [entry], short: false };
}

/** Why an absolute-form entry was written and how to get the short one; undefined for the short form. */
export function launcherSentence(launcher: GuardLauncher): string | undefined {
  if (launcher.short) return undefined;
  return (
    `plumbline is not on PATH, so each wrapped entry runs the guard as ${printable(launcher.command)} ${printable(launcher.prefix.join(" "))}: paths on this machine, which another machine may not have. ` +
    "For the short form, put plumbline on PATH (npm link in its checkout, or install it), then run plumbline agent wrap."
  );
}

/** What the guard requires of the lock: `locked` (its default, nothing written) or `approved` (a person's approval). */
export type WrapRequire = "locked" | "approved";

const guardArgs = (name: string, decl: StdioDecl, require: WrapRequire): string[] => [
  "guard",
  "--lock",
  AGENT_LOCK_FILE,
  "--server",
  name,
  ...(require === "approved" ? ["--require", "approved"] : []),
  "--",
  decl.command,
  ...(decl.args ?? []),
];

/** The host entry that runs the guard in front of a stdio server (env and every other member kept as they were). */
export function wrappedEntry(entry: Record<string, unknown>, name: string, decl: StdioDecl, launcher: GuardLauncher, require: WrapRequire = "locked"): Record<string, unknown> {
  return { ...entry, command: launcher.command, args: [...launcher.prefix, ...guardArgs(name, decl, require)] };
}

/** The member of a host file that --wrap replaces, as shown: command and args only (env is never printed). */
export const wrapShown = (name: string, decl: StdioDecl, launcher: GuardLauncher, require: WrapRequire = "locked"): string =>
  JSON.stringify({ command: launcher.command, args: [...launcher.prefix, ...guardArgs(name, decl, require)] });

/** True when a wrapped entry's guard arguments (before `--`) already say `--require approved`. */
export function requiresApproval(args: readonly unknown[]): boolean {
  const dash = args.indexOf("--");
  const head = dash < 0 ? args : args.slice(0, dash);
  return head.some((a, i) => a === "--require" && head[i + 1] === "approved");
}

/** A wrapped entry's arguments with `--require approved` set: an earlier --require is replaced, every other flag kept. */
export function withApprovalRequired(args: readonly string[]): string[] {
  const dash = args.indexOf("--");
  const head = dash < 0 ? [...args] : args.slice(0, dash);
  const tail = dash < 0 ? [] : args.slice(dash);
  const kept: string[] = [];
  for (let i = 0; i < head.length; i++) {
    if (head[i] === "--require") {
      i++;
      continue;
    }
    kept.push(head[i] as string);
  }
  return [...kept, "--require", "approved", ...tail];
}

/**
 * Writes a backup of each host file, then the file with each of `toWrap`'s entries wrapped and each of `toRequire`'s
 * already-wrapped entries changed to require approval (its other guard flags kept).
 */
export async function applyWrap(
  root: string,
  hosts: HostDiscovery,
  toWrap: readonly Wrappable[],
  launcher: GuardLauncher,
  require: WrapRequire = "locked",
  toRequire: readonly HostServer[] = [],
): Promise<void> {
  for (const config of hosts.configs) {
    const mine = toWrap.filter((e) => e.file === config.file);
    const upgrade = toRequire.filter((e) => e.file === config.file && !mine.some((m) => m.key === e.key));
    if (mine.length === 0 && upgrade.length === 0) continue;
    const full = repoPath(root, config.file);
    await copyFile(full, full + BACKUP_SUFFIX);
    const servers = config.json[config.member] as Record<string, Record<string, unknown>>;
    for (const e of mine) servers[e.key] = wrappedEntry(servers[e.key] as Record<string, unknown>, e.name, e.decl, launcher, require);
    for (const e of upgrade) {
      const entry = servers[e.key] as Record<string, unknown>;
      servers[e.key] = { ...entry, args: withApprovalRequired(entry.args as string[]) };
    }
    await writeFile(full, jsonText(config.json));
  }
}

/** The raw host entry behind a discovered server. */
function rawEntry(hosts: HostDiscovery, e: HostServer): Record<string, unknown> | undefined {
  const config = hosts.configs.find((c) => c.file === e.file);
  const entry = (config?.json[config.member] as Record<string, unknown> | undefined)?.[e.key];
  return typeof entry === "object" && entry !== null && !Array.isArray(entry) ? (entry as Record<string, unknown>) : undefined;
}

/**
 * `plumbline agent wrap [--root <dir>] [--require approved] [--json]`: on an existing declaration, puts the guard in front
 * of each stdio host entry that does not run it yet (and rewrites absolute-form entries to the short form when
 * `plumbline` is on PATH; with --require approved, every wrapped entry also requires a person's approval of the lock),
 * keeping a backup of each host file it edits (refused when a backup exists, as init refuses), then relocks so the new
 * lock covers the edited host files, chained to the one it replaces. Nothing to wrap: nothing is written, no relock.
 */
export async function wrap(root: string, json: boolean, out: Out, deps: AgentDeps, require: WrapRequire = "locked"): Promise<number> {
  // refuse before anything is written: relock must be able to run after the host files change
  const declarationBytes = await readBytesIfPresent(root, AGENT_FILE);
  if (declarationBytes === undefined) throw new CliError(`there is no ${AGENT_FILE}: run plumbline agent init --wrap`);
  const declaration = parseDeclaration(new TextDecoder().decode(declarationBytes));
  if (!declaration.ok) throw new CliError(`${AGENT_FILE} cannot be read (${declaration.problem}): fix it, then run this again`);
  const lockBytes = await readBytesIfPresent(root, AGENT_LOCK_FILE);
  if (lockBytes === undefined) throw new CliError("there is no agent lock: run plumbline agent init");
  const lock = parseAgentLock(new TextDecoder().decode(lockBytes));
  if (!lock.ok) throw new CliError(`the agent lock cannot be used (${lock.problem}): restore it from version control, then run this again`);

  const hosts = await discoverHosts(root, serverTarget);
  const launcher = guardLauncher(deps.env);
  const stdio = hosts.entries.filter((e): e is Wrappable => e.decl.transport === "stdio");
  const toWrap = stdio.filter((e) => !e.wrapped);
  const toShorten = launcher.short
    ? stdio.filter((e) => {
        const raw = rawEntry(hosts, e);
        return e.wrapped && raw !== undefined && typeof raw.command === "string" && Array.isArray(raw.args) && guardForm(raw.command, raw.args as string[]) === "absolute";
      })
    : [];
  const toRequire =
    require === "approved"
      ? stdio.filter((e) => {
          const raw = rawEntry(hosts, e);
          return e.wrapped && !toShorten.includes(e) && raw !== undefined && Array.isArray(raw.args) && !requiresApproval(raw.args);
        })
      : [];
  const edits = [...toWrap, ...toShorten, ...toRequire];
  const files = [...new Set(edits.map((e) => e.file))].sort(byPath);
  if (edits.length === 0) {
    if (json) out(JSON.stringify({ wrapped: [], wrap: [], shortened: [], required: [], launcher: launcher.short ? "plumbline" : "absolute", relocked: false }));
    else
      out(
        `Every stdio server in the host files already runs the guard${require === "approved" ? " and requires approval" : ""} (${plural(stdio.length, "entry", "entries")}); nothing was written and the lock is unchanged.`,
      );
    return 0;
  }
  for (const file of files) {
    if (existsSync(repoPath(root, file + BACKUP_SUFFIX))) throw new CliError(`${file}${BACKUP_SUFFIX} exists: move it away first, so the earlier copy is not lost`);
  }
  await applyWrap(root, hosts, [...toWrap, ...toShorten], launcher, require, toRequire);

  const shown = toWrap.map((e) => ({ file: e.file, server: printable(e.key), entry: JSON.parse(wrapShown(e.name, e.decl, launcher, require)) as unknown }));
  const shortened = toShorten.map((e) => ({ file: e.file, server: printable(e.key) }));
  const required = toRequire.map((e) => ({ file: e.file, server: printable(e.key) }));
  if (json) {
    const lines: string[] = [];
    await relock(root, true, (line) => lines.push(line), deps);
    out(JSON.stringify({ wrapped: files, wrap: shown, shortened, required, launcher: launcher.short ? "plumbline" : "absolute", relocked: true, relock: JSON.parse(lines.join("\n")) as unknown }));
    return 0;
  }
  if (toWrap.length > 0) out(`Put the guard in front of ${plural(toWrap.length, "stdio server")}; the earlier ${plural(files.length, "file")} kept as ${files.map((f) => f + BACKUP_SUFFIX).join(", ")}:`);
  else out(`The earlier ${plural(files.length, "file")} kept as ${files.map((f) => f + BACKUP_SUFFIX).join(", ")}.`);
  for (const e of toWrap) out(`  ${e.file} ${printable(e.key)}: ${printable(wrapShown(e.name, e.decl, launcher, require))}`);
  for (const e of toRequire) out(`  ${e.file} ${printable(e.key)}: the guard now requires a person's approval of the lock (--require approved)`);
  for (const e of toShorten) out(`  ${e.file} ${printable(e.key)}: now runs plumbline guard (the short form)`);
  const why = launcherSentence(launcher);
  if (why !== undefined) out(why);
  out("Relocking, so the lock covers the edited host files:");
  const code = await relock(root, false, out, deps);
  out(`Commit ${files.join(", ")} with the new lock (the ${files.length === 1 ? "backup is" : "backups are"} yours to delete).`);
  return code;
}
