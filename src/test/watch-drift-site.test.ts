// The Desk's drift reader (site/drift.js) against the same decisions as the CLI's watch (src/watch/decide.ts).
// site/drift.js imports ./lib/plumbline/..., which scripts/build-site.mjs writes. So the test lays out its own copy of
// that folder from THIS build (core, the three browser-safe net modules and watch/decide.js, the list build-site
// copies) beside a copy of drift.js, and imports that: no network, and no dependency on a site/lib someone else built.

import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LOCK_FILE, type DriftFinding, type PlumblineLock } from "../core/types.js";
import { SafeFetchError } from "../net/fetch-types.js";
import { copySite, scripted, type Route } from "./net-helpers.js";
import { baseRoutes, NOW, PEER, watch } from "./watch-helpers.js";

const BUILD = fileURLToPath(new URL("../", import.meta.url));
const REPO = fileURLToPath(new URL("../../", import.meta.url));

interface DriftResult {
  lockFound: boolean;
  lockState: string;
  lockSummary?: string;
  unreachablePeers: string[];
  findings: DriftFinding[];
}
type ReadDrift = (target: string, fetcher: unknown, options?: object) => Promise<DriftResult>;

let loaded: Promise<ReadDrift> | undefined;
function loadDrift(): Promise<ReadDrift> {
  loaded ??= (async () => {
    const dir = mkdtempSync(join(tmpdir(), "plumbline-drift-"));
    writeFileSync(join(dir, "package.json"), '{ "type": "module" }\n');
    const lib = join(dir, "lib", "plumbline");
    const copy = (sub: string, names: string[]) => {
      mkdirSync(join(lib, sub), { recursive: true });
      for (const name of names) copyFileSync(join(BUILD, sub, name), join(lib, sub, name));
    };
    copy("core", readdirSync(join(BUILD, "core")).filter((n) => n.endsWith(".js")));
    copy("net", ["canonical.js", "locate.js", "fetch-types.js"]);
    copy("watch", ["decide.js"]);
    copyFileSync(join(REPO, "site", "drift.js"), join(dir, "drift.js"));
    // the browser copy must not reach a Node module: the same rule build-site enforces
    assert.ok(!/from\s+["']node:/.test(readFileSync(join(lib, "watch", "decide.js"), "utf8")), "decide.js imports a Node module");
    const mod = (await import(pathToFileURL(join(dir, "drift.js")).href)) as { readDrift: ReadDrift };
    return mod.readDrift;
  })();
  return loaded;
}

const SITE = "https://watcher.example";
const HEX = (c: string) => c.repeat(64);

function lockWith(peers: PlumblineLock["peers"], extra: object = {}): string {
  return JSON.stringify({ version: 1, runtime: { source: "nsdeploy", commit: "53a787c", files: {} }, grounding: { sources: [], builtAt: NOW.toISOString() }, peers, ...extra });
}

test("Desk drift: a lock's peer address that is not https, carries credentials or a query, or names a local or private host is never contacted", async () => {
  const readDrift = await loadDrift();
  const record = { sha256: HEX("c"), links: "absent", checkedAt: NOW.toISOString() };
  const refused = [
    "http://127.0.0.1:8080/x",
    "https://user:pw@cred.example/p",
    "https://localhost/x",
    "https://app.localhost/x",
    "https://10.0.0.1/x",
    "https://192.168.1.20/x",
    "https://169.254.169.254/latest",
    "https://intranet/x",
    "https://[::1]/x",
    "https://query.example/p?say=hi",
    "https://frag.example/p#frag",
  ];
  const peers = Object.fromEntries([...refused, PEER].map((u) => [u, record]));
  const s = scripted({
    [`${SITE}/agent-manifest.json`]: { body: { networks: [] } },
    [`${SITE}/${LOCK_FILE}`]: { body: lockWith(peers) },
    ...baseRoutes(),
  });
  const result = await readDrift(`${SITE}/`, s.fetch);
  assert.equal(result.lockState, "found");
  for (const url of refused) {
    const host = new URL(url).host;
    assert.ok(!s.calls.some((c) => new URL(c).host === host && !c.startsWith(SITE)), `${url} was contacted: ${s.calls.join(", ")}`);
    const mine = result.findings.filter((f) => f.ref === url);
    assert.deepEqual(mine.map((f) => [f.kind, f.severity]), [["peer", "warn"]], url);
    assert.match(mine[0]!.summary, /was not contacted/);
    for (const part of ["127.0.0.1", "user", "localhost", "10.0.0.1", "intranet", "say=hi", "#frag", "cred.example"]) {
      assert.ok(!mine[0]!.summary.includes(part), `the summary quotes the address: ${mine[0]!.summary}`);
    }
  }
  assert.ok(s.calls.includes("https://peer.example/partner.network.json"), "a public https peer is still checked");
});

test("Desk drift: an absent, refused, unreadable or unusable lock is a lock state with a sentence and no findings", async () => {
  const readDrift = await loadDrift();
  const routes: Record<string, Route> = { [`${SITE}/agent-manifest.json`]: { body: { networks: [] } } };
  const cases: [Route, string, RegExp][] = [
    [{ status: 404 }, "absent", /^no lock: /],
    [{ status: 410 }, "absent", /^no lock: /],
    [{ error: new SafeFetchError("network", "CORS") }, "refused", /browser was refused/],
    [{ status: 503 }, "unreadable", /answered HTTP 503/],
    [{ error: new SafeFetchError("timeout", "t") }, "unreadable", /timed out/],
    [{ body: "{ nope" }, "unusable", /not valid JSON/],
    [{ body: { version: 1 } }, "unusable", /runtime section is malformed/],
  ];
  for (const [route, state, summary] of cases) {
    const s = scripted({ ...routes, [`${SITE}/${LOCK_FILE}`]: route });
    const result = await readDrift(`${SITE}/`, s.fetch);
    assert.deepEqual([result.lockFound, result.lockState, result.findings], [false, state, []], state);
    assert.match(result.lockSummary ?? "", summary, state);
  }
});

test("Desk drift and the CLI's watch agree: the same lock and the same bytes give the same findings", async () => {
  const readDrift = await loadDrift();
  const root = copySite();
  await watch(root, baseRoutes(), { init: true, extraSources: ["data/rooms.json"] });
  // drift on every side: a grounding file, a vendored runtime file, a peer's definition and its links.json
  writeFileSync(join(root, "data", "rooms.json"), '{"rooms": []}\n');
  writeFileSync(join(root, "runtime", "engine.js"), "patched\n");
  const routes = baseRoutes();
  routes["https://peer.example/partner.network.json"] = { body: { changed: true } };
  routes["https://other-peer.example/links.json"] = { status: 404 };
  const cli = (await watch(root, routes)).findings.filter((f) => !(f.kind === "runtime" && f.severity === "info"));
  // the published copy of the same folder
  const lock = JSON.parse(readFileSync(join(root, LOCK_FILE), "utf8")) as PlumblineLock;
  const published: Record<string, Route> = { [`${SITE}/agent-manifest.json`]: { body: readFileSync(join(root, "agent-manifest.json"), "utf8") } };
  for (const ref of [LOCK_FILE, ...lock.grounding.sources.map((s) => s.ref), ...Object.keys(lock.runtime.files)]) {
    const path = join(root, ref);
    published[`${SITE}/${ref}`] = existsSync(path) ? { body: readFileSync(path, "utf8") } : { status: 404 };
  }
  const desk = await readDrift(`${SITE}/`, scripted({ ...routes, ...published }).fetch);
  const key = (f: DriftFinding) => JSON.stringify([f.kind, f.severity, f.ref, f.expected, f.actual, f.summary]);
  assert.ok(cli.length >= 4, JSON.stringify(cli));
  assert.deepEqual(desk.findings.map(key).sort(), cli.map(key).sort());
});

test("Desk drift reports a lock's pending peers as the watch does, without contacting them", async () => {
  const readDrift = await loadDrift();
  const pending = "https://later.example/partner";
  const s = scripted({
    [`${SITE}/agent-manifest.json`]: { body: { networks: [] } },
    [`${SITE}/${LOCK_FILE}`]: { body: lockWith({}, { pendingPeers: { [pending]: { since: NOW.toISOString() } } }) },
  });
  const result = await readDrift(`${SITE}/`, s.fetch);
  assert.deepEqual(result.findings.map((f) => [f.kind, f.severity, f.ref]), [["peer", "warn", pending]]);
  assert.match(result.findings[0]!.summary, /pending since 2026-11-17/);
  assert.ok(!s.calls.some((c) => c.includes("later.example")));
});
