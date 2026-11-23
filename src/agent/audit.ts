// The audit's walk and decisions (docs/agent-lock.md, "Approval and audit"). Pure: no node:* imports; the git layer
// (src/cli/audit-command.ts) hands it the history as data.
//
// Input: every commit that touched the agent lock or its approval, oldest first, each with the two files' exact bytes
// as committed there (absent when the file did not exist at that commit). Output: the distinct lock versions in order,
// each with its chain link (does `previous` name the prior version's byte hash?) and its approval: an approval file
// committed from this version's commit up to the next lock change whose `lock` equals this version's hash, verified
// against the caller's approvers. Unverifiable is never reported as verified; absent is never folded into invalid.
//
// What the result certifies (`clean`) has two rules. `since-first-approval` (the default): the current lock is verified,
// and every version from the first approved one on is verified with each link between them intact; the versions before
// the first approval (init's first lock, committed before anyone approved it) are listed as before approval began and do
// not count. `all` (audit --all): every version verified and the whole chain intact, the rule before 2026-11-23.
// A lock deleted and later created again starts a new chain: the re-created lock names no previous, so it reads `start`.
// A sentence here is built from counts and fixed phrases; the only words shown that are not Plumbline's are the
// approvers file's labels, which the trust store's owner chose.

import { sha256Hex } from "../core/canonical.js";
import { verifyApproval } from "../core/approve.js";
import type { AgentCode, ApprovalState, ApproverEntry, InvalidReason } from "../core/types.js";

/** One commit that touched the lock or its approval, with both files as committed there. */
export interface AuditCommit {
  commit: string;
  /** The commit date, UTC ISO or as git printed it. */
  date: string;
  lock?: Uint8Array;
  approval?: Uint8Array;
}

/** `start`: the first lock, which names none; `ok`: previous names the prior version; `broken`: it does not. */
export type ChainLink = "start" | "ok" | "broken";

export interface AuditVersion {
  /** 1 for the oldest version. */
  index: number;
  /** Set (true) on a version before the first approved one, under the since-first-approval rule: it does not count. */
  beforeApproval?: true;
  commit: string;
  date: string;
  /** SHA-256 of this version's exact bytes. */
  lock: string;
  /** The lock's own `previous`, when it holds a SHA-256 there. */
  previous?: string;
  chain: ChainLink;
  approval: ApprovalState;
  /** Set when `approval` is `invalid`. */
  reason?: InvalidReason;
  /** The approval's kid (16 hex), when an approval for this version was found and was well formed. */
  kid?: string;
  /** The trust store's label for the approver, when `approval` is `verified`. */
  label?: string;
  /** The commit that holds the approval this verdict is about. */
  approvalCommit?: string;
}

export interface AuditSummary {
  versions: number;
  verified: number;
  invalid: number;
  unverifiable: number;
  absent: number;
  chainBroken: number;
  /** Versions before the first approved one (since-first-approval); 0 under `all`, or when no version is approved. */
  beforeApproval: number;
}

/** Which versions the audit's result certifies: from the first approved version on (the default), or every version. */
export const AUDIT_RULES = ["since-first-approval", "all"] as const;
export type AuditRule = (typeof AUDIT_RULES)[number];

export interface AuditFinding {
  code: AgentCode;
  /** The version's index (1-based) as a string, or `history`. */
  ref: string;
  summary: string;
  /** Set (true) when the finding is about a version before approval began, or the link into the first approved one: listed, not counted. */
  beforeApproval?: true;
}

export interface AuditResult {
  /** The rule `clean` was decided by. */
  rule: AuditRule;
  /** The index of the first verified version, when one is. */
  firstApproved?: number;
  versions: AuditVersion[];
  summary: AuditSummary;
  /** Every problem found, each version's; those marked beforeApproval do not count against `clean`. */
  findings: AuditFinding[];
  /**
   * since-first-approval: at least one version, the current (newest) one verified, every version from the first
   * verified one on verified, and every link after it intact. all: at least one version, every one verified, the chain
   * whole.
   */
  clean: boolean;
}

const SHA256 = /^[0-9a-f]{64}$/;
const decoder = new TextDecoder();

function parsedObject(bytes: Uint8Array): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(decoder.decode(bytes));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

interface Span {
  start: AuditCommit;
  /** True when the lock was deleted in the commits before this version: a new chain may start here. */
  afterDeletion: boolean;
  bytes: Uint8Array;
  /** The commits from this version's commit up to (not including) the next lock change. */
  commits: AuditCommit[];
}

/** Groups the commits into lock versions: a new version wherever the lock's bytes differ from the one before. */
export function lockSpans(commits: readonly AuditCommit[]): Span[] {
  const spans: Span[] = [];
  let current: Span | undefined;
  let deleted = false;
  for (const c of commits) {
    if (c.lock === undefined) {
      // the lock was removed here: no version, and approvals after it belong to none
      if (spans.length > 0) deleted = true;
      current = undefined;
      continue;
    }
    if (current === undefined || !sameBytes(current.bytes, c.lock)) {
      current = { start: c, afterDeletion: deleted, bytes: c.lock, commits: [] };
      deleted = false;
      spans.push(current);
    }
    current.commits.push(c);
  }
  return spans;
}

const JUDGED: Record<Exclude<ApprovalState, "verified">, number> = { invalid: 0, unverifiable: 1, absent: 2 };

/** The approval verdict for one version: the first approval in its span that verifies, else the most telling one. */
async function approvalOf(
  span: Span,
  hash: string,
  approvers: readonly ApproverEntry[],
): Promise<Pick<AuditVersion, "approval" | "reason" | "kid" | "label" | "approvalCommit">> {
  let best: Pick<AuditVersion, "approval" | "reason" | "kid" | "label" | "approvalCommit"> = { approval: "absent" };
  const seen: Uint8Array[] = [];
  for (const c of span.commits) {
    if (c.approval === undefined || seen.some((s) => sameBytes(s, c.approval as Uint8Array))) continue;
    seen.push(c.approval);
    const value = parsedObject(c.approval);
    let candidate: typeof best;
    if (value === undefined) {
      // an approval file that is not JSON may have been meant for this version; it is never taken as absent
      candidate = { approval: "invalid", reason: "malformed", approvalCommit: c.commit };
    } else if (value.lock !== hash) {
      continue; // an approval of another lock (usually the version before, still in the tree)
    } else {
      const verdict = await verifyApproval(span.bytes, value, approvers);
      const kid = typeof value.kid === "string" && /^[0-9a-f]{16}$/.test(value.kid) ? value.kid : undefined;
      candidate = {
        approval: verdict.state,
        ...(verdict.reason !== undefined ? { reason: verdict.reason } : {}),
        ...(kid !== undefined ? { kid } : {}),
        ...(verdict.approver !== undefined ? { label: verdict.approver.label } : {}),
        approvalCommit: c.commit,
      };
      if (verdict.state === "verified") return candidate;
    }
    if (best.approval === "absent" || JUDGED[candidate.approval as keyof typeof JUDGED] < JUDGED[best.approval as keyof typeof JUDGED]) {
      best = candidate;
    }
  }
  return best;
}

const APPROVAL_FINDING: Record<Exclude<ApprovalState, "verified">, { code: AgentCode; summary: string }> = {
  absent: { code: "lock-unapproved", summary: "This lock version has no approval committed before the next change." },
  invalid: { code: "approval-invalid", summary: "This lock version's approval does not verify." },
  unverifiable: {
    code: "approval-unverifiable",
    summary: "This lock version's approval names a key that is in no entry of the approvers file, so it cannot be checked.",
  },
};

/**
 * Walks the lock's history: distinct versions in order, each one's chain link and approval verdict, the summary counts
 * and a finding per problem. A version whose approval was committed one or more commits after it (before the next lock
 * change) counts as approved. The first version must name no `previous` (a first lock that names one points at a lock
 * this history does not hold: chain-broken). A version re-created after the lock was deleted reads `start` when it names
 * no previous (a re-init), `ok` when it names the last version before the deletion (a restore), else `broken`. No
 * version at all is a `lock-absent` finding. `rule` decides `clean` (see the module comment).
 */
export async function auditHistory(
  commits: readonly AuditCommit[],
  approvers: readonly ApproverEntry[],
  rule: AuditRule = "since-first-approval",
): Promise<AuditResult> {
  const spans = lockSpans(commits);
  const versions: AuditVersion[] = [];
  const findings: AuditFinding[] = [];
  let priorHash: string | undefined;
  for (const [i, span] of spans.entries()) {
    const hash = await sha256Hex(span.bytes);
    const parsed = parsedObject(span.bytes);
    const previous = typeof parsed?.previous === "string" && SHA256.test(parsed.previous) ? parsed.previous : undefined;
    const fresh = parsed !== undefined && parsed.previous === undefined;
    const chain: ChainLink =
      i === 0 ? (fresh ? "start" : "broken") : span.afterDeletion && fresh ? "start" : previous !== undefined && previous === priorHash ? "ok" : "broken";
    const version: AuditVersion = {
      index: i + 1,
      commit: span.start.commit,
      date: span.start.date,
      lock: hash,
      ...(previous !== undefined ? { previous } : {}),
      chain,
      ...(await approvalOf(span, hash, approvers)),
    };
    versions.push(version);
    if (chain === "broken") {
      findings.push({
        code: "chain-broken",
        ref: String(version.index),
        summary:
          i === 0
            ? "The oldest lock in this history names a lock before it that the history does not hold, or is not a lock document."
            : span.afterDeletion
              ? "This lock version, created after the lock was deleted, names a previous that is not the version before the deletion."
              : "This lock version does not name the version before it as its previous.",
      });
    }
    if (version.approval !== "verified") {
      const f = APPROVAL_FINDING[version.approval];
      findings.push({ code: f.code, ref: String(version.index), summary: f.summary });
    }
    priorHash = hash;
  }
  if (versions.length === 0) {
    findings.push({ code: "lock-absent", ref: "history", summary: "No commit in this history holds plumbline.agent.lock.json." });
  }

  // since the first approval: what came before it is listed, not counted; so is the first approved version's own link
  // when it leads into versions before approval began (a first version in the history that names a lock the history does
  // not hold is still counted: nothing before it was listed). The current version must be verified under either rule.
  const first = versions.find((v) => v.approval === "verified")?.index;
  let beforeApproval = 0;
  if (rule === "since-first-approval" && first !== undefined) {
    for (const v of versions) {
      if (v.index >= first) break;
      v.beforeApproval = true;
      beforeApproval++;
    }
    for (const f of findings) {
      const index = Number(f.ref);
      if (Number.isInteger(index) && (index < first || (index === first && first > 1 && f.code === "chain-broken"))) f.beforeApproval = true;
    }
  }
  const current = versions[versions.length - 1];
  const clean = current !== undefined && current.approval === "verified" && findings.every((f) => f.beforeApproval === true);

  const count = (state: ApprovalState): number => versions.filter((v) => v.approval === state).length;
  const summary: AuditSummary = {
    versions: versions.length,
    verified: count("verified"),
    invalid: count("invalid"),
    unverifiable: count("unverifiable"),
    absent: count("absent"),
    chainBroken: versions.filter((v) => v.chain === "broken").length,
    beforeApproval,
  };
  return { rule, ...(first !== undefined ? { firstApproved: first } : {}), versions, summary, findings, clean };
}

/** A label fit for a markdown table cell: pipes and backslashes escaped (labels hold no control characters). */
function cell(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

const VERDICT_WORDS: Record<ApprovalState, string> = {
  verified: "verified",
  invalid: "INVALID",
  unverifiable: "UNVERIFIABLE (approver not in the approvers file)",
  absent: "NOT APPROVED",
};

/** What the result certifies, in one sentence, by its rule. */
export function cleanWords(result: AuditResult): string {
  if (result.rule === "all") return result.clean ? "Every change was approved and the chain is whole." : "NOT every change is accounted for: see the rows not marked verified or ok.";
  const before = result.summary.beforeApproval;
  const listed = before > 0 ? ` ${before} version(s) before approval began are listed and not counted (audit --all counts them).` : "";
  return result.clean
    ? `The current lock is verified, and every change since approval began was approved with the chain whole.${listed}`
    : `NOT every change since approval began is accounted for: see the rows not marked verified or ok.${listed}`;
}

/** The audit as a markdown document: a table fit to attach as change-management evidence. */
export function auditMarkdown(result: AuditResult, context: { generatedAt: string; approversSource: string }): string {
  const s = result.summary;
  const lines = [
    "# Agent change audit",
    "",
    `Generated ${context.generatedAt} by plumbline audit from the git history of plumbline.agent.lock.json. Approvers: ${context.approversSource}.`,
    "",
    `${s.versions} lock version(s): ${s.verified} verified, ${s.invalid} invalid, ${s.unverifiable} unverifiable, ${s.absent} not approved; ${s.chainBroken} chain break(s). ${cleanWords(result)}`,
    "",
    "| Version | Date | Commit | Lock (SHA-256) | Approver | Verdict | Chain |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const v of result.versions) {
    const approver = v.approval === "verified" && v.label !== undefined ? `${cell(v.label)} (${v.kid ?? ""})` : v.kid !== undefined ? `key ${v.kid}` : "-";
    const verdict = v.approval === "invalid" && v.reason !== undefined ? `${VERDICT_WORDS.invalid} (${v.reason})` : VERDICT_WORDS[v.approval];
    const before = v.beforeApproval === true ? " (before approval began)" : "";
    lines.push(`| ${v.index} | ${v.date} | ${v.commit.slice(0, 12)} | ${v.lock.slice(0, 16)} | ${approver} | ${verdict}${before} | ${v.chain === "broken" ? "BROKEN" : v.chain} |`);
  }
  lines.push("");
  return lines.join("\n");
}
