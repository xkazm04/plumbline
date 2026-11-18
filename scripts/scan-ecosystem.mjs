// node scripts/scan-ecosystem.mjs <list file> --out <dir> [--adapters validator,atlas,customs] [--trust <trust file>] [--allow-local]
// The scan of a list of agentic sites, kept under its old name. Since UAT-28 (PRI-L1-11) it is the CLI's own command,
// `plumbline scan` (src/cli/scan-command.ts, docs/ecosystem-scan.md); this script runs that module unchanged, so both
// write the same report. Run `npm run build` first: it loads the built module. Exit 0 when the report was written, 2 for
// a usage or I/O error.
//
// Publishing a report that names other people's sites is the owner's decision; ecosystem/out/ is git-ignored.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const USAGE = "usage: node scripts/scan-ecosystem.mjs <list file> --out <dir> [--adapters validator,atlas,customs] [--trust <trust file>] [--allow-local] (or: plumbline scan, the same command)";

let scan;
try {
  scan = await import(pathToFileURL(path.join(ROOT, "dist", "cli", "scan-command.js")).href);
} catch {
  process.stderr.write(`the built modules are missing: run \`npm run build\` first\n${USAGE}\n`);
  process.exit(2);
}
process.exitCode = await scan.runScanCommand(process.argv.slice(2), USAGE);
