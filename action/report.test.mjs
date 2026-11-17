// The Action's report reader (action/report.mjs) and the workflows that use its outputs. Plain node --test, no build,
// no npm, no network: `node --test "action/*.test.mjs"`.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { cell, gateOutputs, issueBody, openFindings, watchOutputs } from "./report.mjs";

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
  test(`${name} takes the issue body from the Action and closes the drift issue on a clean run`, () => {
    const text = code(read(file));
    assert.doesNotMatch(text, /JSON\.parse|node -e|node - /, "no second reader of the report");
    assert.match(text, /steps\.watch\.outputs\.issue-body/);
    assert.match(text, /steps\.watch\.outputs\.findings/);
    // One open issue only: edited when it exists, created when it does not, closed with a comment when clean.
    assert.match(text, /gh issue edit "\$number" --body-file/);
    assert.match(text, /gh issue create --title "Plumbline drift"/);
    assert.match(text, /gh issue close "\$number" --comment/);
    // Idempotent: closing happens only when an open issue was found.
    assert.match(text, /if \[ -n "\$number" \]/);
  });
}

test("a report whose lock is not found is never clean: no lock keeps the issue open with the init advice", async () => {
  const { openFindings, issueBody } = await import("./report.mjs");
  const absent = { findings: [], lockState: "absent", lockSummary: "There is no plumbline.lock.json." };
  assert.equal(openFindings(absent).length, 1);
  assert.match(issueBody(absent), /There is no lock yet/);
  const unusable = { findings: [], lockState: "unusable", lockSummary: "The lock is not JSON." };
  assert.equal(openFindings(unusable)[0].summary, "The lock is not JSON.");
  assert.equal(openFindings({ findings: [], lockState: "found" }).length, 0, "a found lock with no findings is clean");
});

