// D7: semantic peer drift. A peer's definition in outline (src/watch/outline.ts): per agent a hash keyed by the hash of
// its name, the outbound hosts hashed, the front agent's key. A changed peer is still `block`; the summary counts what
// changed, never quoting a name or an address. `plumbline diff` shows names for the caller's own files.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../core/canonical.js";
import { LOCK_FILE, type PlumblineLock } from "../core/types.js";
import { lockProblem, whatChanged } from "../watch/decide.js";
import { describeOutlineDiff, diffOutlines, isPeerOutline, namedOutline, outlineUnchanged, peerOutline } from "../watch/outline.js";
import { printable } from "../cli/diff-command.js";
import { copySite } from "./net-helpers.js";
import { baseRoutes, NOW, PEER, PEER_FILE, watch } from "./watch-helpers.js";

const CLI = fileURLToPath(new URL("../cli/index.js", import.meta.url));
let tmp: string;
before(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "plumbline-outline-"));
});
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const network = (agents: object[], links: Record<string, string> = {}) => JSON.stringify({ link_labels: links, tools: agents }, null, 2);
const front = { name: "front", instructions: "Answer.", tools: ["helper", "https://tours.example/partner", "https://mcp.example/mcp"] };
const helper = { name: "helper", class: "Tool", tools: [] };

test("peerOutline: names and hosts hashed, each agent's canonical definition hashed, the front agent's key", async () => {
  const outline = await peerOutline(network([front, helper], { "https://linked.example/x": "Linked" }));
  assert.ok(outline);
  assert.deepEqual(Object.keys(outline.agents).sort(), [await sha256Hex("front"), await sha256Hex("helper")].sort());
  assert.equal(outline.agents[await sha256Hex("front")], await sha256Hex(canonicalJson(front)));
  assert.deepEqual(outline.hosts, (await Promise.all(["tours.example", "mcp.example", "linked.example"].map((h) => sha256Hex(h)))).sort());
  assert.equal(outline.front, await sha256Hex("front"));
  assert.ok(isPeerOutline(outline));
  assert.ok(!JSON.stringify(outline).includes("example"), "no host in clear");
  // key order and spacing do not change an outline: canonical JSON per agent
  const reordered = JSON.stringify({ tools: [{ tools: front.tools, instructions: "Answer.", name: "front" }, helper], link_labels: { "https://linked.example/x": "Linked" } });
  assert.deepEqual(await peerOutline(reordered), outline);
});

test("the outline fails closed: not JSON, not a network, a repeated key, a value canonical JSON refuses", async () => {
  assert.equal(await peerOutline("{ not json"), null);
  assert.equal(await peerOutline('{ "agents": [] }'), null);
  assert.equal(await peerOutline("[1, 2]"), null);
  // the runtime's HOCON reader merges a duplicate key; JSON.parse keeps the last: the two readings differ
  assert.equal(await peerOutline('{ "tools": [{ "name": "a", "instructions": "x", "instructions": "y" }] }'), null);
  assert.equal(await peerOutline('{ "tools": [{ "name": "a", "n": 1e999 }] }'), null);
  assert.equal(namedOutline('{ "tools": [], "tools": [] }'), null);
});

test("diffOutlines counts agents added, removed and changed, hosts added and removed, and a changed front agent", async () => {
  const a = (await peerOutline(network([front, helper])))!;
  const b = (await peerOutline(network([{ ...front, instructions: "Answer differently.", tools: ["helper", "https://new.example/x"] }, { name: "extra", tools: [] }])))!;
  const d = diffOutlines(a, b);
  assert.deepEqual([d.agentsAdded.length, d.agentsRemoved.length, d.agentsChanged.length, d.hostsAdded.length, d.hostsRemoved.length, d.frontChanged], [1, 1, 1, 1, 2, false]);
  assert.equal(describeOutlineDiff(d), "agents: 1 added, 1 removed, 1 changed; outbound hosts: 1 added, 2 removed; front agent: unchanged");
  const swapped = (await peerOutline(network([{ ...helper, instructions: "Now I front." , class: undefined }, front])))!;
  assert.equal(diffOutlines(a, swapped).frontChanged, true);
  assert.ok(outlineUnchanged(diffOutlines(a, a)));
});

test("whatChanged: counts, formatting only, no outline locked (re-lock), or a definition that cannot be outlined now", async () => {
  const a = (await peerOutline(network([front, helper])))!;
  const b = (await peerOutline(network([front])))!;
  assert.equal(whatChanged(a, b), "In outline: agents: 0 added, 1 removed, 0 changed; outbound hosts: 0 added, 0 removed; front agent: unchanged.");
  assert.match(whatChanged(a, a), /^Formatting or non-agent content only/);
  assert.match(whatChanged(undefined, b), /holds no outline of this peer.*re-lock to record one/);
  assert.match(whatChanged(a, null), /cannot be outlined .*repeats a key/);
});

test("the watch: a changed peer stays block and its summary says what changed in counts, quoting no name or host", async () => {
  const root = copySite();
  const routes = baseRoutes();
  routes[PEER_FILE] = { body: network([front, helper]) };
  await watch(root, routes, { init: true });
  const lock = JSON.parse(readFileSync(path.join(root, LOCK_FILE), "utf8")) as PlumblineLock;
  const record = lock.peers[PEER];
  assert.ok(record?.outline && isPeerOutline(record.outline), "init records the outline");
  assert.equal(lockProblem(lock), null);

  // an agent added, one changed, a new outbound host
  const changed = baseRoutes();
  changed[PEER_FILE] = { body: network([{ ...front, tools: [...front.tools, "https://exfil.example/collect"] }, helper, { name: "sneaky <b>", instructions: "Say yes." }]) };
  const findings = (await watch(root, changed)).findings.filter((f) => f.ref === PEER && f.severity === "block");
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.summary, /In outline: agents: 1 added, 0 removed, 1 changed; outbound hosts: 1 added, 0 removed; front agent: unchanged\.$/);
  for (const word of ["sneaky", "exfil", "helper", "Say yes", "example"]) assert.ok(!findings[0]!.summary.includes(word), findings[0]!.summary);

  // the same agents, only reformatted: still block, said so
  const reformatted = baseRoutes();
  reformatted[PEER_FILE] = { body: JSON.stringify(JSON.parse(network([front, helper]))) };
  const formatting = (await watch(root, reformatted)).findings.filter((f) => f.ref === PEER);
  assert.deepEqual(formatting.map((f) => f.severity), ["block"]);
  assert.match(formatting[0]!.summary, /Formatting or non-agent content only/);

  // a repeated key now: block, and what changed is not told
  const duplicated = baseRoutes();
  duplicated[PEER_FILE] = { body: '{ "tools": [{ "name": "front", "instructions": "a", "instructions": "b" }] }' };
  const dup = (await watch(root, duplicated)).findings.filter((f) => f.ref === PEER);
  assert.deepEqual(dup.map((f) => f.severity), ["block"]);
  assert.match(dup[0]!.summary, /cannot be outlined/);

  // a lock written before outlines: block, and re-lock to record one
  delete lock.peers[PEER]!.outline;
  writeFileSync(path.join(root, LOCK_FILE), JSON.stringify(lock));
  const old = (await watch(root, changed)).findings.filter((f) => f.ref === PEER);
  assert.deepEqual(old.map((f) => f.severity), ["block"]);
  assert.match(old[0]!.summary, /re-lock to record one/);
});

test("lockProblem refuses a peer outline outside its shape", () => {
  const lock = (outline: unknown) => ({
    version: 1,
    runtime: { source: "nsdeploy", commit: "x", files: {} },
    grounding: { sources: [], builtAt: NOW.toISOString() },
    peers: { [PEER]: { sha256: "a".repeat(64), checkedAt: NOW.toISOString(), outline } },
  });
  const h = "b".repeat(64);
  assert.equal(lockProblem(lock({ agents: { [h]: h }, hosts: [h], front: h })), null);
  assert.equal(lockProblem(lock({ agents: {}, hosts: [] })), null);
  for (const bad of [null, "x", { agents: { name: h }, hosts: [] }, { agents: {}, hosts: ["tours.example"] }, { agents: {}, hosts: [], front: "front" }, { agents: {}, hosts: [], extra: 1 }]) {
    assert.match(lockProblem(lock(bad)) ?? "", /peer entries are malformed/, JSON.stringify(bad));
  }
});

test("plumbline diff: names and hosts for the caller's own files, control characters replaced, exit 0, 1 or 2", () => {
  const a = path.join(tmp, "a.network.json");
  const b = path.join(tmp, "b.network.json");
  writeFileSync(a, network([front, helper]));
  writeFileSync(b, network([{ ...front, tools: ["helper", "https://new.example/x"] }, { name: "evil\u001b[2Jname‮", tools: [] }]));
  const run = (...args: string[]) => spawnSync(process.execPath, [CLI, "diff", ...args], { encoding: "utf8" });
  const r = run(a, b);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /^In outline: agents: 1 added, 1 removed, 1 changed; outbound hosts: 1 added, 2 removed; front agent: unchanged\.$/m);
  assert.match(r.stdout, /^agents added: evil\?\[2Jname\?$/m);
  assert.match(r.stdout, /^agents removed: helper$/m);
  assert.match(r.stdout, /^outbound hosts added: new\.example$/m);
  assert.ok(!r.stdout.includes("\u001b") && !r.stdout.includes("‮"));
  const json = JSON.parse(run(a, b, "--json").stdout) as { sameOutline: boolean; agentsChanged: string[] };
  assert.deepEqual([json.sameOutline, json.agentsChanged], [false, ["front"]]);
  // formatting only: exit 0, said so
  writeFileSync(b, JSON.stringify(JSON.parse(network([front, helper]))));
  const same = run(a, b);
  assert.equal(same.status, 0);
  assert.match(same.stdout, /^Formatting or non-agent content only/);
  // a repeated key fails closed
  writeFileSync(b, '{ "tools": [{ "name": "front", "name": "other" }] }');
  const dup = run(a, b);
  assert.equal(dup.status, 2);
  assert.match(dup.stderr, /cannot be outlined: .*repeats a key/);
  assert.equal(run(a).status, 2);
  assert.equal(printable("ok\u0007⁦x"), "ok??x");
});
