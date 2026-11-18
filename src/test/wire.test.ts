// check:wire. Pins the exact strings other code and other sites read. A change here is a format change.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ALG,
  DRIFT_KINDS,
  FORMAT_VERSION,
  GATE_STATES,
  INVALID_REASONS,
  KEY_FILE,
  LOCK_STATES,
  KEY_TYPE,
  KID_PATTERN,
  LINKS_FILE,
  LOCK_FILE,
  MANIFEST_FILE,
  PEER_LINKS_ABSENT,
  PRIVATE_KEY_FILE,
  PRIVATE_KEY_TYPE,
  PUBLIC_KEY_PATTERN,
  SHA256_PATTERN,
  SUBJECT_PATH_PATTERN,
  REVOCATION_FILE,
  REVOCATION_TYPE,
  ROTATION_FILE,
  ROTATION_TYPE,
  SEVERITIES,
  SIGNATURE_FILE,
  SIGNATURE_TYPE,
  VERDICTS,
} from "../core/types.js";

test("document types, version and algorithm", () => {
  assert.equal(SIGNATURE_TYPE, "plumbline-signature");
  assert.equal(KEY_TYPE, "plumbline-key");
  assert.equal(ROTATION_TYPE, "plumbline-rotation");
  assert.equal(REVOCATION_TYPE, "plumbline-revocation");
  assert.equal(FORMAT_VERSION, 1);
  assert.equal(ALG, "Ed25519");
});

test("published file names", () => {
  assert.equal(SIGNATURE_FILE, "plumbline.signature.json");
  assert.equal(KEY_FILE, ".well-known/plumbline-key.json");
  assert.equal(ROTATION_FILE, "plumbline-rotation.json");
  assert.equal(REVOCATION_FILE, "plumbline-revocation.json");
  assert.equal(LOCK_FILE, "plumbline.lock.json");
  assert.equal(MANIFEST_FILE, "agent-manifest.json");
  assert.equal(LINKS_FILE, "links.json");
});

test("the private key file: its name and type string (the CLI writes it, the Desk reads it; never published)", async () => {
  assert.equal(PRIVATE_KEY_FILE, "plumbline.private.json");
  assert.equal(PRIVATE_KEY_TYPE, "plumbline-private-key");
  const { generateKey, isPrivateKeyFile } = await import("../core/index.js");
  const k = await generateKey(new Date("2026-11-17T12:00:00.000Z"));
  const file = { type: PRIVATE_KEY_TYPE, version: 1, alg: "Ed25519", kid: k.key.kid, privateKey: k.privateKey };
  assert.equal(isPrivateKeyFile(file), true);
  assert.deepEqual(Object.keys(file).sort(), ["alg", "kid", "privateKey", "type", "version"]);
});

test("the exact patterns every inbound kid, public key, digest and subject path is held to", () => {
  assert.equal(KID_PATTERN.source, "^[0-9a-f]{16}$");
  assert.equal(PUBLIC_KEY_PATTERN.source, "^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$");
  assert.equal(SHA256_PATTERN.source, "^[0-9a-f]{64}$");
  assert.equal(SUBJECT_PATH_PATTERN.source, "^[A-Za-z0-9._/-]+$");
  for (const p of [KID_PATTERN, PUBLIC_KEY_PATTERN, SHA256_PATTERN, SUBJECT_PATH_PATTERN]) assert.equal(p.flags, "");
});

test("a subject's sha256 is SHA-256 of the file's exact bytes (since 2026-11-17), never of a re-serialisation", async () => {
  const { generateKey, sha256Hex, signSubjects } = await import("../core/index.js");
  const k = await generateKey(new Date("2026-11-17T12:00:00.000Z"));
  const manifest = '{ "b": 1,\n  "a": 2 }\r\n';
  const sig = await signSubjects({ privateKey: k.privateKey, key: k.key, origin: "https://w.example", files: [{ path: MANIFEST_FILE, content: manifest }] });
  assert.deepEqual(sig.subjects, [{ path: MANIFEST_FILE, sha256: await sha256Hex(manifest) }]);
  assert.deepEqual(Object.keys(sig.subjects[0] ?? {}).sort(), ["path", "sha256"]);
});

test("trust entries: adoptedVia is the one new field, set only on an entry adopted through a rotation", async () => {
  const { adoptRotation, generateKey, rotateKey } = await import("../core/index.js");
  const oldK = await generateKey(new Date("2026-11-17T12:00:00.000Z"));
  const newK = await generateKey(new Date("2026-11-17T12:00:00.000Z"));
  const rotation = await rotateKey({ oldPrivateKey: oldK.privateKey, oldKey: oldK.key, newKey: newK.key });
  const entry = adoptRotation(rotation, [{ kid: oldK.key.kid, origin: "https://w.example", publicKey: oldK.key.publicKey }], "https://w.example");
  assert.deepEqual(Object.keys(entry).sort(), ["adoptedVia", "kid", "origin", "publicKey"]);
  assert.equal(entry.adoptedVia, oldK.key.kid);
});

test("the lock's peer record: links is a sha256 or the literal string absent", () => {
  assert.equal(PEER_LINKS_ABSENT, "absent");
});

test("the lock's peer outline (since 2026-11-18): agents, hosts and front, every string a SHA-256, front only when there is one", async () => {
  const { peerOutline, isPeerOutline } = await import("../watch/outline.js");
  const withFront = await peerOutline('{ "tools": [{ "name": "a", "instructions": "x", "tools": ["https://h.example/p"] }] }');
  assert.ok(withFront && isPeerOutline(withFront));
  assert.deepEqual(Object.keys(withFront).sort(), ["agents", "front", "hosts"]);
  const hex = /^[0-9a-f]{64}$/;
  assert.ok([...Object.keys(withFront.agents), ...Object.values(withFront.agents), ...withFront.hosts, withFront.front ?? ""].every((h) => hex.test(h)));
  const none = await peerOutline('{ "tools": [] }');
  assert.deepEqual(none, { agents: {}, hosts: [] }, "no front agent: the member is omitted, never null");
});

test("enum strings are exact and three-state where the standard demands it", () => {
  assert.deepEqual([...VERDICTS], ["verified", "invalid", "unverifiable"]);
  assert.deepEqual([...INVALID_REASONS], ["bad-signature", "tampered", "expired", "kid-mismatch", "malformed", "revoked"]);
  assert.deepEqual([...GATE_STATES], ["pass", "fail", "unavailable"]);
  assert.deepEqual([...DRIFT_KINDS], ["grounding", "runtime", "peer"]);
  assert.deepEqual([...SEVERITIES], ["info", "warn", "block"]);
  assert.deepEqual([...LOCK_STATES], ["found", "absent", "refused", "unreadable", "unusable"]);
});

test("plumbline-revocation.json carries exactly these fields; `reason` only when given", async () => {
  const { generateKey, revokeKey } = await import("../core/index.js");
  const k = await generateKey(new Date("2026-11-17T12:00:00.000Z"));
  const bare = await revokeKey({ privateKey: k.privateKey, key: k.key, now: new Date("2026-11-18T12:00:00.000Z") });
  assert.deepEqual(Object.keys(bare).sort(), ["alg", "kid", "revokedAt", "sig", "type", "version"]);
  const noted = await revokeKey({ privateKey: k.privateKey, key: k.key, reason: "leaked" });
  assert.deepEqual(Object.keys(noted).sort(), ["alg", "kid", "reason", "revokedAt", "sig", "type", "version"]);
});

test("statement files (since 2026-11-18): one statement, or a JSON array of 1..64 statements; a signature lists at most 256 files", async () => {
  const { MAX_STATEMENTS_PER_FILE, MAX_SUBJECTS, applyRevocationText, generateKey, revokeKey, rotateKey, walkRotationChain } = await import(
    "../core/index.js"
  );
  assert.equal(MAX_STATEMENTS_PER_FILE, 64);
  assert.equal(MAX_SUBJECTS, 256);
  const t = new Date("2026-11-18T12:00:00.000Z");
  const [a, b, c] = [await generateKey(t), await generateKey(t), await generateKey(t)];
  const entry = (k: typeof a) => ({ kid: k.key.kid, origin: "https://w.example", publicKey: k.key.publicKey });
  // a revocation file: the single statement every earlier file holds, or an array of the same statements, unchanged
  const ra = await revokeKey({ privateKey: a.privateKey, key: a.key, now: t });
  const rb = await revokeKey({ privateKey: b.privateKey, key: b.key, now: t });
  assert.equal((await applyRevocationText(JSON.stringify(ra), [entry(a)])).applied, true);
  const list = await applyRevocationText(JSON.stringify([ra, rb]), [entry(a), entry(b)]);
  assert.deepEqual(list.entries.map((e) => e.revokedAt !== undefined), [true, true]);
  // a rotation file: the single statement, or the chain oldest first, each statement's from the previous one's to
  const ab = await rotateKey({ oldPrivateKey: a.privateKey, oldKey: a.key, newKey: b.key, now: t });
  const bc = await rotateKey({ oldPrivateKey: b.privateKey, oldKey: b.key, newKey: c.key, now: t });
  assert.deepEqual(Object.keys(bc).sort(), ["from", "sig", "signedAt", "to", "toPublicKey", "type", "version"], "a chain adds no member to a statement");
  const walk = await walkRotationChain([ab, bc], [entry(a)], "https://w.example");
  assert.deepEqual(walk.entries.map((e) => [e.kid, e.adoptedVia]), [[b.key.kid, a.key.kid], [c.key.kid, b.key.kid]]);
});
