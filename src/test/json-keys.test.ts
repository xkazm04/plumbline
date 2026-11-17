// The duplicate-key scanner the validator port uses: pure, no dependency, keys compared after unescaping.
import assert from "node:assert/strict";
import { test } from "node:test";
import { countDuplicateKeys } from "../core/index.js";

test("countDuplicateKeys counts repeated keys per object, at any depth, after unescaping", () => {
  assert.equal(countDuplicateKeys('{"a":1,"b":2}'), 0);
  assert.equal(countDuplicateKeys('{"a":1,"a":2}'), 1);
  assert.equal(countDuplicateKeys('{"a":1,"a":2,"a":3}'), 2);
  assert.equal(countDuplicateKeys('{"a":{"x":1,"x":2},"b":[{"y":1,"y":1},{"y":1}]}'), 2);
  assert.equal(countDuplicateKeys('{"a":1,"\\u0061":2}'), 1, "an escaped spelling is the same key");
  assert.equal(countDuplicateKeys('{"\\n":1,"\\u000a":2,"\\/":3,"/":4}'), 2, "every escape form is unescaped before comparing");
  assert.equal(countDuplicateKeys('{"a":{"a":1},"b":{"a":1}}'), 0, "the same key in different objects is fine");
  assert.equal(countDuplicateKeys('\uFEFF {"k":"v","k":"w"} \n'), 1, "a BOM and surrounding whitespace are allowed");
  assert.equal(countDuplicateKeys('["a","a",{"a":1}]'), 0, "array values are not keys");
  assert.equal(countDuplicateKeys('{"s":"{\\"a\\":1,\\"a\\":2}"}'), 0, "text inside a string is not structure");
  assert.equal(countDuplicateKeys("123"), 0);
  assert.equal(countDuplicateKeys('{"a":[],"b":{},"c":[[]],"d":-1.5e3,"e":true,"f":null}'), 0);
});

test("countDuplicateKeys agrees with JSON.parse about what is JSON, and survives deep nesting", () => {
  for (const bad of ["", "{", '{"a"}', '{"a":}', '{"a":1,}', "[1,]", "01", '{"a":1}x', "'a'", '{"a":"\\x"}', "nul", '"\u0001"']) {
    assert.throws(() => JSON.parse(bad), SyntaxError, `JSON.parse should refuse ${JSON.stringify(bad)}`);
    assert.throws(() => countDuplicateKeys(bad), /not JSON/, JSON.stringify(bad));
  }
  const deep = "[".repeat(100_000) + "]".repeat(100_000);
  assert.equal(countDuplicateKeys(deep), 0);
  const deepObjects = '{"a":'.repeat(20_000) + "1" + "}".repeat(20_000);
  assert.equal(countDuplicateKeys(deepObjects), 0);
});
