// A tiny flag parser: `--name value` pairs and the boolean `--json`. Anything else is a usage error (exit 2).

export class CliError extends Error {}

export interface ParsedArgs {
  values: Map<string, string>;
  json: boolean;
}

export function parseArgs(argv: string[], allowed: readonly string[]): ParsedArgs {
  const values = new Map<string, string>();
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (!arg.startsWith("--") || !allowed.includes(arg.slice(2))) throw new CliError(`unknown option: ${arg}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new CliError(`${arg} needs a value`);
    values.set(arg.slice(2), value);
    i++;
  }
  return { values, json };
}

export function required(args: ParsedArgs, name: string): string {
  const value = args.values.get(name);
  if (value === undefined) throw new CliError(`missing --${name}`);
  return value;
}

/** `--now <ISO timestamp>` pins the clock, for tests and reproducible runs. */
export function nowFrom(args: ParsedArgs): Date | undefined {
  const raw = args.values.get("now");
  if (raw === undefined) return undefined;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) throw new CliError("--now must be an ISO timestamp");
  return new Date(ms);
}
