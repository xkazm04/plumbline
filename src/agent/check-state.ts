// `agent check`, the state part: a report's overall state (pass, fail, unavailable) and the exit code it maps to.
// Pure. The rule is the wire's (AgentReport.state in src/core/types.ts): fail on any block, or any warn that is not a
// not-checked code; unavailable on a not-checked warn alone; pass otherwise. Unavailable is never folded into pass or fail.

import { AGENT_NOT_CHECKED_CODES, type AgentFinding, type AgentReport, type AgentState } from "../core/types.js";

const NOT_CHECKED: ReadonlySet<string> = new Set(AGENT_NOT_CHECKED_CODES);

/** The overall state of a set of findings. */
export function agentState(findings: readonly AgentFinding[]): AgentState {
  if (findings.some((f) => f.severity === "block" || (f.severity === "warn" && !NOT_CHECKED.has(f.code)))) return "fail";
  if (findings.some((f) => f.severity === "warn")) return "unavailable";
  return "pass";
}

/** Exit code for a report: 0 when nothing is warn or block. (The --fail-on rule replaces this; see the brief, D-6.) */
export const reportExit = (r: AgentReport): number => (r.findings.some((f) => f.severity !== "info") ? 1 : 0);
