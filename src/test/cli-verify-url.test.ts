// `plumbline verify --url`: the site is fetched through safeFetch as exact bytes, and the URL's origin is the origin the
// files are checked as. The site is served by a loopback server in this process; the CLI runs with --allow-local and
// the no-network preload, so nothing here reaches the internet.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { keygen, readTrust, run, runAsync, scratchDir, writeSite, writeTrust } from "./cli-helpers.js";
import { loopbackServer, type TestServer } from "./net-helpers.js";

let server: TestServer;
let site: string;
let root: string;
/** Paths this server was asked for, and answers to force for a path (an HTTP status instead of the file). */
const requested: string[] = [];
const forced = new Map<string, number>();

before(async () => {
  root = scratchDir();
  site = path.join(root, "site");
  writeSite(site);
  server = await loopbackServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    requested.push(url.pathname);
    const status = forced.get(url.pathname);
    if (status !== undefined) {
      res.writeHead(status).end();
      return;
    }
    if (!url.pathname.startsWith("/sub/")) {
      res.writeHead(404).end();
      return;
    }
    try {
      const bytes = readFileSync(path.join(site, ...url.pathname.slice("/sub/".length).split("/")));
      res.writeHead(200, { "content-type": "application/json" }).end(bytes);
    } catch {
      res.writeHead(404).end();
    }
  });
});
after(async () => {
  await server.close();
});

/** Signs the served site for `origin` with a fresh key and returns a trust file that trusts that key there. */
function signFor(origin: string, name: string): { trust: string; keys: ReturnType<typeof keygen> } {
  const keys = keygen(path.join(root, `keys-${name}`));
  const signed = run("sign", "--root", site, "--key", keys.privateFile, "--origin", origin);
  assert.equal(signed.code, 0, signed.err);
  const trust = writeTrust(path.join(root, `${name}.trust.json`), [{ kid: keys.record.kid, origin, publicKey: keys.record.publicKey }]);
  return { trust, keys };
}

test("verify --url fetches the site and verifies it, bound to the URL's origin", async () => {
  const { trust } = signFor(server.url, "plain");
  requested.length = 0;
  const r = await runAsync("verify", "--url", `${server.url}/sub`, "--trust", trust, "--allow-local");
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /^verified/m);
  assert.ok(requested.includes("/sub/plumbline.signature.json"));
  assert.ok(requested.includes("/sub/networks/helper.hocon"));
  assert.ok(requested.includes("/sub/plumbline-revocation.json"), "the revocation is looked for");
  assert.ok(requested.every((p) => p.startsWith("/sub/")), "nothing outside the site base is fetched");

  // one byte changed on the server: tampered
  const hocon = path.join(site, "networks", "helper.hocon");
  const original = readFileSync(hocon);
  writeFileSync(hocon, Buffer.concat([original, Buffer.from(" ")]));
  try {
    const tampered = await runAsync("verify", "--url", `${server.url}/sub/`, "--trust", trust, "--allow-local", "--json");
    assert.equal(tampered.code, 1);
    const result = JSON.parse(tampered.out).results[0];
    assert.deepEqual([result.verdict, result.reason], ["invalid", "tampered"]);
  } finally {
    writeFileSync(hocon, original);
  }
});

test("verify --url: files signed for another origin are unverifiable where they are served", async () => {
  const { trust } = signFor("https://site.example", "elsewhere");
  const r = await runAsync("verify", "--url", `${server.url}/sub/`, "--trust", trust, "--allow-local");
  assert.equal(r.code, 1);
  assert.match(r.out, /^unverifiable/m);
  assert.match(r.out, /The signature names https:\/\/site\.example, but these files were checked as http:\/\/127\.0\.0\.1:\d+: a copy signed for another address is not attested here/);
});

test("verify --url applies a served revocation and records it in the trust file", async () => {
  const { trust, keys } = signFor(server.url, "revoked");
  assert.equal(run("revoke", "--root", site, "--key", keys.privateFile).code, 0);
  try {
    const r = await runAsync("verify", "--url", `${server.url}/sub/`, "--trust", trust, "--allow-local");
    assert.equal(r.code, 1);
    assert.match(r.out, /^revocation applied/m);
    assert.match(r.out, /^revocation recorded in /m);
    assert.match(r.out, /^invalid revoked/m);
    assert.ok(readTrust(trust).entries.every((e) => e.revokedAt !== undefined));
  } finally {
    rmSync(path.join(site, "plumbline-revocation.json"));
  }
});

test("verify --url never claims verified when links.json or the revocation cannot be read (an HTTP error, not a 404)", async () => {
  const { trust } = signFor(server.url, "unknown");
  for (const file of ["links.json", "plumbline-revocation.json"]) {
    forced.set(`/sub/${file}`, 503);
    try {
      const r = await runAsync("verify", "--url", `${server.url}/sub/`, "--trust", trust, "--allow-local");
      assert.equal(r.code, 1, file);
      assert.match(r.out, /^unverifiable/m, file);
      assert.match(r.out, new RegExp(file.replace(".", "\\.")), file);
    } finally {
      forced.delete(`/sub/${file}`);
    }
  }
});

test("verify --url: no signature is unverifiable, exit 1; http without --allow-local, and --url with --root, are usage errors", async () => {
  const trust = writeTrust(path.join(root, "none.trust.json"), []);
  forced.set("/sub/plumbline.signature.json", 404);
  try {
    const missing = await runAsync("verify", "--url", `${server.url}/sub/`, "--trust", trust, "--allow-local");
    assert.equal(missing.code, 1);
    assert.match(missing.out, /^unverifiable - This site publishes no plumbline\.signature\.json \(http:\/\/127\.0\.0\.1:\d+\/sub\/\), so nothing can be verified\.$/m);
  } finally {
    forced.delete("/sub/plumbline.signature.json");
  }
  const http = await runAsync("verify", "--url", `${server.url}/sub/`, "--trust", trust);
  assert.equal(http.code, 2);
  assert.match(http.err, /--url must be an https/);
  assert.match(http.err, /usage: plumbline verify/);
  const both = await runAsync("verify", "--url", "https://site.example/", "--root", site, "--trust", trust);
  assert.equal(both.code, 2);
  assert.match(both.err, /usage: plumbline verify/);
  // a public https address cannot be reached in tests (no network): an I/O error, exit 2, never a verdict
  const offline = await runAsync("verify", "--url", "https://site.example/", "--trust", trust);
  assert.equal(offline.code, 2);
  assert.match(offline.err, /cannot fetch/);
});

test("UAT-7: trust --url refuses a key the same site publishes a revocation of, --yes or not; the Desk does not offer it either", async () => {
  const keys = keygen(path.join(root, "keys-revoked-offer"));
  // the site publishes A's key record and A's revocation (between revoke and re-sign)
  mkdirSync(path.join(site, ".well-known"), { recursive: true });
  writeFileSync(path.join(site, ".well-known", "plumbline-key.json"), readFileSync(keys.recordFile));
  const scratch = scratchDir();
  writeSite(scratch);
  assert.equal(run("revoke", "--root", scratch, "--key", keys.privateFile).code, 0);
  writeFileSync(path.join(site, "plumbline-revocation.json"), readFileSync(path.join(scratch, "plumbline-revocation.json")));
  const file = path.join(root, "fresh.trust.json");
  try {
    const r = await runAsync("trust", "--url", `${server.url}/sub/`, "--file", file, "--allow-local", "--yes", "--json");
    assert.equal(r.code, 1, r.out + r.err);
    const out = JSON.parse(r.out);
    assert.deepEqual([out.added, out.refusedBy], [false, "revocation"]);
    assert.throws(() => readFileSync(file), "nothing written");
  } finally {
    rmSync(path.join(site, "plumbline-revocation.json"), { force: true });
  }
});
