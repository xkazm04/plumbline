// `agent check`, the servers and peers part: MCP servers against the lock (targets, the guard's pending observation,
// remote tool lists) and A2A peers. The network only through the injected lister and fetcher, and not with `offline`.

import { serverTarget, toolsDecision, toolsParts, toolsUnchanged, type ToolsDecision } from "../core/agent-tools.js";
import { type AgentCounts, type AgentDeclaration, type AgentFinding, type AgentLock, type Severity } from "../core/types.js";
import { externalFinding, observeExternal } from "../watch/external.js";
import { listFailure, readPending, type AgentDeps } from "./build.js";
import { byPath } from "./glob.js";

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export interface CheckOptions {
  offline: boolean;
  /** `--approvers <file>`; else PLUMBLINE_APPROVERS; else the default path (src/cli/approvers-file.ts). */
  approvers?: string;
}

/** The counts of a tool decision. */
export function decisionCounts(d: ToolsDecision): AgentCounts {
  return { toolsAdded: d.unpinned.length, toolsRemoved: d.removed, toolsChanged: d.changed.length };
}

/** One finding per kind of tool difference (added, removed, changed), each carrying the full counts. */
function toolFindings(server: string, d: ToolsDecision, severity: Severity, where: string): AgentFinding[] {
  const counts = decisionCounts(d);
  const out: AgentFinding[] = [];
  const say = (n: number, what: string) => `${where} ${plural(n, "tool")} ${what} since the lock (${counts.toolsAdded} added, ${counts.toolsRemoved} removed, ${counts.toolsChanged} changed).`;
  if (d.changed.length > 0) out.push({ severity, code: "tool-changed", ref: server, summary: say(d.changed.length, "whose definition changed"), counts });
  if (d.unpinned.length > 0) out.push({ severity, code: "tool-added", ref: server, summary: say(d.unpinned.length, "the lock does not hold"), counts });
  if (d.removed > 0) out.push({ severity, code: "tool-removed", ref: server, summary: say(d.removed, "the lock holds no longer listed"), counts });
  return out;
}

export async function serverFindings(root: string, lock: AgentLock, declaration: AgentDeclaration, options: CheckOptions, deps: AgentDeps): Promise<AgentFinding[]> {
  const out: AgentFinding[] = [];
  const declared = declaration.mcp ?? {};
  const held = lock.mcp ?? {};
  for (const name of [...new Set([...Object.keys(declared), ...Object.keys(held)])].sort(byPath)) {
    const decl = declared[name];
    const record = held[name];
    if (record === undefined) {
      out.push({ severity: "block", code: "server-added", ref: name, summary: "An MCP server the declaration names is not in the lock." });
      continue;
    }
    if (decl === undefined) {
      out.push({ severity: "block", code: "server-removed", ref: name, summary: "An MCP server the lock holds is no longer declared." });
      continue;
    }
    const target = await serverTarget(decl);
    if (target !== record.target || decl.transport !== record.transport) {
      out.push({ severity: "block", code: "server-target-changed", ref: name, summary: decl.transport === "stdio" ? "The command this MCP server runs differs from the lock." : "The address of this MCP server differs from the lock." });
      continue;
    }
    if (decl.transport === "stdio") {
      if (record.tools === undefined) {
        out.push({ severity: "warn", code: "server-not-observed", ref: name, summary: "This stdio MCP server's tools are not in the lock yet: run the agent with the guard, then plumbline agent relock." });
      }
      const pending = await readPending(root, name);
      if (pending !== undefined && pending.target === target) {
        const d = toolsDecision(record.tools, (await toolsParts(pending.tools)).parts);
        if (!toolsUnchanged(d)) out.push(...toolFindings(name, d, "warn", "The guard saw locally"));
      }
      continue;
    }
    if (options.offline) {
      out.push({ severity: "info", code: "server-unreachable", ref: name, summary: "Not contacted (--offline): this MCP server's tools were not checked." });
      continue;
    }
    const listed = await deps.lister(decl.url);
    if (!listed.ok) {
      const failure = listFailure(listed);
      out.push(
        failure.refused
          ? { severity: "warn", code: "server-refused", ref: name, summary: `An MCP server over HTTP was not contacted: ${failure.why}, an address Plumbline does not contact, so its tools were not checked.` }
          : { severity: "warn", code: "server-unreachable", ref: name, summary: `An MCP server over HTTP could not be read (${failure.why}), so its tools were not checked.` },
      );
      continue;
    }
    const d = toolsDecision(record.tools, (await toolsParts(listed.tools)).parts);
    if (!toolsUnchanged(d)) out.push(...toolFindings(name, d, "block", "The server lists"));
  }
  return out;
}

export async function peerFindings(lock: AgentLock, declaration: AgentDeclaration, options: CheckOptions, deps: AgentDeps): Promise<AgentFinding[]> {
  const out: AgentFinding[] = [];
  const declared = new Set(declaration.peers ?? []);
  const held = lock.peers ?? {};
  for (const url of [...new Set([...declared, ...Object.keys(held)])].sort(byPath)) {
    const record = held[url];
    if (record === undefined) {
      out.push({ severity: "block", code: "peer-changed", ref: url, summary: "An A2A peer the declaration names is not in the lock." });
      continue;
    }
    if (!declared.has(url)) {
      out.push({ severity: "block", code: "peer-changed", ref: url, summary: "An A2A peer the lock holds is no longer declared." });
      continue;
    }
    if (options.offline) {
      out.push({ severity: "info", code: "peer-unreachable", ref: url, summary: "Not contacted (--offline): this A2A peer's card was not checked." });
      continue;
    }
    const finding = externalFinding(url, record, await observeExternal(url, "a2a-card", deps.fetcher));
    if (finding === null) continue;
    out.push(finding.code === "external-changed" ? { severity: "block", code: "peer-changed", ref: url, summary: finding.summary } : { severity: "warn", code: "peer-unreachable", ref: url, summary: finding.summary });
  }
  return out;
}
