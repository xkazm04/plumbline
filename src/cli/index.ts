#!/usr/bin/env node
// plumbline keygen|sign|verify|rotate|revoke|gate|watch|init
// Exit 0 clean, 1 findings, 2 usage or I/O error. Signing commands in commands.ts; gate and watch in their own command modules; init is not built yet.

import { CliError } from "./args.js";
import { keygen, revoke, rotate, sign, verify, type Out } from "./commands.js";
import { runGateCommand } from "./gate-command.js";
import { runWatchCommand } from "./watch-command.js";

const COMMANDS = ["keygen", "sign", "verify", "rotate", "revoke", "gate", "watch", "init"] as const;

const SIGNING: Record<string, (argv: string[], out: Out) => Promise<number>> = {
  keygen,
  sign,
  verify,
  rotate,
  revoke,
  gate: (argv) => runGateCommand(argv),
  watch: (argv) => runWatchCommand(argv),
};

async function main(argv: string[]): Promise<number> {
  const command = argv[0];
  if (!command || !(COMMANDS as readonly string[]).includes(command)) {
    process.stderr.write(`usage: plumbline <${COMMANDS.join("|")}> [options]\n`);
    return 2;
  }
  const handler = SIGNING[command];
  if (!handler) {
    process.stderr.write(`plumbline ${command}: not implemented yet\n`);
    return 2;
  }
  const rest = argv.slice(1);
  try {
    return await handler(rest, (line) => process.stdout.write(line + "\n"));
  } catch (error) {
    // every failure is a usage or I/O problem for the caller: exit 2, never a crash code
    const message = error instanceof CliError ? error.message : `unexpected failure: ${(error as Error).message}`;
    if (rest.includes("--json")) process.stdout.write(JSON.stringify({ error: message }) + "\n");
    process.stderr.write(`plumbline ${command}: ${message}\n`);
    return 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
