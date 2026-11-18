// Rotation: the old key names its successor; trust moves only on the word of a key the verifier already holds, across a
// chain of rotations when the site publishes one.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adoptRotation,
  applyRevocationText,
  canonicalJson,
  generateKey,
  revokeKey,
  rotateKey,
  spreadRevocations,
  statementsOf,
  walkRotationChain,
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
  const files = [{ path: "agent-manifest.json", content: JSON.stringify({ name: "Site" }) }];
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

// ---- p-86391a: a rotation chain, walked from the newest key the verifier trusts ----

/** Keys k0..kn and the chain k0 -> k1 -> ... -> kn, each statement signed by the previous key. */
async function chainOf(n: number): Promise<{ keys: GeneratedKey[]; chain: PlumblineRotation[] }> {
  const keys: GeneratedKey[] = [];
  for (let i = 0; i <= n; i++) keys.push(await generateKey(T0));
  const chain: PlumblineRotation[] = [];
  for (let i = 0; i < n; i++) {
    const [from, to] = [keys[i] as GeneratedKey, keys[i + 1] as GeneratedKey];
    chain.push(await rotateKey({ oldPrivateKey: from.privateKey, oldKey: from.key, newKey: to.key, now: T0 }));
  }
  return { keys, chain };
}
const entry = (g: GeneratedKey, origin = ORIGIN): TrustEntry => ({ kid: g.key.kid, origin, publicKey: g.key.publicKey });

test("walkRotationChain: a verifier two rotations behind follows the chain, each successor adopted via the key before it", async () => {
  const { keys, chain } = await chainOf(3);
  const [k0, k1, k2, k3] = keys as [GeneratedKey, GeneratedKey, GeneratedKey, GeneratedKey];
  const walk = await walkRotationChain(chain, [entry(k0)], ORIGIN);
  assert.equal(walk.result.verdict, "verified", walk.result.detail);
  assert.equal(walk.brokenAt, undefined);
  assert.equal(walk.newest, k3.key.kid);
  assert.deepEqual(walk.hops.map((h) => [h.index, h.result.verdict]), [[0, "verified"], [1, "verified"], [2, "verified"]]);
  assert.deepEqual(walk.entries, [
    { kid: k1.key.kid, origin: ORIGIN, publicKey: k1.key.publicKey, adoptedVia: k0.key.kid },
    { kid: k2.key.kid, origin: ORIGIN, publicKey: k2.key.publicKey, adoptedVia: k1.key.kid },
    { kid: k3.key.kid, origin: ORIGIN, publicKey: k3.key.publicKey, adoptedVia: k2.key.kid },
  ]);
  // revoking the first key still cascades through every hop the chain was adopted through
  const revoked = spreadRevocations([{ ...entry(k0), revokedAt: T0.toISOString() }, ...walk.entries]);
  assert.ok(revoked.every((e) => e.revokedAt !== undefined));
});

test("walkRotationChain starts at the NEWEST trusted key, and a single statement behaves as verifyRotation always did", async () => {
  const { keys, chain } = await chainOf(3);
  const [k0, k1, k2, k3] = keys as [GeneratedKey, GeneratedKey, GeneratedKey, GeneratedKey];
  // the first statement is garbage now, but a verifier that trusts k2 never walks it (its shape is all that is checked)
  const flipped = { ...(chain[0] as PlumblineRotation), sig: "AAAA" };
  const walk = await walkRotationChain([flipped, chain[1], chain[2]], [entry(k0), entry(k2)], ORIGIN);
  assert.equal(walk.result.verdict, "verified");
  assert.deepEqual(walk.hops.map((h) => h.index), [2]);
  assert.deepEqual(walk.entries.map((e) => [e.kid, e.adoptedVia]), [[k3.key.kid, k2.key.kid]]);
  void k1;

  const single = await walkRotationChain([chain[0]], [entry(k0)], ORIGIN);
  assert.deepEqual(single.result, await verifyRotation(chain[0] as PlumblineRotation, trustOf([k0, ORIGIN]), ORIGIN));
  const stranger = await walkRotationChain([chain[0]], [], ORIGIN);
  assert.equal(stranger.result.verdict, "unverifiable");
  assert.deepEqual(stranger.entries, []);
});

test("walkRotationChain: a broken link, a bad signature or a revoked key mid-chain stops the walk, names where, adopts nothing", async () => {
  const { keys, chain } = await chainOf(3);
  const [k0, , , k3] = keys as [GeneratedKey, GeneratedKey, GeneratedKey, GeneratedKey];
  const other = await chainOf(1); // x -> y, signed by x: links to nothing in this chain
  const broken = await walkRotationChain([chain[0], other.chain[0], chain[2]], [entry(k0)], ORIGIN);
  assert.deepEqual([broken.result.verdict, broken.result.reason, broken.brokenAt], ["invalid", "malformed", 1]);
  assert.match(broken.result.detail ?? "", /breaks at statement 1/);
  assert.deepEqual(broken.entries, []);

  const forged = { ...(chain[1] as PlumblineRotation), toPublicKey: k3.key.publicKey, to: k3.key.kid };
  const bad = await walkRotationChain([chain[0], forged], [entry(k0)], ORIGIN);
  assert.deepEqual([bad.result.verdict, bad.result.reason, bad.brokenAt], ["invalid", "bad-signature", 1]);
  assert.match(bad.result.detail ?? "", /^Statement 1 of the rotation chain/);
  assert.deepEqual(bad.entries, []);

  // the middle key was revoked (recorded in the trust file): its rotation is not honoured, nor anything after it
  const k1 = keys[1] as GeneratedKey;
  const revoked = await walkRotationChain(chain, [entry(k0), { ...entry(k1), origin: "https://other.example", revokedAt: T0.toISOString() }], ORIGIN);
  assert.deepEqual([revoked.result.verdict, revoked.result.reason, revoked.brokenAt], ["invalid", "revoked", 0]);
  assert.deepEqual(revoked.entries, []);

  const malformed = await walkRotationChain([chain[0], { nope: true }], [entry(k0)], ORIGIN);
  assert.deepEqual([malformed.result.reason, malformed.brokenAt], ["malformed", 1]);
  assert.equal((await walkRotationChain([], [entry(k0)], ORIGIN)).result.reason, "malformed");
});

test("statementsOf: one object or a list of 1..64; an empty or longer list and a non-object are problems", () => {
  assert.deepEqual(statementsOf({ a: 1 }), { statements: [{ a: 1 }] });
  assert.deepEqual(statementsOf([{ a: 1 }, { b: 2 }]), { statements: [{ a: 1 }, { b: 2 }] });
  assert.ok("problem" in statementsOf([]));
  assert.ok("problem" in statementsOf(new Array(65).fill({})));
  assert.ok(!("problem" in statementsOf(new Array(64).fill({}))));
  for (const v of [null, 4, "x", true]) assert.ok("problem" in statementsOf(v));
});

// ---- p-ba60fb: a successor the trust store records as revoked is never adopted ----

test("adoptRotation refuses a successor recorded as revoked in any entry; the walk reports it as invalid revoked for that key", async () => {
  const { keys, chain } = await chainOf(1);
  const [k0, k1] = keys as [GeneratedKey, GeneratedKey];
  const store = [entry(k0), { ...entry(k1, "https://elsewhere.example"), revokedAt: T0.toISOString() }];
  assert.throws(() => adoptRotation(chain[0] as PlumblineRotation, store, ORIGIN), /successor key is recorded as revoked/);
  const walk = await walkRotationChain(chain, store, ORIGIN);
  assert.deepEqual([walk.result.verdict, walk.result.reason, walk.result.kid], ["invalid", "revoked", k1.key.kid]);
  assert.deepEqual(walk.entries, []);
  // the same revocation reached through a revocation file (applyRevocationText), not by hand
  const statement = await revokeKey({ privateKey: k1.privateKey, key: k1.key, now: T0 });
  const outcome = await applyRevocationText(JSON.stringify(statement), [entry(k0), entry(k1, "https://elsewhere.example")]);
  assert.equal(outcome.applied, true);
  assert.throws(() => adoptRotation(chain[0] as PlumblineRotation, outcome.entries, ORIGIN), /revoked/);
});
