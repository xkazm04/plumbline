// The Desk's drift reader (site/drift.js) against the same decisions as the CLI's watch (src/watch/decide.ts).
// site/drift.js imports ./lib/plumbline/..., which scripts/build-site.mjs writes. So the test lays out its own copy of
// that folder from THIS build (core plus BROWSER_MODULES below, the list build-site copies) beside a copy of drift.js,
// and imports that: no network, and no dependency on a site/lib someone else built.

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
import { NOT_CHECKED_FROM_URL, runWatchUrl } from "../watch/index.js";

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

/** The browser-safe modules beyond core that drift.js reaches: scripts/build-site.mjs must copy the same list. */
const BROWSER_MODULES: Record<string, string[]> = {
  net: ["address.js", "canonical.js", "locate.js", "fetch-types.js"],
  watch: ["anchors.js", "decide.js", "external.js", "observe.js", "outline.js", "published.js"],
  gate: ["validator.js"],
};

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
    for (const [sub, names] of Object.entries(BROWSER_MODULES)) copy(sub, names);
    copyFileSync(join(REPO, "site", "drift.js"), join(dir, "drift.js"));
    // the browser copy must not reach a Node module: the same rule build-site enforces
    for (const [sub, names] of Object.entries(BROWSER_MODULES)) {
      for (const name of names) assert.ok(!/from\s+["']node:/.test(readFileSync(join(lib, sub, name), "utf8")), `${sub}/${name} imports a Node module`);
    }
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
    // p-0810b9: documentation and protocol ranges, which only safeFetch's table refused before
    "https://192.0.2.5/x",
    "https://203.0.113.9/x",
    "https://198.51.100.7/x",
    "https://192.0.0.8/x",
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
    for (const part of ["127.0.0.1", "user", "localhost", "10.0.0.1", "192.0.2.5", "203.0.113.9", "intranet", "say=hi", "#frag", "cred.example"]) {
      assert.ok(!mine[0]!.summary.includes(part), `the summary quotes the address: ${mine[0]!.summary}`);
    }
  }
  assert.ok(s.calls.includes("https://peer.example/partner.network.json"), "a public https peer is still checked");
});

test("REGRESSION (p-088c6f): a lock's https grounding ref and a peer manifest's network file are held to the address rule, and never contacted", async () => {
  const readDrift = await loadDrift();
  const record = { sha256: HEX("c"), links: "absent", checkedAt: NOW.toISOString() };
  const grounding = [
    { ref: "https://192.168.1.1/admin", sha256: HEX("a") },
    { ref: "https://localhost/data.json", sha256: HEX("a") },
    { ref: "https://user:pw@creds.example/data.json", sha256: HEX("a") },
  ];
  const peer = "https://hocon.example/partner";
  const s = scripted({
    [`${SITE}/agent-manifest.json`]: { body: { networks: [] } },
    [`${SITE}/${LOCK_FILE}`]: { body: lockWith({ [peer]: record }, { grounding: { sources: grounding, builtAt: NOW.toISOString() } }) },
    // the peer's own manifest points its network file at a private address
    "https://hocon.example/agent-manifest.json": { body: { networks: [{ name: "partner", hocon: "https://10.0.0.5/x.json", front_man: "f" }] } },
  });
  const result = await readDrift(`${SITE}/`, s.fetch);
  assert.equal(result.lockState, "found");
  for (const host of ["192.168.1.1", "localhost", "creds.example", "10.0.0.5"]) {
    assert.ok(!s.calls.some((c) => new URL(c).hostname === host), `${host} was contacted: ${s.calls.join(", ")}`);
  }
  for (const { ref } of grounding) {
    const mine = result.findings.filter((f) => f.ref === ref);
    assert.deepEqual(mine.map((f) => [f.kind, f.severity]), [["grounding", "warn"]], ref);
    assert.match(mine[0]!.summary, /was not fetched/, ref);
    for (const part of ["192.168", "localhost", "creds", "user"]) assert.ok(!mine[0]!.summary.includes(part), mine[0]!.summary);
  }
  const mine = result.findings.filter((f) => f.ref === peer);
  assert.deepEqual(mine.map((f) => [f.kind, f.severity]), [["peer", "warn"]]);
  assert.match(mine[0]!.summary, /network file was not contacted: it is a private or loopback address/);
  assert.ok(!mine[0]!.summary.includes("10.0.0.5"), mine[0]!.summary);
  assert.deepEqual(result.unreachablePeers, [], "a refused network file is not an unreachable peer");
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

test("D7 parity: a changed peer's outline counts are the same in the Desk and the CLI's watch", async () => {
  const readDrift = await loadDrift();
  const root = copySite();
  const routes = baseRoutes();
  routes["https://peer.example/partner.network.json"] = { body: { tools: [{ name: "a", instructions: "x", tools: ["https://h.example/x"] }] } };
  await watch(root, routes, { init: true });
  routes["https://peer.example/partner.network.json"] = { body: { tools: [{ name: "a", instructions: "y" }, { name: "b", tools: [] }] } };
  const cli = (await watch(root, routes)).findings.filter((f) => f.ref === PEER);
  const published: Record<string, Route> = {
    [`${SITE}/agent-manifest.json`]: { body: readFileSync(join(root, "agent-manifest.json"), "utf8") },
    [`${SITE}/${LOCK_FILE}`]: { body: readFileSync(join(root, LOCK_FILE), "utf8") },
  };
  const desk = (await readDrift(`${SITE}/`, scripted({ ...routes, ...published }).fetch)).findings.filter((f) => f.ref === PEER);
  assert.equal(cli.length, 1);
  assert.match(cli[0]!.summary, /In outline: agents: 1 added, 0 removed, 1 changed; outbound hosts: 0 added, 1 removed; front agent: unchanged\./);
  assert.deepEqual(desk, cli);
});

test("D1 parity: the CLI's watch --url and the Desk's drift reader give the same findings for the same published lock", async () => {
  const readDrift = await loadDrift();
  const root = copySite();
  await watch(root, baseRoutes(), { init: true, extraSources: ["data/rooms.json"] });
  writeFileSync(join(root, "data", "rooms.json"), '{"rooms": []}\n');
  writeFileSync(join(root, "runtime", "engine.js"), "patched\n");
  const lock = JSON.parse(readFileSync(join(root, LOCK_FILE), "utf8")) as PlumblineLock;
  // a stranger's additions to the published lock: a refused peer, a refused absolute ref and a pending peer
  lock.peers["https://10.0.0.1/x"] = { sha256: HEX("c"), links: "absent", checkedAt: NOW.toISOString() };
  lock.grounding.sources.push({ ref: "https://localhost/data.json", sha256: HEX("a") });
  lock.pendingPeers = { "https://later.example/partner": { since: NOW.toISOString() } };
  const routes = baseRoutes();
  routes["https://peer.example/partner.network.json"] = { body: { changed: true } };
  routes["https://other-peer.example/links.json"] = { status: 404 };
  const published: Record<string, Route> = {
    [`${SITE}/agent-manifest.json`]: { body: readFileSync(join(root, "agent-manifest.json"), "utf8") },
    [`${SITE}/${LOCK_FILE}`]: { body: JSON.stringify(lock) },
    [`${SITE}/plumbline.signature.json`]: { status: 404 },
  };
  for (const ref of [...lock.grounding.sources.map((s) => s.ref), ...Object.keys(lock.runtime.files)]) {
    const path = join(root, ref);
    if (!ref.startsWith("https:")) published[`${SITE}/${ref}`] = existsSync(path) ? { body: readFileSync(path, "utf8") } : { status: 404 };
  }
  const desk = await readDrift(`${SITE}/`, scripted({ ...routes, ...published }).fetch);
  const cli = await runWatchUrl({ url: `${SITE}/` }, { fetch: scripted({ ...routes, ...published }).fetch, now: () => NOW });
  // the CLI adds one line of its own: the not-checked sentence (and the signature expiry, none here)
  const shared = cli.findings.filter((f) => f.summary !== NOT_CHECKED_FROM_URL);
  assert.equal(cli.findings.length - shared.length, 1);
  const key = (f: DriftFinding) => JSON.stringify([f.kind, f.severity, f.ref, f.expected, f.actual, f.summary]);
  assert.ok(shared.length >= 7, JSON.stringify(shared));
  assert.deepEqual(desk.findings.map(key), shared.map(key), "the same findings, in the same order");
  assert.deepEqual([cli.lockState, desk.lockState], ["found", "found"]);
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
