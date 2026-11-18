// Grounding that checks facts, with no model: the literals a network's instructions state (a price, an opening time, a
// date, a phone number, an e-mail address, a percentage), found with fixed patterns, and which of them a grounding page
// also states. Such a literal is an ANCHOR. When the page changes, the watch counts the anchors no longer on it: "the
// page changed and the network still states the old fact". Pure: no node:* import, so the CLI's watch and the Desk's
// drift reader (through watch/published.js) count the same; scripts/build-site.mjs copies it.
//
// What an anchor is and is not: the PRESENCE of a literal in two texts, compared after normalisation. It is not truth:
// a page can state a price in a sentence that says it no longer applies, and a fact written in words ("nine in the
// morning") is not seen. A literal is never stored or quoted: the lock holds SHA-256 of each normalised literal, and a
// finding holds counts.

import { sha256Hex } from "../core/canonical.js";
import { MAX_BODY_BYTES } from "../net/fetch-types.js";
import type { DriftFinding } from "../core/types.js";
import { groundingFinding, type AnchorCheck, type Observed } from "./decide.js";

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

const CURRENCY_WORDS: Record<string, string> = { "$": "usd", "us$": "usd", usd: "usd", "€": "eur", eur: "eur", "£": "gbp", gbp: "gbp", "¥": "jpy", jpy: "jpy", chf: "chf", czk: "czk", "kč": "czk", kc: "czk" };
const NUMBER = "\\d{1,3}(?:[,.\\s\\u00a0\\u202f']\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?";

interface Pattern {
  kind: AnchorKind;
  re: RegExp;
  /** The normalised literal for a match, or null when the match is not one after all. */
  norm: (m: RegExpExecArray) => string | null;
}

const PATTERNS: Pattern[] = [
  {
    kind: "email",
    re: /\b[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/g,
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
  {
    kind: "money",
    re: new RegExp(`(?:(us\\$|[$€£¥]|\\b(?:usd|eur|gbp|jpy|chf|czk)\\b)\\s?(${NUMBER}))|(?:\\b(${NUMBER})\\s?(usd|eur|gbp|jpy|chf|czk|kč|kc|€|\\$|£)(?![a-z]))`, "g"),
    norm: (m) => {
      const symbol = (m[1] ?? m[4] ?? "").toLowerCase();
      const amount = m[2] ?? m[3] ?? "";
      const currency = CURRENCY_WORDS[symbol];
      return currency === undefined ? null : `${currency} ${normaliseNumber(amount)}`;
    },
  },
  {
    kind: "percent",
    re: /\b(\d+(?:[.,]\d+)?)\s?(?:%|percent\b|per cent\b)/g,
    norm: (m) => `${normaliseNumber(m[1] ?? "")}%`,
  },
  {
    kind: "time",
    re: /\b([01]?\d|2[0-3]):([0-5]\d)\s?(a\.?m\.?|p\.?m\.?)?(?![\d:])|\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s?(a\.?m\.?|p\.?m\.?)(?![a-z])/g,
    norm: (m) => {
      const hour = Number(m[1] ?? m[4]);
      const minute = Number(m[2] ?? m[5] ?? "0");
      const half = (m[3] ?? m[6] ?? "").replace(/\./g, "");
      if (half !== "" && (hour < 1 || hour > 12)) return null;
      const h24 = half === "pm" ? (hour % 12) + 12 : half === "am" ? hour % 12 : hour;
      return `${pad(h24)}:${pad(minute)}`;
    },
  },
  {
    kind: "phone",
    // international (+ or 00) or grouped national numbers; 7 to 15 digits (E.164 allows at most 15)
    re: /(?:\+|\b00)\d[\d\s().-]{5,}\d\b|\(?\b\d{2,4}\)?[\s.-]\d{2,4}[\s.-]\d{2,4}(?:[\s.-]\d{2,4})?\b/g,
    norm: (m) => {
      const digits = m[0].replace(/\D/g, "");
      if (digits.length < 7 || digits.length > 15) return null;
      return `${m[0].trimStart().startsWith("+") ? "+" : ""}${digits.replace(/^00/, "+")}`;
    },
  },
];

/**
 * The literals a text states, each `<kind>:<normalised literal>`, each once, sorted. The text is lowercased and its
 * whitespace collapsed first; each kind's matches are masked before the next kind looks, so a date is not also a phone
 * number and a price is not also a percentage.
 */
export function extractLiterals(text: string): string[] {
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
      masked += rest.slice(last, m.index) + " ".repeat(m[0].length);
      last = m.index + m[0].length;
    }
    rest = masked + rest.slice(last);
  }
  return [...out].sort();
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", euro: "€", pound: "£", yen: "¥", ndash: "-", mdash: "-", hellip: "..." };

/**
 * A page's text: script and style contents and comments dropped, every tag a space, the common entities decoded. A
 * small stripper, not a parser (no dependency): text in attributes is not read, and malformed markup may leave stray
 * characters, which can only hide an anchor (counted as gone), never invent one the page does not state.
 */
export function reduceToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
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

/** The literals stated in a network definition's instructions (every agent's `instructions` string). */
export function networkLiterals(networkText: string): string[] {
  let value: unknown;
  try {
    value = JSON.parse(networkText.replace(/^﻿/, ""));
  } catch {
    return [];
  }
  const tools = typeof value === "object" && value !== null ? (value as { tools?: unknown }).tools : undefined;
  if (!Array.isArray(tools)) return [];
  const texts = tools.map((agent: unknown) => (typeof agent === "object" && agent !== null ? (agent as { instructions?: unknown }).instructions : undefined)).filter((t): t is string => typeof t === "string");
  return [...new Set(texts.flatMap(extractLiterals))].sort();
}

/**
 * The anchors of a page: SHA-256 of each literal the network states that the page states too, sorted. `literals` are
 * the network's (networkLiterals). Returns the problem when the page cannot be reduced.
 */
export async function anchorsOf(literals: string[], page: Uint8Array): Promise<{ anchors: string[] } | { problem: string }> {
  const reduced = pageText(page);
  if ("problem" in reduced) return reduced;
  const onPage = new Set(extractLiterals(reduced.text));
  const shared = literals.filter((l) => onPage.has(l));
  return { anchors: [...new Set(await Promise.all(shared.map((l) => sha256Hex(l))))].sort() };
}

export async function checkAnchors(anchors: string[], page: Uint8Array): Promise<AnchorCheck> {
  const reduced = pageText(page);
  if ("problem" in reduced) return { total: anchors.length, problem: reduced.problem };
  const now = new Set(await Promise.all(extractLiterals(reduced.text).map((l) => sha256Hex(l))));
  return { total: anchors.length, present: anchors.filter((h) => now.has(h)).length };
}

/**
 * A grounding source's finding with its anchors counted: decide.ts groundingFinding, given what the changed page still
 * states. Only a changed source with anchors is re-read; the severity stays `warn` either way.
 */
export async function groundingFindingWithAnchors(source: { ref: string; sha256: string; anchors?: string[] }, seen: Observed & { bytes?: Uint8Array }): Promise<DriftFinding | null> {
  const anchors = source.anchors ?? [];
  if (!seen.ok || seen.sha256 === source.sha256 || anchors.length === 0 || seen.bytes === undefined) return groundingFinding(source, seen);
  return groundingFinding(source, seen, await checkAnchors(anchors, seen.bytes));
}
