// Approving an agent lock (WP4 builds this; WP0 stub with final signatures). Pure: no node:* imports.
// An approval is an Ed25519 signature by a PERSON's key over one lock's exact bytes (docs/agent-lock.md). Verification
// trusts only the caller's approvers list, which lives outside the repository; a key inside the artifact is never trusted.

import type { AgentApproval, AgentLock, ApproverEntry, ApproversFile, ApprovalState, InvalidReason } from "./types.js";

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

export async function approveLock(options: ApproveOptions): Promise<AgentApproval> {
  void options;
  throw new Error("approveLock is not built yet (WP4)");
}

/**
 * verified: the approval names a kid in `approvers`, its signature verifies with that entry's key, and it covers
 * exactly `lockBytes`. invalid: malformed, a bad signature, or a lock hash that differs (tampered). unverifiable: the
 * kid is in no approvers entry.
 */
export async function verifyApproval(lockBytes: string | Uint8Array, approval: unknown, approvers: readonly ApproverEntry[]): Promise<ApprovalVerdict> {
  void lockBytes;
  void approval;
  void approvers;
  throw new Error("verifyApproval is not built yet (WP4)");
}

/** Parses an approvers file; throws an Error naming what is wrong (never quoting a value) when it is not one. */
export function parseApprovers(text: string): ApproversFile {
  void text;
  throw new Error("parseApprovers is not built yet (WP4)");
}
