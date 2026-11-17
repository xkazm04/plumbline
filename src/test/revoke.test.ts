// Revocation: a key declares itself dead, and a verifier that trusted it refuses everything it signs, whatever the dates.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalJson,
  applyRevocation,
  generateKey,
  revokeKey,
  rotateKey,
  signSubjects,
  verifyRotation,
  verifySignature,
  type GeneratedKey,
  type PlumblineRevocation,
  type SubjectFile,
  type TrustEntry,
  type TrustStore,
} from "../core/index.js";
import { signText } from "../core/keys.js";

const ORIGIN = "https://site.example";
const T0 = new Date("2026-11-17T12:00:00.000Z");
const LATER = new Date("2026-11-20T12:00:00.000Z");
const files: SubjectFile[] = [{ path: "agent-manifest.json", content: JSON.stringify({ name: "Site" }) }];

const entryOf = (g: GeneratedKey, origin = ORIGIN): TrustEntry => ({ kid: g.key.kid, origin, publicKey: g.key.publicKey });
const storeOf = (...entries: TrustEntry[]): TrustStore => ({
  find: (kid, origin) => entries.find((e) => e.kid === kid && e.origin === origin),
});

test("revokeKey: the exact wire shape, signed by the revoked key; reason omitted when absent", async () => {
  const k = await generateKey(T0);
  const r = await revokeKey({ privateKey: k.privateKey, key: k.key, now: LATER });
  assert.deepEqual(Object.keys(r).sort(), ["alg", "kid", "revokedAt", "sig", "type", "version"]);
  assert.equal(r.type, "plumbline-revocation");
  assert.equal(r.version, 1);
  assert.equal(r.alg, "Ed25519");
  assert.equal(r.kid, k.key.kid);
  assert.equal(r.revokedAt, LATER.toISOString());
  assert.ok(!canonicalJson(r).includes("null"));

  const withReason = await revokeKey({ privateKey: k.privateKey, key: k.key, now: LATER, reason: "laptop stolen" });
  assert.equal(withReason.reason, "laptop stolen");
  // the reason is covered by the signature: editing it breaks the revocation
  const edited = { ...withReason, reason: "routine" };
  assert.equal((await applyRevocation(edited, entryOf(k))).reason, "bad-signature");
});

test("revokeKey refuses a key record that does not belong to the private key, and an empty reason", async () => {
  const k = await generateKey(T0);
  const other = await generateKey(T0);
  await assert.rejects(revokeKey({ privateKey: k.privateKey, key: other.key }), /does not belong/);
  await assert.rejects(revokeKey({ privateKey: k.privateKey, key: k.key, reason: "  " }), /reason/);
});

test("revoke then verify: a signature by the revoked key is invalid / revoked", async () => {
  const k = await generateKey(T0);
  const signature = await signSubjects({ privateKey: k.privateKey, key: k.key, origin: ORIGIN, files, now: T0 });
  assert.equal((await verifySignature(signature, files, storeOf(entryOf(k)), { now: T0 })).verdict, "verified");

  const revocation = await revokeKey({ privateKey: k.privateKey, key: k.key, now: LATER });
  const applied = await applyRevocation(revocation, entryOf(k));
  assert.equal(applied.verdict, "verified");
  assert.equal(applied.kid, k.key.kid);
  assert.equal(applied.entry?.revokedAt, LATER.toISOString());

  const result = await verifySignature(signature, files, storeOf(applied.entry as TrustEntry), { now: T0 });
  assert.deepEqual([result.verdict, result.reason, result.kid, result.origin], ["invalid", "revoked", k.key.kid, ORIGIN]);
  assert.match(result.detail ?? "", /revoked/);
});

test("a backdated signature by a revoked key is still invalid / revoked: dates do not matter", async () => {
  const k = await generateKey(T0);
  const revocation = await revokeKey({ privateKey: k.privateKey, key: k.key, now: LATER });
  const { entry } = await applyRevocation(revocation, entryOf(k));
  // made with the leaked key, claiming a time long before the revocation
  const backdated = await signSubjects({
    privateKey: k.privateKey,
    key: k.key,
    origin: ORIGIN,
    files,
    now: new Date("2026-01-01T00:00:00.000Z"),
    lifetimeDays: 3650,
  });
  const result = await verifySignature(backdated, files, storeOf(entry as TrustEntry), { now: LATER });
  assert.deepEqual([result.verdict, result.reason], ["invalid", "revoked"]);
});

test("revocation is checked before the digests: a revoked signer's tampered files report revoked", async () => {
  const k = await generateKey(T0);
  const signature = await signSubjects({ privateKey: k.privateKey, key: k.key, origin: ORIGIN, files, now: T0 });
  const revoked: TrustEntry = { ...entryOf(k), revokedAt: LATER.toISOString() };
  const changed = [{ path: "agent-manifest.json", content: JSON.stringify({ name: "Other" }) }];
  assert.equal((await verifySignature(signature, changed, storeOf(revoked), { now: T0 })).reason, "revoked");
});

test("a revocation signed by another key is refused (bad-signature) and changes nothing", async () => {
  const k = await generateKey(T0);
  const attacker = await generateKey(T0);
  // the attacker signs a statement that claims to revoke k
  const unsigned = { type: "plumbline-revocation", version: 1, alg: "Ed25519", kid: k.key.kid, revokedAt: LATER.toISOString() };
  const forged = { ...unsigned, sig: await signText(attacker.privateKey, canonicalJson(unsigned)) } as PlumblineRevocation;
  const result = await applyRevocation(forged, entryOf(k));
  assert.deepEqual([result.verdict, result.reason], ["invalid", "bad-signature"]);
  assert.equal(result.entry, undefined);
  // the attacker's own valid revocation of their own key does not touch k's entry either
  const own = await revokeKey({ privateKey: attacker.privateKey, key: attacker.key, now: LATER });
  const mismatched = await applyRevocation(own, entryOf(k));
  assert.equal(mismatched.verdict, "unverifiable");
  assert.equal(mismatched.entry, undefined);
});

test("a revocation is checked under the key the verifier ALREADY trusts, never a key that arrives with it", async () => {
  const k = await generateKey(T0);
  const revocation = await revokeKey({ privateKey: k.privateKey, key: k.key, now: LATER });
  // nobody trusts k: nothing to revoke, and nothing in the statement can vouch for itself
  const stranger = await applyRevocation(revocation, undefined);
  assert.equal(stranger.verdict, "unverifiable");
  assert.equal(stranger.entry, undefined);
  // a poisoned trust entry (kid not derived from its key) is a defect, not a revocation
  const other = await generateKey(T0);
  const poisoned = await applyRevocation(revocation, { kid: k.key.kid, origin: ORIGIN, publicKey: other.key.publicKey });
  assert.deepEqual([poisoned.verdict, poisoned.reason], ["invalid", "kid-mismatch"]);
});

test("malformed revocations are invalid / malformed and never throw", async () => {
  const k = await generateKey(T0);
  const good = await revokeKey({ privateKey: k.privateKey, key: k.key, now: LATER });
  for (const bad of [null, {}, { ...good, type: "plumbline-rotation" }, { ...good, alg: "RS256" }, { ...good, kid: "XYZ" },
    { ...good, revokedAt: "yesterday" }, { ...good, reason: 7 }, { ...good, sig: "!!" }, { ...good, version: 2 }]) {
    const result = await applyRevocation(bad as PlumblineRevocation, entryOf(k));
    assert.deepEqual([result.verdict, result.reason], ["invalid", "malformed"]);
  }
});

test("a rotation from a revoked key is invalid / revoked, even one signed before the revocation", async () => {
  const k = await generateKey(T0);
  const successor = await generateKey(T0);
  // the thief's rotation: a perfectly valid statement by the leaked key, naming the thief's key
  const rotation = await rotateKey({ oldPrivateKey: k.privateKey, oldKey: k.key, newKey: successor.key, now: T0 });
  assert.equal((await verifyRotation(rotation, storeOf(entryOf(k)), ORIGIN)).verdict, "verified");

  const { entry } = await applyRevocation(await revokeKey({ privateKey: k.privateKey, key: k.key, now: LATER }), entryOf(k));
  const result = await verifyRotation(rotation, storeOf(entry as TrustEntry), ORIGIN);
  assert.deepEqual([result.verdict, result.reason, result.kid], ["invalid", "revoked", k.key.kid]);
});

test("applying a revocation twice keeps the earliest revokedAt", async () => {
  const k = await generateKey(T0);
  const first = await applyRevocation(await revokeKey({ privateKey: k.privateKey, key: k.key, now: T0 }), entryOf(k));
  const again = await applyRevocation(await revokeKey({ privateKey: k.privateKey, key: k.key, now: LATER }), first.entry);
  assert.equal(again.verdict, "verified");
  assert.equal(again.entry?.revokedAt, T0.toISOString());
});

test("expectedOrigin: a signature for another origin is unverifiable, an invalid one stays invalid, a match is unchanged", async () => {
  const k = await generateKey(T0);
  const signature = await signSubjects({ privateKey: k.privateKey, key: k.key, origin: ORIGIN, files, now: T0 });
  const trust = storeOf(entryOf(k));
  const same = await verifySignature(signature, files, trust, { now: T0, expectedOrigin: ORIGIN });
  assert.equal(same.verdict, "verified");
  const elsewhere = await verifySignature(signature, files, trust, { now: T0, expectedOrigin: "https://mirror.example" });
  assert.equal(elsewhere.verdict, "unverifiable");
  assert.equal(elsewhere.reason, undefined);
  assert.equal(elsewhere.detail, "The files may be genuine but are not attested for the origin they were checked as: the signature names a different origin (see the result's origin field).");
  assert.equal(elsewhere.origin, "https://site.example");
  const changed = [{ path: "agent-manifest.json", content: JSON.stringify({ name: "Other" }) }];
  const tampered = await verifySignature(signature, changed, trust, { now: T0, expectedOrigin: "https://mirror.example" });
  assert.deepEqual([tampered.verdict, tampered.reason], ["invalid", "tampered"]);
});
