// The verifier's URL flow, wave 2 (2026-11-18): `trust --url` and `adopt --url` read the site through safeFetch,
// `verify --url` names adopt when the site publishes a rotation, fetches signed files under the runtime-file ceiling,
// fetches nothing for a signature listing too many files, and stops at one overall deadline. A loopback server in this
// process serves the site; the CLI runs with --allow-local and the no-network preload, so nothing reaches the internet.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { keygen, readTrust, run, runAsync, scratchDir, writeSite, writeTrust } from "./cli-helpers.js";
import { loopbackServer, type TestServer } from "./net-helpers.js";

let server: TestServer;
let root: string;
/** Each test serves its own folder under /<name>/. */
const sites = new Map<string, string>();
/** Answers to force for a path: a status, a body, or a delay before the file is served. */
const forced = new Map<string, { status?: number; body?: Buffer; delayMs?: number }>();
const requested: string[] = [];

before(async () => {
  root = scratchDir();
  server = await loopbackServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    requested.push(url.pathname);
    const answer = (): void => {
      const force = forced.get(url.pathname);
      if (force?.status !== undefined) {
        res.writeHead(force.status).end();
        return;
      }
      if (force?.body !== undefined) {
        res.writeHead(200, { "content-type": "application/octet-stream" }).end(force.body);
        return;
      }
      const [, name, ...rest] = url.pathname.split("/");
      const dir = sites.get(name ?? "");
      if (dir === undefined) {
        res.writeHead(404).end();
        return;
      }
      let bytes: Buffer;
      try {
        bytes = readFileSync(path.join(dir, ...rest));
      } catch {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" }).end(bytes);
    };
    const delay = forced.get(url.pathname)?.delayMs;
    if (delay !== undefined) setTimeout(answer, delay);
    else answer();
  });
});
after(async () => {
  await server.close();
});

/** A site served at /<name>/, signed for the server's origin by a fresh key, and a trust file that trusts that key there. */
function servedSite(name: string): { site: string; base: string; keys: ReturnType<typeof keygen>; trust: string; dir: string } {
  const dir = path.join(root, name);
  const site = path.join(dir, "site");
  writeSite(site);
  sites.set(name, site);
  const keys = keygen(path.join(dir, "keys"));
  const signed = run("sign", "--root", site, "--key", keys.privateFile, "--origin", server.url);
  assert.equal(signed.code, 0, signed.err);
  const trust = writeTrust(path.join(dir, "plumbline.trust.json"), [{ kid: keys.record.kid, origin: server.url, publicKey: keys.record.publicKey }]);
  return { site, base: `${server.url}/${name}/`, keys, trust, dir };
}

// ---- p-58cf7d and p-8dbe71: verify --url names adopt --url, and adopt follows the rotation by URL ----

test("verify --url points at adopt --url when the site publishes a rotation, and adopt --url adopts the successor through safeFetch", async () => {
  const { site, base, keys: a, trust, dir } = servedSite("rotated");
  const b = keygen(path.join(dir, "keys-b"));
  assert.equal(run("rotate", "--root", site, "--old-key", a.privateFile, "--new-key", b.privateFile).code, 0);
  assert.equal(run("sign", "--root", site, "--key", b.privateFile, "--origin", server.url).code, 0);

  const stranger = await runAsync("verify", "--url", base, "--trust", trust, "--allow-local");
  assert.equal(stranger.code, 1);
  assert.match(stranger.out, /^unverifiable/m);
  assert.match(stranger.out, new RegExp(`^hint: plumbline-rotation\\.json is present; .*plumbline adopt --url ${base.replace(/[.]/g, "\\.")} --trust .* --allow-local`, "m"));

  requested.length = 0;
  const dry = await runAsync("adopt", "--url", base, "--trust", trust, "--allow-local");
  assert.equal(dry.code, 1, dry.out + dry.err);
  assert.match(dry.out, new RegExp(`rotation ${a.record.kid} -> ${b.record.kid} for ${server.url.replace(/[.]/g, "\\.")}`));
  assert.ok(requested.includes("/rotated/plumbline-rotation.json") && requested.includes("/rotated/plumbline-revocation.json"));
  assert.equal(readTrust(trust).entries.length, 1);

  const yes = await runAsync("adopt", "--url", base, "--trust", trust, "--allow-local", "--yes");
  assert.equal(yes.code, 0, yes.out + yes.err);
  assert.deepEqual(readTrust(trust).entries[1], { kid: b.record.kid, origin: server.url, publicKey: b.record.publicKey, adoptedVia: a.record.kid });
  const verified = await runAsync("verify", "--url", base, "--trust", trust, "--allow-local");
  assert.equal(verified.code, 0, verified.out);
});

test("adopt --url: a revocation the site does not serve cleanly refuses the adoption; usage rules match verify's", async () => {
  const { site, base, keys: a, trust, dir } = servedSite("adopt-refusals");
  const b = keygen(path.join(dir, "keys-b"));
  assert.equal(run("rotate", "--root", site, "--old-key", a.privateFile, "--new-key", b.privateFile).code, 0);
  forced.set("/adopt-refusals/plumbline-revocation.json", { status: 503 });
  try {
    const r = await runAsync("adopt", "--url", base, "--trust", trust, "--allow-local", "--yes");
    assert.equal(r.code, 2);
    assert.match(r.err, /cannot fetch plumbline-revocation\.json .*nothing is adopted/);
    assert.equal(readTrust(trust).entries.length, 1);
  } finally {
    forced.delete("/adopt-refusals/plumbline-revocation.json");
  }
  rmSync(path.join(site, "plumbline-rotation.json"));
  const missing = await runAsync("adopt", "--url", base, "--trust", trust, "--allow-local");
  assert.equal(missing.code, 2);
  assert.match(missing.err, /plumbline-rotation\.json not found/);

  for (const args of [
    ["--url", base, "--origin", server.url, "--allow-local"],
    ["--url", base, "--root", site, "--allow-local"],
    ["--root", site, "--origin", server.url, "--allow-local"],
    ["--url", base],
  ]) {
    const usage = await runAsync("adopt", "--trust", trust, ...args);
    assert.equal(usage.code, 2, args.join(" "));
    assert.match(usage.err, /usage: plumbline adopt/, args.join(" "));
  }
});

// ---- p-426ec9: trust reads the key record from the site ----

test("trust --url fetches the site's key record, binds the URL's origin, keeps the dry run, and verify then answers verified", async () => {
  const { site, base, keys, dir } = servedSite("first-contact");
  const record = path.join(site, ".well-known", "plumbline-key.json");
  const file = path.join(dir, "fresh.trust.json");
  const absent = await runAsync("trust", "--url", base, "--file", file, "--allow-local");
  assert.equal(absent.code, 2);
  assert.match(absent.err, /\.well-known\/plumbline-key\.json not found/);

  // publish the record the way keygen wrote it
  mkdirSync(path.dirname(record), { recursive: true });
  writeFileSync(record, readFileSync(keys.recordFile));
  const dry = await runAsync("trust", "--url", base, "--file", file, "--allow-local");
  assert.equal(dry.code, 1, dry.out + dry.err);
  assert.match(dry.out, new RegExp(`^kid ${keys.record.kid} for ${server.url.replace(/[.]/g, "\\.")}$`, "m"));
  assert.match(dry.out, /out of band/);
  assert.match(dry.out, /rerun with --yes/);

  const yes = await runAsync("trust", "--url", base, "--file", file, "--allow-local", "--yes");
  assert.equal(yes.code, 0, yes.err);
  assert.deepEqual(readTrust(file).entries, [{ kid: keys.record.kid, origin: server.url, publicKey: keys.record.publicKey }]);
  assert.equal((await runAsync("verify", "--url", base, "--trust", file, "--allow-local")).code, 0);

  // a record that lies about its kid is refused by URL as it is from a file; --origin beside --url is a usage error
  writeFileSync(record, JSON.stringify({ ...keys.record, kid: "0123456789abcdef" }));
  const lying = await runAsync("trust", "--url", base, "--file", path.join(dir, "other.trust.json"), "--allow-local", "--yes");
  assert.equal(lying.code, 2);
  assert.match(lying.err, /not derived/);
  const both = await runAsync("trust", "--url", base, "--origin", server.url, "--file", file, "--allow-local");
  assert.equal(both.code, 2);
  assert.match(both.err, /usage: plumbline trust/);
});

// ---- p-66b089: signed files are fetched under the runtime-file ceiling, and one over it is named ----

test("verify --url names a signed file over the size ceiling, never as not served or tampered", async () => {
  const { base, trust } = servedSite("oversize");
  // over every ceiling safeFetch has (4 MiB for a runtime file, 512 KiB otherwise)
  forced.set("/oversize/networks/helper.hocon", { body: Buffer.alloc(4 * 1024 * 1024 + 1, 0x20) });
  try {
    const r = await runAsync("verify", "--url", base, "--trust", trust, "--allow-local");
    assert.equal(r.code, 1);
    assert.match(r.out, /^unverifiable .*1 signed file is over the size ceiling for one fetched file/m);
    assert.doesNotMatch(r.out, /did not serve/);
  } finally {
    forced.delete("/oversize/networks/helper.hocon");
  }
});

test(
  "verify --url verifies a signed network of 1 MB, over the 512 KiB network ceiling but under the 4 MiB runtime-file one",
  async () => {
    const { site, base, keys, trust } = servedSite("large");
    writeFileSync(path.join(site, "networks", "helper.hocon"), JSON.stringify({ agents: [{ name: "helper", note: "x".repeat(1024 * 1024) }] }));
    assert.equal(run("sign", "--root", site, "--key", keys.privateFile, "--origin", server.url).code, 0);
    const r = await runAsync("verify", "--url", base, "--trust", trust, "--allow-local");
    assert.equal(r.code, 0, r.out);
  },
);

// ---- p-11613d: a bounded number of files, and one overall deadline ----

test("verify --url fetches none of the files a signature lists when it lists more than MAX_SUBJECTS: invalid malformed, at once", async () => {
  const { site, base, trust } = servedSite("many");
  const signatureFile = path.join(site, "plumbline.signature.json");
  const signature = JSON.parse(readFileSync(signatureFile, "utf8"));
  signature.subjects = Array.from({ length: 3000 }, (_, i) => ({ path: `slow/${i}.json`, sha256: "0".repeat(64) }));
  writeFileSync(signatureFile, JSON.stringify(signature));
  requested.length = 0;
  const started = Date.now();
  const r = await runAsync("verify", "--url", base, "--trust", trust, "--allow-local", "--json");
  assert.equal(r.code, 1);
  const result = JSON.parse(r.out).results[0];
  assert.deepEqual([result.verdict, result.reason], ["invalid", "malformed"]);
  assert.match(result.detail, /more than 256 files/);
  assert.ok(!requested.some((p) => p.startsWith("/many/slow/")), "no listed file was fetched");
  assert.ok(Date.now() - started < 10_000, "it answers at once");
});

test("verify --url stops at its overall deadline (--timeout) and says unverifiable, naming what was not served", async () => {
  const { base, trust } = servedSite("slow");
  forced.set("/slow/networks/helper.hocon", { delayMs: 3000 });
  try {
    const started = Date.now();
    const r = await runAsync("verify", "--url", base, "--trust", trust, "--allow-local", "--timeout", "1");
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.out, /^unverifiable .*did not serve/m);
    assert.ok(Date.now() - started < 2900, "the run ended before the slow file would have arrived");
  } finally {
    forced.delete("/slow/networks/helper.hocon");
  }
  const bad = await runAsync("verify", "--url", base, "--trust", trust, "--allow-local", "--timeout", "0");
  assert.equal(bad.code, 2);
  assert.match(bad.err, /--timeout must be/);
});

// ---- p-9f62b8: verify's flag conflicts and an unserved signed file ----

test("verify: --url with --origin, and --root with --allow-local or --timeout, are usage errors; an unserved signed file is unverifiable", async () => {
  const { site, base, trust } = servedSite("flags");
  const withOrigin = await runAsync("verify", "--url", base, "--origin", server.url, "--trust", trust, "--allow-local");
  assert.equal(withOrigin.code, 2);
  assert.match(withOrigin.err, /leave out --origin/);
  assert.match(withOrigin.err, /usage: plumbline verify/);
  const local = await runAsync("verify", "--root", site, "--trust", trust, "--allow-local");
  assert.equal(local.code, 2);
  assert.match(local.err, /--allow-local goes with --url/);
  const timeout = await runAsync("verify", "--root", site, "--trust", trust, "--timeout", "5");
  assert.equal(timeout.code, 2);
  assert.match(timeout.err, /--timeout goes with --url/);

  forced.set("/flags/networks/helper.hocon", { status: 500 });
  try {
    const r = await runAsync("verify", "--url", base, "--trust", trust, "--allow-local");
    assert.equal(r.code, 1);
    assert.match(r.out, /^unverifiable .*The site did not serve 1 signed file \(an error, not a 404\)/m);
  } finally {
    forced.delete("/flags/networks/helper.hocon");
  }
});

// ---- one verdict rule for the CLI and the Desk: a READ file with the wrong digest is tampered, whatever else is unread ----

test("verify --url keeps invalid tampered when a file it did read was edited, even though another signed file was not served", async () => {
  const { site, base, trust } = servedSite("read-mismatch");
  writeFileSync(path.join(site, "links.json"), JSON.stringify({ links: [{ href: "https://evil.example/" }] }));
  forced.set("/read-mismatch/networks/helper.hocon", { status: 500 });
  try {
    const r = await runAsync("verify", "--url", base, "--trust", trust, "--allow-local");
    assert.equal(r.code, 1);
    assert.match(r.out, /^invalid tampered/m, r.out);
  } finally {
    forced.delete("/read-mismatch/networks/helper.hocon");
  }
});
