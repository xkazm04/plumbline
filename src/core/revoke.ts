// Revocation: a key declares itself dead. Pure: no node:* imports.
//
// Why revocation and not rotation after a leak: a rotation is signed by the old key, so whoever holds a leaked key can
// publish a rotation to a key of their own and it verifies. A revocation is also signed by the old key, but it can only
// ever take trust away, never hand it to anyone, so anyone holding the key may publish it: that is the safe direction.

import { canonicalJson, unsignedBytesOf } from "./canonical.js";
import { isDerivedKid, keyIdOfPrivate, signText, verifyText } from "./keys.js";
import { statementsOf } from "./rotate.js";
import { KID_PATTERN, invalid, isBase64Url, isIsoUtc, isKid } from "./verify.js";
import {
  ALG,
  FORMAT_VERSION,
  REVOCATION_TYPE,
  type PlumblineKey,
  type PlumblineRevocation,
  type TrustEntry,
  type VerifyResult,
} from "./types.js";

export interface RevokeOptions {
  /** base64url PKCS#8 private key of the key being revoked. */
  privateKey: string;
  /** The public key record of the key being revoked. */
  key: PlumblineKey;
  now?: Date;
  /** A note for people. Omitted from the statement when absent. */
  reason?: string;
}

export async function revokeKey(options: RevokeOptions): Promise<PlumblineRevocation> {
  const { privateKey, key, reason } = options;
  if ((await keyIdOfPrivate(privateKey)) !== key.kid) {
    throw new Error("the key record's kid does not belong to the private key");
  }
  if (reason !== undefined && (typeof reason !== "string" || reason.trim() === "")) {
    throw new Error("a reason, when given, must be a non-empty string");
  }
  const unsigned = {
    type: REVOCATION_TYPE,
    version: FORMAT_VERSION,
    alg: ALG,
    kid: key.kid,
    revokedAt: (options.now ?? new Date()).toISOString(),
    ...(reason !== undefined ? { reason } : {}),
  };
  return { ...unsigned, sig: await signText(privateKey, canonicalJson(unsigned)) };
}

function shapeProblem(r: unknown): string | undefined {
  if (typeof r !== "object" || r === null || Array.isArray(r)) return "the revocation is not an object";
  const o = r as Record<string, unknown>;
  if (o.type !== REVOCATION_TYPE) return "the document type is not plumbline-revocation";
  if (o.version !== FORMAT_VERSION) return "the format version is not supported";
  if (o.alg !== ALG) return "the algorithm is not Ed25519";
  if (typeof o.kid !== "string" || !KID_PATTERN.test(o.kid)) return "the kid is not 16 lowercase hex characters";
  if (!isIsoUtc(o.revokedAt)) return "revokedAt is not a UTC ISO timestamp";
  if (o.reason !== undefined && typeof o.reason !== "string") return "the reason is not a string";
  if (!isBase64Url(o.sig)) return "the signature value is not base64url";
  return undefined;
}

/** The earlier of two ISO timestamps (both already checked). */
function earliest(a: string | undefined, b: string): string {
  return a !== undefined && Date.parse(a) <= Date.parse(b) ? a : b;
}

/**
 * The trust entries with every revocation spread to where it belongs, as a new array (entries not affected are
 * returned as they are). Two rules, applied until nothing changes:
 *   1. a kid is revoked everywhere once ANY entry for it carries `revokedAt` (a revocation names no origin);
 *   2. an entry whose `adoptedVia` names a revoked kid is revoked too (it was adopted on that key's word, and a leaked
 *      key could have named its thief's key as successor), and so on down the chain.
 * Each entry keeps the earliest `revokedAt` that reaches it. Pure; it only ever takes trust away.
 */
export function spreadRevocations(entries: readonly TrustEntry[]): TrustEntry[] {
  const dead = new Map<string, string>();
  for (const e of entries) if (e.revokedAt !== undefined) dead.set(e.kid, earliest(dead.get(e.kid), e.revokedAt));
  for (let changed = true; changed; ) {
    changed = false;
    for (const e of entries) {
      const via = e.adoptedVia !== undefined ? dead.get(e.adoptedVia) : undefined;
      if (via === undefined) continue;
      const next = earliest(dead.get(e.kid), via);
      if (next !== dead.get(e.kid)) {
        dead.set(e.kid, next);
        changed = true;
      }
    }
  }
  return entries.map((e) => {
    const at = dead.get(e.kid);
    if (at === undefined || e.revokedAt === at) return e;
    return { ...e, revokedAt: earliest(e.revokedAt, at) };
  });
}

/**
 * Checks a revocation against the trust entry the verifier ALREADY holds for its `kid` (never against a key that arrives
 * with the statement). `verified` returns the entry with `revokedAt` set; the caller replaces its entry with it, and from
 * then on verifySignature and verifyRotation answer `invalid` / `revoked` for that key. No entry (the verifier never
 * trusted the key) is `unverifiable`, and a revocation that does not verify under the trusted key is `invalid`.
 *
 * Pass the verifier's whole trust store as `trustEntries` and a `verified` result also carries `entries`: that store
 * with the revocation applied and spread (spreadRevocations), so every entry for the revoked kid, at every origin, and
 * every entry adopted through a rotation chain that leads to it, carries `revokedAt`. Replace the store with it.
 */
export async function applyRevocation(
  revocation: PlumblineRevocation,
  entry: TrustEntry | undefined,
  trustEntries?: readonly TrustEntry[],
): Promise<VerifyResult & { entry?: TrustEntry; entries?: TrustEntry[] }> {
  const problem = shapeProblem(revocation);
  if (problem !== undefined) {
    return invalid("malformed", `The revocation is malformed: ${problem}.`, undefined, entry?.origin);
  }
  const { kid } = revocation;
  if (entry === undefined || entry.kid !== kid) {
    return {
      verdict: "unverifiable",
      kid,
      ...(entry !== undefined ? { origin: entry.origin } : {}),
      detail: "The revoked key is not one this verifier trusts, so the revocation cannot be checked and changes nothing here.",
    };
  }
  if (!(await isDerivedKid(entry.kid, entry.publicKey))) {
    return invalid(
      "kid-mismatch",
      "The trust store entry for this key does not match its own key id, so the trust store itself is defective.",
      kid,
      entry.origin,
    );
  }
  const { sig } = revocation;
  let signed: string;
  try {
    signed = unsignedBytesOf(revocation);
  } catch {
    return invalid("malformed", "The revocation carries a value canonical JSON cannot encode.", kid, entry.origin);
  }
  if (!(await verifyText(entry.publicKey, signed, sig))) {
    return invalid(
      "bad-signature",
      "The revocation does not verify under the key this verifier trusts for it, so it was not made by that key and is refused.",
      kid,
      entry.origin,
    );
  }
  // Keep the earliest revocation time seen; the time is informational, since a revoked key is dead whatever the dates.
  const mark = (e: TrustEntry): TrustEntry => ({ ...e, revokedAt: earliest(e.revokedAt, revocation.revokedAt) });
  const entries = trustEntries === undefined ? undefined : spreadRevocations(trustEntries.map((e) => (e.kid === kid ? mark(e) : e)));
  return {
    verdict: "verified",
    kid,
    origin: entry.origin,
    detail: "A key this verifier trusts has revoked itself: nothing signed by it is accepted any more.",
    entry: mark(entry),
    ...(entries !== undefined ? { entries } : {}),
  };
}

/** What applyRevocationText did with a revocation file's text. */
export interface RevocationOutcome {
  /** True when at least one revocation in the file verified under a trusted key and `entries` carries it. */
  applied: boolean;
  /**
   * A revoked kid, only when it is a well-formed kid (anything else is never quoted): the kid of a single-statement
   * file, or the kid of the LAST well-formed statement of a list (the newest: `plumbline revoke` appends). Read `kids`
   * for every key a list revokes.
   */
  kid?: string;
  /** Every well-formed kid the file names, once each, in file order (since 2026-11-18). Absent when it names none. */
  kids?: string[];
  /**
   * One result per trust entry checked for each statement, statement by statement in file order; one result for a
   * statement whose kid no entry matched, and one result when the text is not JSON or not a statement file.
   */
  results: VerifyResult[];
  /**
   * The trust entries afterwards, in the order given: with every verified revocation applied and spread (every origin,
   * every adoptedVia chain) when `applied`, otherwise the entries as given. Index i is the caller's entry i.
   */
  entries: TrustEntry[];
}

/** One statement applied to every trust entry for its kid, threading the entries through. */
async function applyOne(
  statement: unknown,
  entries: TrustEntry[],
): Promise<{ applied: boolean; kid?: string; results: VerifyResult[]; entries: TrustEntry[] }> {
  const raw = (statement as { kid?: unknown } | null)?.kid;
  const kid = isKid(raw) ? raw : undefined;
  const revocation = statement as PlumblineRevocation;
  const matching = kid === undefined ? [] : entries.filter((e) => e.kid === kid);
  if (matching.length === 0) {
    const { entry: _none, entries: _all, ...result } = await applyRevocation(revocation, undefined);
    void _none;
    void _all;
    return { applied: false, ...(kid !== undefined ? { kid } : {}), results: [result], entries };
  }
  const results: VerifyResult[] = [];
  let working = entries;
  let applied = false;
  for (const entry of matching) {
    const current = working.find((e) => e.kid === entry.kid && e.origin === entry.origin) ?? entry;
    const { entry: _one, entries: next, ...result } = await applyRevocation(revocation, current, working);
    void _one;
    results.push(result);
    if (result.verdict === "verified" && next) {
      working = next;
      applied = true;
    }
  }
  return { applied, ...(kid !== undefined ? { kid } : {}), results, entries: working };
}

/**
 * Applies the text of a `plumbline-revocation.json` (as read or fetched) to a verifier's trust entries: parses it,
 * takes its statements (one object, or a list of 1..MAX_STATEMENTS_PER_FILE, RevocationFileBody), checks each with
 * applyRevocation against EVERY entry the verifier holds for its kid (a revocation names no origin), and returns the
 * entries with every verified one spread. Only a verified revocation changes anything, and only by taking trust away; a
 * statement in a list that does not verify changes nothing and does not stop the others. The one rule the CLI and the
 * Desk share; the caller decides whether to keep the result in memory or write it back. Pure.
 */
export async function applyRevocationText(text: string, entries: readonly TrustEntry[]): Promise<RevocationOutcome> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      applied: false,
      results: [{ verdict: "invalid", reason: "malformed", detail: "The revocation file is not valid JSON." }],
      entries: [...entries],
    };
  }
  const listed = statementsOf(parsed);
  if ("problem" in listed) {
    // a lone value that is not an object goes to applyRevocation, which words it as before; a bad list is ours to word
    if (!Array.isArray(parsed)) {
      const { entry: _none, entries: _all, ...result } = await applyRevocation(parsed as PlumblineRevocation, undefined);
      void _none;
      void _all;
      return { applied: false, results: [result], entries: [...entries] };
    }
    return {
      applied: false,
      results: [{ verdict: "invalid", reason: "malformed", detail: `The revocation file is malformed: ${listed.problem}.` }],
      entries: [...entries],
    };
  }
  let working: TrustEntry[] = [...entries];
  let applied = false;
  let kid: string | undefined;
  const kids: string[] = [];
  const results: VerifyResult[] = [];
  for (const statement of listed.statements) {
    const one = await applyOne(statement, working);
    results.push(...one.results);
    working = one.entries;
    applied ||= one.applied;
    if (one.kid !== undefined) {
      kid = one.kid;
      if (!kids.includes(one.kid)) kids.push(one.kid);
    }
  }
  return { applied, ...(kid !== undefined ? { kid, kids } : {}), results, entries: working };
}
