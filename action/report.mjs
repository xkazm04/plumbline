// The Action's decisions, in plain Node with no dependencies and no build, so the Action runs it straight from its own
// checkout and `node --test "action/*.test.mjs"` tests every decision that the Action's shell only carries out:
//
//   node report.mjs inputs                               refuse bad inputs (read from PLUMBLINE_*), before any build
//   node report.mjs gate  <report.json>                  the gate state and the job summary
//   node report.mjs watch <report.json> <issue-body.md>  the warn-or-block count and the drift issue's body
//   node report.mjs title                                print the drift issue's title
//   node report.mjs issue <findings> <issue-body.md> <open-issues.json> <comment.md> [<report.json>]
//                                                        what to do with the drift issue: create, edit, close or none
//   node report.mjs pr-branch <relock|renew>             print the branch of a mode's one pull request
//   node report.mjs renew-needed <report.json>           print true when the site's signature is near or past expiry
//   node report.mjs pr <relock|renew> <report.json> <relock.json|-> <sign.json|-> <open-prs.json> <body.md> <comment.md>
//                                                        what to do with the pull request: create, edit, close or none
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
export function inputProblem({ command, target, failOn, issues, rootIsFolder, relockPr = "false", renew = "false", signingKey = false, origin = "" }) {
  if (command !== "gate" && command !== "watch") return "command must be gate or watch";
  if (issues !== "true" && issues !== "false") return "issues must be true or false";
  if (relockPr !== "true" && relockPr !== "false") return "relock-pr must be true or false";
  if (renew !== "true" && renew !== "false") return "renew must be true or false";
  if (command === "gate") {
    if (failOn !== "fail" && failOn !== "unavailable") return "fail-on must be fail or unavailable";
    if (!target) return "command gate needs a target";
    if (issues === "true") return "issues: true goes with command watch only (the gate keeps no drift issue)";
    if (relockPr === "true" || renew === "true") return "relock-pr and renew go with command watch only";
    return null;
  }
  if (!rootIsFolder) return "root must name a folder in the workspace: the site folder holding plumbline.lock.json";
  if (relockPr === "true" && renew === "true") return "relock-pr and renew are separate workflows: give one of them (action/templates/ has one for each)";
  if (renew === "true" && !signingKey) return "renew: true needs signing-key (a secret holding plumbline.private.json): a renewal is a new signature";
  if ((relockPr === "true" || renew === "true") && signingKey && !/^https:\/\/[^/\s]+$/.test(origin)) {
    return "signing needs origin: the https origin the site is published from, like https://example.org";
  }
  if (signingKey && relockPr !== "true" && renew !== "true") return "signing-key goes with relock-pr or renew: nothing else signs";
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
 * The digest of the open findings: severity, kind and ref, and the finding's evidence when it has one (`actual`: the
 * hash of what changed, a peer's new links.json, a signer's kid), block first, without duplicates. New evidence for the
 * same ref is news (UAT-6: a partner that changed again, a page whose price changed after a wording edit, a fee change
 * that keeps every outline count). The summary is left out, and a finding with no evidence (an unreachable peer) has
 * none, so a peer that is still unreachable after 12 s instead of 10 s stays the same finding and nobody is notified.
 */
export function digestOf(report) {
  const seen = new Set();
  const rows = [];
  for (const f of openFindings(report)) {
    const row = [String(f.severity), String(f.kind ?? ""), String(f.ref ?? ""), ...evidenceOf(f)];
    const key = JSON.stringify(row);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  const rank = (row) => SEVERITY_RANK[row[0]] ?? 2;
  return rows.sort((a, b) => rank(a) - rank(b) || a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]));
}

/** A finding's evidence for the digest: its `actual` (a hash, a kid, a date) in a safe form, or nothing. */
function evidenceOf(f) {
  const actual = typeof f?.actual === "string" ? f.actual : "";
  return /^[0-9A-Za-z._:-]{1,128}$/.test(actual) ? [actual] : [];
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
    // three strings (a body written before UAT-6, or a finding with no evidence) or four (with its evidence)
    const row = (r) => Array.isArray(r) && (r.length === 3 || r.length === 4) && r.every((v) => typeof v === "string");
    return Array.isArray(digest) && digest.every(row) ? digest : null;
  } catch {
    return null;
  }
}

const CHECKER_NAMES = { validator: "validator", atlas: "Atlas", customs: "Customs" };

/**
 * One sentence for what a gate report checked: src/gate/context.ts gateSentence, kept word for word here because the
 * Action runs this file with no build (action/report.test.mjs holds the two to the same cases). "Partly checked" is
 * never "not checked" (UAT-9): "checked by 1 of 3 (validator pass); Atlas and Customs had no verdict"; "the site could
 * not be reached (<why>); nothing was checked, so this is not a pass"; "nothing was checked: every checker was
 * unavailable, so this is not a pass". The state is the report's; only the words are derived.
 */
export function gateSentence(report) {
  const findings = (Array.isArray(report?.findings) ? report.findings : []).filter((f) => f && typeof f.state === "string");
  const nameOf = (a) => CHECKER_NAMES[a] ?? String(a);
  const andList = (names) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
  const checked = findings.filter((f) => f.state !== "unavailable");
  const missing = findings.filter((f) => f.state === "unavailable");
  let down = null;
  for (const f of missing) {
    const m = /the target could not be reached \(([^)]{1,120})\)/.exec(String(f.summary ?? ""));
    if (m) {
      down = m[1];
      break;
    }
  }
  const by = checked.length > 0 ? `checked by ${checked.length} of ${findings.length} (${checked.map((f) => `${nameOf(f.adapter)} ${f.state}`).join(", ")})` : "";
  if (down !== null) return checked.length > 0 ? `the site could not be reached (${down}); ${by}` : `the site could not be reached (${down}); nothing was checked, so this is not a pass`;
  if (checked.length === 0) return "nothing was checked: every checker was unavailable, so this is not a pass";
  return missing.length === 0 ? by : `${by}; ${andList(missing.map((f) => nameOf(f.adapter)))} had no verdict`;
}

/** The gate's outputs: its state, the sentence for what was checked, and one summary line per adapter finding. */
export function gateOutputs(report) {
  const state = typeof report?.state === "string" ? report.state : "unknown";
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  const lines = findings.map((f) => `- **${cell(f?.adapter)}**: ${cell(f?.state)}. ${cell(f?.summary)}`);
  const sentence = findings.length > 0 ? cell(gateSentence(report)) : "";
  // a site that did not answer, or a run that checked nothing, is said in the heading itself (an alarm, not a grey word)
  const alarm = /^the site could not be reached|^nothing was checked/.test(sentence);
  const heading = sentence === "" ? `### Plumbline gate: ${state}` : alarm ? `### Plumbline gate: ${state}: ${sentence}` : `### Plumbline gate: ${state}`;
  return { state, summary: [heading, ...(sentence !== "" && !alarm ? [sentence.charAt(0).toUpperCase() + sentence.slice(1) + "."] : []), ...lines].join("\n") + "\n" };
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

const bullet = ([severity, kind, ref], summary) =>
  `- **${severity}** ${kind} \`${ref.replace(/`/g, "'").replace(/[\r\n]+/g, " ")}\`${typeof summary === "string" && summary ? `: ${cell(summary)}` : ""}`;

/**
 * The comment that says what changed between the digest the open issue carries (`before`, null when it has none) and the
 * one this run found (`now`). A new block is said first, because it is the finding that must not wait. Null when the
 * findings did not change. A row is the same finding when severity, kind and ref match and so does its evidence, or one
 * side has none (a digest written before evidence was carried: the first run after an upgrade is not news). A row with
 * new evidence for a ref the issue already holds is new (the partner changed again); the row it replaces is not listed
 * as gone. `findings` (this run's open findings, when the caller has the report) gives each new row its summary, which
 * says what is new in counts and named units.
 */
export function changeComment(before, now, runUrl, findings = []) {
  const key3 = (row) => JSON.stringify(row.slice(0, 3));
  const same = (a, b) => key3(a) === key3(b) && (a.length < 4 || b.length < 4 || a[3] === b[3]);
  const added = now.filter((row) => !(before ?? []).some((old) => same(old, row)));
  const nowRefs = new Set(now.map(key3));
  const gone = (before ?? []).filter((old) => !now.some((row) => same(old, row)) && !nowRefs.has(key3(old)));
  if (before !== null && added.length === 0 && gone.length === 0) return null;
  const summaryOf = (row) => {
    const f = findings.find((x) => x && same([String(x.severity), String(x.kind ?? ""), String(x.ref ?? ""), ...evidenceOf(x)], row) && (row.length < 4 || evidenceOf(x)[0] === row[3]));
    return f?.summary;
  };
  const lines = [];
  if (added.some((row) => row[0] === "block")) lines.push("**A new `block` finding.** Look before the next release.", "");
  if (before === null) {
    lines.push(
      `Plumbline watch updated this issue as of ${runUrl}. The issue held no record of its earlier findings, so all of them are listed:`,
      "",
      ...now.map((row) => bullet(row, summaryOf(row))),
    );
  } else {
    lines.push(`Plumbline watch's findings changed as of ${runUrl}. The table in the issue body is up to date.`);
    if (added.length > 0) lines.push("", "New:", "", ...added.map((row) => bullet(row, summaryOf(row))));
    if (gone.length > 0) lines.push("", "No longer reported:", "", ...gone.map((row) => bullet(row)));
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
export function issuePlan({ findings, body, open, runUrl, report }) {
  if (!Number.isInteger(findings) || findings < 0) throw new Error("the findings count is not a number");
  const issue = (Array.isArray(open) ? open : []).find((i) => i && i.title === ISSUE_TITLE && Number.isInteger(i.number));
  if (findings > 0) {
    if (!issue) return { action: "create", title: ISSUE_TITLE };
    // GitHub may hand the body back with CRLF line ends or without the final newline: that is the same body.
    const same = (text) => String(text ?? "").replace(/\r\n/g, "\n").trimEnd();
    if (same(issue.body) === same(body)) return { action: "none", number: issue.number };
    const now = readDigest(body);
    if (now === null) throw new Error("this run's issue body carries no digest");
    const comment = changeComment(readDigest(issue.body), now, runUrl, report ? openFindings(report) : []);
    return comment === null ? { action: "edit", number: issue.number } : { action: "edit", number: issue.number, comment };
  }
  if (!issue) return { action: "none" };
  return {
    action: "close",
    number: issue.number,
    comment:
      `Plumbline watch is clean as of ${runUrl}: the locked files, peers and runtime match plumbline.lock.json, and the site's signature, if it has one, still covers its files. Closing. ` +
      "(Clean is not safe: it means nothing locked has drifted.)\n",
  };
}

// ---- the pull request: `relock-pr: true` (accept drift) and `renew: true` (re-sign before the signature expires) ----

/** One branch and one title per mode, so a repository has at most one open pull request of each. */
export const PR_BRANCHES = { relock: "plumbline/relock", renew: "plumbline/renew" };
export const PR_TITLES = { relock: "Plumbline: accept the drift (relock)", renew: "Plumbline: renew the signature" };
const SIGNATURE_REF = "plumbline.signature.json";

/** True when the watch report says the site's own signature expires within the warning window or has expired. */
export function renewNeeded(report) {
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  return findings.some((f) => f && f.ref === SIGNATURE_REF && (f.severity === "warn" || f.severity === "block") && /expire/.test(String(f.summary ?? "")));
}

/** The kid a `sign --json` output names, only in its exact pattern; null when the site was not signed in this run. */
export function signedKid(sign) {
  const kid = sign && typeof sign === "object" ? sign.kid : undefined;
  return typeof kid === "string" && /^[0-9a-f]{16}$/.test(kid) ? kid : null;
}

/**
 * The pull request's body. For a relock: the change list `watch --relock --json` printed, then the findings that led to
 * it (their summaries carry the counts: what changed in a peer, how many facts a page no longer states). For a renewal:
 * the expiry finding. Then the signing state: signed in this run with the key in the secret (its kid), or a sentence
 * saying to sign locally, in which case the pull request is a draft. A person merges; nothing is accepted by this run.
 */
export function prBody({ mode, report, relock, kid, runUrl }) {
  const lines = [];
  if (mode === "relock") {
    const changes = relock?.changes ?? {};
    const list = (label, refs) => (Array.isArray(refs) ? refs : []).map((r) => `- ${label} \`${String(r).replace(/`/g, "'").replace(/[\r\n]+/g, " ")}\``);
    const all = [...list("added", changes.added), ...list("removed", changes.removed), ...list("changed", changes.changed)];
    lines.push(`Plumbline watch found drift as of ${runUrl}, and this pull request accepts it: \`plumbline watch --relock\` rewrote \`plumbline.lock.json\` from the current state.`, "");
    lines.push("**What the new lock changes:**", "", ...(all.length > 0 ? all : ["- no ref changed (only the capture times)"]), "");
    // what the relock itself would not accept, or kept as it was (UAT-2: a stale fact; UAT-3: a pin it could not
    // re-read): said before the findings it does accept, and those refs are not listed as accepted
    const kept = (Array.isArray(relock?.findings) ? relock.findings : []).filter((f) => f && (f.severity === "warn" || f.severity === "block"));
    if (kept.length > 0) {
      lines.push("**What this relock does not accept, or keeps as it was** (these keep reporting after a merge):", "", "| Severity | Kind | Ref | What |", "| --- | --- | --- | --- |");
      for (const f of kept) lines.push(`| ${cell(f.severity)} | ${cell(f.kind)} | ${cell(f.ref)} | ${cell(f.summary)} |`);
      lines.push("");
    }
    const keptRefs = new Set(kept.map((f) => `${f.kind} ${f.ref}`));
    const findings = openFindings(report).filter((f) => !keptRefs.has(`${f.kind} ${f.ref}`));
    if (findings.length > 0) {
      lines.push("**The findings this accepts** (review each before merging; a `block` is changed code):", "", "| Severity | Kind | Ref | What |", "| --- | --- | --- | --- |");
      for (const f of findings) lines.push(`| ${cell(f.severity)} | ${cell(f.kind)} | ${cell(f.ref)} | ${cell(f.summary)} |`);
      lines.push("");
    }
  } else {
    lines.push(`The site's signature is close to its expiry, or past it, as of ${runUrl}. This pull request signs the same files again with a new expiry.`, "");
    for (const f of openFindings(report).filter((x) => x.ref === SIGNATURE_REF)) lines.push(`- **${cell(f.severity)}** ${cell(f.summary)}`);
    lines.push("");
  }
  lines.push(
    kid !== null
      ? `Signed in this run with the key in the workflow's secret (kid \`${kid}\`). Check the kid is yours before merging.`
      : "**Not signed.** The lock is a signed file, so the site's signature reads invalid (tampered) until it is signed again. Check out this branch, run `plumbline sign` with your key, push, and mark this pull request ready. It stays a draft until then.",
    "",
    "Nothing is accepted until a person merges this. A clean watch closes it.",
  );
  // the findings' evidence (UAT-6): a peer that changed again keeps every sentence and count but not its hash, so the
  // body differs, the plan edits, and the branch's lock is pushed again with the new hash
  if (mode === "relock") lines.push("", digestMarker(digestOf(report)));
  return lines.join("\n") + "\n";
}

/**
 * What to do with the one pull request of a mode, from whether this run wants one, this run's body, whether it signed,
 * and the open pull requests on the mode's branch (`gh pr list --head <branch> --state open --json number,body,isDraft`):
 * - `create` when one is wanted and none is open; a draft when it was not signed;
 * - `edit` when one is open and its body differs (the branch is pushed again), with `draft` saying which state it must be in;
 * - `none` when the open one's body is this run's (nothing is pushed: the capture times alone are no news);
 * - `close`, with a comment, when none is wanted (a clean run, nothing to accept or renew) and one is open.
 */
export function prPlan({ mode, wanted, body, signed, open, runUrl }) {
  if (mode !== "relock" && mode !== "renew") throw new Error("the mode is relock or renew");
  const pr = (Array.isArray(open) ? open : []).find((p) => p && Number.isInteger(p.number));
  const draft = !signed;
  if (!wanted) {
    if (!pr) return { action: "none", draft };
    return { action: "close", number: pr.number, draft, comment: `Plumbline watch no longer finds anything to ${mode === "relock" ? "accept" : "renew"} as of ${runUrl}. Closing.\n` };
  }
  if (!pr) return { action: "create", draft, title: PR_TITLES[mode], branch: PR_BRANCHES[mode] };
  const same = (text) => String(text ?? "").replace(/\r\n/g, "\n").replace(/as of \S+/g, "as of <run>").trimEnd();
  if (same(pr.body) === same(body) && Boolean(pr.isDraft) === draft) return { action: "none", number: pr.number, draft };
  return { action: "edit", number: pr.number, draft, branch: PR_BRANCHES[mode] };
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
      relockPr: env.PLUMBLINE_RELOCK_PR ?? "false",
      renew: env.PLUMBLINE_RENEW ?? "false",
      // only whether a key was given: its value is never read here
      signingKey: Boolean(env.PLUMBLINE_SIGNING_KEY),
      origin: env.PLUMBLINE_ORIGIN ?? "",
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
  if (command === "issue" && (argv.length === 5 || argv.length === 6)) {
    const [, count, bodyPath, openFile, commentFile, reportFile] = argv;
    const runUrl = `${env.GITHUB_SERVER_URL ?? "https://github.com"}/${env.GITHUB_REPOSITORY ?? ""}/actions/runs/${env.GITHUB_RUN_ID ?? ""}`;
    let plan;
    try {
      const findings = /^[0-9]+$/.test(count) ? Number(count) : Number.NaN;
      const report = reportFile === undefined ? undefined : readReport(reportFile);
      plan = issuePlan({ findings, body: readFileSync(bodyPath, "utf8"), open: JSON.parse(readFileSync(openFile, "utf8")), runUrl, ...(report !== undefined ? { report } : {}) });
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
  if (command === "pr-branch" && argv.length === 2 && Object.hasOwn(PR_BRANCHES, argv[1])) {
    process.stdout.write(`${PR_BRANCHES[argv[1]]}\n`);
    return 0;
  }
  if (command === "renew-needed" && argv.length === 2) {
    try {
      process.stdout.write(`${renewNeeded(readReport(argv[1]))}\n`);
      return 0;
    } catch (error) {
      process.stderr.write(`::error::cannot read the watch report ${argv[1]}: ${error.message}\n`);
      return 2;
    }
  }
  if (command === "pr" && argv.length === 8) {
    const [, mode, reportPath, relockPath, signPath, openFile, bodyFile, commentFile] = argv;
    const runUrl = `${env.GITHUB_SERVER_URL ?? "https://github.com"}/${env.GITHUB_REPOSITORY ?? ""}/actions/runs/${env.GITHUB_RUN_ID ?? ""}`;
    let plan;
    try {
      const report = readReport(reportPath);
      if (!Array.isArray(report?.findings)) throw new Error("the watch report has no findings list");
      const relock = relockPath === "-" ? null : readReport(relockPath);
      const kid = signedKid(signPath === "-" ? null : readReport(signPath));
      // relock: wanted when there is open drift and the relock changed a ref; renew: when the signature needs it
      const changes = relock?.changes ?? {};
      const changed = ["added", "removed", "changed"].some((k) => Array.isArray(changes[k]) && changes[k].length > 0);
      const wanted = mode === "relock" ? relock !== null && openFindings(report).length > 0 && changed : renewNeeded(report) && kid !== null;
      const body = prBody({ mode, report, relock, kid, runUrl });
      plan = prPlan({ mode, wanted, body, signed: kid !== null, open: JSON.parse(readFileSync(openFile, "utf8")), runUrl });
      writeFileSync(bodyFile, body);
    } catch (error) {
      process.stderr.write(`::error::cannot decide on the pull request: ${error.message}\n`);
      return 2;
    }
    if (plan.comment !== undefined) writeFileSync(commentFile, plan.comment);
    output("action", plan.action);
    output("number", plan.number === undefined ? "" : String(plan.number));
    output("draft", String(plan.draft));
    output("title", PR_TITLES[mode]);
    output("branch", PR_BRANCHES[mode]);
    output("body", bodyFile);
    output("comment", plan.comment === undefined ? "" : commentFile);
    return 0;
  }
  process.stderr.write(
    "usage: node report.mjs inputs | gate <report.json> | watch <report.json> <issue-body.md> | title\n" +
      "       | issue <findings> <issue-body.md> <open-issues.json> <comment.md>\n" +
      "       | pr-branch <relock|renew> | renew-needed <report.json>\n" +
      "       | pr <relock|renew> <report.json> <relock.json|-> <sign.json|-> <open-prs.json> <body.md> <comment.md>\n",
  );
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
