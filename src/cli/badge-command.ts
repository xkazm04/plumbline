// plumbline badge --report <gate report .json> [--out <file.svg>] [--now <iso>]
// A small static SVG of one gate report (`plumbline gate --json`): the state word and the date. Three states, three
// colours, and the word always written (src/scan/badge.ts). A report whose findings are all `unavailable` is drawn as
// "not checked" whatever its state says, by the gate's own rule (gate-command.ts nothingChecked).
// Exit 0 when the badge was written, 2 for a usage or I/O error (including a file that is not a gate report).

import { readFile, writeFile } from "node:fs/promises";
import { GATE_STATES, type GateReport, type GateState } from "../core/types.js";
import { badgeSvg } from "../scan/badge.js";
import { CliError, UsageError, nowFrom, parseArgs, required } from "./args.js";
import { nothingChecked } from "./gate-command.js";
import type { Out } from "./commands.js";

export const BADGE_USAGE = "usage: plumbline badge --report <gate report .json> [--out <file.svg>] [--now <iso>]";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The state a gate report's badge shows, or null when the value is not a gate report. */
export function badgeStateOf(value: unknown): GateState | null {
  if (!isObject(value) || typeof value.state !== "string" || !Array.isArray(value.findings)) return null;
  if (!(GATE_STATES as readonly string[]).includes(value.state)) return null;
  if (!value.findings.every((f) => isObject(f) && typeof f.state === "string" && (GATE_STATES as readonly string[]).includes(f.state))) return null;
  // nothing checked is never drawn as a pass, whatever the report's own state says
  return nothingChecked(value as unknown as GateReport) ? "unavailable" : (value.state as GateState);
}

export async function badge(argv: string[], out: Out): Promise<number> {
  const args = parseArgs(argv, ["report", "out", "now"]);
  const reportPath = required(args, "report");
  const now = nowFrom(args) ?? new Date();
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
  const state = badgeStateOf(parsed);
  if (state === null) throw new UsageError("--report must be a gate report written by plumbline gate --json (state and findings, each pass, fail or unavailable)");
  const svg = badgeSvg(state, now.toISOString().slice(0, 10));
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
  if (args.json) out(JSON.stringify({ badge: target, state }));
  else out(`badge: wrote ${target} (${state})`);
  return 0;
}
