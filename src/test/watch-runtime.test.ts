import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { SafeFetchError } from "../net/safe-fetch.js";
import { UPSTREAM_COMMITS_URL } from "../watch/lock.js";
import { copySite, fixture } from "./net-helpers.js";
import { baseRoutes, ofKind, watch } from "./watch-helpers.js";

async function locked(): Promise<string> {
  const root = copySite();
  assert.deepEqual((await watch(root, baseRoutes(), { init: true })).findings, []);
  return root;
}

test("runtime drift: an edited vendored file is a block", async () => {
  const root = await locked();
  writeFileSync(join(root, "runtime/engine.js"), "export const engine = 'patched';\n");
  const { findings } = await watch(root, baseRoutes());
  const runtime = ofKind(findings, "runtime");
  assert.equal(runtime.length, 1);
  assert.equal(runtime[0]?.severity, "block");
  assert.equal(runtime[0]?.ref, "runtime/engine.js");
  assert.notEqual(runtime[0]?.expected, runtime[0]?.actual);
  assert.match(runtime[0]!.summary, /copy-do-not-change/);
  assert.equal(findings.length, 1);
});

test("runtime drift: a missing vendored file is a block", async () => {
  const root = await locked();
  rmSync(join(root, "runtime/ui.js"));
  const { findings } = await watch(root, baseRoutes());
  assert.deepEqual(findings.map((f) => [f.kind, f.severity, f.ref]), [["runtime", "block", "runtime/ui.js"]]);
  assert.match(findings[0]!.summary, /missing/);
});

test("runtime neighbour: untouched files, and a CRLF checkout of them, are not drift", async () => {
  const root = await locked();
  assert.deepEqual((await watch(root, baseRoutes())).findings, []);
  writeFileSync(join(root, "runtime/engine.js"), "export const engine = 1;\r\n");
  assert.deepEqual((await watch(root, baseRoutes())).findings, []);
});

test("runtime upstream: a newer upstream commit is info with both short SHAs (recorded real GitHub response)", async () => {
  const root = await locked();
  const routes = { ...baseRoutes(), [UPSTREAM_COMMITS_URL]: { body: fixture("github-nsdeploy-commits.json") } };
  const { findings } = await watch(root, routes);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "info");
  assert.equal(findings[0]?.kind, "runtime");
  assert.equal(findings[0]?.expected, "53a787c");
  assert.match(findings[0]!.actual ?? "", /^[0-9a-f]{7}$/);
  assert.match(findings[0]!.summary, /Upstream is ahead/);
  assert.match(findings[0]!.summary, /53a787c/);
  assert.ok(findings[0]!.summary.includes(findings[0]!.actual ?? "?"));
});

test("runtime upstream neighbour: the same commit (a full SHA starting with the locked short one) is clean", async () => {
  const root = await locked();
  assert.deepEqual((await watch(root, baseRoutes())).findings, []);
});

test("runtime upstream: failing to ask is info 'could not check upstream', never silence and never block", async () => {
  const root = await locked();
  const cases: [string, object][] = [
    ["timeout", { error: new SafeFetchError("timeout", "t") }],
    ["network", { error: new SafeFetchError("network", "n") }],
    ["rate limited 403", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1794929636" }, body: { message: "API rate limit exceeded" } }],
    ["rate limited 429", { status: 429, headers: { "retry-after": "60" } }],
    ["forbidden", { status: 403, body: {} }],
    ["server error", { status: 500 }],
    ["not a commit listing", { body: { message: "Not Found" } }],
    ["not JSON", { body: "<html>" }],
    ["empty list", { body: [] }],
  ];
  for (const [label, route] of cases) {
    const { findings } = await watch(root, { ...baseRoutes(), [UPSTREAM_COMMITS_URL]: route });
    assert.equal(findings.length, 1, label);
    assert.equal(findings[0]?.severity, "info", label);
    assert.equal(findings[0]?.kind, "runtime", label);
    assert.match(findings[0]!.summary, /Could not check upstream/, label);
  }
  const limited = await watch(root, { ...baseRoutes(), [UPSTREAM_COMMITS_URL]: cases[2]![1] });
  assert.match(limited.findings[0]!.summary, /rate-limited/);
});

test("runtime upstream: a lock with no recorded commit says upstream cannot be compared", async () => {
  const root = copySite();
  rmSync(join(root, "runtime/README.md"));
  await watch(root, baseRoutes(), { init: true });
  const { findings } = await watch(root, baseRoutes());
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "info");
  assert.match(findings[0]!.summary, /records no runtime commit/);
});

test("runtime: the upstream check asks GitHub unauthenticated for one commit of nsdeploy", async () => {
  assert.equal(UPSTREAM_COMMITS_URL, "https://api.github.com/repos/cognizant-ai-lab/nsdeploy/commits?per_page=1");
});
