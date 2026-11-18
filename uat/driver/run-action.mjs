#!/usr/bin/env node
// UAT runner for the GitHub Action's WATCH path (action/action.yml). NOT the product, and not a GitHub runner.
// First written for the marta-hollis L2 walk (run 2026-11-18-first-five, evidence/marta/run-action.mjs, kept there);
// generalised here as a tracked overlay tool (repository name, site root, remote set-up are options, not constants).
//
// It executes the `run:` blocks of action/action.yml VERBATIM, read from the file at run time, in
// `bash --noprofile --norc -eo pipefail` as GitHub does, with the env each step declares. What differs from a GitHub
// runner, and nothing else:
//   - the workspace is a fresh `git clone` of a local bare remote (actions/checkout, core.autocrlf=false as on Linux),
//     and the Action's push URL (https://x-access-token:<token>@github.com/<repo>.git) is mapped onto that remote with
//     git's url.<remote>.insteadOf, given through GIT_CONFIG_* env (no config file is written), so the push and fetch
//     command lines are byte for byte the Action's;
//   - `gh` is uat/driver/gh-stub.mjs, first on PATH (the runner refuses to start if `command -v gh` is anything else);
//   - the Build step is skipped: build dist/ from the commit under test first (npm run build);
//   - with --harness, the text `node "$cli" watch` is replaced by `node "<uat/driver/local-cli.mjs>" watch` (the test
//     harness: the built modules with allowLocal, so a loopback peer is watched as an https one would be). Anything
//     measured that way is "reachable only through the test harness". Sign and relock stay the real CLI's.
//   - the Action is never given a signing key here (inputs.signing-key and origin are empty), so every relock pull
//     request is the unsigned draft; that is the Action's own rule for a keyless run.
//
//   node uat/driver/run-action.mjs --world <world dir> --label <run label> [--repo <site repo folder>] [--setup-remote]
//        [--root site] [--repo-name owner/name] [--issues true|false] [--relock-pr true|false] [--harness]
//
// --world is the world's temp folder (`world.mjs status <world>` prints it as `dir`); state lives in <world>/_uat/
// (remote.git, ws/<label>, tmp/<label>, bin/gh, gh-state.json), so `world.mjs down` removes it with the world.
// --setup-remote (once per world, with --repo = the site repository folder, `sites[].repo`): git init the repository
// if needed, commit everything as it is, create <world>/_uat/remote.git and push it as `main`. After that, a change a
// Character makes is committed and pushed to that remote the ordinary way (git -C <repo> commit / push) before a run.
// Prints ONE JSON document: each step's exit code, outputs and output tails, and the gh calls this run made, each
// marked with whether GitHub would notify watchers. Exit 0 every step passed, 1 a step failed (that is a finding when
// the Action's own step failed, as the stale-info push did in run 2026-11-18-first-five), 2 usage or environment.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const ACTION = path.join(REPO, "action");
const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const world = opt("--world");
const label = opt("--label");
const siteRepo = opt("--repo");
const root = opt("--root", "site");
const repoName = opt("--repo-name", "uat-world/site");
const issues = opt("--issues", "true");
const relockPr = opt("--relock-pr", "false");
const harness = argv.includes("--harness");
const setupRemote = argv.includes("--setup-remote");
const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(2);
};
if (!world || !label) fail("usage: run-action.mjs --world <dir> --label <label> [--repo <dir>] [--setup-remote] [--root site] [--repo-name o/n] [--issues true] [--relock-pr true] [--harness]");
if (!existsSync(path.join(REPO, "dist", "cli", "index.js"))) fail("dist/ is not built: run npm run build first");
const uat = path.join(world, "_uat");
const remote = path.join(uat, "remote.git").replace(/\\/g, "/");
const ws = path.join(uat, "ws", label);
const temp = path.join(uat, "tmp", label);
const bin = path.join(uat, "bin");
const ghState = path.join(uat, "gh-state.json");
mkdirSync(bin, { recursive: true });

const git = (args, cwd) => {
  const r = spawnSync("git", ["-c", "core.autocrlf=false", "-c", "user.name=uat-world", "-c", "user.email=uat-world@example.invalid", ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) fail(`git ${args.join(" ")} failed in ${cwd}: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
};
if (setupRemote) {
  if (!siteRepo) fail("--setup-remote needs --repo <the site repository folder>");
  if (existsSync(remote)) fail(`${remote} already exists: --setup-remote is once per world`);
  if (!existsSync(path.join(siteRepo, ".git"))) git(["init", "--quiet", "-b", "main"], siteRepo);
  git(["add", "-A"], siteRepo);
  git(["commit", "--quiet", "--allow-empty", "-m", "the site as the world left it"], siteRepo);
  mkdirSync(uat, { recursive: true });
  git(["init", "--quiet", "--bare", "-b", "main", remote], uat);
  git(["push", "--quiet", remote, "HEAD:refs/heads/main"], siteRepo);
}
if (!existsSync(remote)) fail(`no remote at ${remote}: run once with --setup-remote --repo <site repository folder>`);

rmSync(ws, { recursive: true, force: true });
rmSync(temp, { recursive: true, force: true });
mkdirSync(temp, { recursive: true });
writeFileSync(path.join(bin, "gh"), `#!/bin/bash\nexec node "${path.join(HERE, "gh-stub.mjs").replace(/\\/g, "/")}" "$@"\n`, { mode: 0o755 });

const TOKEN = "uat-stub-token";
const env = {
  ...process.env,
  PATH: `${bin}${path.delimiter}${process.env.PATH}`,
  GH_STUB_STATE: ghState,
  UAT_RUN_LABEL: label,
  GITHUB_ACTION_PATH: ACTION.replace(/\\/g, "/"),
  GITHUB_WORKSPACE: ws.replace(/\\/g, "/"),
  RUNNER_TEMP: temp.replace(/\\/g, "/"),
  GITHUB_REPOSITORY: repoName,
  GITHUB_RUN_ID: label,
  GITHUB_SERVER_URL: "https://github.com",
  GIT_CONFIG_COUNT: "2",
  GIT_CONFIG_KEY_0: `url.${remote}.insteadOf`,
  GIT_CONFIG_VALUE_0: `https://x-access-token:${TOKEN}@github.com/${repoName}.git`,
  GIT_CONFIG_KEY_1: "core.autocrlf",
  GIT_CONFIG_VALUE_1: "false",
  UAT_HARNESS: path.join(REPO, "uat", "driver", "local-cli.mjs").replace(/\\/g, "/"),
};

function sh(script, extraEnv = {}, cwd = ws) {
  const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], { cwd, env: { ...env, ...extraEnv }, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const which = sh("command -v gh", {}, uat);
if (!/gh$/.test(which.stdout.trim()) || !which.stdout.includes("_uat/bin")) fail(`refusing: gh resolves to ${which.stdout.trim()}, not the stub`);

// actions/checkout: a fresh clone of the default branch
const clone = spawnSync("git", ["clone", "--quiet", remote, ws], { encoding: "utf8", env });
if (clone.status !== 0) fail(clone.stderr);

const actionLines = readFileSync(path.join(ACTION, "action.yml"), "utf8").split(/\r?\n/);
/** The run: block of the step named `name`, verbatim, de-indented. */
function block(name) {
  const start = actionLines.findIndex((l) => l.trim() === `- name: ${name}`);
  if (start < 0) throw new Error(`action.yml has no step "${name}"`);
  const runAt = actionLines.findIndex((l, i) => i > start && /^\s+run: \|$/.test(l));
  const out = [];
  let indent = null;
  for (let i = runAt + 1; i < actionLines.length; i++) {
    const l = actionLines[i];
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
  const start = actionLines.findIndex((l) => l.trim() === `- name: ${name}`);
  const run = actionLines.slice(start).find((l) => /^\s+run: /.test(l));
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
  PLUMBLINE_ROOT: root,
  PLUMBLINE_ISSUES: issues,
  PLUMBLINE_RELOCK_PR: relockPr,
  PLUMBLINE_RENEW: "false",
  PLUMBLINE_SIGNING_KEY: "",
  PLUMBLINE_ORIGIN: "",
};
const base = { GH_TOKEN: TOKEN, GH_REPO: repoName };
run();
finish();

function run() {
  if (step("inputs", "Check the inputs", oneLine("Check the inputs"), inputs).code !== 0) return;
  if (step("run", "Run plumbline", block("Run plumbline"), { ...inputs, PLUMBLINE_ADAPTERS: "validator,atlas,customs" }).code !== 0) return;
  if (issues === "true") {
    if (step("issue-plan", "Decide on the drift issue", block("Decide on the drift issue"), { ...base, FINDINGS: outputs.run.findings, BODY: outputs.run["issue-body"], REPORT: outputs.run.report }).code !== 0) return;
    const plan = outputs["issue-plan"];
    const r = step("issue-do", "Open, edit or close the drift issue", block("Open, edit or close the drift issue"), {
      ...base,
      ISSUE_ACTION: plan.action,
      NUMBER: plan.number,
      COMMENT: plan.comment,
      BODY: outputs.run["issue-body"],
    });
    if (r.code !== 0) return;
  }
  if (relockPr === "true") {
    const r = step("pr-plan", "Decide on the pull request", block("Decide on the pull request"), {
      ...base,
      MODE: "relock",
      REPORT: outputs.run.report,
      FINDINGS: outputs.run.findings,
      PLUMBLINE_ROOT: root,
      PLUMBLINE_SIGNING_KEY: "",
      PLUMBLINE_ORIGIN: "",
    });
    if (r.code !== 0) return;
    const p = outputs["pr-plan"];
    step("pr-do", "Open, update or close the pull request", block("Open, update or close the pull request"), {
      ...base,
      PR_ACTION: p.action,
      NUMBER: p.number,
      DRAFT: p.draft,
      TITLE: p.title,
      BRANCH: p.branch,
      BODY: p.body,
      COMMENT: p.comment,
      PLUMBLINE_ROOT: root,
    });
  }
}

function finish() {
  const gh = existsSync(ghState) ? JSON.parse(readFileSync(ghState, "utf8")) : { calls: [] };
  const failed = steps.find((s) => s.code !== 0);
  process.stdout.write(
    `${JSON.stringify({ label, harness, issues, relockPr, repoName, root, failedStep: failed ? failed.id : null, steps, ghCallsThisRun: gh.calls.filter((c) => c.run === label) }, null, 2)}\n`,
  );
  process.exit(failed ? 1 : 0);
}
