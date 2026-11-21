// WP0 stub with the final export names; the work package that owns this command replaces the body.

import { CliError } from "./args.js";
import type { Out } from "./commands.js";

export const APPROVE_USAGE = "usage: plumbline approve (--key <file> | --key-env <NAME>) [--root <dir>] [--json]";

export async function approve(argv: string[], out: Out): Promise<number> {
  void argv;
  void out;
  throw new CliError("this command is not built yet");
}
