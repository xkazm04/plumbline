// The Action's `command: agent` (plumbline agent check in CI; docs/agent-lock.md "CI"): the input refusals, the state
// and summary, the agent's own drift issue, and the run step's exit code. Plain node --test, no build, no network.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { AGENT_ISSUE_TITLE, AGENT_NOT_CHECKED_CODES, ISSUE_TITLE, agentIssueBody, agentOutputs, approvalLine, digestOf, inputProblem, issuePlan, notCheckedWords, readDigest } from "./report.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const script = join(here, "report.mjs");
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const code = (text) => text.split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");
const bash = process.env.PLUMBLINE_TEST_BASH ?? (process.platform === "win32" ? undefined : "bash");

const KID = "0123456789abcdef";
const unapproved = {
  findings: [
    { severity: "block", code: "lock-unapproved", ref: "plumbline.agent.lock.json", summary: "The lock has no approval." },
    { severity: "warn", code: "server-not-observed", ref: "files|server", summary: "Not yet observed by the guard." },
    { severity: "info", code: "peer-unreachable", ref: "https://peer.example/", summary: "Not checked (offline)." },
  ],
  approval: "absent",
  checkedAt: "2026-11-21T10:00:00.000Z",
};
const clean = { findings: [], approval: "verified", approvedBy: { kid: KID, label: "Alice | Ops" }, checkedAt: "2026-11-21T10:00:00.000Z" };
/** A report whose only open finding says something was not checked (a remote server that answered 401): unavailable. */
const notChecked = {
  state: "unavailable",
  findings: [
    { severity: "warn", code: "server-unreachable", ref: "grinex", summary: "An MCP server over HTTP could not be read (it answered HTTP 401), so its tools were not checked." },
    { severity: "info", code: "peer-unreachable", ref: "https://peer.example/", summary: "Not contacted (--offline)." },
  ],
  approval: "verified",
  approvedBy: { kid: KID, label: "Alice" },
  checkedAt: "2026-11-21T10:00:00.000Z",
};

test("agent inputs: accepted with root and issues; offline is true or false and goes with agent only; relock-pr, renew and signing-key refused", () => {
  const ok = { command: "agent", target: "", failOn: "fail", issues: "false", rootIsFolder: true };
  assert.equal(inputProblem(ok), null);
  assert.equal(inputProblem({ ...ok, issues: "true", offline: "true", assignee: "octocat" }), null);
  assert.match(inputProblem({ ...ok, offline: "yes" }), /offline must be true or false/);
  assert.match(inputProblem({ ...ok, command: "watch", offline: "true" }), /offline goes with command agent only/);
  assert.match(inputProblem({ ...ok, rootIsFolder: false }), /root must name a folder/);
  assert.match(inputProblem({ ...ok, relockPr: "true" }), /relock-pr does not go with command agent yet/);
  assert.match(inputProblem({ ...ok, renew: "true" }), /never renewed by CI/);
  assert.match(inputProblem({ ...ok, signingKey: true }), /CI never approves an agent lock/);
});

test("fail-on goes with gate and agent: fail or unavailable; with watch anything but the default is refused", () => {
  const agent = { command: "agent", target: "", failOn: "fail", issues: "false", rootIsFolder: true };
  assert.equal(inputProblem({ ...agent, failOn: "unavailable" }), null);
  assert.match(inputProblem({ ...agent, failOn: "warn" }), /fail-on must be fail or unavailable/);
  assert.match(inputProblem({ ...agent, failOn: undefined }), /fail-on must be fail or unavailable/);
  const watch = { command: "watch", target: "", failOn: "fail", issues: "true", rootIsFolder: true };
  assert.equal(inputProblem(watch), null);
  assert.match(inputProblem({ ...watch, failOn: "unavailable" }), /fail-on goes with command gate or agent only/);
  assert.equal(inputProblem({ command: "gate", target: "https://example.com/", failOn: "unavailable", issues: "false", rootIsFolder: false }), null);
});

test("the not-checked codes report.mjs knows are the wire's (src/core/types.ts AGENT_NOT_CHECKED_CODES), in order", () => {
  const types = read("src/core/types.ts");
  const start = types.indexOf("export const AGENT_NOT_CHECKED_CODES = [");
  assert.ok(start >= 0, "the list is in types.ts");
  const block = types.slice(start, types.indexOf("] as const", start));
  assert.deepEqual([...block.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]), AGENT_NOT_CHECKED_CODES);
});

test("agent outputs: the report's state wins (unavailable stays unavailable on exit 0 and on exit 1); the summary says what was not checked", () => {
  for (const exit of [0, 1]) {
    const out = agentOutputs(notChecked, exit);
    assert.equal(out.state, "unavailable", `exit ${exit}`);
    assert.match(out.summary, /^### Plumbline agent check: unavailable\nApproval: approved by Alice \(`0123456789abcdef`\)\.\nNot checked: 1 MCP server\. Nothing that was checked failed; this fails the step only with `fail-on: unavailable`\.\n/);
    assert.equal(out.findings, 1, "the scheduled run keeps its issue open for what was not checked");
  }
  assert.equal(agentOutputs(notChecked, 2).state, "unknown", "an error exit is never read from the report");
  assert.equal(agentOutputs({ ...notChecked, state: "maybe" }, 0).state, "pass", "a state that is not one of the three falls back to the exit code");
  const failing = { ...unapproved, state: "fail" };
  assert.match(agentOutputs(failing, 1).summary, /^### Plumbline agent check: fail\nApproval: not approved[^\n]*\nNot checked: 1 MCP server\.\n/);
  assert.equal(notCheckedWords(clean), null);
  const several = { ...notChecked, findings: [...notChecked.findings, { severity: "warn", code: "peer-unreachable", ref: "p" }, { severity: "warn", code: "link-absent", ref: "l" }, { severity: "warn", code: "server-not-observed", ref: "s" }] };
  assert.equal(notCheckedWords(several), "2 MCP servers, 1 A2A peer and 1 linked folder");
});

test("the agent issue for an unavailable check says what was not checked and what to do, never to relock or approve a change", () => {
  const body = agentIssueBody(notChecked);
  assert.match(body, /^Plumbline agent check could not check part of the agent \(not checked: 1 MCP server\)\. Nothing that was checked differs from the approved lock/);
  assert.match(body, /\| warn \| server-unreachable \| grinex \|/);
  assert.match(body, /answers HTTP 401 or 403 needs a key/);
  assert.doesNotMatch(body, /Review each change/);
  assert.deepEqual(readDigest(body), digestOf(notChecked));
  // a failing check that also could not see something: both pieces of advice
  const both = agentIssueBody({ ...unapproved, state: "fail" });
  assert.match(both, /Review each change/);
  assert.match(both, /For what was not checked/);
});

test("agent outputs: pass on exit 0, fail on exit 1, unknown otherwise; an unreadable report is unknown with no count and no body", () => {
  const pass = agentOutputs(clean, 0);
  assert.equal(pass.state, "pass");
  assert.equal(pass.findings, 0);
  assert.match(pass.summary, /^### Plumbline agent check: pass\nApproval: approved by Alice \\\| Ops \(`0123456789abcdef`\)\.\n\nNo findings\.\n$/);
  const fail = agentOutputs(unapproved, 1);
  assert.equal(fail.state, "fail");
  assert.equal(fail.findings, 2, "info stays out of the count");
  assert.match(fail.summary, /- \*\*block\*\* `lock-unapproved` plumbline\.agent\.lock\.json: The lock has no approval\./);
  assert.match(fail.summary, /`server-not-observed` files\\\|server/);
  assert.match(fail.summary, /Approval: not approved/);
  assert.equal(agentOutputs(unapproved, 2).state, "unknown");
  assert.equal(agentOutputs(unapproved, Number.NaN).state, "unknown");
  for (const report of [undefined, null, {}, { findings: [] }, { findings: [], approval: "approved" }, { findings: {}, approval: "absent" }]) {
    const out = agentOutputs(report, 0);
    assert.equal(out.state, "unknown", JSON.stringify(report));
    assert.equal(out.body, undefined);
    assert.equal(out.findings, undefined);
  }
});

test("approval line: unverifiable says the key is in no approvers entry, never approved; a label is shown only when verified", () => {
  assert.match(approvalLine({ approval: "unverifiable" }), /in no entry of the approvers file/);
  assert.doesNotMatch(approvalLine({ approval: "unverifiable", approvedBy: { kid: KID, label: "Mallory" } }), /Mallory|approved by/);
  assert.match(approvalLine({ approval: "invalid" }), /does not verify/);
  assert.doesNotMatch(approvalLine({ approval: "verified", approvedBy: { kid: "not-a-kid", label: "X" } }), /by X/);
});

test("the agent drift issue: its own title, findings by code and ref, a digest keyed by code, and its own close comment", () => {
  const body = agentIssueBody(unapproved);
  assert.match(body, /\| block \| lock-unapproved \| plumbline\.agent\.lock\.json \| The lock has no approval\. \|/);
  assert.doesNotMatch(body, /peer-unreachable/, "info stays out of the issue");
  assert.match(body, /CI never does/);
  assert.deepEqual(readDigest(body), digestOf(unapproved));
  assert.deepEqual(digestOf(unapproved)[0], ["block", "lock-unapproved", "plumbline.agent.lock.json"]);

  const runUrl = "https://github.com/o/r/actions/runs/7";
  assert.deepEqual(issuePlan({ findings: 2, body, open: [], runUrl, title: AGENT_ISSUE_TITLE }), { action: "create", title: AGENT_ISSUE_TITLE });
  // a site's drift issue is never taken for the agent's, nor the agent's for the site's
  const siteIssue = { number: 3, title: ISSUE_TITLE, body: "x" };
  assert.equal(issuePlan({ findings: 2, body, open: [siteIssue], runUrl, title: AGENT_ISSUE_TITLE }).action, "create");
  const agentIssue = { number: 4, title: AGENT_ISSUE_TITLE, body };
  assert.deepEqual(issuePlan({ findings: 0, body: "", open: [agentIssue], runUrl }), { action: "none" });
  const closed = issuePlan({ findings: 0, body: "", open: [siteIssue, agentIssue], runUrl, title: AGENT_ISSUE_TITLE });
  assert.equal(closed.action, "close");
  assert.equal(closed.number, 4);
  assert.match(closed.comment, /^Plumbline agent check is clean/);
  // a new block on the open agent issue is news, with its sentence
  const more = { ...unapproved, findings: [...unapproved.findings, { severity: "block", code: "tool-changed", ref: "github", summary: "1 tool changed." }] };
  const edited = issuePlan({ findings: 3, body: agentIssueBody(more), open: [agentIssue], runUrl, report: more, title: AGENT_ISSUE_TITLE });
  assert.equal(edited.action, "edit");
  assert.match(edited.comment, /A new `block` finding/);
  assert.match(edited.comment, /tool-changed `github`: 1 tool changed\./);
});

function run(args, files, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "plumbline-agent-report-"));
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    const out = join(dir, "out");
    const summary = join(dir, "summary");
    const r = spawnSync(process.execPath, [script, ...args.map((a) => (a.startsWith("@") ? join(dir, a.slice(1)) : a))], {
      env: { ...process.env, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary, ...env },
      encoding: "utf8",
    });
    const maybe = (f) => {
      try {
        return readFileSync(f, "utf8");
      } catch {
        return undefined;
      }
    };
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, output: maybe(out), summary: maybe(summary), body: maybe(join(dir, "body.md")), dir };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("agent, as the Action runs it: state, count and body path in GITHUB_OUTPUT; an unreadable report gives state=unknown only", () => {
  const r = run(["agent", "@report.json", "1", "@body.md"], { "report.json": JSON.stringify(unapproved) });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.output, `state=fail\nfindings=2\nissue-body=${join(r.dir, "body.md")}\n`);
  assert.equal(r.body, agentIssueBody(unapproved));
  assert.match(r.summary, /^### Plumbline agent check: fail/);
  const broken = run(["agent", "@report.json", "0", "@body.md"], { "report.json": "{not json" });
  assert.equal(broken.status, 0);
  assert.equal(broken.output, "state=unknown\n");
  assert.equal(broken.body, undefined);
  assert.equal(run(["agent", "@report.json"], {}).status, 2);
  assert.equal(run(["title", "agent"], {}).stdout, `${AGENT_ISSUE_TITLE}\n`);
  assert.equal(run(["title"], {}, { PLUMBLINE_COMMAND: "agent" }).stdout, `${AGENT_ISSUE_TITLE}\n`);
  assert.equal(run(["title"], {}, { PLUMBLINE_COMMAND: "watch" }).stdout, `${ISSUE_TITLE}\n`);
});

test("issue, as the Action runs it for agent: the agent's title decides which open issue is its own", () => {
  const files = { "body.md": agentIssueBody(unapproved), "open.json": JSON.stringify([{ number: 9, title: AGENT_ISSUE_TITLE, body: "old" }]) };
  const r = run(["issue", "2", "@body.md", "@open.json", "@comment.md"], files, { PLUMBLINE_COMMAND: "agent" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.output, /^action=edit\nnumber=9\n/);
  const site = run(["issue", "2", "@body.md", "@open.json", "@comment.md"], files, { PLUMBLINE_COMMAND: "watch" });
  assert.match(site.output, /^action=create\n/);
});

test("action.yml: agent runs agent check in root with the approvers input as PLUMBLINE_APPROVERS, reads the report once, and the issue steps know the command", () => {
  const action = code(read("action/action.yml"));
  assert.match(action, /\n {2}offline:\n(?: {4}[^\n]*\n)* {4}default: "false"\n/);
  assert.match(action, /\n {2}approvers:\n(?: {4}[^\n]*\n)* {4}default: ""\n/);
  assert.match(action, /PLUMBLINE_APPROVERS: \$\{\{ inputs\.approvers \}\}/);
  assert.equal([...action.matchAll(/PLUMBLINE_APPROVERS:/g)].length, 1, "the approvers reach the run step only");
  assert.match(action, /node "\$cli" agent check \$offline --fail-on "\$PLUMBLINE_FAIL_ON" --json/);
  assert.equal([...action.matchAll(/report\.mjs" agent /g)].length, 1);
  assert.match(action, /\n {2}fail-on:\n(?: {4}[^\n]*\n)* {4}default: fail\n/);
  assert.equal([...action.matchAll(/PLUMBLINE_COMMAND: \$\{\{ inputs\.command \}\}/g)].length, 4, "inputs, run, and both issue steps");
});

/** The `run: |` block of the composite step with this name, dedented. */
function stepScript(name) {
  const lines = read("action/action.yml").split("\n");
  const start = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  const runAt = lines.findIndex((l, i) => i > start && l.trim() === "run: |");
  const indent = lines[runAt + 1].match(/^ */)[0].length;
  const body = [];
  for (const l of lines.slice(runAt + 1)) {
    if (l.trim() !== "" && l.match(/^ */)[0].length < indent) break;
    body.push(l.slice(indent));
  }
  return body.join("\n");
}

test("the run step for agent, by bash against a stub CLI: a pull request's check fails on findings; the scheduled run with issues stays green", { skip: !bash && "no POSIX bash (set PLUMBLINE_TEST_BASH)" }, () => {
  const step = stepScript("Run plumbline");
  const dir = mkdtempSync(join(tmpdir(), "plumbline-agent-step-"));
  try {
    const actionPath = join(dir, "action");
    mkdirSync(join(dir, "dist", "cli"), { recursive: true });
    mkdirSync(actionPath);
    copyFileSync(script, join(actionPath, "report.mjs"));
    const workspace = join(dir, "ws");
    mkdirSync(workspace);
    // the stub CLI records its arguments, its folder and the approvers it was given, prints a report and exits with
    // $STUB_EXIT; with STUB_EXIT=rule it exits as agent check does, by the report's state and the --fail-on it was given
    writeFileSync(
      join(dir, "dist", "cli", "index.js"),
      'import { appendFileSync } from "node:fs";\n' +
        "const argv = process.argv.slice(2);\n" +
        'appendFileSync(process.env.STUB_LOG, JSON.stringify({ argv, cwd: process.cwd(), approvers: process.env.PLUMBLINE_APPROVERS }) + "\\n");\n' +
        "process.stdout.write(process.env.STUB_REPORT);\n" +
        'const failOn = argv[argv.indexOf("--fail-on") + 1];\n' +
        "const state = JSON.parse(process.env.STUB_REPORT).state;\n" +
        'process.exitCode = process.env.STUB_EXIT === "rule" ? (state === "fail" || (state === "unavailable" && failOn === "unavailable") ? 1 : 0) : Number(process.env.STUB_EXIT);\n',
    );
    writeFileSync(join(dir, "package.json"), '{"type":"module"}');
    const go = (exit, report, extra) => {
      const out = join(dir, "out");
      const log = join(dir, "log");
      writeFileSync(out, "");
      writeFileSync(log, "");
      const r = spawnSync(bash, ["-eo", "pipefail", "-c", step], {
        env: {
          ...process.env,
          GITHUB_ACTION_PATH: actionPath,
          GITHUB_WORKSPACE: workspace,
          GITHUB_OUTPUT: out,
          RUNNER_TEMP: dir,
          PLUMBLINE_COMMAND: "agent",
          PLUMBLINE_ROOT: ".",
          PLUMBLINE_ISSUES: "false",
          PLUMBLINE_OFFLINE: "false",
          PLUMBLINE_FAIL_ON: "fail",
          PLUMBLINE_APPROVERS: '{"type":"plumbline-approvers"}',
          STUB_LOG: log,
          STUB_REPORT: JSON.stringify(report),
          STUB_EXIT: String(exit),
          ...extra,
        },
        encoding: "utf8",
      });
      return { status: r.status, output: readFileSync(out, "utf8"), calls: readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) };
    };
    const pr = go(1, unapproved, { PLUMBLINE_OFFLINE: "true" });
    assert.equal(pr.status, 1, "findings fail the pull request's check");
    assert.match(pr.output, /state=fail/);
    assert.deepEqual(pr.calls[0].argv, ["agent", "check", "--offline", "--fail-on", "fail", "--json"]);
    assert.equal(pr.calls[0].approvers, '{"type":"plumbline-approvers"}');
    assert.equal(go(0, clean, {}).status, 0);
    const scheduled = go(1, unapproved, { PLUMBLINE_ISSUES: "true" });
    assert.equal(scheduled.status, 0, "the scheduled run keeps the issue and stays green");
    assert.match(scheduled.output, /findings=2/);
    assert.deepEqual(scheduled.calls[0].argv, ["agent", "check", "--fail-on", "fail", "--json"]);
    assert.equal(go(2, {}, { PLUMBLINE_ISSUES: "true" }).status, 2, "a usage or I/O error always fails");

    // F9: a warn-only report (a 401 server, not checked) passes a pull request's check under the default fail-on, and
    // fails it under fail-on: unavailable; the state output says unavailable either way
    const lenient = go("rule", notChecked, { PLUMBLINE_OFFLINE: "true" });
    assert.equal(lenient.status, 0, "unavailable is not fail");
    assert.match(lenient.output, /^state=unavailable$/m);
    assert.deepEqual(lenient.calls[0].argv, ["agent", "check", "--offline", "--fail-on", "fail", "--json"]);
    const strict = go("rule", notChecked, { PLUMBLINE_OFFLINE: "true", PLUMBLINE_FAIL_ON: "unavailable" });
    assert.equal(strict.status, 1, "fail-on: unavailable fails on it");
    assert.match(strict.output, /^state=unavailable$/m);
    assert.deepEqual(strict.calls[0].argv, ["agent", "check", "--offline", "--fail-on", "unavailable", "--json"]);
    assert.equal(go("rule", { ...unapproved, state: "fail" }, {}).status, 1, "fail fails under the default");
    const keep = go("rule", notChecked, { PLUMBLINE_ISSUES: "true", PLUMBLINE_FAIL_ON: "unavailable" });
    assert.equal(keep.status, 0, "the scheduled run stays green and keeps the issue");
    assert.match(keep.output, /findings=1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the agent template: offline check on pull requests with contents: read, full check daily with issues, approvers from a repository variable", () => {
  const text = code(read("action/templates/plumbline-agent.yml"));
  assert.match(text, /\non:\n {2}pull_request:\n {2}schedule:\n/);
  assert.match(text, /\n {2}workflow_dispatch:\n/);
  assert.match(text, /\npermissions:\n {2}contents: read\n\n/, "the workflow's default is read only");
  const check = text.slice(text.indexOf("\n  check:"), text.indexOf("\n  watch:"));
  const watch = text.slice(text.indexOf("\n  watch:"));
  assert.match(check, /if: github\.event_name == 'pull_request'/);
  assert.match(check, /permissions:\n {6}contents: read\n {4}steps:/);
  assert.doesNotMatch(check, /issues: (write|true)/);
  assert.match(check, /command: agent\n {10}root: "\."\n {10}offline: true\n {10}approvers: \$\{\{ vars\.PLUMBLINE_APPROVERS \}\}\n/);
  assert.match(watch, /if: github\.event_name != 'pull_request'/);
  assert.match(watch, /permissions:\n {6}contents: read\n {6}issues: write\b/);
  assert.match(watch, /command: agent\n {10}root: "\."\n {10}issues: true\n {10}approvers: \$\{\{ vars\.PLUMBLINE_APPROVERS \}\}\n/);
  assert.doesNotMatch(text, /signing-key|secrets\.|relock-pr|pull-requests: write|contents: write/);
  for (const uses of text.matchAll(/uses: ([^\s@]+)@(\S+)/g)) assert.match(uses[2], /^[0-9a-f]{40}$/, `${uses[1]} is pinned by full commit SHA`);
});

test("the agent template pins a commit of this repository whose Action has command agent and every input and output the template uses", () => {
  const text = code(read("action/templates/plumbline-agent.yml"));
  const shas = new Set([...text.matchAll(/uses: xkazm04\/plumbline\/action@([0-9a-f]{40})/g)].map((m) => m[1]));
  assert.equal(shas.size, 1, "both jobs pin the same commit");
  const [sha] = shas;
  const root = fileURLToPath(new URL("..", import.meta.url));
  const shown = spawnSync("git", ["show", `${sha}:action/action.yml`], { cwd: root, encoding: "utf8" });
  assert.equal(shown.status, 0, `the pinned commit ${sha} is in this repository's history`);
  const pinned = shown.stdout;
  assert.match(pinned, /\n {10}agent\)\n/, "the pinned Action runs command agent");
  assert.match(pinned, /node "\$cli" agent check \$offline (?:--fail-on "\$PLUMBLINE_FAIL_ON" )?--json/);
  const inputs = pinned.slice(pinned.indexOf("\ninputs:"), pinned.indexOf("\noutputs:"));
  for (const name of ["command", "root", "offline", "issues", "approvers"]) assert.match(inputs, new RegExp(`\n {2}${name}:\n`), `the pinned Action declares ${name}`);
  for (const name of ["state", "findings"]) assert.match(pinned.slice(pinned.indexOf("\noutputs:")), new RegExp(`\n {2}${name}:\n`));
});
