// The approvers file's resolution (src/cli/approvers-file.ts): order (file, env, default), absence, problems, and the
// refusal of an approvers file inside the repository it governs.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { APPROVERS_IN_REPOSITORY, defaultApproversPath, resolveApprovers } from "../cli/approvers-file.js";
import { generateKey } from "../core/keys.js";
import type { ApproverEntry } from "../core/types.js";

async function entry(label: string): Promise<ApproverEntry> {
  const { key } = await generateKey();
  return { kid: key.kid, publicKey: key.publicKey, label, addedAt: "2026-11-21T10:00:00.000Z" };
}
const textOf = (entries: ApproverEntry[]): string => JSON.stringify({ type: "plumbline-approvers", version: 1, approvers: entries });

test("defaultApproversPath: $PLUMBLINE_HOME/approvers.json, else <home>/.config/plumbline/approvers.json", () => {
  const home = path.resolve("somewhere");
  assert.equal(defaultApproversPath({ PLUMBLINE_HOME: home }), path.join(home, "approvers.json"));
  assert.equal(defaultApproversPath({}), path.join(os.homedir(), ".config", "plumbline", "approvers.json"));
  assert.equal(defaultApproversPath({ PLUMBLINE_HOME: "" }), path.join(os.homedir(), ".config", "plumbline", "approvers.json"));
});

test("resolution order: --approvers file, then PLUMBLINE_APPROVERS, then the default path", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plumbline-approvers-"));
  const [a, b, c] = [await entry("File"), await entry("Env"), await entry("Default")];
  const file = path.join(dir, "given.json");
  await writeFile(file, textOf([a]));
  const home = path.join(dir, "home");
  await mkdir(home);
  await writeFile(path.join(home, "approvers.json"), textOf([c]));
  const env = { PLUMBLINE_APPROVERS: textOf([b]), PLUMBLINE_HOME: home };

  const fromFile = await resolveApprovers(file, env);
  assert.deepEqual(fromFile, { ok: true, approvers: [a], source: "file", path: file });
  const fromEnv = await resolveApprovers(undefined, env);
  assert.deepEqual(fromEnv, { ok: true, approvers: [b], source: "env" });
  const fromDefault = await resolveApprovers(undefined, { PLUMBLINE_HOME: home, PLUMBLINE_APPROVERS: "  " });
  assert.deepEqual(fromDefault, { ok: true, approvers: [c], source: "default", path: path.join(home, "approvers.json") });
});

test("absent: nothing at the place looked", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plumbline-approvers-"));
  const missing = path.join(dir, "nope.json");
  assert.deepEqual(await resolveApprovers(missing, {}), { ok: false, absent: true, looked: missing });
  assert.deepEqual(await resolveApprovers(undefined, { PLUMBLINE_HOME: dir }), {
    ok: false,
    absent: true,
    looked: path.join(dir, "approvers.json"),
  });
});

test("problems: not JSON, wrong shape, a kid not derived from its key; the sentence never quotes the content", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plumbline-approvers-"));
  const file = path.join(dir, "bad.json");
  await writeFile(file, "SECRET not json");
  const r1 = await resolveApprovers(file, {});
  assert.equal(r1.ok, false);
  assert.ok("problem" in r1 && r1.source === "file" && !r1.problem.includes("SECRET"));
  const [a, b] = [await entry("A"), await entry("B")];
  const r2 = await resolveApprovers(undefined, { PLUMBLINE_APPROVERS: textOf([{ ...a, kid: b.kid }]) });
  assert.ok("problem" in r2 && r2.source === "env" && /not derived/.test(r2.problem));
});

test("an approvers file inside the repository root is refused, by --approvers or by PLUMBLINE_HOME", async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), "plumbline-repo-"));
  const inside = path.join(repo, "approvers.json");
  await writeFile(inside, textOf([await entry("Mallory")]));
  assert.deepEqual(await resolveApprovers(inside, {}, repo), { ok: false, problem: APPROVERS_IN_REPOSITORY, source: "file" });
  assert.deepEqual(await resolveApprovers(undefined, { PLUMBLINE_HOME: repo }, repo), {
    ok: false,
    problem: APPROVERS_IN_REPOSITORY,
    source: "default",
  });
  // outside the root it is read
  const outside = await mkdtemp(path.join(os.tmpdir(), "plumbline-outside-"));
  const ok = path.join(outside, "approvers.json");
  await writeFile(ok, textOf([await entry("Alice")]));
  assert.equal((await resolveApprovers(ok, {}, repo)).ok, true);
  // the environment variable has no place, so it is never refused for one
  assert.equal((await resolveApprovers(undefined, { PLUMBLINE_APPROVERS: textOf([]) }, repo)).ok, true);
});
