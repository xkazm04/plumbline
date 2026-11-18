import assert from "node:assert/strict";
import { test } from "node:test";
import { runGate } from "../gate/index.js";
import type { Fetcher } from "../net/locate.js";
import { SafeFetchError } from "../net/safe-fetch.js";
import { fixture, loopbackServer, response, scripted, type Route } from "./net-helpers.js";

const NOW = new Date("2026-11-17T12:00:00Z");
const TARGET = "https://montbaga.github.io/agent-customs/agent_customs.network.json";
const C = "https://montbaga.github.io/agent-customs/";
const atlasUrl = `https://agent-atlas-phi.vercel.app/api/check?url=${encodeURIComponent(TARGET)}`;

const allGood = (): Record<string, Route> => ({
  [TARGET]: { body: fixture("atlas-site-network.json") },
  [atlasUrl]: { body: fixture("atlas-check-conformant.json") },
  [`${C}receipts/index.json`]: { body: fixture("customs-index.json") },
  [`${C}.well-known/agent-customs-key.json`]: { body: fixture("customs-key.json") },
  [`${C}receipts/montbaga.github.io/agent-customs/agent_customs.json`]: { body: fixture("customs-receipt-cleared.json") },
});

test("gate: every adapter passing gives pass, with one finding per adapter in order", async () => {
  const report = await runGate({ target: TARGET }, { fetch: scripted(allGood()).fetch, now: () => NOW });
  assert.equal(report.state, "pass");
  assert.equal(report.target, TARGET);
  assert.deepEqual(report.findings.map((f) => f.adapter), ["validator", "atlas", "customs"]);
  assert.ok(report.findings.every((f) => f.state === "pass"));
  // UAT-10 (PRI-L1-08): the report says when the gate ran, by the gate's clock
  assert.equal(report.checkedAt, NOW.toISOString());
  assert.equal(report.signature, undefined, "the runner never claims a signature verdict");
});

test("gate: an unreachable Atlas and Customs make the state unavailable, and the validator's pass does not hide them", async () => {
  const routes = allGood();
  delete routes[atlasUrl];
  delete routes[`${C}receipts/index.json`];
  const report = await runGate({ target: TARGET }, { fetch: scripted(routes).fetch, now: () => NOW });
  assert.equal(report.state, "unavailable");
  assert.notEqual(report.state, "pass");
  const by = Object.fromEntries(report.findings.map((f) => [f.adapter, f.state]));
  assert.deepEqual(by, { validator: "pass", atlas: "unavailable", customs: "unavailable" });
});

test("gate: the state is the worst: fail beats unavailable beats pass", async () => {
  const routes = allGood();
  routes[atlasUrl] = { body: fixture("atlas-check-not-conformant.json") };
  delete routes[`${C}receipts/index.json`];
  const report = await runGate({ target: TARGET }, { fetch: scripted(routes).fetch, now: () => NOW });
  assert.equal(report.state, "fail");
  assert.deepEqual(report.findings.map((f) => f.state), ["pass", "fail", "unavailable"]);
});

test("gate: only the asked-for adapters run, and asking for none is not a pass", async () => {
  const s = scripted(allGood());
  const only = await runGate({ target: TARGET, adapters: ["atlas"] }, { fetch: s.fetch, now: () => NOW });
  assert.deepEqual(only.findings.map((f) => f.adapter), ["atlas"]);
  assert.deepEqual(s.calls, [atlasUrl]);
  const none = await runGate({ target: TARGET, adapters: [] }, { fetch: s.fetch });
  assert.equal(none.state, "unavailable");
  assert.deepEqual(none.findings, []);
});

test("gate: one adapter failing unexpectedly never hides the others", async () => {
  const good = scripted(allGood()).fetch;
  const bomb: Fetcher = async (url, options) => {
    if (url === atlasUrl) {
      const r = response(url, { body: "{}" });
      return { ...r, text: () => { throw new Error("boom"); } };
    }
    return good(url, options);
  };
  const report = await runGate({ target: TARGET }, { fetch: bomb, now: () => NOW });
  const by = Object.fromEntries(report.findings.map((f) => [f.adapter, f.state]));
  assert.deepEqual(by, { validator: "pass", atlas: "unavailable", customs: "pass" });
  assert.equal(report.state, "unavailable");
});

test("gate: an adapter that hangs gets its own deadline and the others still report", async () => {
  const good = scripted(allGood()).fetch;
  const hang: Fetcher = (url, options) => (url === atlasUrl ? new Promise(() => undefined) : good(url, options));
  const started = Date.now();
  const report = await runGate({ target: TARGET, timeoutMs: 40 }, { fetch: hang, now: () => NOW });
  assert.ok(Date.now() - started < 2000);
  const by = Object.fromEntries(report.findings.map((f) => [f.adapter, f.state]));
  assert.deepEqual(by, { validator: "pass", atlas: "unavailable", customs: "pass" });
  assert.match(report.findings[1]!.summary, /did not finish in time/);
});

test("gate: a target that is a private address is unavailable on every adapter, not an exception", async () => {
  const report = await runGate({ target: "https://127.0.0.1/", timeoutMs: 500 }, { atlasBase: "https://127.0.0.1" });
  assert.equal(report.state, "unavailable");
  assert.ok(report.findings.every((f) => f.state === "unavailable"));
  assert.match(report.findings[0]!.summary, /private or loopback/);
});

test("gate: end to end through the real safeFetch against a loopback test server", async () => {
  const site = await loopbackServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === "/agent-manifest.json") res.end(fixture("atlas-site-manifest.json"));
    else if (path === "/agent_atlas.network.json") res.end(fixture("atlas-site-network.json"));
    else if (path === "/api/check") res.end(fixture("atlas-check-conformant.json"));
    else res.writeHead(404).end("no");
  });
  try {
    const report = await runGate(
      { target: `${site.url}/`, adapters: ["validator", "atlas"], timeoutMs: 3000 },
      { atlasBase: site.url, fetchOptions: { allowLocal: true } },
    );
    assert.deepEqual(report.findings.map((f) => [f.adapter, f.state]), [["validator", "pass"], ["atlas", "pass"]]);
    // Without the test option the same gate reaches nothing.
    const refused = await runGate({ target: `${site.url}/`, adapters: ["validator", "atlas"], timeoutMs: 3000 }, { atlasBase: site.url });
    assert.equal(refused.state, "unavailable");
  } finally {
    await site.close();
  }
});

test("gate: a SafeFetchError from the fetcher is an adapter outcome, never a crash", async () => {
  const boom: Fetcher = async () => {
    throw new SafeFetchError("network", "ECONNRESET");
  };
  const report = await runGate({ target: TARGET }, { fetch: boom, now: () => NOW });
  assert.equal(report.state, "unavailable");
  assert.equal(report.findings.length, 3);
});
