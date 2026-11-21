// `agent check`: what changed in a repository's agent since its lock, and whether the lock is approved. Node: reads the
// checkout; the network only through the injected lister and fetcher, and not at all with `offline`.
//
// Severity: what a reader of the repository can see changed, or a remote server or peer that answers differently now,
// is `block`; what could not be checked (a server or peer unreachable or refused, a stdio server the guard has not seen)
// is `warn`, never clean; what `--offline` chose not to check is `info`, one per server or peer, so the report says what
// it did not look at. Sentences are counts and fixed phrases: no tool name, description or server text is ever in one.
//
// Approval mapping (shared with `guard --require approved`): no approval file -> `absent`, lock-unapproved; an approval
// over other lock bytes (invalid, tampered) -> lock-unapproved, the lock changed after it was approved; invalid for any
// other reason -> approval-invalid; unverifiable (kid in no approvers entry, or no usable approvers file) ->
// approval-unverifiable; verified -> no finding, approvedBy.

import { readFile } from "node:fs/promises";
import { serverTarget, toolsDecision, toolsParts, toolsUnchanged, type ToolsDecision } from "../core/agent-tools.js";
import { verifyApproval } from "../core/approve.js";
import { sha256Hex } from "../core/canonical.js";
import {
  AGENT_APPROVAL_FILE,
  AGENT_FILE,
  AGENT_LOCK_FILE,
  type AgentCounts,
  type AgentDeclaration,
  type AgentFinding,
  type AgentLock,
  type AgentReport,
  type ApprovalState,
  type Severity,
} from "../core/types.js";
import { CliError } from "../cli/args.js";
import { resolveApprovers } from "../cli/approvers-file.js";
import { externalFinding, observeExternal } from "../watch/external.js";
import { listFailure, readPending, repoPath, type AgentDeps } from "./build.js";
import { matchFiles } from "./discover.js";
import { byPath } from "./glob.js";
import { parseAgentLock, parseDeclaration } from "./lock.js";

/** A repository file's exact bytes, or undefined when it is absent. Any other read failure: exit 2. */
export async function readBytesIfPresent(root: string, rel: string): Promise<Uint8Array | undefined> {
  try {
    return new Uint8Array(await readFile(repoPath(root, rel)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new CliError(`${rel} could not be read`);
  }
}

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
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

/** The approval's state for these lock bytes, with its finding (none when verified). */
export async function approvalOf(
  root: string,
  lockBytes: Uint8Array,
  options: CheckOptions,
  env: NodeJS.ProcessEnv,
): Promise<{ state: ApprovalState; finding?: AgentFinding; approvedBy?: { kid: string; label: string } }> {
  const approvalBytes = await readBytesIfPresent(root, AGENT_APPROVAL_FILE);
  if (approvalBytes === undefined) {
    return { state: "absent", finding: { severity: "block", code: "lock-unapproved", ref: AGENT_LOCK_FILE, summary: "The agent lock has no approval: no approver has signed it (plumbline approve)." } };
  }
  let approval: unknown;
  try {
    approval = JSON.parse(text(approvalBytes).replace(/^﻿/, ""));
  } catch {
    approval = undefined; // verifyApproval reports it invalid (malformed)
  }
  const source = await resolveApprovers(options.approvers, env, root);
  const verdict = await verifyApproval(lockBytes, approval, source.ok ? source.approvers : []);
  if (verdict.state === "invalid" && verdict.reason === "tampered") {
    return { state: "invalid", finding: { severity: "block", code: "lock-unapproved", ref: AGENT_LOCK_FILE, summary: "The agent lock changed after it was approved: the approval covers other lock bytes." } };
  }
  if (verdict.state === "invalid") {
    return { state: "invalid", finding: { severity: "block", code: "approval-invalid", ref: AGENT_APPROVAL_FILE, summary: `The approval does not verify (${verdict.reason ?? "invalid"}).` } };
  }
  if (verdict.state === "unverifiable") {
    const why = source.ok
      ? "its key is in no entry of the approvers file"
      : "absent" in source
        ? "no approvers file was found (pass --approvers, set PLUMBLINE_APPROVERS, or add one with plumbline approver add)"
        : `the approvers file could not be used: ${source.problem}`;
    return { state: "unverifiable", finding: { severity: "block", code: "approval-unverifiable", ref: AGENT_APPROVAL_FILE, summary: `The approval could not be verified: ${why}.` } };
  }
  const entry = verdict.approver!;
  return { state: "verified", approvedBy: { kid: entry.kid, label: entry.label } };
}

/** `agent check` on a checkout. */
export async function checkAgent(root: string, options: CheckOptions, deps: AgentDeps): Promise<AgentReport> {
  const findings: AgentFinding[] = [];
  const checkedAt = deps.now.toISOString();
  const lockBytes = await readBytesIfPresent(root, AGENT_LOCK_FILE);
  if (lockBytes === undefined) {
    findings.push({ severity: "block", code: "lock-absent", ref: AGENT_LOCK_FILE, summary: "There is no agent lock, so nothing about the agent was checked (plumbline agent init)." });
    return { findings, approval: "absent", checkedAt };
  }
  const approval = await approvalOf(root, lockBytes, options, deps.env);
  const parsedLock = parseAgentLock(text(lockBytes));
  if (!parsedLock.ok) {
    findings.push({ severity: "block", code: "lock-unusable", ref: AGENT_LOCK_FILE, summary: `The agent lock cannot be used (${parsedLock.problem}), so nothing about the agent was checked.` });
    if (approval.finding) findings.push(approval.finding);
    return report(findings, approval, checkedAt);
  }
  const lock = parsedLock.value;

  // the declaration
  const declarationBytes = await readBytesIfPresent(root, AGENT_FILE);
  let declaration: AgentDeclaration | undefined;
  if (declarationBytes === undefined) {
    findings.push({ severity: "block", code: "declaration-changed", ref: AGENT_FILE, summary: "The agent declaration is missing; only the files the lock holds were checked." });
  } else {
    const parsed = parseDeclaration(text(declarationBytes));
    if ((await sha256Hex(declarationBytes)) !== lock.declaration) {
      findings.push({
        severity: "block",
        code: "declaration-changed",
        ref: AGENT_FILE,
        summary: parsed.ok ? "The agent declaration changed since the lock was written." : `The agent declaration changed since the lock was written and cannot be read (${parsed.problem}); only the files the lock holds were checked.`,
      });
    }
    if (parsed.ok) declaration = parsed.value;
  }

  // files
  findings.push(...(await fileFindings(root, lock, declaration)));

  // models
  const before = lock.models ?? {};
  const after = declaration?.models ?? (declaration === undefined ? before : {});
  for (const label of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort(byPath)) {
    if (before[label] === after[label]) continue;
    const summary =
      !Object.hasOwn(before, label) ? "A model label the lock does not hold is declared." : !Object.hasOwn(after, label) ? "A model label the lock holds is no longer declared." : "The model id declared for this label differs from the lock.";
    findings.push({ severity: "block", code: "model-changed", ref: label, summary });
  }

  // servers
  if (declaration !== undefined) findings.push(...(await serverFindings(root, lock, declaration, options, deps)));
  // peers
  if (declaration !== undefined) findings.push(...(await peerFindings(lock, declaration, options, deps)));

  if (approval.finding) findings.push(approval.finding);
  return report(findings, approval, checkedAt);
}

function report(findings: AgentFinding[], approval: { state: ApprovalState; approvedBy?: { kid: string; label: string } }, checkedAt: string): AgentReport {
  return { findings, approval: approval.state, ...(approval.approvedBy !== undefined ? { approvedBy: approval.approvedBy } : {}), checkedAt };
}

async function fileFindings(root: string, lock: AgentLock, declaration: AgentDeclaration | undefined): Promise<AgentFinding[]> {
  const out: AgentFinding[] = [];
  const now = new Map<string, Uint8Array>();
  if (declaration !== undefined) {
    const matched = await matchFiles(root, declaration.files);
    for (const rel of matched.paths) {
      const bytes = await readBytesIfPresent(root, rel);
      if (bytes !== undefined) now.set(rel, bytes);
    }
    for (const glob of matched.unsafeGlobs) {
      out.push({ severity: "block", code: "file-added", ref: glob, summary: "A file whose name a lock cannot hold (outside [A-Za-z0-9._/-]) matches this glob; rename it or narrow the glob." });
    }
  } else {
    for (const rel of Object.keys(lock.files)) {
      const bytes = await readBytesIfPresent(root, rel);
      if (bytes !== undefined) now.set(rel, bytes);
    }
  }
  for (const rel of [...new Set([...Object.keys(lock.files), ...now.keys()])].sort(byPath)) {
    const held = lock.files[rel];
    const bytes = now.get(rel);
    if (held === undefined) out.push({ severity: "block", code: "file-added", ref: rel, summary: "A file the declaration matches is not in the lock." });
    else if (bytes === undefined) out.push({ severity: "block", code: "file-removed", ref: rel, summary: "A file the lock holds is no longer in the repository (or no longer matched)." });
    else if ((await sha256Hex(bytes)) !== held) out.push({ severity: "block", code: "file-changed", ref: rel, summary: "A file the lock holds changed since the lock was written." });
  }
  return out;
}

async function serverFindings(root: string, lock: AgentLock, declaration: AgentDeclaration, options: CheckOptions, deps: AgentDeps): Promise<AgentFinding[]> {
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

async function peerFindings(lock: AgentLock, declaration: AgentDeclaration, options: CheckOptions, deps: AgentDeps): Promise<AgentFinding[]> {
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

/** Exit code for a report: 0 when nothing is warn or block. */
export const reportExit = (r: AgentReport): number => (r.findings.some((f) => f.severity !== "info") ? 1 : 0);
