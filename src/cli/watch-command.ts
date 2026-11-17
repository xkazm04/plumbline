// plumbline watch [--root <dir>] [--init] [--source <ref>]... [--timeout <ms>] [--json]
// Dry-run: it reports, and with --init (and no lock yet) writes plumbline.lock.json, nothing else.
// Exit 0: no finding of severity warn or block (info alone is clean). 1: at least one warn or block. 2: usage or I/O error.
// The Director wires runWatchCommand into src/cli/index.ts.

import { resolve } from "node:path";
import { runWatch } from "../watch/index.js";

const USAGE = "usage: plumbline watch [--root <dir>] [--init] [--source <path-or-https-url>]... [--timeout <ms>] [--json]\n";

export async function runWatchCommand(args: string[]): Promise<number> {
  let root = process.cwd();
  let init = false;
  let json = false;
  let timeoutMs: number | undefined;
  const extraSources: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    const value = (): string | undefined => args[++i];
    if (arg === "--json") json = true;
    else if (arg === "--init") init = true;
    else if (arg === "--root") {
      const v = value();
      if (!v) {
        process.stderr.write(`--root takes a folder\n${USAGE}`);
        return 2;
      }
      root = resolve(v);
    } else if (arg === "--source") {
      const v = value();
      if (!v) {
        process.stderr.write(`--source takes a path or an https URL\n${USAGE}`);
        return 2;
      }
      extraSources.push(v);
    } else if (arg === "--timeout") {
      const n = Number(value());
      if (!Number.isFinite(n) || n <= 0) {
        process.stderr.write(`--timeout takes a positive number of milliseconds\n${USAGE}`);
        return 2;
      }
      timeoutMs = n;
    } else {
      process.stderr.write(`unknown argument ${arg}\n${USAGE}`);
      return 2;
    }
  }

  let report;
  try {
    report = await runWatch({ root, init, ...(timeoutMs !== undefined ? { timeoutMs } : {}) }, { extraSources });
  } catch (error) {
    process.stderr.write(`watch failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    return 2;
  }
  if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else if (report.findings.length === 0) process.stdout.write("watch: no drift\n");
  else {
    for (const f of report.findings) process.stdout.write(`${f.severity.padEnd(5)} ${f.kind} ${f.ref}: ${f.summary}\n`);
  }
  return report.findings.some((f) => f.severity === "warn" || f.severity === "block") ? 1 : 0;
}
