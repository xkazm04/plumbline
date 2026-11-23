// `agent check`, the state part: a report's overall state (pass, fail, unavailable) and the exit code it maps to.
// Pure. The rule is the wire's (AgentReport.state in src/core/types.ts): fail on any block, or any warn that is not a
// not-checked code; unavailable on a not-checked warn alone; pass otherwise. Unavailable is never folded into pass or fail:
// the exit code is where a caller chooses, with --fail-on, whether something not checked stops them (as the gate's).

import { AGENT_NOT_CHECKED_CODES, type AgentFinding, type AgentReport, type AgentState } from "../core/types.js";

const NOT_CHECKED: ReadonlySet<string> = new Set(AGENT_NOT_CHECKED_CODES);

/** True for a finding that says something was not checked (a warn whose code is in AGENT_NOT_CHECKED_CODES). */
export const isNotChecked = (f: AgentFinding): boolean => f.severity === "warn" && NOT_CHECKED.has(f.code);

/** The overall state of a set of findings. */
export function agentState(findings: readonly AgentFinding[]): AgentState {
  if (findings.some((f) => f.severity === "block" || (f.severity === "warn" && !NOT_CHECKED.has(f.code)))) return "fail";
  if (findings.some((f) => f.severity === "warn")) return "unavailable";
  return "pass";
}

/** `agent check --fail-on`: which states exit 1. `fail` (the default): fail only; `unavailable`: fail and unavailable. */
export const FAIL_ON = ["fail", "unavailable"] as const;
export type FailOn = (typeof FAIL_ON)[number];

/** Exit code for a state: 1 on fail, and on unavailable under `--fail-on unavailable`; else 0. */
export const stateExit = (state: AgentState, failOn: FailOn = "fail"): 0 | 1 => (state === "fail" || (state === "unavailable" && failOn === "unavailable") ? 1 : 0);

/**
 * Exit code for a report, by its state and --fail-on. An absent or unusable lock is a block (state fail), so a check
 * that looked at nothing at all exits 1 whatever --fail-on says.
 */
export const reportExit = (r: AgentReport, failOn: FailOn = "fail"): 0 | 1 => stateExit(r.state, failOn);
