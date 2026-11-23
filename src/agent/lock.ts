// Reading the agent declaration (plumbline.agent.json) and the agent lock (plumbline.agent.lock.json). Pure: no node:*
// import, so it runs in Node and in a browser.
//
// A document is refused when it is not JSON, repeats a key inside one object (countDuplicateKeys), is not the type and
// version it claims, holds a key the format does not define (at the top level and inside every member the format
// defines), or holds a field that breaks its pattern. The problem is a fixed sentence naming the field, never a quoted
// value: a declaration is the repository's own words and a lock may have been written by anyone who can push.
//
// Patterns: hashes are SHA256_PATTERN; times are UTC ISO (isIsoUtc); repository paths are isSafeSubjectPath (only
// [A-Za-z0-9._/-], no empty, `.` or `..` segment); a glob is a path that may also hold `*`; http servers and peers are
// https addresses without credentials. Server names and model labels are short names (SERVER_NAME_PATTERN,
// MODEL_LABEL_PATTERN), because they become finding refs, terminal lines and the guard's pending file names.

import { countDuplicateKeys } from "../core/json-keys.js";
import { isSafeSubjectPath } from "../core/signed-paths.js";
import {
  AGENT_DECLARATION_VERSIONS,
  AGENT_HASHING_RULES,
  AGENT_LOCK_TYPE,
  AGENT_LOCK_VERSIONS,
  AGENT_TYPE,
  MCP_HOSTS,
  SHA256_PATTERN,
  type AgentDeclaration,
  type AgentLock,
} from "../core/types.js";
import { isIsoUtc } from "../core/verify.js";

export type Parsed<T> = { ok: true; value: T } | { ok: false; problem: string };

/**
 * A server name as the declaration and the lock hold it: what the host's config calls it, or `<host>:<name>` when two
 * hosts declare the same name with different targets. Starts with a letter, digit or `_`; at most 128 characters
 * (a host config name in practice is a short word; 128 leaves room for a host prefix and is still one terminal line).
 */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}(?::[A-Za-z0-9_][A-Za-z0-9._-]{0,127})?$/;
/** A model label: `default`, or the name of an agent file under .claude/agents/ (same 128-character bound). */
export const MODEL_LABEL_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
/**
 * A model id: printable ASCII without spaces or quotes, at most 256 characters (the longest provider-qualified ids,
 * e.g. a Bedrock ARN for an inference profile, run to about 120; 256 is twice that).
 */
export const MODEL_ID_PATTERN = /^[A-Za-z0-9._:@/+=-]{1,256}$/;
/** Glob characters: a repository path's, plus `*` (one segment) and `**` (any depth). */
const GLOB_PATTERN = /^[A-Za-z0-9._/*-]+$/;
/** Names an object member may not take (JSON.parse makes them own keys; a later assignment would not). */
const RESERVED_NAMES = new Set(["__proto__", "constructor", "prototype"]);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isHex = (v: unknown): v is string => typeof v === "string" && SHA256_PATTERN.test(v);
const onlyKeys = (v: Record<string, unknown>, allowed: readonly string[]): boolean => Object.keys(v).every((k) => allowed.includes(k));

/** An HTTP header name (RFC 9110 token). */
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/;
/** An environment variable name: what every shell and CI secret store accepts; 128 characters is far past any in use. */
export const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
/** At most this many auth headers per server (servers in practice want one key, sometimes a tenant beside it). */
export const MAX_AUTH_HEADERS = 8;
/**
 * Headers an `auth` entry may not set, compared lower-case: the ones the guarded POST sets itself (content-type, accept,
 * content-length, host, the MCP session and protocol headers), cookies, and the hop-by-hop and proxy headers.
 */
export const RESERVED_AUTH_HEADERS: ReadonlySet<string> = new Set([
  "content-type", "accept", "accept-encoding", "content-length", "host", "cookie", "mcp-session-id", "mcp-protocol-version",
  "connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade", "proxy-authorization", "proxy-connection",
]);

/** True for an auth header name a declaration may name. */
export function isAuthHeaderName(name: unknown): name is string {
  return typeof name === "string" && HEADER_NAME_PATTERN.test(name) && !RESERVED_AUTH_HEADERS.has(name.toLowerCase()) && !RESERVED_NAMES.has(name);
}

/** True for an environment variable name an auth entry may name. */
export function isEnvName(name: unknown): name is string {
  return typeof name === "string" && ENV_NAME_PATTERN.test(name) && !RESERVED_NAMES.has(name);
}

const isVersion = (v: unknown, versions: readonly number[]): v is 1 | 2 => typeof v === "number" && versions.includes(v);

/** True for a server name the declaration and the lock accept. */
export function isServerName(name: unknown): name is string {
  return typeof name === "string" && SERVER_NAME_PATTERN.test(name) && !name.split(":").some((part) => RESERVED_NAMES.has(part));
}

/** True for a model label the declaration and the lock accept. */
export function isModelLabel(label: unknown): label is string {
  return typeof label === "string" && MODEL_LABEL_PATTERN.test(label) && !RESERVED_NAMES.has(label);
}

/** True for a declaration glob: a repository path whose segments may hold `*`, or be `**`; no empty, `.` or `..` segment. */
export function isSafeGlob(glob: unknown): glob is string {
  if (typeof glob !== "string" || glob === "" || !GLOB_PATTERN.test(glob)) return false;
  return glob.split("/").every((s) => s !== "" && s !== "." && s !== ".." && (s === "**" || !s.includes("**")));
}

/** True for an https address without credentials (an http server or a peer). */
export function isHttpsAddress(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.username === "" && parsed.password === "" && parsed.hostname !== "";
  } catch {
    return false;
  }
}

/** The JSON value of a document's text, or the fixed sentence saying why it is not one. A leading BOM is allowed. */
function readJson(text: string, what: string): Parsed<Record<string, unknown>> {
  const body = text.replace(/^﻿/, "");
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return { ok: false, problem: `the ${what} is not JSON` };
  }
  if (countDuplicateKeys(body) > 0) return { ok: false, problem: `the ${what} repeats a key inside one object` };
  if (!isObject(value)) return { ok: false, problem: `the ${what} is not a JSON object` };
  return { ok: true, value };
}

function modelsProblem(models: unknown, what: string): string | null {
  if (!isObject(models)) return `the ${what}'s models is not an object`;
  for (const [label, id] of Object.entries(models)) {
    if (!isModelLabel(label)) return `the ${what} has a model label outside [A-Za-z0-9._-]`;
    if (typeof id !== "string" || !MODEL_ID_PATTERN.test(id)) return `the ${what} has a model id that is not a short id string`;
  }
  return null;
}

function authProblem(auth: unknown): string | null {
  if (!isObject(auth)) return "the agent declaration has an http server whose auth is not an object";
  const entries = Object.entries(auth);
  if (entries.length === 0 || entries.length > MAX_AUTH_HEADERS) return `the agent declaration has an http server whose auth names no header or more than ${MAX_AUTH_HEADERS}`;
  for (const [header, env] of entries) {
    if (!isAuthHeaderName(header)) return "the agent declaration has an auth header name that is not a header token, or one Plumbline sets itself";
    if (!isEnvName(env)) return "the agent declaration has an auth entry whose environment variable name is outside [A-Za-z_][A-Za-z0-9_]*";
  }
  if (new Set(entries.map(([h]) => h.toLowerCase())).size !== entries.length) return "the agent declaration names one auth header twice";
  return null;
}

function serverDeclProblem(server: unknown, version: 1 | 2): string | null {
  if (!isObject(server)) return "the agent declaration has an mcp server that is not an object";
  const v2 = version === 2 ? ["from"] : [];
  if (server.from !== undefined && !(version === 2 && typeof server.from === "string" && (MCP_HOSTS as readonly string[]).includes(server.from))) {
    return version === 2 ? "the agent declaration has an mcp server whose from is not claude, cursor or vscode" : "the agent declaration has an mcp server with a key the format does not define";
  }
  if (server.transport === "stdio") {
    if (!onlyKeys(server, ["transport", "command", "args", ...v2])) return "the agent declaration has a stdio server with a key the format does not define";
    if (typeof server.command !== "string" || server.command === "") return "the agent declaration has a stdio server without a command";
    if (server.args !== undefined && !(Array.isArray(server.args) && server.args.every((a) => typeof a === "string"))) {
      return "the agent declaration has a stdio server whose args are not a list of strings";
    }
    return null;
  }
  if (server.transport === "http") {
    if (!onlyKeys(server, ["transport", "url", ...(version === 2 ? ["from", "auth"] : [])])) return "the agent declaration has an http server with a key the format does not define";
    if (!isHttpsAddress(server.url)) return "the agent declaration has an http server whose url is not an https address without credentials";
    if (server.auth !== undefined) return authProblem(server.auth);
    return null;
  }
  return "the agent declaration has an mcp server whose transport is not stdio or http";
}

/** The agent declaration in its exact shape, or a fixed sentence saying why the text is not one. */
export function parseDeclaration(text: string): Parsed<AgentDeclaration> {
  const read = readJson(text, "agent declaration");
  if (!read.ok) return read;
  const v = read.value;
  if (v.type !== AGENT_TYPE) return { ok: false, problem: `the agent declaration's type is not ${AGENT_TYPE}` };
  if (!isVersion(v.version, AGENT_DECLARATION_VERSIONS)) return { ok: false, problem: "the agent declaration has an unknown version" };
  const version = v.version;
  if (!onlyKeys(v, ["type", "version", "files", "models", "mcp", "peers"])) return { ok: false, problem: "the agent declaration has a top-level key the format does not define" };
  if (!Array.isArray(v.files)) return { ok: false, problem: "the agent declaration's files is not a list" };
  if (!v.files.every(isSafeGlob)) return { ok: false, problem: "the agent declaration has a files entry that is not a safe repository path or glob" };
  if (new Set(v.files).size !== v.files.length) return { ok: false, problem: "the agent declaration repeats a files entry" };
  if (v.models !== undefined) {
    const problem = modelsProblem(v.models, "agent declaration");
    if (problem !== null) return { ok: false, problem };
  }
  if (v.mcp !== undefined) {
    if (!isObject(v.mcp)) return { ok: false, problem: "the agent declaration's mcp is not an object" };
    for (const [name, server] of Object.entries(v.mcp)) {
      if (!isServerName(name)) return { ok: false, problem: "the agent declaration has an mcp server name outside [A-Za-z0-9._-] (and one host prefix)" };
      const problem = serverDeclProblem(server, version);
      if (problem !== null) return { ok: false, problem };
    }
  }
  if (v.peers !== undefined) {
    if (!Array.isArray(v.peers)) return { ok: false, problem: "the agent declaration's peers is not a list" };
    if (!v.peers.every(isHttpsAddress)) return { ok: false, problem: "the agent declaration has a peer that is not an https address without credentials" };
    if (new Set(v.peers).size !== v.peers.length) return { ok: false, problem: "the agent declaration repeats a peer" };
  }
  return { ok: true, value: v as unknown as AgentDeclaration };
}

function mcpRecordProblem(record: unknown): string | null {
  if (!isObject(record)) return "the agent lock has an mcp record that is not an object";
  if (!onlyKeys(record, ["transport", "target", "tools", "observedAt"])) return "the agent lock has an mcp record with a key the format does not define";
  if (record.transport !== "stdio" && record.transport !== "http") return "the agent lock has an mcp record whose transport is not stdio or http";
  if (!isHex(record.target)) return "the agent lock has an mcp record whose target is not a SHA-256 hash";
  if (record.tools === undefined) {
    if (record.observedAt !== undefined) return "the agent lock has an mcp record with observedAt but no tools";
    return null;
  }
  if (!isObject(record.tools) || !Object.entries(record.tools).every(([k, h]) => isHex(k) && isHex(h))) {
    return "the agent lock has an mcp record whose tools are not SHA-256 hashes keyed by SHA-256 hashes";
  }
  if (!isIsoUtc(record.observedAt)) return "the agent lock has an mcp record whose observedAt is not a UTC ISO time";
  return null;
}

function peerRecordProblem(record: unknown): string | null {
  if (!isObject(record)) return "the agent lock has a peer record that is not an object";
  if (!onlyKeys(record, ["kind", "sha256", "parts", "signatures", "checkedAt"])) return "the agent lock has a peer record with a key the format does not define";
  if (record.kind !== "a2a-card") return "the agent lock has a peer record whose kind is not a2a-card";
  if (!isHex(record.sha256)) return "the agent lock has a peer record whose sha256 is not a SHA-256 hash";
  if (record.parts !== undefined && !(isObject(record.parts) && Object.entries(record.parts).every(([k, h]) => isHex(k) && isHex(h)))) {
    return "the agent lock has a peer record whose parts are not SHA-256 hashes keyed by SHA-256 hashes";
  }
  if (record.signatures !== undefined && !(typeof record.signatures === "number" && Number.isInteger(record.signatures) && record.signatures >= 0)) {
    return "the agent lock has a peer record whose signatures is not a non-negative integer";
  }
  if (!isIsoUtc(record.checkedAt)) return "the agent lock has a peer record whose checkedAt is not a UTC ISO time";
  return null;
}

/** The agent lock in its exact shape, or a fixed sentence saying why the text is not one. */
export function parseAgentLock(text: string): Parsed<AgentLock> {
  const read = readJson(text, "agent lock");
  if (!read.ok) return read;
  const v = read.value;
  if (v.type !== AGENT_LOCK_TYPE) return { ok: false, problem: `the agent lock's type is not ${AGENT_LOCK_TYPE}` };
  if (!isVersion(v.version, AGENT_LOCK_VERSIONS)) return { ok: false, problem: "the agent lock has an unknown version" };
  const v2 = v.version === 2;
  if (!onlyKeys(v, ["type", "version", "previous", "declaration", "files", "models", "mcp", "peers", "lockedAt", ...(v2 ? ["hashing", "links"] : [])])) {
    return { ok: false, problem: "the agent lock has a top-level key the format does not define" };
  }
  if (v2 && !(typeof v.hashing === "string" && (AGENT_HASHING_RULES as readonly string[]).includes(v.hashing))) {
    return { ok: false, problem: "the agent lock's hashing is not a rule this build knows (text-lf)" };
  }
  if (v.links !== undefined) {
    if (!Array.isArray(v.links) || v.links.length === 0 || !v.links.every(isSafeSubjectPath)) return { ok: false, problem: "the agent lock's links is not a non-empty list of safe repository paths" };
    if (new Set(v.links).size !== v.links.length) return { ok: false, problem: "the agent lock repeats a link" };
  }
  if (v.previous !== undefined && !isHex(v.previous)) return { ok: false, problem: "the agent lock's previous is not a SHA-256 hash" };
  if (!isHex(v.declaration)) return { ok: false, problem: "the agent lock's declaration is not a SHA-256 hash" };
  if (!isObject(v.files)) return { ok: false, problem: "the agent lock's files is not an object" };
  for (const [path, hash] of Object.entries(v.files)) {
    if (!isSafeSubjectPath(path)) return { ok: false, problem: "the agent lock has a file path that is not a safe repository path" };
    if (!isHex(hash)) return { ok: false, problem: "the agent lock has a file hash that is not a SHA-256 hash" };
  }
  if (v.models !== undefined) {
    const problem = modelsProblem(v.models, "agent lock");
    if (problem !== null) return { ok: false, problem };
  }
  if (v.mcp !== undefined) {
    if (!isObject(v.mcp)) return { ok: false, problem: "the agent lock's mcp is not an object" };
    for (const [name, record] of Object.entries(v.mcp)) {
      if (!isServerName(name)) return { ok: false, problem: "the agent lock has an mcp server name outside [A-Za-z0-9._-] (and one host prefix)" };
      const problem = mcpRecordProblem(record);
      if (problem !== null) return { ok: false, problem };
    }
  }
  if (v.peers !== undefined) {
    if (!isObject(v.peers)) return { ok: false, problem: "the agent lock's peers is not an object" };
    for (const [url, record] of Object.entries(v.peers)) {
      if (!isHttpsAddress(url)) return { ok: false, problem: "the agent lock has a peer that is not an https address without credentials" };
      const problem = peerRecordProblem(record);
      if (problem !== null) return { ok: false, problem };
    }
  }
  if (!isIsoUtc(v.lockedAt)) return { ok: false, problem: "the agent lock's lockedAt is not a UTC ISO time" };
  return { ok: true, value: v as unknown as AgentLock };
}
