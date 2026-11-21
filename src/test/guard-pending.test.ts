// The guard's pending file (src/agent/pending.ts): written by pendingFor, read back by parsePending, refused when it is
// not exactly one.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePending, pendingFileName, pendingFor } from "../agent/pending.js";

const TARGET = "a".repeat(64);
const NOW = new Date("2026-11-21T10:00:00.000Z");

test("pendingFor restricts each tool to the defining keys, in order, and parsePending reads it back", () => {
  const tools = [
    { name: "search", description: "d", inputSchema: { type: "object" }, _meta: { v: 1 }, extra: true },
    { name: "fetch", title: "Fetch", annotations: { readOnlyHint: true } },
  ];
  const doc = pendingFor("docs", TARGET, tools, NOW);
  assert.deepEqual(doc, {
    type: "plumbline-agent-pending",
    version: 1,
    server: "docs",
    target: TARGET,
    observedAt: "2026-11-21T10:00:00.000Z",
    tools: [
      { name: "search", description: "d", inputSchema: { type: "object" } },
      { name: "fetch", title: "Fetch", annotations: { readOnlyHint: true } },
    ],
  });
  assert.deepEqual(parsePending(JSON.stringify(doc, null, 2)), doc);
  assert.deepEqual(parsePending("﻿" + JSON.stringify(doc)), doc);
});

test("pendingFileName: a host-prefixed name has its colon encoded as two underscores", () => {
  assert.equal(pendingFileName("docs"), "docs.json");
  assert.equal(pendingFileName("claude:docs"), "claude__docs.json");
});

test("parsePending refuses what is not a pending document", () => {
  const good = pendingFor("docs", TARGET, [{ name: "a" }], NOW) as unknown as Record<string, unknown>;
  const variant = (patch: Record<string, unknown>): string => JSON.stringify({ ...good, ...patch });
  assert.equal(parsePending("not json"), null);
  assert.equal(parsePending("[]"), null);
  assert.equal(parsePending('{"type":"plumbline-agent-pending","type":"plumbline-agent-pending","version":1}'), null);
  // a repeated key deep inside a tool
  const dup = JSON.stringify(good).replace('{"name":"a"}', '{"name":"a","name":"b"}');
  assert.equal(parsePending(dup), null);
  assert.equal(parsePending(variant({ type: "plumbline-agent-lock" })), null);
  assert.equal(parsePending(variant({ version: 2 })), null);
  assert.equal(parsePending(variant({ server: "" })), null);
  assert.equal(parsePending(variant({ server: 3 })), null);
  assert.equal(parsePending(variant({ target: "A".repeat(64) })), null);
  assert.equal(parsePending(variant({ observedAt: "yesterday" })), null);
  assert.equal(parsePending(variant({ tools: {} })), null);
  assert.equal(parsePending(variant({ tools: ["a"] })), null);
  assert.equal(parsePending(variant({ tools: [{ description: "no name" }] })), null);
  assert.equal(parsePending(variant({ tools: [{ name: "a", _meta: {} }] })), null);
  assert.equal(parsePending(variant({ extra: 1 })), null);
  assert.equal(parsePending(variant({ observedAt: null })), null);
  assert.notEqual(parsePending(variant({ tools: [] })), null);
});
