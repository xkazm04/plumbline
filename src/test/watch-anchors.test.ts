// D8: grounding that checks facts. The literals a network's instructions state (fixed patterns, normalised), the
// anchors a page shares with it, and the count of anchors gone when the page changes. Severity stays warn; no literal
// is ever quoted. No network.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { sha256Hex } from "../core/canonical.js";
import { LOCK_FILE, type PlumblineLock } from "../core/types.js";
import { lockProblem } from "../watch/decide.js";
import { MAX_REDUCED_BYTES, anchorsOf, checkAnchors, extractLiterals, networkLiterals, normaliseNumber, pageText, reduceToText } from "../watch/anchors.js";
import { readPublishedLock } from "../watch/published.js";
import { copySite, scripted, type Route } from "./net-helpers.js";
import { baseRoutes, NOW, watch } from "./watch-helpers.js";

const kinds = (text: string, kind: string) => extractLiterals(text).filter((l) => l.startsWith(`${kind}:`));

test("money: symbols and codes before or after, thousands separators and a zero fraction normalised", () => {
  assert.deepEqual(kinds("€120, EUR 120 and 120 €", "money"), ["money:eur 120"]);
  assert.deepEqual(kinds("$1,500.00 or USD 1500", "money"), ["money:usd 1500"]);
  assert.deepEqual(kinds("1 250 Kč, 12,50 CHF, £7.5", "money"), ["money:chf 12.5", "money:czk 1250", "money:gbp 7.5"]);
  // not money: a bare number, a measure, a version
  assert.deepEqual(kinds("room 101, 12.50 m2, version 2.10.3, 120 guests", "money"), []);
  assert.deepEqual([normaliseNumber("1.500"), normaliseNumber("1,5"), normaliseNumber("1.250,00"), normaliseNumber("0.50")], ["1500", "1.5", "1250", "0.5"]);
});

test("times and opening hours: 24-hour and am/pm forms become HH:MM; a bare number or a decimal is not a time", () => {
  assert.deepEqual(kinds("open 9:00-17:30, tours at 2:30 p.m. and 3pm, closes 12 am", "time"), ["time:00:00", "time:09:00", "time:14:30", "time:15:00", "time:17:30"]);
  assert.deepEqual(kinds("open 9 to 5, 12.30 a coffee, ratio 3:1, 24:00, 13pm", "time"), []);
});

test("dates: ISO, day month year and month day year become ISO; numeric dates keep their order", () => {
  assert.deepEqual(kinds("on 2026-12-24, 24th December 2026 and Dec. 24, 2026", "date"), ["date:2026-12-24"]);
  assert.deepEqual(kinds("from 1.5.2026 to 05/01/2026", "date"), ["date:1/5/2026", "date:5/1/2026"]);
  assert.deepEqual(kinds("2026-13-40, the market 5 2026, May 2026", "date"), []);
});

test("phone numbers, e-mail addresses and percentages; a date or a price is not also a phone number", () => {
  assert.deepEqual(kinds("+420 123 456 789, 00420 123456789, (555) 123-4567", "phone"), ["phone:+420123456789", "phone:5551234567"]);
  assert.deepEqual(kinds("on 2026-11-18 for $1,234,567 or 12-34", "phone"), []);
  assert.deepEqual(kinds("Desk@Hotel.Example, not@local", "email"), ["email:desk@hotel.example"]);
  assert.deepEqual(kinds("15% off, 7.5 percent, 2,5 %", "percent"), ["percent:15%", "percent:2.5%", "percent:7.5%"]);
  assert.deepEqual(kinds("$15", "percent"), []);
});

test("a page is reduced to its text: scripts, styles and comments dropped, tags a space, entities decoded; binary and oversize refused", () => {
  assert.equal(reduceToText('<p>a<b>&euro;1</b></p><script>"€9"</script><style>x{}</style><!-- €5 -->&#36;7&amp;').replace(/\s+/g, " ").trim(), "a €1 $7&");
  assert.deepEqual(extractLiterals(reduceToText("<script>const p = '€999';</script><p>€120</p>")), ["money:eur 120"]);
  assert.deepEqual(pageText(new Uint8Array([0x3c, 0x00, 0x3e])), { problem: "is binary, not text" });
  assert.deepEqual(pageText(new Uint8Array([0xc3, 0x28])), { problem: "is not UTF-8 text" });
  assert.match((pageText(new Uint8Array(MAX_REDUCED_BYTES + 1).fill(0x41)) as { problem: string }).problem, /larger than the 524288 bytes/);
});

test("networkLiterals reads every agent's instructions only; anchorsOf keeps what the page states too, hashed", async () => {
  const net = JSON.stringify({ tools: [{ name: "a", instructions: "A room is €120. Call +420 123 456 789." }, { name: "b", instructions: "Open 7:30.", description: "€999" }] });
  assert.deepEqual(networkLiterals(net), ["money:eur 120", "phone:+420123456789", "time:07:30"]);
  assert.deepEqual(networkLiterals("{ not json"), []);
  const result = await anchorsOf(networkLiterals(net), new TextEncoder().encode("<p>Rooms from EUR 120.00; breakfast from 7:30.</p>"));
  assert.ok("anchors" in result);
  assert.deepEqual(result.anchors, [await sha256Hex("money:eur 120"), await sha256Hex("time:07:30")].sort());
  assert.deepEqual(await checkAnchors(result.anchors, new TextEncoder().encode("Rooms from €135, breakfast from 7:30.")), { total: 2, present: 1 });
});

const NETWORK = { tools: [{ name: "concierge", instructions: "A double room costs €120 a night. Breakfast is served 7:30 to 10:00. Call +420 123 456 789." }] };
const PAGE = (price: string, extra = "") => `<html><body><h1>Prices</h1><p>Double room: ${price} per night.</p><p>Breakfast 7:30 - 10:00.</p><p>Phone +420 123 456 789</p>${extra}</body></html>\n`;

function anchoredSite(): string {
  const root = copySite();
  writeFileSync(join(root, "fixture_guesthouse.network.json"), JSON.stringify({ ...NETWORK, link_labels: {} }));
  writeFileSync(join(root, "links.json"), '{ "version": 1, "networks": {} }\n');
  mkdirSync(join(root, "pages"), { recursive: true });
  writeFileSync(join(root, "pages", "prices.html"), PAGE("€120"));
  return root;
}

test("a fixture site whose price changes: the watch counts the anchored fact gone, stays warn, and quotes no literal", async () => {
  const root = anchoredSite();
  const init = await watch(root, baseRoutes(), { init: true, extraSources: ["pages/prices.html"] });
  assert.ok(!init.findings.some((f) => f.severity !== "info"), JSON.stringify(init.findings));
  const lock = JSON.parse(readFileSync(join(root, LOCK_FILE), "utf8")) as PlumblineLock;
  const page = lock.grounding.sources.find((s) => s.ref === "pages/prices.html");
  assert.equal(page?.anchors?.length, 4, "the price, two times and the phone number");
  assert.equal(lock.grounding.sources.find((s) => s.ref === "fixture_guesthouse.network.json")?.anchors, undefined, "the network itself is not anchored on itself");
  assert.equal(lockProblem(lock), null);

  writeFileSync(join(root, "pages", "prices.html"), PAGE("€135"));
  const changed = (await watch(root, baseRoutes())).findings.filter((f) => f.ref === "pages/prices.html");
  assert.deepEqual(changed.map((f) => f.severity), ["warn"]);
  assert.equal(changed[0]!.summary, "A grounding source changed since the lock was written; 1 of 4 facts the network states are no longer on it, so the network may now state an old fact.");
  for (const literal of ["120", "135", "€", "420", "7:30"]) assert.ok(!changed[0]!.summary.includes(literal), changed[0]!.summary);

  writeFileSync(join(root, "pages", "prices.html"), PAGE("€120", "<p>New: free parking.</p>"));
  const still = (await watch(root, baseRoutes())).findings.filter((f) => f.ref === "pages/prices.html");
  assert.equal(still[0]?.summary, "A grounding source changed since the lock was written; all 4 facts the network states from it are still on it.");
  assert.equal(still[0]?.severity, "warn", "a changed page is warn whatever the count says");

  writeFileSync(join(root, "pages", "prices.html"), new Uint8Array([0x3c, 0x00, 0x01]));
  const binary = (await watch(root, baseRoutes())).findings.filter((f) => f.ref === "pages/prices.html");
  assert.match(binary[0]!.summary, /its 4 facts the network states could not be checked: it is binary, not text\.$/);
});

test("Desk parity: the published lock's anchored page gives the same finding through the Desk's reader as through the CLI", async () => {
  const root = anchoredSite();
  await watch(root, baseRoutes(), { init: true, extraSources: ["pages/prices.html"] });
  writeFileSync(join(root, "pages", "prices.html"), PAGE("€99"));
  const cli = (await watch(root, baseRoutes())).findings.filter((f) => f.ref === "pages/prices.html");
  const SITE = "https://anchored.example";
  const published: Record<string, Route> = { [`${SITE}/agent-manifest.json`]: { body: readFileSync(join(root, "agent-manifest.json"), "utf8") } };
  const lock = JSON.parse(readFileSync(join(root, LOCK_FILE), "utf8")) as PlumblineLock;
  for (const ref of [LOCK_FILE, ...lock.grounding.sources.map((s) => s.ref)]) published[`${SITE}/${ref}`] = { body: readFileSync(join(root, ref), "utf8") };
  const desk = (await readPublishedLock(`${SITE}/`, scripted({ ...baseRoutes(), ...published }).fetch)).findings.filter((f) => f.ref === "pages/prices.html");
  assert.deepEqual(desk, cli);
  assert.match(cli[0]!.summary, /1 of 4 facts/);
});

test("the lock's anchors: an array of SHA-256 when present; anything else makes the lock unusable", () => {
  const lock = (anchors: unknown) => ({
    version: 1,
    runtime: { source: "nsdeploy", commit: "x", files: {} },
    grounding: { sources: [{ ref: "p.html", sha256: "a".repeat(64), anchors }], builtAt: NOW.toISOString() },
    peers: {},
  });
  assert.equal(lockProblem(lock(["b".repeat(64)])), null);
  assert.equal(lockProblem({ ...lock(undefined), grounding: { sources: [{ ref: "p.html", sha256: "a".repeat(64) }], builtAt: NOW.toISOString() } }), null);
  for (const bad of ["x", ["€120"], [1], null]) assert.match(lockProblem(lock(bad)) ?? "", /grounding sources are malformed/, JSON.stringify(bad));
});
