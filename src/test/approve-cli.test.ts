// `plumbline approver add` (spawned) and `plumbline approve` (in process, with a stand-in lock reader until WP2's
// parseAgentLock is merged). Keys are made in temp folders; nothing touches the network.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { Parsed } from "../agent/lock.js";
import { approveWith } from "../cli/approve-command.js";
import { CliError } from "../cli/args.js";
import { verifyApproval, parseApprovers } from "../core/approve.js";
import { sha256Hex } from "../core/canonical.js";
import { AGENT_LOCK_TYPE, type AgentLock } from "../core/types.js";
import { CLI, NO_NETWORK, scratchDir } from "./cli-helpers.js";

function cli(env: Record<string, string>, ...args: string[]): { code: number | null; out: string; err: string } {
  const merged: NodeJS.ProcessEnv = { ...process.env, PLUMBLINE_APPROVERS: "", ...env };
  const r = spawnSync(process.execPath, ["--import", NO_NETWORK, CLI, ...args], { encoding: "utf8", env: merged });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function keygen(dir: string): { privateFile: string; publicRecord: string } {
  const r = cli({}, "keygen", "--out", dir);
  assert.equal(r.code, 0, r.err);
  return { privateFile: path.join(dir, "plumbline.private.json"), publicRecord: path.join(dir, ".well-known", "plumbline-key.json") };
}

/** WP2 owns the real reader; this stand-in checks only what approve needs. */
const parseLock = (text: string): Parsed<AgentLock> => {
  try {
    const v = JSON.parse(text) as AgentLock;
    return v.type === AGENT_LOCK_TYPE ? { ok: true, value: v } : { ok: false, problem: "not a lock" };
  } catch {
    return { ok: false, problem: "not JSON" };
  }
};

function writeLock(root: string, previous?: string): string {
  const lock = { type: AGENT_LOCK_TYPE, version: 1, ...(previous ? { previous } : {}), declaration: "b".repeat(64), files: {}, lockedAt: "2026-11-21T09:00:00.000Z" };
  const text = JSON.stringify(lock, null, 2) + "\n";
  writeFileSync(path.join(root, "plumbline.agent.lock.json"), text);
  return text;
}

test("approver add: creates the file and its folder, prints the kid and path, refuses a duplicate kid", () => {
  const keys = scratchDir();
  const home = path.join(scratchDir(), "deep", "home");
  const { publicRecord } = keygen(keys);
  const kid = (JSON.parse(readFileSync(publicRecord, "utf8")) as { kid: string }).kid;
  const added = cli({ PLUMBLINE_HOME: home }, "approver", "add", "--key", publicRecord, "--label", "Alice");
  assert.equal(added.code, 0, added.err);
  const file = path.join(home, "approvers.json");
  assert.match(added.out, new RegExp(kid));
  assert.ok(added.out.includes(file));
  assert.match(added.out, /Next:/);
  const parsed = parseApprovers(readFileSync(file, "utf8"));
  assert.deepEqual(parsed.approvers.map((e) => [e.kid, e.label]), [[kid, "Alice"]]);
  const again = cli({ PLUMBLINE_HOME: home }, "approver", "add", "--key", publicRecord, "--label", "Alice again");
  assert.equal(again.code, 2);
  assert.match(again.err, /already in/);
  // a second person is added beside the first
  const bob = keygen(scratchDir());
  assert.equal(cli({}, "approver", "add", "--key", bob.publicRecord, "--label", "Bob", "--file", file, "--json").code, 0);
  assert.equal(parseApprovers(readFileSync(file, "utf8")).approvers.length, 2);
});

test("approver add: refuses a repository folder, a private key file, a bad label, and a missing action", () => {
  const { publicRecord, privateFile } = keygen(scratchDir());
  const repo = scratchDir();
  mkdirSync(path.join(repo, ".git"));
  const inRepo = cli({}, "approver", "add", "--key", publicRecord, "--label", "A", "--file", path.join(repo, "approvers.json"));
  assert.equal(inRepo.code, 2);
  assert.match(inRepo.err, /git repository/);
  const agentRepo = scratchDir();
  writeFileSync(path.join(agentRepo, "plumbline.agent.json"), "{}");
  mkdirSync(path.join(agentRepo, "sub"));
  const below = cli({}, "approver", "add", "--key", publicRecord, "--label", "A", "--file", path.join(agentRepo, "sub", "approvers.json"));
  assert.equal(below.code, 2);
  assert.match(below.err, /declares an agent/);
  const out = path.join(scratchDir(), "approvers.json");
  assert.equal(cli({}, "approver", "add", "--key", privateFile, "--label", "A", "--file", out).code, 2);
  const longLabel = cli({}, "approver", "add", "--key", publicRecord, "--label", "x".repeat(81), "--file", out);
  assert.equal(longLabel.code, 2);
  assert.match(longLabel.err, /--label/);
  assert.equal(existsSync(out), false);
  assert.equal(cli({}, "approver", "--key", publicRecord, "--label", "A").code, 2);
});

test("approve: writes an approval that verifies against the approver's entry; previous is repeated", async () => {
  const keys = scratchDir();
  const { privateFile, publicRecord } = keygen(keys);
  const record = JSON.parse(readFileSync(publicRecord, "utf8")) as { kid: string; publicKey: string };
  const root = scratchDir();
  const prev = "a".repeat(64);
  const text = writeLock(root, prev);
  const lines: string[] = [];
  const code = await approveWith(["--key", privateFile, "--root", root], (l) => lines.push(l), { parseLock, env: {} });
  assert.equal(code, 0);
  const hash = await sha256Hex(text);
  assert.ok(lines.some((l) => l.includes(record.kid) && l.includes(hash.slice(0, 12))));
  assert.match(lines.at(-1) ?? "", /^Next: commit plumbline.agent.lock.json and plumbline.agent.approval.json together/);
  const approval = JSON.parse(readFileSync(path.join(root, "plumbline.agent.approval.json"), "utf8")) as Record<string, unknown>;
  assert.equal(approval.previous, prev);
  const verdict = await verifyApproval(text, approval, [{ kid: record.kid, publicKey: record.publicKey, label: "A", addedAt: "2026-11-21T00:00:00.000Z" }]);
  assert.equal(verdict.state, "verified");
});

test("approve --key-env: reads the key from the environment and prints the CI custody notes", async () => {
  const { privateFile } = keygen(scratchDir());
  const root = scratchDir();
  writeLock(root);
  const lines: string[] = [];
  const code = await approveWith(["--key-env", "APPROVER_KEY", "--root", root, "--json"], (l) => lines.push(l), {
    parseLock,
    env: { APPROVER_KEY: readFileSync(privateFile, "utf8") },
  });
  assert.equal(code, 0);
  const doc = JSON.parse(lines[0] as string) as { notes: string[]; previous?: string };
  assert.ok(doc.notes.some((n) => /secret store/.test(n)));
  assert.equal("previous" in doc, false);
});

test("approve refuses: no lock, not a lock, a key inside the repository, a private key file in the root, both or neither key", async () => {
  const { privateFile } = keygen(scratchDir());
  const sink = (): void => undefined;
  const empty = scratchDir();
  await assert.rejects(approveWith(["--key", privateFile, "--root", empty], sink, { parseLock, env: {} }), (e: Error) => e instanceof CliError && /agent init/.test(e.message));
  const bad = scratchDir();
  writeFileSync(path.join(bad, "plumbline.agent.lock.json"), "{}");
  await assert.rejects(approveWith(["--key", privateFile, "--root", bad], sink, { parseLock, env: {} }), /not an agent lock/);
  const root = scratchDir();
  writeLock(root);
  const keyInside = path.join(root, "keys", "mine.json");
  mkdirSync(path.dirname(keyInside));
  writeFileSync(keyInside, readFileSync(privateFile));
  await assert.rejects(approveWith(["--key", keyInside, "--root", root], sink, { parseLock, env: {} }), /inside the repository/);
  const withPrivate = scratchDir();
  writeLock(withPrivate);
  writeFileSync(path.join(withPrivate, "plumbline.private.json"), readFileSync(privateFile));
  await assert.rejects(approveWith(["--key", privateFile, "--root", withPrivate], sink, { parseLock, env: {} }), /holds a plumbline.private.json/);
  await assert.rejects(approveWith(["--root", root], sink, { parseLock, env: {} }), /exactly one of --key and --key-env/);
  await assert.rejects(approveWith(["--key", privateFile, "--key-env", "X", "--root", root], sink, { parseLock, env: {} }), /exactly one/);
  assert.equal(existsSync(path.join(root, "plumbline.agent.approval.json")), false);
});
