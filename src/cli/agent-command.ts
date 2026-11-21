// plumbline agent init [--root <dir>] [--wrap] [--json]
// plumbline agent check [--root <dir>] [--approvers <file>] [--offline] [--json]
// plumbline agent relock [--root <dir>] [--json]
// The agent lock (docs/agent-lock.md): `init` declares what the repository's agent is made of (plumbline.agent.json) from
// the agent hosts' files and writes the first lock; `check` reports what changed since the lock and whether the lock is
// approved; `relock` rebuilds the lock after a person reviewed the change, chained to the one it replaces.
// Exit 0: init or relock wrote; check found nothing of severity warn or block. 1: check found something (an absent or
// unusable lock is never clean). 2: usage or I/O error, or a refusal (init over an existing declaration, relock with
// no lock).
//
// Words: findings are counts and fixed phrases. Names from the caller's own repository (paths, server names, the host
// entries init declares or wraps, and the tool names relock lists from the guard's pending files) are shown only in the
// caller's terminal, through printable; a remote server's tool names are never printed.

import { existsSync } from "node:fs";
import { copyFile, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { serverTarget } from "../core/agent-tools.js";
import {
  AGENT_APPROVAL_FILE,
  AGENT_FILE,
  AGENT_FORMAT_VERSION,
  AGENT_LOCK_FILE,
  AGENT_TYPE,
  type AgentDeclaration,
  type AgentLock,
  type AgentReport,
  type McpServerDecl,
} from "../core/types.js";
import { buildLock, hashDeclaredFiles, lockText, repoPath, type AgentDeps, type ServerChange } from "../agent/build.js";
import { checkAgent, readBytesIfPresent, reportExit } from "../agent/check.js";
import { defaultGlobs, discoverHosts, discoverModels, type HostDiscovery, type HostServer } from "../agent/discover.js";
import { byPath } from "../agent/glob.js";
import { parseAgentLock, parseDeclaration } from "../agent/lock.js";
import { listMcpTools } from "../net/mcp-http.js";
import { safeFetch } from "../net/safe-fetch.js";
import { CliError, parseArgs, UsageError } from "./args.js";
import type { Out } from "./commands.js";
import { printable } from "./diff-command.js";

export const AGENT_USAGE =
  "usage: plumbline agent init [--root <dir>] [--wrap] [--json]\n" +
  "       plumbline agent check [--root <dir>] [--approvers <file>] [--offline] [--json]\n" +
  "       plumbline agent relock [--root <dir>] [--json]";

/** The suffix of the copy --wrap keeps of each host file it edits. */
export const BACKUP_SUFFIX = ".plumbline-backup";
/** The line init adds to .gitignore (the guard's pending files are local, never committed). */
export const GITIGNORE_LINE = ".plumbline/";

/** The production dependencies: the guarded MCP lister and fetch, the clock and the environment. */
export function defaultDeps(): AgentDeps {
  return { lister: (url) => listMcpTools(url), fetcher: safeFetch, now: new Date(), env: process.env };
}

export async function runAgentCommand(argv: string[], out: Out): Promise<number> {
  return runAgent(argv, out, defaultDeps());
}

/** The command with its dependencies given (tests inject the lister, the fetcher, the clock and the environment). */
export async function runAgent(argv: string[], out: Out, deps: AgentDeps): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === "init") {
    const args = parseArgs(rest, ["root"], ["wrap"]);
    return init(rootOf(args.values.get("root")), args.flags.has("wrap"), args.json, out, deps);
  }
  if (sub === "check") {
    const args = parseArgs(rest, ["root", "approvers"], ["offline"]);
    const approvers = args.values.get("approvers");
    const report = await checkAgent(rootOf(args.values.get("root")), { offline: args.flags.has("offline"), ...(approvers !== undefined ? { approvers } : {}) }, deps);
    printReport(report, args.json, args.flags.has("offline"), out);
    return reportExit(report);
  }
  if (sub === "relock") {
    const args = parseArgs(rest, ["root"]);
    return relock(rootOf(args.values.get("root")), args.json, out, deps);
  }
  throw new UsageError("agent takes init, check or relock");
}

function rootOf(given: string | undefined): string {
  const root = path.resolve(given ?? ".");
  if (!existsSync(root)) throw new CliError("--root is not a folder that exists");
  return root;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const jsonText = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

// ---- init ----

/** The host entry that runs the guard in front of a stdio server (env and every other member kept as they were). */
export function wrappedEntry(entry: Record<string, unknown>, name: string, decl: Extract<McpServerDecl, { transport: "stdio" }>): Record<string, unknown> {
  return { ...entry, command: "plumbline", args: ["guard", "--lock", AGENT_LOCK_FILE, "--server", name, "--", decl.command, ...(decl.args ?? [])] };
}

/** The member of a host file that --wrap replaces, as shown: command and args only (env is never printed). */
const wrapShown = (name: string, decl: Extract<McpServerDecl, { transport: "stdio" }>): string =>
  JSON.stringify({ command: "plumbline", args: ["guard", "--lock", AGENT_LOCK_FILE, "--server", name, "--", decl.command, ...(decl.args ?? [])] });

async function init(root: string, wrap: boolean, json: boolean, out: Out, deps: AgentDeps): Promise<number> {
  if (existsSync(repoPath(root, AGENT_FILE))) throw new CliError(`${AGENT_FILE} exists: edit it, then plumbline agent relock`);
  if (existsSync(repoPath(root, AGENT_LOCK_FILE))) throw new CliError(`${AGENT_LOCK_FILE} exists without ${AGENT_FILE}: restore the declaration, then plumbline agent relock`);

  const hosts = await discoverHosts(root, serverTarget);
  const models = await discoverModels(root);
  const files = await defaultGlobs(root);
  const mcp: Record<string, McpServerDecl> = {};
  for (const s of [...hosts.servers].sort((a, b) => byPath(a.name, b.name))) mcp[s.name] = s.decl;
  const declaration: AgentDeclaration = {
    type: AGENT_TYPE,
    version: AGENT_FORMAT_VERSION,
    files,
    ...(Object.keys(models.models).length > 0 ? { models: models.models } : {}),
    ...(Object.keys(mcp).length > 0 ? { mcp } : {}),
  };
  const declarationText = jsonText(declaration);
  const check = parseDeclaration(declarationText);
  if (!check.ok) throw new CliError(`the declaration init built is not one (${check.problem}); please report this`);
  // refuse before anything is written: a declared file a lock cannot name
  await hashDeclaredFiles(root, files);

  const toWrap = hosts.entries.filter((e): e is HostServer & { decl: Extract<McpServerDecl, { transport: "stdio" }> } => e.decl.transport === "stdio" && !e.wrapped);
  const wrapFiles = [...new Set(toWrap.map((e) => e.file))].sort(byPath);
  if (wrap) {
    for (const file of wrapFiles) {
      if (existsSync(repoPath(root, file + BACKUP_SUFFIX))) throw new CliError(`${file}${BACKUP_SUFFIX} exists: move it away first, so the earlier copy is not lost`);
    }
    await applyWrap(root, hosts, toWrap);
  }

  const declarationBytes = new TextEncoder().encode(declarationText);
  const built = await buildLock(root, declaration, declarationBytes, deps);
  await writeFile(repoPath(root, AGENT_FILE), declarationText);
  await writeFile(repoPath(root, AGENT_LOCK_FILE), lockText(built.lock));
  const gitignored = await ensureGitignore(root);

  const stdio = hosts.servers.filter((s) => s.decl.transport === "stdio");
  const http = hosts.servers.filter((s) => s.decl.transport === "http");
  const counts = { stdio: stdio.length, http: http.length, files: Object.keys(built.lock.files).length, models: Object.keys(models.models).length, peers: 0 };
  if (json) {
    out(
      JSON.stringify({
        written: [AGENT_FILE, AGENT_LOCK_FILE],
        counts,
        declaration,
        wrapped: wrap ? wrapFiles : [],
        wrap: toWrap.map((e) => ({ file: e.file, server: printable(e.key), entry: JSON.parse(wrapShown(e.name, e.decl)) as unknown })),
        alreadyWrapped: hosts.entries.filter((e) => e.wrapped).map((e) => ({ file: e.file, server: printable(e.key) })),
        sse: hosts.entries.filter((e) => e.sse).map((e) => ({ file: e.file, server: printable(e.key) })),
        skipped: hosts.skipped.map((s) => ({ file: s.file, server: printable(s.name), why: s.why })),
        modelsSkipped: models.skipped,
        gitignore: gitignored,
        findings: built.findings,
      }),
    );
    return 0;
  }
  out(`Locked: ${plural(counts.stdio + counts.http, "MCP server")} (${counts.stdio} stdio, ${counts.http} http), ${plural(counts.files, "file")}, ${plural(counts.models, "model")}, ${plural(counts.peers, "peer")}.`);
  out(`Wrote ${AGENT_FILE} (the declaration: edit it to add or remove what the agent is made of) and ${AGENT_LOCK_FILE} (the first lock).`);
  for (const e of hosts.entries.filter((x) => x.sse)) out(`${e.file}: ${printable(e.key)} is an SSE server; it is declared as http (Streamable HTTP), which is what Plumbline reads.`);
  for (const e of hosts.entries.filter((x) => x.name !== x.key)) out(`${e.file}: ${printable(e.key)} names a different server in another host, so it is declared as ${printable(e.name)}.`);
  for (const s of hosts.skipped) out(`${s.file}: ${printable(s.name)} is not declared: ${s.why}.`);
  for (const rel of models.skipped) out(`${rel}: its model is not declared (a label or id Plumbline does not read); add it to ${AGENT_FILE} by hand if it matters.`);
  for (const f of built.findings) out(`[${f.severity}] ${f.code} ${printable(f.ref)}: ${f.summary}`);
  if (gitignored) out(`Added ${GITIGNORE_LINE} to .gitignore (the guard's local observations are never committed).`);
  out(`${plural(stdio.length, "stdio server")} will be observed by the guard.`);
  for (const e of hosts.entries.filter((x) => x.wrapped)) out(`${e.file}: ${printable(e.key)} already runs the guard.`);
  if (toWrap.length > 0) {
    if (wrap) out(`Put the guard in front of ${plural(toWrap.length, "stdio server")}; the earlier ${plural(wrapFiles.length, "file")} kept as ${wrapFiles.map((f) => f + BACKUP_SUFFIX).join(", ")}:`);
    else out(`To put the guard in front of ${toWrap.length === 1 ? "it" : "them"}, run again with --wrap (after removing ${AGENT_FILE} and ${AGENT_LOCK_FILE}), or change each entry yourself (env stays as it is):`);
    for (const e of toWrap) out(`  ${e.file} ${printable(e.key)}: ${printable(wrapShown(e.name, e.decl))}`);
  }
  const commit = [AGENT_FILE, AGENT_LOCK_FILE, ...(gitignored ? [".gitignore"] : []), ...(wrap ? wrapFiles : [])];
  out(`Next: approve the lock (plumbline approve --key <your key file>), then commit ${commit.join(", ")} and ${AGENT_APPROVAL_FILE}.`);
  return 0;
}

async function applyWrap(root: string, hosts: HostDiscovery, toWrap: readonly (HostServer & { decl: Extract<McpServerDecl, { transport: "stdio" }> })[]): Promise<void> {
  for (const config of hosts.configs) {
    const mine = toWrap.filter((e) => e.file === config.file);
    if (mine.length === 0) continue;
    const full = repoPath(root, config.file);
    await copyFile(full, full + BACKUP_SUFFIX);
    const servers = config.json[config.member] as Record<string, Record<string, unknown>>;
    for (const e of mine) servers[e.key] = wrappedEntry(servers[e.key] as Record<string, unknown>, e.name, e.decl);
    await writeFile(full, jsonText(config.json));
  }
}

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

// ---- check ----

function printReport(report: AgentReport, json: boolean, offline: boolean, out: Out): void {
  if (json) {
    out(JSON.stringify(report));
    return;
  }
  const shown = report.findings.filter((f) => f.severity !== "info");
  for (const f of shown) out(`[${f.severity}] ${f.code} ${printable(f.ref)}: ${f.summary}`);
  const skipped = report.findings.filter((f) => f.severity === "info");
  if (offline) {
    const servers = skipped.filter((f) => f.code === "server-unreachable").length;
    const peers = skipped.filter((f) => f.code === "peer-unreachable").length;
    out(`Offline: ${plural(servers, "MCP server")} over HTTP and ${plural(peers, "A2A peer")} were not contacted, so their tools and cards were not checked.`);
  }
  const approval =
    report.approval === "verified" && report.approvedBy !== undefined
      ? `Approval: verified, by ${printable(report.approvedBy.label)} (${report.approvedBy.kid}).`
      : `Approval: ${report.approval}.`;
  out(approval);
  const blocks = report.findings.filter((f) => f.severity === "block").length;
  const warns = report.findings.filter((f) => f.severity === "warn").length;
  if (blocks + warns === 0) {
    out("The agent matches its approved lock.");
    return;
  }
  out(`${plural(blocks, "change")} to block, ${plural(warns, "warning")}.`);
  const codes = new Set(report.findings.map((f) => f.code));
  if (codes.has("lock-absent")) out("Next: plumbline agent init, then plumbline approve --key <your key file>.");
  else if (codes.has("lock-unusable")) out(`Next: restore ${AGENT_LOCK_FILE} from version control, then run this again.`);
  else if (report.findings.every((f) => f.severity === "info" || ["lock-unapproved", "approval-invalid", "approval-unverifiable", "server-not-observed"].includes(f.code))) {
    out("Next: a person reviews the lock and approves it (plumbline approve --key <your key file>); a stdio server not yet observed is locked after the guard has run it (plumbline agent relock).");
  } else out("Next: review what changed; if it is intended, plumbline agent relock, then a person approves the new lock (plumbline approve --key <your key file>).");
}

// ---- relock ----

interface FilesDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

function filesDiff(before: Record<string, string>, after: Record<string, string>): FilesDiff {
  return {
    added: Object.keys(after).filter((k) => !Object.hasOwn(before, k)).sort(byPath),
    removed: Object.keys(before).filter((k) => !Object.hasOwn(after, k)).sort(byPath),
    changed: Object.keys(after).filter((k) => Object.hasOwn(before, k) && before[k] !== after[k]).sort(byPath),
  };
}

function modelsDiff(before: Record<string, string>, after: Record<string, string>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => before[k] !== after[k]).sort(byPath);
}

async function relock(root: string, json: boolean, out: Out, deps: AgentDeps): Promise<number> {
  const lockBytes = await readBytesIfPresent(root, AGENT_LOCK_FILE);
  if (lockBytes === undefined) throw new CliError("there is no agent lock: run plumbline agent init");
  const parsedLock = parseAgentLock(new TextDecoder().decode(lockBytes));
  if (!parsedLock.ok) throw new CliError(`the agent lock cannot be used (${parsedLock.problem}): restore it from version control, then run this again`);
  const declarationBytes = await readBytesIfPresent(root, AGENT_FILE);
  if (declarationBytes === undefined) throw new CliError(`there is no ${AGENT_FILE}: restore it, then run this again`);
  const parsed = parseDeclaration(new TextDecoder().decode(declarationBytes));
  if (!parsed.ok) throw new CliError(`${AGENT_FILE} cannot be read (${parsed.problem}): fix it, then run this again`);

  const old: AgentLock = parsedLock.value;
  const built = await buildLock(root, parsed.value, declarationBytes, deps, { lock: old, bytes: lockBytes });
  await writeFile(repoPath(root, AGENT_LOCK_FILE), lockText(built.lock));
  let approvalRemoved = false;
  if (existsSync(repoPath(root, AGENT_APPROVAL_FILE))) {
    await rm(repoPath(root, AGENT_APPROVAL_FILE));
    approvalRemoved = true;
  }

  const files = filesDiff(old.files, built.lock.files);
  const models = modelsDiff(old.models ?? {}, built.lock.models ?? {});
  const serversAdded = Object.keys(built.lock.mcp ?? {}).filter((k) => !Object.hasOwn(old.mcp ?? {}, k)).sort(byPath);
  const serversRemoved = Object.keys(old.mcp ?? {}).filter((k) => !Object.hasOwn(built.lock.mcp ?? {}, k)).sort(byPath);
  const peersAdded = Object.keys(built.lock.peers ?? {}).filter((k) => !Object.hasOwn(old.peers ?? {}, k)).sort(byPath);
  const peersRemoved = Object.keys(old.peers ?? {}).filter((k) => !Object.hasOwn(built.lock.peers ?? {}, k)).sort(byPath);
  const peersChanged = Object.keys(built.lock.peers ?? {}).filter((k) => old.peers?.[k] !== undefined && old.peers[k]!.sha256 !== built.lock.peers![k]!.sha256).sort(byPath);
  const shownServers = built.servers.map((s) => ({ ...s, ...(s.addedNames ? { addedNames: s.addedNames.map(printable) } : {}), ...(s.changedNames ? { changedNames: s.changedNames.map(printable) } : {}) }));
  if (json) {
    out(
      JSON.stringify({
        written: AGENT_LOCK_FILE,
        previous: built.lock.previous,
        declarationChanged: old.declaration !== built.lock.declaration,
        files,
        models,
        servers: { added: serversAdded, removed: serversRemoved, tools: shownServers },
        peers: { added: peersAdded, removed: peersRemoved, changed: peersChanged },
        approvalRemoved,
        findings: built.findings,
      }),
    );
    return 0;
  }
  out(`Wrote ${AGENT_LOCK_FILE}; it names the lock it replaces (previous ${built.lock.previous?.slice(0, 12)}).`);
  if (old.declaration !== built.lock.declaration) out(`${AGENT_FILE} changed since the last lock.`);
  for (const rel of files.added) out(`  file added: ${rel}`);
  for (const rel of files.removed) out(`  file removed: ${rel}`);
  for (const rel of files.changed) out(`  file changed: ${rel}`);
  for (const label of models) out(`  model: ${label}`);
  for (const name of serversAdded) out(`  server added: ${name}`);
  for (const name of serversRemoved) out(`  server removed: ${name}`);
  for (const s of shownServers) out(serverLine(s));
  for (const url of peersAdded) out(`  peer added: ${printable(url)}`);
  for (const url of peersRemoved) out(`  peer removed: ${printable(url)}`);
  for (const url of peersChanged) out(`  peer changed: ${printable(url)}`);
  for (const f of built.findings) out(`[${f.severity}] ${f.code} ${printable(f.ref)}: ${f.summary}`);
  if (approvalRemoved) out(`Removed ${AGENT_APPROVAL_FILE}: the approval covered the old lock; approve the new one.`);
  out(`Next: a person reviews the change list, approves the new lock (plumbline approve --key <your key file>), then commits ${AGENT_LOCK_FILE} and ${AGENT_APPROVAL_FILE}.`);
  return 0;
}

const SOURCE_WORDS: Record<ServerChange["source"], string> = {
  pending: "from what the guard saw",
  listed: "listed now",
  kept: "kept from the earlier lock",
  none: "not yet observed",
};

function serverLine(s: ServerChange): string {
  const base = `  server ${s.server} (${SOURCE_WORDS[s.source]}): tools ${s.added} added, ${s.removed} removed, ${s.changed} changed`;
  const names = [
    ...(s.addedNames && s.addedNames.length > 0 ? [`added ${s.addedNames.join(", ")}`] : []),
    ...(s.changedNames && s.changedNames.length > 0 ? [`changed ${s.changedNames.join(", ")}`] : []),
  ];
  return names.length > 0 ? `${base} (${names.join("; ")})` : base;
}
