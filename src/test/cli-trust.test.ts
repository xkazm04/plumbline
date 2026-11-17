// The verifier's side of the key lifecycle through the built CLI: first contact (`trust`), adopting a published
// rotation (`adopt`), recording an accepted revocation in the trust file, refusing to sign with a revoked key, and each
// signing command's own usage on a usage error.
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ORIGIN, keygen, readTrust, run, scratchDir, writeSite, writeTrust } from "./cli-helpers.js";

/** A site signed by a fresh key, and a trust file that trusts that key for ORIGIN. */
function signedSite(): { root: string; site: string; keys: ReturnType<typeof keygen>; trust: string } {
  const root = scratchDir();
  const site = path.join(root, "site");
  writeSite(site);
  const keys = keygen(path.join(root, "keys"));
  const signed = run("sign", "--root", site, "--key", keys.privateFile, "--origin", ORIGIN);
  assert.equal(signed.code, 0, signed.err);
  const trust = writeTrust(path.join(root, "plumbline.trust.json"), [{ kid: keys.record.kid, origin: ORIGIN, publicKey: keys.record.publicKey }]);
  assert.equal(run("verify", "--root", site, "--trust", trust).code, 0, "verified before anything else happens");
  return { root, site, keys, trust };
}

// ---- p-8a9c57: an accepted revocation is written to the trust file ----

test("verify records an accepted revocation in the trust file, so the key stays dead once the revocation file is gone", () => {
  const { site, keys, trust } = signedSite();
  // the same key also trusted at another origin, an unknown top-level member and an unknown entry member: all kept
  const here = { kid: keys.record.kid, origin: ORIGIN, publicKey: keys.record.publicKey, label: "the publisher" };
  writeTrust(trust, [here, { ...here, origin: "https://mirror.example" }], { comment: "kept by hand" });

  assert.equal(run("revoke", "--root", site, "--key", keys.privateFile, "--now", "2026-11-18T12:00:00.000Z").code, 0);
  const first = run("verify", "--root", site, "--trust", trust);
  assert.equal(first.code, 1);
  assert.match(first.out, /^revocation applied/m);
  assert.match(first.out, new RegExp(`^revocation recorded in ${trust.replace(/[\\.]/g, "\\$&")} \\(2 entries\\)`, "m"));
  assert.match(first.out, /^invalid revoked/m);

  const stored = readTrust(trust);
  assert.equal(stored.comment, "kept by hand");
  assert.deepEqual(stored.entries.map((e) => e.revokedAt), ["2026-11-18T12:00:00.000Z", "2026-11-18T12:00:00.000Z"]);
  assert.deepEqual(stored.entries.map((e) => e.label), ["the publisher", "the publisher"]);

  // the file is already up to date: verify says so and leaves it alone
  const before = readFileSync(trust, "utf8");
  const again = JSON.parse(run("verify", "--root", site, "--trust", trust, "--json").out);
  assert.equal(again.revocation.applied, true);
  assert.equal(again.revocation.recorded, false);
  assert.equal(readFileSync(trust, "utf8"), before);

  // the leaked key's holder serves the site without the revocation: the trust file still remembers
  rmSync(path.join(site, "plumbline-revocation.json"));
  const replay = run("verify", "--root", site, "--trust", trust, "--json");
  assert.equal(replay.code, 1);
  const parsed = JSON.parse(replay.out);
  assert.deepEqual([parsed.results[0].verdict, parsed.results[0].reason], ["invalid", "revoked"]);
  assert.equal(parsed.revocation, undefined);
});

test("verify --json reports recorded: true and the trust file it wrote; a refused revocation writes nothing", () => {
  const { site, keys, trust } = signedSite();
  const thief = keygen(path.join(path.dirname(trust), "thief"));
  // a revocation by another key, relabelled with the publisher's kid: refused, and the trust file is untouched
  assert.equal(run("revoke", "--root", site, "--key", thief.privateFile).code, 0);
  const file = path.join(site, "plumbline-revocation.json");
  const forged = JSON.parse(readFileSync(file, "utf8"));
  forged.kid = keys.record.kid;
  writeFileSync(file, JSON.stringify(forged));
  const before = readFileSync(trust, "utf8");
  const refused = JSON.parse(run("verify", "--root", site, "--trust", trust, "--json").out);
  assert.equal(refused.revocation.applied, false);
  assert.equal(refused.revocation.recorded, false);
  assert.equal(readFileSync(trust, "utf8"), before);

  assert.equal(run("revoke", "--root", site, "--key", keys.privateFile).code, 0);
  const accepted = JSON.parse(run("verify", "--root", site, "--trust", trust, "--json").out);
  assert.equal(accepted.revocation.recorded, true);
  assert.equal(accepted.revocation.trustFile, trust);
});

// ---- p-5288ec: sign refuses a key the site's revocation names ----

test("sign refuses to sign with a key the site's plumbline-revocation.json revokes (exit 2, points at keygen)", () => {
  const { root, site, keys } = signedSite();
  assert.equal(run("revoke", "--root", site, "--key", keys.privateFile).code, 0);
  const before = readFileSync(path.join(site, "plumbline.signature.json"), "utf8");
  const refused = run("sign", "--root", site, "--key", keys.privateFile, "--origin", ORIGIN);
  assert.equal(refused.code, 2);
  assert.match(refused.err, /revoked/);
  assert.match(refused.err, /keygen/);
  assert.equal(readFileSync(path.join(site, "plumbline.signature.json"), "utf8"), before, "no new signature written");

  // the publisher's normal path after a leak: a NEW key signs, with the old key's revocation still published
  const fresh = keygen(path.join(root, "keys-new"));
  assert.equal(run("sign", "--root", site, "--key", fresh.privateFile, "--origin", ORIGIN).code, 0);
});

test("sign ignores a revocation file that does not verify under the signing key (someone else's, or not JSON)", () => {
  const { root, site, keys } = signedSite();
  const other = keygen(path.join(root, "other"));
  assert.equal(run("revoke", "--root", site, "--key", other.privateFile).code, 0);
  const file = path.join(site, "plumbline-revocation.json");
  const forged = JSON.parse(readFileSync(file, "utf8"));
  forged.kid = keys.record.kid;
  writeFileSync(file, JSON.stringify(forged));
  assert.equal(run("sign", "--root", site, "--key", keys.privateFile, "--origin", ORIGIN).code, 0);
  writeFileSync(file, "{ not json");
  assert.equal(run("sign", "--root", site, "--key", keys.privateFile, "--origin", ORIGIN).code, 0);
});

// ---- p-0e8d6d: the first-contact ceremony ----

test("trust without --yes prints the kid and the first-contact warning, adds nothing and exits 1", () => {
  const root = scratchDir();
  const keys = keygen(path.join(root, "keys"));
  const file = path.join(root, "plumbline.trust.json");
  const r = run("trust", "--key", keys.recordFile, "--origin", ORIGIN, "--file", file);
  assert.equal(r.code, 1, r.err);
  assert.match(r.out, new RegExp(`kid ${keys.record.kid}`));
  assert.match(r.out, /out of band/);
  assert.match(r.out, /rerun with --yes/);
  assert.equal(existsSync(file), false, "nothing written");
  const json = JSON.parse(run("trust", "--key", keys.recordFile, "--origin", ORIGIN, "--file", file, "--json").out);
  assert.deepEqual([json.kid, json.origin, json.added], [keys.record.kid, ORIGIN, false]);
});

test("trust --yes appends {kid, origin, publicKey}, and verify then answers verified; a second run adds nothing", () => {
  const { site, keys, root } = signedSite();
  const file = path.join(root, "fresh.trust.json");
  const unknown = run("verify", "--root", site, "--trust", writeTrust(file, []));
  assert.equal(unknown.code, 1);
  assert.match(unknown.out, /^unverifiable/m);

  const added = run("trust", "--key", keys.recordFile, "--origin", ORIGIN, "--file", file, "--yes");
  assert.equal(added.code, 0, added.err);
  assert.deepEqual(readTrust(file).entries, [{ kid: keys.record.kid, origin: ORIGIN, publicKey: keys.record.publicKey }]);
  assert.equal(run("verify", "--root", site, "--trust", file).code, 0);

  const twice = run("trust", "--key", keys.recordFile, "--origin", ORIGIN, "--file", file, "--yes", "--json");
  assert.equal(twice.code, 0);
  assert.equal(JSON.parse(twice.out).added, false);
  assert.equal(readTrust(file).entries.length, 1);

  // a missing trust file is created
  const created = path.join(root, "new", "plumbline.trust.json");
  assert.equal(run("trust", "--key", keys.recordFile, "--origin", ORIGIN, "--file", created, "--yes").code, 0);
  assert.equal(readTrust(created).entries.length, 1);
});

test("trust refuses a key record whose kid is not derived from its key, a bad origin, and a key this store revoked (exit 2)", () => {
  const root = scratchDir();
  const keys = keygen(path.join(root, "keys"));
  const other = keygen(path.join(root, "other"));
  const file = path.join(root, "plumbline.trust.json");

  const lying = path.join(root, "lying.json");
  writeFileSync(lying, JSON.stringify({ ...keys.record, publicKey: other.record.publicKey }));
  const mismatch = run("trust", "--key", lying, "--origin", ORIGIN, "--file", file, "--yes");
  assert.equal(mismatch.code, 2);
  assert.match(mismatch.err, /not derived/);
  assert.equal(existsSync(file), false);

  const bad = run("trust", "--key", keys.recordFile, "--origin", "https://site.example/path", "--file", file, "--yes");
  assert.equal(bad.code, 2);
  assert.match(bad.err, /usage: plumbline trust/);

  writeTrust(file, [{ kid: keys.record.kid, origin: "https://elsewhere.example", publicKey: keys.record.publicKey, revokedAt: "2026-11-18T12:00:00.000Z" }]);
  const revoked = run("trust", "--key", keys.recordFile, "--origin", ORIGIN, "--file", file, "--yes");
  assert.equal(revoked.code, 2);
  assert.match(revoked.err, /revoked/);
  assert.equal(readTrust(file).entries.length, 1);
});

// ---- p-b38569: adopt a published rotation, never automatically ----

/** A site moved from an old key to a new one: rotation published, re-signed by the new key; the verifier trusts the old. */
function rotatedSite(): { site: string; trust: string; oldKeys: ReturnType<typeof keygen>; newKeys: ReturnType<typeof keygen>; root: string } {
  const { root, site, keys: oldKeys, trust } = signedSite();
  const newKeys = keygen(path.join(root, "keys-next"));
  assert.equal(run("rotate", "--root", site, "--old-key", oldKeys.privateFile, "--new-key", newKeys.privateFile).code, 0);
  assert.equal(run("sign", "--root", site, "--key", newKeys.privateFile, "--origin", ORIGIN).code, 0);
  return { root, site, trust, oldKeys, newKeys };
}

test("adopt without --yes shows the verified rotation and changes nothing; with --yes it adds the successor via adoptedVia", () => {
  const { site, trust, oldKeys, newKeys } = rotatedSite();
  const before = readFileSync(trust, "utf8");
  const stranger = run("verify", "--root", site, "--trust", trust);
  assert.equal(stranger.code, 1);
  assert.match(stranger.out, /^unverifiable/m);
  assert.match(stranger.out, /plumbline adopt/, "verify points at adopt when a rotation is published");

  const dry = run("adopt", "--root", site, "--trust", trust, "--origin", ORIGIN);
  assert.equal(dry.code, 1, dry.err);
  assert.match(dry.out, new RegExp(`${oldKeys.record.kid} -> ${newKeys.record.kid}`));
  assert.match(dry.out, /rerun with --yes/);
  assert.equal(readFileSync(trust, "utf8"), before, "nothing adopted without --yes");

  const yes = run("adopt", "--root", site, "--trust", trust, "--origin", ORIGIN, "--yes", "--json");
  assert.equal(yes.code, 0, yes.err);
  assert.equal(JSON.parse(yes.out).added, true);
  const entries = readTrust(trust).entries;
  assert.deepEqual(entries[1], { kid: newKeys.record.kid, origin: ORIGIN, publicKey: newKeys.record.publicKey, adoptedVia: oldKeys.record.kid });
  assert.equal(run("verify", "--root", site, "--trust", trust).code, 0);

  const twice = run("adopt", "--root", site, "--trust", trust, "--origin", ORIGIN, "--yes", "--json");
  assert.equal(twice.code, 0);
  assert.equal(JSON.parse(twice.out).added, false);
  assert.equal(readTrust(trust).entries.length, 2);
});

test("adopt refuses a rotation from a key it does not trust, from a revoked key, and for another origin (exit 1)", () => {
  const { root, site, trust, oldKeys } = rotatedSite();
  const before = readFileSync(trust, "utf8");

  const empty = writeTrust(path.join(root, "empty.trust.json"), []);
  const unknown = run("adopt", "--root", site, "--trust", empty, "--origin", ORIGIN, "--yes");
  assert.equal(unknown.code, 1);
  assert.match(unknown.out, /^unverifiable/m);
  assert.equal(readTrust(empty).entries.length, 0);

  const elsewhere = run("adopt", "--root", site, "--trust", trust, "--origin", "https://other.example", "--yes");
  assert.equal(elsewhere.code, 1);
  assert.equal(readFileSync(trust, "utf8"), before);

  // the old key revoked itself: the published revocation is applied (and recorded) before the rotation is judged
  assert.equal(run("revoke", "--root", site, "--key", oldKeys.privateFile).code, 0);
  const revoked = run("adopt", "--root", site, "--trust", trust, "--origin", ORIGIN, "--yes");
  assert.equal(revoked.code, 1);
  assert.match(revoked.out, /^invalid revoked/m);
  assert.ok(readTrust(trust).entries.every((e) => e.adoptedVia === undefined), "no successor adopted");
  assert.ok(readTrust(trust).entries.every((e) => e.revokedAt !== undefined), "the revocation was recorded");

  const missing = run("adopt", "--root", root, "--trust", trust, "--origin", ORIGIN);
  assert.equal(missing.code, 2);
  assert.match(missing.err, /plumbline-rotation\.json not found/);
});

// ---- Dowser 1e601ffd: each signing command shows its own options on a usage error ----

test("every signing command prints its own usage line on a usage error, and --json carries it", () => {
  for (const command of ["keygen", "sign", "verify", "rotate", "revoke", "trust", "adopt"]) {
    const missing = run(command);
    assert.equal(missing.code, 2, command);
    assert.match(missing.err, new RegExp(`^usage: plumbline ${command} --`, "m"), command);
    const unknown = run(command, "--bogus", "x");
    assert.equal(unknown.code, 2, command);
    assert.match(unknown.err, /unknown option: --bogus/, command);
    assert.match(unknown.err, new RegExp(`^usage: plumbline ${command} --`, "m"), command);
  }
  const json = JSON.parse(run("sign", "--json").out);
  assert.match(json.error, /missing --root/);
  assert.match(json.usage, /^usage: plumbline sign --root/);

  // an I/O error is not a usage error: no usage line
  const root = scratchDir();
  const io = run("verify", "--root", root, "--trust", path.join(root, "absent.json"));
  assert.equal(io.code, 2);
  assert.doesNotMatch(io.err, /usage:/);
});
