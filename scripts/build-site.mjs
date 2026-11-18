// npm run build:site: compile with tsc (into dist/, the normal build) and copy the browser-safe compiled modules into
// site/lib/plumbline/, keeping their relative layout so their relative imports still resolve. site/lib/ is generated
// and git-ignored; never edit it by hand.
//
// What is copied, and why it is browser-safe:
//   core/*.js            pure by contract (no node:* imports; WebCrypto only)
//   gate/*.js            every adapter, the context and run.js; NOT index.js, which binds the gate to safeFetch
//   net/canonical.js     re-exports core's canonical bytes plus the document fingerprints
//   net/locate.js        pure address resolution over an injected fetcher
//   net/fetch-types.js   the pure half of safeFetch (limits, error class); safe-fetch.js itself is Node-only, never copied
//   net/address.js       the address rules safeFetch and the Desk's peer check share (pure)
//   watch/decide.js      the drift decisions the CLI watch and the Desk share (pure)
//   watch/observe.js     the one fetcher-injected peer and published-file reader (pure)
//   watch/anchors.js     the facts a grounding page states, for the anchor count (pure)
//   watch/outline.js     a peer's definition in outline, hashed (pure)
//   browser/*.js         checkPeerBeforeLoad: a peer's signature and lock pin before it loads (pure)
//   watch/published.js   the reader of a published lock: the CLI's `watch --url` and the Desk's drift.js (pure)
//
// After copying, every module is scanned: a node:* import, a require() or an import that does not resolve inside
// site/lib/plumbline fails the build, and so does a use of the Node global `Buffer` (it would throw only when that
// code path ran, which is how the Customs adapter failed silently in the browser before 2026-11-17).

import { spawnSync } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const OUT = path.join(ROOT, "site", "lib", "plumbline");

function compile() {
  const tsc = path.join(ROOT, "node_modules", "typescript", "bin", "tsc");
  const result = spawnSync(process.execPath, [tsc, "-p", path.join(ROOT, "tsconfig.json")], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`tsc failed with exit code ${result.status}`);
}

async function jsFiles(dir) {
  return (await readdir(dir)).filter((name) => name.endsWith(".js")).sort();
}

async function copy(fromDir, names, toDir) {
  await mkdir(toDir, { recursive: true });
  for (const name of names) {
    await writeFile(path.join(toDir, name), await readFile(path.join(fromDir, name)));
  }
}

async function scan() {
  const errors = [];
  const warnings = [];
  const all = [];
  for (const sub of await readdir(OUT)) {
    for (const name of await jsFiles(path.join(OUT, sub))) all.push(path.join(OUT, sub, name));
  }
  const known = new Set(all.map((f) => path.resolve(f)));
  for (const file of all) {
    const text = await readFile(file, "utf8");
    const rel = path.relative(OUT, file).split(path.sep).join("/");
    if (/\bfrom\s+["']node:|import\(\s*["']node:|\brequire\(/.test(text)) errors.push(`${rel} imports a Node module`);
    for (const match of text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const spec = match[1];
      if (!spec.startsWith(".")) {
        errors.push(`${rel} imports "${spec}", which is not a relative module`);
        continue;
      }
      if (!known.has(path.resolve(path.dirname(file), spec))) errors.push(`${rel} imports "${spec}", which is not in site/lib/plumbline`);
    }
    if (/\bBuffer\./.test(text)) errors.push(`${rel} uses the Node global Buffer, which does not exist in a browser`);
  }
  return { errors, warnings, count: all.length };
}

async function main() {
  compile();
  await rm(OUT, { recursive: true, force: true });
  await copy(path.join(DIST, "core"), await jsFiles(path.join(DIST, "core")), path.join(OUT, "core"));
  const gate = (await jsFiles(path.join(DIST, "gate"))).filter((name) => name !== "index.js");
  await copy(path.join(DIST, "gate"), gate, path.join(OUT, "gate"));
  await copy(path.join(DIST, "net"), ["address.js", "canonical.js", "locate.js", "fetch-types.js"], path.join(OUT, "net"));
  // the drift decisions the CLI watch and the Desk share, and the owner's line made from them (pure: no node:* import)
  await copy(path.join(DIST, "watch"), ["anchors.js", "decide.js", "external.js", "observe.js", "outline.js", "owner.js", "published.js"], path.join(OUT, "watch"));
  // the load-path check of a peer (pure, fetcher-injected): the Desk's partner check runs it
  await copy(path.join(DIST, "browser"), await jsFiles(path.join(DIST, "browser")), path.join(OUT, "browser"));
  const { errors, warnings, count } = await scan();
  for (const w of warnings) console.log(`WARNING: ${w}`);
  for (const e of errors) console.log(`ERROR: ${e}`);
  if (errors.length) {
    console.log(`build:site FAILED with ${errors.length} error(s).`);
    return 1;
  }
  console.log(`build:site: ${count} browser modules in ${path.relative(ROOT, OUT).split(path.sep).join("/")}/`);
  return 0;
}

process.exitCode = await main();
