// How a declared file's hash is taken: the one rule `agent init`, `agent relock` (src/agent/build.ts) and `agent check`
// (src/agent/check-files.ts) share. Pure: no node:* import, so it runs wherever WebCrypto does.
//
// `text-lf` (lock version 2): a file holding no NUL byte is text, hashed with every CRLF pair replaced by LF, which is how
// git stores a text file; a lone CR is kept. So a Windows working tree (core.autocrlf, `w/crlf`) and a Linux checkout
// (`w/lf`) of one commit hash the same. A file holding a NUL byte is binary to git and is hashed exactly. No rule (a
// version 1 lock): every file is hashed exactly, as it was locked. The lock's and the approval's own bytes are never
// passed through this: an approval signs exact bytes.

import { sha256Hex } from "../core/canonical.js";
import type { AgentHashingRule } from "../core/types.js";

const CR = 0x0d;
const LF = 0x0a;

/** The bytes as the text rule reads them: unchanged when they hold a NUL byte or no CRLF, else every CRLF as LF. */
export function textLfBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.includes(0)) return bytes;
  let pairs = 0;
  for (let i = 0; i + 1 < bytes.length; i++) if (bytes[i] === CR && bytes[i + 1] === LF) pairs++;
  if (pairs === 0) return bytes;
  const out = new Uint8Array(bytes.length - pairs);
  let o = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === CR && bytes[i + 1] === LF) continue; // the LF that follows is copied next
    out[o++] = bytes[i] as number;
  }
  return out;
}

/** SHA-256 (hex) of a declared file's bytes under `rule`; `undefined` (a version 1 lock) hashes the exact bytes. */
export async function declaredFileHash(bytes: Uint8Array, rule: AgentHashingRule | undefined): Promise<string> {
  return sha256Hex(rule === "text-lf" ? textLfBytes(bytes) : bytes);
}
