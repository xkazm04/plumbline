// The guard's decision: given the approved lock's record for one MCP server and the newline-delimited JSON-RPC messages
// that cross between an agent host and that server, what to forward, what to answer locally, what to say on stderr and
// what to write as the observation. Pure: no node:* imports, no process, no file; src/guard/process.ts does the I/O.
//
// Rules (docs/agent-lock.md, "The guard"; registry rule agent-runtime-assembly/guard-input-custody):
// - The policy is decided ONCE, before the first message, from a lock read once. It never changes while the guard runs.
// - Host -> server passes through, except a `tools/call` whose tool is not passing (changed, unpinned, or the server's
//   list not seen yet): it is answered here with a fixed JSON-RPC error and never forwarded.
// - Server -> host passes through, except the response to a `tools/list` the host sent: only passing tools are kept
//   (toolsDecision over every page seen so far, so a name repeated on a later page is keyed by its occurrence).
// - A refusing policy relays the protocol so the host does not hang, but every list is empty and every call refused.
//   It never falls back to passing tools.
// - A message that is not JSON, or repeats a key inside one object (JSON.parse keeps the last, another reader may keep
//   the first, so it would mean two things), is a protocol error: not forwarded, counted, one stderr line.
// - Stderr lines are counts and fixed phrases. A server's own words (tool names, descriptions) are never copied into
//   them, nor into a locally made error. The server label is the caller's own (`--server`), made printable by the caller.

import { toolsDecision, toolsParts, toolsUnchanged, type ToolPart } from "../core/agent-tools.js";
import { countDuplicateKeys } from "../core/json-keys.js";

/** JSON-RPC error code of a refused tools/call ("method not found": the tool is not one the host may call). */
export const GUARD_REFUSED_CODE = -32601;
/** JSON-RPC error code of a host request left unanswered when `--strict` stopped the server. */
export const GUARD_STOPPED_CODE = -32000;

/** The fixed message of a tools/call to a tool the approved lock does not pass. Never quotes the server. */
export const TOOL_REFUSED_MESSAGE =
  "Plumbline guard: this tool is not in the approved agent lock (it changed, is new, or the server's tool list was not seen yet); run `plumbline agent relock` and approve the new lock";
/** The fixed message of every tools/call while the guard refuses all tools. */
export const ALL_REFUSED_MESSAGE =
  "Plumbline guard: every tool of this server is refused because the agent lock could not be used for it; the guard's stderr says why";
/** The fixed message for host requests still open when `--strict` stopped the server. */
export const STOPPED_MESSAGE =
  "Plumbline guard: the server was stopped because its tools differ from the approved agent lock (--strict); run `plumbline agent relock` and approve the new lock";

/** Why the guard refuses every tool. Each has one fixed sentence (REFUSAL_SENTENCES). */
export const GUARD_REFUSALS = [
  "lock-absent",
  "lock-unusable",
  "server-absent",
  "server-not-stdio",
  "server-target-changed",
  "lock-unapproved",
  "lock-changed-after-approval",
  "approval-invalid",
  "approval-unverifiable",
] as const;
export type GuardRefusal = (typeof GUARD_REFUSALS)[number];

export const REFUSAL_SENTENCES: Record<GuardRefusal, string> = {
  "lock-absent": "the agent lock could not be read, so every tool of this server is refused; run `plumbline agent init`, or pass --lock with the lock's path",
  "lock-unusable": "the agent lock is not a usable plumbline agent lock (not JSON, a repeated key, or a wrong type or shape), so every tool of this server is refused",
  "server-absent": "the agent lock has no MCP server by this name, so every tool is refused; declare it in plumbline.agent.json, run `plumbline agent relock` and approve",
  "server-not-stdio": "the agent lock records this server as reached over HTTP, not as a command the host runs, so every tool is refused",
  "server-target-changed": "the command the guard was asked to run is not the one the agent lock records for this server, so every tool is refused; run `plumbline agent relock` and approve",
  "lock-unapproved": "--require approved: the agent lock has no approval (plumbline.agent.approval.json), so every tool is refused; run `plumbline approve`",
  "lock-changed-after-approval": "--require approved: the agent lock changed after it was approved, so every tool is refused; review the lock and run `plumbline approve`",
  "approval-invalid": "--require approved: the approval does not verify (malformed, or a bad signature), so every tool is refused; run `plumbline approve` again",
  "approval-unverifiable": "--require approved: the approval cannot be verified (its key is in no entry of your approvers file, or no approvers file could be used), so every tool is refused; add the approver with `plumbline approver add`",
};

/** What the guard enforces for one server, decided once at start. `tools` undefined: never observed, nothing passes. */
export type GuardPolicy =
  | { mode: "enforce"; tools: Readonly<Record<string, string>> | undefined }
  | { mode: "refuse"; reason: GuardRefusal };

export type GuardAction =
  /** Write this line (no newline) to the server's stdin. */
  | { kind: "to-server"; line: string }
  /** Write this line (no newline) to the host (the guard's stdout). */
  | { kind: "to-host"; line: string }
  /** One line for the guard's stderr (no newline). */
  | { kind: "stderr"; line: string }
  /** A tools/list completed: write the observation (each an object with a string name). */
  | { kind: "pending"; tools: Record<string, unknown>[] }
  /** `--strict` and drift: stop the server and exit with this code (the open host requests were answered above). */
  | { kind: "stop"; exitCode: number };

export interface GuardFilterOptions {
  policy: GuardPolicy;
  /** The caller's name for the server, printable (the `--server` value, control characters replaced). */
  label: string;
  strict?: boolean;
  /** Where the observation is written, for the drift line; omitted when none is written. */
  pendingPath?: string;
}

/** Counts a host or a test may read after a run. */
export interface GuardCounts {
  /** Lines from the server that were not JSON (or repeated a key): not forwarded. */
  serverProtocolErrors: number;
  /** Lines from the host that were not JSON (or repeated a key): not forwarded. */
  hostProtocolErrors: number;
  /** tools/call requests answered by the guard and not forwarded. */
  callsRefused: number;
  /** tools/list requests whose response was filtered. */
  listsFiltered: number;
}

type Json = unknown;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const idKey = (id: unknown): string => JSON.stringify(id);
const isId = (id: unknown): boolean => typeof id === "string" || (typeof id === "number" && Number.isFinite(id));
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** JSON.parse that also refuses a repeated key in one object; undefined when the text is not one JSON value. */
function parseStrict(line: string): { value: Json } | undefined {
  try {
    const value: Json = JSON.parse(line);
    if (countDuplicateKeys(line) > 0) return undefined;
    return { value };
  } catch {
    return undefined;
  }
}

function errorResponse(id: unknown, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/**
 * The guard's state across one connection. Feed it every line in the order it arrived (one at a time: the process
 * module serialises both directions through one queue, so a call is always decided against the list the host saw).
 */
export class GuardFilter {
  readonly counts: GuardCounts = { serverProtocolErrors: 0, hostProtocolErrors: 0, callsRefused: 0, listsFiltered: 0 };
  private readonly policy: GuardPolicy;
  private readonly label: string;
  private readonly strict: boolean;
  private readonly pendingPath: string | undefined;
  /** Host request ids still waiting for the server's answer, and which of them are tools/list. */
  private readonly open = new Map<string, { id: unknown; list: boolean; first: boolean }>();
  /** Every tool of the list being read, pages in order. */
  private seen: unknown[] = [];
  /** Names the host may call: every occurrence in the list seen passes. Empty until a list is seen. */
  private passing = new Set<string>();
  private stopped = false;

  constructor(options: GuardFilterOptions) {
    this.policy = options.policy;
    this.label = options.label;
    this.strict = options.strict === true;
    this.pendingPath = options.pendingPath;
  }

  /** True once `--strict` stopped the connection: every later line is dropped. */
  get isStopped(): boolean {
    return this.stopped;
  }

  /** The line(s) to say on stderr at start: the refusal, or in `--require locked` the custody warning (the CLI's). */
  startLines(): string[] {
    return this.policy.mode === "refuse" ? [`plumbline guard: ${this.label}: ${REFUSAL_SENTENCES[this.policy.reason]}`] : [];
  }

  /** The answers to every host request still open (the connection is ending), with the fixed stopped message. */
  answerOpen(message: string = STOPPED_MESSAGE): GuardAction[] {
    const actions: GuardAction[] = [];
    for (const { id } of this.open.values()) actions.push({ kind: "to-host", line: JSON.stringify(errorResponse(id, GUARD_STOPPED_CODE, message)) });
    this.open.clear();
    return actions;
  }

  /** One line from the host. */
  fromHost(line: string): GuardAction[] {
    if (this.stopped) return [];
    const parsed = parseStrict(line);
    if (parsed === undefined) {
      this.counts.hostProtocolErrors++;
      return [{ kind: "stderr", line: `plumbline guard: ${this.label}: a message from the host is not JSON (or repeats a key inside one object); it was not forwarded (${this.counts.hostProtocolErrors} so far)` }];
    }
    const batch = Array.isArray(parsed.value);
    const items = batch ? (parsed.value as Json[]) : [parsed.value];
    const forward: Json[] = [];
    const answers: Json[] = [];
    let changed = false;
    for (const item of items) {
      const answer = this.hostItem(item);
      if (answer === undefined) forward.push(item);
      else {
        changed = true;
        if (answer !== null) answers.push(answer);
      }
    }
    const actions: GuardAction[] = [];
    // only a batch can both forward and answer: a single message is either forwarded as sent or answered
    if (forward.length > 0) actions.push({ kind: "to-server", line: changed ? JSON.stringify(forward) : line });
    if (answers.length > 0) actions.push({ kind: "to-host", line: JSON.stringify(batch ? answers : answers[0]) });
    return actions;
  }

  /** undefined: forward it. null: drop it without an answer (a notification). Otherwise the local answer. */
  private hostItem(item: Json): Json | undefined | null {
    if (!isObject(item) || typeof item.method !== "string") return undefined; // a response to a server request
    const hasId = isId(item.id);
    if (item.method === "tools/call") {
      const params = item.params;
      const name = isObject(params) && typeof params.name === "string" ? params.name : undefined;
      const allowed = this.policy.mode === "enforce" && name !== undefined && this.passing.has(name);
      if (!allowed) {
        this.counts.callsRefused++;
        if (!hasId) return null; // a call as a notification: never forwarded, nothing to answer
        return errorResponse(item.id, GUARD_REFUSED_CODE, this.policy.mode === "refuse" ? ALL_REFUSED_MESSAGE : TOOL_REFUSED_MESSAGE);
      }
    }
    if (hasId) {
      const list = item.method === "tools/list";
      const cursor = isObject(item.params) ? item.params.cursor : undefined;
      this.open.set(idKey(item.id), { id: item.id, list, first: cursor === undefined });
    }
    return undefined;
  }

  /** One line from the server. Async: a tool's definition is hashed (WebCrypto). */
  async fromServer(line: string): Promise<GuardAction[]> {
    if (this.stopped) return [];
    const parsed = parseStrict(line);
    if (parsed === undefined) {
      this.counts.serverProtocolErrors++;
      return [{ kind: "stderr", line: `plumbline guard: ${this.label}: a line from the server is not JSON (or repeats a key inside one object); it was not forwarded (${this.counts.serverProtocolErrors} so far)` }];
    }
    const batch = Array.isArray(parsed.value);
    const items = batch ? (parsed.value as Json[]) : [parsed.value];
    const out: Json[] = [];
    const actions: GuardAction[] = [];
    let changed = false;
    for (const item of items) {
      const r = await this.serverItem(item, actions);
      if (this.stopped) return actions;
      if (r !== item) changed = true;
      out.push(r);
    }
    actions.unshift({ kind: "to-host", line: changed ? JSON.stringify(batch ? out : out[0]) : line });
    return actions;
  }

  private async serverItem(item: Json, actions: GuardAction[]): Promise<Json> {
    if (!isObject(item)) return item;
    if (typeof item.method === "string") {
      // a notification or a request from the server: passes; a changed list is not trusted until it is read again
      if (item.method === "notifications/tools/list_changed") this.passing = new Set();
      return item;
    }
    if (!isId(item.id)) return item;
    const key = idKey(item.id);
    const request = this.open.get(key);
    if (request === undefined) return item;
    this.open.delete(key);
    if (!request.list || Object.hasOwn(item, "error")) return item;
    return this.filterList(item, request.first, actions);
  }

  private async filterList(response: Record<string, unknown>, first: boolean, actions: GuardAction[]): Promise<Json> {
    this.counts.listsFiltered++;
    const result = isObject(response.result) ? response.result : {};
    const page: unknown[] = Array.isArray(result.tools) ? result.tools : [];
    const complete = typeof result.nextCursor !== "string";
    if (first) this.seen = [];
    const offset = this.seen.length;
    this.seen.push(...page);
    const { parts, problems } = await toolsParts(this.seen);
    const decision = this.policy.mode === "enforce" ? toolsDecision(this.policy.tools, parts) : undefined;
    const passIndexes = new Set(decision?.pass ?? []);

    // names the host may call: every occurrence in the list so far passes (a repeated name with one changed twin is refused)
    const nameOf = (i: number): string => (this.seen[i] as Record<string, unknown>).name as string;
    const refused = new Set<string>();
    for (const p of parts) if (!passIndexes.has(p.index)) refused.add(nameOf(p.index));
    this.passing = new Set(parts.filter((p: ToolPart) => passIndexes.has(p.index) && !refused.has(nameOf(p.index))).map((p) => nameOf(p.index)));

    const kept = page.filter((_, i) => passIndexes.has(offset + i));
    // nextCursor is kept (a refusing guard's pages are all empty), so the host reads to the end and the list completes
    const filtered: Record<string, unknown> = { ...result, tools: kept };

    if (complete) {
      actions.push({ kind: "pending", tools: parts.map((p) => this.seen[p.index] as Record<string, unknown>) });
      if (decision !== undefined && (!toolsUnchanged(decision) || problems > 0)) {
        actions.push({ kind: "stderr", line: this.driftLine(decision.changed.length, decision.unpinned.length, decision.removed, problems) });
        if (this.strict) {
          this.stopped = true;
          this.open.set(idKey(response.id), { id: response.id, list: true, first });
          actions.push(...this.answerOpen(), { kind: "stop", exitCode: 1 });
          return response;
        }
      }
    }
    return { ...response, result: filtered };
  }

  private driftLine(changed: number, unpinned: number, removed: number, problems: number): string {
    const hidden = changed + unpinned + problems;
    const where = this.pendingPath === undefined ? "" : `; what the server listed is in ${this.pendingPath}`;
    const next = this.strict ? "; --strict: the server is stopped" : "";
    return (
      `plumbline guard: ${this.label}: the server's tools differ from the approved agent lock: ` +
      `${plural(hidden, "tool hidden", "tools hidden")} (${changed} changed, ${unpinned} not in the lock, ${problems} not a tool), ` +
      `${removed} in the lock no longer listed${where}${next}; run \`plumbline agent relock\`, review the change and approve the new lock`
    );
  }
}
