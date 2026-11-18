#!/usr/bin/env node
// TEST HARNESS, NOT THE PRODUCT. It exists only because the product's CLI cannot reach a loopback world:
//   - `plumbline init` and `plumbline watch --root` take no --allow-local, so every peer at http://127.0.0.1:<port> is
//     recorded as pending ("the address is not https") and never watched;
//   - `--external a2a-card=<url>` refuses an http address;
//   - `scripts/scan-ecosystem.mjs` refuses a list with an http address.
// (`watch --url --allow-local` reads a loopback site's published lock, but still refuses every non-https peer address
// IN that lock, by design: the lock is a stranger's document. This harness does not change that either.)
//
// It calls the BUILT product modules unchanged (dist/watch/index.js runWatch and runRelock, dist/scan/run.js scanList,
// dist/scan/report.js renderHtml) and passes the same dependency the product's own tests pass: fetchOptions
// { allowLocal: true }, which lets safeFetch use http and loopback (private ranges stay refused). Nothing else differs.
// stdout is what the CLI would print for the same report (the printing below mirrors src/cli/watch-command.ts, which
// does not export it); a banner on stderr says the harness ran.
//
// Anything a Character does through this harness is "reachable only through the test harness". Record that as a
// finding in its own right: a publisher could not have done it with the product before going live.
//
//   node uat/driver/local-cli.mjs watch --root <dir> [--init] [--source <ref>]... [--external a2a-card=<url>]... [--timeout <ms>] [--json]
//   node uat/driver/local-cli.mjs watch --root <dir> --relock [--source <ref>]... [--drop <ref>]... [--external a2a-card=<url>]... [--json]
//   node uat/driver/local-cli.mjs scan <address>... [--out <dir>] [--json] [--real-atlas]
//
// --external here also takes http://127.0.0.1 / http://localhost addresses (the product's parser refuses http); every
// other value goes through the product's own parser. Exit codes are the CLI's: watch 0 clean / 1 findings or no usable
// lock / 2 usage or I/O; relock 0 written; scan 0 report written or printed, 2 usage.
//
// AGENT ATLAS STAND-IN (scan only, the default). The scan's gate sends every address to Agent Atlas' public API. A
// world's addresses are loopback, so by default this harness answers every request to the Atlas base URL HERE, from the
// recorded response src/test/fixtures/wp2/atlas-check-no-manifest.json with files[0].status set to 0: the shape the
// adapter maps to "Agent Atlas could not connect to the target", which is word for word what the live Atlas answered for
// a loopback address on 2026-11-18. Nothing about a world leaves the machine. Each answered request is printed on stderr
// ("ATLAS STAND-IN answered: <target>"), the count is printed at the end, and with --out a harness.json beside the
// report records that Atlas was a stand-in. --real-atlas sends the addresses to the public service instead (an explicit
// opt-in; it says so on stderr). Agent Customs is never sent an address, but its public receipts index and key are
// read: by default those reads are answered from the recorded src/test/fixtures/wp2/customs-index.json and
// customs-key.json (a receipt path answers 404), so a world scan contacts no public service at all; --real-customs
// reads the real ones. Learned from shots/priya/arms/scan-arm.mjs (run 2026-11-18-first-five), whose walker found the
// harness had no stand-in.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOCAL = { allowLocal: true };
const BANNER = "local-cli: TEST HARNESS (uat/driver/local-cli.mjs): the built Plumbline modules with allowLocal; the product's CLI cannot do this run against a loopback site\n";

const USAGE = `usage:
  node uat/driver/local-cli.mjs watch --root <dir> [--init] [--source <ref>]... [--external a2a-card=<url>]... [--timeout <ms>] [--json]
  node uat/driver/local-cli.mjs watch --root <dir> --relock [--source <ref>]... [--drop <ref>]... [--external a2a-card=<url>]... [--json]
  node uat/driver/local-cli.mjs scan <address>... [--out <dir>] [--json] [--real-atlas]
`;

const load = (rel) => import(pathToFileURL(path.join(REPO, "dist", ...rel.split("/"))).href);

function usage(message) {
  process.stderr.write(`${message}\n${USAGE}`);
  return 2;
}

function parse(argv, values, flags, repeatable) {
  const out = { values: new Map(), flags: new Set(), lists: new Map(repeatable.map((r) => [r, []])), positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) out.positional.push(a);
    else {
      const name = a.slice(2);
      if (flags.includes(name)) out.flags.add(name);
      else if (values.includes(name) || repeatable.includes(name)) {
        const v = argv[++i];
        if (v === undefined || v.startsWith("--")) throw new Error(`--${name} takes a value`);
        if (repeatable.includes(name)) out.lists.get(name).push(v);
        else out.values.set(name, v);
      } else throw new Error(`unknown argument ${a}`);
    }
  }
  return out;
}

const isLoopbackHttp = (url) => {
  try {
    const u = new URL(url);
    return u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost") && !u.username && !u.password;
  } catch {
    return false;
  }
};

/** Mirrors printReport in src/cli/watch-command.ts. */
function printReport(report, json) {
  const noLock = report.lockState !== undefined && report.lockState !== "found";
  if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    if (noLock) process.stdout.write(`lock  ${report.lockState}: ${report.lockSummary ?? ""}\n`);
    else if (report.findings.length === 0) process.stdout.write("watch: no drift\n");
    for (const f of report.findings) process.stdout.write(`${f.severity.padEnd(5)} ${f.kind} ${f.ref}: ${f.summary}\n`);
  }
  return noLock || report.findings.some((f) => f.severity === "warn" || f.severity === "block") ? 1 : 0;
}

async function watch(argv) {
  let args;
  try {
    args = parse(argv, ["root", "timeout"], ["init", "relock", "json"], ["source", "drop", "external"]);
  } catch (error) {
    return usage(error.message);
  }
  if (args.positional.length) return usage(`unexpected argument ${args.positional[0]}`);
  const root = path.resolve(args.values.get("root") ?? process.cwd());
  const init = args.flags.has("init");
  const relock = args.flags.has("relock");
  const json = args.flags.has("json");
  const sources = args.lists.get("source");
  const drops = args.lists.get("drop");
  if (init && relock) return usage("--init and --relock do not go together: --init writes a first lock, --relock replaces one");
  if (drops.length && !relock) return usage("--drop goes with --relock: it takes a ref out of the lock --relock writes");
  const { parseExternalArg } = await load("watch/external.js");
  const externals = [];
  for (const arg of args.lists.get("external")) {
    const at = arg.indexOf("=");
    if (arg.slice(0, at) === "a2a-card" && isLoopbackHttp(arg.slice(at + 1))) {
      externals.push({ kind: "a2a-card", url: arg.slice(at + 1) });
      continue;
    }
    const parsed = parseExternalArg(arg);
    if ("problem" in parsed) return usage(parsed.problem);
    externals.push(parsed);
  }
  if (externals.length && !init && !relock) return usage("--external goes with --init or --relock: it adds a definition to the lock they write");
  let timeoutMs;
  if (args.values.has("timeout")) {
    timeoutMs = Number(args.values.get("timeout"));
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return usage("--timeout takes a positive number of milliseconds");
  }
  const { runWatch, runRelock } = await load("watch/index.js");
  const { RESIGN_REMINDER } = await load("watch/decide.js");
  const options = { root, init, ...(timeoutMs !== undefined ? { timeoutMs } : {}) };
  const deps = { fetchOptions: LOCAL, extraSources: sources, externals };
  if (relock) {
    let result;
    try {
      result = await runRelock(options, { ...deps, dropSources: drops });
    } catch (error) {
      process.stderr.write(`watch failed: ${error?.message ?? "unknown error"}\n`);
      return 2;
    }
    if (json) process.stdout.write(`${JSON.stringify({ relocked: true, ...result, reminder: RESIGN_REMINDER }, null, 2)}\n`);
    else {
      process.stdout.write(`relock: wrote plumbline.lock.json (the previous lock was ${result.previous})\n`);
      const { added, removed, changed } = result.changes;
      for (const ref of added) process.stdout.write(`added   ${ref}\n`);
      for (const ref of removed) process.stdout.write(`removed ${ref}\n`);
      for (const ref of changed) process.stdout.write(`changed ${ref}\n`);
      if (added.length + removed.length + changed.length === 0) process.stdout.write("no ref changed\n");
      for (const f of result.findings) process.stdout.write(`${f.severity.padEnd(5)} ${f.kind} ${f.ref}: ${f.summary}\n`);
      process.stdout.write(`${RESIGN_REMINDER}\n`);
    }
    return 0;
  }
  let report;
  try {
    report = await runWatch(options, deps);
  } catch (error) {
    process.stderr.write(`watch failed: ${error?.message ?? "unknown error"}\n`);
    return 2;
  }
  if (init && report.lockState === undefined) {
    // runWatch with init and no lock wrote one and returned the capture's findings (as `watch --init` prints them)
    if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else {
      if (report.findings.length === 0) process.stdout.write("watch: no drift\n");
      for (const f of report.findings) process.stdout.write(`${f.severity.padEnd(5)} ${f.kind} ${f.ref}: ${f.summary}\n`);
    }
    return report.findings.some((f) => f.severity === "warn" || f.severity === "block") ? 1 : 0;
  }
  return printReport(report, json);
}

/**
 * The fetcher the scan uses: the product's safeFetch for everything, except requests to the Agent Atlas base URL, which
 * are answered locally from a recorded response unless `real` is set. Returns the fetcher and a counter of the targets
 * the stand-in answered.
 */
async function standInFetch({ realAtlas, realCustoms }) {
  const { safeFetch } = await load("net/safe-fetch.js");
  const { ATLAS_BASE, CUSTOMS_BASE } = await load("gate/context.js");
  const fixture = async (name) => readFile(path.join(REPO, "src", "test", "fixtures", "wp2", name), "utf8");
  const recorded = JSON.parse(await fixture("atlas-check-no-manifest.json"));
  recorded.files[0].status = 0; // the shape the adapter reads as "could not connect to the target"
  const atlasText = JSON.stringify(recorded);
  const customsFiles = new Map([
    [new URL("receipts/index.json", CUSTOMS_BASE).toString(), await fixture("customs-index.json")],
    [new URL(".well-known/agent-customs-key.json", CUSTOMS_BASE).toString(), await fixture("customs-key.json")],
  ]);
  const answer = (url, status, text) => ({ status, ok: status === 200, url, redirects: 0, headers: { "content-type": "application/json" }, bytes: new TextEncoder().encode(text), text: () => text });
  const answered = { atlas: [], customs: 0 };
  const fetch = async (url, options) => {
    if (!realAtlas && url.startsWith(ATLAS_BASE)) {
      const target = new URL(url).searchParams.get("url") ?? "(no url parameter)";
      answered.atlas.push(target);
      process.stderr.write(`ATLAS STAND-IN answered: ${target}\n`);
      return answer(url, 200, atlasText);
    }
    if (!realCustoms && url.startsWith(CUSTOMS_BASE)) {
      answered.customs += 1;
      return customsFiles.has(url) ? answer(url, 200, customsFiles.get(url)) : answer(url, 404, "");
    }
    return safeFetch(url, options);
  };
  return { fetch, answered };
}

async function scan(argv) {
  let args;
  try {
    args = parse(argv, ["out"], ["json", "real-atlas", "real-customs"], []);
  } catch (error) {
    return usage(error.message);
  }
  const addresses = [...new Set(args.positional)];
  if (!addresses.length) return usage("scan takes one or more site addresses");
  for (const a of addresses) {
    let u;
    try {
      u = new URL(a);
    } catch {
      return usage(`not an address: ${a}`);
    }
    if (u.protocol !== "https:" && !isLoopbackHttp(a)) return usage(`scan takes https addresses, or http://127.0.0.1 / http://localhost ones: ${a}`);
  }
  const run = await load("scan/run.js");
  const report = await load("scan/report.js");
  const pkg = JSON.parse(await readFile(path.join(REPO, "package.json"), "utf8"));
  const realAtlas = args.flags.has("real-atlas");
  const realCustoms = args.flags.has("real-customs");
  const { fetch, answered } = await standInFetch({ realAtlas, realCustoms });
  process.stderr.write(`plumbline ecosystem scan: ${addresses.length} sites, one at a time, ${run.DELAY_MS} ms apart, ${run.SITE_DEADLINE_MS} ms deadline each.\n`);
  process.stderr.write(
    realAtlas
      ? "local-cli: --real-atlas: every address below IS SENT to Agent Atlas' public API.\n"
      : "local-cli: AGENT ATLAS IS A STAND-IN for this run: every Atlas request is answered here with the recorded 'could not connect' response; no address leaves this machine.\n",
  );
  process.stderr.write(
    realCustoms
      ? "local-cli: --real-customs: Agent Customs' public receipts index and key are read.\n"
      : "local-cli: AGENT CUSTOMS IS A STAND-IN for this run: its index and key are the recorded copies in src/test/fixtures/wp2/.\n",
  );
  process.stderr.write("local-cli: the product's own disclosure below describes the real scan, not this one.\n");
  for (const line of report.DISCLOSURE) process.stderr.write(`  ${line}\n`);
  const result = await run.scanList(addresses, pkg.version, {
    fetch,
    fetchOptions: LOCAL,
    onSite: (site, i, total) =>
      process.stderr.write(`[${i + 1}/${total}] gate ${site.gate.state}, drift ${site.drift}, signature ${site.signature.state}, ${site.elapsedMs} ms: ${site.address}\n`),
  });
  const harness = {
    harness: "uat/driver/local-cli.mjs scan",
    atlas: realAtlas
      ? { source: "real", note: "every address was sent to Agent Atlas' public API (--real-atlas)" }
      : { source: "stand-in", answered: answered.atlas.length, note: "answered locally with the recorded 'could not connect' response; no address left the machine. Every Atlas line in this report is the stand-in's, not Atlas's." },
    customs: realCustoms
      ? { source: "real", note: "Agent Customs' public index and key were read (--real-customs)" }
      : { source: "stand-in", answered: answered.customs, note: "the recorded index and key from src/test/fixtures/wp2/; a receipt path answers 404" },
  };
  process.stderr.write(
    `local-cli: Atlas ${realAtlas ? "real" : `stand-in (${answered.atlas.length} answered here, 0 sent out)`}; Customs ${realCustoms ? "real" : `stand-in (${answered.customs} reads answered here)`}.\n`,
  );
  const out = args.values.get("out");
  if (out !== undefined) {
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, "report.json"), `${JSON.stringify(result, null, 2)}\n`);
    await writeFile(path.join(out, "report.html"), report.renderHtml(result));
    await writeFile(path.join(out, "harness.json"), `${JSON.stringify(harness, null, 2)}\n`);
    process.stderr.write(`wrote ${path.join(out, "report.json")}, report.html and harness.json\n`);
  }
  if (out === undefined || args.flags.has("json")) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

const [command, ...rest] = process.argv.slice(2);
process.stderr.write(BANNER);
process.exitCode = command === "watch" ? await watch(rest) : command === "scan" ? await scan(rest) : usage(command ? `unknown command ${command}` : "a command is required");
