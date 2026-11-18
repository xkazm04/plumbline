// Grounding that checks facts, with no model: the literals a network's instructions state (a price, an opening time, a
// date, a phone number, an e-mail address, a percentage), found with fixed patterns, and which of them a grounding page
// also states. Such a literal is an ANCHOR. When the page changes, the watch counts the anchors no longer on it, and
// asks the networks as they are now whether they still state them: "the page no longer states a fact the network still
// states" is the stale fact; "the network no longer states it either" is a change both sides made. Pure: no node:*
// import, so the CLI's watch and the Desk's drift reader (through watch/published.js) count the same;
// scripts/build-site.mjs copies it.
//
// What an anchor is and is not: the PRESENCE of a literal in two texts, compared after normalisation. It is not truth:
// a page can state a price in a sentence that says it no longer applies, and a fact written in words ("nine in the
// morning") is not seen. A literal is never stored or quoted in a finding: the lock holds SHA-256 of each normalised
// literal, and a finding holds counts and the kind of fact ("1 price"). Only the publisher's own terminal, at init and
// relock, is shown the literals of the publisher's own network that no page states (factCoverageLines).
//
// Every pattern is linear on a page of the 512 KiB ceiling: repetitions are bounded, and the tag stripper is a scan,
// not a regular expression (a page of 512 Ki "<" took minutes through the stripper's earlier `<[^>]*>`; UAT-1).

import { sha256Hex } from "../core/canonical.js";
import { LINKS_FILE, MANIFEST_FILE, type DriftFinding, type GroundingSource } from "../core/types.js";
import { MAX_BODY_BYTES } from "../net/fetch-types.js";
import { groundingFinding, type AnchorCheck, type Observed, type SourceRole } from "./decide.js";

export type { AnchorCheck };

/** The kinds of literal, in the order they are taken from a text (each match is masked before the next kind looks). */
export const ANCHOR_KINDS = ["email", "date", "money", "percent", "time", "phone"] as const;
export type AnchorKind = (typeof ANCHOR_KINDS)[number];

/**
 * The most text a page is reduced from: the fetch ceiling (net/fetch-types.ts MAX_BODY_BYTES, 512 KiB, derived there
 * from the largest real network definition), so a local page is held to what a fetched one could be.
 */
export const MAX_REDUCED_BYTES = MAX_BODY_BYTES;

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const monthOf = (word: string): number => MONTHS.findIndex((m) => m.startsWith(word.slice(0, 3))) + 1;
const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * A number as written, normalised: separators removed where they group thousands, the decimal mark as `.`, a zero
 * fraction dropped. `1,500` and `1.500` and `1 500` are 1500; `12,50` and `12.50` are 12.5; `12.00` is 12.
 * A lone separator followed by exactly three digits groups thousands; followed by one or two, it is the decimal mark.
 */
export function normaliseNumber(written: string): string {
  let s = written.replace(/[\s  ']/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? "," : ".";
    const group = decimal === "," ? "." : ",";
    s = s.split(group).join("").replace(decimal, ".");
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? "," : ".";
    const parts = s.split(sep);
    const tail = parts[parts.length - 1] ?? "";
    s = parts.length > 2 || tail.length === 3 ? parts.join("") : parts.join(".");
  }
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s.replace(/^0+(?=\d)/, "");
}

const CURRENCY_WORDS: Record<string, string> = {
  "$": "usd",
  "us$": "usd",
  usd: "usd",
  dollar: "usd",
  dollars: "usd",
  "€": "eur",
  eur: "eur",
  euro: "eur",
  euros: "eur",
  "£": "gbp",
  gbp: "gbp",
  pound: "gbp",
  pounds: "gbp",
  "¥": "jpy",
  jpy: "jpy",
  chf: "chf",
  czk: "czk",
  "kč": "czk",
  kc: "czk",
};
// A number: grouped thousands (at most four groups, so a run of numbers is never re-scanned from every start), or up to
// twelve plain digits; an optional one- or two-digit fraction.
const NUMBER = "\\d{1,3}(?:[,.\\s\\u00a0\\u202f']\\d{3}){1,4}(?:[.,]\\d{1,2})?|\\d{1,12}(?:[.,]\\d{1,2})?";
const SYMBOL = "us\\$|[$€£¥]";
const CODE = "usd|eur|gbp|jpy|chf|czk";
const AFTER = "usd|eur|gbp|jpy|chf|czk|kč|kc|euros?|pounds?|dollars?|€|\\$|£|¥";

interface Pattern {
  kind: AnchorKind;
  re: RegExp;
  /** The normalised literal for a match, or null when the match is not one after all. */
  norm: (m: RegExpExecArray) => string | null;
  /** The literal as locks written before 2026-11-19 normalised it, when that differs (read, never written). */
  legacy?: (m: RegExpExecArray) => string | null;
}

const money = (symbol: string | undefined, amount: string | undefined): string | null => {
  const currency = CURRENCY_WORDS[(symbol ?? "").toLowerCase()];
  return currency === undefined || amount === undefined ? null : `${currency} ${normaliseNumber(amount)}`;
};

/** A phone number by its last nine digits (all of them when shorter), so +44 1632 960418, 01632 960418 and +44 (0)1632 960418 are one number. */
function phoneDigits(written: string): string | null {
  const digits = written.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return digits.slice(-9);
}

const TIME_HALF = "(a\\.?m\\.?|p\\.?m\\.?)";
const PATTERNS: Pattern[] = [
  {
    kind: "email",
    re: /\b[a-z0-9._%+-]{1,64}@[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){0,8}\.[a-z]{2,24}\b/g,
    norm: (m) => m[0],
  },
  {
    kind: "date",
    re: new RegExp(
      `\\b(\\d{4})-(\\d{2})-(\\d{2})\\b|\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\.?,?\\s+(\\d{4})\\b|\\b${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b|\\b(\\d{1,2})[./](\\d{1,2})[./](\\d{4})\\b`,
      "g",
    ),
    norm: (m) => {
      if (m[1]) return Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[3]) >= 1 && Number(m[3]) <= 31 ? `${m[1]}-${m[2]}-${m[3]}` : null;
      if (m[6]) return `${m[6]}-${pad(monthOf(m[5] ?? ""))}-${pad(Number(m[4]))}`;
      if (m[9]) return `${m[9]}-${pad(monthOf(m[7] ?? ""))}-${pad(Number(m[8]))}`;
      // d.m.yyyy or m/d/yyyy: the order is the writer's, so the literal keeps it, separators unified
      if (m[12]) return `${Number(m[10])}/${Number(m[11])}/${m[12]}`;
      return null;
    },
  },
  // Money in three passes, so a number cell before a price is never read as the amount (UAT-1: "Sleeps 2 | €89" read
  // EUR 2): a symbol written against its number first (€89), then a symbol or code after a number (89 €, 89 euros,
  // 89,- €), then a symbol or code before a number with a space (EUR 89, € 89).
  { kind: "money", re: new RegExp(`(${SYMBOL})(${NUMBER})`, "g"), norm: (m) => money(m[1], m[2]) },
  { kind: "money", re: new RegExp(`\\b(${NUMBER})(?:[,.]-)?\\s?(${AFTER})(?![a-z])`, "g"), norm: (m) => money(m[2], m[1]) },
  { kind: "money", re: new RegExp(`(${SYMBOL}|\\b(?:${CODE})\\b)\\s?(${NUMBER})`, "g"), norm: (m) => money(m[1], m[2]) },
  {
    kind: "percent",
    re: /\b(\d{1,12}(?:[.,]\d{1,6})?)\s?(?:%|percent\b|per cent\b)/g,
    norm: (m) => `${normaliseNumber(m[1] ?? "")}%`,
  },
  {
    kind: "time",
    // 15:00 (with or without am/pm); 3pm, 3:30 p.m., 10.30am; 15h and 15h30; 15.00 after a word that introduces a time
    // (from, until, by, ...) or as the first of a range (15.00-20.00). A bare decimal (12.30 alone) is not a time.
    re: new RegExp(
      `\\b([01]?\\d|2[0-3]):([0-5]\\d)\\s?${TIME_HALF}?(?![\\d:])` +
        `|\\b(1[0-2]|0?[1-9])(?:[:.]([0-5]\\d))?\\s?${TIME_HALF}(?![a-z])` +
        `|\\b([01]?\\d|2[0-3])h([0-5]\\d)?(?![a-z\\d])` +
        `|(?<=\\b(?:from|until|till|to|at|by|before|after|opens?|closes?|between|and)\\s)([01]?\\d|2[0-3])\\.([0-5]\\d)(?![\\d.,])` +
        `|\\b([01]?\\d|2[0-3])\\.([0-5]\\d)(?=\\s?(?:-|–|—|to)\\s?(?:[01]?\\d|2[0-3])\\.[0-5]\\d(?![\\d.,]))`,
      "g",
    ),
    norm: (m) => {
      const at = [1, 4, 7, 9, 11].find((i) => m[i] !== undefined) ?? 1;
      const hour = Number(m[at]);
      const minute = Number(m[at + 1] ?? "0");
      const half = (at === 1 ? m[3] : at === 4 ? m[6] : undefined)?.replace(/\./g, "") ?? "";
      if (half !== "" && (hour < 1 || hour > 12)) return null;
      const h24 = half === "pm" ? (hour % 12) + 12 : half === "am" ? hour % 12 : hour;
      return `${pad(h24)}:${pad(minute)}`;
    },
  },
  {
    kind: "phone",
    // international (+ or 00), national with a trunk 0 (01632 960418), or grouped (555) 123-4567; 7 to 15 digits
    re: /(?:\+|\b00)\d[\d\s().-]{5,24}\d\b|\(?\b0\d{2,5}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b|\(?\b\d{2,4}\)?[\s.-]\d{2,4}[\s.-]\d{2,4}(?:[\s.-]\d{2,4})?\b/g,
    norm: (m) => phoneDigits(m[0]),
    legacy: (m) => {
      const digits = m[0].replace(/\D/g, "");
      if (digits.length < 7 || digits.length > 15) return null;
      return `${m[0].trimStart().startsWith("+") ? "+" : ""}${digits.replace(/^00/, "+")}`;
    },
  },
];

/**
 * The literals a text states, each `<kind>:<normalised literal>`, each once, sorted. The text is lowercased and its
 * whitespace collapsed first; each pattern's matches are masked before the next looks, so a date is not also a phone
 * number and a price is not also a percentage. `legacy` adds the forms locks written before 2026-11-19 hashed (a phone
 * number with its country code), for comparing with such a lock; capture never writes them.
 */
export function extractLiterals(text: string, options: { legacy?: boolean } = {}): string[] {
  let rest = text.toLowerCase().replace(/[\s  ]+/g, " ");
  const out = new Set<string>();
  for (const pattern of PATTERNS) {
    pattern.re.lastIndex = 0;
    let masked = "";
    let last = 0;
    for (let m = pattern.re.exec(rest); m !== null; m = pattern.re.exec(rest)) {
      if (m[0] === "") {
        pattern.re.lastIndex += 1;
        continue;
      }
      const norm = pattern.norm(m);
      if (norm === null) continue;
      out.add(`${pattern.kind}:${norm}`);
      const old = options.legacy === true ? pattern.legacy?.(m) : undefined;
      if (old) out.add(`${pattern.kind}:${old}`);
      masked += rest.slice(last, m.index) + " ".repeat(m[0].length);
      last = m.index + m[0].length;
    }
    rest = masked + rest.slice(last);
  }
  return [...out].sort();
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", euro: "€", pound: "£", yen: "¥", ndash: "-", mdash: "-", hellip: "..." };
/** Elements whose content is not text a visitor reads. An unclosed one hides the rest of the page (as a browser does). */
const RAW = new Set(["script", "style", "template", "noscript"]);
/**
 * Elements that separate their content from what is beside them: a table cell, a paragraph, a list item, a line break.
 * Their tags become " | ", which no pattern reads across, so a number in one cell never joins a price in the next
 * ("Sleeps 2 | €89", "€89 | 120"). Every other tag (a span, a link, emphasis) is a space, so markup inside a sentence
 * does not split it.
 */
const SEPARATING = new Set(
  "address article aside blockquote br button caption dd details div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr label legend li main nav ol option p pre section select summary table tbody td tfoot th thead tr ul".split(" "),
);

/**
 * A page's text: script, style, template and noscript contents and comments dropped, a cell or block tag " | ", every
 * other tag a space, the common entities decoded, and the target of a `tel:` or `mailto:` link written out beside its
 * text (a visitor who taps "Call us" dials that number, so the page states it). A small scanner, not a parser (no
 * dependency): other attributes are not read, and malformed markup may leave stray characters, which can only hide an
 * anchor (counted as gone), never invent one the page does not state.
 */
export function reduceToText(html: string): string {
  const lower = html.toLowerCase();
  const out: string[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      out.push(html.slice(i));
      break;
    }
    out.push(html.slice(i, lt));
    if (lower.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      out.push(" ");
      if (end < 0) break;
      i = end + 3;
      continue;
    }
    const gt = html.indexOf(">", lt + 1);
    if (gt < 0) {
      // no tag closes after this point: the rest is text
      out.push(html.slice(lt));
      break;
    }
    const tag = html.slice(lt, gt + 1);
    const name = /^<(\/?)([a-z][a-z0-9]*)/i.exec(tag);
    const element = name?.[2]?.toLowerCase() ?? "";
    if (RAW.has(element) && name?.[1] === "") {
      out.push(" ");
      const close = lower.indexOf(`</${element}`, gt + 1);
      const closeEnd = close < 0 ? -1 : html.indexOf(">", close);
      if (closeEnd < 0) break;
      i = closeEnd + 1;
      continue;
    }
    out.push(SEPARATING.has(element) ? " | " : " ");
    const link = /\bhref\s*=\s*["']?\s*(?:tel|mailto):([^"'\s>?#]{1,256})/i.exec(tag);
    if (link?.[1] !== undefined) {
      let target = link[1];
      try {
        target = decodeURIComponent(target);
      } catch {
        // a malformed escape stays as written
      }
      out.push(` ${target} `);
    }
    i = gt + 1;
  }
  return out.join("").replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{1,31});/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " ";
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** A page's bytes as reducible text, or the sentence ("it ...") for why they cannot be reduced. */
export function pageText(bytes: Uint8Array): { text: string } | { problem: string } {
  if (bytes.length > MAX_REDUCED_BYTES) return { problem: `is larger than the ${MAX_REDUCED_BYTES} bytes a page is reduced from` };
  if (bytes.includes(0)) return { problem: "is binary, not text" };
  try {
    return { text: reduceToText(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch {
    return { problem: "is not UTF-8 text" };
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Every agent's `instructions` in a network definition, with the `{name}` placeholders the runtime fills from
 * `commondefs.replacement_strings` filled in (what the agent is told is what it states), or null when the text is not a
 * network definition (not JSON, or no `tools` array).
 */
function networkInstructions(networkText: string): string[] | null {
  let value: unknown;
  try {
    value = JSON.parse(networkText.replace(/^﻿/, ""));
  } catch {
    return null;
  }
  if (!isObject(value) || !Array.isArray(value.tools)) return null;
  const commondefs = value.commondefs;
  const strings = isObject(commondefs) && isObject(commondefs.replacement_strings) ? commondefs.replacement_strings : {};
  const fill = (text: string): string =>
    text.replace(/\{([A-Za-z0-9_]{1,64})\}/g, (whole, key: string) => (Object.hasOwn(strings, key) && typeof strings[key] === "string" ? (strings[key] as string) : whole));
  return value.tools
    .map((agent: unknown) => (isObject(agent) ? agent.instructions : undefined))
    .filter((t): t is string => typeof t === "string")
    .map(fill);
}

/** The literals stated in a network definition's instructions (every agent's, with its replacement strings filled in). */
export function networkLiterals(networkText: string, options: { legacy?: boolean } = {}): string[] {
  const texts = networkInstructions(networkText) ?? [];
  return [...new Set(texts.flatMap((t) => extractLiterals(t, options)))].sort();
}

// ---- the kinds of fact, for counts in findings and the publisher's own terminal ----

const KIND_WORDS: Record<AnchorKind, readonly [string, string]> = {
  money: ["price", "prices"],
  time: ["time", "times"],
  date: ["date", "dates"],
  phone: ["phone number", "phone numbers"],
  email: ["e-mail address", "e-mail addresses"],
  percent: ["percentage", "percentages"],
};
const KIND_ORDER: readonly AnchorKind[] = ["money", "time", "date", "phone", "email", "percent"];

export function literalKind(literal: string): AnchorKind {
  const kind = literal.slice(0, literal.indexOf(":")) as AnchorKind;
  return (ANCHOR_KINDS as readonly string[]).includes(kind) ? kind : "money";
}

/** How many literals of each kind, in a fixed order. */
export function kindCounts(literals: readonly string[]): Partial<Record<AnchorKind, number>> {
  const out: Partial<Record<AnchorKind, number>> = {};
  for (const kind of KIND_ORDER) {
    const n = literals.filter((l) => literalKind(l) === kind).length;
    if (n > 0) out[kind] = n;
  }
  return out;
}

/** "3 prices, 2 times, 1 phone number", or "none". Kinds only: never a literal. */
export function describeKinds(kinds: readonly AnchorKind[] | readonly string[]): string {
  const asKinds = kinds.map((k) => (k.includes(":") ? literalKind(k) : (k as AnchorKind)));
  const parts = KIND_ORDER.map((kind) => [kind, asKinds.filter((k) => k === kind).length] as const)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => `${n} ${KIND_WORDS[kind][n === 1 ? 0 : 1]}`);
  return parts.length === 0 ? "none" : parts.join(", ");
}

/** A literal as the publisher's own terminal shows it: from the publisher's own network, never from a stranger's page. */
export function showLiteral(literal: string): string {
  const kind = literalKind(literal);
  const value = literal.slice(literal.indexOf(":") + 1);
  if (kind === "money") return value.replace(/^([a-z]+) /, (_, c: string) => `${c.toUpperCase()} `);
  if (kind === "phone") return `the phone number ending ${value.slice(-6)}`;
  return value;
}

/** Which of the network's literals a page states (watched there) and which it does not, or why it cannot be read. */
export function pageFacts(literals: readonly string[], page: Uint8Array): { watched: string[]; notOnPage: string[] } | { problem: string } {
  const reduced = pageText(page);
  if ("problem" in reduced) return reduced;
  const onPage = new Set(extractLiterals(reduced.text));
  return { watched: literals.filter((l) => onPage.has(l)), notOnPage: literals.filter((l) => !onPage.has(l)) };
}

/**
 * The anchors of a page: SHA-256 of each literal the network states that the page states too, sorted. `literals` are
 * the network's (networkLiterals). Returns the problem when the page cannot be reduced.
 */
export async function anchorsOf(literals: string[], page: Uint8Array): Promise<{ anchors: string[] } | { problem: string }> {
  const facts = pageFacts(literals, page);
  if ("problem" in facts) return facts;
  return { anchors: [...new Set(await Promise.all(facts.watched.map((l) => sha256Hex(l))))].sort() };
}

/** The hashes of the literals a page states now, in the current and the earlier normalisation. */
export async function pageLiteralHashes(page: Uint8Array): Promise<Set<string> | { problem: string }> {
  return pageHashes(page);
}

async function pageHashes(page: Uint8Array): Promise<Set<string> | { problem: string }> {
  const reduced = pageText(page);
  if ("problem" in reduced) return reduced;
  return new Set(await Promise.all(extractLiterals(reduced.text, { legacy: true }).map((l) => sha256Hex(l))));
}

export async function checkAnchors(anchors: string[], page: Uint8Array): Promise<AnchorCheck> {
  const now = await pageHashes(page);
  if ("problem" in now) return { total: anchors.length, problem: now.problem };
  return { total: anchors.length, present: anchors.filter((h) => now.has(h)).length };
}

/** What the lock's networks state now: each literal's hash (in both normalisations) and its kind. */
export type NetworkStatement = Map<string, AnchorKind>;

const isAgentFileName = (ref: string): boolean => {
  const name = ref.split(/[?#]/)[0]?.split("/").pop() ?? "";
  return name === MANIFEST_FILE || name === LINKS_FILE;
};

/**
 * What the networks among the lock's grounding sources state NOW, from this run's reads of them, or undefined when that
 * cannot be told: no source read now is a network definition, or a source that may be one could not be read. A source
 * with anchors is a page, never a network.
 */
export async function networkStatesNow(sources: readonly GroundingSource[], seen: readonly Observed[]): Promise<NetworkStatement | undefined> {
  const out: NetworkStatement = new Map();
  let found = false;
  for (const [i, source] of sources.entries()) {
    if ((source.anchors ?? []).length > 0) continue;
    const s = seen[i];
    if (s === undefined) continue;
    if (!s.ok) {
      if (/\.json$/i.test(source.ref.split(/[?#]/)[0] ?? "") && !isAgentFileName(source.ref)) return undefined;
      continue;
    }
    if (s.bytes === undefined) continue;
    const texts = networkInstructions(new TextDecoder("utf-8").decode(s.bytes));
    if (texts === null) continue;
    found = true;
    for (const literal of new Set(texts.flatMap((t) => extractLiterals(t, { legacy: true })))) out.set(await sha256Hex(literal), literalKind(literal));
  }
  return found ? out : undefined;
}

/** What a changed grounding source is, for its sentence: a network definition, another agent file, or a page. */
export function sourceRole(source: GroundingSource, bytes: Uint8Array | undefined): SourceRole {
  if ((source.anchors ?? []).length > 0) return "page";
  if (bytes !== undefined && networkInstructions(new TextDecoder("utf-8").decode(bytes)) !== null) return "network";
  return isAgentFileName(source.ref) || /\.json$/i.test(source.ref) ? "agent" : "page";
}

/**
 * The grounding findings for every source the lock holds, given this run's read of each (the same order): decide.ts
 * groundingFinding, with a changed page's anchors counted, and the ones gone from it checked against what the networks
 * state now. The severity stays `warn` either way. The CLI's watch of a checkout and the published reader (the Desk and
 * `watch --url`) both call this, so they count the same.
 */
export async function groundingFindingsWithAnchors(sources: readonly GroundingSource[], seen: readonly (Observed | undefined)[]): Promise<DriftFinding[]> {
  const observed = seen.map((s): Observed => s ?? { ok: false, missing: false, sentence: "could not be read" });
  const stated = await networkStatesNow(sources, observed);
  const out: DriftFinding[] = [];
  for (const [i, source] of sources.entries()) {
    const s = observed[i]!;
    const anchors = source.anchors ?? [];
    let finding: DriftFinding | null;
    if (!s.ok || s.sha256 === source.sha256) finding = groundingFinding(source, s);
    else if (anchors.length === 0 || s.bytes === undefined) finding = groundingFinding(source, s, undefined, sourceRole(source, s.bytes));
    else {
      const now = await pageHashes(s.bytes);
      if ("problem" in now) finding = groundingFinding(source, s, { total: anchors.length, problem: now.problem }, "page");
      else {
        const gone = anchors.filter((h) => !now.has(h));
        const still = stated === undefined ? undefined : gone.filter((h) => stated.has(h));
        const check: AnchorCheck = {
          total: anchors.length,
          present: anchors.length - gone.length,
          ...(still !== undefined ? { stillStated: { count: still.length, kinds: describeKinds(still.map((h) => stated!.get(h)!)) } } : {}),
        };
        finding = groundingFinding(source, s, check, "page");
      }
    }
    if (finding) out.push(finding);
  }
  return out;
}

// ---- what a lock watches, at capture: for init and relock ----

/** The facts the networks state, and per page given with --source, which of them it states (watched) and which not. */
export interface FactCoverage {
  network: string[];
  pages: { ref: string; watched: string[]; notOnPage: string[]; problem?: string }[];
}

/** The facts the networks state that no page watches. */
export function unwatchedFacts(coverage: FactCoverage): string[] {
  const watched = new Set(coverage.pages.flatMap((p) => p.watched));
  return coverage.network.filter((l) => !watched.has(l));
}

const listed = (literals: readonly string[]): string => `${literals.length} (${describeKinds(literals)}${literals.length > 0 ? `: ${literals.map(showLiteral).join(", ")}` : ""})`;

/**
 * The lines init and relock print in the publisher's own terminal: what the networks state, what each page watches and
 * which facts no page states. The literals named are the publisher's own network's, normalised, never a page's words.
 */
export function factCoverageLines(coverage: FactCoverage): string[] {
  if (coverage.network.length === 0 && coverage.pages.length === 0) return [];
  const lines = [`facts the network states: ${coverage.network.length} (${describeKinds(coverage.network)})`];
  for (const page of coverage.pages) {
    if (page.problem !== undefined) {
      lines.push(`facts ${page.ref}: none watched (it ${page.problem})`);
      continue;
    }
    lines.push(`facts ${page.ref}: watches ${page.watched.length} (${describeKinds(page.watched)}); not on it: ${listed(page.notOnPage)}`);
  }
  if (coverage.network.length > 0) {
    const unwatched = unwatchedFacts(coverage);
    lines.push(
      unwatched.length === 0
        ? "facts not watched on any page: none"
        : `facts not watched on any page: ${listed(unwatched)}; a change to them is not seen until a --source page states them`,
    );
  }
  return lines;
}

/** The same, in counts by kind, for --json (no literal). */
export function factCoverageCounts(coverage: FactCoverage): {
  network: Partial<Record<AnchorKind, number>>;
  pages: { ref: string; watched: Partial<Record<AnchorKind, number>>; notOnPage: Partial<Record<AnchorKind, number>>; problem?: string }[];
  unwatched: Partial<Record<AnchorKind, number>>;
} {
  return {
    network: kindCounts(coverage.network),
    pages: coverage.pages.map((p) => ({ ref: p.ref, watched: kindCounts(p.watched), notOnPage: kindCounts(p.notOnPage), ...(p.problem !== undefined ? { problem: p.problem } : {}) })),
    unwatched: kindCounts(unwatchedFacts(coverage)),
  };
}
