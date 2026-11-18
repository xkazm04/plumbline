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

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { FORMAT_VERSION, LINKS_FILE, MANIFEST_FILE, type DriftFinding, type GroundingSource } from "../core/types.js";
import { sha256Hex } from "../core/canonical.js";
import { anchorPlace, anchorPlaces, describeKinds, networkClauses, networkLiterals, pageFacts, pageLiteralHashes, pagePlacesNow, statedElsewhere, type FactCoverage } from "./anchors.js";
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

/** The .gitattributes line that pins LF for every text file, as the docs and the warning name it. */
export const LF_PIN_LINE = "* text=auto eol=lf";

/**
 * Whether a .gitattributes from the site root up to its repository root (the folder holding .git) pins LF for every
 * file: a `*` line with `eol=lf`, or `* -text` (no conversion at all). Read only, never written.
 */
export async function lfPinned(root: string): Promise<boolean> {
  let dir = resolve(root);
  for (;;) {
    try {
      const text = await readFile(join(dir, ".gitattributes"), "utf8");
      if (/^\*\s+(?:\S+\s+)*(?:eol=lf|-text)(?:\s|$)/m.test(text)) return true;
    } catch {
      // no .gitattributes here
    }
    if (existsSync(join(dir, ".git"))) return false;
    const up = dirname(dir);
    if (up === dir) return false;
    dir = up;
  }
}

/**
 * The capture-time warning for files locked with CRLF line endings (UAT-13, DEV-L2-1), or null when none has any. The
 * lock hashes the bytes as they are here, so a checkout that converted them (Git for Windows sets core.autocrlf=true)
 * makes every watch elsewhere, where they are LF, report them changed. The finding names the .gitattributes line, a few
 * of the publisher's own files (their names, in their own terminal) and the count.
 */
export async function lineEndingWarning(root: string, refs: readonly string[]): Promise<DriftFinding | null> {
  const withCrlf: string[] = [];
  for (const ref of refs) {
    let bytes: Uint8Array;
    try {
      bytes = await readUnderRoot(root, ref);
    } catch {
      continue;
    }
    for (let i = 1; i < bytes.length; i += 1) {
      if (bytes[i] === 10 && bytes[i - 1] === 13) {
        withCrlf.push(ref);
        break;
      }
    }
  }
  if (withCrlf.length === 0) return null;
  const shown = withCrlf.slice(0, 3).map((r) => r.replace(/[\u0000-\u001f\u007f]/g, "?")).join(", ");
  const files = `${withCrlf.length} of the ${refs.length} files this lock hashes end their lines with CRLF (${shown}${withCrlf.length > 3 ? ", ..." : ""})`;
  const why = "A checkout that converts line endings (Git for Windows sets core.autocrlf=true) writes CRLF here while CI and the served site read LF, so every watch there would report these files changed (in line endings only).";
  const ifReal = "If the site really serves these files with CRLF, the lock is right as it is.";
  return {
    kind: "grounding",
    severity: "warn",
    code: "capture-line-endings",
    ref: ".gitattributes",
    summary: (await lfPinned(root))
      ? `${files}, although .gitattributes pins LF: they were checked out before the pin. ${why} Check the files out again so the pin applies, then run this again. ${ifReal}`
      : `${files}, and no .gitattributes pins LF. ${why} Add the line "${LF_PIN_LINE}" to .gitattributes at the repository root, commit it, check the files out again, then run this again. ${ifReal}`,
  };
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
    findings.push({ kind: "runtime", severity: "info", code: "capture-runtime-absent", ref: "runtime", summary: "No vendored runtime folder was found, so no runtime files were locked." });
  } else {
    for (const full of (await listFiles(join(root, runtimeRoot))).sort()) {
      const ref = toPosix(root, full);
      try {
        files[ref] = await hashLocal(env, ref);
      } catch (error) {
        findings.push({ kind: "runtime", severity: "warn", code: "capture-runtime-unreadable", ref, summary: `A runtime file could not be locked: it ${(error as Error).message}.` });
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
      findings.push({ kind: "runtime", severity: "info", code: "capture-runtime-commit-unknown", ref: runtimeRoot, summary: "The runtime folder does not name an nsdeploy commit, so the lock records \"unknown\"." });
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
      code: "capture-source-dropped-named",
      ref,
      summary: "Dropped from the lock as asked, but the site still names this file, so every watch reports it as not covered until the site stops naming it.",
    });
  }
  const refs = [...new Set([...found.refs, ...(options.extraSources ?? [])])].filter((r) => !drop.has(r));
  // the facts the networks' instructions state (anchors.ts), to anchor on every page that states them too
  const literals = new Set<string>();
  // what the networks state, in both normalisations, hashed (for the stale-fact check of a relock, below)
  const statedNow = new Map<string, string>();
  // the networks' texts, for where on a page each fact is (anchors.ts anchorPlaces, MAR-RC-1)
  const networkTexts: string[] = [];
  for (const ref of found.networks) {
    try {
      const text = new TextDecoder("utf-8").decode(await readUnderRoot(root, ref));
      networkTexts.push(text);
      for (const l of networkLiterals(text)) literals.add(l);
      for (const l of networkLiterals(text, { legacy: true })) statedNow.set(await sha256Hex(l), l);
    } catch {
      // a network that cannot be read is the grounding check's finding; it states nothing to anchor
    }
  }
  const agentFiles = new Set([...found.networks, MANIFEST_FILE, LINKS_FILE]);
  const sources: GroundingSource[] = [];
  const network = [...literals].sort();
  const coverage: FactCoverage = { network, pages: [] };
  const pagesNow = new Map<string, Set<string>>();
  const pageBytes = new Map<string, Uint8Array>();
  for (const ref of refs) {
    let read;
    try {
      read = await readRef(env, ref);
    } catch (error) {
      findings.push({ kind: "grounding", severity: "warn", code: "capture-source-unreadable", ref, summary: `A grounding source could not be locked: it ${(error as Error).message}.` });
      continue;
    }
    if (agentFiles.has(ref)) {
      sources.push({ ref, sha256: read.sha256 });
      continue;
    }
    const facts = pageFacts(network, read.bytes);
    if ("problem" in facts) {
      coverage.pages.push({ ref, watched: [], notOnPage: network, problem: facts.problem });
      findings.push({ kind: "grounding", severity: "info", code: "capture-source-no-text", ref, summary: `A grounding source could not be reduced to text (it ${facts.problem}), so no fact the network states is anchored on it; its bytes are still locked.` });
      sources.push({ ref, sha256: read.sha256 });
      continue;
    }
    // where on the page each watched fact is (MAR-RC-1); a fact whose place cannot be told is named at init and relock
    const { places, unplaced } = await anchorPlaces(networkTexts, read.bytes, facts.watched);
    coverage.pages.push({ ref, ...facts, ...(unplaced.length > 0 ? { unplaced } : {}) });
    const now = await pageLiteralHashes(read.bytes);
    if (!("problem" in now)) {
      pagesNow.set(ref, now);
      pageBytes.set(ref, read.bytes);
    }
    // a page that states none of the facts the network states is locked by its bytes only: say so at capture (UAT-1:
    // "warn at zero"). A network that states no fact the watch reads has nothing to anchor; the coverage lines say so.
    if (facts.watched.length === 0 && network.length > 0) {
      findings.push({
        kind: "grounding",
        severity: "warn",
        code: "capture-page-no-fact",
        ref,
        summary: `No fact is watched on this page: none of the ${network.length} facts the network states (${describeKinds(network)}) was found on it in a form the watch reads, so a change to it is drift with no fact counted.`,
      });
    }
    const anchors = [...new Set(await Promise.all(facts.watched.map((l) => sha256Hex(l))))].sort();
    sources.push({ ref, sha256: read.sha256, ...(anchors.length > 0 ? { anchors } : {}), ...(Object.keys(places).length > 0 ? { places } : {}) });
  }
  // A relock never silences a stale fact (UAT-2): a page that no longer states a fact the lock watched on it, while the
  // network still states that fact and no other page in the new lock states it, keeps its earlier record, so every watch
  // still reports it ("the network still states it ..."), and the relock says so. A fact still on the page but no longer
  // where the lock recorded it (MAR-RC-1) is stale too while the network still states it where the page does not.
  // Correcting the network (or the page), or --drop, is how it leaves.
  const clausesNow = networkClauses(networkTexts);
  for (const [i, source] of sources.entries()) {
    const before = options.previous?.grounding.sources.find((p) => p.ref === source.ref);
    const now = pagesNow.get(source.ref);
    const bytes = pageBytes.get(source.ref);
    if (before === undefined || now === undefined || bytes === undefined || before.sha256 === source.sha256 || (before.anchors ?? []).length === 0) continue;
    const onOtherPages = new Set([...pagesNow.entries()].filter(([ref]) => ref !== source.ref).flatMap(([, set]) => [...set]));
    const placesNow = await pagePlacesNow(bytes);
    let moved = 0;
    const stale = (before.anchors ?? []).filter((h) => {
      if (!statedNow.has(h) || onOtherPages.has(h)) return false;
      const where = anchorPlace(h, before.places?.[h], now, placesNow);
      if (where === "gone") return true;
      if (where !== "moved" || "problem" in placesNow || !statedElsewhere(statedNow.get(h) ?? "", clausesNow, placesNow)) return false;
      moved += 1;
      return true;
    });
    if (stale.length === 0) continue;
    sources[i] = before;
    const kinds = describeKinds(stale.map((h) => statedNow.get(h) ?? "money:"));
    findings.push({
      kind: "grounding",
      severity: "warn",
      code: "capture-stale-kept",
      ref: source.ref,
      summary: `Not accepted: the network still states ${stale.length} fact${stale.length === 1 ? "" : "s"} this page no longer states${moved > 0 ? " where the lock recorded it" : ""} (${kinds}), and no other locked page states ${stale.length === 1 ? "it" : "them"}, so the agent may answer with an old fact. The lock keeps its earlier record of this page, so every watch still reports it: correct the network (or the page), then re-lock, or take the page out with --drop.`,
    });
  }

  if (refs.length === 0) {
    findings.push({ kind: "grounding", severity: "info", code: "capture-no-sources", ref: ".", summary: "No grounding sources were found at the root; pass --source to lock some." });
  }

  // UAT-13 (DEV-L2-1): bytes locked with CRLF in a checkout that converts line endings read as changed everywhere else
  const crlf = await lineEndingWarning(root, [...Object.keys(files), ...sources.map((s) => s.ref).filter((r) => !/^https?:\/\//i.test(r))]);
  if (crlf !== null) findings.push(crlf);

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
      // the signer: a signature that could not be read is not "unsigned" (UAT-3, TOM-L1-08). One the peer says it does
      // not have (404, 410) is captured as none, and the lock remembers the kid it had (formerKid), so a later signature
      // by another key is still a signer change (TOM-RC-1). Whether a person named that change is runRelock's decision.
      let kid = "kid" in signature ? signature.kid : undefined;
      let formerKid: string | undefined;
      if ("problem" in signature) {
        kid = pinned?.kid;
        if (kid === undefined) formerKid = pinned?.formerKid;
        findings.push({
          kind: "peer",
          severity: "warn",
          code: kid !== undefined ? "capture-signer-kept" : "capture-signer-unrecorded",
          ref: url,
          summary:
            kid !== undefined
              ? `A peer's signature could not be read at capture (${signature.problem}), so the lock keeps the key it recorded before; every watch compares the peer's signer with that key.`
              : `A peer's signature could not be read at capture (${signature.problem}), so the lock records no key for it; re-lock once its signature answers.`,
        });
      } else if (kid === undefined) {
        formerKid = pinned?.kid ?? pinned?.formerKid;
      }
      peers[url] = {
        sha256: def.sha256,
        links: links.state,
        ...(kid !== undefined ? { kid } : {}),
        ...(formerKid !== undefined ? { formerKid } : {}),
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
        code: "capture-peer-kept",
        ref: url,
        summary: `A peer could not be re-read (${detail}), so the lock keeps its earlier pin (recorded ${day(pinned.checkedAt)}); every watch compares the peer with that pin.`,
      });
      continue;
    }
    const wasPending = previous?.pendingPeers?.[url];
    pendingPeers[url] = wasPending ?? { since: options.now.toISOString() };
    findings.push({ kind: "peer", severity: "warn", code: "capture-peer-pending", ref: url, summary: `A peer could not be captured, so the lock holds it as pending and every watch reports it (${detail}).` });
  }

  // external agent definitions (external.ts): through the same guarded fetch. One the previous lock held that cannot be
  // read now keeps its record (UAT-3, TOM-L1-04); a new one that cannot be read is left out of the lock and returned as
  // a finding, as a missing grounding source is
  const external: Record<string, ExternalRecord> = {};
  for (const { kind, url } of options.externals ?? []) {
    if (url in external) continue;
    const seen = await observeExternal(url, kind, env.fetch, { fetchOptions: env.fetchOptions });
    if (!seen.ok) {
      // the address rule's refusal reads as a peer's does: one situation, one reason (TOM-RC-5)
      const why = seen.unsupported ? "this build does not read that kind" : seen.status !== undefined ? `it answered HTTP ${seen.status}` : (seen.refused ?? seen.reason ?? "it could not be read");
      const held = previous?.external?.[url];
      if (held !== undefined && held.kind === kind) {
        external[url] = held;
        findings.push({
          kind: "peer",
          severity: "warn",
          code: "capture-external-kept",
          ref: url,
          summary: `An external agent definition could not be re-read (${why}), so the lock keeps its earlier record (recorded ${day(held.checkedAt)}); every watch compares it with that record.`,
        });
        continue;
      }
      findings.push({ kind: "peer", severity: "warn", code: "capture-external-unreadable", ref: url, summary: `An external agent definition could not be locked (${why}), so it is not in the lock.` });
      continue;
    }
    if (seen.outline === null) {
      findings.push({ kind: "peer", severity: "info", code: "capture-external-no-outline", ref: url, summary: "An external agent definition is not readable as an A2A Agent Card (not JSON, or a repeated key); its bytes are locked without an outline." });
    }
    const parts = seen.outline && Object.keys(seen.outline.parts).length > 0 ? { parts: seen.outline.parts } : {};
    // UAT-17 (TOM-L1-13): the card's JWS signature count, so an inventory's signer column has a field for a card
    const signatures = seen.outline ? { signatures: seen.outline.signatures } : {};
    external[url] = { kind, sha256: seen.sha256, ...parts, ...signatures, checkedAt: options.now.toISOString() };
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
