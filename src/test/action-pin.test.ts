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
const code = (text: string): string => text.split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");

test("the Action builds plumbline from its own checkout and runs the built CLI", () => {
  assert.match(action, /cd "\$GITHUB_ACTION_PATH\/\.\."\n\s+npm ci /);
  assert.match(action, /npm run build/);
  assert.match(action, /cli="\$GITHUB_ACTION_PATH\/\.\.\/dist\/cli\/index\.js"/);
});

test("nothing installs plumbline from a registry or by name: no npx, no plumbline@", () => {
  for (const text of [code(action), code(template)]) {
    assert.doesNotMatch(text, /\bnpx\b/);
    assert.doesNotMatch(text, /plumbline@/);
  }
});

test("the watch template uses this repository's Action pinned to a full commit SHA that holds the self-building Action", () => {
  const uses = [...template.matchAll(/uses: xkazm04\/plumbline\/action@([^\s#]+)/g)].map((m) => m[1]);
  assert.equal(uses.length, 1, "the template uses the Action once");
  const sha = uses[0]!;
  assert.match(sha, /^[0-9a-f]{40}$/);
  // check.yml checks out with fetch-depth 0, so an older commit is present in CI too.
  git("cat-file", "-e", `${sha}^{commit}`);
  const pinned = git("show", `${sha}:action/action.yml`);
  assert.match(pinned, /cd "\$GITHUB_ACTION_PATH\/\.\."/, "the pinned commit's Action builds itself");
  assert.match(pinned, /\n {2}command:\n/, "the pinned commit's Action has the command input the template uses");
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
  assert.doesNotMatch(code(template), /allow-local/);
});
