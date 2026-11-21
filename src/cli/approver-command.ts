// WP0 stub with the final export names; the work package that owns this command replaces the body.

import { CliError } from "./args.js";
import type { Out } from "./commands.js";

export const APPROVER_USAGE = "usage: plumbline approver add --key <key record> --label <name> [--file <approvers file>]";

export async function approver(argv: string[], out: Out): Promise<number> {
  void argv;
  void out;
  throw new CliError("this command is not built yet");
}
