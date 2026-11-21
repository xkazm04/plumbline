// plumbline guard --lock <file> --server <name> [--require locked|approved] [--approvers <file>] [--strict]
//   [--pending <dir>] -- <command> [args...]
// Runs one stdio MCP server behind the approved agent lock (docs/agent-lock.md, "The guard"): the host's config runs
// the guard in place of the server. The guard's stdout is the MCP channel, so everything it says goes to stderr.
//
// The lock (and with --require approved, the approval and the approvers file) is read ONCE, before the server starts
// (registry rule agent-runtime-assembly/guard-input-custody). Every way it cannot be used refuses all tools, with one
// stderr line saying why; the protocol is still relayed so the host does not hang.
// Exit: the server's exit code; 1 when --strict stopped it or a message was too large; 2 usage or I/O error.

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { parseAgentLock, type Parsed } from "../agent/lock.js";
import { pendingFileName } from "../agent/pending.js";
import { verifyApproval, type ApprovalVerdict } from "../core/approve.js";
import { AGENT_APPROVAL_FILE, AGENT_PENDING_DIR, GUARD_REQUIRE, type AgentLock, type ApproverEntry, type GuardRequire } from "../core/types.js";
import { GuardFilter } from "../guard/filter.js";
import { guardPolicy, type ApprovalOutcome } from "../guard/policy.js";
import { runGuardProcess } from "../guard/process.js";
import { resolveApprovers, type ApproversSource } from "./approvers-file.js";
import { CliError, UsageError, parseArgs, required } from "./args.js";
import type { Out } from "./commands.js";
import { printable } from "./diff-command.js";

export const GUARD_USAGE =
  "usage: plumbline guard --lock <file> --server <name> [--require locked|approved] [--approvers <file>] [--strict] [--pending <dir>] -- <command> [args...]";

/** Said once at start in `--require locked` (the default): what the mode does not protect against. */
export const LOCKED_MODE_WARNING =
  "plumbline guard: --require locked: tools are matched against the agent lock by hash only; the lock is not checked for approval, and anything that can write the repository can change it (use --require approved to require a person's approval)";

export type { ApproversSource };
export type ResolveApprovers = (file: string | undefined, env: NodeJS.ProcessEnv, repoRoot?: string) => Promise<ApproversSource>;

/** What the command reaches outside itself; tests replace any of it. */
export interface GuardDeps {
  parseLock: (text: string) => Parsed<AgentLock>;
  verifyApproval: (lockBytes: Uint8Array, approval: unknown, approvers: readonly ApproverEntry[]) => Promise<ApprovalVerdict>;
  resolveApprovers: ResolveApprovers;
  env: NodeJS.ProcessEnv;
  input: Readable;
  output: Writable;
  stderr: (line: string) => void;
}

/** A server name usable as a file name in the pending folder: no folder separator, no control or Windows-reserved character. */
export function isFileSafeName(name: string): boolean {
  return name !== "" && name !== "." && name !== ".." && !/[\u0000-\u001f\u007f<>:"/\\|?*]/.test(name) && !/[. ]$/.test(name);
}

async function approvalOutcome(lockFile: string, lockBytes: Uint8Array, approversFile: string | undefined, deps: GuardDeps): Promise<ApprovalOutcome> {
  const root = path.dirname(lockFile);
  let text: string;
  try {
    text = await readFile(path.join(root, AGENT_APPROVAL_FILE), "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return { state: "absent" };
    return { state: "unverifiable" };
  }
  let approval: unknown;
  try {
    approval = JSON.parse(text);
  } catch {
    return { state: "invalid", reason: "malformed" };
  }
  const source = await deps.resolveApprovers(approversFile, deps.env, root);
  if (!source.ok) return { state: "unverifiable" };
  const verdict = await deps.verifyApproval(lockBytes, approval, source.approvers);
  if (verdict.state === "verified") return { state: "verified" };
  if (verdict.state === "invalid") return verdict.reason === undefined ? { state: "invalid" } : { state: "invalid", reason: verdict.reason };
  return { state: "unverifiable" };
}

/** The command with every dependency injectable. */
export async function guardCommand(argv: string[], deps: GuardDeps): Promise<number> {
  const split = argv.indexOf("--");
  if (split === -1) throw new UsageError("guard needs the server's command after --");
  const [command, ...serverArgs] = argv.slice(split + 1);
  if (command === undefined || command === "") throw new UsageError("guard needs the server's command after --");
  const args = parseArgs(argv.slice(0, split), ["lock", "server", "require", "approvers", "pending"], ["strict"]);
  if (args.json) throw new UsageError("guard has no --json: its stdout is the MCP channel");
  const lockFile = path.resolve(required(args, "lock"));
  const server = required(args, "server");
  const requireMode = (args.values.get("require") ?? "locked") as GuardRequire;
  if (!(GUARD_REQUIRE as readonly string[]).includes(requireMode)) throw new UsageError("--require takes locked or approved");
  const approversFile = args.values.get("approvers");
  if (approversFile !== undefined && requireMode !== "approved") throw new UsageError("--approvers goes with --require approved");
  const label = printable(server);

  // the lock is read once, here, before the server starts; nothing re-reads it while the guard runs
  let lockBytes: Uint8Array | undefined;
  try {
    lockBytes = await readFile(lockFile);
  } catch {
    lockBytes = undefined;
  }
  let lockText: string | undefined;
  if (lockBytes !== undefined) {
    try {
      lockText = new TextDecoder("utf-8", { fatal: true }).decode(lockBytes);
    } catch {
      lockText = "\u0000not utf-8"; // read, but not text: unusable
    }
  }
  const decision = await guardPolicy({
    lockText,
    parseLock: deps.parseLock,
    server,
    command,
    args: serverArgs,
    require: requireMode,
    approval: () => approvalOutcome(lockFile, lockBytes as Uint8Array, approversFile, deps),
  });

  const pendingDir = path.resolve(args.values.get("pending") ?? path.join(path.dirname(lockFile), ...AGENT_PENDING_DIR.split("/")));
  const fileName = pendingFileName(server);
  const pendingFile = isFileSafeName(fileName) ? path.join(pendingDir, fileName) : undefined;
  const filter = new GuardFilter({ policy: decision.policy, label, strict: args.flags.has("strict"), ...(pendingFile === undefined ? {} : { pendingPath: pendingFile }) });

  if (requireMode === "locked") deps.stderr(LOCKED_MODE_WARNING);
  for (const line of filter.startLines()) deps.stderr(line);
  if (pendingFile === undefined) deps.stderr(`plumbline guard: ${label}: the server name cannot be a file name, so what it lists is not written for \`plumbline agent relock\``);

  return runGuardProcess({
    command,
    args: serverArgs,
    filter,
    server,
    target: decision.target,
    ...(pendingFile === undefined ? {} : { pendingFile }),
    input: deps.input,
    output: deps.output,
    stderr: deps.stderr,
    env: deps.env,
  });
}

export async function runGuardCommand(argv: string[], out: Out): Promise<number> {
  void out; // stdout is the MCP channel: the guard never prints to it
  let code: number;
  try {
    code = await guardCommand(argv, {
      parseLock: parseAgentLock,
      verifyApproval,
      resolveApprovers,
      env: process.env,
      input: process.stdin,
      output: process.stdout,
      stderr: (line) => process.stderr.write(line + "\n"),
    });
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(`the guard failed: ${(error as Error).message}`);
  }
  process.stdin.destroy(); // nothing more is read: let the process end
  return code;
}
