// plumbline diff <old network file> <new network file> [--json]
// plumbline diff --root <site> --peer <peer address> [--allow-local] [--timeout <ms>] [--json]: a peer against the kept
// copy of what the lock pinned (UAT-18; diff-peer.ts).
// The outline diff the watch counts for a changed peer (src/watch/outline.ts), for two network files on the caller's
// own disk: here names and hosts may be shown, because these are the caller's files in the caller's terminal. Control
// and bidirectional-override characters are replaced, so a name cannot rewrite the terminal or reorder the line.
// Since 2026-11-23 (the demo film's walk; DEV-L2 "what changed inside a changed agent can never be recovered"): for each
// changed agent, the sentences of its instructions and description that were removed and added, each made printable
// and cut at 300 characters. Only for two files on the caller's own disk: the --peer form does not print them.
// Exit 0: the outlines are the same (the bytes may still differ: formatting or non-agent content only). 1: they differ.
// 2: usage or I/O error, or a file that cannot be outlined (not JSON, not a network, or a repeated key the runtime
// would merge: it fails closed, as the validator port does).

import { readFile } from "node:fs/promises";
import { diffNamedOutlines, describeOutlineDiff, namedOutline, outlineUnchanged, type NamedOutline } from "../watch/outline.js";
import { CliError, UsageError, parseArgs } from "./args.js";
import type { Out } from "./commands.js";
import { diffPeer } from "./diff-peer.js";

export const DIFF_USAGE =
  "usage: plumbline diff <old network file> <new network file> [--json]\n" +
  "       plumbline diff --root <site> --peer <peer address> [--allow-local] [--timeout <ms>] [--json]";

/** A name or host made safe for a terminal line: C0, C1, DEL and the bidi controls become `?`. */
export function printable(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "?");
}

const SENTENCE_MAX = 300;

/** An agent's words, by name: its instructions and its function description, from a network the outline accepted. */
function agentWords(text: string): Map<string, string> {
  const out = new Map<string, string>();
  try {
    const network = JSON.parse(text) as { tools?: unknown };
    if (!Array.isArray(network.tools)) return out;
    for (const tool of network.tools as Record<string, unknown>[]) {
      if (typeof tool?.name !== "string") continue;
      const fn = tool.function as { description?: unknown } | undefined;
      const words = [typeof fn?.description === "string" ? fn.description : "", typeof tool.instructions === "string" ? tool.instructions : ""].join(" ");
      out.set(tool.name, words);
    }
  } catch {
    // the outline already refused a file that is not JSON
  }
  return out;
}

/** The sentences of a text: split after . ! or ? followed by a space, trimmed, empty ones dropped. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter((x) => x !== "");
}

/** What one changed agent's words lost and gained, sentence by sentence, in the order each file states them. */
export function sentenceDiff(before: string, after: string): { removed: string[]; added: string[] } {
  const a = sentences(before);
  const b = sentences(after);
  const cut = (x: string) => printable(x.length > SENTENCE_MAX ? `${x.slice(0, SENTENCE_MAX)}…` : x);
  return { removed: a.filter((x) => !b.includes(x)).map(cut), added: b.filter((x) => !a.includes(x)).map(cut) };
}

async function outlineOf(path: string, label: string): Promise<{ text: string; outline: NamedOutline }> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new CliError(`the ${label} file could not be read`);
  }
  const outline = namedOutline(text);
  if (outline === null) {
    throw new CliError(`the ${label} file cannot be outlined: it is not a network definition in JSON, or it repeats a key inside one object (the runtime merges duplicates, so what a JSON reader sees is not what runs)`);
  }
  return { text, outline };
}

export async function diff(argv: string[], out: Out): Promise<number> {
  const args = parseArgs(argv, ["root", "peer", "timeout"], ["allow-local"], { positionals: 2 });
  // UAT-18: the second form compares the lock's kept copy of a peer with the peer now (diff-peer.ts)
  if (args.values.has("peer")) return diffPeer(args, out);
  if (args.values.has("root") || args.values.has("timeout") || args.flags.has("allow-local")) {
    throw new UsageError("--root, --timeout and --allow-local go with --peer");
  }
  const [oldPath, newPath] = args.positionals;
  if (oldPath === undefined || newPath === undefined) throw new UsageError("diff takes two network files: the old one, then the new one");
  const before = await outlineOf(oldPath, "old");
  const after = await outlineOf(newPath, "new");
  const d = diffNamedOutlines(before.outline, after.outline);
  const same = outlineUnchanged(d);
  const identicalBytes = before.text === after.text;
  const p = (names: string[]) => names.map(printable);
  const wordsBefore = agentWords(before.text);
  const wordsAfter = agentWords(after.text);
  const changes = d.agentsChanged.map((name) => ({ agent: printable(name), ...sentenceDiff(wordsBefore.get(name) ?? "", wordsAfter.get(name) ?? "") }));
  const frontBefore = before.outline.front === null ? null : printable(before.outline.front);
  const frontAfter = after.outline.front === null ? null : printable(after.outline.front);
  const summary = same
    ? identicalBytes
      ? "The files are identical."
      : "Formatting or non-agent content only: no agent, outbound host or front agent changed."
    : `In outline: ${describeOutlineDiff(d)}.`;
  if (args.json) {
    out(
      JSON.stringify(
        {
          identicalBytes,
          sameOutline: same,
          agentsAdded: p(d.agentsAdded),
          agentsRemoved: p(d.agentsRemoved),
          agentsChanged: p(d.agentsChanged),
          hostsAdded: p(d.hostsAdded),
          hostsRemoved: p(d.hostsRemoved),
          front: { before: frontBefore, after: frontAfter, changed: d.frontChanged },
          changes,
          summary,
        },
        null,
        2,
      ),
    );
  } else {
    out(summary);
    const line = (label: string, names: string[]) => {
      if (names.length > 0) out(`${label}: ${p(names).join(", ")}`);
    };
    line("agents added", d.agentsAdded);
    line("agents removed", d.agentsRemoved);
    line("agents changed", d.agentsChanged);
    line("outbound hosts added", d.hostsAdded);
    line("outbound hosts removed", d.hostsRemoved);
    if (d.frontChanged) out(`front agent: ${frontBefore ?? "(none)"} -> ${frontAfter ?? "(none)"}`);
    for (const c of changes) {
      if (c.removed.length === 0 && c.added.length === 0) {
        out(`${c.agent}: its words are the same; another part of its definition changed`);
        continue;
      }
      out(`${c.agent}:`);
      for (const x of c.removed) out(`  - ${x}`);
      for (const x of c.added) out(`  + ${x}`);
    }
  }
  return same ? 0 : 1;
}
