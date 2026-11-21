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
  // a phone number is its last nine digits, so a national and an international form of one number are one literal
  assert.deepEqual(kinds("+420 123 456 789, 00420 123456789, (555) 123-4567", "phone"), ["phone:123456789", "phone:551234567"]);
  assert.deepEqual(kinds("+44 1632 960418", "phone"), kinds("01632 960418", "phone"));
  assert.deepEqual(kinds("+44 (0)1632 960418", "phone"), kinds("+44 1632 960418", "phone"));
  // the earlier normalisation, for a lock written before 2026-11-19: read with legacy, never written
  assert.deepEqual(extractLiterals("+420 123 456 789", { legacy: true }), ["phone:+420123456789", "phone:123456789"]);
  assert.deepEqual(kinds("on 2026-11-18 for $1,234,567 or 12-34", "phone"), []);
  assert.deepEqual(kinds("Desk@Hotel.Example, not@local", "email"), ["email:desk@hotel.example"]);
  assert.deepEqual(kinds("15% off, 7.5 percent, 2,5 %", "percent"), ["percent:15%", "percent:2.5%", "percent:7.5%"]);
  assert.deepEqual(kinds("$15", "percent"), []);
});

test("a page is reduced to its text: scripts, styles and comments dropped, tags a space, entities decoded; binary and oversize refused", () => {
  // a cell or block tag is " | ", which no pattern reads across; an inline tag is a space
  assert.equal(reduceToText('<p>a<b>&euro;1</b></p><script>"€9"</script><style>x{}</style><!-- €5 -->&#36;7&amp;').replace(/\s+/g, " ").trim(), "| a €1 | $7&");
  assert.deepEqual(extractLiterals(reduceToText("<script>const p = '€999';</script><p>€120</p>")), ["money:eur 120"]);
  assert.deepEqual(pageText(new Uint8Array([0x3c, 0x00, 0x3e])), { problem: "is binary, not text" });
  assert.deepEqual(pageText(new Uint8Array([0xc3, 0x28])), { problem: "is not UTF-8 text" });
  assert.match((pageText(new Uint8Array(MAX_REDUCED_BYTES + 1).fill(0x41)) as { problem: string }).problem, /larger than the 524288 bytes/);
});

test("networkLiterals reads every agent's instructions only; anchorsOf keeps what the page states too, hashed", async () => {
  const net = JSON.stringify({ tools: [{ name: "a", instructions: "A room is €120. Call +420 123 456 789." }, { name: "b", instructions: "Open 7:30.", description: "€999" }] });
  assert.deepEqual(networkLiterals(net), ["money:eur 120", "phone:123456789", "time:07:30"]);
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
  assert.equal(
    changed[0]!.summary,
    "A grounding source changed since the lock was written; 1 of 4 facts the lock watches on it (facts the network states) is no longer on it, and the network still states it (1 price), so the agent may now answer with an old fact.",
  );
  for (const literal of ["120", "135", "€", "420", "7:30"]) assert.ok(!changed[0]!.summary.includes(literal), changed[0]!.summary);

  writeFileSync(join(root, "pages", "prices.html"), PAGE("€120", "<p>New: free parking.</p>"));
  const still = (await watch(root, baseRoutes())).findings.filter((f) => f.ref === "pages/prices.html");
  assert.equal(
    still[0]?.summary,
    "A grounding source changed since the lock was written; all 4 facts the lock watches on it (facts the network states) are still on it, so what changed is something the lock does not watch.",
  );
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

// ---- UAT-1: grounding watches what it says it watches ----

const page = (html: string) => extractLiterals(reduceToText(html));

test("UAT-1: a number cell before a price is never the amount; every form MAR-L2-02 found missed now anchors", () => {
  const anchored: [string, string][] = [
    ["<tr><td>Double room</td><td>2</td><td>€89 per night</td></tr>", "money:eur 89"],
    ["<tr><td>Room 4</td><td>€89</td></tr>", "money:eur 89"],
    ["<tr><td>Summer 2027</td><td>€89</td></tr>", "money:eur 89"],
    ["<tr><td>7</td><td>€560</td></tr>", "money:eur 560"],
    ["<tr><td>Double room</td><td>€89</td><td>120</td></tr>", "money:eur 89"],
    ["<tr><td>Double</td><td>2</td><td>£89</td></tr>", "money:gbp 89"],
    ["<p>Double room 2 €89 per night</p>", "money:eur 89"],
    ["<p>Double room 89 euros a night</p>", "money:eur 89"],
    ["<p>Doppelzimmer 89,- €</p>", "money:eur 89"],
    ["<p>Check-in from 15.00</p>", "time:15:00"],
    ["<p>Check-out by 10.30am</p>", "time:10:30"],
    ["<p>Arrivée à partir de 15h</p>", "time:15:00"],
    ["<p>Breakfast 08.00-09.30</p>", "time:08:00"],
    ["<p>Call 01632 960418</p>", "phone:632960418"],
    ["<p>Call +44 (0)1632 960418</p>", "phone:632960418"],
    ['<p><a href="tel:+441632960418">Call us</a></p>', "phone:632960418"],
    ['<p><a href="mailto:stay@larchhouse.example?subject=Booking">E-mail us</a></p>', "email:stay@larchhouse.example"],
  ];
  for (const [html, literal] of anchored) assert.ok(page(html).includes(literal), `${html} -> ${JSON.stringify(page(html))}`);
  // and nothing reads a number cell as the amount
  assert.deepEqual(page("<tr><td>Double room</td><td>2</td><td>€89 per night</td></tr>").filter((l) => l.startsWith("money:")), ["money:eur 89"]);
  assert.deepEqual(page("<tr><td>€89</td><td>120</td></tr>").filter((l) => l.startsWith("money:")), ["money:eur 89"]);
  // a split price inside one cell still reads
  assert.ok(page("<p>Double room <span>€</span><span>89</span></p>").includes("money:eur 89"));
  // the network side reads words too
  assert.deepEqual(networkLiterals(JSON.stringify({ tools: [{ instructions: "The double room costs 89 euros a night." }] })), ["money:eur 89"]);
});

test("UAT-1 residual (O-1): a symbol or code between two numbers binds to the following one, never the count before it", () => {
  assert.deepEqual(kinds("Sleeps 2 € 89", "money"), ["money:eur 89"]);
  assert.deepEqual(kinds("Sleeps 2 EUR 89", "money"), ["money:eur 89"]);
  assert.deepEqual(kinds("Sleeps 2 £ 89 a night", "money"), ["money:gbp 89"]);
  assert.deepEqual(kinds("2 € 89 €", "money"), ["money:eur 89"]);
  // number-first stays number-first when nothing numeric follows, or a separator does
  assert.deepEqual(kinds("Double room 89 € a night", "money"), ["money:eur 89"]);
  assert.deepEqual(page("<tr><td>89 €</td><td>2 nights</td></tr>").filter((l) => l.startsWith("money:")), ["money:eur 89"]);
});

test("UAT-1 residual (O-1): a currency word with its cents is one amount; a word between two bare numbers anchors nothing", () => {
  assert.deepEqual(kinds("for 2 euros 89 cents", "money"), ["money:eur 2.89"]);
  assert.deepEqual(kinds("3 pounds 50 pence", "money"), ["money:gbp 3.5"]);
  // the false-positive guard: never eur 2
  assert.ok(!kinds("for 2 euros 89 cents", "money").includes("money:eur 2"));
  assert.deepEqual(kinds("for 2 euros 89", "money"), []);
});

test("UAT-1 residual (O-1): a code written against its number anchors (EUR89), and a code inside a word does not", () => {
  assert.deepEqual(kinds("EUR89", "money"), ["money:eur 89"]);
  assert.deepEqual(kinds("only USD1,500 today", "money"), ["money:usd 1500"]);
  assert.deepEqual(kinds("neur89 europe 89", "money"), []);
});

test("UAT-1 residual (O-1): a run of years or a bare reference is not a phone number; a cued or grouped one still is", () => {
  assert.deepEqual(kinds("years 1998 2001 2010", "phone"), []);
  assert.deepEqual(kinds("ref 12 345 678", "phone"), []);
  assert.deepEqual(kinds("1998-2001-2010", "phone"), []);
  assert.deepEqual(kinds("recall 555 123 4567", "phone"), []);
  // a cue keeps the grouped form: a dialling word, parentheses, the national hyphen or dot grouping
  assert.deepEqual(kinds("Call us on 555 123 4567", "phone"), ["phone:551234567"]);
  assert.deepEqual(kinds("tel.: 12 345 678", "phone"), ["phone:12345678"]);
  assert.deepEqual(kinds("(555) 123 4567", "phone"), ["phone:551234567"]);
  assert.deepEqual(kinds("555-123-4567 or 555.123.4567", "phone"), ["phone:551234567"]);
});

test("UAT-1: the network's replacement strings are what its agents state", () => {
  const net = { commondefs: { replacement_strings: { rules: "Quiet hours are 22:00 to 07:00." } }, tools: [{ name: "a", instructions: "Check-in from 15:00. {rules} {missing}" }] };
  assert.deepEqual(networkLiterals(JSON.stringify(net)), ["time:07:00", "time:15:00", "time:22:00"]);
});

test("UAT-1: a 512 KiB page of pathological markup and numbers reduces and extracts in linear time", () => {
  const n = 512 * 1024;
  for (const text of ["<".repeat(n), "<a ".repeat(n / 3), "<!--".repeat(n / 4), "<script>".repeat(n / 8), "&a".repeat(n / 2), "100 200 ".repeat(n / 8), "+1 ".repeat(n / 3), "a.".repeat(n / 2), "1 2 3 ".repeat(n / 6), "0".repeat(n)]) {
    const started = Date.now();
    extractLiterals(reduceToText(text));
    assert.ok(Date.now() - started < 3000, `${JSON.stringify(text.slice(0, 12))}... took ${Date.now() - started} ms`);
  }
});

const LARCH = (price: string) => ({
  commondefs: { replacement_strings: { rules: "Quiet hours are 22:00 to 07:00." } },
  link_labels: {},
  tools: [{ name: "front", instructions: `The double room costs ${price} per night and the single room €69. Check-in is from 15:00. Call +44 1632 960418. {rules}` }],
});
const ROOMS = (price: string, intro = "Six rooms.") =>
  `<html><body><p>${intro}</p><table><tr><th>Room</th><th>Sleeps</th><th>Price</th></tr><tr><td>Double room</td><td>2</td><td>${price} per night</td></tr><tr><td>Single room</td><td>1</td><td>€69 per night</td></tr></table><p>Check-in is from 15:00. Call +44 1632 960418.</p></body></html>\n`;

function larchSite(): string {
  const root = copySite();
  writeFileSync(join(root, "fixture_guesthouse.network.json"), JSON.stringify(LARCH("€89")));
  writeFileSync(join(root, "links.json"), '{ "version": 1, "networks": {} }\n');
  writeFileSync(join(root, "rooms.html"), ROOMS("€89"));
  return root;
}

test("UAT-1: on a Sleeps-then-Price table, a raised price, a wording edit and a corrected network read three different ways", async () => {
  const root = larchSite();
  await watch(root, baseRoutes(), { init: true, extraSources: ["rooms.html"] });
  const rooms = () => watch(root, baseRoutes()).then((r) => r.findings.filter((f) => f.kind === "grounding" && /rooms\.html|guesthouse/.test(f.ref)));

  // raise-price: the page no longer states a price the network still states
  writeFileSync(join(root, "rooms.html"), ROOMS("€95"));
  const raised = await rooms();
  assert.deepEqual(raised.map((f) => [f.ref, f.severity]), [["rooms.html", "warn"]]);
  assert.match(raised[0]!.summary, /1 of 4 facts the lock watches on it \(facts the network states\) is no longer on it, and the network still states it \(1 price\), so the agent may now answer with an old fact\.$/);

  // cosmetic-edit: something else changed; every watched fact is still there
  writeFileSync(join(root, "rooms.html"), ROOMS("€89", "Six rooms under the larches."));
  const cosmetic = await rooms();
  assert.match(cosmetic[0]!.summary, /all 4 facts the lock watches on it \(facts the network states\) are still on it, so what changed is something the lock does not watch\.$/);
  assert.notEqual(cosmetic[0]!.summary, raised[0]!.summary);

  // fix-network: the network says €95 as the page does; no stale-fact sentence is left, only re-lock
  writeFileSync(join(root, "rooms.html"), ROOMS("€95"));
  writeFileSync(join(root, "fixture_guesthouse.network.json"), JSON.stringify(LARCH("€95")));
  const fixed = await rooms();
  const byRef = Object.fromEntries(fixed.map((f) => [f.ref, f.summary]));
  assert.match(byRef["rooms.html"] ?? "", /is no longer on it, and the network no longer states it either, so no stale fact is left: review the change, then re-lock \(watch --relock\)\.$/);
  assert.match(byRef["fixture_guesthouse.network.json"] ?? "", /the agent now answers from different facts: review the change, then re-lock \(watch --relock\)\.$/);
  for (const summary of Object.values(byRef)) assert.doesNotMatch(summary, /old fact/);
  for (const f of fixed) for (const literal of ["89", "95", "€", "1632"]) assert.ok(!f.summary.includes(literal), f.summary);

  // the Desk's reader says the same after the fix
  const SITE = "https://larch.example";
  const lock = JSON.parse(readFileSync(join(root, LOCK_FILE), "utf8")) as PlumblineLock;
  const published: Record<string, Route> = { [`${SITE}/agent-manifest.json`]: { body: readFileSync(join(root, "agent-manifest.json"), "utf8") } };
  for (const ref of [LOCK_FILE, ...lock.grounding.sources.map((s) => s.ref)]) published[`${SITE}/${ref}`] = { body: readFileSync(join(root, ref), "utf8") };
  const desk = (await readPublishedLock(`${SITE}/`, scripted({ ...baseRoutes(), ...published }).fetch)).findings.filter((f) => f.ref === "rooms.html");
  assert.equal(desk[0]?.summary, byRef["rooms.html"]);
});

test("UAT-1: a changed page the lock watches no fact on is not said to change what the agent answers", async () => {
  const root = larchSite();
  writeFileSync(join(root, "about.html"), "<p>A family house since 1962.</p>\n");
  const init = await watch(root, baseRoutes(), { init: true, extraSources: ["about.html"] });
  const zero = init.findings.find((f) => f.ref === "about.html");
  assert.equal(zero?.severity, "warn", "a page that watches no fact is a warning at capture");
  assert.match(zero?.summary ?? "", /^No fact is watched on this page: none of the 6 facts the network states \(2 prices, 3 times, 1 phone number\)/);
  writeFileSync(join(root, "about.html"), "<p>A family house since 1963.</p>\n");
  const changed = (await watch(root, baseRoutes())).findings.find((f) => f.ref === "about.html");
  assert.match(changed?.summary ?? "", /the lock watches no fact the network states on it, so whether the network now states an old fact is not checked/);
  assert.doesNotMatch(changed?.summary ?? "", /answers from different facts/);
});

test("UAT-1: a lock written before 2026-11-19 (a phone anchored with its country code) still reads the number on its page", async () => {
  const literal = "phone:+441632960418";
  const anchors = [await sha256Hex(literal)];
  assert.deepEqual(await checkAnchors(anchors, new TextEncoder().encode("<p>Call +44 1632 960418, new opening hours.</p>")), { total: 1, present: 1 });
});

test("UAT-1: the facts a lock watches, per page, in kinds; the literals only in the publisher's own lines", async () => {
  const { factCoverageLines, factCoverageCounts } = await import("../watch/anchors.js");
  const network = networkLiterals(JSON.stringify(LARCH("€89")));
  const coverage = { network, pages: [{ ref: "rooms.html", ...(pageFactsOf(network, ROOMS("€89"))) }] };
  const lines = factCoverageLines(coverage);
  assert.deepEqual(lines, [
    "facts the network states: 6 (2 prices, 3 times, 1 phone number)",
    "facts rooms.html: watches 4 (2 prices, 1 time, 1 phone number); not on it: 2 (2 times: 07:00, 22:00)",
    "facts not watched on any page: 2 (2 times: 07:00, 22:00); a change to them is not seen until a --source page states them",
  ]);
  assert.deepEqual(factCoverageCounts(coverage), { network: { money: 2, time: 3, phone: 1 }, pages: [{ ref: "rooms.html", watched: { money: 2, time: 1, phone: 1 }, notOnPage: { time: 2 } }], unwatched: { time: 2 } });
});

function pageFactsOf(network: string[], html: string): { watched: string[]; notOnPage: string[] } {
  const onPage = new Set(extractLiterals(reduceToText(html)));
  return { watched: network.filter((l) => onPage.has(l)), notOnPage: network.filter((l) => !onPage.has(l)) };
}

test("UAT-1: init and --relock print, per --source page, the kinds of fact watched and the network's facts not on it", async () => {
  const { run } = await import("./cli-helpers.js");
  const root = larchSite();
  const init = run("init", "--root", root, "--source", "rooms.html");
  assert.match(init.out, /^facts the network states: 6 \(2 prices, 3 times, 1 phone number\)$/m, init.out + init.err);
  assert.match(init.out, /^facts rooms\.html: watches 4 \(2 prices, 1 time, 1 phone number\); not on it: 2 \(2 times: 07:00, 22:00\)$/m);
  assert.match(init.out, /^facts not watched on any page: 2 \(2 times: 07:00, 22:00\)/m);
  // the next step no longer asks for the --source just given
  assert.doesNotMatch(init.out, /Name the pages whose facts your network states/);
  const json = JSON.parse(run("watch", "--root", root, "--relock", "--json").out) as { facts: { pages: { ref: string; watched: Record<string, number> }[] } };
  assert.deepEqual(json.facts.pages, [{ ref: "rooms.html", watched: { money: 2, time: 1, phone: 1 }, notOnPage: { time: 2 } }]);
  assert.doesNotMatch(JSON.stringify(json), /22:00|07:00|€|1632/, "--json carries counts, never a literal");
  const relock = run("watch", "--root", root, "--relock");
  assert.match(relock.out, /^facts rooms\.html: watches 4 /m);
});

// ---- UAT-2: an accept never silences a stale fact; a merge never closes clean over a broken signature ----

test("UAT-2: a relock does not accept a page that dropped a fact the network still states; it keeps the earlier record and says so", async () => {
  const { runRelock } = await import("../watch/index.js");
  const root = larchSite();
  await watch(root, baseRoutes(), { init: true, extraSources: ["rooms.html"] });
  const before = readFileSync(join(root, LOCK_FILE), "utf8");
  const pageBefore = (JSON.parse(before) as PlumblineLock).grounding.sources.find((s) => s.ref === "rooms.html");
  writeFileSync(join(root, "rooms.html"), ROOMS("€95"));
  const relocked = await runRelock({ root }, { fetch: scripted(baseRoutes()).fetch, now: () => NOW });
  assert.deepEqual(relocked.changes.changed, [], "rooms.html is not accepted");
  const kept = relocked.findings.find((f) => f.ref === "rooms.html");
  assert.equal(kept?.severity, "warn");
  assert.match(kept?.summary ?? "", /^Not accepted: the network still states 1 fact this page no longer states \(1 price\), and no other locked page states it/);
  assert.ok(!(kept?.summary ?? "").includes("89") && !(kept?.summary ?? "").includes("€"));
  const lock = JSON.parse(readFileSync(join(root, LOCK_FILE), "utf8")) as PlumblineLock;
  assert.deepEqual(lock.grounding.sources.find((s) => s.ref === "rooms.html"), pageBefore);
  // so the next watch still reports the stale fact
  const next = (await watch(root, baseRoutes())).findings.find((f) => f.ref === "rooms.html");
  assert.match(next?.summary ?? "", /the network still states it \(1 price\), so the agent may now answer with an old fact/);

  // once the network is corrected, the relock accepts the page
  writeFileSync(join(root, "fixture_guesthouse.network.json"), JSON.stringify(LARCH("€95")));
  const fixed = await runRelock({ root }, { fetch: scripted(baseRoutes()).fetch, now: () => NOW });
  assert.ok(fixed.changes.changed.includes("grounding rooms.html"), JSON.stringify(fixed.changes));
  assert.ok(!fixed.findings.some((f) => f.ref === "rooms.html"));
});

test("UAT-2: a fact moved to another locked page is not stale: the relock accepts the change", async () => {
  const { runRelock } = await import("../watch/index.js");
  const root = larchSite();
  writeFileSync(join(root, "prices.html"), "<p>Breakfast from 7:00.</p>\n");
  await watch(root, baseRoutes(), { init: true, extraSources: ["rooms.html", "prices.html"] });
  writeFileSync(join(root, "rooms.html"), ROOMS("€95"));
  writeFileSync(join(root, "prices.html"), "<p>Breakfast from 7:00. The double room is €89.</p>\n");
  const relocked = await runRelock({ root }, { fetch: scripted(baseRoutes()).fetch, now: () => NOW });
  assert.ok(relocked.changes.changed.includes("grounding rooms.html"), JSON.stringify(relocked.changes));
  assert.ok(!relocked.findings.some((f) => /Not accepted/.test(f.summary)));
});

test("UAT-2: the watch reports a site signature that no longer covers its files (no trust store), as a block", async () => {
  const { signatureCoverageFinding } = await import("../watch/decide.js");
  const root = larchSite();
  await watch(root, baseRoutes(), { init: true, extraSources: ["rooms.html"] });
  const hash = async (rel: string) => sha256Hex(readFileSync(join(root, rel)));
  const subjects = [{ path: "agent-manifest.json", sha256: await hash("agent-manifest.json") }, { path: LOCK_FILE, sha256: await hash(LOCK_FILE) }];
  writeFileSync(join(root, "plumbline.signature.json"), JSON.stringify({ type: "plumbline-signature", version: 1, kid: "a".repeat(16), expiresAt: "2027-06-01T00:00:00.000Z", subjects }));
  const clean = await watch(root, baseRoutes());
  assert.ok(!clean.findings.some((f) => f.ref === "plumbline.signature.json"), JSON.stringify(clean.findings));
  // an unsigned relock: the lock changes, the signature does not
  writeFileSync(join(root, LOCK_FILE), readFileSync(join(root, LOCK_FILE), "utf8").replace(/"builtAt": "[^"]+"/, '"builtAt": "2026-11-19T00:00:00.000Z"'));
  const broken = (await watch(root, baseRoutes())).findings.find((f) => f.ref === "plumbline.signature.json");
  assert.equal(broken?.severity, "block");
  assert.equal(
    broken?.summary,
    "The site's signature no longer covers its files: 1 of 2 signed files differs from the signed version or is missing (plumbline.lock.json), so verifiers now answer invalid (tampered) until the site is signed again (plumbline sign).",
  );
  // malformed subjects are not compared; a path outside the pattern is never read
  assert.equal(await signatureCoverageFinding([{ path: "../x", sha256: "a".repeat(64) }, { path: "a b", sha256: "b".repeat(64) }], async () => null), null);
});

// ---- MAR-RC-1: an anchor is a value in its place, not anywhere on the page ----

const TWIN_NET = (double: string) => ({
  link_labels: {},
  tools: [{ name: "front", instructions: `The double room costs ${double} per night, the twin room €89 per night and the single room €69. Check-in is from 15:00.` }],
});
const PRICES = (rows: [string, string][], intro = "Six rooms.") =>
  `<html><body><h1>Rooms and prices</h1><p>${intro}</p><table><tr><th>Room</th><th>Price</th></tr>${rows.map(([room, price]) => `<tr><td>${room}</td><td>${price} per night</td></tr>`).join("")}</table><h2>Arriving</h2><p>Check-in is from 15:00.</p></body></html>\n`;

async function placedSite(network: object, html: string): Promise<string> {
  const root = copySite();
  writeFileSync(join(root, "fixture_guesthouse.network.json"), JSON.stringify(network));
  writeFileSync(join(root, "links.json"), '{ "version": 1, "networks": {} }\n');
  writeFileSync(join(root, "rooms.html"), html);
  await watch(root, baseRoutes(), { init: true, extraSources: ["rooms.html"] });
  return root;
}
const roomsLine = async (root: string): Promise<string> => (await watch(root, baseRoutes())).findings.find((f) => f.ref === "rooms.html")?.summary ?? "";

test("MAR-RC-1 (M1): a twin room at the same price does not hide the double room's raise; the relock does not accept it; a corrected network does", async () => {
  const { runRelock } = await import("../watch/index.js");
  const root = await placedSite(TWIN_NET("€89"), PRICES([["Double room", "€89"], ["Twin room", "€89"], ["Single room", "€69"]]));
  const lock = JSON.parse(readFileSync(join(root, LOCK_FILE), "utf8")) as PlumblineLock;
  const page = lock.grounding.sources.find((s) => s.ref === "rooms.html");
  assert.ok(page?.places && Object.keys(page.places).length === 3, JSON.stringify(page));
  assert.ok(Object.keys(page.places).every((k) => page.anchors?.includes(k)));
  assert.ok(Object.values(page.places).flat().every((h) => /^[0-9a-f]{64}$/.test(h)), "places are hashes only");

  writeFileSync(join(root, "rooms.html"), PRICES([["Double room", "€95"], ["Twin room", "€89"], ["Single room", "€69"]]));
  const raised = await roomsLine(root);
  assert.match(
    raised,
    /; 1 of 3 facts the lock watches on it \(facts the network states\) is no longer on it where the lock recorded it \(it still appears elsewhere on the page, as another row's or section's value\), and the network still states it \(1 price\), so the agent may now answer with an old fact\.$/,
  );
  assert.doesNotMatch(raised, /something the lock does not watch/);
  const relocked = await runRelock({ root }, { fetch: scripted(baseRoutes()).fetch, now: () => NOW });
  assert.match(relocked.findings.find((f) => f.ref === "rooms.html")?.summary ?? "", /^Not accepted: the network still states 1 fact this page no longer states where the lock recorded it \(1 price\)/);
  assert.deepEqual(relocked.changes.changed, []);

  // the network corrected to the page: the twin room's €89 is where the network says it is, so nothing is stale
  writeFileSync(join(root, "fixture_guesthouse.network.json"), JSON.stringify(TWIN_NET("€95")));
  assert.match(await roomsLine(root), /no longer on it where the lock recorded it \(it still appears elsewhere on the page, as another row's or section's value\), and the network no longer states it there either, so no stale fact is left: review the change, then re-lock/);
  const fixed = await runRelock({ root }, { fetch: scripted(baseRoutes()).fetch, now: () => NOW });
  assert.ok(fixed.changes.changed.includes("grounding rooms.html"), JSON.stringify(fixed.changes));
  assert.ok(!fixed.findings.some((f) => /Not accepted/.test(f.summary)));
});

test("MAR-RC-1 (M2): a struck-through old price is not a price the page states", async () => {
  const root = await placedSite(TWIN_NET("€89"), PRICES([["Double room", "€89"], ["Single room", "€69"]]));
  writeFileSync(join(root, "rooms.html"), PRICES([["Double room", "<del>€89</del> €79"], ["Single room", "€69"]]));
  assert.match(await roomsLine(root), /; 1 of 3 facts the lock watches on it \(facts the network states\) is no longer on it, and the network still states it \(1 price\), so the agent may now answer with an old fact\.$/);
  assert.deepEqual(extractLiterals(reduceToText("<p><s>€89</s> <strike>€88</strike> €79 <span>€77</span></p>")), ["money:eur 77", "money:eur 79"]);
});

test("MAR-RC-1 (M4): 'Doubles from €89' in the introduction does not hide the table's raise; removing that line alone changes no watched fact", async () => {
  const intro = "Six rooms. Doubles from €89 a night.";
  const root = await placedSite(TWIN_NET("€89"), PRICES([["Double room", "€89"], ["Single room", "€69"]], intro));
  writeFileSync(join(root, "rooms.html"), PRICES([["Double room", "€95"], ["Single room", "€69"]], intro));
  assert.match(await roomsLine(root), /is no longer on it where the lock recorded it \(it still appears elsewhere on the page, as another row's or section's value\), and the network still states it \(1 price\), so the agent may now answer with an old fact\.$/);
  // the other way round: the introduction loses its line, the table still holds the double room's price where it was
  writeFileSync(join(root, "rooms.html"), PRICES([["Double room", "€89"], ["Single room", "€69"]], "Six quiet rooms."));
  assert.match(await roomsLine(root), /all 3 facts the lock watches on it \(facts the network states\) are still on it, so what changed is something the lock does not watch\.$/);
});

test("MAR-RC-1: a fact whose place cannot be told is never 'still on it': not checked, said at init and at the watch; an old lock reads the same", async () => {
  const net = { link_labels: {}, tools: [{ name: "front", instructions: "Coffee is €4." }] };
  const html = (extra = "") => `<html><body><h2>Morning</h2><p>Coffee €4.</p><h2>Evening</h2><p>Coffee €4.${extra}</p></body></html>\n`;
  const root = await placedSite(net, html());
  const page = (JSON.parse(readFileSync(join(root, LOCK_FILE), "utf8")) as PlumblineLock).grounding.sources.find((s) => s.ref === "rooms.html");
  assert.equal(page?.anchors?.length, 1);
  assert.equal(page?.places, undefined, "no place could be told: the member is omitted, never empty or null");
  writeFileSync(join(root, "rooms.html"), html(" Cake too."));
  const line = await roomsLine(root);
  assert.match(line, /; the 1 fact the lock watches on it \(a fact the network states\) is on it, but the lock does not record where on it the network's fact is \(stated in more than one place, or a lock written before places were recorded\), so whether it moved is not checked: review the change, then re-lock \(watch --relock\)\.$/);
  assert.doesNotMatch(line, /still on it|does not watch/);
  // init names it in the publisher's terminal
  const { run } = await import("./cli-helpers.js");
  const fresh = copySite();
  writeFileSync(join(fresh, "fixture_guesthouse.network.json"), JSON.stringify(net));
  writeFileSync(join(fresh, "links.json"), '{ "version": 1, "networks": {} }\n');
  writeFileSync(join(fresh, "rooms.html"), html());
  const init = run("init", "--root", fresh, "--source", "rooms.html");
  assert.match(init.out, /^facts rooms\.html: where on it not told: 1 \(1 price: EUR 4\); each is on the page in more than one place and none is named as the network names it, so a watch does not check whether it moved$/m, init.out + init.err);
  // a lock written before places: every anchor on the page is not checked for where it is, never "still on it"
  const twin = await placedSite(TWIN_NET("€89"), PRICES([["Double room", "€89"], ["Twin room", "€89"]]));
  const lockPath = join(twin, LOCK_FILE);
  const old = JSON.parse(readFileSync(lockPath, "utf8")) as PlumblineLock;
  for (const s of old.grounding.sources) delete s.places;
  writeFileSync(lockPath, JSON.stringify(old));
  writeFileSync(join(twin, "rooms.html"), PRICES([["Double room", "€95"], ["Twin room", "€89"]]));
  assert.match(await roomsLine(twin), /all 2 facts the lock watches on it \(facts the network states\) are on it, but the lock does not record where on it the network's facts are \(stated in more than one place, or a lock written before places were recorded\), so whether they moved is not checked/);
});

test("MAR-RC-1: a lock whose places do not belong to its anchors is unusable", async () => {
  const { lockProblem } = await import("../watch/decide.js");
  const h = "a".repeat(64);
  const lock = (source: object) => ({ version: 1, runtime: { source: "nsdeploy", commit: "unknown", files: {} }, grounding: { sources: [{ ref: "p.html", sha256: h, ...source }], builtAt: "x" }, peers: {} });
  assert.equal(lockProblem(lock({ anchors: [h], places: { [h]: ["b".repeat(64)] } })), null);
  assert.equal(lockProblem(lock({ anchors: [h], places: { ["c".repeat(64)]: ["b".repeat(64)] } })), "the lock's grounding sources are malformed");
  assert.equal(lockProblem(lock({ anchors: [h], places: { [h]: [] } })), "the lock's grounding sources are malformed");
  assert.equal(lockProblem(lock({ anchors: [h], places: null })), "the lock's grounding sources are malformed");
});

// ---- UAT-29: the counts a page's sentence says, as fields, and the owner's line made from them ----

test("UAT-29: a changed page carries its fact counts and the kinds of a stale fact; the owner's line is made from them", async () => {
  const { ownerLine } = await import("../watch/owner.js");
  const { ANCHOR_KINDS } = await import("../watch/anchors.js");
  const { FACT_KINDS } = await import("../core/types.js");
  assert.deepEqual([...FACT_KINDS].sort(), [...ANCHOR_KINDS].sort(), "the wire's kinds are the anchors' kinds");
  const root = larchSite();
  await watch(root, baseRoutes(), { init: true, extraSources: ["rooms.html"] });
  const page = async () => (await watch(root, baseRoutes())).findings;
  const rooms = (findings: Awaited<ReturnType<typeof page>>) => findings.find((f) => f.ref === "rooms.html");

  writeFileSync(join(root, "rooms.html"), ROOMS("€95"));
  const raised = await page();
  assert.equal(rooms(raised)?.code, "grounding-stale-fact");
  assert.deepEqual(rooms(raised)?.counts, { factsWatched: 4, factsGone: 1, factsUnplaced: 0, factsStale: 1, staleKinds: { money: 1 } });
  assert.equal(
    ownerLine(raised, { siteSigned: false }),
    "Your page rooms.html changed, and your assistant may still be telling visitors an old price from it: forward this to whoever looks after your website, who updates what the assistant says.",
  );

  writeFileSync(join(root, "rooms.html"), ROOMS("€89", "Six rooms under the larches."));
  const cosmetic = await page();
  assert.deepEqual(rooms(cosmetic)?.counts, { factsWatched: 4, factsGone: 0, factsUnplaced: 0, factsStale: 0 });
  assert.match(ownerLine(cosmetic) ?? "", /^Your page rooms\.html changed, but the 4 facts your assistant gives from it that Plumbline watches are all still there; it does not watch everything on the page/);

  // the right fix before the re-sign (MAR-RC-2): no alarm, one step left
  writeFileSync(join(root, "rooms.html"), ROOMS("€95"));
  writeFileSync(join(root, "fixture_guesthouse.network.json"), JSON.stringify(LARCH("€95")));
  const fixed = await page();
  assert.deepEqual(rooms(fixed)?.counts, { factsWatched: 4, factsGone: 1, factsUnplaced: 0, factsStale: 0 });
  assert.equal(
    ownerLine([...fixed, { severity: "block", code: "signature-not-covering", ref: "plumbline.signature.json" }]),
    "Your page rooms.html changed, and your assistant's facts from it changed to match, so no old fact is left: one step remains for whoever looks after your website, to record the change and sign the site again.",
  );
  assert.match(ownerLine(fixed, { siteSigned: false }) ?? "", /to record the change\.$/);
  for (const f of [...raised, ...cosmetic, ...fixed]) assert.ok(!JSON.stringify(f.counts ?? {}).match(/89|95|€/), "no literal in a count");

  // the Desk's reader carries the same counts
  const SITE = "https://larch.example";
  writeFileSync(join(root, "fixture_guesthouse.network.json"), JSON.stringify(LARCH("€89")));
  const lock = JSON.parse(readFileSync(join(root, LOCK_FILE), "utf8")) as PlumblineLock;
  const published: Record<string, Route> = { [`${SITE}/agent-manifest.json`]: { body: readFileSync(join(root, "agent-manifest.json"), "utf8") } };
  for (const ref of [LOCK_FILE, ...lock.grounding.sources.map((s) => s.ref)]) published[`${SITE}/${ref}`] = { body: readFileSync(join(root, ref), "utf8") };
  const desk = (await readPublishedLock(`${SITE}/`, scripted({ ...baseRoutes(), ...published }).fetch)).findings.find((f) => f.ref === "rooms.html");
  assert.deepEqual(desk?.counts, rooms(raised)?.counts);
});

test("UAT-29: the owner's line is never greener than the findings, and names no partner and no stranger's words", async () => {
  const { ownerLine, staleWords, pageName } = await import("../watch/owner.js");
  assert.equal(ownerLine([]), null, "a clean report has no owner's line");
  assert.equal(ownerLine([{ severity: "info", code: "upstream-ahead" }]), null, "an info is never news to an owner");
  assert.match(ownerLine([], { lockState: "unreadable" }) ?? "", /nothing about your assistant was checked this time/);
  assert.match(ownerLine([], { lockState: "absent" }) ?? "", /has not been set up for your site yet/);
  // a page whose facts could not all be placed is "could not tell", never "all still there"
  assert.match(ownerLine([{ severity: "warn", code: "grounding-changed", ref: "rooms.html", counts: { factsWatched: 3, factsGone: 0, factsUnplaced: 1 } }]) ?? "", /could not tell whether your assistant now gives an old fact/);
  // a gone fact with the networks unreadable is not the right fix
  assert.match(ownerLine([{ severity: "warn", code: "grounding-changed", ref: "rooms.html", counts: { factsWatched: 3, factsGone: 1, factsUnplaced: 0 } }]) ?? "", /could not tell/);
  // an unreachable partner is not an all-clear, and its address is never said
  const down = ownerLine([{ severity: "warn", code: "peer-unreachable", ref: "https://evil.example/<b>x</b>" }]) ?? "";
  assert.match(down, /this is not an all-clear/);
  assert.doesNotMatch(down, /evil|<b>/);
  // a partner's code change leads over a page's wording change, and the rest is counted
  assert.match(
    ownerLine([
      { severity: "warn", code: "grounding-changed", ref: "rooms.html", counts: { factsWatched: 4, factsGone: 0, factsUnplaced: 0, factsStale: 0 } },
      { severity: "block", code: "peer-changed", ref: "https://partner.example/net" },
    ]) ?? "",
    /^Code that runs your assistant in your visitors' browsers changed \(a partner service's\).*\(and 1 more thing below for them\)\.$/,
  );
  assert.equal(staleWords({ money: 2, time: 1 }), "old facts (2 prices, 1 time)");
  assert.equal(staleWords({}), "an old fact");
  assert.equal(pageName("https://site.example/pages/rooms.html"), "rooms.html");
  assert.equal(pageName("rooms <b>.html"), undefined);
  assert.match(ownerLine([{ severity: "warn", code: "grounding-stale-fact", ref: "x y.html" }]) ?? "", /^A page of your site changed/);
  // a report written before codes still gets a line that sends it on, never a green one
  assert.match(ownerLine([{ severity: "block", ref: "runtime/x.js" }]) ?? "", /^Plumbline found something on your site/);
});

// ---- UAT-31: the published reading says what the lock watches, in kinds, per source ----

test("UAT-31 (MAR-L1-12): the published reading carries the lock's sources and, per page, the kinds watched and not watched; never a value", async () => {
  const root = larchSite();
  await watch(root, baseRoutes(), { init: true, extraSources: ["rooms.html"] });
  const SITE = "https://larch.example";
  const lock = JSON.parse(readFileSync(join(root, LOCK_FILE), "utf8")) as PlumblineLock;
  const published: Record<string, Route> = { [`${SITE}/agent-manifest.json`]: { body: readFileSync(join(root, "agent-manifest.json"), "utf8") } };
  for (const ref of [LOCK_FILE, ...lock.grounding.sources.map((s) => s.ref)]) published[`${SITE}/${ref}`] = { body: readFileSync(join(root, ref), "utf8") };
  const reading = await readPublishedLock(`${SITE}/`, scripted({ ...baseRoutes(), ...published }).fetch);
  const facts = reading.facts;
  assert.ok(facts, "the network could be read");
  // the network states 2 prices, 2 times (15:00 and the quiet hours' 22:00, 07:00 among them) and a phone number
  assert.equal(facts.network, "2 prices, 3 times, 1 phone number");
  const rooms = facts.sources.find((s) => s.ref === "rooms.html");
  assert.deepEqual(rooms, { ref: "rooms.html", role: "page", watched: "2 prices, 1 time, 1 phone number", notWatched: "2 times" });
  assert.equal(facts.sources.find((s) => s.ref === "fixture_guesthouse.network.json")?.role, "network");
  assert.equal(facts.unwatched, "2 times");
  for (const literal of ["89", "69", "15:00", "1632"]) assert.ok(!JSON.stringify(facts).includes(literal), literal);
  // watch --url's report does not carry it: it is the Desk's tool result, not the wire's
  const { runWatchUrl } = await import("../watch/index.js");
  const report = await runWatchUrl({ url: `${SITE}/` }, { fetch: scripted({ ...baseRoutes(), ...published }).fetch });
  assert.equal(Object.hasOwn(report, "facts"), false);
});
