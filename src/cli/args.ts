// A tiny flag parser: `--name value` pairs, the boolean `--json`, the boolean flags a command names, the keys a command
// declares repeatable (`--source a --source b`) and up to the number of positionals it declares (the gate's target).
// Anything else is a usage error (exit 2, and the command's own usage line is printed).

/** A failure the caller can do nothing about but read: a usage or I/O problem. Exit 2. */
export class CliError extends Error {}

/** The caller gave the command wrong options: exit 2, and the command's usage line is printed after the message. */
export class UsageError extends CliError {}

/**
 * The parser's own refusal, with what it refused, so a command that words its usage errors in its own sentences (gate,
 * watch) can do so: `unknown` is a flag no one declared (or a positional where the command takes none), `missing` is a
 * value-taking key with no value after it, `extra` is a positional beyond the number the command takes.
 */
export class ArgsError extends UsageError {
  constructor(
    readonly reason: "unknown" | "missing" | "extra",
    /** The argument as given (`--verbose`, `somewhere`), or for `missing` the key without its dashes (`timeout`). */
    readonly arg: string,
  ) {
    super(reason === "unknown" ? `unknown option: ${arg}` : reason === "missing" ? `--${arg} needs a value` : `unexpected argument: ${arg}`);
  }
}

export interface ParseOptions {
  /** Value-taking keys that may repeat; every value is kept, in order, under `lists`. */
  repeatable?: readonly string[];
  /** How many positionals (arguments not starting with `--`) the command takes. Default 0: a positional is unknown. */
  positionals?: number;
}

export interface ParsedArgs {
  /** Single-value keys; a key given twice keeps the last value. */
  values: Map<string, string>;
  /** Every declared repeatable key, with the values given in order (an empty array when the key was not given). */
  lists: Map<string, string[]>;
  /** The positionals, in order. */
  positionals: string[];
  /** The boolean flags given (never `json`, which has its own field). */
  flags: Set<string>;
  json: boolean;
}

export function parseArgs(
  argv: string[],
  allowed: readonly string[],
  booleans: readonly string[] = [],
  options: ParseOptions = {},
): ParsedArgs {
  const repeatable = options.repeatable ?? [];
  const maxPositionals = options.positionals ?? 0;
  const values = new Map<string, string>();
  const lists = new Map<string, string[]>(repeatable.map((key) => [key, []]));
  const positionals: string[] = [];
  const flags = new Set<string>();
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      if (maxPositionals === 0) throw new ArgsError("unknown", arg);
      if (positionals.length >= maxPositionals) throw new ArgsError("extra", arg);
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (booleans.includes(key)) {
      flags.add(key);
      continue;
    }
    const list = repeatable.includes(key) ? lists.get(key) : undefined;
    if (!list && !allowed.includes(key)) throw new ArgsError("unknown", arg);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new ArgsError("missing", key);
    if (list) list.push(value);
    else values.set(key, value);
    i++;
  }
  return { values, lists, positionals, flags, json };
}

export function required(args: ParsedArgs, name: string): string {
  const value = args.values.get(name);
  if (value === undefined) throw new UsageError(`missing --${name}`);
  return value;
}

/** The values a declared repeatable key was given, in order (empty when it was not given). */
export function repeated(args: ParsedArgs, name: string): string[] {
  return args.lists.get(name) ?? [];
}

/** `--now <ISO timestamp>` pins the clock, for tests and reproducible runs. */
export function nowFrom(args: ParsedArgs): Date | undefined {
  const raw = args.values.get("now");
  if (raw === undefined) return undefined;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) throw new UsageError("--now must be an ISO timestamp");
  return new Date(ms);
}
