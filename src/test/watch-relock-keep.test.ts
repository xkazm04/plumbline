// UAT-3: a relock never forgets what it could not re-read. A pinned peer that cannot be reached keeps its pin, a card
// that cannot be reached keeps its record, a signature that cannot be read keeps the kid, and every kept record is a
// finding that says so. A pending peer's line says why it is still pending today. No network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { LOCK_FILE, type PlumblineLock } from "../core/types.js";
import { SafeFetchError } from "../net/safe-fetch.js";
import { runRelock } from "../watch/index.js";
import { copySite, scripted, type Route } from "./net-helpers.js";
import { baseRoutes, NOW, PEER, PEER_FILE, PEER_SIGNATURE, peerNetwork, watch } from "./watch-helpers.js";

const readLock = (root: string): PlumblineLock => JSON.parse(readFileSync(join(root, LOCK_FILE), "utf8")) as PlumblineLock;
const relock = (root: string, routes: Record<string, Route>, extra: Parameters<typeof runRelock>[1] = {}) =>
  runRelock({ root }, { fetch: scripted(routes).fetch, now: () => new Date("2026-11-19T08:00:00Z"), ...extra });
const down: Route = { error: new SafeFetchError("network", "connection refused") };
const signed = (kid: string): Route => ({ body: { type: "plumbline-signature", version: 1, kid } });
const CARD_URL = "https://studio.example/.well-known/agent-card.json";
const card = (): string => readFileSync(new URL("../../src/test/fixtures/a2a/sample-agent-card.json", import.meta.url), "utf8");

test("UAT-3: a relock while a pinned peer is down keeps its pin and says so; when it returns changed, the watch blocks with the outline", async () => {
  const root = copySite();
  await watch(root, { ...baseRoutes(), [PEER_SIGNATURE]: signed("aaaaaaaaaaaaaaaa") }, { init: true });
  const pinned = readLock(root).peers[PEER];
  assert.ok(pinned?.kid);

  const offline = await relock(root, { ...baseRoutes(), [PEER_FILE]: down, [PEER_SIGNATURE]: down });
  assert.deepEqual(offline.changes, { added: [], removed: [], changed: [] }, "nothing pinned is lost: no ref changed");
  assert.deepEqual(readLock(root).peers[PEER], pinned);
  assert.equal(readLock(root).pendingPeers, undefined);
  const kept = offline.findings.find((f) => f.ref === PEER);
  assert.equal(kept?.severity, "warn");
  assert.match(kept?.summary ?? "", /^A peer could not be re-read \(the connection failed\), so the lock keeps its earlier pin \(recorded 2026-11-17\); every watch compares the peer with that pin\.$/);

  // it comes back changed: compared with the kept pin, not accepted as "added"
  const back = { ...baseRoutes(), [PEER_FILE]: { body: { ...peerNetwork(), tools: [...(peerNetwork() as { tools: object[] }).tools, { name: "deposit_taker", instructions: "Take a deposit." }] } }, [PEER_SIGNATURE]: signed("aaaaaaaaaaaaaaaa") };
  const { findings } = await watch(root, back);
  const block = findings.find((f) => f.ref === PEER && f.severity === "block");
  assert.match(block?.summary ?? "", /In outline: agents: 1 added, 0 removed, 0 changed/);
});

test("UAT-3: a relock with nothing reachable keeps every pin and the Agent Card", async () => {
  const root = copySite();
  await watch(root, { ...baseRoutes(), [CARD_URL]: { body: card() } }, { init: true, externals: [{ kind: "a2a-card", url: CARD_URL }] });
  const before = readLock(root);
  assert.ok(before.external?.[CARD_URL]);
  const nothing: Record<string, Route> = Object.fromEntries(Object.keys({ ...baseRoutes(), [CARD_URL]: down }).map((u) => [u, down]));
  const result = await relock(root, nothing);
  assert.deepEqual(result.changes, { added: [], removed: [], changed: [] });
  const after = readLock(root);
  assert.deepEqual(after.peers, before.peers);
  assert.deepEqual(after.external, before.external);
  assert.match(result.findings.find((f) => f.ref === CARD_URL)?.summary ?? "", /could not be re-read \(the connection failed\), so the lock keeps its earlier record/);
  // the card is still in the lock and still warns while it is down
  const { findings } = await watch(root, { ...baseRoutes(), [CARD_URL]: down });
  assert.equal(findings.find((f) => f.ref === CARD_URL)?.severity, "warn");
});

test("UAT-3: a signature that answers 5xx at capture is a finding and keeps the previous kid; a new key is recorded when it answers", async () => {
  const root = copySite();
  await watch(root, { ...baseRoutes(), [PEER_SIGNATURE]: signed("aaaaaaaaaaaaaaaa") }, { init: true });
  const result = await relock(root, { ...baseRoutes(), [PEER_SIGNATURE]: { status: 500, body: "oops" } });
  assert.equal(readLock(root).peers[PEER]?.kid, "aaaaaaaaaaaaaaaa");
  const finding = result.findings.find((f) => f.ref === PEER);
  assert.match(finding?.summary ?? "", /signature could not be read at capture \(its signature request answered HTTP 500\), so the lock keeps the key it recorded before/);
  assert.deepEqual(result.changes.changed, [], "the kept kid is no change");
  // a peer that was signed and now publishes none: recorded unsigned, said so
  const unsigned = await relock(root, baseRoutes());
  assert.match(unsigned.findings.find((f) => f.ref === PEER)?.summary ?? "", /recorded as signed publishes no signature now/);
});

test("UAT-3: a pending peer stays pending with its date through a relock while it is down, and its line says why today", async () => {
  const root = copySite();
  await watch(root, { ...baseRoutes(), [PEER_FILE]: down }, { init: true });
  const since = readLock(root).pendingPeers?.[PEER]?.since;
  assert.equal(since, NOW.toISOString());
  await relock(root, { ...baseRoutes(), [PEER_FILE]: down });
  assert.equal(readLock(root).pendingPeers?.[PEER]?.since, since, "the date it first could not be captured");

  const still = (await watch(root, { ...baseRoutes(), [PEER_FILE]: down })).findings.find((f) => f.ref === PEER);
  assert.match(still?.summary ?? "", /pending since 2026-11-17\), so it is not watched; it still cannot be read \(the connection failed\); run watch --relock once it answers\.$/);
  const answers = (await watch(root, baseRoutes())).findings.find((f) => f.ref === PEER);
  assert.match(answers?.summary ?? "", /so it is not watched; it answers now: review it, then run watch --relock to capture it\.$/);
});

test("UAT-3: a peer the address rule refuses reads the same words in the checkout's watch as in the Desk's reader", async () => {
  const root = copySite();
  await watch(root, baseRoutes(), { init: true });
  const refused: Route = { error: new SafeFetchError("insecure-scheme", "not https") };
  const { findings } = await watch(root, { ...baseRoutes(), [PEER_FILE]: refused, "https://peer.example/agent-manifest.json": refused });
  const line = findings.find((f) => f.ref === PEER);
  assert.equal(line?.summary, "A peer in this lock was not contacted: it is not an https address, an address Plumbline does not contact, so it was not checked.");
});

test("UAT-3: an Agent Card the address rule refuses reads the address rule's words too", async () => {
  const root = copySite();
  await watch(root, { ...baseRoutes(), [CARD_URL]: { body: card() } }, { init: true, externals: [{ kind: "a2a-card", url: CARD_URL }] });
  const { findings } = await watch(root, { ...baseRoutes(), [CARD_URL]: { error: new SafeFetchError("insecure-scheme", "not https") } });
  assert.equal(
    findings.find((f) => f.ref === CARD_URL)?.summary,
    "An external agent definition in this lock was not contacted: it is not an https address, an address Plumbline does not contact, so it was not checked.",
  );
});
