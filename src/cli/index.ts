#!/usr/bin/env node
// plumbline init|watch|gate|keygen|sign|verify|rotate|revoke|trust|adopt
// Exit 0 clean, 1 findings, 2 usage or I/O error. Signing commands in commands.ts; the verifier's trust-store commands
// in trust-command.ts; gate and watch in their own command modules.

import { CliError, UsageError } from "./args.js";
import { USAGE, keygen, revoke, rotate, sign, verify, type Out } from "./commands.js";
import { runGateCommand } from "./gate-command.js";
import { runInitCommand } from "./init-command.js";
import { adopt, trust } from "./trust-command.js";
import { runWatchCommand } from "./watch-command.js";

// The watch comes first: a publisher gets value with no key (init, watch); signing is the upgrade.
const HANDLERS: Record<string, (argv: string[], out: Out) => Promise<number>> = {
  init: (argv) => runInitCommand(argv),
  watch: (argv) => runWatchCommand(argv),
  gate: (argv) => runGateCommand(argv),
  keygen,
  sign,
  verify,
  rotate,
  revoke,
  trust,
  adopt,
};

const COMMANDS = Object.keys(HANDLERS);

async function main(argv: string[]): Promise<number> {
  const command = argv[0];
  // own keys only: `plumbline toString` is an unknown command, not Object.prototype's
  const handler = command !== undefined && Object.hasOwn(HANDLERS, command) ? HANDLERS[command] : undefined;
  if (command === undefined || !handler) {
    if (command !== undefined) process.stderr.write(`plumbline: unknown command: ${command}\n`);
    process.stderr.write(`usage: plumbline <${COMMANDS.join("|")}> [options]\n`);
    return 2;
  }
  const rest = argv.slice(1);
  try {
    return await handler(rest, (line) => process.stdout.write(line + "\n"));
  } catch (error) {
    // every failure is a usage or I/O problem for the caller: exit 2, never a crash code
    const message = error instanceof CliError ? error.message : `unexpected failure: ${(error as Error).message}`;
    // a usage error shows the command's own options, so the caller sees what it takes
    const usage = error instanceof UsageError ? (USAGE as Record<string, string>)[command] : undefined;
    if (rest.includes("--json")) process.stdout.write(JSON.stringify({ error: message, ...(usage ? { usage } : {}) }) + "\n");
    process.stderr.write(`plumbline ${command}: ${message}\n`);
    if (usage) process.stderr.write(`${usage}\n`);
    return 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
