// plumbline gate <target> [--adapters validator,atlas,customs] [--fail-on fail|unavailable] [--timeout <ms>] [--trust <file>] [--allow-local] [--json]
// Exit 0: the gate passed by --fail-on (with --fail-on fail, `unavailable` on SOME adapters alone does not fail it).
// 1: the gate failed by --fail-on, or NOTHING was checked (every adapter `unavailable`, whatever --fail-on says).
// 2: usage error, including a target that is not an http(s) URL (refused before any adapter runs), and a trust file
// that cannot be read.
// --trust <file> (UAT-10): the site's signature is checked too, by `plumbline verify --url` itself, and the report
// carries the verdict as `signature`. It never changes the state or the exit code. Without it the output says the
// signature was not checked.

import { gateSentence, runGate, ALL_ADAPTERS, type GateOptions } from "../gate/index.js";
import { safeFetch } from "../net/safe-fetch.js";
import { siteBase } from "../watch/published.js";
import { ArgsError, CliError, parseArgs } from "./args.js";
import { verify } from "./commands.js";
import { readTrustFile } from "./files.js";
import type { GateReport, VerifyResult } from "../core/types.js";

const USAGE =
  "usage: plumbline gate <target> [--adapters validator,atlas,customs] [--fail-on fail|unavailable] [--timeout <ms>] [--trust <plumbline.trust.json>] [--allow-local] [--json]\n";

/** The line a report with no signature verdict carries: the gate does not check signatures unless asked (PRI-L1-14). */
export const SIGNATURE_NOT_CHECKED =
  "not checked: the gate checks the site's signature only with --trust <your trust file> (plumbline verify checks it too)";

/** The line for a signature verdict: its verdict (an invalid one with its reason), then verify's own sentence. */
export function signatureLine(signature: VerifyResult | undefined): string {
  if (signature === undefined) return SIGNATURE_NOT_CHECKED;
  const verdict = signature.verdict === "invalid" && signature.reason !== undefined ? `invalid ${signature.reason}` : signature.verdict;
  return signature.detail !== undefined ? `${verdict}: ${signature.detail}` : verdict;
}

/**
 * The site's signature, checked by `plumbline verify --url` itself (one verifier, one set of verdicts and sentences),
 * against the trust file, at the site base the target names. As verify does, a revocation the site publishes and that
 * verifies under a trusted key is recorded in the trust file. A signature that cannot be fetched is `unverifiable`
 * with the reason: the gate never reads "could not check" as a verdict about the files.
 */
export async function checkSignature(target: string, trustFile: string, allowLocal: boolean): Promise<VerifyResult> {
  const base = await siteBase(target, safeFetch, allowLocal ? { allowLocal: true } : {});
  const lines: string[] = [];
  try {
    await verify(["--url", base, "--trust", trustFile, "--json", ...(allowLocal ? ["--allow-local"] : [])], (line) => lines.push(line), { quiet: true });
  } catch (error) {
    if (error instanceof CliError) return { verdict: "unverifiable", detail: `The signature could not be checked (${error.message}), so this says nothing about it.` };
    throw error;
  }
  const result = (JSON.parse(lines[lines.length - 1] ?? "{}") as { results?: VerifyResult[] }).results?.[0];
  if (result === undefined) return { verdict: "unverifiable", detail: "The signature could not be checked, so this says nothing about it." };
  return result;
}

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
    args = parseArgs(argv, ["adapters", "fail-on", "timeout", "trust"], ["allow-local"], { positionals: 1 });
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
  // A trust file that cannot be used is a configuration error, said before anything is fetched.
  const trustFile = args.values.get("trust");
  if (trustFile !== undefined) {
    try {
      await readTrustFile(trustFile);
    } catch (error) {
      if (error instanceof CliError) return refuse(`--trust: ${error.message}`);
      throw error;
    }
  }

  if (allowLocal) process.stderr.write(`${ALLOW_LOCAL_WARNING}\n`);
  const gated = await runGate(
    { target, ...(adapters ? { adapters } : {}), ...(timeoutMs !== undefined ? { timeoutMs } : {}) },
    allowLocal ? { fetchOptions: { allowLocal: true } } : {},
  );
  const report: GateReport = trustFile !== undefined ? { ...gated, signature: await checkSignature(target, trustFile, allowLocal) } : gated;
  if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    // UAT-9: the headline says what was checked, so partly checked never reads as nothing checked
    process.stdout.write(`gate ${report.state}: ${report.target} - ${gateSentence(report)}\n`);
    for (const f of report.findings) process.stdout.write(`  ${f.state.padEnd(11)} ${f.adapter}: ${f.summary}\n`);
    // UAT-10 (PRI-L1-14): the signature's verdict, or that the gate did not check it, at the point of use
    process.stdout.write(`  signature: ${signatureLine(report.signature)}\n`);
  }
  // On stderr, so --json output stays one JSON document.
  if (nothingChecked(report)) process.stderr.write(`plumbline gate: ${NOTHING_CHECKED}\n`);
  return gateExitCode(report, failOn);
}
