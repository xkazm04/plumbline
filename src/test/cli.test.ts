// The signing CLI end to end, in a temp dir under the OS temp folder. No network, no key ever written into the repo.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { verifyRotation, type PlumblineKey, type PlumblineRotation, type TrustEntry } from "../core/index.js";

// dist/test/cli.test.js -> dist/cli/index.js
const CLI = fileURLToPath(new URL("../cli/index.js", import.meta.url));
const ORIGIN = "https://site.example";

let tmp: string;
before(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "plumbline-cli-"));
});
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function run(...args: string[]): { code: number | null; out: string; err: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function writeSite(dir: string): void {
  mkdirSync(path.join(dir, "networks"), { recursive: true });
  writeFileSync(
    path.join(dir, "agent-manifest.json"),
    JSON.stringify({ name: "Fixture", networks: [{ hocon: "networks/helper.hocon" }, { hocon: "networks/raw.json" }] }),
  );
  writeFileSync(path.join(dir, "networks", "helper.network.json"), JSON.stringify({ agents: [{ name: "helper", tools: ["a"] }] }));
  writeFileSync(path.join(dir, "networks", "raw.json"), JSON.stringify({ any: "file used as written" }));
  writeFileSync(path.join(dir, "links.json"), JSON.stringify({ links: [{ href: "https://site.example/docs" }] }));
}

function trustFile(dir: string, keyRecordPath: string, origin = ORIGIN): string {
  const key = JSON.parse(readFileSync(keyRecordPath, "utf8")) as PlumblineKey;
  const entry: TrustEntry = { kid: key.kid, origin, publicKey: key.publicKey };
  const file = path.join(dir, "plumbline.trust.json");
  writeFileSync(file, JSON.stringify({ version: 1, entries: [entry] }));
  return file;
}

test("keygen -> sign -> verify -> tamper -> verify, end to end", () => {
  const keyDir = path.join(tmp, "keys");
  const site = path.join(tmp, "site");
  writeSite(site);

  const gen = run("keygen", "--out", keyDir);
  assert.equal(gen.code, 0, gen.err);
  const privatePath = path.join(keyDir, "plumbline.private.json");
  const recordPath = path.join(keyDir, ".well-known", "plumbline-key.json");
  const priv = JSON.parse(readFileSync(privatePath, "utf8"));
  const record = JSON.parse(readFileSync(recordPath, "utf8")) as PlumblineKey;
  assert.deepEqual(Object.keys(priv).sort(), ["alg", "kid", "privateKey", "type", "version"]);
  assert.equal(priv.type, "plumbline-private-key");
  assert.equal(priv.kid, record.kid);
  assert.ok(!JSON.stringify(record).includes(priv.privateKey), "the public record never carries the private key");
  assert.match(gen.out, new RegExp(record.kid));
  assert.match(gen.out, /back up/i);
  assert.match(gen.out, /never commit/i);
  assert.match(gen.out, /browser memory/i);

  const signed = run("sign", "--root", site, "--key", privatePath, "--origin", ORIGIN, "--days", "30");
  assert.equal(signed.code, 0, signed.err);
  const signature = JSON.parse(readFileSync(path.join(site, "plumbline.signature.json"), "utf8"));
  assert.deepEqual(
    signature.subjects.map((s: { path: string }) => s.path),
    ["agent-manifest.json", "links.json", "networks/helper.network.json", "networks/raw.json"],
  );
  assert.equal(signature.kid, record.kid);

  const trust = trustFile(tmp, recordPath);
  const good = run("verify", "--root", site, "--trust", trust);
  assert.equal(good.code, 0, good.out + good.err);
  assert.match(good.out, /^verified/m);

  // the same site, a verifier that never met this signer
  const emptyTrust = path.join(tmp, "empty.trust.json");
  writeFileSync(emptyTrust, JSON.stringify({ version: 1, entries: [] }));
  mkdirSync(path.join(site, ".well-known"), { recursive: true });
  writeFileSync(path.join(site, ".well-known", "plumbline-key.json"), readFileSync(recordPath));
  const stranger = run("verify", "--root", site, "--trust", emptyTrust);
  assert.equal(stranger.code, 1);
  assert.match(stranger.out, /^unverifiable/m);
  assert.match(stranger.out, /internally consistent but the signer is unknown/);

  const asJson = run("verify", "--root", site, "--trust", trust, "--json");
  assert.equal(asJson.code, 0);
  assert.equal(JSON.parse(asJson.out).results[0].verdict, "verified");

  // edit one signed file
  writeFileSync(path.join(site, "links.json"), JSON.stringify({ links: [{ href: "https://evil.example/" }] }));
  const bad = run("verify", "--root", site, "--trust", trust);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /^invalid tampered/m);

  // restore, then damage a network file so it is not even JSON any more: still tampered, still exit 1
  writeFileSync(path.join(site, "links.json"), JSON.stringify({ links: [{ href: "https://site.example/docs" }] }));
  assert.equal(run("verify", "--root", site, "--trust", trust).code, 0);
  writeFileSync(path.join(site, "networks", "helper.network.json"), "{ broken");
  const broken = run("verify", "--root", site, "--trust", trust, "--json");
  assert.equal(broken.code, 1);
  assert.deepEqual(
    [JSON.parse(broken.out).results[0].verdict, JSON.parse(broken.out).results[0].reason],
    ["invalid", "tampered"],
  );
  // a deleted signed file is tampered too
  rmSync(path.join(site, "networks", "helper.network.json"));
  assert.match(run("verify", "--root", site, "--trust", trust).out, /^invalid tampered/m);
});

test("the private key file is mode 0600 on POSIX; keygen refuses to overwrite", (t) => {
  const keyDir = path.join(tmp, "keys-mode");
  assert.equal(run("keygen", "--out", keyDir).code, 0);
  const privatePath = path.join(keyDir, "plumbline.private.json");
  if (process.platform === "win32") t.diagnostic("mode bits are not meaningful on Windows; the 0600 assertion ran only on POSIX");
  else assert.equal(statSync(privatePath).mode & 0o777, 0o600);

  const before = readFileSync(privatePath, "utf8");
  const again = run("keygen", "--out", keyDir);
  assert.equal(again.code, 2);
  assert.match(again.err, /refusing to overwrite/);
  assert.equal(readFileSync(privatePath, "utf8"), before);
});

test("sign exits 2 with a clear message when the manifest or a named network file is missing", () => {
  const keyDir = path.join(tmp, "keys-missing");
  assert.equal(run("keygen", "--out", keyDir).code, 0);
  const key = path.join(keyDir, "plumbline.private.json");

  const empty = path.join(tmp, "site-empty");
  mkdirSync(empty, { recursive: true });
  const noManifest = run("sign", "--root", empty, "--key", key, "--origin", ORIGIN);
  assert.equal(noManifest.code, 2);
  assert.match(noManifest.err, /agent-manifest\.json not found/);

  const site = path.join(tmp, "site-missing-net");
  mkdirSync(site, { recursive: true });
  writeFileSync(path.join(site, "agent-manifest.json"), JSON.stringify({ networks: [{ hocon: "networks/gone.hocon" }] }));
  const noNetwork = run("sign", "--root", site, "--key", key, "--origin", ORIGIN);
  assert.equal(noNetwork.code, 2);
  assert.match(noNetwork.err, /networks\/gone\.network\.json/);
});

test("sign exits 2 on a bad origin, a mismatched key file, a path that escapes the root; unknown option is a usage error", () => {
  const keyDir = path.join(tmp, "keys-bad");
  assert.equal(run("keygen", "--out", keyDir).code, 0);
  const key = path.join(keyDir, "plumbline.private.json");
  const site = path.join(tmp, "site-bad");
  writeSite(site);

  assert.equal(run("sign", "--root", site, "--key", key, "--origin", "http://site.example").code, 2);
  assert.equal(run("sign", "--root", site, "--key", key, "--origin", ORIGIN, "--days", "0").code, 2);

  const tampered = JSON.parse(readFileSync(key, "utf8"));
  tampered.kid = "0".repeat(16);
  const wrongKid = path.join(tmp, "wrong-kid.private.json");
  writeFileSync(wrongKid, JSON.stringify(tampered));
  const mismatch = run("sign", "--root", site, "--key", wrongKid, "--origin", ORIGIN);
  assert.equal(mismatch.code, 2);
  assert.match(mismatch.err, /kid/);

  writeFileSync(path.join(site, "agent-manifest.json"), JSON.stringify({ networks: [{ hocon: "../outside.hocon" }] }));
  const escape = run("sign", "--root", site, "--key", key, "--origin", ORIGIN);
  assert.equal(escape.code, 2);
  assert.match(escape.err, /unsafe path/);

  assert.equal(run("sign", "--bogus", "x").code, 2);
  assert.equal(run("sign").code, 2);
  assert.equal(run("verify", "--root", site, "--trust", path.join(tmp, "nope.json")).code, 2);
  assert.equal(run("verify", "--root", tmp, "--trust", path.join(tmp, "empty.trust.json")).code, 2, "no signature file is an I/O error");
});

test("verify honours --now: past expiry is invalid expired (exit 1)", () => {
  const keyDir = path.join(tmp, "keys-expiry");
  const site = path.join(tmp, "site-expiry");
  writeSite(site);
  assert.equal(run("keygen", "--out", keyDir).code, 0);
  const key = path.join(keyDir, "plumbline.private.json");
  assert.equal(run("sign", "--root", site, "--key", key, "--origin", ORIGIN, "--days", "1", "--now", "2026-11-17T12:00:00.000Z").code, 0);
  const trust = trustFile(tmp, path.join(keyDir, ".well-known", "plumbline-key.json"));
  assert.equal(run("verify", "--root", site, "--trust", trust, "--now", "2026-11-18T11:59:59.999Z").code, 0);
  const late = run("verify", "--root", site, "--trust", trust, "--now", "2026-11-18T12:00:00.000Z");
  assert.equal(late.code, 1);
  assert.match(late.out, /^invalid expired/m);
});

test("rotate writes plumbline-rotation.json that a verifier holding the old key accepts", async () => {
  const oldDir = path.join(tmp, "keys-old");
  const newDir = path.join(tmp, "keys-new");
  const site = path.join(tmp, "site-rotate");
  mkdirSync(site, { recursive: true });
  assert.equal(run("keygen", "--out", oldDir).code, 0);
  assert.equal(run("keygen", "--out", newDir).code, 0);
  const result = run("rotate", "--root", site, "--old-key", path.join(oldDir, "plumbline.private.json"), "--new-key", path.join(newDir, "plumbline.private.json"), "--json");
  assert.equal(result.code, 0, result.err);
  const rotation = JSON.parse(readFileSync(path.join(site, "plumbline-rotation.json"), "utf8")) as PlumblineRotation;
  const oldRecord = JSON.parse(readFileSync(path.join(oldDir, ".well-known", "plumbline-key.json"), "utf8")) as PlumblineKey;
  const newRecord = JSON.parse(readFileSync(path.join(newDir, ".well-known", "plumbline-key.json"), "utf8")) as PlumblineKey;
  assert.equal(rotation.from, oldRecord.kid);
  assert.equal(rotation.to, newRecord.kid);
  const trust = { find: (kid: string, origin: string) => (kid === oldRecord.kid && origin === ORIGIN ? { kid, origin, publicKey: oldRecord.publicKey } : undefined) };
  assert.equal((await verifyRotation(rotation, trust, ORIGIN)).verdict, "verified");

  // same key twice is refused
  const same = run("rotate", "--root", site, "--old-key", path.join(oldDir, "plumbline.private.json"), "--new-key", path.join(oldDir, "plumbline.private.json"));
  assert.equal(same.code, 2);
});

test("gate without a target is a usage error, init is not implemented (exit 2), an unknown command is a usage error", () => {
  const gate = run("gate");
  assert.equal(gate.code, 2);
  assert.match(gate.err, /usage: plumbline gate/);
  const init = run("init");
  assert.equal(init.code, 2);
  assert.match(init.err, /not implemented/);
  assert.equal(run("nonsense").code, 2);
  assert.equal(run().code, 2);
});

test("--json on an error prints a JSON error object and exits 2", () => {
  const r = run("keygen", "--json");
  assert.equal(r.code, 2);
  assert.match(JSON.parse(r.out).error, /missing --out/);
});
