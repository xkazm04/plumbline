// The audit's pure walk (src/agent/audit.ts), with the history given as data: no git.
import assert from "node:assert/strict";
import { test } from "node:test";
import { auditHistory, auditMarkdown, type AuditCommit } from "../agent/audit.js";
import { approveLock } from "../core/approve.js";
import { sha256Hex, utf8 } from "../core/canonical.js";
import { generateKey } from "../core/keys.js";
import { AGENT_LOCK_TYPE, type AgentLock, type ApproverEntry } from "../core/types.js";

const NOW = new Date("2026-11-21T10:00:00.000Z");

async function person(label: string): Promise<{ privateKey: string; entry: ApproverEntry }> {
  const { key, privateKey } = await generateKey(NOW);
  return { privateKey, entry: { kid: key.kid, publicKey: key.publicKey, label, addedAt: NOW.toISOString() } };
}

function lockBytes(n: number, previous?: string): { lock: AgentLock; bytes: Uint8Array } {
  const lock: AgentLock = {
    type: AGENT_LOCK_TYPE,
    version: 1,
    ...(previous !== undefined ? { previous } : {}),
    declaration: "b".repeat(64),
    files: { [`prompt-${n}.md`]: "c".repeat(64) },
    lockedAt: `2026-11-2${n}T09:00:00.000Z`,
  };
  return { lock, bytes: utf8(JSON.stringify(lock, null, 2) + "\n") };
}

async function approvalBytes(privateKey: string, l: { lock: AgentLock; bytes: Uint8Array }): Promise<Uint8Array> {
  return utf8(JSON.stringify(await approveLock({ privateKey, lockBytes: l.bytes, lock: l.lock, now: NOW })));
}

let seq = 0;
const c = (lock?: Uint8Array, approval?: Uint8Array): AuditCommit => {
  seq++;
  return { commit: seq.toString(16).padStart(40, "0"), date: `2026-11-21T10:${String(seq % 60).padStart(2, "0")}:00.000Z`, ...(lock ? { lock } : {}), ...(approval ? { approval } : {}) };
};

/** Three locks, each naming the one before, each approved in its own commit by Alice. */
async function wholeChain(): Promise<{ commits: AuditCommit[]; alice: Awaited<ReturnType<typeof person>> }> {
  const alice = await person("Alice Approver");
  const l1 = lockBytes(1);
  const l2 = lockBytes(2, await sha256Hex(l1.bytes));
  const l3 = lockBytes(3, await sha256Hex(l2.bytes));
  const commits = [
    c(l1.bytes, await approvalBytes(alice.privateKey, l1)),
    c(l2.bytes, await approvalBytes(alice.privateKey, l2)),
    c(l3.bytes, await approvalBytes(alice.privateKey, l3)),
  ];
  return { commits, alice };
}

test("whole chain, every version approved: clean, each verified with the label and kid", async () => {
  const { commits, alice } = await wholeChain();
  const r = await auditHistory(commits, [alice.entry]);
  assert.equal(r.clean, true);
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.summary, { versions: 3, verified: 3, invalid: 0, unverifiable: 0, absent: 0, chainBroken: 0, beforeApproval: 0 });
  assert.deepEqual(r.versions.map((v) => v.chain), ["start", "ok", "ok"]);
  for (const v of r.versions) {
    assert.equal(v.approval, "verified");
    assert.equal(v.label, "Alice Approver");
    assert.equal(v.kid, alice.entry.kid);
  }
  const md = auditMarkdown(r, { generatedAt: NOW.toISOString(), approversSource: "test" });
  assert.match(md, /\| Version \| Date \| Commit \| Lock \(SHA-256\) \| Approver \| Verdict \| Chain \|/);
  assert.equal(md.split("\n").filter((l) => /^\| \d/.test(l)).length, 3);
  assert.match(md, /The current lock is verified, and every change since approval began was approved with the chain whole\.\n/);
  assert.match(auditMarkdown(await auditHistory(commits, [alice.entry], "all"), { generatedAt: "x", approversSource: "y" }), /Every change was approved and the chain is whole/);
});

test("broken chain: a version that does not name the one before; and a first lock that names one", async () => {
  const alice = await person("Alice");
  const l1 = lockBytes(1);
  const l2 = lockBytes(2, "d".repeat(64));
  const r = await auditHistory([c(l1.bytes, await approvalBytes(alice.privateKey, l1)), c(l2.bytes, await approvalBytes(alice.privateKey, l2))], [alice.entry]);
  assert.equal(r.clean, false);
  assert.deepEqual(r.versions.map((v) => v.chain), ["start", "broken"]);
  assert.deepEqual(r.findings.map((f) => [f.code, f.ref]), [["chain-broken", "2"]]);
  assert.equal(r.summary.chainBroken, 1);

  const orphan = lockBytes(1, "e".repeat(64));
  const r2 = await auditHistory([c(orphan.bytes, await approvalBytes(alice.privateKey, orphan))], [alice.entry]);
  assert.equal(r2.versions[0]?.chain, "broken");
  assert.equal(r2.clean, false);
});

test("an unapproved version: absent, lock-unapproved, never folded into invalid", async () => {
  const alice = await person("Alice");
  const l1 = lockBytes(1);
  const l2 = lockBytes(2, await sha256Hex(l1.bytes));
  const a1 = await approvalBytes(alice.privateKey, l1);
  // the second lock is committed with the first approval still in the tree: that approval is of another lock
  const r = await auditHistory([c(l1.bytes, a1), c(l2.bytes, a1)], [alice.entry]);
  assert.deepEqual(r.versions.map((v) => v.approval), ["verified", "absent"]);
  assert.deepEqual(r.findings.map((f) => f.code), ["lock-unapproved"]);
  assert.equal(r.summary.absent, 1);
  assert.equal(r.clean, false);
});

test("an approval committed one commit later, before the next lock change, approves the version", async () => {
  const alice = await person("Alice");
  const l1 = lockBytes(1);
  const l2 = lockBytes(2, await sha256Hex(l1.bytes));
  const a1 = await approvalBytes(alice.privateKey, l1);
  const history = [c(l1.bytes), c(l1.bytes, a1), c(l2.bytes, a1), c(l2.bytes, await approvalBytes(alice.privateKey, l2))];
  const r = await auditHistory(history, [alice.entry]);
  assert.equal(r.clean, true);
  assert.equal(r.versions.length, 2);
  assert.equal(r.versions[0]?.commit, history[0]?.commit);
  assert.equal(r.versions[0]?.approvalCommit, history[1]?.commit);
  // an approval committed after the NEXT lock change does not reach back
  const late = await auditHistory([c(l1.bytes), c(l2.bytes), c(l2.bytes, a1)], [alice.entry]);
  assert.equal(late.versions[0]?.approval, "absent");
});

test("an invalid approval: a bad signature is invalid with its reason; unparsable approval is invalid malformed", async () => {
  const alice = await person("Alice");
  const l1 = lockBytes(1);
  const good = JSON.parse(new TextDecoder().decode(await approvalBytes(alice.privateKey, l1))) as Record<string, unknown>;
  const bad = utf8(JSON.stringify({ ...good, approvedAt: "2026-11-22T00:00:00.000Z" }));
  const r = await auditHistory([c(l1.bytes, bad)], [alice.entry]);
  assert.equal(r.versions[0]?.approval, "invalid");
  assert.equal(r.versions[0]?.reason, "bad-signature");
  assert.deepEqual(r.findings.map((f) => f.code), ["approval-invalid"]);
  const junk = await auditHistory([c(l1.bytes, utf8("not json"))], [alice.entry]);
  assert.equal(junk.versions[0]?.approval, "invalid");
  assert.equal(junk.versions[0]?.reason, "malformed");
});

test("an unknown approver: unverifiable, shows the kid, never verified; no approvers at all is the same", async () => {
  const { commits, alice } = await wholeChain();
  const bob = await person("Bob");
  for (const approvers of [[bob.entry], []]) {
    const r = await auditHistory(commits, approvers);
    assert.equal(r.clean, false);
    assert.equal(r.summary.unverifiable, 3);
    assert.equal(r.summary.verified, 0);
    for (const v of r.versions) {
      assert.equal(v.approval, "unverifiable");
      assert.equal(v.kid, alice.entry.kid);
      assert.equal(v.label, undefined);
    }
    assert.ok(r.findings.every((f) => f.code === "approval-unverifiable"));
    assert.doesNotMatch(auditMarkdown(r, { generatedAt: "x", approversSource: "y" }), /\| verified \|/);
  }
});

test("a verified approval beats an earlier bad one in the same span; a re-committed identical lock is one version", async () => {
  const alice = await person("Alice");
  const l1 = lockBytes(1);
  const good = await approvalBytes(alice.privateKey, l1);
  const bad = utf8(JSON.stringify({ ...JSON.parse(new TextDecoder().decode(good)), sig: "AAAA" }));
  const r = await auditHistory([c(l1.bytes, bad), c(l1.bytes, good), c(l1.bytes, good)], [alice.entry]);
  assert.equal(r.versions.length, 1);
  assert.equal(r.versions[0]?.approval, "verified");
});

test("no lock in the history: lock-absent, not clean; a removed lock ends its version", async () => {
  const r = await auditHistory([], []);
  assert.equal(r.clean, false);
  assert.deepEqual(r.findings.map((f) => f.code), ["lock-absent"]);
  const alice = await person("Alice");
  const l1 = lockBytes(1);
  const a1 = await approvalBytes(alice.privateKey, l1);
  const r2 = await auditHistory([c(l1.bytes), c(undefined, a1)], [alice.entry]);
  assert.equal(r2.versions[0]?.approval, "absent");
});

test("since the first approval: init's unapproved first lock, then two approved relocks, is clean and lists 1 before approval; --all is not", async () => {
  const alice = await person("Alice");
  const l1 = lockBytes(1);
  const l2 = lockBytes(2, await sha256Hex(l1.bytes));
  const l3 = lockBytes(3, await sha256Hex(l2.bytes));
  // the trial's order: commit what init wrote, approve later (relock, approve, commit), then one more approved change
  const history = [c(l1.bytes), c(l2.bytes, await approvalBytes(alice.privateKey, l2)), c(l3.bytes, await approvalBytes(alice.privateKey, l3))];
  const r = await auditHistory(history, [alice.entry]);
  assert.equal(r.rule, "since-first-approval");
  assert.equal(r.clean, true);
  assert.equal(r.firstApproved, 2);
  assert.equal(r.summary.beforeApproval, 1);
  assert.deepEqual(r.versions.map((v) => v.beforeApproval ?? false), [true, false, false]);
  assert.deepEqual(r.versions.map((v) => v.approval), ["absent", "verified", "verified"]);
  // the unapproved first version is still reported, marked as not counted
  assert.deepEqual(r.findings, [{ code: "lock-unapproved", ref: "1", summary: "This lock version has no approval committed before the next change.", beforeApproval: true }]);
  const md = auditMarkdown(r, { generatedAt: "x", approversSource: "y" });
  assert.match(md, /NOT APPROVED \(before approval began\)/);
  assert.match(md, /The current lock is verified, and every change since approval began was approved with the chain whole\. 1 version\(s\) before approval began/);

  const all = await auditHistory(history, [alice.entry], "all");
  assert.equal(all.rule, "all");
  assert.equal(all.clean, false);
  assert.equal(all.summary.beforeApproval, 0);
  assert.ok(all.versions.every((v) => v.beforeApproval === undefined));
  assert.deepEqual(all.findings.map((f) => [f.code, f.ref, f.beforeApproval]), [["lock-unapproved", "1", undefined]]);
  assert.match(auditMarkdown(all, { generatedAt: "x", approversSource: "y" }), /NOT every change is accounted for/);
});

test("since the first approval still fails an unapproved change after approval began, an unapproved current lock, and a break after it", async () => {
  const alice = await person("Alice");
  const l1 = lockBytes(1);
  const l2 = lockBytes(2, await sha256Hex(l1.bytes));
  const l3 = lockBytes(3, await sha256Hex(l2.bytes));
  const a2 = await approvalBytes(alice.privateKey, l2);
  // the current lock is not approved
  let r = await auditHistory([c(l1.bytes), c(l2.bytes, a2), c(l3.bytes, a2)], [alice.entry]);
  assert.equal(r.clean, false);
  assert.deepEqual(r.findings.map((f) => [f.code, f.ref, f.beforeApproval ?? false]), [["lock-unapproved", "1", true], ["lock-unapproved", "3", false]]);
  // a version between two approved ones is not approved
  const l4 = lockBytes(4, await sha256Hex(l3.bytes));
  r = await auditHistory([c(l1.bytes), c(l2.bytes, a2), c(l3.bytes, a2), c(l4.bytes, await approvalBytes(alice.privateKey, l4))], [alice.entry]);
  assert.equal(r.clean, false);
  assert.deepEqual(r.findings.filter((f) => f.beforeApproval !== true).map((f) => [f.code, f.ref]), [["lock-unapproved", "3"]]);
  // a broken link after the first approval counts
  const stray = lockBytes(3, "d".repeat(64));
  r = await auditHistory([c(l1.bytes), c(l2.bytes, a2), c(stray.bytes, await approvalBytes(alice.privateKey, stray))], [alice.entry]);
  assert.equal(r.clean, false);
  assert.deepEqual(r.findings.filter((f) => f.beforeApproval !== true).map((f) => [f.code, f.ref]), [["chain-broken", "3"]]);
  // no version approved at all: nothing is "before approval", and the audit is not clean
  r = await auditHistory([c(l1.bytes), c(l2.bytes)], [alice.entry]);
  assert.equal(r.clean, false);
  assert.equal(r.firstApproved, undefined);
  assert.equal(r.summary.beforeApproval, 0);
  assert.ok(r.findings.every((f) => f.beforeApproval === undefined));
});

test("a lock deleted and created again by init starts a new chain (start), not a break", async () => {
  const alice = await person("Alice");
  const l1 = lockBytes(1);
  const a1 = await approvalBytes(alice.privateKey, l1);
  const reinit = lockBytes(2); // init writes a first lock: it names no previous
  const a2 = await approvalBytes(alice.privateKey, reinit);
  for (const rule of ["since-first-approval", "all"] as const) {
    const r = await auditHistory([c(l1.bytes, a1), c(), c(reinit.bytes, a2)], [alice.entry], rule);
    assert.deepEqual(r.versions.map((v) => v.chain), ["start", "start"], rule);
    assert.deepEqual(r.findings, [], rule);
    assert.equal(r.clean, true, rule);
  }
  // restored after the deletion: names the last version before it, so the chain is ok
  const l2 = lockBytes(2, await sha256Hex(l1.bytes));
  let r = await auditHistory([c(l1.bytes, a1), c(), c(l2.bytes, await approvalBytes(alice.privateKey, l2))], [alice.entry]);
  assert.deepEqual(r.versions.map((v) => v.chain), ["start", "ok"]);
  // created after the deletion naming some other lock: broken, with its own sentence
  const other = lockBytes(2, "d".repeat(64));
  r = await auditHistory([c(l1.bytes, a1), c(), c(other.bytes, await approvalBytes(alice.privateKey, other))], [alice.entry]);
  assert.deepEqual(r.versions.map((v) => v.chain), ["start", "broken"]);
  assert.match(r.findings[0]!.summary, /created after the lock was deleted/);
  // without a deletion between them, a lock that names no previous is still a break
  r = await auditHistory([c(l1.bytes, a1), c(reinit.bytes, a2)], [alice.entry]);
  assert.deepEqual(r.versions.map((v) => v.chain), ["start", "broken"]);
});

test("markdown escapes a pipe in a label", async () => {
  const alice = await person("Ops | Release");
  const l1 = lockBytes(1);
  const r = await auditHistory([c(l1.bytes, await approvalBytes(alice.privateKey, l1))], [alice.entry]);
  assert.match(auditMarkdown(r, { generatedAt: "x", approversSource: "y" }), /Ops \\\| Release/);
});
