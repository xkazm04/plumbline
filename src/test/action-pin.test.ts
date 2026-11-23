// The Action runs the code of the commit an adopter pins: it builds plumbline from its own checkout and calls the CLI,
// with no package registry in between (the npm name `plumbline` belongs to an unrelated package, and npx's git
// installs fail on the runner's npm). The watch template uses that Action, pinned by full commit SHA. Text plus git.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// The tests run from a build folder one level under the repository root (dist/ or .build-*/).
const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string): string => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
const git = (...args: string[]): string => execFileSync("git", args, { cwd: root, encoding: "utf8" });

const action = read("action/action.yml");
const template = read("action/templates/plumbline-watch.yml");
// every template that uses the Action is held to the same rules (D10 added the renewal template)
const TEMPLATES = ["action/templates/plumbline-watch.yml", "action/templates/plumbline-renew.yml"] as const;
const code = (text: string): string => text.split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");

test("the Action builds plumbline from its own checkout and runs the built CLI", () => {
  assert.match(action, /cd "\$GITHUB_ACTION_PATH\/\.\."\n\s+npm ci /);
  assert.match(action, /npm run build/);
  assert.match(action, /cli="\$GITHUB_ACTION_PATH\/\.\.\/dist\/cli\/index\.js"/);
});

/**
 * What the runner refuses when it loads an action.yml, before any step runs ("Unrecognized named-value: 'secrets'",
 * every scheduled watch from 2026-11-18 to 11-23): it evaluates `${{ }}` everywhere in the file, descriptions included,
 * and an action's metadata has no `secrets` or `vars` context (a workflow passes them in as inputs).
 */
function loadRefusals(text: string): string[] {
  const out: string[] = [];
  for (const [i, line] of text.split("\n").entries()) {
    if (/^\s*description:.*\$\{\{/.test(line)) out.push(`line ${i + 1}: an expression in a description`);
    for (const m of line.matchAll(/\$\{\{\s*([A-Za-z_]+)/g)) if (m[1] === "secrets" || m[1] === "vars") out.push(`line ${i + 1}: the ${m[1]} context`);
  }
  return out;
}

test("action.yml loads on the runner: no expression in a description, no secrets or vars context", () => {
  assert.deepEqual(loadRefusals(action), []);
  assert.deepEqual(loadRefusals('    description: "from `${{ secrets.KEY }}`"\n'), ["line 1: an expression in a description", "line 1: the secrets context"]);
});

test("nothing installs plumbline from a registry or by name: no npx, no plumbline@", () => {
  // the agent template (two jobs, two uses of the Action) has its pin checked in action/agent.test.mjs
  for (const text of [code(action), ...[...TEMPLATES, "action/templates/plumbline-agent.yml"].map((t) => code(read(t)))]) {
    assert.doesNotMatch(text, /\bnpx\b/);
    assert.doesNotMatch(text, /plumbline@/);
  }
});

for (const file of TEMPLATES) test(`${file} uses this repository's Action pinned to a full commit SHA that holds the self-building Action`, () => {
  const template = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  const uses = [...template.matchAll(/uses: xkazm04\/plumbline\/action@([^\s#]+)/g)].map((m) => m[1]);
  assert.equal(uses.length, 1, "the template uses the Action once");
  const sha = uses[0]!;
  assert.match(sha, /^[0-9a-f]{40}$/);
  // check.yml checks out with fetch-depth 0, so an older commit is present in CI too.
  git("cat-file", "-e", `${sha}^{commit}`);
  const pinned = git("show", `${sha}:action/action.yml`);
  assert.match(pinned, /cd "\$GITHUB_ACTION_PATH\/\.\."/, "the pinned commit's Action builds itself");
  assert.match(pinned, /\n {2}command:\n/, "the pinned commit's Action has the command input the template uses");
  // every input the template passes to the Action must exist in the pinned commit's action.yml: GitHub only warns about
  // an unknown input, so a pin older than the input silently ignores it (an `issues: true` that opens no issue)
  const block = /uses: xkazm04\/plumbline\/action@[^\n]+\n\s+with:\n((?:\s{10,}[a-z-]+:.*\n)+)/.exec(template);
  assert.ok(block, "the template passes inputs to the Action");
  const passed = [...block[1]!.matchAll(/^\s+([a-z-]+):/gm)].map((m) => m[1]!);
  assert.ok(passed.length > 0);
  const inputsPart = pinned.slice(pinned.indexOf("\ninputs:"), pinned.indexOf("\noutputs:"));
  for (const name of passed) assert.match(inputsPart, new RegExp(`\\n {2}${name}:\\n`), `the pinned Action declares the input ${name}`);
  // every Action output the template reads must exist in the pinned commit's action.yml, or the step reads ""
  const read = [...template.matchAll(/steps\.watch\.outputs\.([a-z-]+)/g)].map((m) => m[1]!);
  assert.ok(read.length > 0, "the template reads the Action's outputs");
  for (const name of read) assert.match(pinned, new RegExp(`\\n {2}${name}:\\n`), `the pinned Action declares the output ${name}`);
  const pkg = JSON.parse(git("show", `${sha}:package.json`)) as { private?: boolean; scripts?: Record<string, string> };
  assert.equal(pkg.private, true, "never publishable to npm under a name we do not own");
  assert.ok(pkg.scripts?.build);
});

test("the Action and the template never pass --allow-local (a comment may name it)", () => {
  assert.doesNotMatch(code(action), /allow-local/);
  for (const file of TEMPLATES) assert.doesNotMatch(code(read(file)), /allow-local/);
});
