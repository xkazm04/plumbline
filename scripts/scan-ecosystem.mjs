// node scripts/scan-ecosystem.mjs <list file> --out <dir>
// The state of a list of agentic sites: for each address, the gate report, the published lock's drift report and
// whether a signature and a key record are published (docs/ecosystem-scan.md). Writes <dir>/report.json (the stable
// schema in src/scan/report.ts) and <dir>/report.html (static, no script, every string escaped). Run `npm run build`
// first: this script loads the built modules. It scans one site at a time with a fixed pause, and prints what it sends
// where before it starts. Exit 0 when the report was written, 2 for a usage or I/O error.
//
// Publishing a report that names other people's sites is the owner's decision; ecosystem/out/ is git-ignored.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const USAGE = "usage: node scripts/scan-ecosystem.mjs <list file> --out <dir>";

function fail(message) {
  process.stderr.write(`${message}\n${USAGE}\n`);
  return 2;
}

async function main(argv) {
  let list;
  let out;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") {
      out = argv[++i];
      if (out === undefined || out.startsWith("--")) return fail("--out takes a folder");
    } else if (argv[i].startsWith("--")) return fail(`unknown option ${argv[i]}`);
    else if (list === undefined) list = argv[i];
    else return fail(`unexpected argument ${argv[i]}`);
  }
  if (list === undefined || out === undefined) return fail("a list file and --out are required");

  let run;
  let report;
  try {
    run = await import(pathToFileURL(path.join(ROOT, "dist", "scan", "run.js")).href);
    report = await import(pathToFileURL(path.join(ROOT, "dist", "scan", "report.js")).href);
  } catch {
    return fail("the built modules are missing: run `npm run build` first");
  }
  const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  let text;
  try {
    text = await readFile(list, "utf8");
  } catch {
    return fail("the list file could not be read");
  }
  const { addresses, problems } = run.parseList(text);
  if (problems.length > 0) return fail(`the list was refused: ${problems.join("; ")}`);
  if (addresses.length === 0) return fail("the list names no address");

  process.stderr.write(`plumbline ecosystem scan: ${addresses.length} sites, one at a time, ${run.DELAY_MS} ms apart, ${run.SITE_DEADLINE_MS} ms deadline each.\n`);
  for (const line of report.DISCLOSURE) process.stderr.write(`  ${line}\n`);
  const result = await run.scanList(addresses, pkg.version, {
    onSite: (site, i, total) =>
      process.stderr.write(`[${i + 1}/${total}] gate ${site.gate.state}, drift ${site.drift}, signature ${site.signature.state}, ${site.elapsedMs} ms: ${site.address}\n`),
  });
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, "report.json"), `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(path.join(out, "report.html"), report.renderHtml(result));
  process.stderr.write(`wrote ${path.join(out, "report.json")} and report.html\n`);
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
