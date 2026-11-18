// D9: the ecosystem scan. The aggregator, the HTML (static, no script, every string escaped), the badge, the list
// parser, the per-site deadline and one site scanned end to end over a scripted fetcher. No network.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { LOCK_FILE, type DriftReport, type GateReport } from "../core/types.js";
import { SafeFetchError } from "../net/fetch-types.js";
import { BADGE_COLOURS, BADGE_GATES, BADGE_SIGNATURES, badgeColour, badgeSvg, type BadgeFacts } from "../scan/badge.js";
import { DISCLOSURE, driftStateOf, escapeHtml, renderHtml, summarise, type ScanReport, type SiteResult } from "../scan/report.js";
import { MAX_SITES, deadlineFetcher, parseList, scanList, scanSite } from "../scan/run.js";
import { badgeFactsOf, badgeStateOf } from "../cli/badge-command.js";
import { fixture, scripted } from "./net-helpers.js";
import { NOW } from "./watch-helpers.js";

const CLI = fileURLToPath(new URL("../cli/index.js", import.meta.url));
let tmp: string;
before(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "plumbline-scan-"));
});
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const gate = (state: GateReport["state"], ...states: GateReport["state"][]): GateReport => ({
  target: "https://x.example/",
  state,
  findings: states.map((s, i) => ({ adapter: `a${i}`, state: s, summary: "fixed" })),
});

function site(address: string, g: GateReport, watch: DriftReport, signature: SiteResult["signature"] = { state: "absent" }): SiteResult {
  return { address, gate: g, watch, drift: driftStateOf(watch), signature, keyRecord: { state: "absent" }, elapsedMs: 5, deadlinePassed: false };
}

test("driftStateOf: a lock that was not found is not checked, never clean; otherwise the worst severity", () => {
  assert.equal(driftStateOf({ lockState: "absent", lockSummary: "no lock", findings: [] }), "not-checked");
  assert.equal(driftStateOf({ lockState: "unreadable", lockSummary: "x", findings: [] }), "not-checked");
  assert.equal(driftStateOf({ lockState: "found", findings: [] }), "clean");
  assert.equal(driftStateOf({ lockState: "found", findings: [{ kind: "runtime", severity: "info", ref: "r", summary: "s" }] }), "info");
  const warn = { kind: "peer" as const, severity: "warn" as const, ref: "p", summary: "s" };
  assert.equal(driftStateOf({ lockState: "found", findings: [warn] }), "warn");
  assert.equal(driftStateOf({ lockState: "found", findings: [warn, { ...warn, severity: "block" }] }), "block");
});

test("summarise counts every state in its own bucket; unavailable is never counted as pass", () => {
  const sites = [
    site("https://a.example/", gate("pass", "pass"), { lockState: "found", findings: [] }, { state: "published", kid: "0123456789abcdef" }),
    site("https://b.example/", gate("unavailable", "unavailable", "unavailable"), { lockState: "absent", lockSummary: "no lock", findings: [] }),
    site("https://c.example/", gate("fail", "fail", "pass"), { lockState: "found", findings: [{ kind: "peer", severity: "block", ref: "p", summary: "s" }] }, { state: "unknown" }),
  ];
  assert.deepEqual(summarise(sites), {
    sites: 3,
    gate: { pass: 1, fail: 1, unavailable: 1 },
    lock: { found: 2, absent: 1, refused: 0, unreadable: 0, unusable: 0 },
    drift: { clean: 1, info: 0, warn: 0, block: 1, "not-checked": 1 },
    signature: { published: 1, absent: 1, unknown: 1 },
  });
});

test("renderHtml: static, no script, no external resource, every string escaped; the disclosure comes first", () => {
  const hostile = 'https://evil.example/"><script>alert(1)</script><img src=x onerror=alert(2)>';
  const report: ScanReport = {
    schema: "plumbline-ecosystem-scan",
    version: 1,
    scannedAt: NOW.toISOString(),
    tool: { name: "plumbline", version: "0.1.0" },
    disclosure: [...DISCLOSURE],
    settings: { siteDeadlineMs: 120000, delayMs: 2000 },
    summary: summarise([]),
    sites: [
      site(hostile, { target: hostile, state: "fail", findings: [{ adapter: "validator", state: "fail", summary: "<b>bold</b> & 'quoted'" }] }, {
        lockState: "found",
        findings: [{ kind: "peer", severity: "warn", ref: "https://p.example/<svg onload=x>", summary: "a </td> b" }],
      }),
    ],
  };
  const html = renderHtml(report);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<(img|svg)\b/i, "no markup from a report string survives");
  assert.doesNotMatch(html, /<[^>]*\son[a-z]+=/i, "no event handler attribute inside a real tag");
  assert.doesNotMatch(html, /\b(src|href)=["']?(https?:)?\/\//i, "no external resource or outbound link");
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;b&gt;bold&lt;\/b&gt; &amp; &#39;quoted&#39;/);
  assert.match(html, /a &lt;\/td&gt; b/);
  assert.match(html, /Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"/);
  assert.ok(html.indexOf("What this scan sent where") < html.indexOf("<h2>Sites</h2>"));
  assert.match(html, /Agent Atlas&#39; public check API/);
  assert.match(html, /unavailable \(not checked\)|not checked/);
  assert.equal(escapeHtml(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
});

const facts = (gate: BadgeFacts["gate"], signature: BadgeFacts["signature"]): BadgeFacts => ({ gate, signature, date: "2026-11-18" });

test("badgeSvg: the gate part, the signature part and the date always written; four colours; anything outside its list refused", () => {
  for (const g of BADGE_GATES) {
    for (const signature of BADGE_SIGNATURES) {
      const svg = badgeSvg(facts(g, signature));
      const colour = badgeColour(facts(g, signature));
      assert.match(svg, new RegExp(`fill="${BADGE_COLOURS[colour]}"`));
      assert.match(svg, /<title>Plumbline gate: [a-z ()]+, signature [a-z ()]+, checked on 2026-11-18<\/title>/);
      assert.match(svg, /role="img" aria-label="Plumbline gate: /);
      assert.doesNotMatch(svg, /<script|on[a-z]+=/i);
      // UAT-10: green only for a full pass with a verified signature; red for a failed checker or an invalid signature
      assert.equal(colour === "green", g === "pass" && signature === "verified", `${g} ${signature}`);
      if (g === "fail" || !["verified", "unverifiable", "not-checked"].includes(signature)) assert.equal(colour, "red", `${g} ${signature}`);
    }
  }
  assert.match(badgeSvg(facts("partly-checked", "not-checked")), />partly checked, signature not checked, 2026-11-18</);
  assert.match(badgeSvg(facts("pass", "tampered")), />pass, signature invalid \(tampered\), 2026-11-18</);
  assert.equal(badgeColour(facts("unreachable", "unverifiable")), "amber", "a site that did not answer has an alarm colour of its own");
  assert.equal(badgeColour(facts("pass", "not-checked")), "grey", "a signature not checked is never green");
  assert.equal(new Set(Object.values(BADGE_COLOURS)).size, 4);
  assert.throws(() => badgeSvg({ ...facts("pass", "verified"), gate: "warn" as never }));
  assert.throws(() => badgeSvg({ ...facts("pass", "verified"), signature: "green" as never }));
  assert.throws(() => badgeSvg({ ...facts("pass", "verified"), date: "18.11.2026" }));
  assert.throws(() => badgeSvg({ ...facts("pass", "verified"), date: '2026-11-18"><script>' }));
});

test("badgeStateOf: a report with nothing checked is drawn not checked; anything that is not a gate report is refused", () => {
  assert.equal(badgeStateOf(gate("pass", "pass")), "pass");
  assert.equal(badgeStateOf(gate("pass", "unavailable", "unavailable")), "unavailable", "the gate's own nothing-checked rule");
  assert.equal(badgeStateOf(gate("fail", "fail")), "fail");
  assert.equal(badgeStateOf({ state: "green", findings: [] }), null);
  assert.equal(badgeStateOf({ state: "pass" }), null);
  assert.equal(badgeStateOf({ state: "pass", findings: [{ state: "ok" }] }), null);
  assert.equal(badgeStateOf([]), null);
});

const CHECKED_AT = "2026-11-18T09:30:00.000Z";
const healthyDefault = (): GateReport => ({
  target: "https://x.example/",
  state: "unavailable",
  checkedAt: CHECKED_AT,
  findings: [
    { adapter: "validator", state: "pass", summary: "port: no problem" },
    { adapter: "atlas", state: "unavailable", summary: "Agent Atlas could not connect to the target, so it has no verdict about the site." },
    { adapter: "customs", state: "unavailable", summary: "no receipt for this target" },
  ],
});
const validatorOnly = (signature?: GateReport["signature"]): GateReport => ({
  target: "https://x.example/",
  state: "pass",
  checkedAt: CHECKED_AT,
  findings: [{ adapter: "validator", state: "pass", summary: "port: no problem" }],
  ...(signature ? { signature } : {}),
});

test("UAT-10 (PRI-L1-09, REC-5): healthy, down, tampered and expired sites draw different badges, and only a verified full pass is green", () => {
  const drawn = (r: unknown): BadgeFacts => {
    const f = badgeFactsOf(r);
    assert.ok("facts" in f, JSON.stringify(f));
    return f.facts;
  };
  const down: GateReport = {
    target: "https://x.example/",
    state: "unavailable",
    checkedAt: CHECKED_AT,
    findings: [{ adapter: "validator", state: "unavailable", summary: "The validator port could not run: the target could not be reached (the connection failed)." }],
    signature: { verdict: "unverifiable", detail: "The signature could not be checked (cannot fetch plumbline.signature.json ...), so this says nothing about it." },
  };
  const cases = {
    healthy: drawn(validatorOnly({ verdict: "verified", kid: "0123456789abcdef", detail: "ok" })),
    healthyDefault: drawn(healthyDefault()),
    down: drawn(down),
    tampered: drawn(validatorOnly({ verdict: "invalid", reason: "tampered", detail: "x" })),
    expired: drawn(validatorOnly({ verdict: "invalid", reason: "expired", detail: "x" })),
    unchecked: drawn(validatorOnly()),
  };
  const svgs = Object.values(cases).map((f) => badgeSvg(f));
  assert.equal(new Set(svgs).size, svgs.length, "no two of them are the same badge");
  assert.deepEqual(cases.healthyDefault, { gate: "partly-checked", signature: "not-checked", date: "2026-11-18" });
  assert.deepEqual(cases.down, { gate: "unreachable", signature: "unverifiable", date: "2026-11-18" });
  assert.equal(badgeColour(cases.healthy), "green");
  assert.equal(badgeColour(cases.tampered), "red");
  assert.equal(badgeColour(cases.expired), "red");
  assert.equal(badgeColour(cases.unchecked), "grey", "a pass whose signature was not checked is not green");
  assert.equal(badgeColour(cases.down), "amber");
  // a signature field that is not a verdict is not a gate report
  assert.ok("problem" in badgeFactsOf({ ...validatorOnly(), signature: { verdict: "green" } }));
  assert.ok("problem" in badgeFactsOf({ ...validatorOnly(), signature: { verdict: "invalid", reason: "odd" } }));
});

test("UAT-10 (PRI-L1-08): the badge is dated by the report's checkedAt; --now is refused, and so is a report with no time", () => {
  const report = path.join(tmp, "dated.json");
  writeFileSync(report, JSON.stringify(healthyDefault()));
  const svg = path.join(tmp, "dated.svg");
  const r = spawnSync(process.execPath, [CLI, "badge", "--report", report, "--out", svg], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^badge: wrote .*dated\.svg \(partly checked, signature not checked, 2026-11-18\)/);
  assert.match(readFileSync(svg, "utf8"), />partly checked, signature not checked, 2026-11-18</);
  const moved = spawnSync(process.execPath, [CLI, "badge", "--report", report, "--now", "2025-01-01T00:00:00Z"], { encoding: "utf8" });
  assert.equal(moved.status, 2);
  assert.match(moved.stderr, /--now cannot date a badge: its date is when the gate ran/);
  const { checkedAt: _unused, ...old } = healthyDefault();
  writeFileSync(report, JSON.stringify(old));
  const undated = spawnSync(process.execPath, [CLI, "badge", "--report", report], { encoding: "utf8" });
  assert.equal(undated.status, 2);
  assert.match(undated.stderr, /does not say when the gate ran .*run plumbline gate --json again/);
  writeFileSync(report, JSON.stringify({ ...healthyDefault(), checkedAt: "yesterday" }));
  assert.equal(spawnSync(process.execPath, [CLI, "badge", "--report", report], { encoding: "utf8" }).status, 2);
});

test("plumbline badge writes the SVG, and refuses a file that is not a gate report (exit 2)", () => {
  const report = path.join(tmp, "gate.json");
  writeFileSync(report, JSON.stringify({ ...gate("fail", "fail", "pass"), checkedAt: CHECKED_AT }));
  const svg = path.join(tmp, "gate.svg");
  const r = spawnSync(process.execPath, [CLI, "badge", "--report", report, "--out", svg], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^badge: wrote .*gate\.svg \(fail, signature not checked, 2026-11-18\)/);
  assert.match(readFileSync(svg, "utf8"), />fail, signature not checked, 2026-11-18</);
  const json = spawnSync(process.execPath, [CLI, "badge", "--report", report, "--out", svg, "--json"], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(json.stdout), { badge: svg, state: "fail", gate: "fail", signature: "not-checked", date: "2026-11-18", colour: "red" });
  writeFileSync(report, JSON.stringify({ verdict: "verified" }));
  const bad = spawnSync(process.execPath, [CLI, "badge", "--report", report], { encoding: "utf8" });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /must be a gate report/);
  assert.match(bad.stderr, /usage: plumbline badge/);
});

test("parseList: https only, no credentials, comments and blanks skipped, each address once, at most MAX_SITES", () => {
  const { addresses, problems } = parseList("# seed\n\nhttps://a.example/  # the first\nhttps://a.example/\nhttp://b.example/\nhttps://u:p@c.example/\nnot a url\r\nhttps://d.example/x\n");
  assert.deepEqual(addresses, ["https://a.example/", "https://d.example/x"]);
  assert.deepEqual(problems, ["line 5 is not an https address without credentials", "line 6 is not an https address without credentials", "line 7 is not a URL"]);
  const many = Array.from({ length: MAX_SITES + 1 }, (_, i) => `https://s${i}.example/`).join("\n");
  assert.match(parseList(many).problems.join(), new RegExp(`at most ${MAX_SITES}`));
});

test("deadlineFetcher: each fetch gets at most the time left, and a fetch after the deadline is refused as a timeout", async () => {
  let clock = 1_000;
  const seen: number[] = [];
  const inner = scripted({ "https://a.example/x": { body: "ok" } });
  const fetch = deadlineFetcher(async (url, options) => {
    seen.push(options?.timeoutMs ?? -1);
    return inner.fetch(url, options);
  }, 5_000, () => clock);
  await fetch("https://a.example/x", { timeoutMs: 10_000 });
  clock = 4_500;
  await fetch("https://a.example/x");
  assert.deepEqual(seen, [4_000, 500]);
  clock = 5_000;
  await assert.rejects(fetch("https://a.example/x"), (e: unknown) => e instanceof SafeFetchError && e.code === "timeout");
});

test("scanSite over a scripted site: the gate, the published lock's drift, the signature published and unverifiable here", async () => {
  const SITE = "https://agent-atlas-phi.vercel.app/";
  const routes = {
    // the gate: the validator reads the site; Atlas answers its recorded check; Customs has no receipt for it
    [`${SITE}agent-manifest.json`]: { body: fixture("atlas-site-manifest.json") },
    [`${SITE}agent_atlas.network.json`]: { body: fixture("atlas-site-network.json") },
    [`https://agent-atlas-phi.vercel.app/api/check?url=${encodeURIComponent(SITE)}`]: { body: fixture("atlas-check-conformant.json") },
    "https://montbaga.github.io/agent-customs/receipts/index.json": { body: fixture("customs-index.json") },
    "https://montbaga.github.io/agent-customs/.well-known/customs-key.json": { body: fixture("customs-key.json") },
    // the published lock: clean, nothing locked
    [`${SITE}${LOCK_FILE}`]: { body: { version: 1, runtime: { source: "nsdeploy", commit: "unknown", files: {} }, grounding: { sources: [], builtAt: NOW.toISOString() }, peers: {} } },
    [`${SITE}plumbline.signature.json`]: { body: { kid: "0123456789abcdef", expiresAt: "2027-01-30T00:00:00.000Z" } },
    [`${SITE}.well-known/plumbline-key.json`]: { body: { kid: "not a kid <b>" } },
  };
  const s = scripted(routes);
  const result = await scanSite(SITE, { fetch: s.fetch, now: () => NOW });
  assert.equal(result.address, SITE);
  assert.ok(["pass", "fail", "unavailable"].includes(result.gate.state));
  assert.equal(result.gate.findings.length, 3);
  assert.equal(result.watch.lockState, "found");
  assert.equal(result.drift, "info", "the not-checked sentence is info: clean");
  assert.deepEqual(result.signature, { state: "published", kid: "0123456789abcdef" });
  assert.equal(result.verdict, "unverifiable", "this scan trusts no key");
  assert.deepEqual(result.keyRecord, { state: "published" }, "a kid outside its pattern is never recorded");
  assert.equal(result.deadlinePassed, false);
  // scanList: the pause between sites, the disclosure and the summary
  const pauses: number[] = [];
  const report = await scanList([SITE, SITE], "0.1.0", { fetch: s.fetch, now: () => NOW, sleep: async (ms) => void pauses.push(ms) });
  assert.deepEqual(pauses, [2000], "one pause, between the two sites");
  assert.equal(report.schema, "plumbline-ecosystem-scan");
  assert.deepEqual(report.disclosure, [...DISCLOSURE]);
  assert.equal(report.summary.sites, 2);
  assert.equal(report.summary.signature.published, 2);
});

test("scanSite: a site past its deadline is unavailable and not checked, never pass or clean", async () => {
  let clock = 0;
  const s = scripted({});
  const result = await scanSite("https://slow.example/", {
    fetch: async (url, options) => {
      clock += 60_000; // every request takes a minute
      return s.fetch(url, options);
    },
    clock: () => clock,
    siteDeadlineMs: 120_000,
    now: () => NOW,
  });
  assert.equal(result.gate.state, "unavailable");
  assert.equal(result.drift, "not-checked");
  assert.equal(result.signature.state, "unknown");
  assert.equal(result.deadlinePassed, true);
});

test("UAT-9: partly checked is not not checked: the gate cell, the CLI's sentence and the site that could not be reached", async () => {
  const { gateSentence, siteUnreachable } = await import("../gate/context.js");
  const healthy: GateReport = {
    target: "https://healthy.example/",
    state: "unavailable",
    findings: [
      { adapter: "validator", state: "pass", summary: "The validator port found no problem: 1 network definition checked." },
      { adapter: "atlas", state: "unavailable", summary: "Agent Atlas could not connect to the target, so it has no verdict about the site." },
      { adapter: "customs", state: "unavailable", summary: "Unavailable: no receipt for this target in Agent Customs' published receipts." },
    ],
  };
  const down: GateReport = {
    target: "https://down.example/",
    state: "unavailable",
    findings: [
      { adapter: "validator", state: "unavailable", summary: "The validator port could not run: the target could not be reached (the request timed out)." },
      { adapter: "atlas", state: "unavailable", summary: "Agent Atlas answered HTTP 503, so there is no verdict." },
    ],
  };
  assert.equal(gateSentence(healthy), "checked by 1 of 3 (validator pass); Atlas and Customs had no verdict");
  assert.equal(siteUnreachable(healthy), null);
  assert.equal(gateSentence(down), "the site could not be reached (the request timed out); nothing was checked, so this is not a pass");
  assert.equal(gateSentence({ findings: [{ adapter: "atlas", state: "unavailable", summary: "x" }] }), "nothing was checked: every checker was unavailable, so this is not a pass");
  assert.equal(gateSentence({ findings: [{ adapter: "validator", state: "pass", summary: "ok" }, { adapter: "atlas", state: "fail", summary: "no" }] }), "checked by 2 of 2 (validator pass, Atlas fail)");
  const report: ScanReport = {
    schema: "plumbline-ecosystem-scan",
    version: 1,
    scannedAt: NOW.toISOString(),
    tool: { name: "plumbline", version: "0.1.0" },
    disclosure: [...DISCLOSURE],
    settings: { siteDeadlineMs: 120000, delayMs: 2000 },
    summary: summarise([]),
    sites: [site(healthy.target, healthy, { lockState: "found", findings: [] }), site(down.target, down, { lockState: "unreadable", lockSummary: "x", findings: [] })],
  };
  const html = renderHtml(report);
  assert.match(html, /<td class="s-unavailable">unavailable: checked by 1 of 3 \(validator pass\); Atlas and Customs had no verdict<\/td>/);
  assert.match(html, /<td class="s-unreachable">unavailable: the site could not be reached \(the request timed out\); nothing was checked, so this is not a pass<\/td>/);
  assert.match(html, /td\.s-unreachable \{ color: #b71c1c; font-weight: bold; \}/);
});
