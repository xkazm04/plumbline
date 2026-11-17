// The Action and the watch template run an exact plumbline version, equal to package.json's: pinning the action by
// commit SHA then pins the code that runs, not whatever npm serves that day. A text check; no YAML dependency.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The tests run from a build folder one level under the repository root (dist/ or .build-*/).
const read = (rel: string): string => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

const version = (JSON.parse(read("package.json")) as { version: string }).version;
const action = read("action/action.yml");
const template = read("action/templates/plumbline-watch.yml");

/** Every line that runs plumbline through npx. */
const npxLines = (text: string): string[] => text.split("\n").filter((line) => /\bnpx\b/.test(line) && /plumbline/.test(line));

test("action.yml: the plumbline-version input defaults to package.json's version", () => {
  const input = /\n {2}plumbline-version:\n(?: {4}.*\n)*? {4}default: *"?([^"\n]+)"?\n/.exec(action);
  assert.ok(input, "action.yml declares a plumbline-version input with a default");
  assert.equal(input[1]?.trim(), version);
  assert.match(action, /PLUMBLINE_VERSION: \$\{\{ inputs\.plumbline-version \}\}/, "the input reaches the script through the environment");
});

test("the watch template pins PLUMBLINE_VERSION to package.json's version", () => {
  const pins = [...template.matchAll(/PLUMBLINE_VERSION: *"?([^"\s]+)"?/g)].map((m) => m[1]);
  assert.ok(pins.length > 0, "the template sets PLUMBLINE_VERSION");
  for (const pin of pins) assert.equal(pin, version);
  for (const m of template.matchAll(/plumbline@([0-9][^\s`"]*)/g)) assert.equal(m[1], version, "every literal plumbline@<v> matches");
});

test("every npx invocation of plumbline names a version: none runs the unpinned latest", () => {
  const lines = [...npxLines(action), ...npxLines(template)];
  assert.ok(lines.length >= 3, `found the npx lines: ${lines.length}`);
  for (const line of lines) assert.match(line, /plumbline@/, line.trim());
  assert.doesNotMatch([...lines].join("\n"), /npx (?:--yes )?plumbline(?!@)/);
});

test("the Action and the template never pass --allow-local (a comment may name it)", () => {
  const code = (text: string): string => text.split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");
  assert.doesNotMatch(code(action), /allow-local/);
  assert.doesNotMatch(code(template), /allow-local/);
});
