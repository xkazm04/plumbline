// The key lifecycle through the built CLI, wave 2 (2026-11-18): every revocation stays published, a rotation chain a
// verifier several rotations behind can follow, rotate and adopt refusing revoked keys, sign refusing a private key
// inside the site and warning about a stale key record, and the untested refusals of sign, trust and adopt.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ORIGIN, keygen, readTrust, run, scratchDir, writeSite, writeTrust } from "./cli-helpers.js";

type Keys = ReturnType<typeof keygen>;

/** A site signed by a fresh key, and a trust file that trusts that key for ORIGIN. */
function signedSite(): { root: string; site: string; keys: Keys; trust: string } {
  const root = scratchDir();
  const site = path.join(root, "site");
  writeSite(site);
  const keys = keygen(path.join(root, "keys"));
  const signed = run("sign", "--root", site, "--key", keys.privateFile, "--origin", ORIGIN);
  assert.equal(signed.code, 0, signed.err);
  const trust = writeTrust(path.join(root, "plumbline.trust.json"), [{ kid: keys.record.kid, origin: ORIGIN, publicKey: keys.record.publicKey }]);
  return { root, site, keys, trust };
}

const verdict = (site: string, trust: string): [string, string | undefined] => {
  const r = JSON.parse(run("verify", "--root", site, "--trust", trust, "--json").out).results[0];
  return [r.verdict, r.reason];
};

// ---- p-c30007: revoke appends; every revocation the site made stays published ----

test("revoking a second key keeps the first revocation: a verifier still on the first key gets invalid revoked", () => {
  const { root, site, keys: a, trust } = signedSite();
  // a mirror of the site as A signed it, before any revocation: what a stale verifier may still be served
  const mirror = path.join(root, "mirror");
  writeSite(mirror);
  assert.equal(run("sign", "--root", mirror, "--key", a.privateFile, "--origin", ORIGIN).code, 0);

  assert.equal(run("revoke", "--root", site, "--key", a.privateFile, "--now", "2026-11-18T12:00:00.000Z").code, 0);
  const b = keygen(path.join(root, "keys-b"));
  assert.equal(run("sign", "--root", site, "--key", b.privateFile, "--origin", ORIGIN).code, 0);
  const second = run("revoke", "--root", site, "--key", b.privateFile, "--now", "2026-11-19T12:00:00.000Z");
  assert.equal(second.code, 0, second.err);
  assert.match(second.out, /appended to .*\(2 revocations; every one stays published\)/);

  const file = JSON.parse(readFileSync(path.join(site, "plumbline-revocation.json"), "utf8"));
  assert.ok(Array.isArray(file), "two revocations make a list");
  assert.deepEqual(file.map((s: { kid: string }) => s.kid), [a.record.kid, b.record.kid]);

  // the stale verifier trusts A and has never seen a revocation; the site now publishes both
  writeFileSync(path.join(mirror, "plumbline-revocation.json"), readFileSync(path.join(site, "plumbline-revocation.json")));
  assert.deepEqual(verdict(mirror, trust), ["invalid", "revoked"]);
  assert.equal(readTrust(trust).entries[0]?.revokedAt, "2026-11-18T12:00:00.000Z");

  // revoking the same key again writes nothing
  const before = readFileSync(path.join(site, "plumbline-revocation.json"), "utf8");
  const again = run("revoke", "--root", site, "--key", a.privateFile);
  assert.equal(again.code, 0);
  assert.match(again.out, /already revoked/);
  assert.equal(readFileSync(path.join(site, "plumbline-revocation.json"), "utf8"), before);
});

test("the first revocation is still one statement (older verifiers read it), and a file that holds no statement is never overwritten", () => {
  const { site, keys } = signedSite();
  assert.equal(run("revoke", "--root", site, "--key", keys.privateFile).code, 0);
  const one = JSON.parse(readFileSync(path.join(site, "plumbline-revocation.json"), "utf8"));
  assert.equal(Array.isArray(one), false);
  assert.equal(one.type, "plumbline-revocation");

  writeFileSync(path.join(site, "plumbline-revocation.json"), "{ not a statement");
  const refused = run("revoke", "--root", site, "--key", keys.privateFile);
  assert.equal(refused.code, 2);
  assert.match(refused.err, /refusing to overwrite/);
  assert.equal(readFileSync(path.join(site, "plumbline-revocation.json"), "utf8"), "{ not a statement");
});

// ---- p-86391a: rotate appends to a chain; adopt walks it ----

test("two planned rotations make a chain, and a verifier still on the first key adopts both successors from it", () => {
  const { root, site, keys: a, trust } = signedSite();
  const b = keygen(path.join(root, "keys-b"));
  const c = keygen(path.join(root, "keys-c"));
  assert.equal(run("rotate", "--root", site, "--old-key", a.privateFile, "--new-key", b.privateFile).code, 0);
  const second = run("rotate", "--root", site, "--old-key", b.privateFile, "--new-key", c.privateFile);
  assert.equal(second.code, 0, second.err);
  assert.match(second.out, /a chain of 2 rotations/);
  assert.equal(run("sign", "--root", site, "--key", c.privateFile, "--origin", ORIGIN).code, 0);
  const chain = JSON.parse(readFileSync(path.join(site, "plumbline-rotation.json"), "utf8"));
  assert.deepEqual(chain.map((s: { from: string; to: string }) => [s.from, s.to]), [[a.record.kid, b.record.kid], [b.record.kid, c.record.kid]]);

  const dry = run("adopt", "--root", site, "--trust", trust, "--origin", ORIGIN);
  assert.equal(dry.code, 1, dry.out + dry.err);
  assert.match(dry.out, new RegExp(`rotation ${a.record.kid} -> ${b.record.kid}`));
  assert.match(dry.out, new RegExp(`rotation ${b.record.kid} -> ${c.record.kid}`));
  assert.equal(readTrust(trust).entries.length, 1, "nothing adopted without --yes");

  const yes = run("adopt", "--root", site, "--trust", trust, "--origin", ORIGIN, "--yes", "--json");
  assert.equal(yes.code, 0, yes.out + yes.err);
  assert.deepEqual(JSON.parse(yes.out).adopted, [b.record.kid, c.record.kid]);
  assert.deepEqual(
    readTrust(trust).entries.map((e) => [e.kid, e.adoptedVia]),
    [[a.record.kid, undefined], [b.record.kid, a.record.kid], [c.record.kid, b.record.kid]],
  );
  assert.deepEqual(verdict(site, trust), ["verified", undefined]);

  // revoking the first key cascades down the whole chain
  assert.equal(run("revoke", "--root", site, "--key", a.privateFile).code, 0);
  assert.deepEqual(verdict(site, trust), ["invalid", "revoked"]);
  assert.ok(readTrust(trust).entries.every((e) => e.revokedAt !== undefined));
});

test("a broken chain stops adopt at the statement that breaks it and adopts nothing; rotate refuses to break a chain", () => {
  const { root, site, keys: a, trust } = signedSite();
  const b = keygen(path.join(root, "keys-b"));
  const c = keygen(path.join(root, "keys-c"));
  const x = keygen(path.join(root, "keys-x"));
  assert.equal(run("rotate", "--root", site, "--old-key", a.privateFile, "--new-key", b.privateFile).code, 0);

  // rotate refuses a statement that does not continue the chain, and one that returns to a key the chain left
  const gap = run("rotate", "--root", site, "--old-key", x.privateFile, "--new-key", c.privateFile);
  assert.equal(gap.code, 2);
  assert.match(gap.err, new RegExp(`ends at key ${b.record.kid}`));
  const loop = run("rotate", "--root", site, "--old-key", b.privateFile, "--new-key", a.privateFile);
  assert.equal(loop.code, 2);
  assert.match(loop.err, /never returns to a key it left/);
  // the same rotation twice writes nothing
  const before = readFileSync(path.join(site, "plumbline-rotation.json"), "utf8");
  assert.match(run("rotate", "--root", site, "--old-key", a.privateFile, "--new-key", b.privateFile).out, /already published/);
  assert.equal(readFileSync(path.join(site, "plumbline-rotation.json"), "utf8"), before);

  // someone splices a statement that does not link (x -> c) onto the published chain by hand
  const spliceDir = path.join(root, "splice");
  mkdirSync(spliceDir);
  assert.equal(run("rotate", "--root", spliceDir, "--old-key", x.privateFile, "--new-key", c.privateFile).code, 0);
  const chain = [JSON.parse(before), JSON.parse(readFileSync(path.join(spliceDir, "plumbline-rotation.json"), "utf8"))];
  writeFileSync(path.join(site, "plumbline-rotation.json"), JSON.stringify(chain));
  const broken = run("adopt", "--root", site, "--trust", trust, "--origin", ORIGIN, "--yes", "--json");
  assert.equal(broken.code, 1);
  const report = JSON.parse(broken.out);
  assert.deepEqual([report.brokenAt, report.added], [1, false]);
  assert.match(run("adopt", "--root", site, "--trust", trust, "--origin", ORIGIN, "--yes").out, /stops at statement 1 of 2/);
  assert.equal(readTrust(trust).entries.length, 1, "a broken chain adopts nothing, not even the hop before the break");
});

// ---- p-a4ae28: rotate refuses a key the site's revocation file revokes ----

test("rotate refuses to rotate from (or to) a key the site's revocation file revokes, and writes no rotation", () => {
  const { root, site, keys: a } = signedSite();
  const b = keygen(path.join(root, "keys-b"));
  assert.equal(run("revoke", "--root", site, "--key", a.privateFile).code, 0);
  const refused = run("rotate", "--root", site, "--old-key", a.privateFile, "--new-key", b.privateFile);
  assert.equal(refused.code, 2);
  assert.match(refused.err, /old key .* is revoked by the site's plumbline-revocation\.json/);
  assert.match(refused.err, /keygen/);
  assert.equal(existsSync(path.join(site, "plumbline-rotation.json")), false);

  const c = keygen(path.join(root, "keys-c"));
  const toRevoked = run("rotate", "--root", site, "--old-key", c.privateFile, "--new-key", a.privateFile);
  assert.equal(toRevoked.code, 2);
  assert.match(toRevoked.err, /new key .* is revoked/);
  // a revocation of another key does not stop a rotation between two live keys
  assert.equal(run("rotate", "--root", site, "--old-key", b.privateFile, "--new-key", c.privateFile).code, 0);
});

// ---- p-ba60fb: adopt refuses a successor the trust file records as revoked ----

test("adopt refuses a successor the trust file already records as revoked (exit 1, the trust command's sentence)", () => {
  const { root, site, keys: a, trust } = signedSite();
  const b = keygen(path.join(root, "keys-b"));
  assert.equal(run("rotate", "--root", site, "--old-key", a.privateFile, "--new-key", b.privateFile).code, 0);
  writeTrust(trust, [
    { kid: a.record.kid, origin: ORIGIN, publicKey: a.record.publicKey },
    { kid: b.record.kid, origin: "https://elsewhere.example", publicKey: b.record.publicKey, revokedAt: "2026-11-18T12:00:00.000Z" },
  ]);
  const before = readFileSync(trust, "utf8");
  const r = run("adopt", "--root", site, "--trust", trust, "--origin", ORIGIN, "--yes");
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.out, /^invalid revoked/m);
  assert.match(r.out, new RegExp(`records key ${b.record.kid} as revoked; a revoked key is never trusted again`));
  assert.doesNotMatch(r.out, /^adopted/m);
  assert.equal(readFileSync(trust, "utf8"), before);
});

// ---- p-f6cd37: adopt with a rotation that is not JSON, and with a revocation but no --yes ----

test("adopt: a rotation file that is not JSON is invalid malformed (exit 1); a revocation without --yes is applied in memory only", () => {
  const { root, site, keys: a, trust } = signedSite();
  writeFileSync(path.join(site, "plumbline-rotation.json"), "{ SECRET not json");
  const before = readFileSync(trust, "utf8");
  const garbled = run("adopt", "--root", site, "--trust", trust, "--origin", ORIGIN, "--yes");
  assert.equal(garbled.code, 1);
  assert.match(garbled.out, /^invalid malformed .*The rotation file is not valid JSON\./m);
  assert.ok(!garbled.out.includes("SECRET"));
  assert.equal(readFileSync(trust, "utf8"), before);

  const b = keygen(path.join(root, "keys-b"));
  rmSync(path.join(site, "plumbline-rotation.json"));
  assert.equal(run("rotate", "--root", site, "--old-key", a.privateFile, "--new-key", b.privateFile).code, 0);
  assert.equal(run("revoke", "--root", site, "--key", a.privateFile).code, 0);
  const dry = run("adopt", "--root", site, "--trust", trust, "--origin", ORIGIN);
  assert.equal(dry.code, 1);
  assert.match(dry.out, /^revocation applied/m);
  assert.match(dry.out, new RegExp(`^revocation applied in memory only; nothing was written to ${trust.replace(/[\\.]/g, "\\$&")}`, "m"));
  assert.match(dry.out, /^invalid revoked/m);
  assert.equal(readFileSync(trust, "utf8"), before, "the trust file is unchanged without --yes");
});

// ---- p-1c7bd9: sign refuses a private key inside the site root ----

test("sign refuses a private key file inside the site root, or a root holding plumbline.private.json (exit 2, nothing signed)", () => {
  const root = scratchDir();
  const site = path.join(root, "site");
  writeSite(site);
  // keygen --out <site> is the convenient mistake: it warns, and sign then refuses
  const gen = run("keygen", "--out", site);
  assert.equal(gen.code, 0);
  assert.match(gen.out, /looks like a site folder/);
  const inside = run("sign", "--root", site, "--key", path.join(site, "plumbline.private.json"), "--origin", ORIGIN);
  assert.equal(inside.code, 2);
  assert.match(inside.err, /sits inside the site root/);
  assert.match(inside.err, /revoke/);
  assert.equal(existsSync(path.join(site, "plumbline.signature.json")), false);

  // a key kept outside, but a private key file still lying in the root: refused too
  const outside = keygen(path.join(root, "keys"));
  const lying = run("sign", "--root", site, "--key", outside.privateFile, "--origin", ORIGIN);
  assert.equal(lying.code, 2);
  assert.match(lying.err, /holds a plumbline\.private\.json/);
  rmSync(path.join(site, "plumbline.private.json"));
  assert.equal(run("sign", "--root", site, "--key", outside.privateFile, "--origin", ORIGIN).code, 0);

  // a key in a subfolder of the root is inside it as well
  const nested = keygen(path.join(site, "private"));
  const sub = run("sign", "--root", site, "--key", nested.privateFile, "--origin", ORIGIN);
  assert.equal(sub.code, 2);
  assert.match(sub.err, /sits inside the site root/);
});

// ---- p-69e5ec: sign with a --key file that is not a key file, and one whose key is not PKCS#8 ----

test("sign with a --key file that is not a private key file, or whose key is not PKCS#8, exits 2 naming it and writes nothing", () => {
  const root = scratchDir();
  const site = path.join(root, "site");
  writeSite(site);
  const keys = keygen(path.join(root, "keys"));
  const notKey = path.join(root, "record.json");
  writeFileSync(notKey, readFileSync(keys.recordFile)); // a public key record is JSON of another shape
  const wrongShape = run("sign", "--root", site, "--key", notKey, "--origin", ORIGIN);
  assert.equal(wrongShape.code, 2);
  assert.match(wrongShape.err, /not a Plumbline private key file/);

  const notPkcs8 = path.join(root, "bad.private.json");
  writeFileSync(notPkcs8, JSON.stringify({ ...JSON.parse(readFileSync(keys.privateFile, "utf8")), privateKey: "AAAA" }));
  const badKey = run("sign", "--root", site, "--key", notPkcs8, "--origin", ORIGIN);
  assert.equal(badKey.code, 2);
  assert.match(badKey.err, /not a valid Ed25519 PKCS#8 key/);
  assert.equal(existsSync(path.join(site, "plumbline.signature.json")), false);
});

// ---- p-86e728: sign warns when the published key record is not the signing key's ----

test("sign warns when the site's key record is absent or another key's (and says which in --json); a matching record is quiet", () => {
  const { root, site, keys: a } = signedSite();
  const record = path.join(site, ".well-known", "plumbline-key.json");
  const absent = JSON.parse(run("sign", "--root", site, "--key", a.privateFile, "--origin", ORIGIN, "--json").out);
  assert.equal(absent.keyRecord, "absent");
  assert.match(run("sign", "--root", site, "--key", a.privateFile, "--origin", ORIGIN).out, /^WARNING: .*publishes no \.well-known\/plumbline-key\.json/m);

  mkdirSync(path.dirname(record), { recursive: true });
  writeFileSync(record, readFileSync(a.recordFile));
  const match = run("sign", "--root", site, "--key", a.privateFile, "--origin", ORIGIN, "--json");
  assert.equal(JSON.parse(match.out).keyRecord, "match");
  assert.doesNotMatch(run("sign", "--root", site, "--key", a.privateFile, "--origin", ORIGIN).out, /WARNING/);

  // after a rotation the publisher signs with the new key but forgets the record: warned, not refused
  const b = keygen(path.join(root, "keys-b"));
  const stale = run("sign", "--root", site, "--key", b.privateFile, "--origin", ORIGIN);
  assert.equal(stale.code, 0);
  assert.match(stale.out, new RegExp(`^WARNING: the \\.well-known/plumbline-key\\.json in .* is not the record of the key that signed \\(${b.record.kid}\\)`, "m"));
  assert.equal(JSON.parse(run("sign", "--root", site, "--key", b.privateFile, "--origin", ORIGIN, "--json").out).keyRecord, "mismatch");
});

// ---- p-e4efa2: every trust entry's origin is held to the origin rule ----

test("a trust entry whose origin breaks the origin rule (a trailing slash, a path, not https) makes the trust file unreadable (exit 2)", () => {
  const { site, keys } = signedSite();
  const trust = path.join(path.dirname(site), "hand.trust.json");
  for (const origin of ["https://site.example/", "https://site.example/path", "http://site.example", "site.example", "SECRET"]) {
    writeTrust(trust, [{ kid: keys.record.kid, origin, publicKey: keys.record.publicKey }]);
    const r = run("verify", "--root", site, "--trust", trust);
    assert.equal(r.code, 2, origin);
    assert.match(r.err, /a trust store entry is malformed/, origin);
    assert.ok(!r.err.includes("SECRET"));
  }
  writeTrust(trust, [{ kid: keys.record.kid, origin: ORIGIN, publicKey: keys.record.publicKey }]);
  assert.equal(run("verify", "--root", site, "--trust", trust).code, 0);
});

// ---- p-9f62b8 (part): trust with a file that is not a key record ----

test("trust refuses a --key file that is not a key record (exit 2) and writes nothing", () => {
  const root = scratchDir();
  const keys = keygen(path.join(root, "keys"));
  const file = path.join(root, "plumbline.trust.json");
  for (const [name, body] of [
    ["private", readFileSync(keys.privateFile, "utf8")],
    ["array", "[]"],
    ["no-key", JSON.stringify({ kid: keys.record.kid })],
  ] as const) {
    const notRecord = path.join(root, `${name}.json`);
    writeFileSync(notRecord, body);
    const r = run("trust", "--key", notRecord, "--origin", ORIGIN, "--file", file, "--yes");
    assert.equal(r.code, 2, name);
    assert.match(r.err, /not a Plumbline key record/, name);
  }
  assert.equal(existsSync(file), false);
});

// ---- UAT-7: one verdict vocabulary on the CLI and the Desk ----

test("UAT-7: a key revoked for one origin signing for another reads invalid revoked, as on the Desk, never 'unknown'; adopt too", () => {
  const { root, keys: a, trust } = signedSite();
  const mirror = path.join(root, "mirror");
  writeSite(mirror);
  const MIRROR = "https://mirror.example";
  assert.equal(run("sign", "--root", mirror, "--key", a.privateFile, "--origin", MIRROR).code, 0);
  // before the revocation: A is trusted for the clinic only, so the mirror's own-origin signature is a stranger's
  const before = JSON.parse(run("verify", "--root", mirror, "--trust", trust, "--origin", MIRROR, "--json").out).results[0];
  assert.equal(before.verdict, "unverifiable");
  // the verifier records A's revocation (as verifying the clinic's site does)
  const t = readTrust(trust);
  writeTrust(trust, t.entries.map((e) => ({ ...e, revokedAt: "2026-11-18T12:00:00.000Z" })));
  const after = JSON.parse(run("verify", "--root", mirror, "--trust", trust, "--origin", MIRROR, "--json").out).results[0];
  assert.deepEqual([after.verdict, after.reason, after.kid], ["invalid", "revoked", a.record.kid]);
  // a rotation the thief publishes from A for the mirror: adopt reads it as revoked, not as from an unknown key
  const b = keygen(path.join(root, "keys-thief"));
  assert.equal(run("rotate", "--root", mirror, "--old-key", a.privateFile, "--new-key", b.privateFile).code, 0);
  const adopt = run("adopt", "--root", mirror, "--origin", MIRROR, "--trust", trust, "--yes", "--json");
  assert.equal(adopt.code, 1, adopt.out + adopt.err);
  assert.match(adopt.out, /"reason":"revoked"/);
  assert.doesNotMatch(adopt.out, /unknown to this verifier/);
});

test("UAT-7: with the signature taken down, verify says what the revocation recorded, then unverifiable (exit 1), never a silent write", () => {
  const { site, keys: a, trust } = signedSite();
  assert.equal(run("revoke", "--root", site, "--key", a.privateFile, "--now", "2026-11-18T12:00:00.000Z").code, 0);
  rmSync(path.join(site, "plumbline.signature.json"));
  const r = run("verify", "--root", site, "--trust", trust);
  assert.equal(r.code, 1, r.err);
  assert.match(r.out, /revocation recorded/);
  assert.match(r.out, /^unverifiable - This site publishes no plumbline\.signature\.json/m);
  assert.equal(readTrust(trust).entries[0]?.revokedAt, "2026-11-18T12:00:00.000Z");
  const json = JSON.parse(run("verify", "--root", site, "--trust", trust, "--json").out);
  assert.equal(json.results[0].verdict, "unverifiable");
});
