// `plumbline agent check`: printing a report (text or --json), its state and the next step.
//
// The state line says pass, fail or unavailable, as the report's `state` (the wire's rule, src/agent/check-state.ts).
// Every "Next:" line is chosen by that state and the codes behind it: a check that could not see something is told how
// to let it see (set the variable, put the guard in place, check the address), never to relock or approve; approval
// advice appears only when the approval is what failed.

import { AGENT_FILE, AGENT_LOCK_FILE, AGENT_NOT_CHECKED_CODES, type AgentCode, type AgentFinding, type AgentReport } from "../core/types.js";
import { isNotChecked } from "../agent/check-state.js";
import type { Out } from "./commands.js";
import { printable } from "./diff-command.js";
import { plural } from "./agent-shared.js";

type NotCheckedCode = (typeof AGENT_NOT_CHECKED_CODES)[number];

/** What to do about each not-checked code, one line each. None of them asks for a relock or an approval of this lock. */
export const NOT_CHECKED_NEXT: Record<NotCheckedCode, string> = {
  "server-not-observed":
    "Next: run the agent once with the guard in place (plumbline agent wrap) so the guard observes each stdio MCP server not yet observed, then plumbline agent relock and a person approves the new lock.",
  "server-unreachable":
    `Next: check that each MCP server that could not be read answers at its address; one that answers HTTP 401 or 403 needs a key: name the environment variable under auth in ${AGENT_FILE} and set it, then run this again.`,
  "server-refused":
    "Next: check the address of each MCP server Plumbline did not contact (it contacts public addresses only); a server at a private or loopback address is checked where it runs, not by this check.",
  "server-auth-missing": `Next: set each environment variable that ${AGENT_FILE} names under auth for a server whose key is missing (in CI, from a secret), then run this again.`,
  "peer-unreachable": "Next: check that each A2A peer that could not be read serves its card at the declared address, then run this again.",
  "link-absent": "Next: restore each recorded link (or check out what it points to) so the files under it can be checked, then run this again.",
};

const APPROVAL_CODES: ReadonlySet<AgentCode> = new Set<AgentCode>(["lock-unapproved", "approval-invalid", "approval-unverifiable"]);

const APPROVAL_NEXT: Partial<Record<AgentCode, string>> = {
  "lock-unapproved": "Next: a person reviews the lock and approves it (plumbline approve --key <your key file>).",
  "approval-invalid": "Next: the approval does not verify: a person reviews the lock and approves it again (plumbline approve --key <your key file>).",
  "approval-unverifiable":
    "Next: give check the approvers file that holds the approver's key (--approvers <file>, PLUMBLINE_APPROVERS, or plumbline approver add), or have a person in it approve the lock.",
};

const CHANGED_NEXT = "Next: review what changed; if it is intended, plumbline agent relock, then a person approves the new lock (plumbline approve --key <your key file>).";

/** "a", "a and b", "a, b and c". */
const listed = (parts: string[]): string => (parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);

/** What was not checked, as counts: "1 MCP server and 1 A2A peer were not checked". */
export function notCheckedPhrase(findings: readonly AgentFinding[]): string {
  const open = findings.filter(isNotChecked);
  const distinct = (codes: string[]): number => new Set(open.filter((f) => codes.includes(f.code)).map((f) => f.ref)).size;
  const servers = distinct(["server-not-observed", "server-unreachable", "server-refused", "server-auth-missing"]);
  const peers = distinct(["peer-unreachable"]);
  const links = distinct(["link-absent"]);
  const parts = [
    ...(servers > 0 ? [plural(servers, "MCP server")] : []),
    ...(peers > 0 ? [plural(peers, "A2A peer")] : []),
    ...(links > 0 ? [plural(links, "linked folder")] : []),
  ];
  return `${listed(parts)} ${servers + peers + links === 1 ? "was" : "were"} not checked`;
}

/** The one line that states the report's state. */
export function stateLine(report: AgentReport): string {
  if (report.state === "pass") return "State: pass: the agent matches its approved lock.";
  if (report.state === "unavailable") return `State: unavailable: nothing that was checked differs from the approved lock, but ${notCheckedPhrase(report.findings)}.`;
  const blocks = report.findings.filter((f) => f.severity === "block").length;
  const warns = report.findings.filter((f) => f.severity === "warn").length;
  const unseen = report.findings.some(isNotChecked) ? `; ${notCheckedPhrase(report.findings)}` : "";
  // only the counts that are not zero ("0 changes to block, 1 warning" read as a contradiction), and why it fails
  const counts = [...(blocks > 0 ? [`${plural(blocks, "change")} to block`] : []), ...(warns > 0 ? [plural(warns, "warning")] : [])];
  return `State: fail: ${listed(counts) || plural(report.findings.length, "finding")}${unseen}. Any finding fails the check.`;
}

/** The "Next:" lines for a report, chosen by its state. None for pass. */
export function nextLines(report: AgentReport): string[] {
  if (report.state === "pass") return [];
  const codes = new Set(report.findings.map((f) => f.code));
  if (codes.has("lock-absent")) return ["Next: plumbline agent init, then plumbline approve --key <your key file>."];
  if (codes.has("lock-unusable")) return [`Next: restore ${AGENT_LOCK_FILE} from version control, then run this again.`];
  const lines: string[] = [];
  if (report.state === "fail") {
    const failing = report.findings.filter((f) => f.severity !== "info" && !isNotChecked(f));
    if (failing.some((f) => !APPROVAL_CODES.has(f.code))) lines.push(CHANGED_NEXT);
    else for (const code of APPROVAL_CODES) if (codes.has(code)) lines.push(APPROVAL_NEXT[code] as string);
  }
  const unseen = new Set(report.findings.filter(isNotChecked).map((f) => f.code));
  for (const code of AGENT_NOT_CHECKED_CODES) if (unseen.has(code)) lines.push(NOT_CHECKED_NEXT[code]);
  return lines;
}

export function printReport(report: AgentReport, json: boolean, offline: boolean, out: Out): void {
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
  out(stateLine(report));
  for (const line of nextLines(report)) out(line);
}
