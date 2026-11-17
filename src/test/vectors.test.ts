// Known-answer vectors: src/test/vectors.json was generated from a fixed seeded key and is committed as data
// (regenerated deliberately on 2026-11-17, same seed, when subjects became exact bytes). This test regenerates nothing;
// it only checks the committed answers. The Desk runs the same JSON in a browser.
import assert from "node:assert/strict";
import { createHash, createPrivateKey, sign as nodeSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  canonicalJson,
  keyId,
  sha256Hex,
  signSubjects,
  verifySignature,
  type PlumblineKey,
  type PlumblineSignature,
  type SubjectFile,
  type TrustEntry,
} from "../core/index.js";

// dist/test/vectors.test.js -> ../../src/test/vectors.json
const vectors = JSON.parse(readFileSync(new URL("../../src/test/vectors.json", import.meta.url), "utf8")) as {
  canonical: { inputJson: string; canonical: string }[];
  canonicalRefused: string[];
  sha256: { text: string; sha256: string }[];
  seedHex: string;
  privateKey: string;
  key: PlumblineKey;
  origin: string;
  signingNow: string;
  lifetimeDays: number;
  files: SubjectFile[];
  signedBytes: string;
  signature: PlumblineSignature;
  trust: TrustEntry[];
  cases: {
    name: string;
    now: string;
    signature: PlumblineSignature;
    files: SubjectFile[];
    trust: TrustEntry[];
    publishedKey?: PlumblineKey;
    expect: { verdict: string; reason?: string };
  }[];
};

test("vector canonical strings", () => {
  for (const c of vectors.canonical) assert.equal(canonicalJson(JSON.parse(c.inputJson)), c.canonical);
});

test("vector canonical refusals: a non-finite number has no canonical form (1e999 would otherwise encode as null)", () => {
  assert.ok(vectors.canonicalRefused.length >= 1);
  for (const input of vectors.canonicalRefused) assert.throws(() => canonicalJson(JSON.parse(input)), /non-finite/, input);
});

test("vector subjects: every committed digest is SHA-256 of the file text's exact UTF-8 bytes", async () => {
  const byPath = new Map(vectors.files.map((f) => [f.path, f.content]));
  for (const subject of vectors.signature.subjects) {
    const content = byPath.get(subject.path);
    assert.equal(typeof content, "string", subject.path);
    assert.equal(await sha256Hex(new TextEncoder().encode(content as string)), subject.sha256, subject.path);
  }
});

test("vector sha256 digests", async () => {
  for (const c of vectors.sha256) assert.equal(await sha256Hex(c.text), c.sha256);
});

test("vector key: kid is derived from the raw public key", async () => {
  assert.equal(await keyId(vectors.key.publicKey), vectors.key.kid);
  assert.equal(vectors.key.kid, "56475aa75463474c");
});

test("vector key agrees with an independent implementation (node:crypto) on the seed", () => {
  const seed = Buffer.from(vectors.seedHex, "hex");
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  assert.equal(pkcs8.toString("base64url"), vectors.privateKey);
  const privateKey = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  const sig = nodeSign(null, Buffer.from(vectors.signedBytes, "utf8"), privateKey).toString("base64url");
  assert.equal(sig, vectors.signature.sig, "Ed25519 is deterministic: the committed signature is the one RFC 8032 gives");
  const raw = Buffer.from(vectors.key.publicKey, "base64url");
  assert.equal(createHash("sha256").update(raw).digest("hex").slice(0, 16), vectors.key.kid);
});

test("vector signature: its signed bytes are the canonical JSON of the signature without sig", () => {
  const { sig, ...rest } = vectors.signature;
  assert.ok(sig.length > 0);
  assert.equal(canonicalJson(rest), vectors.signedBytes);
});

test("signing the vector inputs again reproduces the committed signature byte for byte", async () => {
  const again = await signSubjects({
    privateKey: vectors.privateKey,
    key: vectors.key,
    origin: vectors.origin,
    files: vectors.files,
    now: new Date(vectors.signingNow),
    lifetimeDays: vectors.lifetimeDays,
  });
  assert.deepEqual(again, vectors.signature);
});

for (const c of vectors.cases) {
  test(`vector verification: ${c.name}`, async () => {
    const trust = { find: (kid: string, origin: string) => c.trust.find((e) => e.kid === kid && e.origin === origin) };
    const result = await verifySignature(c.signature, c.files, trust, {
      now: new Date(c.now),
      ...(c.publishedKey ? { publishedKey: c.publishedKey } : {}),
    });
    assert.equal(result.verdict, c.expect.verdict);
    assert.equal(result.reason, c.expect.reason);
  });
}
