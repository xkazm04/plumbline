// D2: the package can be packed and run from its tarball, under whatever name the owner chooses. It is packed from a
// staging copy of what package.json's `files` names, never in the repository: npm 10 runs the `prepare` script (tsc) on
// `npm pack` even with --ignore-scripts, and a build rewriting dist/ under the other test files running the CLI broke a
// random one on loaded Linux runs (a module half-written: "does not provide an export named ...", 2026-11-23). The
// staging package.json is the real one without `prepare` (the build is already in dist/); --ignore-scripts keeps
// prepack from running there. The tarball is unpacked here by a small tar reader (no dependency) and its CLI is run
// under the no-network preload.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const NO_NETWORK = new URL("./no-network.js", import.meta.url).href;

let tmp: string;
let entries: Map<string, Uint8Array>;
before(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "plumbline-pack-"));
  const stage = path.join(tmp, "stage");
  mkdirSync(stage);
  const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8")) as { files: string[]; scripts?: Record<string, string> };
  const { prepare: _built, ...scripts } = pkg.scripts ?? {};
  writeFileSync(path.join(stage, "package.json"), `${JSON.stringify({ ...pkg, scripts }, null, 2)}\n`);
  // the positive entries of `files`; its negations (!dist/test, maps) are left for npm pack to apply, as it does in the repository
  for (const entry of pkg.files.filter((f) => !f.startsWith("!"))) cpSync(path.join(REPO, entry), path.join(stage, entry), { recursive: true });
  // a fixed command line, no input from anywhere: shell is needed on Windows to run npm.cmd
  const packed = spawnSync(`npm pack --ignore-scripts --json --pack-destination "${tmp}"`, { cwd: stage, encoding: "utf8", shell: true });
  assert.equal(packed.status, 0, packed.stderr);
  const tarball = readdirSync(tmp).find((n) => n.endsWith(".tgz"));
  assert.ok(tarball, "npm pack wrote a tarball");
  entries = untar(gunzipSync(readFileSync(path.join(tmp, tarball))));
});
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** The regular files of a ustar archive, by path. Enough for npm's tarballs: no links, no long-name extensions. */
function untar(bytes: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const text = (from: number, len: number) => new TextDecoder().decode(bytes.subarray(from, from + len)).replace(/\0.*$/s, "");
  for (let at = 0; at + 512 <= bytes.length; ) {
    const name = text(at, 100);
    if (name === "") break;
    const size = parseInt(text(at + 124, 12).trim() || "0", 8);
    const type = text(at + 156, 1);
    const prefix = text(at + 345, 155);
    const full = prefix ? `${prefix}/${name}` : name;
    if (type === "0" || type === "") out.set(full, bytes.subarray(at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

test("the tarball holds the built CLI and the watch template, and no test build, source map, key or secret", () => {
  const names = [...entries.keys()];
  assert.ok(names.every((n) => n.startsWith("package/")), "npm's layout");
  for (const must of ["package/package.json", "package/README.md", "package/LICENSE", "package/dist/cli/index.js", "package/dist/core/index.js", "package/action/templates/plumbline-watch.yml"]) {
    assert.ok(entries.has(must), `${must} is packed`);
  }
  assert.ok(!names.some((n) => n.startsWith("package/dist/test/")), "no test build");
  assert.ok(!names.some((n) => n.endsWith(".map")), "no source map (its sources are not packed)");
  assert.ok(!names.some((n) => n.startsWith("package/src/") || n.startsWith("package/site/")), "no source, no Desk");
  // a key or a secret, by name and by content
  const secretName = /(^|\/)(\.env[^/]*|\.dev\.vars[^/]*|keys\/.*|[^/]*\.private\.json|[^/]*\.key|[^/]*\.pem|plumbline\.private\.[^/]*)$/;
  assert.deepEqual(names.filter((n) => secretName.test(n)), []);
  for (const [name, body] of entries) {
    assert.doesNotMatch(new TextDecoder().decode(body), /-----BEGIN [A-Z ]*PRIVATE KEY-----|"privateKey"\s*:\s*"[A-Za-z0-9_-]{40,}"/, `${name} carries key material`);
  }
});

test("the packed package.json stays private until the owner names the package, and its bin is in the tarball", () => {
  const pkg = JSON.parse(new TextDecoder().decode(entries.get("package/package.json"))) as {
    private?: boolean;
    bin?: Record<string, string>;
    publishConfig?: { access?: string };
    dependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  // the npm name `plumbline` belongs to an unrelated project: publishing is the owner's choice of a scoped name
  assert.equal(pkg.private, true);
  assert.equal(pkg.publishConfig?.access, "public", "a scoped name publishes public once private is lifted");
  assert.equal(pkg.dependencies, undefined, "zero runtime dependencies");
  assert.match(pkg.scripts?.prepack ?? "", /clean-dist\.mjs && tsc/, "a published tarball is built from a clean dist/");
  for (const target of Object.values(pkg.bin ?? {})) assert.ok(entries.has(`package/${target}`), `bin ${target} is packed`);
  assert.match(new TextDecoder().decode(entries.get("package/dist/cli/index.js")).split("\n")[0] ?? "", /^#!\/usr\/bin\/env node/);
});

test("the unpacked CLI runs: init writes a lock and the workflow from the packed template, with no network", () => {
  const unpacked = path.join(tmp, "unpacked");
  for (const [name, body] of entries) {
    const file = path.join(unpacked, ...name.split("/"));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
  const site = mkdtempSync(path.join(tmp, "site-"));
  writeFileSync(path.join(site, "agent-manifest.json"), '{ "networks": [] }\n');
  const bin = path.join(unpacked, "package", "dist", "cli", "index.js");
  const r = spawnSync(process.execPath, ["--import", NO_NETWORK, bin, "init", "--workflow", "--json"], { cwd: site, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout) as { lock: string; workflowRoot: string };
  assert.deepEqual([report.lock, report.workflowRoot], ["written", "."]);
  assert.ok(existsSync(path.join(site, "plumbline.lock.json")));
  assert.match(readFileSync(path.join(site, ".github", "workflows", "plumbline-watch.yml"), "utf8"), /uses: xkazm04\/plumbline\/action@[0-9a-f]{40}/);
});
