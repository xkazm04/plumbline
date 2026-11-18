// A peer's network definition in outline: what changed, said without quoting it. Pure: no node:* import, so the CLI's
// watch, its capture and the Desk's drift reader (through watch/observe.js) compute the same outline from the same
// bytes; scripts/build-site.mjs copies it into site/lib/plumbline/watch/.
//
// The outline of a network definition (the JSON the runtime loads, `{ tools: [agent, ...], link_labels? }`):
//   agents  per agent, SHA-256 of canonicalJson(the agent object), keyed by SHA-256 of the agent's name. A name is a
//           stranger's word, so it is hashed, never stored or quoted; equal hashes say "the same agent".
//   hosts   the set of outbound hosts: the host of every http(s) address in an agent's `tools` (remote agents and MCP
//           endpoints alike) and of every `link_labels` key, lowercased, each as SHA-256, sorted.
//   front   SHA-256 of the front agent's name, by the reference's rule (gate/validator.ts findFrontAgent); omitted when
//           the network has none.
// A file the outline cannot stand for is no outline (null), and the caller says so: text that is not JSON, a value that
// is not an object with a `tools` array, a value canonical JSON refuses, or a file that repeats a key inside one object
// (the runtime's HOCON reader merges duplicates, so JSON.parse's reading is not what runs; the validator port fails
// closed on the same files, gate/validator.ts duplicateKeyIssues).

import { canonicalJson, sha256Hex } from "../core/canonical.js";
import { countDuplicateKeys } from "../core/json-keys.js";
import type { PeerOutline } from "../core/types.js";
import { findFrontAgent } from "../gate/validator.js";

/** The outline the lock records for a peer: the wire's `PeerRecord.outline` (core/types.ts). */
export type { PeerOutline };

/** The same outline with the names and hosts in clear: only for the caller's own files (`plumbline diff`). */
export interface NamedOutline {
  agents: Map<string, string>;
  hosts: Set<string>;
  front: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isHttp = (v: unknown): v is string => typeof v === "string" && /^https?:\/\//i.test(v);

function hostOf(address: string): string | null {
  try {
    const host = new URL(address).host.toLowerCase();
    return host === "" ? null : host;
  } catch {
    return null;
  }
}

/**
 * The outline with names in clear, or null when the text cannot be outlined (see the header). Throws nothing.
 * An agent without a string name is keyed by its position (`#<index>`), so it still counts.
 */
export function namedOutline(text: string): NamedOutline | null {
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^﻿/, ""));
    if (countDuplicateKeys(text) > 0) return null;
  } catch {
    return null;
  }
  if (!isObject(value) || !Array.isArray(value.tools)) return null;
  const agents = new Map<string, string>();
  const hosts = new Set<string>();
  try {
    value.tools.forEach((agent: unknown, index: number) => {
      const name = isObject(agent) && typeof agent.name === "string" ? agent.name : `#${index}`;
      agents.set(name, canonicalJson(agent));
      if (isObject(agent) && Array.isArray(agent.tools)) {
        for (const t of agent.tools) {
          const host = isHttp(t) ? hostOf(t) : null;
          if (host !== null) hosts.add(host);
        }
      }
    });
  } catch {
    return null; // canonical JSON refused a value (a non-finite number)
  }
  if (isObject(value.link_labels)) {
    for (const key of Object.keys(value.link_labels)) {
      const host = isHttp(key) ? hostOf(key) : null;
      if (host !== null) hosts.add(host);
    }
  }
  const front = findFrontAgent(value);
  return { agents, hosts, front: front === null || front === "" ? null : front };
}

/** The outline the lock records: every name, definition and host as SHA-256. Null when the text cannot be outlined. */
export async function peerOutline(bytes: Uint8Array | string): Promise<PeerOutline | null> {
  const text = typeof bytes === "string" ? bytes : new TextDecoder("utf-8").decode(bytes);
  const named = namedOutline(text);
  if (named === null) return null;
  const agents: Record<string, string> = {};
  for (const [name, canonical] of named.agents) agents[await sha256Hex(name)] = await sha256Hex(canonical);
  const hosts = [...new Set(await Promise.all([...named.hosts].map((h) => sha256Hex(h))))].sort();
  return { agents, hosts, ...(named.front !== null ? { front: await sha256Hex(named.front) } : {}) };
}

const HEX = /^[0-9a-f]{64}$/;

/** True for a value in the outline's exact shape: the lock's rule for `peers[url].outline`. */
export function isPeerOutline(v: unknown): v is PeerOutline {
  if (!isObject(v) || !isObject(v.agents) || !Array.isArray(v.hosts)) return false;
  if (!Object.entries(v.agents).every(([k, h]) => HEX.test(k) && typeof h === "string" && HEX.test(h))) return false;
  if (!v.hosts.every((h) => typeof h === "string" && HEX.test(h))) return false;
  if (v.front !== undefined && !(typeof v.front === "string" && HEX.test(v.front))) return false;
  return Object.keys(v).every((k) => k === "agents" || k === "hosts" || k === "front");
}

/** What differs between two outlines, as counts (and, for named outlines, the names). */
export interface OutlineDiff<T = string> {
  agentsAdded: T[];
  agentsRemoved: T[];
  agentsChanged: T[];
  hostsAdded: T[];
  hostsRemoved: T[];
  frontChanged: boolean;
}

function diffMaps<T>(before: Map<T, string>, after: Map<T, string>, beforeHosts: Set<T>, afterHosts: Set<T>, frontBefore: T | null | undefined, frontAfter: T | null | undefined): OutlineDiff<T> {
  const sort = (a: T[]) => a.sort((x, y) => (String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0));
  return {
    agentsAdded: sort([...after.keys()].filter((k) => !before.has(k))),
    agentsRemoved: sort([...before.keys()].filter((k) => !after.has(k))),
    agentsChanged: sort([...after.keys()].filter((k) => before.has(k) && before.get(k) !== after.get(k))),
    hostsAdded: sort([...afterHosts].filter((h) => !beforeHosts.has(h))),
    hostsRemoved: sort([...beforeHosts].filter((h) => !afterHosts.has(h))),
    frontChanged: (frontBefore ?? null) !== (frontAfter ?? null),
  };
}

export function diffOutlines(before: PeerOutline, after: PeerOutline): OutlineDiff {
  return diffMaps(new Map(Object.entries(before.agents)), new Map(Object.entries(after.agents)), new Set(before.hosts), new Set(after.hosts), before.front, after.front);
}

export function diffNamedOutlines(before: NamedOutline, after: NamedOutline): OutlineDiff {
  return diffMaps(before.agents, after.agents, before.hosts, after.hosts, before.front, after.front);
}

/** True when nothing an outline sees differs. */
export function outlineUnchanged(d: OutlineDiff<unknown>): boolean {
  return d.agentsAdded.length + d.agentsRemoved.length + d.agentsChanged.length + d.hostsAdded.length + d.hostsRemoved.length === 0 && !d.frontChanged;
}

/** The counts in fixed words: "agents: 1 added, 0 removed, 2 changed; outbound hosts: 1 added, 0 removed; front agent: unchanged". */
export function describeOutlineDiff(d: OutlineDiff<unknown>): string {
  return (
    `agents: ${d.agentsAdded.length} added, ${d.agentsRemoved.length} removed, ${d.agentsChanged.length} changed; ` +
    `outbound hosts: ${d.hostsAdded.length} added, ${d.hostsRemoved.length} removed; ` +
    `front agent: ${d.frontChanged ? "changed" : "unchanged"}`
  );
}
