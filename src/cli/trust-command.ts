// The verifier's trust-store commands. Neither ever adds trust on its own: each prints what it would add and changes
// nothing until the person confirms with --yes.
//
//   plumbline trust --key <plumbline-key.json> --origin <origin> --file <plumbline.trust.json> [--yes] [--json]
//     First contact: checks that the record's kid is derived from its key, prints the kid to compare out of band, and
//     with --yes appends { kid, origin, publicKey }. Without --yes: exit 1, nothing written.
//   plumbline adopt --root <site dir> --trust <plumbline.trust.json> --origin <origin> [--yes] [--json]
//     A published rotation: core's verifyRotation against the trust file, then with --yes core's adoptRotation entry
//     ({ kid, origin, publicKey, adoptedVia }) is appended. A rotation that does not verify is refused (exit 1).
// Exit 0 when the entry was added or was already there, 1 when nothing was added, 2 on a usage or I/O error.

import path from "node:path";
import { CliError, UsageError, parseArgs, required } from "./args.js";
import {
  ORIGIN_RULE,
  applyRevocationToTrust,
  emit,
  formatResult,
  revocationLines,
  type Out,
  type RevocationReport,
} from "./commands.js";
import { appendEntry, readJsonFile, readTextIfPresent, readTrustFile, trustStoreOf, writeTrustFile } from "./files.js";
import {
  REVOCATION_FILE,
  ROTATION_FILE,
  adoptRotation,
  isAcceptableOrigin,
  isKid,
  isPublicKey,
  keyId,
  verifyRotation,
  type PlumblineRotation,
  type TrustEntry,
  type VerifyResult,
} from "../core/index.js";

export const FIRST_CONTACT_WARNING =
  "Compare this kid, character by character, with the one the publisher gave you out of band (in person, on a call, " +
  "in a signed message or a repository you already trust), never with one the site itself shows: a key trusted on the " +
  "site's own word trusts whoever controls the site today.";

const CONFIRM = "nothing added: confirm out of band, then rerun with --yes";

export async function trust(argv: string[], out: Out): Promise<number> {
  const args = parseArgs(argv, ["key", "origin", "file"], ["yes"]);
  const keyPath = required(args, "key");
  const origin = required(args, "origin");
  const file = required(args, "file");
  if (!isAcceptableOrigin(origin)) throw new UsageError(ORIGIN_RULE);

  const record = (await readJsonFile(keyPath, "key record")) as Record<string, unknown> | null;
  if (typeof record !== "object" || record === null || Array.isArray(record) || !isKid(record.kid) || !isPublicKey(record.publicKey)) {
    throw new CliError(`not a Plumbline key record (a kid of 16 lowercase hex and a 32-byte base64url publicKey): ${keyPath}`);
  }
  const { kid, publicKey } = record as { kid: string; publicKey: string };
  let derived: string | undefined;
  try {
    derived = await keyId(publicKey);
  } catch {
    derived = undefined;
  }
  if (derived !== kid) throw new CliError(`the key record's kid is not derived from its public key, so it is refused: ${keyPath}`);

  const store = await readTrustFile(file, { missingIsEmpty: true });
  // A revocation recorded for this kid anywhere is final: never trusted again, at any origin.
  if (store.entries.some((e) => e.kid === kid && e.revokedAt !== undefined)) {
    throw new CliError(`${file} records key ${kid} as revoked; a revoked key is never trusted again: ask the publisher for its new key`);
  }
  const already = store.entries.some((e) => e.kid === kid && e.origin === origin);
  const entry: TrustEntry = { kid, origin, publicKey };
  const yes = args.flags.has("yes");
  const lines = [`kid ${kid} for ${origin}`, `public key ${publicKey}`, `WARNING: ${FIRST_CONTACT_WARNING}`];
  let added = false;
  let code: number;
  if (already) {
    lines.push(`already trusted: ${file} has this key for ${origin}; nothing to add`);
    code = 0;
  } else if (!yes) {
    lines.push(CONFIRM);
    code = 1;
  } else {
    appendEntry(store, entry);
    await writeTrustFile(store);
    added = true;
    lines.push(`added to ${file}`);
    code = 0;
  }
  emit(args, out, { kid, origin, publicKey, trustFile: file, added, alreadyTrusted: already, warning: FIRST_CONTACT_WARNING }, lines);
  return code;
}

export async function adopt(argv: string[], out: Out): Promise<number> {
  const args = parseArgs(argv, ["root", "trust", "origin"], ["yes"]);
  const root = required(args, "root");
  const trustPath = required(args, "trust");
  const origin = required(args, "origin");
  if (!isAcceptableOrigin(origin)) throw new UsageError(ORIGIN_RULE);
  const yes = args.flags.has("yes");
  const store = await readTrustFile(trustPath);

  // A revocation published beside the rotation is applied first: a rotation from a revoked key is never honoured. It is
  // written to the trust file only with --yes; without it, adopt changes nothing (verify records it).
  let revocation: RevocationReport | undefined;
  const revocationFile = path.join(root, REVOCATION_FILE);
  const revocationText = await readTextIfPresent(revocationFile);
  if (revocationText !== undefined) revocation = await applyRevocationToTrust(revocationFile, revocationText, store, yes);

  const rotationFile = path.join(root, ROTATION_FILE);
  const text = await readTextIfPresent(rotationFile);
  if (text === undefined) throw new CliError(`${ROTATION_FILE} not found in ${root}`);
  let rotation: unknown;
  try {
    rotation = JSON.parse(text);
  } catch {
    rotation = undefined;
  }
  const result: VerifyResult =
    rotation === undefined
      ? { verdict: "invalid", reason: "malformed", origin, detail: "The rotation file is not valid JSON." }
      : await verifyRotation(rotation as PlumblineRotation, trustStoreOf(store.entries), origin);
  const lines = revocation ? revocationLines(revocation, store, yes) : [];
  const report = { ...(revocation ? { revocation } : {}), results: [result] };

  if (result.verdict !== "verified") {
    lines.push(formatResult(result), "nothing adopted: only a rotation signed by a key you already trust, unrevoked, for this origin is adopted");
    emit(args, out, { ...report, added: false }, lines);
    return 1;
  }
  const statement = rotation as PlumblineRotation;
  let entry: TrustEntry;
  try {
    entry = adoptRotation(statement, store.entries, origin);
  } catch (error) {
    throw new CliError(`cannot adopt: ${(error as Error).message}`);
  }
  lines.push(
    `rotation ${statement.from} -> ${statement.to} for ${origin}`,
    formatResult(result),
    `successor public key ${statement.toPublicKey}`,
  );
  const already = store.entries.some((e) => e.kid === entry.kid && e.origin === origin);
  let added = false;
  let code: number;
  if (already) {
    lines.push(`already trusted: ${trustPath} has ${entry.kid} for ${origin}; nothing to add`);
    code = 0;
  } else if (!yes) {
    lines.push("nothing adopted: adopting a successor is your decision; rerun with --yes to add it");
    code = 1;
  } else {
    appendEntry(store, entry);
    await writeTrustFile(store);
    added = true;
    lines.push(`adopted ${entry.kid} for ${origin} into ${trustPath}, recorded as adopted via ${statement.from}`);
    code = 0;
  }
  emit(args, out, { ...report, from: statement.from, to: statement.to, origin, trustFile: trustPath, added, alreadyTrusted: already }, lines);
  return code;
}
