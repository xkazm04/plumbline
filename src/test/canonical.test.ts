// canonicalJson must be byte-identical to Agent Customs' reference for every JSON-compatible input.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { bytesToBase64Url, canonicalJson, generateKey, keyId, sha256Hex } from "../core/index.js";

// Reference: canonicalJson from montbaga/agent-customs, practice/customs/canonical.js (Apache-2.0).
// Copied verbatim (types added) so the differential test compares against the real rule, not our reading of it.
function referenceCanonicalJson(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return "[" + value.map(referenceCanonicalJson).join(",") + "]";
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + referenceCanonicalJson(value[k])).join(",") + "}";
}

const inputs: [string, unknown][] = [
  ["nested objects", { b: { z: 1, a: { y: [1, 2], x: null } }, a: "s" }],
  ["array of objects", [{ b: 1, a: 2 }, { a: 2, b: 1 }, {}, []]],
  ["astral plane", { "\u{1F680}": "\u{1F680}", "\u{10FFFF}": "\u{10000}", plain: "x" }],
  ["combining marks", { "é": "é", "é": "é", "ạ̈": 1 }],
  ["precomposed vs decomposed keys", { "é": 1, "é": 2, e: 3, z: 4 }],
  ["lone surrogate", { s: "\ud800", t: "\udfff x" }],
  ["escapes and control characters", { s: 'quote " back \\ nl \n tab \t nul \u0000 del \u007f line    ' }],
  ["key order variant one", { a: 1, b: 2, c: 3 }],
  ["key order variant two", { c: 3, a: 1, b: 2 }],
  ["key order variant three", { b: 2, c: 3, a: 1 }],
  ["numeric-looking keys sort as strings", { "10": "a", "9": "b", "1": "c", "-1": "d", "": "e" }],
  ["undefined members", { a: undefined, b: 1, c: { d: undefined, e: [undefined, 1] } }],
  ["null", null],
  ["null member", { a: null }],
  ["numbers", [0, -0, 1e21, 0.1, 1e-7, 123456789012345680000, 5e-324, 1.7976931348623157e308, -12.5]],
  ["booleans and strings", { t: true, f: false, s: "" }],
  ["empty containers", { o: {}, a: [], n: [[], {}, [[]]] }],
  ["top-level scalars", "just a string"],
  ["top-level number", 42],
  ["top-level empty object", {}],
  ["top-level empty array", []],
  ["deep nesting", { a: { b: { c: { d: { e: { f: [{ g: [{ h: 1 }] }] } } } } } }],
];

for (const [name, value] of inputs) {
  test(`canonicalJson equals the Customs reference: ${name}`, () => {
    assert.equal(canonicalJson(value), referenceCanonicalJson(value));
  });
}

test("canonicalJson equals the Customs reference on a deterministic fuzz of 2000 values", () => {
  let state = 0x2545f491;
  const rand = (n: number): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % n;
  };
  const strings = ["", "a", "b", "A", "café", "é", "\u{1F680}", "\u{10000}", "z\u0000", " ", "10", "9", "~", " "];
  const gen = (depth: number): unknown => {
    const kind = rand(depth > 3 ? 6 : 9);
    switch (kind) {
      case 0: return null;
      case 1: return rand(2) === 0;
      case 2: return [0, -0, 1, -1, 0.1, 1e21, 1e-7, 123.456][rand(8)];
      case 3: return strings[rand(strings.length)];
      case 4: return undefined;
      case 5: return rand(1000) - 500;
      case 6: return Array.from({ length: rand(4) }, () => gen(depth + 1));
      default: {
        const o: Record<string, unknown> = {};
        for (let i = rand(5); i > 0; i--) o[strings[rand(strings.length)] as string] = gen(depth + 1);
        return o;
      }
    }
  };
  for (let i = 0; i < 2000; i++) {
    const value = gen(0);
    assert.equal(canonicalJson(value), referenceCanonicalJson(value));
  }
});

test("canonicalJson drops undefined members and keeps null", () => {
  assert.equal(canonicalJson({ a: undefined, b: null, c: 1 }), '{"b":null,"c":1}');
});

test("sha256Hex: lowercase hex, UTF-8 for strings, same answer for bytes", async () => {
  assert.equal(await sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const text = "café \u{1F680}";
  assert.equal(await sha256Hex(text), createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex"));
  assert.equal(await sha256Hex(new TextEncoder().encode(text)), await sha256Hex(text));
});

test("keyId: first 16 hex chars of SHA-256 of the RAW public key bytes", async () => {
  const { key } = await generateKey();
  const raw = Buffer.from(key.publicKey, "base64url");
  assert.equal(raw.length, 32);
  assert.equal(key.kid, createHash("sha256").update(raw).digest("hex").slice(0, 16));
  assert.equal(await keyId(key.publicKey), key.kid);
  assert.match(key.kid, /^[0-9a-f]{16}$/);
  await assert.rejects(keyId(bytesToBase64Url(new Uint8Array(31))));
  await assert.rejects(keyId("not base64url!"));
});

test("generateKey: base64url PKCS#8 private key, raw public key, ISO createdAt, a fresh key each time", async () => {
  const when = new Date("2026-11-17T08:00:00.000Z");
  const a = await generateKey(when);
  const b = await generateKey(when);
  assert.equal(a.key.createdAt, "2026-11-17T08:00:00.000Z");
  assert.equal(a.key.type, "plumbline-key");
  assert.equal(a.key.alg, "Ed25519");
  assert.equal(Buffer.from(a.privateKey, "base64url").length, 48);
  assert.notEqual(a.key.kid, b.key.kid);
  assert.ok(!("privateKey" in a.key));
});
