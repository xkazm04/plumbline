// Putting the guard in front of stdio servers: the wrapped host entry, how it is shown, applying it to host files, and
// `plumbline agent wrap` (on an existing declaration). Owned by the onboarding work (PATH resolution, the absolute form).

import { copyFile, writeFile } from "node:fs/promises";
import { AGENT_LOCK_FILE, type McpServerDecl } from "../core/types.js";
import { repoPath, type AgentDeps } from "../agent/build.js";
import { type HostDiscovery, type HostServer } from "../agent/discover.js";
import { CliError } from "./args.js";
import type { Out } from "./commands.js";
import { BACKUP_SUFFIX, jsonText } from "./agent-shared.js";

/** The host entry that runs the guard in front of a stdio server (env and every other member kept as they were). */
export function wrappedEntry(entry: Record<string, unknown>, name: string, decl: Extract<McpServerDecl, { transport: "stdio" }>): Record<string, unknown> {
  return { ...entry, command: "plumbline", args: ["guard", "--lock", AGENT_LOCK_FILE, "--server", name, "--", decl.command, ...(decl.args ?? [])] };
}

/** The member of a host file that --wrap replaces, as shown: command and args only (env is never printed). */
export const wrapShown = (name: string, decl: Extract<McpServerDecl, { transport: "stdio" }>): string =>
  JSON.stringify({ command: "plumbline", args: ["guard", "--lock", AGENT_LOCK_FILE, "--server", name, "--", decl.command, ...(decl.args ?? [])] });

export async function applyWrap(root: string, hosts: HostDiscovery, toWrap: readonly (HostServer & { decl: Extract<McpServerDecl, { transport: "stdio" }> })[]): Promise<void> {
  for (const config of hosts.configs) {
    const mine = toWrap.filter((e) => e.file === config.file);
    if (mine.length === 0) continue;
    const full = repoPath(root, config.file);
    await copyFile(full, full + BACKUP_SUFFIX);
    const servers = config.json[config.member] as Record<string, Record<string, unknown>>;
    for (const e of mine) servers[e.key] = wrappedEntry(servers[e.key] as Record<string, unknown>, e.name, e.decl);
    await writeFile(full, jsonText(config.json));
  }
}

/** `plumbline agent wrap [--root <dir>] [--json]`: not built yet (the onboarding work, D-8). */
export async function wrap(_root: string, _json: boolean, _out: Out, _deps: AgentDeps): Promise<number> {
  throw new CliError("agent wrap is not built yet");
}
