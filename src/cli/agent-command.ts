// plumbline agent init [--root <dir>] [--wrap] [--json]
// plumbline agent check [--root <dir>] [--approvers <file>] [--offline] [--json]
// plumbline agent relock [--root <dir>] [--json]
// plumbline agent wrap [--root <dir>] [--json]
// The agent lock (docs/agent-lock.md): `init` declares what the repository's agent is made of (plumbline.agent.json) from
// the agent hosts' files and writes the first lock; `check` reports what changed since the lock and whether the lock is
// approved; `relock` rebuilds the lock after a person reviewed the change, chained to the one it replaces.
// Exit 0: init or relock wrote; check found nothing of severity warn or block. 1: check found something (an absent or
// unusable lock is never clean). 2: usage or I/O error, or a refusal (init over an existing declaration, relock with
// no lock).
//
// Words: findings are counts and fixed phrases. Names from the caller's own repository (paths, server names, the host
// entries init declares or wraps, and the tool names relock lists from the guard's pending files) are shown only in the
// caller's terminal, through printable; a remote server's tool names are never printed.
//
// The subcommands live in agent-init.ts, agent-check-cmd.ts, agent-relock.ts and agent-wrap.ts; this file dispatches.

import { checkAgent, reportExit } from "../agent/check.js";
import { type AgentDeps } from "../agent/build.js";
import { listMcpTools } from "../net/mcp-http.js";
import { safeFetch } from "../net/safe-fetch.js";
import { parseArgs, UsageError } from "./args.js";
import type { Out } from "./commands.js";
import { printReport } from "./agent-check-cmd.js";
import { init } from "./agent-init.js";
import { relock } from "./agent-relock.js";
import { rootOf } from "./agent-shared.js";
import { wrap } from "./agent-wrap.js";

export { BACKUP_SUFFIX, ensureGitignore, GITIGNORE_LINE } from "./agent-shared.js";
export { wrappedEntry } from "./agent-wrap.js";

export const AGENT_USAGE =
  "usage: plumbline agent init [--root <dir>] [--wrap] [--json]\n" +
  "       plumbline agent check [--root <dir>] [--approvers <file>] [--offline] [--json]\n" +
  "       plumbline agent relock [--root <dir>] [--json]\n" +
  "       plumbline agent wrap [--root <dir>] [--json]";

/** The production dependencies: the guarded MCP lister and fetch, the clock and the environment. */
export function defaultDeps(): AgentDeps {
  return { lister: (url) => listMcpTools(url), fetcher: safeFetch, now: new Date(), env: process.env };
}

export async function runAgentCommand(argv: string[], out: Out): Promise<number> {
  return runAgent(argv, out, defaultDeps());
}

/** The command with its dependencies given (tests inject the lister, the fetcher, the clock and the environment). */
export async function runAgent(argv: string[], out: Out, deps: AgentDeps): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === "init") {
    const args = parseArgs(rest, ["root"], ["wrap"]);
    return init(rootOf(args.values.get("root")), args.flags.has("wrap"), args.json, out, deps);
  }
  if (sub === "check") {
    const args = parseArgs(rest, ["root", "approvers"], ["offline"]);
    const approvers = args.values.get("approvers");
    const report = await checkAgent(rootOf(args.values.get("root")), { offline: args.flags.has("offline"), ...(approvers !== undefined ? { approvers } : {}) }, deps);
    printReport(report, args.json, args.flags.has("offline"), out);
    return reportExit(report);
  }
  if (sub === "relock") {
    const args = parseArgs(rest, ["root"]);
    return relock(rootOf(args.values.get("root")), args.json, out, deps);
  }
  if (sub === "wrap") {
    const args = parseArgs(rest, ["root"]);
    return wrap(rootOf(args.values.get("root")), args.json, out, deps);
  }
  throw new UsageError("agent takes init, check, relock or wrap");
}
