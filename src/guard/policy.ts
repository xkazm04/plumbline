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
 * The policy. The command's target is hashed as `agent init` hashes a declaration: `args` only when there is at least
 * one argument (an empty list and no list are the same command).
 */
export async function guardPolicy(inputs: PolicyInputs): Promise<PolicyDecision> {
  const ran = await serverTarget(
    inputs.args.length === 0 ? { transport: "stdio", command: inputs.command } : { transport: "stdio", command: inputs.command, args: [...inputs.args] },
  );
  const refuse = (reason: Extract<GuardPolicy, { mode: "refuse" }>["reason"], target = ran): PolicyDecision => ({
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
  if (record.target !== ran) return refuse("server-target-changed");
  const target = ran;

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
