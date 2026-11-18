import assert from "node:assert/strict";
import { test } from "node:test";
import { runGate } from "../gate/index.js";
import { SafeFetchError } from "../net/safe-fetch.js";
import { fixture, scripted, type Route } from "./net-helpers.js";

const TARGET = "https://agent-atlas-phi.vercel.app/agent_atlas";
const ATLAS = "https://agent-atlas-phi.vercel.app";
const url = (target: string): string => `${ATLAS}/api/check?url=${encodeURIComponent(target)}`;

async function atlas(route: Route | undefined, target = TARGET) {
  const s = scripted(route === undefined ? {} : { [url(target)]: route });
  const report = await runGate({ target, adapters: ["atlas"] }, { fetch: s.fetch });
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0]?.adapter, "atlas");
  return { report, finding: report.findings[0]!, calls: s.calls };
}

test("atlas: pass, from the RECORDED real /api/check response for a conformant site", async () => {
  const { report, finding, calls } = await atlas({ body: fixture("atlas-check-conformant.json") });
  assert.equal(finding.state, "pass");
  assert.equal(report.state, "pass");
  assert.match(finding.summary, /conformant/);
  assert.match(finding.summary, /score 100/);
  // UAT-11: the target is read first (here its manifest answers 404, which is no refusal of the address), then one GET
  assert.deepEqual(calls.filter((c) => c.startsWith(`${ATLAS}/api/`)), [url(TARGET)], "one GET to /api/check with the target encoded");
  assert.equal(calls[calls.length - 1], url(TARGET), "Atlas is asked last, after the gate read the address itself");
});

test("atlas: fail, from the RECORDED real response for a site whose manifest has no such network", async () => {
  const { finding } = await atlas({ body: fixture("atlas-check-not-conformant.json") }, "https://agent-atlas-phi.vercel.app/no_such_network");
  assert.equal(finding.state, "fail");
  assert.match(finding.summary, /not conformant/);
  assert.match(finding.summary, /1 failed MUST check/);
  assert.match(finding.summary, /manifest\.exact/, "Atlas' own check id is named");
  assert.doesNotMatch(finding.summary, /Callers must fail/, "Atlas' prose is not copied");
});

test("atlas: fail when Atlas got an HTTP answer with no manifest (recorded response for example.com)", async () => {
  const { finding } = await atlas({ body: fixture("atlas-check-no-manifest.json") }, "https://example.com");
  assert.equal(finding.state, "fail");
  assert.match(finding.summary, /HTTP 404/);
});

test("atlas: unavailable when Atlas could not connect at all (the same shape with status 0)", async () => {
  const body = JSON.parse(fixture("atlas-check-no-manifest.json"));
  body.files[0].status = 0;
  body.files[0].error = "getaddrinfo EBUSY";
  const { finding, report } = await atlas({ body }, "https://example.com");
  assert.equal(finding.state, "unavailable");
  assert.equal(report.state, "unavailable");
});

test("atlas: conformant-with-warnings is a pass that says so", async () => {
  const body = JSON.parse(fixture("atlas-check-conformant.json"));
  body.summary.verdict = "conformant-with-warnings";
  body.summary.counts.warn = 2;
  const { finding } = await atlas({ body });
  assert.equal(finding.state, "pass");
  assert.match(finding.summary, /2 warnings/);
});

test("atlas: unavailable on a transport error, a timeout, a non-200, non-JSON, an unrecognised shape, or a contradiction", async () => {
  const cases: [string, Route | undefined][] = [
    ["unreachable host", undefined],
    ["timeout", { error: new SafeFetchError("timeout", "t") }],
    ["blocked address", { error: new SafeFetchError("blocked-address", "b") }],
    ["too large", { error: new SafeFetchError("body-too-large", "b") }],
    ["HTTP 500", { status: 500, body: "oops" }],
    ["HTTP 404", { status: 404, body: fixture("atlas-check-conformant.json") }],
    ["not JSON", { body: "<html>maintenance</html>" }],
    ["unrecognised shape", { body: { verdict: "ok" } }],
    ["no summary fields", { body: { summary: {}, checks: [] } }],
    ["unknown verdict", { body: { ...JSON.parse(fixture("atlas-check-conformant.json")), summary: { verdict: "excellent", score: 100, mustFails: 0, counts: {} } } }],
    ["conformant with failed MUST checks", { body: { ...JSON.parse(fixture("atlas-check-conformant.json")), summary: { verdict: "conformant", score: 100, mustFails: 2, counts: {} } } }],
  ];
  for (const [label, route] of cases) {
    const { finding, report } = await atlas(route);
    assert.equal(finding.state, "unavailable", label);
    assert.notEqual(report.state, "pass", label);
  }
});
