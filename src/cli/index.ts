#!/usr/bin/env node
// plumbline keygen|sign|verify|rotate|gate|watch|init
// Exit 0 clean, 1 findings, 2 usage or I/O error. WP1 wires the signing commands, WP2 gate and watch.

const COMMANDS = ["keygen", "sign", "verify", "rotate", "gate", "watch", "init"] as const;

function main(argv: string[]): number {
  const command = argv[0];
  if (!command || !(COMMANDS as readonly string[]).includes(command)) {
    process.stderr.write(`usage: plumbline <${COMMANDS.join("|")}> [options]\n`);
    return 2;
  }
  process.stderr.write(`plumbline ${command}: not implemented yet\n`);
  return 2;
}

process.exitCode = main(process.argv.slice(2));
