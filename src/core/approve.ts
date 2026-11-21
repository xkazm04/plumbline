// Approving an agent lock. Pure: no node:* imports.
// An approval is an Ed25519 signature by a PERSON's key over one lock's exact bytes (docs/agent-lock.md, "Approval and
// audit"). It is signed as rotations and revocations are: canonical JSON of the statement without `sig`
// (unsignedBytesOf). Verification trusts only the caller's approvers list, which lives outside the repository; a key
// inside the artifact is never trusted, and an approval carries none.

import { sha256Hex, unsignedBytesOf } from "./canonical.js";
import { isDerivedKid, keyIdOfPrivate, signText, verifyText } from "./keys.js";
import { isBase64Url, isIsoUtc } from "./verify.js";
import {
  AGENT_APPROVAL_TYPE,
  AGENT_FORMAT_VERSION,
  ALG,
  APPROVERS_TYPE,
  KID_PATTERN,
  PUBLIC_KEY_PATTERN,
  SHA256_PATTERN,
  type AgentApproval,
  type AgentLock,
  type ApproverEntry,
  type ApproversFile,
  type ApprovalState,
  type InvalidReason,
} from "./types.js";

export interface ApproveOptions {
  /** The approver's private key (PrivateKeyFile.privateKey). */
  privateKey: string;
  /** The lock's exact bytes as committed. */
  lockBytes: string | Uint8Array;
  /** The same lock, parsed: its `previous` is repeated in the approval. */
  lock: AgentLock;
  now?: Date;
}

export interface ApprovalVerdict {
  state: Exclude<ApprovalState, "absent">;
  /** Set when `state` is `invalid`. */
  reason?: InvalidReason;
  /** The approvers entry whose key verified the approval, when `state` is `verified`. */
  approver?: ApproverEntry;
}

/** The longest approver label, in characters: a name or a role fits; a paragraph does not. */
export const MAX_APPROVER_LABEL = 80;

const APPROVAL_KEYS = new Set(["type", "version", "alg", "kid", "lock", "previous", "approvedAt", "sig"]);
const ENTRY_KEYS = new Set(["kid", "publicKey", "label", "addedAt"]);
// C0 and C1 controls, and the bidi and zero-width format characters that reorder or hide text in a terminal.
const UNPRINTABLE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/u;

/**
 * Signs one lock: `{type, version, alg, kid, lock: sha256(lockBytes), previous?, approvedAt, sig}`. The kid is derived
 * from the private key, never taken from a record. Throws when `lock.previous` is present but not a SHA-256.
 */
export async function approveLock(options: ApproveOptions): Promise<AgentApproval> {
  const { privateKey, lockBytes, lock } = options;
  if (lock.previous !== undefined && !(typeof lock.previous === "string" && SHA256_PATTERN.test(lock.previous))) {
    throw new Error("the lock's previous is not a SHA-256");
  }
  const kid = await keyIdOfPrivate(privateKey);
  const unsigned = {
    type: AGENT_APPROVAL_TYPE,
    version: AGENT_FORMAT_VERSION,
    alg: ALG,
    kid,
    lock: await sha256Hex(lockBytes),
    ...(lock.previous !== undefined ? { previous: lock.previous } : {}),
    approvedAt: (options.now ?? new Date()).toISOString(),
  };
  return { ...unsigned, sig: await signText(privateKey, unsignedBytesOf(unsigned)) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Why a value is not an approval statement, or undefined when its shape is one. Never quotes a value. */
export function approvalShapeProblem(value: unknown): string | undefined {
  if (!isRecord(value)) return "the approval is not an object";
  for (const key of Object.keys(value)) if (!APPROVAL_KEYS.has(key)) return "the approval has a member the format does not define";
  if (value.type !== AGENT_APPROVAL_TYPE) return "the document type is not plumbline-agent-approval";
  if (value.version !== AGENT_FORMAT_VERSION) return "the format version is not supported";
  if (value.alg !== ALG) return "the algorithm is not Ed25519";
  if (typeof value.kid !== "string" || !KID_PATTERN.test(value.kid)) return "the kid is not 16 lowercase hex characters";
  if (typeof value.lock !== "string" || !SHA256_PATTERN.test(value.lock)) return "lock is not a SHA-256";
  if (value.previous !== undefined && (typeof value.previous !== "string" || !SHA256_PATTERN.test(value.previous))) {
    return "previous is not a SHA-256";
  }
  if (!isIsoUtc(value.approvedAt)) return "approvedAt is not a UTC ISO timestamp";
  if (!isBase64Url(value.sig)) return "the signature value is not base64url";
  return undefined;
}

/** The lock's `previous`, when its bytes parse as a lock-shaped object; `null` when they do not parse at all. */
function previousOf(lockBytes: string | Uint8Array): string | undefined | null {
  try {
    const parsed: unknown = JSON.parse(typeof lockBytes === "string" ? lockBytes : new TextDecoder().decode(lockBytes));
    if (!isRecord(parsed)) return null;
    return typeof parsed.previous === "string" ? parsed.previous : undefined;
  } catch {
    return null;
  }
}

/**
 * verified: the approval names a kid in `approvers`, its signature verifies with that entry's key, and it covers
 * exactly `lockBytes`. invalid: malformed (including a `previous` that differs from the lock's own), a bad signature,
 * a lock hash that differs (tampered: checked first, since it needs no trust), or an approvers entry whose kid is not
 * derived from its key (kid-mismatch: the trust store itself is defective). unverifiable: the kid is in no approvers
 * entry. Never throws.
 */
export async function verifyApproval(lockBytes: string | Uint8Array, approval: unknown, approvers: readonly ApproverEntry[]): Promise<ApprovalVerdict> {
  if (approvalShapeProblem(approval) !== undefined) return { state: "invalid", reason: "malformed" };
  const a = approval as AgentApproval;
  if ((await sha256Hex(lockBytes)) !== a.lock) return { state: "invalid", reason: "tampered" };
  const entries = approvers.filter((e) => e.kid === a.kid);
  if (entries.length === 0) return { state: "unverifiable" };
  for (const entry of entries) {
    if (!(await isDerivedKid(entry.kid, entry.publicKey))) return { state: "invalid", reason: "kid-mismatch" };
  }
  const entry = entries[0] as ApproverEntry;
  let signed: string;
  try {
    signed = unsignedBytesOf(a);
  } catch {
    return { state: "invalid", reason: "malformed" };
  }
  if (!(await verifyText(entry.publicKey, signed, a.sig))) return { state: "invalid", reason: "bad-signature" };
  // the approval repeats the lock's previous so the chain can be followed from approvals alone; a signed statement that
  // repeats it wrongly is not a statement about this lock's chain
  const previous = previousOf(lockBytes);
  if (previous !== null && previous !== a.previous) return { state: "invalid", reason: "malformed" };
  return { state: "verified", approver: entry };
}

function entryProblem(value: unknown, index: number): string | undefined {
  const where = `approver ${index}`;
  if (!isRecord(value)) return `${where} is not an object`;
  for (const key of Object.keys(value)) if (!ENTRY_KEYS.has(key)) return `${where} has a member the format does not define`;
  if (typeof value.kid !== "string" || !KID_PATTERN.test(value.kid)) return `${where}: the kid is not 16 lowercase hex characters`;
  if (typeof value.publicKey !== "string" || !PUBLIC_KEY_PATTERN.test(value.publicKey)) {
    return `${where}: the public key is not the base64url of a 32-byte key`;
  }
  if (typeof value.label !== "string" || value.label.trim() === "") return `${where}: the label is not a non-empty string`;
  if ([...value.label].length > MAX_APPROVER_LABEL) return `${where}: the label is longer than ${MAX_APPROVER_LABEL} characters`;
  if (UNPRINTABLE.test(value.label)) return `${where}: the label holds a control or bidi character`;
  if (!isIsoUtc(value.addedAt)) return `${where}: addedAt is not a UTC ISO timestamp`;
  return undefined;
}

/**
 * Parses an approvers file; throws an Error naming what is wrong (never quoting a value) when it is not one. Checks the
 * type and version, every entry's kid and public key patterns, label and addedAt, and refuses a repeated kid or key.
 * It is synchronous, so it cannot hash: that each kid is derived from its key is checked by approversKidProblem (and
 * again by verifyApproval, which reports a defective entry as `invalid kid-mismatch`).
 */
export function parseApprovers(text: string): ApproversFile {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("the approvers file is not JSON");
  }
  if (!isRecord(value)) throw new Error("the approvers file is not an object");
  if (value.type !== APPROVERS_TYPE) throw new Error("the document type is not plumbline-approvers");
  if (value.version !== AGENT_FORMAT_VERSION) throw new Error("the format version is not supported");
  if (!Array.isArray(value.approvers)) throw new Error("approvers is not a list");
  const kids = new Set<string>();
  const keys = new Set<string>();
  const approvers: ApproverEntry[] = [];
  for (const [index, entry] of value.approvers.entries()) {
    const problem = entryProblem(entry, index);
    if (problem !== undefined) throw new Error(problem);
    const e = entry as ApproverEntry;
    if (kids.has(e.kid) || keys.has(e.publicKey)) throw new Error(`approver ${index} repeats a key an earlier entry holds`);
    kids.add(e.kid);
    keys.add(e.publicKey);
    approvers.push({ kid: e.kid, publicKey: e.publicKey, label: e.label, addedAt: e.addedAt });
  }
  return { type: APPROVERS_TYPE, version: AGENT_FORMAT_VERSION, approvers };
}

/** The first entry whose kid is not derived from its public key, as a sentence (never quoting a value), or undefined. */
export async function approversKidProblem(approvers: readonly ApproverEntry[]): Promise<string | undefined> {
  for (const [index, entry] of approvers.entries()) {
    if (!(await isDerivedKid(entry.kid, entry.publicKey))) return `approver ${index}: the kid is not derived from its public key`;
  }
  return undefined;
}
