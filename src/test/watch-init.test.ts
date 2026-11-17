import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { LOCK_FILE, SEVERITIES, DRIFT_KINDS, type PlumblineLock } from "../core/types.js";
import { copySite } from "./net-helpers.js";
import { baseRoutes, PEER, PEER2, watch } from "./watch-helpers.js";

const readLock = (root: string): PlumblineLock => JSON.parse(readFileSync(join(root, LOCK_FILE), "utf8"));

test("watch: no lock and no init reports exactly one grounding warning 'no lock'", async () => {
  const root = copySite();
  const { findings, calls } = await watch(root, baseRoutes());
  assert.deepEqual(findings, [{ kind: "grounding", severity: "warn", ref: "plumbline.lock.json", summary: "no lock" }]);
  assert.deepEqual(calls, [], "nothing is fetched and nothing is written");
  assert.throws(() => readLock(root));
});

test("watch --init writes a lock capturing the current state and returns an empty report; a second run reports clean", async () => {
  const root = copySite();
  const first = await watch(root, baseRoutes(), { init: true, extraSources: ["data/rooms.json"] });
  assert.deepEqual(first.findings, []);

  const lock = readLock(root);
  assert.equal(lock.version, 1);
  assert.equal(lock.runtime.source, "nsdeploy");
  assert.equal(lock.runtime.commit, "53a787c");
  assert.deepEqual(Object.keys(lock.runtime.files), ["runtime/README.md", "runtime/engine.js", "runtime/generated/graph.gen.mjs", "runtime/ui.js"]);
  assert.deepEqual(
    lock.grounding.sources.map((s) => s.ref),
    ["agent-manifest.json", "fixture_guesthouse.network.json", "links.json", "data/rooms.json"],
  );
  assert.equal(lock.grounding.builtAt, "2026-11-17T12:00:00.000Z");
  assert.deepEqual(Object.keys(lock.peers).sort(), [PEER, PEER2].sort(), "peers come from link_labels, agent tools and links.json; the MCP endpoint is not a peer");
  assert.equal(lock.peers[PEER]?.checkedAt, "2026-11-17T12:00:00.000Z");
  assert.equal("kid" in (lock.peers[PEER] ?? {}), false, "an unsigned peer records no kid, and no null");
  assert.ok(!readFileSync(join(root, LOCK_FILE), "utf8").includes("null"), "absent optional fields are omitted, never null");

  const second = await watch(root, baseRoutes());
  assert.deepEqual(second.findings, [], "a second run against the same state is clean");
});

test("watch --init records a peer's signer kid when it publishes one", async () => {
  const root = copySite();
  const routes = baseRoutes();
  routes["https://peer.example/plumbline.signature.json"] = { body: { type: "plumbline-signature", kid: "0123456789abcdef" } };
  await watch(root, routes, { init: true });
  assert.equal(readLock(root).peers[PEER]?.kid, "0123456789abcdef");
});

test("watch --init does not overwrite an existing lock: it checks against it", async () => {
  const root = copySite();
  await watch(root, baseRoutes(), { init: true });
  const before = readFileSync(join(root, LOCK_FILE), "utf8");
  writeFileSync(join(root, "links.json"), '{ "version": 1, "networks": {} }');
  const again = await watch(root, baseRoutes(), { init: true });
  assert.equal(readFileSync(join(root, LOCK_FILE), "utf8"), before);
  assert.deepEqual(again.findings.map((f) => f.ref), ["links.json"]);
});

test("watch --init leaves a gap out of the lock and says so, rather than writing a lock that looks complete", async () => {
  const root = copySite();
  const routes = baseRoutes();
  routes["https://peer.example/partner.network.json"] = { status: 500 };
  delete routes["https://other-peer.example/shuttle.network.json"];
  const { findings } = await watch(root, routes, { init: true, extraSources: ["data/missing.json", "https://docs.example/facts.json"] });
  const lock = readLock(root);
  assert.deepEqual(Object.keys(lock.peers), []);
  assert.deepEqual(findings.map((f) => `${f.kind}:${f.severity}:${f.ref}`).sort(), [
    `grounding:warn:data/missing.json`,
    `grounding:warn:https://docs.example/facts.json`,
    `peer:warn:${PEER}`,
    `peer:warn:${PEER2}`,
  ].sort());
});

test("watch --init on a folder with no runtime or sources locks what exists and notes the rest as info", async () => {
  const empty = copySite();
  for (const name of ["runtime", "agent-manifest.json", "fixture_guesthouse.network.json", "links.json", "data"]) {
    rmSync(join(empty, name), { recursive: true, force: true });
  }
  const { findings } = await watch(empty, baseRoutes(), { init: true });
  assert.deepEqual(findings.map((f) => `${f.kind}:${f.severity}`).sort(), ["grounding:info", "runtime:info"]);
  assert.deepEqual(readLock(empty).runtime, { source: "nsdeploy", commit: "unknown", files: {} });
});

test("watch: a lock that is not valid is one warning, not a crash or a silent pass", async () => {
  const root = copySite();
  writeFileSync(join(root, LOCK_FILE), "{ nope");
  const a = await watch(root, baseRoutes());
  assert.equal(a.findings.length, 1);
  assert.equal(a.findings[0]?.severity, "warn");
  writeFileSync(join(root, LOCK_FILE), JSON.stringify({ version: 1, runtime: { source: "nsdeploy", commit: "x", files: { a: "not-a-hash" } }, grounding: { sources: [], builtAt: "t" }, peers: {} }));
  const b = await watch(root, baseRoutes());
  assert.equal(b.findings.length, 1);
  assert.match(b.findings[0]!.summary, /cannot be used/);
});

test("every finding uses only the kinds and severities in the wire contract", async () => {
  const root = copySite();
  await watch(root, baseRoutes(), { init: true });
  writeFileSync(join(root, "links.json"), "{}");
  writeFileSync(join(root, "runtime/engine.js"), "tampered");
  const routes = baseRoutes();
  routes["https://peer.example/partner.network.json"] = { body: { changed: true } };
  routes["https://api.github.com/repos/cognizant-ai-lab/nsdeploy/commits?per_page=1"] = { body: [{ sha: "ffffffffffffffffffffffffffffffffffffffff" }] };
  const { findings } = await watch(root, routes);
  assert.ok(findings.length >= 4);
  for (const f of findings) {
    assert.ok((DRIFT_KINDS as readonly string[]).includes(f.kind));
    assert.ok((SEVERITIES as readonly string[]).includes(f.severity));
    assert.ok(f.summary.length > 0);
  }
});
