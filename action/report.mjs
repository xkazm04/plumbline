// Reads the report the Action's CLI run wrote, ONCE, and turns it into the step's outputs: for `gate` the state and the
// job summary, for `watch` the warn-or-block count and the drift issue's body. Plain Node, no dependencies, no build,
// so the Action can run it straight from its own checkout and `node --test "action/*.test.mjs"` can test it.
//
//   node report.mjs gate  <report.json>
//   node report.mjs watch <report.json> <issue-body.md>
//
// Outputs go to $GITHUB_OUTPUT (to stdout when it is unset) and the gate summary to $GITHUB_STEP_SUMMARY (skipped when
// it is unset).
// A gate report that cannot be read gives `state=unknown` and exit 0: the CLI's own exit code decides the step. A watch
// report that cannot be read, or has no findings list, is exit 2: the CLI said it wrote one, so that is a real error,
// and reading it as clean would close an open drift issue.

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ISSUE_TITLE = "Plumbline drift";

/** One Markdown table cell: pipes escaped, line breaks folded, absent values empty. */
export function cell(text) {
  return String(text ?? "")
    .replace(/\|/g, "\\|")
    .replace(/[\r\n]+/g, " ");
}

/** The findings that are not clean: severity `warn` or `block`. `info` stays in the job log. */
export function openFindings(report) {
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  const open = findings.filter((f) => f && (f.severity === "warn" || f.severity === "block"));
  // A lock that is not `found` means nothing was checked: that is never clean, so it keeps (or opens) the issue.
  const state = report?.lockState;
  if (typeof state === "string" && state !== "found") {
    const why = typeof report?.lockSummary === "string" && report.lockSummary ? report.lockSummary : `lock ${state}`;
    open.unshift({ severity: "warn", kind: "grounding", ref: "plumbline.lock.json", summary: state === "absent" ? "no lock" : why, lockState: state });
  }
  return open;
}

/** The gate's outputs: its state and one summary line per adapter finding. */
export function gateOutputs(report) {
  const state = typeof report?.state === "string" ? report.state : "unknown";
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  const lines = findings.map((f) => `- **${cell(f?.adapter)}**: ${cell(f?.state)}. ${cell(f?.summary)}`);
  return { state, summary: [`### Plumbline gate: ${state}`, ...lines].join("\n") + "\n" };
}

/**
 * The drift issue's body, built from warn and block findings only. The commands it gives run in a clone of Plumbline,
 * not in the site's repository, so the site is named as a placeholder: the workflow cannot know where that clone is.
 */
export function issueBody(report) {
  const findings = openFindings(report);
  const rows = findings.map((f) => `| ${cell(f.severity)} | ${cell(f.kind)} | ${cell(f.ref)} | ${cell(f.summary)} |`);
  const noLock = findings.some((f) => f.summary === "no lock");
  const cli = "node dist/cli/index.js";
  const site = "<path to your site>";
  return (
    [
      "Plumbline watch found drift since `plumbline.lock.json` was written.",
      "",
      "| Severity | Kind | Ref | What |",
      "| --- | --- | --- | --- |",
      ...rows,
      "",
      noLock
        ? "There is no lock yet. In a clone of xkazm04/plumbline at the commit this workflow pins, run " +
          `\`npm ci && ${cli} watch --root ${site} --init\`, review the lock, sign the site (the lock is a signed file) ` +
          "and commit both."
        : "`block` means a vendored runtime file, a peer's definition or a peer's links.json changed: look before the next release. " +
          "After reviewing a change you accept, in a clone of xkazm04/plumbline at the commit this workflow pins, run " +
          `\`${cli} watch --root ${site} --relock\`, ` +
          "sign the site again (the lock is a signed file) and commit both. The next clean run closes this issue.",
      "",
      "A clean report does not mean the site is safe: it means the locked files, peers and runtime match what was locked.",
    ].join("\n") + "\n"
  );
}

/**
 * The watch's outputs: how many findings are warn or block, and the issue body. A report without a findings list throws:
 * read as "no findings" it would close an open drift issue on a run that checked nothing.
 */
export function watchOutputs(report) {
  if (!Array.isArray(report?.findings)) throw new Error("the watch report has no findings list");
  return { findings: openFindings(report).length, body: issueBody(report) };
}

function readReport(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function output(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${name}=${value}\n`);
  else process.stdout.write(`${name}=${value}\n`);
}

function main(argv) {
  const [command, reportFile, bodyFile] = argv;
  if (command === "gate" && reportFile) {
    let report;
    try {
      report = readReport(reportFile);
    } catch {
      report = undefined;
    }
    const { state, summary } = gateOutputs(report);
    output("state", state);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    return 0;
  }
  if (command === "watch" && reportFile && bodyFile) {
    let findings;
    let body;
    try {
      ({ findings, body } = watchOutputs(readReport(reportFile)));
    } catch (error) {
      process.stderr.write(`::error::cannot read the watch report ${reportFile}: ${error.message}\n`);
      return 2;
    }
    writeFileSync(bodyFile, body);
    output("findings", String(findings));
    output("issue-body", bodyFile);
    return 0;
  }
  process.stderr.write("usage: node report.mjs gate <report.json> | watch <report.json> <issue-body.md>\n");
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
