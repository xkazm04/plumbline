// UAT-21 (DEV-L1-08, TOM-L1-11, TOM-L2-06, PRI-L1-11): a publisher rehearses before production with the product's own
// CLI. `init`, `watch --root` (plain, --init, --relock) with `--external`, and the scan script take `--allow-local`:
// http and loopback peers, cards and sites on this machine, with the warning printed; private ranges stay refused; and
// `watch --url` still refuses a published lock's non-https peers. The partner is a loopback test server; every spawned
// CLI runs with the no-network preload.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { LOCK_FILE, type PlumblineLock } from "../core/types.js";
import { parseExternalArg } from "../watch/external.js";
import { parseList } from "../scan/run.js";
import { runAsync } from "./cli-helpers.js";
import { loopbackServer, type TestServer } from "./net-helpers.js";

const NO_NETWORK = new URL("./no-network.js", import.meta.url).href;
const SCAN = fileURLToPath(new URL("../../scripts/scan-ecosystem.mjs", import.meta.url));
const WARNING = /WARNING: --allow-local: http and loopback addresses are allowed for this run \(private ranges stay refused\)/;

let tmp: string;
let server: TestServer;
const served = new Map<string, string>();
const handler: http.RequestListener = (req, res) => {
  const body = served.get(new URL(req.url ?? "/", "http://x").pathname);
  if (body === undefined) res.writeHead(404).end();
  else res.writeHead(200, { "content-type": "application/json" }).end(body);
};

before(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), "plumbline-uat21-"));
  server = await loopbackServer(handler);
});
after(async () => {
  await server.close();
  rmSync(tmp, { recursive: true, force: true });
});

const partner = (fee: string) => JSON.stringify({ tools: [{ name: "seller_front", instructions: `Sell pots. Fee ${fee}.`, tools: [] }] });
const card = (skills: string[]) => JSON.stringify({ name: "Studio", skills: skills.map((id) => ({ id, description: id })), signatures: [{ protected: "x", signature: "y" }] });

/** A site whose network names the loopback partner and a partner on a private address. */
function site(withPrivate = false): { root: string; peer: string } {
  const root = mkdtempSync(path.join(tmp, "site-"));
  const peer = `${server.url}/seller`;
  const tools = [peer, ...(withPrivate ? ["http://10.0.0.5/inside"] : [])];
  writeFileSync(path.join(root, "market.network.json"), JSON.stringify({ tools: [{ name: "market_front", instructions: "Find sellers.", tools }] }, null, 2));
  return { root, peer };
}

const lockOf = (root: string) => JSON.parse(readFileSync(path.join(root, LOCK_FILE), "utf8")) as PlumblineLock;

test("UAT-21: init --allow-local pins a loopback peer (with the warning); without it the peer is pending, as before", async () => {
  served.clear();
  served.set("/seller.network.json", partner("5%"));
  const plain = site();
  const without = await runAsync("init", "--root", plain.root, "--json");
  assert.equal(without.code, 1);
  assert.deepEqual(Object.keys(lockOf(plain.root).pendingPeers ?? {}), [plain.peer], "not https: pending");
  assert.match(without.out, /it is not an https address/);

  const local = site(true);
  const r = await runAsync("init", "--root", local.root, "--allow-local", "--json");
  assert.match(r.err, WARNING);
  const lock = lockOf(local.root);
  assert.ok(lock.peers[local.peer]?.sha256, JSON.stringify(lock));
  // a private range stays refused: that partner is pending, in the address rule's words
  assert.deepEqual(Object.keys(lock.pendingPeers ?? {}), ["http://10.0.0.5/inside"]);
  assert.equal(r.code, 1, "the private partner is a gap");
  assert.match(r.out, /private/);
});

test("UAT-21: watch --root --allow-local sees the change; --relock --external takes a loopback card with --allow-local and refuses it without", async () => {
  served.clear();
  served.set("/seller.network.json", partner("5%"));
  const { root, peer } = site();
  assert.match((await runAsync("watch", "--root", root, "--init", "--allow-local")).err, WARNING);
  served.set("/seller.network.json", partner("9%"));
  const watch = await runAsync("watch", "--root", root, "--allow-local", "--json");
  assert.equal(watch.code, 1);
  assert.match(watch.err, WARNING);
  const findings = (JSON.parse(watch.out) as { findings: { code: string; ref: string }[] }).findings;
  assert.ok(findings.some((f) => f.ref === peer && f.code === "peer-changed"), watch.out);

  const cardUrl = `${server.url}/.well-known/agent-card.json`;
  served.set("/.well-known/agent-card.json", card(["glaze"]));
  const refused = await runAsync("watch", "--root", root, "--relock", "--external", `a2a-card=${cardUrl}`);
  assert.equal(refused.code, 2);
  assert.match(refused.err, /--external takes an https address without credentials/);
  const relock = await runAsync("watch", "--root", root, "--relock", "--external", `a2a-card=${cardUrl}`, "--allow-local", "--json");
  assert.equal(relock.code, 0, relock.err);
  assert.equal(lockOf(root).external?.[cardUrl]?.signatures, 1);
  served.set("/.well-known/agent-card.json", card(["glaze", "quote"]));
  const after = JSON.parse((await runAsync("watch", "--root", root, "--allow-local", "--json")).out) as { findings: { code: string; ref: string; counts?: object }[] };
  assert.deepEqual(after.findings.find((f) => f.ref === cardUrl)?.counts, { skillsAdded: 1, skillsRemoved: 0, skillsChanged: 0, signatures: 1 });
  // a private address is never taken as a card, with or without the flag
  assert.ok("problem" in parseExternalArg("a2a-card=http://10.0.0.5/card.json", { allowLocal: true }));
  assert.ok(!("problem" in parseExternalArg("a2a-card=http://localhost:8080/card.json", { allowLocal: true })));
});

test("UAT-21: watch --url --allow-local still refuses a published lock's non-https peers", async () => {
  served.clear();
  served.set("/seller.network.json", partner("5%"));
  const { root, peer } = site();
  await runAsync("init", "--root", root, "--allow-local");
  // publish that lock (its peer is http on loopback) and read it back as a stranger's
  served.set("/pub/plumbline.lock.json", readFileSync(path.join(root, LOCK_FILE), "utf8"));
  const r = await runAsync("watch", "--url", `${server.url}/pub/`, "--allow-local", "--json");
  const findings = (JSON.parse(r.out) as { findings: { code: string; ref: string; summary: string }[] }).findings;
  const row = findings.find((f) => f.ref === peer);
  assert.equal(row?.code, "peer-refused");
  assert.match(row?.summary ?? "", /it is not an https address, an address Plumbline does not contact/);
});

test("UAT-21 (PRI-L1-11): the scan script takes --allow-local for a list of sites on this machine, with the warning and the report saying so", async () => {
  assert.deepEqual(parseList("http://127.0.0.1:4400/\n").problems, ["line 1 is not an https address without credentials"]);
  assert.deepEqual(parseList("http://127.0.0.1:4400/\n", { allowLocal: true }), { addresses: ["http://127.0.0.1:4400/"], problems: [] });
  served.clear();
  served.set("/agent-manifest.json", JSON.stringify({ brand: "x", networks: [{ name: "shop", front_man: "shop_front", hocon: "./shop.network.json" }] }));
  served.set("/shop.network.json", JSON.stringify({ tools: [{ name: "shop_front", instructions: "Sell.", tools: [] }] }));
  const list = path.join(tmp, "local.txt");
  writeFileSync(list, `${server.url}/\n`);
  const out = path.join(tmp, "scan-out");
  const r = await new Promise<{ code: number | null; err: string }>((resolve) => {
    const child = spawn(process.execPath, ["--import", NO_NETWORK, SCAN, list, "--out", out, "--adapters", "validator", "--allow-local"]);
    let err = "";
    child.stderr.setEncoding("utf8").on("data", (d: string) => (err += d));
    child.on("close", (code) => resolve({ code, err }));
  });
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /WARNING: --allow-local/);
  const report = JSON.parse(readFileSync(path.join(out, "report.json"), "utf8")) as { settings: { allowLocal?: boolean }; disclosure: string[]; sites: { gate: { state: string; findings: { adapter: string; state: string }[] } }[] };
  assert.equal(report.settings.allowLocal, true);
  assert.ok(report.disclosure.some((d) => d.startsWith("--allow-local: http and loopback addresses were allowed for this scan")));
  assert.deepEqual(report.sites[0]?.gate.findings.map((f) => [f.adapter, f.state]), [["validator", "pass"]]);
});

test("UAT-21 (MC-3): a rehearsal's printed commands keep --allow-local, so they run as printed", async () => {
  const { refusalCommands } = await import("../cli/watch-command.js");
  const { nextSteps } = await import("../cli/init-command.js");
  assert.deepEqual(refusalCommands([{ peer: "http://127.0.0.1:4502/b", to: "0123456789abcdef" }], "site", true, true), [
    "plumbline watch --root site --relock --accept-signer http://127.0.0.1:4502/b --allow-local",
  ]);
  assert.deepEqual(refusalCommands([{ peer: "https://b.example/b", to: "0123456789abcdef" }], "site", true), ["plumbline watch --root site --relock --accept-signer https://b.example/b"]);
  const steps = nextSteps("site", false, false, false, true).join("\n");
  assert.match(steps, /plumbline watch --root site --allow-local \(or add --workflow/);
  assert.match(steps, /plumbline watch --root site --relock --source <page> --allow-local\./);
  assert.ok(!nextSteps("site", false).join("\n").includes("--allow-local"));
});
