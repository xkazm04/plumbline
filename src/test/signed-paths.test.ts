// The one rule for which files a site signs, shared by the CLI and the Desk. It follows what the runtime FETCHES:
// `networks[].hocon` exactly as written (site/runtime/engine.js `_compile`), links.json, and the lock.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as core from "../core/index.js";
import { isSafeSubjectPath, networkPathOf, parseManifest, signedPathsOf } from "../core/index.js";

const NONE = { links: false, lock: false };
const ALL = { links: true, lock: true };

test("signedPathsOf: manifest first, each named network once as written, in manifest order, then links and lock when present", () => {
  const manifest = {
    networks: [
      { name: "a", hocon: "networks/helper.hocon" },
      { name: "b", hocon: "./networks/raw.json" },
      { name: "c", hocon: "networks/helper.hocon" },
      { name: "d" },
      { name: "e", hocon: 42 },
      null,
    ],
  };
  assert.deepEqual(signedPathsOf(manifest, ALL), [
    "agent-manifest.json",
    "networks/helper.hocon",
    "networks/raw.json",
    "links.json",
    "plumbline.lock.json",
  ]);
  assert.deepEqual(signedPathsOf(manifest, NONE), ["agent-manifest.json", "networks/helper.hocon", "networks/raw.json"]);
  assert.deepEqual(signedPathsOf(manifest, { links: false, lock: true }), [
    "agent-manifest.json",
    "networks/helper.hocon",
    "networks/raw.json",
    "plumbline.lock.json",
  ]);
});

test("REGRESSION (reviewer finding 2): the signed path is the fetched path; x.hocon is never mapped to x.network.json", () => {
  // Old code: signedPathsOf({networks:[{hocon:"x.hocon"}]}, false) returned ["agent-manifest.json", "x.network.json"],
  // so the file the runtime fetches (x.hocon) was never signed and could be edited freely.
  assert.deepEqual(signedPathsOf({ networks: [{ hocon: "x.hocon" }] }, NONE), ["agent-manifest.json", "x.hocon"]);
  assert.equal((core as Record<string, unknown>).networkFileFor, undefined, "the .hocon -> .network.json mapping is gone");
});

test("signedPathsOf: a manifest without networks, or not an object, signs the manifest (and links, lock) alone", () => {
  for (const manifest of [{}, { networks: "x" }, null, [], "text", 3]) {
    assert.deepEqual(signedPathsOf(manifest, NONE), ["agent-manifest.json"]);
    assert.deepEqual(signedPathsOf(manifest, ALL), ["agent-manifest.json", "links.json", "plumbline.lock.json"]);
  }
});

test("signedPathsOf never lists a path twice, even when a network names the manifest or links.json", () => {
  const manifest = { networks: [{ hocon: "agent-manifest.json" }, { hocon: "./links.json" }] };
  assert.deepEqual(signedPathsOf(manifest, { links: true, lock: false }), ["agent-manifest.json", "links.json"]);
});

test("signedPathsOf refuses a hocon the runtime would fetch from outside the site, and never quotes it", () => {
  const unsafe = [
    "https://evil.example/x.hocon",
    "//evil.example/x.hocon",
    "/abs/x.hocon",
    "../x.hocon",
    "a/../../x.hocon",
    "a\\x.hocon",
    "a//x.hocon",
    "././x.hocon",
    "a/./x.hocon",
    "x .hocon",
    "x%2e.hocon",
    "x.hocon?v=1",
    "café.hocon",
    "",
    ".",
  ];
  for (const hocon of unsafe) {
    assert.throws(
      () => signedPathsOf({ networks: [{ name: "n", hocon: "ok.hocon" }, { hocon }] }, NONE),
      (error: Error) => /networks\[1\]\.hocon is not a safe site-relative path/.test(error.message) && (hocon.length < 4 || !error.message.includes(hocon)),
      JSON.stringify(hocon),
    );
  }
});

test("signedPathsOf refuses the old boolean second argument instead of silently dropping links.json", () => {
  assert.throws(() => signedPathsOf({}, true as never), TypeError);
  assert.throws(() => signedPathsOf({}, undefined as never), TypeError);
});

test("isSafeSubjectPath and networkPathOf: only [A-Za-z0-9._/-], relative, no empty, '.' or '..' segment", () => {
  for (const ok of ["a", "a.json", "networks/x.hocon", ".well-known/k.json", "a-b_c/D.E", "..a/b.."]) assert.equal(isSafeSubjectPath(ok), true, ok);
  for (const bad of ["", "/a", "a/", "a//b", "./a", "a/..", "a\\b", "a:b", "a b", "a\u0000b", "é", 5, null]) {
    assert.equal(isSafeSubjectPath(bad), false, JSON.stringify(bad));
  }
  assert.equal(networkPathOf("./x.network.json"), "x.network.json");
  assert.equal(networkPathOf("x.network.json"), "x.network.json");
});

test("parseManifest reads bytes the way resp.json() does: UTF-8, a BOM dropped; not JSON is undefined", () => {
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"networks":[]}')]);
  assert.deepEqual(parseManifest(bom), { networks: [] });
  assert.deepEqual(parseManifest('\uFEFF{"a":1}'), { a: 1 });
  assert.equal(parseManifest("{ nope"), undefined);
  assert.equal(parseManifest(new Uint8Array([0xff])), undefined);
});
