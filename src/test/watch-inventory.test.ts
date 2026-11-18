// UAT-17 (TOM-L1-07, TOM-L1-13, TOM-L1-02, DEV-L1-11): inventory-grade output. Every finding carries a reason code from
// a closed, documented list; every report carries the time it ran and one row per peer, pending peer and external
// definition the lock holds; card and peer differ by a field; the lock records a card's signature count; the outline
// counts are numbers. The inventory below fills Tomasz's five columns (pinned hash, state, signer, last checked, reason)
// from fields alone, never from a sentence. No network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { DRIFT_CODES, LOCK_FILE, RECORD_STATES, type DriftReport, type PlumblineLock, type WatchedRecord } from "../core/types.js";
import { lockRecords, peerFindings, signerChangeCode, signerFindings } from "../watch/decide.js";
import { runRelock } from "../watch/index.js";
import { copySite, scripted, type Route } from "./net-helpers.js";
import { baseRoutes, NOW, PEER, PEER2, PEER_SIGNATURE, peerNetwork, PEER_FILE, watch } from "./watch-helpers.js";

const CARD_URL = "https://georoute-agent.example.com/.well-known/agent-card.json";
const card = (name: string) => readFileSync(new URL(`../../src/test/fixtures/a2a/${name}`, import.meta.url), "utf8");
const DOC = readFileSync(new URL("../../docs/gate-and-watch.md", import.meta.url), "utf8");

test("UAT-17: the reason codes are a closed list, each documented once in docs/gate-and-watch.md's table", () => {
  assert.equal(new Set(DRIFT_CODES).size, DRIFT_CODES.length, "no code twice");
  const table = DOC.slice(DOC.indexOf("### Reason codes"));
  assert.ok(table.length > 0 && DOC.includes("### Reason codes"));
  for (const code of DRIFT_CODES) {
    assert.match(code, /^[a-z]+(?:-[a-z]+)*$/);
    assert.ok(table.includes(`| \`${code}\` |`), `docs/gate-and-watch.md lists ${code}`);
  }
  for (const state of RECORD_STATES) assert.ok(table.includes(`\`${state}\``), `the record state ${state} is documented`);
});

test("UAT-17 (TOM-L1-02): a rotation and a bare signer change differ by code, not only by sentence", () => {
  assert.equal(signerChangeCode(undefined), "signer-no-rotation");
  assert.equal(signerChangeCode({ fromLocked: false }), "signer-no-rotation");
  assert.equal(signerChangeCode({ fromLocked: true }), "signer-rotation-published");
  assert.equal(signerChangeCode({ fromLocked: true, verified: false }), "signer-rotation-unverified");
  assert.equal(signerChangeCode({ fromLocked: true, verified: true }), "signer-rotated-verified");
  const record = { sha256: "a".repeat(64), links: "absent", kid: "0123456789abcdef", checkedAt: NOW.toISOString() };
  const seen = (kid: string | undefined, rotation?: { fromLocked: boolean }) => ({
    definition: { ok: true as const, sha256: record.sha256 },
    links: { state: "absent" },
    signature: kid === undefined ? { none: true as const } : { kid },
    ...(rotation !== undefined ? { rotation } : {}),
  });
  const swapped = signerFindings(PEER, record, seen("fedcba9876543210"));
  const rotated = signerFindings(PEER, record, seen("fedcba9876543210", { fromLocked: true }));
  assert.deepEqual([swapped[0]?.code, rotated[0]?.code], ["signer-no-rotation", "signer-rotation-published"]);
  assert.deepEqual([swapped[0]?.expected, swapped[0]?.actual], ["0123456789abcdef", "fedcba9876543210"], "expected and actual are kids for signer codes");
  assert.equal(signerFindings(PEER, record, seen(undefined))[0]?.code, "signer-gone");
  assert.equal(signerFindings(PEER, record, { ...seen(undefined), signature: { problem: "x" } })[0]?.code, "signer-unreadable");
  const unsigned = { sha256: record.sha256, links: "absent", checkedAt: record.checkedAt };
  assert.equal(signerFindings(PEER, unsigned, seen("fedcba9876543210"))[0]?.code, "signer-first");
  assert.equal(signerFindings(PEER, { ...unsigned, formerKid: "0123456789abcdef" }, seen("0123456789abcdef"))[0]?.code, "signer-back");
  // the definition's own reads
  assert.equal(peerFindings(PEER, record, { ...seen("0123456789abcdef"), definition: { ok: false, status: 503 } })[0]?.code, "peer-unreachable");
  assert.equal(peerFindings(PEER, record, { ...seen("0123456789abcdef"), definition: { ok: false, addressProblem: "it is not an https address" } })[0]?.code, "peer-refused");
  assert.equal(peerFindings(PEER, record, { ...seen("0123456789abcdef"), links: { state: "b".repeat(64) } })[0]?.code, "peer-links-appeared");
});

test("UAT-17 (DEV-L1-11): a changed peer's outline counts are numbers beside the sentence", async () => {
  const root = copySite();
  await watch(root, baseRoutes(), { init: true });
  const two = { ...peerNetwork(), tools: [...(peerNetwork() as { tools: object[] }).tools, { name: "second", instructions: "x", tools: ["https://new-host.example/api"] }] };
  const { findings } = await watch(root, { ...baseRoutes(), [PEER_FILE]: { body: two } });
  const changed = findings.find((f) => f.ref === PEER && f.code === "peer-changed");
  assert.ok(changed, JSON.stringify(findings));
  assert.deepEqual(changed.counts, { agentsAdded: 1, agentsRemoved: 0, agentsChanged: 0, hostsAdded: 1, hostsRemoved: 0, frontChanged: false });
  assert.match(changed.summary, /agents: 1 added, 0 removed, 0 changed; outbound hosts: 1 added, 0 removed/);
});

/** Tomasz's five columns for one row, each filled from a named field only (inventory.mjs's rules, against these fields). */
function inventoryRow(report: DriftReport, record: WatchedRecord) {
  return {
    pinned: record.sha256 !== undefined || record.state === "pending",
    state: (RECORD_STATES as readonly string[]).includes(record.state),
    // a peer's recorded kid (absent: recorded unsigned), a card's signature count; a pending peer was never captured
    signer: record.part === "peer" ? true : record.part === "external" ? typeof record.signatures === "number" : record.state === "pending",
    checked: typeof report.checkedAt === "string" && typeof record.lockedAt === "string",
    reason: Array.isArray(record.codes) && record.codes.every((c) => (DRIFT_CODES as readonly string[]).includes(c)),
  };
}

test("UAT-17 (TOM-L1-07, TOM-L1-13): every row of the inventory fills its five cells from fields, through a week of events", async () => {
  const root = copySite();
  const SIGNED = "0123456789abcdef";
  const start: Record<string, Route> = { ...baseRoutes(), [PEER_SIGNATURE]: { body: { kid: SIGNED } }, [CARD_URL]: { body: card("sample-agent-card.json") } };
  const init = await watch(root, start, { init: true, externals: [{ kind: "a2a-card", url: CARD_URL }] });
  assert.equal(init.report.checkedAt, NOW.toISOString());
  const lock = JSON.parse(readFileSync(join(root, LOCK_FILE), "utf8")) as PlumblineLock;
  assert.equal(lock.external?.[CARD_URL]?.signatures, 1, "the lock records the card's signature count");

  // a clean week: three rows, every cell filled, every state unchanged
  const clean = (await watch(root, start)).report;
  assert.equal(clean.checkedAt, NOW.toISOString());
  assert.deepEqual(clean.records?.map((r) => [r.part, r.ref, r.state, r.codes.length]), [
    ["peer", PEER2, "unchanged", 0],
    ["peer", PEER, "unchanged", 0],
    ["external", CARD_URL, "unchanged", 0],
  ]);
  const peerRow = clean.records?.find((r) => r.ref === PEER);
  assert.equal(peerRow?.kid, SIGNED);
  assert.equal(peerRow?.sha256, lock.peers[PEER]?.sha256);
  assert.equal(peerRow?.lockedAt, lock.peers[PEER]?.checkedAt);
  const cardRow = clean.records?.find((r) => r.part === "external");
  assert.deepEqual([cardRow?.externalKind, cardRow?.signatures, cardRow?.sha256], ["a2a-card", 1, lock.external?.[CARD_URL]?.sha256]);

  // the events: the signed peer is swapped to another key, the other peer goes down, the card changes
  const changedCard = JSON.parse(card("sample-agent-card.json")) as { skills: { id: string; description: string }[] };
  changedCard.skills.push({ id: "another", description: "x" });
  const week: Record<string, Route> = {
    ...start,
    [PEER_SIGNATURE]: { body: { kid: "fedcba9876543210" } },
    "https://other-peer.example/shuttle.network.json": { status: 503 },
    [CARD_URL]: { body: JSON.stringify(changedCard) },
  };
  const report = (await watch(root, week)).report;
  const byRef = new Map(report.records?.map((r) => [r.ref, r]));
  assert.deepEqual([byRef.get(PEER)?.state, byRef.get(PEER)?.codes], ["changed", ["signer-no-rotation"]]);
  assert.deepEqual([byRef.get(PEER2)?.state, byRef.get(PEER2)?.codes], ["not-checked", ["peer-unreachable"]]);
  assert.deepEqual([byRef.get(CARD_URL)?.state, byRef.get(CARD_URL)?.codes], ["changed", ["external-changed"]]);
  const cardFinding = report.findings.find((f) => f.ref === CARD_URL);
  assert.deepEqual(cardFinding?.counts, { skillsAdded: 1, skillsRemoved: 0, skillsChanged: 0, signatures: 1 });
  // card and peer differ by a field: the record's part, and the code's family
  assert.ok(report.findings.filter((f) => f.kind === "peer").every((f) => (f.ref === CARD_URL) === f.code.startsWith("external-")));
  for (const rep of [clean, report]) {
    for (const r of rep.records ?? []) assert.deepEqual(inventoryRow(rep, r), { pinned: true, state: true, signer: true, checked: true, reason: true }, JSON.stringify(r));
  }
  // every finding of every report carries a code from the list
  for (const f of [...init.findings, ...clean.findings, ...report.findings]) assert.ok((DRIFT_CODES as readonly string[]).includes(f.code), JSON.stringify(f));
});

test("UAT-17: a relock's report carries the time it captured and the rows of the lock it wrote, a pending peer included", async () => {
  const root = copySite();
  await watch(root, baseRoutes(), { init: true });
  const down = { ...baseRoutes(), "https://other-peer.example/shuttle.network.json": { status: 503 } };
  // drop the shuttle's pin by relocking it while it is down: the lock keeps it (UAT-3), so the row stays a peer
  const relock = await runRelock({ root }, { fetch: scripted(down).fetch, now: () => NOW });
  assert.equal(relock.checkedAt, NOW.toISOString());
  assert.deepEqual(relock.records.map((r) => r.part), ["peer", "peer"]);
  assert.ok(relock.findings.every((f) => (DRIFT_CODES as readonly string[]).includes(f.code)));
  assert.ok(relock.findings.some((f) => f.code === "capture-peer-kept"));
  // lockRecords on a lock with a pending peer: its row is `pending`, with its `since` as lockedAt
  const rows = lockRecords({ version: 1, runtime: { source: "nsdeploy", commit: "unknown", files: {} }, grounding: { sources: [], builtAt: "x" }, peers: {}, pendingPeers: { [PEER]: { since: "2026-11-01T00:00:00.000Z" } } }, [
    { kind: "peer", severity: "warn", code: "peer-pending", ref: PEER, summary: "s" },
  ]);
  assert.deepEqual(rows, [{ part: "pending", ref: PEER, lockedAt: "2026-11-01T00:00:00.000Z", state: "pending", codes: ["peer-pending"] }]);
});
