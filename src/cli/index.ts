#!/usr/bin/env node
// plumbline agent|approve|audit|approver|guard|init|watch|diff|gate|scan|badge|keygen|sign|verify|rotate|revoke|trust|adopt|dns|export-jws
// Exit 0 clean, 1 findings, 2 usage or I/O error. Signing commands in commands.ts; the verifier's trust-store commands
// in trust-command.ts; gate, watch and scan in their own command modules; the help, grouped by role, in help.ts.

import { runAgentCommand } from "./agent-command.js";
import { approve } from "./approve-command.js";
import { approver } from "./approver-command.js";
import { CliError, UsageError } from "./args.js";
import { audit } from "./audit-command.js";
import { runGuardCommand } from "./guard-command.js";
import { badge } from "./badge-command.js";
import { diff } from "./diff-command.js";
import { exportJws, keygen, revoke, rotate, sign, verify, type Out } from "./commands.js";
import { runGateCommand } from "./gate-command.js";
import { COMMANDS, COMMAND_HELP, commandHelp, topHelp } from "./help.js";
import { runInitCommand } from "./init-command.js";
import { runScanCommand } from "./scan-command.js";
import { adopt, dnsRecord, trust } from "./trust-command.js";
import { runWatchCommand } from "./watch-command.js";

// The watch comes first: a publisher gets value with no key (init, watch); signing is the upgrade. help.ts lists the
// same commands, in the same order, under their roles.
const HANDLERS: Record<string, (argv: string[], out: Out) => Promise<number>> = {
  agent: runAgentCommand,
  approve,
  audit,
  approver,
  guard: runGuardCommand,
  init: (argv) => runInitCommand(argv),
  watch: (argv) => runWatchCommand(argv),
  diff,
  keygen,
  sign,
  rotate,
  revoke,
  dns: dnsRecord,
  "export-jws": exportJws,
  trust,
  verify,
  adopt,
  gate: (argv) => runGateCommand(argv),
  scan: (argv) => runScanCommand(argv),
  badge,
};

const HELP_FLAGS = new Set(["--help", "-h"]);

async function main(argv: string[]): Promise<number> {
  const command = argv[0];
  // UAT-28: `plumbline --help`, `plumbline -h`, `plumbline help` and `plumbline help <command>` answer on stdout, exit 0
  if (command !== undefined && (HELP_FLAGS.has(command) || command === "help")) {
    const about = argv[1];
    if (command === "help" && about !== undefined) {
      const text = commandHelp(about);
      if (text === undefined) {
        process.stderr.write(`plumbline: unknown command: ${about}\n${topHelp()}`);
        return 2;
      }
      process.stdout.write(text);
      return 0;
    }
    process.stdout.write(topHelp());
    return 0;
  }
  // own keys only: `plumbline toString` is an unknown command, not Object.prototype's
  const handler = command !== undefined && Object.hasOwn(HANDLERS, command) ? HANDLERS[command] : undefined;
  if (command === undefined || !handler) {
    if (command !== undefined) process.stderr.write(`plumbline: unknown command: ${command}\n`);
    process.stderr.write(`usage: plumbline <${COMMANDS.join("|")}> [options]\nplumbline --help lists the commands by role, with one line on what each does.\n`);
    return 2;
  }
  const rest = argv.slice(1);
  // Only the options before `--` are Plumbline's: after it come another program's arguments (`plumbline guard ... --
  // <server> -h` runs the server with -h). A --help or --json there is never read here.
  const end = rest.indexOf("--");
  const own = end === -1 ? rest : rest.slice(0, end);
  // `plumbline <command> --help` (or -h) is that command's help, never an unknown option
  if (own.some((a) => HELP_FLAGS.has(a))) {
    process.stdout.write(commandHelp(command) ?? topHelp());
    return 0;
  }
  try {
    return await handler(rest, (line) => process.stdout.write(line + "\n"));
  } catch (error) {
    // every failure is a usage or I/O problem for the caller: exit 2, never a crash code
    const message = error instanceof CliError ? error.message : `unexpected failure: ${(error as Error).message}`;
    // a usage error shows the command's own options, so the caller sees what it takes
    const usage = error instanceof UsageError && Object.hasOwn(COMMAND_HELP, command) ? COMMAND_HELP[command]?.usage.replace(/\n+$/, "") : undefined;
    // the guard's stdout is the MCP channel to the host: it never carries anything but relayed protocol messages
    if (own.includes("--json") && command !== "guard") process.stdout.write(JSON.stringify({ error: message, ...(usage ? { usage } : {}) }) + "\n");
    process.stderr.write(`plumbline ${command}: ${message}\n`);
    if (usage) process.stderr.write(`${usage}\n`);
    return 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
