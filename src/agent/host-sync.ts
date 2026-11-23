// Keeping the declaration's servers in step with the agent hosts' files (format version 2, the idea note's D-7): "host
// config wins". A server declared with `from` (init sets it on every server it discovers) takes its host entry's current
// command and args, or address and header names, whenever `agent relock` runs; one whose host entry is gone leaves the
// declaration; a host entry not yet declared joins it with `from`. A server declared by hand (no `from`) is never
// touched. `agent check` runs the same comparison and reports each difference as `host-changed`, so a version bump in
// `.mcp.json` is one reviewed relock instead of a guard that refuses every tool.
//
// The first version 2 relock of a version 1 declaration (which has no `from`) marks `from` only on a server identical to
// a current host entry (same name, same command and args, or same address); every other declared server stays declared
// by hand, and the caller says how many.
//
// Pure over what discoverHosts read: no file is read or written here, and no header value is ever seen (an entry's
// `auth` names environment variables only).

import { AGENT_CURRENT_VERSION, type AgentDeclaration, type McpServerDecl } from "../core/types.js";
import type { HostDiscovery, HostServer } from "./discover.js";
import { byPath } from "./glob.js";

/** One way the re-synced declaration differs from the one given, for one server. */
export type DeclarationChange =
  /** A `from` server whose host entry runs another command, names another address, or sends other headers. */
  | { kind: "changed"; server: string; file: string; before: McpServerDecl; after: McpServerDecl }
  /** A host entry not yet declared, added with `from`. */
  | { kind: "added"; server: string; file: string; after: McpServerDecl }
  /** A `from` server whose host entry is gone (removed, renamed, or now one init does not declare). */
  | { kind: "removed"; server: string; file: string; before: McpServerDecl };

export interface HostSync {
  /** The declaration with its `from` servers re-synced, at AGENT_CURRENT_VERSION. */
  declaration: AgentDeclaration;
  /** True when it differs from the one given (servers, or the version), so relock writes it. */
  rewrite: boolean;
  changes: DeclarationChange[];
  /** A version 1 declaration: how many servers were marked `from`, and how many stay declared by hand. */
  migrated?: { marked: number; hand: number };
  /** Host entries not added because a server declared by hand holds their name (and runs something else). */
  notAdded: { server: string; file: string }[];
}

const argsOf = (d: McpServerDecl): string[] => (d.transport === "stdio" ? (d.args ?? []) : []);

/** Same transport and the same command and args (no args and `[]` alike), or the same address. */
export function sameRun(a: McpServerDecl, b: McpServerDecl): boolean {
  if (a.transport !== b.transport) return false;
  if (a.transport === "http" && b.transport === "http") return a.url === b.url;
  if (a.transport === "stdio" && b.transport === "stdio") {
    const x = argsOf(a);
    const y = argsOf(b);
    return a.command === b.command && x.length === y.length && x.every((v, i) => v === y[i]);
  }
  return false;
}

const authOf = (d: McpServerDecl): Record<string, string> => (d.transport === "http" ? (d.auth ?? {}) : {});

/** The same auth headers naming the same variables (header names compared without case). */
export function sameAuth(a: McpServerDecl, b: McpServerDecl): boolean {
  const x = Object.entries(authOf(a)).map(([h, v]) => `${h.toLowerCase()}\0${v}`).sort();
  const y = Object.entries(authOf(b)).map(([h, v]) => `${h.toLowerCase()}\0${v}`).sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * The host entry as a `from` declaration. Header names come from the host file; a header the declaration already
 * names keeps the variable the declaration gives it (a person may have renamed it), a new one takes the suggested name.
 */
export function fromDecl(entry: HostServer, declared?: McpServerDecl): McpServerDecl {
  if (entry.decl.transport === "stdio") {
    const { transport, command, args } = entry.decl;
    return { transport, command, ...(args !== undefined ? { args } : {}), from: entry.host };
  }
  const had = Object.entries(declared === undefined ? {} : authOf(declared));
  const suggested = entry.decl.auth ?? {};
  const auth = Object.fromEntries(Object.entries(suggested).map(([h, v]) => [h, had.find(([d]) => d.toLowerCase() === h.toLowerCase())?.[1] ?? v]));
  return { transport: "http", url: entry.decl.url, ...(Object.keys(auth).length > 0 ? { auth } : {}), from: entry.host };
}

/** The host entry a `from` server came from: its host, under its declared name or the key it has in the host file. */
function entryOf(name: string, decl: McpServerDecl, hosts: HostDiscovery): HostServer | undefined {
  const from = decl.from;
  if (from === undefined) return undefined;
  const mine = hosts.entries.filter((e) => e.host === from);
  return mine.find((e) => e.name === name) ?? mine.find((e) => e.key === name || `${e.host}:${e.key}` === name);
}

const entryId = (e: HostServer): string => `${e.host}\0${e.key}`;

/** The declaration re-synced from what the hosts' files declare now. */
export function syncDeclaration(declaration: AgentDeclaration, hosts: HostDiscovery): HostSync {
  const declared = declaration.mcp ?? {};
  const mcp: Record<string, McpServerDecl> = {};
  const changes: DeclarationChange[] = [];
  const covered = new Set<string>();
  const v1 = declaration.version === 1;
  let marked = 0;

  for (const [name, decl] of Object.entries(declared)) {
    if (v1) {
      // first version 2 relock: `from` only for a server identical to a current host entry
      const same = hosts.servers.find((s) => s.name === name && sameRun(s.decl, decl));
      if (same === undefined) {
        mcp[name] = decl;
        continue;
      }
      covered.add(entryId(same));
      marked++;
      const after = fromDecl(same, decl);
      mcp[name] = after;
      if (!sameAuth(decl, after)) changes.push({ kind: "changed", server: name, file: same.file, before: decl, after });
      continue;
    }
    if (decl.from === undefined) {
      mcp[name] = decl; // declared by hand: never touched
      continue;
    }
    const entry = entryOf(name, decl, hosts);
    if (entry === undefined) {
      const file = hosts.configs.find((c) => c.host === decl.from)?.file ?? fileOfHost(decl.from);
      changes.push({ kind: "removed", server: name, file, before: decl });
      continue;
    }
    covered.add(entryId(entry));
    const after = fromDecl(entry, decl);
    mcp[name] = after;
    if (!sameRun(decl, after) || !sameAuth(decl, after)) changes.push({ kind: "changed", server: name, file: entry.file, before: decl, after });
  }

  const notAdded: HostSync["notAdded"] = [];
  const added: [string, McpServerDecl][] = [];
  for (const s of hosts.servers) {
    if (covered.has(entryId(s))) continue;
    // the same server in another host's file, already declared from that host
    if (hosts.entries.some((e) => e.name === s.name && covered.has(entryId(e)) && sameRun(e.decl, s.decl))) continue;
    if (Object.hasOwn(mcp, s.name) || added.some(([n]) => n === s.name)) {
      const held = mcp[s.name];
      if (held !== undefined && !sameRun(held, s.decl)) notAdded.push({ server: s.name, file: s.file });
      continue;
    }
    const after = fromDecl(s);
    added.push([s.name, after]);
    changes.push({ kind: "added", server: s.name, file: s.file, after });
  }
  for (const [name, decl] of added.sort((a, b) => byPath(a[0], b[0]))) mcp[name] = decl;

  // the members in the order the given declaration has them, so a rewrite changes only what changed
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(declaration)) {
    if (key === "version") out.version = AGENT_CURRENT_VERSION;
    else if (key !== "mcp") out[key] = value;
    else if (Object.keys(mcp).length > 0) out.mcp = mcp;
  }
  if (!Object.hasOwn(out, "mcp") && Object.keys(mcp).length > 0) out.mcp = mcp;
  const rewrite = declaration.version !== AGENT_CURRENT_VERSION || JSON.stringify(declaration.mcp ?? {}) !== JSON.stringify(mcp);
  return {
    declaration: out as unknown as AgentDeclaration,
    rewrite,
    changes,
    ...(v1 ? { migrated: { marked, hand: Object.keys(declared).length - marked } } : {}),
    notAdded,
  };
}

/** The file a host keeps its servers in, for a `from` whose host file is gone altogether. */
function fileOfHost(host: string): string {
  return host === "claude" ? ".mcp.json" : host === "cursor" ? ".cursor/mcp.json" : ".vscode/mcp.json";
}
