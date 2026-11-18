// The shared flag parser (src/cli/args.ts): single values, booleans, repeatable keys and positionals, and what it refuses.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ArgsError, UsageError, parseArgs, repeated } from "../cli/args.js";

/** Runs `fn`, expecting an ArgsError, and returns it. */
function refusal(fn: () => unknown): ArgsError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof ArgsError, String(error));
    assert.ok(error instanceof UsageError, "a parser refusal is a usage error (exit 2 and the usage line)");
    return error;
  }
  assert.fail("expected a refusal");
}

test("parseArgs: values, booleans and --json as before; a value given twice keeps the last", () => {
  const args = parseArgs(["--root", "a", "--yes", "--json", "--root", "b"], ["root"], ["yes"]);
  assert.equal(args.values.get("root"), "b");
  assert.deepEqual([...args.flags], ["yes"]);
  assert.equal(args.json, true);
  assert.deepEqual(args.positionals, []);
  assert.equal(args.lists.size, 0);
});

test("parseArgs: a repeatable key keeps every value in order, beside single values", () => {
  const args = parseArgs(["--source", "a.json", "--root", "r", "--source", "https://x.example/b.json"], ["root"], [], { repeatable: ["source", "drop"] });
  assert.deepEqual(repeated(args, "source"), ["a.json", "https://x.example/b.json"]);
  assert.equal(args.values.get("root"), "r");
  assert.equal(args.values.has("source"), false, "a repeatable key is never in values");
});

test("parseArgs: a repeatable key used once is a one-item list; one not given is an empty list", () => {
  const args = parseArgs(["--drop", "data/rooms.json"], [], [], { repeatable: ["source", "drop"] });
  assert.deepEqual(repeated(args, "drop"), ["data/rooms.json"]);
  assert.deepEqual(repeated(args, "source"), []);
  assert.deepEqual(args.lists.get("source"), [], "every declared repeatable key is present");
});

test("parseArgs: a repeatable key still needs a value each time", () => {
  const error = refusal(() => parseArgs(["--source", "a", "--source"], [], [], { repeatable: ["source"] }));
  assert.deepEqual([error.reason, error.arg, error.message], ["missing", "source", "--source needs a value"]);
  const flagAfter = refusal(() => parseArgs(["--source", "--json"], [], [], { repeatable: ["source"] }));
  assert.deepEqual([flagAfter.reason, flagAfter.arg], ["missing", "source"]);
});

test("parseArgs: positionals are collected in order, between flags, up to the number declared", () => {
  const args = parseArgs(["--timeout", "5", "https://site.example/", "--allow-local"], ["timeout"], ["allow-local"], { positionals: 1 });
  assert.deepEqual(args.positionals, ["https://site.example/"]);
  assert.equal(args.values.get("timeout"), "5");
  assert.ok(args.flags.has("allow-local"));
  assert.deepEqual(parseArgs(["a", "", "-x"], [], [], { positionals: 3 }).positionals, ["a", "", "-x"], "anything not starting with -- is a positional");

  const extra = refusal(() => parseArgs(["https://a.example/", "https://b.example/"], [], [], { positionals: 1 }));
  assert.deepEqual([extra.reason, extra.arg, extra.message], ["extra", "https://b.example/", "unexpected argument: https://b.example/"]);
});

test("parseArgs: a command that takes no positionals refuses one as an unknown option, as before", () => {
  const error = refusal(() => parseArgs(["somewhere"], ["root"]));
  assert.deepEqual([error.reason, error.arg, error.message], ["unknown", "somewhere", "unknown option: somewhere"]);
});

test("parseArgs: an unknown flag is still refused, also when repeatable keys and positionals are declared", () => {
  const error = refusal(() => parseArgs(["target", "--verbose"], ["root"], ["init"], { repeatable: ["source"], positionals: 1 }));
  assert.deepEqual([error.reason, error.arg, error.message], ["unknown", "--verbose", "unknown option: --verbose"]);
  const missing = refusal(() => parseArgs(["--root"], ["root"]));
  assert.deepEqual([missing.reason, missing.arg, missing.message], ["missing", "root", "--root needs a value"]);
});
