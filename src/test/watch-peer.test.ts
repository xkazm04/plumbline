import assert from "node:assert/strict";
import { test } from "node:test";
import { SafeFetchError } from "../net/safe-fetch.js";
import { copySite } from "./net-helpers.js";
import { baseRoutes, ofKind, peerNetwork, PEER, PEER_FILE, PEER_SIGNATURE, PEER2, PEER2_FILE, watch } from "./watch-helpers.js";

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

test("peer neighbour: the same definition re-serialised (key order, spacing) is not drift", async () => {
  const root = await locked();
  const reordered = '{ "tools": [ { "instructions": "Answer as partner.", "name": "partner_front" } ],\n  "metadata": { "description": "partner" } }';
  const { findings } = await watch(root, { ...baseRoutes(), [PEER_FILE]: { body: reordered } });
  assert.deepEqual(findings, []);
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
