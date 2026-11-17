import assert from "node:assert/strict";
import { test } from "node:test";
import { SafeFetchError } from "../net/safe-fetch.js";
import { copySite } from "./net-helpers.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LOCK_FILE, type PlumblineLock } from "../core/types.js";
import { baseRoutes, ofKind, peerNetwork, PEER, PEER_FILE, PEER_LINKS, PEER_SIGNATURE, PEER2, PEER2_FILE, PEER2_LINKS, watch } from "./watch-helpers.js";

const readLockOf = (root: string): PlumblineLock => JSON.parse(readFileSync(join(root, LOCK_FILE), "utf8"));

async function locked(routes = baseRoutes()): Promise<string> {
  const root = copySite();
  assert.deepEqual((await watch(root, routes, { init: true })).findings, []);
  return root;
}

const signed = (kid: string) => ({ body: { type: "plumbline-signature", version: 1, kid } });

test("peer drift: a changed peer definition is a block, with both hashes", async () => {
  const root = await locked();
  const { findings } = await watch(root, { ...baseRoutes(), [PEER_FILE]: { body: peerNetwork("partner, now with new instructions") } });
  const peer = ofKind(findings, "peer");
  assert.equal(peer.length, 1);
  assert.equal(peer[0]?.severity, "block");
  assert.equal(peer[0]?.ref, PEER);
  assert.match(peer[0]!.expected ?? "", /^[0-9a-f]{64}$/);
  assert.notEqual(peer[0]?.expected, peer[0]?.actual);
  assert.match(peer[0]!.summary, /runs in the visitor's browser/);
  assert.equal(findings.length, 1, "the other peer did not drift");
});

test("peer: the same definition re-serialised (key order, spacing) is a block: exact bytes, since the runtime merges what JSON.parse hides", async () => {
  const root = await locked();
  const reordered = '{ "tools": [ { "instructions": "Answer as partner.", "name": "partner_front" } ],\n  "metadata": { "description": "partner" } }';
  const { findings } = await watch(root, { ...baseRoutes(), [PEER_FILE]: { body: reordered } });
  assert.deepEqual(findings.map((f) => [f.severity, f.ref]), [["block", PEER]]);
});

test("REGRESSION (reviewer finding 9): a peer links.json that appears after locking is a block", async () => {
  const root = await locked();
  assert.equal(readLockOf(root).peers[PEER]?.links, "absent", "no links.json at lock time is recorded as absent");
  assert.match(readLockOf(root).peers[PEER2]?.links ?? "", /^[0-9a-f]{64}$/);
  const evil = { version: 1, networks: { partner: { helper: "https://evil.example/agent" } } };
  const { findings } = await watch(root, { ...baseRoutes(), [PEER_LINKS]: { body: evil } });
  assert.deepEqual(findings.map((f) => [f.kind, f.severity, f.ref, f.expected]), [["peer", "block", PEER, "absent"]]);
  assert.match(findings[0]!.summary, /now publishes a links\.json/);
  assert.ok(!findings[0]!.summary.includes("evil.example"));
});

test("peer links.json: changed or gone is a block; unreadable is a warn; the same bytes are clean", async () => {
  const root = await locked();
  assert.deepEqual((await watch(root, baseRoutes())).findings, []);
  const changed = await watch(root, { ...baseRoutes(), [PEER2_LINKS]: { body: { version: 1, networks: {} } } });
  assert.deepEqual(changed.findings.map((f) => [f.severity, f.ref]), [["block", PEER2]]);
  assert.match(changed.findings[0]!.summary, /links\.json changed/);
  const gone = await watch(root, { ...baseRoutes(), [PEER2_LINKS]: { status: 404 } });
  assert.deepEqual(gone.findings.map((f) => [f.severity, f.ref, f.actual]), [["block", PEER2, "absent"]]);
  const down = await watch(root, { ...baseRoutes(), [PEER2_LINKS]: { status: 503 } });
  assert.deepEqual(down.findings.map((f) => [f.severity, f.ref]), [["warn", PEER2]]);
  assert.match(down.findings[0]!.summary, /links\.json could not be checked/);
});

test("peer links.json: a lock written before links were tracked says so (warn), never a silent pass", async () => {
  const root = await locked();
  const lock = readLockOf(root);
  for (const record of Object.values(lock.peers)) delete record.links;
  writeFileSync(join(root, LOCK_FILE), JSON.stringify(lock));
  const { findings } = await watch(root, baseRoutes());
  assert.deepEqual(findings.map((f) => [f.severity, f.ref]).sort(), [["warn", PEER], ["warn", PEER2]].sort());
  assert.match(findings[0]!.summary, /does not record this peer's links\.json/);
});

test("peer links.json at lock time: unreadable leaves the peer out of the lock, with a warn", async () => {
  const root = copySite();
  const { findings } = await watch(root, { ...baseRoutes(), [PEER_LINKS]: { status: 500 } }, { init: true });
  assert.deepEqual(findings.map((f) => [f.severity, f.ref]), [["warn", PEER]]);
  assert.match(findings[0]!.summary, /links\.json answered HTTP 500/);
  assert.deepEqual(Object.keys(readLockOf(root).peers), [PEER2]);
});

test("peer: a peer definition that no longer parses is a block, not a skipped check", async () => {
  const root = await locked();
  const { findings } = await watch(root, { ...baseRoutes(), [PEER_FILE]: { body: "<html>moved</html>" } });
  assert.deepEqual(findings.map((f) => [f.severity, f.ref]), [["block", PEER]]);
});

test("peer: an unreachable peer is a warn that says so, not a block and not silence", async () => {
  const root = await locked();
  const cases: object[] = [{ error: new SafeFetchError("timeout", "t") }, { error: new SafeFetchError("network", "n") }, { status: 503 }, { status: 404 }];
  for (const route of cases) {
    const { findings } = await watch(root, { ...baseRoutes(), [PEER_FILE]: route });
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.severity, "warn");
    assert.equal(findings[0]?.ref, PEER);
    assert.match(findings[0]!.summary, /not checked/);
  }
  const routes = baseRoutes();
  delete routes[PEER2_FILE];
  const { findings } = await watch(root, routes);
  assert.deepEqual(findings.map((f) => [f.severity, f.ref]), [["warn", PEER2]]);
});

test("peer: the manifest's network entry decides where the peer's definition is", async () => {
  const routes = baseRoutes();
  routes["https://peer.example/agent-manifest.json"] = { body: { networks: [{ name: "partner", front_man: "partner_front", hocon: "./nets/partner.json" }] } };
  routes["https://peer.example/nets/partner.json"] = { body: peerNetwork() };
  delete routes[PEER_FILE];
  const root = await locked(routes);
  assert.deepEqual((await watch(root, routes)).findings, []);
  routes["https://peer.example/nets/partner.json"] = { body: peerNetwork("different") };
  assert.deepEqual((await watch(root, routes)).findings.map((f) => f.severity), ["block"]);
});

test("peer signer: a different kid than the lock recorded is a block, even when the definition is unchanged", async () => {
  const withKid = { ...baseRoutes(), [PEER_SIGNATURE]: signed("aaaaaaaaaaaaaaaa") };
  const root = await locked(withKid);
  const rotated = await watch(root, { ...baseRoutes(), [PEER_SIGNATURE]: signed("bbbbbbbbbbbbbbbb") });
  assert.equal(rotated.findings.length, 1);
  assert.equal(rotated.findings[0]?.severity, "block");
  assert.equal(rotated.findings[0]?.expected, "aaaaaaaaaaaaaaaa");
  assert.equal(rotated.findings[0]?.actual, "bbbbbbbbbbbbbbbb");
  assert.match(rotated.findings[0]!.summary, /different key/);
});

test("peer signer neighbour: the same kid is clean", async () => {
  const withKid = { ...baseRoutes(), [PEER_SIGNATURE]: signed("aaaaaaaaaaaaaaaa") };
  const root = await locked(withKid);
  assert.deepEqual((await watch(root, withKid)).findings, []);
});

test("peer signer: a signed peer that stops publishing its signature is a warn; an unsigned one that starts is info", async () => {
  const withKid = { ...baseRoutes(), [PEER_SIGNATURE]: signed("aaaaaaaaaaaaaaaa") };
  const signedRoot = await locked(withKid);
  const dropped = await watch(signedRoot, baseRoutes());
  assert.deepEqual(dropped.findings.map((f) => [f.severity, f.ref]), [["warn", PEER]]);
  assert.match(dropped.findings[0]!.summary, /no longer shows a usable signature/);

  const unsignedRoot = await locked();
  const started = await watch(unsignedRoot, withKid);
  assert.deepEqual(started.findings.map((f) => [f.severity, f.ref]), [["info", PEER]]);
});

test("peer: a peer on a private or loopback address is a warn through safeFetch's refusal, never contacted", async () => {
  const root = await locked();
  const { readFileSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const lockPath = join(root, "plumbline.lock.json");
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  lock.peers["https://127.0.0.1:8081/partner"] = { sha256: "0".repeat(64), checkedAt: "2026-11-17T12:00:00.000Z" };
  writeFileSync(lockPath, JSON.stringify(lock));
  // the real safeFetch (no scripted fetcher) answers for the loopback peer; scripted routes answer the rest
  const { runWatch } = await import("../watch/index.js");
  const { safeFetch } = await import("../net/safe-fetch.js");
  const { scripted } = await import("./net-helpers.js");
  const s = scripted(baseRoutes());
  const report = await runWatch(
    { root },
    { now: () => new Date("2026-11-17T12:00:00Z"), fetch: (url, o) => (url.includes("127.0.0.1") ? safeFetch(url, o) : s.fetch(url, o)) },
  );
  const refused = report.findings.filter((f) => f.ref === "https://127.0.0.1:8081/partner");
  assert.equal(refused.length, 1);
  assert.equal(refused[0]?.severity, "warn");
  assert.match(refused[0]!.summary, /private or loopback/);
});

test("peer signer: a kid outside its exact pattern is never recorded or quoted; it counts as no usable signature", async () => {
  const hostile = { ...baseRoutes(), [PEER_SIGNATURE]: signed("SECRET <b>not-a-kid</b>") };
  const root = await locked(hostile);
  assert.equal("kid" in (readLockOf(root).peers[PEER] ?? {}), false);
  const signedRoot = await locked({ ...baseRoutes(), [PEER_SIGNATURE]: signed("aaaaaaaaaaaaaaaa") });
  const { findings } = await watch(signedRoot, hostile);
  assert.deepEqual(findings.map((f) => [f.severity, f.ref]), [["warn", PEER]]);
  assert.match(findings[0]!.summary, /no valid kid/);
  assert.ok(findings.every((f) => !JSON.stringify(f).includes("SECRET")));
});
