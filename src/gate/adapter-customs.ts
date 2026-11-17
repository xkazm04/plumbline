// The `customs` adapter: a RECEIPT adapter. Agent Customs (https://montbaga.github.io/agent-customs, repo
// montbaga/agent-customs) inspects in the visitor's browser and has no HTTP check API (read on 2026-11-17: its README,
// practice/agent-mcp.json, practice/customs/receipts.js, site/receipts/index.json, .well-known/agent-customs-key.json).
// What it does publish is signed receipts: for each network in its list, an ES256 (ECDSA P-256, SHA-256) signature over
// canonicalJson(receipt), a public key, and an index. This adapter reads those. Steps:
//   1. learn the target's network address(es) (`<site base><network name>`, the address Customs stamps);
//   2. look the address up in `receipts/index.json`. No entry: `unavailable`, reason "no receipt for this target".
//      The index is unsigned and only points; the receipt is the authority;
//   3. fetch the receipt, check its signature with Node WebCrypto against Customs' key, and require the key to equal
//      the key pinned in this build (see PINNED_CUSTOMS_KEY): a changed key is `unavailable`, never trusted silently;
//   4. a failed signature is `fail`; a receipt for another network, or an index that disagrees with the receipt, is
//      `unavailable`; an expired receipt (past its own expiresAt, or 35 days after inspectedAt, whichever is first) is
//      `unavailable`: an old stamp does not stand in for a fresh check;
//   5. report the stamped verdict: CLEARED and CONDITIONS are `pass`; HOLD, DENIED and INVALID are `fail`; anything else
//      (UNREADABLE, an unknown code) is `unavailable`.
// What this does NOT do, and the summary says so: it does not recheck the live network. Customs' fingerprint is the
// SHA-256 of the canonical JSON of the runtime's NORMALISED config (replacement strings expanded, defaults pushed down,
// `links` split off), which cannot be reproduced from the published file without the runtime, so a stamp for a network
// that changed since is not detected here; the watch's peer and grounding detectors cover change over time.

import type { GateFinding, GateState } from "../core/types.js";
import { canonicalJson, sha256Hex } from "../net/canonical.js";
import { describeFetchError, finding, worst, type Adapter, type GateContext, type PinnedCustomsKey } from "./context.js";

const NAME = "customs";
const RECEIPT_DAYS = 35;
const DAY_MS = 86_400_000;
const NOT_RECHECKED = "The live network was not rechecked: Plumbline cannot reproduce Customs' fingerprint, so a change since the stamp would not show here.";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const subtle = (): SubtleCrypto => globalThis.crypto.subtle;

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function fromBase64Url(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "base64url"));
}

/** Customs' key id: the first 12 bytes of SHA-256 of canonicalJson({crv,kty,x,y}), base64url (receipts.js keyIdOf). */
export async function customsKeyId(jwk: { crv: string; kty: string; x: string; y: string }): Promise<string> {
  const { crv, kty, x, y } = jwk;
  const digest = await sha256Hex(canonicalJson({ crv, kty, x, y }));
  return toBase64Url(Buffer.from(digest, "hex").subarray(0, 12));
}

/** receipts.js receiptPath: https://shop.example/agents/bakery becomes shop.example/agents/bakery.json. */
export function customsReceiptPath(networkUrl: string): string {
  const u = new URL(networkUrl);
  const parts = u.pathname.split("/").filter(Boolean).map((p) => p.replace(/[^\w.-]/g, "_"));
  return `${u.host.replace(/[^\w.-]/g, "_")}/${parts.join("/") || "index"}.json`;
}

function normaliseNetworkUrl(text: string): string | null {
  try {
    const u = new URL(text);
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

type KeyOutcome = { ok: true; jwk: JsonWebKey & { crv: string; kty: string; x: string; y: string } } | { ok: false; summary: string };

async function loadKey(ctx: GateContext): Promise<KeyOutcome> {
  let response;
  try {
    response = await ctx.fetch(new URL(".well-known/agent-customs-key.json", ctx.customsBase).toString());
  } catch (error) {
    return { ok: false, summary: `Agent Customs' public key could not be fetched (${describeFetchError(error)}).` };
  }
  if (response.status !== 200) return { ok: false, summary: `Agent Customs' public key request answered HTTP ${response.status}.` };
  let body: unknown;
  try {
    body = JSON.parse(response.text());
  } catch {
    return { ok: false, summary: "Agent Customs' public key file is not JSON." };
  }
  const key = isObject(body) ? body.publicKey : undefined;
  if (
    !isObject(body) ||
    body.alg !== "ES256" ||
    typeof body.keyId !== "string" ||
    !isObject(key) ||
    key.kty !== "EC" ||
    key.crv !== "P-256" ||
    typeof key.x !== "string" ||
    typeof key.y !== "string"
  ) {
    return { ok: false, summary: "Agent Customs' public key file is not in the recorded shape." };
  }
  const jwk = { crv: key.crv, kty: key.kty, x: key.x, y: key.y };
  if ((await customsKeyId(jwk)) !== body.keyId) return { ok: false, summary: "Agent Customs' published key id does not match its key." };
  const pinned: PinnedCustomsKey | null = ctx.customsPinnedKey;
  if (pinned !== null && (pinned.keyId !== body.keyId || pinned.publicKey.x !== jwk.x || pinned.publicKey.y !== jwk.y)) {
    return { ok: false, summary: "Agent Customs now publishes a different key than the one pinned in this build, so its receipts are not trusted until Plumbline is updated." };
  }
  return { ok: true, jwk };
}

async function checkOne(ctx: GateContext, entry: Record<string, unknown>, networkUrl: string, key: JsonWebKey & { x: string }): Promise<{ state: GateState; summary: string }> {
  const un = (summary: string): { state: GateState; summary: string } => ({ state: "unavailable", summary });
  const path = customsReceiptPath(networkUrl);
  if (entry.path !== path) return un("Agent Customs' index names a receipt location that does not match its own naming rule, so Plumbline did not follow it.");
  let response;
  try {
    response = await ctx.fetch(new URL(`receipts/${path}`, ctx.customsBase).toString());
  } catch (error) {
    return un(`The receipt could not be fetched (${describeFetchError(error)}).`);
  }
  if (response.status !== 200) return un(`The receipt request answered HTTP ${response.status}.`);
  let signed: unknown;
  try {
    signed = JSON.parse(response.text());
  } catch {
    return un("The receipt file is not JSON.");
  }
  const receipt = isObject(signed) ? signed.receipt : undefined;
  const signature = isObject(signed) ? signed.signature : undefined;
  if (
    !isObject(receipt) ||
    !isObject(signature) ||
    receipt.type !== "agent-customs-receipt" ||
    receipt.version !== 1 ||
    signature.alg !== "ES256" ||
    typeof signature.value !== "string" ||
    typeof receipt.verdict !== "string" ||
    typeof receipt.network !== "string" ||
    typeof receipt.inspectedAt !== "string" ||
    typeof receipt.expiresAt !== "string"
  ) {
    return un("The receipt is not in the recorded shape.");
  }
  const keyId = await customsKeyId(key as { crv: string; kty: string; x: string; y: string });
  const inspector = receipt.inspector;
  if (signature.keyId !== keyId || !isObject(inspector) || inspector.keyId !== keyId) {
    return { state: "fail", summary: "The receipt claims a different signing key than Agent Customs' published key, so its signature does not check out." };
  }
  let valid = false;
  try {
    const imported = await subtle().importKey("jwk", { ...key, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    valid = await subtle().verify(
      { name: "ECDSA", hash: "SHA-256" },
      imported,
      fromBase64Url(signature.value) as BufferSource,
      new TextEncoder().encode(canonicalJson(receipt)) as BufferSource,
    );
  } catch {
    valid = false;
  }
  if (!valid) return { state: "fail", summary: "The receipt's signature does not verify against Agent Customs' key: the receipt was changed after it was signed or was not signed by Customs." };
  if (normaliseNetworkUrl(receipt.network) !== normaliseNetworkUrl(networkUrl)) {
    return un("The signed receipt is for a different network than the one asked about.");
  }
  if (entry.verdict !== receipt.verdict) return un("Agent Customs' index and its signed receipt disagree about the verdict, so Plumbline reports neither.");
  const inspected = Date.parse(receipt.inspectedAt);
  const expires = Date.parse(receipt.expiresAt);
  if (!Number.isFinite(inspected) || !Number.isFinite(expires)) return un("The signed receipt has no usable dates.");
  const validUntil = Math.min(expires, inspected + RECEIPT_DAYS * DAY_MS);
  const when = `inspected ${receipt.inspectedAt.slice(0, 10)}, valid until ${new Date(validUntil).toISOString().slice(0, 10)}`;
  if (ctx.now().getTime() > validUntil) {
    return un(`The signed receipt has expired (${when}); an old stamp does not stand in for a fresh check.`);
  }
  switch (receipt.verdict) {
    case "CLEARED":
      return { state: "pass", summary: `Agent Customs' signed receipt stamps the network CLEARED (${when}); the signature checks out. ${NOT_RECHECKED}` };
    case "CONDITIONS":
      return { state: "pass", summary: `Agent Customs' signed receipt stamps the network cleared with conditions (${when}); the signature checks out. ${NOT_RECHECKED}` };
    case "HOLD":
    case "DENIED":
    case "INVALID":
      return {
        state: "fail",
        summary: `Agent Customs' signed receipt stamps the network ${receipt.verdict} (${when}); the signature checks out. ${NOT_RECHECKED}`,
      };
    default:
      return un("The signed receipt carries a verdict Plumbline does not recognise, so there is no verdict.");
  }
}

export const customsAdapter: Adapter = async (ctx: GateContext): Promise<GateFinding> => {
  let located;
  try {
    located = await ctx.locate();
  } catch (error) {
    return finding(NAME, "unavailable", `Agent Customs was not asked: the target could not be reached to learn its network address (${describeFetchError(error)}).`);
  }
  if (!located.ok || located.networks.length === 0) {
    return finding(NAME, "unavailable", "Agent Customs was not asked: no network address could be worked out for the target.");
  }
  let indexResponse;
  try {
    indexResponse = await ctx.fetch(new URL("receipts/index.json", ctx.customsBase).toString());
  } catch (error) {
    return finding(NAME, "unavailable", `Agent Customs' receipt index could not be fetched (${describeFetchError(error)}).`);
  }
  if (indexResponse.status !== 200) {
    return finding(NAME, "unavailable", `Agent Customs' receipt index request answered HTTP ${indexResponse.status}.`);
  }
  let index: unknown;
  try {
    index = JSON.parse(indexResponse.text());
  } catch {
    return finding(NAME, "unavailable", "Agent Customs' receipt index is not JSON.");
  }
  if (!isObject(index) || !Array.isArray(index.receipts)) {
    return finding(NAME, "unavailable", "Agent Customs' receipt index is not in the recorded shape.");
  }
  const entries = index.receipts.filter(isObject);

  const outcomes: { state: GateState; summary: string }[] = [];
  let keyOutcome: KeyOutcome | undefined;
  for (const network of located.networks) {
    const wanted = normaliseNetworkUrl(network.networkUrl);
    const entry = entries.find((e) => typeof e.network === "string" && normaliseNetworkUrl(e.network) === wanted);
    if (entry === undefined) {
      outcomes.push({ state: "unavailable", summary: "Unavailable: no receipt for this target in Agent Customs' published receipts. The live network was not rechecked." });
      continue;
    }
    keyOutcome ??= await loadKey(ctx);
    if (!keyOutcome.ok) {
      outcomes.push({ state: "unavailable", summary: keyOutcome.summary });
      continue;
    }
    outcomes.push(await checkOne(ctx, entry, network.networkUrl, keyOutcome.jwk));
  }
  const state = worst(outcomes.map((o) => o.state));
  const chosen = outcomes.find((o) => o.state === state) ?? outcomes[0];
  const extra = outcomes.length > 1 ? ` (${outcomes.length} networks on this target; the worst is shown)` : "";
  return finding(NAME, state, `${chosen?.summary ?? "No result."}${extra}`);
};
