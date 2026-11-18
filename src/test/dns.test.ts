// D4: first contact with a second channel. The `_plumbline.<host>` TXT record (src/net/dns-txt.ts), the bounded lookup
// with an injected resolver (src/net/dns.ts), trust's decision, and the CLI: `plumbline dns` and `trust --url` under
// the no-network preload (which refuses every TXT query). No resolver is ever asked for real.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { askDns, type TxtResolver } from "../net/dns.js";
import { describeDns, dnsNameFor, dnsVerdict, parseTxt, txtRecordFor } from "../net/dns-txt.js";
import { DNS_DISAGREES, trustDecision } from "../cli/trust-command.js";
import { loopbackServer } from "./net-helpers.js";

const CLI = fileURLToPath(new URL("../cli/index.js", import.meta.url));
const NO_NETWORK = new URL("./no-network.js", import.meta.url).href;
const KID = "0123456789abcdef";
const OTHER = "fedcba9876543210";

let tmp: string;
before(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "plumbline-dns-"));
});
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const answering = (records: string[][]): { resolver: TxtResolver; asked: string[] } => {
  const asked: string[] = [];
  return { asked, resolver: async (name) => (asked.push(name), records) };
};
const failing = (code: string): TxtResolver => async () => {
  throw Object.assign(new Error(code), { code });
};

test("the record: v=plumbline1; kid=<16 hex>, under _plumbline.<host>; parseTxt reads only that form", () => {
  assert.equal(txtRecordFor(KID), `v=plumbline1; kid=${KID}`);
  assert.throws(() => txtRecordFor("ABC"));
  assert.equal(dnsNameFor("Site.Example."), "_plumbline.site.example");
  const parsed = parseTxt([
    [`v=plumbline1; kid=${KID}`],
    ["v=plumbline1;", `kid=${OTHER};`], // chunks are joined, a trailing ; is allowed
    [`v=plumbline1;kid=${KID}`], // the same kid twice counts once
    ["v=spf1 -all"], // someone else's record
    ["v=plumbline1; kid=NOT-A-KID"],
    [`v=plumbline1; kid=${KID}; extra=1`],
  ]);
  assert.deepEqual(parsed, { kids: [KID, OTHER], malformed: 2 });
});

test("askDns with an injected resolver: agrees, disagrees, several records, none, malformed only, errors and a timeout", async () => {
  const agree = answering([[`v=plumbline1; kid=${KID}`]]);
  assert.deepEqual(await askDns("site.example", KID, agree.resolver), { name: "_plumbline.site.example", state: "agrees", kids: [KID] });
  assert.deepEqual(agree.asked, ["_plumbline.site.example"]);
  assert.equal((await askDns("site.example", KID, answering([[`v=plumbline1; kid=${OTHER}`]]).resolver)).state, "disagrees");
  // a rotation in progress: both keys published, either one agrees
  const both = await askDns("site.example", KID, answering([[`v=plumbline1; kid=${OTHER}`], [`v=plumbline1; kid=${KID}`]]).resolver);
  assert.deepEqual([both.state, both.kids], ["agrees", [OTHER, KID]]);
  assert.match(describeDns(both), /agrees \(it names this kid among 2\)/);
  for (const code of ["ENOTFOUND", "ENODATA"]) assert.deepEqual(await askDns("site.example", KID, failing(code)), { name: "_plumbline.site.example", state: "no record" });
  assert.equal((await askDns("site.example", KID, answering([["v=spf1 -all"]]).resolver)).state, "no record");
  const malformed = await askDns("site.example", KID, answering([["v=plumbline1; kid=xyz"]]).resolver);
  assert.deepEqual(malformed, { name: "_plumbline.site.example", state: "no record", malformed: 1 });
  assert.match(describeDns(malformed), /no record; 1 record there is not in the v=plumbline1; kid=<16 hex> form/);
  for (const [code, why] of [["ESERVFAIL", "the lookup failed"], ["ECONNREFUSED", "the resolver refused the query"], ["ETIMEOUT", "the lookup timed out"]]) {
    const r = await askDns("site.example", KID, failing(code as string));
    assert.deepEqual([r.state, r.why], ["could not ask", why]);
  }
  const hung = await askDns("site.example", KID, () => new Promise(() => undefined), 50);
  assert.deepEqual([hung.state, hung.why], ["could not ask", "the lookup timed out"]);
});

test("askDns never asks for an IP literal or a name that is not public", async () => {
  const spy = answering([[`v=plumbline1; kid=${KID}`]]);
  for (const host of ["127.0.0.1", "[::1]", "localhost", "intranet", "app.localhost"]) {
    assert.equal((await askDns(host, KID, spy.resolver)).state, "could not ask", host);
  }
  assert.deepEqual(spy.asked, []);
});

test("describeDns names only kids in their pattern: a stranger's TXT text never reaches the line", () => {
  const check = dnsVerdict("_plumbline.site.example", KID, parseTxt([["v=plumbline1; kid=<script>"], [`v=plumbline1; kid=${OTHER}`]]));
  const line = describeDns(check);
  assert.equal(line, `dns _plumbline.site.example: disagrees (it names ${OTHER}, not this kid); 1 record there is not in the v=plumbline1; kid=<16 hex> form`);
  assert.ok(!line.includes("script"));
});

test("trustDecision: DNS adds no trust; a disagreement refuses --yes; --require-dns refuses --yes unless DNS agrees", () => {
  const name = "_plumbline.site.example";
  const agrees = { name, state: "agrees" as const, kids: [KID] };
  const disagrees = { name, state: "disagrees" as const, kids: [OTHER] };
  const none = { name, state: "no record" as const };
  const unasked = { name, state: "could not ask" as const, why: "the lookup failed" };
  assert.deepEqual(trustDecision({ already: true, yes: false, requireDns: true, dns: disagrees }), { action: "already" });
  // without --yes nothing is added, whatever DNS says: agreement is not consent
  assert.equal(trustDecision({ already: false, yes: false, requireDns: false, dns: agrees }).action, "refuse");
  assert.deepEqual(trustDecision({ already: false, yes: true, requireDns: false, dns: disagrees }), { action: "refuse", line: DNS_DISAGREES, refusedBy: "dns" });
  assert.equal(trustDecision({ already: false, yes: true, requireDns: false, dns: none }).action, "add");
  assert.equal(trustDecision({ already: false, yes: true, requireDns: false, dns: unasked }).action, "add");
  assert.equal(trustDecision({ already: false, yes: true, requireDns: false }).action, "add", "trust --key asks no DNS");
  for (const dns of [none, unasked, disagrees]) {
    const d = trustDecision({ already: false, yes: true, requireDns: true, dns });
    assert.equal(d.action, "refuse", dns.state);
    assert.equal(d.refusedBy, "dns");
  }
  assert.equal(trustDecision({ already: false, yes: true, requireDns: true, dns: agrees }).action, "add");
});

function keygen(): { record: string; kid: string } {
  const dir = mkdtempSync(path.join(tmp, "keys-"));
  const r = spawnSync(process.execPath, [CLI, "keygen", "--out", dir, "--json"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const record = path.join(dir, ".well-known", "plumbline-key.json");
  return { record, kid: (JSON.parse(readFileSync(record, "utf8")) as { kid: string }).kid };
}

test("plumbline dns prints the record to publish for a key record, and refuses one whose kid is not derived", () => {
  const { record, kid } = keygen();
  const r = spawnSync(process.execPath, [CLI, "dns", "--key", record, "--origin", "https://site.example"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`^_plumbline\\.site\\.example TXT "v=plumbline1; kid=${kid}"$`, "m"));
  assert.match(r.stdout, /second channel, not proof/);
  const json = JSON.parse(spawnSync(process.execPath, [CLI, "dns", "--key", record, "--json"], { encoding: "utf8" }).stdout) as { name: string; value: string };
  assert.deepEqual(json, { name: "_plumbline.<your host>", type: "TXT", value: `v=plumbline1; kid=${kid}`, kid });
  const bad = spawnSync(process.execPath, [CLI, "dns", "--key", record, "--origin", "https://site.example/"], { encoding: "utf8" });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /usage: plumbline dns/);
});

function run(...args: string[]): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", NO_NETWORK, CLI, ...args]);
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => (out += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

test("trust --url says what DNS says; --require-dns refuses --yes when DNS cannot agree; --require-dns needs --url", async () => {
  const { record, kid } = keygen();
  const text = readFileSync(record);
  const server = await loopbackServer((req, res) => {
    if (req.url === "/.well-known/plumbline-key.json") res.end(text);
    else res.writeHead(404).end("no");
  });
  try {
    const base = `${server.url}/`;
    const file = path.join(tmp, "dns.trust.json");
    const dry = await run("trust", "--url", base, "--file", file, "--allow-local", "--json");
    assert.equal(dry.code, 1, dry.err);
    const parsed = JSON.parse(dry.out) as { kid: string; dns: { state: string; why: string } };
    assert.equal(parsed.kid, kid);
    assert.deepEqual([parsed.dns.state, parsed.dns.why], ["could not ask", "the address is an IP literal, which has no DNS name"]);
    const required = await run("trust", "--url", base, "--file", file, "--allow-local", "--require-dns", "--yes");
    assert.equal(required.code, 1, required.out + required.err);
    assert.match(required.out, /^dns 127\.0\.0\.1: could not ask/m);
    assert.match(required.out, /nothing added: --require-dns needs DNS to agree/);
    assert.ok(!existsSync(file), "nothing written");
    const yes = await run("trust", "--url", base, "--file", file, "--allow-local", "--yes");
    assert.equal(yes.code, 0, yes.out + yes.err);
    mkdirSync(path.join(tmp, "x"), { recursive: true });
    const keyOnly = await run("trust", "--key", record, "--origin", "https://site.example", "--file", path.join(tmp, "x", "t.json"), "--require-dns");
    assert.equal(keyOnly.code, 2);
    assert.match(keyOnly.err, /--require-dns goes with --url/);
  } finally {
    await server.close();
  }
});
