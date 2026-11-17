import assert from "node:assert/strict";
import { test } from "node:test";
import * as core from "../core/index.js";
import { canonicalJson, hashBytes, hashDocument, sha256Hex } from "../net/canonical.js";

test("canonical bytes: sorted keys, no whitespace, undefined dropped", () => {
  assert.equal(canonicalJson({ b: 1, a: [{ d: undefined, c: 2 }], z: null }), '{"a":[{"c":2}],"b":1,"z":null}');
  assert.equal(canonicalJson("é"), '"é"');
  assert.equal(canonicalJson([3, "x", true]), '[3,"x",true]');
});

test("sha256 of a known vector", async () => {
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("a document hashes by its exact bytes: re-serialising JSON (key order, spacing) is a different document", async () => {
  const a = await hashDocument('{"b": 1, "a": 2}');
  assert.equal(a, await sha256Hex('{"b": 1, "a": 2}'));
  assert.notEqual(a, await hashDocument('{\n  "a": 2,\n  "b": 1\n}\n'));
  assert.notEqual(a, await hashDocument('{"a":2,"b":1}'));
});

test("nothing is folded: CRLF, a BOM and a duplicate key each change the hash", async () => {
  const lf = await hashDocument("line one\nline two\n");
  assert.equal(lf, await sha256Hex("line one\nline two\n"));
  assert.notEqual(await hashDocument("line one\r\nline two\r\n"), lf);
  assert.notEqual(await hashDocument("\uFEFFline one\nline two\n"), lf);
  assert.notEqual(await hashBytes(new TextEncoder().encode("line one\r\nline two\r\n")), lf);
  assert.equal(await hashBytes(new TextEncoder().encode("line one\nline two\n")), lf);
  // JSON.parse sees one object here; the runtime's HOCON reader merges the two `a` members. Different bytes, different hash.
  assert.notEqual(await hashDocument('{"a":{"x":1},"a":{"y":2}}'), await hashDocument('{"a":{"y":2}}'));
});

test("bytes that are not UTF-8 are hashed as they are", async () => {
  const bytes = new Uint8Array([0xff, 0xfe, 0x00, 0x80]);
  assert.equal(await hashBytes(bytes), await sha256Hex(bytes));
});

test("net re-exports core's canonicalJson and sha256Hex: one authority for the bytes", async () => {
  assert.equal(canonicalJson, core.canonicalJson);
  assert.equal(core.canonicalJson({ b: [1, { y: undefined, x: "é" }], a: null }), canonicalJson({ b: [1, { y: undefined, x: "é" }], a: null }));
  assert.equal(await core.sha256Hex("abc"), await sha256Hex("abc"));
});
