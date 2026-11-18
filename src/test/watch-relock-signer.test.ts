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
