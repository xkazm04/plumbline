// UAT-22 (PRI-L1-06): a pre-launch gate over files. `gate --root <build output>` runs the validator's rules on the
// folder's files before the site is published: a repeated `commondefs` fails (exit 1), the fixed copy passes (exit 0),
// nothing is fetched from anywhere (the folder fetcher refuses every other address; the CLI runs with the no-network
// preload), and Agent Atlas and Agent Customs are never asked.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { folderFetcher, gateFolder, ROOT_BASE } from "../cli/gate-root.js";
import { run } from "./cli-helpers.js";

let tmp: string;
before(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "plumbline-uat22-"));
});
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const MANIFEST = JSON.stringify({ brand: "Dunmore Books", networks: [{ name: "dunmore_books", front_man: "books_front", hocon: "./dunmore_books.network.json" }] }, null, 2);
// the launch defect: `commondefs` twice, which the runtime merges and a JSON reader collapses
const LAUNCH = `{
  "commondefs": { "replacement_strings": { "refunds": "All sales are final." } },
  "tools": [{ "name": "books_front", "instructions": "Help with orders. {refunds}", "tools": [] }],
  "commondefs": { "replacement_strings": { "refunds": "30-day refunds." } }
}
`;
const FIXED = `{
  "commondefs": { "replacement_strings": { "refunds": "30-day refunds." } },
  "tools": [{ "name": "books_front", "instructions": "Help with orders. {refunds}", "tools": [] }]
}
`;

function build(network: string): string {
  const dir = mkdtempSync(path.join(tmp, "dist-"));
  writeFileSync(path.join(dir, "agent-manifest.json"), MANIFEST);
  writeFileSync(path.join(dir, "dunmore_books.network.json"), network);
  return dir;
}

test("UAT-22: gate --root fails the launch defect (exit 1) and passes the fixed files (exit 0), checking the files only", () => {
  const launch = build(LAUNCH);
  const before = run("gate", "--root", launch);
  assert.equal(before.code, 1, before.out + before.err);
  assert.match(before.out, /^gate fail: .* \(files\) - checked by 1 of 1 \(validator fail\)$/m);
  assert.match(before.out, /duplicate keys/);
  assert.match(before.err, /plumbline gate: the files under the folder are checked with the validator's rules only .*nothing is sent to a third party/);
  assert.ok(!before.err.includes("Agent Atlas' public check API"), "no Atlas disclosure: Atlas is not asked");

  const fixed = build(FIXED);
  const after = run("gate", "--root", fixed, "--json");
  assert.equal(after.code, 0, after.out + after.err);
  const report = JSON.parse(after.out) as { target: string; state: string; findings: { adapter: string; state: string }[]; checkedAt?: string };
  assert.equal(report.target, fixed);
  assert.equal(report.state, "pass");
  assert.deepEqual(report.findings.map((f) => [f.adapter, f.state]), [["validator", "pass"]]);
  assert.ok(report.checkedAt);
});

test("UAT-22: a missing manifest fails; refusals: no folder, an address and a folder, a third party asked, --trust or --allow-local", () => {
  const empty = mkdtempSync(path.join(tmp, "empty-"));
  const none = run("gate", "--root", empty);
  assert.equal(none.code, 1);
  assert.match(none.out, /no agent-manifest\.json is published at the target \(HTTP 404\)/);
  for (const [args, message] of [
    [["gate", "--root", path.join(tmp, "nope")], /--root must name a folder/],
    [["gate", "--root", empty, "https://site.example/"], /give a folder or an address, not both/],
    [["gate", "--root", empty, "--adapters", "validator,atlas"], /--root checks files with the validator only/],
    [["gate", "--root", empty, "--trust", "t.json"], /--trust and --allow-local go with an address/],
    [["gate", "--root", empty, "--allow-local"], /--trust and --allow-local go with an address/],
  ] as [string[], RegExp][]) {
    const r = run(...args);
    assert.equal(r.code, 2, args.join(" "));
    assert.match(r.err, message);
    assert.match(r.err, /plumbline gate --root <site folder>/);
  }
});

test("UAT-22: the folder fetcher reads only under the folder; a manifest that names another site's file is never fetched", async () => {
  const dir = build(FIXED);
  mkdirSync(path.join(dir, "sub"));
  const fetch = folderFetcher(dir);
  assert.equal((await fetch(`${ROOT_BASE}agent-manifest.json`)).status, 200);
  assert.equal((await fetch(`${ROOT_BASE}missing.json`)).status, 404);
  assert.equal((await fetch(`${ROOT_BASE}sub/`)).status, 404);
  await assert.rejects(fetch("https://elsewhere.example/x.network.json"), /not a file under the folder/);
  await assert.rejects(fetch(`${ROOT_BASE}..%2F..%2Fetc%2Fpasswd`), /outside the site root/);
  writeFileSync(path.join(dir, "agent-manifest.json"), JSON.stringify({ brand: "x", networks: [{ name: "far", front_man: "f", hocon: "https://elsewhere.example/far.network.json" }] }));
  const report = await gateFolder(dir, "dist");
  assert.equal(report.target, "dist");
  assert.notEqual(report.state, "pass", JSON.stringify(report));
});

test("UAT-24 (PRI-L1-12): the validator names the network file and the repeated spec key beside the rule, and never quotes another key", async () => {
  const dir = mkdtempSync(path.join(tmp, "two-"));
  writeFileSync(
    path.join(dir, "agent-manifest.json"),
    JSON.stringify({ brand: "Dunmore Books", networks: [{ name: "dunmore_books", front_man: "books_front", hocon: "./dunmore_books.network.json" }, { name: "gifts", front_man: "books_front", hocon: "./gifts.network.json" }] }),
  );
  writeFileSync(path.join(dir, "dunmore_books.network.json"), FIXED);
  writeFileSync(path.join(dir, "gifts.network.json"), LAUNCH);
  const report = await gateFolder(dir, "dist");
  const summary = report.findings[0]?.summary ?? "";
  assert.equal(report.state, "fail");
  assert.match(summary, /1 x duplicate keys: the reference runtime merges them, so the file means something different from what a JSON reader sees; gifts\.network\.json repeats "commondefs" \(2 network definitions checked\)\.$/);
  assert.ok(!summary.includes("dunmore_books.network.json"), "the clean file is not named");

  // a repeated key that is not a spec key is counted, never quoted
  writeFileSync(path.join(dir, "gifts.network.json"), '{ "tools": [{ "name": "books_front", "instructions": "x", "tools": [], "<b>evil</b>": 1, "<b>evil</b>": 2 }] }');
  const other = (await gateFolder(dir, "dist")).findings[0]?.summary ?? "";
  assert.match(other, /gifts\.network\.json repeats 1 other key \(not named: not a key of the spec\)/);
  assert.ok(!other.includes("evil"), other);

  const { fileLabel } = await import("../gate/adapter-validator.js");
  assert.equal(fileLabel("https://s.example/nets/a.network.json", "https://s.example/"), "nets/a.network.json");
  assert.equal(fileLabel("https://other.example/x/b.network.json", "https://s.example/"), "b.network.json");
  assert.equal(fileLabel("https://s.example/%3Cb%3E.json", "https://s.example/"), "a network definition");
});
