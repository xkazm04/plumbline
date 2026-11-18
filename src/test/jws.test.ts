// D5: a standard envelope. Canonical JSON against RFC 8785 (JCS) on the RFC's samples and on Plumbline's own
// documents; the RFC 8037 Ed25519 JWS vector; a detached JWS made and checked independently with WebCrypto; and the
// JWS path giving the same three verdicts as the native one, through the same trust store. No network.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { webcrypto } from "node:crypto";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { base64UrlToBytes, bytesToBase64Url, canonicalJson, unsignedBytesOf } from "../core/canonical.js";
import { generateKey, signText, verifyText } from "../core/keys.js";
import { parseDetachedJws, signDetachedJws, verifyDetachedJws } from "../core/jws.js";
import { revokeKey } from "../core/revoke.js";
import { rotateKey } from "../core/rotate.js";
import { signSubjects } from "../core/sign.js";
import { verifySignature } from "../core/verify.js";
import type { PlumblineSignature, SubjectFile, TrustEntry, TrustStore } from "../core/types.js";

const CLI = fileURLToPath(new URL("../cli/index.js", import.meta.url));
const fixture = (name: string) => readFileSync(new URL(`../../src/test/fixtures/rfc/${name}`, import.meta.url), "utf8");
const T0 = new Date("2026-11-18T12:00:00.000Z");
const ORIGIN = "https://site.example";

let tmp: string;
before(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "plumbline-jws-"));
});
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** RFC 8785 Appendix A's sample canonicalizer, transcribed: the independent reference canonicalJson is held to. */
function jcs(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jcs).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${jcs(o[k])}`)
    .join(",")}}`;
}

test("RFC 8785: canonicalJson gives the RFC's canonical form of its sample and its property order", () => {
  const sample: unknown = JSON.parse(fixture("rfc8785-sample.input.json"));
  assert.equal(canonicalJson(sample), fixture("rfc8785-sample.canonical.txt").trimEnd());
  assert.equal(jcs(sample), canonicalJson(sample), "the transcribed reference agrees");
  // the order of the values in the canonical TEXT (a parsed object would put the integer-like key "1" first)
  const text = canonicalJson(JSON.parse(fixture("rfc8785-sorting.input.json")));
  const order = [...text.matchAll(/:"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, [
    "Carriage Return",
    "One",
    "Control",
    "Latin Small Letter O With Diaeresis",
    "Euro Sign",
    "Emoji: Grinning Face",
    "Hebrew Letter Dalet With Dagesh",
  ]);
});

test("RFC 8785: on Plumbline's own documents canonicalJson IS JCS; the differences are outside JCS's domain", async () => {
  const k = await generateKey(T0);
  const next = await generateKey(T0);
  const signature = await signSubjects({ privateKey: k.privateKey, key: k.key, origin: ORIGIN, files: [{ path: "agent-manifest.json", content: '{"networks":[]}' }], now: T0 });
  const rotation = await rotateKey({ oldPrivateKey: k.privateKey, oldKey: k.key, newKey: next.key, now: T0 });
  const revocation = await revokeKey({ privateKey: k.privateKey, key: k.key, now: T0, reason: "clé perdue, €, \u{1F600}, \"quoted\" \\ \n" });
  for (const doc of [signature, rotation, revocation, k.key]) {
    const parsed: unknown = JSON.parse(JSON.stringify(doc));
    assert.equal(canonicalJson(parsed), jcs(parsed));
    assert.equal(unsignedBytesOf(doc), jcs(JSON.parse(JSON.stringify({ ...doc, sig: undefined }))));
  }
  // outside JCS's domain (I-JSON): a non-finite number (both refuse; canonicalJson throws), an undefined member
  // (dropped; JSON has none), and a lone surrogate (canonicalJson escapes it as JSON.stringify does; JCS refuses it)
  assert.throws(() => canonicalJson({ n: Number.POSITIVE_INFINITY }));
  assert.equal(canonicalJson({ a: undefined, b: 1 }), '{"b":1}');
  assert.equal(canonicalJson({ s: "\ud800" }), '{"s":"\\ud800"}');
});

test("RFC 8037 A.4: Ed25519 over the JWS signing input gives the RFC's signature with the RFC's key", async () => {
  const v = JSON.parse(fixture("rfc8037-a4.json")) as { privateJwk: JsonWebKey & { x: string }; headerB64: string; payloadB64: string; payload: string; signatureB64: string; protectedHeader: string };
  assert.equal(bytesToBase64Url(new TextEncoder().encode(v.protectedHeader)), v.headerB64);
  assert.equal(bytesToBase64Url(new TextEncoder().encode(v.payload)), v.payloadB64);
  const key = await webcrypto.subtle.importKey("jwk", v.privateJwk, "Ed25519", true, ["sign"]);
  const pkcs8 = bytesToBase64Url(new Uint8Array(await webcrypto.subtle.exportKey("pkcs8", key)));
  const input = `${v.headerB64}.${v.payloadB64}`;
  assert.equal(await signText(pkcs8, input), v.signatureB64, "Ed25519 is deterministic: the same signature");
  assert.equal(await verifyText(v.privateJwk.x, input, v.signatureB64), true);
});

// ---- a site, signed, and its detached JWS ----

interface Signed {
  k: Awaited<ReturnType<typeof generateKey>>;
  signature: PlumblineSignature;
  files: SubjectFile[];
}

async function signedSite(): Promise<Signed> {
  const k = await generateKey(T0);
  const files: SubjectFile[] = [
    { path: "agent-manifest.json", content: '{"networks":[{"name":"n","hocon":"n.network.json","front_man":"f"}]}' },
    { path: "n.network.json", content: '{"tools":[{"name":"f","instructions":"Hello."}]}' },
  ];
  const signature = await signSubjects({ privateKey: k.privateKey, key: k.key, origin: ORIGIN, files, now: T0 });
  return { k, signature, files };
}

const storeOf = (...entries: TrustEntry[]): TrustStore => ({ find: (kid, origin) => entries.find((e) => e.kid === kid && e.origin === origin) });

test("an independent detached EdDSA JWS made with WebCrypto verifies here; ours verifies under an independent check", async () => {
  const { k, signature, files } = await signedSite();
  const enc = (s: string) => bytesToBase64Url(new TextEncoder().encode(s));
  // independent: the header written by hand, the payload by the RFC 8785 reference, the signature by WebCrypto itself
  const header = enc(`{"alg":"EdDSA","kid":"${k.key.kid}"}`);
  const { sig: _sig, ...statement } = signature;
  void _sig;
  const input = `${header}.${enc(jcs(statement))}`;
  const priv = await webcrypto.subtle.importKey("pkcs8", base64UrlToBytes(k.privateKey), "Ed25519", false, ["sign"]);
  const theirs = `${header}..${bytesToBase64Url(new Uint8Array(await webcrypto.subtle.sign("Ed25519", priv, new TextEncoder().encode(input))))}`;
  const trusted = storeOf({ kid: k.key.kid, origin: ORIGIN, publicKey: k.key.publicKey });
  assert.equal((await verifyDetachedJws(signature, theirs, files, trusted, { now: T0 })).verdict, "verified");

  const ours = await signDetachedJws(signature, k.privateKey);
  assert.equal(ours, theirs, "the profile's header and payload are fixed, and Ed25519 is deterministic");
  const [h, p, s] = ours.split(".") as [string, string, string];
  assert.equal(p, "", "detached");
  const pub = await webcrypto.subtle.importKey("raw", base64UrlToBytes(k.key.publicKey), "Ed25519", false, ["verify"]);
  assert.ok(await webcrypto.subtle.verify("Ed25519", pub, base64UrlToBytes(s), new TextEncoder().encode(`${h}.${enc(jcs(statement))}`)));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(base64UrlToBytes(h))), { alg: "EdDSA", kid: k.key.kid });
});

test("the JWS path gives the native path's verdict in every case, through the same trust store", async () => {
  const { k, signature, files } = await signedSite();
  const jws = await signDetachedJws(signature, k.privateKey);
  const entry = { kid: k.key.kid, origin: ORIGIN, publicKey: k.key.publicKey };
  const tampered = files.map((f) => (f.path === "n.network.json" ? { ...f, content: '{"tools":[{"name":"f","instructions":"Bye."}]}' } : f));
  const cases: [string, SubjectFile[], TrustStore, object][] = [
    ["stranger", files, storeOf(), { now: T0, publishedKey: k.key }],
    ["trusted", files, storeOf(entry), { now: T0 }],
    ["tampered", tampered, storeOf(entry), { now: T0 }],
    ["expired", files, storeOf(entry), { now: new Date("2027-12-31T00:00:00.000Z") }],
    ["revoked", files, storeOf({ ...entry, revokedAt: T0.toISOString() }), { now: T0 }],
    ["another origin", files, storeOf(entry), { now: T0, expectedOrigin: "https://mirror.example" }],
  ];
  for (const [name, f, store, options] of cases) {
    const native = await verifySignature(signature, f, store, options);
    const viaJws = await verifyDetachedJws(signature, jws, f, store, options);
    assert.deepEqual(viaJws, native, name);
  }
  assert.equal((await verifyDetachedJws(signature, jws, files, storeOf(), { now: T0, publishedKey: k.key })).detail?.startsWith("The signature is internally consistent"), true);
});

test("a JWS that does not belong is refused: another key, a forged signature, a key in the header, a payload, junk", async () => {
  const { k, signature, files } = await signedSite();
  const other = await generateKey(T0);
  const trusted = storeOf({ kid: k.key.kid, origin: ORIGIN, publicKey: k.key.publicKey });
  const jws = await signDetachedJws(signature, k.privateKey);
  const [h, , s] = jws.split(".") as [string, string, string];
  // signed by another key under the right kid: the math fails under the TRUST STORE's key
  const wrongKey = `${h}..${(await signDetachedJws(signature, other.privateKey)).split(".")[2]}`;
  assert.deepEqual([(await verifyDetachedJws(signature, wrongKey, files, trusted, { now: T0 })).reason], ["bad-signature"]);
  // a JWS naming another kid than the document
  const otherKid = await signDetachedJws({ ...signature, kid: other.key.kid }, other.privateKey);
  assert.match((await verifyDetachedJws(signature, otherKid, files, trusted, { now: T0 })).detail ?? "", /names another kid/);
  const enc = (o: object) => bytesToBase64Url(new TextEncoder().encode(JSON.stringify(o)));
  const refusals: [string, RegExp][] = [
    [`${enc({ alg: "EdDSA", kid: k.key.kid, jwk: { kty: "OKP", crv: "Ed25519", x: k.key.publicKey } })}..${s}`, /never takes the key from the artifact/],
    [`${enc({ alg: "EdDSA", kid: k.key.kid, crit: ["exp"] })}..${s}`, /crit/],
    [`${enc({ alg: "ES256", kid: k.key.kid })}..${s}`, /not EdDSA/],
    [`${h}.${bytesToBase64Url(new TextEncoder().encode("x"))}.${s}`, /carries a payload/],
    ["not a jws", /not a compact JWS/],
    [`${bytesToBase64Url(new TextEncoder().encode("nope"))}..${s}`, /not JSON/],
  ];
  for (const [text, detail] of refusals) {
    const r = await verifyDetachedJws(signature, text, files, trusted, { now: T0 });
    assert.deepEqual([r.verdict, r.reason], ["invalid", "malformed"], text);
    assert.match(r.detail ?? "", detail);
  }
  assert.ok("problem" in parseDetachedJws(`${h}..${s}.extra`));
});

test("plumbline export-jws and verify --jws: the same trust file, the same verdicts and exit codes", () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
  const keys = path.join(tmp, "keys");
  const other = path.join(tmp, "other-keys");
  const site = path.join(tmp, "site");
  mkdirSync(site, { recursive: true });
  writeFileSync(path.join(site, "agent-manifest.json"), '{"networks":[]}');
  assert.equal(run("keygen", "--out", keys).status, 0);
  assert.equal(run("keygen", "--out", other).status, 0);
  const key = path.join(keys, "plumbline.private.json");
  assert.equal(run("sign", "--root", site, "--key", key, "--origin", ORIGIN).status, 0);
  const jwsFile = path.join(tmp, "site.jws");
  const exported = run("export-jws", "--root", site, "--key", key, "--out", jwsFile);
  assert.equal(exported.status, 0, exported.stderr);
  assert.match(readFileSync(jwsFile, "utf8"), /^[A-Za-z0-9_-]+\.\.[A-Za-z0-9_-]+\n$/);
  const wrong = run("export-jws", "--root", site, "--key", path.join(other, "plumbline.private.json"));
  assert.equal(wrong.status, 2);
  assert.match(wrong.stderr, /was not made by this key/);

  const trust = path.join(tmp, "plumbline.trust.json");
  const stranger = run("verify", "--root", site, "--trust", trust, "--origin", ORIGIN, "--jws", jwsFile);
  assert.equal(stranger.status, 1, "an absent trust file is an empty one (UAT-23): unverifiable, as without --jws");
  assert.match(stranger.stdout, /^unverifiable/m);
  writeFileSync(trust, '{"version":1,"entries":[]}');
  const unknown = run("verify", "--root", site, "--trust", trust, "--origin", ORIGIN, "--jws", jwsFile);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stdout, /^unverifiable/m);
  const record = JSON.parse(readFileSync(path.join(keys, ".well-known", "plumbline-key.json"), "utf8")) as { kid: string; publicKey: string };
  writeFileSync(trust, JSON.stringify({ version: 1, entries: [{ kid: record.kid, origin: ORIGIN, publicKey: record.publicKey }] }));
  const verified = run("verify", "--root", site, "--trust", trust, "--origin", ORIGIN, "--jws", jwsFile);
  assert.equal(verified.status, 0, verified.stdout + verified.stderr);
  assert.match(verified.stdout, /^verified/m);
  writeFileSync(path.join(site, "agent-manifest.json"), '{"networks": []}');
  const tampered = run("verify", "--root", site, "--trust", trust, "--origin", ORIGIN, "--jws", jwsFile);
  assert.equal(tampered.status, 1);
  assert.match(tampered.stdout, /^invalid tampered/m);
});
