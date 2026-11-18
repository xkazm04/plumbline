// A small static SVG badge for one gate report: the state word and the date, on one of three colours. The colour is
// never the only signal: the word is always written, and the SVG carries a title and an aria-label that say it again.
// Pure: no node:* import. Every string in it is one of three fixed words or a date in its exact pattern.

import { GATE_STATES, type GateState } from "../core/types.js";

/**
 * The fill for each state, with white text. Each passes 4.5:1 contrast against white (WCAG AA for small text); the
 * ratios were computed 2026-11-18 from the sRGB relative luminance formula. The label's #555 is 7.46:1.
 */
export const BADGE_COLOURS: Record<GateState, string> = {
  pass: "#1b5e20", // green 900: 7.9:1 against #fff
  fail: "#b71c1c", // red 900: 6.6:1
  unavailable: "#424242", // grey 800: 10.05:1; unavailable is not a pass, so it is not green
};

/** The word written on the badge; unavailable says what it means. */
export const BADGE_WORDS: Record<GateState, string> = {
  pass: "pass",
  fail: "fail",
  unavailable: "not checked",
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Width of a text run at 11 px Verdana, the face badges conventionally use: about 7 px per character for lowercase
 * letters, digits and spaces (measured from Verdana's advance widths: 'a' 6.7, 'e' 6.8, '0' 7.0, ' ' 3.9 at 11 px),
 * plus 10 px of padding on each side. Rounded up, so the text never touches the edge.
 */
const width = (text: string): number => Math.ceil(text.length * 7) + 20;

/** The SVG for a gate state on a date (YYYY-MM-DD). Throws on a state outside the three or a date outside its pattern. */
export function badgeSvg(state: GateState, date: string): string {
  if (!(GATE_STATES as readonly string[]).includes(state)) throw new Error("the gate state must be pass, fail or unavailable");
  if (!DATE.test(date)) throw new Error("the date must be YYYY-MM-DD");
  const label = "plumbline gate";
  const value = `${BADGE_WORDS[state]} ${date}`;
  const left = width(label);
  const right = width(value);
  const total = left + right;
  const said = `Plumbline gate: ${BADGE_WORDS[state]} on ${date}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${said}">
<title>${said}</title>
<rect width="${left}" height="20" fill="#555"/>
<rect x="${left}" width="${right}" height="20" fill="${BADGE_COLOURS[state]}"/>
<g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11">
<text x="10" y="14">${label}</text>
<text x="${left + 10}" y="14">${value}</text>
</g>
</svg>
`;
}
