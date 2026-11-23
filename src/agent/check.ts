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


import { verifyApproval } from "../core/approve.js";
import { sha256Hex } from "../core/canonical.js";
import {
  AGENT_APPROVAL_FILE,
  AGENT_FILE,
  AGENT_LOCK_FILE,
  type AgentDeclaration,
  type AgentFinding,
  type AgentReport,
  type ApprovalState,
} from "../core/types.js";
import { resolveApprovers } from "../cli/approvers-file.js";
import { fileFindings, readBytesIfPresent } from "./check-files.js";
import { definitionsFindings } from "./definitions.js";
import { peerFindings, serverFindings, type CheckOptions } from "./check-servers.js";
import { agentState } from "./check-state.js";
import { type AgentDeps } from "./build.js";
import { byPath } from "./glob.js";
import { parseAgentLock, parseDeclaration } from "./lock.js";

export { readBytesIfPresent } from "./check-files.js";
export { decisionCounts, type CheckOptions } from "./check-servers.js";
export { agentState, reportExit } from "./check-state.js";

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

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
    return { state: agentState(findings), findings, approval: "absent", checkedAt };
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
  // the committed tool definitions (format version 2)
  findings.push(...(await definitionsFindings(root, lock)));

  if (approval.finding) findings.push(approval.finding);
  return report(findings, approval, checkedAt);
}

function report(findings: AgentFinding[], approval: { state: ApprovalState; approvedBy?: { kid: string; label: string } }, checkedAt: string): AgentReport {
  return { state: agentState(findings), findings, approval: approval.state, ...(approval.approvedBy !== undefined ? { approvedBy: approval.approvedBy } : {}), checkedAt };
}
