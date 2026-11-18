// UAT-18 (DEV-L1-03, DEV-L1-10): the old partner definition, so the change can be seen. init and every relock keep a copy
// of what the lock pins of each peer beside it (.plumbline/peers/<sha256>.json); `plumbline diff --root <site> --peer
// <url>` shows the change by name from that copy and the peer now; a links.json that appears or changes is counted by
// the outbound hosts it adds, in counts only. The peer is a loopback test server; every spawned CLI runs with the
// no-network preload.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { LOCK_FILE, type PlumblineLock } from "../core/types.js";
import { hashBytes } from "../net/canonical.js";
import { keepCopies, keptRef, readKept } from "../watch/kept.js";
import { runInit, runRelock, runWatch } from "../watch/index.js";
import { runAsync } from "./cli-helpers.js";
import { loopbackServer, type TestServer } from "./net-helpers.js";
import { NOW } from "./watch-helpers.js";

let tmp: string;
let server: TestServer;
/** What the partner serves, by path. */
const served = new Map<string, string>();
const handler: http.RequestListener = (req, res) => {
  const body = served.get(new URL(req.url ?? "/", "http://x").pathname);
  if (body === undefined) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": "application/json" }).end(body);
};

before(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), "plumbline-uat18-"));
  server = await loopbackServer(handler);
});
after(async () => {
  await server.close();
  rmSync(tmp, { recursive: true, force: true });
});

const LOCAL = { fetchOptions: { allowLocal: true }, now: () => NOW };

function partner(extra: object[] = [], fee = "0.5%"): string {
  return JSON.stringify(
    {
      tools: [
        { name: "fx_front", instructions: `Convert currencies. Our fee is ${fee}.`, tools: ["rate_lookup", ...extra.map((a) => (a as { name: string }).name)] },
        { name: "rate_lookup", instructions: "Look up a rate.", tools: ["https://mcp.coinbridge.example/mcp"] },
        ...extra,
      ],
    },
    null,
    2,
  );
}

/** A site whose one network names the partner by its loopback address. */
function site(): { root: string; peer: string } {
  const root = mkdtempSync(path.join(tmp, "site-"));
  const peer = `${server.url}/coinbridge_fx`;
  writeFileSync(
    path.join(root, "trips.network.json"),
    JSON.stringify({ tools: [{ name: "trips_front", instructions: "Plan trips.", tools: [peer] }] }, null, 2),
  );
  return { root, peer };
}

test("UAT-18: init keeps a copy of each pinned definition beside the lock, named by its hash, and never in the lock", async () => {
  served.clear();
  served.set("/coinbridge_fx.network.json", partner());
  const { root, peer } = site();
  const report = await runInit({ root }, LOCAL);
  const lock = JSON.parse(readFileSync(path.join(root, LOCK_FILE), "utf8")) as PlumblineLock;
  const pin = lock.peers[peer]?.sha256 as string;
  assert.deepEqual(report?.kept, [keptRef(pin)]);
  assert.equal(readFileSync(path.join(root, ".plumbline", "peers", `${pin}.json`), "utf8"), partner());
  assert.ok(!readFileSync(path.join(root, LOCK_FILE), "utf8").includes("fx_front"), "the lock holds hashes only");
  const back = await readKept(root, pin);
  assert.ok("bytes" in back && (await hashBytes(back.bytes)) === pin);
  // a checkout that converted the copy to CRLF is read back as the lock pinned it, and says so
  writeFileSync(path.join(root, ".plumbline", "peers", `${pin}.json`), partner().replace(/\n/g, "\r\n"));
  const crlf = await readKept(root, pin);
  assert.ok("bytes" in crlf && crlf.lineEndings === "crlf" && (await hashBytes(crlf.bytes)) === pin);
  // an edited copy is refused, never used
  writeFileSync(path.join(root, ".plumbline", "peers", `${pin}.json`), "{}");
  assert.deepEqual(await readKept(root, pin), { problem: "its bytes do not hash to the pin (it was edited)" });
  // keepCopies writes only what the lock pins, and never over a file that is there
  assert.deepEqual(await keepCopies(root, lock, new Map([[pin, new TextEncoder().encode(partner())]])), []);
});

test("UAT-18 (DEV-L1-03): diff --peer shows the partner's change by name, the changed agent's fields old and new, and the new host", async () => {
  served.clear();
  served.set("/coinbridge_fx.network.json", partner());
  const { root, peer } = site();
  await runInit({ root }, LOCAL);
  // partner-adds-agent, and the fee changes: one agent added, one changed, one new host
  served.set("/coinbridge_fx.network.json", partner([{ name: "fee_estimator", instructions: "Estimate the fee.", tools: ["https://mcp.ledgerline.example/mcp"] }], "0.9%"));
  const text = await runAsync("diff", "--root", root, "--peer", peer, "--allow-local");
  assert.equal(text.code, 1, text.err);
  assert.match(text.err, /--allow-local/);
  assert.match(text.out, /^In outline: agents: 1 added, 0 removed, 1 changed; outbound hosts: 1 added, 0 removed; front agent: unchanged\.$/m);
  assert.match(text.out, /^agents added: fee_estimator$/m);
  assert.match(text.out, /^agent changed: fx_front$/m);
  assert.match(text.out, /^ {2}instructions: "Convert currencies\. Our fee is 0\.5%\." -> "Convert currencies\. Our fee is 0\.9%\."$/m);
  assert.match(text.out, /^outbound hosts added: mcp\.ledgerline\.example$/m);
  assert.match(text.out, /^links\.json: as the lock pinned it$/m);
  const json = JSON.parse((await runAsync("diff", "--root", root, "--peer", peer, "--allow-local", "--json")).out);
  assert.deepEqual(json.agentsAdded, ["fee_estimator"]);
  assert.deepEqual(json.changes[0].agent, "fx_front");
  assert.ok(json.changes[0].fields.some((f: { key: string }) => f.key === "tools"), "fx_front now calls fee_estimator");
  assert.deepEqual(json.hostsAdded, ["mcp.ledgerline.example"]);

  // partner-adds-links: its links.json routes a link to a host the definition never names; counted at the watch, named here
  served.set("/links.json", JSON.stringify({ version: 1, networks: { coinbridge_fx: { settlement_partner: "https://agents.ledgerline.example/ledger_settlement" } } }));
  const watch = await runWatch({ root }, LOCAL);
  const links = watch.findings.find((f) => f.ref === peer && f.code === "peer-links-appeared");
  assert.ok(links, JSON.stringify(watch.findings));
  assert.deepEqual(links.counts, { hostsAdded: 1 });
  assert.match(links.summary, /It names 1 outbound host the lock did not see for this peer/);
  assert.ok(!links.summary.includes("ledgerline"), "counts, never a host, in a finding");
  const withLinks = await runAsync("diff", "--root", root, "--peer", peer, "--allow-local");
  assert.match(withLinks.out, /^links\.json: the peer now publishes one; the lock recorded none$/m);
  assert.match(withLinks.out, /^links\.json outbound hosts added: agents\.ledgerline\.example$/m);

  // after a relock the new definition and links.json are kept too, and the peer reads as pinned (exit 0)
  const relock = await runRelock({ root }, LOCAL);
  assert.equal(relock.kept.length, 2, JSON.stringify(relock.kept));
  const same = await runAsync("diff", "--root", root, "--peer", peer, "--allow-local");
  assert.equal(same.code, 0, same.out + same.err);
  assert.match(same.out, /^The definition is the one the lock pinned\.$/m);

  // a changed links.json is counted against the kept copy of the locked one
  served.set("/links.json", JSON.stringify({ version: 1, networks: { coinbridge_fx: { settlement_partner: "https://agents.ledgerline.example/x", audit: "https://audit.example/y" } } }));
  const again = (await runWatch({ root }, LOCAL)).findings.find((f) => f.ref === peer && f.code === "peer-links-changed");
  assert.deepEqual(again?.counts, { hostsAdded: 1 });
});

test("UAT-18: diff --peer says what is missing instead of guessing: no kept copy, a pending peer, a peer the lock does not pin", async () => {
  served.clear();
  served.set("/coinbridge_fx.network.json", partner());
  const { root, peer } = site();
  await runInit({ root }, LOCAL);
  rmSync(path.join(root, ".plumbline"), { recursive: true, force: true });
  const none = await runAsync("diff", "--root", root, "--peer", peer, "--allow-local");
  assert.equal(none.code, 2);
  assert.match(none.err, /there is no kept copy of the definition the lock pinned for this peer \(\.plumbline\/peers\/[0-9a-f]{64}\.json\).*re-lock \(plumbline watch --root .* --relock\) to keep one/);
  const other = await runAsync("diff", "--root", root, "--peer", `${server.url}/nobody`, "--allow-local");
  assert.equal(other.code, 2);
  assert.match(other.err, /the lock pins no peer at that address/);
  const usage = await runAsync("diff", "--root", root);
  assert.equal(usage.code, 2);
  assert.match(usage.err, /--root, --timeout and --allow-local go with --peer/);
  assert.ok(!existsSync(path.join(root, ".plumbline")), "diff writes nothing");
});
