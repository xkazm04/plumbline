// plumbline approver add --key <key record> --label <name> [--file <approvers file>] [--json]
// Adds a person's public key to the approvers file, the agent trust store (src/cli/approvers-file.ts). The file lives
// OUTSIDE every repository it governs: a target folder that holds .git, or any folder up from it that holds
// plumbline.agent.json, is refused. The key record is the public half keygen writes (.well-known/plumbline-key.json);
// its kid must be derived from its key. A kid already in the file is refused. Exit 0 added, 2 usage or I/O error.

import { existsSync } from "node:fs";
import path from "node:path";
import { MAX_APPROVER_LABEL, parseApprovers } from "../core/approve.js";
import { isDerivedKid } from "../core/keys.js";
import { AGENT_FILE, AGENT_FORMAT_VERSION, APPROVERS_TYPE, KEY_TYPE, type ApproverEntry, type ApproversFile } from "../core/types.js";
import { CliError, UsageError, nowFrom, parseArgs, required } from "./args.js";
import { defaultApproversPath } from "./approvers-file.js";
import { emit, type Out } from "./commands.js";
import { readJsonFile, readTextIfPresent, writeFileAtomic } from "./files.js";

export const APPROVER_USAGE = "usage: plumbline approver add --key <key record> --label <name> [--file <approvers file>] [--json]";

/** Why `dir` is no place for an approvers file, or undefined: it is a repository's top, or inside an agent repository. */
function repositoryProblem(dir: string): string | undefined {
  if (existsSync(path.join(dir, ".git"))) return `${dir} is a git repository's top folder`;
  for (let d = dir; ; ) {
    if (existsSync(path.join(d, AGENT_FILE))) return `${dir} is inside a repository that declares an agent (${AGENT_FILE})`;
    const up = path.dirname(d);
    if (up === d) return undefined;
    d = up;
  }
}

export async function approver(argv: string[], out: Out): Promise<number> {
  const args = parseArgs(argv, ["key", "label", "file", "now"], [], { positionals: 1 });
  if (args.positionals[0] !== "add") throw new UsageError("approver takes one action: add");
  const keyPath = required(args, "key");
  const label = required(args, "label");
  const file = path.resolve(args.values.get("file") ?? defaultApproversPath(process.env));
  const problem = repositoryProblem(path.dirname(file));
  if (problem !== undefined) {
    throw new CliError(`refusing to write the approvers file there: ${problem}, and a trust store inside the repository it governs lets a change to the repository add an approver; keep it in $PLUMBLINE_HOME (the default)`);
  }

  const record = (await readJsonFile(keyPath, "key record")) as Record<string, unknown> | null;
  if (typeof record !== "object" || record === null || Array.isArray(record) || record.type !== KEY_TYPE) {
    throw new CliError(`not a Plumbline public key record (keygen writes it as .well-known/plumbline-key.json): ${keyPath}`);
  }
  if (!(await isDerivedKid(record.kid, record.publicKey))) throw new CliError(`the key record's kid is not derived from its public key: ${keyPath}`);

  const existing = await readTextIfPresent(file);
  let current: ApproversFile;
  try {
    current = existing === undefined ? { type: APPROVERS_TYPE, version: AGENT_FORMAT_VERSION, approvers: [] } : parseApprovers(existing);
  } catch (error) {
    throw new CliError(`${file} is not an approvers file: ${(error as Error).message}`);
  }
  const kid = record.kid as string;
  if (current.approvers.some((e) => e.kid === kid)) throw new CliError(`key ${kid} is already in ${file}: nothing was changed`);
  const entry: ApproverEntry = { kid, publicKey: record.publicKey as string, label, addedAt: (nowFrom(args) ?? new Date()).toISOString() };
  const next: ApproversFile = { type: APPROVERS_TYPE, version: AGENT_FORMAT_VERSION, approvers: [...current.approvers, entry] };
  const text = JSON.stringify(next, null, 2) + "\n";
  try {
    parseApprovers(text);
  } catch {
    throw new UsageError(`--label must be 1 to ${MAX_APPROVER_LABEL} characters, not blank, with no control or bidi characters`);
  }
  await writeFileAtomic(file, text);
  const nextStep = `Next: this key can now approve agent locks you check (plumbline approve --key <its private file>); in CI, put the file's JSON in a repository variable and pass it as PLUMBLINE_APPROVERS.`;
  emit(args, out, { kid, label, file, approvers: next.approvers.length, next: nextStep }, [`added key ${kid} to ${file} (${next.approvers.length} approver(s))`, nextStep]);
  return 0;
}
