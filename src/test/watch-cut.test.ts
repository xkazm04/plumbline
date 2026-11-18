// UAT-25 (DEV-L2-3): after a partner is cut from the networks, the watch notes an `allowed_peers` origin no network or
// links.json names a peer at (`info`, never a failure), and is quiet while one does. No network: the peers' fetches
// are scripted.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { coverageFindings } from "../watch/decide.js";
import { runRelock, runWatch } from "../watch/index.js";
import { scripted } from "./net-helpers.js";
import { NOW, peerNetwork } from "./watch-helpers.js";

let tmp: string;
before(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "plumbline-uat25-"));
});
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const PEER = "https://coinbridge.example/coinbridge_fx";
const routes = {
  "https://coinbridge.example/agent-manifest.json": { status: 404 },
  "https://coinbridge.example/coinbridge_fx.network.json": { body: peerNetwork("fx") },
  "https://coinbridge.example/links.json": { status: 404 },
  "https://coinbridge.example/plumbline.signature.json": { status: 404 },
  "https://api.github.com/repos/cognizant-ai-lab/nsdeploy/commits?per_page=1": { body: [{ sha: "53a787c0123456789abcdef0123456789abcdef0" }] },
};

function site(tools: string[]): string {
  const root = mkdtempSync(path.join(tmp, "site-"));
  writeFileSync(path.join(root, "agent-manifest.json"), JSON.stringify({ brand: "Trips", networks: [{ name: "trips", front_man: "trips_front", hocon: "./trips.network.json" }], allowed_peers: ["https://coinbridge.example"] }));
  writeFileSync(path.join(root, "trips.network.json"), JSON.stringify({ tools: [{ name: "trips_front", instructions: "Plan trips.", tools }] }));
  return root;
}

test("UAT-25: a partner cut from the networks and left in allowed_peers is noted (info, exit-clean); while it is named, nothing", async () => {
  const deps = { fetch: scripted(routes).fetch, now: () => NOW };
  const root = site([PEER]);
  await runWatch({ root, init: true }, deps);
  const named = await runWatch({ root }, deps);
  assert.ok(!named.findings.some((f) => f.code === "allowed-peer-unused"), JSON.stringify(named.findings));
  // the cut: the network no longer names the partner; a relock drops it from the lock
  writeFileSync(path.join(root, "trips.network.json"), JSON.stringify({ tools: [{ name: "trips_front", instructions: "Plan trips.", tools: [] }] }));
  const relock = await runRelock({ root }, deps);
  assert.ok(relock.changes.removed.includes(`peer ${PEER}`), JSON.stringify(relock.changes));
  const after = await runWatch({ root }, deps);
  const note = after.findings.filter((f) => f.code === "allowed-peer-unused");
  assert.deepEqual(note.map((f) => [f.kind, f.severity, f.ref]), [["peer", "info", "https://coinbridge.example"]]);
  assert.match(note[0]?.summary ?? "", /still lists this origin in allowed_peers, but no network or links\.json names a peer there/);
  assert.ok(!after.findings.some((f) => f.severity === "warn" || f.severity === "block"), "info alone: the watch stays clean");
});

test("UAT-25: allowed_peers entries are compared by origin; one that is not a URL is ignored", () => {
  const lock = { version: 1 as const, runtime: { source: "nsdeploy" as const, commit: "unknown", files: {} }, grounding: { sources: [], builtAt: "x" }, peers: {} };
  const out = coverageFindings(lock, { refs: [], peers: ["https://A.example/x"], allowed: ["https://a.example", "https://a.example/", "not a url", "https://b.example:8443"] });
  assert.deepEqual(out.filter((f) => f.code === "allowed-peer-unused").map((f) => f.ref), ["https://b.example:8443"], "only the origin no peer is named at");
});
