// The owner's line (UAT-29: MAR-L1-06, MAR-RC-2): one sentence in a site owner's words that opens the drift issue, the
// relock pull request and the Desk's drift result, above the technical table (which stays: the developer and the
// policy reader quote it). It is generated from the findings' codes and counts (UAT-17, DriftCounts), never from a
// sentence and never from a stranger's words: a page is named only by a plain file name the site's own lock holds, a
// partner never by its address. It is never greener than the findings behind it: a page whose facts could not all be
// checked is "could not tell", an unreachable partner is "not an all-clear", and a clean report has no owner line.
//
// Pure: no node:* import, so the Desk runs it (site/lib/plumbline/watch/owner.js) and the CLI could. action/report.mjs
// keeps the same function word for word, because the Action runs that file with no build; action/report.test.mjs holds
// the two to the same cases.

/** The slice of a finding the line reads: its code, ref and counts (a report written before codes has none). */
export interface OwnerFinding {
  severity: string;
  code?: string;
  ref?: string;
  counts?: {
    factsWatched?: number;
    factsGone?: number;
    factsUnplaced?: number;
    factsStale?: number;
    staleKinds?: Record<string, number | undefined>;
  };
  /** Since 2026-11-23: a stale fact's values (StaleFact), for the line to name. */
  facts?: { kind?: string; was?: string; now?: string }[];
  actual?: string;
}

export interface OwnerContext {
  /** The lock state; anything but `found` means nothing was checked. Absent: found. */
  lockState?: string;
  /** Whether the site publishes a signature, so "sign it again" is said only of a signed site (UAT-12). */
  siteSigned?: boolean;
}

/** Who acts, in the owner's words. */
export const WHO = "whoever looks after your website";
/** The seal, explained where it is named. */
const SEAL = "your site's signature (the seal that shows your assistant's files are yours)";

const KIND_WORDS: Record<string, readonly [string, string]> = {
  money: ["price", "prices"],
  time: ["time", "times"],
  date: ["date", "dates"],
  phone: ["phone number", "phone numbers"],
  email: ["e-mail address", "e-mail addresses"],
  percent: ["percentage", "percentages"],
};
const KIND_ORDER = ["money", "time", "date", "phone", "email", "percent"];

const PLAIN = /^[A-Za-z0-9._/-]{1,120}$/;

/** A page as the owner reads it: a plain file name of the site's own (its last segment for an address), else "a page". */
export function pageName(ref: string | undefined): string | undefined {
  const value = String(ref ?? "");
  let path = value;
  if (/^https?:\/\//i.test(value)) {
    try {
      path = new URL(value).pathname.split("/").filter(Boolean).pop() ?? "";
    } catch {
      path = "";
    }
  }
  return PLAIN.test(path) && !path.split("/").some((s) => s === "" || s === "." || s === "..") ? path : undefined;
}

/** "an old price", or "old facts (2 prices, 1 time)", from staleKinds; "an old fact" when the kinds are not told. */
export function staleWords(kinds: Record<string, number | undefined> | undefined): string {
  const parts = KIND_ORDER.map((k) => [k, Number(kinds?.[k] ?? 0)] as const).filter(([k, n]) => Number.isInteger(n) && n > 0 && Object.hasOwn(KIND_WORDS, k));
  const total = parts.reduce((sum, [, n]) => sum + n, 0);
  if (total === 0) return "an old fact";
  if (total === 1) return `an old ${(KIND_WORDS[parts[0]![0]] as readonly [string, string])[0]}`;
  return `old facts (${parts.map(([k, n]) => `${n} ${(KIND_WORDS[k] as readonly [string, string])[n === 1 ? 0 : 1]}`).join(", ")})`;
}

const RUNTIME_CHANGE = new Set(["runtime-changed", "runtime-missing", "runtime-unreadable", "runtime-added"]);
const PARTNER_CODE_CHANGE = new Set(["peer-changed", "peer-links-appeared", "peer-links-changed", "peer-links-gone", "external-changed"]);
const SIGNER_CHANGE = new Set(["signer-rotated-verified", "signer-rotation-published", "signer-rotation-unverified", "signer-no-rotation", "signer-gone"]);
const LINE_ENDINGS = new Set(["grounding-line-endings", "runtime-line-endings"]);
const AGENT_FILE = /(\.network\.json|\.hocon|agent-manifest\.json|links\.json)$/i;

/** The page's words: "your page rooms.html", or "a page of your site" when its name is not plain. */
const page = (ref: string | undefined): string => {
  const name = pageName(ref);
  return name === undefined ? "a page of your site" : `your page ${name}`;
};

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The owner's line for a report's open findings (warn and block; info is never news to an owner), or null when there
 * is nothing to say (a clean report). The most pressing situation leads; the rest are counted, never hidden.
 */
export function ownerLine(findings: readonly OwnerFinding[], context: OwnerContext = {}): string | null {
  const state = context.lockState;
  if (state !== undefined && state !== "found") {
    return state === "absent"
      ? `Plumbline has not been set up for your site yet, so nothing about your assistant is being checked: forward this to ${WHO}.`
      : `Plumbline could not read its record of your site, so nothing about your assistant was checked this time: forward this to ${WHO}.`;
  }
  const open = findings.filter((f) => f && (f.severity === "warn" || f.severity === "block"));
  if (open.length === 0) return null;
  const code = (f: OwnerFinding): string => String(f.code ?? "");
  const has = (set: Set<string>) => open.filter((f) => set.has(code(f)));
  const resign = context.siteSigned === false ? "" : " and sign the site again";

  let lead: string;
  let covered: OwnerFinding[];
  const stale = open.filter((f) => code(f) === "grounding-stale-fact");
  // a page whose gone facts the network no longer states either: the right fix, one step from done (MAR-RC-2)
  const fixed = open.filter((f) => code(f) === "grounding-changed" && (f.counts?.factsGone ?? 0) > 0 && f.counts?.factsStale === 0);
  if (stale.length > 0) {
    const kinds: Record<string, number> = {};
    for (const f of stale) for (const [k, n] of Object.entries(f.counts?.staleKinds ?? {})) kinds[k] = (kinds[k] ?? 0) + Number(n ?? 0);
    const where = stale.length === 1 ? page(stale[0]?.ref) : "some of your pages";
    // one stale fact with both values: say them (since 2026-11-23); otherwise the kinds, as before
    const only = stale.length === 1 && stale[0]?.facts?.length === 1 ? stale[0].facts[0] : undefined;
    const said =
      only !== undefined && typeof only.was === "string" && typeof only.now === "string" && only.was !== "" && only.now !== ""
        ? `${only.was} where the page now says ${only.now}`
        : `${staleWords(kinds)} from ${stale.length === 1 ? "it" : "them"}`;
    lead = `${capital(where)} changed, and your assistant may still be telling visitors ${said}: forward this to ${WHO}, who updates what the assistant says`;
    covered = stale;
  } else if (has(RUNTIME_CHANGE).length > 0 || has(PARTNER_CODE_CHANGE).length > 0) {
    const own = has(RUNTIME_CHANGE).length > 0;
    lead = `Code that runs your assistant in your visitors' browsers changed (${own ? "your site's own copy of it" : "a partner service's"}): forward this to ${WHO} before your site is next updated, so they can check the change`;
    covered = [...has(RUNTIME_CHANGE), ...has(PARTNER_CODE_CHANGE)];
  } else if (has(SIGNER_CHANGE).length > 0) {
    lead = `A partner service your assistant works with is now signed by someone other than the one on record, and nothing accepts that until ${WHO} has checked it with the partner: forward this to them`;
    covered = has(SIGNER_CHANGE);
  } else if (fixed.length > 0) {
    lead = `${capital(page(fixed[0]?.ref))} changed, and your assistant's facts from it changed to match, so no old fact is left: one step remains for ${WHO}, to record the change${resign}`;
    // the network's own change and the signature that no longer covers it are that one step
    covered = open.filter((f) => f === fixed[0] || code(f) === "signature-not-covering" || (code(f) === "grounding-changed" && AGENT_FILE.test(String(f.ref ?? "")) && f.counts === undefined));
  } else if (open.some((f) => code(f) === "signature-not-covering")) {
    lead = `${capital(SEAL)} no longer matches its files: if you or ${WHO} just changed the site, they sign it again; if nobody did, forward this to them today`;
    covered = open.filter((f) => code(f) === "signature-not-covering");
  } else if (open.some((f) => code(f) === "signature-expired")) {
    lead = `${capital(SEAL)} has expired, so checkers no longer accept it: ${WHO} signs the site again`;
    covered = open.filter((f) => code(f) === "signature-expired");
  } else {
    const first = open.find((f) => code(f).startsWith("grounding-")) ?? open[0] as OwnerFinding;
    const c = code(first);
    covered = [first];
    if (c === "grounding-changed" && first.counts?.factsWatched !== undefined && (first.counts.factsGone ?? 0) === 0 && (first.counts.factsUnplaced ?? 0) === 0) {
      const n = first.counts.factsWatched;
      lead = `${capital(page(first.ref))} changed, but the ${n === 1 ? "1 fact" : `${n} facts`} your assistant gives from it that Plumbline watches ${n === 1 ? "is" : "are all"} still there; it does not watch everything on the page, so if the change was about something visitors ask about, forward this to ${WHO}`;
    } else if (c === "grounding-changed" && first.counts === undefined && AGENT_FILE.test(String(first.ref ?? ""))) {
      lead = `Your assistant's own instructions changed: if you or ${WHO} did not make this change, forward this to them today`;
    } else if (LINE_ENDINGS.has(c)) {
      lead = `A file of your site was saved with different line endings, a technical change that alters no word: ${WHO} fixes the setting`;
    } else if (c === "grounding-unreadable") {
      lead = `Plumbline could not read ${page(first.ref)}, so it could not check it: forward this to ${WHO}`;
    } else if (c === "grounding-not-locked") {
      lead = `Your site has a file Plumbline was not told to watch (${pageName(first.ref) ?? "a file of your site"}), so it is not checked: forward this to ${WHO}`;
    } else if (c === "signature-expiring") {
      const date = /^\d{4}-\d{2}-\d{2}/.exec(String(first.actual ?? ""))?.[0];
      lead = `${capital(SEAL)} expires ${date !== undefined ? `on ${date}` : "soon"}: ${WHO} renews it before then`;
    } else if (c === "signature-unreadable") {
      lead = `Plumbline could not read ${SEAL}, so it could not check its date: forward this to ${WHO}`;
    } else if (c.startsWith("grounding-") || c === "capture-source-unreadable" || c === "capture-page-no-fact" || c === "capture-stale-kept") {
      lead = `${capital(page(first.ref))} changed, and Plumbline could not tell whether your assistant now gives an old fact from it: forward this to ${WHO} to check`;
    } else if (c.startsWith("peer-") || c.startsWith("external-") || c.startsWith("signer-") || c.startsWith("network-") || c.startsWith("capture-")) {
      lead = `Plumbline could not check everything your assistant depends on this time (a partner service, or the file that names them), so this is not an all-clear: forward this to ${WHO}`;
    } else {
      lead = `Plumbline found something on your site for ${WHO} to look at: forward this to them`;
    }
  }
  const rest = open.length - covered.length;
  return `${lead}${rest > 0 ? ` (and ${rest === 1 ? "1 more thing" : `${rest} more things`} below for them)` : ""}.`;
}
