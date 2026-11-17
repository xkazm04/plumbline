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

test("a document hashes by its canonical JSON when it parses, so key order and spacing do not matter", async () => {
  const a = await hashDocument('{"b": 1, "a": 2}');
  const b = await hashDocument('{\n  "a": 2,\n  "b": 1\n}\n');
  assert.equal(a, b);
  assert.equal(a, await sha256Hex('{"a":2,"b":1}'));
  assert.notEqual(a, await hashDocument('{"a":2,"b":3}'));
});

test("a non-JSON document hashes by its text, with CRLF folded and a BOM ignored", async () => {
  const lf = await hashDocument("line one\nline two\n");
  assert.equal(await hashDocument("line one\r\nline two\r\n"), lf);
  assert.equal(await hashDocument("﻿line one\nline two\n"), lf);
  assert.equal(lf, await sha256Hex("line one\nline two\n"));
  assert.notEqual(await hashDocument("line one\nline 2\n"), lf);
  assert.equal(await hashBytes(new TextEncoder().encode("line one\r\nline two\r\n")), lf);
});

test("bytes that are not UTF-8 are hashed as they are", async () => {
  const bytes = new Uint8Array([0xff, 0xfe, 0x00, 0x80]);
  assert.equal(await hashBytes(bytes), await sha256Hex(bytes));
});

test("parity with core's canonicalJson and sha256Hex once WP1 lands", async (t) => {
  let theirs: string;
  try {
    theirs = core.canonicalJson({ b: [1, { y: undefined, x: "é" }], a: null });
  } catch {
    t.skip("core is not implemented yet (WP1); this runs once it lands");
    return;
  }
  assert.equal(theirs, canonicalJson({ b: [1, { y: undefined, x: "é" }], a: null }));
  assert.equal(await core.sha256Hex("abc"), await sha256Hex("abc"));
});
