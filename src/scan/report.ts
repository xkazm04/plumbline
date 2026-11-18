// The ecosystem scan's report: its stable shape (report.json, `docs/ecosystem-scan.md`), the summary counted from the
// sites, and a static HTML page with no script in which every string is escaped. Pure: no node:* import, no fetch.
//
// Three states stay three. A gate is pass, fail or unavailable. A lock is found, absent, unreadable or unusable, and a
// lock that was not found is "not checked", never clean. A published signature is `unverifiable` here, because this
// scan trusts no key (first contact is a person's decision, docs/signature-format.md): it says so, and a site that
// publishes no signature is "not signed", never a failure.

import { GATE_STATES, LOCK_STATES, type DriftReport, type GateReport, type GateState, type LockState } from "../core/types.js";

export const SCAN_SCHEMA = "plumbline-ecosystem-scan" as const;
export const SCAN_VERSION = 1 as const;

/** What the scan saw of a published Plumbline file: its presence, and the kid when it is in its exact pattern. */
export interface PublishedFile {
  /** `published` (2xx), `absent` (404 or 410), or `unknown` (any other answer, a failure, the deadline). */
  state: "published" | "absent" | "unknown";
  /** Only a kid in its exact pattern (16 lowercase hex) is recorded; anything else is left out, never quoted. */
  kid?: string;
}

/** One site's drift in one word: the worst severity of a found lock, or `not-checked` when no lock was found. */
export const DRIFT_STATES = ["clean", "info", "warn", "block", "not-checked"] as const;
export type DriftState = (typeof DRIFT_STATES)[number];

export interface SiteResult {
  /** The address from the list, as given (the list is the scan operator's). */
  address: string;
  gate: GateReport;
  watch: DriftReport;
  drift: DriftState;
  signature: PublishedFile;
  keyRecord: PublishedFile;
  /**
   * The signature's verdict here: `unverifiable` when one is published (this scan trusts no key), absent otherwise.
   * Never `verified` and never `invalid`: nothing was verified.
   */
  verdict?: "unverifiable";
  /** How long the site took, and whether its deadline passed (then whatever was not read is unknown or unavailable). */
  elapsedMs: number;
  deadlinePassed: boolean;
}

export interface ScanSummary {
  sites: number;
  gate: Record<GateState, number>;
  lock: Record<LockState, number>;
  drift: Record<DriftState, number>;
  signature: Record<PublishedFile["state"], number>;
}

export interface ScanReport {
  schema: typeof SCAN_SCHEMA;
  version: typeof SCAN_VERSION;
  scannedAt: string;
  tool: { name: "plumbline"; version: string };
  /** What the scan sent where, in fixed sentences, before any result. */
  disclosure: string[];
  settings: { siteDeadlineMs: number; delayMs: number };
  summary: ScanSummary;
  sites: SiteResult[];
}

/** The fixed sentences every report opens with: who was asked what. */
export const DISCLOSURE = [
  "The gate sends each address to Agent Atlas' public check API (https://agent-atlas-phi.vercel.app/api/check?url=<address>); that is the adapter's job.",
  "Agent Customs' published receipts, index and key are read (https://montbaga.github.io/agent-customs/); nothing is sent to it.",
  "Each site is read through safeFetch: https only, every resolved address public, a capped body and an absolute timeout per request, at most 3 redirects.",
  "Sites are scanned one at a time, with a fixed pause between them and one absolute deadline per site.",
  "A published signature is unverifiable here: this scan trusts no key. A site that publishes no signature is not signed, which is the publisher's choice, not a failure.",
] as const;

const zero = <K extends string>(keys: readonly K[]): Record<K, number> => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

/** One word for a site's drift: the worst severity of a found lock, or `not-checked`. Info alone is `info`, which is clean. */
export function driftStateOf(watch: DriftReport): DriftState {
  if (watch.lockState !== undefined && watch.lockState !== "found") return "not-checked";
  const severities = new Set(watch.findings.map((f) => f.severity));
  if (severities.has("block")) return "block";
  if (severities.has("warn")) return "warn";
  if (severities.has("info")) return "info";
  return "clean";
}

/** The counts over every site. A report state outside its enum is counted nowhere, so the sums show it. */
export function summarise(sites: SiteResult[]): ScanSummary {
  const summary: ScanSummary = {
    sites: sites.length,
    gate: zero(GATE_STATES),
    lock: zero(LOCK_STATES),
    drift: zero(DRIFT_STATES),
    signature: zero(["published", "absent", "unknown"] as const),
  };
  for (const site of sites) {
    if (Object.hasOwn(summary.gate, site.gate.state)) summary.gate[site.gate.state] += 1;
    const lock = site.watch.lockState ?? "found";
    if (Object.hasOwn(summary.lock, lock)) summary.lock[lock] += 1;
    if (Object.hasOwn(summary.drift, site.drift)) summary.drift[site.drift] += 1;
    if (Object.hasOwn(summary.signature, site.signature.state)) summary.signature[site.signature.state] += 1;
  }
  return summary;
}

/** HTML text and attribute escaping: the five characters that can change markup. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

const WORDS: Record<string, string> = {
  pass: "pass",
  fail: "fail",
  unavailable: "unavailable (not checked)",
  clean: "clean",
  info: "clean (info only)",
  warn: "warn",
  block: "block",
  "not-checked": "not checked",
  published: "published",
  absent: "not published",
  unknown: "could not be read",
};

function cell(state: string, extra = ""): string {
  const word = WORDS[state] ?? state;
  return `<td class="s-${escapeHtml(state)}">${escapeHtml(word)}${extra}</td>`;
}

/**
 * The static page: the disclosure, the summary and one row per site, then each site's findings. No script, no external
 * resource, no inline handler; every string from a report (addresses, summaries, refs) is escaped.
 */
export function renderHtml(report: ScanReport): string {
  const e = escapeHtml;
  const s = report.summary;
  const counts = (label: string, record: Record<string, number>) =>
    `<li>${e(label)}: ${Object.entries(record)
      .map(([k, n]) => `${e(WORDS[k] ?? k)} ${n}`)
      .join(", ")}</li>`;
  const rows = report.sites
    .map((site, i) => {
      const lock = site.watch.lockState ?? "found";
      const kid = site.signature.kid !== undefined ? ` <code>${e(site.signature.kid)}</code>` : "";
      const verdict = site.verdict !== undefined ? ` (${e(site.verdict)} here)` : "";
      return `<tr><th scope="row"><a href="#site-${i}">${e(site.address)}</a></th>${cell(site.gate.state)}<td>${e(lock)}</td>${cell(site.drift)}${cell(site.signature.state, kid + verdict)}</tr>`;
    })
    .join("\n");
  const details = report.sites
    .map((site, i) => {
      const gate = site.gate.findings.map((f) => `<li>${e(f.adapter)}: <strong>${e(f.state)}</strong>. ${e(f.summary)}</li>`).join("");
      const lockLine = site.watch.lockSummary !== undefined ? `<p>Lock: ${e(site.watch.lockState ?? "")}. ${e(site.watch.lockSummary)}</p>` : "";
      const drift = site.watch.findings.map((f) => `<li><strong>${e(f.severity)}</strong> ${e(f.kind)} <code>${e(f.ref)}</code>: ${e(f.summary)}</li>`).join("");
      const deadline = site.deadlinePassed ? "<p>The site's deadline passed; what was not read by then is unavailable or could not be read.</p>" : "";
      return `<section id="site-${i}"><h3>${e(site.address)}</h3>${deadline}<h4>Gate: ${e(site.gate.state)}</h4><ul>${gate}</ul><h4>Drift: ${e(WORDS[site.drift] ?? site.drift)}</h4>${lockLine}<ul>${drift}</ul></section>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Plumbline ecosystem scan</title>
<style>
body { font: 15px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 70rem; padding: 1rem; color: #1b1b1b; background: #fff; }
table { border-collapse: collapse; width: 100%; } th, td { border-bottom: 1px solid #ccc; padding: .3rem .5rem; text-align: left; vertical-align: top; }
td.s-pass, td.s-clean, td.s-info { color: #1b5e20; } td.s-fail, td.s-block { color: #b71c1c; } td.s-warn { color: #8a4b00; }
td.s-unavailable, td.s-not-checked, td.s-unknown, td.s-absent, td.s-published { color: #424242; }
code { overflow-wrap: anywhere; } th[scope=row] { overflow-wrap: anywhere; font-weight: normal; }
</style>
</head>
<body>
<h1>Plumbline ecosystem scan</h1>
<p>Scanned ${e(report.scannedAt)} with plumbline ${e(report.tool.version)}. ${s.sites} sites. Report schema ${e(report.schema)} version ${report.version}.</p>
<h2>What this scan sent where</h2>
<ul>${report.disclosure.map((d) => `<li>${e(d)}</li>`).join("")}</ul>
<h2>Summary</h2>
<ul>${counts("Gate", s.gate)}${counts("Lock", s.lock)}${counts("Drift", s.drift)}${counts("Signature", s.signature)}</ul>
<p>A gate that is unavailable was not checked; it is never a pass. A lock that was not found means no drift was checked. A clean watch means the locked things match the lock; a gate pass is not a security review.</p>
<h2>Sites</h2>
<table>
<thead><tr><th scope="col">Address</th><th scope="col">Gate</th><th scope="col">Lock</th><th scope="col">Drift</th><th scope="col">Signature</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
<h2>Details</h2>
${details}
</body>
</html>
`;
}
