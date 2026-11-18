// The Action's decisions, in plain Node with no dependencies and no build, so the Action runs it straight from its own
// checkout and `node --test "action/*.test.mjs"` tests every decision that the Action's shell only carries out:
//
//   node report.mjs inputs                               refuse bad inputs (read from PLUMBLINE_*), before any build
//   node report.mjs gate  <report.json>                  the gate state and the job summary
//   node report.mjs watch <report.json> <issue-body.md>  the warn-or-block count and the drift issue's body
//   node report.mjs title                                print the drift issue's title
//   node report.mjs issue <findings> <issue-body.md> <open-issues.json> <comment.md>
//                                                        what to do with the drift issue: create, edit, close or none
//
// The report the CLI wrote is read ONCE (gate or watch). The issue step reads what that read produced: the count, and the
// body, which carries the findings' digest in a hidden marker, so a later run can tell which findings are new.
// Outputs go to $GITHUB_OUTPUT (to stdout when it is unset) and the gate summary to $GITHUB_STEP_SUMMARY (skipped when
// it is unset).
// A gate report that cannot be read gives `state=unknown` and exit 0: the CLI's own exit code decides the step. A watch
// report that cannot be read, or has no findings list, is exit 2: the CLI said it wrote one, so that is a real error,
// and reading it as clean would close an open drift issue.

import { appendFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ISSUE_TITLE = "Plumbline drift";
const SEVERITY_RANK = { block: 0, warn: 1 };

/**
 * Why the Action's inputs cannot run, or null when they can. Checked before the build, so a misconfigured workflow goes
 * red at once with the reason, never after a minute of npm ci, and never as a quiet run that checked nothing.
 * `rootIsFolder` says whether `root` names a folder in the workspace; only `watch` asks.
 */
export function inputProblem({ command, target, failOn, issues, rootIsFolder }) {
  if (command !== "gate" && command !== "watch") return "command must be gate or watch";
  if (issues !== "true" && issues !== "false") return "issues must be true or false";
  if (command === "gate") {
    if (failOn !== "fail" && failOn !== "unavailable") return "fail-on must be fail or unavailable";
    if (!target) return "command gate needs a target";
    if (issues === "true") return "issues: true goes with command watch only (the gate keeps no drift issue)";
    return null;
  }
  if (!rootIsFolder) return "root must name a folder in the workspace: the site folder holding plumbline.lock.json";
  return null;
}

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

/**
 * The digest of the open findings: severity, kind and ref, block first, without duplicates. The summary is left out, so
 * a peer that is still unreachable after 12 s instead of 10 s stays the same finding and nobody is notified again.
 */
export function digestOf(report) {
  const seen = new Set();
  const rows = [];
  for (const f of openFindings(report)) {
    const row = [String(f.severity), String(f.kind ?? ""), String(f.ref ?? "")];
    const key = JSON.stringify(row);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  const rank = (row) => SEVERITY_RANK[row[0]] ?? 2;
  return rows.sort((a, b) => rank(a) - rank(b) || a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]));
}

/** The hidden marker that carries the digest in the issue body. `<` and `>` are JSON-escaped, so it never ends early. */
export function digestMarker(digest) {
  const json = JSON.stringify(digest).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  return `<!-- plumbline:digest ${json} -->`;
}

/** The digest an issue body carries, or null when it has none (an issue written before the marker, or edited by hand). */
export function readDigest(body) {
  const match = typeof body === "string" ? body.match(/<!-- plumbline:digest (.*?) -->/) : null;
  if (!match) return null;
  try {
    const digest = JSON.parse(match[1]);
    const row = (r) => Array.isArray(r) && r.length === 3 && r.every((v) => typeof v === "string");
    return Array.isArray(digest) && digest.every(row) ? digest : null;
  } catch {
    return null;
  }
}

/** The gate's outputs: its state and one summary line per adapter finding. */
export function gateOutputs(report) {
  const state = typeof report?.state === "string" ? report.state : "unknown";
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  const lines = findings.map((f) => `- **${cell(f?.adapter)}**: ${cell(f?.state)}. ${cell(f?.summary)}`);
  return { state, summary: [`### Plumbline gate: ${state}`, ...lines].join("\n") + "\n" };
}

/**
 * The drift issue's body, built from warn and block findings only, ending with the hidden digest marker. The commands it
 * gives run in a clone of Plumbline, not in the site's repository, so the site is named as a placeholder: the workflow
 * cannot know where that clone is.
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
      "",
      digestMarker(digestOf(report)),
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

const bullet = ([severity, kind, ref]) => `- **${severity}** ${kind} \`${ref.replace(/`/g, "'").replace(/[\r\n]+/g, " ")}\``;

/**
 * The comment that says what changed between the digest the open issue carries (`before`, null when it has none) and the
 * one this run found (`now`). A new block is said first, because it is the finding that must not wait. Null when the
 * findings did not change.
 */
export function changeComment(before, now, runUrl) {
  const key = (row) => JSON.stringify(row);
  const had = new Set((before ?? []).map(key));
  const has = new Set(now.map(key));
  const added = now.filter((row) => !had.has(key(row)));
  const gone = (before ?? []).filter((row) => !has.has(key(row)));
  if (before !== null && added.length === 0 && gone.length === 0) return null;
  const lines = [];
  if (added.some((row) => row[0] === "block")) lines.push("**A new `block` finding.** Look before the next release.", "");
  if (before === null) {
    lines.push(
      `Plumbline watch updated this issue as of ${runUrl}. The issue held no record of its earlier findings, so all of them are listed:`,
      "",
      ...now.map(bullet),
    );
  } else {
    lines.push(`Plumbline watch's findings changed as of ${runUrl}. The table in the issue body is up to date.`);
    if (added.length > 0) lines.push("", "New:", "", ...added.map(bullet));
    if (gone.length > 0) lines.push("", "No longer reported:", "", ...gone.map(bullet));
  }
  return lines.join("\n") + "\n";
}

/**
 * What to do with the drift issue, from this run's count and body and the open issues `gh issue list --json
 * number,title,body` found (the first one titled exactly ISSUE_TITLE is the issue):
 * - `create` when there are findings and no open issue;
 * - `edit` when there are findings and the open issue's body differs, with a `comment` when the findings themselves
 *   changed (a body edit notifies nobody, a comment does), and none when only a summary's wording moved;
 * - `close`, with a comment, when the run is clean and an issue is open;
 * - `none` when the body is unchanged, or the run is clean and no issue is open.
 * A count that is not a number throws: it means no report was read, and that is never clean.
 */
export function issuePlan({ findings, body, open, runUrl }) {
  if (!Number.isInteger(findings) || findings < 0) throw new Error("the findings count is not a number");
  const issue = (Array.isArray(open) ? open : []).find((i) => i && i.title === ISSUE_TITLE && Number.isInteger(i.number));
  if (findings > 0) {
    if (!issue) return { action: "create", title: ISSUE_TITLE };
    // GitHub may hand the body back with CRLF line ends or without the final newline: that is the same body.
    const same = (text) => String(text ?? "").replace(/\r\n/g, "\n").trimEnd();
    if (same(issue.body) === same(body)) return { action: "none", number: issue.number };
    const now = readDigest(body);
    if (now === null) throw new Error("this run's issue body carries no digest");
    const comment = changeComment(readDigest(issue.body), now, runUrl);
    return comment === null ? { action: "edit", number: issue.number } : { action: "edit", number: issue.number, comment };
  }
  if (!issue) return { action: "none" };
  return {
    action: "close",
    number: issue.number,
    comment:
      `Plumbline watch is clean as of ${runUrl}: the locked files, peers and runtime match plumbline.lock.json. Closing. ` +
      "(Clean is not safe: it means nothing locked has drifted.)\n",
  };
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
  const env = process.env;
  if (command === "inputs" && argv.length === 1) {
    let rootIsFolder = false;
    try {
      rootIsFolder = statSync(join(env.GITHUB_WORKSPACE ?? process.cwd(), env.PLUMBLINE_ROOT ?? ".")).isDirectory();
    } catch {
      rootIsFolder = false;
    }
    const problem = inputProblem({
      command: env.PLUMBLINE_COMMAND,
      target: env.PLUMBLINE_TARGET ?? "",
      failOn: env.PLUMBLINE_FAIL_ON,
      issues: env.PLUMBLINE_ISSUES,
      rootIsFolder,
    });
    if (problem === null) return 0;
    process.stderr.write(`::error::${problem}\n`);
    return 2;
  }
  if (command === "gate" && reportFile) {
    let report;
    try {
      report = readReport(reportFile);
    } catch {
      report = undefined;
    }
    const { state, summary } = gateOutputs(report);
    output("state", state);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
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
  if (command === "title" && argv.length === 1) {
    process.stdout.write(`${ISSUE_TITLE}\n`);
    return 0;
  }
  if (command === "issue" && argv.length === 5) {
    const [, count, bodyPath, openFile, commentFile] = argv;
    const runUrl = `${env.GITHUB_SERVER_URL ?? "https://github.com"}/${env.GITHUB_REPOSITORY ?? ""}/actions/runs/${env.GITHUB_RUN_ID ?? ""}`;
    let plan;
    try {
      const findings = /^[0-9]+$/.test(count) ? Number(count) : Number.NaN;
      plan = issuePlan({ findings, body: readFileSync(bodyPath, "utf8"), open: JSON.parse(readFileSync(openFile, "utf8")), runUrl });
    } catch (error) {
      process.stderr.write(`::error::cannot decide on the drift issue: ${error.message}\n`);
      return 2;
    }
    if (plan.comment !== undefined) writeFileSync(commentFile, plan.comment);
    output("action", plan.action);
    output("number", plan.number === undefined ? "" : String(plan.number));
    output("comment", plan.comment === undefined ? "" : commentFile);
    return 0;
  }
  process.stderr.write(
    "usage: node report.mjs inputs | gate <report.json> | watch <report.json> <issue-body.md> | title\n" +
      "       | issue <findings> <issue-body.md> <open-issues.json> <comment.md>\n",
  );
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
