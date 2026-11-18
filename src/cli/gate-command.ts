// plumbline gate <target> [--adapters validator,atlas,customs] [--fail-on fail|unavailable] [--timeout <ms>] [--allow-local] [--json]
// Exit 0: the gate passed by --fail-on (with --fail-on fail, `unavailable` on SOME adapters alone does not fail it).
// 1: the gate failed by --fail-on, or NOTHING was checked (every adapter `unavailable`, whatever --fail-on says).
// 2: usage error, including a target that is not an http(s) URL (refused before any adapter runs).

import { runGate, ALL_ADAPTERS, type GateOptions } from "../gate/index.js";
import { ArgsError, parseArgs } from "./args.js";
import type { GateReport } from "../core/types.js";

const USAGE =
  "usage: plumbline gate <target> [--adapters validator,atlas,customs] [--fail-on fail|unavailable] [--timeout <ms>] [--allow-local] [--json]\n";

export const NOTHING_CHECKED = "nothing was checked: every adapter was unavailable, so this is not a pass";

export const ALLOW_LOCAL_WARNING =
  "WARNING: --allow-local: http and loopback addresses are allowed for this run (private ranges stay refused); use it only for a site on this machine";

/** True for an absolute http: or https: URL with a host: the only gate target an adapter can check. */
export function isHttpUrl(target: string): boolean {
  try {
    const url = new URL(target);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname !== "";
  } catch {
    return false;
  }
}

/** True when no adapter produced a verdict: every finding is `unavailable` (or there are none). */
export function nothingChecked(report: GateReport): boolean {
  return report.findings.every((f) => f.state === "unavailable");
}

/**
 * The exit code for a report. A gate that checked nothing exits 1 whatever --fail-on says: `unavailable` is never
 * `pass`, and with --fail-on fail an all-unavailable run would otherwise go green having looked at nothing.
 */
export function gateExitCode(report: GateReport, failOn: "fail" | "unavailable"): 0 | 1 {
  if (nothingChecked(report)) return 1;
  const failed = report.state === "fail" || (failOn === "unavailable" && report.state === "unavailable");
  return failed ? 1 : 0;
}

/** The refusal for a bad value of each value-taking flag; a flag given with no value is refused with the same one. */
const BAD_VALUE = {
  adapters: `unknown adapter in --adapters (known: ${ALL_ADAPTERS.join(", ")})`,
  "fail-on": "--fail-on takes fail or unavailable",
  timeout: "--timeout takes a positive number of milliseconds",
} as const;

/** The gate's own sentence for each refusal of the shared parser. */
function usageSentence(error: ArgsError): string {
  if (error.reason === "extra") return "unexpected argument";
  if (error.reason === "unknown") return `unknown option ${error.arg}`;
  return Object.hasOwn(BAD_VALUE, error.arg) ? BAD_VALUE[error.arg as keyof typeof BAD_VALUE] : error.message;
}

function refuse(sentence: string): 2 {
  process.stderr.write(`${sentence}\n${USAGE}`);
  return 2;
}

export async function runGateCommand(argv: string[]): Promise<number> {
  let args;
  try {
    args = parseArgs(argv, ["adapters", "fail-on", "timeout"], ["allow-local"], { positionals: 1 });
  } catch (error) {
    if (error instanceof ArgsError) return refuse(usageSentence(error));
    throw error;
  }
  const json = args.json;
  const allowLocal = args.flags.has("allow-local");

  let adapters: GateOptions["adapters"];
  const adapterList = args.values.get("adapters");
  if (adapterList !== undefined) {
    const list = adapterList.split(",").map((s) => s.trim()).filter(Boolean);
    const known = list.filter((a): a is (typeof ALL_ADAPTERS)[number] => (ALL_ADAPTERS as readonly string[]).includes(a));
    if (list.length === 0 || known.length !== list.length) return refuse(BAD_VALUE.adapters);
    adapters = known;
  }

  let failOn: "fail" | "unavailable" = "fail";
  const failOnValue = args.values.get("fail-on");
  if (failOnValue !== undefined) {
    if (failOnValue !== "fail" && failOnValue !== "unavailable") return refuse(BAD_VALUE["fail-on"]);
    failOn = failOnValue;
  }

  let timeoutMs: number | undefined;
  const timeoutValue = args.values.get("timeout");
  if (timeoutValue !== undefined) {
    const n = Number(timeoutValue);
    if (!Number.isFinite(n) || n <= 0) return refuse(BAD_VALUE.timeout);
    timeoutMs = n;
  }

  const target = args.positionals[0];
  if (target === undefined || target === "") {
    process.stderr.write(USAGE);
    return 2;
  }
  // Before any adapter runs: a target that is not an http(s) URL would make every adapter unavailable and be sent to
  // Agent Atlas as written. It is a configuration error, so it exits 2 like one.
  if (!isHttpUrl(target)) return refuse("the target must be an http(s) URL, such as https://site.example/");

  if (allowLocal) process.stderr.write(`${ALLOW_LOCAL_WARNING}\n`);
  const report = await runGate(
    { target, ...(adapters ? { adapters } : {}), ...(timeoutMs !== undefined ? { timeoutMs } : {}) },
    allowLocal ? { fetchOptions: { allowLocal: true } } : {},
  );
  if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    process.stdout.write(`gate ${report.state}: ${report.target}\n`);
    for (const f of report.findings) process.stdout.write(`  ${f.state.padEnd(11)} ${f.adapter}: ${f.summary}\n`);
  }
  // On stderr, so --json output stays one JSON document.
  if (nothingChecked(report)) process.stderr.write(`plumbline gate: ${NOTHING_CHECKED}\n`);
  return gateExitCode(report, failOn);
}
