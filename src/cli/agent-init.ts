// `plumbline agent init`: declare the agent from its hosts' files and write the first lock.

import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { serverTarget } from "../core/agent-tools.js";
import { AGENT_APPROVAL_FILE, AGENT_CURRENT_VERSION, AGENT_FILE, AGENT_LOCK_FILE, AGENT_TYPE, type AgentDeclaration, type McpServerDecl } from "../core/types.js";
import { buildLock, hashDeclaredFiles, lockText, repoPath, type AgentDeps } from "../agent/build.js";
import { writeDefinitions } from "../agent/definitions.js";
import { defaultGlobs, discoverHosts, discoverModels, type HostServer } from "../agent/discover.js";
import { byPath } from "../agent/glob.js";
import { fromDecl } from "../agent/host-sync.js";
import { parseDeclaration } from "../agent/lock.js";
import { CliError } from "./args.js";
import type { Out } from "./commands.js";
import { printable } from "./diff-command.js";
import { BACKUP_SUFFIX, ensureGitignore, GITIGNORE_LINE, jsonText, plural } from "./agent-shared.js";
import { applyWrap, wrapShown } from "./agent-wrap.js";

export async function init(root: string, wrap: boolean, json: boolean, out: Out, deps: AgentDeps): Promise<number> {
  if (existsSync(repoPath(root, AGENT_FILE))) throw new CliError(`${AGENT_FILE} exists: edit it, then plumbline agent relock`);
  if (existsSync(repoPath(root, AGENT_LOCK_FILE))) throw new CliError(`${AGENT_LOCK_FILE} exists without ${AGENT_FILE}: restore the declaration, then plumbline agent relock`);

  const hosts = await discoverHosts(root, serverTarget);
  const models = await discoverModels(root);
  const files = await defaultGlobs(root);
  const mcp: Record<string, McpServerDecl> = {};
  // every discovered server is declared `from` its host file, so relock re-syncs it from there (host config wins)
  for (const s of [...hosts.servers].sort((a, b) => byPath(a.name, b.name))) mcp[s.name] = fromDecl(s);
  const declaration: AgentDeclaration = {
    type: AGENT_TYPE,
    version: AGENT_CURRENT_VERSION,
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
  await writeDefinitions(root, built.lock, built.definitions);
  const gitignored = await ensureGitignore(root);

  const stdio = hosts.servers.filter((s) => s.decl.transport === "stdio");
  const http = hosts.servers.filter((s) => s.decl.transport === "http");
  const counts = { stdio: stdio.length, http: http.length, files: Object.keys(built.lock.files).length, models: Object.keys(models.models).length, peers: 0 };
  // the variables an http server's headers are declared to come from (header names only: a value is never read)
  const auth = http.flatMap((s) =>
    Object.entries(s.decl.transport === "http" ? (s.decl.auth ?? {}) : {}).map(([header, variable]) => ({ file: s.file, server: s.name, header, variable })),
  );
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
        auth: auth.map((a) => ({ file: a.file, server: printable(a.server), header: printable(a.header), variable: a.variable })),
        skipped: hosts.skipped.map((s) => ({ file: s.file, server: printable(s.name), why: s.why })),
        modelsSkipped: models.skipped,
        gitignore: gitignored,
        findings: built.findings,
      }),
    );
    return 0;
  }
  out(`Locked: ${plural(counts.stdio + counts.http, "MCP server")} (${counts.stdio} stdio, ${counts.http} http), ${plural(counts.files, "file")}, ${plural(counts.models, "model")}, ${plural(counts.peers, "peer")}.`);
  if (built.linked.links > 0) out(`${plural(built.linked.files, "file")} through ${plural(built.linked.links, "link")} (followed; the lock records each link's path, never where it points).`);
  out(`Wrote ${AGENT_FILE} (the declaration: edit it to add or remove what the agent is made of) and ${AGENT_LOCK_FILE} (the first lock).`);
  for (const e of hosts.entries.filter((x) => x.sse)) out(`${e.file}: ${printable(e.key)} is an SSE server; it is declared as http (Streamable HTTP), which is what Plumbline reads.`);
  for (const e of hosts.entries.filter((x) => x.name !== x.key)) out(`${e.file}: ${printable(e.key)} names a different server in another host, so it is declared as ${printable(e.name)}.`);
  for (const s of hosts.skipped) out(`${s.file}: ${printable(s.name)} is not declared: ${s.why}.`);
  for (const s of http.filter((x) => x.decl.transport === "http" && x.decl.auth !== undefined)) {
    const mine = auth.filter((a) => a.server === s.name);
    out(
      `${s.file}: ${printable(s.name)} sends ${plural(mine.length, "header")}; ${mine.length === 1 ? "its value is" : "their values are"} never read. Set ${mine.map((a) => `${a.variable} (${printable(a.header)})`).join(", ")} in the environment of init, check and relock (a CI secret), and its tools are listed.`,
    );
  }
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
