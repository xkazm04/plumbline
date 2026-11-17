// Canonical bytes. Pure: no node:* imports, so this runs in Node 22 and in a browser.
// The rule is byte-identical to Agent Customs' canonicalJson (montbaga/agent-customs, Apache-2.0): sorted keys
// (UTF-16 code unit order), no whitespace, members whose value is `undefined` dropped, `null` kept, UTF-8 on the wire.

/** Sorted keys, no whitespace, `undefined` keys dropped, UTF-8. Byte-identical to Agent Customs' canonicalJson. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(record[k])).join(",") + "}";
}

const encoder = new TextEncoder();

/** The UTF-8 bytes of a string. */
export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

function toBytes(data: string | Uint8Array): Uint8Array {
  return typeof data === "string" ? utf8(data) : data;
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("WebCrypto (globalThis.crypto.subtle) is not available in this runtime");
  return s;
}

export { subtle as webCrypto };

/** Lowercase hex SHA-256 of a string (UTF-8) or bytes. */
export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const digest = await subtle().digest("SHA-256", toBytes(data) as BufferSource);
  return bytesToHex(new Uint8Array(digest));
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const BASE64URL = /^[A-Za-z0-9_-]*$/;

/** Strict base64url (no padding, no other alphabet). Throws on anything else. */
export function base64UrlToBytes(text: string): Uint8Array {
  if (typeof text !== "string" || !BASE64URL.test(text) || text.length % 4 === 1) {
    throw new Error("not base64url");
  }
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
