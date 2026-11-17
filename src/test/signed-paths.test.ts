// The one rule for which files a site signs, shared by the CLI and the Desk.
import assert from "node:assert/strict";
import { test } from "node:test";
import { networkFileFor, signedPathsOf } from "../core/index.js";

test("signedPathsOf: manifest first, each named network once in manifest order, links last when present", () => {
  const manifest = {
    networks: [
      { name: "a", hocon: "networks/helper.hocon" },
      { name: "b", hocon: "networks/raw.json" },
      { name: "c", hocon: "networks/helper.hocon" },
      { name: "d" },
      { name: "e", hocon: 42 },
      null,
    ],
  };
  assert.deepEqual(signedPathsOf(manifest, true), [
    "agent-manifest.json",
    "networks/helper.network.json",
    "networks/raw.json",
    "links.json",
  ]);
  assert.deepEqual(signedPathsOf(manifest, false), ["agent-manifest.json", "networks/helper.network.json", "networks/raw.json"]);
});

test("signedPathsOf: a manifest without networks, or not an object, signs the manifest (and links) alone", () => {
  for (const manifest of [{}, { networks: "x" }, null, [], "text", 3]) {
    assert.deepEqual(signedPathsOf(manifest, false), ["agent-manifest.json"]);
    assert.deepEqual(signedPathsOf(manifest, true), ["agent-manifest.json", "links.json"]);
  }
});

test("signedPathsOf never lists a path twice, even when a network names the manifest or links.json", () => {
  const manifest = { networks: [{ hocon: "agent-manifest.json" }, { hocon: "links.json" }] };
  assert.deepEqual(signedPathsOf(manifest, true), ["agent-manifest.json", "links.json"]);
});

test("networkFileFor maps .hocon to .network.json and leaves any other path as written", () => {
  assert.equal(networkFileFor("./x.hocon"), "./x.network.json");
  assert.equal(networkFileFor("a/b.json"), "a/b.json");
  assert.equal(networkFileFor("hocon"), "hocon");
});
