#!/usr/bin/env node
// UAT runner for action/action.yml, written for the marta-hollis L2 walk (run 2026-11-18-first-five). NOT the product.
// It executes the `run:` blocks of action/action.yml VERBATIM (read from the file at run time), in bash with
// `-eo pipefail` as GitHub does, with the env each step declares. What differs from a GitHub runner, and nothing else:
//   - the workspace is a fresh `git clone` of a local bare remote (actions/checkout), and the Action's push URL
//     (https://x-access-token:<token>@github.com/<repo>.git) is mapped to that remote with git's url.insteadOf, given
//     through GIT_CONFIG_* env (no config file is written);
//   - `gh` is uat gh-stub.mjs (first on PATH; the runner refuses to start if `command -v gh` is anything else);
//   - the build step is skipped: dist/ was built from HEAD before the walk (npm run build);
//   - with --harness, the text `node "$cli" watch` is replaced by `node "<uat/driver/local-cli.mjs>" watch` (the test
//     harness: the built modules with allowLocal, so a loopback peer is watched as an https one would be). Sign stays
//     the real CLI.
//
//   node run-action.mjs --world <dir> --label <run label> [--issues true] [--relock-pr true] [--harness]
// Prints one JSON document: the steps' outputs, stdout tails, and the gh calls this run made.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..", "..", "..");
const ACTION = path.join(REPO, "action");
const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const world = opt("--world");
const label = opt("--label");
const issues = opt("--issues", "true");
const relockPr = opt("--relock-pr", "false");
const harness = argv.includes("--harness");
if (!world || !label) {
  process.stderr.write("usage: run-action.mjs --world <dir> --label <label> [--issues true] [--relock-pr true] [--harness]\n");
  process.exit(2);
}
const uat = path.join(world, "_uat");
const remote = path.join(uat, "remote.git").replace(/\\/g, "/");
const ws = path.join(uat, "ws", label);
const temp = path.join(uat, "tmp", label);
const bin = path.join(uat, "bin");
const ghState = path.join(uat, "gh-state.json");
rmSync(ws, { recursive: true, force: true });
rmSync(temp, { recursive: true, force: true });
mkdirSync(temp, { recursive: true });
mkdirSync(bin, { recursive: true });
writeFileSync(path.join(bin, "gh"), `#!/bin/bash\nexec node "${path.join(HERE, "gh-stub.mjs").replace(/\\/g, "/")}" "$@"\n`, { mode: 0o755 });

const TOKEN = "uat-stub-token";
const REPO_NAME = "larchhouse/larchhouse-site";
const env = {
  ...process.env,
  PATH: `${bin}${path.delimiter}${process.env.PATH}`,
  GH_STUB_STATE: ghState,
  UAT_RUN_LABEL: label,
  GITHUB_ACTION_PATH: ACTION.replace(/\\/g, "/"),
  GITHUB_WORKSPACE: ws.replace(/\\/g, "/"),
  RUNNER_TEMP: temp.replace(/\\/g, "/"),
  GITHUB_REPOSITORY: REPO_NAME,
  GITHUB_RUN_ID: label,
  GITHUB_SERVER_URL: "https://github.com",
  GIT_CONFIG_COUNT: "2",
  GIT_CONFIG_KEY_1: "core.autocrlf",
  GIT_CONFIG_VALUE_1: "false",
  GIT_CONFIG_KEY_0: `url.${remote}.insteadOf`,
  GIT_CONFIG_VALUE_0: `https://x-access-token:${TOKEN}@github.com/${REPO_NAME}.git`,
  UAT_HARNESS: path.join(REPO, "uat", "driver", "local-cli.mjs").replace(/\\/g, "/"),
};

function sh(script, extraEnv = {}, cwd = ws) {
  const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], { cwd, env: { ...env, ...extraEnv }, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const which = sh("command -v gh", {}, uat);
if (!/gh$/.test(which.stdout.trim()) || !which.stdout.includes("_uat/bin")) {
  process.stderr.write(`refusing: gh resolves to ${which.stdout.trim()}, not the stub\n`);
  process.exit(2);
}

// actions/checkout: a fresh clone of the default branch
const clone = spawnSync("git", ["clone", "--quiet", remote, ws], { encoding: "utf8", env });
if (clone.status !== 0) {
  process.stderr.write(clone.stderr);
  process.exit(2);
}

/** The run: block of the step named `name`, verbatim, de-indented. */
function block(name) {
  const lines = readFileSync(path.join(ACTION, "action.yml"), "utf8").split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  if (start < 0) throw new Error(`no step ${name}`);
  const runAt = lines.findIndex((l, i) => i > start && /^\s+run: \|$/.test(l));
  const out = [];
  let indent = null;
  for (let i = runAt + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === "") {
      out.push("");
      continue;
    }
    const lead = l.match(/^\s*/)[0].length;
    if (indent === null) indent = lead;
    if (lead < indent) break;
    out.push(l.slice(indent));
  }
  let text = out.join("\n");
  if (harness) text = text.split('node "$cli" watch').join('node "$UAT_HARNESS" watch');
  return text;
}
const oneLine = (name) => {
  const lines = readFileSync(path.join(ACTION, "action.yml"), "utf8").split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  const run = lines.slice(start).find((l) => /^\s+run: /.test(l));
  return run.replace(/^\s+run: /, "");
};

const outputs = {};
const steps = [];
function step(id, name, script, stepEnv) {
  const out = path.join(temp, `out-${id}.txt`);
  writeFileSync(out, "");
  const r = sh(script, { ...stepEnv, GITHUB_OUTPUT: out.replace(/\\/g, "/") });
  const o = {};
  for (const line of readFileSync(out, "utf8").split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at > 0) o[line.slice(0, at)] = line.slice(at + 1);
  }
  outputs[id] = o;
  steps.push({ id, name, code: r.code, stdoutTail: r.stdout.slice(-1500), stderrTail: r.stderr.slice(-1500), outputs: o });
  return r;
}

const inputs = {
  PLUMBLINE_COMMAND: "watch",
  PLUMBLINE_TARGET: "",
  PLUMBLINE_FAIL_ON: "fail",
  PLUMBLINE_ROOT: "site",
  PLUMBLINE_ISSUES: issues,
  PLUMBLINE_RELOCK_PR: relockPr,
  PLUMBLINE_RENEW: "false",
  PLUMBLINE_SIGNING_KEY: "",
  PLUMBLINE_ORIGIN: "",
};
let r = step("inputs", "Check the inputs", oneLine("Check the inputs"), inputs);
if (r.code !== 0) finish();
r = step("run", "Run plumbline", block("Run plumbline"), { ...inputs, PLUMBLINE_ADAPTERS: "validator,atlas,customs" });
if (r.code !== 0) finish();
if (issues === "true") {
  const base = { GH_TOKEN: TOKEN, GH_REPO: REPO_NAME };
  r = step("issue-plan", "Decide on the drift issue", block("Decide on the drift issue"), { ...base, FINDINGS: outputs.run.findings, BODY: outputs.run["issue-body"] });
  if (r.code !== 0) finish();
  r = step("issue-do", "Open, edit or close the drift issue", block("Open, edit or close the drift issue"), {
    ...base,
    ISSUE_ACTION: outputs["issue-plan"].action,
    NUMBER: outputs["issue-plan"].number,
    COMMENT: outputs["issue-plan"].comment,
    BODY: outputs.run["issue-body"],
  });
  if (r.code !== 0) finish();
}
if (relockPr === "true") {
  const base = { GH_TOKEN: TOKEN, GH_REPO: REPO_NAME };
  r = step("pr-plan", "Decide on the pull request", block("Decide on the pull request"), {
    ...base,
    MODE: "relock",
    REPORT: outputs.run.report,
    FINDINGS: outputs.run.findings,
    PLUMBLINE_ROOT: "site",
    PLUMBLINE_SIGNING_KEY: "",
    PLUMBLINE_ORIGIN: "",
  });
  if (r.code !== 0) finish();
  const p = outputs["pr-plan"];
  r = step("pr-do", "Open, update or close the pull request", block("Open, update or close the pull request"), {
    ...base,
    PR_ACTION: p.action,
    NUMBER: p.number,
    DRAFT: p.draft,
    TITLE: p.title,
    BRANCH: p.branch,
    BODY: p.body,
    COMMENT: p.comment,
    PLUMBLINE_ROOT: "site",
  });
}
finish();

function finish() {
  const gh = existsSync(ghState) ? JSON.parse(readFileSync(ghState, "utf8")) : { calls: [] };
  const failed = steps.find((s) => s.code !== 0);
  process.stdout.write(
    JSON.stringify({ label, harness, issues, relockPr, failedStep: failed ? failed.id : null, steps, ghCallsThisRun: gh.calls.filter((c) => c.run === label) }, null, 2) + "\n",
  );
  process.exit(failed ? 1 : 0);
}
