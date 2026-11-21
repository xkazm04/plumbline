// What the guard enforces for one server, decided ONCE at start from a lock read once (guard-input-custody). Pure: no
// node:* imports; the CLI reads the files and hands their text in. Every way the lock cannot be used refuses all tools;
// none falls back to passing them.

import { serverTarget } from "../core/agent-tools.js";
import type { AgentLock, GuardRequire, InvalidReason } from "../core/types.js";
import type { Parsed } from "../agent/lock.js";
import type { GuardPolicy } from "./filter.js";

/** Where the lock's approval stands, as the CLI found it (shared-deps.md, "Approval mapping"). */
export type ApprovalOutcome =
  | { state: "absent" }
  | { state: "verified" }
  | { state: "invalid"; reason?: InvalidReason }
  | { state: "unverifiable" };

export interface PolicyInputs {
  /** The lock's text, or undefined when it could not be read. */
  lockText: string | undefined;
  parseLock: (text: string) => Parsed<AgentLock>;
  server: string;
  command: string;
  args: readonly string[];
  require: GuardRequire;
  /** Asked only with `--require approved`, and only once the lock itself is usable for this server. */
  approval: () => Promise<ApprovalOutcome>;
}

export interface PolicyDecision {
  policy: GuardPolicy;
  /** AgentMcpRecord.target of the command the guard runs, for the pending file. */
  target: string;
}

/**
 * The policy. The command's target is compared with the lock's in both spellings of "no arguments" (args omitted, or
 * an empty list), since the guard's argv cannot tell which the declaration used; any argument makes them one spelling.
 */
export async function guardPolicy(inputs: PolicyInputs): Promise<PolicyDecision> {
  const bare = await serverTarget({ transport: "stdio", command: inputs.command });
  const listed = await serverTarget({ transport: "stdio", command: inputs.command, args: [...inputs.args] });
  const targets = inputs.args.length === 0 ? [bare, listed] : [listed];
  const refuse = (reason: Extract<GuardPolicy, { mode: "refuse" }>["reason"], target = targets[0] as string): PolicyDecision => ({
    policy: { mode: "refuse", reason },
    target,
  });

  if (inputs.lockText === undefined) return refuse("lock-absent");
  const parsed = inputs.parseLock(inputs.lockText);
  if (!parsed.ok) return refuse("lock-unusable");
  const mcp = parsed.value.mcp;
  const record = mcp !== undefined && Object.hasOwn(mcp, inputs.server) ? mcp[inputs.server] : undefined;
  if (record === undefined) return refuse("server-absent");
  if (record.transport !== "stdio") return refuse("server-not-stdio");
  const target = targets.find((t) => t === record.target);
  if (target === undefined) return refuse("server-target-changed");

  if (inputs.require === "approved") {
    let outcome: ApprovalOutcome;
    try {
      outcome = await inputs.approval();
    } catch {
      outcome = { state: "unverifiable" }; // could not be checked: never verified
    }
    if (outcome.state === "absent") return refuse("lock-unapproved", target);
    if (outcome.state === "invalid") return refuse(outcome.reason === "tampered" ? "lock-changed-after-approval" : "approval-invalid", target);
    if (outcome.state !== "verified") return refuse("approval-unverifiable", target);
  }
  return { policy: { mode: "enforce", tools: record.tools }, target };
}
