import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { LOCK_FILE, type PlumblineLock } from "../core/types.js";
import { SafeFetchError } from "../net/safe-fetch.js";
import { copySite } from "./net-helpers.js";
import { baseRoutes, ofKind, watch } from "./watch-helpers.js";

async function locked(extraSources: string[] = ["data/rooms.json"]): Promise<string> {
  const root = copySite();
  const init = await watch(root, baseRoutes(), { init: true, extraSources });
  assert.deepEqual(init.findings, []);
  return root;
}

test("grounding drift: an edited source is a warn naming the ref, with both hashes", async () => {
  const root = await locked();
  writeFileSync(join(root, "data/rooms.json"), '{ "rooms": [ { "id": "garden", "price": 999 } ] }');
  const { findings } = await watch(root, baseRoutes());
  const grounding = ofKind(findings, "grounding");
  assert.equal(grounding.length, 1);
  const f = grounding[0]!;
  assert.equal(f.severity, "warn");
  assert.equal(f.ref, "data/rooms.json");
  assert.match(f.expected ?? "", /^[0-9a-f]{64}$/);
  assert.match(f.actual ?? "", /^[0-9a-f]{64}$/);
  assert.notEqual(f.expected, f.actual);
  assert.match(f.summary, /changed since the lock was written/);
  assert.deepEqual(findings.filter((x) => x !== f), [], "nothing else drifted");
});

test("grounding neighbour: the same JSON with different key order and spacing is not drift", async () => {
  const root = await locked();
  writeFileSync(join(root, "data/rooms.json"), '{"rooms":[{"price":120,"id":"garden"},{"price":150,"id":"lantern"}]}\n');
  const { findings } = await watch(root, baseRoutes());
  assert.deepEqual(findings, []);
});

test("grounding neighbour: a non-JSON source is hashed by its text, so CRLF is not drift but an edit is", async () => {
  const root = copySite();
  writeFileSync(join(root, "data/policy.txt"), "No pets.\nCheck-in at 3.\n");
  await watch(root, baseRoutes(), { init: true, extraSources: ["data/policy.txt"] });
  writeFileSync(join(root, "data/policy.txt"), "No pets.\r\nCheck-in at 3.\r\n");
  assert.deepEqual((await watch(root, baseRoutes())).findings, []);
  writeFileSync(join(root, "data/policy.txt"), "Pets welcome.\nCheck-in at 3.\n");
  const { findings } = await watch(root, baseRoutes());
  assert.deepEqual(findings.map((f) => [f.kind, f.severity, f.ref]), [["grounding", "warn", "data/policy.txt"]]);
});

test("grounding: an unreadable source is a warn that says so, not silence", async () => {
  const root = await locked();
  rmSync(join(root, "data/rooms.json"));
  const { findings } = await watch(root, baseRoutes());
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "warn");
  assert.match(findings[0]!.summary, /could not be checked.*was not found/);
});

test("grounding: a lock reference that leaves the site root is refused, not read", async () => {
  const root = await locked();
  const lock: PlumblineLock = JSON.parse(readFileSync(join(root, LOCK_FILE), "utf8"));
  lock.grounding.sources.push({ ref: "../outside.txt", sha256: "0".repeat(64) }, { ref: "/etc/hostname", sha256: "0".repeat(64) });
  writeFileSync(join(root, LOCK_FILE), JSON.stringify(lock));
  const { findings } = await watch(root, baseRoutes());
  const refused = findings.filter((f) => f.ref === "../outside.txt" || f.ref === "/etc/hostname");
  assert.equal(refused.length, 2);
  assert.ok(refused.every((f) => f.severity === "warn" && /outside the site root/.test(f.summary)));
});

test("grounding: an https source is hashed through safeFetch; changed is a warn, same is clean, unreachable is a warn", async () => {
  const url = "https://docs.example/facts.json";
  const routes = { ...baseRoutes(), [url]: { body: { open: "9-5" } } };
  const root = copySite();
  const init = await watch(root, routes, { init: true, extraSources: [url] });
  assert.deepEqual(init.findings, []);

  assert.deepEqual((await watch(root, { ...routes, [url]: { body: '{ "open": "9-5" }' } })).findings, [], "same facts, different spacing");

  const changed = await watch(root, { ...routes, [url]: { body: { open: "10-4" } } });
  assert.deepEqual(changed.findings.map((f) => [f.severity, f.ref]), [["warn", url]]);
  assert.match(changed.findings[0]!.summary, /changed/);

  for (const route of [{ error: new SafeFetchError("timeout", "t") }, { status: 500 }, { error: new SafeFetchError("blocked-address", "b") }]) {
    const down = await watch(root, { ...routes, [url]: route });
    assert.equal(down.findings.length, 1);
    assert.equal(down.findings[0]?.severity, "warn");
    assert.match(down.findings[0]!.summary, /could not be checked/);
  }
});
