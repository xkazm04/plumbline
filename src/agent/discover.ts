// What a repository's agent is made of, read from the files agent hosts keep: the MCP servers three hosts declare
// (Claude Code `.mcp.json`, Cursor `.cursor/mcp.json`, VS Code `.vscode/mcp.json`), the model ids Claude Code is set to,
// and the repository files a declaration's globs match now. Node: reads the checkout. Reading is not running: nothing
// here starts a server.
//
// Secrets: a host entry's `env` and `headers` hold tokens. They are never copied into anything this module returns, so
// no Plumbline file can carry them. Files that are never locked, whatever a glob says: anything under `.git`,
// `node_modules` (at any depth), `.plumbline` and `.claude/worktrees`, `.claude/settings.local.json` (a person's own
// settings, often with tokens), and Plumbline's own agent files (the declaration is pinned by its own hash; the lock and
// the approval cannot pin themselves; the committed tool definitions under plumbline.agent.tools are checked against the
// lock's tool hashes instead). Symbolic links are not followed: a declared file replaced by a link reads as
// removed.

import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { countDuplicateKeys } from "../core/json-keys.js";
import { isSafeSubjectPath } from "../core/signed-paths.js";
import { AGENT_APPROVAL_FILE, AGENT_FILE, AGENT_LOCK_FILE, AGENT_PENDING_DIR, AGENT_TOOLS_DIR, type McpServerDecl } from "../core/types.js";
import { CliError } from "../cli/args.js";
import { byPath, globMatch } from "./glob.js";
import { isHttpsAddress, isModelLabel, isServerName, MODEL_ID_PATTERN } from "./lock.js";

/** The hosts whose MCP config is read, with the file each keeps it in and the member that holds the servers. */
export const HOSTS = [
  { host: "claude", file: ".mcp.json", member: "mcpServers" },
  { host: "cursor", file: ".cursor/mcp.json", member: "mcpServers" },
  { host: "vscode", file: ".vscode/mcp.json", member: "servers" },
] as const;
export type HostName = (typeof HOSTS)[number]["host"];

/** The files `agent init` declares by default, each only when it exists (a directory glob: when the directory does). */
export const DEFAULT_FILES = [
  "CLAUDE.md",
  "AGENTS.md",
  ".mcp.json",
  ".cursor/mcp.json",
  ".vscode/mcp.json",
  ".claude/settings.json",
  ".claude/agents/**",
  ".claude/commands/**",
  ".claude/skills/**",
] as const;

/** Directories never walked, at any depth. */
const NEVER_DIRS = new Set([".git", "node_modules"]);
/** Repository paths never locked, with everything under them. */
const NEVER_UNDER = [".plumbline", ".claude/worktrees", AGENT_PENDING_DIR, AGENT_TOOLS_DIR];
/** Repository paths never locked. */
const NEVER_FILES = new Set([".claude/settings.local.json", AGENT_FILE, AGENT_LOCK_FILE, AGENT_APPROVAL_FILE]);

/** True for a repository path no lock holds, whatever the declaration's globs say. */
export function isNeverLocked(rel: string): boolean {
  if (NEVER_FILES.has(rel)) return true;
  if (rel.split("/").some((s) => NEVER_DIRS.has(s))) return true;
  return NEVER_UNDER.some((d) => rel === d || rel.startsWith(`${d}/`));
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

async function kindOf(full: string): Promise<"file" | "dir" | "other" | "none"> {
  try {
    const s = await lstat(full);
    return s.isFile() ? "file" : s.isDirectory() ? "dir" : "other";
  } catch {
    return "none";
  }
}

/** Every regular file under `dir` (repository-relative `rel`), pruning what is never locked. */
async function walk(root: string, rel: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(rel === "" ? root : path.join(root, ...rel.split("/")), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const child = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (isNeverLocked(child)) continue;
    if (entry.isDirectory()) await walk(root, child, out);
    else if (entry.isFile()) out.push(child);
  }
}

/** The literal segments a glob starts with (before its first segment holding `*`). */
function literalPrefix(glob: string): string[] {
  const segments = glob.split("/");
  const at = segments.findIndex((s) => s.includes("*"));
  return at < 0 ? segments : segments.slice(0, at);
}

export interface Matched {
  /** Repository paths (safe ones only), sorted, each once. */
  paths: string[];
  /** The globs that matched at least one file whose name is outside [A-Za-z0-9._/-] (a lock cannot hold it). */
  unsafeGlobs: string[];
  /** How many such files. */
  unsafe: number;
}

/** The repository files the globs match now. Walks only below each glob's literal prefix. */
export async function matchFiles(root: string, globs: readonly string[]): Promise<Matched> {
  const found = new Set<string>();
  const walked = new Set<string>();
  for (const glob of globs) {
    const prefix = literalPrefix(glob);
    const rel = prefix.join("/");
    if (prefix.length === glob.split("/").length) {
      // no wildcard: the one file, when it is a regular file
      if (!isNeverLocked(rel) && (await kindOf(path.join(root, ...prefix))) === "file") found.add(rel);
      continue;
    }
    if (walked.has(rel) || (rel !== "" && isNeverLocked(rel))) continue;
    walked.add(rel);
    const files: string[] = [];
    await walk(root, rel, files);
    for (const f of files) found.add(f);
  }
  const paths: string[] = [];
  const unsafeGlobs = new Set<string>();
  let unsafe = 0;
  for (const f of found) {
    const by = globs.filter((g) => globMatch(g, f));
    if (by.length === 0) continue;
    if (isSafeSubjectPath(f)) paths.push(f);
    else {
      unsafe++;
      for (const g of by) unsafeGlobs.add(g);
    }
  }
  return { paths: paths.sort(byPath), unsafeGlobs: [...unsafeGlobs].sort(byPath), unsafe };
}

/** The DEFAULT_FILES that exist in the repository now (a glob when its directory does). */
export async function defaultGlobs(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const glob of DEFAULT_FILES) {
    const prefix = literalPrefix(glob);
    const kind = await kindOf(path.join(root, ...prefix));
    if (glob.includes("*") ? kind === "dir" : kind === "file") out.push(glob);
  }
  return out;
}

// ---- host configs ----

/** One server a host's config declares, as it will be declared, and what the host file says of it. */
export interface HostServer {
  host: HostName;
  /** The host file (repository-relative). */
  file: string;
  /** The key in the host file (a repository's own word: shown only in the caller's terminal, through printable). */
  key: string;
  /** The name it is declared under: `key`, or `<host>:<key>` when two hosts use the key for different targets. */
  name: string;
  decl: McpServerDecl;
  /** The host entry already runs the guard (`plumbline guard ... -- <command>`, or the absolute form); `decl` is the command it guards. */
  wrapped: boolean;
  /** The host said `sse`: declared as `http` (Streamable HTTP), which is what Plumbline reads. */
  sse: boolean;
}

/** A host entry that is not declared, and why (fixed words). */
export interface SkippedServer {
  host: HostName;
  file: string;
  name: string;
  why: string;
}

export interface HostConfig {
  host: HostName;
  file: string;
  /** The parsed file, for --wrap to edit. */
  json: Record<string, unknown>;
  member: string;
}

export interface HostDiscovery {
  configs: HostConfig[];
  /** One per declared name (a server two hosts both declare is listed once). */
  servers: HostServer[];
  /** Every host entry that is declared, in every host file (what --wrap edits). */
  entries: HostServer[];
  skipped: SkippedServer[];
}

/** A node executable as process.execPath names it (`node`, `nodejs`, `node.exe`), in any folder. */
const NODE_EXECUTABLE = /^node(?:js)?(?:\.exe)?$/i;
/** The CLI entry the absolute form runs (src/cli/agent-wrap.ts, cliEntry): `.../dist/cli/index.js`, either separator. */
const CLI_ENTRY = /(?:^|[\\/])dist[\\/]cli[\\/]index\.js$/;

/**
 * How a host entry runs the guard: `short` (`plumbline guard ...`), `absolute` (`<node> <.../dist/cli/index.js> guard
 * ...`, what --wrap writes when `plumbline` is not on PATH), or undefined when it does not run the guard.
 */
export function guardForm(command: string, args: readonly string[]): "short" | "absolute" | undefined {
  if (command === "plumbline" && args[0] === "guard") return "short";
  const base = command.split(/[\\/]/).pop() ?? "";
  if (NODE_EXECUTABLE.test(base) && typeof args[0] === "string" && CLI_ENTRY.test(args[0]) && args[1] === "guard") return "absolute";
  return undefined;
}

/** The command a guard-wrapped entry (either form) guards, or undefined when the entry is not wrapped. */
export function unwrapGuard(command: string, args: readonly string[]): { command: string; args: string[] } | undefined {
  if (guardForm(command, args) === undefined) return undefined;
  const dash = args.indexOf("--");
  if (dash < 0 || dash + 1 >= args.length) return undefined;
  return { command: args[dash + 1] as string, args: args.slice(dash + 2) };
}

/** A host entry as a declaration, or why not. Never reads `env` or `headers`. */
function entryDecl(entry: unknown): { decl: McpServerDecl; wrapped: boolean; sse: boolean } | { why: string } {
  if (!isObject(entry)) return { why: "its entry is not an object" };
  const type = entry.type;
  if (typeof entry.command === "string" && (type === undefined || type === "stdio")) {
    if (entry.command === "") return { why: "its command is empty" };
    let args: string[] | undefined;
    if (entry.args !== undefined) {
      if (!Array.isArray(entry.args) || !entry.args.every((a) => typeof a === "string")) return { why: "its args are not a list of strings" };
      args = entry.args as string[];
    }
    const inner = unwrapGuard(entry.command, args ?? []);
    const command = inner?.command ?? entry.command;
    const runArgs = inner?.args ?? args ?? [];
    // args are omitted when there are none, so `"args": []` and no args are one target (serverTarget)
    const decl: McpServerDecl = runArgs.length > 0 ? { transport: "stdio", command, args: runArgs } : { transport: "stdio", command };
    return { decl, wrapped: inner !== undefined, sse: false };
  }
  if (typeof entry.url === "string" && (type === undefined || type === "http" || type === "sse" || type === "streamable-http")) {
    if (!isHttpsAddress(entry.url)) return { why: "its address is not https (or carries credentials)" };
    return { decl: { transport: "http", url: entry.url }, wrapped: false, sse: type === "sse" };
  }
  return { why: "it is neither a command nor an address Plumbline reads" };
}

/** Reads a JSON file of the repository's own, or undefined when absent. Not JSON or a repeated key: exit 2. */
export async function readRepoJson(root: string, rel: string): Promise<Record<string, unknown> | undefined> {
  let text: string;
  try {
    text = await readFile(path.join(root, ...rel.split("/")), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new CliError(`${rel} could not be read`);
  }
  const body = text.replace(/^﻿/, "");
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new CliError(`${rel} is not JSON (comments are not read): fix it, then run this again`);
  }
  if (countDuplicateKeys(body) > 0) throw new CliError(`${rel} repeats a key inside one object, so hosts may read it differently: fix it, then run this again`);
  if (!isObject(value)) throw new CliError(`${rel} is not a JSON object`);
  return value;
}

/** Every server the three hosts' configs declare. A name used by two hosts for different targets is kept under `<host>:<name>`. */
export async function discoverHosts(root: string, target: (decl: McpServerDecl) => Promise<string>): Promise<HostDiscovery> {
  const configs: HostConfig[] = [];
  const raw: HostServer[] = [];
  const skipped: SkippedServer[] = [];
  for (const { host, file, member } of HOSTS) {
    const json = await readRepoJson(root, file);
    if (json === undefined) continue;
    configs.push({ host, file, json, member });
    const servers = json[member];
    if (servers === undefined) continue;
    if (!isObject(servers)) throw new CliError(`${file}: ${member} is not an object`);
    for (const [name, entry] of Object.entries(servers)) {
      const read = entryDecl(entry);
      if ("why" in read) skipped.push({ host, file, name, why: read.why });
      else raw.push({ host, file, key: name, name, ...read });
    }
  }
  // a name two hosts use: one entry when every host means the same server, `<host>:<name>` each when they differ
  const targets = new Map<string, Set<string>>();
  for (const s of raw) {
    const set = targets.get(s.name) ?? new Set<string>();
    set.add(await target(s.decl));
    targets.set(s.name, set);
  }
  const servers: HostServer[] = [];
  const entries: HostServer[] = [];
  const declared = new Set<string>();
  for (const s of raw) {
    const clash = (targets.get(s.key)?.size ?? 0) > 1;
    const name = clash ? `${s.host}:${s.key}` : s.key;
    if (!isServerName(name)) {
      skipped.push({ host: s.host, file: s.file, name: s.key, why: "its name is outside [A-Za-z0-9._-] (rename it in the host file to declare it)" });
      continue;
    }
    entries.push({ ...s, name });
    if (declared.has(name)) continue; // the same server in a second host
    declared.add(name);
    servers.push({ ...s, name });
  }
  return { configs, servers, entries, skipped };
}

// ---- models ----

export interface ModelDiscovery {
  models: Record<string, string>;
  /** Agent files whose model could not be declared (a label or id outside its pattern), by repository path. */
  skipped: string[];
}

/** The `model:` of a markdown file's front matter, when it has one. */
export function frontMatterModel(text: string): string | undefined {
  const body = text.replace(/^﻿/, "");
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(body);
  if (m === null) return undefined;
  for (const line of (m[1] as string).split(/\r?\n/)) {
    const kv = /^model\s*:\s*(.*?)\s*$/.exec(line);
    if (kv === null) continue;
    let value = kv[1] as string;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return value === "" ? undefined : value;
  }
  return undefined;
}

/** `.claude/settings.json` `model` as label `default`; each `.claude/agents/<name>.md` front matter `model:` as `<name>`. */
export async function discoverModels(root: string): Promise<ModelDiscovery> {
  const models: Record<string, string> = {};
  const skipped: string[] = [];
  const settings = await readRepoJson(root, ".claude/settings.json");
  if (settings !== undefined && typeof settings.model === "string") {
    if (MODEL_ID_PATTERN.test(settings.model)) models.default = settings.model;
    else skipped.push(".claude/settings.json");
  }
  const agents: string[] = [];
  await walk(root, ".claude/agents", agents);
  for (const rel of agents.sort(byPath)) {
    if (!rel.endsWith(".md")) continue;
    let text: string;
    try {
      text = await readFile(path.join(root, ...rel.split("/")), "utf8");
    } catch {
      continue;
    }
    const model = frontMatterModel(text);
    if (model === undefined) continue;
    const label = path.posix.basename(rel, ".md");
    if (!isModelLabel(label) || !MODEL_ID_PATTERN.test(model) || Object.hasOwn(models, label)) {
      if (isSafeSubjectPath(rel)) skipped.push(rel);
      continue;
    }
    models[label] = model;
  }
  return { models, skipped };
}
