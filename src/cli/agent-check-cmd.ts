// `plumbline agent check`: printing a report (text or --json) and the next step.

import { AGENT_LOCK_FILE, type AgentReport } from "../core/types.js";
import type { Out } from "./commands.js";
import { printable } from "./diff-command.js";
import { plural } from "./agent-shared.js";

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
