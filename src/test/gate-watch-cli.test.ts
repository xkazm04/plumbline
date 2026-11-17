// Exit codes of `plumbline gate` and `plumbline watch`, through the built CLI. Every spawned CLI runs with the
// no-network preload (src/test/no-network.ts): any name lookup fails, so nothing here can reach the internet. The
// targets are private addresses (refused before connecting) or the loopback test server.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { GateReport } from "../core/types.js";
import { ALLOW_LOCAL_WARNING, NOTHING_CHECKED, gateExitCode } from "../cli/gate-command.js";
import { fixture, loopbackServer } from "./net-helpers.js";

const CLI = fileURLToPath(new URL("../cli/index.js", import.meta.url));
const NO_NETWORK = new URL("./no-network.js", import.meta.url).href;

interface Run {
  code: number | null;
  out: string;
  err: string;
}

/** Spawns the CLI without blocking this process, so the loopback server in this process can answer it. */
function runAsync(cwd: string, ...args: string[]): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", NO_NETWORK, CLI, ...args], { cwd });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => (out += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

function runSync(cwd: string, ...args: string[]): Run {
  const r = spawnSync(process.execPath, ["--import", NO_NETWORK, CLI, ...args], { cwd, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

let tmp: string;
before(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "plumbline-gw-"));
});
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const report = (...states: GateReport["state"][]): GateReport => {
  const rank = { pass: 0, unavailable: 1, fail: 2 } as const;
  const worst = states.reduce<GateReport["state"]>((w, s) => (rank[s] > rank[w] ? s : w), "pass");
  return {
    target: "https://site.example/",
    state: states.length === 0 ? "unavailable" : worst,
    findings: states.map((state, i) => ({ adapter: `a${i}`, state, summary: "x" })),
  };
};

test("gateExitCode: nothing checked is exit 1 whatever --fail-on says; otherwise --fail-on decides as before", () => {
  for (const failOn of ["fail", "unavailable"] as const) {
    assert.equal(gateExitCode(report("unavailable", "unavailable", "unavailable"), failOn), 1);
    assert.equal(gateExitCode(report(), failOn), 1);
    assert.equal(gateExitCode(report("pass", "pass"), failOn), 0);
    assert.equal(gateExitCode(report("pass", "fail", "unavailable"), failOn), 1);
  }
  assert.equal(gateExitCode(report("pass", "unavailable"), "fail"), 0, "some unavailable, --fail-on fail: passes as before");
  assert.equal(gateExitCode(report("pass", "unavailable"), "unavailable"), 1);
});

test("gate with no target exits 2 with the usage line", () => {
  const r = runSync(tmp, "gate");
  assert.equal(r.code, 2);
  assert.match(r.err, /usage: plumbline gate/);
});

test("gate against an unreachable host: every adapter unavailable, exit 1 under either --fail-on, and it says nothing was checked", async () => {
  for (const failOn of ["fail", "unavailable"]) {
    const r = await runAsync(tmp, "gate", "https://10.0.0.1/", "--fail-on", failOn, "--timeout", "2000", "--json");
    assert.equal(r.code, 1, `--fail-on ${failOn}: ${r.err}`);
    const parsed = JSON.parse(r.out) as GateReport;
    assert.equal(parsed.state, "unavailable");
    assert.equal(parsed.findings.length, 3);
    assert.ok(parsed.findings.every((f) => f.state === "unavailable"));
    assert.ok(r.err.includes(NOTHING_CHECKED), r.err);
    // proof the preload held: Atlas' public host was looked up and the lookup failed, so nothing left this machine
    assert.match(parsed.findings.find((f) => f.adapter === "atlas")?.summary ?? "", /did not resolve/);
  }
});

test("gate --allow-local: a loopback site is reachable only with the flag, which warns; private ranges stay refused", async () => {
  const site = await loopbackServer((req, res) => {
    const p = new URL(req.url ?? "/", "http://x").pathname;
    if (p === "/agent-manifest.json") res.end(fixture("atlas-site-manifest.json"));
    else if (p === "/agent_atlas.network.json") res.end(fixture("atlas-site-network.json"));
    else res.writeHead(404).end("no");
  });
  try {
    const target = `${site.url}/`;
    const allowed = await runAsync(tmp, "gate", target, "--adapters", "validator", "--allow-local", "--json");
    assert.equal(allowed.code, 0, allowed.out + allowed.err);
    assert.deepEqual((JSON.parse(allowed.out) as GateReport).findings.map((f) => [f.adapter, f.state]), [["validator", "pass"]]);
    assert.ok(allowed.err.includes(ALLOW_LOCAL_WARNING), allowed.err);

    const refused = await runAsync(tmp, "gate", target, "--adapters", "validator", "--json");
    assert.equal(refused.code, 1);
    assert.equal((JSON.parse(refused.out) as GateReport).state, "unavailable");
    assert.ok(!refused.err.includes("--allow-local:"), "no warning without the flag");

    const privateRange = await runAsync(tmp, "gate", "http://10.0.0.1/", "--adapters", "validator", "--allow-local", "--json");
    assert.equal(privateRange.code, 1);
    const finding = (JSON.parse(privateRange.out) as GateReport).findings[0];
    assert.equal(finding?.state, "unavailable");
    assert.match(finding?.summary ?? "", /private or loopback/);
  } finally {
    await site.close();
  }
});

test("watch: an empty folder exits 1 with 'no lock'; --init exits 0; a second run exits 0", () => {
  const root = mkdtempSync(path.join(tmp, "watch-"));
  const first = runSync(root, "watch", "--root", root);
  assert.equal(first.code, 1, first.err);
  assert.match(first.out, /no lock/);

  const init = runSync(root, "watch", "--root", root, "--init");
  assert.equal(init.code, 0, init.out + init.err);

  const second = runSync(root, "watch", "--root", root, "--timeout", "2000", "--json");
  assert.equal(second.code, 0, second.out + second.err);
  const findings = (JSON.parse(second.out) as { findings: { severity: string; summary: string }[] }).findings;
  assert.ok(findings.every((f) => f.severity === "info"), JSON.stringify(findings));
  // the upstream check could not ask GitHub (no network in tests), which is info, never a failure
  assert.ok(findings.some((f) => /Could not check upstream/.test(f.summary)), JSON.stringify(findings));
});
