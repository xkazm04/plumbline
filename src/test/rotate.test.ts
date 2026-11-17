// Rotation: the old key names its successor; trust moves only on the word of a key the verifier already holds.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalJson,
  generateKey,
  rotateKey,
  signSubjects,
  verifyRotation,
  verifySignature,
  type GeneratedKey,
  type PlumblineRotation,
  type TrustEntry,
  type TrustStore,
} from "../core/index.js";
import { signText } from "../core/keys.js";

const ORIGIN = "https://site.example";
const T0 = new Date("2026-11-17T12:00:00.000Z");

function trustOf(...pairs: [GeneratedKey, string][]): TrustStore & { add(e: TrustEntry): void } {
  const entries: TrustEntry[] = pairs.map(([g, origin]) => ({ kid: g.key.kid, origin, publicKey: g.key.publicKey }));
  return {
    find: (kid, origin) => entries.find((e) => e.kid === kid && e.origin === origin),
    add: (e) => void entries.push(e),
  };
}

test("rotateKey: a statement signed by the old key", async () => {
  const oldK = await generateKey(T0);
  const newK = await generateKey(T0);
  const r = await rotateKey({ oldPrivateKey: oldK.privateKey, oldKey: oldK.key, newKey: newK.key, now: T0 });
  assert.deepEqual(Object.keys(r).sort(), ["from", "sig", "signedAt", "to", "toPublicKey", "type", "version"]);
  assert.equal(r.type, "plumbline-rotation");
  assert.equal(r.from, oldK.key.kid);
  assert.equal(r.to, newK.key.kid);
  assert.equal(r.toPublicKey, newK.key.publicKey);
  assert.equal(r.signedAt, T0.toISOString());
});

test("rotateKey refuses a new key whose kid is not derived from its public key, and an old key that does not match", async () => {
  const oldK = await generateKey(T0);
  const newK = await generateKey(T0);
  const third = await generateKey(T0);
  await assert.rejects(
    rotateKey({ oldPrivateKey: oldK.privateKey, oldKey: oldK.key, newKey: { ...newK.key, kid: third.key.kid } }),
    /new key/,
  );
  await assert.rejects(
    rotateKey({ oldPrivateKey: oldK.privateKey, oldKey: third.key, newKey: newK.key }),
    /old key/,
  );
  await assert.rejects(rotateKey({ oldPrivateKey: oldK.privateKey, oldKey: oldK.key, newKey: oldK.key }), /different key/);
});

test("a statement from a trusted old key is verified and moves trust to the new kid", async () => {
  const oldK = await generateKey(T0);
  const newK = await generateKey(T0);
  const trust = trustOf([oldK, ORIGIN]);
  const files = [{ path: "agent-manifest.json", content: { name: "Site" } }];
  const afterRotation = await signSubjects({ privateKey: newK.privateKey, key: newK.key, origin: ORIGIN, files, now: T0 });

  // before adopting: the new key's signature is from a stranger
  assert.equal((await verifySignature(afterRotation, files, trust, { now: T0 })).verdict, "unverifiable");

  const rotation = await rotateKey({ oldPrivateKey: oldK.privateKey, oldKey: oldK.key, newKey: newK.key, now: T0 });
  const verdict = await verifyRotation(rotation, trust, ORIGIN);
  assert.deepEqual([verdict.verdict, verdict.kid, verdict.origin], ["verified", oldK.key.kid, ORIGIN]);

  // the caller adopts the new key on a verified statement; the new key's signature now verifies
  trust.add({ kid: rotation.to, origin: ORIGIN, publicKey: rotation.toPublicKey });
  assert.equal((await verifySignature(afterRotation, files, trust, { now: T0 })).verdict, "verified");
});

test("a statement signed by an untrusted key is unverifiable, never verified", async () => {
  const stranger = await generateKey(T0);
  const newK = await generateKey(T0);
  const rotation = await rotateKey({ oldPrivateKey: stranger.privateKey, oldKey: stranger.key, newKey: newK.key, now: T0 });
  const trustedElsewhere = await generateKey(T0);
  const result = await verifyRotation(rotation, trustOf([trustedElsewhere, ORIGIN]), ORIGIN);
  assert.equal(result.verdict, "unverifiable");
  assert.equal(result.kid, stranger.key.kid);
  // the same old key trusted for a different origin is still a stranger here
  assert.equal((await verifyRotation(rotation, trustOf([stranger, "https://other.example"]), ORIGIN)).verdict, "unverifiable");
});

test("a statement with a wrong `to` is invalid, even when the old key signed it", async () => {
  const oldK = await generateKey(T0);
  const newK = await generateKey(T0);
  const other = await generateKey(T0);
  const unsigned = {
    type: "plumbline-rotation",
    version: 1,
    from: oldK.key.kid,
    to: other.key.kid, // not derived from toPublicKey
    toPublicKey: newK.key.publicKey,
    signedAt: T0.toISOString(),
  };
  const rotation = { ...unsigned, sig: await signText(oldK.privateKey, canonicalJson(unsigned)) } as PlumblineRotation;
  const result = await verifyRotation(rotation, trustOf([oldK, ORIGIN]), ORIGIN);
  assert.deepEqual([result.verdict, result.reason], ["invalid", "kid-mismatch"]);
});

test("a tampered statement (public key swapped, or signature flipped) is invalid / bad-signature", async () => {
  const oldK = await generateKey(T0);
  const newK = await generateKey(T0);
  const evil = await generateKey(T0);
  const trust = trustOf([oldK, ORIGIN]);
  const rotation = await rotateKey({ oldPrivateKey: oldK.privateKey, oldKey: oldK.key, newKey: newK.key, now: T0 });
  const swapped = { ...rotation, to: evil.key.kid, toPublicKey: evil.key.publicKey };
  const r1 = await verifyRotation(swapped, trust, ORIGIN);
  assert.deepEqual([r1.verdict, r1.reason], ["invalid", "bad-signature"]);
  const flipped = { ...rotation, sig: (rotation.sig[0] === "A" ? "B" : "A") + rotation.sig.slice(1) };
  const r2 = await verifyRotation(flipped, trust, ORIGIN);
  assert.deepEqual([r2.verdict, r2.reason], ["invalid", "bad-signature"]);
  const later = { ...rotation, signedAt: "2026-11-18T12:00:00.000Z" };
  assert.equal((await verifyRotation(later, trust, ORIGIN)).reason, "bad-signature");
});

test("malformed statements and a poisoned trust entry are invalid", async () => {
  const oldK = await generateKey(T0);
  const newK = await generateKey(T0);
  const other = await generateKey(T0);
  const rotation = await rotateKey({ oldPrivateKey: oldK.privateKey, oldKey: oldK.key, newKey: newK.key, now: T0 });
  for (const bad of [null, {}, { ...rotation, type: "x" }, { ...rotation, from: "nope" }, { ...rotation, sig: 4 }, { ...rotation, signedAt: "soon" }]) {
    const result = await verifyRotation(bad as PlumblineRotation, trustOf([oldK, ORIGIN]), ORIGIN);
    assert.deepEqual([result.verdict, result.reason], ["invalid", "malformed"]);
  }
  const poisoned: TrustStore = { find: (kid, origin) => ({ kid, origin, publicKey: other.key.publicKey }) };
  assert.equal((await verifyRotation(rotation, poisoned, ORIGIN)).reason, "kid-mismatch");
});
