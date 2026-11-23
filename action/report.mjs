// The Action's decisions, in plain Node with no dependencies and no build, so the Action runs it straight from its own
// checkout and `node --test "action/*.test.mjs"` tests every decision that the Action's shell only carries out:
//
//   node report.mjs inputs                               refuse bad inputs (read from PLUMBLINE_*), before any build
//   node report.mjs gate  <report.json>                  the gate state and the job summary
//   node report.mjs watch <report.json> <issue-body.md>  the warn-or-block count and the drift issue's body
//   node report.mjs agent <report.json> <exit> <issue-body.md>
//                                                        `agent check`: the state, the job summary, the count and the body
//   node report.mjs title [agent]                        print the drift issue's title (the agent's has its own)
//   node report.mjs issue <findings> <issue-body.md> <open-issues.json> <comment.md> [<report.json>]
//                                                        what to do with the drift issue: create, edit, close or none
//   node report.mjs pr-branch <relock|renew>             print the branch of a mode's one pull request
//   node report.mjs renew-needed <report.json>           print true when the site's signature is near or past expiry
//   node report.mjs pr <relock|renew> <report.json> <relock.json|-> <sign.json|-> <open-prs.json> <body.md> <comment.md>
//                                                        what to do with the pull request: create, edit, close or none
//
// The report the CLI wrote is read ONCE (gate or watch). The issue step reads what that read produced: the count, and the
// body, which carries the findings' digest in a hidden marker, so a later run can tell which findings are new.
// Outputs go to $GITHUB_OUTPUT (to stdout when it is unset) and the gate summary to $GITHUB_STEP_SUMMARY (skipped when
// it is unset).
// A gate report that cannot be read gives `state=unknown` and exit 0: the CLI's own exit code decides the step. A watch
// report that cannot be read, or has no findings list, is exit 2: the CLI said it wrote one, so that is a real error,
// and reading it as clean would close an open drift issue.

import { appendFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ISSUE_TITLE = "Plumbline drift";
/** The agent check's own issue (`command: agent`), so a repository that watches a site too keeps the two apart. */
export const AGENT_ISSUE_TITLE = "Plumbline agent drift";
const SEVERITY_RANK = { block: 0, warn: 1 };

/**
 * Why the Action's inputs cannot run, or null when they can. Checked before the build, so a misconfigured workflow goes
 * red at once with the reason, never after a minute of npm ci, and never as a quiet run that checked nothing.
 * `rootIsFolder` says whether `root` names a folder in the workspace: `watch` needs one, and so does a `gate` with no
 * target, which checks the files there (UAT-22).
 */
export function inputProblem({ command, target, failOn, issues, rootIsFolder, relockPr = "false", renew = "false", signingKey = false, origin = "", siteAddress = "", desk = "", assignee = "", offline = "false" }) {
  if (command !== "gate" && command !== "watch" && command !== "agent") return "command must be gate, watch or agent";
  // UAT-30: a GitHub login (the pattern GitHub allows), and only where there is an issue to assign
  if (assignee !== "" && !/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(assignee)) return "assignee must be a GitHub login, like octocat";
  if (assignee !== "" && issues !== "true") return "assignee goes with issues: true: it names the person the drift issue is assigned to";
  // UAT-29: the Desk link is built from these, so each is a plain https address or empty
  if (siteAddress !== "" && deskLink(siteAddress) === null) return "site-address must be the https address the site is published at, like https://example.org/";
  if (desk !== "" && deskLink("https://example.org/", desk) === null) return "desk must be an https address, like https://plumbline.xkazm04.workers.dev/";
  if (issues !== "true" && issues !== "false") return "issues must be true or false";
  if (relockPr !== "true" && relockPr !== "false") return "relock-pr must be true or false";
  if (renew !== "true" && renew !== "false") return "renew must be true or false";
  if (offline !== "true" && offline !== "false") return "offline must be true or false";
  if (command !== "agent" && offline === "true") return "offline goes with command agent only";
  // fail-on is the gate's and the agent check's (each has an unavailable state); the watch's exit is its findings, so a
  // fail-on other than the default there would be ignored in silence
  if (command === "watch" && failOn !== undefined && failOn !== "fail") return "fail-on goes with command gate or agent only: the watch reports findings and has no unavailable state";
  if (command === "agent") {
    if (failOn !== "fail" && failOn !== "unavailable") return "fail-on must be fail or unavailable";
    if (!rootIsFolder) return "root must name a folder in the workspace: the repository folder holding plumbline.agent.json";
    // the agent lock's relock pull request is not built yet, and CI never signs or approves anything (UAT-34)
    if (relockPr === "true") return "relock-pr does not go with command agent yet: relock the agent lock with plumbline agent relock, review it, approve it and commit both";
    if (renew === "true") return "renew goes with command watch only: an agent lock is approved by a person, never renewed by CI";
    if (signingKey) return "signing-key does not go with command agent: CI never approves an agent lock; a person runs plumbline approve with their own key";
    return null;
  }
  if (command === "gate") {
    if (failOn !== "fail" && failOn !== "unavailable") return "fail-on must be fail or unavailable";
    // UAT-22: with no target the gate checks the files at `root` (a branch before deployment), with the validator only
    if (!target && !rootIsFolder) return "command gate needs a target (an https address) or a root folder in the workspace (the site's files, to gate a branch before deployment)";
    if (issues === "true") return "issues: true goes with command watch only (the gate keeps no drift issue)";
    if (relockPr === "true" || renew === "true") return "relock-pr and renew go with command watch only";
    return null;
  }
  if (!rootIsFolder) return "root must name a folder in the workspace: the site folder holding plumbline.lock.json";
  if (relockPr === "true" && renew === "true") return "relock-pr and renew are separate workflows: give one of them (action/templates/ has one for each)";
  if (renew === "true" && !signingKey) return "renew: true needs signing-key (a secret holding plumbline.private.json): a renewal is a new signature";
  // UAT-34: CI never signs a change before a person has reviewed it. A relock is signed by a person on the pull
  // request's branch, or, once merged, by the renew workflow over the merged files.
  if (relockPr === "true" && signingKey) {
    return "signing-key goes with renew only: CI never signs a relock before a person reviews it. Sign the relock pull request's branch yourself, or merge it and let the renew workflow sign the merged files";
  }
  if (renew === "true" && signingKey && !/^https:\/\/[^/\s]+$/.test(origin)) {
    return "signing needs origin: the https origin the site is published from, like https://example.org";
  }
  if (signingKey && renew !== "true") return "signing-key goes with renew only: nothing else signs";
  return null;
}

/** A finding's kind for the digest: a watch finding's `kind`, or an agent finding's `code` (it has no kind). */
function kindOf(f) {
  return String(f?.kind ?? f?.code ?? "");
}

/** One Markdown table cell: pipes escaped, line breaks folded, absent values empty. */
export function cell(text) {
  return String(text ?? "")
    .replace(/\|/g, "\\|")
    .replace(/[\r\n]+/g, " ");
}

/** The findings that are not clean: severity `warn` or `block`. `info` stays in the job log. */
export function openFindings(report) {
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  const open = findings.filter((f) => f && (f.severity === "warn" || f.severity === "block"));
  // A lock that is not `found` means nothing was checked: that is never clean, so it keeps (or opens) the issue.
  const state = report?.lockState;
  if (typeof state === "string" && state !== "found") {
    const why = typeof report?.lockSummary === "string" && report.lockSummary ? report.lockSummary : `lock ${state}`;
    open.unshift({ severity: "warn", kind: "grounding", ref: "plumbline.lock.json", summary: state === "absent" ? "no lock" : why, lockState: state });
  }
  return open;
}

/**
 * The digest of the open findings: severity, kind and ref, and the finding's evidence when it has one (`actual`: the
 * hash of what changed, a peer's new links.json, a signer's kid), block first, without duplicates. New evidence for the
 * same ref is news (UAT-6: a partner that changed again, a page whose price changed after a wording edit, a fee change
 * that keeps every outline count). The summary is left out, and a finding with no evidence (an unreachable peer) has
 * none, so a peer that is still unreachable after 12 s instead of 10 s stays the same finding and nobody is notified.
 */
export function digestOf(report) {
  const seen = new Set();
  const rows = [];
  for (const f of openFindings(report)) {
    const row = [String(f.severity), kindOf(f), String(f.ref ?? ""), ...evidenceOf(f)];
    const key = JSON.stringify(row);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  const rank = (row) => SEVERITY_RANK[row[0]] ?? 2;
  return rows.sort((a, b) => rank(a) - rank(b) || a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]));
}

/** A finding's evidence for the digest: its `actual` (a hash, a kid, a date) in a safe form, or nothing. */
function evidenceOf(f) {
  const actual = typeof f?.actual === "string" ? f.actual : "";
  return /^[0-9A-Za-z._:-]{1,128}$/.test(actual) ? [actual] : [];
}

/** The hidden marker that carries the digest in the issue body. `<` and `>` are JSON-escaped, so it never ends early. */
export function digestMarker(digest) {
  const json = JSON.stringify(digest).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  return `<!-- plumbline:digest ${json} -->`;
}

/** The digest an issue body carries, or null when it has none (an issue written before the marker, or edited by hand). */
export function readDigest(body) {
  const match = typeof body === "string" ? body.match(/<!-- plumbline:digest (.*?) -->/) : null;
  if (!match) return null;
  try {
    const digest = JSON.parse(match[1]);
    // three strings (a body written before UAT-6, or a finding with no evidence) or four (with its evidence)
    const row = (r) => Array.isArray(r) && (r.length === 3 || r.length === 4) && r.every((v) => typeof v === "string");
    return Array.isArray(digest) && digest.every(row) ? digest : null;
  } catch {
    return null;
  }
}

/**
 * The sentence each row of an issue body's findings table carries, keyed as the digest keys a row (severity, kind, ref),
 * each cell as `cell` wrote it. Empty for a body with no table.
 */
export function tableSummaries(body) {
  const out = new Map();
  for (const line of String(body ?? "").replace(/\r\n/g, "\n").split("\n")) {
    if (!line.startsWith("| ") || !line.endsWith(" |")) continue;
    const cells = line.slice(2, -2).split(/(?<!\\) \| /);
    if (cells.length !== 4 || cells[0] === "Severity" || cells[0] === "---") continue;
    const unescape = (c) => c.replace(/\\\|/g, "|");
    out.set(JSON.stringify([unescape(cells[0]), unescape(cells[1]), unescape(cells[2])]), cells[3]);
  }
  return out;
}

const CHECKER_NAMES = { validator: "validator", atlas: "Atlas", customs: "Customs" };

/**
 * One sentence for what a gate report checked: src/gate/context.ts gateSentence, kept word for word here because the
 * Action runs this file with no build (action/report.test.mjs holds the two to the same cases). "Partly checked" is
 * never "not checked" (UAT-9): "checked by 1 of 3 (validator pass); Atlas and Customs had no verdict"; "the site could
 * not be reached (<why>); nothing was checked, so this is not a pass"; "nothing was checked: every checker was
 * unavailable, so this is not a pass". The state is the report's; only the words are derived.
 */
export function gateSentence(report) {
  const findings = (Array.isArray(report?.findings) ? report.findings : []).filter((f) => f && typeof f.state === "string");
  const nameOf = (a) => CHECKER_NAMES[a] ?? String(a);
  const andList = (names) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
  const checked = findings.filter((f) => f.state !== "unavailable");
  const missing = findings.filter((f) => f.state === "unavailable");
  let down = null;
  for (const f of missing) {
    const m = /the target could not be reached \(([^)]{1,120})\)/.exec(String(f.summary ?? ""));
    if (m) {
      down = m[1];
      break;
    }
  }
  const by = checked.length > 0 ? `checked by ${checked.length} of ${findings.length} (${checked.map((f) => `${nameOf(f.adapter)} ${f.state}`).join(", ")})` : "";
  if (down !== null) return checked.length > 0 ? `the site could not be reached (${down}); ${by}` : `the site could not be reached (${down}); nothing was checked, so this is not a pass`;
  if (checked.length === 0) return "nothing was checked: every checker was unavailable, so this is not a pass";
  return missing.length === 0 ? by : `${by}; ${andList(missing.map((f) => nameOf(f.adapter)))} had no verdict`;
}

const VERDICT_WORDS = new Set(["verified", "invalid", "unverifiable"]);

/**
 * The job summary's signature line: src/cli/gate-command.ts signatureLine, in the summary's list form. A report with no
 * `signature` was made without `--trust`, so the gate did not check the signature, and the line says so (PRI-L1-14).
 */
export function gateSignatureLine(signature) {
  if (signature === undefined || signature === null || !VERDICT_WORDS.has(signature.verdict)) {
    return "- **signature**: not checked. This gate checks the site's signature only with `--trust <your trust file>`; `plumbline verify` checks it too.";
  }
  const verdict = signature.verdict === "invalid" && typeof signature.reason === "string" ? `invalid ${cell(signature.reason)}` : signature.verdict;
  return `- **signature**: ${verdict}.${typeof signature.detail === "string" ? ` ${cell(signature.detail)}` : ""}`;
}

/** The gate's outputs: its state, the sentence for what was checked, one summary line per adapter finding, and the signature. */
export function gateOutputs(report) {
  const state = typeof report?.state === "string" ? report.state : "unknown";
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  const lines = findings.map((f) => `- **${cell(f?.adapter)}**: ${cell(f?.state)}. ${cell(f?.summary)}`);
  // UAT-10 (PRI-L1-14): the signature's verdict when the gate was given a trust file, else that it was not checked
  if (typeof report === "object" && report !== null) lines.push(gateSignatureLine(report.signature));
  const sentence = findings.length > 0 ? cell(gateSentence(report)) : "";
  // a site that did not answer, or a run that checked nothing, is said in the heading itself (an alarm, not a grey word)
  const alarm = /^the site could not be reached|^nothing was checked/.test(sentence);
  const heading = sentence === "" ? `### Plumbline gate: ${state}` : alarm ? `### Plumbline gate: ${state}: ${sentence}` : `### Plumbline gate: ${state}`;
  return { state, summary: [heading, ...(sentence !== "" && !alarm ? [sentence.charAt(0).toUpperCase() + sentence.slice(1) + "."] : []), ...lines].join("\n") + "\n" };
}

const KID = /^[0-9a-f]{16}$/;
/** A peer address as a command argument or code span: no backtick, no whitespace. */
const argOf = (ref) => String(ref ?? "").replace(/[`\s]/g, "");

/**
 * The commands a person runs after deciding on each refused peer (TOM-RC-3), src/cli/watch-command.ts refusalCommands
 * kept word for word: one per peer, so no single command accepts two signers. With several peers each is narrowed to
 * its peer (`--accept <peer> --accept-signer <peer>`); a peer with a new key gets `--trust <your trust file>`, so the
 * relock says whether that file backs it.
 */
export function acceptCommands(peers, cli, site) {
  return peers.map((p) => `${cli} watch --root ${site} --relock ${peers.length > 1 ? `--accept ${argOf(p.peer)} ` : ""}--accept-signer ${argOf(p.peer)}${p.newKey ? " --trust <your trust file>" : ""}`);
}

/**
 * The watch's findings for a peer whose recorded signer changed (UAT-4, TOM-RC-1), which a relock refuses until a person
 * names the peer: `block`, the recorded kid as `expected`, and the new kid as `actual`, or no `actual` when the peer
 * publishes no signature now (its sentence then ends with the --accept-signer decision).
 */
export function signerChangeFindings(findings) {
  return findings.filter(
    (f) =>
      f.kind === "peer" &&
      f.severity === "block" &&
      KID.test(String(f.expected ?? "")) &&
      (KID.test(String(f.actual ?? "")) || (f.actual === undefined && /--accept-signer/.test(String(f.summary ?? "")))),
  );
}

/** The codes of a peer whose definition or links.json changed (src/core/types.ts DRIFT_CODES, UAT-17). */
const PEER_CHANGE_CODES = new Set(["peer-changed", "peer-links-appeared", "peer-links-changed", "peer-links-gone"]);

/**
 * The peers a person can see by name with `plumbline diff --peer` (UAT-18, DEV-L1-03): one whose definition or
 * links.json changed. Read from the finding's code; a report from a CLI before codes is read from its sentence.
 */
export function changedPeers(findings) {
  const refs = findings
    .filter((f) => f.kind === "peer" && (PEER_CHANGE_CODES.has(f.code) || (f.code === undefined && /^A peer's network definition changed|^A peer now publishes a links\.json|^A peer's links\.json (changed|is gone)/.test(String(f.summary ?? "")))))
    .map((f) => argOf(f.ref))
    .filter((r) => r !== "");
  return [...new Set(refs)];
}

/** The lines that name the diff command for each changed peer (UAT-18): what changed, by name, in the person's own terminal. */
export function diffLines(findings, cli, site) {
  const peers = changedPeers(findings);
  if (peers.length === 0) return [];
  return [
    "",
    `**To see what changed in ${peers.length === 1 ? "this partner" : "these partners"} by name** (agents added, removed and changed, each changed agent's fields before and after, new outbound hosts, and what its links.json now routes to), run in that clone, from the copy the lock kept beside it (\`.plumbline/peers/\`, committed with the lock):`,
    "",
    ...peers.map((p) => `- \`${cli} diff --root ${site} --peer ${p}\``),
  ];
}

const PLAIN_FILE = /^[A-Za-z0-9._/-]{1,120}$/;

/**
 * The publisher's own files at the site root that name a peer (UAT-25, DEV-L2-3): every root `*.network.json`, every
 * network file the manifest names at a plain relative path, and links.json, whose text holds the peer's address. Read
 * from the workspace only (the publisher's own repository), never fetched; a name that is not plain is left out.
 */
export function peerNamedIn(siteRoot, peer) {
  const names = new Set();
  try {
    for (const name of readdirSync(siteRoot)) if (name.endsWith(".network.json") || name === "links.json") names.add(name);
  } catch {
    return [];
  }
  try {
    const manifest = JSON.parse(readFileSync(join(siteRoot, "agent-manifest.json"), "utf8"));
    for (const n of Array.isArray(manifest?.networks) ? manifest.networks : []) {
      const hocon = typeof n?.hocon === "string" ? n.hocon.replace(/^\.\//, "") : "";
      if (PLAIN_FILE.test(hocon) && !hocon.split("/").some((s) => s === "" || s === "." || s === "..")) names.add(hocon);
    }
  } catch {
    // no manifest, or not JSON: the root's network files are still read
  }
  const out = [];
  for (const name of [...names].sort()) {
    try {
      if (PLAIN_FILE.test(name) && readFileSync(join(siteRoot, name), "utf8").includes(peer)) out.push(name);
    } catch {
      // not readable: not named
    }
  }
  return out;
}

/**
 * The cut path for each changed peer (UAT-25, DEV-L2-3): accepting is not the only answer. Names the publisher's own
 * files that name the peer when the workspace has them (`namedIn`), and says the manifest's allowed_peers goes too.
 */
export function cutLines(findings, cli, site, namedIn = () => []) {
  const peers = changedPeers(findings);
  if (peers.length === 0) return [];
  return [
    "",
    `**Or remove the partner.** If you no longer want ${peers.length === 1 ? "this partner's" : "a partner's"} code, delete it and relock instead: a peer leaves the lock when no network names it.`,
    "",
    ...peers.map((p) => {
      const files = namedIn(p).filter((f) => PLAIN_FILE.test(f));
      const where = files.length > 0 ? files.map((f) => `\`${f}\``).join(" and ") : "the network file (or links.json) that names it";
      return `- \`${p}\`: delete it from ${where}, remove its origin from \`allowed_peers\` in \`agent-manifest.json\`, then run \`${cli} watch --root ${site} --relock\``;
    }),
  ];
}

// ---- the owner's line (UAT-29): src/watch/owner.ts, kept word for word (the Action runs this file with no build;
// action/report.test.mjs holds the two to the same cases). Generated from the findings' codes and counts, never from a
// sentence or a stranger's words. ----

/** Who acts, in the owner's words. */
export const WHO = "whoever looks after your website";
/** The seal, explained where it is named. */
const SEAL = "your site's signature (the seal that shows your assistant's files are yours)";

const OWNER_KIND_WORDS = {
  money: ["price", "prices"],
  time: ["time", "times"],
  date: ["date", "dates"],
  phone: ["phone number", "phone numbers"],
  email: ["e-mail address", "e-mail addresses"],
  percent: ["percentage", "percentages"],
};
const OWNER_KIND_ORDER = ["money", "time", "date", "phone", "email", "percent"];

const PLAIN = /^[A-Za-z0-9._/-]{1,120}$/;

/** A page as the owner reads it: a plain file name of the site's own (its last segment for an address), else "a page". */
export function pageName(ref) {
  const value = String(ref ?? "");
  let path = value;
  if (/^https?:\/\//i.test(value)) {
    try {
      path = new URL(value).pathname.split("/").filter(Boolean).pop() ?? "";
    } catch {
      path = "";
    }
  }
  return PLAIN.test(path) && !path.split("/").some((s) => s === "" || s === "." || s === "..") ? path : undefined;
}

/** "an old price", or "old facts (2 prices, 1 time)", from staleKinds; "an old fact" when the kinds are not told. */
export function staleWords(kinds) {
  const parts = OWNER_KIND_ORDER.map((k) => [k, Number(kinds?.[k] ?? 0)]).filter(([k, n]) => Number.isInteger(n) && n > 0 && Object.hasOwn(OWNER_KIND_WORDS, k));
  const total = parts.reduce((sum, [, n]) => sum + n, 0);
  if (total === 0) return "an old fact";
  if (total === 1) return `an old ${OWNER_KIND_WORDS[parts[0][0]][0]}`;
  return `old facts (${parts.map(([k, n]) => `${n} ${OWNER_KIND_WORDS[k][n === 1 ? 0 : 1]}`).join(", ")})`;
}

const RUNTIME_CHANGE = new Set(["runtime-changed", "runtime-missing", "runtime-unreadable", "runtime-added"]);
const PARTNER_CODE_CHANGE = new Set(["peer-changed", "peer-links-appeared", "peer-links-changed", "peer-links-gone", "external-changed"]);
const SIGNER_CHANGE = new Set(["signer-rotated-verified", "signer-rotation-published", "signer-rotation-unverified", "signer-no-rotation", "signer-gone"]);
const LINE_ENDINGS = new Set(["grounding-line-endings", "runtime-line-endings"]);
const AGENT_FILE = /(\.network\.json|\.hocon|agent-manifest\.json|links\.json)$/i;

/** The page's words: "your page rooms.html", or "a page of your site" when its name is not plain. */
const ownerPage = (ref) => {
  const name = pageName(ref);
  return name === undefined ? "a page of your site" : `your page ${name}`;
};

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The owner's line for a report's open findings (warn and block; info is never news to an owner), or null when there
 * is nothing to say (a clean report). The most pressing situation leads; the rest are counted, never hidden.
 */
export function ownerLine(findings, context = {}) {
  const state = context.lockState;
  if (state !== undefined && state !== "found") {
    return state === "absent"
      ? `Plumbline has not been set up for your site yet, so nothing about your assistant is being checked: forward this to ${WHO}.`
      : `Plumbline could not read its record of your site, so nothing about your assistant was checked this time: forward this to ${WHO}.`;
  }
  const open = findings.filter((f) => f && (f.severity === "warn" || f.severity === "block"));
  if (open.length === 0) return null;
  const code = (f) => String(f.code ?? "");
  const has = (set) => open.filter((f) => set.has(code(f)));
  const resign = context.siteSigned === false ? "" : " and sign the site again";

  let lead;
  let covered;
  const stale = open.filter((f) => code(f) === "grounding-stale-fact");
  // a page whose gone facts the network no longer states either: the right fix, one step from done (MAR-RC-2)
  const fixed = open.filter((f) => code(f) === "grounding-changed" && (f.counts?.factsGone ?? 0) > 0 && f.counts?.factsStale === 0);
  if (stale.length > 0) {
    const kinds = {};
    for (const f of stale) for (const [k, n] of Object.entries(f.counts?.staleKinds ?? {})) kinds[k] = (kinds[k] ?? 0) + Number(n ?? 0);
    const where = stale.length === 1 ? ownerPage(stale[0]?.ref) : "some of your pages";
    lead = `${capital(where)} changed, and your assistant may still be telling visitors ${staleWords(kinds)} from ${stale.length === 1 ? "it" : "them"}: forward this to ${WHO}, who updates what the assistant says`;
    covered = stale;
  } else if (has(RUNTIME_CHANGE).length > 0 || has(PARTNER_CODE_CHANGE).length > 0) {
    const own = has(RUNTIME_CHANGE).length > 0;
    lead = `Code that runs your assistant in your visitors' browsers changed (${own ? "your site's own copy of it" : "a partner service's"}): forward this to ${WHO} before your site is next updated, so they can check the change`;
    covered = [...has(RUNTIME_CHANGE), ...has(PARTNER_CODE_CHANGE)];
  } else if (has(SIGNER_CHANGE).length > 0) {
    lead = `A partner service your assistant works with is now signed by someone other than the one on record, and nothing accepts that until ${WHO} has checked it with the partner: forward this to them`;
    covered = has(SIGNER_CHANGE);
  } else if (fixed.length > 0) {
    lead = `${capital(ownerPage(fixed[0]?.ref))} changed, and your assistant's facts from it changed to match, so no old fact is left: one step remains for ${WHO}, to record the change${resign}`;
    // the network's own change and the signature that no longer covers it are that one step
    covered = open.filter((f) => f === fixed[0] || code(f) === "signature-not-covering" || (code(f) === "grounding-changed" && AGENT_FILE.test(String(f.ref ?? "")) && f.counts === undefined));
  } else if (open.some((f) => code(f) === "signature-not-covering")) {
    lead = `${capital(SEAL)} no longer matches its files: if you or ${WHO} just changed the site, they sign it again; if nobody did, forward this to them today`;
    covered = open.filter((f) => code(f) === "signature-not-covering");
  } else if (open.some((f) => code(f) === "signature-expired")) {
    lead = `${capital(SEAL)} has expired, so checkers no longer accept it: ${WHO} signs the site again`;
    covered = open.filter((f) => code(f) === "signature-expired");
  } else {
    const first = open.find((f) => code(f).startsWith("grounding-")) ?? open[0];
    const c = code(first);
    covered = [first];
    if (c === "grounding-changed" && first.counts?.factsWatched !== undefined && (first.counts.factsGone ?? 0) === 0 && (first.counts.factsUnplaced ?? 0) === 0) {
      const n = first.counts.factsWatched;
      lead = `${capital(ownerPage(first.ref))} changed, but the ${n === 1 ? "1 fact" : `${n} facts`} your assistant gives from it that Plumbline watches ${n === 1 ? "is" : "are all"} still there; it does not watch everything on the page, so if the change was about something visitors ask about, forward this to ${WHO}`;
    } else if (c === "grounding-changed" && first.counts === undefined && AGENT_FILE.test(String(first.ref ?? ""))) {
      lead = `Your assistant's own instructions changed: if you or ${WHO} did not make this change, forward this to them today`;
    } else if (LINE_ENDINGS.has(c)) {
      lead = `A file of your site was saved with different line endings, a technical change that alters no word: ${WHO} fixes the setting`;
    } else if (c === "grounding-unreadable") {
      lead = `Plumbline could not read ${ownerPage(first.ref)}, so it could not check it: forward this to ${WHO}`;
    } else if (c === "grounding-not-locked") {
      lead = `Your site has a file Plumbline was not told to watch (${pageName(first.ref) ?? "a file of your site"}), so it is not checked: forward this to ${WHO}`;
    } else if (c === "signature-expiring") {
      const date = /^\d{4}-\d{2}-\d{2}/.exec(String(first.actual ?? ""))?.[0];
      lead = `${capital(SEAL)} expires ${date !== undefined ? `on ${date}` : "soon"}: ${WHO} renews it before then`;
    } else if (c === "signature-unreadable") {
      lead = `Plumbline could not read ${SEAL}, so it could not check its date: forward this to ${WHO}`;
    } else if (c.startsWith("grounding-") || c === "capture-source-unreadable" || c === "capture-page-no-fact" || c === "capture-stale-kept") {
      lead = `${capital(ownerPage(first.ref))} changed, and Plumbline could not tell whether your assistant now gives an old fact from it: forward this to ${WHO} to check`;
    } else if (c.startsWith("peer-") || c.startsWith("external-") || c.startsWith("signer-") || c.startsWith("network-") || c.startsWith("capture-")) {
      lead = `Plumbline could not check everything your assistant depends on this time (a partner service, or the file that names them), so this is not an all-clear: forward this to ${WHO}`;
    } else {
      lead = `Plumbline found something on your site for ${WHO} to look at: forward this to them`;
    }
  }
  const rest = open.length - covered.length;
  return `${lead}${rest > 0 ? ` (and ${rest === 1 ? "1 more thing" : `${rest} more things`} below for them)` : ""}.`;
}

/** The Desk the issue links to: the public one, unless the workflow names another (an https address). */
export const DEFAULT_DESK = "https://plumbline.xkazm04.workers.dev/";
const ADDRESS = /^https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?(?:\/[A-Za-z0-9._~\/-]*)?$/;

/**
 * The Desk's drift reading of the site, with the address filled in (UAT-29, MAR-L1-11), or null when no address is
 * known. `address` is the site's published address (the workflow's `site-address`, else the origin its own signature
 * names); both it and `desk` must be plain https addresses, so nothing a third party wrote reaches the link.
 */
export function deskLink(address, desk = DEFAULT_DESK) {
  const site = String(address ?? "").trim();
  const base = String(desk || DEFAULT_DESK).trim();
  if (!ADDRESS.test(site) || !ADDRESS.test(base)) return null;
  return `${base.endsWith("/") ? base : `${base}/`}#/drift?target=${encodeURIComponent(site)}`;
}

/**
 * The words the technical part uses, each explained in one sentence where that part starts (UAT-29: Marta's count of
 * terms she would have to look up drops to the ones explained where they appear). Each sentence is said only when the
 * part below uses its words, so a keyless site's issue says nothing about signing (UAT-12). The part below is the
 * developer's and stays as it was.
 */
const GLOSSARY = [
  [/./, "*Drift* is a change since the *lock* (`plumbline.lock.json`), Plumbline's record of your site's agent files, pages and partners; *severity* is `warn` (look at it) or `block` (look before the next release), and *kind* and *ref* say which part and which file."],
  [/grounding|source/i, "A *grounding source* is a page or file whose facts the assistant gives."],
  [/network|agent/i, "The *network* is the assistant's instructions, carried out by its *agents*."],
  [/runtime|vendored/i, "The *runtime* is the code that runs the assistant in the visitor's browser (*vendored*: copied into your site)."],
  [/peer|links\.json/i, "A *peer* is a partner service, and *links.json* the file that lists a site's partners."],
  [/\bpin|captur/i, "A *pin* is a file's fingerprint as the lock recorded it at *capture*, when the lock was written."],
  [/re-?lock/i, "To *re-lock* (`--relock`) records the current state as the new lock."],
  [/\bsign|verifier|tampered/i, "To *sign* puts the site's *signature* (the seal that shows the files are yours) on them again, the lock among the *signed* files; until then *verifiers*, anyone who checks the seal, read the files as *tampered*."],
  [/clone|commit|workflow/i, "The commands run in a *clone* (a copy) of Plumbline's code; to *commit* saves a change in your repository, and the *workflow* is the daily job that wrote this."],
];

/** The glossary paragraph for a technical part's text: the sentences whose words it uses. */
export function glossaryFor(text) {
  return `**Words used below.** ${GLOSSARY.filter(([words]) => words.test(text)).map(([, sentence]) => sentence).join(" ")}`;
}

/** The lines that open the issue and the pull request: the owner's line, then the Desk link (or where the Desk is). */
export function ownerLines(report, { siteSigned = true, link = null, desk = DEFAULT_DESK } = {}) {
  const line = ownerLine(Array.isArray(report?.findings) ? report.findings : [], { ...(typeof report?.lockState === "string" ? { lockState: report.lockState } : {}), siteSigned });
  if (line === null) return [];
  const where =
    link !== null
      ? `**See it in your browser**, with no install and no key: [the reading of your site](${link}).`
      : `**See it in your browser**, with no install and no key: open ${ADDRESS.test(String(desk)) ? String(desk) : DEFAULT_DESK}#/drift and type your site's address.`;
  return [line, "", where, ""];
}

/**
 * The drift issue's body, built from warn and block findings only, ending with the hidden digest marker. The commands it
 * gives run in a clone of Plumbline, not in the site's repository, so the site is named as a placeholder: the workflow
 * cannot know where that clone is. UAT-12 (DEV-L1-04): `siteSigned` is whether the site publishes
 * plumbline.signature.json; a site with none is not told to sign (its lock is not a signed file there).
 */
export function issueBody(report, { siteSigned = true, namedIn = () => [], link = null, desk = DEFAULT_DESK } = {}) {
  const findings = openFindings(report);
  const rows = findings.map((f) => `| ${cell(f.severity)} | ${cell(f.kind)} | ${cell(f.ref)} | ${cell(f.summary)} |`);
  const noLock = findings.some((f) => f.summary === "no lock");
  // UAT-4, TOM-RC-1: a peer whose recorded signer changed (another kid, or none now): a relock refuses it
  const signerChanged = signerChangeFindings(findings);
  const cli = "node dist/cli/index.js";
  const site = "<path to your site>";
  const technical = [
    "Plumbline watch found drift since `plumbline.lock.json` was written.",
    "",
    "| Severity | Kind | Ref | What |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    noLock
      ? "There is no lock yet. In a clone of xkazm04/plumbline at the commit this workflow pins, run " +
        `\`npm ci && ${cli} watch --root ${site} --init\`, review the lock` +
        (siteSigned ? ", sign the site (the lock is a signed file) and commit both." : " and commit it.")
      : "`block` means a vendored runtime file, a peer's definition or a peer's links.json changed: look before the next release. " +
        "After reviewing a change you accept, in a clone of xkazm04/plumbline at the commit this workflow pins, run " +
        `\`${cli} watch --root ${site} --relock\`, ` +
        (siteSigned ? "sign the site again (the lock is a signed file) and commit both." : "and commit the lock.") +
        " The next clean run closes this issue.",
    "",
    ...diffLines(findings, cli, site),
    ...cutLines(findings, cli, site, namedIn),
    ...(signerChanged.length > 0
      ? [
          "",
          `**A relock refuses while a peer's signer changed** (${signerChanged.map((f) => `\`${argOf(f.ref)}\``).join(", ")}): CI never accepts a signer change, so nothing is relocked and this issue stays open until a person decides. Decide each peer on its own (\`plumbline verify --url\`; \`plumbline adopt\` for a published rotation; for a different key with no rotation, or no signature, ask its publisher out of band), then run in that clone, one command per peer:`,
          "",
          ...acceptCommands(signerChanged.map((f) => ({ peer: f.ref, newKey: f.actual !== undefined })), cli, site).map((c) => `- \`${c}\``),
        ]
      : []),
    "",
    "A clean report does not mean the site is safe: it means the locked files, peers and runtime match what was locked.",
  ];
  // UAT-29 (MAR-L1-06, MAR-L1-11): the owner's line and the Desk link first; the technical part follows, unchanged
  const owner = ownerLines(report, { siteSigned, link, desk });
  const head = owner.length > 0 ? [...owner, "### For whoever looks after the website", "", glossaryFor(technical.join("\n")), ""] : [];
  return [...head, ...technical, "", digestMarker(digestOf(report))].join("\n") + "\n";
}

/**
 * The watch's outputs: how many findings are warn or block, and the issue body. A report without a findings list throws:
 * read as "no findings" it would close an open drift issue on a run that checked nothing.
 */
export function watchOutputs(report, { siteSigned = true, namedIn = () => [], link = null, desk = DEFAULT_DESK } = {}) {
  if (!Array.isArray(report?.findings)) throw new Error("the watch report has no findings list");
  return { findings: openFindings(report).length, body: issueBody(report, { siteSigned, namedIn, link, desk }) };
}

const bullet = ([severity, kind, ref], summary) =>
  `- **${severity}** ${kind} \`${ref.replace(/`/g, "'").replace(/[\r\n]+/g, " ")}\`${typeof summary === "string" && summary ? `: ${cell(summary)}` : ""}`;

/**
 * The comment that says what changed between the digest the open issue carries (`before`, null when it has none) and the
 * one this run found (`now`). A new block is said first, because it is the finding that must not wait. Null when the
 * findings did not change. A row is the same finding when severity, kind and ref match and so does its evidence, or one
 * side has none (a digest written before evidence was carried: the first run after an upgrade is not news). A row with
 * new evidence for a ref the issue already holds is new (the partner changed again); the row it replaces is not listed
 * as gone. `findings` (this run's open findings, when the caller has the report) gives each new row its summary, which
 * says what is new in counts and named units.
 */
export function changeComment(before, now, runUrl, findings = [], beforeBody = "") {
  const key3 = (row) => JSON.stringify(row.slice(0, 3));
  const same = (a, b) => key3(a) === key3(b) && (a.length < 4 || b.length < 4 || a[3] === b[3]);
  const added = now.filter((row) => !(before ?? []).some((old) => same(old, row)));
  const nowRefs = new Set(now.map(key3));
  const gone = (before ?? []).filter((old) => !now.some((row) => same(old, row)) && !nowRefs.has(key3(old)));
  if (before !== null && added.length === 0 && gone.length === 0) return null;
  const summaryOf = (row) => {
    const f = findings.find((x) => x && same([String(x.severity), kindOf(x), String(x.ref ?? ""), ...evidenceOf(x)], row) && (row.length < 4 || evidenceOf(x)[0] === row[3]));
    return f?.summary;
  };
  // MAR-RC-3: a row that is new only by its evidence (the page changed again) and whose sentence the issue's table already
  // holds is said as such, not as news with the same sentence again
  const said = tableSummaries(beforeBody);
  const sameWords = (row) => before !== null && before.some((old) => key3(old) === key3(row)) && said.get(key3(row)) === cell(summaryOf(row) ?? "\u0000");
  const fresh = added.filter((row) => !sameWords(row));
  const again = added.filter((row) => sameWords(row));
  const lines = [];
  // MAR-RC-2: the site's own signature no longer covering its files is what a person's own relock-and-fix looks like
  // until it is signed again, so it is said as that, not as an alarm; any other new block keeps the alarm
  const isResign = (row) => row[2] === SIGNATURE_REF && /no longer covers its files/.test(String(summaryOf(row) ?? ""));
  const blocks = fresh.filter((row) => row[0] === "block");
  if (blocks.length > 0 && blocks.every(isResign)) {
    lines.push("**The site's signature no longer covers its files.** If you or your developer changed and relocked the site, sign it again (`plumbline sign`) and commit; if nobody did, look before the next release.", "");
  } else if (blocks.length > 0) lines.push("**A new `block` finding.** Look before the next release.", "");
  else if (again.some((row) => row[0] === "block")) lines.push("**A `block` finding changed again** (new evidence; what it says is unchanged). Look before the next release.", "");
  if (before === null) {
    lines.push(
      `Plumbline watch updated this issue as of ${runUrl}. The issue held no record of its earlier findings, so all of them are listed:`,
      "",
      ...now.map((row) => bullet(row, summaryOf(row))),
    );
  } else {
    lines.push(`Plumbline watch's findings changed as of ${runUrl}. The table in the issue body is up to date.`);
    if (fresh.length > 0) lines.push("", "New:", "", ...fresh.map((row) => bullet(row, summaryOf(row))));
    if (again.length > 0) lines.push("", "Changed again, and what the finding says is unchanged (its sentence is in the table):", "", ...again.map((row) => bullet(row)));
    if (gone.length > 0) lines.push("", "No longer reported:", "", ...gone.map((row) => bullet(row)));
  }
  return lines.join("\n") + "\n";
}

/**
 * What to do with the drift issue, from this run's count and body and the open issues `gh issue list --json
 * number,title,body` found (the first one titled exactly ISSUE_TITLE is the issue):
 * - `create` when there are findings and no open issue;
 * - `edit` when there are findings and the open issue's body differs, with a `comment` when the findings themselves
 *   changed (a body edit notifies nobody, a comment does), and none when only a summary's wording moved;
 * - `close`, with a comment, when the run is clean and an issue is open;
 * - `none` when the body is unchanged, or the run is clean and no issue is open.
 * A count that is not a number throws: it means no report was read, and that is never clean.
 */
export function issuePlan({ findings, body, open, runUrl, report, title = ISSUE_TITLE }) {
  if (!Number.isInteger(findings) || findings < 0) throw new Error("the findings count is not a number");
  const issue = (Array.isArray(open) ? open : []).find((i) => i && i.title === title && Number.isInteger(i.number));
  if (findings > 0) {
    if (!issue) return { action: "create", title };
    // GitHub may hand the body back with CRLF line ends or without the final newline: that is the same body.
    const same = (text) => String(text ?? "").replace(/\r\n/g, "\n").trimEnd();
    if (same(issue.body) === same(body)) return { action: "none", number: issue.number };
    const now = readDigest(body);
    if (now === null) throw new Error("this run's issue body carries no digest");
    const comment = changeComment(readDigest(issue.body), now, runUrl, report ? openFindings(report) : [], String(issue.body ?? ""));
    return comment === null ? { action: "edit", number: issue.number } : { action: "edit", number: issue.number, comment };
  }
  if (!issue) return { action: "none" };
  if (title === AGENT_ISSUE_TITLE) {
    return {
      action: "close",
      number: issue.number,
      comment:
        `Plumbline agent check is clean as of ${runUrl}: the agent's files, models, servers and peers match plumbline.agent.lock.json, and the lock's approval verifies against the approvers file. Closing. ` +
        "(Clean is not safe: it means nothing locked has changed without an approval.)\n",
    };
  }
  return {
    action: "close",
    number: issue.number,
    comment:
      `Plumbline watch is clean as of ${runUrl}: the locked files, peers and runtime match plumbline.lock.json, and the site's signature, if it has one, still covers its files. Closing. ` +
      "(Clean is not safe: it means nothing locked has drifted.)\n",
  };
}

// ---- the pull request: `relock-pr: true` (accept drift) and `renew: true` (re-sign before the signature expires) ----

/** One branch and one title per mode, so a repository has at most one open pull request of each. */
export const PR_BRANCHES = { relock: "plumbline/relock", renew: "plumbline/renew" };
export const PR_TITLES = { relock: "Plumbline: accept the drift (relock)", renew: "Plumbline: renew the signature" };
const SIGNATURE_REF = "plumbline.signature.json";

/** The codes of the site's own signature near or past its expiry (src/core/types.ts DRIFT_CODES, UAT-17). */
const EXPIRY_CODES = new Set(["signature-expiring", "signature-expired"]);
/**
 * UAT-34: the site's signature no longer covers its files on the default branch, as after a relock pull request a
 * person merged unsigned. A renewal then signs the merged files: what it signs was reviewed when it was merged.
 */
const NOT_COVERING = "signature-not-covering";
const RENEW_CODES = new Set([...EXPIRY_CODES, NOT_COVERING]);

/**
 * True when the watch report says the site's own signature expires within the warning window or has expired, or no
 * longer covers its files (UAT-34). UAT-35: decided by the finding's code; only a report written before codes (it has
 * none) is read from its sentence.
 */
export function renewNeeded(report) {
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  return findings.some(
    (f) =>
      f &&
      f.ref === SIGNATURE_REF &&
      (f.severity === "warn" || f.severity === "block") &&
      (typeof f.code === "string" ? RENEW_CODES.has(f.code) : /expire/.test(String(f.summary ?? ""))),
  );
}

/** The kid a `sign --json` output names, only in its exact pattern; null when the site was not signed in this run. */
export function signedKid(sign) {
  const kid = sign && typeof sign === "object" ? sign.kid : undefined;
  return typeof kid === "string" && /^[0-9a-f]{16}$/.test(kid) ? kid : null;
}

/**
 * The pull request's body. For a relock: the change list `watch --relock --json` printed, then the findings that led to
 * it (their summaries carry the counts: what changed in a peer, how many facts a page no longer states). For a renewal:
 * the expiry finding. Then the signing state: signed in this run with the key in the secret (its kid), or a sentence
 * saying to sign locally, in which case the pull request is a draft. A person merges; nothing is accepted by this run.
 * UAT-12 (DEV-L1-04): for a site that publishes no signature (`siteSigned` false) the body says nothing about signing.
 */
export function prBody({ mode, report, relock, kid, runUrl, siteSigned = true, namedIn = () => [], link = null, desk = DEFAULT_DESK }) {
  const technical = prTechnical({ mode, report, relock, kid, runUrl, siteSigned, namedIn });
  // UAT-29: the owner's line, then what this pull request is to her; the developer's part follows, unchanged
  const owner = mode === "relock" ? ownerLines(report, { siteSigned, link, desk }) : [];
  if (owner.length === 0) return technical;
  const forOwner = "This pull request is for whoever looks after your website: nothing on your site changes until they review it and merge it.";
  return [...owner, forOwner, "", "### For whoever looks after the website", "", glossaryFor(technical), "", technical].join("\n");
}

/** The pull request's body for the developer: the part below the owner's line. */
function prTechnical({ mode, report, relock, kid, runUrl, siteSigned = true, namedIn = () => [] }) {
  const lines = [];
  if (mode === "relock" && relock?.refused === "signer") {
    // UAT-4: one proposal for all changes, so nothing is relocked while a signer change waits for a person
    const peers = (Array.isArray(relock.peers) ? relock.peers : []).filter((p) => p && typeof p.peer === "string");
    const kid = (k) => (typeof k === "string" && KID.test(k) ? k : "?");
    lines.push(`Plumbline watch found drift as of ${runUrl}, but **the relock was refused**: a peer's signer is not the one the lock recorded, and CI never accepts a signer change. Nothing was relocked, and nothing in this pull request removes or replaces a recorded signer; every other change waits with it, so this pull request stays one proposal.`, "");
    lines.push("**Peers whose signer changed:**", "");
    for (const p of peers) {
      const now = typeof p.to === "string" ? `it is now signed by \`${kid(p.to)}\` (${cell(p.how)})` : "it publishes no signature now (it answers 404 or 410 for its signature)";
      lines.push(`- \`${argOf(p.peer)}\`: the lock recorded \`${kid(p.from)}\`; ${now}`);
    }
    const commands = acceptCommands(peers.map((p) => ({ peer: p.peer, newKey: typeof p.to === "string" })), "node dist/cli/index.js", "<path to your site>");
    lines.push(
      "",
      `Decide each peer on its own (\`plumbline verify --url\`; \`plumbline adopt\` for a published rotation; for a different key with no rotation, or no signature, ask its publisher out of band). Then, in a clone of xkazm04/plumbline at the commit this workflow pins, run one command per peer, ${siteSigned ? "sign the site again and commit both" : "and commit the lock"}:`,
      "",
      ...commands.map((c) => `- \`${c}\``),
      "",
    );
    const findings = openFindings(report);
    if (findings.length > 0) {
      lines.push("**The findings waiting for that decision:**", "", "| Severity | Kind | Ref | What |", "| --- | --- | --- | --- |");
      for (const f of findings) lines.push(`| ${cell(f.severity)} | ${cell(f.kind)} | ${cell(f.ref)} | ${cell(f.summary)} |`);
      lines.push("");
    }
    lines.push("Nothing is accepted until a person merges a relock. A clean watch closes this.", "", digestMarker(digestOf(report)));
    return lines.join("\n") + "\n";
  }
  if (mode === "relock") {
    const changes = relock?.changes ?? {};
    const list = (label, refs) => (Array.isArray(refs) ? refs : []).map((r) => `- ${label} \`${String(r).replace(/`/g, "'").replace(/[\r\n]+/g, " ")}\``);
    const all = [...list("added", changes.added), ...list("removed", changes.removed), ...list("changed", changes.changed)];
    lines.push(`Plumbline watch found drift as of ${runUrl}, and this pull request accepts it: \`plumbline watch --relock\` rewrote \`plumbline.lock.json\` from the current state.`, "");
    lines.push("**What the new lock changes:**", "", ...(all.length > 0 ? all : ["- no ref changed (only the capture times)"]), "");
    // a signer the lock records for the first time (TOM-RC-4), and a signer change a person named (never CI's)
    const kidOf = (k) => (typeof k === "string" && KID.test(k) ? k : "?");
    const first = (Array.isArray(relock?.firstSigners) ? relock.firstSigners : []).filter((f) => f && typeof f.peer === "string");
    if (first.length > 0) {
      lines.push("**Signers this lock records for the first time** (check each kid with its publisher before merging):", "");
      for (const f of first) {
        lines.push(
          f.was === "unsigned"
            ? `- \`${argOf(f.peer)}\`: recorded \`${kidOf(f.kid)}\`, its first signer (the lock recorded it unsigned)`
            : `- \`${argOf(f.peer)}\`: first seen, recorded \`${kidOf(f.kid)}\`; compared with no earlier key (the lock keeps no record of a peer it no longer holds, so a peer named again is first seen too)`,
        );
      }
      lines.push("");
    }
    const named = (Array.isArray(relock?.signers) ? relock.signers : []).filter((c) => c && typeof c.peer === "string");
    if (named.length > 0) {
      lines.push("**Signer changes a person named with --accept-signer:**", "");
      for (const c of named) lines.push(`- \`${argOf(c.peer)}\`: \`${kidOf(c.from)}\` -> ${typeof c.to === "string" ? `\`${kidOf(c.to)}\`` : "no signature"} (${cell(c.how)})`);
      lines.push("");
    }
    // what the relock itself would not accept, or kept as it was (UAT-2: a stale fact; UAT-3: a pin it could not
    // re-read): said before the findings it does accept, and those refs are not listed as accepted
    const kept = (Array.isArray(relock?.findings) ? relock.findings : []).filter((f) => f && (f.severity === "warn" || f.severity === "block"));
    if (kept.length > 0) {
      lines.push("**What this relock does not accept, or keeps as it was** (these keep reporting after a merge):", "", "| Severity | Kind | Ref | What |", "| --- | --- | --- | --- |");
      for (const f of kept) lines.push(`| ${cell(f.severity)} | ${cell(f.kind)} | ${cell(f.ref)} | ${cell(f.summary)} |`);
      lines.push("");
    }
    const keptRefs = new Set(kept.map((f) => `${f.kind} ${f.ref}`));
    const findings = openFindings(report).filter((f) => !keptRefs.has(`${f.kind} ${f.ref}`));
    if (findings.length > 0) {
      lines.push("**The findings this accepts** (review each before merging; a `block` is changed code):", "", "| Severity | Kind | Ref | What |", "| --- | --- | --- | --- |");
      for (const f of findings) lines.push(`| ${cell(f.severity)} | ${cell(f.kind)} | ${cell(f.ref)} | ${cell(f.summary)} |`);
      lines.push("");
    }
    // UAT-25: the other answer to a changed partner, in a clone of Plumbline as the issue says it
    const cut = cutLines(findings, "node dist/cli/index.js", "<path to your site>", namedIn);
    if (cut.length > 0) lines.push(...cut.slice(1), "", "Close this pull request unmerged if you cut the partner: the relock after the cut replaces it.", "");
  } else {
    const sigFindings = openFindings(report).filter((x) => x.ref === SIGNATURE_REF);
    if (sigFindings.some((x) => x.code === NOT_COVERING)) {
      // UAT-34: the signature this proposes covers files that changed since the last one; the person merging it vouches
      // for every one of them, so the body says which and how to see the changes
      lines.push(
        `The site's files changed since they were last signed, as of ${runUrl} (a relock pull request merged unsigned, or another change). This pull request signs the files as they are on this branch's base now, with a new expiry.`,
        "",
        "**Merging this vouches for every changed file below as yours.** Check each change since the last signature (`git log -p` on the files named) before merging; if one is not yours, close this unmerged.",
        "",
      );
    } else {
      lines.push(`The site's signature is close to its expiry, or past it, as of ${runUrl}. This pull request signs the same files again with a new expiry.`, "");
    }
    for (const f of sigFindings) lines.push(`- **${cell(f.severity)}** ${cell(f.summary)}`);
    lines.push("");
  }
  if (kid !== null) lines.push(`Signed in this run with the key in the workflow's secret (kid \`${kid}\`). Check the kid is yours before merging.`, "");
  else if (siteSigned) {
    lines.push(
      "**Not signed: CI never signs a change before a person has reviewed it.** The lock is a signed file, so the site's signature reads invalid (tampered) until it is signed again. Once you have reviewed this, check out this branch, run `plumbline sign` with your key, push, and mark this pull request ready. It stays a draft until then. If it is merged unsigned, the renew workflow, when you have it, opens a pull request that signs the merged files.",
      "",
    );
  }
  lines.push("Nothing is accepted until a person merges this. A clean watch closes it.");
  // the findings' evidence (UAT-6): a peer that changed again keeps every sentence and count but not its hash, so the
  // body differs, the plan edits, and the branch's lock is pushed again with the new hash
  if (mode === "relock") lines.push("", digestMarker(digestOf(report)));
  return lines.join("\n") + "\n";
}

/**
 * What to do with the one pull request of a mode, from whether this run wants one, this run's body, whether it signed,
 * and the open pull requests on the mode's branch (`gh pr list --head <branch> --state open --json
 * number,body,isDraft,isCrossRepository`; one whose head is in another repository, a fork's, is never the Action's own):
 * - `create` when one is wanted and none is open; a draft when it was not signed;
 * - `edit` when one is open and its body differs (the branch is pushed again), with `draft` saying which state it must be in;
 * - `none` when the open one's body is this run's (nothing is pushed: the capture times alone are no news);
 * - `close`, with a comment, when none is wanted (a clean run, nothing to accept or renew) and one is open.
 */
export function prPlan({ mode, wanted, body, signed, open, runUrl, refused = false, siteSigned = true }) {
  if (mode !== "relock" && mode !== "renew") throw new Error("the mode is relock or renew");
  // UAT-33: gh pr list --head filters by the branch name alone, so a fork's pull request from a branch of the same name
  // comes back too; only a pull request whose head is in this repository is the Action's own
  const pr = (Array.isArray(open) ? open : []).find((p) => p && Number.isInteger(p.number) && p.isCrossRepository !== true);
  // a draft waits for a signature; a site that publishes none has nothing to wait for (UAT-12, DEV-L1-04)
  const draft = siteSigned && !signed;
  // UAT-4: the relock was refused (a peer's signer changed; CI never accepts one). Nothing is pushed: an open pull
  // request is described (its body says so, a comment notifies), and with none open the issue says it.
  if (refused) {
    if (!pr) return { action: "none", draft };
    const same = (text) => String(text ?? "").replace(/\r\n/g, "\n").replace(/as of \S+/g, "as of <run>").trimEnd();
    if (same(pr.body) === same(body)) return { action: "none", number: pr.number, draft };
    return { action: "describe", number: pr.number, draft, comment: `Plumbline watch refused to relock as of ${runUrl}: a peer is signed by another key than the lock recorded, and CI never accepts a new signer. The body says which peers and the command a person runs after deciding.\n` };
  }
  if (!wanted) {
    if (!pr) return { action: "none", draft };
    return { action: "close", number: pr.number, draft, comment: `Plumbline watch no longer finds anything to ${mode === "relock" ? "accept" : "renew"} as of ${runUrl}. Closing.\n` };
  }
  if (!pr) return { action: "create", draft, title: PR_TITLES[mode], branch: PR_BRANCHES[mode] };
  const same = (text) => String(text ?? "").replace(/\r\n/g, "\n").replace(/as of \S+/g, "as of <run>").trimEnd();
  if (same(pr.body) === same(body) && Boolean(pr.isDraft) === draft) return { action: "none", number: pr.number, draft };
  return { action: "edit", number: pr.number, draft, branch: PR_BRANCHES[mode] };
}

// ---- `command: agent`: plumbline agent check (docs/agent-lock.md, "CI") ----

const APPROVAL_STATES = new Set(["verified", "invalid", "unverifiable", "absent"]);
/** The agent check's states (AGENT_STATES in src/core/types.ts). */
const AGENT_STATES = new Set(["pass", "fail", "unavailable"]);
/**
 * The codes that say something was not checked (AGENT_NOT_CHECKED_CODES in src/core/types.ts; agent.test.mjs reads the
 * list there and fails when the two differ). A warn of one of them alone makes the report `unavailable`.
 */
export const AGENT_NOT_CHECKED_CODES = ["server-not-observed", "server-unreachable", "server-refused", "server-auth-missing", "peer-unreachable", "link-absent"];
const NOT_CHECKED = new Set(AGENT_NOT_CHECKED_CODES);
const notCheckedFindings = (report) => report.findings.filter((f) => f?.severity === "warn" && NOT_CHECKED.has(f?.code));

/** What was not checked, as counts ("1 MCP server and 1 A2A peer"), or null when everything was. */
export function notCheckedWords(report) {
  const open = notCheckedFindings(report);
  const distinct = (codes) => new Set(open.filter((f) => codes.includes(f.code)).map((f) => String(f.ref))).size;
  const counts = [
    [distinct(["server-not-observed", "server-unreachable", "server-refused", "server-auth-missing"]), "MCP server"],
    [distinct(["peer-unreachable"]), "A2A peer"],
    [distinct(["link-absent"]), "linked folder"],
  ].filter(([n]) => n > 0);
  if (counts.length === 0) return null;
  const parts = counts.map(([n, one]) => `${n} ${one}${n === 1 ? "" : "s"}`);
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
const APPROVAL_WORDS = {
  verified: "approved",
  invalid: "the approval does not verify",
  unverifiable: "the approval names a key that is in no entry of the approvers file (PLUMBLINE_APPROVERS)",
  absent: "not approved: no plumbline.agent.approval.json",
};

/** True when a value is an agent check report: a findings list and an approval state. */
export function isAgentReport(report) {
  return Array.isArray(report?.findings) && APPROVAL_STATES.has(report?.approval);
}

/** The approval, in words: the state, and the approver's label and kid when verified. Never more than the report holds. */
export function approvalLine(report) {
  const words = APPROVAL_WORDS[report.approval];
  const by =
    report.approval === "verified" && typeof report.approvedBy?.label === "string" && KID.test(String(report.approvedBy?.kid))
      ? ` by ${cell(report.approvedBy.label)} (\`${report.approvedBy.kid}\`)`
      : "";
  return `Approval: ${words}${by}.`;
}

/** What to do about what was not checked: one sentence, for the issue and the summary. Never a relock or an approval. */
const NOT_CHECKED_ADVICE =
  "For what was not checked: a server that answers HTTP 401 or 403 needs a key (name its environment variable under `auth` in `plumbline.agent.json` and give the job that variable from a secret); a stdio server not yet observed needs one run of the agent with the guard in place, then `plumbline agent relock` and a person's approval; an address that could not be read, or a link that is absent from the checkout, needs looking at where it is. Nothing here is a change to approve.";

/** The agent drift issue's body: warn and block findings by code and ref, what to do, and the digest marker. */
export function agentIssueBody(report) {
  const findings = openFindings(report);
  const rows = findings.map((f) => `| ${cell(f.severity)} | ${cell(f.code)} | ${cell(f.ref)} | ${cell(f.summary)} |`);
  const unseen = notCheckedWords(report);
  const unavailable = report.state === "unavailable";
  return (
    [
      unavailable
        ? `Plumbline agent check could not check part of the agent (not checked: ${unseen ?? "see the table"}). Nothing that was checked differs from the approved lock (\`plumbline.agent.lock.json\`), and its approval stands.`
        : "Plumbline agent check found that the agent differs from its approved lock (`plumbline.agent.lock.json`), or that the lock's approval does not stand.",
      "",
      approvalLine(report),
      "",
      "| Severity | Code | Ref | What |",
      "| --- | --- | --- | --- |",
      ...rows,
      "",
      ...(unavailable
        ? []
        : [
            "Review each change. For one you accept, in the repository run `plumbline agent relock`, look at what it lists, then `plumbline approve --key <your private key file>` (a person approves; CI never does) and commit `plumbline.agent.lock.json` and `plumbline.agent.approval.json` together. The next clean run closes this issue.",
            "",
          ]),
      ...(unseen !== null ? [NOT_CHECKED_ADVICE, ""] : []),
      "A clean check does not mean the agent is safe: it means what was locked has not changed without an approval.",
      "",
      digestMarker(digestOf(report)),
    ].join("\n") + "\n"
  );
}

/**
 * The agent check's outputs from its report and the CLI's exit code. `state` is the report's own (pass, fail or
 * unavailable: the CLI's rule, never folded); a report from an older CLI that carries no state is read from the exit
 * code (0 pass, 1 fail). Any exit other than 0 or 1, or a report that is not an agent report, is unknown: never read as
 * pass. With a readable report, the job summary states what was not checked and lists the findings by code and ref, and
 * `findings` and `body` are the warn-or-block count and the issue body (unavailable findings keep the scheduled run's
 * issue open, as before).
 */
export function agentOutputs(report, code) {
  if (!isAgentReport(report)) {
    return { state: "unknown", summary: "### Plumbline agent check: unknown\nThe report could not be read, so nothing is known to be approved.\n" };
  }
  const state = code !== 0 && code !== 1 ? "unknown" : AGENT_STATES.has(report.state) ? report.state : code === 0 ? "pass" : "fail";
  const unseen = notCheckedWords(report);
  const notChecked =
    unseen === null
      ? []
      : [
          state === "unavailable"
            ? `Not checked: ${unseen}. Nothing that was checked failed; this fails the step only with \`fail-on: unavailable\`.`
            : `Not checked: ${unseen}.`,
        ];
  const lines = report.findings.map((f) => `- **${cell(f?.severity)}** \`${cell(f?.code)}\` ${cell(f?.ref)}: ${cell(f?.summary)}`);
  const summary = [`### Plumbline agent check: ${state}`, approvalLine(report), ...notChecked, "", ...(lines.length > 0 ? lines : ["No findings."])].join("\n") + "\n";
  return { state, summary, findings: openFindings(report).length, body: agentIssueBody(report) };
}

function readReport(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function output(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${name}=${value}\n`);
  else process.stdout.write(`${name}=${value}\n`);
}

/**
 * Whether the watched site publishes plumbline.signature.json (UAT-12): the file at the workspace's site root, where
 * the Action's steps run. The pull request step reads it after this run's `sign`, so a site signed in this run counts.
 */
export function siteIsSigned(env) {
  return existsSync(join(siteRootOf(env), "plumbline.signature.json"));
}

/**
 * The site's published address, for the Desk link (UAT-29): the workflow's `site-address`, else the https origin the
 * site's own plumbline.signature.json names (the publisher's file, in the publisher's workspace), else null.
 */
export function siteAddressOf(env) {
  const given = String(env.PLUMBLINE_SITE_ADDRESS ?? "").trim();
  if (given !== "") return given;
  try {
    const origin = JSON.parse(readFileSync(join(siteRootOf(env), "plumbline.signature.json"), "utf8"))?.origin;
    return typeof origin === "string" && /^https:\/\//.test(origin) ? `${origin}/` : null;
  } catch {
    return null;
  }
}

/** The watched site's folder in the workspace. */
export function siteRootOf(env) {
  return join(env.GITHUB_WORKSPACE ?? process.cwd(), env.PLUMBLINE_ROOT ?? ".");
}

function main(argv) {
  const [command, reportFile, bodyFile] = argv;
  const env = process.env;
  if (command === "inputs" && argv.length === 1) {
    let rootIsFolder = false;
    try {
      rootIsFolder = statSync(join(env.GITHUB_WORKSPACE ?? process.cwd(), env.PLUMBLINE_ROOT ?? ".")).isDirectory();
    } catch {
      rootIsFolder = false;
    }
    const problem = inputProblem({
      command: env.PLUMBLINE_COMMAND,
      target: env.PLUMBLINE_TARGET ?? "",
      failOn: env.PLUMBLINE_FAIL_ON,
      issues: env.PLUMBLINE_ISSUES,
      rootIsFolder,
      relockPr: env.PLUMBLINE_RELOCK_PR ?? "false",
      renew: env.PLUMBLINE_RENEW ?? "false",
      // only whether a key was given: its value is never read here
      signingKey: Boolean(env.PLUMBLINE_SIGNING_KEY),
      origin: env.PLUMBLINE_ORIGIN ?? "",
      siteAddress: env.PLUMBLINE_SITE_ADDRESS ?? "",
      desk: env.PLUMBLINE_DESK ?? "",
      assignee: env.PLUMBLINE_ASSIGNEE ?? "",
      offline: env.PLUMBLINE_OFFLINE ?? "false",
    });
    if (problem === null) return 0;
    process.stderr.write(`::error::${problem}\n`);
    return 2;
  }
  if (command === "gate" && reportFile) {
    let report;
    try {
      report = readReport(reportFile);
    } catch {
      report = undefined;
    }
    const { state, summary } = gateOutputs(report);
    output("state", state);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
    return 0;
  }
  if (command === "watch" && reportFile && bodyFile) {
    let findings;
    let body;
    try {
      ({ findings, body } = watchOutputs(readReport(reportFile), { siteSigned: siteIsSigned(env), namedIn: (peer) => peerNamedIn(siteRootOf(env), peer), link: deskLink(siteAddressOf(env), env.PLUMBLINE_DESK), desk: env.PLUMBLINE_DESK || DEFAULT_DESK }));
    } catch (error) {
      process.stderr.write(`::error::cannot read the watch report ${reportFile}: ${error.message}\n`);
      return 2;
    }
    writeFileSync(bodyFile, body);
    output("findings", String(findings));
    output("issue-body", bodyFile);
    return 0;
  }
  if (command === "agent" && argv.length === 4) {
    const [, file, exit, body] = argv;
    let report;
    try {
      report = readReport(file);
    } catch {
      report = undefined;
    }
    const outputs = agentOutputs(report, /^[0-9]+$/.test(exit) ? Number(exit) : Number.NaN);
    output("state", outputs.state);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, outputs.summary);
    // no count and no body for a report that cannot be read: the issue step then refuses, and never closes the issue
    if (outputs.body !== undefined) {
      writeFileSync(body, outputs.body);
      output("findings", String(outputs.findings));
      output("issue-body", body);
    }
    return 0;
  }
  if (command === "title" && (argv.length === 1 || (argv.length === 2 && argv[1] === "agent"))) {
    process.stdout.write(`${argv[1] === "agent" || env.PLUMBLINE_COMMAND === "agent" ? AGENT_ISSUE_TITLE : ISSUE_TITLE}\n`);
    return 0;
  }
  if (command === "issue" && (argv.length === 5 || argv.length === 6)) {
    const [, count, bodyPath, openFile, commentFile, reportFile] = argv;
    const runUrl = `${env.GITHUB_SERVER_URL ?? "https://github.com"}/${env.GITHUB_REPOSITORY ?? ""}/actions/runs/${env.GITHUB_RUN_ID ?? ""}`;
    let plan;
    try {
      const findings = /^[0-9]+$/.test(count) ? Number(count) : Number.NaN;
      const report = reportFile === undefined ? undefined : readReport(reportFile);
      const title = env.PLUMBLINE_COMMAND === "agent" ? AGENT_ISSUE_TITLE : ISSUE_TITLE;
      plan = issuePlan({ findings, body: readFileSync(bodyPath, "utf8"), open: JSON.parse(readFileSync(openFile, "utf8")), runUrl, title, ...(report !== undefined ? { report } : {}) });
    } catch (error) {
      process.stderr.write(`::error::cannot decide on the drift issue: ${error.message}\n`);
      return 2;
    }
    if (plan.comment !== undefined) writeFileSync(commentFile, plan.comment);
    output("action", plan.action);
    output("number", plan.number === undefined ? "" : String(plan.number));
    output("comment", plan.comment === undefined ? "" : commentFile);
    return 0;
  }
  if (command === "pr-branch" && argv.length === 2 && Object.hasOwn(PR_BRANCHES, argv[1])) {
    process.stdout.write(`${PR_BRANCHES[argv[1]]}\n`);
    return 0;
  }
  if (command === "renew-needed" && argv.length === 2) {
    try {
      process.stdout.write(`${renewNeeded(readReport(argv[1]))}\n`);
      return 0;
    } catch (error) {
      process.stderr.write(`::error::cannot read the watch report ${argv[1]}: ${error.message}\n`);
      return 2;
    }
  }
  if (command === "pr" && argv.length === 8) {
    const [, mode, reportPath, relockPath, signPath, openFile, bodyFile, commentFile] = argv;
    const runUrl = `${env.GITHUB_SERVER_URL ?? "https://github.com"}/${env.GITHUB_REPOSITORY ?? ""}/actions/runs/${env.GITHUB_RUN_ID ?? ""}`;
    let plan;
    try {
      const report = readReport(reportPath);
      if (!Array.isArray(report?.findings)) throw new Error("the watch report has no findings list");
      const relock = relockPath === "-" ? null : readReport(relockPath);
      const kid = signedKid(signPath === "-" ? null : readReport(signPath));
      // relock: wanted when there is open drift and the relock changed a ref; renew: when the signature needs it
      const changes = relock?.changes ?? {};
      const changed = ["added", "removed", "changed"].some((k) => Array.isArray(changes[k]) && changes[k].length > 0);
      const wanted = mode === "relock" ? relock !== null && openFindings(report).length > 0 && changed : renewNeeded(report) && kid !== null;
      const siteSigned = siteIsSigned(env);
      const body = prBody({ mode, report, relock, kid, runUrl, siteSigned, namedIn: (peer) => peerNamedIn(siteRootOf(env), peer), link: deskLink(siteAddressOf(env), env.PLUMBLINE_DESK), desk: env.PLUMBLINE_DESK || DEFAULT_DESK });
      const refused = mode === "relock" && relock?.refused === "signer";
      plan = prPlan({ mode, wanted, body, signed: kid !== null, open: JSON.parse(readFileSync(openFile, "utf8")), runUrl, refused, siteSigned });
      writeFileSync(bodyFile, body);
    } catch (error) {
      process.stderr.write(`::error::cannot decide on the pull request: ${error.message}\n`);
      return 2;
    }
    if (plan.comment !== undefined) writeFileSync(commentFile, plan.comment);
    output("action", plan.action);
    output("number", plan.number === undefined ? "" : String(plan.number));
    output("draft", String(plan.draft));
    output("title", PR_TITLES[mode]);
    output("branch", PR_BRANCHES[mode]);
    output("body", bodyFile);
    output("comment", plan.comment === undefined ? "" : commentFile);
    return 0;
  }
  process.stderr.write(
    "usage: node report.mjs inputs | gate <report.json> | watch <report.json> <issue-body.md> | title [agent]\n" +
      "       | agent <report.json> <exit code> <issue-body.md>\n" +
      "       | issue <findings> <issue-body.md> <open-issues.json> <comment.md>\n" +
      "       | pr-branch <relock|renew> | renew-needed <report.json>\n" +
      "       | pr <relock|renew> <report.json> <relock.json|-> <sign.json|-> <open-prs.json> <body.md> <comment.md>\n",
  );
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
