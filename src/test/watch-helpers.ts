// Shared setup for the watch tests: the scripted network a fixture site sees, and a runner.

import { runWatch, type WatchDeps } from "../watch/index.js";
import type { DriftFinding } from "../core/types.js";
import { UPSTREAM_COMMITS_URL } from "../watch/lock.js";
import { fixture, scripted, type Route } from "./net-helpers.js";

export const NOW = new Date("2026-11-17T12:00:00Z");
export const PEER = "https://peer.example/partner";
export const PEER_FILE = "https://peer.example/partner.network.json";
export const PEER_SIGNATURE = "https://peer.example/plumbline.signature.json";
export const PEER_MANIFEST = "https://peer.example/agent-manifest.json";
export const PEER2 = "https://other-peer.example/shuttle";
export const PEER2_FILE = "https://other-peer.example/shuttle.network.json";

/** The newest upstream commit is the one the fixture runtime README names. */
export const UPSTREAM_SAME: Route = { body: [{ sha: "53a787c0123456789abcdef0123456789abcdef0" }] };

export function peerNetwork(label = "partner"): object {
  return { metadata: { description: label }, tools: [{ name: "partner_front", instructions: `Answer as ${label}.` }] };
}

/** Routes for a site whose peers, upstream and signatures are all as locked. */
export function baseRoutes(): Record<string, Route> {
  return {
    [UPSTREAM_COMMITS_URL]: UPSTREAM_SAME,
    [PEER_MANIFEST]: { status: 404 },
    [PEER_FILE]: { body: peerNetwork() },
    [PEER_SIGNATURE]: { status: 404 },
    "https://other-peer.example/agent-manifest.json": { status: 404 },
    [PEER2_FILE]: { body: peerNetwork("shuttle") },
    "https://other-peer.example/plumbline.signature.json": { status: 404 },
  };
}

export async function watch(root: string, routes: Record<string, Route>, extra: { init?: boolean } & WatchDeps = {}) {
  const { init, ...deps } = extra;
  const s = scripted(routes);
  const report = await runWatch({ root, ...(init !== undefined ? { init } : {}) }, { fetch: s.fetch, now: () => NOW, ...deps });
  return { report, findings: report.findings, calls: s.calls };
}

export const ofKind = (findings: DriftFinding[], kind: DriftFinding["kind"]): DriftFinding[] => findings.filter((f) => f.kind === kind);

export { fixture };
