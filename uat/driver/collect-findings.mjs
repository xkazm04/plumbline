#!/usr/bin/env node
// node uat/driver/collect-findings.mjs <run folder>
// Builds <run>/findings.json from the fenced ```json blocks under each "## Findings" heading (L1, and any later
// "## Findings (L2)") of the per-Character reports. A run's only machine-readable output must not depend on one agent
// writing it by hand. Later blocks win for a repeated id (L2 re-scores a carried finding), and the earlier impact and
// severity are kept as impact_l1 / severity_l1 when they differ. Prints a count table; exits 1 on a block that does not
// parse or a severity outside the rubric's legend.

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SEVERITIES = ["blocker", "major", "minor", "polish"];
const SCORE = { low: 1, med: 2, high: 3 };

const run = process.argv[2];
if (!run) {
  console.error("usage: node uat/driver/collect-findings.mjs <run folder>");
  process.exit(2);
}

const byId = new Map();
const problems = [];
const files = (await readdir(run)).filter((name) => /--.+\.md$/.test(name)).sort();
for (const file of files) {
  const text = await readFile(path.join(run, file), "utf8");
  // every fenced json block that follows a heading starting with "## Findings"
  const sections = text.split(/^## /m).filter((section) => /^Findings/.test(section));
  for (const section of sections) {
    for (const match of section.matchAll(/```json\s*\n([\s\S]*?)\n```/g)) {
      let rows;
      try {
        rows = JSON.parse(match[1]);
      } catch (error) {
        problems.push(`${file}: a findings block is not JSON (${error.message})`);
        continue;
      }
      if (!Array.isArray(rows)) {
        problems.push(`${file}: a findings block is not an array`);
        continue;
      }
      for (const row of rows) {
        if (!row || typeof row.id !== "string") {
          problems.push(`${file}: a finding has no id`);
          continue;
        }
        if (!row.strength && !SEVERITIES.includes(row.severity)) {
          problems.push(`${file}: ${row.id} has severity "${row.severity}", outside the rubric's legend`);
        }
        const before = byId.get(row.id);
        if (before) {
          const merged = { ...before, ...row };
          if (before.severity !== row.severity && row.severity !== undefined) merged.severity_l1 = before.severity_l1 ?? before.severity;
          if (row.impact && JSON.stringify(before.impact) !== JSON.stringify(row.impact)) merged.impact_l1 = before.impact_l1 ?? before.impact;
          byId.set(row.id, merged);
        } else {
          byId.set(row.id, { ...row, source: file });
        }
      }
    }
  }
}

const rank = (finding) => {
  const i = finding.impact ?? {};
  return (SCORE[i.frequency] ?? 0) * (SCORE[i.reachability] ?? 0) * (SCORE[i.trust_erosion] ?? 0);
};
const findings = [...byId.values()].map((finding) => ({ ...finding, rank: rank(finding) }));
findings.sort((a, b) => Number(Boolean(a.strength)) - Number(Boolean(b.strength)) || b.rank - a.rank || a.id.localeCompare(b.id));
await writeFile(path.join(run, "findings.json"), JSON.stringify(findings, null, 2) + "\n");

const counts = {};
for (const finding of findings) {
  const who = finding.character ?? "unknown";
  counts[who] ??= { blocker: 0, major: 0, minor: 0, polish: 0, strength: 0 };
  if (finding.strength) counts[who].strength += 1;
  else if (SEVERITIES.includes(finding.severity)) counts[who][finding.severity] += 1;
}
console.table(counts);
console.log(`${findings.length} rows from ${files.length} reports -> ${path.join(run, "findings.json")}`);
for (const problem of problems) console.error(problem);
process.exit(problems.length ? 1 : 0);
