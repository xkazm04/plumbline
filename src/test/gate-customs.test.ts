import assert from "node:assert/strict";
import { test } from "node:test";
import { customsKeyId, customsReceiptPath } from "../gate/adapter-customs.js";
import { PINNED_CUSTOMS_KEY, type PinnedCustomsKey } from "../gate/context.js";
import { runGate, type GateDeps } from "../gate/index.js";
import { canonicalJson } from "../net/canonical.js";
import { SafeFetchError } from "../net/safe-fetch.js";
import { fixture, scripted, type Route } from "./net-helpers.js";

const C = "https://montbaga.github.io/agent-customs/";
const INDEX = `${C}receipts/index.json`;
const KEY = `${C}.well-known/agent-customs-key.json`;
const NOW = new Date("2026-11-17T12:00:00Z"); // inside the recorded receipts' validity (valid until 2026-12-21)

const CLEARED_TARGET = "https://montbaga.github.io/agent-customs/agent_customs.network.json";
const CLEARED_RECEIPT = `${C}receipts/montbaga.github.io/agent-customs/agent_customs.json`;
const DENIED_TARGET = "https://agent-customs-range.github.io/shady_pizza/shady_pizza.network.json";
const DENIED_RECEIPT = `${C}receipts/agent-customs-range.github.io/shady_pizza/shady_pizza.json`;

async function customs(target: string, routes: Record<string, Route>, deps: GateDeps = {}) {
  const s = scripted(routes);
  const report = await runGate({ target, adapters: ["customs"] }, { fetch: s.fetch, now: () => NOW, ...deps });
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0]?.adapter, "customs");
  return { report, finding: report.findings[0]!, calls: s.calls };
}

const recorded = (): Record<string, Route> => ({
  [INDEX]: { body: fixture("customs-index.json") },
  [KEY]: { body: fixture("customs-key.json") },
  [CLEARED_RECEIPT]: { body: fixture("customs-receipt-cleared.json") },
  [DENIED_RECEIPT]: { body: fixture("customs-receipt-denied.json") },
});

test("the recorded key hashes to its published key id, and receipt paths follow Customs' naming rule", async () => {
  const key = JSON.parse(fixture("customs-key.json"));
  assert.equal(await customsKeyId(key.publicKey), key.keyId);
  assert.equal(key.keyId, PINNED_CUSTOMS_KEY.keyId);
  assert.equal(key.publicKey.x, PINNED_CUSTOMS_KEY.publicKey.x);
  assert.equal(customsReceiptPath("https://montbaga.github.io/agent-customs/agent_customs"), "montbaga.github.io/agent-customs/agent_customs.json");
  for (const r of JSON.parse(fixture("customs-index.json")).receipts) assert.equal(customsReceiptPath(r.network), r.path);
});

test("customs: pass, from a RECORDED real signed receipt (ES256 verified with WebCrypto against the pinned key)", async () => {
  const { finding, report, calls } = await customs(CLEARED_TARGET, recorded());
  assert.equal(finding.state, "pass");
  assert.equal(report.state, "pass");
  assert.match(finding.summary, /CLEARED/);
  assert.match(finding.summary, /inspected 2026-11-16, valid until 2026-12-21/);
  assert.match(finding.summary, /live network was not rechecked/);
  assert.deepEqual(calls, [INDEX, KEY, CLEARED_RECEIPT]);
});

test("customs: fail, from a RECORDED real DENIED receipt", async () => {
  const { finding } = await customs(DENIED_TARGET, recorded());
  assert.equal(finding.state, "fail");
  assert.match(finding.summary, /DENIED/);
});

test("customs: a tampered receipt fails its signature check", async () => {
  const receipt = JSON.parse(fixture("customs-receipt-denied.json"));
  receipt.receipt.verdict = "CLEARED";
  receipt.receipt.stamp = "Cleared";
  const routes = recorded();
  routes[DENIED_RECEIPT] = { body: receipt };
  const index = JSON.parse(fixture("customs-index.json"));
  for (const r of index.receipts) if (r.path.endsWith("shady_pizza.json")) r.verdict = "CLEARED";
  routes[INDEX] = { body: index };
  const { finding, report } = await customs(DENIED_TARGET, routes);
  assert.equal(finding.state, "fail");
  assert.equal(report.state, "fail");
  assert.match(finding.summary, /signature does not verify/);
});

test("customs: a signature made with some other key fails", async () => {
  const other = await makeSigner();
  const signed = await other.sign(receiptFor("https://montbaga.github.io/agent-customs/agent_customs", "CLEARED"), PINNED_CUSTOMS_KEY.keyId);
  const routes = recorded();
  routes[CLEARED_RECEIPT] = { body: signed };
  const { finding } = await customs(CLEARED_TARGET, routes);
  assert.equal(finding.state, "fail");
});

test("REGRESSION (p-05d52a): a receipt signed by a key Customs no longer publishes, and naming it, is unavailable, not a failed signature", async () => {
  // Old code: any key id other than the published one was `fail` ("its signature does not check out") before any
  // signature was checked; after Customs rotates its key, every receipt still signed with the old one read as forged.
  const old = await makeSigner();
  const signed = await old.sign(receiptFor("https://montbaga.github.io/agent-customs/agent_customs", "CLEARED"));
  const routes = recorded();
  routes[CLEARED_RECEIPT] = { body: signed };
  const { finding, report } = await customs(CLEARED_TARGET, routes);
  assert.equal(finding.state, "unavailable");
  assert.equal(report.state, "unavailable");
  assert.match(finding.summary, /signed with a key this build does not trust/);
  assert.match(finding.summary, /re-stamp/);
  // a receipt whose inspector names another key than its signature is not in a shape Customs writes: unavailable
  const signer = await makeSigner();
  const network = "https://montbaga.github.io/agent-customs/agent_customs";
  const mixed = await signer.sign(receiptFor(network, "CLEARED"), signer.pinned.keyId, "some-other-key-id");
  const inconsistent = await customs(CLEARED_TARGET, signerRoutes(signer, network, mixed, "CLEARED"), { customsPinnedKey: signer.pinned });
  assert.equal(inconsistent.finding.state, "unavailable");
  assert.match(inconsistent.finding.summary, /inspector names a different key than its signature/);
  // and a trusted key id whose signature fails stays `fail` (the test above: "a signature made with some other key fails")
});

test("customs: no receipt for this target is unavailable, with that reason, never pass", async () => {
  const { finding, report } = await customs("https://other.example/net.network.json", recorded());
  assert.equal(finding.state, "unavailable");
  assert.equal(report.state, "unavailable");
  assert.match(finding.summary, /no receipt for this target/);
});

test("customs: unreachable index, key or receipt, a non-200, junk, and a changed key are all unavailable", async () => {
  const base = recorded();
  const cases: [string, Record<string, Route>][] = [
    ["index unreachable", { ...base, [INDEX]: { error: new SafeFetchError("timeout", "t") } }],
    ["index absent from the table", Object.fromEntries(Object.entries(base).filter(([k]) => k !== INDEX))],
    ["index 503", { ...base, [INDEX]: { status: 503 } }],
    ["index not JSON", { ...base, [INDEX]: { body: "<html>" } }],
    ["index wrong shape", { ...base, [INDEX]: { body: { receipts: "none" } } }],
    ["key unreachable", { ...base, [KEY]: { error: new SafeFetchError("network", "n") } }],
    ["key 404", { ...base, [KEY]: { status: 404 } }],
    ["key not in the recorded shape", { ...base, [KEY]: { body: { alg: "ES256" } } }],
    ["receipt unreachable", { ...base, [CLEARED_RECEIPT]: { error: new SafeFetchError("timeout", "t") } }],
    ["receipt 404", { ...base, [CLEARED_RECEIPT]: { status: 404 } }],
    ["receipt not JSON", { ...base, [CLEARED_RECEIPT]: { body: "nope" } }],
    ["receipt wrong shape", { ...base, [CLEARED_RECEIPT]: { body: { receipt: {} } } }],
  ];
  for (const [label, routes] of cases) {
    const { finding, report } = await customs(CLEARED_TARGET, routes);
    assert.equal(finding.state, "unavailable", label);
    assert.notEqual(report.state, "pass", label);
  }
  // A published key that differs from the pinned one is not trusted, even when it is self-consistent.
  const rotated = await makeSigner();
  const routes = { ...base, [KEY]: { body: rotated.keyFile } };
  const { finding } = await customs(CLEARED_TARGET, routes);
  assert.equal(finding.state, "unavailable");
  assert.match(finding.summary, /different key than the one pinned/);
});

test("p-a851cc: the adapter's remaining refusals are each unavailable, with their own reason", async () => {
  const base = recorded();
  // a published key file whose key id does not match its key
  const key = JSON.parse(fixture("customs-key.json"));
  const badKeyId = await customs(CLEARED_TARGET, { ...base, [KEY]: { body: { ...key, keyId: "AAAAAAAAAAAAAAAA" } } });
  assert.equal(badKeyId.finding.state, "unavailable");
  assert.match(badKeyId.finding.summary, /published key id does not match its key/);

  // an index entry whose path breaks Customs' naming rule: the unsigned index never steers a fetch
  const index = JSON.parse(fixture("customs-index.json"));
  for (const r of index.receipts) if (r.path.endsWith("agent_customs.json")) r.path = "../../elsewhere/evil.json";
  const steered = await customs(CLEARED_TARGET, { ...base, [INDEX]: { body: index } });
  assert.equal(steered.finding.state, "unavailable");
  assert.match(steered.finding.summary, /does not match its own naming rule/);
  assert.ok(!steered.calls.some((c) => c.includes("evil")), steered.calls.join(", "));

  // a signed receipt with unusable dates
  const signer = await makeSigner();
  const network = "https://montbaga.github.io/agent-customs/agent_customs";
  const undated = receiptFor(network, "CLEARED");
  undated.inspectedAt = "soon";
  const dates = await customs(CLEARED_TARGET, signerRoutes(signer, network, await signer.sign(undated), "CLEARED"), { customsPinnedKey: signer.pinned });
  assert.equal(dates.finding.state, "unavailable");
  assert.match(dates.finding.summary, /no usable dates/);

  // no network address for the target: no manifest, or a manifest that names no network
  for (const manifest of [{ status: 404 }, { body: { networks: [] } }] as Route[]) {
    const none = await customs("https://site.example/", { ...base, "https://site.example/agent-manifest.json": manifest });
    assert.equal(none.finding.state, "unavailable");
    assert.match(none.finding.summary, /no network address could be worked out/);
    assert.ok(!none.calls.includes(INDEX), "Customs is not asked");
  }
});

test("p-a851cc: a target with several networks shows the worst outcome and the count", async () => {
  const manifest = {
    networks: [
      { name: "agent_customs", front_man: "f", hocon: "agent_customs.network.json" },
      { name: "unstamped", front_man: "f", hocon: "unstamped.network.json" },
    ],
  };
  const { finding } = await customs(C, { ...recorded(), [`${C}agent-manifest.json`]: { body: manifest } });
  assert.equal(finding.state, "unavailable", "one CLEARED and one with no receipt: unavailable is worse than pass");
  assert.match(finding.summary, /no receipt for this target/);
  assert.match(finding.summary, /\(2 networks on this target; the worst is shown\)$/);
});

test("customs: an expired receipt is unavailable, not pass", async () => {
  const { finding } = await customs(CLEARED_TARGET, recorded(), { now: () => new Date("2027-01-02T00:00:00Z") });
  assert.equal(finding.state, "unavailable");
  assert.match(finding.summary, /expired/);
});

test("customs: the 35-day lifetime applies even when a receipt claims a longer one", async () => {
  const signer = await makeSigner();
  const network = "https://montbaga.github.io/agent-customs/agent_customs";
  const receipt = receiptFor(network, "CLEARED");
  receipt.inspectedAt = "2026-10-01T00:00:00.000Z";
  receipt.expiresAt = "2030-01-01T00:00:00.000Z";
  const routes = signerRoutes(signer, network, await signer.sign(receipt), "CLEARED");
  const { finding } = await customs(CLEARED_TARGET, routes, { customsPinnedKey: signer.pinned, now: () => NOW });
  assert.equal(finding.state, "unavailable", "inspected 47 days before NOW, so past 35 days despite the claimed 2030 expiry");
  assert.match(finding.summary, /expired/);
});

test("customs: stamped verdicts map as CLEARED and CONDITIONS pass, HOLD, DENIED and INVALID fail, the rest unavailable", async () => {
  const signer = await makeSigner();
  const network = "https://montbaga.github.io/agent-customs/agent_customs";
  const expected: Record<string, string> = { CLEARED: "pass", CONDITIONS: "pass", HOLD: "fail", DENIED: "fail", INVALID: "fail", UNREADABLE: "unavailable", MYSTERY: "unavailable" };
  for (const [verdict, state] of Object.entries(expected)) {
    const routes = signerRoutes(signer, network, await signer.sign(receiptFor(network, verdict)), verdict);
    const { finding } = await customs(CLEARED_TARGET, routes, { customsPinnedKey: signer.pinned });
    assert.equal(finding.state, state, verdict);
  }
});

test("customs: a validly signed receipt for another network, or one the index contradicts, is unavailable", async () => {
  const signer = await makeSigner();
  const network = "https://montbaga.github.io/agent-customs/agent_customs";
  const wrongNetwork = signerRoutes(signer, network, await signer.sign(receiptFor("https://elsewhere.example/x", "CLEARED")), "CLEARED");
  assert.equal((await customs(CLEARED_TARGET, wrongNetwork, { customsPinnedKey: signer.pinned })).finding.state, "unavailable");
  const contradicted = signerRoutes(signer, network, await signer.sign(receiptFor(network, "DENIED")), "CLEARED");
  assert.equal((await customs(CLEARED_TARGET, contradicted, { customsPinnedKey: signer.pinned })).finding.state, "unavailable");
});

// ---- a signer of our own, so verdicts the recorded receipts do not cover can be exercised ----

function receiptFor(network: string, verdict: string): any {
  return {
    type: "agent-customs-receipt",
    version: 1,
    network,
    fingerprint: "sha256:" + "0".repeat(64),
    verdict,
    stamp: verdict,
    summary: "test",
    counts: {},
    findings: [],
    conformance: { passed: 1, total: 1 },
    inspectedAt: "2026-11-16T09:00:00.000Z",
    expiresAt: "2026-12-21T09:00:00.000Z",
    inspector: { name: "Agent Customs", version: "1.0.0", site: C, keyId: "" },
  };
}

async function makeSigner() {
  const pair = await globalThis.crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await globalThis.crypto.subtle.exportKey("jwk", pair.publicKey);
  const publicKey = { crv: jwk.crv!, kty: jwk.kty!, x: jwk.x!, y: jwk.y! };
  const keyId = await customsKeyId(publicKey);
  const keyFile = { alg: "ES256", keyId, publicKey };
  const pinned: PinnedCustomsKey = { keyId, publicKey };
  return {
    keyFile,
    pinned,
    async sign(receipt: any, claimedKeyId = keyId, inspectorKeyId = claimedKeyId) {
      const withKey = { ...receipt, inspector: { ...receipt.inspector, keyId: inspectorKeyId } };
      const sig = await globalThis.crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(canonicalJson(withKey)));
      return { receipt: withKey, signature: { alg: "ES256", keyId: claimedKeyId, value: Buffer.from(sig).toString("base64url") } };
    },
  };
}

function signerRoutes(signer: Awaited<ReturnType<typeof makeSigner>>, network: string, signed: unknown, indexVerdict: string): Record<string, Route> {
  const path = customsReceiptPath(network);
  return {
    [INDEX]: { body: { receipts: [{ network, path, verdict: indexVerdict }] } },
    [KEY]: { body: signer.keyFile },
    [`${C}receipts/${path}`]: { body: signed as object },
  };
}
