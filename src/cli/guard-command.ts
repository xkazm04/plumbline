// WP0 stub with the final export names; the work package that owns this command replaces the body.

import { CliError } from "./args.js";
import type { Out } from "./commands.js";

export const GUARD_USAGE = "usage: plumbline guard --lock <file> --server <name> [--require locked|approved] [--approvers <file>] [--strict] [--pending <dir>] -- <command> [args...]";

export async function runGuardCommand(argv: string[], out: Out): Promise<number> {
  void argv;
  void out;
  throw new CliError("this command is not built yet");
}
