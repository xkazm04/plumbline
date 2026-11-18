// A small static SVG badge for one gate report: what the gate checked, what it says about the site's signature, and
// the date the gate ran, on one of four colours. The colour is never the only signal: the words are always written,
// and the SVG carries a title and an aria-label that say them again.
// Pure: no node:* import. Every string in it is one of a few fixed phrases or a date in its exact pattern.
//
// UAT-10 (PRI-L1-09, PRI-L1-14, REC-5): the badge is green only for a gate that passed on every checker AND a signature
// verified against the trust file the gate was given. A gate that never checked the signature says "signature not
// checked" and is not green; an invalid signature is red whatever the checkers said.

import { INVALID_REASONS, type InvalidReason } from "../core/types.js";

/** What the gate part of a badge says: the report's state, with `unavailable` split the way every surface words it (UAT-9). */
export const BADGE_GATES = ["pass", "fail", "partly-checked", "unreachable", "not-checked"] as const;
export type BadgeGate = (typeof BADGE_GATES)[number];

/** What the signature part says: the verify verdict (an invalid one by its reason), or that the gate did not check it. */
export const BADGE_SIGNATURES = ["verified", ...INVALID_REASONS, "unverifiable", "not-checked"] as const;
export type BadgeSignature = "verified" | InvalidReason | "unverifiable" | "not-checked";

export interface BadgeFacts {
  gate: BadgeGate;
  signature: BadgeSignature;
  /** The day the gate ran (YYYY-MM-DD), from the report's checkedAt. */
  date: string;
}

export const BADGE_GATE_WORDS: Record<BadgeGate, string> = {
  pass: "pass",
  fail: "fail",
  "partly-checked": "partly checked",
  unreachable: "unreachable",
  "not-checked": "not checked",
};

export const BADGE_SIGNATURE_WORDS: Record<BadgeSignature, string> = {
  verified: "signature verified",
  "bad-signature": "signature invalid (bad signature)",
  tampered: "signature invalid (tampered)",
  expired: "signature invalid (expired)",
  "kid-mismatch": "signature invalid (kid mismatch)",
  malformed: "signature invalid (malformed)",
  revoked: "signature invalid (revoked)",
  unverifiable: "signature unverifiable",
  "not-checked": "signature not checked",
};

/**
 * The fills, with white text. Each passes 4.5:1 contrast against white (WCAG AA for small text); the ratios were
 * computed 2026-11-18 from the sRGB relative luminance formula. The label's #555 is 7.46:1.
 */
export const BADGE_COLOURS = {
  green: "#1b5e20", // green 900: 7.87:1 against #fff; only a full pass with a verified signature
  red: "#b71c1c", // red 900: 6.57:1; a checker failed, or the signature is invalid
  amber: "#8c4a00", // dark amber: 6.79:1; the site could not be reached (an alarm, but not a defect found)
  grey: "#424242", // grey 800: 10.05:1; anything else: partly checked, not checked, or a signature not verified
} as const;
export type BadgeColour = keyof typeof BADGE_COLOURS;

/** The one colour a badge's facts get. Green needs both halves; red wins over everything; never green by default. */
export function badgeColour(facts: Pick<BadgeFacts, "gate" | "signature">): BadgeColour {
  const invalidSignature = (INVALID_REASONS as readonly string[]).includes(facts.signature);
  if (facts.gate === "fail" || invalidSignature) return "red";
  if (facts.gate === "pass" && facts.signature === "verified") return "green";
  if (facts.gate === "unreachable") return "amber";
  return "grey";
}

/** The words a badge writes after its label, without the date. */
export function badgeWords(facts: Pick<BadgeFacts, "gate" | "signature">): string {
  return `${BADGE_GATE_WORDS[facts.gate]}, ${BADGE_SIGNATURE_WORDS[facts.signature]}`;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Width of a text run at 11 px Verdana, the face badges conventionally use: about 7 px per character for lowercase
 * letters, digits and spaces (measured from Verdana's advance widths: 'a' 6.7, 'e' 6.8, '0' 7.0, ' ' 3.9 at 11 px),
 * plus 10 px of padding on each side. Rounded up, so the text never touches the edge.
 */
const width = (text: string): number => Math.ceil(text.length * 7) + 20;

/** The SVG for a badge's facts. Throws on a gate or signature outside its list, or a date outside its pattern. */
export function badgeSvg(facts: BadgeFacts): string {
  if (!(BADGE_GATES as readonly string[]).includes(facts.gate)) throw new Error("the gate part must be one of the badge's gate words");
  if (!(BADGE_SIGNATURES as readonly string[]).includes(facts.signature)) throw new Error("the signature part must be a verdict, an invalid reason or not-checked");
  if (!DATE.test(facts.date)) throw new Error("the date must be YYYY-MM-DD");
  const label = "plumbline gate";
  const words = badgeWords(facts);
  const value = `${words}, ${facts.date}`;
  const left = width(label);
  const right = width(value);
  const total = left + right;
  const said = `Plumbline gate: ${words}, checked on ${facts.date}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${said}">
<title>${said}</title>
<rect width="${left}" height="20" fill="#555"/>
<rect x="${left}" width="${right}" height="20" fill="${BADGE_COLOURS[badgeColour(facts)]}"/>
<g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11">
<text x="10" y="14">${label}</text>
<text x="${left + 10}" y="14">${value}</text>
</g>
</svg>
`;
}
