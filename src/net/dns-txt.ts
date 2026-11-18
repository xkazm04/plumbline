// A second channel for first contact: the publisher names its key id in DNS, at `_plumbline.<host>`, as a TXT record
// `v=plumbline1; kid=<16 lowercase hex>` (several records are allowed, so a rotation can list the old and the new key).
// An attacker who controls only the web host cannot change it; one who controls the DNS or the registrar can. It is a
// second channel, never proof, and it never adds trust: `plumbline trust --url` reports what DNS says and still adds
// nothing without --yes (docs/trust-bootstrap.md). Pure: no node:* import; the lookup itself is ./dns.ts.

import { KID_PATTERN } from "../core/types.js";

/** The label the record lives under: `_plumbline.<host>`. */
export const DNS_LABEL = "_plumbline";

/** The record's version tag; a record that starts with it and is not exactly the form below is malformed. */
export const DNS_VERSION = "v=plumbline1";

/** `v=plumbline1; kid=<16 hex>`: the separator `;`, spaces around either part allowed, a trailing `;` allowed. */
const RECORD = /^v=plumbline1\s*;\s*kid=([0-9a-f]{16})\s*;?$/;

/** The TXT record a publisher adds for a key id. */
export function txtRecordFor(kid: string): string {
  if (!KID_PATTERN.test(kid)) throw new Error("a kid is 16 lowercase hex characters");
  return `${DNS_VERSION}; kid=${kid}`;
}

/** The name the record is published under, for a host (a name, never an IP literal). */
export function dnsNameFor(host: string): string {
  return `${DNS_LABEL}.${host.toLowerCase().replace(/\.$/, "")}`;
}

/** What the TXT answer holds: the kids of the well-formed Plumbline records, and how many claimed to be one and are not. */
export interface ParsedTxt {
  kids: string[];
  malformed: number;
}

/**
 * Reads a TXT answer (each record as the chunks DNS returned, joined without a separator as RFC 7208 does for SPF).
 * A record that does not start with `v=plumbline1` is someone else's and is ignored; one that does and is not exactly
 * the form is malformed, counted and never read for a kid.
 */
export function parseTxt(records: string[][]): ParsedTxt {
  const kids: string[] = [];
  let malformed = 0;
  for (const chunks of records) {
    const text = chunks.join("").trim();
    if (!text.toLowerCase().startsWith(DNS_VERSION)) continue;
    const m = RECORD.exec(text);
    if (m?.[1] === undefined) malformed += 1;
    else if (!kids.includes(m[1])) kids.push(m[1]);
  }
  return { kids, malformed };
}

/** The four answers, in the words `trust` prints. */
export const DNS_STATES = ["agrees", "disagrees", "no record", "could not ask"] as const;
export type DnsState = (typeof DNS_STATES)[number];

export interface DnsCheck {
  /** `_plumbline.<host>`, or the host itself when it was not asked (an IP literal). */
  name: string;
  state: DnsState;
  /** The well-formed kids DNS names (agrees, disagrees). */
  kids?: string[];
  /** Records that claim to be Plumbline's and are not in the form. */
  malformed?: number;
  /** Why DNS could not be asked, in Plumbline's words. */
  why?: string;
}

/** What a parsed answer says about a kid: it is named (agrees), others are named (disagrees), or none is (no record). */
export function dnsVerdict(name: string, kid: string, parsed: ParsedTxt): DnsCheck {
  const malformed = parsed.malformed > 0 ? { malformed: parsed.malformed } : {};
  if (parsed.kids.length === 0) return { name, state: "no record", ...malformed };
  return { name, state: parsed.kids.includes(kid) ? "agrees" : "disagrees", kids: parsed.kids, ...malformed };
}

/** One line for a person: what DNS says, with the kids it names (each in its exact pattern) and no other text. */
export function describeDns(check: DnsCheck): string {
  const extra = check.malformed !== undefined ? `; ${check.malformed} record${check.malformed === 1 ? "" : "s"} there ${check.malformed === 1 ? "is" : "are"} not in the ${DNS_VERSION}; kid=<16 hex> form` : "";
  switch (check.state) {
    case "agrees":
      return `dns ${check.name}: agrees (it names this kid${(check.kids?.length ?? 0) > 1 ? ` among ${check.kids?.length}` : ""})${extra}`;
    case "disagrees":
      return `dns ${check.name}: disagrees (it names ${check.kids?.join(", ")}, not this kid)${extra}`;
    case "no record":
      return `dns ${check.name}: no record${extra}`;
    case "could not ask":
      return `dns ${check.name}: could not ask (${check.why ?? "the lookup failed"})`;
  }
}
