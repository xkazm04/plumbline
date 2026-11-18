// Key rotation: the old key names its successor, and a chain of such statements carries trust across several planned
// rotations. Pure: no node:* imports.

import { canonicalJson, unsignedBytesOf } from "./canonical.js";
import { isDerivedKid, keyId, keyIdOfPrivate, signText, verifyText } from "./keys.js";
import { KID_PATTERN, invalid, isBase64Url, isIsoUtc, isPublicKey, resolveTrusted, revokedResult } from "./verify.js";
import {
  FORMAT_VERSION,
  MAX_STATEMENTS_PER_FILE,
  ROTATION_TYPE,
  type PlumblineKey,
  type PlumblineRotation,
  type TrustEntry,
  type TrustStore,
  type VerifyResult,
} from "./types.js";

export interface RotateOptions {
  oldPrivateKey: string;
  oldKey: PlumblineKey;
  newKey: PlumblineKey;
  now?: Date;
}

export async function rotateKey(options: RotateOptions): Promise<PlumblineRotation> {
  const { oldPrivateKey, oldKey, newKey } = options;
  if ((await keyId(newKey.publicKey)) !== newKey.kid) {
    throw new Error("the new key's kid is not derived from its public key");
  }
  if ((await keyIdOfPrivate(oldPrivateKey)) !== oldKey.kid) {
    throw new Error("the old key's kid does not belong to the old private key");
  }
  if (oldKey.kid === newKey.kid) throw new Error("the new key is the old key: a rotation must name a different key");
  const unsigned = {
    type: ROTATION_TYPE,
    version: FORMAT_VERSION,
    from: oldKey.kid,
    to: newKey.kid,
    toPublicKey: newKey.publicKey,
    signedAt: (options.now ?? new Date()).toISOString(),
  };
  return { ...unsigned, sig: await signText(oldPrivateKey, canonicalJson(unsigned)) };
}

function shapeProblem(r: unknown): string | undefined {
  if (typeof r !== "object" || r === null || Array.isArray(r)) return "the rotation statement is not an object";
  const o = r as Record<string, unknown>;
  if (o.type !== ROTATION_TYPE) return "the document type is not plumbline-rotation";
  if (o.version !== FORMAT_VERSION) return "the format version is not supported";
  if (typeof o.from !== "string" || !KID_PATTERN.test(o.from)) return "from is not a kid";
  if (typeof o.to !== "string" || !KID_PATTERN.test(o.to)) return "to is not a kid";
  if (!isPublicKey(o.toPublicKey)) return "toPublicKey is not the base64url of a 32-byte key";
  if (!isIsoUtc(o.signedAt)) return "signedAt is not a UTC ISO timestamp";
  if (!isBase64Url(o.sig)) return "the signature value is not base64url";
  return undefined;
}

/**
 * The statements a parsed statement file holds, as a list: one object is a list of one (every file written before
 * 2026-11-18), an array of 1..MAX_STATEMENTS_PER_FILE values is itself. Anything else (an empty or longer array, a
 * string, a number, null) is a problem sentence. The elements are NOT checked here: each statement's own verifier does
 * that. Shared by rotation chains and revocation lists. Pure.
 */
export function statementsOf(value: unknown): { statements: unknown[] } | { problem: string } {
  if (Array.isArray(value)) {
    if (value.length === 0) return { problem: "the file holds an empty list" };
    if (value.length > MAX_STATEMENTS_PER_FILE) return { problem: `the file holds more than ${MAX_STATEMENTS_PER_FILE} statements` };
    return { statements: value };
  }
  if (typeof value === "object" && value !== null) return { statements: [value] };
  return { problem: "the file holds neither a statement nor a list of statements" };
}

/**
 * Checks a rotation statement against the old key the verifier already trusts for `origin`. `verified` means the
 * caller may adopt `rotation.to` / `rotation.toPublicKey` for that origin. The result's `kid` is always the signer
 * (`from`), as it is for signatures; the key to adopt is read from the statement the caller already holds.
 */
export async function verifyRotation(
  rotation: PlumblineRotation,
  trust: TrustStore,
  origin: string,
): Promise<VerifyResult> {
  const problem = shapeProblem(rotation);
  if (problem !== undefined) return invalid("malformed", `The rotation statement is malformed: ${problem}.`, undefined, origin);
  const { from, to, toPublicKey, sig } = rotation;

  const trusted = await resolveTrusted(trust, from, origin);
  if (trusted && "poisoned" in trusted) {
    return invalid(
      "kid-mismatch",
      "A trust store entry for the old key does not match its own key id, so the trust store itself is defective.",
      from,
      origin,
    );
  }
  // A rotation from a revoked key is never honoured: whoever holds a leaked key could otherwise name their own successor.
  if (trusted && trusted.entry.revokedAt !== undefined) return revokedResult("rotation", from, origin);

  if (!(await isDerivedKid(to, toPublicKey))) {
    return invalid("kid-mismatch", "The new key id in the statement is not derived from the new public key it carries.", from, origin);
  }
  if (from === to) return invalid("malformed", "The rotation names the same key as its successor.", from, origin);

  if (!trusted) {
    return {
      verdict: "unverifiable",
      kid: from,
      origin,
      detail:
        "The old key that signed this rotation is unknown to this verifier, so the statement cannot be checked and the new key must not be adopted on its word.",
    };
  }
  let signed: string;
  try {
    signed = unsignedBytesOf(rotation);
  } catch {
    return invalid("malformed", "The rotation statement carries a value canonical JSON cannot encode.", from, origin);
  }
  return (await verifyText(trusted.entry.publicKey, signed, sig))
    ? { verdict: "verified", kid: from, origin, detail: "A key this verifier already trusts for this origin named its successor." }
    : invalid("bad-signature", "The rotation statement does not verify under the trusted old key.", from, origin);
}

/**
 * The trust entry a verifier adds for `origin` once verifyRotation(rotation, trust, origin) returned `verified`: the
 * successor key, with `adoptedVia` set to the old kid, so a later revocation of the old key (or of any key up the
 * chain) revokes this entry too (applyRevocation, spreadRevocations). It checks the statement's shape, that the old
 * key is trusted, unrevoked, for that origin among `trustEntries`, and that the successor is not recorded as revoked
 * in any entry (a revoked key is never trusted again, the rule first contact follows too); it does NOT check the
 * signature, which is verifyRotation's job and must come first. Throws when a check fails. Plumbline's CLI and Desk
 * never call this on their own: adopting a successor is the verifier's decision.
 */
export function adoptRotation(rotation: PlumblineRotation, trustEntries: readonly TrustEntry[], origin: string): TrustEntry {
  const problem = shapeProblem(rotation);
  if (problem !== undefined) throw new Error(`the rotation statement is malformed: ${problem}`);
  if (rotation.from === rotation.to) throw new Error("the rotation names the same key as its successor");
  const old = trustEntries.find((e) => e.kid === rotation.from && e.origin === origin);
  if (!old) throw new Error("the old key is not trusted for this origin, so its successor cannot be adopted");
  if (trustEntries.some((e) => e.kid === rotation.from && e.revokedAt !== undefined)) {
    throw new Error("the old key has been revoked, so its successor is never adopted");
  }
  if (trustEntries.some((e) => e.kid === rotation.to && e.revokedAt !== undefined)) {
    throw new Error("the successor key is recorded as revoked, and a revoked key is never trusted again");
  }
  return { kid: rotation.to, origin, publicKey: rotation.toPublicKey, adoptedVia: rotation.from };
}

/** One statement of a chain as the walk judged it. */
export interface RotationHop {
  /** The statement's index in the file (0 is the oldest). */
  index: number;
  from: string;
  to: string;
  result: VerifyResult;
}

/** What walkRotationChain found. */
export interface RotationWalk {
  /**
   * `verified` when every statement from the newest key this verifier trusts to the end of the chain linked, verified
   * and named a successor that may be adopted; otherwise the result of the statement where the walk stopped, or
   * `unverifiable` when no key that signed a statement is trusted for the origin.
   */
  result: VerifyResult;
  /** The statements walked, in order, each with its own verifyRotation result. */
  hops: RotationHop[];
  /**
   * The entries to add, in chain order, when the walk completed: each successor not already trusted for the origin,
   * with `adoptedVia` naming the key before it, so a revocation of any key up the chain revokes everything after it.
   * Empty when the walk stopped: a broken chain adopts nothing.
   */
  entries: TrustEntry[];
  /** The index of the statement where the walk stopped, when it did not complete. */
  brokenAt?: number;
  /** The newest key in the chain (the last statement's `to`), when the file was well formed. */
  newest?: string;
}

/**
 * Walks a rotation chain (the statements of a `plumbline-rotation.json`, oldest first; one statement is a chain of one)
 * from the NEWEST key the verifier trusts for `origin` to the end, so a verifier several planned rotations behind
 * follows every one of them. Starting point: the last statement whose `from` has an entry for the origin in
 * `trustEntries` (revoked or not: a revoked one stops the walk as `invalid revoked`). From there each statement must
 * continue from the previous one's `to` (a broken link stops the walk), verify under the key trusted so far
 * (verifyRotation, with each successor already walked counted as trusted), and name a successor adoptRotation accepts.
 * The first statement that fails stops the walk, `brokenAt` names it, and nothing is adopted. Statements before the
 * starting point are never looked at beyond their shape: every statement must be well formed. Pure; adds nothing to
 * any store: the caller appends `entries` once the person confirms.
 */
export async function walkRotationChain(
  statements: readonly unknown[],
  trustEntries: readonly TrustEntry[],
  origin: string,
): Promise<RotationWalk> {
  if (statements.length === 0 || statements.length > MAX_STATEMENTS_PER_FILE) {
    return {
      result: invalid("malformed", `The rotation chain is malformed: it holds no statement, or more than ${MAX_STATEMENTS_PER_FILE}.`, undefined, origin),
      hops: [],
      entries: [],
    };
  }
  for (const [index, statement] of statements.entries()) {
    const problem = shapeProblem(statement);
    if (problem !== undefined) {
      const where = statements.length === 1 ? "The rotation statement" : `Statement ${index} of the rotation chain`;
      return { result: invalid("malformed", `${where} is malformed: ${problem}.`, undefined, origin), hops: [], entries: [], brokenAt: index };
    }
  }
  const chain = statements as readonly PlumblineRotation[];
  const newest = (chain[chain.length - 1] as PlumblineRotation).to;
  let start = -1;
  for (let i = chain.length - 1; i >= 0; i--) {
    if (trustEntries.some((e) => e.kid === (chain[i] as PlumblineRotation).from && e.origin === origin)) {
      start = i;
      break;
    }
  }
  if (start < 0) {
    // the oldest statement's signer is the one a verifier would have to know; verifyRotation words the stranger verdict
    const result = await verifyRotation(chain[chain.length - 1] as PlumblineRotation, { find: () => undefined }, origin);
    return {
      result:
        chain.length === 1
          ? result
          : {
              verdict: "unverifiable",
              origin,
              detail: "No key that signed a statement of this rotation chain is trusted by this verifier for this origin, so the chain cannot be followed and no key in it may be adopted on its word.",
            },
      hops: [],
      entries: [],
      newest,
    };
  }

  const working: TrustEntry[] = [...trustEntries];
  const hops: RotationHop[] = [];
  const entries: TrustEntry[] = [];
  const stop = (index: number, result: VerifyResult): RotationWalk => ({ result, hops, entries: [], brokenAt: index, newest });
  for (let index = start; index < chain.length; index++) {
    const statement = chain[index] as PlumblineRotation;
    const previous = index > start ? (chain[index - 1] as PlumblineRotation) : undefined;
    if (previous !== undefined && statement.from !== previous.to) {
      const result = invalid(
        "malformed",
        `The rotation chain breaks at statement ${index}: it does not continue from the key statement ${index - 1} named, so the chain cannot be followed past it.`,
        statement.from,
        origin,
      );
      hops.push({ index, from: statement.from, to: statement.to, result });
      return stop(index, result);
    }
    const result = await verifyRotation(statement, { find: (kid, o) => working.find((e) => e.kid === kid && e.origin === o) }, origin);
    if (result.verdict !== "verified") {
      const where: VerifyResult =
        chain.length === 1 ? result : { ...result, detail: `Statement ${index} of the rotation chain: ${result.detail ?? result.verdict}` };
      hops.push({ index, from: statement.from, to: statement.to, result: where });
      return stop(index, where);
    }
    let entry: TrustEntry;
    try {
      entry = adoptRotation(statement, working, origin);
    } catch {
      // verifyRotation has already held the old key trusted and unrevoked under this origin's entry; what is left is a
      // revocation recorded in another entry, for the old key or for the successor
      const refused = working.some((e) => e.kid === statement.to && e.revokedAt !== undefined)
        ? invalid(
            "revoked",
            "The successor this rotation names is recorded as revoked by this verifier, and a revoked key is never trusted again.",
            statement.to,
            origin,
          )
        : revokedResult("rotation", statement.from, origin);
      hops.push({ index, from: statement.from, to: statement.to, result: refused });
      return stop(index, refused);
    }
    hops.push({ index, from: statement.from, to: statement.to, result });
    if (!working.some((e) => e.kid === entry.kid && e.origin === origin)) {
      working.push(entry);
      entries.push(entry);
    }
  }
  const first = chain[start] as PlumblineRotation;
  return {
    result:
      hops.length === 1
        ? (hops[0] as RotationHop).result
        : {
            verdict: "verified",
            kid: first.from,
            origin,
            detail: `Every statement from a key this verifier already trusts for this origin to the newest key (${hops.length} statements) links and verifies.`,
          },
    hops,
    entries,
    newest,
  };
}
