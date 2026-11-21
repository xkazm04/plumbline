// plumbline audit [--root <dir>] [--approvers <file>] [--out <dir>] [--json]
// Walks the git history of plumbline.agent.lock.json: every distinct lock version in order, whether each names the one
// before it (the chain), and who approved it, verified against the approvers file (src/cli/approvers-file.ts: the
// --approvers file, PLUMBLINE_APPROVERS, or $PLUMBLINE_HOME/approvers.json; never a file inside the repository).
// The decisions are pure (src/agent/audit.ts); this module is the git layer: git runs through execFile with an argument
// list, never a shell. Exit 0 every version verified and the chain whole, 1 otherwise, 2 usage or I/O error (including
// a folder that is not a git repository). The uncommitted working-tree lock is not part of the history.

import { execFile } from "node:child_process";
import path from "node:path";
import { auditHistory, auditMarkdown, type AuditCommit, type AuditResult } from "../agent/audit.js";
import { AGENT_APPROVAL_FILE, AGENT_LOCK_FILE } from "../core/types.js";
import { CliError, parseArgs } from "./args.js";
import { resolveApprovers, type ApproversSource } from "./approvers-file.js";
import type { Out } from "./commands.js";
import { writeFileAtomic } from "./files.js";

export const AUDIT_USAGE = "usage: plumbline audit [--root <dir>] [--approvers <file>] [--out <dir>] [--json]";

/**
 * The ceiling on one git command's output. A lock or approval is a few kilobytes (a lock of 2,000 pinned files at about
 * 100 bytes per entry is about 200 KB); a `git log` line is 41 + 26 bytes, so 50,000 commits that touched the two
 * files print about 3.4 MB. 16 MiB holds either with room, and a larger output is an I/O error, never a silent cut.
 */
export const GIT_MAX_BUFFER = 16 * 1024 * 1024;

function git(cwd: string, args: string[]): Promise<{ ok: true; stdout: Buffer } | { ok: false; code: number | string | undefined; stderr: string }> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, encoding: "buffer", maxBuffer: GIT_MAX_BUFFER, windowsHide: true }, (error, stdout, stderr) => {
      if (error) resolve({ ok: false, code: (error as { code?: number | string }).code, stderr: String(stderr) });
      else resolve({ ok: true, stdout });
    });
  });
}

/** The file's exact committed bytes at `commit`, or undefined when it is not in that commit's tree. */
async function blobAt(root: string, commit: string, file: string): Promise<Uint8Array | undefined> {
  // `<commit>:./<file>` is relative to `root` (git's own rule), so a --root below the repository's top works
  const present = await git(root, ["cat-file", "-e", `${commit}:./${file}`]);
  if (!present.ok) return undefined;
  const shown = await git(root, ["cat-file", "blob", `${commit}:./${file}`]);
  if (!shown.ok) throw new CliError(`git could not read ${file} at commit ${commit.slice(0, 12)}`);
  return new Uint8Array(shown.stdout);
}

/** Every commit that touched the lock or its approval under `root`, oldest first, with both files as committed. */
export async function historyOf(root: string): Promise<AuditCommit[]> {
  const inside = await git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.stdout.toString("utf8").trim() !== "true") {
    if (inside.ok === false && inside.code === "ENOENT") throw new CliError("git is not installed or not on the PATH: audit reads the lock's history with git");
    throw new CliError(`${root} is not inside a git repository: audit reads the history of ${AGENT_LOCK_FILE} from git`);
  }
  const head = await git(root, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  if (!head.ok) return []; // a repository with no commit yet holds no history
  const log = await git(root, ["log", "--reverse", "--format=%H%x09%cI", "--", AGENT_LOCK_FILE, AGENT_APPROVAL_FILE]);
  if (!log.ok) throw new CliError("git could not read the history of the agent lock");
  const commits: AuditCommit[] = [];
  for (const line of log.stdout.toString("utf8").split("\n")) {
    const [commit, date] = line.trim().split("\t");
    if (commit === undefined || !/^[0-9a-f]{40,64}$/.test(commit)) continue;
    const lock = await blobAt(root, commit, AGENT_LOCK_FILE);
    const approval = await blobAt(root, commit, AGENT_APPROVAL_FILE);
    commits.push({
      commit,
      date: normalisedDate(date ?? ""),
      ...(lock !== undefined ? { lock } : {}),
      ...(approval !== undefined ? { approval } : {}),
    });
  }
  return commits;
}

function normalisedDate(text: string): string {
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : text;
}

function approversWords(source: ApproversSource): string {
  if (source.ok) return source.source === "env" ? "PLUMBLINE_APPROVERS" : (source.path ?? source.source);
  if ("absent" in source) return `none (nothing at ${source.looked})`;
  return `none (${source.problem})`;
}

function lineOf(v: AuditResult["versions"][number]): string {
  const who =
    v.approval === "verified"
      ? `approved by ${v.label ?? "?"} (${v.kid ?? "?"})`
      : v.approval === "invalid"
        ? `approval INVALID (${v.reason ?? "?"})`
        : v.approval === "unverifiable"
          ? `approval UNVERIFIABLE: key ${v.kid ?? "?"} is in no approvers entry`
          : "NOT APPROVED";
  const chain = v.chain === "broken" ? "chain BROKEN" : v.chain === "start" ? "first lock" : "chain ok";
  return `  ${v.index}. ${v.date} ${v.commit.slice(0, 12)} lock ${v.lock.slice(0, 12)}: ${who}; ${chain}`;
}

export async function audit(argv: string[], out: Out): Promise<number> {
  const args = parseArgs(argv, ["root", "approvers", "out"]);
  const root = path.resolve(args.values.get("root") ?? ".");
  const commits = await historyOf(root);
  const source = await resolveApprovers(args.values.get("approvers"), process.env, root);
  const result = await auditHistory(commits, source.ok ? source.approvers : []);
  const generatedAt = new Date().toISOString();
  const approvers = approversWords(source);

  const outDir = args.values.get("out");
  const written: string[] = [];
  if (outDir !== undefined) {
    const jsonPath = path.join(outDir, "audit.json");
    const mdPath = path.join(outDir, "audit.md");
    await writeFileAtomic(jsonPath, JSON.stringify({ generatedAt, approvers, ...result }, null, 2) + "\n");
    await writeFileAtomic(mdPath, auditMarkdown(result, { generatedAt, approversSource: approvers }));
    written.push(jsonPath, mdPath);
  }

  const next = result.clean
    ? "Next: attach audit.md to your change record (plumbline audit --out <dir>), or rerun after the next approved change."
    : !source.ok
      ? "Next: give the approvers file (--approvers <file>, PLUMBLINE_APPROVERS, or plumbline approver add) so approvals can be verified, then rerun."
      : result.summary.versions === 0
        ? "Next: create and commit a lock (plumbline agent init), approve it (plumbline approve) and commit the approval."
        : "Next: for each version not verified, have an approver in your approvers file review it; approve the current lock with plumbline approve and commit the approval.";
  if (args.json) {
    out(JSON.stringify({ generatedAt, approvers, ...result, ...(written.length > 0 ? { written } : {}), next }));
  } else {
    const s = result.summary;
    out(`audit of ${AGENT_LOCK_FILE} in ${root} (approvers: ${approvers})`);
    for (const v of result.versions) out(lineOf(v));
    out(
      `${s.versions} version(s): ${s.verified} verified, ${s.invalid} invalid, ${s.unverifiable} unverifiable, ${s.absent} not approved; ${s.chainBroken} chain break(s).`,
    );
    if (result.versions.length === 0) out(`No commit in this history holds ${AGENT_LOCK_FILE}.`);
    for (const file of written) out(`wrote ${file}`);
    out(next);
  }
  return result.clean ? 0 : 1;
}
