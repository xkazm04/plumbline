// check:wire for agent change control (docs/agent-lock.md). Pins the exact strings other code and other repositories
// read. A change here is a format change.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AGENT_APPROVAL_FILE,
  AGENT_APPROVAL_TYPE,
  AGENT_CODES,
  AGENT_CURRENT_VERSION,
  AGENT_DECLARATION_VERSIONS,
  AGENT_FILE,
  AGENT_FORMAT_VERSION,
  AGENT_HASHING_RULES,
  AGENT_LOCK_FILE,
  AGENT_LOCK_TYPE,
  AGENT_LOCK_VERSIONS,
  AGENT_NOT_CHECKED_CODES,
  AGENT_PENDING_DIR,
  AGENT_PENDING_TYPE,
  AGENT_STATES,
  AGENT_TOOLS_DIR,
  AGENT_TOOLS_TYPE,
  AGENT_TYPE,
  APPROVAL_STATES,
  APPROVERS_FILE,
  APPROVERS_TYPE,
  GUARD_REQUIRE,
  MCP_HOSTS,
  MCP_TOOL_DEFINITION_KEYS,
  MCP_TRANSPORTS,
} from "../core/types.js";
import { serverTarget, toolsDecision, toolsParts, toolsRecord } from "../core/agent-tools.js";
import { canonicalJson, sha256Hex } from "../core/canonical.js";

test("agent document types, version and file names", () => {
  assert.equal(AGENT_FORMAT_VERSION, 1);
  assert.equal(AGENT_TYPE, "plumbline-agent");
  assert.equal(AGENT_LOCK_TYPE, "plumbline-agent-lock");
  assert.equal(AGENT_APPROVAL_TYPE, "plumbline-agent-approval");
  assert.equal(APPROVERS_TYPE, "plumbline-approvers");
  assert.equal(AGENT_PENDING_TYPE, "plumbline-agent-pending");
  assert.equal(AGENT_FILE, "plumbline.agent.json");
  assert.equal(AGENT_LOCK_FILE, "plumbline.agent.lock.json");
  assert.equal(AGENT_APPROVAL_FILE, "plumbline.agent.approval.json");
  assert.equal(AGENT_PENDING_DIR, ".plumbline/pending");
  assert.equal(APPROVERS_FILE, "approvers.json");
});

test("agent format version 2 (2026-11-23): versions, the tools folder, hashing rule, hosts, states", () => {
  assert.deepEqual([...AGENT_DECLARATION_VERSIONS], [1, 2]);
  assert.deepEqual([...AGENT_LOCK_VERSIONS], [1, 2]);
  assert.equal(AGENT_CURRENT_VERSION, 2);
  assert.equal(AGENT_TOOLS_DIR, "plumbline.agent.tools");
  assert.equal(AGENT_TOOLS_TYPE, "plumbline-agent-tools");
  assert.deepEqual([...AGENT_HASHING_RULES], ["text-lf"]);
  assert.deepEqual([...MCP_HOSTS], ["claude", "cursor", "vscode"]);
  assert.deepEqual([...AGENT_STATES], ["pass", "fail", "unavailable"]);
  assert.deepEqual([...AGENT_NOT_CHECKED_CODES], ["server-not-observed", "server-unreachable", "server-refused", "server-auth-missing", "peer-unreachable", "link-absent"]);
});

test("agent enums: transports, tool definition keys, approval states, guard modes, finding codes", () => {
  assert.deepEqual([...MCP_TRANSPORTS], ["stdio", "http"]);
  assert.deepEqual([...MCP_TOOL_DEFINITION_KEYS], ["name", "title", "description", "inputSchema", "outputSchema", "annotations"]);
  assert.deepEqual([...APPROVAL_STATES], ["verified", "invalid", "unverifiable", "absent"]);
  assert.deepEqual([...GUARD_REQUIRE], ["locked", "approved"]);
  assert.deepEqual([...AGENT_CODES], [
    "declaration-changed", "file-changed", "file-added", "file-removed", "model-changed",
    "server-added", "server-removed", "server-target-changed", "server-not-observed", "server-unreachable", "server-refused",
    "tool-changed", "tool-added", "tool-removed", "peer-changed", "peer-unreachable",
    "lock-absent", "lock-unusable", "lock-unapproved", "approval-invalid", "approval-unverifiable", "chain-broken",
    "host-changed", "link-absent", "server-auth-missing", "definitions-mismatch", "definitions-absent",
  ]);
});

test("a tool's part: key is SHA-256 of its name, definition SHA-256 of canonical JSON of the defining keys only", async () => {
  const tool = { name: "search", description: "d", inputSchema: { type: "object" }, _meta: { x: 1 }, extra: true };
  const { parts, problems } = await toolsParts([tool]);
  assert.equal(problems, 0);
  assert.equal(parts[0]?.key, await sha256Hex("search"));
  assert.equal(parts[0]?.definition, await sha256Hex(canonicalJson({ name: "search", description: "d", inputSchema: { type: "object" } })));
});

test("a repeated name is keyed name NUL n, so a duplicate cannot overwrite its twin; a non-tool is a problem", async () => {
  const { parts, problems } = await toolsParts([{ name: "a" }, { name: "a", description: "x" }, { nope: 1 }, "s"]);
  assert.equal(problems, 2);
  assert.deepEqual(parts.map((p) => p.index), [0, 1]);
  assert.equal(parts[1]?.key, await sha256Hex("a\u00002"));
});

test("toolsDecision: pass, changed, unpinned and removed; a never-observed lock passes nothing", async () => {
  const lockedParts = (await toolsParts([{ name: "keep" }, { name: "edit", description: "old" }, { name: "gone" }])).parts;
  const locked = toolsRecord(lockedParts);
  const seen = (await toolsParts([{ name: "keep" }, { name: "edit", description: "new" }, { name: "new" }])).parts;
  assert.deepEqual(toolsDecision(locked, seen), { pass: [0], changed: [1], unpinned: [2], removed: 1 });
  assert.deepEqual(toolsDecision(undefined, seen), { pass: [], changed: [], unpinned: [0, 1, 2], removed: 0 });
});

test("serverTarget: stdio hashes command and args (args omitted when absent), http hashes the url", async () => {
  assert.equal(await serverTarget({ transport: "stdio", command: "npx" }), await sha256Hex('{"command":"npx"}'));
  assert.equal(await serverTarget({ transport: "stdio", command: "npx", args: ["-y", "s"] }), await sha256Hex('{"args":["-y","s"],"command":"npx"}'));
  assert.equal(await serverTarget({ transport: "http", url: "https://m.example/mcp" }), await sha256Hex('{"url":"https://m.example/mcp"}'));
});
