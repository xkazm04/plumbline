// The Desk's Content-Security-Policy (site/index.html) and the static-host headers beside it (site/_headers).
// The Desk holds the visitor's LLM key and, while signing, a private key in memory, and renders model-written content,
// so it must keep a strict policy: this test fails if index.html loses the CSP <meta> tag, if the policy allows eval or
// inline script, or if the style hashes no longer match the vendored runtime's fixed inline styles.
// Run: npm run test:site. No browser here; the browser proof (zero violations across the Desk's flows) is recorded in
// site/README.md, "Content-Security-Policy".
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { PRESENTATION_CSS } from "../runtime/cruse-render.js";

const SITE = new URL("../", import.meta.url);
const read = async (rel) => (await readFile(new URL(rel, SITE), "utf8")).replace(/\r\n/g, "\n");
const sha256 = (text) => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

const html = await read("index.html");
const head = html.slice(0, html.indexOf("</head>"));
const metas = [...head.matchAll(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*>/gi)];

/** The policy as a Map from directive name to its list of sources. */
function parsePolicy(text) {
  const directives = new Map();
  for (const part of text.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (!name) continue;
    assert.ok(!directives.has(name.toLowerCase()), `the policy names ${name} twice`);
    directives.set(name.toLowerCase(), sources);
  }
  return directives;
}

const policy = metas.length === 1 ? parsePolicy(metas[0][1]) : new Map();

/** What the vendored runtime injects as inline style: the <style> block from BASE_CSS, and constant style="" texts. */
async function runtimeInlineStyles() {
  const ui = await read("runtime/ui.js");
  const base = ui.match(/const BASE_CSS = PRESENTATION_CSS \+ `([^`]*)`;/);
  assert.ok(base, "runtime/ui.js no longer builds BASE_CSS as PRESENTATION_CSS + a template literal; recompute the style hashes by hand");
  assert.ok(!base[1].includes("${") && !base[1].includes("\\"), "BASE_CSS now has interpolations or escapes; its text cannot be read from the source");
  const attributes = new Set();
  const runtime = new URL("runtime/", SITE);
  for (const name of (await readdir(runtime)).filter((n) => n.endsWith(".js")).sort()) {
    const text = await read(`runtime/${name}`);
    for (const match of text.matchAll(/style="([^"]*)"/g)) {
      assert.ok(!match[1].includes("${"), `runtime/${name} builds a style="" attribute from data (${match[1]}); a hash cannot allow it`);
      attributes.add(match[1]);
    }
  }
  return { block: PRESENTATION_CSS + base[1], attributes: [...attributes] };
}

test("index.html carries exactly one CSP meta tag, before any script or stylesheet", () => {
  assert.equal(metas.length, 1, "site/index.html must have one <meta http-equiv=\"Content-Security-Policy\"> in <head>");
  const at = metas[0].index;
  for (const tag of ["<script", "<link"]) {
    const first = head.indexOf(tag);
    if (first !== -1) assert.ok(at < first, `the CSP meta tag must come before the first ${tag}, or that element loads unprotected`);
  }
});

test("the policy never allows eval or inline script", () => {
  const all = [...policy.values()].flat().map((s) => s.toLowerCase());
  assert.ok(!all.includes("'unsafe-eval'"), "the Desk's policy must not allow 'unsafe-eval'");
  assert.ok(!all.includes("'wasm-unsafe-eval'"), "the Desk's policy must not allow 'wasm-unsafe-eval'");
  assert.deepEqual(policy.get("script-src"), ["'self'"], "script-src is 'self' only: no inline script, no nonce, no other host");
  assert.ok(!(policy.get("style-src") || []).includes("'unsafe-inline'"), "style-src allows the runtime's styles by hash, not 'unsafe-inline'");
});

test("the policy denies by default and closes base, form, object and plugin routes", () => {
  assert.deepEqual(policy.get("default-src"), ["'none'"]);
  assert.deepEqual(policy.get("object-src"), ["'none'"]);
  assert.deepEqual(policy.get("base-uri"), ["'none'"]);
  assert.deepEqual(policy.get("form-action"), ["'none'"]);
  assert.deepEqual(policy.get("worker-src"), ["'self'"]);
  assert.ok(!policy.has("frame-ancestors"), "frame-ancestors is ignored in a meta tag; it belongs in site/_headers");
});

test("connect-src allows https, the page's origin and local model servers, and no other plain http", () => {
  assert.deepEqual(policy.get("connect-src"), ["'self'", "https:", "http://localhost:*", "http://127.0.0.1:*"]);
});

test("style-src allows exactly the vendored runtime's inline styles, by hash", async () => {
  const { block, attributes } = await runtimeInlineStyles();
  const sources = policy.get("style-src") || [];
  assert.equal(sources[0], "'self'");
  const hashes = sources.filter((s) => s.startsWith("'sha256-"));
  const expected = [sha256(block), ...attributes.map(sha256)];
  assert.deepEqual([...hashes].sort(), [...expected].sort(),
    "style-src hashes differ from the runtime's inline styles (runtime/ui.js BASE_CSS and its style=\"\" attributes). "
    + `Expected ${expected.join(" ")}`);
  assert.equal(sources.includes("'unsafe-hashes'"), attributes.length > 0, "'unsafe-hashes' is needed exactly when the runtime has style attributes");
  assert.equal(sources.length, 1 + (attributes.length > 0 ? 1 : 0) + expected.length, "style-src has a source the runtime does not need");
});

test("frame-src allows each partner in allowed_peers, for the runtime's action bridge frame", async () => {
  const manifest = JSON.parse(await read("agent-manifest.json"));
  const frames = policy.get("frame-src") || [];
  for (const peer of manifest.allowed_peers) assert.ok(frames.includes(new URL(peer).origin), `frame-src lacks ${peer}`);
  for (const source of frames) assert.match(source, /^https:\/\/[a-z0-9.-]+$/, `frame-src ${source} is not one https origin`);
});

test("_headers forbids framing the Desk and gives the sandbox worker the policy the runtime asks for", async () => {
  const headers = await read("_headers");
  const rules = new Map();
  let path = null;
  for (const line of headers.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) { path = line.trim(); rules.set(path, []); continue; }
    rules.get(path).push(line.trim());
  }
  for (const page of ["/", "/index.html"]) {
    assert.deepEqual(rules.get(page), ["Content-Security-Policy: frame-ancestors 'none'"], `${page} must send frame-ancestors 'none'`);
  }
  assert.ok(![...rules.keys()].some((p) => p === "/*" || p.startsWith("/bridge")), "bridge/action-bridge.html must stay framable");
  const worker = await read("runtime/sandbox-worker.js");
  const asked = worker.match(/Serve runtime\/sandbox-worker\.js with: ([^.]+)\./);
  assert.ok(asked, "runtime/sandbox-worker.js no longer states the policy it needs");
  assert.deepEqual(rules.get("/runtime/sandbox-worker.js"), [`Content-Security-Policy: ${asked[1]}`]);
});
