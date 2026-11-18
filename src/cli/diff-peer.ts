// plumbline diff --root <site> --peer <peer address> [--allow-local] [--timeout <ms>] [--json]
// UAT-18 (DEV-L1-03, DEV-L1-10): what changed in a partner since the lock pinned it, by name, from one command. The old
// definition and links.json are the publisher's kept copies (src/watch/kept.ts, written beside the lock by init and
// every relock); the new ones are fetched now through safeFetch, as the watch fetches them. It shows the agents added,
// removed and changed, each changed agent's fields old and new, the outbound hosts added and removed, the front agent,
// and what the peer's links.json routes to that it did not. Names and text appear here because this is the publisher's
// own terminal, never in an alert (guardrail 2); control and bidirectional-override characters are replaced.
// Exit 0: the definition's bytes and the links.json are as the lock pinned them. 1: something differs. 2: usage or I/O
// error: no lock, a peer the lock does not pin, no kept copy (said, with the relock that keeps one), the peer not
// readable now, or a definition that cannot be outlined.

import { LINKS_FILE, PEER_LINKS_ABSENT } from "../core/types.js";
import { hashBytes } from "../net/canonical.js";
import { locatePeerFile } from "../net/locate.js";
import { DEFAULT_TIMEOUT_MS, safeFetch } from "../net/safe-fetch.js";
import { describeWatchError } from "../watch/observe.js";
import { KEPT_DIR, keptRef, readKept } from "../watch/kept.js";
import { readLock } from "../watch/lock.js";
import { describeOutlineDiff, diffNamedOutlines, linksHosts, namedOutline, outlineUnchanged } from "../watch/outline.js";
import { CliError, UsageError, type ParsedArgs } from "./args.js";
import type { Out } from "./commands.js";
import { printable } from "./diff-command.js";
import { ALLOW_LOCAL_WARNING } from "./gate-command.js";
import { resolve } from "node:path";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const decode = (bytes: Uint8Array): string => new TextDecoder("utf-8").decode(bytes);

/** Each agent of a network definition by name (an agent without a string name by `#<index>`, as the outline keys it). */
function agentsByName(text: string): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return out;
  }
  if (!isObject(value) || !Array.isArray(value.tools)) return out;
  value.tools.forEach((agent: unknown, index: number) => {
    const name = isObject(agent) && typeof agent.name === "string" ? agent.name : `#${index}`;
    out.set(name, isObject(agent) ? agent : { value: agent });
  });
  return out;
}

/** A changed agent's fields that differ, old and new, as JSON text (made printable by the caller). */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): { key: string; before?: string; after?: string }[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const out: { key: string; before?: string; after?: string }[] = [];
  for (const key of keys) {
    const a = Object.hasOwn(before, key) ? JSON.stringify(before[key]) : undefined;
    const b = Object.hasOwn(after, key) ? JSON.stringify(after[key]) : undefined;
    if (a === b) continue;
    out.push({ key, ...(a !== undefined ? { before: a } : {}), ...(b !== undefined ? { after: b } : {}) });
  }
  return out;
}

async function fetchNow(url: string, options: object): Promise<{ state: "absent" } | { state: "present"; bytes: Uint8Array }> {
  let response;
  try {
    response = await safeFetch(url, options);
  } catch (error) {
    throw new CliError(`the peer could not be read now (${describeWatchError(error)}), so nothing was compared`);
  }
  if (response.status === 404 || response.status === 410) return { state: "absent" };
  if (!response.ok) throw new CliError(`the peer answered HTTP ${response.status} now, so nothing was compared`);
  return { state: "present", bytes: response.bytes };
}

export async function diffPeer(args: ParsedArgs, out: Out): Promise<number> {
  if (args.positionals.length > 0) throw new UsageError("diff --peer compares the lock's kept copy with the peer now: it takes no files");
  const peer = args.values.get("peer") ?? "";
  if (peer === "") throw new UsageError("--peer takes a peer address the lock pins");
  const rootValue = args.values.get("root");
  if (rootValue === "") throw new UsageError("--root takes a folder");
  const root = resolve(rootValue ?? ".");
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  const timeoutValue = args.values.get("timeout");
  if (timeoutValue !== undefined) {
    const n = Number(timeoutValue);
    if (!Number.isFinite(n) || n <= 0) throw new UsageError("--timeout takes a positive number of milliseconds");
    timeoutMs = n;
  }
  const allowLocal = args.flags.has("allow-local");
  if (allowLocal) process.stderr.write(`${ALLOW_LOCAL_WARNING}\n`);

  const read = await readLock(root);
  if (read.kind !== "ok") throw new CliError(`there is no usable plumbline.lock.json in ${rootValue ?? "."} (${read.kind === "missing" ? "none" : read.why}), so there is no pinned definition to compare with`);
  const record = read.lock.peers[peer];
  if (record === undefined) {
    if (peer in (read.lock.pendingPeers ?? {})) throw new CliError("the lock holds this peer as pending: it was never captured, so there is no pinned definition to compare with");
    throw new CliError("the lock pins no peer at that address (use the address exactly as the lock and the drift issue name it)");
  }
  const old = await readKept(root, record.sha256);
  if (!("bytes" in old)) {
    throw new CliError(
      "missing" in old
        ? `there is no kept copy of the definition the lock pinned for this peer (${keptRef(record.sha256)}): the lock was written before copies were kept, or ${KEPT_DIR}/ was not committed with it. After a review, re-lock (plumbline watch --root ${rootValue ?? "."} --relock) to keep one, and commit it with the lock.`
        : `the kept copy ${keptRef(record.sha256)} cannot be used: ${old.problem}`,
    );
  }
  const fetchOptions = { timeoutMs, ...(allowLocal ? { allowLocal: true } : {}) };
  let located;
  try {
    located = await locatePeerFile(peer, safeFetch, fetchOptions);
  } catch (error) {
    throw new CliError(`the peer could not be read now (${describeWatchError(error)}), so nothing was compared`);
  }
  const now = await fetchNow(located.fileUrl, fetchOptions);
  if (now.state === "absent") throw new CliError("the peer's network definition is not published now (HTTP 404 or 410), so nothing was compared");
  const nowHash = await hashBytes(now.bytes);
  const oldText = decode(old.bytes);
  const newText = decode(now.bytes);
  const before = namedOutline(oldText);
  const after = namedOutline(newText);
  if (before === null || after === null) {
    throw new CliError(`the ${before === null ? "kept" : "current"} definition cannot be outlined: it is not a network definition in JSON, or it repeats a key inside one object (the runtime merges duplicates)`);
  }
  const d = diffNamedOutlines(before, after);
  const oldAgents = agentsByName(oldText);
  const newAgents = agentsByName(newText);
  const changes = d.agentsChanged.map((name) => ({ agent: name, fields: changedFields(oldAgents.get(name) ?? {}, newAgents.get(name) ?? {}) }));

  // links.json: the kept copy of the locked one (or none, when the lock recorded none) against the one served now
  const linksNow = await fetchNow(`${located.base}${LINKS_FILE}`, fetchOptions);
  let links: { state: "unchanged" | "appeared" | "gone" | "changed" | "untracked" | "not-kept"; hostsAdded: string[]; hostsRemoved: string[] };
  const nowLinksHash = linksNow.state === "present" ? await hashBytes(linksNow.bytes) : PEER_LINKS_ABSENT;
  const hostsOf = (bytes: Uint8Array | undefined) => [...(bytes === undefined ? [] : (linksHosts(bytes) ?? []))];
  if (record.links === undefined) {
    links = { state: "untracked", hostsAdded: [], hostsRemoved: [] };
  } else if (record.links === nowLinksHash) {
    links = { state: "unchanged", hostsAdded: [], hostsRemoved: [] };
  } else {
    let oldBytes: Uint8Array | undefined;
    let kept = true;
    if (record.links !== PEER_LINKS_ABSENT) {
      const k = await readKept(root, record.links);
      if ("bytes" in k) oldBytes = k.bytes;
      else kept = false;
    }
    const newBytes = linksNow.state === "present" ? linksNow.bytes : undefined;
    const oldHosts = new Set(hostsOf(oldBytes));
    const newHosts = new Set(hostsOf(newBytes));
    const definitionHosts = new Set([...before.hosts, ...after.hosts]);
    links = !kept
      ? { state: "not-kept", hostsAdded: [...newHosts].filter((h) => !definitionHosts.has(h)).sort(), hostsRemoved: [] }
      : {
          state: record.links === PEER_LINKS_ABSENT ? "appeared" : newBytes === undefined ? "gone" : "changed",
          hostsAdded: [...newHosts].filter((h) => !oldHosts.has(h)).sort(),
          hostsRemoved: [...oldHosts].filter((h) => !newHosts.has(h)).sort(),
        };
  }

  const identicalBytes = nowHash === record.sha256;
  const same = outlineUnchanged(d);
  const linksSame = links.state === "unchanged" || links.state === "untracked";
  const summary = identicalBytes
    ? "The definition is the one the lock pinned."
    : same
      ? "Formatting or non-agent content only: no agent, outbound host or front agent changed."
      : `In outline: ${describeOutlineDiff(d)}.`;
  const p = (names: readonly string[]) => names.map(printable);
  const front = { before: before.front === null ? null : printable(before.front), after: after.front === null ? null : printable(after.front), changed: d.frontChanged };
  const pinnedOn = /^\d{4}-\d{2}-\d{2}/.test(record.checkedAt) ? record.checkedAt.slice(0, 10) : "an unknown date";
  if (args.json) {
    out(
      JSON.stringify(
        {
          peer,
          pinned: record.sha256,
          pinnedAt: record.checkedAt,
          now: nowHash,
          kept: keptRef(record.sha256),
          ...(old.lineEndings !== undefined ? { keptLineEndings: old.lineEndings } : {}),
          identicalBytes,
          sameOutline: same,
          agentsAdded: p(d.agentsAdded),
          agentsRemoved: p(d.agentsRemoved),
          agentsChanged: p(d.agentsChanged),
          changes: changes.map((c) => ({ agent: printable(c.agent), fields: c.fields.map((f) => ({ key: printable(f.key), ...(f.before !== undefined ? { before: printable(f.before) } : {}), ...(f.after !== undefined ? { after: printable(f.after) } : {}) })) })),
          hostsAdded: p(d.hostsAdded),
          hostsRemoved: p(d.hostsRemoved),
          front,
          links: { state: links.state, hostsAdded: p(links.hostsAdded), hostsRemoved: p(links.hostsRemoved) },
          summary,
        },
        null,
        2,
      ),
    );
  } else {
    out(`peer ${printable(peer)}: the lock pinned ${record.sha256.slice(0, 12)} on ${pinnedOn} (kept copy ${keptRef(record.sha256)}); it serves ${nowHash.slice(0, 12)} now`);
    if (old.lineEndings !== undefined) out(`note: the kept copy was checked out with ${old.lineEndings === "crlf" ? "CRLF" : "LF"} line endings; it is compared as the lock pinned it`);
    out(summary);
    const line = (label: string, names: readonly string[]) => {
      if (names.length > 0) out(`${label}: ${p(names).join(", ")}`);
    };
    line("agents added", d.agentsAdded);
    line("agents removed", d.agentsRemoved);
    for (const c of changes) {
      out(`agent changed: ${printable(c.agent)}`);
      for (const f of c.fields) out(`  ${printable(f.key)}: ${f.before === undefined ? "(absent)" : printable(f.before)} -> ${f.after === undefined ? "(absent)" : printable(f.after)}`);
    }
    line("outbound hosts added", d.hostsAdded);
    line("outbound hosts removed", d.hostsRemoved);
    if (d.frontChanged) out(`front agent: ${front.before ?? "(none)"} -> ${front.after ?? "(none)"}`);
    const linksLine = {
      unchanged: "links.json: as the lock pinned it",
      untracked: "links.json: the lock does not record this peer's links.json, so it is not compared (re-lock to track it)",
      appeared: "links.json: the peer now publishes one; the lock recorded none",
      gone: "links.json: gone since the lock was written",
      changed: "links.json: changed since the lock was written",
      "not-kept": `links.json: changed since the lock was written; there is no kept copy of the locked one, so only the hosts it names that the definition does not are listed`,
    }[links.state];
    out(linksLine);
    line("links.json outbound hosts added", links.hostsAdded);
    line("links.json outbound hosts removed", links.hostsRemoved);
  }
  return identicalBytes && linksSame ? 0 : 1;
}
