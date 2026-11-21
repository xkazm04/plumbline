// Approvals (src/core/approve.ts): round trip, every invalid reason, unverifiable, and the approvers file parser.
import assert from "node:assert/strict";
import { test } from "node:test";
import { approveLock, parseApprovers, approversKidProblem, verifyApproval } from "../core/approve.js";
import { sha256Hex, unsignedBytesOf } from "../core/canonical.js";
import { generateKey, signText } from "../core/keys.js";
import { AGENT_LOCK_TYPE, type AgentLock, type ApproverEntry } from "../core/types.js";

const NOW = new Date("2026-11-21T10:00:00.000Z");
const PREV = "a".repeat(64);

function lockOf(previous?: string): { lock: AgentLock; bytes: string } {
  const lock: AgentLock = {
    type: AGENT_LOCK_TYPE,
    version: 1,
    ...(previous !== undefined ? { previous } : {}),
    declaration: "b".repeat(64),
    files: { "CLAUDE.md": "c".repeat(64) },
    lockedAt: "2026-11-21T09:00:00.000Z",
  };
  return { lock, bytes: JSON.stringify(lock, null, 2) + "\n" };
}

async function person(label = "Alice"): Promise<{ privateKey: string; entry: ApproverEntry }> {
  const { key, privateKey } = await generateKey(NOW);
  return { privateKey, entry: { kid: key.kid, publicKey: key.publicKey, label, addedAt: NOW.toISOString() } };
}

test("approve then verify: verified, names the approver, repeats previous, omits it when absent", async () => {
  const alice = await person();
  const { lock, bytes } = lockOf(PREV);
  const approval = await approveLock({ privateKey: alice.privateKey, lockBytes: bytes, lock, now: NOW });
  assert.equal(approval.kid, alice.entry.kid);
  assert.equal(approval.lock, await sha256Hex(bytes));
  assert.equal(approval.previous, PREV);
  assert.equal(approval.approvedAt, NOW.toISOString());
  const verdict = await verifyApproval(bytes, approval, [alice.entry]);
  assert.equal(verdict.state, "verified");
  assert.deepEqual(verdict.approver, alice.entry);

  const first = lockOf();
  const a2 = await approveLock({ privateKey: alice.privateKey, lockBytes: first.bytes, lock: first.lock, now: NOW });
  assert.equal("previous" in a2, false);
  assert.equal((await verifyApproval(new TextEncoder().encode(first.bytes), a2, [alice.entry])).state, "verified");
});

test("tampered: the approval covers other lock bytes", async () => {
  const alice = await person();
  const { lock, bytes } = lockOf(PREV);
  const approval = await approveLock({ privateKey: alice.privateKey, lockBytes: bytes, lock, now: NOW });
  const changed = bytes.replace("CLAUDE.md", "AGENTS.md");
  assert.deepEqual(await verifyApproval(changed, approval, [alice.entry]), { state: "invalid", reason: "tampered" });
  // one byte (a trailing newline) is a different lock
  assert.equal((await verifyApproval(bytes + "\n", approval, [alice.entry])).reason, "tampered");
});

test("unverifiable: the kid is in no approvers entry", async () => {
  const alice = await person();
  const bob = await person("Bob");
  const { lock, bytes } = lockOf();
  const approval = await approveLock({ privateKey: alice.privateKey, lockBytes: bytes, lock, now: NOW });
  assert.deepEqual(await verifyApproval(bytes, approval, [bob.entry]), { state: "unverifiable" });
  assert.deepEqual(await verifyApproval(bytes, approval, []), { state: "unverifiable" });
});

test("bad-signature: a changed statement, or a signature by another key under the named kid", async () => {
  const alice = await person();
  const bob = await person("Bob");
  const { lock, bytes } = lockOf();
  const approval = await approveLock({ privateKey: alice.privateKey, lockBytes: bytes, lock, now: NOW });
  const later = { ...approval, approvedAt: "2026-11-22T10:00:00.000Z" };
  assert.deepEqual(await verifyApproval(bytes, later, [alice.entry]), { state: "invalid", reason: "bad-signature" });
  const { sig: _s, ...unsigned } = approval;
  void _s;
  const forged = { ...unsigned, sig: await signText(bob.privateKey, unsignedBytesOf(unsigned)) };
  assert.deepEqual(await verifyApproval(bytes, forged, [alice.entry]), { state: "invalid", reason: "bad-signature" });
});

test("kid-mismatch: an approvers entry whose kid is not derived from its key", async () => {
  const alice = await person();
  const bob = await person("Bob");
  const { lock, bytes } = lockOf();
  const approval = await approveLock({ privateKey: alice.privateKey, lockBytes: bytes, lock, now: NOW });
  const poisoned: ApproverEntry = { ...alice.entry, publicKey: bob.entry.publicKey };
  assert.deepEqual(await verifyApproval(bytes, approval, [poisoned]), { state: "invalid", reason: "kid-mismatch" });
});

test("malformed: not an object, wrong type, extra member, bad fields, a previous that differs from the lock's", async () => {
  const alice = await person();
  const { lock, bytes } = lockOf(PREV);
  const approval = await approveLock({ privateKey: alice.privateKey, lockBytes: bytes, lock, now: NOW });
  const cases: unknown[] = [
    null,
    [],
    "x",
    { ...approval, type: "plumbline-signature" },
    { ...approval, version: 2 },
    { ...approval, alg: "RS256" },
    { ...approval, kid: "ABC" },
    { ...approval, lock: "nope" },
    { ...approval, previous: 3 },
    { ...approval, approvedAt: "yesterday" },
    { ...approval, sig: "not base64url!" },
    { ...approval, publicKey: alice.entry.publicKey },
  ];
  for (const c of cases) assert.deepEqual(await verifyApproval(bytes, c, [alice.entry]), { state: "invalid", reason: "malformed" });
  // an approval that repeats the wrong previous, though validly signed, is not about this lock's chain
  const { sig: _s, ...unsigned } = approval;
  void _s;
  const wrongPrev = { ...unsigned, previous: "d".repeat(64) };
  const signed = { ...wrongPrev, sig: await signText(alice.privateKey, unsignedBytesOf(wrongPrev)) };
  assert.deepEqual(await verifyApproval(bytes, signed, [alice.entry]), { state: "invalid", reason: "malformed" });
  const { previous: _p, ...noPrev } = unsigned;
  void _p;
  const dropped = { ...noPrev, sig: await signText(alice.privateKey, unsignedBytesOf(noPrev)) };
  assert.deepEqual(await verifyApproval(bytes, dropped, [alice.entry]), { state: "invalid", reason: "malformed" });
});

function approversText(entries: unknown[]): string {
  return JSON.stringify({ type: "plumbline-approvers", version: 1, approvers: entries });
}

test("parseApprovers: a good file, and every refusal without quoting a value", async () => {
  const alice = await person();
  const bob = await person("Bob");
  assert.deepEqual(parseApprovers(approversText([alice.entry, bob.entry])).approvers, [alice.entry, bob.entry]);
  assert.deepEqual(parseApprovers(approversText([])).approvers, []);
  const secret = "SECRET-VALUE";
  const refusals: Array<[string, RegExp]> = [
    ["not json", /not JSON/],
    ["[]", /not an object/],
    [JSON.stringify({ type: "plumbline-trust", version: 1, approvers: [] }), /document type/],
    [JSON.stringify({ type: "plumbline-approvers", version: 2, approvers: [] }), /version/],
    [JSON.stringify({ type: "plumbline-approvers", version: 1 }), /not a list/],
    [approversText([{ ...alice.entry, kid: secret }]), /kid/],
    [approversText([{ ...alice.entry, publicKey: secret }]), /public key/],
    [approversText([{ ...alice.entry, label: "" }]), /label/],
    [approversText([{ ...alice.entry, label: "   " }]), /label/],
    [approversText([{ ...alice.entry, label: 7 }]), /label/],
    [approversText([{ ...alice.entry, label: "x".repeat(81) }]), /longer than 80/],
    [approversText([{ ...alice.entry, label: "Al\u001bice" }]), /control or bidi/],
    [approversText([{ ...alice.entry, label: "Al‮ice" }]), /control or bidi/],
    [approversText([{ ...alice.entry, addedAt: secret }]), /addedAt/],
    [approversText([{ ...alice.entry, extra: secret }]), /member/],
    [approversText([alice.entry, { ...alice.entry, label: "Again" }]), /repeats a key/],
  ];
  for (const [text, pattern] of refusals) {
    assert.throws(() => parseApprovers(text), (error: Error) => pattern.test(error.message) && !error.message.includes(secret));
  }
  // an 80-character label is accepted
  assert.equal(parseApprovers(approversText([{ ...alice.entry, label: "x".repeat(80) }])).approvers.length, 1);
});

test("approversKidProblem: a kid not derived from its key is named by index", async () => {
  const alice = await person();
  const bob = await person("Bob");
  assert.equal(await approversKidProblem([alice.entry, bob.entry]), undefined);
  assert.match((await approversKidProblem([alice.entry, { ...bob.entry, kid: alice.entry.kid }])) ?? "", /approver 1/);
});
