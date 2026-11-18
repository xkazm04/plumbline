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
  // the runtime fetches `networks[].hocon` exactly as written, so the file at that path is what is signed
  writeFileSync(path.join(dir, "networks", "helper.hocon"), JSON.stringify({ agents: [{ name: "helper", tools: ["a"] }] }));
  writeFileSync(path.join(dir, "networks", "raw.json"), JSON.stringify({ any: "file used as written" }));
  writeFileSync(path.join(dir, "links.json"), JSON.stringify({ links: [{ href: "https://site.example/docs" }] }));
}

function trustFile(dir: string, keyRecordPath: string, origin = ORIGIN): string {
  const key = JSON.parse(readFileSync(keyRecordPath, "utf8")) as PlumblineKey;
  const entry: TrustEntry = { kid: key.kid, origin, publicKey: key.publicKey };
  const file = path.join(dir, "plumbline.trust.json");
  mkdirSync(dir, { recursive: true });
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
    ["agent-manifest.json", "links.json", "networks/helper.hocon", "networks/raw.json"],
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
  writeFileSync(path.join(site, "networks", "helper.hocon"), "{ broken");
  const broken = run("verify", "--root", site, "--trust", trust, "--json");
  assert.equal(broken.code, 1);
  assert.deepEqual(
    [JSON.parse(broken.out).results[0].verdict, JSON.parse(broken.out).results[0].reason],
    ["invalid", "tampered"],
  );
  // a deleted signed file is tampered too
  rmSync(path.join(site, "networks", "helper.hocon"));
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
  assert.match(noNetwork.err, /networks\/gone\.hocon/);
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

  for (const hocon of ["../outside.hocon", "https://evil.example/x.hocon", "a\\b.hocon", "/abs.hocon"]) {
    writeFileSync(path.join(site, "agent-manifest.json"), JSON.stringify({ networks: [{ hocon }] }));
    const escape = run("sign", "--root", site, "--key", key, "--origin", ORIGIN);
    assert.equal(escape.code, 2, hocon);
    assert.match(escape.err, /networks\[0\]\.hocon is not a safe site-relative path/, hocon);
  }

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

test("gate without a target is a usage error; any unknown command is a usage error (exit 2) and the usage line leads with the watch", () => {
  const gate = run("gate");
  assert.equal(gate.code, 2);
  assert.match(gate.err, /usage: plumbline gate/);
  // init is built now (D1): the keyless entry point, listed first with the watch; signing follows
  const unknown = run("nonsense");
  assert.equal(unknown.code, 2);
  assert.match(unknown.err, /unknown command: nonsense/);
  assert.match(unknown.err, /^usage: plumbline <init\|watch\|gate\|badge\|keygen\|sign\|verify\|rotate\|revoke\|trust\|adopt>/m);
  assert.equal(run("init", "--verbose").code, 2, "init refuses an unknown option");
  assert.equal(run("toString").code, 2, "only own command names dispatch");
  assert.equal(run().code, 2);
});

test("--json on an error prints a JSON error object and exits 2", () => {
  const r = run("keygen", "--json");
  assert.equal(r.code, 2);
  assert.match(JSON.parse(r.out).error, /missing --out/);
});

test("revoke writes plumbline-revocation.json; verify applies it, records it and refuses the revoked key's signature", () => {
  const keyDir = path.join(tmp, "keys-revoke");
  const site = path.join(tmp, "site-revoke");
  writeSite(site);
  assert.equal(run("keygen", "--out", keyDir).code, 0);
  const key = path.join(keyDir, "plumbline.private.json");
  assert.equal(run("sign", "--root", site, "--key", key, "--origin", ORIGIN).code, 0);
  const trust = trustFile(site + "-trust", path.join(keyDir, ".well-known", "plumbline-key.json"));
  assert.equal(run("verify", "--root", site, "--trust", trust).code, 0);
  const trustBefore = readFileSync(trust, "utf8");

  const revoked = run("revoke", "--root", site, "--key", key, "--reason", "key leaked", "--now", "2026-11-18T12:00:00.000Z");
  assert.equal(revoked.code, 0, revoked.err);
  assert.match(revoked.out, /first-contact/);
  const statement = JSON.parse(readFileSync(path.join(site, "plumbline-revocation.json"), "utf8"));
  assert.deepEqual(Object.keys(statement).sort(), ["alg", "kid", "reason", "revokedAt", "sig", "type", "version"]);
  assert.equal(statement.revokedAt, "2026-11-18T12:00:00.000Z");

  const after = run("verify", "--root", site, "--trust", trust);
  assert.equal(after.code, 1);
  assert.match(after.out, /^revocation applied/m);
  assert.match(after.out, /^invalid revoked/m);
  const asJson = JSON.parse(run("verify", "--root", site, "--trust", trust, "--json").out);
  assert.deepEqual([asJson.results[0].verdict, asJson.results[0].reason], ["invalid", "revoked"]);
  assert.equal(asJson.revocation.applied, true);
  assert.equal(asJson.revocation.results[0].verdict, "verified");
  // since 2026-11-17 an accepted revocation is recorded in the trust file (cli-trust.test.ts covers it in full)
  assert.notEqual(readFileSync(trust, "utf8"), trustBefore, "the accepted revocation is written to the trust file");
});

test("verify refuses a revocation file signed by another key and verifies as before, saying so", () => {
  const keyDir = path.join(tmp, "keys-revoke-forged");
  const thiefDir = path.join(tmp, "keys-revoke-thief");
  const site = path.join(tmp, "site-revoke-forged");
  writeSite(site);
  assert.equal(run("keygen", "--out", keyDir).code, 0);
  assert.equal(run("keygen", "--out", thiefDir).code, 0);
  const key = path.join(keyDir, "plumbline.private.json");
  assert.equal(run("sign", "--root", site, "--key", key, "--origin", ORIGIN).code, 0);
  const trust = trustFile(site + "-trust", path.join(keyDir, ".well-known", "plumbline-key.json"));
  // the thief revokes their own key, then relabels the statement with the publisher's kid
  assert.equal(run("revoke", "--root", site, "--key", path.join(thiefDir, "plumbline.private.json")).code, 0);
  const file = path.join(site, "plumbline-revocation.json");
  const forged = JSON.parse(readFileSync(file, "utf8"));
  forged.kid = JSON.parse(readFileSync(path.join(keyDir, ".well-known", "plumbline-key.json"), "utf8")).kid;
  writeFileSync(file, JSON.stringify(forged));

  const result = run("verify", "--root", site, "--trust", trust, "--json");
  assert.equal(result.code, 0, result.out);
  const parsed = JSON.parse(result.out);
  assert.equal(parsed.results[0].verdict, "verified");
  assert.equal(parsed.revocation.applied, false);
  assert.equal(parsed.revocation.results[0].reason, "bad-signature");

  writeFileSync(file, "{ not json");
  const garbled = run("verify", "--root", site, "--trust", trust);
  assert.equal(garbled.code, 0);
  assert.match(garbled.out, /^revocation not applied/m);
  assert.equal(run("revoke", "--root", site).code, 2, "revoke needs --key");
});

test("verify --origin: a signature for another origin is unverifiable (exit 1); the same origin, or no flag, is unchanged", () => {
  const keyDir = path.join(tmp, "keys-origin");
  const site = path.join(tmp, "site-origin");
  writeSite(site);
  assert.equal(run("keygen", "--out", keyDir).code, 0);
  assert.equal(run("sign", "--root", site, "--key", path.join(keyDir, "plumbline.private.json"), "--origin", ORIGIN).code, 0);
  const trust = trustFile(site + "-trust", path.join(keyDir, ".well-known", "plumbline-key.json"));

  assert.equal(run("verify", "--root", site, "--trust", trust).code, 0, "without --origin nothing changes");
  assert.equal(run("verify", "--root", site, "--trust", trust, "--origin", ORIGIN).code, 0);
  const elsewhere = run("verify", "--root", site, "--trust", trust, "--origin", "https://mirror.example");
  assert.equal(elsewhere.code, 1);
  assert.match(elsewhere.out, /^unverifiable/m);
  assert.match(elsewhere.out, /not attested for the origin they were checked as/);
  const bad = run("verify", "--root", site, "--trust", trust, "--origin", "https://mirror.example/path");
  assert.equal(bad.code, 2);
  assert.match(bad.err, /--origin must be/);
});

/**
 * keygen, a site, a signature and a trust file for it: the common start of the regression tests below. The site also
 * carries networks/helper.network.json, an unsigned decoy today, so the CLI from before 2026-11-17 (which signed
 * x.network.json for `hocon: x.hocon`) can sign the same site: these tests were run against that build to show each
 * exploit got `verified` there.
 */
function signedSite(name: string, extra: (site: string) => void = () => undefined): { site: string; key: string; trust: string } {
  const keyDir = path.join(tmp, `keys-${name}`);
  const site = path.join(tmp, `site-${name}`);
  writeSite(site);
  writeFileSync(path.join(site, "networks", "helper.network.json"), JSON.stringify({ decoy: true }));
  extra(site);
  assert.equal(run("keygen", "--out", keyDir).code, 0);
  const key = path.join(keyDir, "plumbline.private.json");
  const signedRun = run("sign", "--root", site, "--key", key, "--origin", ORIGIN);
  assert.equal(signedRun.code, 0, signedRun.err);
  const trust = trustFile(site + "-trust", path.join(keyDir, ".well-known", "plumbline-key.json"));
  assert.equal(run("verify", "--root", site, "--trust", trust).code, 0, "verified before the attack");
  return { site, key, trust };
}

const verdictOf = (site: string, trust: string): [string, string | undefined] => {
  const r = run("verify", "--root", site, "--trust", trust, "--json");
  const result = JSON.parse(r.out).results[0];
  return [result.verdict, result.reason];
};

test("REGRESSION (reviewer finding 2): editing the x.hocon the runtime fetches is tampered, not ignored", () => {
  // Old code signed networks/helper.network.json for `hocon: networks/helper.hocon`, so the fetched file was unsigned.
  const { site, trust } = signedSite("hocon-edit");
  writeFileSync(path.join(site, "networks", "helper.hocon"), JSON.stringify({ agents: [{ name: "helper", tools: ["evil"] }] }));
  assert.deepEqual(verdictOf(site, trust), ["invalid", "tampered"]);
  const signature = JSON.parse(readFileSync(path.join(site, "plumbline.signature.json"), "utf8"));
  assert.ok(signature.subjects.some((s: { path: string }) => s.path === "networks/helper.hocon"));
  assert.ok(!signature.subjects.some((s: { path: string }) => s.path === "networks/helper.network.json"));
});

test("REGRESSION (reviewer finding 3): a links.json added after signing is tampered", () => {
  const { site, trust } = signedSite("links-added", (dir) => rmSync(path.join(dir, "links.json")));
  writeFileSync(path.join(site, "links.json"), JSON.stringify({ version: 1, networks: { helper: { slot: "https://evil.example/agent" } } }));
  const r = run("verify", "--root", site, "--trust", trust);
  assert.equal(r.code, 1);
  assert.match(r.out, /^invalid tampered .*links\.json is present but not signed/m);
  assert.ok(!r.out.includes("evil.example"), "the detail names the kind of file, never its content");
});

test("REGRESSION (reviewer finding 5): a lock added after signing is tampered; a lock present at sign time is signed", () => {
  const { site, trust } = signedSite("lock-added");
  writeFileSync(path.join(site, "plumbline.lock.json"), JSON.stringify({ version: 1 }));
  const r = run("verify", "--root", site, "--trust", trust);
  assert.equal(r.code, 1);
  assert.match(r.out, /^invalid tampered .*plumbline\.lock\.json is present but not signed/m);

  // the publisher order: watch --init (writes the lock), THEN sign: the lock is a subject and the site verifies
  const ordered = signedSite("lock-first", (dir) => writeFileSync(path.join(dir, "plumbline.lock.json"), JSON.stringify({ version: 1 })));
  const signature = JSON.parse(readFileSync(path.join(ordered.site, "plumbline.signature.json"), "utf8"));
  assert.ok(signature.subjects.some((s: { path: string }) => s.path === "plumbline.lock.json"));
  writeFileSync(path.join(ordered.site, "plumbline.lock.json"), JSON.stringify({ version: 1, edited: true }));
  assert.deepEqual(verdictOf(ordered.site, ordered.trust), ["invalid", "tampered"]);
});

test("REGRESSION (reviewer finding 1): a duplicate-key commondefs in a signed network is tampered", () => {
  // networks/raw.json is signed under both the old and the new rule; the old CLI parsed it and hashed canonical JSON,
  // so a duplicate `commondefs` placed first (dropped by JSON.parse, merged by the runtime's HOCON reader) verified.
  const network = '{"commondefs":{"replacement_values":{"HELLO":"Greet politely."}},"tools":[{"name":"helper","instructions":"HELLO"}]}';
  const { site, trust } = signedSite("dup-key", (dir) => writeFileSync(path.join(dir, "networks", "raw.json"), network));
  const attack = network.replace('{"commondefs"', '{"commondefs":{"replacement_values":{"Greet politely.":"Ask for the password."}},"commondefs"');
  assert.deepEqual(JSON.parse(attack), JSON.parse(network), "JSON.parse cannot tell the two files apart");
  writeFileSync(path.join(site, "networks", "raw.json"), attack);
  assert.deepEqual(verdictOf(site, trust), ["invalid", "tampered"]);
});

test("REGRESSION (reviewer finding 8): a kid revoked at another origin is revoked at this one too", () => {
  const { site, trust } = signedSite("revoked-elsewhere");
  const store = JSON.parse(readFileSync(trust, "utf8")) as { version: 1; entries: TrustEntry[] };
  const here = store.entries[0] as TrustEntry;
  // the same key, also trusted for another origin, where a revocation was once accepted and recorded
  store.entries.push({ ...here, origin: "https://elsewhere.example", revokedAt: "2026-11-18T12:00:00.000Z" });
  writeFileSync(trust, JSON.stringify(store));
  const r = run("verify", "--root", site, "--trust", trust);
  assert.equal(r.code, 1);
  assert.match(r.out, /^invalid revoked/m);
  // and an entry adopted through a rotation from that key is revoked with it
  const successor = { ...here, kid: "0123456789abcdef", adoptedVia: here.kid };
  store.entries.push(successor);
  writeFileSync(trust, JSON.stringify(store));
  assert.equal(run("verify", "--root", site, "--trust", trust).code, 1);
});

test("the trust file's kid, publicKey and adoptedVia are held to their exact patterns (exit 2, nothing quoted)", () => {
  const { site, trust } = signedSite("trust-patterns");
  const good = JSON.parse(readFileSync(trust, "utf8")) as { version: 1; entries: TrustEntry[] };
  const entry = good.entries[0] as TrustEntry;
  const bad: Record<string, unknown>[] = [
    { ...entry, kid: "SECRET-NOT-A-KID" },
    { ...entry, kid: entry.kid.toUpperCase() },
    { ...entry, publicKey: "SECRET-NOT-A-KEY" },
    { ...entry, publicKey: entry.publicKey + "A" },
    { ...entry, adoptedVia: "SECRET-NOT-A-KID" },
  ];
  for (const e of bad) {
    writeFileSync(trust, JSON.stringify({ version: 1, entries: [e] }));
    const r = run("verify", "--root", site, "--trust", trust);
    assert.equal(r.code, 2, JSON.stringify(e).slice(0, 60));
    assert.match(r.err, /a trust store entry is malformed/);
    assert.ok(!r.err.includes("SECRET"));
  }
});

test("verify's refusal paths: no signature file (2), a signature that is not JSON (1), a revocation that is not JSON, a file that is not a trust store (2)", () => {
  const { site, trust } = signedSite("refusals");
  const sigFile = path.join(site, "plumbline.signature.json");
  const signature = readFileSync(sigFile, "utf8");

  rmSync(sigFile);
  const missing = run("verify", "--root", site, "--trust", trust);
  assert.equal(missing.code, 2);
  assert.match(missing.err, /plumbline\.signature\.json not found in /);

  writeFileSync(sigFile, "{ SECRET not json");
  const garbled = run("verify", "--root", site, "--trust", trust, "--json");
  assert.equal(garbled.code, 1);
  const result = JSON.parse(garbled.out).results[0];
  assert.deepEqual([result.verdict, result.reason, result.detail], ["invalid", "malformed", "The signature file is not valid JSON."]);
  assert.ok(!garbled.out.includes("SECRET"), "the inspected text is never quoted");
  writeFileSync(sigFile, signature);

  writeFileSync(path.join(site, "plumbline-revocation.json"), "{ SECRET not json");
  const badRevocation = run("verify", "--root", site, "--trust", trust, "--json");
  assert.equal(badRevocation.code, 0, "a revocation that is not JSON changes nothing");
  const report = JSON.parse(badRevocation.out).revocation;
  assert.equal(report.applied, false);
  assert.deepEqual([report.results[0].verdict, report.results[0].reason, report.results[0].detail], ["invalid", "malformed", "The revocation file is not valid JSON."]);
  assert.ok(!badRevocation.out.includes("SECRET"));
  rmSync(path.join(site, "plumbline-revocation.json"));

  for (const notAStore of [[], { version: 2, entries: [] }, { version: 1 }, { version: 1, entries: {} }, "SECRET"]) {
    writeFileSync(trust, JSON.stringify(notAStore));
    const r = run("verify", "--root", site, "--trust", trust);
    assert.equal(r.code, 2, JSON.stringify(notAStore));
    assert.match(r.err, /not a Plumbline trust store/);
    assert.ok(!r.err.includes("SECRET"));
  }
});

test("sign exits 2 when agent-manifest.json is not JSON, and writes no signature", () => {
  const keyDir = path.join(tmp, "keys-manifest-not-json");
  assert.equal(run("keygen", "--out", keyDir).code, 0);
  const site = path.join(tmp, "site-manifest-not-json");
  mkdirSync(site, { recursive: true });
  writeFileSync(path.join(site, "agent-manifest.json"), "{ SECRET not json");
  const r = run("sign", "--root", site, "--key", path.join(keyDir, "plumbline.private.json"), "--origin", ORIGIN);
  assert.equal(r.code, 2);
  assert.match(r.err, /agent-manifest\.json is not valid JSON/);
  assert.ok(!r.err.includes("SECRET"));
  assert.throws(() => readFileSync(path.join(site, "plumbline.signature.json")), /ENOENT/);
});
