// The Action's report reader (action/report.mjs) and the workflows that use its outputs. Plain node --test, no build,
// no npm, no network: `node --test "action/*.test.mjs"`.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  ISSUE_TITLE,
  cell,
  digestMarker,
  digestOf,
  gateOutputs,
  inputProblem,
  issueBody,
  issuePlan,
  openFindings,
  readDigest,
  watchOutputs,
} from "./report.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const script = join(here, "report.mjs");
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const code = (text) => text.split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");

const drift = {
  findings: [
    { kind: "runtime", severity: "block", ref: "runtime/engine.js", summary: "changed" },
    { kind: "peer", severity: "warn", ref: "https://peer.example/a|b", summary: "unreachable\r\nafter 10 s" },
    { kind: "runtime", severity: "info", ref: "nsdeploy", summary: "Upstream is ahead" },
  ],
};

test("cells escape pipes and fold line breaks; absent values are empty", () => {
  assert.equal(cell("a|b"), "a\\|b");
  assert.equal(cell("one\r\ntwo\nthree"), "one two three");
  assert.equal(cell(undefined), "");
});

test("only warn and block findings count and reach the issue; info stays out", () => {
  assert.equal(openFindings(drift).length, 2);
  const { findings, body } = watchOutputs(drift);
  assert.equal(findings, 2);
  assert.match(body, /\| block \| runtime \| runtime\/engine\.js \| changed \|/);
  assert.match(body, /\| warn \| peer \| https:\/\/peer\.example\/a\\\|b \| unreachable after 10 s \|/);
  assert.doesNotMatch(body, /Upstream is ahead/);
});

test("drift tells the reader to re-lock and sign again; a missing lock tells them to init", () => {
  const body = issueBody(drift);
  assert.match(body, /watch --root <path to your site> --relock/);
  assert.match(body, /sign the site again/);
  assert.match(body, /next clean run closes this issue/);
  assert.doesNotMatch(body, /--init/);

  const noLock = issueBody({
    findings: [{ kind: "grounding", severity: "warn", ref: "plumbline.lock.json", summary: "no lock" }],
  });
  assert.match(noLock, /There is no lock yet/);
  assert.match(noLock, /watch --root <path to your site> --init/);
  assert.doesNotMatch(noLock, /--relock/);
});

test("a clean report is zero findings, and a report without a findings list is an error, never clean", () => {
  assert.equal(watchOutputs({ findings: [drift.findings[2]] }).findings, 0);
  assert.throws(() => watchOutputs({}), /no findings list/);
  assert.throws(() => watchOutputs(undefined), /no findings list/);
});

test("the gate's outputs: its state and one summary line per adapter; an unreadable report is unknown", () => {
  const { state, summary } = gateOutputs({
    state: "unavailable",
    findings: [
      { adapter: "validator", state: "pass", summary: "port: 0 problems" },
      { adapter: "atlas", state: "unavailable", summary: "timed out" },
    ],
  });
  assert.equal(state, "unavailable");
  assert.equal(summary, "### Plumbline gate: unavailable\n- **validator**: pass. port: 0 problems\n- **atlas**: unavailable. timed out\n");
  assert.equal(gateOutputs(undefined).state, "unknown");
});

function run(args, files) {
  const dir = mkdtempSync(join(tmpdir(), "plumbline-report-"));
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    const out = join(dir, "github-output");
    const summary = join(dir, "step-summary");
    const env = { ...process.env, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary };
    const result = spawnSync(process.execPath, [script, ...args.map((a) => (a.startsWith("@") ? join(dir, a.slice(1)) : a))], {
      env,
      encoding: "utf8",
    });
    const readIf = (file) => (existsSync(file) ? readFileSync(file, "utf8") : undefined);
    return {
      status: result.status,
      stderr: result.stderr,
      output: readIf(out),
      summary: readIf(summary),
      body: readIf(join(dir, "body.md")),
      dir,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("watch, as the Action runs it: one read, the count and the body path in GITHUB_OUTPUT", () => {
  const r = run(["watch", "@report.json", "@body.md"], { "report.json": JSON.stringify(drift) });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.output, `findings=2\nissue-body=${join(r.dir, "body.md")}\n`);
  assert.equal(r.body, issueBody(drift));
});

test("watch with a broken report exits 2 and writes no outputs and no body", () => {
  for (const text of ["", "{not json", JSON.stringify({ state: "pass" })]) {
    const r = run(["watch", "@report.json", "@body.md"], { "report.json": text });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /cannot read the watch report/);
    assert.equal(r.output, undefined);
    assert.equal(r.body, undefined);
  }
});

test("gate, as the Action runs it: state output and job summary; an unreadable report is state=unknown, exit 0", () => {
  const ok = run(["gate", "@report.json"], {
    "report.json": JSON.stringify({ state: "pass", findings: [{ adapter: "validator", state: "pass", summary: "ok" }] }),
  });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.output, "state=pass\n");
  assert.equal(ok.summary, "### Plumbline gate: pass\n- **validator**: pass. ok\n");

  const broken = run(["gate", "@report.json"], { "report.json": "" });
  assert.equal(broken.status, 0);
  assert.equal(broken.output, "state=unknown\n");
});

test("a usage mistake exits 2", () => {
  assert.equal(run(["watch", "@report.json"], {}).status, 2);
  assert.equal(run([], {}).status, 2);
});

test("action.yml reads its report through report.mjs once per command, never with inline JSON parsing", () => {
  const action = code(read("action/action.yml"));
  assert.doesNotMatch(action, /JSON\.parse|node -e/);
  assert.equal([...action.matchAll(/report\.mjs" gate /g)].length, 1);
  assert.equal([...action.matchAll(/report\.mjs" watch /g)].length, 1);
  assert.match(action, /\n {2}issue-body:\n/, "the Action declares the issue-body output");
});

for (const [name, file] of [
  ["the watch template", "action/templates/plumbline-watch.yml"],
  ["the Desk's watch workflow", ".github/workflows/watch-desk.yml"],
]) {
  test(`${name} leaves the drift issue to the Action (issues: true) and holds no copy of its handling`, () => {
    const text = code(read(file));
    assert.doesNotMatch(text, /JSON\.parse|node -e|node - /, "no second reader of the report");
    assert.doesNotMatch(text, /\bgh issue\b/, "the open, edit and close steps live in the Action only");
    assert.doesNotMatch(text, /Plumbline drift/, "the title lives in report.mjs only");
    assert.match(text, /\n {8}with:\n {10}command: watch\n {10}root: [^\n]+\n {10}issues: true\n/);
    assert.match(text, /\n {2}issues: write\b/, "the job's token may write issues, which the Action uses");
    // action-pin.test.ts needs the template to read at least one output the pinned Action declares.
    assert.match(text, /steps\.watch\.outputs\.findings/);
  });
}

test("the Action keeps the drift issue itself: one decision in report.mjs, one thin gh step", () => {
  const action = code(read("action/action.yml"));
  assert.match(action, /\n {2}issues:\n(?: {4}[^\n]*\n)* {4}default: "false"\n/, "issues is off unless asked for");
  assert.match(action, /\n {2}token:\n(?: {4}[^\n]*\n)* {4}default: \$\{\{ github\.token \}\}\n/);
  assert.equal([...action.matchAll(/report\.mjs" issue /g)].length, 1);
  assert.equal([...action.matchAll(/if: inputs\.issues == 'true'/g)].length, 2);
  assert.doesNotMatch(action.slice(action.indexOf("\nruns:")), /Plumbline drift/, "the steps take the title from report.mjs");
  // The input check runs before the build, so a refusal never waits for npm ci.
  assert.ok(action.indexOf('report.mjs" inputs') < action.indexOf("npm ci"), "the inputs are checked before the build");
});

test("refusals: a bad command, a gate without target, a bad fail-on, a bad issues, issues with gate, a root that is no folder", () => {
  const ok = { command: "gate", target: "https://example.com/", failOn: "fail", issues: "false", rootIsFolder: false };
  assert.equal(inputProblem(ok), null);
  assert.equal(inputProblem({ ...ok, failOn: "unavailable" }), null);
  assert.match(inputProblem({ ...ok, command: "nope" }), /command must be gate or watch/);
  assert.match(inputProblem({ ...ok, command: undefined }), /command must be gate or watch/);
  assert.match(inputProblem({ ...ok, target: "" }), /needs a target/);
  assert.match(inputProblem({ ...ok, failOn: "maybe" }), /fail-on must be fail or unavailable/);
  assert.match(inputProblem({ ...ok, issues: "maybe" }), /issues must be true or false/);
  assert.match(inputProblem({ ...ok, issues: "true" }), /watch only/);
  const watch = { command: "watch", target: "", failOn: "maybe", issues: "true", rootIsFolder: true };
  assert.equal(inputProblem(watch), null, "fail-on and target are not the watch's business");
  assert.match(inputProblem({ ...watch, rootIsFolder: false }), /root must name a folder/);
});

test("inputs, as the Action runs it: exit 2 with the reason as an error annotation, exit 0 when they can run", () => {
  const dir = mkdtempSync(join(tmpdir(), "plumbline-inputs-"));
  try {
    writeFileSync(join(dir, "a-file"), "");
    const inputs = (env) =>
      spawnSync(process.execPath, [script, "inputs"], {
        env: { ...process.env, GITHUB_WORKSPACE: dir, PLUMBLINE_ISSUES: "false", PLUMBLINE_FAIL_ON: "fail", PLUMBLINE_TARGET: "", ...env },
        encoding: "utf8",
      });
    assert.equal(inputs({ PLUMBLINE_COMMAND: "watch", PLUMBLINE_ROOT: "." }).status, 0);
    const file = inputs({ PLUMBLINE_COMMAND: "watch", PLUMBLINE_ROOT: "a-file" });
    assert.equal(file.status, 2);
    assert.match(file.stderr, /^::error::root must name a folder/);
    assert.equal(inputs({ PLUMBLINE_COMMAND: "watch", PLUMBLINE_ROOT: "missing" }).status, 2);
    assert.equal(inputs({ PLUMBLINE_COMMAND: "nope" }).status, 2);
    assert.equal(inputs({ PLUMBLINE_COMMAND: "gate", PLUMBLINE_TARGET: "https://example.com/" }).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const block = { kind: "runtime", severity: "block", ref: "runtime/engine.js", summary: "changed" };
const warn = { kind: "peer", severity: "warn", ref: "https://peer.example/a", summary: "unreachable after 10 s" };
const runUrl = "https://github.com/o/r/actions/runs/7";
const issueOf = (report, number = 4) => ({ number, title: ISSUE_TITLE, body: issueBody(report) });

test("the digest: severity, kind and ref, block first, no duplicates, no summary; it survives the body round trip", () => {
  const report = { findings: [warn, block, { ...warn, summary: "unreachable after 12 s" }, drift.findings[2]] };
  const digest = digestOf(report);
  assert.deepEqual(digest, [
    ["block", "runtime", "runtime/engine.js"],
    ["warn", "peer", "https://peer.example/a"],
  ]);
  assert.deepEqual(readDigest(issueBody(report)), digest);
  // A ref that would end an HTML comment early cannot: < and > are escaped inside the marker.
  const sly = { findings: [{ ...warn, ref: "https://peer.example/--><b>x</b>" }] };
  assert.match(digestMarker(digestOf(sly)), /^<!-- plumbline:digest [^>]*-->$/);
  assert.deepEqual(readDigest(issueBody(sly)), [["warn", "peer", "https://peer.example/--><b>x</b>"]]);
  assert.equal(readDigest("no marker here"), null);
  assert.equal(readDigest("<!-- plumbline:digest {not json} -->"), null);
});

test("the issue decision: create, edit with a comment, a quiet edit, none, close", () => {
  const warnOnly = { findings: [warn] };
  const both = { findings: [warn, block] };
  const plan = (report, open) => issuePlan({ findings: openFindings(report).length, body: issueBody(report), open, runUrl });

  // findings and no open issue: create, under the one title
  assert.deepEqual(plan(warnOnly, []), { action: "create", title: ISSUE_TITLE });
  assert.deepEqual(plan(warnOnly, [{ number: 9, title: "Plumbline drift (old)", body: "" }]), { action: "create", title: ISSUE_TITLE });

  // a block arrives under an open warn issue: edit the body AND comment, the block said first
  const changed = plan(both, [issueOf(warnOnly)]);
  assert.equal(changed.action, "edit");
  assert.equal(changed.number, 4);
  assert.match(changed.comment, /^\*\*A new `block` finding\.\*\*/);
  assert.match(changed.comment, /New:\n\n- \*\*block\*\* runtime `runtime\/engine\.js`\n/);
  assert.doesNotMatch(changed.comment, /No longer reported/);
  assert.ok(changed.comment.includes(runUrl));

  // a finding goes away: still a comment, naming it, and no block alarm
  const gone = plan(warnOnly, [issueOf(both)]);
  assert.match(gone.comment, /No longer reported:\n\n- \*\*block\*\* runtime/);
  assert.doesNotMatch(gone.comment, /new `block`/);

  // only a summary's wording moved: edit the body quietly, no comment
  const reworded = { findings: [{ ...warn, summary: "unreachable after 12 s" }] };
  assert.deepEqual(plan(reworded, [issueOf(warnOnly)]), { action: "edit", number: 4 });

  // nothing changed (even with CRLF line ends from the API): none
  const same = issueOf(warnOnly);
  assert.deepEqual(plan(warnOnly, [same]), { action: "none", number: 4 });
  assert.deepEqual(plan(warnOnly, [{ ...same, body: same.body.replace(/\n/g, "\r\n").trimEnd() }]), { action: "none", number: 4 });

  // clean with an open issue: close with a comment linking the run; clean with none: none
  const closed = plan({ findings: [] }, [issueOf(warnOnly)]);
  assert.equal(closed.action, "close");
  assert.equal(closed.number, 4);
  assert.match(closed.comment, /clean as of https:\/\/github\.com\/o\/r\/actions\/runs\/7/);
  assert.deepEqual(plan({ findings: [] }, []), { action: "none" });
});

test("an issue written before the digest gets one comment listing everything, block first; a missing count is an error", () => {
  const both = { findings: [warn, block] };
  const old = { number: 4, title: ISSUE_TITLE, body: "| warn | peer | https://peer.example/a | unreachable |" };
  const p = issuePlan({ findings: 2, body: issueBody(both), open: [old], runUrl });
  assert.equal(p.action, "edit");
  assert.match(p.comment, /^\*\*A new `block` finding\.\*\*[\s\S]*held no record[\s\S]*- \*\*block\*\*[\s\S]*- \*\*warn\*\*/);
  assert.throws(() => issuePlan({ findings: Number.NaN, body: "", open: [], runUrl }), /not a number/);
});

test("issue, as the Action runs it: action, number and comment path in GITHUB_OUTPUT; a bad count exits 2", () => {
  const both = { findings: [warn, block] };
  const r = run(["issue", "2", "@body.md", "@open.json", "@comment.md"], {
    "body.md": issueBody(both),
    "open.json": JSON.stringify([issueOf({ findings: [warn] }, 12)]),
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.output, `action=edit\nnumber=12\ncomment=${join(r.dir, "comment.md")}\n`);
  for (const count of ["", "two"]) {
    const bad = run(["issue", count, "@body.md", "@open.json", "@comment.md"], { "body.md": "", "open.json": "[]" });
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /cannot decide on the drift issue/);
    assert.equal(bad.output, undefined);
  }
});

// The Action's two issue steps, run as written in action.yml by bash, with a stub `gh` on PATH that logs its calls and
// serves the open issues. No network. On Windows, `bash` may be WSL's: set PLUMBLINE_TEST_BASH to Git Bash to run it.
const bash = process.env.PLUMBLINE_TEST_BASH ?? (process.platform === "win32" ? undefined : "bash");

/** The `run: |` block of the composite step with this name, dedented. */
function stepScript(name) {
  const lines = read("action/action.yml").split("\n");
  const start = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  assert.ok(start >= 0, `action.yml has the step ${name}`);
  const runAt = lines.findIndex((l, i) => i > start && l.trim() === "run: |");
  const indent = lines[runAt + 1].match(/^ */)[0].length;
  const body = [];
  for (const l of lines.slice(runAt + 1)) {
    if (l.trim() !== "" && l.match(/^ */)[0].length < indent) break;
    body.push(l.slice(indent));
  }
  return body.join("\n");
}

test("the Action's issue steps, run by bash against a stub gh: a new block edits the issue and comments; clean closes it", { skip: !bash && "no POSIX bash (set PLUMBLINE_TEST_BASH)" }, () => {
  const plan = stepScript("Decide on the drift issue");
  const apply = stepScript("Open, edit or close the drift issue");
  const dir = mkdtempSync(join(tmpdir(), "plumbline-issue-steps-"));
  try {
    const stubs = join(dir, "bin");
    mkdirSync(stubs);
    writeFileSync(join(stubs, "gh"), '#!/usr/bin/env bash\nprintf \'%s\\n\' "$*" >> "$GH_LOG"\nif [ "$1 $2" = "issue list" ]; then cat "$GH_OPEN"; fi\n', { mode: 0o755 });
    const steps = (report, open) => {
      const body = join(dir, "body.md");
      const out = join(dir, "out");
      const log = join(dir, "gh.log");
      writeFileSync(body, issueBody(report));
      writeFileSync(join(dir, "open.json"), JSON.stringify(open));
      for (const f of [out, log]) writeFileSync(f, "");
      const env = {
        ...process.env,
        PATH: `${stubs}${delimiter}${process.env.PATH}`,
        GH_LOG: log,
        GH_OPEN: join(dir, "open.json"),
        GITHUB_ACTION_PATH: here,
        GITHUB_OUTPUT: out,
        RUNNER_TEMP: dir,
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_REPOSITORY: "o/r",
        GITHUB_RUN_ID: "7",
        FINDINGS: String(openFindings(report).length),
        BODY: body,
      };
      const first = spawnSync(bash, ["-eo", "pipefail", "-c", plan], { env, encoding: "utf8" });
      assert.equal(first.status, 0, first.stderr);
      const outputs = Object.fromEntries(readFileSync(out, "utf8").trim().split("\n").map((l) => l.split(/=(.*)/s).slice(0, 2)));
      const second = spawnSync(bash, ["-eo", "pipefail", "-c", apply], {
        env: { ...env, ISSUE_ACTION: outputs.action, NUMBER: outputs.number, COMMENT: outputs.comment },
        encoding: "utf8",
      });
      assert.equal(second.status, 0, second.stderr);
      return { outputs, calls: readFileSync(log, "utf8").trim().split("\n").slice(1), comment: outputs.comment ? readFileSync(outputs.comment, "utf8") : "" };
    };

    const created = steps({ findings: [warn] }, []);
    assert.equal(created.outputs.action, "create");
    assert.deepEqual(created.calls, [`issue create --title ${ISSUE_TITLE} --body-file ${join(dir, "body.md")}`]);

    const changed = steps({ findings: [warn, block] }, [issueOf({ findings: [warn] }, 5)]);
    assert.deepEqual(changed.calls, [`issue edit 5 --body-file ${join(dir, "body.md")}`, `issue comment 5 --body-file ${changed.outputs.comment}`]);
    assert.match(changed.comment, /^\*\*A new `block` finding\.\*\*/);

    const unchanged = steps({ findings: [warn] }, [issueOf({ findings: [warn] }, 5)]);
    assert.deepEqual(unchanged.calls, [], "an unchanged run stays quiet");

    const closed = steps({ findings: [] }, [issueOf({ findings: [warn] }, 5)]);
    assert.equal(closed.calls.length, 1);
    assert.match(closed.calls[0], /^issue close 5 --comment Plumbline watch is clean as of https:\/\/github\.com\/o\/r\/actions\/runs\/7/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a report whose lock is not found is never clean: no lock keeps the issue open with the init advice", async () => {
  const { openFindings, issueBody } = await import("./report.mjs");
  const absent = { findings: [], lockState: "absent", lockSummary: "There is no plumbline.lock.json." };
  assert.equal(openFindings(absent).length, 1);
  assert.match(issueBody(absent), /There is no lock yet/);
  const unusable = { findings: [], lockState: "unusable", lockSummary: "The lock is not JSON." };
  assert.equal(openFindings(unusable)[0].summary, "The lock is not JSON.");
  assert.equal(openFindings({ findings: [], lockState: "found" }).length, 0, "a found lock with no findings is clean");
});


// ---- D10: the publisher's loop: one pull request that accepts drift (relock-pr) or renews the signature (renew) ----

const { PR_BRANCHES, PR_TITLES, prBody, prPlan, renewNeeded, signedKid } = await import("./report.mjs");
const relockOut = { relocked: true, previous: "found", changes: { added: ["peer https://new.example/p"], removed: [], changed: ["grounding pages/prices.html"] }, findings: [] };
const peerChange = {
  kind: "peer",
  severity: "block",
  ref: "https://peer.example/a",
  summary:
    "A peer's network definition changed since the lock was written; it runs in the visitor's browser, so a changed one is changed code. In outline: agents: 1 added, 0 removed, 0 changed; outbound hosts: 1 added, 0 removed; front agent: unchanged.",
};
const expiring = { kind: "grounding", severity: "warn", ref: "plumbline.signature.json", summary: "The site's signature expires on 2026-12-01, in 9 days; sign the site again before then." };

test("pull request inputs: relock-pr and renew with watch only, never both; renew and signing need a key and an https origin", () => {
  const ok = { command: "watch", target: "", failOn: "fail", issues: "false", rootIsFolder: true };
  assert.equal(inputProblem({ ...ok, relockPr: "true" }), null, "relock-pr without a key: a draft to sign locally");
  assert.equal(inputProblem({ ...ok, relockPr: "true", signingKey: true, origin: "https://example.org" }), null);
  assert.equal(inputProblem({ ...ok, renew: "true", signingKey: true, origin: "https://example.org" }), null);
  const cases = [
    [{ ...ok, relockPr: "yes" }, /relock-pr must be true or false/],
    [{ ...ok, renew: "1" }, /renew must be true or false/],
    [{ ...ok, command: "gate", target: "https://x.example/", relockPr: "true" }, /watch only/],
    [{ ...ok, relockPr: "true", renew: "true", signingKey: true, origin: "https://example.org" }, /separate workflows/],
    [{ ...ok, renew: "true" }, /renew: true needs signing-key/],
    [{ ...ok, relockPr: "true", signingKey: true, origin: "http://example.org" }, /signing needs origin/],
    [{ ...ok, relockPr: "true", signingKey: true, origin: "https://example.org/" }, /signing needs origin/],
    [{ ...ok, signingKey: true, origin: "https://example.org" }, /signing-key goes with relock-pr or renew/],
  ];
  for (const [input, message] of cases) assert.match(inputProblem(input) ?? "", message, JSON.stringify(input));
});

test("renewNeeded reads the signature-expiry finding; signedKid takes only a kid in its pattern", () => {
  assert.equal(renewNeeded({ findings: [expiring] }), true);
  assert.equal(renewNeeded({ findings: [{ ...expiring, severity: "block", summary: "The site's signature expired on 2026-11-01; verifiers now answer invalid (expired)." }] }), true);
  assert.equal(renewNeeded({ findings: [warn, block] }), false);
  assert.equal(renewNeeded({ findings: [{ ...expiring, summary: "The site's signature file has no readable expiry, so the watch cannot say when it lapses." }] }), false, "an unreadable expiry is the issue's, not a renewal");
  assert.equal(signedKid({ kid: "0123456789abcdef" }), "0123456789abcdef");
  assert.equal(signedKid({ kid: "<b>" }), null);
  assert.equal(signedKid(null), null);
});

test("the relock body: what the new lock changes, the findings it accepts with their counts, and the signing state", () => {
  const signed = prBody({ mode: "relock", report: { findings: [peerChange, drift.findings[2]] }, relock: relockOut, kid: "0123456789abcdef", runUrl });
  assert.match(signed, /^- added `peer https:\/\/new\.example\/p`$/m);
  assert.match(signed, /^- changed `grounding pages\/prices\.html`$/m);
  assert.match(signed, /In outline: agents: 1 added/);
  assert.doesNotMatch(signed, /Upstream is ahead/, "info stays out");
  assert.match(signed, /Signed in this run with the key in the workflow's secret \(kid `0123456789abcdef`\)/);
  assert.match(signed, /Nothing is accepted until a person merges this/);
  const unsigned = prBody({ mode: "relock", report: { findings: [peerChange] }, relock: relockOut, kid: null, runUrl });
  assert.match(unsigned, /\*\*Not signed\.\*\* .*It stays a draft until then\./);
  const renew = prBody({ mode: "renew", report: { findings: [expiring, warn] }, relock: null, kid: "0123456789abcdef", runUrl });
  assert.match(renew, /expires on 2026-12-01/);
  assert.doesNotMatch(renew, /peer\.example/, "a renewal lists the expiry only");
});

test("UAT-2: the relock body says what the relock does not accept (a stale fact, a kept pin) and does not list it as accepted", () => {
  const stale = { kind: "grounding", severity: "warn", ref: "rooms.html", summary: "A grounding source changed since the lock was written; 1 of 7 facts the lock watches on it (facts the network states) is no longer on it, and the network still states it (1 price), so the agent may now answer with an old fact." };
  const notAccepted = { kind: "grounding", severity: "warn", ref: "rooms.html", summary: "Not accepted: the network still states 1 fact this page no longer states (1 price), and no other locked page states it, so the agent may answer with an old fact." };
  const body = prBody({ mode: "relock", report: { findings: [stale, peerChange] }, relock: { ...relockOut, findings: [notAccepted, { kind: "runtime", severity: "info", ref: "x", summary: "info stays out" }] }, kid: null, runUrl });
  const notSection = body.slice(body.indexOf("**What this relock does not accept"), body.indexOf("**The findings this accepts"));
  assert.match(notSection, /\| warn \| grounding \| rooms\.html \| Not accepted: the network still states 1 fact this page no longer states \(1 price\)/);
  assert.doesNotMatch(notSection, /info stays out/);
  const accepts = body.slice(body.indexOf("**The findings this accepts"), body.indexOf("**Not signed"));
  assert.doesNotMatch(accepts, /rooms\.html/, "a ref the relock kept is not listed as accepted");
  assert.match(accepts, /peer\.example/);
  assert.doesNotMatch(prBody({ mode: "relock", report: { findings: [peerChange] }, relock: relockOut, kid: null, runUrl }), /does not accept/);
});

test("UAT-6: new evidence for a finding already on the open issue is news: a comment naming the ref and its sentence", () => {
  const changed = (actual, summary = peerChange.summary) => ({ ...peerChange, expected: "e".repeat(64), actual, summary });
  const first = { findings: [changed("a".repeat(64))] };
  // the partner changed again with the same counts (a fee change): only the hash moved
  const again = { findings: [changed("b".repeat(64))] };
  const plan = issuePlan({ findings: 1, body: issueBody(again), open: [issueOf(first, 3)], runUrl, report: again });
  assert.equal(plan.action, "edit");
  assert.match(plan.comment, /^\*\*A new `block` finding\.\*\*/);
  assert.match(plan.comment, /New:\n\n- \*\*block\*\* peer `https:\/\/peer\.example\/a`: A peer's network definition changed since the lock was written; .*In outline: agents: 1 added/);
  assert.doesNotMatch(plan.comment, /No longer reported/, "the earlier evidence is replaced, not gone");
  // a links.json that appears beside a changed definition: a second block row for the same peer
  const links = { kind: "peer", severity: "block", ref: peerChange.ref, expected: "absent", actual: "c".repeat(64), summary: "A peer now publishes a links.json it did not have when locked; the runtime lays it over the peer's links, so this is changed code." };
  const withLinks = { findings: [changed("a".repeat(64)), links] };
  const linksPlan = issuePlan({ findings: 2, body: issueBody(withLinks), open: [issueOf(first, 3)], runUrl, report: withLinks });
  assert.match(linksPlan.comment, /New:\n\n- \*\*block\*\* peer `https:\/\/peer\.example\/a`: A peer now publishes a links\.json/);
  // a page that changed again (a price after a wording edit): warn, new evidence, a comment
  const page = (actual, summary) => ({ findings: [{ kind: "grounding", severity: "warn", ref: "rooms.html", expected: "e".repeat(64), actual, summary }] });
  const cosmetic = page("1".repeat(64), "all 7 facts ... are still on it");
  const raised = page("2".repeat(64), "1 of 7 facts ... is no longer on it, and the network still states it (1 price)");
  const pagePlan = issuePlan({ findings: 1, body: issueBody(raised), open: [issueOf(cosmetic, 3)], runUrl, report: raised });
  assert.match(pagePlan.comment, /New:\n\n- \*\*warn\*\* grounding `rooms\.html`: 1 of 7 facts/);
  // an unreachable peer is still unreachable after 12 s instead of 10 s: no evidence, no news
  const slow = (summary) => ({ findings: [{ ...warn, summary }] });
  assert.equal(issuePlan({ findings: 1, body: issueBody(slow("unreachable after 12 s")), open: [issueOf(slow("unreachable after 10 s"), 3)], runUrl }).comment, undefined);
  // an issue written before evidence was carried: the first run after the upgrade is not news
  const oldBody = issueBody(first).replace(/<!-- plumbline:digest .* -->/, digestMarker([["block", "peer", peerChange.ref]]));
  assert.equal(issuePlan({ findings: 1, body: issueBody(first), open: [{ number: 3, title: ISSUE_TITLE, body: oldBody }], runUrl }).comment, undefined);
});

test("UAT-6: the relock body carries the findings' evidence, so a partner that changed again with the same counts edits the pull request", () => {
  const at = (actual) => ({ findings: [{ ...peerChange, actual }] });
  const body1 = prBody({ mode: "relock", report: at("a".repeat(64)), relock: relockOut, kid: null, runUrl });
  const body2 = prBody({ mode: "relock", report: at("b".repeat(64)), relock: relockOut, kid: null, runUrl: "https://github.com/o/r/actions/runs/8" });
  assert.equal(prPlan({ mode: "relock", wanted: true, body: body2, signed: false, open: [{ number: 3, body: body1, isDraft: true }], runUrl }).action, "edit");
  const body3 = prBody({ mode: "relock", report: at("a".repeat(64)), relock: relockOut, kid: null, runUrl: "https://github.com/o/r/actions/runs/9" });
  assert.equal(prPlan({ mode: "relock", wanted: true, body: body3, signed: false, open: [{ number: 3, body: body1, isDraft: true }], runUrl }).action, "none", "the same evidence from a later run is no news");
});

test("UAT-2: the close comment says what clean covers, the site's own signature included", () => {
  const plan = issuePlan({ findings: 0, body: "", open: [issueOf({ findings: [warn] }, 5)], runUrl });
  assert.match(plan.comment, /and the site's signature, if it has one, still covers its files\. Closing\./);
});

test("the pull request decision: create (a draft when unsigned), none for the same body, edit, close when nothing is wanted", () => {
  const body = prBody({ mode: "relock", report: { findings: [peerChange] }, relock: relockOut, kid: null, runUrl });
  assert.deepEqual(prPlan({ mode: "relock", wanted: true, body, signed: false, open: [], runUrl }), { action: "create", draft: true, title: PR_TITLES.relock, branch: PR_BRANCHES.relock });
  assert.equal(prPlan({ mode: "relock", wanted: true, body, signed: true, open: [], runUrl }).draft, false);
  // the same body from a later run (another run address): nothing is pushed, nobody is notified
  const later = body.replace(runUrl, "https://github.com/o/r/actions/runs/8");
  assert.deepEqual(prPlan({ mode: "relock", wanted: true, body: later, signed: false, open: [{ number: 3, body, isDraft: true }], runUrl }), { action: "none", number: 3, draft: true });
  // a new change, or now signed: edit (pushed again), with the draft state it must be in
  const more = prBody({ mode: "relock", report: { findings: [peerChange, block] }, relock: relockOut, kid: null, runUrl });
  assert.deepEqual(prPlan({ mode: "relock", wanted: true, body: more, signed: false, open: [{ number: 3, body, isDraft: true }], runUrl }), {
    action: "edit",
    number: 3,
    draft: true,
    branch: PR_BRANCHES.relock,
  });
  assert.equal(prPlan({ mode: "relock", wanted: true, body, signed: true, open: [{ number: 3, body, isDraft: true }], runUrl }).action, "edit", "signed now: ready for review");
  const closed = prPlan({ mode: "renew", wanted: false, body, signed: true, open: [{ number: 9, body, isDraft: false }], runUrl });
  assert.deepEqual([closed.action, closed.number], ["close", 9]);
  assert.match(closed.comment, /no longer finds anything to renew as of https:\/\/github\.com\/o\/r\/actions\/runs\/7/);
  assert.equal(prPlan({ mode: "relock", wanted: false, body, signed: false, open: [], runUrl }).action, "none");
  assert.throws(() => prPlan({ mode: "merge", wanted: true, body, signed: true, open: [], runUrl }));
});

test("pr, as the Action runs it: wanted only for open drift whose relock changed a ref; outputs in GITHUB_OUTPUT; a broken report exits 2", () => {
  const files = { "report.json": JSON.stringify({ lockState: "found", findings: [peerChange] }), "relock.json": JSON.stringify(relockOut), "open.json": "[]" };
  const r = run(["pr", "relock", "@report.json", "@relock.json", "-", "@open.json", "@body.md", "@comment.md"], files);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.output, /^action=create\nnumber=\ndraft=true\ntitle=Plumbline: accept the drift \(relock\)\nbranch=plumbline\/relock\nbody=.*body\.md\ncomment=\n$/);
  const nothing = run(["pr", "relock", "@report.json", "@relock.json", "-", "@open.json", "@body.md", "@comment.md"], {
    ...files,
    "relock.json": JSON.stringify({ changes: { added: [], removed: [], changed: [] } }),
  });
  assert.match(nothing.output, /^action=none\n/, "a relock that changes no ref has nothing to accept");
  const clean = run(["pr", "renew", "@report.json", "-", "-", "@open.json", "@body.md", "@comment.md"], { ...files, "report.json": JSON.stringify({ lockState: "found", findings: [] }) });
  assert.match(clean.output, /^action=none\n/);
  const broken = run(["pr", "relock", "@report.json", "-", "-", "@open.json", "@body.md", "@comment.md"], { ...files, "report.json": "{}" });
  assert.equal(broken.status, 2);
  assert.match(broken.stderr, /cannot decide on the pull request/);
});

test(
  "the Action's pull request step, run by bash against stub gh and git: create pushes the branch and opens a draft; close only comments",
  { skip: !bash && "no POSIX bash (set PLUMBLINE_TEST_BASH)" },
  () => {
    const apply = stepScript("Open, update or close the pull request");
    const dir = mkdtempSync(join(tmpdir(), "plumbline-pr-steps-"));
    try {
      const stubs = join(dir, "bin");
      mkdirSync(stubs);
      for (const tool of ["gh", "git"]) writeFileSync(join(stubs, tool), `#!/usr/bin/env bash\nprintf '${tool} %s\\n' "$*" >> "$TOOL_LOG"\n`, { mode: 0o755 });
      const workspace = join(dir, "ws");
      mkdirSync(join(workspace, "site"), { recursive: true });
      writeFileSync(join(workspace, "site", "plumbline.lock.json"), "{}");
      writeFileSync(join(dir, "body.md"), "body");
      writeFileSync(join(dir, "comment.md"), "no longer needed");
      const steps = (vars) => {
        const log = join(dir, "tools.log");
        writeFileSync(log, "");
        const env = {
          ...process.env,
          PATH: `${stubs}${delimiter}${process.env.PATH}`,
          TOOL_LOG: log,
          GITHUB_WORKSPACE: workspace,
          GH_TOKEN: "t0ken",
          GH_REPO: "o/r",
          TITLE: PR_TITLES.relock,
          BRANCH: PR_BRANCHES.relock,
          BODY: join(dir, "body.md"),
          COMMENT: join(dir, "comment.md"),
          PLUMBLINE_ROOT: "site",
          NUMBER: "",
          ...vars,
        };
        // Git Bash puts its own folders (with a real git) before the PATH it was given: put the stubs first inside bash
        const prefix = 'PATH="$(cygpath -u "$STUB_DIR" 2>/dev/null || printf %s "$STUB_DIR"):$PATH"\n';
        const r = spawnSync(bash, ["-eo", "pipefail", "-c", prefix + apply], { env: { ...env, STUB_DIR: stubs }, encoding: "utf8" });
        assert.equal(r.status, 0, r.stderr);
        return readFileSync(log, "utf8").trim().split("\n").filter(Boolean);
      };
      const created = steps({ PR_ACTION: "create", DRAFT: "true" });
      assert.deepEqual(created.slice(0, 2), ["git add -- site/plumbline.lock.json", `git -c user.name=github-actions[bot] -c user.email=41898282+github-actions[bot]@users.noreply.github.com commit -m ${PR_TITLES.relock} --quiet`]);
      assert.ok(created.some((l) => l.startsWith("git push --quiet --force-with-lease=refs/heads/plumbline/relock:") && l.endsWith("HEAD:refs/heads/plumbline/relock")), created.join("\n"));
      assert.equal(created[created.length - 1], `gh pr create --draft --head plumbline/relock --title ${PR_TITLES.relock} --body-file ${join(dir, "body.md")}`);
      const edited = steps({ PR_ACTION: "edit", DRAFT: "false", NUMBER: "3" });
      assert.deepEqual(edited.slice(-2), [`gh pr edit 3 --body-file ${join(dir, "body.md")}`, "gh pr ready 3"]);
      const closed = steps({ PR_ACTION: "close", DRAFT: "false", NUMBER: "3" });
      assert.deepEqual(closed, ["gh pr close 3 --comment no longer needed"], "closing pushes nothing");
      assert.deepEqual(steps({ PR_ACTION: "none", DRAFT: "false" }), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

// UAT-5: the push, with the real git against a local bare remote behind the Action's own URL (url.<remote>.insteadOf,
// given through GIT_CONFIG_* so no config file is written) and a stub gh. The branch is created, replaced on a second
// run while it exists, and replaced again after a merged pull request whose branch was kept; the same for renewal.
test(
  "the Action's pull request push, with the real git: create, a second drift on the existing branch, and a run after a merge whose branch remains all push",
  { skip: !bash && "no POSIX bash (set PLUMBLINE_TEST_BASH)" },
  () => {
    const apply = stepScript("Open, update or close the pull request");
    const dir = mkdtempSync(join(tmpdir(), "plumbline-pr-push-"));
    const g = (cwd, ...args) => {
      const r = spawnSync("git", ["-c", "core.autocrlf=false", "-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { cwd, encoding: "utf8" });
      assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
      return r.stdout.trim();
    };
    try {
      const stubs = join(dir, "bin");
      mkdirSync(stubs);
      writeFileSync(join(stubs, "gh"), `#!/usr/bin/env bash\nprintf 'gh %s\\n' "$*" >> "$TOOL_LOG"\n`, { mode: 0o755 });
      const remote = join(dir, "remote.git").replace(/\\/g, "/");
      const seed = join(dir, "seed");
      mkdirSync(join(seed, "site"), { recursive: true });
      writeFileSync(join(seed, "site", "plumbline.lock.json"), '{"v":0}\n');
      g(dir, "init", "--quiet", "--bare", "-b", "main", remote);
      g(seed, "init", "--quiet", "-b", "main");
      g(seed, "add", "-A");
      g(seed, "commit", "--quiet", "-m", "seed");
      g(seed, "push", "--quiet", remote, "HEAD:refs/heads/main");
      const run = (label, mode, lock, prAction) => {
        const ws = join(dir, `ws-${label}`);
        g(dir, "clone", "--quiet", remote, ws);
        const branch = mode === "relock" ? PR_BRANCHES.relock : PR_BRANCHES.renew;
        g(ws, "switch", "--quiet", "-C", branch);
        writeFileSync(join(ws, "site", "plumbline.lock.json"), lock);
        const log = join(dir, `${label}.log`);
        writeFileSync(log, "");
        const env = {
          ...process.env,
          TOOL_LOG: log,
          STUB_DIR: stubs,
          GITHUB_WORKSPACE: ws.replace(/\\/g, "/"),
          GH_TOKEN: "t0ken",
          GH_REPO: "o/r",
          TITLE: PR_TITLES[mode],
          BRANCH: branch,
          BODY: join(dir, "body.md"),
          COMMENT: join(dir, "comment.md"),
          PLUMBLINE_ROOT: "site",
          PR_ACTION: prAction,
          DRAFT: "true",
          NUMBER: prAction === "edit" ? "3" : "",
          GIT_CONFIG_COUNT: "2",
          GIT_CONFIG_KEY_0: `url.${remote}.insteadOf`,
          GIT_CONFIG_VALUE_0: "https://x-access-token:t0ken@github.com/o/r.git",
          GIT_CONFIG_KEY_1: "core.autocrlf",
          GIT_CONFIG_VALUE_1: "false",
        };
        const prefix = 'PATH="$(cygpath -u "$STUB_DIR" 2>/dev/null || printf %s "$STUB_DIR"):$PATH"\n';
        const r = spawnSync(bash, ["-eo", "pipefail", "-c", prefix + apply], { env, encoding: "utf8" });
        assert.equal(r.status, 0, `${label}: ${r.stderr}`);
        return readFileSync(log, "utf8").trim().split("\n");
      };
      writeFileSync(join(dir, "body.md"), "body");
      const lockOn = (branch) => spawnSync("git", ["--git-dir", remote, "show", `refs/heads/${branch}:site/plumbline.lock.json`], { encoding: "utf8" }).stdout;
      for (const mode of ["relock", "renew"]) {
        const branch = PR_BRANCHES[mode];
        const v = (n) => `{"${mode}":${n}}\n`;
        assert.match(run(`${mode}-1`, mode, v(1), "create").at(-1), /^gh pr create --draft --head /);
        assert.equal(lockOn(branch), v(1), "the first run pushed the branch");
        assert.deepEqual(run(`${mode}-2`, mode, v(2), "edit").slice(0, 1), ["gh pr edit 3 --body-file " + join(dir, "body.md")]);
        assert.equal(lockOn(branch), v(2), "a second drift replaced the existing branch");
        // a person merges the pull request on main; the branch is kept
        const merger = join(dir, `merge-${mode}`);
        g(dir, "clone", "--quiet", remote, merger);
        g(merger, "merge", "--quiet", "--no-edit", `origin/${branch}`);
        g(merger, "push", "--quiet", "origin", "HEAD:refs/heads/main");
        run(`${mode}-3`, mode, v(3), "create");
        assert.equal(lockOn(branch), v(3), "after a merge whose branch remains, a new run replaced it");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
