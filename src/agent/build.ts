// Building an agent lock from the declaration (`agent init`, `agent relock`). Node: reads the checkout; every network
// read goes through the injected lister (MCP over HTTP, src/net/mcp-http.ts) and fetcher (A2A cards, safeFetch), so
// tests inject both and production passes the guarded ones.
//
// Rules: files are the declaration's globs expanded now, links followed (src/agent/discover.ts), each hashed by the text
// rule (src/agent/text-hash.ts: CRLF read as LF unless the file holds a NUL byte); the lock is written as version 2 with
// `hashing: "text-lf"` and the links followed. A stdio server's tools come from the guard's pending file when its
// `target` matches the declared command; else the previous lock's tools are kept when the target did not change; else
// none (not yet observed). An http server's tools are listed now; one that cannot be read keeps the previous record when
// its target did not change, else it is locked without tools, and either way a warn says so. An http server whose
// `auth` names a variable that is unset or unsendable is not contacted at all (server-auth-missing, kept the same way);
// the values are read from the environment for that one listing only. A peer is read now; one that cannot be read keeps
// its previous record, else it is left out, with a warn.
// Nothing the network said is ever dropped silently, and a server's own words never reach a finding.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { toolDefinition, serverTarget, toolsParts, toolsRecord, type ToolPart } from "../core/agent-tools.js";
import { sha256Hex } from "../core/canonical.js";
import {
  AGENT_CURRENT_VERSION,
  AGENT_LOCK_TYPE,
  AGENT_PENDING_DIR,
  type AgentDeclaration,
  type AgentFinding,
  type AgentLock,
  type AgentMcpRecord,
  type AgentPending,
  type ExternalRecord,
  type McpServerDecl,
} from "../core/types.js";
import { CliError } from "../cli/args.js";
import { isSendableHeaderValue } from "../net/fetch-types.js";
import type { Fetcher } from "../net/locate.js";
import type { McpListResult, McpToolLister } from "../net/mcp-http.js";
import { observeExternal, type ExternalObservation } from "../watch/external.js";
import { matchFiles } from "./discover.js";
import { byPath } from "./glob.js";
import { parsePending, pendingFileName } from "./pending.js";
import { declaredFileHash } from "./text-hash.js";

/** What every agent command is given, so tests inject the network and the clock. */
export interface AgentDeps {
  lister: McpToolLister;
  fetcher: Fetcher;
  now: Date;
  env: NodeJS.ProcessEnv;
}

/** A repository-relative path as a path on this machine. */
export const repoPath = (root: string, rel: string): string => path.join(root, ...rel.split("/"));

/** The guard's pending file for a server (repository-relative). */
export const pendingPathOf = (server: string): string => `${AGENT_PENDING_DIR}/${pendingFileName(server)}`;

/** The guard's pending document for a server, when there is one that reads as one. */
export async function readPending(root: string, server: string): Promise<AgentPending | undefined> {
  try {
    return parsePending(await readFile(repoPath(root, pendingPathOf(server)), "utf8")) ?? undefined;
  } catch {
    return undefined;
  }
}

/** The declared files as a lock holds them. */
export interface DeclaredFiles {
  /** Repository path to SHA-256 under the text rule (`text-lf`). */
  files: Record<string, string>;
  /** The links followed that lead to a file in `files`, repository-relative, sorted (never where they point). */
  links: string[];
  /**
   * The files whose hash differs from `exactBefore` (a version 1 lock's files) only because of the text rule: their
   * exact bytes still hash to the old record, so their contents did not change. Sorted; empty without `exactBefore`.
   */
  rehashed: string[];
}

/**
 * The files the declaration's globs match now, hashed by the text rule. A matched file a lock cannot name is refused
 * (exit 2), as are a link cycle and a walk over MAX_DECLARED_FILES (src/agent/discover.ts). `exactBefore`: the files of
 * a version 1 lock being replaced, whose hashes are of exact bytes (for `rehashed`).
 */
export async function hashDeclaredFiles(root: string, globs: readonly string[], exactBefore?: Record<string, string>): Promise<DeclaredFiles> {
  const matched = await matchFiles(root, globs);
  if (matched.unsafe > 0) {
    throw new CliError(
      `${matched.unsafe} file${matched.unsafe === 1 ? "" : "s"} the declaration's globs match ha${matched.unsafe === 1 ? "s a name" : "ve names"} outside [A-Za-z0-9._/-], which a lock cannot hold: rename ${matched.unsafe === 1 ? "it" : "them"} or narrow the glob${matched.unsafeGlobs.length === 1 ? "" : "s"} (${matched.unsafeGlobs.join(", ")})`,
    );
  }
  const files: Record<string, string> = {};
  const rehashed: string[] = [];
  for (const rel of matched.paths) {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(repoPath(root, rel)));
    } catch {
      throw new CliError(`${rel} could not be read`);
    }
    files[rel] = await declaredFileHash(bytes, "text-lf");
    const before = exactBefore?.[rel];
    if (before !== undefined && before !== files[rel] && (await declaredFileHash(bytes, undefined)) === before) rehashed.push(rel);
  }
  return { files, links: matched.links, rehashed };
}

/**
 * The header values an http server's `auth` names, read from the environment now (never stored), or the variables that
 * are unset, empty, or hold a value Plumbline does not send (printable ASCII only, so no CR or LF). No auth: no values.
 */
export function resolveAuth(decl: McpServerDecl, env: NodeJS.ProcessEnv): { ok: true; values?: Record<string, string> } | { ok: false; missing: string[] } {
  if (decl.transport !== "http" || decl.auth === undefined) return { ok: true };
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const [header, variable] of Object.entries(decl.auth)) {
    const value = Object.hasOwn(env, variable) ? env[variable] : undefined;
    if (value === undefined || value === "" || !isSendableHeaderValue(value)) missing.push(variable);
    else values[header] = value;
  }
  return missing.length > 0 ? { ok: false, missing: [...new Set(missing)] } : { ok: true, values };
}

/** The fixed sentence start of a server-auth-missing finding: names the variables, never a value. */
export function authMissingWords(missing: readonly string[]): string {
  const one = missing.length === 1;
  return `An MCP server over HTTP was not contacted: the environment variable${one ? "" : "s"} ${missing.join(", ")} it names for a header ${one ? "is" : "are"} unset or hold${one ? "s" : ""} a value Plumbline does not send (printable ASCII, no line breaks)`;
}

/** Why a list result is not a list, in words completing "could not be read (...)", and whether the address was refused. */
export function listFailure(result: Exclude<McpListResult, { ok: true }>): { refused: boolean; why: string } {
  if ("refused" in result) return { refused: true, why: result.refused };
  if ("status" in result) return { refused: false, why: `it answered HTTP ${result.status}` };
  return { refused: false, why: result.reason };
}

/** The same for an A2A card read. */
export function peerFailure(seen: Exclude<ExternalObservation, { ok: true }>): string {
  return seen.refused ?? (seen.status !== undefined ? `it answered HTTP ${seen.status}` : (seen.reason ?? "it could not be read"));
}

/** A peer's record from a successful read, as the site lock records an external card (src/watch/capture.ts). */
export function peerRecord(seen: Extract<ExternalObservation, { ok: true }>, now: Date): ExternalRecord {
  const parts = seen.outline && Object.keys(seen.outline.parts).length > 0 ? { parts: seen.outline.parts } : {};
  const signatures = seen.outline ? { signatures: seen.outline.signatures } : {};
  return { kind: "a2a-card", sha256: seen.sha256, ...parts, ...signatures, checkedAt: now.toISOString() };
}

/** What `relock` prints per server: tool counts, and for a pending file's objects the names of tools added or changed. */
export interface ServerChange {
  server: string;
  source: "pending" | "listed" | "kept" | "none";
  added: number;
  removed: number;
  changed: number;
  /** Names (the caller's own servers, for its own terminal only) of tools added and changed, from a pending file. */
  addedNames?: string[];
  changedNames?: string[];
}

export interface Built {
  lock: AgentLock;
  /**
   * The tool objects (restricted to MCP_TOOL_DEFINITION_KEYS, in the order received) behind each server whose tools
   * this build observed now (a pending file taken, or a list read); a server kept from the earlier lock is absent.
   * Written by relock and init as the committed definitions files (src/agent/definitions.ts).
   */
  definitions: Record<string, Record<string, unknown>[]>;
  /** warn findings: a server or peer that could not be read now (what the lock holds for it is said). */
  findings: AgentFinding[];
  servers: ServerChange[];
  /**
   * The first version 2 lock after a version 1 lock: the files whose recorded hash changed only because the text rule
   * replaced exact bytes (their contents did not change), sorted. Relock reports them as re-hashed, not changed. Empty
   * otherwise.
   */
  rehashed: string[];
  /** How many links the files were followed through (`lock.links`), and how many locked files sit under them. */
  linked: { links: number; files: number };
}

function counted(server: string, source: ServerChange["source"], before: Record<string, string> | undefined, after: Record<string, string> | undefined): ServerChange {
  const b = before ?? {};
  const a = after ?? {};
  return {
    server,
    source,
    added: Object.keys(a).filter((k) => !Object.hasOwn(b, k)).length,
    removed: Object.keys(b).filter((k) => !Object.hasOwn(a, k)).length,
    changed: Object.keys(a).filter((k) => Object.hasOwn(b, k) && b[k] !== a[k]).length,
  };
}

/** The names of the tools a pending file holds that are added to or changed in the lock. */
function pendingNames(pending: AgentPending, parts: readonly ToolPart[], before: Record<string, string> | undefined): { addedNames: string[]; changedNames: string[] } {
  const b = before ?? {};
  const addedNames: string[] = [];
  const changedNames: string[] = [];
  for (const part of parts) {
    const name = String(pending.tools[part.index]?.name);
    if (!Object.hasOwn(b, part.key)) addedNames.push(name);
    else if (b[part.key] !== part.definition) changedNames.push(name);
  }
  return { addedNames, changedNames };
}

/**
 * The lock for a declaration now. `previous` (relock) is the lock being replaced and its exact bytes: its hash becomes
 * `previous`, and what cannot be read now is kept from it.
 */
export async function buildLock(
  root: string,
  declaration: AgentDeclaration,
  declarationBytes: Uint8Array,
  deps: AgentDeps,
  previous?: { lock: AgentLock; bytes: Uint8Array },
): Promise<Built> {
  const findings: AgentFinding[] = [];
  const servers: ServerChange[] = [];
  const definitions: Record<string, Record<string, unknown>[]> = {};
  const exactBefore = previous !== undefined && previous.lock.hashing === undefined ? previous.lock.files : undefined;
  const { files, links, rehashed } = await hashDeclaredFiles(root, declaration.files, exactBefore);
  const mcp: Record<string, AgentMcpRecord> = {};
  for (const name of Object.keys(declaration.mcp ?? {}).sort(byPath)) {
    const decl = (declaration.mcp ?? {})[name]!;
    const target = await serverTarget(decl);
    const held = previous?.lock.mcp?.[name];
    const same = held !== undefined && held.target === target && held.transport === decl.transport ? held : undefined;
    // what the change list compares with: the earlier record under this name, even for another command or address (a
    // version bump reads as the tools it changed, not as every tool added); what is KEPT needs the same target
    const prior = held !== undefined && held.transport === decl.transport ? held.tools : undefined;
    const keep = (): AgentMcpRecord => (same?.tools !== undefined && same.observedAt !== undefined ? { transport: decl.transport, target, tools: same.tools, observedAt: same.observedAt } : { transport: decl.transport, target });
    if (decl.transport === "stdio") {
      const pending = await readPending(root, name);
      if (pending !== undefined && pending.target === target) {
        const { parts } = await toolsParts(pending.tools);
        const tools = toolsRecord(parts);
        mcp[name] = { transport: "stdio", target, tools, observedAt: pending.observedAt };
        definitions[name] = pending.tools.map((t) => toolDefinition(t));
        servers.push({ ...counted(name, "pending", prior, tools), ...pendingNames(pending, parts, prior) });
      } else {
        mcp[name] = keep();
        servers.push(counted(name, mcp[name].tools !== undefined ? "kept" : "none", prior, mcp[name].tools));
      }
      continue;
    }
    const auth = resolveAuth(decl, deps.env);
    if (!auth.ok) {
      mcp[name] = keep();
      const kept = mcp[name].tools !== undefined;
      servers.push(counted(name, kept ? "kept" : "none", prior, mcp[name].tools));
      findings.push({
        severity: "warn",
        code: "server-auth-missing",
        ref: name,
        summary: `${authMissingWords(auth.missing)}; ${kept ? "the lock keeps its earlier tools" : "the lock holds it without tools"}.`,
      });
      continue;
    }
    const listed = auth.values !== undefined ? await deps.lister(decl.url, auth.values) : await deps.lister(decl.url);
    if (listed.ok) {
      const { parts } = await toolsParts(listed.tools);
      const tools = toolsRecord(parts);
      mcp[name] = { transport: "http", target, tools, observedAt: deps.now.toISOString() };
      definitions[name] = listed.tools.filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null && !Array.isArray(t)).map((t) => toolDefinition(t));
      servers.push(counted(name, "listed", prior, tools));
      continue;
    }
    const failure = listFailure(listed);
    mcp[name] = keep();
    const kept = mcp[name].tools !== undefined;
    servers.push(counted(name, kept ? "kept" : "none", prior, mcp[name].tools));
    findings.push({
      severity: "warn",
      code: failure.refused ? "server-refused" : "server-unreachable",
      ref: name,
      summary: failure.refused
        ? `An MCP server over HTTP was not contacted: ${failure.why}, an address Plumbline does not contact; ${kept ? "the lock keeps its earlier tools" : "the lock holds it without tools"}.`
        : `An MCP server over HTTP could not be read (${failure.why}); ${kept ? "the lock keeps its earlier tools" : "the lock holds it without tools"}.`,
    });
  }
  const peers: Record<string, ExternalRecord> = {};
  for (const url of [...(declaration.peers ?? [])].sort(byPath)) {
    const seen = await observeExternal(url, "a2a-card", deps.fetcher);
    if (seen.ok) {
      peers[url] = peerRecord(seen, deps.now);
      continue;
    }
    const held = previous?.lock.peers?.[url];
    if (held !== undefined) peers[url] = held;
    findings.push({
      severity: "warn",
      code: "peer-unreachable",
      ref: url,
      summary: `An A2A peer could not be read (${peerFailure(seen)}); ${held !== undefined ? "the lock keeps its earlier record" : "it is not in the lock"}.`,
    });
  }
  const lock: AgentLock = {
    type: AGENT_LOCK_TYPE,
    version: AGENT_CURRENT_VERSION,
    ...(previous !== undefined ? { previous: await sha256Hex(previous.bytes) } : {}),
    declaration: await sha256Hex(declarationBytes),
    hashing: "text-lf",
    files,
    ...(links.length > 0 ? { links } : {}),
    ...(declaration.models !== undefined && Object.keys(declaration.models).length > 0 ? { models: { ...declaration.models } } : {}),
    ...(Object.keys(mcp).length > 0 ? { mcp } : {}),
    ...(Object.keys(peers).length > 0 ? { peers } : {}),
    lockedAt: deps.now.toISOString(),
  };
  const linkedFiles = Object.keys(files).filter((rel) => links.some((l) => rel === l || rel.startsWith(`${l}/`))).length;
  return { lock, findings, servers, definitions, rehashed, linked: { links: links.length, files: linkedFiles } };
}

/** The bytes a lock is written as: two-space JSON and a newline. */
export const lockText = (lock: AgentLock): string => `${JSON.stringify(lock, null, 2)}\n`;
