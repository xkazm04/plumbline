// plumbline approve (--key <file> | --key-env <NAME>) [--root <dir>] [--json]
// Signs the agent lock's exact bytes with a person's own key and writes plumbline.agent.approval.json beside it
// (src/core/approve.ts). Custody as `sign` holds it (commands.ts): a key file inside the repository is refused (a commit
// would publish it), the root may not hold a plumbline.private.json, and --key-env prints CI_KEY_WARNINGS. Exit 0
// written, 2 usage or I/O error (no lock, a lock that is not one, a key in the wrong place).

import path from "node:path";
import { parseAgentLock, type Parsed } from "../agent/lock.js";
import { approveLock } from "../core/approve.js";
import { keyIdOfPrivate } from "../core/keys.js";
import { AGENT_APPROVAL_FILE, AGENT_LOCK_FILE, ALG, FORMAT_VERSION, isPrivateKeyFile, type AgentLock } from "../core/index.js";
import { LF_PIN_LINE, lfPinned } from "../watch/capture.js";
import { CliError, UsageError, nowFrom, parseArgs } from "./args.js";
import { isInside } from "./approvers-file.js";
import { CI_KEY_WARNINGS, emit, type Out } from "./commands.js";
import { PRIVATE_KEY_FILE, PRIVATE_KEY_TYPE, readBytesIfPresent, readPrivateKeyFile, readTextIfPresent, writeFileAtomic, type PrivateKeyFile } from "./files.js";

export const APPROVE_USAGE = "usage: plumbline approve (--key <file> | --key-env <NAME>) [--root <dir>] [--json]";

/** What `approve` reads that a test may stand in for: the lock reader (WP2's parseAgentLock) and the environment. */
export interface ApproveDeps {
  parseLock?: (text: string) => Parsed<AgentLock>;
  env?: NodeJS.ProcessEnv;
}

const KEY_FIX = "keep your approval key outside the repository (for example under $PLUMBLINE_HOME), and if it was ever committed, make a new key with plumbline keygen";

async function approvalKey(
  key: string | undefined,
  keyEnv: string | undefined,
  root: string,
  env: NodeJS.ProcessEnv,
): Promise<{ privateFile: PrivateKeyFile; fromEnv?: string }> {
  if ((key === undefined) === (keyEnv === undefined)) throw new UsageError("give exactly one of --key and --key-env");
  // a private key inside the repository is one commit away from published (the rule `sign` holds for a site root)
  if ((await readTextIfPresent(path.join(root, PRIVATE_KEY_FILE))) !== undefined) {
    throw new CliError(`refusing to approve: the repository ${root} holds a ${PRIVATE_KEY_FILE}: ${KEY_FIX}`);
  }
  if (key !== undefined) {
    if (await isInside(root, key)) throw new CliError(`refusing to approve: the key file ${key} sits inside the repository ${root}: ${KEY_FIX}`);
    return { privateFile: await readPrivateKeyFile(key) };
  }
  const name = keyEnv as string;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new UsageError("--key-env takes the NAME of an environment variable");
  const text = env[name];
  if (text === undefined || text.trim() === "") throw new CliError(`the environment variable ${name} is not set or is empty`);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CliError(`the environment variable ${name} does not hold a Plumbline private key file (it is not JSON)`);
  }
  if (!isPrivateKeyFile(value)) throw new CliError(`the environment variable ${name} does not hold a Plumbline private key file`);
  return { privateFile: { type: PRIVATE_KEY_TYPE, version: FORMAT_VERSION, alg: ALG, kid: value.kid, privateKey: value.privateKey }, fromEnv: name };
}

/** `approve` with its lock reader and environment injectable. */
export async function approveWith(argv: string[], out: Out, deps: ApproveDeps = {}): Promise<number> {
  const args = parseArgs(argv, ["key", "key-env", "root", "now"]);
  const env = deps.env ?? process.env;
  const root = path.resolve(args.values.get("root") ?? ".");
  const lockPath = path.join(root, AGENT_LOCK_FILE);
  const bytes = await readBytesIfPresent(lockPath);
  if (bytes === undefined) throw new CliError(`there is no ${AGENT_LOCK_FILE} in ${root} to approve: run plumbline agent init (or agent relock) first`);
  const parsed = (deps.parseLock ?? parseAgentLock)(new TextDecoder().decode(bytes));
  if (!parsed.ok) throw new CliError(`refusing to approve: ${AGENT_LOCK_FILE} is not an agent lock (${parsed.problem})`);
  const { privateFile, fromEnv } = await approvalKey(args.values.get("key"), args.values.get("key-env"), root, env);
  let kid: string;
  try {
    kid = await keyIdOfPrivate(privateFile.privateKey);
  } catch {
    throw new CliError("the private key is not a valid Ed25519 PKCS#8 key");
  }
  if (kid !== privateFile.kid) throw new CliError("the private key file's kid does not belong to its key");
  const approval = await approveLock({ privateKey: privateFile.privateKey, lockBytes: bytes, lock: parsed.value, now: nowFrom(args) ?? new Date() });
  const approvalPath = path.join(root, AGENT_APPROVAL_FILE);
  await writeFileAtomic(approvalPath, JSON.stringify(approval, null, 2) + "\n");

  const notes: string[] = [];
  // the approval covers exact bytes: a checkout that rewrites line endings would make it cover a different lock
  if (bytes.includes(13) && !(await lfPinned(root))) {
    notes.push(`The lock holds CRLF line endings and no .gitattributes pins LF: add the line "${LF_PIN_LINE}" so every checkout has the bytes you approved.`);
  }
  if (fromEnv !== undefined) notes.push(...CI_KEY_WARNINGS);
  const next = `Next: commit ${AGENT_LOCK_FILE} and ${AGENT_APPROVAL_FILE} together; a reviewer's approvers file must hold your key (plumbline approver add --key <your plumbline-key.json> --label <name>).`;
  emit(
    args,
    out,
    { kid, lock: approval.lock, ...(approval.previous !== undefined ? { previous: approval.previous } : {}), approvalFile: approvalPath, notes, next },
    [`approved ${AGENT_LOCK_FILE} (lock ${approval.lock.slice(0, 12)}) with key ${kid}`, `wrote ${approvalPath}`, ...notes.map((n) => `NOTE: ${n}`), next],
  );
  return 0;
}

export async function approve(argv: string[], out: Out): Promise<number> {
  return approveWith(argv, out);
}
