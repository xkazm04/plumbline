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

export const atlasAdapter: Adapter = async (ctx: GateContext): Promise<GateFinding> => {
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
