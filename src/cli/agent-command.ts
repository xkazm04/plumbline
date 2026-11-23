// plumbline agent init [--root <dir>] [--wrap [--require approved]] [--json]
// plumbline agent check [--root <dir>] [--approvers <file>] [--offline] [--fail-on fail|unavailable] [--json]
// plumbline agent relock [--root <dir>] [--json]
// plumbline agent wrap [--root <dir>] [--require approved] [--json]
// The agent lock (docs/agent-lock.md): `init` declares what the repository's agent is made of (plumbline.agent.json) from
// the agent hosts' files and writes the first lock; `check` reports what changed since the lock and whether the lock is
// approved; `relock` rebuilds the lock after a person reviewed the change, chained to the one it replaces.
// Exit 0: init or relock wrote; check's state is pass, or unavailable under --fail-on fail (the default). 1: check's
// state is fail (an absent or unusable lock is a block, so a check that looked at nothing is never 0), or unavailable
// under --fail-on unavailable. 2: usage or I/O error, or a refusal (init over an existing declaration, relock with no
// lock). check's three states are the wire's (AgentReport.state): unavailable (something was not checked, nothing
// failed) is never folded into pass or fail; --fail-on chooses what it does to the exit code, as the gate's does.
//
// Words: findings are counts and fixed phrases. Names from the caller's own repository (paths, server names, the host
// entries init declares or wraps, and the tool names relock lists from the guard's pending files) are shown only in the
// caller's terminal, through printable; a remote server's tool names are never printed.
//
// The subcommands live in agent-init.ts, agent-check-cmd.ts, agent-relock.ts and agent-wrap.ts; this file dispatches.

import { checkAgent } from "../agent/check.js";
import { FAIL_ON, reportExit, type FailOn } from "../agent/check-state.js";
import { type AgentDeps } from "../agent/build.js";
import { listMcpTools } from "../net/mcp-http.js";
import { safeFetch } from "../net/safe-fetch.js";
import { parseArgs, UsageError } from "./args.js";
import type { Out } from "./commands.js";
import { printReport } from "./agent-check-cmd.js";
import { init } from "./agent-init.js";
import { relock } from "./agent-relock.js";
import { rootOf } from "./agent-shared.js";
import { wrap, type WrapRequire } from "./agent-wrap.js";

export { BACKUP_SUFFIX, ensureGitignore, GITIGNORE_LINE } from "./agent-shared.js";
export { wrappedEntry } from "./agent-wrap.js";

export const AGENT_USAGE =
  "usage: plumbline agent init [--root <dir>] [--wrap [--require approved]] [--json]\n" +
  "       plumbline agent check [--root <dir>] [--approvers <file>] [--offline] [--json]\n" +
  "       plumbline agent relock [--root <dir>] [--json]\n" +
  "       plumbline agent wrap [--root <dir>] [--require approved] [--json]";

/** The production dependencies: the guarded MCP lister and fetch, the clock and the environment. */
export function defaultDeps(): AgentDeps {
  return { lister: (url, auth) => listMcpTools(url, auth !== undefined ? { auth } : {}), fetcher: safeFetch, now: new Date(), env: process.env };
}

/** --require for init --wrap and wrap: approved, or absent (the guard's default, locked). */
function wrapRequire(value: string | undefined): WrapRequire {
  if (value === undefined) return "locked";
  if (value !== "approved") throw new UsageError("--require takes approved (the guard requires the lock by default)");
  return "approved";
}

export async function runAgentCommand(argv: string[], out: Out): Promise<number> {
  return runAgent(argv, out, defaultDeps());
}

/** The command with its dependencies given (tests inject the lister, the fetcher, the clock and the environment). */
export async function runAgent(argv: string[], out: Out, deps: AgentDeps): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === "init") {
    const args = parseArgs(rest, ["root", "require"], ["wrap"]);
    const require = wrapRequire(args.values.get("require"));
    if (args.values.has("require") && !args.flags.has("wrap")) throw new UsageError("--require goes with --wrap");
    return init(rootOf(args.values.get("root")), args.flags.has("wrap"), args.json, out, deps, require);
  }
  if (sub === "check") {
    const args = parseArgs(rest, ["root", "approvers", "fail-on"], ["offline"]);
    const failOnValue = args.values.get("fail-on") ?? "fail";
    if (!(FAIL_ON as readonly string[]).includes(failOnValue)) throw new UsageError("--fail-on takes fail or unavailable");
    const failOn = failOnValue as FailOn;
    const approvers = args.values.get("approvers");
    const report = await checkAgent(rootOf(args.values.get("root")), { offline: args.flags.has("offline"), ...(approvers !== undefined ? { approvers } : {}) }, deps);
    printReport(report, args.json, args.flags.has("offline"), out);
    return reportExit(report, failOn);
  }
  if (sub === "relock") {
    const args = parseArgs(rest, ["root"]);
    return relock(rootOf(args.values.get("root")), args.json, out, deps);
  }
  if (sub === "wrap") {
    const args = parseArgs(rest, ["root", "require"]);
    return wrap(rootOf(args.values.get("root")), args.json, out, deps, wrapRequire(args.values.get("require")));
  }
  throw new UsageError("agent takes init, check, relock or wrap");
}
