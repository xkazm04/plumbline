// What a repository's agent is made of, read from the files agent hosts keep: the MCP servers three hosts declare
// (Claude Code `.mcp.json`, Cursor `.cursor/mcp.json`, VS Code `.vscode/mcp.json`), the model ids Claude Code is set to,
// and the repository files a declaration's globs match now. Node: reads the checkout. Reading is not running: nothing
// here starts a server.
//
// Secrets: a host entry's `env` and `headers` hold tokens. Their values are never read, so no Plumbline file can carry
// them: of `headers` only the NAMES are read, and each becomes an `auth` entry naming an environment variable the person
// sets (suggestedAuthVariable). An address with a query string is not declared at all (it may carry a token).
// Files that are never locked, whatever a glob says: anything under `.git`,
// `node_modules` (at any depth), `.plumbline` and `.claude/worktrees`, `.claude/settings.local.json` (a person's own
// settings, often with tokens), and Plumbline's own agent files (the declaration is pinned by its own hash; the lock and
// the approval cannot pin themselves; the committed tool definitions under plumbline.agent.tools are checked against the
// lock's tool hashes instead).
//
// Links (symbolic links, Windows junctions) under a declared glob are followed, to a file or a folder: what they lead to
// is listed under the link's own path, and the link's path is returned so the lock can record it; where it points is
// never returned (it is a path on this machine). Following one reads outside the repository: the files are hashed by
// the caller, their contents go nowhere. A link back into a folder being walked is refused, and one walk reads at most
// MAX_DECLARED_FILES files. Links outside a glob's reach are never touched, and model discovery does not follow
// links at all (a model id is words, not a hash).

import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { countDuplicateKeys } from "../core/json-keys.js";
import { isSafeSubjectPath } from "../core/signed-paths.js";
import { AGENT_APPROVAL_FILE, AGENT_FILE, AGENT_LOCK_FILE, AGENT_PENDING_DIR, AGENT_TOOLS_DIR, type McpServerDecl } from "../core/types.js";
import { CliError } from "../cli/args.js";
import { byPath, globMatch } from "./glob.js";
import { isBlockedAddress } from "../net/address.js";
import { isAuthHeaderName, isEnvName, isHttpsAddress, isModelLabel, isServerName, MAX_AUTH_HEADERS, MODEL_ID_PATTERN } from "./lock.js";

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

/**
 * The most regular files one walk (one `matchFiles`) visits, links followed. Derived from the field trial (2026-11-23):
 * the largest declared tree seen was 85 files through 7 links (bp's `.claude/skills`); 100 times that, rounded up to a
 * round number, is 10,000. Over it the walk stops with a sentence (exit 2) rather than reading a link into somewhere
 * vast without end.
 */
export const MAX_DECLARED_FILES = 10_000;

type Kind = "file" | "dir" | "other" | "none";

/** What a path is, a link followed to what it points at (a dangling link is `none`), and whether it is a link. */
async function kindOf(full: string): Promise<{ kind: Kind; link: boolean }> {
  let s;
  try {
    s = await lstat(full);
  } catch {
    return { kind: "none", link: false };
  }
  if (!s.isSymbolicLink()) return { kind: s.isFile() ? "file" : s.isDirectory() ? "dir" : "other", link: false };
  try {
    const t = await stat(full);
    return { kind: t.isFile() ? "file" : t.isDirectory() ? "dir" : "other", link: true };
  } catch {
    return { kind: "none", link: true };
  }
}

/**
 * One walk's state: whether it follows links, the links it followed (repository paths) and the files it visited, for
 * MAX_DECLARED_FILES.
 */
interface Walk {
  root: string;
  follow: boolean;
  links: Set<string>;
  visited: number;
}

const full = (root: string, rel: string): string => (rel === "" ? root : path.join(root, ...rel.split("/")));
/** Real paths compare without case on Windows (one folder, however it is spelled). */
const realKey = (p: string): string => (process.platform === "win32" ? p.toLowerCase() : p);
/** True when real path `inner` is `outer` or inside it. */
function within(inner: string, outer: string): boolean {
  const i = realKey(inner);
  const o = realKey(outer);
  return i === o || i.startsWith(o.endsWith(path.sep) ? o : o + path.sep);
}

function visit(w: Walk): void {
  if (++w.visited > MAX_DECLARED_FILES) {
    throw new CliError(
      `the declaration's globs reach more than ${MAX_DECLARED_FILES} files, the most one walk reads (100 times the largest agent seen in use): narrow the globs, or remove a link that leads somewhere large`,
    );
  }
}

/**
 * Every regular file under `rel`, pruning what is never locked. A link (symbolic link, Windows junction) is followed:
 * the files under it are listed under the link's path and the link is noted in `w.links`. `stack` holds the real paths
 * of the folders being walked; a link to one of them or to a folder holding one is a cycle and is refused (exit 2). A
 * dangling link has nothing to follow and is passed over.
 */
async function walk(w: Walk, rel: string, stack: readonly string[], out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(full(w.root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  const here = stack[stack.length - 1] as string;
  for (const entry of entries) {
    const child = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (isNeverLocked(child)) continue;
    if (entry.isSymbolicLink()) {
      if (!w.follow) continue;
      const { kind } = await kindOf(full(w.root, child));
      if (kind === "file") {
        visit(w);
        w.links.add(child);
        out.push(child);
      } else if (kind === "dir") {
        const real = await realpath(full(w.root, child));
        if (stack.some((s) => within(s, real))) {
          throw new CliError(
            `${isSafeSubjectPath(child) ? child : `a link under ${rel === "" ? "the repository" : rel}`} is a link to a folder that holds it, so following it would never end: remove the link or narrow the glob`,
          );
        }
        w.links.add(child);
        await walk(w, child, [...stack, real], out);
      }
    } else if (entry.isDirectory()) await walk(w, child, [...stack, path.join(here, entry.name)], out);
    else if (entry.isFile()) {
      visit(w);
      out.push(child);
    }
  }
}

/** Notes every link among the leading segments of `rel` (a glob's literal prefix: readdir follows them). */
async function prefixLinks(w: Walk, rel: string): Promise<void> {
  const segments = rel === "" ? [] : rel.split("/");
  for (let i = 1; i <= segments.length; i++) {
    const at = segments.slice(0, i).join("/");
    if ((await kindOf(full(w.root, at))).link) w.links.add(at);
  }
}

/**
 * Every file under `rel` (a folder, through links), noting the links in `w.links`. A walk that does not follow links
 * lists nothing when `rel` itself is reached through one.
 */
async function walkFrom(w: Walk, rel: string, out: string[]): Promise<void> {
  let real: string;
  try {
    real = await realpath(full(w.root, rel));
  } catch {
    return;
  }
  await prefixLinks(w, rel);
  if (!w.follow && w.links.size > 0) return;
  await walk(w, rel, [real], out);
}

/** The literal segments a glob starts with (before its first segment holding `*`). */
function literalPrefix(glob: string): string[] {
  const segments = glob.split("/");
  const at = segments.findIndex((s) => s.includes("*"));
  return at < 0 ? segments : segments.slice(0, at);
}

export interface Matched {
  /** Repository paths (safe ones only), sorted, each once. A file reached through a link sits under the link's path. */
  paths: string[];
  /**
   * The links followed that lead to at least one path in `paths` (a link to a file is itself one), repository-relative,
   * sorted. Where a link points is never returned.
   */
  links: string[];
  /** The globs that matched at least one file whose name is outside [A-Za-z0-9._/-] (a lock cannot hold it). */
  unsafeGlobs: string[];
  /** How many such files. */
  unsafe: number;
}

/**
 * The repository files the globs match now. Walks only below each glob's literal prefix, following links (at most
 * MAX_DECLARED_FILES files; a link cycle is refused).
 */
export async function matchFiles(root: string, globs: readonly string[]): Promise<Matched> {
  const found = new Set<string>();
  const walked = new Set<string>();
  const w: Walk = { root, follow: true, links: new Set(), visited: 0 };
  for (const glob of globs) {
    const prefix = literalPrefix(glob);
    const rel = prefix.join("/");
    if (prefix.length === glob.split("/").length) {
      // no wildcard: the one file, when it is a regular file (or a link to one)
      if (!isNeverLocked(rel) && (await kindOf(full(root, rel))).kind === "file") {
        await prefixLinks(w, rel);
        found.add(rel);
      }
      continue;
    }
    if (walked.has(rel) || (rel !== "" && isNeverLocked(rel))) continue;
    walked.add(rel);
    const files: string[] = [];
    await walkFrom(w, rel, files);
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
  const links = [...w.links].filter((l) => paths.some((p) => p === l || p.startsWith(`${l}/`)));
  return { paths: paths.sort(byPath), links: links.sort(byPath), unsafeGlobs: [...unsafeGlobs].sort(byPath), unsafe };
}

/** The DEFAULT_FILES that exist in the repository now (a glob when its directory does), links followed. */
export async function defaultGlobs(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const glob of DEFAULT_FILES) {
    const prefix = literalPrefix(glob);
    const { kind } = await kindOf(full(root, prefix.join("/")));
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

/** The environment variable init suggests for one auth header: `PLUMBLINE_<SERVER>_<HEADER>`, upper-case, every other character `_`. */
export function suggestedAuthVariable(server: string, header: string): string {
  return `PLUMBLINE_${server}_${header}`.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

/** Why a host entry's address is not declared (fixed words), or undefined when it is declared. */
export function addressSkipReason(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "its address is not a URL";
  }
  if (parsed.username !== "" || parsed.password !== "") return "its address carries credentials (a user name or password)";
  const host = parsed.hostname.startsWith("[") ? parsed.hostname.slice(1, -1) : parsed.hostname;
  const name = host.toLowerCase().replace(/\.$/, "");
  if (name === "localhost" || name.endsWith(".localhost") || ((/^[0-9.]+$/.test(name) || name.includes(":")) && isBlockedAddress(name))) {
    return "it is a local address (your own server): not locked";
  }
  if (parsed.protocol !== "https:" || !isHttpsAddress(url)) return "its address is not https";
  if (parsed.search !== "" || url.includes("?")) {
    return "its address has a query string, which may carry a token: move the key into the entry's headers, which init declares as auth (a header whose value comes from an environment variable)";
  }
  return undefined;
}

/** The header NAMES of an http entry's `headers` (values never read), or why they cannot be declared as auth. */
function headerNames(headers: unknown): { names: string[] } | { why: string } {
  if (headers === undefined) return { names: [] };
  if (!isObject(headers)) return { why: "its headers are not an object" };
  const names = Object.keys(headers);
  if (names.length > MAX_AUTH_HEADERS) return { why: `it sends more than ${MAX_AUTH_HEADERS} headers` };
  if (!names.every(isAuthHeaderName)) return { why: "it sends a header Plumbline does not send as auth (a protocol, cookie or hop-by-hop header, or not a header name)" };
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) return { why: "it names one header twice" };
  return { names };
}

/**
 * A host entry as a declaration, or why not. Never reads `env`, nor a value of `headers` (`headers` is the http entry's
 * header names, declared as `auth` once the server's name is known).
 */
function entryDecl(entry: unknown): { decl: McpServerDecl; wrapped: boolean; sse: boolean; headers: string[] } | { why: string } {
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
    return { decl, wrapped: inner !== undefined, sse: false, headers: [] };
  }
  if (typeof entry.url === "string" && (type === undefined || type === "http" || type === "sse" || type === "streamable-http")) {
    const why = addressSkipReason(entry.url);
    if (why !== undefined) return { why };
    const headers = headerNames(entry.headers);
    if ("why" in headers) return headers;
    return { decl: { transport: "http", url: entry.url }, wrapped: false, sse: type === "sse", headers: headers.names };
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
  const raw: (HostServer & { headers: string[] })[] = [];
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
  for (const { headers, ...s } of raw) {
    const clash = (targets.get(s.key)?.size ?? 0) > 1;
    const name = clash ? `${s.host}:${s.key}` : s.key;
    if (!isServerName(name)) {
      skipped.push({ host: s.host, file: s.file, name: s.key, why: "its name is outside [A-Za-z0-9._-] (rename it in the host file to declare it)" });
      continue;
    }
    if (headers.length > 0 && s.decl.transport === "http") {
      const auth = Object.fromEntries(headers.map((h) => [h, suggestedAuthVariable(name, h)]));
      if (!Object.values(auth).every(isEnvName)) {
        skipped.push({ host: s.host, file: s.file, name: s.key, why: "the environment variable names its headers would take run past 128 characters (shorten its name or its header names)" });
        continue;
      }
      s.decl = { ...s.decl, auth };
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
  // links are not followed here: a model id read through one would copy words from outside the repository into the
  // declaration (a linked agent file is still locked by its hash when a glob matches it)
  const agents: string[] = [];
  await walkFrom({ root, follow: false, links: new Set(), visited: 0 }, ".claude/agents", agents);
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
