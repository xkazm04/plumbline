// plumbline init [--root <dir>] [--source <ref>]... [--workflow] [--timeout <ms>] [--json]
// The entry point for a publisher: one command, no key and no trust ceremony. It writes plumbline.lock.json exactly as
// `watch --init` does (src/watch/capture.ts), and with --workflow the daily watch workflow from the Action's template,
// then prints the next steps. Signing is the upgrade, named as the last step; init makes no key and reads none.
// An existing lock is kept (never overwritten: accepting drift is `watch --relock`, after a review). An existing
// workflow file is never overwritten either: --workflow refuses before anything is written.
// Exit 0: the lock was written (or kept) and nothing is warn or block. 1: a warn or block finding at capture (a peer
// held as pending, a source that could not be read: the lock has a gap), or a lock that is there and cannot be used.
// 2: usage or I/O error.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { LOCK_FILE, type DriftFinding } from "../core/types.js";
import { runWatch } from "../watch/index.js";
import { readLock } from "../watch/lock.js";
import { ArgsError, parseArgs, repeated } from "./args.js";

const USAGE = "usage: plumbline init [--root <site dir>] [--source <path-or-https-url>]... [--workflow] [--timeout <ms>] [--json]\n";

/** Where --workflow writes, relative to the current folder (the repository root the workflow runs in). */
export const WORKFLOW_PATH = ".github/workflows/plumbline-watch.yml";

/** The Action's watch template, shipped beside the built CLI (dist/cli -> ../../action/templates). */
const TEMPLATE_URL = new URL("../../action/templates/plumbline-watch.yml", import.meta.url);

/** The template's root line, which init replaces with the site folder. */
const TEMPLATE_ROOT_LINE = /^( +root: )"\."$/m;

const BAD_VALUE = {
  root: "--root takes a folder",
  source: "--source takes a path or an https URL",
  timeout: "--timeout takes a positive number of milliseconds",
} as const;

/**
 * What a publisher does next, in order. The lock alone is enough for the watch; the signature is the upgrade. The
 * grounding line says what turns byte hashing into a check of the facts the network states (D8: anchors).
 */
export function nextSteps(rootArg: string, workflow: boolean): string[] {
  return [
    `Commit ${LOCK_FILE}${workflow ? ` and ${WORKFLOW_PATH}` : ""}. The watch needs nothing else: no key, no trust file.`,
    workflow
      ? "The workflow runs daily and keeps one drift issue (it needs issues: write)."
      : `Run the watch: plumbline watch --root ${rootArg} (or add --workflow to write the daily CI workflow).`,
    `Name the pages whose facts your network states (a price list, opening hours): plumbline watch --root ${rootArg} --relock --source <page>. A changed page is then drift, and the prices, times, dates, phone numbers, e-mail addresses and percentages the network states from it are anchored: the watch counts the ones no longer on it.`,
    `Upgrade, when you are ready: sign the agent files. plumbline keygen --out <a folder outside the site>, then plumbline sign --root ${rootArg} --key <that folder>/plumbline.private.json --origin <https origin>. The lock is a signed file: sign again after every --relock.`,
  ];
}

function refuse(sentence: string): 2 {
  process.stderr.write(`${sentence}\n${USAGE}`);
  return 2;
}

/** The site folder as the Action's `root:` input: relative to the current folder, `/` separators; null when unusable. */
function workflowRoot(cwd: string, root: string): string | null {
  const rel = relative(cwd, root);
  if (rel === "") return ".";
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) return null;
  const posixRel = rel.split(sep).join(posix.sep);
  // the value goes into YAML between double quotes and into the Action's folder check: the safe-path characters only
  return /^[A-Za-z0-9._/-]+$/.test(posixRel) && posixRel.split("/").every((s) => s !== "" && s !== "." && s !== "..") ? posixRel : null;
}

export async function runInitCommand(argv: string[]): Promise<number> {
  let args;
  try {
    args = parseArgs(argv, ["root", "timeout"], ["workflow"], { repeatable: ["source"] });
  } catch (error) {
    if (error instanceof ArgsError) {
      if (error.reason !== "missing") return refuse(`unknown argument ${error.arg}`);
      return refuse(Object.hasOwn(BAD_VALUE, error.arg) ? BAD_VALUE[error.arg as keyof typeof BAD_VALUE] : error.message);
    }
    throw error;
  }
  const { json } = args;
  const workflow = args.flags.has("workflow");
  const sources = repeated(args, "source");
  const rootValue = args.values.get("root");
  if (rootValue === "") return refuse(BAD_VALUE.root);
  if (sources.includes("")) return refuse(BAD_VALUE.source);
  const cwd = process.cwd();
  const root = rootValue === undefined ? cwd : resolve(rootValue);
  const rootArg = rootValue ?? ".";
  let timeoutMs: number | undefined;
  const timeoutValue = args.values.get("timeout");
  if (timeoutValue !== undefined) {
    const n = Number(timeoutValue);
    if (!Number.isFinite(n) || n <= 0) return refuse(BAD_VALUE.timeout);
    timeoutMs = n;
  }

  // --workflow is checked before anything is written, so a refusal leaves the folder as it was.
  let workflowText: string | undefined;
  let workflowRel: string | undefined;
  if (workflow) {
    const rel = workflowRoot(cwd, root);
    if (rel === null) {
      return refuse("--workflow writes the workflow under the current folder, so --root must be a folder inside it named with letters, digits, '.', '_', '-' and '/': run init from the repository root");
    }
    if (existsSync(join(cwd, WORKFLOW_PATH))) {
      process.stderr.write(`init failed: ${WORKFLOW_PATH} already exists; init never overwrites it (compare it with the template in action/templates/ by hand)\n`);
      return 2;
    }
    let template: string;
    try {
      template = await readFile(TEMPLATE_URL, "utf8");
    } catch {
      process.stderr.write("init failed: the watch template is not beside this build (action/templates/plumbline-watch.yml)\n");
      return 2;
    }
    if (!TEMPLATE_ROOT_LINE.test(template)) {
      process.stderr.write('init failed: the watch template has no `root: "."` line to fill in\n');
      return 2;
    }
    workflowText = template.replace(TEMPLATE_ROOT_LINE, `$1"${rel}"`);
    workflowRel = rel;
  }

  const before = await readLock(root);
  let lockAction: "written" | "kept";
  let findings: DriftFinding[] = [];
  if (before.kind === "missing") {
    try {
      findings = (await runWatch({ root, init: true, ...(timeoutMs !== undefined ? { timeoutMs } : {}) }, { extraSources: sources })).findings;
    } catch (error) {
      process.stderr.write(`init failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
      return 2;
    }
    lockAction = "written";
  } else if (before.kind === "ok") {
    lockAction = "kept";
    for (const ref of sources) {
      findings.push({ kind: "grounding", severity: "info", ref, summary: "Not added: a lock was already there, and init never rewrites one; add it with watch --relock --source after a review." });
    }
  } else {
    const why = before.why;
    if (json) process.stdout.write(`${JSON.stringify({ lock: "unusable", lockFile: LOCK_FILE, reason: why }, null, 2)}\n`);
    else process.stdout.write(`init: ${LOCK_FILE} is there and cannot be used (${why}); fix or remove it, or accept the current state with watch --relock\n`);
    return 1;
  }
  const after = await readLock(root);
  const lock = after.kind === "ok" ? after.lock : undefined;
  const counts = {
    grounding: lock?.grounding.sources.length ?? 0,
    runtime: Object.keys(lock?.runtime.files ?? {}).length,
    peers: Object.keys(lock?.peers ?? {}).length,
    pending: Object.keys(lock?.pendingPeers ?? {}).length,
  };

  if (workflowText !== undefined) {
    try {
      await mkdir(dirname(join(cwd, WORKFLOW_PATH)), { recursive: true });
      await writeFile(join(cwd, WORKFLOW_PATH), workflowText, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      process.stderr.write(`init failed: the workflow could not be written (${error instanceof Error ? error.message : "unknown error"})\n`);
      return 2;
    }
  }

  const steps = nextSteps(rootArg, workflow);
  if (json) {
    process.stdout.write(
      `${JSON.stringify({ lock: lockAction, lockFile: LOCK_FILE, counts, findings, ...(workflowRel !== undefined ? { workflow: WORKFLOW_PATH, workflowRoot: workflowRel } : {}), next: steps }, null, 2)}\n`,
    );
  } else {
    process.stdout.write(
      lockAction === "written"
        ? `init: wrote ${LOCK_FILE} (${counts.grounding} grounding sources, ${counts.runtime} runtime files, ${counts.peers} peers, ${counts.pending} pending)\n`
        : `init: kept the ${LOCK_FILE} that is there (accept changes with watch --relock after a review)\n`,
    );
    for (const f of findings) process.stdout.write(`${f.severity.padEnd(5)} ${f.kind} ${f.ref}: ${f.summary}\n`);
    if (workflowRel !== undefined) process.stdout.write(`init: wrote ${WORKFLOW_PATH} (root: ${workflowRel})\n`);
    process.stdout.write("next:\n");
    steps.forEach((step, i) => process.stdout.write(`  ${i + 1}. ${step}\n`));
  }
  return findings.some((f) => f.severity === "warn" || f.severity === "block") ? 1 : 0;
}
