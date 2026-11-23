// `plumbline agent relock`: rebuild the lock after a person reviewed the change, chained to the one it replaces.
//
// Host config wins (format version 2): before building, the declaration's `from` servers are re-synced from the hosts'
// files (src/agent/host-sync.ts), and when that changes the declaration it is rewritten (the form init writes) with the
// lock. So a version bump in `.mcp.json` moves the declared command, and the guard's pending file for the new command
// (matched by target) is taken. The change list says how many servers each host file re-synced and each command,
// address or header change, in the caller's own words through printable; a header's value is never read.

import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { serverTarget } from "../core/agent-tools.js";
import { AGENT_APPROVAL_FILE, AGENT_FILE, AGENT_LOCK_FILE, type AgentLock, type McpServerDecl } from "../core/types.js";
import { buildLock, lockText, repoPath, type AgentDeps } from "../agent/build.js";
import { readBytesIfPresent } from "../agent/check.js";
import { writeDefinitions } from "../agent/definitions.js";
import { discoverHosts } from "../agent/discover.js";
import { byPath } from "../agent/glob.js";
import { syncDeclaration, type DeclarationChange, type HostSync } from "../agent/host-sync.js";
import { parseAgentLock, parseDeclaration } from "../agent/lock.js";
import { CliError } from "./args.js";
import type { Out } from "./commands.js";
import { printable } from "./diff-command.js";
import { reviewServers, serverLines } from "./agent-changes.js";
import { jsonText, plural } from "./agent-shared.js";

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

/** What a server runs, in the caller's own words (a command line or an address), for its own terminal. */
function runText(d: McpServerDecl): string {
  return d.transport === "stdio" ? [d.command, ...(d.args ?? [])].join(" ") : d.url;
}

const authText = (d: McpServerDecl): string => {
  const entries = d.transport === "http" ? Object.entries(d.auth ?? {}) : [];
  return entries.length === 0 ? "none" : entries.map(([h, v]) => `${h} from ${v}`).join(", ");
};

/** The declaration lines of the change list: per host file a count, then one line per server changed, added or removed. */
export function declarationLines(sync: HostSync): string[] {
  const lines: string[] = [];
  if (sync.migrated !== undefined) {
    lines.push(
      `  declaration: version 2; ${plural(sync.migrated.marked, "server")} now re-synced from ${sync.migrated.marked === 1 ? "its" : "their"} host file, ${plural(sync.migrated.hand, "server")} ${sync.migrated.hand === 1 ? "stays" : "stay"} declared by hand (not identical to a host entry)`,
    );
  }
  const files = [...new Set(sync.changes.map((c) => c.file))].sort(byPath);
  for (const file of files) {
    const mine = sync.changes.filter((c) => c.file === file);
    lines.push(`  declaration: ${plural(mine.length, "server")} re-synced from ${file}`);
    for (const c of mine) lines.push(changeLine(c));
  }
  for (const n of sync.notAdded) lines.push(`  declaration: ${printable(n.server)} in ${n.file} is not added: a server declared by hand has its name`);
  return lines;
}

function changeLine(c: DeclarationChange): string {
  const name = printable(c.server);
  if (c.kind === "added") return `    ${name}: added (${printable(runText(c.after))})`;
  if (c.kind === "removed") return `    ${name}: removed (no longer in the host file)`;
  const parts: string[] = [];
  const what = c.after.transport === "stdio" ? "command" : "address";
  if (runText(c.before) !== runText(c.after) || c.before.transport !== c.after.transport) parts.push(`${what} ${printable(runText(c.before))} -> ${printable(runText(c.after))}`);
  if (authText(c.before) !== authText(c.after)) parts.push(`auth ${printable(authText(c.before))} -> ${printable(authText(c.after))}`);
  return `    ${name}: ${parts.join("; ")}`;
}

export async function relock(root: string, json: boolean, out: Out, deps: AgentDeps): Promise<number> {
  const lockBytes = await readBytesIfPresent(root, AGENT_LOCK_FILE);
  if (lockBytes === undefined) throw new CliError("there is no agent lock: run plumbline agent init");
  const parsedLock = parseAgentLock(new TextDecoder().decode(lockBytes));
  if (!parsedLock.ok) throw new CliError(`the agent lock cannot be used (${parsedLock.problem}): restore it from version control, then run this again`);
  const declarationBytes = await readBytesIfPresent(root, AGENT_FILE);
  if (declarationBytes === undefined) throw new CliError(`there is no ${AGENT_FILE}: restore it, then run this again`);
  const parsed = parseDeclaration(new TextDecoder().decode(declarationBytes));
  if (!parsed.ok) throw new CliError(`${AGENT_FILE} cannot be read (${parsed.problem}): fix it, then run this again`);

  const old: AgentLock = parsedLock.value;
  // host config wins: re-sync the `from` servers, and build from the declaration as it will be written
  const sync = syncDeclaration(parsed.value, await discoverHosts(root, serverTarget));
  let declaration = parsed.value;
  let bytes = declarationBytes;
  if (sync.rewrite) {
    const text = jsonText(sync.declaration);
    const reread = parseDeclaration(text);
    if (!reread.ok) throw new CliError(`the declaration re-synced from the host files is not one (${reread.problem}); please report this`);
    declaration = reread.value;
    bytes = new TextEncoder().encode(text);
  }
  const built = await buildLock(root, declaration, bytes, deps, { lock: old, bytes: lockBytes });
  if (sync.rewrite) await writeFile(repoPath(root, AGENT_FILE), bytes);
  const reviews = await reviewServers(root, old, built); // reads the definitions files before writeDefinitions replaces them
  await writeFile(repoPath(root, AGENT_LOCK_FILE), lockText(built.lock));
  const definitionsWritten = await writeDefinitions(root, built.lock, built.definitions);
  let approvalRemoved = false;
  if (existsSync(repoPath(root, AGENT_APPROVAL_FILE))) {
    await rm(repoPath(root, AGENT_APPROVAL_FILE));
    approvalRemoved = true;
  }

  const diff = filesDiff(old.files, built.lock.files);
  // a version 1 lock's files re-hashed under the text rule with unchanged contents are said once, never as changed
  const rehashed = new Set(built.rehashed);
  const files = { ...diff, changed: diff.changed.filter((k) => !rehashed.has(k)) };
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
        declaration: {
          written: sync.rewrite,
          changes: sync.changes.map((c) => ({ kind: c.kind, server: printable(c.server), file: c.file })),
          ...(sync.migrated !== undefined ? { migrated: sync.migrated } : {}),
          notAdded: sync.notAdded.map((n) => ({ server: printable(n.server), file: n.file })),
        },
        files,
        rehashed: built.rehashed,
        models,
        servers: { added: serversAdded, removed: serversRemoved, tools: shownServers },
        peers: { added: peersAdded, removed: peersRemoved, changed: peersChanged },
        approvalRemoved,
        definitions: definitionsWritten,
        findings: built.findings,
      }),
    );
    return 0;
  }
  out(`Wrote ${AGENT_LOCK_FILE}; it names the lock it replaces (previous ${built.lock.previous?.slice(0, 12)}).`);
  if (sync.rewrite) out(`Rewrote ${AGENT_FILE} from the host files (host config wins for servers declared from one).`);
  if (old.declaration !== built.lock.declaration) out(`${AGENT_FILE} changed since the last lock.`);
  for (const line of declarationLines(sync)) out(line);
  for (const rel of files.added) out(`  file added: ${rel}`);
  for (const rel of files.removed) out(`  file removed: ${rel}`);
  for (const rel of files.changed) out(`  file changed: ${rel}`);
  if (built.rehashed.length > 0) out(`  re-hashed ${plural(built.rehashed.length, "file")} under the text rule (line endings as git stores them), contents unchanged`);
  for (const label of models) out(`  model: ${label}`);
  for (const name of serversAdded) out(`  server added: ${name}`);
  for (const name of serversRemoved) out(`  server removed: ${name}`);
  for (const s of built.servers) for (const line of serverLines(s, reviews[s.server])) out(line);
  for (const url of peersAdded) out(`  peer added: ${printable(url)}`);
  for (const url of peersRemoved) out(`  peer removed: ${printable(url)}`);
  for (const url of peersChanged) out(`  peer changed: ${printable(url)}`);
  for (const f of built.findings) out(`[${f.severity}] ${f.code} ${printable(f.ref)}: ${f.summary}`);
  if (approvalRemoved) out(`Removed ${AGENT_APPROVAL_FILE}: the approval covered the old lock; approve the new one.`);
  out(`Next: a person reviews the change list, approves the new lock (plumbline approve --key <your key file>), then commits ${sync.rewrite ? `${AGENT_FILE}, ` : ""}${AGENT_LOCK_FILE} and ${AGENT_APPROVAL_FILE}.`);
  return 0;
}
