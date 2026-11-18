// The lock's later life: re-locking after a review, peers held as pending, the runtime's real upstream, what the lock
// does not cover, the site's own signature expiry, and lock references that leave the root through a link.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { LOCK_FILE, SIGNATURE_FILE } from "../core/types.js";
import { lockProblem, type Lock } from "../watch/decide.js";
import { runtimeProvenance } from "../watch/capture.js";
import { runRelock } from "../watch/index.js";
import { UPSTREAM_COMMITS_URL, viaCommitsUrl } from "../watch/lock.js";
import { copySite, scripted, type Route } from "./net-helpers.js";
import { baseRoutes, NOW, PEER, PEER2, peerNetwork, watch } from "./watch-helpers.js";

const readLock = (root: string): Lock => JSON.parse(readFileSync(join(root, LOCK_FILE), "utf8")) as Lock;
const relock = (root: string, routes: Record<string, Route>, extraSources?: string[]) =>
  runRelock({ root }, { fetch: scripted(routes).fetch, now: () => new Date("2026-11-18T08:00:00Z"), ...(extraSources ? { extraSources } : {}) });

// ---- the runtime's upstream: the repository the copy was really taken from ----

const NOTICE =
  "Copy of cognizant-ai-labs/agentic-web `skills/agentify-website/runtime` at commit 7817c1f75b8d4f497c869540212be17dda94dcae, itself nsdeploy's browser runtime at commit 53a787c with the edits its README lists. Apache-2.0, see LICENSE.txt. Not modified here.\n";
const VIA = { repo: "cognizant-ai-labs/agentic-web", path: "skills/agentify-website/runtime", commit: "7817c1f75b8d4f497c869540212be17dda94dcae" };
const AT_COPY = "63a1b15fd791d81ccd20de6a621fb5bce1fa8d07";
const NEWER = "7ee54a3eaf6339d2d05226e844c2e9c6eee2bf1b";

function viaRoutes(newest: string): Record<string, Route> {
  return { ...baseRoutes(), [viaCommitsUrl(VIA)]: { body: [{ sha: newest }] }, [viaCommitsUrl(VIA, VIA.commit)]: { body: [{ sha: AT_COPY }] } };
}

test("runtime source: init records the repository folder and commit the NOTICE names as runtime.via, beside nsdeploy's commit", async () => {
  const root = copySite();
  writeFileSync(join(root, "runtime", "NOTICE"), NOTICE);
  await watch(root, viaRoutes(AT_COPY), { init: true });
  const lock = readLock(root);
  assert.deepEqual(lock.runtime.via, VIA);
  assert.equal(lock.runtime.commit, "53a787c", "nsdeploy's commit stays recorded: the ledger names both upstreams");
  assert.equal(lockProblem(lock), null);
});

test("runtime source: a lock with via asks that folder's history, not nsdeploy; an unchanged folder is clean, a changed one is info", async () => {
  const root = copySite();
  writeFileSync(join(root, "runtime", "NOTICE"), NOTICE);
  await watch(root, viaRoutes(AT_COPY), { init: true });
  const same = await watch(root, viaRoutes(AT_COPY));
  assert.deepEqual(same.findings, [], "the folder's newest commit is the one it had at the copy: no upstream change");
  assert.ok(same.calls.includes(viaCommitsUrl(VIA)) && same.calls.includes(viaCommitsUrl(VIA, VIA.commit)));
  assert.ok(!same.calls.includes(UPSTREAM_COMMITS_URL), "nsdeploy is not asked for a copy taken from agentic-web");
  assert.equal(viaCommitsUrl(VIA), "https://api.github.com/repos/cognizant-ai-labs/agentic-web/commits?path=skills/agentify-website/runtime&per_page=1");

  const ahead = await watch(root, viaRoutes(NEWER));
  assert.deepEqual(ahead.findings.map((f) => [f.kind, f.severity, f.ref, f.expected, f.actual]), [["runtime", "info", VIA.repo, "7817c1f", "7ee54a3"]]);
  assert.match(ahead.findings[0]!.summary, /Upstream is ahead: the runtime folder in cognizant-ai-labs\/agentic-web changed after the copy/);

  const routes = viaRoutes(NEWER);
  routes[viaCommitsUrl(VIA, VIA.commit)] = { status: 403, headers: { "x-ratelimit-remaining": "0" } };
  const limited = await watch(root, routes);
  assert.deepEqual(limited.findings.map((f) => [f.severity, f.ref]), [["info", VIA.repo]]);
  assert.match(limited.findings[0]!.summary, /Could not check upstream: GitHub rate-limited/);
});

test("runtime source: a lock without via (a copy of nsdeploy itself) still asks nsdeploy, as before", async () => {
  const root = copySite();
  await watch(root, baseRoutes(), { init: true });
  assert.equal(readLock(root).runtime.via, undefined);
  const { calls, findings } = await watch(root, baseRoutes());
  assert.deepEqual(findings, []);
  assert.ok(calls.includes(UPSTREAM_COMMITS_URL));
  assert.ok(!calls.some((c) => c.includes("agentic-web")));
});

test("runtime source: a via that could leave the GitHub API path makes the lock unusable", () => {
  const base = { version: 1, grounding: { sources: [], builtAt: "t" }, peers: {} };
  for (const via of [
    { ...VIA, repo: "a/b?x=1" },
    { ...VIA, repo: "../../x" },
    { ...VIA, path: "../secrets" },
    { ...VIA, path: "a&sha=evil" },
    { ...VIA, commit: "main" },
    "cognizant-ai-labs/agentic-web",
  ]) {
    assert.match(lockProblem({ ...base, runtime: { source: "nsdeploy", commit: "53a787c", files: {}, via } }) ?? "", /via/, JSON.stringify(via));
  }
});

test("REGRESSION (p-1a9b4a): a via whose repository name is . or .. makes the lock unusable, and init does not record one", () => {
  // Old code: REPO matched owner/.. and viaCommitsUrl built https://api.github.com/repos/owner/../commits, which URL
  // parsing turns into https://api.github.com/repos/commits.
  const base = { version: 1, grounding: { sources: [], builtAt: "t" }, peers: {} };
  for (const repo of ["owner/..", "owner/.", "cognizant-ai-labs/.."]) {
    assert.match(lockProblem({ ...base, runtime: { source: "nsdeploy", commit: "53a787c", files: {}, via: { ...VIA, repo } } }) ?? "", /via/, repo);
  }
  assert.equal(lockProblem({ ...base, runtime: { source: "nsdeploy", commit: "53a787c", files: {}, via: { ...VIA, repo: "owner/.github" } } }), null, "a dot inside a name is fine");
  assert.equal(runtimeProvenance(["Copy of owner/.. `skills/runtime` at commit 7817c1f75b8d4f497c869540212be17dda94dcae"]).via, undefined);
  assert.equal(runtimeProvenance(["Copy of owner/. `skills/runtime` at commit 7817c1f75b8d4f497c869540212be17dda94dcae"]).via, undefined);
});

// ---- re-lock ----

test("relock: rewrites the lock from the current state, lists added, removed and changed refs, and keeps a --source from init", async () => {
  const root = copySite();
  await watch(root, baseRoutes(), { init: true, extraSources: ["data/rooms.json"] });
  const before = readLock(root);
  writeFileSync(join(root, "links.json"), '{ "version": 1, "networks": {} }');
  writeFileSync(join(root, "runtime", "ui.js"), "export const ui = 3;\n");
  writeFileSync(join(root, "runtime", "extra.js"), "export const extra = 1;\n");
  rmSync(join(root, "runtime", "generated"), { recursive: true });
  const drift = await watch(root, baseRoutes());
  assert.ok(drift.findings.length > 0);

  const result = await relock(root, baseRoutes());
  assert.equal(result.previous, "found");
  assert.deepEqual(result.changes, {
    added: ["runtime runtime/extra.js"],
    removed: ["peer https://other-peer.example/shuttle", "runtime runtime/generated/graph.gen.mjs"],
    changed: ["grounding links.json", "runtime runtime/ui.js"],
  });
  const after = readLock(root);
  assert.deepEqual(after.grounding.sources.map((s) => s.ref), before.grounding.sources.map((s) => s.ref), "data/rooms.json, given only at init, is still locked");
  assert.equal(after.grounding.builtAt, "2026-11-18T08:00:00.000Z");
  assert.deepEqual((await watch(root, baseRoutes())).findings, [], "the accepted drift is clean after the re-lock");
});

test("relock with no lock writes one and lists everything as added; a source that is gone leaves the lock with a finding", async () => {
  const root = copySite();
  const fresh = await relock(root, baseRoutes());
  assert.equal(fresh.previous, "absent");
  assert.ok(fresh.changes.added.includes("grounding agent-manifest.json") && fresh.changes.added.includes(`peer ${PEER}`));
  assert.deepEqual([fresh.changes.removed, fresh.changes.changed], [[], []]);

  await relock(root, baseRoutes(), ["data/rooms.json"]);
  rmSync(join(root, "data", "rooms.json"));
  const gone = await relock(root, baseRoutes());
  assert.deepEqual(gone.changes.removed, ["grounding data/rooms.json"]);
  assert.deepEqual(gone.findings.map((f) => [f.kind, f.severity, f.ref]), [["grounding", "warn", "data/rooms.json"]]);
});

// ---- pending peers ----

test("pending: a peer that cannot be captured stays in the lock as pending and every watch reports it until a re-lock fills it in", async () => {
  const root = copySite();
  const down = baseRoutes();
  down["https://peer.example/partner.network.json"] = { status: 500 };
  const init = await watch(root, down, { init: true });
  assert.deepEqual(init.findings.map((f) => [f.kind, f.severity, f.ref]), [["peer", "warn", PEER]]);
  assert.match(init.findings[0]!.summary, /holds it as pending/);
  const lock = readLock(root);
  assert.deepEqual(lock.pendingPeers, { [PEER]: { since: NOW.toISOString() } });
  assert.deepEqual(Object.keys(lock.peers), [PEER2]);
  assert.equal(lockProblem(lock), null);

  for (const routes of [down, baseRoutes()]) {
    const { findings } = await watch(root, routes);
    assert.deepEqual(findings.map((f) => [f.kind, f.severity, f.ref]), [["peer", "warn", PEER]], "reported on every watch, reachable or not");
    assert.match(findings[0]!.summary, /pending since 2026-11-17.*watch --relock/);
  }

  const filled = await relock(root, baseRoutes());
  assert.deepEqual(filled.changes, { added: [`peer ${PEER}`], removed: [`pending ${PEER}`], changed: [] });
  assert.equal(readLock(root).pendingPeers, undefined, "no empty member is written");
  assert.deepEqual((await watch(root, baseRoutes())).findings, []);
});

// ---- coverage: what the site names that the lock does not ----

test("coverage: a network file or a peer the lock does not cover is a finding, not a silent clean watch", async () => {
  const root = copySite();
  await watch(root, baseRoutes(), { init: true });
  writeFileSync(
    join(root, "shuttle_desk.network.json"),
    JSON.stringify({ tools: [{ name: "desk", instructions: "Book.", tools: ["https://new-peer.example/ferry", "https://mcp.example/mcp"] }] }),
  );
  const { findings } = await watch(root, baseRoutes());
  assert.deepEqual(findings.map((f) => [f.kind, f.severity, f.ref]), [
    ["grounding", "warn", "shuttle_desk.network.json"],
    ["peer", "warn", "https://new-peer.example/ferry"],
  ]);
  assert.match(findings[1]!.summary, /does not cover/);

  const routes = { ...baseRoutes(), "https://new-peer.example/agent-manifest.json": { status: 404 }, "https://new-peer.example/ferry.network.json": { body: peerNetwork("ferry") }, "https://new-peer.example/links.json": { status: 404 }, "https://new-peer.example/plumbline.signature.json": { status: 404 } };
  await relock(root, routes);
  assert.deepEqual((await watch(root, routes)).findings, []);
});

test("coverage: peers come from every network the manifest names, not only the root's *.network.json files", async () => {
  const root = copySite();
  mkdirSync(join(root, "networks"));
  writeFileSync(join(root, "networks", "concierge.hocon"), JSON.stringify({ tools: [{ name: "concierge", instructions: "Help.", tools: ["https://ferry.example/boats"] }] }));
  const manifest = JSON.parse(readFileSync(join(root, "agent-manifest.json"), "utf8"));
  manifest.networks.push({ name: "concierge", front_man: "concierge", hocon: "./networks/concierge.hocon" });
  writeFileSync(join(root, "agent-manifest.json"), JSON.stringify(manifest, null, 2));
  const routes = { ...baseRoutes(), "https://ferry.example/agent-manifest.json": { status: 404 }, "https://ferry.example/boats.network.json": { body: peerNetwork("boats") }, "https://ferry.example/links.json": { status: 404 }, "https://ferry.example/plumbline.signature.json": { status: 404 } };
  await watch(root, routes, { init: true });
  assert.ok("https://ferry.example/boats" in readLock(root).peers, "a peer of a manifest-named network is locked");
  // and a changed definition of it is drift
  routes["https://ferry.example/boats.network.json"] = { body: peerNetwork("changed") };
  assert.deepEqual((await watch(root, routes)).findings.map((f) => [f.kind, f.severity, f.ref]), [["peer", "block", "https://ferry.example/boats"]]);
});

test("coverage: a named network file that is not JSON is a finding, since its peers could not be collected", async () => {
  const root = copySite();
  mkdirSync(join(root, "networks"));
  writeFileSync(join(root, "networks", "concierge.hocon"), "include \"base.hocon\"\ntools = []\n");
  const manifest = JSON.parse(readFileSync(join(root, "agent-manifest.json"), "utf8"));
  manifest.networks.push({ name: "concierge", hocon: "networks/concierge.hocon" });
  writeFileSync(join(root, "agent-manifest.json"), JSON.stringify(manifest));
  const { findings } = await watch(root, baseRoutes(), { init: true });
  assert.deepEqual(findings.map((f) => [f.kind, f.severity, f.ref]), [["peer", "warn", "networks/concierge.hocon"]]);
  assert.match(findings[0]!.summary, /not JSON/);
});

// ---- the site's own signature ----

test("signature expiry: none for an absent signature or one far from expiry; warn within 14 days; block once expired", async () => {
  const root = copySite();
  await watch(root, baseRoutes(), { init: true });
  const sign = (expiresAt: string) => writeFileSync(join(root, SIGNATURE_FILE), JSON.stringify({ type: "plumbline-signature", expiresAt }));
  const sig = async () => (await watch(root, baseRoutes())).findings.filter((f) => f.ref === SIGNATURE_FILE).map((f) => [f.kind, f.severity, f.actual]);
  assert.deepEqual(await sig(), [], "no signature, no finding");
  sign("2026-12-17T12:00:00.000Z");
  assert.deepEqual(await sig(), [], "30 days out");
  sign("2026-12-01T12:00:00.000Z");
  assert.deepEqual(await sig(), [["grounding", "warn", "2026-12-01"]], "exactly 14 days out");
  sign("2026-11-18T00:00:00.000Z");
  const soon = (await watch(root, baseRoutes())).findings.find((f) => f.ref === SIGNATURE_FILE);
  assert.match(soon?.summary ?? "", /expires on 2026-11-18, in 1 day; sign the site again/);
  sign("2026-11-17T11:59:59.000Z");
  assert.deepEqual(await sig(), [["grounding", "block", "2026-11-17"]]);
  writeFileSync(join(root, SIGNATURE_FILE), "{ not json");
  assert.deepEqual(await sig(), [["grounding", "warn", undefined]]);
  // checked with no lock too: an expiring signature is worth saying whether or not drift could be read
  rmSync(join(root, LOCK_FILE));
  sign("2026-11-17T11:59:59.000Z");
  const nolock = await watch(root, baseRoutes());
  assert.deepEqual([nolock.report.lockState, nolock.findings.map((f) => f.severity)], ["absent", ["block"]]);
});

// ---- references that leave the root through a link ----

/** A directory junction (Windows, no privilege needed) or a symlink elsewhere; null when this machine refuses both. */
function linkOut(root: string): string | null {
  const outside = mkdtempSync(join(tmpdir(), "plumbline-outside-"));
  writeFileSync(join(outside, "secret.txt"), "outside the root\n");
  try {
    symlinkSync(outside, join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
    return "linked/secret.txt";
  } catch {
    return null;
  }
}

test("realpath: a lock reference that reaches outside the root through a link is refused, at init and on every watch", async (t) => {
  const root = copySite();
  const ref = linkOut(root);
  if (ref === null) {
    t.skip("this machine cannot create a link");
    return;
  }
  const init = await watch(root, baseRoutes(), { init: true, extraSources: [ref] });
  assert.deepEqual(init.findings.map((f) => [f.kind, f.severity, f.ref]), [["grounding", "warn", ref]]);
  assert.match(init.findings[0]!.summary, /outside the site root/);
  assert.ok(!readLock(root).grounding.sources.some((s) => s.ref === ref), "nothing outside the root is hashed into the lock");
  // a lock someone committed with the reference in it: the watch refuses to read it
  const lock = readLock(root);
  lock.grounding.sources.push({ ref, sha256: "0".repeat(64) });
  writeFileSync(join(root, LOCK_FILE), JSON.stringify(lock));
  const { findings } = await watch(root, baseRoutes());
  assert.deepEqual(findings.map((f) => [f.kind, f.severity, f.ref, f.actual]), [["grounding", "warn", ref, undefined]]);
  assert.match(findings[0]!.summary, /outside the site root/);
});
