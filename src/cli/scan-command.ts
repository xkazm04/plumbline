// plumbline scan <list file> --out <dir> [--adapters validator,atlas,customs] [--trust <trust file>] [--allow-local]
// The state of a list of agentic sites (an agency's portfolio, or an ecosystem list): for each address, the gate report,
// the published lock's drift report and whether a signature and a key record are published (docs/ecosystem-scan.md).
// Writes <dir>/report.json (the stable schema in src/scan/report.ts) and <dir>/report.html (static, no script, every
// string escaped). It scans one site at a time with a fixed pause, and prints what it sends where before it starts.
// --adapters names the gate's checkers (default all three): leaving atlas out sends no address to Agent Atlas, for a
// pre-launch or confidential list (UAT-11). --trust names the operator's own trust file (UAT-20): each site's signature
// is then checked as plumbline verify --url checks it against that file, and a revocation that verifies is recorded in
// it, as verify does. --allow-local (UAT-21) takes http and loopback addresses in the list, for a rehearsal on this
// machine (private ranges stay refused; a warning is printed and the report says so). Exit 0 when the report was
// written, 2 for a usage or I/O error. UAT-28 (PRI-L1-11): the same scan as `node scripts/scan-ecosystem.mjs`, which is
// now a shim over this module, so an operator finds it in `plumbline --help`.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DELAY_MS, SITE_DEADLINE_MS, parseList, scanList } from "../scan/run.js";
import { disclosureFor, renderHtml } from "../scan/report.js";
import { ALLOW_LOCAL_WARNING, checkSignature } from "./gate-command.js";
import { readTrustFile } from "./files.js";

export const USAGE = "usage: plumbline scan <list file> --out <dir> [--adapters validator,atlas,customs] [--trust <trust file>] [--allow-local]";
/** What the scan does, in one line: the help's line for it. */
export const SCAN_SUMMARY =
  "plumbline scan: a portfolio report for a list of sites (one address per line): report.json and report.html, worst first.";
const KNOWN_ADAPTERS = ["validator", "atlas", "customs"] as const;
type Adapter = (typeof KNOWN_ADAPTERS)[number];

/** The --adapters list, or a refusal sentence: each a known checker, at least one. */
function adaptersOf(value: string | undefined): { adapters: Adapter[] } | { problem: string } {
  const listed = String(value ?? "").split(",").map((a) => a.trim()).filter(Boolean);
  if (value === undefined || listed.length === 0 || !listed.every((a) => (KNOWN_ADAPTERS as readonly string[]).includes(a))) {
    return { problem: `unknown adapter in --adapters (known: ${KNOWN_ADAPTERS.join(", ")})` };
  }
  return { adapters: [...new Set(listed)] as Adapter[] };
}

/**
 * Runs the scan. `usage` is the usage line printed after a refusal: the CLI's own, or the script's when it runs through
 * `node scripts/scan-ecosystem.mjs`, so each surface names the command as it was typed.
 */
export async function runScanCommand(argv: string[], usage: string = USAGE): Promise<number> {
  const fail = (message: string): 2 => {
    process.stderr.write(`${message}\n${usage}\n`);
    return 2;
  };
  // the script's own --help (the CLI answers `plumbline scan --help` before it gets here)
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${SCAN_SUMMARY}\n${usage}\n`);
    return 0;
  }
  let list: string | undefined;
  let out: string | undefined;
  let adapters: Adapter[] | undefined;
  let trust: string | undefined;
  let allowLocal = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--out") {
      out = argv[++i];
      if (out === undefined || out.startsWith("--")) return fail("--out takes a folder");
    } else if (arg === "--adapters") {
      const read = adaptersOf(argv[++i]);
      if ("problem" in read) return fail(read.problem);
      adapters = read.adapters;
    } else if (arg === "--allow-local") {
      allowLocal = true;
    } else if (arg === "--trust") {
      trust = argv[++i];
      if (trust === undefined || trust === "" || trust.startsWith("--")) return fail("--trust takes a trust file (plumbline.trust.json)");
    } else if (arg.startsWith("--")) return fail(`unknown option ${arg}`);
    else if (list === undefined) list = arg;
    else return fail(`unexpected argument ${arg}`);
  }
  if (list === undefined || out === undefined) return fail("a list file and --out are required");

  // UAT-20: a trust file that cannot be used is refused before anything is read
  if (trust !== undefined) {
    try {
      await readTrustFile(trust);
    } catch (error) {
      return fail(`--trust: ${error instanceof Error ? error.message : "the trust file could not be read"}`);
    }
  }
  const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
  let text: string;
  try {
    text = await readFile(list, "utf8");
  } catch {
    return fail("the list file could not be read");
  }
  const { addresses, problems } = parseList(text, { allowLocal });
  if (problems.length > 0) {
    // UAT-28 (PRI-L2-4): an http list names the flag that takes a site on this machine
    const http = !allowLocal && problems.some((p) => /not an https address/.test(p)) ? "; for sites on this machine (localhost, 127.0.0.1), add --allow-local" : "";
    return fail(`the list was refused: ${problems.join("; ")}${http}`);
  }
  if (addresses.length === 0) return fail("the list names no address");

  process.stderr.write(`plumbline scan: ${addresses.length} sites, one at a time, ${DELAY_MS} ms apart, ${SITE_DEADLINE_MS} ms deadline each.\n`);
  // UAT-21: a list of sites on this machine (a rehearsal before production); the warning comes first
  if (allowLocal) process.stderr.write(`${ALLOW_LOCAL_WARNING}\n`);
  for (const line of disclosureFor(adapters, { trust: trust !== undefined, allowLocal })) process.stderr.write(`  ${line}\n`);
  const trustFile = trust;
  const result = await scanList(addresses, pkg.version, {
    ...(adapters !== undefined ? { adapters } : {}),
    ...(allowLocal ? { allowLocal: true } : {}),
    ...(trustFile !== undefined ? { verifySignature: (address: string) => checkSignature(address, trustFile, allowLocal) } : {}),
    onSite: (site, i, total) =>
      process.stderr.write(
        `[${i + 1}/${total}] ${site.attention}: gate ${site.gate.state}, drift ${site.drift}, signature ${site.signature.state}${site.signatureCheck ? ` (${site.signatureCheck.verdict}${site.signatureCheck.reason ? ` ${site.signatureCheck.reason}` : ""})` : ""}, ${site.elapsedMs} ms: ${site.address}\n`,
      ),
  });
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, "report.json"), `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(path.join(out, "report.html"), renderHtml(result));
  process.stderr.write(`wrote ${path.join(out, "report.json")} and report.html\n`);
  return 0;
}
