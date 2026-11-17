// plumbline gate <target> [--adapters validator,atlas,customs] [--fail-on fail|unavailable] [--timeout <ms>] [--json]
// Exit 0: the gate passed (or, with --fail-on fail, only `unavailable` was seen). 1: the gate failed by --fail-on.
// 2: usage error. The Director wires runGateCommand into src/cli/index.ts.

import { runGate, ALL_ADAPTERS, type GateOptions } from "../gate/index.js";

const USAGE = "usage: plumbline gate <target> [--adapters validator,atlas,customs] [--fail-on fail|unavailable] [--timeout <ms>] [--json]\n";

export async function runGateCommand(args: string[]): Promise<number> {
  let target: string | undefined;
  let adapters: GateOptions["adapters"];
  let failOn: "fail" | "unavailable" = "fail";
  let timeoutMs: number | undefined;
  let json = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    const value = (): string | undefined => args[++i];
    if (arg === "--json") json = true;
    else if (arg === "--adapters") {
      const list = (value() ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const known = list.filter((a): a is (typeof ALL_ADAPTERS)[number] => (ALL_ADAPTERS as readonly string[]).includes(a));
      if (list.length === 0 || known.length !== list.length) {
        process.stderr.write(`unknown adapter in --adapters (known: ${ALL_ADAPTERS.join(", ")})\n${USAGE}`);
        return 2;
      }
      adapters = known;
    } else if (arg === "--fail-on") {
      const v = value();
      if (v !== "fail" && v !== "unavailable") {
        process.stderr.write(`--fail-on takes fail or unavailable\n${USAGE}`);
        return 2;
      }
      failOn = v;
    } else if (arg === "--timeout") {
      const n = Number(value());
      if (!Number.isFinite(n) || n <= 0) {
        process.stderr.write(`--timeout takes a positive number of milliseconds\n${USAGE}`);
        return 2;
      }
      timeoutMs = n;
    } else if (arg.startsWith("--")) {
      process.stderr.write(`unknown option ${arg}\n${USAGE}`);
      return 2;
    } else if (target === undefined) target = arg;
    else {
      process.stderr.write(`unexpected argument\n${USAGE}`);
      return 2;
    }
  }
  if (target === undefined || target === "") {
    process.stderr.write(USAGE);
    return 2;
  }

  const report = await runGate({ target, ...(adapters ? { adapters } : {}), ...(timeoutMs !== undefined ? { timeoutMs } : {}) });
  if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    process.stdout.write(`gate ${report.state}: ${report.target}\n`);
    for (const f of report.findings) process.stdout.write(`  ${f.state.padEnd(11)} ${f.adapter}: ${f.summary}\n`);
  }
  const failed = report.state === "fail" || (failOn === "unavailable" && report.state === "unavailable");
  return failed ? 1 : 0;
}
