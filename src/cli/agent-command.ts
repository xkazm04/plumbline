// WP0 stub with the final export names; the work package that owns this command replaces the body.

import { CliError } from "./args.js";
import type { Out } from "./commands.js";

export const AGENT_USAGE = "usage: plumbline agent <init|check|relock> [options]";

export async function runAgentCommand(argv: string[], out: Out): Promise<number> {
  void argv;
  void out;
  throw new CliError("this command is not built yet");
}
