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
  assert.equal(
    summary,
    "### Plumbline gate: unavailable\nChecked by 1 of 2 (validator pass); Atlas had no verdict.\n- **validator**: pass. port: 0 problems\n- **atlas**: unavailable. timed out\n- **signature**: not checked. This gate checks the site's signature only with `--trust <your trust file>`; `plumbline verify` checks it too.\n",
  );
  assert.equal(gateOutputs(undefined).state, "unknown");
});

test("UAT-10 (PRI-L1-14): the gate summary says the signature's verdict when the report carries one, and that it was not checked when not", () => {
  const findings = [{ adapter: "validator", state: "pass", summary: "port: 0 problems" }];
  const tampered = gateOutputs({ state: "pass", findings, signature: { verdict: "invalid", reason: "tampered", detail: "A signed file differs from the version that was signed: a.json." } });
  assert.match(tampered.summary, /\n- \*\*signature\*\*: invalid tampered\. A signed file differs from the version that was signed: a\.json\.\n$/);
  assert.match(gateOutputs({ state: "pass", findings, signature: { verdict: "verified", detail: "ok | fine" } }).summary, /- \*\*signature\*\*: verified\. ok \\\| fine\n$/);
  assert.match(gateOutputs({ state: "pass", findings }).summary, /- \*\*signature\*\*: not checked\./);
  assert.match(gateOutputs({ state: "pass", findings, signature: { verdict: "green" } }).summary, /- \*\*signature\*\*: not checked\./, "an unknown verdict is not read as one");
  assert.doesNotMatch(gateOutputs(undefined).summary, /signature/);
});

function run(args, files) {
  const dir = mkdtempSync(join(tmpdir(), "plumbline-report-"));
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    const out = join(dir, "github-output");
    const summary = join(dir, "step-summary");
    // the run's folder is its workspace and site root: the site is signed when `files` holds a plumbline.signature.json
    const env = { ...process.env, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary, GITHUB_WORKSPACE: dir, PLUMBLINE_ROOT: "." };
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
  const r = run(["watch", "@report.json", "@body.md"], { "report.json": JSON.stringify(drift), "plumbline.signature.json": "{}" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.output, `findings=2\nissue-body=${join(r.dir, "body.md")}\n`);
  assert.equal(r.body, issueBody(drift));
  // UAT-12 (DEV-L1-04): a site that publishes no signature is not told to sign
  const keyless = run(["watch", "@report.json", "@body.md"], { "report.json": JSON.stringify(drift) });
  assert.equal(keyless.body, issueBody(drift, { siteSigned: false }));
  assert.doesNotMatch(keyless.body, /sign/i);
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
  assert.equal(
    ok.summary,
    "### Plumbline gate: pass\nChecked by 1 of 1 (validator pass).\n- **validator**: pass. ok\n- **signature**: not checked. This gate checks the site's signature only with `--trust <your trust file>`; `plumbline verify` checks it too.\n",
  );

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
  assert.match(inputProblem({ ...ok, command: "nope" }), /command must be gate, watch or agent/);
  assert.match(inputProblem({ ...ok, command: undefined }), /command must be gate, watch or agent/);
  assert.match(inputProblem({ ...ok, target: "" }), /needs a target/);
  // UAT-22: no target and a root folder: the gate checks the files there
  assert.equal(inputProblem({ ...ok, target: "", rootIsFolder: true }), null);
  assert.match(inputProblem({ ...ok, failOn: "maybe" }), /fail-on must be fail or unavailable/);
  assert.match(inputProblem({ ...ok, issues: "maybe" }), /issues must be true or false/);
  assert.match(inputProblem({ ...ok, issues: "true" }), /watch only/);
  const watch = { command: "watch", target: "", failOn: "fail", issues: "true", rootIsFolder: true };
  assert.equal(inputProblem(watch), null, "target is not the watch's business");
  assert.match(inputProblem({ ...watch, failOn: "maybe" }), /fail-on goes with command gate or agent only/, "a fail-on the watch would ignore is refused");
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
  assert.equal(inputProblem({ ...ok, renew: "true", signingKey: true, origin: "https://example.org" }), null);
  const cases = [
    [{ ...ok, relockPr: "yes" }, /relock-pr must be true or false/],
    [{ ...ok, renew: "1" }, /renew must be true or false/],
    [{ ...ok, command: "gate", target: "https://x.example/", relockPr: "true" }, /watch only/],
    [{ ...ok, relockPr: "true", renew: "true", signingKey: true, origin: "https://example.org" }, /separate workflows/],
    [{ ...ok, renew: "true" }, /renew: true needs signing-key/],
    [{ ...ok, renew: "true", signingKey: true, origin: "http://example.org" }, /signing needs origin/],
    [{ ...ok, renew: "true", signingKey: true, origin: "https://example.org/" }, /signing needs origin/],
    [{ ...ok, signingKey: true, origin: "https://example.org" }, /signing-key goes with renew only/],
    // UAT-34: CI never signs a relock before a person reviews it
    [{ ...ok, relockPr: "true", signingKey: true, origin: "https://example.org" }, /signing-key goes with renew only: CI never signs a relock before a person reviews it/],
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
  assert.match(unsigned, /\*\*Not signed: CI never signs a change before a person has reviewed it\.\*\* .*It stays a draft until then\./);
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
  // MAR-RC-3: the same sentence with new evidence is said as such, still a comment (it notifies), still led as a block
  assert.match(plan.comment, /^\*\*A `block` finding changed again\*\* \(new evidence; what it says is unchanged\)/);
  assert.match(plan.comment, /Changed again, and what the finding says is unchanged \(its sentence is in the table\):\n\n- \*\*block\*\* peer `https:\/\/peer\.example\/a`\n/);
  assert.doesNotMatch(plan.comment, /New:/);
  // with another sentence (other counts), it is new, with its sentence
  const recount = { findings: [changed("b".repeat(64), peerChange.summary.replace("agents: 1 added", "agents: 2 added"))] };
  const recountPlan = issuePlan({ findings: 1, body: issueBody(recount), open: [issueOf(first, 3)], runUrl, report: recount });
  assert.match(recountPlan.comment, /^\*\*A new `block` finding\.\*\*/);
  assert.match(recountPlan.comment, /New:\n\n- \*\*block\*\* peer `https:\/\/peer\.example\/a`: A peer's network definition changed since the lock was written; .*In outline: agents: 2 added/);
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
  const files = { "report.json": JSON.stringify({ lockState: "found", findings: [peerChange] }), "relock.json": JSON.stringify(relockOut), "open.json": "[]", "plumbline.signature.json": "{}" };
  const r = run(["pr", "relock", "@report.json", "@relock.json", "-", "@open.json", "@body.md", "@comment.md"], files);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.output, /^action=create\nnumber=\ndraft=true\ntitle=Plumbline: accept the drift \(relock\)\nbranch=plumbline\/relock\nbody=.*body\.md\ncomment=\n$/);
  // UAT-12: the same run on a site that publishes no signature opens a pull request that is not a draft
  const { "plumbline.signature.json": _signature, ...keylessFiles } = files;
  const keyless = run(["pr", "relock", "@report.json", "@relock.json", "-", "@open.json", "@body.md", "@comment.md"], keylessFiles);
  assert.match(keyless.output, /^action=create\nnumber=\ndraft=false\n/);
  assert.doesNotMatch(keyless.body ?? "", /sign/i);
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
      // UAT-4: a refused relock describes the open pull request and pushes nothing
      const described = steps({ PR_ACTION: "describe", DRAFT: "true", NUMBER: "3" });
      assert.deepEqual(described, [`gh pr edit 3 --body-file ${join(dir, "body.md")}`, `gh pr comment 3 --body-file ${join(dir, "comment.md")}`], "describing pushes nothing");
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

test("UAT-9: partly checked is not not checked: the Action summary words the three cases as the CLI does, nothing checked in the heading", async () => {
  const { gateSentence } = await import("./report.mjs");
  const healthy = {
    state: "unavailable",
    findings: [
      { adapter: "validator", state: "pass", summary: "The validator port found no problem: 1 network definition checked." },
      { adapter: "atlas", state: "unavailable", summary: "Agent Atlas could not connect to the target, so it has no verdict about the site." },
      { adapter: "customs", state: "unavailable", summary: "Unavailable: no receipt for this target in Agent Customs' published receipts." },
    ],
  };
  assert.equal(gateSentence(healthy), "checked by 1 of 3 (validator pass); Atlas and Customs had no verdict");
  assert.match(gateOutputs(healthy).summary, /^### Plumbline gate: unavailable\nChecked by 1 of 3 \(validator pass\); Atlas and Customs had no verdict\.\n/);
  const down = {
    state: "unavailable",
    findings: [
      { adapter: "validator", state: "unavailable", summary: "The validator port could not run: the target could not be reached (the connection failed)." },
      { adapter: "atlas", state: "unavailable", summary: "Agent Atlas could not connect to the target, so it has no verdict about the site." },
      { adapter: "customs", state: "unavailable", summary: "Agent Customs was not asked: the target could not be reached to learn its network address (the connection failed)." },
    ],
  };
  assert.equal(gateSentence(down), "the site could not be reached (the connection failed); nothing was checked, so this is not a pass");
  assert.match(gateOutputs(down).summary, /^### Plumbline gate: unavailable: the site could not be reached \(the connection failed\); nothing was checked, so this is not a pass\n/);
  const none = { state: "unavailable", findings: [{ adapter: "atlas", state: "unavailable", summary: "Agent Atlas answered HTTP 503, so there is no verdict." }] };
  assert.match(gateOutputs(none).summary, /^### Plumbline gate: unavailable: nothing was checked: every checker was unavailable, so this is not a pass\n/);
  // the same words as the built CLI's gate/context.ts, when it has been built (the cases above, word for word)
  const built = new URL("../dist/gate/context.js", import.meta.url);
  if (existsSync(built)) {
    const core = await import(built.href);
    for (const report of [healthy, down, none]) assert.equal(core.gateSentence(report), gateSentence(report));
  }
});

test("UAT-4: a refused relock (a signer change) is described on the open pull request, never pushed; with none open the issue says it", () => {
  const swap = {
    kind: "peer",
    severity: "block",
    ref: "https://seller.example/shop",
    expected: "aaaaaaaaaaaaaaaa",
    actual: "cccccccccccccccc",
    summary: "A peer is now signed by a different key than the one the lock recorded: a different key, with no rotation published. A relock refuses it until a person decides: watch --relock --accept-signer <this peer>.",
  };
  const refused = { relocked: false, refused: "signer", peers: [{ peer: swap.ref, from: "aaaaaaaaaaaaaaaa", to: "cccccccccccccccc", how: "a different key, with no rotation published" }] };
  const body = prBody({ mode: "relock", report: { findings: [swap] }, relock: refused, kid: null, runUrl });
  assert.match(body, /\*\*the relock was refused\*\*/);
  assert.match(body, /- `https:\/\/seller\.example\/shop`: the lock recorded `aaaaaaaaaaaaaaaa`; it is now signed by `cccccccccccccccc` \(a different key, with no rotation published\)/);
  assert.match(body, /--relock --accept-signer https:\/\/seller\.example\/shop --trust <your trust file>`/);
  assert.doesNotMatch(body, /What the new lock changes/);
  const open = [{ number: 4, body: "an earlier body", isDraft: true }];
  const plan = prPlan({ mode: "relock", wanted: false, body, signed: false, open, runUrl, refused: true });
  assert.deepEqual([plan.action, plan.number], ["describe", 4]);
  assert.match(plan.comment, /refused to relock/);
  assert.equal(prPlan({ mode: "relock", wanted: false, body, signed: false, open: [], runUrl, refused: true }).action, "none", "no pull request: the issue says it");
  const issue = issueBody({ findings: [swap] });
  assert.match(issue, /\*\*A relock refuses while a peer's signer changed\*\* \(`https:\/\/seller\.example\/shop`\)/);
  assert.match(issue, /watch --root <path to your site> --relock --accept-signer https:\/\/seller\.example\/shop --trust <your trust file>`/);
  assert.doesNotMatch(issueBody({ findings: [warn] }), /A relock refuses/);
});

test("TOM-RC-2: a signer that is gone is a held signer change: the pull request names it outside any 'keeps reporting' table, and the issue never closes over it", () => {
  const gone = {
    kind: "peer",
    severity: "block",
    ref: "https://seller.example/shop",
    expected: "aaaaaaaaaaaaaaaa",
    summary: "A peer the lock recorded as signed publishes no signature now (its plumbline.signature.json is not published), so nothing ties it to the key the lock recorded. A relock refuses it until a person decides: watch --relock --accept-signer <this peer>.",
  };
  const refused = { relocked: false, refused: "signer", peers: [{ peer: gone.ref, from: "aaaaaaaaaaaaaaaa", how: "it publishes no signature now" }], commands: [] };
  const body = prBody({ mode: "relock", report: { findings: [gone] }, relock: refused, kid: null, runUrl });
  assert.match(body, /\*\*the relock was refused\*\*/);
  assert.match(body, /nothing in this pull request removes or replaces a recorded signer/);
  assert.match(body, /- `https:\/\/seller\.example\/shop`: the lock recorded `aaaaaaaaaaaaaaaa`; it publishes no signature now \(it answers 404 or 410 for its signature\)/);
  assert.match(body, /- `node dist\/cli\/index\.js watch --root <path to your site> --relock --accept-signer https:\/\/seller\.example\/shop`/, "no --trust: there is no new key to back");
  assert.doesNotMatch(body, /keeps reporting after a merge|What the new lock changes/);
  // the issue: held, named, with the command; open while the watch reports it, and never closed as clean
  const issue = issueBody({ findings: [gone] });
  assert.match(issue, /\*\*A relock refuses while a peer's signer changed\*\* \(`https:\/\/seller\.example\/shop`\): CI never accepts a signer change, so nothing is relocked and this issue stays open until a person decides/);
  const open = [issueOf({ findings: [gone] }, 9)];
  assert.notEqual(issuePlan({ findings: 1, body: issue, open, runUrl }).action, "close");
  assert.equal(issuePlan({ findings: 1, body: issue, open, runUrl }).action, "none");
});

test("TOM-RC-3: the Action's pull request and issue give one command per peer, each narrowed when several wait, --trust where a new key needs backing", () => {
  const swap = (ref, actual) => ({ kind: "peer", severity: "block", ref, expected: "aaaaaaaaaaaaaaaa", actual, summary: "A peer is now signed by a different key than the one the lock recorded: x. A relock refuses it until a person decides: watch --relock --accept-signer <this peer>." });
  const issue = issueBody({ findings: [swap("https://a.example/s", "cccccccccccccccc"), swap("https://b.example/s", "dddddddddddddddd")] });
  const lines = issue.split("\n").filter((l) => l.includes("--accept-signer https://"));
  assert.deepEqual(lines, [
    "- `node dist/cli/index.js watch --root <path to your site> --relock --accept https://a.example/s --accept-signer https://a.example/s --trust <your trust file>`",
    "- `node dist/cli/index.js watch --root <path to your site> --relock --accept https://b.example/s --accept-signer https://b.example/s --trust <your trust file>`",
  ]);
  const refused = { relocked: false, refused: "signer", peers: [{ peer: "https://a.example/s", from: "aaaaaaaaaaaaaaaa", to: "cccccccccccccccc", how: "x" }, { peer: "https://b.example/s", from: "bbbbbbbbbbbbbbbb", how: "it publishes no signature now" }] };
  const body = prBody({ mode: "relock", report: { findings: [] }, relock: refused, kid: null, runUrl });
  assert.ok(!body.split("\n").some((l) => l.includes("--accept-signer https://a.example/s") && l.includes("--accept-signer https://b.example/s")), "no line accepts both");
  assert.match(body, /--accept https:\/\/b\.example\/s --accept-signer https:\/\/b\.example\/s`/);
});

test("TOM-RC-4: the relock pull request lists each signer it records for the first time", () => {
  const relock = { ...relockOut, firstSigners: [{ peer: "https://new.example/p", kid: "eeeeeeeeeeeeeeee", was: "added", backing: "not checked: no --trust file given" }, { peer: "https://old.example/p", kid: "ffffffffffffffff", was: "unsigned", backing: "not checked: no --trust file given" }] };
  const body = prBody({ mode: "relock", report: { findings: [peerChange] }, relock, kid: null, runUrl });
  assert.match(body, /\*\*Signers this lock records for the first time\*\*/);
  assert.match(body, /- `https:\/\/new\.example\/p`: first seen, recorded `eeeeeeeeeeeeeeee`; compared with no earlier key/);
  assert.match(body, /- `https:\/\/old\.example\/p`: recorded `ffffffffffffffff`, its first signer \(the lock recorded it unsigned\)/);
  assert.doesNotMatch(prBody({ mode: "relock", report: { findings: [peerChange] }, relock: relockOut, kid: null, runUrl }), /for the first time/);
});

test("MAR-RC-2: a new block that is only the site's own signature not covering its files is said as the re-sign it most likely needs", () => {
  const stale = { kind: "grounding", severity: "warn", ref: "rooms.html", expected: "e".repeat(64), actual: "1".repeat(64), summary: "1 of 7 facts ... the network still states it (1 price)" };
  const resign = { kind: "grounding", severity: "block", ref: "plumbline.signature.json", summary: "The site's signature no longer covers its files: 1 of 3 signed files differs from the signed version or is missing (plumbline.lock.json), so verifiers now answer invalid (tampered) until the site is signed again (plumbline sign)." };
  const before = { findings: [stale] };
  const now = { findings: [stale, resign] };
  const plan = issuePlan({ findings: 2, body: issueBody(now), open: [issueOf(before, 3)], runUrl, report: now });
  assert.match(plan.comment, /^\*\*The site's signature no longer covers its files\.\*\* If you or your developer changed and relocked the site, sign it again/);
  assert.doesNotMatch(plan.comment, /A new `block` finding/);
  // beside another new block, the alarm stays
  const both = { findings: [stale, resign, { ...peerChange, actual: "9".repeat(64) }] };
  assert.match(issuePlan({ findings: 3, body: issueBody(both), open: [issueOf(before, 3)], runUrl, report: both }).comment, /^\*\*A new `block` finding\.\*\*/);
});

test("MAR-RC-3: a page edited again while its stale-fact sentence is unchanged is said as unchanged, not as news with the same sentence", () => {
  const page = (actual, summary) => ({ findings: [{ kind: "grounding", severity: "warn", ref: "rooms.html", expected: "e".repeat(64), actual, summary }] });
  const sentence = "A grounding source changed since the lock was written; 1 of 7 facts the lock watches on it (facts the network states) is no longer on it, and the network still states it (1 price), so the agent may now answer with an old fact.";
  const first = page("1".repeat(64), sentence);
  const edited = page("2".repeat(64), sentence);
  const plan = issuePlan({ findings: 1, body: issueBody(edited), open: [issueOf(first, 3)], runUrl, report: edited });
  assert.equal(plan.action, "edit");
  assert.doesNotMatch(plan.comment, /New:|no longer on it/);
  assert.match(plan.comment, /Changed again, and what the finding says is unchanged \(its sentence is in the table\):\n\n- \*\*warn\*\* grounding `rooms\.html`\n/);
});

test("UAT-12 (DEV-L1-04): a keyless site's issue and pull request say nothing about signing, and the pull request is not a draft", () => {
  for (const report of [drift, { lockState: "absent", findings: [{ kind: "grounding", severity: "block", ref: "plumbline.lock.json", summary: "no lock" }] }]) {
    const keyless = issueBody(report, { siteSigned: false });
    assert.doesNotMatch(keyless, /sign/i, keyless);
    assert.match(keyless, /commit (the lock|it)\./);
    assert.match(issueBody(report), /sign the site/, "a signed site keeps its reminder, word for word");
  }
  const relocked = { mode: "relock", report: { lockState: "found", findings: [peerChange] }, relock: relockOut, kid: null, runUrl: "https://run" };
  const keyless = prBody({ ...relocked, siteSigned: false });
  assert.doesNotMatch(keyless, /sign/i, keyless);
  assert.equal(prBody(relocked), prBody({ ...relocked, siteSigned: true }), "a signed site's body is unchanged");
  assert.match(prBody(relocked), /\*\*Not signed: CI never signs a change before a person has reviewed it\.\*\*.*It stays a draft until then\./);
  // the draft rule: only a signed site that this run did not sign waits as a draft
  const plan = (siteSigned, open) => prPlan({ mode: "relock", wanted: true, body: keyless, signed: false, open, runUrl: "https://run", siteSigned });
  assert.deepEqual(plan(false, []), { action: "create", draft: false, title: PR_TITLES.relock, branch: PR_BRANCHES.relock });
  assert.equal(plan(true, []).draft, true);
  // a scheduled run with the pull request open, marked ready and unchanged does nothing (no re-draft, no push)
  assert.deepEqual(plan(false, [{ number: 7, body: keyless, isDraft: false }]), { action: "none", number: 7, draft: false });
  // a refused relock on a keyless site: one command per peer, then commit the lock; nothing about signing
  const refused = prBody({ mode: "relock", report: { lockState: "found", findings: [] }, relock: { refused: "signer", peers: [{ peer: "https://p.example/n", from: "0123456789abcdef", to: "fedcba9876543210", how: "a different key" }] }, kid: null, runUrl: "https://run", siteSigned: false });
  assert.match(refused, /run one command per peer, and commit the lock:/);
  assert.doesNotMatch(refused.replace(/signer|signed by|no signature/gi, ""), /\bsign\b/i);
});

test("UAT-18 (DEV-L1-03): the issue names the diff command once per changed peer, from the code, and nothing of the peer but its address", async () => {
  const { changedPeers } = await import("./report.mjs");
  const peer = "https://coinbridge.example/coinbridge_fx";
  const report = {
    lockState: "found",
    findings: [
      { kind: "peer", severity: "block", code: "peer-changed", ref: peer, summary: "A peer's network definition changed ... In outline: agents: 1 added." },
      { kind: "peer", severity: "block", code: "peer-links-appeared", ref: peer, summary: "A peer now publishes a links.json ..." },
      { kind: "peer", severity: "warn", code: "peer-unreachable", ref: "https://down.example/x", summary: "A peer could not be reached" },
    ],
  };
  assert.deepEqual(changedPeers(openFindings(report)), [peer]);
  const body = issueBody(report);
  const lines = body.split("\n").filter((l) => l.includes(" diff --root "));
  assert.deepEqual(lines, [`- \`node dist/cli/index.js diff --root <path to your site> --peer ${peer}\``]);
  assert.match(body, /\*\*To see what changed in this partner by name\*\*/);
  // a report from a CLI before codes is read from the sentence
  assert.deepEqual(changedPeers([{ kind: "peer", severity: "block", ref: peer, summary: "A peer's network definition changed since the lock was written" }]), [peer]);
  // no changed peer: no diff line
  assert.ok(!issueBody({ lockState: "found", findings: [report.findings[2]] }).includes(" diff --root "));
});

test("UAT-18: the relock pull request commits the lock's kept peer copies with the lock", () => {
  const yml = read("action/action.yml");
  assert.match(yml, /if \[ -d "\$PLUMBLINE_ROOT\/\.plumbline\/peers" \]; then git add -- "\$PLUMBLINE_ROOT\/\.plumbline\/peers"; fi/);
});

test("UAT-22 (PRI-L1-06): the Action's gate step checks the files at root when no target is given, and never sends them anywhere", { skip: !bash && "no POSIX bash (set PLUMBLINE_TEST_BASH)" }, () => {
  const step = stepScript("Run plumbline");
  const dir = mkdtempSync(join(tmpdir(), "plumbline-gate-root-"));
  try {
    // a stub CLI beside a copy of report.mjs, laid out as the Action's checkout is: it logs its arguments and answers a report
    mkdirSync(join(dir, "action"));
    mkdirSync(join(dir, "dist", "cli"), { recursive: true });
    writeFileSync(join(dir, "action", "report.mjs"), readFileSync(script));
    writeFileSync(
      join(dir, "dist", "cli", "index.js"),
      'import { appendFileSync } from "node:fs";\nappendFileSync(process.env.CLI_LOG, JSON.stringify(process.argv.slice(2)) + String.fromCharCode(10));\nprocess.stdout.write(JSON.stringify({ target: "x", state: "fail", findings: [{ adapter: "validator", state: "fail", summary: "duplicate keys" }] }));\nprocess.exitCode = 1;\n',
    );
    mkdirSync(join(dir, "ws", "site"), { recursive: true });
    const runStep = (target) => {
      const log = join(dir, `cli-${target ? "url" : "root"}.log`);
      writeFileSync(log, "");
      const r = spawnSync(bash, ["-eo", "pipefail", "-c", step], {
        env: {
          ...process.env,
          CLI_LOG: log,
          GITHUB_ACTION_PATH: join(dir, "action"),
          GITHUB_WORKSPACE: join(dir, "ws"),
          GITHUB_OUTPUT: join(dir, "out"),
          GITHUB_STEP_SUMMARY: join(dir, "summary"),
          RUNNER_TEMP: dir,
          PLUMBLINE_COMMAND: "gate",
          PLUMBLINE_TARGET: target,
          PLUMBLINE_ADAPTERS: "validator,atlas,customs",
          PLUMBLINE_FAIL_ON: "fail",
          PLUMBLINE_ROOT: "site",
        },
        encoding: "utf8",
      });
      assert.notEqual(readFileSync(log, "utf8").trim(), "", r.stderr + r.stdout);
      return { code: r.status, args: JSON.parse(readFileSync(log, "utf8").trim().split("\n")[0]) };
    };
    const files = runStep("");
    assert.equal(files.code, 1, "the gate's own exit code: a failed rule fails the step");
    assert.deepEqual(files.args, ["gate", "--root", `${join(dir, "ws")}/site`, "--fail-on", "fail", "--json"]);
    assert.ok(!files.args.includes("--adapters"), "a folder is checked by the validator only");
    const address = runStep("https://example.com/");
    assert.deepEqual(address.args, ["gate", "https://example.com/", "--adapters", "validator,atlas,customs", "--fail-on", "fail", "--json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("UAT-25 (DEV-L2-3): the issue and the relock pull request offer the cut path, naming the publisher's own files that name the partner", async () => {
  const { cutLines, peerNamedIn, prBody } = await import("./report.mjs");
  const dir = mkdtempSync(join(tmpdir(), "plumbline-cut-"));
  try {
    const peer = "http://127.0.0.1:4201/coinbridge_fx";
    writeFileSync(join(dir, "agent-manifest.json"), JSON.stringify({ networks: [{ name: "trips", hocon: "./nets/trips.network.json" }, { name: "x", hocon: "../escape.network.json" }] }));
    mkdirSync(join(dir, "nets"));
    writeFileSync(join(dir, "nets", "trips.network.json"), JSON.stringify({ tools: [{ name: "front", tools: [peer] }] }));
    writeFileSync(join(dir, "other.network.json"), JSON.stringify({ tools: [] }));
    writeFileSync(join(dir, "links.json"), JSON.stringify({ networks: { trips: { fx: peer } } }));
    assert.deepEqual(peerNamedIn(dir, peer), ["links.json", "nets/trips.network.json"]);
    assert.deepEqual(peerNamedIn(join(dir, "missing"), peer), []);

    const report = { lockState: "found", findings: [{ kind: "peer", severity: "block", code: "peer-changed", ref: peer, summary: "A peer's network definition changed ..." }] };
    const namedIn = (p) => peerNamedIn(dir, p);
    const body = issueBody(report, { namedIn });
    assert.match(body, /\*\*Or remove the partner\.\*\* If you no longer want this partner's code, delete it and relock instead: a peer leaves the lock when no network names it\./);
    assert.ok(
      body.includes(`- \`${peer}\`: delete it from \`links.json\` and \`nets/trips.network.json\`, remove its origin from \`allowed_peers\` in \`agent-manifest.json\`, then run \`node dist/cli/index.js watch --root <path to your site> --relock\``),
      body,
    );
    // without the workspace's files the sentence still runs, naming the file generically
    assert.match(cutLines(report.findings, "cli", "<site>").join("\n"), /delete it from the network file \(or links\.json\) that names it/);
    // no changed peer: no cut line
    assert.deepEqual(cutLines([{ kind: "peer", severity: "warn", code: "peer-unreachable", ref: peer, summary: "x" }], "cli", "<site>"), []);

    const pr = prBody({ mode: "relock", report, relock: { relocked: true, changes: { added: [], removed: [], changed: [`peer ${peer}`] }, findings: [] }, kid: null, runUrl: "https://github.com/o/r/actions/runs/1", siteSigned: false, namedIn });
    assert.match(pr, /\*\*Or remove the partner\.\*\*/);
    assert.match(pr, /Close this pull request unmerged if you cut the partner: the relock after the cut replaces it\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- UAT-29: the owner's line, the Desk link, and the words explained where they appear ----

const OWNER_CASES = [
  [{ findings: [] }, {}],
  [{ findings: [], lockState: "absent" }, {}],
  [{ findings: [], lockState: "unreadable" }, {}],
  [{ findings: [{ severity: "warn", kind: "grounding", code: "grounding-stale-fact", ref: "rooms.html", summary: "s", counts: { factsWatched: 7, factsGone: 1, factsUnplaced: 0, factsStale: 1, staleKinds: { money: 1 } } }] }, {}],
  [{ findings: [{ severity: "warn", code: "grounding-stale-fact", ref: "a.html", counts: { staleKinds: { money: 2, time: 1 } } }, { severity: "warn", code: "grounding-stale-fact", ref: "b.html" }] }, {}],
  [{ findings: [{ severity: "warn", code: "grounding-changed", ref: "rooms.html", counts: { factsWatched: 4, factsGone: 0, factsUnplaced: 0, factsStale: 0 } }] }, {}],
  [{ findings: [{ severity: "warn", code: "grounding-changed", ref: "rooms.html", counts: { factsWatched: 4, factsGone: 1, factsUnplaced: 0, factsStale: 0 } }, { severity: "warn", code: "grounding-changed", ref: "larch_house.network.json" }, { severity: "block", code: "signature-not-covering", ref: "plumbline.signature.json" }] }, {}],
  [{ findings: [{ severity: "warn", code: "grounding-changed", ref: "rooms.html", counts: { factsWatched: 4, factsGone: 1, factsUnplaced: 0, factsStale: 0 } }] }, { siteSigned: false }],
  [{ findings: [{ severity: "block", code: "signature-not-covering", ref: "plumbline.signature.json" }] }, {}],
  [{ findings: [{ severity: "block", code: "signature-expired", ref: "plumbline.signature.json" }] }, {}],
  [{ findings: [{ severity: "warn", code: "signature-expiring", ref: "plumbline.signature.json", actual: "2026-12-01T00:00:00.000Z" }] }, {}],
  [{ findings: [{ severity: "block", code: "runtime-changed", ref: "runtime/x.js" }, { severity: "warn", code: "peer-unreachable", ref: "https://p.example/n" }] }, {}],
  [{ findings: [{ severity: "block", code: "peer-changed", ref: "https://p.example/n" }] }, {}],
  [{ findings: [{ severity: "block", code: "signer-no-rotation", ref: "https://p.example/n" }] }, {}],
  [{ findings: [{ severity: "warn", code: "peer-pending", ref: "https://p.example/n" }] }, {}],
  [{ findings: [{ severity: "warn", code: "grounding-line-endings", ref: "rooms.html" }] }, {}],
  [{ findings: [{ severity: "warn", code: "grounding-unreadable", ref: "rooms.html" }] }, {}],
  [{ findings: [{ severity: "warn", code: "grounding-not-locked", ref: "hours.html" }] }, {}],
  [{ findings: [{ severity: "warn", code: "grounding-changed", ref: "rooms.html", counts: { factsWatched: 3, factsGone: 0, factsUnplaced: 1 } }] }, {}],
  [{ findings: [{ severity: "block", kind: "runtime", ref: "runtime/x.js", summary: "changed" }] }, {}],
];

test("UAT-29: the owner's line is src/watch/owner.ts word for word, made from codes and counts", async () => {
  const { ownerLine } = await import("./report.mjs");
  const lines = OWNER_CASES.map(([r, c]) => ownerLine(r.findings, { ...(r.lockState ? { lockState: r.lockState } : {}), ...c }));
  assert.equal(lines[0], null, "a clean report has no owner's line");
  assert.match(lines[3], /^Your page rooms\.html changed, and your assistant may still be telling visitors an old price from it/);
  assert.match(lines[4], /^Some of your pages changed, and your assistant may still be telling visitors old facts \(2 prices, 1 time\) from them/);
  assert.match(lines[6], /no old fact is left: one step remains for whoever looks after your website, to record the change and sign the site again\.$/);
  assert.match(lines[7], /to record the change\.$/);
  assert.match(lines[10], /expires on 2026-12-01/);
  assert.match(lines[11], /\(your site's own copy of it\).*\(and 1 more thing below for them\)\.$/);
  assert.match(lines[14], /this is not an all-clear/);
  const built = new URL("../dist/watch/owner.js", import.meta.url);
  if (existsSync(built)) {
    const core = await import(built.href);
    OWNER_CASES.forEach(([r, c], i) => assert.equal(core.ownerLine(r.findings, { ...(r.lockState ? { lockState: r.lockState } : {}), ...c }), lines[i], `case ${i}`));
  }
});

// Marta's 28-term list (uat/runs/2026-11-18-first-five/evidence/marta-recert/jargon.mjs), counted the same way
const JARGON = ["drift", "lock", "plumbline.lock.json", "grounding", "source", "network", "agent", "re-lock", "relock", "sign", "signed", "signature", "clone", "commit", "workflow", "block", "warn", "severity", "kind", "ref", "vendored", "runtime", "peer", "links.json", "verifiers", "tampered", "pin", "capture"];
const termsIn = (text) => {
  const t = text.replace(/<!--[\s\S]*?-->/g, "").toLowerCase();
  return JARGON.filter((w) => new RegExp(`(^|[^a-z.])${w.replace(/\./g, "\\.")}([^a-z]|$)`).test(t));
};

test("UAT-29 (MAR-L1-06, MAR-L1-11): the issue opens with the owner's line and the Desk link; every word of Marta's list it uses is explained where it appears", async () => {
  const { deskLink, issueBody, ownerLine, glossaryFor } = await import("./report.mjs");
  const raise = {
    lockState: "found",
    findings: [
      { kind: "grounding", severity: "warn", code: "grounding-stale-fact", ref: "rooms.html", expected: "a".repeat(64), actual: "b".repeat(64), summary: "A grounding source changed since the lock was written; 1 of 7 facts the lock watches on it (facts the network states) is no longer on it, and the network still states it (1 price), so the agent may now answer with an old fact.", counts: { factsWatched: 7, factsGone: 1, factsUnplaced: 0, factsStale: 1, staleKinds: { money: 1 } } },
      { kind: "peer", severity: "warn", code: "peer-pending", ref: "http://127.0.0.1:4101/fellside_bikes", summary: "A peer could not be captured when the lock was written (pending since 2026-11-18), so it is not watched; it was not contacted now either: it is not an https address, an address Plumbline does not contact." },
    ],
  };
  const link = deskLink("https://larchhouse.example/");
  assert.equal(link, "https://plumbline.xkazm04.workers.dev/#/drift?target=https%3A%2F%2Flarchhouse.example%2F");
  const body = issueBody(raise, { link });
  const [first, , second] = body.split("\n");
  assert.equal(first, ownerLine(raise.findings, { lockState: "found", siteSigned: true }));
  assert.equal(second, `**See it in your browser**, with no install and no key: [the reading of your site](${link}).`);
  // the owner's part uses none of the words on her list but the explained "signature"
  const ownerPart = body.slice(0, body.indexOf("### For whoever looks after the website"));
  assert.deepEqual(termsIn(ownerPart.replace(/\(https?:[^)]*\)/g, "")), []);
  // every listed word the technical part uses is in the glossary right above it, in italics
  const glossaryLine = body.split("\n").find((l) => l.startsWith("**Words used below.**"));
  const technical = body.slice(body.indexOf(glossaryLine) + glossaryLine.length);
  const unexplained = termsIn(technical).filter((w) => !termsIn(glossaryLine).includes(w));
  assert.deepEqual(unexplained, [], glossaryLine);
  assert.ok(termsIn(technical).length >= 15, "the technical part is the developer's, unchanged");
  // the technical table stays, below
  assert.match(body, /\| warn \| grounding \| rooms\.html \| A grounding source changed since the lock was written; 1 of 7 facts/);
  // without an address, the issue says where the Desk is
  assert.match(issueBody(raise), /open https:\/\/plumbline\.xkazm04\.workers\.dev\/#\/drift and type your site's address\./);
  // a keyless site's glossary says nothing of signing (UAT-12)
  assert.doesNotMatch(issueBody(raise, { siteSigned: false }), /\bsign/i);
  // a clean report has no owner's part at all
  assert.doesNotMatch(glossaryFor("lock"), /\*sign\*/);
});

test("UAT-29: the link's address is the workflow's site-address, else the origin the site's own signature names; anything not a plain https address is refused", async () => {
  const { deskLink, siteAddressOf, inputProblem } = await import("./report.mjs");
  const dir = mkdtempSync(join(tmpdir(), "plumbline-uat29-"));
  try {
    assert.equal(siteAddressOf({ GITHUB_WORKSPACE: dir, PLUMBLINE_ROOT: ".", PLUMBLINE_SITE_ADDRESS: "https://given.example/" }), "https://given.example/");
    assert.equal(siteAddressOf({ GITHUB_WORKSPACE: dir, PLUMBLINE_ROOT: "." }), null);
    writeFileSync(join(dir, "plumbline.signature.json"), JSON.stringify({ origin: "https://signed.example" }));
    assert.equal(siteAddressOf({ GITHUB_WORKSPACE: dir, PLUMBLINE_ROOT: "." }), "https://signed.example/");
    writeFileSync(join(dir, "plumbline.signature.json"), JSON.stringify({ origin: "http://127.0.0.1:4100" }));
    assert.equal(siteAddressOf({ GITHUB_WORKSPACE: dir, PLUMBLINE_ROOT: "." }), null, "CI links only an https address");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  for (const bad of ["javascript:alert(1)", "https://x.example/a b", "https://x.example/)[y](z", "http://x.example/", "https://user@x.example/"]) assert.equal(deskLink(bad), null, bad);
  assert.equal(deskLink("https://x.example/", "https://evil.example/)"), null);
  const base = { command: "watch", target: "", failOn: "fail", issues: "true", rootIsFolder: true };
  assert.match(inputProblem({ ...base, siteAddress: "not an address" }), /site-address must be the https address/);
  assert.match(inputProblem({ ...base, desk: "http://desk.example/" }), /desk must be an https address/);
  assert.equal(inputProblem({ ...base, siteAddress: "https://larchhouse.example/", desk: "https://plumbline.xkazm04.workers.dev/" }), null);
});

test("UAT-29: the relock pull request opens with the owner's line and what the pull request is to her", async () => {
  const { prBody, ownerLine } = await import("./report.mjs");
  const report = { findings: [{ kind: "grounding", severity: "warn", code: "grounding-changed", ref: "rooms.html", summary: "changed", counts: { factsWatched: 4, factsGone: 0, factsUnplaced: 0, factsStale: 0 } }] };
  const relock = { relocked: true, previous: "found", changes: { added: [], removed: [], changed: ["grounding rooms.html"] }, findings: [] };
  const body = prBody({ mode: "relock", report, relock, kid: null, runUrl: "https://github.com/o/r/actions/runs/1", siteSigned: false });
  assert.equal(body.split("\n")[0], ownerLine(report.findings, { siteSigned: false }));
  assert.match(body, /This pull request is for whoever looks after your website: nothing on your site changes until they review it and merge it\./);
  assert.match(body, /### For whoever looks after the website\n\n\*\*Words used below\.\*\*/);
  assert.match(body, /Plumbline watch found drift as of https:\/\/github\.com\/o\/r\/actions\/runs\/1, and this pull request accepts it/);
  // a renewal has no drift to tell the owner of
  assert.doesNotMatch(prBody({ mode: "renew", report: { findings: [] }, relock: null, kid: "a".repeat(16), runUrl: "u" }), /whoever looks after/);
});

// ---- UAT-30: the news when it lands, to a named person ----

test("UAT-30 (MAR-L1-08): the watch template runs on a push that touches the site folder as well as daily, on the default branch only", () => {
  const template = read("action/templates/plumbline-watch.yml");
  const on = template.slice(template.indexOf("\non:\n"), template.indexOf("\npermissions:"));
  assert.match(on, /\n {2}schedule:\n {4}- cron: /);
  assert.match(on, /\n {2}push:\n {4}paths:\n {6}- "\*\*"\n/, "the push filter init narrows to the site folder");
  // a push to the relock branch, or a person's signature pushed to it, must never edit or close the drift issue
  assert.match(code(template), /\n {4}if: github\.event_name != 'push' \|\| github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)\n/);
  // the named person and the Desk address are offered as comments, so the pinned Action is not passed an input it lacks
  assert.match(template, /\n {10}# assignee: your-github-login /);
});

test("UAT-30: assignee is a GitHub login, and goes with issues: true", async () => {
  const base = { command: "watch", target: "", failOn: "fail", issues: "true", rootIsFolder: true };
  assert.equal(inputProblem({ ...base, assignee: "marta-hollis" }), null);
  for (const bad of ["@marta", "marta hollis", "-marta", "marta--", "a".repeat(40), "m;rm -rf"]) assert.match(inputProblem({ ...base, assignee: bad }), /assignee must be a GitHub login/, bad);
  assert.match(inputProblem({ ...base, issues: "false", assignee: "marta" }), /assignee goes with issues: true/);
});

test("UAT-30: the issue step assigns the named person on create and on edit; a refused assignment only warns, and the issue stands", { skip: !bash && "no POSIX bash (set PLUMBLINE_TEST_BASH)" }, () => {
  const apply = stepScript("Open, edit or close the drift issue");
  const dir = mkdtempSync(join(tmpdir(), "plumbline-uat30-"));
  try {
    const stubs = join(dir, "bin");
    mkdirSync(stubs);
    // a gh that logs, answers create with the issue's address, and refuses to assign the login "nobody"
    writeFileSync(
      join(stubs, "gh"),
      '#!/usr/bin/env bash\nprintf \'%s\\n\' "$*" >> "$GH_LOG"\nif [ "$1 $2" = "issue create" ]; then echo "https://github.com/o/r/issues/12"; fi\nif [ "$5" = "nobody" ]; then echo "could not assign" >&2; exit 1; fi\n',
      { mode: 0o755 },
    );
    const body = join(dir, "body.md");
    writeFileSync(body, "x\n");
    const steps = (env) => {
      const log = join(dir, "gh.log");
      writeFileSync(log, "");
      const r = spawnSync(bash, ["-eo", "pipefail", "-c", apply], { env: { ...process.env, PATH: `${stubs}${delimiter}${process.env.PATH}`, GH_LOG: log, GITHUB_ACTION_PATH: here, BODY: body, ...env }, encoding: "utf8" });
      return { status: r.status, out: r.stdout, err: r.stderr, calls: readFileSync(log, "utf8").trim().split("\n").filter(Boolean) };
    };
    const created = steps({ ISSUE_ACTION: "create", ASSIGNEE: "marta-hollis" });
    assert.equal(created.status, 0, created.err);
    assert.deepEqual(created.calls, [`issue create --title ${ISSUE_TITLE} --body-file ${body}`, "issue edit 12 --add-assignee marta-hollis"]);
    const edited = steps({ ISSUE_ACTION: "edit", NUMBER: "12", COMMENT: "", ASSIGNEE: "marta-hollis" });
    assert.deepEqual(edited.calls, [`issue edit 12 --body-file ${body}`, "issue edit 12 --add-assignee marta-hollis"]);
    const none = steps({ ISSUE_ACTION: "create", ASSIGNEE: "" });
    assert.deepEqual(none.calls, [`issue create --title ${ISSUE_TITLE} --body-file ${body}`], "no assignee, no assignment");
    const refused = steps({ ISSUE_ACTION: "create", ASSIGNEE: "nobody" });
    assert.equal(refused.status, 0, "a refused assignment never fails the step");
    assert.match(refused.out, /::warning::the drift issue could not be assigned to nobody/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- UAT-35: renewal reads the finding's code, not an English word in its sentence ----

test("UAT-35: renewNeeded decides on the expiry codes, whatever the sentence says; a report before codes still reads its sentence", async () => {
  const { renewNeeded } = await import("./report.mjs");
  const sig = "plumbline.signature.json";
  // the documented codes decide, whatever the words
  assert.equal(renewNeeded({ findings: [{ severity: "warn", kind: "grounding", code: "signature-expiring", ref: sig, summary: "The seal lapses in 3 days." }] }), true);
  assert.equal(renewNeeded({ findings: [{ severity: "block", kind: "grounding", code: "signature-expired", ref: sig, summary: "Lapsed." }] }), true);
  // another code on the signature file is not a renewal, even if its words say expire (signature-not-covering is one
  // since UAT-34: test below)
  assert.equal(renewNeeded({ findings: [{ severity: "warn", kind: "grounding", code: "signature-unreadable", ref: sig, summary: "It could not be read to see when it expires." }] }), false);
  // a report written before codes (UAT-17) is read as before
  assert.equal(renewNeeded({ findings: [{ severity: "warn", kind: "grounding", ref: sig, summary: "The site's signature expires on 2026-12-01, in 5 days; sign the site again before then." }] }), true);
});

// ---- UAT-33: a fork's pull request on a branch named plumbline/relock is never taken for the Action's own ----

test("UAT-33: the pull request plan ignores a pull request whose head is in another repository (a fork's branch of the same name)", () => {
  const body = prBody({ mode: "relock", report: { findings: [peerChange] }, relock: relockOut, kid: null, runUrl });
  const fork = { number: 41, body: "a stranger's change", isDraft: false, isCrossRepository: true };
  // gh pr list --head filters by the branch name alone ("<owner>:<branch>" syntax not supported, gh 2.102.0's help),
  // so a fork's pull request from its own plumbline/relock comes back with ours
  assert.deepEqual(prPlan({ mode: "relock", wanted: true, body, signed: false, open: [fork], runUrl }), { action: "create", draft: true, title: PR_TITLES.relock, branch: PR_BRANCHES.relock });
  assert.equal(prPlan({ mode: "relock", wanted: false, body, signed: false, open: [fork], runUrl }).action, "none", "a clean run never closes a fork's pull request");
  assert.equal(prPlan({ mode: "relock", wanted: true, body, signed: false, open: [fork], runUrl, refused: true }).action, "none", "a refused relock never describes a fork's pull request");
  // ours is found beside it
  const ours = { number: 3, body, isDraft: true, isCrossRepository: false };
  assert.equal(prPlan({ mode: "relock", wanted: false, body, signed: false, open: [fork, ours], runUrl }).number, 3);
});

test("UAT-33: the Action asks gh whether each pull request's head is in another repository", () => {
  const action = read("action/action.yml");
  assert.match(action, /gh pr list --head "\$branch" --state open --json number,body,isDraft,isCrossRepository > "\$pr\/open\.json"/);
});

// ---- UAT-34: CI never signs a relock before a person has reviewed it; renew signs merged files ----

test("UAT-34: the Action signs only in a renewal, and the relock step never holds the key", () => {
  const action = read("action/action.yml");
  assert.match(action, /if \[ "\$MODE" = "renew" \] && \[ -n "\$PLUMBLINE_SIGNING_KEY" \]; then\n\s+node "\$cli" sign /);
  assert.match(action, /PLUMBLINE_SIGNING_KEY: \$\{\{ inputs\.renew == 'true' && inputs\.signing-key \|\| '' \}\}/);
  assert.equal((action.match(/node "\$cli" sign /g) ?? []).length, 1, "one sign call in the whole Action");
});

test("UAT-34: a signature that no longer covers the merged files is a renewal, and its body says what merging vouches for", () => {
  const sig = "plumbline.signature.json";
  const notCovering = { severity: "block", kind: "grounding", code: "signature-not-covering", ref: sig, summary: "The site's signature no longer covers its files: 1 of 4 signed files differs from the signed version or is missing (plumbline.lock.json), so verifiers now answer invalid (tampered) until the site is signed again (plumbline sign)." };
  assert.equal(renewNeeded({ findings: [notCovering] }), true);
  const body = prBody({ mode: "renew", report: { findings: [notCovering] }, relock: null, kid: "0123456789abcdef", runUrl });
  assert.match(body, /The site's files changed since they were last signed/);
  assert.match(body, /\*\*Merging this vouches for every changed file below as yours\.\*\*/);
  assert.match(body, /\(plumbline\.lock\.json\)/);
  assert.doesNotMatch(body, /close to its expiry/);
  // an expiry renewal keeps its words
  assert.match(prBody({ mode: "renew", report: { findings: [expiring] }, relock: null, kid: "0123456789abcdef", runUrl }), /close to its expiry/);
});
