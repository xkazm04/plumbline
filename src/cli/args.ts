// A tiny flag parser: `--name value` pairs, the boolean `--json` and the boolean flags a command names. Anything else
// is a usage error (exit 2, and the command's own usage line is printed).

/** A failure the caller can do nothing about but read: a usage or I/O problem. Exit 2. */
export class CliError extends Error {}

/** The caller gave the command wrong options: exit 2, and the command's usage line is printed after the message. */
export class UsageError extends CliError {}

export interface ParsedArgs {
  values: Map<string, string>;
  /** The boolean flags given (never `json`, which has its own field). */
  flags: Set<string>;
  json: boolean;
}

export function parseArgs(argv: string[], allowed: readonly string[], booleans: readonly string[] = []): ParsedArgs {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg.startsWith("--") && booleans.includes(arg.slice(2))) {
      flags.add(arg.slice(2));
      continue;
    }
    if (!arg.startsWith("--") || !allowed.includes(arg.slice(2))) throw new UsageError(`unknown option: ${arg}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new UsageError(`${arg} needs a value`);
    values.set(arg.slice(2), value);
    i++;
  }
  return { values, flags, json };
}

export function required(args: ParsedArgs, name: string): string {
  const value = args.values.get(name);
  if (value === undefined) throw new UsageError(`missing --${name}`);
  return value;
}

/** `--now <ISO timestamp>` pins the clock, for tests and reproducible runs. */
export function nowFrom(args: ParsedArgs): Date | undefined {
  const raw = args.values.get("now");
  if (raw === undefined) return undefined;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) throw new UsageError("--now must be an ISO timestamp");
  return new Date(ms);
}
