// plumbline watch [--root <dir>] [--init | --relock [--drop <ref>]...] [--source <ref>]... [--timeout <ms>] [--json]
// Dry-run: it reports, and with --init (and no lock yet) writes plumbline.lock.json, nothing else. --relock rewrites the
// lock from the current state after a person reviewed the drift, prints what changed and reminds that the lock is a
// signed file. --drop (with --relock only, repeatable) leaves a grounding ref out of the new lock; it is listed as
// removed.
// Exit 0: no finding of severity warn or block (info alone is clean), or --relock wrote the lock. 1: at least one warn
// or block, or no lock could be used (absent, unreadable or unusable: nothing was checked, which is never clean).
// 2: usage or I/O error.
// The Director wires runWatchCommand into src/cli/index.ts.

import { resolve } from "node:path";
import { RESIGN_REMINDER } from "../watch/decide.js";
import { runRelock, runWatch } from "../watch/index.js";

const USAGE =
  "usage: plumbline watch [--root <dir>] [--init | --relock [--drop <ref>]...] [--source <path-or-https-url>]... [--timeout <ms>] [--json]\n";

export async function runWatchCommand(args: string[]): Promise<number> {
  let root = process.cwd();
  let init = false;
  let relock = false;
  let json = false;
  let timeoutMs: number | undefined;
  const extraSources: string[] = [];
  const dropSources: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    const value = (): string | undefined => args[++i];
    if (arg === "--json") json = true;
    else if (arg === "--init") init = true;
    else if (arg === "--relock") relock = true;
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
    } else if (arg === "--drop") {
      const v = value();
      if (!v) {
        process.stderr.write(`--drop takes a grounding ref the lock holds\n${USAGE}`);
        return 2;
      }
      dropSources.push(v);
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
  if (init && relock) {
    process.stderr.write(`--init and --relock do not go together: --init writes a first lock, --relock replaces one\n${USAGE}`);
    return 2;
  }
  if (dropSources.length > 0 && !relock) {
    process.stderr.write(`--drop goes with --relock: it takes a ref out of the lock --relock writes\n${USAGE}`);
    return 2;
  }
  if (dropSources.some((ref) => extraSources.includes(ref))) {
    process.stderr.write(`--source and --drop name the same ref\n${USAGE}`);
    return 2;
  }
  const options = { root, init, ...(timeoutMs !== undefined ? { timeoutMs } : {}) };

  if (relock) {
    let result;
    try {
      result = await runRelock(options, { extraSources, dropSources });
    } catch (error) {
      process.stderr.write(`watch failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
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
    report = await runWatch(options, { extraSources });
  } catch (error) {
    process.stderr.write(`watch failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    return 2;
  }
  const noLock = report.lockState !== undefined && report.lockState !== "found";
  if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    if (noLock) process.stdout.write(`lock  ${report.lockState}: ${report.lockSummary ?? ""}\n`);
    else if (report.findings.length === 0) process.stdout.write("watch: no drift\n");
    for (const f of report.findings) process.stdout.write(`${f.severity.padEnd(5)} ${f.kind} ${f.ref}: ${f.summary}\n`);
  }
  return noLock || report.findings.some((f) => f.severity === "warn" || f.severity === "block") ? 1 : 0;
}
