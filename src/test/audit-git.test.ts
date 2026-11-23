// `plumbline audit` against a real temp git repository (the git layer), spawned with the no-network preload: versions
// in order, an approval committed a commit later, an unapproved change, --out files, the exit codes.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { approveLock } from "../core/approve.js";
import { sha256Hex } from "../core/canonical.js";
import { generateKey } from "../core/keys.js";
import { AGENT_LOCK_TYPE, type AgentLock } from "../core/types.js";
import { CLI, NO_NETWORK, scratchDir } from "./cli-helpers.js";

function cli(env: Record<string, string>, ...args: string[]): { code: number | null; out: string; err: string } {
  const r = spawnSync(process.execPath, ["--import", NO_NETWORK, CLI, ...args], { encoding: "utf8", env: { ...process.env, PLUMBLINE_APPROVERS: "", ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
  });
}

test("audit over a real git history: versions in order, approval a commit later, an unapproved change, --out, exit codes", async () => {
  const repo = scratchDir();
  const home = scratchDir();
  const env = { PLUMBLINE_HOME: home };
  gitIn(repo, "init", "-q");

  // not yet a lock in the history: exit 1, lock-absent
  writeFileSync(path.join(repo, "README.md"), "x\n");
  gitIn(repo, "add", "README.md");
  gitIn(repo, "commit", "-q", "-m", "start");
  const none = cli(env, "audit", "--root", repo, "--json");
  assert.equal(none.code, 1, none.err);
  assert.equal((JSON.parse(none.out) as { findings: { code: string }[] }).findings[0]?.code, "lock-absent");

  const { key, privateKey } = await generateKey();
  writeFileSync(path.join(home, "approvers.json"), JSON.stringify({ type: "plumbline-approvers", version: 1, approvers: [{ kid: key.kid, publicKey: key.publicKey, label: "Alice", addedAt: "2026-11-21T00:00:00.000Z" }] }));

  const commitLock = async (previous: string | undefined, n: number, approveNow: boolean): Promise<string> => {
    const lock: AgentLock = { type: AGENT_LOCK_TYPE, version: 1, ...(previous ? { previous } : {}), declaration: "b".repeat(64), files: { [`p${n}.md`]: "c".repeat(64) }, lockedAt: "2026-11-21T09:00:00.000Z" };
    const text = JSON.stringify(lock, null, 2) + "\n";
    writeFileSync(path.join(repo, "plumbline.agent.lock.json"), text);
    gitIn(repo, "add", "plumbline.agent.lock.json");
    gitIn(repo, "commit", "-q", "-m", `lock ${n}`);
    if (approveNow) {
      writeFileSync(path.join(repo, "plumbline.agent.approval.json"), JSON.stringify(await approveLock({ privateKey, lockBytes: text, lock })));
      gitIn(repo, "add", "plumbline.agent.approval.json");
      gitIn(repo, "commit", "-q", "-m", `approve ${n}`);
    }
    return sha256Hex(text);
  };
  const h1 = await commitLock(undefined, 1, true);
  const h2 = await commitLock(h1, 2, true);

  const ok = cli(env, "audit", "--root", repo);
  assert.equal(ok.code, 0, ok.out + ok.err);
  assert.match(ok.out, /2 version\(s\): 2 verified/);
  assert.match(ok.out, /approved by Alice/);

  // a third lock, never approved: exit 1, and the report says which
  await commitLock(h2, 3, false);
  const outDir = path.join(scratchDir(), "evidence");
  mkdirSync(outDir);
  const bad = cli(env, "audit", "--root", repo, "--out", outDir, "--json");
  assert.equal(bad.code, 1, bad.err);
  const doc = JSON.parse(bad.out) as { versions: { approval: string; chain: string }[]; written: string[] };
  assert.deepEqual(doc.versions.map((v) => v.approval), ["verified", "verified", "absent"]);
  assert.deepEqual(doc.versions.map((v) => v.chain), ["start", "ok", "ok"]);
  const md = readFileSync(path.join(outDir, "audit.md"), "utf8");
  assert.match(md, /NOT APPROVED/);
  assert.equal((JSON.parse(readFileSync(path.join(outDir, "audit.json"), "utf8")) as { versions: unknown[] }).versions.length, 3);

  // without the approvers file every approval is unverifiable, never verified
  const stranger = cli({ PLUMBLINE_HOME: scratchDir() }, "audit", "--root", repo, "--json");
  assert.equal(stranger.code, 1);
  assert.deepEqual((JSON.parse(stranger.out) as { versions: { approval: string }[] }).versions.map((v) => v.approval), ["unverifiable", "unverifiable", "absent"]);

  // an approvers file inside the repository is refused, so it verifies nothing
  writeFileSync(path.join(repo, "approvers.json"), readFileSync(path.join(home, "approvers.json")));
  const inside = cli({}, "audit", "--root", repo, "--approvers", path.join(repo, "approvers.json"), "--json");
  assert.equal(inside.code, 1);
  assert.match((JSON.parse(inside.out) as { approvers: string }).approvers, /inside the repository/);
});

test("audit since the first approval (the trial's history): exit 0 listing 1 before approval; --all exit 1; delete and re-init reads start", async () => {
  const repo = scratchDir();
  const home = scratchDir();
  const env = { PLUMBLINE_HOME: home };
  gitIn(repo, "init", "-q");
  const { key, privateKey } = await generateKey();
  writeFileSync(path.join(home, "approvers.json"), JSON.stringify({ type: "plumbline-approvers", version: 1, approvers: [{ kid: key.kid, publicKey: key.publicKey, label: "Alice", addedAt: "2026-11-21T00:00:00.000Z" }] }));
  const lockFile = path.join(repo, "plumbline.agent.lock.json");
  const approvalFile = path.join(repo, "plumbline.agent.approval.json");
  const commitLock = async (previous: string | undefined, n: number, approve: boolean): Promise<string> => {
    const lock: AgentLock = { type: AGENT_LOCK_TYPE, version: 1, ...(previous ? { previous } : {}), declaration: "b".repeat(64), files: { [`p${n}.md`]: "c".repeat(64) }, lockedAt: "2026-11-21T09:00:00.000Z" };
    const text = JSON.stringify(lock, null, 2) + "\n";
    writeFileSync(lockFile, text);
    gitIn(repo, "add", "plumbline.agent.lock.json");
    if (approve) {
      // relock removes the old approval; the new one is committed with the lock (approve, then commit both)
      writeFileSync(approvalFile, JSON.stringify(await approveLock({ privateKey, lockBytes: text, lock })));
      gitIn(repo, "add", "plumbline.agent.approval.json");
    }
    gitIn(repo, "commit", "-q", "-m", `lock ${n}`);
    return sha256Hex(text);
  };
  // init's first lock committed before anyone approved it, then two approved relocks
  const h1 = await commitLock(undefined, 1, false);
  const h2 = await commitLock(h1, 2, true);
  await commitLock(h2, 3, true);

  const since = cli(env, "audit", "--root", repo);
  assert.equal(since.code, 0, since.out + since.err);
  assert.match(since.out, /1\. .*NOT APPROVED; first lock \(before approval began\)/);
  assert.match(since.out, /3 version\(s\): 2 verified, 0 invalid, 0 unverifiable, 1 not approved; 0 chain break\(s\)\./);
  assert.match(since.out, /The current lock is verified, and every change since approval began was approved with the chain whole\. 1 version\(s\) before approval began are listed and not counted/);
  const doc = JSON.parse(cli(env, "audit", "--root", repo, "--json").out) as { rule: string; clean: boolean; firstApproved: number; summary: { beforeApproval: number }; versions: { beforeApproval?: boolean }[] };
  assert.equal(doc.rule, "since-first-approval");
  assert.equal(doc.clean, true);
  assert.equal(doc.firstApproved, 2);
  assert.equal(doc.summary.beforeApproval, 1);
  assert.deepEqual(doc.versions.map((v) => v.beforeApproval === true), [true, false, false]);

  const all = cli(env, "audit", "--root", repo, "--all", "--json");
  assert.equal(all.code, 1, all.err);
  assert.equal((JSON.parse(all.out) as { rule: string }).rule, "all");

  // the lock is deleted, then init writes a new first lock (approved): a new chain starts, not a break
  gitIn(repo, "rm", "-q", "plumbline.agent.lock.json", "plumbline.agent.approval.json");
  gitIn(repo, "commit", "-q", "-m", "remove the lock");
  await commitLock(undefined, 4, true);
  const reinit = cli(env, "audit", "--root", repo, "--json");
  assert.equal(reinit.code, 0, reinit.out + reinit.err);
  assert.deepEqual((JSON.parse(reinit.out) as { versions: { chain: string }[] }).versions.map((v) => v.chain), ["start", "ok", "ok", "start"]);
  assert.match(cli(env, "audit", "--root", repo).out, /4\. .*approved by Alice .*; a new chain starts/);
});

test("audit: a folder that is not a git repository is exit 2; an unknown option is exit 2", () => {
  const plain = scratchDir();
  const r = cli({}, "audit", "--root", plain);
  assert.equal(r.code, 2);
  assert.match(r.err, /not inside a git repository/);
  assert.equal(cli({}, "audit", "--nope").code, 2);
});
