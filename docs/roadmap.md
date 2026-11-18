# Roadmap: ten directions

Written 2026-11-18 from a review of the repository at `94d7bf7`. Each direction has a goal, a design, the steps, what
"done" means and what stays with the owner. The order below is the execution order: earlier phases need no wire change
and make later ones cheaper. The numbers (D1..D10) are the review's.

## Rules that bind every direction

- `CLAUDE.md` is law. In particular: the wire contract (`src/core/types.ts`) changes only with
  `docs/signature-format.md` and `npm run check:wire` in the same commit; absent optional fields are omitted; three-state
  verdicts and gates are never folded; `site/runtime/` is never edited; core stays free of `node:*`; every fetch of a
  stranger's address goes through `safeFetch` (or the Desk's fetcher held to the same table).
- A finding's sentence is built from counts and fixed phrases. A site's own words (agent names, instructions, addresses a
  stranger chose) are never copied into a finding.
- A new adapter or reader is derived from a recorded real response, dated, kept under `src/test/fixtures/`. Tests never
  touch the network (`src/test/no-network.ts`).
- Nothing new softens an existing severity or turns `unavailable`/`unverifiable` into something greener.
- Gates before every commit: `npm run check`, `npm run check:wire`, `node --test "action/*.test.mjs"`,
  `npm run test:site`. Small atomic commits on `master`, one concern each.
- **The Desk is signed over its own code** (`site/plumbline.signature.json`, `site/plumbline.lock.json`). Any change to
  a signed Desk file needs a relock and a re-sign with the owner's private key. Never read, create or replace that key.
  List the changed signed files in the status table so the owner can relock and sign before release.
- A change to `action/` used by the watch template moves the template's pinned SHA in a follow-up commit.

## Owner-only (prepare, never perform)

Pushing, tagging and releasing; publishing to npm; opening issues or pull requests on other repositories; submitting
text to a standards body or the challenge; deploying the Desk; publishing scan results that name other people's sites;
anything touching the private key. For each, the work ends with a ready artifact and a line in the status table.

## Phase A: reach (no wire change)

### D1. The watch is the entry point

Goal: a publisher gets value in one command with no key and no trust ceremony; signing is the upgrade.

Design:
- `plumbline init [--root <dir>] [--workflow] [--json]`: runs the `--init` capture, writes the lock, and with
  `--workflow` writes `.github/workflows/plumbline-watch.yml` from `action/templates/plumbline-watch.yml` (refuses to
  overwrite). It prints the next step (sign) and makes no key.
- `plumbline watch --url <site>`: read a PUBLISHED lock and re-check it from the CLI, as the Desk does, through
  `safeFetch`. The decisions are already shared (`src/watch/decide.ts`, `src/watch/observe.ts`); only the reader is new.
  Lock states and exit codes follow the existing rule (anything but `found` is exit 1). The CLI-only checks (added
  runtime file, coverage, upstream) are stated as not run, in words.
- README and `action/README.md` lead with watch; sign and verify follow.

Done: both commands tested (a fixture site for `init`; a loopback server for `watch --url`, including a lock aiming at
a private address); a CLI/Desk parity test over the same published lock; docs updated.

As built (deviations): the reader is not new beside `site/drift.js` but moved out of it: `src/watch/published.ts` is
the one reader of a published lock, and `drift.js` now only gives it the browser's error sentence and the `refused`
state, so the CLI and the Desk cannot disagree (the parity test still compares them). That changes a signed Desk file
(`site/drift.js`). The not-run checks are one `info` finding (kind `grounding`, ref `plumbline.lock.json`), so the
report keeps the wire's `DriftReport` shape; it also names the lock's signature as not verified. `watch --url` adds the
published signature's expiry, which the checkout's watch already checks on disk. `init` keeps a lock that is there
(stated, exit 0) rather than refusing, and `--workflow` refuses before anything is written.

### D2. Install without friction

Goal: `npx <package> watch` works, and the Action is no slower than it must be.

Design:
- The npm name `plumbline` belongs to an unrelated project (`action/action.yml` says so). Make the package publishable
  under a scoped name without choosing it for the owner: remove what blocks `npm pack`, add `publishConfig`, a
  `prepack` build, and a test that packs and asserts the tarball holds `dist/` without `dist/test`, the bin runs, and no
  key or `.env` is inside. Leave `"private": true` until the owner names the package; say so in the status table.
- Action: measure the build step first (zero runtime dependencies; `npm ci` installs only TypeScript). Record the
  number in `action/README.md`. Only if it is over 30 s, cache `~/.npm` keyed on the lockfile. Do not commit `dist/`:
  "the code that runs is the commit you pin" stays true.

Done: pack test green; measurement written beside its date; no behaviour change in the Action unless measured need.

As built: the measurement is local (npm ci from the npm cache 4.6 s, build 2.9 s, 2026-11-18), not the runner's; the
runner downloads 26 MB more, which is seconds. Under 30 s, so no cache. `files` also ships the watch template (for
`init --workflow`) and leaves out source maps (their sources are not packed); `prepack` empties `dist/` first.

Owner: choose the package name, publish.

### D9. A public ecosystem scan

Goal: one command produces the state of a list of agentic sites; the Devpost entry's strongest exhibit.

Design:
- `scripts/scan-ecosystem.mjs <list file> --out <dir>`: for each address, the gate report, the published lock's drift
  report (`watch --url`, D1) and whether a signature and key record are published (presence and kid only; `verify`
  against an empty trust store is `unverifiable`, and the scan says that, never "unsigned = bad"). Sequential, one
  absolute deadline per site, a polite fixed delay, the gate's Atlas call disclosed in the output header.
- Output: `report.json` (stable schema, documented) and a static `report.html` with no script, every site string
  escaped. A `plumbline badge --report <gate.json>` writing a small static SVG (state word and date; three states,
  three colours plus words, never colour alone).
- Seed list `ecosystem/sites.txt`: only the sites this repository already names (the Desk, Agent Atlas, Agent Customs,
  the agentic-web example sites if they are served publicly). The owner extends it.

Done: unit tests on the aggregator and the HTML escaping with fixtures; one local run against the seed list, its
output kept out of git (`ecosystem/out/` ignored) and summarised in the status table.

As built: the aggregator, the HTML and the badge are pure TypeScript (`src/scan/`), the script only loads the build.
`badge` is a CLI command. The agentic-web example sites are not served publicly (GitHub Pages answered 404 on
2026-11-18), so the seed list is the Desk, Agent Atlas and Agent Customs.

Owner: curate the list, decide whether and where to publish results about named sites.

## Phase B: drift that means something (wire changes, each with its doc and `check:wire`)

### D7. Semantic peer drift

Goal: when a peer changes, say what changed, not only that bytes differ.

Design:
- `src/watch/outline.ts` (pure): from a network definition, an outline: per agent a SHA-256 of its canonical
  definition, keyed by SHA-256 of the agent name (names are a stranger's words; hashes compare without quoting); the
  set of outbound hosts (remote agent addresses, MCP endpoints), each hashed the same way; the front agent's key.
- Wire: `PeerRecord.outline?` (omitted for old locks). `--init`/`--relock` record it.
- `peerFindings`: severity is unchanged (`block` for any byte change). The summary gains counts: agents added, removed,
  changed; outbound hosts added, removed; front agent changed or not. A changed file with an identical outline says
  "formatting or non-agent content only" and stays `block`. A lock with no outline says "re-lock to see what changed".
- `plumbline diff <old> <new>` for two local network files: the same outline diff, and here names may be shown (the
  caller's own files, their own terminal), with control characters stripped.

Done: outline is identical in Node and the Desk (shared pure module, copied by `build-site.mjs`); duplicate-key files
fail closed as the validator port does; tests for each count; docs.

As built: the outline is computed in `observe.ts`, so the Desk gets it through `lib/` with no change to a signed Desk
file. "Fail closed" means no outline: a peer whose file repeats a key (or is not JSON) is recorded without one, and a
changed one says "cannot be outlined"; the finding stays `block`. Hosts include `link_labels` keys as well as agents'
`tools`. An agent without a string name is keyed by its position. `plumbline diff` exits 0 (same outline), 1 (differs)
or 2 (cannot be outlined). The relock change list itself is unchanged (D10 reads the findings).

### D8. Grounding that checks facts

Goal: catch "the page changed and the network still states the old fact", deterministically, with no model.

Design:
- `src/watch/anchors.ts` (pure): extract literals from a network definition's instructions with fixed patterns (money
  amounts, times and opening hours, dates, phone numbers, e-mail addresses, percentages). Normalise (case, whitespace,
  thousands separators). An anchor is a literal that also appears in the text of a grounding source at lock time
  (HTML reduced to text by a small tag stripper: no parser dependency; script and style contents dropped).
- Wire: `grounding.sources[].anchors?: string[]`, SHA-256 of each normalised literal (omitted when none, and for old
  locks).
- Detector: when a source's bytes changed, re-reduce it and count anchors no longer present. Summary: "changed; all N
  anchored facts are still on it" or "changed; K of N facts the network states are no longer on it". Severity stays
  `warn` either way; the literal is never quoted. A source that cannot be reduced (binary, over the ceiling) says so.
- `init` (D1) explains `--source <page>`: this is what turns byte hashing into a grounding check.

Done: extraction tests per pattern with false-positive cases; a fixture site whose price changes; Desk parity for the
published-lock case; docs state plainly what an anchor is and is not (presence of a literal, not truth).

As built: "appears in the text" is set membership of normalised literals taken from the page by the same patterns, not
a substring search, so the re-check at watch time (which holds only hashes) asks exactly the question asked at lock
time. Literals come from every agent's `instructions` only. The agent files themselves (manifest, `links.json`,
networks) get no anchors; a page that cannot be reduced at capture is an `info` and keeps its byte hash. Also fixed on
the way (separate commit 4b9c90e): a pre-existing test that failed for about 1 generated key in 1,800.

## Phase C: trust

### D4. First contact with a second channel

Goal: reduce the out-of-band step without ever letting the site vouch for itself.

Design:
- DNS record `_plumbline.<host>` TXT `v=plumbline1; kid=<16 hex>` (several allowed, for rotation). `plumbline dns
  --key <key record>` prints the record to publish.
- `trust --url` also resolves the TXT (in `src/net/`, Node only; core untouched) and prints one of: agrees, disagrees,
  no record, could not ask. It still adds nothing without `--yes`. `--require-dns` makes `--yes` refuse unless DNS
  agrees. A disagreement is never overridden silently. `verify` is unchanged: it trusts only the trust file.
- Docs say what this is: a second channel an attacker of the web host alone does not control; not proof against a
  compromised DNS or registrar.
- Design notes only, in `docs/trust-bootstrap.md`, each with its threat model and why it is not built now: keyless
  signing through CI identity (needs a dependency and a third-party log), and a public append-only log of key and lock
  changes.

Done: tests with an injected resolver (agree, disagree, none, error, malformed, several records); docs.

As built: DNS is asked by `trust --url` only (`trust --key` stays offline; `--require-dns` without `--url` is a usage
error). A disagreement refuses `--yes` outright; the deliberate route past it is `trust --key <file> --origin <o> --yes`,
a separate command that asks no DNS. Records that claim `v=plumbline1` but break the form count as malformed and make
"no record" (with the count), never "disagrees". An IP literal, `localhost` or a single-label host is "could not ask"
without a query. No DNSSEC validation (Node's resolver does none); the docs say so. The decision is one pure function,
`trustDecision`, tested for every combination; the no-network preload now refuses TXT queries.

### D5. A standard envelope

Goal: a verifier that speaks JWS can check a Plumbline signature; alignment with A2A's signed Agent Cards.

Design:
- First establish, with test vectors, whether `src/core/canonical.ts` equals RFC 8785 (JCS) on Plumbline's own
  documents; document any difference instead of changing canonical bytes (a change would break every signature).
- `docs/jws-profile.md`: the detached JWS form (RFC 7515, `alg: EdDSA` per RFC 8037, `kid` = the Plumbline kid, payload
  = the signed bytes `signedBytesOf` already defines). `plumbline export-jws` and `verify --jws` convert and check
  through the SAME trust store and return the same three verdicts. The native file stays the wire format; nothing new
  is published by default, so no wire change.
- `docs/proposals/waw-provenance.md`: a short proposal for the Worldwide Agentic Web spec (file names, verdicts, first
  contact), written to be submitted as it stands.

Done: round-trip tests; a vector checked against an independent EdDSA JWS computation written in the test with
WebCrypto; docs.

As built: canonicalJson equals RFC 8785 on Plumbline's documents (the RFC's own samples are recorded as fixtures);
nothing changed in the canonical bytes. `export-jws` cannot convert an existing signature: a JWS signs
`BASE64URL(header).BASE64URL(payload)`, not the payload, so it needs the private key, and it refuses a key that did not
make the native signature. The verifier gained `verifyStatement` (the native pipeline with the math passed in), which
both paths run; a test compares their results in six cases. `verify --jws` reads the JWS from a local file. Also
committed on the way (ccd4091): invisible characters the editor had written into literals (a BOM, no-break spaces,
bidi controls) are escapes again.

Owner: submit the proposal.

### D3. Verification in the load path

Goal: something checks a peer before its definition runs in the visitor's tab.

Design:
- `src/browser/preload.ts` (pure, fetcher-injected): `checkPeerBeforeLoad(peerUrl, { trust, fetcher, lock? })` returns
  the signature verdict (three states) and, when the caller's lock holds the peer, whether its definition still matches.
  Copied to `site/lib/plumbline/` by `build-site.mjs`.
- The Desk shows that result where it asks consent for a partner, IF that surface is the Desk's own code. If the
  consent card is drawn by the vendored runtime, do not touch it: show the result in the Desk's own page next to the
  partner list instead. An unsigned peer reads `unverifiable`, in words, and is not blocked by the Desk.
- `docs/proposals/runtime-preload-hook.md`: the hook the reference runtime would need (called with the peer address and
  bytes before a remote network is instantiated; may veto), with the reference to `preload.ts` as an implementation.

Done: tests for each verdict and for lock match and mismatch; `test:site` covers the Desk surface; the changed signed
Desk files listed for the owner.

As built: the consent card is the vendored runtime's (`runtime/ui.js`; the Desk stands in front of it only through
`onConsent` in `site.js`), so the result is shown beside the partner list, in the page's own "Check the partners now".
`checkPeerBeforeLoad` takes the caller's trust ENTRIES (not a store), because a revocation the peer publishes is applied
to a copy of them; it reads the peer itself (a runtime hook would hand it the bytes instead). It adds a lock state
`unread` and a `refuse` flag. Its verify-from-a-fetcher follows `verify --url` and the Desk's `#verifyAt`; folding those
two onto it is a follow-up, not done here (it would change more signed Desk code).

Owner: file the hook proposal upstream; relock and re-sign the Desk.

## Phase D: scale

### D6. Beyond this spec

Goal: the lock and the watch cover the other agent definitions that change under a consumer.

Design:
- Wire: `lock.external?: Record<url, { kind: "a2a-card" | "mcp-tools"; sha256: string; parts?: Record<string, string>;
  checkedAt: string }>`. Drift maps to kind `peer` (the wire keeps three drift kinds), `block` on change, `warn` when
  unreachable, the same address rules as peers.
- `a2a-card` first: GET the card at the address given (`watch --init --external a2a-card=<url>`), hash exact bytes,
  `parts` = per-skill hashes so the summary can count skills added, removed and changed. If the card carries JWS
  signatures, report present or absent only; verifying them against a trust store reuses D5 and is a follow-up noted in
  the doc.
- `mcp-tools` second, only if it can be done within the fetch rules: `tools/list` needs a JSON-RPC POST after
  `initialize`. If `safeFetch` cannot POST under its existing guards without weakening them, extend it narrowly (fixed
  small request body, same address checks, same ceiling and timeout) with tests; `parts` = per-tool hash of name,
  description and input schema. If no public server can be recorded as a fixture, stop at the design and say so.
- Fixtures from real public responses, dated.

Done: detectors, capture, relock change list and Desk parity for `a2a-card`; `mcp-tools` built or its blocker written
down; docs.

As built: `a2a-card` is done as designed (capture with `watch --init|--relock --external a2a-card=<url>`, block on change
with skill counts and the card's JWS signature count, warn when unreachable, `external <url>` in the relock change list,
`--drop <url>` removes one, parity test). Deviation: no live card could be recorded (none of the hosts this repository
talks to publishes one: `/.well-known/agent-card.json` and `agent.json` answered 404 on each, 2026-11-18), so the
fixtures are the A2A specification's own sample cards, dated and with the spec's commit. `mcp-tools` is NOT built: it
needs a JSON-RPC POST, `safeFetch` is GET-only, and no MCP server could be recorded as a fixture within the rules this
work ran under (no POST to a third party). The narrow `safeFetch` extension is designed in `docs/gate-and-watch.md`;
the wire reserves the kind; `--external mcp-tools=` is refused with that reason and a held entry is a `warn`, "not
checked". `init` does not take `--external` (use `watch --init` or `--relock`).

### D10. The publisher's loop

Goal: accepting drift and staying signed takes one review, not a checklist.

Design:
- `sign --key-env <NAME>`: read the private key file's JSON from an environment variable (for a CI secret), never
  echoed, never written to disk; the existing custody warnings extended for CI.
- Action input `relock-pr: true` (watch only): on drift, run `--relock` on a branch and open or update ONE pull request
  whose body is the relock's change list (D7 and D8 make it readable). With a key secret it also signs; without one the
  body says to sign locally and the PR is marked draft. A person merges; nothing is accepted automatically. Decisions
  in `action/report.mjs`, tested there as the issue plan is.
- A renewal template `action/templates/plumbline-renew.yml`: re-sign when the signature is inside the 14-day warning.
- `action/README.md`: forwarding the `issue-body` output to a chat webhook, as an example, no new code.
- Then the template pin follow-up commit.

Done: `action/*.test.mjs` cover the PR plan; CLI tests for `--key-env` (including that the key never reaches stdout,
stderr or a report); docs.

As built: the Action gained `relock-pr`, `renew`, `signing-key` and `origin`. `renew` is an Action input used by the
new template rather than a separate workflow with its own build, so one Action holds every decision. The PR plan does
not push when only the capture times changed (the body is compared with the run address masked), closes the PR when
nothing is left to accept, and keeps it a draft until it is signed. The apply step is tested by bash against stub `gh`
and `git`; the decide step runs the built CLI, so it is covered by the CLI tests and the decision tests, not run by bash
in the Action's tests (they have no build). The branch push uses `--force-with-lease` on the Action's own branch in the
adopter's repository. Commits by the Action use the standard `github-actions[bot]` identity.

## Status

| Direction | State | Commits | Left for the owner |
| --- | --- | --- | --- |
| D1 | done | a9a03ee | Relock and re-sign the Desk: `site/drift.js` (a signed file) changed. |
| D2 | done | 8a79b57 | Choose the scoped package name, set it in `package.json`, lift `"private": true`, publish. |
| D9 | done | 9ab1e40 | Curate `ecosystem/sites.txt`; decide whether and where to publish results. Run of 2026-11-18 (3 sites): gate pass 1 (Agent Customs), unavailable 2 (the Desk and Agent Atlas: validator and Atlas pass, no Customs receipt); lock found 1 (the Desk: no drift, info only), absent 2; signature published 1 (the Desk, kid `91971cfa8d0e630c`, unverifiable to the scan), absent 2. The Desk took 12.1 s, Atlas 1.4 s, Customs 2.2 s. |
| D7 | done | 6c36ee8 | Relock the Desk's lock (`site/plumbline.lock.json`, signed) so its peers carry an outline; until then a changed partner says "re-lock to record one". Re-sign after. |
| D8 | done | 7c87318, 4b9c90e | None beyond the Desk relock above (the Desk names no `--source` page today; add one with `--relock --source` if a page grounds the network). |
| D4 | done | addcd1e | Optional: publish the Desk's `_plumbline` TXT record (`plumbline dns --key site/.well-known/plumbline-key.json --origin https://plumbline.xkazm04.workers.dev`); on a `workers.dev` host this needs a custom domain, since the workers.dev zone is Cloudflare's. |
| D5 | done | 3b53541, ccd4091 | Submit `docs/proposals/waw-provenance.md` to cognizant-ai-labs/agentic-web (it references `docs/proposals/runtime-preload-hook.md`, written in D3). |
| D3 | done | 1730387 | File `docs/proposals/runtime-preload-hook.md` upstream. Relock and re-sign the Desk: `site/desk.js` and `site/strings.js` (signed) changed. |
| D6 | partial | 29741e1 | `a2a-card` done. `mcp-tools` blocked: needs a JSON-RPC POST (safeFetch is GET-only) and a recorded response from a public MCP server; the design is written. To unblock: name an MCP server whose `tools/list` may be recorded, and accept the narrow POST extension. |
| D10 | done | 6b47457, 9fbe10f | Push both commits together (the templates pin 6b47457, which must exist on GitHub). To use it: add the `PLUMBLINE_SIGNING_KEY` secret and `PLUMBLINE_ORIGIN` variable, give the job `contents: write` and `pull-requests: write`. |

## Owner list (consolidated, 2026-11-18)

Nothing below was done by this work; each item is ready to act on.

- **Push.** 19 local commits on `master` after `94d7bf7` (this status commit included), none pushed. Push them in order, through the publish gate and
  the secret scan; the watch template pins `6b47457`, so that commit must reach GitHub with or before `9fbe10f`.
- **Relock and re-sign the Desk.** Three signed Desk files changed: `site/drift.js` (D1), `site/desk.js` and
  `site/strings.js` (D3); the Desk's `plumbline.signature.json` no longer matches them (no test asserts it does). Run the
  release order in `site/README.md`: `npm run build:site`, `watch --root ./site --relock` (it also records the partner
  outlines D7 added), `sign --root ./site ...`, deploy, then verify the Desk from the Desk.
- **Package.** Choose the scoped npm name, set it in `package.json`, remove `"private": true`, `npm publish` (D2). The
  pin test keeps checking that the pinned commit's `package.json` is private, which stays true for `6b47457`.
- **Proposals to submit.** `docs/proposals/waw-provenance.md` (to the Worldwide Agentic Web spec, D5) and
  `docs/proposals/runtime-preload-hook.md` (to the agentic-web runtime, D3). Both are written to be filed as they stand.
- **Ecosystem scan.** Curate `ecosystem/sites.txt` and decide whether and where to publish results about named sites
  (D9). The 2026-11-18 run's output is in the git-ignored `ecosystem/out/`.
- **DNS record (optional).** Publish the Desk's `_plumbline` TXT record (D4); a `workers.dev` host needs a custom domain.
- **MCP tool lists.** Decide whether to name a recordable MCP server and accept a narrow POST in `safeFetch` (D6).
