// Agent definitions from outside the agentic-web spec that a site depends on: today an A2A Agent Card, read with a GET.
// The lock's `external` member records each one's exact-byte hash and, per part, a hash keyed by the hash of the part's
// id, so a changed card is counted (skills added, removed, changed) without quoting a stranger's words. Pure: no
// node:* import; the CLI's watch (through safeFetch) and the Desk's published reader count the same.
//
// Severity follows the peers' rule (decide.ts): a changed external definition is `block` (a client that reads it now
// gets different skills or endpoints); one that cannot be read is `warn`. Kind `peer` on the wire (it has three drift
// kinds). An MCP tool list (`mcp-tools`) is reserved and not checked by this build: it needs a JSON-RPC POST, which the
// guarded fetch does not make; a lock that holds one gets a `warn` saying it was not checked.

import { canonicalJson, sha256Hex } from "../core/canonical.js";
import { countDuplicateKeys } from "../core/json-keys.js";
import { EXTERNAL_KINDS, type DriftCounts, type DriftFinding, type ExternalKind, type ExternalRecord } from "../core/types.js";
import { hashBytes } from "../net/canonical.js";
import { addressProblemOf, describeFetchError, type SafeFetchOptions } from "../net/fetch-types.js";
import type { Fetcher } from "../net/locate.js";

/** A sentence for the parentheses after "could not be reached" (observe.ts's Describe; kept here so decide.ts may import this module). */
type Describe = (error: unknown) => string;
const describeWatchError: Describe = (error) => describeFetchError(error, "it could not be read");

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const HEX = /^[0-9a-f]{64}$/;

/** True for an `external` record in its exact shape: the lock's rule. */
export function isExternalRecord(v: unknown): v is ExternalRecord {
  if (!isObject(v)) return false;
  if (typeof v.kind !== "string" || !(EXTERNAL_KINDS as readonly string[]).includes(v.kind)) return false;
  if (typeof v.sha256 !== "string" || !HEX.test(v.sha256) || typeof v.checkedAt !== "string") return false;
  if (v.parts !== undefined && !(isObject(v.parts) && Object.entries(v.parts).every(([k, h]) => HEX.test(k) && typeof h === "string" && HEX.test(h)))) return false;
  if (v.signatures !== undefined && !(typeof v.signatures === "number" && Number.isInteger(v.signatures) && v.signatures >= 0)) return false;
  return true;
}

/** What an A2A Agent Card holds that the watch counts: its skills, hashed, and how many JWS signatures it carries. */
export interface CardOutline {
  parts: Record<string, string>;
  signatures: number;
}

/**
 * An A2A card in outline, or null when the bytes are not one (not JSON, not an object, a repeated key, a value canonical
 * JSON refuses). A skill without a string `id` is keyed by its position. Signatures are counted, never verified here.
 */
export async function cardOutline(bytes: Uint8Array): Promise<CardOutline | null> {
  let value: unknown;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
    value = JSON.parse(text);
    if (countDuplicateKeys(text) > 0) return null;
  } catch {
    return null;
  }
  if (!isObject(value)) return null;
  const parts: Record<string, string> = {};
  const skills = Array.isArray(value.skills) ? value.skills : [];
  try {
    for (const [index, skill] of skills.entries()) {
      const id = isObject(skill) && typeof skill.id === "string" ? skill.id : `#${index}`;
      parts[await sha256Hex(id)] = await sha256Hex(canonicalJson(skill));
    }
  } catch {
    return null;
  }
  return { parts, signatures: Array.isArray(value.signatures) ? value.signatures.length : 0 };
}

/** What a driver saw of one external definition now. */
export type ExternalObservation =
  | { ok: true; sha256: string; outline: CardOutline | null }
  | { ok: false; status?: number; reason?: string; refused?: string; unsupported?: true };

/** Fetches and outlines one external definition. Never throws. An `mcp-tools` entry is not fetched (unsupported). */
export async function observeExternal(url: string, kind: ExternalKind, fetcher: Fetcher, options: { fetchOptions?: SafeFetchOptions; why?: Describe } = {}): Promise<ExternalObservation & { bytes?: Uint8Array }> {
  if (kind !== "a2a-card") return { ok: false, unsupported: true };
  const why = options.why ?? describeWatchError;
  let response;
  try {
    response = await fetcher(url, options.fetchOptions ?? {});
  } catch (error) {
    // the address rule's refusal reads as the Desk's does (UAT-3, REC-2)
    const refused = addressProblemOf(error);
    return refused !== undefined ? { ok: false, refused } : { ok: false, reason: why(error) };
  }
  if (!response.ok) return { ok: false, status: response.status };
  return { ok: true, sha256: await hashBytes(response.bytes), outline: await cardOutline(response.bytes), bytes: response.bytes };
}

/** The count of skills added, removed and changed between two part maps. */
export function partsDiff(before: Record<string, string>, after: Record<string, string>): { added: number; removed: number; changed: number } {
  return {
    added: Object.keys(after).filter((k) => !(k in before)).length,
    removed: Object.keys(before).filter((k) => !(k in after)).length,
    changed: Object.keys(after).filter((k) => k in before && before[k] !== after[k]).length,
  };
}

/** The count of skills added, removed and changed between two part maps, in fixed words. */
export function describePartsDiff(before: Record<string, string>, after: Record<string, string>): string {
  const { added, removed, changed } = partsDiff(before, after);
  return `skills: ${added} added, ${removed} removed, ${changed} changed`;
}

/** The finding for one external definition, or null when it matches the lock. */
export function externalFinding(url: string, record: ExternalRecord, seen: ExternalObservation): DriftFinding | null {
  if (!seen.ok) {
    if (seen.unsupported) {
      return { kind: "peer", severity: "warn", code: "external-unsupported", ref: url, summary: "An external entry of a kind this build does not read (an MCP tool list needs a JSON-RPC POST) was not checked." };
    }
    if (seen.refused !== undefined) {
      return { kind: "peer", severity: "warn", code: "external-refused", ref: url, summary: `An external agent definition in this lock was not contacted: ${seen.refused}, an address Plumbline does not contact, so it was not checked.` };
    }
    return {
      kind: "peer",
      severity: "warn",
      code: "external-unreachable",
      ref: url,
      summary:
        seen.status !== undefined
          ? `An external agent definition answered HTTP ${seen.status}, so it was not checked.`
          : `An external agent definition could not be reached (${seen.reason ?? "it could not be read"}), so it was not checked.`,
    };
  }
  if (seen.sha256 === record.sha256) return null;
  let detail: string;
  let counts: DriftCounts | undefined;
  if (seen.outline === null) detail = "It cannot be read as an A2A Agent Card now (not JSON, or a repeated key), so what changed is not told.";
  else if (record.parts === undefined) detail = "The lock holds no outline of it, so what changed is not told; after a review, re-lock to record one.";
  else {
    const d = partsDiff(record.parts, seen.outline.parts);
    counts = { skillsAdded: d.added, skillsRemoved: d.removed, skillsChanged: d.changed, signatures: seen.outline.signatures };
    detail = `In outline: ${describePartsDiff(record.parts, seen.outline.parts)}${seen.outline.signatures > 0 ? `; it carries ${seen.outline.signatures} JWS signature${seen.outline.signatures === 1 ? "" : "s"}, not verified here` : "; it carries no signature"}.`;
  }
  return {
    kind: "peer",
    severity: "block",
    code: "external-changed",
    ref: url,
    expected: record.sha256,
    actual: seen.sha256,
    summary: `An external A2A Agent Card changed since the lock was written; a client that reads it now gets different skills or endpoints. ${detail}`,
    ...(counts !== undefined ? { counts } : {}),
  };
}

/** A loopback host as `--allow-local` lets safeFetch reach it: `localhost`, 127.0.0.0/8 or `[::1]`. */
const isLoopbackHost = (host: string): boolean => host === "localhost" || host === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(host);

/**
 * The `--external` argument: `<kind>=<https url>`, or the reason it is refused. With `allowLocal` (UAT-21, `--allow-local`
 * for a rehearsal on this machine) an http address on a loopback host is taken too; safeFetch still refuses private
 * ranges.
 */
export function parseExternalArg(arg: string, options: { allowLocal?: boolean } = {}): { kind: ExternalKind; url: string } | { problem: string } {
  const at = arg.indexOf("=");
  const kind = at > 0 ? arg.slice(0, at) : "";
  const url = at > 0 ? arg.slice(at + 1) : "";
  if (kind === "mcp-tools") return { problem: "--external mcp-tools is not built: an MCP tool list needs a JSON-RPC POST, which the guarded fetch does not make" };
  if (kind !== "a2a-card") return { problem: "--external takes a2a-card=<https url>" };
  try {
    const parsed = new URL(url);
    const localHttp = options.allowLocal === true && parsed.protocol === "http:" && isLoopbackHost(parsed.hostname.toLowerCase());
    if ((parsed.protocol !== "https:" && !localHttp) || parsed.username || parsed.password) {
      return { problem: options.allowLocal === true ? "--external takes an https address without credentials (http only for a loopback address, with --allow-local)" : "--external takes an https address without credentials" };
    }
  } catch {
    return { problem: "--external takes a2a-card=<https url>" };
  }
  return { kind, url };
}
