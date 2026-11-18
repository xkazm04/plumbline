// UAT-4: accept is per ref and knows signers (the owner's decided design, docs/BACKLOG.md "Owner decisions"). A relock
// refuses while a peer's signer changed until a person names it with --accept-signer; --accept narrows a relock to the
// named refs; the watch tells a published rotation from a different key with none, and with --trust (opt-in) a
// rotation that verifies; --drop refuses a peer. The lock never pins a peer's public key. No network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { generateKey, rotateKey } from "../core/index.js";
import { LOCK_FILE, type PlumblineLock, type TrustEntry } from "../core/types.js";
import { RelockRefused, runRelock } from "../watch/index.js";
import { SafeFetchError } from "../net/safe-fetch.js";
import { copySite, scripted, type Route } from "./net-helpers.js";
import { baseRoutes, NOW, PEER, PEER2, PEER_FILE, PEER_SIGNATURE, peerNetwork, watch } from "./watch-helpers.js";

const readLock = (root: string): PlumblineLock => JSON.parse(readFileSync(join(root, LOCK_FILE), "utf8")) as PlumblineLock;
const signed = (kid: string): Route => ({ body: { type: "plumbline-signature", version: 1, kid } });
const PEER_ROTATION = "https://peer.example/plumbline-rotation.json";
const PEER2_SIGNATURE = "https://other-peer.example/plumbline.signature.json";
const relock = (root: string, routes: Record<string, Route>, extra: Parameters<typeof runRelock>[1] = {}) =>
  runRelock({ root }, { fetch: scripted(routes).fetch, now: () => new Date("2026-11-19T08:00:00Z"), ...extra });

async function lockedWith(a: string, b = "bbbbbbbbbbbbbbbb"): Promise<string> {
  const root = copySite();
  await watch(root, { ...baseRoutes(), [PEER_SIGNATURE]: signed(a), [PEER2_SIGNATURE]: signed(b) }, { init: true });
  assert.equal(readLock(root).peers[PEER]?.kid, a);
  return root;
}

test("UAT-4: a different key with no rotation published reads so, stays block, and a plain relock refuses it and writes nothing", async () => {
  const root = await lockedWith("aaaaaaaaaaaaaaaa");
  const swapped = { ...baseRoutes(), [PEER_SIGNATURE]: signed("cccccccccccccccc"), [PEER2_SIGNATURE]: signed("bbbbbbbbbbbbbbbb"), [PEER_ROTATION]: { status: 404 } };
  const line = (await watch(root, swapped)).findings.find((f) => f.ref === PEER && f.severity === "block");
  assert.equal(
    line?.summary,
    "A peer is now signed by a different key than the one the lock recorded: a different key, with no rotation published. A relock refuses it until a person decides: watch --relock --accept-signer <this peer>.",
  );
  const before = readFileSync(join(root, LOCK_FILE), "utf8");
  await assert.rejects(relock(root, swapped), (error: unknown) => {
    assert.ok(error instanceof RelockRefused);
    assert.equal(error.refusal.refused, "signer");
    assert.deepEqual(error.refusal.refused === "signer" ? error.refusal.peers.map((p) => [p.peer, p.from, p.to, p.how]) : [], [[PEER, "aaaaaaaaaaaaaaaa", "cccccccccccccccc", "a different key, with no rotation published"]]);
    return true;
  });
  assert.equal(readFileSync(join(root, LOCK_FILE), "utf8"), before, "nothing written");
  // named by a person: accepted, said in the change list, the lock pins the kid only
  const accepted = await relock(root, swapped, { acceptSigners: [PEER] });
  assert.equal(readLock(root).peers[PEER]?.kid, "cccccccccccccccc");
  assert.deepEqual(accepted.signers?.map((c) => [c.peer, c.backing]), [[PEER, "not checked: no --trust file given"]]);
  assert.ok(accepted.changes.changed.includes(`peer ${PEER}`));
  assert.deepEqual(Object.keys(readLock(root).peers[PEER] ?? {}).sort(), ["checkedAt", "kid", "links", "outline", "sha256"], "no public key is pinned");
});

test("UAT-4: a rotation statement from the locked key reads apart from a swap; with --trust a chain that verifies reads verified", async () => {
  const a = await generateKey(NOW);
  const b = await generateKey(NOW);
  const root = await lockedWith(a.key.kid);
  const rotation = await rotateKey({ oldPrivateKey: a.privateKey, oldKey: a.key, newKey: b.key, now: NOW });
  const rotated = { ...baseRoutes(), [PEER_SIGNATURE]: signed(b.key.kid), [PEER2_SIGNATURE]: signed("bbbbbbbbbbbbbbbb"), [PEER_ROTATION]: { body: rotation } };
  const plain = (await watch(root, rotated)).findings.find((f) => f.ref === PEER && f.severity === "block");
  assert.match(plain?.summary ?? "", /: a rotation statement from the locked key is published \(not verified here\)\./);
  const trust: TrustEntry[] = [{ kid: a.key.kid, origin: "https://peer.example", publicKey: a.key.publicKey }];
  const checked = (await watch(root, rotated, { trust })).findings.find((f) => f.ref === PEER && f.severity === "block");
  assert.match(checked?.summary ?? "", /: it rotated from the key the lock recorded, verified against your trust file\./);
  // a trust file that holds another key for the peer: the chain does not verify from it
  const other = await generateKey(NOW);
  const wrong = (await watch(root, rotated, { trust: [{ kid: other.key.kid, origin: "https://peer.example", publicKey: other.key.publicKey }] })).findings.find((f) => f.ref === PEER && f.severity === "block");
  assert.match(wrong?.summary ?? "", /a rotation statement from the locked key is published, and it does not verify against your trust file/);
  // the relock still refuses a rotation until named; named with --trust, it says the trust file backs it
  await assert.rejects(relock(root, rotated, { trust }), RelockRefused);
  const accepted = await relock(root, rotated, { trust, acceptSigners: [PEER] });
  assert.equal(accepted.signers?.[0]?.backing, "backed by your trust file");
});

test("UAT-4: an unbacked signer is still accepted when named, and the change list says it is not backed", async () => {
  const root = await lockedWith("aaaaaaaaaaaaaaaa");
  const swapped = { ...baseRoutes(), [PEER_SIGNATURE]: signed("cccccccccccccccc"), [PEER2_SIGNATURE]: signed("bbbbbbbbbbbbbbbb"), [PEER_ROTATION]: { status: 404 } };
  const x = await generateKey(NOW);
  const accepted = await relock(root, swapped, { trust: [{ kid: x.key.kid, origin: "https://peer.example", publicKey: x.key.publicKey }], acceptSigners: [PEER] });
  assert.equal(accepted.signers?.[0]?.backing, "not backed by your trust file");
});

test("UAT-4: accepting the rotated seller does not change the swapped seller's pin (--accept narrows the relock)", async () => {
  const root = await lockedWith("aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb");
  const both = {
    ...baseRoutes(),
    [PEER_SIGNATURE]: signed("cccccccccccccccc"),
    [PEER2_SIGNATURE]: signed("dddddddddddddddd"),
    [PEER_ROTATION]: { status: 404 },
    "https://other-peer.example/plumbline-rotation.json": { status: 404 },
    [PEER_FILE]: { body: { ...peerNetwork(), tools: [...(peerNetwork() as { tools: object[] }).tools, { name: "extra", instructions: "x" }] } },
  };
  // naming one signer does not accept the other: still refused, the other one named
  await assert.rejects(relock(root, both, { acceptSigners: [PEER] }), (error: unknown) => error instanceof RelockRefused && error.refusal.refused === "signer" && error.refusal.peers.map((p) => p.peer).join() === PEER2);
  // narrowed to the first peer: its signer and definition are accepted, the second keeps its pin and keeps reporting
  const before = readLock(root).peers[PEER2];
  const narrowed = await relock(root, both, { accept: [PEER], acceptSigners: [PEER] });
  assert.deepEqual(narrowed.changes.changed, [`peer ${PEER}`]);
  assert.equal(readLock(root).peers[PEER]?.kid, "cccccccccccccccc");
  assert.deepEqual(readLock(root).peers[PEER2], before);
  const after = (await watch(root, both)).findings.find((f) => f.ref === PEER2 && f.severity === "block");
  assert.match(after?.summary ?? "", /signed by a different key than the one the lock recorded/);
});

test("UAT-4: --drop with a peer refuses and says what --drop takes, never 'was not in the lock'", async () => {
  const root = await lockedWith("aaaaaaaaaaaaaaaa");
  await assert.rejects(relock(root, baseRoutes(), { dropSources: [PEER] }), (error: unknown) => error instanceof RelockRefused && error.refusal.refused === "drop-peer");
  const { run } = await import("./cli-helpers.js");
  const cli = run("watch", "--root", root, "--relock", "--drop", PEER);
  assert.equal(cli.code, 2, cli.out + cli.err);
  assert.match(cli.err, /^--drop takes a grounding ref or an external definition the lock holds; https:\/\/peer\.example\/partner is a peer, which leaves the lock when no network names it/m);
  assert.doesNotMatch(cli.out + cli.err, /was not in the lock/);
});

// ---- TOM-RC-1: once a lock recorded a signer, only a person naming the peer moves it. One test per transition. ----

const down: Route = { error: new SafeFetchError("network", "connection refused") };
type Refused = { peer: string; from: string; to?: string; how: string };
const refusedFor = async (p: Promise<unknown>): Promise<Refused[]> => {
  let peers: Refused[] = [];
  await assert.rejects(p, (error: unknown) => {
    assert.ok(error instanceof RelockRefused);
    assert.equal(error.refusal.refused, "signer");
    if (error.refusal.refused === "signer") peers = error.refusal.peers;
    return true;
  });
  return peers;
};

test("TOM-RC-1: signed A, then the peer cannot be reached: a plain relock keeps A, refuses nothing", async () => {
  const root = await lockedWith("aaaaaaaaaaaaaaaa");
  const result = await relock(root, { ...baseRoutes(), [PEER_FILE]: down, [PEER2_SIGNATURE]: signed("bbbbbbbbbbbbbbbb") });
  assert.equal(readLock(root).peers[PEER]?.kid, "aaaaaaaaaaaaaaaa");
  assert.match(result.findings.find((f) => f.ref === PEER)?.summary ?? "", /could not be re-read .* keeps its earlier pin/);
});

test("TOM-RC-1: signed A, then its signature cannot be fetched (connection, 5xx): the relock keeps A; never 'unsigned'", async () => {
  const root = await lockedWith("aaaaaaaaaaaaaaaa");
  for (const answer of [down, { status: 502 } as Route]) {
    const routes = { ...baseRoutes(), [PEER_SIGNATURE]: answer, [PEER2_SIGNATURE]: signed("bbbbbbbbbbbbbbbb") };
    const line = (await watch(root, routes)).findings.find((f) => f.ref === PEER);
    assert.equal(line?.severity, "warn");
    assert.match(line?.summary ?? "", /signature could not be read now .*its signer was not checked; a relock keeps the key the lock recorded\.$/);
    await relock(root, routes);
    assert.equal(readLock(root).peers[PEER]?.kid, "aaaaaaaaaaaaaaaa");
    assert.equal(readLock(root).peers[PEER]?.formerKid, undefined);
  }
});

test("TOM-RC-1: signed A, then 404 (the recertifier's B1): the watch blocks, a plain relock refuses and writes nothing; the swapped key returning is still refused", async () => {
  const root = await lockedWith("aaaaaaaaaaaaaaaa");
  const gone = { ...baseRoutes(), [PEER_SIGNATURE]: { status: 404 } as Route, [PEER2_SIGNATURE]: signed("bbbbbbbbbbbbbbbb") };
  const line = (await watch(root, gone)).findings.find((f) => f.ref === PEER);
  assert.deepEqual([line?.severity, line?.expected, line?.actual], ["block", "aaaaaaaaaaaaaaaa", undefined]);
  const before = readFileSync(join(root, LOCK_FILE), "utf8");
  assert.deepEqual(await refusedFor(relock(root, gone)), [{ peer: PEER, from: "aaaaaaaaaaaaaaaa", how: "it publishes no signature now" }]);
  assert.equal(readFileSync(join(root, LOCK_FILE), "utf8"), before, "nothing written");
  // the signature comes back under another key: still a signer change from A, never "newly signed"
  const swapped = { ...gone, [PEER_SIGNATURE]: signed("cccccccccccccccc"), [PEER_ROTATION]: { status: 404 } as Route };
  const back = (await watch(root, swapped)).findings.find((f) => f.ref === PEER);
  assert.equal(back?.severity, "block");
  assert.match(back?.summary ?? "", /different key than the one the lock recorded: a different key, with no rotation published/);
  assert.deepEqual((await refusedFor(relock(root, swapped))).map((p) => [p.from, p.to]), [["aaaaaaaaaaaaaaaa", "cccccccccccccccc"]]);
  assert.equal(readFileSync(join(root, LOCK_FILE), "utf8"), before);
  // a narrowed relock that does not name the peer keeps its record (the other accepts a person makes)
  await relock(root, swapped, { accept: [PEER2] });
  assert.equal(readLock(root).peers[PEER]?.kid, "aaaaaaaaaaaaaaaa");
});

test("TOM-RC-1: signed A, then unsigned, accepted by name: the lock remembers A (formerKid); B later is refused, A again is not", async () => {
  const root = await lockedWith("aaaaaaaaaaaaaaaa");
  const unsigned = { ...baseRoutes(), [PEER_SIGNATURE]: { status: 404 } as Route, [PEER2_SIGNATURE]: signed("bbbbbbbbbbbbbbbb") };
  const accepted = await relock(root, unsigned, { acceptSigners: [PEER] });
  assert.deepEqual(accepted.signers, [{ peer: PEER, from: "aaaaaaaaaaaaaaaa", how: "it publishes no signature now" }]);
  const record = readLock(root).peers[PEER];
  assert.equal(record?.kid, undefined);
  assert.equal(record?.formerKid, "aaaaaaaaaaaaaaaa");
  assert.ok(accepted.changes.changed.includes(`peer ${PEER}`));
  const { relockOutput } = await import("../cli/watch-command.js");
  assert.match(relockOutput(accepted, false), /: aaaaaaaaaaaaaaaa -> none \(it publishes no signature now; the lock remembers aaaaaaaaaaaaaaaa, so a later signature by another key is refused until a person names this peer\)/);
  // still unsigned: no line for the peer, and a plain relock keeps the memory
  assert.equal((await watch(root, unsigned)).findings.filter((f) => f.ref === PEER).length, 0);
  await relock(root, unsigned);
  assert.equal(readLock(root).peers[PEER]?.formerKid, "aaaaaaaaaaaaaaaa");
  // a new key: block at the watch, refused at the relock, named from the remembered kid
  const other = { ...unsigned, [PEER_SIGNATURE]: signed("cccccccccccccccc"), [PEER_ROTATION]: { status: 404 } as Route };
  const line = (await watch(root, other)).findings.find((f) => f.ref === PEER);
  assert.deepEqual([line?.severity, line?.expected, line?.actual], ["block", "aaaaaaaaaaaaaaaa", "cccccccccccccccc"]);
  assert.match(line?.summary ?? "", /^A peer that had stopped signing is now signed by a different key than the one the lock last recorded for it/);
  assert.deepEqual((await refusedFor(relock(root, other))).map((p) => [p.from, p.to]), [["aaaaaaaaaaaaaaaa", "cccccccccccccccc"]]);
  // the key it had, back: info, and a plain relock records it with no refusal
  const again = { ...unsigned, [PEER_SIGNATURE]: signed("aaaaaaaaaaaaaaaa") };
  assert.deepEqual((await watch(root, again)).findings.filter((f) => f.ref === PEER).map((f) => f.severity), ["info"]);
  await relock(root, again);
  assert.equal(readLock(root).peers[PEER]?.kid, "aaaaaaaaaaaaaaaa");
  assert.equal(readLock(root).peers[PEER]?.formerKid, undefined);
});

test("TOM-RC-4: a never-signed peer's first key is recorded with a signer line, with --trust its backing", async () => {
  const root = copySite();
  await watch(root, baseRoutes(), { init: true });
  assert.equal(readLock(root).peers[PEER]?.kid, undefined);
  const x = await generateKey(NOW);
  const trust: TrustEntry[] = [{ kid: x.key.kid, origin: "https://peer.example", publicKey: x.key.publicKey }];
  const first = await relock(root, { ...baseRoutes(), [PEER_SIGNATURE]: signed(x.key.kid) }, { trust });
  assert.deepEqual(first.firstSigners, [{ peer: PEER, kid: x.key.kid, was: "unsigned", backing: "backed by your trust file" }]);
  assert.equal(first.signers, undefined, "a first signer is not a signer change");
});

test("TOM-RC-1/TOM-RC-4: delisted then relisted: the lock keeps no record of a dropped peer, so the relisted one is first seen, and its key is said", async () => {
  const { writeFileSync } = await import("node:fs");
  const root = await lockedWith("aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb");
  const routes = { ...baseRoutes(), [PEER_SIGNATURE]: signed("aaaaaaaaaaaaaaaa"), [PEER2_SIGNATURE]: signed("dddddddddddddddd") };
  const links = readFileSync(join(root, "links.json"), "utf8");
  writeFileSync(join(root, "links.json"), JSON.stringify({ version: 1, networks: {} }));
  const delisted = await relock(root, routes);
  assert.ok(delisted.changes.removed.includes(`peer ${PEER2}`));
  writeFileSync(join(root, "links.json"), links);
  const relisted = await relock(root, routes);
  assert.ok(relisted.changes.added.includes(`peer ${PEER2}`));
  assert.deepEqual(relisted.firstSigners, [{ peer: PEER2, kid: "dddddddddddddddd", was: "added", backing: "not checked: no --trust file given" }]);
  const { relockOutput } = await import("../cli/watch-command.js");
  const line = relockOutput(relisted, false).split("\n").find((l) => l.startsWith(`signer  peer ${PEER2}: `));
  assert.equal(
    line,
    `signer  peer ${PEER2}: first seen, recorded dddddddddddddddd; compared with no earlier key (the lock keeps no record of a peer it no longer holds, so a peer named again is first seen too); not checked: no --trust file given`,
  );
});

test("TOM-RC-3: the refusal suggests one command per peer, each narrowed when more than one waits, with --trust where it applies", async () => {
  const { refusalCommands, signerRefusalOutput } = await import("../cli/watch-command.js");
  const peers = [
    { peer: PEER, from: "aaaaaaaaaaaaaaaa", to: "cccccccccccccccc", how: "a rotation statement from the locked key is published (not verified here)" },
    { peer: PEER2, from: "bbbbbbbbbbbbbbbb", how: "it publishes no signature now" },
  ];
  assert.deepEqual(refusalCommands(peers, "site", false), [
    `plumbline watch --root site --relock --accept ${PEER} --accept-signer ${PEER} --trust <your trust file>`,
    `plumbline watch --root site --relock --accept ${PEER2} --accept-signer ${PEER2}`,
  ]);
  assert.deepEqual(refusalCommands([peers[0]!], "site", true), [`plumbline watch --root site --relock --accept-signer ${PEER}`]);
  const text = signerRefusalOutput(peers, "site", false, false);
  assert.ok(!text.split("\n").some((l) => l.includes(`--accept-signer ${PEER} `) && l.includes(`--accept-signer ${PEER2}`)), "no line accepts both");
  assert.match(text, /the lock recorded bbbbbbbbbbbbbbbb; it publishes no signature now \(it answers 404 or 410 for its signature\)/);
  // the first printed command, run, accepts only its peer
  const root = await lockedWith("aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb");
  const both = { ...baseRoutes(), [PEER_SIGNATURE]: signed("cccccccccccccccc"), [PEER2_SIGNATURE]: { status: 404 } as Route, [PEER_ROTATION]: { status: 404 } as Route };
  await relock(root, both, { accept: [PEER], acceptSigners: [PEER] });
  assert.equal(readLock(root).peers[PEER]?.kid, "cccccccccccccccc");
  assert.equal(readLock(root).peers[PEER2]?.kid, "bbbbbbbbbbbbbbbb");
});
