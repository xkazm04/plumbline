// WP0 stub with the final export names; the work package that owns this command replaces the body.

import { CliError } from "./args.js";
import type { Out } from "./commands.js";

export const AUDIT_USAGE = "usage: plumbline audit [--root <dir>] [--approvers <file>] [--out <dir>] [--json]";

export async function audit(argv: string[], out: Out): Promise<number> {
  void argv;
  void out;
  throw new CliError("this command is not built yet");
}
