// plumbline watch [--root <dir>] [--init | --relock [--drop <ref>]...] [--source <ref>]... [--timeout <ms>] [--json]
// plumbline watch --url <site> [--allow-local] [--timeout <ms>] [--json]
// Dry-run: it reports, and with --init (and no lock yet) writes plumbline.lock.json, nothing else. --relock rewrites the
// lock from the current state after a person reviewed the drift, prints what changed and reminds that the lock is a
// signed file. --drop (with --relock only, repeatable) leaves a grounding ref out of the new lock; it is listed as
// removed. --url reads a site's PUBLISHED lock through safeFetch and re-checks it as the Desk does
// (src/watch/published.ts, the code the Desk runs); what needs the checkout (added runtime files, coverage, upstream) is
// said, in an info finding, not to be checked.
// Exit 0: no finding of severity warn or block (info alone is clean), or --relock wrote the lock. 1: at least one warn
// or block, or no lock could be used (absent, unreadable or unusable: nothing was checked, which is never clean).
// 2: usage or I/O error.

import { resolve } from "node:path";
import { RESIGN_REMINDER, type WatchReport } from "../watch/decide.js";
import { runRelock, runWatch, runWatchUrl } from "../watch/index.js";
import { ArgsError, parseArgs, repeated } from "./args.js";
import { ALLOW_LOCAL_WARNING, isHttpUrl } from "./gate-command.js";

const USAGE =
  "usage: plumbline watch [--root <dir>] [--init | --relock [--drop <ref>]...] [--source <path-or-https-url>]... [--timeout <ms>] [--json]\n" +
  "       plumbline watch --url <https site address> [--allow-local] [--timeout <ms>] [--json]\n";

/** The refusal for a missing or empty value of each value-taking flag (for --timeout, also a bad one). */
const BAD_VALUE = {
  root: "--root takes a folder",
  source: "--source takes a path or an https URL",
  drop: "--drop takes a grounding ref the lock holds",
  timeout: "--timeout takes a positive number of milliseconds",
  url: "--url takes an http(s) site address, such as https://site.example/",
} as const;

/** The watch's own sentence for each refusal of the shared parser. It takes no positionals, so none is `extra`. */
function usageSentence(error: ArgsError): string {
  if (error.reason !== "missing") return `unknown argument ${error.arg}`;
  return Object.hasOwn(BAD_VALUE, error.arg) ? BAD_VALUE[error.arg as keyof typeof BAD_VALUE] : error.message;
}

function refuse(sentence: string): 2 {
  process.stderr.write(`${sentence}\n${USAGE}`);
  return 2;
}

export async function runWatchCommand(argv: string[]): Promise<number> {
  let args;
  try {
    args = parseArgs(argv, ["root", "timeout", "url"], ["init", "relock", "allow-local"], { repeatable: ["source", "drop"] });
  } catch (error) {
    if (error instanceof ArgsError) return refuse(usageSentence(error));
    throw error;
  }
  const { json } = args;
  const init = args.flags.has("init");
  const relock = args.flags.has("relock");
  const extraSources = repeated(args, "source");
  const dropSources = repeated(args, "drop");

  const rootValue = args.values.get("root");
  if (rootValue === "") return refuse(BAD_VALUE.root);
  const root = rootValue === undefined ? process.cwd() : resolve(rootValue);
  if (extraSources.includes("")) return refuse(BAD_VALUE.source);
  if (dropSources.includes("")) return refuse(BAD_VALUE.drop);

  let timeoutMs: number | undefined;
  const timeoutValue = args.values.get("timeout");
  if (timeoutValue !== undefined) {
    const n = Number(timeoutValue);
    if (!Number.isFinite(n) || n <= 0) return refuse(BAD_VALUE.timeout);
    timeoutMs = n;
  }

  const url = args.values.get("url");
  const allowLocal = args.flags.has("allow-local");
  if (url !== undefined) {
    if (rootValue !== undefined || init || relock || extraSources.length > 0 || dropSources.length > 0) {
      return refuse("--url reads a published site; --root, --init, --relock, --source and --drop work on a checkout");
    }
    if (!isHttpUrl(url)) return refuse(BAD_VALUE.url);
    if (allowLocal) process.stderr.write(`${ALLOW_LOCAL_WARNING}\n`);
    let report;
    try {
      report = await runWatchUrl({ url, ...(timeoutMs !== undefined ? { timeoutMs } : {}), ...(allowLocal ? { allowLocal } : {}) });
    } catch (error) {
      process.stderr.write(`watch failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
      return 2;
    }
    return printReport(report, json);
  }
  if (allowLocal) return refuse("--allow-local goes with --url: a checkout is read from disk");

  if (init && relock) return refuse("--init and --relock do not go together: --init writes a first lock, --relock replaces one");
  if (dropSources.length > 0 && !relock) return refuse("--drop goes with --relock: it takes a ref out of the lock --relock writes");
  if (dropSources.some((ref) => extraSources.includes(ref))) return refuse("--source and --drop name the same ref");
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
  return printReport(report, json);
}

/** Prints a watch report and returns its exit code: 1 for a lock that was not found or any warn or block, else 0. */
function printReport(report: WatchReport, json: boolean): 0 | 1 {
  const noLock = report.lockState !== undefined && report.lockState !== "found";
  if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    if (noLock) process.stdout.write(`lock  ${report.lockState}: ${report.lockSummary ?? ""}\n`);
    else if (report.findings.length === 0) process.stdout.write("watch: no drift\n");
    for (const f of report.findings) process.stdout.write(`${f.severity.padEnd(5)} ${f.kind} ${f.ref}: ${f.summary}\n`);
  }
  return noLock || report.findings.some((f) => f.severity === "warn" || f.severity === "block") ? 1 : 0;
}
