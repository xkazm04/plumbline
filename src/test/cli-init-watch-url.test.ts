// D1: the watch is the entry point. `plumbline init` (the lock, and with --workflow the daily workflow, no key) and
// `plumbline watch --url` (a PUBLISHED lock re-checked through safeFetch, by the reader the Desk runs). Every spawned
// CLI runs with the no-network preload; the published site is the loopback test server.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { LOCK_FILE, type DriftFinding, type PlumblineLock } from "../core/types.js";
import { hashBytes } from "../net/canonical.js";
import { NOT_CHECKED_FROM_URL, runWatchUrl } from "../watch/index.js";
import { WORKFLOW_PATH } from "../cli/init-command.js";
import { copySite, loopbackServer, scripted } from "./net-helpers.js";
import { NOW } from "./watch-helpers.js";

const CLI = fileURLToPath(new URL("../cli/index.js", import.meta.url));
const NO_NETWORK = new URL("./no-network.js", import.meta.url).href;

interface Run {
  code: number | null;
  out: string;
  err: string;
}

function cli(cwd: string, ...args: string[]): Promise<Run> {
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

let tmp: string;
before(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "plumbline-d1-"));
});
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** Every file under a folder, relative, `/` separators. */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(full).map((f) => `${e.name}/${f}`));
    else out.push(e.name);
  }
  return out;
}

test("init: writes the lock and the workflow, makes no key, prints the next steps, and never overwrites the workflow", async () => {
  const repo = mkdtempSync(path.join(tmp, "repo-"));
  const site = path.join(repo, "site");
  mkdirSync(site);
  const fixture = copySite();
  for (const name of readdirSync(fixture)) rmSync(path.join(site, name), { recursive: true, force: true });
  // the fixture site, under the repository's site/ folder
  for (const rel of filesUnder(fixture)) {
    mkdirSync(path.dirname(path.join(site, rel)), { recursive: true });
    writeFileSync(path.join(site, rel), readFileSync(path.join(fixture, rel)));
  }

  const first = await cli(repo, "init", "--root", "site", "--workflow", "--json");
  // the fixture's two peers cannot be reached (no network in tests), so they are pending: a gap, exit 1
  assert.equal(first.code, 1, first.out + first.err);
  const report = JSON.parse(first.out) as { lock: string; counts: Record<string, number>; workflow: string; workflowRoot: string; next: string[]; findings: DriftFinding[] };
  assert.equal(report.lock, "written");
  assert.deepEqual(report.counts, { grounding: 3, runtime: 4, peers: 0, pending: 2 });
  assert.deepEqual([report.workflow, report.workflowRoot], [WORKFLOW_PATH, "site"]);
  assert.ok(report.findings.some((f) => f.kind === "peer" && f.severity === "warn" && /pending/.test(f.summary)));
  // the next steps: commit, watch, --source for the pages whose facts the network states, and signing as the upgrade
  assert.match(report.next[0] ?? "", /no key/);
  assert.match(report.next.join("\n"), /--source <page>/);
  assert.match(report.next[report.next.length - 1] ?? "", /^Upgrade, when you are ready: sign/);

  const lock = JSON.parse(readFileSync(path.join(site, LOCK_FILE), "utf8")) as PlumblineLock;
  assert.equal(lock.version, 1);
  const workflow = readFileSync(path.join(repo, WORKFLOW_PATH), "utf8");
  assert.match(workflow, /\n {10}root: "site"\n/);
  assert.doesNotMatch(workflow, /root: "\."/);
  // UAT-30 (MAR-L1-08): a push that touches the site folder runs the watch, as well as the daily schedule
  assert.match(workflow, /\n {2}push:\n {4}paths:\n {6}- "site\/\*\*"\n/);
  assert.match(workflow, /\n {4}- cron: /);
  assert.match(workflow, /uses: xkazm04\/plumbline\/action@[0-9a-f]{40}/, "the template's pinned Action, unchanged");
  // no key anywhere: init makes none and reads none
  assert.ok(!filesUnder(repo).some((f) => /private|\.key$|\.pem$/.test(f)), filesUnder(repo).join(", "));
  assert.ok(!existsSync(path.join(site, "plumbline.signature.json")));

  // a second --workflow refuses before anything is written; the lock is untouched
  const lockBytes = readFileSync(path.join(site, LOCK_FILE), "utf8");
  const again = await cli(repo, "init", "--root", "site", "--workflow");
  assert.equal(again.code, 2, again.out + again.err);
  assert.match(again.err, /already exists; init never overwrites it/);
  assert.equal(readFileSync(path.join(site, LOCK_FILE), "utf8"), lockBytes);

  // without --workflow, a lock that is there is kept, and a --source is said not to be added
  const kept = await cli(repo, "init", "--root", "site", "--source", "data/rooms.json");
  assert.equal(kept.code, 0, kept.out + kept.err);
  assert.match(kept.out, /^init: kept the plumbline\.lock\.json that is there/m);
  assert.match(kept.out, /^info  grounding data\/rooms\.json: Not added: a lock was already there/m);
  assert.match(kept.out, /^next:\n {2}1\. Commit plumbline\.lock\.json\./m);
  assert.equal(readFileSync(path.join(site, LOCK_FILE), "utf8"), lockBytes);
});

test("init refuses, with nothing written: a root outside the current folder with --workflow, a bad value, an unknown flag", async () => {
  const repo = mkdtempSync(path.join(tmp, "repo-refuse-"));
  const outside = mkdtempSync(path.join(tmp, "outside-"));
  writeFileSync(path.join(outside, "agent-manifest.json"), '{ "networks": [] }\n');
  const cases: [string[], RegExp][] = [
    [["init", "--root", outside, "--workflow"], /--root must be a folder inside it/],
    [["init", "--root"], /--root takes a folder/],
    [["init", "--source", ""], /--source takes a path or an https URL/],
    [["init", "--timeout", "0"], /--timeout takes a positive number/],
    [["init", "--yes"], /unknown argument --yes/],
  ];
  for (const [args, message] of cases) {
    const r = await cli(repo, ...args);
    assert.equal(r.code, 2, args.join(" "));
    assert.match(r.err, message, args.join(" "));
    assert.match(r.err, /usage: plumbline init/);
  }
  assert.ok(!existsSync(path.join(outside, LOCK_FILE)));
  assert.ok(!existsSync(path.join(repo, ".github")));
});

test("init on an empty folder writes a lock with nothing to watch yet and says so in info findings", async () => {
  const root = mkdtempSync(path.join(tmp, "empty-"));
  const r = await cli(root, "init");
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /^init: wrote plumbline\.lock\.json \(0 grounding sources, 0 runtime files, 0 peers, 0 pending\)$/m);
  assert.match(r.out, /^info  grounding \.: No grounding sources were found/m);
});

// ---- watch --url ----

const SITE = "https://published.example";

function lockOf(extra: Partial<PlumblineLock> = {}): PlumblineLock {
  return {
    version: 1,
    runtime: { source: "nsdeploy", commit: "53a787c", files: {} },
    grounding: { sources: [], builtAt: NOW.toISOString() },
    peers: {},
    ...extra,
  };
}

test("watch --url (in process): the published lock's drift, the published signature's expiry, and what was not checked, in words", async () => {
  const manifest = '{ "networks": [] }\n';
  const lock = lockOf({ grounding: { sources: [{ ref: "agent-manifest.json", sha256: await hashBytes(new TextEncoder().encode("old\n")) }], builtAt: NOW.toISOString() } });
  const s = scripted({
    [`${SITE}/agent-manifest.json`]: { body: manifest },
    [`${SITE}/${LOCK_FILE}`]: { body: JSON.stringify(lock) },
    [`${SITE}/plumbline.signature.json`]: { body: { expiresAt: "2026-11-01T00:00:00.000Z" } },
  });
  const report = await runWatchUrl({ url: `${SITE}/` }, { fetch: s.fetch, now: () => NOW });
  assert.equal(report.lockState, "found");
  const shown = report.findings.map((f) => [f.kind, f.severity, f.ref]);
  assert.deepEqual(shown, [
    ["grounding", "warn", "agent-manifest.json"],
    ["grounding", "block", "plumbline.signature.json"],
    ["grounding", "info", LOCK_FILE],
  ]);
  assert.equal(report.findings[2]?.summary, NOT_CHECKED_FROM_URL);
  assert.match(NOT_CHECKED_FROM_URL, /added to the vendored runtime folder/);
  assert.match(NOT_CHECKED_FROM_URL, /covers every file and peer/);
  assert.match(NOT_CHECKED_FROM_URL, /upstream/);
  // nothing outside the site was asked: no GitHub, no folder listing
  assert.ok(s.calls.every((c) => c.startsWith(SITE)), s.calls.join(", "));

  // no lock: the lock state, its sentence, and no not-checked line (nothing was checked at all)
  const none = scripted({ [`${SITE}/agent-manifest.json`]: { body: manifest }, [`${SITE}/${LOCK_FILE}`]: { status: 404 }, [`${SITE}/plumbline.signature.json`]: { status: 404 } });
  const absent = await runWatchUrl({ url: `${SITE}/` }, { fetch: none.fetch, now: () => NOW });
  assert.deepEqual([absent.lockState, absent.findings], ["absent", []]);
  assert.match(absent.lockSummary ?? "", /^no lock: /);
  // a connection failure is unreadable for the CLI, never the browser's "refused"
  const failed = scripted({ [`${SITE}/agent-manifest.json`]: { body: manifest } });
  const unreadable = await runWatchUrl({ url: `${SITE}/` }, { fetch: failed.fetch, now: () => NOW });
  assert.equal(unreadable.lockState, "unreadable");
  assert.match(unreadable.lockSummary ?? "", /the connection failed/);
  assert.match(unreadable.findings[0]?.summary ?? "", /signature file could not be read to check its expiry/);
});

test("watch --url (CLI, loopback): drift in a published lock, a lock aiming at private and loopback peers is never followed there, and exit codes", async () => {
  const requested: string[] = [];
  const engine = "export const v = 2;\n";
  let lockText = "";
  const server = await loopbackServer((req, res) => {
    const p = new URL(req.url ?? "/", "http://x").pathname;
    requested.push(p);
    if (p === "/agent-manifest.json") res.end('{ "networks": [] }\n');
    else if (p === `/${LOCK_FILE}`) res.end(lockText);
    else if (p === "/runtime/engine.js") res.end(engine);
    else res.writeHead(404).end("no");
  });
  try {
    const base = `${server.url}/`;
    lockText = JSON.stringify(
      lockOf({
        runtime: { source: "nsdeploy", commit: "53a787c", files: { "runtime/engine.js": await hashBytes(new TextEncoder().encode("export const v = 1;\n")) } },
        grounding: {
          sources: [
            { ref: "agent-manifest.json", sha256: await hashBytes(new TextEncoder().encode('{ "networks": [] }\n')) },
            { ref: "https://192.168.1.1/admin", sha256: "a".repeat(64) },
          ],
          builtAt: NOW.toISOString(),
        },
        peers: {
          "https://10.0.0.1/partner": { sha256: "c".repeat(64), links: "absent", checkedAt: NOW.toISOString() },
          [`${server.url}/partner`]: { sha256: "c".repeat(64), links: "absent", checkedAt: NOW.toISOString() },
        },
      }),
    );
    const r = await cli(tmp, "watch", "--url", base, "--allow-local", "--timeout", "3000", "--json");
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.err, /--allow-local/, "the loopback allowance is warned about");
    const report = JSON.parse(r.out) as { lockState: string; findings: DriftFinding[] };
    assert.equal(report.lockState, "found");
    const byRef = (ref: string) => report.findings.filter((f) => f.ref === ref).map((f) => [f.kind, f.severity]);
    assert.deepEqual(byRef("runtime/engine.js"), [["runtime", "block"]]);
    assert.deepEqual(byRef("agent-manifest.json"), [], "an unchanged grounding file is no finding");
    assert.deepEqual(byRef("https://192.168.1.1/admin"), [["grounding", "warn"]]);
    assert.deepEqual(byRef("https://10.0.0.1/partner"), [["peer", "warn"]]);
    assert.deepEqual(byRef(`${server.url}/partner`), [["peer", "warn"]]);
    for (const f of report.findings.filter((x) => x.kind === "peer" || x.ref.startsWith("https://192"))) {
      assert.match(f.summary, /not contacted|not fetched/, f.summary);
      assert.ok(!/10\.0\.0\.1|192\.168|127\.0\.0\.1/.test(f.summary), `a finding quotes the address: ${f.summary}`);
    }
    // the loopback peer was never asked, though --allow-local lets the CLI read the site itself there
    assert.ok(!requested.some((p) => p.startsWith("/partner")), requested.join(", "));
    assert.ok(report.findings.some((f) => f.severity === "info" && f.summary === NOT_CHECKED_FROM_URL));

    // the text report: one line per finding
    const text = await cli(tmp, "watch", "--url", base, "--allow-local", "--timeout", "3000");
    assert.equal(text.code, 1);
    assert.match(text.out, /^block runtime runtime\/engine\.js: /m);

    // without --allow-local, the http site is refused before anything is read: no lock was checked, exit 1
    const refused = await cli(tmp, "watch", "--url", base, "--timeout", "3000", "--json");
    assert.equal(refused.code, 1, refused.out + refused.err);
    const parsed = JSON.parse(refused.out) as { lockState: string; lockSummary: string };
    assert.equal(parsed.lockState, "unreadable");
    assert.match(parsed.lockSummary, /not https/);

    // a clean published lock exits 0 (info alone is clean)
    lockText = JSON.stringify(lockOf());
    const clean = await cli(tmp, "watch", "--url", base, "--allow-local", "--timeout", "3000");
    assert.equal(clean.code, 0, clean.out + clean.err);
    assert.match(clean.out, /^info  grounding plumbline\.lock\.json: Not checked from a published site/m);
  } finally {
    await server.close();
  }
});

test("watch --url refuses a checkout's flags and a target that is not http(s) (--allow-local works on a checkout too since UAT-21)", async () => {
  const cases: [string[], RegExp][] = [
    [["watch", "--url", "https://site.example/", "--root", "."], /--url reads a published site/],
    [["watch", "--url", "https://site.example/", "--init"], /--url reads a published site/],
    [["watch", "--url", "https://site.example/", "--relock"], /--url reads a published site/],
    [["watch", "--url", "https://site.example/", "--source", "a.json"], /--url reads a published site/],
    [["watch", "--url", "ftp://site.example/"], /--url takes an http\(s\) site address/],
    [["watch", "--url", "site.example"], /--url takes an http\(s\) site address/],
    [["watch", "--url"], /--url takes an http\(s\) site address/],
  ];
  for (const [args, message] of cases) {
    const r = await cli(tmp, ...args);
    assert.equal(r.code, 2, args.join(" "));
    assert.match(r.err, message, args.join(" "));
    assert.match(r.err, /usage: plumbline watch/);
    assert.equal(r.out, "");
  }
});

test("UAT-16: watch --url prints a published lock's refs with their control characters replaced, as plumbline diff does", async () => {
  let lockText = "";
  const server = await loopbackServer((req, res) => {
    const p = new URL(req.url ?? "/", "http://x").pathname;
    if (p === "/agent-manifest.json") res.end('{ "networks": [] }\n');
    else if (p === `/${LOCK_FILE}`) res.end(lockText);
    else res.writeHead(404).end("no");
  });
  try {
    // a stranger's lock: an escape sequence that would clear the terminal and a right-to-left override
    const hostileRef = "rooms\u001b[2J\u001b[31m.html";
    const hostilePeer = "https://10.0.0.1/p‮evil\u0007";
    lockText = JSON.stringify(
      lockOf({
        grounding: { sources: [{ ref: hostileRef, sha256: "a".repeat(64) }], builtAt: NOW.toISOString() },
        peers: { [hostilePeer]: { sha256: "c".repeat(64), links: "absent", checkedAt: NOW.toISOString() } },
      }),
    );
    const text = await cli(tmp, "watch", "--url", `${server.url}/`, "--allow-local", "--timeout", "3000");
    assert.equal(text.code, 1, text.out + text.err);
    assert.doesNotMatch(text.out, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f‪-‮]/, JSON.stringify(text.out));
    assert.match(text.out, /grounding rooms\?\[2J\?\[31m\.html: /);
    assert.match(text.out, /peer https:\/\/10\.0\.0\.1\/p\?evil\?: /);
    // --json keeps the refs as the lock wrote them, escaped by JSON itself
    const json = await cli(tmp, "watch", "--url", `${server.url}/`, "--allow-local", "--timeout", "3000", "--json");
    const refs = (JSON.parse(json.out) as { findings: DriftFinding[] }).findings.map((f) => f.ref);
    assert.ok(refs.includes(hostileRef) && refs.includes(hostilePeer), JSON.stringify(refs));
    assert.doesNotMatch(json.out, /\u001b/);
  } finally {
    await server.close();
  }
});
