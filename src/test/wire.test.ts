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
  assert.equal(FORMAT_VERSION, 1);
  assert.equal(ALG, "Ed25519");
});

test("published file names", () => {
  assert.equal(SIGNATURE_FILE, "plumbline.signature.json");
  assert.equal(KEY_FILE, ".well-known/plumbline-key.json");
  assert.equal(ROTATION_FILE, "plumbline-rotation.json");
  assert.equal(LOCK_FILE, "plumbline.lock.json");
});

test("enum strings are exact and three-state where the standard demands it", () => {
  assert.deepEqual([...VERDICTS], ["verified", "invalid", "unverifiable"]);
  assert.deepEqual([...INVALID_REASONS], ["bad-signature", "tampered", "expired", "kid-mismatch", "malformed"]);
  assert.deepEqual([...GATE_STATES], ["pass", "fail", "unavailable"]);
  assert.deepEqual([...DRIFT_KINDS], ["grounding", "runtime", "peer"]);
  assert.deepEqual([...SEVERITIES], ["info", "warn", "block"]);
});
