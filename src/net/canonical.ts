// The hashes the gate and the watch use. core is the one authority for canonical bytes and SHA-256 (WP1); this module
// adds the document fingerprints on top. The parity test in src/test/net-canonical.test.ts stays.
//
// Every fingerprint is SHA-256 of the EXACT bytes, with no JSON canonicalisation, no CRLF folding and no BOM
// stripping. A re-serialised file IS a different file to the reference runtime: it parses network files with its own
// HOCON reader, which merges duplicate keys that a JSON reader would collapse, so "the same JSON" is not "the same
// program". Repositories pin LF (`.gitattributes`: `* text=auto eol=lf`) and web servers serve bytes as stored, so a
// Windows checkout does not change a hash.

import { canonicalJson, sha256Hex } from "../core/index.js";

export { canonicalJson, sha256Hex };

/**
 * The fingerprint of a document you hold as text: SHA-256 of its UTF-8 bytes, nothing normalised. Prefer hashBytes on
 * the bytes you fetched: decoding first drops a leading BOM and replaces invalid sequences, which changes the hash.
 */
export async function hashDocument(text: string): Promise<string> {
  return sha256Hex(text);
}

/** The fingerprint of fetched or read bytes: SHA-256 of exactly those bytes. */
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  return sha256Hex(bytes);
}
