// The Action and the watch template run plumbline from THIS repository at one exact commit, never from npm: the npm
// name `plumbline` belongs to an unrelated package, so `npx plumbline@...` would run a stranger's code in an adopter's
// CI. Pinning the action by commit SHA then pins the code that runs. A text check plus git; no YAML dependency.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// The tests run from a build folder one level under the repository root (dist/ or .build-*/).
const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string): string => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
const git = (...args: string[]): string => execFileSync("git", args, { cwd: root, encoding: "utf8" });

const REPO = "xkazm04/plumbline";
const action = read("action/action.yml");
const template = read("action/templates/plumbline-watch.yml");

const actionDefault = /\n {2}plumbline-ref:\n(?: {4}.*\n)*? {4}default: *"?([^"\n]+)"?\n/.exec(action)?.[1]?.trim();
const templatePins = [...template.matchAll(/PLUMBLINE_REF: *"?([0-9a-f]+)"?/g)].map((m) => m[1]);

test("action.yml: plumbline-ref defaults to a full commit SHA and reaches the script through the environment", () => {
  assert.ok(actionDefault, "action.yml declares a plumbline-ref input with a default");
  assert.match(actionDefault, /^[0-9a-f]{40}$/);
  assert.match(action, /PLUMBLINE_REF: \$\{\{ inputs\.plumbline-ref \}\}/);
});

test("the watch template pins the same commit as the Action", () => {
  assert.ok(templatePins.length > 0, "the template sets PLUMBLINE_REF");
  for (const pin of templatePins) assert.equal(pin, actionDefault);
});

test("the pinned commit is in this repository's history and builds itself on a git install", () => {
  assert.ok(actionDefault);
  // check.yml checks out with fetch-depth 0, so an older commit is present in CI too.
  git("cat-file", "-e", `${actionDefault}^{commit}`);
  const pkg = JSON.parse(git("show", `${actionDefault}:package.json`)) as {
    private?: boolean; files?: string[]; scripts?: Record<string, string>; bin?: Record<string, string>;
  };
  assert.equal(pkg.private, true, "never publishable to npm under a name we do not own");
  assert.ok(pkg.scripts?.prepare, "a git install runs prepare to build dist/");
  assert.ok(pkg.files?.includes("dist"), "the packed install keeps dist/ although .gitignore excludes it");
  assert.equal(pkg.bin?.plumbline, "dist/cli/index.js");
});

test("every npx line installs from this repository at the pinned ref; none names the npm package", () => {
  // the lines that RUN npx (a quoted package spec after `npx --yes`), not prose that tells a person what to type
  const lines = [action, template].flatMap((t) => t.split("\n")).filter((l) => /\bnpx --yes "/.test(l) && !l.trim().startsWith("#"));
  assert.ok(lines.length >= 2, `found the npx lines: ${lines.length}`);
  for (const line of lines) assert.ok(line.includes(`github:${REPO}#$PLUMBLINE_REF`), line.trim());
  assert.doesNotMatch(action + template, /plumbline@/);
});

test("the Action and the template never pass --allow-local (a comment may name it)", () => {
  const code = (text: string): string => text.split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");
  assert.doesNotMatch(code(action), /allow-local/);
  assert.doesNotMatch(code(template), /allow-local/);
});
