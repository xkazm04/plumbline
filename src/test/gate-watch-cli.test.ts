// Exit codes of `plumbline gate` and `plumbline watch`, through the built CLI. Every spawned CLI runs with the
// no-network preload (src/test/no-network.ts): any name lookup fails, so nothing here can reach the internet. The
// targets are private addresses (refused before connecting) or the loopback test server.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

    // p-a851cc: the text report a person reads in a terminal or a CI log: the gate line, then one line per adapter
    const text = await runAsync(tmp, "gate", target, "--adapters", "validator", "--allow-local");
    assert.equal(text.code, 0, text.out + text.err);
    const lines = text.out.trimEnd().split("\n");
    assert.equal(lines[0], `gate pass: ${target}`);
    assert.equal(lines.length, 2, text.out);
    assert.match(lines[1] ?? "", /^ {2}pass {8}validator: Plumbline's port of the reference validation rules \(not the reference code\) found no problem/);

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

test("gate refuses an unknown adapter, a bad --fail-on, a bad --timeout and a second target, each with exit 2 and the usage line", () => {
  const cases: [string[], RegExp][] = [
    [["gate", "https://site.example/", "--adapters", "validator,oracle"], /unknown adapter in --adapters \(known: validator, atlas, customs\)/],
    [["gate", "https://site.example/", "--adapters", ""], /unknown adapter in --adapters/],
    // p-b02834: parsed by args.ts; a flag with no value after it reads as the bad value it is
    [["gate", "https://site.example/", "--adapters"], /unknown adapter in --adapters/],
    [["gate", "https://site.example/", "--timeout"], /--timeout takes a positive number of milliseconds/],
    [["gate", "https://site.example/", "--timeout", "--json"], /--timeout takes a positive number of milliseconds/],
    [["gate", "--verbose", "https://site.example/"], /unknown option --verbose/],
    [["gate", "https://site.example/", "--fail-on", "warn"], /--fail-on takes fail or unavailable/],
    [["gate", "https://site.example/", "--fail-on"], /--fail-on takes fail or unavailable/],
    [["gate", "https://site.example/", "--timeout", "-5"], /--timeout takes a positive number of milliseconds/],
    [["gate", "https://site.example/", "--timeout", "soon"], /--timeout takes a positive number of milliseconds/],
    [["gate", "https://site.example/", "https://other.example/"], /unexpected argument/],
    [["gate", "https://site.example/", "--verbose"], /unknown option --verbose/],
    // p-bd5d12: a target that is not an http(s) URL is a usage error before any adapter runs (old: a gate was run)
    [["gate", "example.com"], /the target must be an http\(s\) URL/],
    [["gate", "ftp://example.com/x"], /the target must be an http\(s\) URL/],
    [["gate", "example.com:8443/net", "--json"], /the target must be an http\(s\) URL/],
  ];
  for (const [args, message] of cases) {
    const r = runSync(tmp, ...args);
    assert.equal(r.code, 2, args.join(" "));
    assert.match(r.err, message, args.join(" "));
    assert.match(r.err, /usage: plumbline gate/, args.join(" "));
    assert.equal(r.out, "", "nothing is checked on a usage error");
  }
});

test("watch --init --source locks the extra source as grounding, beside what the root names", () => {
  const root = mkdtempSync(path.join(tmp, "watch-src-"));
  writeFileSync(path.join(root, "agent-manifest.json"), '{ "networks": [] }\n');
  mkdirSync(path.join(root, "data"));
  writeFileSync(path.join(root, "data", "rooms.json"), '{ "rooms": [1, 2] }\n');
  const init = runSync(root, "watch", "--root", root, "--init", "--source", "data/rooms.json", "--source", "data/missing.json", "--json");
  // the missing source is a warn finding at init, and is left out of the lock
  assert.equal(init.code, 1, init.out + init.err);
  const lock = JSON.parse(readFileSync(path.join(root, "plumbline.lock.json"), "utf8")) as { grounding: { sources: { ref: string }[] } };
  assert.deepEqual(lock.grounding.sources.map((s) => s.ref), ["agent-manifest.json", "data/rooms.json"]);
  const r = runSync(root, "watch", "--root", root, "--source");
  assert.equal(r.code, 2);
  assert.match(r.err, /--source takes a path or an https URL/);
});

test("watch --relock rewrites the lock, prints what changed and the re-sign reminder, and exits 0; --init with --relock is a usage error", () => {
  const root = mkdtempSync(path.join(tmp, "watch-relock-"));
  writeFileSync(path.join(root, "agent-manifest.json"), '{ "networks": [] }\n');
  writeFileSync(path.join(root, "links.json"), '{ "version": 1, "networks": {} }\n');
  assert.equal(runSync(root, "watch", "--root", root, "--init").code, 0);
  writeFileSync(path.join(root, "links.json"), '{ "version": 1, "networks": { "x": {} } }\n');
  assert.equal(runSync(root, "watch", "--root", root, "--timeout", "2000").code, 1, "the change is drift until it is accepted");

  const text = runSync(root, "watch", "--root", root, "--relock", "--timeout", "2000");
  assert.equal(text.code, 0, text.out + text.err);
  assert.match(text.out, /^relock: wrote plumbline\.lock\.json \(the previous lock was found\)$/m);
  assert.match(text.out, /^changed grounding links\.json$/m);
  assert.match(text.out, /plumbline\.lock\.json is a signed file: sign the site again/);
  assert.equal(runSync(root, "watch", "--root", root, "--timeout", "2000").code, 0, "clean after the re-lock");

  const json = runSync(root, "watch", "--root", root, "--relock", "--json", "--timeout", "2000");
  assert.equal(json.code, 0);
  const parsed = JSON.parse(json.out) as { relocked: boolean; previous: string; changes: { added: string[]; removed: string[]; changed: string[] }; reminder: string };
  assert.deepEqual([parsed.relocked, parsed.previous, parsed.changes], [true, "found", { added: [], removed: [], changed: [] }]);
  assert.match(parsed.reminder, /signed file/);

  const both = runSync(root, "watch", "--root", root, "--init", "--relock");
  assert.equal(both.code, 2);
  assert.match(both.err, /--init and --relock do not go together/);
});

test("REGRESSION (p-8478a5): watch --relock --drop <ref> takes a grounding source out of the lock and lists it as removed", () => {
  // Old code: --relock re-captured every ref the previous lock held, and --drop was an unknown argument (exit 2).
  const root = mkdtempSync(path.join(tmp, "watch-drop-"));
  writeFileSync(path.join(root, "agent-manifest.json"), '{ "networks": [] }\n');
  mkdirSync(path.join(root, "data"));
  writeFileSync(path.join(root, "data", "rooms.json"), '{ "rooms": [1] }\n');
  writeFileSync(path.join(root, "data", "menu.json"), '{ "menu": [] }\n');
  const refs = () => (JSON.parse(readFileSync(path.join(root, "plumbline.lock.json"), "utf8")) as { grounding: { sources: { ref: string }[] } }).grounding.sources.map((s) => s.ref);
  assert.equal(runSync(root, "watch", "--root", root, "--init", "--source", "data/rooms.json", "--source", "data/menu.json").code, 0);
  assert.deepEqual(refs(), ["agent-manifest.json", "data/rooms.json", "data/menu.json"]);

  const dropped = runSync(root, "watch", "--root", root, "--relock", "--drop", "data/rooms.json", "--timeout", "2000");
  assert.equal(dropped.code, 0, dropped.out + dropped.err);
  assert.match(dropped.out, /^removed grounding data\/rooms\.json$/m);
  assert.deepEqual(refs(), ["agent-manifest.json", "data/menu.json"]);
  // a later re-lock does not bring it back, and the watch is clean without it
  assert.match(runSync(root, "watch", "--root", root, "--relock", "--timeout", "2000").out, /^no ref changed$/m);
  assert.equal(runSync(root, "watch", "--root", root, "--timeout", "2000").code, 0);

  // a file the site itself names can be dropped, and the relock says every watch will report it as not covered
  const named = runSync(root, "watch", "--root", root, "--relock", "--drop", "agent-manifest.json", "--json", "--timeout", "2000");
  assert.equal(named.code, 0, named.out + named.err);
  const parsed = JSON.parse(named.out) as { changes: { removed: string[] }; findings: { severity: string; ref: string; summary: string }[] };
  assert.deepEqual(parsed.changes.removed, ["grounding agent-manifest.json"]);
  const warned = parsed.findings.filter((f) => f.severity !== "info"); // "no runtime folder" is info
  assert.deepEqual(warned.map((f) => [f.severity, f.ref]), [["warn", "agent-manifest.json"]]);
  assert.match(warned[0]!.summary, /still names/);
  // a ref that is not in the lock is said so, and nothing else changes
  const nothing = runSync(root, "watch", "--root", root, "--relock", "--drop", "data/none.json", "--json", "--timeout", "2000");
  const none = JSON.parse(nothing.out) as { changes: { removed: string[] }; findings: { severity: string; ref: string; summary: string }[] };
  assert.deepEqual(none.changes.removed, []);
  assert.ok(none.findings.some((f) => f.severity === "info" && f.ref === "data/none.json" && /was not in the lock/.test(f.summary)), JSON.stringify(none.findings));
});

test("p-cf22cb: watch refuses a bad --root, --timeout, --drop or argument, each with exit 2, the usage line and nothing on stdout", () => {
  const cases: [string[], RegExp][] = [
    [["watch", "--root"], /--root takes a folder/],
    [["watch", "--timeout", "0"], /--timeout takes a positive number of milliseconds/],
    [["watch", "--timeout", "soon"], /--timeout takes a positive number of milliseconds/],
    [["watch", "--timeout"], /--timeout takes a positive number of milliseconds/],
    [["watch", "--verbose"], /unknown argument --verbose/],
    [["watch", "somewhere"], /unknown argument somewhere/],
    [["watch", "--source"], /--source takes a path or an https URL/],
    // p-b02834: parsed by args.ts; an empty value is refused like a missing one, as the hand-rolled loop did
    [["watch", "--root", ""], /--root takes a folder/],
    [["watch", "--source", "a.json", "--source", ""], /--source takes a path or an https URL/],
    [["watch", "--relock", "--drop", ""], /--drop takes a grounding ref/],
    [["watch", "--init", "--source", "a.json", "extra"], /unknown argument extra/],
    [["watch", "--relock", "--drop"], /--drop takes a grounding ref/],
    [["watch", "--drop", "data/rooms.json"], /--drop goes with --relock/],
    [["watch", "--relock", "--source", "a.json", "--drop", "a.json"], /--source and --drop name the same ref/],
    [["watch", "--init", "--relock"], /--init and --relock do not go together/],
  ];
  const root = mkdtempSync(path.join(tmp, "watch-usage-"));
  for (const [args, message] of cases) {
    const r = runSync(root, ...args);
    assert.equal(r.code, 2, args.join(" "));
    assert.match(r.err, message, args.join(" "));
    assert.match(r.err, /usage: plumbline watch/, args.join(" "));
    assert.equal(r.out, "", `nothing is reported on a usage error: ${args.join(" ")}`);
  }
  assert.ok(!existsSync(path.join(root, "plumbline.lock.json")), "no usage error writes a lock");
});

test("p-cf22cb: a watch that cannot write its lock exits 2 with 'watch failed', which the Action reads as a real failure", () => {
  // --relock with --root naming a file: the lock's folder cannot be made
  const file = path.join(mkdtempSync(path.join(tmp, "watch-fail-")), "not-a-folder");
  writeFileSync(file, "x\n");
  const relock = runSync(tmp, "watch", "--root", file, "--relock", "--timeout", "2000");
  assert.equal(relock.code, 2, relock.out + relock.err);
  assert.match(relock.err, /^watch failed: /m);
  assert.equal(relock.out, "");
  // --init where the lock's name is a link to nowhere: no lock is read, and none can be written in its place
  const root = mkdtempSync(path.join(tmp, "watch-fail-init-"));
  symlinkSync(path.join(root, "nowhere"), path.join(root, "plumbline.lock.json"), "junction");
  const init = runSync(root, "watch", "--root", root, "--init");
  assert.equal(init.code, 2, init.out + init.err);
  assert.match(init.err, /^watch failed: /m);
  assert.equal(init.out, "");
});

test("watch --json with no lock reports lockState absent and no findings, and still exits 1", () => {
  const root = mkdtempSync(path.join(tmp, "watch-nolock-"));
  const r = runSync(root, "watch", "--root", root, "--json");
  assert.equal(r.code, 1);
  const parsed = JSON.parse(r.out) as { lockState: string; lockSummary: string; findings: unknown[] };
  assert.deepEqual([parsed.lockState, parsed.findings], ["absent", []]);
  assert.match(parsed.lockSummary, /^no lock: /);
});
