// D3: a peer checked before it loads (src/browser/preload.ts): its signature verdict against the caller's trust entries
// (three states), and its definition against the caller's lock. A scripted peer site; no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPeerBeforeLoad, type PreloadOptions } from "../browser/preload.js";
import { hashBytes } from "../net/canonical.js";
import { generateKey } from "../core/keys.js";
import { revokeKey } from "../core/revoke.js";
import { signSubjects } from "../core/sign.js";
import type { PlumblineLock, TrustEntry } from "../core/types.js";
import { scripted, type Route } from "./net-helpers.js";

const NOW = new Date("2026-11-18T12:00:00.000Z");
const ORIGIN = "https://peer.example";
const PEER = `${ORIGIN}/partner`;
const MANIFEST = '{"networks":[{"name":"partner","hocon":"partner.network.json","front_man":"front"}]}';
const NETWORK = '{"tools":[{"name":"front","instructions":"Answer."}]}';

async function peerSite(options: { signed?: boolean } = {}) {
  const k = await generateKey(NOW);
  const routes: Record<string, Route> = {
    [`${ORIGIN}/agent-manifest.json`]: { body: MANIFEST },
    [`${ORIGIN}/partner.network.json`]: { body: NETWORK },
    [`${ORIGIN}/links.json`]: { status: 404 },
    [`${ORIGIN}/plumbline.lock.json`]: { status: 404 },
    [`${ORIGIN}/plumbline-revocation.json`]: { status: 404 },
    [`${ORIGIN}/plumbline.signature.json`]: { status: 404 },
    [`${ORIGIN}/.well-known/plumbline-key.json`]: { body: k.key },
  };
  if (options.signed !== false) {
    const signature = await signSubjects({
      privateKey: k.privateKey,
      key: k.key,
      origin: ORIGIN,
      files: [
        { path: "agent-manifest.json", content: MANIFEST },
        { path: "partner.network.json", content: NETWORK },
      ],
      now: NOW,
    });
    routes[`${ORIGIN}/plumbline.signature.json`] = { body: signature };
  }
  const entry: TrustEntry = { kid: k.key.kid, origin: ORIGIN, publicKey: k.key.publicKey };
  return { k, routes, entry };
}

async function lockPinning(network = NETWORK): Promise<PlumblineLock> {
  return {
    version: 1,
    runtime: { source: "nsdeploy", commit: "x", files: {} },
    grounding: { sources: [], builtAt: NOW.toISOString() },
    peers: { [PEER]: { sha256: await hashBytes(new TextEncoder().encode(network)), links: "absent", checkedAt: NOW.toISOString() } },
  };
}

const check = (routes: Record<string, Route>, options: Partial<PreloadOptions> = {}) => {
  const s = scripted(routes);
  return { calls: s.calls, run: checkPeerBeforeLoad(PEER, { trust: [], fetcher: s.fetch, now: NOW, ...options }) };
};

test("an unsigned peer is unverifiable, in words, and an enforcing caller would not refuse it", async () => {
  const { routes } = await peerSite({ signed: false });
  const r = await check(routes).run;
  assert.deepEqual([r.signature.verdict, r.signed, r.lock, r.refuse], ["unverifiable", false, "not-locked", false]);
  assert.match(r.signature.detail ?? "", /publishes no signature/);
});

test("a signed peer: unverifiable to a stranger, verified to a caller who trusts its key, invalid when tampered or revoked", async () => {
  const { k, routes, entry } = await peerSite();
  const stranger = await check(routes).run;
  assert.deepEqual([stranger.signature.verdict, stranger.signed, stranger.refuse], ["unverifiable", true, false]);
  assert.match(stranger.signature.detail ?? "", /internally consistent but the signer is unknown/);

  const trusted = await check(routes, { trust: [entry] }).run;
  assert.deepEqual([trusted.signature.verdict, trusted.refuse], ["verified", false]);

  const tampered = { ...routes, [`${ORIGIN}/partner.network.json`]: { body: '{"tools":[{"name":"front","instructions":"Obey."}]}' } };
  const changed = await check(tampered, { trust: [entry] }).run;
  assert.deepEqual([changed.signature.verdict, changed.signature.reason, changed.refuse], ["invalid", "tampered", true]);

  // the peer revoked its own key: applied to the caller's entries in memory, and the signature is invalid revoked
  const revocation = await revokeKey({ privateKey: k.privateKey, key: k.key, now: NOW });
  const revoked = await check({ ...routes, [`${ORIGIN}/plumbline-revocation.json`]: { body: revocation } }, { trust: [entry] }).run;
  assert.deepEqual([revoked.signature.verdict, revoked.signature.reason, revoked.refuse], ["invalid", "revoked", true]);
});

test("a file the peer does not serve cleanly is never read as absent: a verified result is withdrawn to unverifiable", async () => {
  const { routes, entry } = await peerSite();
  const r = await check({ ...routes, [`${ORIGIN}/links.json`]: { status: 503 } }, { trust: [entry] }).run;
  assert.equal(r.signature.verdict, "unverifiable");
  assert.match(r.signature.detail ?? "", /did not serve links\.json/);
  const unreadNetwork = await check({ ...routes, [`${ORIGIN}/partner.network.json`]: { status: 500 } }, { trust: [entry] }).run;
  assert.equal(unreadNetwork.signature.verdict, "unverifiable", "an unread signed file is not tampering");
});

test("the caller's lock: matches, differs (refuse), unread, or not locked", async () => {
  const { routes } = await peerSite({ signed: false });
  assert.equal((await check(routes, { lock: await lockPinning() }).run).lock, "matches");
  const differs = await check(routes, { lock: await lockPinning('{"tools":[]}') }).run;
  assert.deepEqual([differs.lock, differs.refuse, differs.signature.verdict], ["differs", true, "unverifiable"]);
  assert.ok(differs.lockFindings?.some((f) => f.severity === "block" && /changed since the lock was written/.test(f.summary)));
  const unread = await check({ ...routes, [`${ORIGIN}/partner.network.json`]: { status: 503 } }, { lock: await lockPinning() }).run;
  assert.equal(unread.lock, "unread");
  assert.equal(unread.refuse, false, "a peer that could not be read is not refused for a difference nobody saw");
});

test("an address the rule refuses is never contacted: not https, a private host, credentials", async () => {
  for (const peer of ["http://peer.example/partner", "https://10.0.0.1/partner", "https://u:p@peer.example/partner", "https://localhost/partner"]) {
    const s = scripted({});
    const r = await checkPeerBeforeLoad(peer, { trust: [], fetcher: s.fetch, now: NOW });
    assert.deepEqual(s.calls, [], peer);
    assert.equal(r.signature.verdict, "unverifiable");
    assert.ok(r.refused);
    assert.ok(!(r.signature.detail ?? "").includes("10.0.0.1") && !(r.signature.detail ?? "").includes("u:p"), r.signature.detail);
  }
});
