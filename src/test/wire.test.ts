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
  KEY_TYPE,
  LOCK_FILE,
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
});

test("enum strings are exact and three-state where the standard demands it", () => {
  assert.deepEqual([...VERDICTS], ["verified", "invalid", "unverifiable"]);
  assert.deepEqual([...INVALID_REASONS], ["bad-signature", "tampered", "expired", "kid-mismatch", "malformed", "revoked"]);
  assert.deepEqual([...GATE_STATES], ["pass", "fail", "unavailable"]);
  assert.deepEqual([...DRIFT_KINDS], ["grounding", "runtime", "peer"]);
  assert.deepEqual([...SEVERITIES], ["info", "warn", "block"]);
});

test("plumbline-revocation.json carries exactly these fields; `reason` only when given", async () => {
  const { generateKey, revokeKey } = await import("../core/index.js");
  const k = await generateKey(new Date("2026-11-17T12:00:00.000Z"));
  const bare = await revokeKey({ privateKey: k.privateKey, key: k.key, now: new Date("2026-11-18T12:00:00.000Z") });
  assert.deepEqual(Object.keys(bare).sort(), ["alg", "kid", "revokedAt", "sig", "type", "version"]);
  const noted = await revokeKey({ privateKey: k.privateKey, key: k.key, reason: "leaked" });
  assert.deepEqual(Object.keys(noted).sort(), ["alg", "kid", "reason", "revokedAt", "sig", "type", "version"]);
});
