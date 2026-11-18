// plumbline diff <old network file> <new network file> [--json]
// The outline diff the watch counts for a changed peer (src/watch/outline.ts), for two network files on the caller's
// own disk: here names and hosts may be shown, because these are the caller's files in the caller's terminal. Control
// and bidirectional-override characters are replaced, so a name cannot rewrite the terminal or reorder the line.
// Exit 0: the outlines are the same (the bytes may still differ: formatting or non-agent content only). 1: they differ.
// 2: usage or I/O error, or a file that cannot be outlined (not JSON, not a network, or a repeated key the runtime
// would merge: it fails closed, as the validator port does).

import { readFile } from "node:fs/promises";
import { diffNamedOutlines, describeOutlineDiff, namedOutline, outlineUnchanged, type NamedOutline } from "../watch/outline.js";
import { CliError, UsageError, parseArgs } from "./args.js";
import type { Out } from "./commands.js";

export const DIFF_USAGE = "usage: plumbline diff <old network file> <new network file> [--json]";

/** A name or host made safe for a terminal line: C0, C1, DEL and the bidi controls become `?`. */
export function printable(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/g, "?");
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
  const args = parseArgs(argv, [], [], { positionals: 2 });
  const [oldPath, newPath] = args.positionals;
  if (oldPath === undefined || newPath === undefined) throw new UsageError("diff takes two network files: the old one, then the new one");
  const before = await outlineOf(oldPath, "old");
  const after = await outlineOf(newPath, "new");
  const d = diffNamedOutlines(before.outline, after.outline);
  const same = outlineUnchanged(d);
  const identicalBytes = before.text === after.text;
  const p = (names: string[]) => names.map(printable);
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
  }
  return same ? 0 : 1;
}
