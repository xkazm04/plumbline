// `plumbline agent relock`: rebuild the lock after a person reviewed the change, chained to the one it replaces.

import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { AGENT_APPROVAL_FILE, AGENT_FILE, AGENT_LOCK_FILE, type AgentLock } from "../core/types.js";
import { buildLock, lockText, repoPath, type AgentDeps } from "../agent/build.js";
import { readBytesIfPresent } from "../agent/check.js";
import { writeDefinitions } from "../agent/definitions.js";
import { byPath } from "../agent/glob.js";
import { parseAgentLock, parseDeclaration } from "../agent/lock.js";
import { CliError } from "./args.js";
import type { Out } from "./commands.js";
import { printable } from "./diff-command.js";
import { reviewServers, serverLines } from "./agent-changes.js";

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
  const built = await buildLock(root, parsed.value, declarationBytes, deps, { lock: old, bytes: lockBytes });
  const reviews = await reviewServers(root, old, built); // reads the definitions files before writeDefinitions replaces them
  await writeFile(repoPath(root, AGENT_LOCK_FILE), lockText(built.lock));
  const definitionsWritten = await writeDefinitions(root, built.lock, built.definitions);
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
        definitions: definitionsWritten,
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
  for (const s of built.servers) for (const line of serverLines(s, reviews[s.server])) out(line);
  for (const url of peersAdded) out(`  peer added: ${printable(url)}`);
  for (const url of peersRemoved) out(`  peer removed: ${printable(url)}`);
  for (const url of peersChanged) out(`  peer changed: ${printable(url)}`);
  for (const f of built.findings) out(`[${f.severity}] ${f.code} ${printable(f.ref)}: ${f.summary}`);
  if (approvalRemoved) out(`Removed ${AGENT_APPROVAL_FILE}: the approval covered the old lock; approve the new one.`);
  out(`Next: a person reviews the change list, approves the new lock (plumbline approve --key <your key file>), then commits ${AGENT_LOCK_FILE} and ${AGENT_APPROVAL_FILE}.`);
  return 0;
}
