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

