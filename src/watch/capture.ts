// `watch --init` and `watch --relock`: capture the current state into a lock. What is captured, and where from:
//   runtime.files    every file under the vendored runtime folder (`runtime/`, else `site/runtime/`, or deps.runtimeDir),
//                    keyed by path relative to the root with `/` separators. Every hash here is SHA-256 of exact bytes.
//   runtime.commit   the nsdeploy commit the runtime README or NOTICE names ("nsdeploy commit `53a787c`"), else "unknown".
//   runtime.via      when the NOTICE or README says the copy was taken from another repository's folder
//                    ("<owner>/<repo> `<path>` at commit <sha>", as site/runtime/NOTICE does for agentic-web), that
//                    repository, folder and commit; omitted otherwise. The upstream check then asks that folder.
//   grounding        what discover.ts names (the root's agent files and every manifest-named network file), plus
//                    the extra sources (--source, and on --relock every ref the previous lock held), less the refs
//                    --relock --drop names. Each source that is not an agent file itself (a page given with --source)
//                    gets `anchors`: the facts the networks' instructions state that it states too (anchors.ts).
//   peers            every peer discover.ts names, fetched through safeFetch: the hash of its network definition, the
//                    state of its links.json and its signer kid. A peer that cannot be captured goes into
//                    `pendingPeers` with the time, and every watch reports it until a re-lock fills it in.
// Anything else that cannot be captured is NOT written to the lock and comes back as a finding, so a lock with a gap
// is never mistaken for a complete one.

import { join } from "node:path";
import { FORMAT_VERSION, LINKS_FILE, MANIFEST_FILE, type DriftFinding, type GroundingSource } from "../core/types.js";
import { sha256Hex } from "../core/canonical.js";
import { describeKinds, networkLiterals, pageFacts, type FactCoverage } from "./anchors.js";
import type { Lock, PendingPeer, RuntimeVia } from "./decide.js";
import { hashLocal, readRef, type DetectorEnv } from "./detectors.js";
import { discover } from "./discover.js";
import { listFiles, readUnderRoot, toPosix } from "./lock.js";
import { observePeer } from "./observe.js";
import { observeExternal } from "./external.js";
import type { ExternalKind, ExternalRecord } from "../core/types.js";

const COMMIT = /nsdeploy commit\s+`?([0-9a-f]{7,40})`?/i;
/** "cognizant-ai-labs/agentic-web `skills/agentify-website/runtime` at commit 7817c1f..." (site/runtime/NOTICE). */
const VIA = /\b([A-Za-z0-9][A-Za-z0-9-]{0,38}\/(?!\.\.?\s)[A-Za-z0-9._-]{1,100})\s+`([A-Za-z0-9._/-]+)`\s+at commit\s+`?([0-9a-f]{7,40})\b/;

/** The nsdeploy commit and, when there is one, the repository folder the runtime copy was really taken from. */
export function runtimeProvenance(texts: string[]): { commit?: string; via?: RuntimeVia } {
  let commit: string | undefined;
  let via: RuntimeVia | undefined;
  for (const text of texts) {
    commit ??= COMMIT.exec(text)?.[1];
    const found = VIA.exec(text);
    if (via === undefined && found?.[1] && found[2] && found[3] && !found[2].split("/").some((s) => s === "" || s === "." || s === "..")) {
      via = { repo: found[1], path: found[2], commit: found[3] };
    }
  }
  return { ...(commit !== undefined ? { commit } : {}), ...(via !== undefined ? { via } : {}) };
}

export async function captureLock(
  env: DetectorEnv,
  options: {
    extraSources?: string[];
    dropSources?: string[];
    runtimeDir?: string;
    externals?: { kind: ExternalKind; url: string }[];
    now: Date;
    /**
     * The lock a relock replaces. What cannot be re-read now keeps what this lock held (UAT-3): a pinned peer keeps its
     * pin, a pending one its `since`, an external definition its record, and a peer whose signature cannot be read its
     * kid. Nothing pinned is lost to an outage; each kept record is a finding that says so.
     */
    previous?: Lock;
  },
): Promise<{ lock: Lock; findings: DriftFinding[]; coverage: FactCoverage }> {
  const findings: DriftFinding[] = [];
  const { root } = env;

  // runtime
  let runtimeRoot: string | undefined;
  for (const candidate of options.runtimeDir !== undefined ? [options.runtimeDir] : ["runtime", "site/runtime"]) {
    if ((await listFiles(join(root, candidate))).length > 0) {
      runtimeRoot = candidate;
      break;
    }
  }
  const files: Record<string, string> = {};
  let commit = "unknown";
  let via: RuntimeVia | undefined;
  if (runtimeRoot === undefined) {
    findings.push({ kind: "runtime", severity: "info", ref: "runtime", summary: "No vendored runtime folder was found, so no runtime files were locked." });
  } else {
    for (const full of (await listFiles(join(root, runtimeRoot))).sort()) {
      const ref = toPosix(root, full);
      try {
        files[ref] = await hashLocal(env, ref);
      } catch (error) {
        findings.push({ kind: "runtime", severity: "warn", ref, summary: `A runtime file could not be locked: it ${(error as Error).message}.` });
      }
    }
    const texts: string[] = [];
    for (const name of ["README.md", "NOTICE", "NOTICE.md"]) {
      try {
        texts.push(new TextDecoder("utf-8").decode(await readUnderRoot(root, `${runtimeRoot}/${name}`)));
      } catch {
        // try the next candidate
      }
    }
    const provenance = runtimeProvenance(texts);
    if (provenance.commit !== undefined) commit = provenance.commit;
    via = provenance.via;
    if (commit === "unknown") {
      findings.push({ kind: "runtime", severity: "info", ref: runtimeRoot, summary: "The runtime folder does not name an nsdeploy commit, so the lock records \"unknown\"." });
    }
  }

  // grounding
  const found = await discover(root);
  findings.push(...found.findings);
  // --drop wins over everything else, a file the site names included: that one is said so, because every watch's
  // coverage check will report it as not covered for as long as the site names it.
  const drop = new Set(options.dropSources ?? []);
  for (const ref of found.refs.filter((r) => drop.has(r))) {
    findings.push({
      kind: "grounding",
      severity: "warn",
      ref,
      summary: "Dropped from the lock as asked, but the site still names this file, so every watch reports it as not covered until the site stops naming it.",
    });
  }
  const refs = [...new Set([...found.refs, ...(options.extraSources ?? [])])].filter((r) => !drop.has(r));
  // the facts the networks' instructions state (anchors.ts), to anchor on every page that states them too
  const literals = new Set<string>();
  for (const ref of found.networks) {
    try {
      for (const l of networkLiterals(new TextDecoder("utf-8").decode(await readUnderRoot(root, ref)))) literals.add(l);
    } catch {
      // a network that cannot be read is the grounding check's finding; it states nothing to anchor
    }
  }
  const agentFiles = new Set([...found.networks, MANIFEST_FILE, LINKS_FILE]);
  const sources: GroundingSource[] = [];
  const network = [...literals].sort();
  const coverage: FactCoverage = { network, pages: [] };
  for (const ref of refs) {
    let read;
    try {
      read = await readRef(env, ref);
    } catch (error) {
      findings.push({ kind: "grounding", severity: "warn", ref, summary: `A grounding source could not be locked: it ${(error as Error).message}.` });
      continue;
    }
    if (agentFiles.has(ref)) {
      sources.push({ ref, sha256: read.sha256 });
      continue;
    }
    const facts = pageFacts(network, read.bytes);
    if ("problem" in facts) {
      coverage.pages.push({ ref, watched: [], notOnPage: network, problem: facts.problem });
      findings.push({ kind: "grounding", severity: "info", ref, summary: `A grounding source could not be reduced to text (it ${facts.problem}), so no fact the network states is anchored on it; its bytes are still locked.` });
      sources.push({ ref, sha256: read.sha256 });
      continue;
    }
    coverage.pages.push({ ref, ...facts });
    // a page that states none of the facts the network states is locked by its bytes only: say so at capture (UAT-1:
    // "warn at zero"). A network that states no fact the watch reads has nothing to anchor; the coverage lines say so.
    if (facts.watched.length === 0 && network.length > 0) {
      findings.push({
        kind: "grounding",
        severity: "warn",
        ref,
        summary: `No fact is watched on this page: none of the ${network.length} facts the network states (${describeKinds(network)}) was found on it in a form the watch reads, so a change to it is drift with no fact counted.`,
      });
    }
    const anchors = [...new Set(await Promise.all(facts.watched.map((l) => sha256Hex(l))))].sort();
    sources.push({ ref, sha256: read.sha256, ...(anchors.length > 0 ? { anchors } : {}) });
  }
  if (refs.length === 0) {
    findings.push({ kind: "grounding", severity: "info", ref: ".", summary: "No grounding sources were found at the root; pass --source to lock some." });
  }

  // peers
  const peers: Lock["peers"] = {};
  const pendingPeers: Record<string, PendingPeer> = {};
  const previous = options.previous;
  const day = (iso: string): string => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : "earlier");
  for (const url of found.peers) {
    // the same reads every watch makes of a locked peer (observe.ts), with links.json always asked
    const seen = await observePeer(url, env.fetch, { fetchOptions: env.fetchOptions, links: true });
    const { definition: def, links, signature } = seen;
    const pinned = previous?.peers[url];
    if (def.ok && links !== undefined && "state" in links) {
      // the signer: a signature that could not be read is not "unsigned" (UAT-3, TOM-L1-08)
      let kid = "kid" in signature ? signature.kid : undefined;
      if ("problem" in signature) {
        kid = pinned?.kid;
        findings.push({
          kind: "peer",
          severity: "warn",
          ref: url,
          summary:
            kid !== undefined
              ? `A peer's signature could not be read at capture (${signature.problem}), so the lock keeps the key it recorded before; every watch compares the peer's signer with that key.`
              : `A peer's signature could not be read at capture (${signature.problem}), so the lock records no key for it; re-lock once its signature answers.`,
        });
      } else if (kid === undefined && pinned?.kid !== undefined) {
        findings.push({ kind: "peer", severity: "warn", ref: url, summary: "A peer the lock recorded as signed publishes no signature now; the new lock records it as unsigned." });
      }
      peers[url] = {
        sha256: def.sha256,
        links: links.state,
        ...(kid !== undefined ? { kid } : {}),
        ...(def.outline ? { outline: def.outline } : {}),
        checkedAt: options.now.toISOString(),
      };
      continue;
    }
    const detail = !def.ok
      ? def.status !== undefined
        ? `answered HTTP ${def.status}`
        : (def.addressProblem ?? def.refused ?? def.reason ?? "it could not be fetched")
      : links !== undefined && "problem" in links
        ? `its links.json ${links.problem}`
        : "it could not be fetched";
    // UAT-3: what the previous lock held is kept, never replaced by "pending" because the peer is down today
    if (pinned !== undefined) {
      peers[url] = pinned;
      findings.push({
        kind: "peer",
        severity: "warn",
        ref: url,
        summary: `A peer could not be re-read (${detail}), so the lock keeps its earlier pin (recorded ${day(pinned.checkedAt)}); every watch compares the peer with that pin.`,
      });
      continue;
    }
    const wasPending = previous?.pendingPeers?.[url];
    pendingPeers[url] = wasPending ?? { since: options.now.toISOString() };
    findings.push({ kind: "peer", severity: "warn", ref: url, summary: `A peer could not be captured, so the lock holds it as pending and every watch reports it (${detail}).` });
  }

  // external agent definitions (external.ts): through the same guarded fetch. One the previous lock held that cannot be
  // read now keeps its record (UAT-3, TOM-L1-04); a new one that cannot be read is left out of the lock and returned as
  // a finding, as a missing grounding source is
  const external: Record<string, ExternalRecord> = {};
  for (const { kind, url } of options.externals ?? []) {
    if (url in external) continue;
    const seen = await observeExternal(url, kind, env.fetch, { fetchOptions: env.fetchOptions });
    if (!seen.ok) {
      const why = seen.unsupported ? "this build does not read that kind" : seen.status !== undefined ? `it answered HTTP ${seen.status}` : (seen.reason ?? "it could not be read");
      const held = previous?.external?.[url];
      if (held !== undefined && held.kind === kind) {
        external[url] = held;
        findings.push({
          kind: "peer",
          severity: "warn",
          ref: url,
          summary: `An external agent definition could not be re-read (${why}), so the lock keeps its earlier record (recorded ${day(held.checkedAt)}); every watch compares it with that record.`,
        });
        continue;
      }
      findings.push({ kind: "peer", severity: "warn", ref: url, summary: `An external agent definition could not be locked (${why}), so it is not in the lock.` });
      continue;
    }
    if (seen.outline === null) {
      findings.push({ kind: "peer", severity: "info", ref: url, summary: "An external agent definition is not readable as an A2A Agent Card (not JSON, or a repeated key); its bytes are locked without an outline." });
    }
    const parts = seen.outline && Object.keys(seen.outline.parts).length > 0 ? { parts: seen.outline.parts } : {};
    external[url] = { kind, sha256: seen.sha256, ...parts, checkedAt: options.now.toISOString() };
  }

  return {
    lock: {
      version: FORMAT_VERSION,
      runtime: { source: "nsdeploy", commit, files, ...(via !== undefined ? { via } : {}) },
      grounding: { sources, builtAt: options.now.toISOString() },
      peers,
      ...(Object.keys(pendingPeers).length > 0 ? { pendingPeers } : {}),
      ...(Object.keys(external).length > 0 ? { external } : {}),
    },
    findings,
    coverage,
  };
}
