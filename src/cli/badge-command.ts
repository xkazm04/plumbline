// plumbline badge --report <gate report .json> [--out <file.svg>]
// A small static SVG of one gate report (`plumbline gate --json`): what the gate checked, what it says about the
// site's signature, and the day the gate ran (src/scan/badge.ts). A report whose findings are all `unavailable` is drawn
// as "not checked" (or "unreachable" when the site itself did not answer) whatever its state says, by the gate's own
// rule (gate-command.ts nothingChecked). UAT-10: the date is the report's `checkedAt`, never the day the badge is drawn,
// so `--now` is refused, and a report with no `checkedAt` (written before the gate recorded one) is refused too. The
// badge is green only for a full pass with a signature verified by `gate --trust`; without `--trust` it says
// "signature not checked".
// Exit 0 when the badge was written, 2 for a usage or I/O error (including a file that is not a gate report).

import { readFile, writeFile } from "node:fs/promises";
import { GATE_STATES, INVALID_REASONS, VERDICTS, type GateReport, type GateState } from "../core/types.js";
import { isIsoUtc } from "../core/verify.js";
import { siteUnreachable } from "../gate/context.js";
import { badgeColour, badgeSvg, badgeWords, type BadgeFacts, type BadgeGate, type BadgeSignature } from "../scan/badge.js";
import { CliError, UsageError, parseArgs, required } from "./args.js";
import { nothingChecked } from "./gate-command.js";
import type { Out } from "./commands.js";

export const BADGE_USAGE = "usage: plumbline badge --report <gate report .json> [--out <file.svg>]";

const NOT_A_REPORT = "--report must be a gate report written by plumbline gate --json (state and findings, each pass, fail or unavailable)";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The state a gate report's badge shows, or null when the value is not a gate report. */
export function badgeStateOf(value: unknown): GateState | null {
  if (!isObject(value) || typeof value.state !== "string" || !Array.isArray(value.findings)) return null;
  if (!(GATE_STATES as readonly string[]).includes(value.state)) return null;
  if (!value.findings.every((f) => isObject(f) && typeof f.state === "string" && (GATE_STATES as readonly string[]).includes(f.state))) return null;
  // nothing checked is never drawn as a pass, whatever the report's own state says
  return nothingChecked(value as unknown as GateReport) ? "unavailable" : (value.state as GateState);
}

/** The gate part of a badge: `unavailable` split as every surface words it (UAT-9), or null when not a gate report. */
export function badgeGateOf(value: unknown): BadgeGate | null {
  const state = badgeStateOf(value);
  if (state === null) return null;
  if (state !== "unavailable") return state;
  const report = value as GateReport;
  const findings = report.findings.map((f) => ({ ...f, summary: typeof f.summary === "string" ? f.summary : "" }));
  if (siteUnreachable({ findings }) !== null) return "unreachable";
  return nothingChecked(report) ? "not-checked" : "partly-checked";
}

/**
 * The signature part of a badge: the verdict `gate --trust` recorded (an invalid one by its reason), or `not-checked`
 * when the report carries none. Null when the field is there but is not a verdict.
 */
export function badgeSignatureOf(value: unknown): BadgeSignature | null {
  if (!isObject(value)) return null;
  const signature = value.signature;
  if (signature === undefined) return "not-checked";
  if (!isObject(signature) || typeof signature.verdict !== "string" || !(VERDICTS as readonly string[]).includes(signature.verdict)) return null;
  if (signature.verdict !== "invalid") return signature.verdict as "verified" | "unverifiable";
  return typeof signature.reason === "string" && (INVALID_REASONS as readonly string[]).includes(signature.reason) ? (signature.reason as BadgeSignature) : null;
}

/** Everything a badge draws from one report, or the sentence for why the report cannot be drawn. */
export function badgeFactsOf(value: unknown): { facts: BadgeFacts } | { problem: string } {
  const gate = badgeGateOf(value);
  const signature = badgeSignatureOf(value);
  if (gate === null || signature === null) return { problem: NOT_A_REPORT };
  const checkedAt = (value as { checkedAt?: unknown }).checkedAt;
  if (checkedAt === undefined) {
    return { problem: "this gate report does not say when the gate ran (it was written before reports carried checkedAt); run plumbline gate --json again" };
  }
  if (!isIsoUtc(checkedAt)) return { problem: `${NOT_A_REPORT}; its checkedAt is not a UTC ISO timestamp` };
  return { facts: { gate, signature, date: checkedAt.slice(0, 10) } };
}

export async function badge(argv: string[], out: Out): Promise<number> {
  const args = parseArgs(argv, ["report", "out", "now"]);
  // UAT-10 (PRI-L1-08): a badge is dated by the check it shows, so no clock may move its date
  if (args.values.has("now")) throw new UsageError("--now cannot date a badge: its date is when the gate ran, from the report's checkedAt");
  const reportPath = required(args, "report");
  let text: string;
  try {
    text = await readFile(reportPath, "utf8");
  } catch {
    throw new CliError("the gate report could not be read");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw new UsageError("--report must be a gate report written by plumbline gate --json; this file is not JSON");
  }
  const drawn = badgeFactsOf(parsed);
  if ("problem" in drawn) throw new UsageError(drawn.problem);
  const { facts } = drawn;
  const svg = badgeSvg(facts);
  const state = badgeStateOf(parsed) as GateState;
  const words = `${badgeWords(facts)}, ${facts.date}`;
  const target = args.values.get("out");
  if (target === undefined) {
    out(svg.trimEnd());
    return 0;
  }
  try {
    await writeFile(target, svg, "utf8");
  } catch {
    throw new CliError("the badge could not be written");
  }
  if (args.json) out(JSON.stringify({ badge: target, state, gate: facts.gate, signature: facts.signature, date: facts.date, colour: badgeColour(facts) }));
  else out(`badge: wrote ${target} (${words})`);
  return 0;
}
