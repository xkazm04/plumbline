// The canonical bytes and SHA-256 come from core, the one authority for them (WP1). This module adds the document
// fingerprints the gate and the watch use on top. The parity test in src/test/net-canonical.test.ts stays.

import { canonicalJson, sha256Hex } from "../core/index.js";

export { canonicalJson, sha256Hex };

/**
 * The fingerprint of a fetched or local document: the canonical JSON when the text parses as JSON, else the text's
 * UTF-8 bytes with CRLF folded to LF (so a Windows checkout of the same file hashes the same). A leading BOM is ignored.
 */
export async function hashDocument(text: string): Promise<string> {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  try {
    return await sha256Hex(canonicalJson(JSON.parse(clean)));
  } catch {
    return await sha256Hex(clean.replace(/\r\n/g, "\n"));
  }
}

/** Like hashDocument for raw bytes; bytes that are not valid UTF-8 are hashed as they are. */
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return await sha256Hex(bytes);
  }
  return await hashDocument(text);
}
