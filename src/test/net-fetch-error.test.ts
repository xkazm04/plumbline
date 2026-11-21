// One fetch-error sentence table for the gate, the watch and the Desk (src/net/fetch-types.ts describeFetchError).

import assert from "node:assert/strict";
import { test } from "node:test";
import { describeFetchError as gateDescribe } from "../gate/context.js";
import { SafeFetchError, describeFetchError, type SafeFetchErrorCode } from "../net/fetch-types.js";
import { why } from "../watch/detectors.js";

const CODES: SafeFetchErrorCode[] = ["bad-url", "insecure-scheme", "blocked-address", "dns-failed", "too-many-redirects", "body-too-large", "timeout", "network", "redirect-refused"];

test("one table: the gate and the watch word every fetch failure the same way, each code with its own sentence", () => {
  assert.equal(gateDescribe, describeFetchError, "the gate re-exports the shared table");
  const sentences = CODES.map((code) => describeFetchError(new SafeFetchError(code, "remote words")));
  assert.equal(new Set(sentences).size, CODES.length);
  for (const [i, code] of CODES.entries()) {
    assert.equal(why(new SafeFetchError(code, "x")), sentences[i], code);
    assert.ok(!sentences[i]!.includes("remote words"), "the error's own message is never used");
  }
  assert.match(describeFetchError(new SafeFetchError("blocked-address", "x")), /private or loopback/);
});

test("a SafeFetchError from another copy of the module (the browser build) is worded by its code, not by class", () => {
  const foreign = Object.assign(new Error("x"), { name: "SafeFetchError", code: "timeout" });
  assert.equal(describeFetchError(foreign), "the request timed out");
  assert.equal(describeFetchError(new Error("boom")), "the request failed");
  assert.equal(describeFetchError(new Error("boom"), "it could not be read"), "it could not be read");
  assert.equal(why(new TypeError("x")), "it could not be read");
});
