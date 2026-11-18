// The ecosystem scan's report: its stable shape (report.json, `docs/ecosystem-scan.md`), the summary counted from the
// sites, and a static HTML page with no script in which every string is escaped. Pure: no node:* import, no fetch.
//
// Three states stay three. A gate is pass, fail or unavailable. A lock is found, absent, unreadable or unusable, and a
// lock that was not found is "not checked", never clean. A published signature is `unverifiable` here, because this
// scan trusts no key (first contact is a person's decision, docs/signature-format.md): it says so, and a site that
// publishes no signature is "not signed", never a failure.

import { GATE_STATES, LOCK_STATES, type DriftReport, type GateReport, type GateState, type LockState } from "../core/types.js";
import { gateSentence, siteUnreachable } from "../gate/context.js";

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

/**
 * UAT-19 (PRI-L1-03): how soon a person looks at a site, worst first, one word per site; the report lists sites in this
 * order. `unreachable`: the site itself did not answer the gate, or its lock could not be read (down or too slow).
 * `fail`: a checker failed it. `invalid`: its signature is `invalid` against the operator's trust file (UAT-20). `block`
 * and `warn`: its drift. `not-checked`: no lock was found, or no checker answered. `ok`: none of these (a gate that some
 * checkers passed while others had no verdict is ok; its cell still says which answered).
 */
export const ATTENTION = ["unreachable", "fail", "invalid", "block", "warn", "not-checked", "ok"] as const;
export type Attention = (typeof ATTENTION)[number];

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
  /** UAT-19: how soon a person looks at it (attentionOf). Every scan since 2026-11-18 writes it. */
  attention?: Attention;
}

export interface ScanSummary {
  sites: number;
  gate: Record<GateState, number>;
  lock: Record<LockState, number>;
  drift: Record<DriftState, number>;
  signature: Record<PublishedFile["state"], number>;
  /** UAT-19: the key record's presence over every site, and the sites per attention word. */
  keyRecord?: Record<PublishedFile["state"], number>;
  attention?: Record<Attention, number>;
}

export interface ScanReport {
  schema: typeof SCAN_SCHEMA;
  version: typeof SCAN_VERSION;
  scannedAt: string;
  tool: { name: "plumbline"; version: string };
  /** What the scan sent where, in fixed sentences, before any result. */
  disclosure: string[];
  /** `adapters`: the checkers asked, present when `--adapters` named them (absent: all three, the default). */
  settings: { siteDeadlineMs: number; delayMs: number; adapters?: string[] };
  summary: ScanSummary;
  sites: SiteResult[];
}

const ATLAS_SENT =
  "The gate sends each address to Agent Atlas' public check API (https://agent-atlas-phi.vercel.app/api/check?url=<address>); that is the adapter's job. An address the gate itself refuses (not https, a private or loopback address, a name that does not resolve) is not sent.";
const ATLAS_LEFT_OUT = "Agent Atlas was not asked (--adapters left it out), so no address was sent to it.";
const CUSTOMS_READ = "Agent Customs' published receipts, index and key are read (https://montbaga.github.io/agent-customs/); nothing is sent to it.";
const CUSTOMS_LEFT_OUT = "Agent Customs was not asked (--adapters left it out), so its receipts were not read.";

/** The fixed sentences every report opens with: who was asked what (all three checkers, the default). */
export const DISCLOSURE = [
  ATLAS_SENT,
  CUSTOMS_READ,
  "Each site is read through safeFetch: https only, every resolved address public, a capped body and an absolute timeout per request, at most 3 redirects.",
  "Sites are scanned one at a time, with a fixed pause between them and one absolute deadline per site.",
  "A published signature is unverifiable here: this scan trusts no key. A site that publishes no signature is not signed, which is the publisher's choice, not a failure.",
] as const;

/**
 * The disclosure for the checkers a scan asks (UAT-11, `--adapters`): the default's sentences, with the Atlas and the
 * Customs sentence each replaced by "was not asked" when the list leaves that checker out.
 */
export function disclosureFor(adapters: readonly string[] | undefined): string[] {
  if (adapters === undefined) return [...DISCLOSURE];
  return DISCLOSURE.map((line) => (line === ATLAS_SENT && !adapters.includes("atlas") ? ATLAS_LEFT_OUT : line === CUSTOMS_READ && !adapters.includes("customs") ? CUSTOMS_LEFT_OUT : line));
}

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

/** How soon a person looks at one site (ATTENTION), from what the report holds; the first that applies wins. */
export function attentionOf(site: Pick<SiteResult, "gate" | "watch" | "drift"> & { verdict?: string }): Attention {
  if (siteUnreachable(site.gate) !== null || site.watch.lockState === "unreadable") return "unreachable";
  if (site.gate.state === "fail") return "fail";
  if (site.verdict === "invalid") return "invalid";
  if (site.drift === "block") return "block";
  if (site.drift === "warn") return "warn";
  const gateCheckedNothing = site.gate.state === "unavailable" && site.gate.findings.every((f) => f.state === "unavailable");
  if (site.drift === "not-checked" || gateCheckedNothing) return "not-checked";
  return "ok";
}

/** The counts over every site. A report state outside its enum is counted nowhere, so the sums show it. */
export function summarise(sites: SiteResult[]): ScanSummary {
  const summary: ScanSummary = {
    sites: sites.length,
    gate: zero(GATE_STATES),
    lock: zero(LOCK_STATES),
    drift: zero(DRIFT_STATES),
    signature: zero(["published", "absent", "unknown"] as const),
    keyRecord: zero(["published", "absent", "unknown"] as const),
    attention: zero(ATTENTION),
  };
  for (const site of sites) {
    if (Object.hasOwn(summary.gate, site.gate.state)) summary.gate[site.gate.state] += 1;
    const lock = site.watch.lockState ?? "found";
    if (Object.hasOwn(summary.lock, lock)) summary.lock[lock] += 1;
    if (Object.hasOwn(summary.drift, site.drift)) summary.drift[site.drift] += 1;
    if (Object.hasOwn(summary.signature, site.signature.state)) summary.signature[site.signature.state] += 1;
    const key = site.keyRecord?.state;
    if (summary.keyRecord !== undefined && key !== undefined && Object.hasOwn(summary.keyRecord, key)) summary.keyRecord[key] += 1;
    if (summary.attention !== undefined) summary.attention[site.attention ?? attentionOf(site)] += 1;
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
  unavailable: "unavailable (no verdict from some or all checkers)",
  clean: "clean",
  info: "clean (info only)",
  warn: "warn",
  block: "block",
  "not-checked": "not checked",
  published: "published",
  absent: "not published",
  unknown: "could not be read",
};

/** UAT-19 (PRI-L1-15): one word per lock state, the same in the table and the summary. */
const LOCK_WORDS: Record<string, string> = {
  found: "found",
  absent: "not published",
  refused: "refused by the browser",
  unreadable: "could not be read",
  unusable: "unusable",
};

/** UAT-19: the attention words, each saying what to do first. */
const ATTENTION_WORDS: Record<Attention, string> = {
  unreachable: "unreachable: look first",
  fail: "fail: fix the rule",
  invalid: "signature invalid: stop and escalate",
  block: "block: look before the next release",
  warn: "warn: review",
  "not-checked": "not checked",
  ok: "ok",
};

/** The `url-not-checked` caveat every found lock carries: stated once at the top of the page, not on every site (UAT-19). */
const isCaveat = (f: { code?: string; severity: string; summary: string }): boolean =>
  f.code === "url-not-checked" || (f.code === undefined && f.severity === "info" && f.summary.startsWith("Not checked from a published site:"));

/**
 * The gate cell (UAT-9): its state with the one sentence every surface uses (gate/context.ts gateSentence), so a site
 * the validator passed reads "checked by 1 of 3 (validator pass); ..." and a site that did not answer reads "the site
 * could not be reached (...)" in the alarm colour, never the grey of "a third party had no verdict".
 */
function gateCell(gate: GateReport): string {
  const down = siteUnreachable(gate) !== null;
  const word = gate.state === "unavailable" ? `unavailable: ${gateSentence(gate)}` : gate.state;
  return `<td class="s-${down ? "unreachable" : escapeHtml(gate.state)}" data-label="Gate">${escapeHtml(word)}</td>`;
}

function cell(state: string, extra = "", label = ""): string {
  const word = WORDS[state] ?? state;
  return `<td class="s-${escapeHtml(state)}"${label === "" ? "" : ` data-label="${escapeHtml(label)}"`}>${escapeHtml(word)}${extra}</td>`;
}

/** The key record cell (UAT-19, PRI-L1-10): its presence and kid, flagged when it does not match a published signature. */
function keyCell(site: SiteResult): string {
  const key = site.keyRecord ?? { state: "unknown" as const };
  const kid = key.kid !== undefined ? ` <code>${escapeHtml(key.kid)}</code>` : "";
  let flag = "";
  if (site.signature.state === "published" && key.state === "absent") flag = " (the site is signed, but a verifier cannot fetch its key record)";
  else if (site.signature.state === "published" && key.kid !== undefined && site.signature.kid !== undefined && key.kid !== site.signature.kid) {
    flag = " (another key than the signature's)";
  }
  return `<td class="s-${escapeHtml(flag === "" ? key.state : "warn")}" data-label="Key record">${escapeHtml(WORDS[key.state] ?? key.state)}${kid}${escapeHtml(flag)}</td>`;
}

/**
 * The static page: the disclosure, the summary and one row per site, worst first (UAT-19: by attention, then in list
 * order), then each site's findings in the same order. No script, no external resource, no inline handler; every string
 * from a report (addresses, summaries, refs) is escaped.
 */
export function renderHtml(report: ScanReport): string {
  const e = escapeHtml;
  const s = report.summary;
  const counts = (label: string, record: Record<string, number> | undefined, words: Record<string, string> = WORDS, skip: readonly string[] = []) =>
    record === undefined
      ? ""
      : `<li>${e(label)}: ${Object.entries(record)
          .filter(([k]) => !skip.includes(k))
          .map(([k, n]) => `${e(words[k] ?? k)} ${n}`)
          .join(", ")}</li>`;
  // worst first, then the list's own order; the anchors keep each site's index in the list
  const ordered = report.sites
    .map((site, i) => ({ site, i, attention: site.attention ?? attentionOf(site) }))
    .sort((a, b) => ATTENTION.indexOf(a.attention) - ATTENTION.indexOf(b.attention) || a.i - b.i);
  const caveat = report.sites.flatMap((site) => site.watch.findings.filter(isCaveat)).map((f) => f.summary)[0];
  const rows = ordered
    .map(({ site, i, attention }) => {
      const lock = site.watch.lockState ?? "found";
      const kid = site.signature.kid !== undefined ? ` <code>${e(site.signature.kid)}</code>` : "";
      const verdict = site.verdict !== undefined ? ` (${e(site.verdict)} here)` : "";
      return (
        `<tr><td class="a-${e(attention)}" data-label="Attention">${e(ATTENTION_WORDS[attention])}</td>` +
        `<th scope="row" data-label="Address"><a href="#site-${i}">${e(site.address)}</a></th>${gateCell(site.gate)}` +
        `<td class="s-${e(lock)}" data-label="Lock">${e(LOCK_WORDS[lock] ?? lock)}</td>${cell(site.drift, "", "Drift")}${cell(site.signature.state, kid + verdict, "Signature")}${keyCell(site)}</tr>`
      );
    })
    .join("\n");
  const details = ordered
    .map(({ site, i, attention }) => {
      const gate = site.gate.findings.map((f) => `<li>${e(f.adapter)}: <strong>${e(f.state)}</strong>. ${e(f.summary)}</li>`).join("");
      const lockLine = site.watch.lockSummary !== undefined ? `<p>Lock: ${e(LOCK_WORDS[site.watch.lockState ?? ""] ?? site.watch.lockState ?? "")}. ${e(site.watch.lockSummary)}</p>` : "";
      const drift = site.watch.findings
        .filter((f) => !isCaveat(f))
        .map((f) => `<li><strong>${e(f.severity)}</strong> ${e(f.kind)} <code>${e(f.ref)}</code>: ${e(f.summary)}</li>`)
        .join("");
      const deadline = site.deadlinePassed ? "<p>The site's deadline passed; what was not read by then is unavailable or could not be read.</p>" : "";
      return `<section id="site-${i}"><h3>${e(site.address)}</h3><p>Attention: ${e(ATTENTION_WORDS[attention])}.</p>${deadline}<h4>Gate: ${e(site.gate.state)}: ${e(gateSentence(site.gate))}</h4><ul>${gate}</ul><h4>Drift: ${e(WORDS[site.drift] ?? site.drift)}</h4>${lockLine}<ul>${drift}</ul></section>`;
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
td.s-unreachable { color: #b71c1c; font-weight: bold; }
td.s-unavailable, td.s-not-checked, td.s-unknown, td.s-absent, td.s-published { color: #424242; }
code { overflow-wrap: anywhere; } th[scope=row] { overflow-wrap: anywhere; font-weight: normal; }
td, th, li, p, h3 { overflow-wrap: anywhere; }
td.a-unreachable, td.a-fail, td.a-invalid { color: #b71c1c; font-weight: bold; } td.a-block { color: #b71c1c; } td.a-warn { color: #8a4b00; }
td.a-not-checked { color: #424242; } td.a-ok { color: #1b5e20; }
@media (max-width: 40rem) {
  table, thead, tbody, tr, th, td { display: block; width: auto; }
  thead { position: absolute; left: -9999px; }
  tr { border-bottom: 2px solid #999; padding: .4rem 0; }
  th, td { border-bottom: 0; padding: .1rem 0; }
  td[data-label]::before, th[data-label]::before { content: attr(data-label) ": "; color: #424242; font-weight: normal; }
}
</style>
</head>
<body>
<h1>Plumbline ecosystem scan</h1>
<p>Scanned ${e(report.scannedAt)} with plumbline ${e(report.tool.version)}. ${s.sites} sites. Report schema ${e(report.schema)} version ${report.version}.</p>
<h2>What this scan sent where</h2>
<ul>${report.disclosure.map((d) => `<li>${e(d)}</li>`).join("")}</ul>
<h2>Summary</h2>
<ul>${counts("Attention", s.attention, ATTENTION_WORDS)}${counts("Gate", s.gate)}${counts("Lock", s.lock, LOCK_WORDS, ["refused"])}${counts("Drift", s.drift)}${counts("Signature", s.signature)}${counts("Key record", s.keyRecord)}</ul>
<p>A gate that is unavailable is never a pass: some or all of its checkers had no verdict, and its cell says which ("checked by 1 of 3 ...", or "nothing was checked"); a site that could not be reached is marked in red. A lock that was not found means no drift was checked. A clean watch means the locked things match the lock; a gate pass is not a security review.</p>
<h2>Sites</h2>
<p>Worst first: a site that could not be read, then a failed checker, an invalid signature, block, warn, not checked, and ok.</p>${caveat === undefined ? "" : `
<p>For every site whose lock was found: ${e(caveat)}</p>`}
<table>
<thead><tr><th scope="col">Attention</th><th scope="col">Address</th><th scope="col">Gate</th><th scope="col">Lock</th><th scope="col">Drift</th><th scope="col">Signature</th><th scope="col">Key record</th></tr></thead>
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
