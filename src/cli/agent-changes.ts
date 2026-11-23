// How `agent relock` words what a new lock changes for each server. Owned by the review work (changed keys, marks).

import { type ServerChange } from "../agent/build.js";

const SOURCE_WORDS: Record<ServerChange["source"], string> = {
  pending: "from what the guard saw",
  listed: "listed now",
  kept: "kept from the earlier lock",
  none: "not yet observed",
};

export function serverLine(s: ServerChange): string {
  const base = `  server ${s.server} (${SOURCE_WORDS[s.source]}): tools ${s.added} added, ${s.removed} removed, ${s.changed} changed`;
  const names = [
    ...(s.addedNames && s.addedNames.length > 0 ? [`added ${s.addedNames.join(", ")}`] : []),
    ...(s.changedNames && s.changedNames.length > 0 ? [`changed ${s.changedNames.join(", ")}`] : []),
  ];
  return names.length > 0 ? `${base} (${names.join("; ")})` : base;
}
