#!/usr/bin/env node
// Drives the Plumbline Desk in a real browser for the UAT suite: reads a step script from stdin and runs it in ONE
// Chromium process. Plain Node ESM; Playwright is NOT a dependency of this package.
//
// How Playwright is resolved (first that works):
//   1. PLAYWRIGHT_MODULE: a path to an installed `playwright` package folder (the one holding package.json), or to
//      its index.mjs. Example (Git Bash):
//        PLAYWRIGHT_MODULE="$LOCALAPPDATA/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright"
//   2. a plain `import("playwright")` (a local or NODE_PATH install, if there is one; there is none in this repo).
//   3. the npx cache, which is where `npx --no-install playwright` resolves it on this machine: every
//      <npm cache>/_npx/*/node_modules/playwright/package.json, highest version first. <npm cache> is
//      npm_config_cache, else %LOCALAPPDATA%\npm-cache on Windows, else ~/.npm. On the machine this was written on
//      (2026-11-18) that is %LOCALAPPDATA%\npm-cache\_npx\e41f203b7505f1fb\node_modules\playwright, version 1.65.1.
// The browser is Playwright's own Chromium for that version (chromium-1255 for 1.65.1). If it is missing, the driver
// exits 1 and says so; install it with:   npx --no-install playwright install chromium
// The journal's `playwright` field records the module path and version that ran.
//
// Usage:
//   node uat/driver/drive-script.mjs < steps.js
//   node uat/driver/drive-script.mjs <<'EOF'
//   await goto(BASE_URL);
//   await waitFor('#portlist-items li');
//   await snap('overview');
//   expect('five ports are listed', (await page.locator('#portlist-items li').count()) === 5);
//   EOF
//
// The script is the body of an async function. In scope:
//   page, context, browser       Playwright objects
//   BASE_URL                     env BASE_URL (the Desk's address from `world.mjs up`), default http://127.0.0.1:4199/
//   goto(url)                    page.goto with waitUntil "domcontentloaded" (never "networkidle"); relative to BASE_URL
//   click(target), fill(target, value)
//                                target: a CSS/Playwright selector string, or { role, name } for getByRole
//   probe()                      the visible interactive elements only: [{ tag, role, name, id, type, disabled }]
//   snap(name)                   writes <SHOT_DIR>/<name>.png (full page), <name>.aria.yml (locator('body').ariaSnapshot())
//                                and <name>.txt (visible text); returns the three paths
//   waitFor(target, { state, timeout })        locator.waitFor (default state "visible")
//   waitForText(text, { timeout })             the first element with that text becomes visible
//   waitUntil(fn, { label, timeout, arg })     fn runs IN THE PAGE (page.waitForFunction) until it returns truthy
//   expect(label, condition, extra)            records a check; never throws; a false condition makes the exit 2
//   expectMatch(label, text, regex)            a text check that records the matched substring and its context; prefer
//                                              it to expect(label, re.test(text)) so a vacuous pass is visible
//   log(...)                     progress to stderr
//   note(key, value)             adds a field to the journal's `notes`
// Wait on predicates, never on fixed sleeps.
//
// Environment: BASE_URL, SHOT_DIR (default: a new <OS temp>/plumbline-uat-shots-<time> folder), TIMEOUT (ms per wait,
// default 15000), HEADED=1 (show the window), VIEWPORT=<width>x<height> (default 1280x900), RECORD_DIR=<folder> (record the
// page as video there at the viewport size; the script sees RECORD_T0, the wall-clock ms the recording began, and the
// journal gains `video`, the file).
// stdout: ONE JSON journal { ok, exit, playwright, baseUrl, shotDir, checks[], snaps[], probes, notes, console[], pageErrors[],
// error? }. Progress goes to stderr. Exit 0: the script ran and every expect passed. 1: the driver or the script threw.
// 2: an expect failed (a finding, not a driver fault).

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const journal = {
  ok: false,
  exit: 1,
  playwright: null,
  baseUrl: process.env.BASE_URL ?? "http://127.0.0.1:4199/",
  shotDir: null,
  checks: [],
  snaps: [],
  probes: [],
  notes: {},
  console: [],
  pageErrors: [],
};
const log = (...parts) => process.stderr.write(`${parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ")}\n`);
const TIMEOUT = Number(process.env.TIMEOUT ?? 15000);

function versionOf(dir) {
  try {
    return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).version;
  } catch {
    return null;
  }
}

function compareVersions(a, b) {
  const pa = String(a).split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  const pb = String(b).split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    // a pre-release tag sorts below the release
    return typeof x === "number" ? 1 : typeof y === "number" ? -1 : String(x).localeCompare(String(y));
  }
  return 0;
}

async function importFrom(dir) {
  const entry = existsSync(path.join(dir, "index.mjs")) ? path.join(dir, "index.mjs") : path.join(dir, "index.js");
  const mod = await import(pathToFileURL(entry).href);
  return mod.chromium ? mod : mod.default;
}

async function resolvePlaywright() {
  const override = process.env.PLAYWRIGHT_MODULE;
  if (override) {
    const dir = override.endsWith(".mjs") || override.endsWith(".js") ? path.dirname(override) : override;
    if (!existsSync(path.join(dir, "package.json"))) throw new Error(`PLAYWRIGHT_MODULE=${override} is not a playwright package folder (no package.json)`);
    return { mod: await importFrom(dir), from: dir, version: versionOf(dir), how: "PLAYWRIGHT_MODULE" };
  }
  try {
    const mod = await import("playwright");
    return { mod: mod.chromium ? mod : mod.default, from: "import('playwright')", version: null, how: "import" };
  } catch {
    // not installed where Node looks; try the npx cache
  }
  const cache =
    process.env.npm_config_cache ??
    (process.platform === "win32" ? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "npm-cache") : path.join(os.homedir(), ".npm"));
  const npx = path.join(cache, "_npx");
  const found = [];
  if (existsSync(npx)) {
    for (const d of readdirSync(npx)) {
      const dir = path.join(npx, d, "node_modules", "playwright");
      const v = versionOf(dir);
      if (v) found.push({ dir, v });
    }
  }
  found.sort((a, b) => compareVersions(b.v, a.v));
  if (found.length === 0) {
    throw new Error(`Playwright was not found: set PLAYWRIGHT_MODULE, or make npx fetch it once (npx playwright --version), looked in ${npx}`);
  }
  return { mod: await importFrom(found[0].dir), from: found[0].dir, version: found[0].v, how: "npx cache" };
}

function locatorOf(page, target) {
  if (typeof target === "string") return page.locator(target).first();
  if (target && typeof target === "object" && target.role) return page.getByRole(target.role, target.name !== undefined ? { name: target.name, exact: target.exact ?? false } : {}).first();
  if (target && typeof target === "object" && target.text) return page.getByText(target.text, { exact: target.exact ?? false }).first();
  throw new Error(`not a target: ${JSON.stringify(target)}`);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

let recording = null;
async function main() {
  const script = await readStdin();
  if (script.trim() === "") throw new Error("no step script on stdin");
  const pw = await resolvePlaywright();
  journal.playwright = { how: pw.how, from: pw.from, version: pw.version };
  log(`playwright ${pw.version ?? "?"} from ${pw.from}`);

  const shotDir = process.env.SHOT_DIR ? path.resolve(process.env.SHOT_DIR) : path.join(os.tmpdir(), `plumbline-uat-shots-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(shotDir, { recursive: true });
  journal.shotDir = shotDir;

  const [w, h] = (process.env.VIEWPORT ?? "1280x900").split("x").map(Number);
  let browser;
  try {
    browser = await pw.mod.chromium.launch({ headless: process.env.HEADED !== "1" });
  } catch (error) {
    const msg = String(error?.message ?? error);
    if (/Executable doesn't exist|browserType\.launch/i.test(msg)) {
      throw new Error(`Playwright ${pw.version ?? ""} has no Chromium installed. Install it with: npx --no-install playwright install chromium  (${msg.split("\n")[0]})`);
    }
    throw error;
  }
  try {
    // RECORD_DIR (the demo film's take): the page is recorded at the viewport's size; the journal's `video` names the
    // file once the context closes, and RECORD_T0 (wall-clock ms) is when the page, and so the video, began
    const size = { width: w || 1280, height: h || 900 };
    const context = await browser.newContext({ viewport: size, ...(process.env.RECORD_DIR ? { recordVideo: { dir: process.env.RECORD_DIR, size } } : {}) });
    const page = await context.newPage();
    const RECORD_T0 = Date.now();
    recording = { context, page };
    page.setDefaultTimeout(TIMEOUT);
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") journal.console.push({ type: m.type(), text: m.text().slice(0, 500) });
    });
    page.on("pageerror", (e) => journal.pageErrors.push(String(e?.message ?? e).slice(0, 500)));

    const helpers = {
      page,
      context,
      browser,
      BASE_URL: journal.baseUrl,
      RECORD_T0,
      log,
      note: (key, value) => {
        journal.notes[key] = value;
      },
      async goto(url) {
        const target = new URL(url ?? "", journal.baseUrl).toString();
        log(`goto ${target}`);
        const response = await page.goto(target, { waitUntil: "domcontentloaded" });
        return response?.status() ?? null;
      },
      async click(target) {
        log(`click ${JSON.stringify(target)}`);
        await locatorOf(page, target).click();
      },
      async fill(target, value) {
        log(`fill ${JSON.stringify(target)}`);
        await locatorOf(page, target).fill(value);
      },
      async waitFor(target, options = {}) {
        await locatorOf(page, target).waitFor({ state: options.state ?? "visible", timeout: options.timeout ?? TIMEOUT });
      },
      async waitForText(text, options = {}) {
        await page.getByText(text, { exact: options.exact ?? false }).first().waitFor({ state: "visible", timeout: options.timeout ?? TIMEOUT });
      },
      async waitUntil(fn, options = {}) {
        log(`waitUntil ${options.label ?? "(unlabelled)"}`);
        try {
          await page.waitForFunction(fn, options.arg, { timeout: options.timeout ?? TIMEOUT, polling: 100 });
        } catch (error) {
          throw new Error(`waitUntil ${options.label ?? "(unlabelled)"}: ${String(error?.message ?? error).split("\n")[0]}`);
        }
      },
      expect(label, condition, extra) {
        const pass = Boolean(condition);
        journal.checks.push({ label, pass, ...(extra !== undefined ? { extra } : {}) });
        log(`${pass ? "PASS" : "FAIL"} ${label}`);
        return pass;
      },
      // A text check that records WHAT it matched, with 40 characters either side, so a reader can see a vacuous pass
      // (run 2026-11-18-first-five: /89/ matched inside a 64-hex hash, /sign/ matched inside "unsigned lock").
      expectMatch(label, text, pattern) {
        const source = String(text ?? "");
        const m = pattern instanceof RegExp ? pattern.exec(source) : null;
        const at = m ? m.index : -1;
        const matched = m ? { match: m[0], context: source.slice(Math.max(0, at - 40), at + m[0].length + 40).replace(/\s+/g, " ") } : { match: null };
        const pass = m !== null;
        journal.checks.push({ label, pass, pattern: String(pattern), ...matched });
        log(`${pass ? "PASS" : "FAIL"} ${label}${pass ? ` (matched "${m[0]}" in "...${matched.context}...")` : ""}`);
        return pass;
      },
      async probe() {
        const items = await page.evaluate(() => {
          const sel = "a[href], button, input, select, textarea, summary, [role=button], [role=link], [role=tab], [role=checkbox], [role=switch], [role=menuitem], [contenteditable=true], [tabindex]:not([tabindex='-1'])";
          const visible = (el) => {
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !el.closest("[hidden],[inert]");
          };
          const nameOf = (el) =>
            (el.getAttribute("aria-label") ||
              (el.getAttribute("aria-labelledby") && document.getElementById(el.getAttribute("aria-labelledby"))?.textContent) ||
              (el.labels && el.labels[0]?.textContent) ||
              el.getAttribute("placeholder") ||
              el.textContent ||
              el.getAttribute("title") ||
              "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 120);
          return [...document.querySelectorAll(sel)].filter(visible).map((el) => ({
            tag: el.tagName.toLowerCase(),
            role: el.getAttribute("role") ?? undefined,
            name: nameOf(el),
            id: el.id || undefined,
            type: el.getAttribute("type") ?? undefined,
            href: el.getAttribute("href") ?? undefined,
            disabled: el.disabled === true || el.getAttribute("aria-disabled") === "true" || undefined,
          }));
        });
        journal.probes.push({ url: page.url(), items });
        return items;
      },
      async snap(name) {
        const safe = String(name).replace(/[^A-Za-z0-9._-]/g, "_");
        const png = path.join(shotDir, `${safe}.png`);
        const aria = path.join(shotDir, `${safe}.aria.yml`);
        const txt = path.join(shotDir, `${safe}.txt`);
        await page.screenshot({ path: png, fullPage: true });
        writeFileSync(aria, await page.locator("body").ariaSnapshot());
        writeFileSync(txt, await page.locator("body").innerText());
        journal.snaps.push({ name: safe, url: page.url(), png, aria, txt });
        log(`snap ${safe}`);
        return { png, aria, txt };
      },
    };
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    const run = new AsyncFunction(...Object.keys(helpers), script);
    await run(...Object.values(helpers));
  } finally {
    if (recording && process.env.RECORD_DIR) {
      const video = recording.page.video();
      await recording.context.close().catch(() => {});
      if (video) journal.video = await video.path().catch(() => null);
    }
    await browser.close();
  }
}

try {
  await main();
  const failed = journal.checks.filter((c) => !c.pass).length;
  journal.ok = failed === 0;
  journal.exit = failed === 0 ? 0 : 2;
} catch (error) {
  journal.ok = false;
  journal.exit = 1;
  journal.error = String(error?.stack ?? error?.message ?? error).split("\n").slice(0, 6).join("\n");
  log(`driver error: ${String(error?.message ?? error).split("\n")[0]}`);
}
process.stdout.write(`${JSON.stringify(journal, null, 2)}\n`);
process.exitCode = journal.exit;
