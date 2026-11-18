// D6: agent definitions beyond the agentic-web spec. An A2A Agent Card in the lock's `external` member: captured at
// --init and --relock, its skills hashed so a change is counted, block on change and warn when unreachable, by the same
// rules in the CLI's watch and the Desk's published reader. The cards are the A2A specification's own samples
// (src/test/fixtures/a2a/README.md). No network.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { EXTERNAL_KINDS, LOCK_FILE, type PlumblineLock } from "../core/types.js";
import { lockChanges, lockProblem } from "../watch/decide.js";
import { cardOutline, externalFinding, parseExternalArg } from "../watch/external.js";
import { runRelock } from "../watch/index.js";
import { readPublishedLock } from "../watch/published.js";
import { copySite, scripted, type Route } from "./net-helpers.js";
import { baseRoutes, NOW, watch } from "./watch-helpers.js";

const CLI = fileURLToPath(new URL("../cli/index.js", import.meta.url));
const card = (name: string) => readFileSync(new URL(`../../src/test/fixtures/a2a/${name}`, import.meta.url), "utf8");
const CARD_URL = "https://georoute-agent.example.com/.well-known/agent-card.json";
const enc = (s: string) => new TextEncoder().encode(s);

test("cardOutline: the specification's sample has 2 skills and 1 signature; its minimal example 1 and none; junk has no outline", async () => {
  const sample = await cardOutline(enc(card("sample-agent-card.json")));
  assert.equal(Object.keys(sample?.parts ?? {}).length, 2);
  assert.equal(sample?.signatures, 1);
  assert.ok(Object.entries(sample?.parts ?? {}).every(([k, v]) => /^[0-9a-f]{64}$/.test(k) && /^[0-9a-f]{64}$/.test(v)));
  const example = await cardOutline(enc(card("example-agent-card.json")));
  assert.deepEqual([Object.keys(example?.parts ?? {}).length, example?.signatures], [1, 0]);
  assert.equal(await cardOutline(enc("{ nope")), null);
  assert.equal(await cardOutline(enc('{"skills":[],"skills":[{"id":"x"}]}')), null, "a repeated key fails closed");
  assert.equal(await cardOutline(enc("[1]")), null);
});

test("watch --init --external a2a-card: the card is locked with its skills hashed; a change is block, counted, and quotes nothing", async () => {
  const root = copySite();
  const routes: Record<string, Route> = { ...baseRoutes(), [CARD_URL]: { body: card("sample-agent-card.json") } };
  await watch(root, routes, { init: true, externals: [{ kind: "a2a-card", url: CARD_URL }] });
  const lock = JSON.parse(readFileSync(join(root, LOCK_FILE), "utf8")) as PlumblineLock;
  const record = lock.external?.[CARD_URL];
  assert.equal(record?.kind, "a2a-card");
  assert.equal(Object.keys(record?.parts ?? {}).length, 2);
  assert.deepEqual(Object.keys(record ?? {}).sort(), ["checkedAt", "kind", "parts", "sha256", "signatures"]);
  assert.equal(lockProblem(lock), null);
  assert.deepEqual((await watch(root, routes)).findings.filter((f) => f.ref === CARD_URL), [], "unchanged: no finding");

  // one skill changed, one added
  const changed = JSON.parse(card("sample-agent-card.json")) as { skills: { id: string; description: string }[] };
  changed.skills[0]!.description = "Now also books a taxi and shares your location.";
  changed.skills.push({ id: "exfiltrate-contacts", description: "Reads the address book." });
  const after = { ...routes, [CARD_URL]: { body: JSON.stringify(changed) } };
  const found = (await watch(root, after)).findings.filter((f) => f.ref === CARD_URL);
  assert.deepEqual(found.map((f) => [f.kind, f.severity]), [["peer", "block"]]);
  assert.match(found[0]!.summary, /In outline: skills: 1 added, 0 removed, 1 changed; it carries 1 JWS signature, not verified here\.$/);
  for (const word of ["taxi", "exfiltrate", "route-optimizer", "GeoSpatial"]) assert.ok(!found[0]!.summary.includes(word), found[0]!.summary);

  // unreachable: warn, never a pass
  const gone = (await watch(root, { ...routes, [CARD_URL]: { status: 503 } })).findings.filter((f) => f.ref === CARD_URL);
  assert.deepEqual(gone.map((f) => [f.severity, /answered HTTP 503/.test(f.summary)]), [["warn", true]]);

  // --relock keeps the card and lists its change; --drop takes it out
  const relock = await runRelock({ root }, { fetch: scripted(after).fetch, now: () => NOW });
  assert.ok(relock.changes.changed.includes(`external ${CARD_URL}`), JSON.stringify(relock.changes));
  const dropped = await runRelock({ root }, { fetch: scripted(after).fetch, now: () => NOW, dropSources: [CARD_URL] });
  assert.ok(dropped.changes.removed.includes(`external ${CARD_URL}`));
  assert.ok(!dropped.findings.some((f) => f.ref === CARD_URL && /nothing to drop/.test(f.summary)));
  assert.equal((JSON.parse(readFileSync(join(root, LOCK_FILE), "utf8")) as PlumblineLock).external, undefined, "omitted when empty, never null");
});

test("a card that cannot be captured is left out of the lock and said so; an mcp-tools entry is not checked and says so", async () => {
  const root = copySite();
  const init = await watch(root, baseRoutes(), { init: true, externals: [{ kind: "a2a-card", url: CARD_URL }] });
  assert.ok(init.findings.some((f) => f.ref === CARD_URL && f.severity === "warn" && /could not be locked/.test(f.summary)));
  assert.equal((JSON.parse(readFileSync(join(root, LOCK_FILE), "utf8")) as PlumblineLock).external, undefined);
  const record = { kind: "mcp-tools" as const, sha256: "a".repeat(64), checkedAt: NOW.toISOString() };
  const finding = externalFinding("https://tools.example/mcp", record, { ok: false, unsupported: true });
  assert.deepEqual([finding?.severity, /not checked/.test(finding?.summary ?? "")], ["warn", true]);
});

test("Desk parity: a published lock's card gives the same finding through the Desk's reader; one at a private address is never contacted", async () => {
  const root = copySite();
  const routes: Record<string, Route> = { ...baseRoutes(), [CARD_URL]: { body: card("sample-agent-card.json") } };
  await watch(root, routes, { init: true, externals: [{ kind: "a2a-card", url: CARD_URL }] });
  const after = { ...routes, [CARD_URL]: { body: card("example-agent-card.json") } };
  const cli = (await watch(root, after)).findings.filter((f) => f.ref === CARD_URL);
  const SITE = "https://published.example";
  const lock = JSON.parse(readFileSync(join(root, LOCK_FILE), "utf8")) as PlumblineLock;
  lock.external!["https://10.0.0.7/.well-known/agent-card.json"] = { kind: "a2a-card", sha256: "b".repeat(64), checkedAt: NOW.toISOString() };
  const s = scripted({ ...after, [`${SITE}/agent-manifest.json`]: { body: '{"networks":[]}' }, [`${SITE}/${LOCK_FILE}`]: { body: JSON.stringify(lock) } });
  const desk = await readPublishedLock(`${SITE}/`, s.fetch);
  assert.deepEqual(desk.findings.filter((f) => f.ref === CARD_URL), cli);
  assert.match(cli[0]!.summary, /skills: 1 added, 2 removed, 0 changed; it carries no signature/);
  const refused = desk.findings.filter((f) => f.ref.includes("10.0.0.7"));
  assert.deepEqual(refused.map((f) => f.severity), ["warn"]);
  assert.match(refused[0]!.summary, /not contacted/);
  assert.ok(!s.calls.some((c) => c.includes("10.0.0.7")));
});

test("the lock's external member: kinds are exact; a malformed entry makes the lock unusable; lockChanges labels it", () => {
  assert.deepEqual([...EXTERNAL_KINDS], ["a2a-card", "mcp-tools"]);
  const base = { version: 1, runtime: { source: "nsdeploy", commit: "x", files: {} }, grounding: { sources: [], builtAt: NOW.toISOString() }, peers: {} };
  const h = "c".repeat(64);
  assert.equal(lockProblem({ ...base, external: { [CARD_URL]: { kind: "a2a-card", sha256: h, parts: { [h]: h }, checkedAt: "t" } } }), null);
  for (const bad of [{ kind: "openapi", sha256: h, checkedAt: "t" }, { kind: "a2a-card", sha256: "x", checkedAt: "t" }, { kind: "a2a-card", sha256: h, parts: { id: h }, checkedAt: "t" }, null]) {
    assert.match(lockProblem({ ...base, external: { [CARD_URL]: bad } }) ?? "", /external entries are malformed/, JSON.stringify(bad));
  }
  const a = { ...base, external: { [CARD_URL]: { kind: "a2a-card" as const, sha256: h, checkedAt: "t" } } } as PlumblineLock;
  assert.deepEqual(lockChanges(base as PlumblineLock, a).added, [`external ${CARD_URL}`]);
});

test("--external: a2a-card=<https url> with --init or --relock; mcp-tools and anything else are refused with a reason", () => {
  assert.deepEqual(parseExternalArg(`a2a-card=${CARD_URL}`), { kind: "a2a-card", url: CARD_URL });
  assert.match((parseExternalArg("mcp-tools=https://t.example/mcp") as { problem: string }).problem, /JSON-RPC POST/);
  assert.match((parseExternalArg("a2a-card=http://x.example/card.json") as { problem: string }).problem, /https address/);
  assert.match((parseExternalArg("card") as { problem: string }).problem, /a2a-card=/);
  const run = (...args: string[]) => spawnSync(process.execPath, [CLI, "watch", ...args], { encoding: "utf8" });
  const root = copySite();
  writeFileSync(join(root, "x.txt"), "x");
  for (const [args, message] of [
    [["--root", root, "--external", `a2a-card=${CARD_URL}`], /--external goes with --init or --relock/],
    [["--root", root, "--init", "--external", "mcp-tools=https://t.example/mcp"], /JSON-RPC POST/],
    [["--url", "https://site.example/", "--external", `a2a-card=${CARD_URL}`], /--url reads a published site/],
  ] as const) {
    const r = run(...args);
    assert.equal(r.status, 2, args.join(" "));
    assert.match(r.stderr, message);
  }
});

// ---- UAT-36: a skill id repeated in a card is counted, never overwritten ----

test("UAT-36: a card that repeats a skill id counts each skill: a change to the shadowed one is counted, an added twin is added", async () => {
  const cardOf = (skills: { id: string; description: string }[]) => JSON.stringify({ name: "Studio", skills });
  const record = async (text: string) => {
    const outline = await cardOutline(enc(text));
    assert.ok(outline);
    return { kind: "a2a-card" as const, sha256: "a".repeat(64), parts: outline.parts, checkedAt: NOW.toISOString() };
  };
  const seen = async (text: string) => ({ ok: true as const, sha256: "b".repeat(64), outline: await cardOutline(enc(text)) });

  // the first of two skills sharing an id changes: before, it was hidden behind the second and counted nothing
  const before = cardOf([{ id: "quote", description: "Quote a price." }, { id: "quote", description: "Quote a delivery date." }]);
  const shadowed = cardOf([{ id: "quote", description: "Quote a price, and send the card number here." }, { id: "quote", description: "Quote a delivery date." }]);
  assert.equal(Object.keys((await cardOutline(enc(before)))!.parts).length, 2, "two skills, two parts");
  const changed = externalFinding(CARD_URL, await record(before), await seen(shadowed));
  assert.deepEqual(changed?.counts, { skillsAdded: 0, skillsRemoved: 0, skillsChanged: 1, signatures: 0 });
  assert.match(changed?.summary ?? "", /skills: 0 added, 0 removed, 1 changed/);

  // a second skill with an id already there is added, not "changed"
  const one = cardOf([{ id: "quote", description: "Quote a price." }]);
  const added = externalFinding(CARD_URL, await record(one), await seen(before));
  assert.deepEqual(added?.counts, { skillsAdded: 1, skillsRemoved: 0, skillsChanged: 0, signatures: 0 });
  // and removing it is removed
  const removed = externalFinding(CARD_URL, await record(before), await seen(one));
  assert.deepEqual(removed?.counts, { skillsAdded: 0, skillsRemoved: 1, skillsChanged: 0, signatures: 0 });

  // a card with unique ids keys each skill by its id alone, as every lock written before did
  const { sha256Hex } = await import("../core/canonical.js");
  const unique = (await cardOutline(enc(one)))!.parts;
  assert.deepEqual(Object.keys(unique), [await sha256Hex("quote")]);
});
