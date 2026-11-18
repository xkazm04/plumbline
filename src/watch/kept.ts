// UAT-18 (DEV-L1-03, DEV-L1-10): the publisher's kept copies of what the lock pinned of each peer, so a changed partner
// can be shown by name later (`plumbline diff --root <site> --peer <url>`) without anyone having saved the old file by
// hand. The lock keeps hashes only (a stranger's words are never written into it); the copies sit beside it, outside
// it, in `<root>/.plumbline/peers/<sha256>.json`: one file per pinned network definition and per pinned links.json,
// named by the SHA-256 of its exact bytes, so the lock's own pin names its copy and two locks share one file.
//
// Written by init, `watch --init` and `--relock` for every definition and links.json the new lock pins, never over an
// existing file, and never removed (another lock in the same folder may still name one). Read back only after its
// bytes hash to the pin, or do so once a checkout's CRLF is made LF again (UAT-13: a checkout that converts line
// endings rewrites JSON files). A missing or different copy is said, never guessed.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { hashBytes } from "../net/canonical.js";
import { lineEndingChange, type Lock } from "./decide.js";
import { readUnderRoot } from "./lock.js";

/** The folder, relative to the site root, that holds the kept copies. */
export const KEPT_DIR = ".plumbline/peers";

const HEX = /^[0-9a-f]{64}$/;

/** The kept copy's path relative to the root for a pinned hash. */
export const keptRef = (sha256: string): string => `${KEPT_DIR}/${sha256}.json`;

/** Every hash the lock pins for a peer: its definition's and, when it recorded one, its links.json's. */
export function pinnedHashes(lock: Lock): Set<string> {
  const out = new Set<string>();
  for (const p of Object.values(lock.peers)) {
    out.add(p.sha256);
    if (p.links !== undefined && HEX.test(p.links)) out.add(p.links);
  }
  return out;
}

/**
 * Writes a copy of every pinned definition and links.json this capture read (`copies`, keyed by the SHA-256 of their
 * bytes) that has none yet. Returns the refs written, sorted. A copy that cannot be written is skipped, and the caller's
 * later read says it is missing: the lock itself is already written and stays the record.
 */
export async function keepCopies(root: string, lock: Lock, copies: ReadonlyMap<string, Uint8Array>): Promise<string[]> {
  const written: string[] = [];
  for (const hash of [...pinnedHashes(lock)].sort()) {
    const bytes = copies.get(hash);
    if (bytes === undefined || !HEX.test(hash) || (await hashBytes(bytes)) !== hash) continue;
    const path = join(root, ...keptRef(hash).split("/"));
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes, { flag: "wx" });
      written.push(keptRef(hash));
    } catch {
      // already kept (EEXIST), or not writable: the read says which
    }
  }
  return written;
}

/** A kept copy read back: its bytes as the lock pinned them, or why there is none to use. */
export type KeptRead = { bytes: Uint8Array; lineEndings?: "crlf" | "lf" } | { missing: true } | { problem: string };

/**
 * The kept copy of a pinned hash, read under the root. Its bytes must hash to the pin; a copy that differs in line
 * endings only (a checkout converted it) is given back with LF restored or CRLF restored, and says so.
 */
export async function readKept(root: string, sha256: string): Promise<KeptRead> {
  if (!HEX.test(sha256)) return { problem: "the pin is not a SHA-256" };
  let bytes: Uint8Array;
  try {
    bytes = await readUnderRoot(root, keptRef(sha256));
  } catch (error) {
    if ((error as { missing?: boolean }).missing === true) return { missing: true };
    return { problem: `it ${(error as Error).message}` };
  }
  if ((await hashBytes(bytes)) === sha256) return { bytes };
  const change = await lineEndingChange(bytes, sha256);
  if (change === "crlf") return { bytes: crlfToLf(bytes), lineEndings: "crlf" };
  if (change === "lf") return { bytes: lfToCrlf(bytes), lineEndings: "lf" };
  return { problem: "its bytes do not hash to the pin (it was edited)" };
}

function crlfToLf(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i += 1) if (!(bytes[i] === 13 && bytes[i + 1] === 10)) out.push(bytes[i]!);
  return Uint8Array.from(out);
}

function lfToCrlf(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 10 && !(i > 0 && bytes[i - 1] === 13)) out.push(13);
    out.push(bytes[i]!);
  }
  return Uint8Array.from(out);
}
