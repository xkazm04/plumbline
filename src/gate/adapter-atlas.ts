// The `atlas` adapter: Agent Atlas' JSON API, GET /api/check?url=. Derived from REAL responses recorded on
// 2026-11-17 (src/test/fixtures/wp2/atlas-check-*.json), not from a guess. The fields read here:
//   summary.verdict   one of "conformant" | "conformant-with-warnings" | "not-conformant" | "unreachable"
//   summary.score     number 0..100
//   summary.counts    { pass, warn, fail, info }
//   summary.mustFails number of failed MUST checks
//   files[0].status   the HTTP status Atlas got for agent-manifest.json (0 when Atlas could not connect at all)
//   checks[].id/status Atlas' own check ids
// Mapping, by Atlas' own fields: conformant and conformant-with-warnings are `pass` (the latter says so);
// not-conformant is `fail`; unreachable is `fail` when Atlas got an HTTP answer without a manifest and `unavailable`
// when Atlas could not connect at all (that is Atlas' network, not a finding about the site). A transport error, a
// non-200, a body that is not JSON, an unrecognised shape, or a verdict that contradicts its own counts is
// `unavailable`. The summary is ours; nothing from the inspected site or Atlas' prose is copied into it.

import type { GateFinding } from "../core/types.js";
import { isBlockedAddress, parseIPv4, parseIPv6 } from "../net/address.js";
import { describeFetchError, finding, type Adapter, type GateContext } from "./context.js";

const NAME = "atlas";

interface AtlasSummary {
  verdict: string;
  score: number;
  mustFails: number;
  warn: number;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads the fields above out of a response, or returns null when the shape is not the recorded one. */
export function readAtlasReport(body: unknown): { summary: AtlasSummary; manifestStatus: number | null; failingIds: string[] } | null {
  if (!isObject(body) || !isObject(body.summary) || !Array.isArray(body.checks)) return null;
  const s = body.summary;
  const counts = s.counts;
  if (typeof s.verdict !== "string" || typeof s.score !== "number" || typeof s.mustFails !== "number" || !isObject(counts)) return null;
  const warn = typeof counts.warn === "number" ? counts.warn : 0;
  const first = Array.isArray(body.files) ? body.files[0] : undefined;
  const manifestStatus = isObject(first) && typeof first.status === "number" ? first.status : null;
  const failingIds = body.checks
    .filter((c): c is Record<string, unknown> => isObject(c) && c.status === "fail" && typeof c.id === "string")
    .map((c) => c.id as string)
    .filter((id) => /^[a-z0-9._-]{1,40}$/i.test(id))
    .slice(0, 3);
  return { summary: { verdict: s.verdict, score: s.score, mustFails: s.mustFails, warn }, manifestStatus, failingIds };
}

/** The fetch refusals that are about the address itself: the gate would not read it, so Atlas is not sent it either. */
const ADDRESS_REFUSALS = new Set(["insecure-scheme", "blocked-address", "dns-failed", "bad-url"]);

function addressRefusal(error: unknown): string | undefined {
  const code = typeof error === "object" && error !== null && (error as { name?: unknown }).name === "SafeFetchError" ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && ADDRESS_REFUSALS.has(code) ? describeFetchError(error) : undefined;
}

/**
 * Why the target is NOT sent to Agent Atlas, or undefined when it may be (UAT-11, PRI-L1-04). Atlas is a public
 * service, so it is sent only an https address the gate itself reads: never an http address (with or without
 * --allow-local), a loopback name or a private or loopback IP, and never one the gate's own fetcher refused (not https,
 * a name that resolves to a private or loopback range, a name that does not resolve, not a URL). The gate's reading of
 * the target is the one the other adapters share (ctx.locate); a target that names a network file directly is fetched
 * once to learn the same. Pure: the address table is ../net/address.ts, the resolution is the fetcher's.
 */
export async function notForAtlas(ctx: GateContext): Promise<string | undefined> {
  let url: URL;
  try {
    url = new URL(ctx.target);
  } catch {
    return "the address is not a valid URL";
  }
  if (url.protocol !== "https:") return "the address is not https";
  const host = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
  if (host === "localhost" || host.endsWith(".localhost")) return "the address names this machine (localhost)";
  if ((parseIPv4(host) !== null || parseIPv6(host) !== null) && isBlockedAddress(host)) return "the address is a private or loopback IP address";
  let located;
  try {
    located = await ctx.locate();
  } catch (error) {
    return addressRefusal(error);
  }
  if (located.ok && located.manifestUrl === undefined) {
    try {
      await ctx.fetch(ctx.target);
    } catch (error) {
      return addressRefusal(error);
    }
  }
  return undefined;
}

export const atlasAdapter: Adapter = async (ctx: GateContext): Promise<GateFinding> => {
  // UAT-11: no address goes to the public Atlas that the gate itself refused, and the finding says so where it happens
  const refused = await notForAtlas(ctx);
  if (refused !== undefined) return finding(NAME, "unavailable", `Not sent to Agent Atlas, a public service: ${refused}. Atlas has no verdict.`);
  const url = `${ctx.atlasBase.replace(/\/+$/, "")}/api/check?url=${encodeURIComponent(ctx.target)}`;
  let response;
  try {
    response = await ctx.fetch(url);
  } catch (error) {
    return finding(NAME, "unavailable", `Agent Atlas could not be reached (${describeFetchError(error)}).`);
  }
  if (response.status !== 200) return finding(NAME, "unavailable", `Agent Atlas answered HTTP ${response.status}, so there is no verdict.`);
  let body: unknown;
  try {
    body = JSON.parse(response.text());
  } catch {
    return finding(NAME, "unavailable", "Agent Atlas answered with something that is not JSON, so there is no verdict.");
  }
  const report = readAtlasReport(body);
  if (report === null) {
    return finding(NAME, "unavailable", "Agent Atlas answered in a shape Plumbline does not recognise, so there is no verdict.");
  }
  const { summary } = report;
  switch (summary.verdict) {
    case "conformant":
      if (summary.mustFails !== 0) break;
      return finding(NAME, "pass", `Agent Atlas reports the target conformant to its checks (score ${summary.score}, no failed MUST checks).`);
    case "conformant-with-warnings":
      if (summary.mustFails !== 0) break;
      return finding(
        NAME,
        "pass",
        `Agent Atlas reports the target conformant with ${summary.warn} warning${summary.warn === 1 ? "" : "s"} (score ${summary.score}, no failed MUST checks).`,
      );
    case "not-conformant": {
      const ids = report.failingIds.length > 0 ? `; failing check ids: ${report.failingIds.join(", ")}` : "";
      return finding(
        NAME,
        "fail",
        `Agent Atlas reports the target not conformant: ${summary.mustFails} failed MUST check${summary.mustFails === 1 ? "" : "s"} (score ${summary.score})${ids}.`,
      );
    }
    case "unreachable":
      if (report.manifestStatus === 0 || report.manifestStatus === null) {
        return finding(NAME, "unavailable", "Agent Atlas could not connect to the target, so it has no verdict about the site.");
      }
      return finding(NAME, "fail", `Agent Atlas found no usable agent-manifest.json at the target (it got HTTP ${report.manifestStatus}).`);
    default:
      return finding(NAME, "unavailable", "Agent Atlas gave a verdict Plumbline does not recognise, so there is no verdict.");
  }
  return finding(NAME, "unavailable", "Agent Atlas' verdict contradicts its own counts, so Plumbline does not trust it.");
};
