// Signing refusals, tamper detection, unknown signers (three states, never two) and the expiry boundary.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalJson,
  generateKey,
  signSubjects,
  verifySignature,
  type GeneratedKey,
  type PlumblineSignature,
  type SubjectFile,
  type TrustEntry,
  type TrustStore,
} from "../core/index.js";
import { signText } from "../core/keys.js";

const ORIGIN = "https://site.example";
const T0 = new Date("2026-11-17T12:00:00.000Z");

const json = (value: unknown): string => JSON.stringify(value);
const MANIFEST = json({ name: "Site", networks: [{ hocon: "n/a.hocon" }], note: "SECRET-INSIDE-FILE" });
const baseFiles = (): SubjectFile[] => [
  { path: "agent-manifest.json", content: MANIFEST },
  { path: "n/a.hocon", content: json({ agents: [{ name: "a", tools: ["x", "y"] }] }) },
  { path: "links.json", content: json({ links: [{ href: "https://site.example/x" }] }) },
  { path: "readme.txt", content: "plain text file\n" },
];

function trustOf(...pairs: [GeneratedKey, string][]): TrustStore {
  const entries: TrustEntry[] = pairs.map(([g, origin]) => ({ kid: g.key.kid, origin, publicKey: g.key.publicKey }));
  return { find: (kid, origin) => entries.find((e) => e.kid === kid && e.origin === origin) };
}

async function signed(g: GeneratedKey, files = baseFiles(), now = T0, days = 30): Promise<PlumblineSignature> {
  return signSubjects({ privateKey: g.privateKey, key: g.key, origin: ORIGIN, files, now, lifetimeDays: days });
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const after = (ms: number): Date => new Date(T0.getTime() + ms);

test("signSubjects: shape, sorted subjects, lifetime, deterministic fields", async () => {
  const g = await generateKey(T0);
  const sig = await signed(g, [...baseFiles()].reverse());
  assert.equal(sig.type, "plumbline-signature");
  assert.equal(sig.version, 1);
  assert.equal(sig.alg, "Ed25519");
  assert.equal(sig.kid, g.key.kid);
  assert.equal(sig.origin, ORIGIN);
  assert.equal(sig.signedAt, "2026-11-17T12:00:00.000Z");
  assert.equal(sig.expiresAt, "2026-12-17T12:00:00.000Z");
  assert.deepEqual(sig.subjects.map((s) => s.path), ["agent-manifest.json", "links.json", "n/a.hocon", "readme.txt"]);
  const defaulted = await signSubjects({ privateKey: g.privateKey, key: g.key, origin: ORIGIN, files: baseFiles(), now: T0 });
  assert.equal(defaulted.expiresAt, "2027-02-15T12:00:00.000Z", "default lifetime is 90 days");
});

test("signSubjects refuses what it must refuse", async () => {
  const g = await generateKey(T0);
  const other = await generateKey(T0);
  const base = { privateKey: g.privateKey, key: g.key, origin: ORIGIN, files: baseFiles(), now: T0 };
  await assert.rejects(signSubjects({ ...base, key: other.key }), /kid/);
  await assert.rejects(signSubjects({ ...base, files: [] }), /no files/);
  await assert.rejects(signSubjects({ ...base, files: [...baseFiles(), { path: "a.json", content: "{}" }, { path: "a.json", content: "{}" }] }), /share a path/);
  // a parsed value is not a file: refused loudly, never canonicalised
  await assert.rejects(signSubjects({ ...base, files: [{ path: "agent-manifest.json", content: { name: "Site" } as never }] }), TypeError);
  // paths outside the rule, and a file set that leaves out what the manifest names
  for (const path of ["../x.json", "a b.json", "/x.json", "a\\b.json", "./x.json"]) {
    await assert.rejects(signSubjects({ ...base, files: [...baseFiles(), { path, content: "x" }] }), /safe site-relative path/, path);
  }
  await assert.rejects(signSubjects({ ...base, files: baseFiles().filter((f) => f.path !== "n/a.hocon") }), /do not include n\/a\.hocon/);
  await assert.rejects(signSubjects({ ...base, files: baseFiles().filter((f) => f.path !== "agent-manifest.json") }), /without agent-manifest\.json/);
  for (const bad of ["http://site.example", "https://site.example/", "https://site.example/path", "site.example", "ftp://site.example", "https://site.example?x=1", ""]) {
    await assert.rejects(signSubjects({ ...base, origin: bad }), /origin/, `origin ${JSON.stringify(bad)}`);
  }
  await assert.rejects(signSubjects({ ...base, lifetimeDays: 0 }), /lifetimeDays/);
  for (const ok of ["https://site.example", "https://site.example:8443", "http://localhost", "http://localhost:3000", "http://127.0.0.1:8080"]) {
    await signSubjects({ ...base, origin: ok });
  }
  await assert.rejects(signSubjects({ ...base, origin: "http://example.com" }), /origin/);
});

test("trusted signer, untouched files: verified; unsigned files are ignored", async () => {
  const g = await generateKey(T0);
  const sig = await signed(g);
  const trust = trustOf([g, ORIGIN]);
  const result = await verifySignature(sig, baseFiles(), trust, { now: after(1000) });
  assert.deepEqual([result.verdict, result.kid, result.origin], ["verified", g.key.kid, ORIGIN]);
  const extra = [...baseFiles(), { path: "unsigned.json", content: json({ anything: 1 }) }];
  assert.equal((await verifySignature(sig, extra, trust, { now: after(1000) })).verdict, "verified");
  const reordered = [...baseFiles()].reverse();
  assert.equal((await verifySignature(sig, reordered, trust, { now: after(1000) })).verdict, "verified");
});

test("subjects are exact bytes: bytes and the same text as a string verify alike; any reformat is tampered", async () => {
  const g = await generateKey(T0);
  const sig = await signed(g);
  const trust = trustOf([g, ORIGIN]);
  const asBytes = baseFiles().map((f) => ({ path: f.path, content: new TextEncoder().encode(f.content as string) }));
  assert.equal((await verifySignature(sig, asBytes, trust, { now: after(1) })).verdict, "verified");
  const reformatted = [
    '{ "note":"SECRET-INSIDE-FILE", "networks":[ {"hocon":"n/a.hocon"} ], "name":"Site" }',
    MANIFEST + "\n",
    MANIFEST.replace(/,/g, ",\r\n"),
    "\uFEFF" + MANIFEST,
  ];
  for (const content of reformatted) {
    const files = baseFiles();
    files[0] = { path: "agent-manifest.json", content };
    const result = await verifySignature(sig, files, trust, { now: after(1) });
    assert.deepEqual([result.verdict, result.reason], ["invalid", "tampered"], JSON.stringify(content).slice(0, 40));
  }
});

test("tamper: changing one member or one character of any signed file is invalid / tampered", async () => {
  const g = await generateKey(T0);
  const sig = await signed(g);
  const trust = trustOf([g, ORIGIN]);
  const mutations: [string, (f: SubjectFile) => string][] = [
    ["agent-manifest.json", () => json({ name: "Site", networks: [{ hocon: "n/a.hocon" }], note: "SECRET-INSIDE-FILE", extra: 1 })],
    ["agent-manifest.json", () => json({ name: "Sitf", networks: [{ hocon: "n/a.hocon" }], note: "SECRET-INSIDE-FILE" })],
    ["n/a.hocon", () => json({ agents: [{ name: "a", tools: ["x"] }] })],
    ["links.json", () => json({ links: [{ href: "https://evil.example/x" }] })],
    ["readme.txt", () => "plain text file\r\n"],
    ["readme.txt", () => "plain text filf\n"],
  ];
  for (const [path, mutate] of mutations) {
    const files = baseFiles().map((f) => (f.path === path ? { path, content: mutate(f) } : f));
    const result = await verifySignature(sig, files, trust, { now: after(1000) });
    assert.deepEqual([result.verdict, result.reason], ["invalid", "tampered"], path);
  }
});

test("tamper: a signed file removed from the file set is invalid / tampered", async () => {
  const g = await generateKey(T0);
  const sig = await signed(g);
  for (const gone of baseFiles().map((f) => f.path)) {
    const files = baseFiles().filter((f) => f.path !== gone);
    const result = await verifySignature(sig, files, trustOf([g, ORIGIN]), { now: after(1000) });
    assert.deepEqual([result.verdict, result.reason], ["invalid", "tampered"], gone);
  }
});

test("tamper: tampering is invalid even when the signer is unknown (it is a defect, not a stranger)", async () => {
  const g = await generateKey(T0);
  const sig = await signed(g);
  const files = baseFiles();
  files[2] = { path: "links.json", content: "{}" };
  const result = await verifySignature(sig, files, trustOf(), { now: after(1000), publishedKey: g.key });
  assert.deepEqual([result.verdict, result.reason], ["invalid", "tampered"]);
});

test("tamper: editing a signature field breaks the signature (bad-signature)", async () => {
  const g = await generateKey(T0);
  const sig = await signed(g);
  const trust = trustOf([g, ORIGIN], [g, "https://other.example"]);
  const edits: [string, (s: PlumblineSignature) => void][] = [
    ["expiresAt extended", (s) => { s.expiresAt = "2031-01-01T00:00:00.000Z"; }],
    ["expiresAt shortened", (s) => { s.expiresAt = "2026-12-01T00:00:00.000Z"; }],
    ["signedAt moved", (s) => { s.signedAt = "2026-11-17T11:59:59.000Z"; }],
    ["origin swapped to another origin the verifier also trusts for this key", (s) => { s.origin = "https://other.example"; }],
    ["sig flipped", (s) => { s.sig = (s.sig[0] === "A" ? "B" : "A") + s.sig.slice(1); }],
  ];
  for (const [name, edit] of edits) {
    const copy = clone(sig);
    edit(copy);
    const result = await verifySignature(copy, baseFiles(), trust, { now: after(1000) });
    assert.deepEqual([result.verdict, result.reason], ["invalid", "bad-signature"], name);
  }
});

test("tamper: editing a signed digest in the signature is caught as tampered (the digest check runs before the math)", async () => {
  const g = await generateKey(T0);
  const sig = clone(await signed(g));
  sig.subjects[0]!.sha256 = "0".repeat(64);
  const result = await verifySignature(sig, baseFiles(), trustOf([g, ORIGIN]), { now: after(1000) });
  assert.deepEqual([result.verdict, result.reason], ["invalid", "tampered"]);
});

test("kid swap to another valid key's id: invalid / bad-signature, because that trusted key did not make this signature", async () => {
  // Justification: the swapped kid resolves, in the VERIFIER's trust store, to key B. Identity is whatever the trust
  // store holds for that kid, never what the artifact claims, so the math is checked under B's key and fails.
  const a = await generateKey(T0);
  const b = await generateKey(T0);
  const sig = clone(await signed(a));
  sig.kid = b.key.kid;
  const result = await verifySignature(sig, baseFiles(), trustOf([a, ORIGIN], [b, ORIGIN]), { now: after(1000) });
  assert.deepEqual([result.verdict, result.reason], ["invalid", "bad-signature"]);
  // and when B is not in the trust store at all, the swap yields a stranger: unverifiable, never verified
  const stranger = await verifySignature(sig, baseFiles(), trustOf([a, ORIGIN]), { now: after(1000), publishedKey: a.key });
  assert.equal(stranger.verdict, "unverifiable");
});

test("a poisoned trust entry (kid not derived from its key) is invalid / kid-mismatch", async () => {
  const a = await generateKey(T0);
  const b = await generateKey(T0);
  const sig = await signed(a);
  const poisoned: TrustStore = { find: (kid, origin) => (kid === a.key.kid ? { kid, origin, publicKey: b.key.publicKey } : undefined) };
  const result = await verifySignature(sig, baseFiles(), poisoned, { now: after(1000) });
  assert.deepEqual([result.verdict, result.reason], ["invalid", "kid-mismatch"]);
  const garbage: TrustStore = { find: (kid, origin) => ({ kid, origin, publicKey: "!!!" }) };
  assert.equal((await verifySignature(sig, baseFiles(), garbage, { now: after(1000) })).reason, "kid-mismatch");
});

test("unknown signer is unverifiable and never verified, even when the math holds under the published key", async () => {
  const g = await generateKey(T0);
  const sig = await signed(g);
  const result = await verifySignature(sig, baseFiles(), trustOf(), { now: after(1000), publishedKey: g.key });
  assert.equal(result.verdict, "unverifiable");
  assert.equal(result.reason, undefined);
  assert.equal(result.kid, g.key.kid);
  assert.match(result.detail ?? "", /internally consistent but the signer is unknown/);
  const blind = await verifySignature(sig, baseFiles(), trustOf(), { now: after(1000) });
  assert.equal(blind.verdict, "unverifiable");
  assert.match(blind.detail ?? "", /cannot be checked/);
  // a trust entry for the same kid under a different origin is still a stranger at this origin
  const wrongOrigin = await verifySignature(sig, baseFiles(), trustOf([g, "https://elsewhere.example"]), { now: after(1000), publishedKey: g.key });
  assert.equal(wrongOrigin.verdict, "unverifiable");
});

test("hostile: a forged signature with a self-consistent enclosed key record is unverifiable, not verified", async () => {
  const victim = await generateKey(T0);
  const attacker = await generateKey(T0);
  const trust = trustOf([victim, ORIGIN]);
  const forgedFiles = [{ path: "agent-manifest.json", content: json({ name: "Totally the real site", payToolUrl: "https://evil.example" }) }];
  const forged = await signSubjects({ privateKey: attacker.privateKey, key: attacker.key, origin: ORIGIN, files: forgedFiles, now: T0 });

  // The attacker's key record is perfectly self-consistent (its kid is derived from its key) and the math holds.
  const own = await verifySignature(forged, forgedFiles, trust, { now: after(1000), publishedKey: attacker.key });
  assert.equal(own.verdict, "unverifiable");
  assert.match(own.detail ?? "", /internally consistent but the signer is unknown/);

  // The attacker claims the victim's kid while shipping their own key record: the trust store's key decides.
  const claim = clone(forged);
  claim.kid = victim.key.kid;
  const claimed = await verifySignature(claim, forgedFiles, trust, { now: after(1000), publishedKey: attacker.key });
  assert.deepEqual([claimed.verdict, claimed.reason], ["invalid", "bad-signature"]);

  // Same claim, but a key record that lies about its kid: no trust, and the record does not vouch for itself.
  const lie = { ...attacker.key, kid: victim.key.kid };
  const claimedEmpty = await verifySignature(claim, forgedFiles, trustOf(), { now: after(1000), publishedKey: lie });
  assert.equal(claimedEmpty.verdict, "unverifiable");
  assert.match(claimedEmpty.detail ?? "", /cannot be checked/);
});

test("verified uses the trust store's key, never options.publishedKey", async () => {
  const real = await generateKey(T0);
  const fake = await generateKey(T0);
  const sig = await signed(real);
  // the trust store holds the real key; the published key is someone else's and must be ignored
  const ok = await verifySignature(sig, baseFiles(), trustOf([real, ORIGIN]), { now: after(1000), publishedKey: fake.key });
  assert.equal(ok.verdict, "verified");
});

test("expiry boundary with a fake clock: one millisecond before is verified, the instant itself is expired", async () => {
  const g = await generateKey(T0);
  const sig = await signed(g, baseFiles(), T0, 1);
  const trust = trustOf([g, ORIGIN]);
  const expires = Date.parse(sig.expiresAt);
  assert.equal(expires, T0.getTime() + 86_400_000);
  assert.equal((await verifySignature(sig, baseFiles(), trust, { now: new Date(expires - 1) })).verdict, "verified");
  const at = await verifySignature(sig, baseFiles(), trust, { now: new Date(expires) });
  assert.deepEqual([at.verdict, at.reason], ["invalid", "expired"]);
  const late = await verifySignature(sig, baseFiles(), trust, { now: new Date(expires + 1) });
  assert.deepEqual([late.verdict, late.reason], ["invalid", "expired"]);
});

test("a signature made in the future (beyond 5 minutes of skew) is malformed; within skew it is fine", async () => {
  const g = await generateKey(T0);
  const sig = await signed(g);
  const trust = trustOf([g, ORIGIN]);
  const early = await verifySignature(sig, baseFiles(), trust, { now: after(-5 * 60_000 - 1) });
  assert.deepEqual([early.verdict, early.reason], ["invalid", "malformed"]);
  assert.equal((await verifySignature(sig, baseFiles(), trust, { now: after(-5 * 60_000) })).verdict, "verified");
});

test("malformed shapes are invalid / malformed and never throw", async () => {
  const g = await generateKey(T0);
  const sig = await signed(g);
  const trust = trustOf([g, ORIGIN]);
  const broken: unknown[] = [
    null,
    "text",
    [],
    {},
    { ...sig, type: "other" },
    { ...sig, version: 2 },
    { ...sig, alg: "RS256" },
    { ...sig, kid: "XYZ" },
    { ...sig, origin: "http://site.example" },
    { ...sig, origin: 5 },
    { ...sig, signedAt: "yesterday" },
    { ...sig, expiresAt: "2026-12-17" },
    { ...sig, sig: 7 },
    { ...sig, sig: "a b" },
    { ...sig, subjects: [] },
    { ...sig, subjects: "none" },
    { ...sig, subjects: [{ path: "a" }] },
    { ...sig, subjects: [{ path: "a", sha256: "abc" }] },
    { ...sig, subjects: [sig.subjects[0], sig.subjects[0]] },
    { ...sig, expiresAt: sig.signedAt },
    // subject paths are held to [A-Za-z0-9._/-] with no empty, '.' or '..' segment
    ...["../etc/passwd", "a b", "/abs", "a\\b", "https://x.example/a", "a/./b", "é.json"].map((path) => ({
      ...sig,
      subjects: [{ path, sha256: "0".repeat(64) }, ...sig.subjects],
    })),
  ];
  for (const bad of broken) {
    const result = await verifySignature(bad as PlumblineSignature, baseFiles(), trust, { now: after(1) });
    assert.deepEqual([result.verdict, result.reason], ["invalid", "malformed"], JSON.stringify(bad)?.slice(0, 80));
  }
});

test("detail is a sentence we wrote, never text copied from the inspected files", async () => {
  const g = await generateKey(T0);
  const sig = await signed(g);
  const files = baseFiles();
  files[0] = { path: "agent-manifest.json", content: json({ note: "SECRET-INSIDE-FILE changed" }) };
  const results = [
    await verifySignature(sig, files, trustOf([g, ORIGIN]), { now: after(1) }),
    await verifySignature(sig, baseFiles(), trustOf(), { now: after(1) }),
    await verifySignature({ ...sig, kid: "SECRET-INSIDE-FILE" } as PlumblineSignature, baseFiles(), trustOf(), { now: after(1) }),
    await verifySignature(
      { ...sig, subjects: [{ path: "SECRET-INSIDE-FILE/../x", sha256: "0".repeat(64) }] } as PlumblineSignature,
      baseFiles(),
      trustOf(),
      { now: after(1) },
    ),
    // a published key record whose fields fail their patterns is ignored, and never quoted
    await verifySignature(sig, baseFiles(), trustOf(), {
      now: after(1),
      publishedKey: { ...g.key, publicKey: "SECRET-INSIDE-FILE" },
    }),
  ];
  for (const r of results) {
    assert.ok(r.detail && r.detail.length > 10);
    assert.ok(!r.detail.includes("SECRET-INSIDE-FILE"));
  }
});

test("the signed bytes are canonical JSON of the signature without sig (verified through a hand-built signature)", async () => {
  const g = await generateKey(T0);
  const files = baseFiles();
  const base = await signed(g, files);
  const { sig, ...unsigned } = base;
  assert.ok(sig);
  const reSigned: PlumblineSignature = { ...unsigned, sig: await signText(g.privateKey, canonicalJson(unsigned)) };
  assert.equal(reSigned.sig, base.sig);
});
