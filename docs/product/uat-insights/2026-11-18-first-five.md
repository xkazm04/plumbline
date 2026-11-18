# UAT drain: run 2026-11-18-first-five

The drain of `uat/runs/2026-11-18-first-five/` (five Characters, one journey each, L1 then L2; synthesis in
`SUMMARY.md` there, 131 finding rows in `findings.json`). Method: the `uat` skill's `drain` mode (ai-registry
`skills/uat`, v1.11.2). Every opportunity below cites finding ids and a quoted Character voice, or the code review of
2026-11-18 where no Character reached the defect. The backlog this produces is `docs/BACKLOG.md`; the one concept
document is `docs/product/concepts/onboarding-and-guidance.md`. Registry: `software-engineering`, golden paths read for
quality-gates, signed-artifacts, agent-host-experience, wizard-flows, guided-tours and ci-execution-trust.

## 1. Confirmed-and-fixed

Nothing was fixed in this run: no product code changed, so no finding is `resolved-verified` and there is no ceiling to
carry. What the run did settle, so nobody re-verifies it:

| Lead | Settled as | Evidence |
| --- | --- | --- |
| Code review: the relock and renewal PR push fails when the branch exists | **confirmed**, and wider: it also fails `create` after any merged PR whose branch was kept, and after a keyless "mark ready". Cause: `--force-with-lease=refs/heads/<branch>` with a URL and no expected value; an explicit `:refs/remotes/plumbline/<branch>` value pushes | DEV-L1-01, MAR-L1-13; Dev's control arm; reproduced again by the drain with the tracked `uat/driver/run-action.mjs` on larch-house (`! [rejected] HEAD -> plumbline/relock (stale info)`) |
| Code review: `watch --init --external` silently does nothing on an existing lock | **confirmed** with the real CLI: lock bytes unchanged, 0 requests served, exit 0 (1 only from unrelated warns) | TOM-L1-05 |
| Code review: a relock PR is not updated when hashes move but wording does not | **confirmed**, and wider: the open issue is silent too | DEV-L1-06 (walker-built act, now the world act `partner-changes-fee`) |
| Code review: an unreachable external card is dropped on relock | **confirmed**: dropped for good, and later watches read clean while it is still down | TOM-L1-04 |
| Code review: `watch --url` prints control characters from a published lock | confirmed by the review; **no Character reached it** (every world lock is the product's own) | backlog UAT-16 |
| Code review: CI signs a relock before review; a fork's PR on the same branch name is taken for the Action's own; renewal matches the English word "expire"; duplicate skill ids miscount | **not reached by any Character**; stay hypotheses. The drain located the code for two: `action/report.mjs:239` (`/expire/` over the summary) and `src/watch/external.ts:59-60` (parts keyed by the id's hash, so a repeated id overwrites) | backlog UAT-33 to UAT-36 |
| The product owner's hypothesis: a non-technical owner cannot onboard or operate the product, and the answer may be an assistant-led or guided experience | **partly true and aimed at the wrong first stop**: Marta never onboards (her developer does); she can operate the Desk's drift view with only her address; she stops at ten named places, and the decisive one (S3) is a false all-clear that guidance would make more convincing | MAR-L2 hypothesis table; `docs/product/concepts/onboarding-and-guidance.md` |
| The L1 strength "the watch tells a price change from a wording change" | **refuted** on the guesthouse's real page: the two issue bodies are byte-identical | MAR-L1-15, MAR-L2-01 |
| L1's prediction that a price in words reads "the agent now answers from different facts" | **narrowed**: that sentence appears only when a page anchors nothing; a realistic page says "all N facts are still on it" | MAR-L1-03 |
| L1's prediction that a keyless "mark ready" is re-drafted | **refuted as stated**: the re-draft never runs, because the push fails first; what Dev sees is a daily red job | DEV-L1-04 |
| `uat/fixtures/README.md` Observed 1 (the price table hides the price) | **a product defect**, the run's only blocker; the fixture stays as it is on purpose | MAR-L2-01, Observed 5 |
| Observed 3 (a rotation and a swap read the same at the watch) and Observed 4 (the stale-trust window) | **confirmed** as product behaviour; Observed 4 is documented and is a strength | TOM-L1-02, INE-L1-22 |
| The template's pin `6b47457` | **not on GitHub** as of 2026-11-18; the published Action has no `relock-pr`. Any live use of the PR loop waits on the owner's push | DEV-L1-S4 ceiling |
| `uat/env.md`'s harness scan "took 96 s" | that run **sent twelve loopback addresses to the public Agent Atlas**; the harness now uses a stand-in by default | PRI L2 preamble; section 3 |

## 2. Design opportunities, ranked

Ranking order, above impact arithmetic: recurrence (none: first run), then convergence across Characters, then voice
escalation (a first-person section harsher than its finding row), then impact (frequency x reachability x trust
erosion). "Verified" means the drain read the code path and it matches the run's stored evidence; "hypothesis" means
the root cause or the fix is a reading that the fixer verifies first. Each opportunity has exactly one disposition;
`build` items are entered in `docs/BACKLOG.md` under the id shown.

**The order of the build items: correctness of what the product says comes before anything that makes it friendlier,
because Marta's L2 verdict shows that a guided or plain-language layer built on today's sentences would translate the
decisive false all-clear faithfully into "your assistant is fine" (her stop S3), and Ines found the same in the CLI
sentences she would paste into an incident note.**

### Convergent (two or more Characters)

**O-1. Grounding must watch what it says it watches.** UAT-1, `build`.
Findings: MAR-L2-01 (blocker), MAR-L2-02, MAR-L1-02, MAR-L1-03, MAR-L1-14, MAR-L1-15 (refuted strength), REC-9; Priya's
harbourlight row ("1 of 6 facts ... which fact is not named, so she has to diff").
Voice (escalated from L1's "the words" to L2's "it was wrong"): Marta, L2: "It said all five facts are still on it. All
five! So I thought, good, the chat is fine. It wasn't."
Root cause: **verified.** `src/watch/anchors.ts:90`: the money pattern accepts a number before a symbol
(`\b(NUMBER)\s?(...|€|...)`), so `Sleeps 2 | €89` reduces to `2 €89` and is read as EUR 2, consuming the symbol before
`89` can match; neither room price is anchored. `src/cli/init-command.ts:168-176` prints source counts, never anchored
facts. The sentence's unit "facts the network states" (`src/watch/decide.ts:125-127`) counts anchored facts only.
MAR-L1-02's after-fix sentence is by design (anchors counted against literals hashed at lock time). The fix design is a
hypothesis.
Cost/value: L. The value is the product's core promise for an owner (D8 in the roadmap); without it the J1 journey
cannot pass and every friendlier layer is unsafe. Highest value in the backlog.
Standard: `quality-gates/vacuous-by-evaluation` (a check that cannot fire for the fact it reports on).

**O-2. A relock must never forget what it could not re-read.** UAT-3, `build`.
Findings: TOM-L1-03, TOM-L1-04, TOM-L2-01, TOM-L1-08, DEV-L1-05, TOM-L2-05, REC-2, REC-7; the code review's "an
unreachable external card is dropped on relock".
Voices: Dev, L2: "The outage case is the one I'd lose sleep over. The bot offered 'accept the drift' with 'removed peer'.
I merged it, because that's what the title says." Tomasz, L2: "A tool that loses my inventory when I follow its own
advice can't be the system of record."
Root cause: **verified.** `src/watch/capture.ts:157-165` writes a peer it could not read as `pendingPeers[url] =
{ since }` and keeps nothing of its previous record; `:172-176` leaves an unreadable external definition out of the lock;
`:150-153` writes no `kid` when the signature could not be read, the same as "unsigned"; `src/watch/index.ts:98-121`
builds the new lock from the capture alone.
Cost/value: M. Small code, large trust: it turns the watch's best strength (never green on the day) into a guarantee
that survives the next accept.
Standard: `quality-gates/unmeasurable-criteria` (absence in the gate's own vision never reads as the subject's state).

**O-3. An accept never silences a stale fact, and a merge never closes clean over a broken signature.** UAT-2, `build`.
Findings: MAR-L1-01, MAR-L2-03, REC-7, REC-8; MAR-L1-17's ceiling.
Voice: Marta, L2: "if I'd pressed it, everything would have gone quiet and said 'clean' while the chat kept saying 89.
That's the booking portal again, with a tick on it this time."
Root cause: **verified.** The relock re-captures anchors from the page as it is now (`src/watch/capture.ts:126-135`),
so a fact the page lost is dropped instead of reported; the watch reads the site's own signature only for expiry
(`src/watch/detectors.ts:205-216`), so an unsigned relock merged over a signed site closes "clean" while verify reads
`invalid (tampered)`; the close comment is written from the finding count (`action/report.mjs:219-226`).
Cost/value: M. Converges with O-2 on "clean must mean watched".
Standard: `signed-artifacts/import-verification-flow` (proceeding despite a failed claim is explicit and specific).

**O-4. One verdict vocabulary on the CLI and the Desk.** UAT-7, `build`.
Findings: INE-L1-03, INE-L1-04, INE-L1-10, INE-L1-14 (part), TOM-L1-06, TOM-L2-04, MAR-L1-10, REC-3, REC-4, REC-6.
Voices: Ines, L2: "I asked three times and got the same split three times. I cannot put two answers in one incident
note, and the one I would normally trust, the command line, is the wrong one." Tomasz, L2: "the product still has three
words for 'unsigned' and none of them is a state." Marta, L2: "it calls my site 'unsigned' until I've typed in Jonas's
sixteen letters on every device".
Root cause: **verified.** `src/cli/files.ts:201-203` finds a trust entry by kid AND origin, so a kid revoked at one
origin is a stranger at another for the CLI, while `site/desk.js:771-774` adds a kid-wide revoked check;
`src/cli/trust-command.ts:130-143` never reads the site's revocation (the Desk does, `site/desk.js:776-783`);
`src/cli/commands.ts:523-533` writes the revocation before throwing on the missing signature; `:531-533` makes an
unsigned site an I/O error (exit 2); `site/desk.js:580-584` labels any lock not covered by a VERIFIED signature
"unsigned".
Cost/value: M. In every disagreement the Desk is right, so the fix moves the CLI to the Desk's rule; the Desk label is a
string and a branch. Desk files are signed: the owner relocks and re-signs.
Standard: `signed-artifacts/verification-ux` (three states; one closed vocabulary feeds every surface).

**O-5. The PR loop must survive its second run.** UAT-5, `build`.
Findings: DEV-L1-01, MAR-L1-13; the code review.
Voice: Dev, L2: "the bot's push was rejected with 'stale info' every time it mattered: when the partner changed again,
after I merged, and after I marked the draft ready."
Root cause: **verified.** `action/action.yml:253-254`: `git fetch ... "+refs/heads/$BRANCH:refs/remotes/plumbline/$BRANCH"`
then `git push --force-with-lease="refs/heads/$BRANCH" <url>`: with a URL there is no remote-tracking ref for the lease,
so git expects the branch to be absent. Dev's control arm pushed with the explicit
`refs/heads/<b>:refs/remotes/plumbline/<b>` value.
Cost/value: S, and it unblocks the whole D10 loop. The template pin moves in a follow-up commit (CLAUDE.md).
Standard: none.

**O-6. New evidence on an open issue or pull request must be announced.** UAT-6, `build`.
Findings: DEV-L1-02, MAR-L1-04, DEV-L1-06; the code review's "PR not updated when wording is unchanged".
Voice: Dev, L2: "When Coinbridge moved a fee from 0.9% to 1.1% while the issue was open, nothing anywhere changed. That
is the change I bought this to catch."
Root cause: **verified.** `action/report.mjs:81-93`: the digest is `[severity, kind, ref]` with the summary left out on
purpose (so a slower timeout does not re-notify); a second block on the same peer, a links.json, a same-count change and
"all N" becoming "K of N" all collapse into the same row. The PR plan compares bodies only (`action/report.mjs:300-301`).
The fix (which evidence enters the digest) is a hypothesis.
Cost/value: M. Keep the timeout rule; add the finding's `actual` hash and the grounding sentence class.
Standard: none.

**O-7. Verdict sentences fit to paste into an incident note.** UAT-8, `build`.
Findings: INE-L1-01, INE-L1-07, INE-L1-08, INE-L1-09, INE-L1-15, INE-L2-1, TOM-L2-03, REC-11.
Voices (INE-L1-07 is labelled minor at rank 18; the voice escalates it): Ines, L1: "Every check after the revocation
printed a line beginning 'verified' next to the stolen key's id. That is precisely the line someone greps for at 7 a.m."
Tomasz, L2: "it showed me the old key in my trust list on the left and 'First contact: trust this publisher?' with a
button on the right. That button is how a swapped key gets trusted in a payments shop."
Root cause: **verified.** `src/core/verify.ts:126-133` has one revoked sentence for every revoked entry, and
`src/core/revoke.ts:76-96` copies the source's `revokedAt` to cascaded successors; `src/cli/commands.ts:340-346` formats
revocation results with the signature verdict formatter; `src/core/verify.ts:236-262` has no branch for "another key is
trusted for this origin"; the Desk's meaning line is chosen by verdict alone (`site/desk.js:1487`).
Cost/value: M. Words and two branches; the incident note is Ines's whole senior bar.
Standard: `signed-artifacts/verification-ux`.

**O-8. A publisher can rehearse before production.** UAT-21, `build`.
Findings: DEV-L1-08, TOM-L1-11, TOM-L2-06 (part), PRI-L1-11 (part).
Voice: Tomasz, L2: "The 'existing lock' pinned none of my sellers, and the only way to pin them was a test harness the
product doesn't ship." Dev, L2: the CLI "said ... identically when the partner was unchanged, changed and down, so a
rehearsal tells Dev nothing about the partner."
Root cause: **verified** (absence): `src/cli/watch-command.ts:92` refuses `--allow-local` on `watch --root`,
`src/cli/init-command.ts:217` does not declare it, `src/watch/external.ts:141` refuses http, `src/scan/run.ts:52-55`
refuses the list. The library already takes `fetchOptions.allowLocal` (`src/watch/lock.ts:15-18`).
Cost/value: M. Mirrors `gate --allow-local`; must keep private ranges refused (CLAUDE.md) and keep a published lock's
peers https-only (a stranger's document).
Standard: none.

**O-9. One way in: help, roles, and a README whose commands run.** UAT-28, `build`.
Findings: DEV-L1-09, INE-L1-06, PRI-L1-13, PRI-L1-11, PRI-L2-4, PRI-L1-15 (help), DEV-L2-2, DEV-L1-07.
Voices: Ines, L1: "there is no `--help`, so on the bad day the only thing that tells me which side a command belongs to
is a table in a 500-line document." Priya, L2: "When I followed it literally inside their clone, it cheerfully
'initialised' their own website and wrote a workflow into their repo. A junior would have committed that."
Root cause: **verified.** `src/cli/index.ts:39-42` treats `--help` as an unknown command; `README.md:23-29` mixes two
working directories; init's next steps print `plumbline ...`, which no install puts on PATH
(`src/cli/init-command.ts:188-196`).
Cost/value: M, cheap per line, and it is the friendlier layer with no new claims, so it may run beside the correctness
items. It is also concept (f) in the onboarding document.
Standard: `quality-gates/refusal-names-a-reachable-remedy` (a printed remedy must resolve where the reader is).

**O-10. Inventory-grade output: closed reason codes, times, fields.** UAT-17, `build`.
Findings: TOM-L1-07, TOM-L1-13, TOM-L1-10, TOM-L1-09, TOM-L1-02 (JSON part), DEV-L1-11, TOM-L1-14, REC-10.
Voice: Tomasz, L2: "I can fill four cells of my 25-cell table from the JSON on a good day and none on a bad one."
Root cause: **verified** (absence): `src/core/types.ts:316-338` (a finding is `{kind, severity, ref, expected?, actual?,
summary}`); the verify hint is pushed to text lines only (`src/cli/commands.ts:626,630`). The code list is a design
hypothesis.
Cost/value: L, a wire change (`types.ts`, `docs/signature-format.md`, `npm run check:wire`). It is also the precondition
for a plain-language layer generated from one vocabulary and for an agent-host surface (onboarding concept, steps 2
and 3).
Standard: `agent-host-experience/journey-shaped-tool-surface` (refuse and report with a closed code, in text and in the
structured result).

**O-11. Accept is per ref and knows signers.** UAT-4, `build`.
Findings: TOM-L1-01, TOM-L2-02, TOM-L1-02 (watch part), REC-8, REC-11.
Voice: Tomasz, L2: "Three times in one week I re-did a manual fix to a signed file, because the product's only accept
button doesn't know what my trust file says."
Root cause: **verified.** `src/watch/index.ts:98-121`: the relock re-captures every peer; `:117-118`: `--drop` compares
against grounding refs and externals only, then says a peer "was not in the lock"; `src/watch/decide.ts:283-286`: one
sentence for any kid change. The accept design (per ref, signer gate against the trust file) is a hypothesis.
Cost/value: M. Converges with Dev and Marta through REC-8 (the accept word). Builds on UAT-3.
Standard: `signed-artifacts/import-verification-flow`.

### Single Character, voice escalated

**O-12. No address to Agent Atlas that the gate itself refused, and say so where it happens.** UAT-11, `build`.
Findings: PRI-L1-04, PRI-L2-1.
Voice (escalates a med-frequency row): Priya, L2: "What actually changed my mind about trust: every staging address I
typed went to Agent Atlas, including ones Plumbline itself refused to touch, and their nice-looking Desk does it without
a word on the page."
Root cause: **verified.** `src/gate/adapter-atlas.ts:46-50` fetches unconditionally; `src/cli/gate-command.ts:104-110`
checks only the scheme form before `runGate`; `src/scan/run.ts:113` runs every adapter with no option.
Cost/value: S to M. A data-flow fix; ship it as a tagged release with notes (`SECURITY.md`, CLAUDE.md), since it
concerns what leaves an operator's machine. The Desk's check view is a signed Desk file.
Standard: none.

**O-13. Guardrails at the moment of a bad-day mistake.** UAT-15, `build`.
Findings: INE-L1-02, INE-L1-05, INE-L1-13, INE-L2-2, INE-L1-16.
Voice (escalated from L1 to L2): Ines, L2: "The other order frightened me more live than on paper. `rotate` did not say a
word. ... When I did revoke, my new key died with the old one, and the refusal told me, the publisher, to 'ask the
publisher'."
Root cause: **verified.** `src/cli/commands.ts:781-785` (rotate's output has no leak warning), `:789-842` (revoke never
reads the rotation file), `:641-674` (export-jws has no revocation check), `src/core/rotate.ts:121,146` (adopt never
consults existing `adoptedVia`); the DNS step is absent from `docs/signature-format.md:398-406` and the `dns` command
says "publish one record per key" (`src/cli/trust-command.ts:214-218`).
Cost/value: M. Warnings and one refusal; the docs are right, the commands in hand are silent. A bad-day wizard is the
alternative the onboarding concept weighs and defers.
Standard: `signed-artifacts/key-custody`.

### By impact

**O-14. Partly checked is not "not checked", on every surface.** UAT-9, `build`. PRI-L1-01, PRI-L1-02, PRI-L2-2,
PRI-L2-3, PRI-L1-07, REC-1. Voice: Priya, L2: "The README's own example, Agent Atlas's site, scored a hundred out of a
hundred and the headline still said 'unavailable'." Root cause **verified**: `src/gate/context.ts:37-44` (`worst()`), the
scan's word map `src/scan/report.ts:112`, the Action summary `action/report.mjs:115-119`; `nothingChecked()` exists
(`src/cli/gate-command.ts:29-31`) and only the exit code uses it. M. No wire change: derive from the findings. Standard:
`quality-gates/policy-projection`.

**O-15. The client badge never green over what it did not check, and dated by the check.** UAT-10, `build`. PRI-L1-09,
PRI-L1-14, PRI-L1-08, REC-5, REC-10. Voice: Priya, L2: "healthy, offline and tampered are literally the same file. When I
switched to the validator-only setting to get a green badge, the gym with the tampered signature got a green 'pass' too.
That badge is not going on any client's site." Root cause **verified**: `src/cli/badge-command.ts:19-25,30`,
`src/core/types.ts:309-314` (no time on the gate report). M, a wire change for the date. Standard:
`signed-artifacts/verification-ux` (badges: one vocabulary, honest silence).

**O-16. A keyless site is not told to sign.** UAT-12, `build`. DEV-L1-04, REC-4. Voice: Dev, L1: "I never made a key,
because the README told me I didn't need one. The pull request still tells me my signature will read 'tampered'." Root
cause **verified**: `src/watch/decide.ts:493` (`RESIGN_REMINDER` unconditional), `action/report.mjs:145-148,273-277`. S.
Standard: `quality-gates/refusal-names-a-reachable-remedy`.

**O-17. Line endings are not "different facts".** UAT-13, `build`. DEV-L2-1. Voice: Dev, L2: "on my Windows box, Git's
default line endings would have had CI scream 'block' on four runtime files on day one ... That's crying wolf on day
one." Root cause **verified** as by-design exact-byte hashing (`src/net/canonical.ts:4-7`, documented only at
`docs/gate-and-watch.md:125-127`); the remedy (an init check and a "line endings only" sentence) is a hypothesis. S. Must
not loosen exact-byte hashing. Standard: none.

**O-18. The old partner definition, so diff can be used.** UAT-18, `build`. DEV-L1-03, DEV-L1-10, DEV-L1-S3's ceiling.
Voice: Dev, L2: "To see which host was added, I had to read `outline.ts` and hash candidate names against the lock.
That's a party trick, not a product." Root cause **verified** (absence: `src/watch/capture.ts:144-156` keeps hashes
only); the design (a kept copy in the publisher's own repository, outside the lock) is a hypothesis. M. Standard: none.

**O-19. A portfolio report a junior can act on.** UAT-19, `build`. PRI-L1-03, PRI-L1-10, PRI-L1-15, PRI-L2-5. Voice:
Priya, L2: "My twelve-site page put a client whose server is refusing connections eleventh, in the same grey as my
healthy bakery." Root cause **verified** (absence: list order `src/scan/run.ts:139-144`; `keyRecord` unwired
`src/scan/report.ts:33`). M. Standard: none.

**O-20. An owner-facing first line, and a link that carries her address.** UAT-29, `build`, after UAT-1, UAT-2 and
UAT-7. MAR-L1-06, MAR-L1-11, MAR-L1-09, MAR-L2-05. Voice: Marta, L1: "Not until it can say, in one line, 'your rooms page
says 95, your chat assistant still says 89, send this to your web person'". Root cause **verified** (absence:
`action/report.mjs:127-155`, `site/shell.js:540-553`). M. It is concept (a) and (f) in the onboarding document and is
gated on correctness by MC-6. Standard: none.

### Concept documents

**O-21. Onboarding and guidance for a non-technical owner (the owner's question).** `concept-doc`:
`docs/product/concepts/onboarding-and-guidance.md`. Rests on Marta's ten stops (MAR-L2 hypothesis table), MAR-L1-06,
-07, -08, -11, -12, MAR-L2-05, and the onboarding evidence of the other four (DEV-L1-09, DEV-L2-1, INE-L1-06, PRI-L1-11,
PRI-L1-13, PRI-L2-4, TOM-L1-11). Voice: Marta, L2: "Would I adopt it? Not as it is. Would I trust it? Less than before I
tried it, because it told me something false in a calm voice." Real design questions remain (who the owner's surface is,
whether an assistant can avoid the key wall); the document recommends a sequence.

**O-22. Opposing verdicts: is the Desk fit to show a non-technical stakeholder?** `concept-doc` (a section of the same
document). Ines, L2: "I meant the Desk as the thing I show the director. It turned out to be the more honest of the
two." Priya, L2: "tell the team the badge and the Desk are not for clients." The evidence splits by view (INE-L2-4 vs
TOM-L2-03, PRI-L1-02, PRI-L2-1, MAR-L1-10); the per-view defects are build items (UAT-7, -8, -9, -11); which views are
meant for which reader is a product decision, so it is not averaged into either verdict.

**O-23. May the publisher's own checkout name the stale fact?** `concept-doc` (a section of the same document).
MAR-L1-05 ("by design"), Priya's harbourlight row. Voice: Marta, L1: "Which one? The price? Breakfast? The check-in
time? I know exactly which, because I changed it ten minutes before, but the note doesn't, or won't say." The rule
"a site's own words are never copied into a finding" (`docs/roadmap.md`) was written for strangers' sites; whether it
binds the publisher's own checkout is a scope question for the owner. UAT-1 names the fact's KIND (a price, a time)
meanwhile, which quotes nothing.

### The rest, by impact

| Opportunity | Disposition | Findings | Voice | Root cause | Size | Standard |
| --- | --- | --- | --- | --- | --- | --- |
| O-24. A flag that cannot act says so | build, UAT-14 | TOM-L1-05, TOM-L1-14; code review | Tomasz, L1: "In payments a tool that does that gets uninstalled the same afternoon." | verified, `src/watch/index.ts:58-67` | S | `quality-gates/refusal-names-a-reachable-remedy` |
| O-25. An operator's scan with the operator's own trust file | build, UAT-20 | PRI-L1-05 | Priya, L1: "the tampered site looked like an ordinary content change, because the scan won't take the trust file I'd happily give it for my own clients" | verified absence `src/scan/run.ts:126`; design hypothesis | M | none |
| O-26. A pre-launch gate over files | build, UAT-22 | PRI-L1-06 | Priya's job, as she states it: "Before a client site goes live and every week after, I want one pass that tells me which of my twelve sites are broken"; the walker's note: "For pre-launch staging there is no product route" | verified absence (no `--root` in `src/cli/gate-command.ts`) | M | none |
| O-27. The trust file records when; verify reads a missing file as empty | build, UAT-23 | INE-L1-11, INE-L1-12 | Ines, L2: "The trust file says the thief's key was revoked two minutes before it was ever trusted." | verified, `src/cli/files.ts:189-195`, `src/core/revoke.ts:76-96`, `src/cli/commands.ts:515-516` | M (wire) | none |
| O-28. The validator names the file and key | build, UAT-24 | PRI-L1-12 | Priya, L1: a junior "knows the rule but not which key" | verified, `src/gate/adapter-validator.ts:39-102`; scope hypothesis | S | none |
| O-29. The alerts offer the cut path | build, UAT-25 | DEV-L2-3 | Dev, L1: "Cutting the partner is as clear as accepting it" (his bar); L2: "Neither the issue nor the PR offers it" | verified, `action/report.mjs:141-148` | S | none |
| O-30. The news when it lands, to a named person | build, UAT-30 | MAR-L1-08 (uncertain on notification reach) | Marta, L1: "I would have missed that for weeks on my own" / definition of done "within a few minutes" | trigger list verified (`action/templates/plumbline-watch.yml:12-15`); reach hypothesis | S | none |
| O-31. The assistant's tool result carries what the lock watches (grounding 5/6 to 6/6) | build, UAT-31, after UAT-1 | MAR-L1-12 (grounding part) | Marta, L2: "it told me something false in a calm voice"; the walker read the live tool result: a keyed assistant "would be handed the false reassurance as its evidence" | verified, `site/desk.js:589-598` | S | `agent-host-experience/journey-shaped-tool-surface` |
| O-32. Two small Desk honesty fixes | build, UAT-32 | MAR-L2-04, INE-L2-3 | no first-person voice; the finding rows (a status line that still says "Unverifiable" after trust; an import button that says "Add these 2 to my trust list" for revocations) | verified, `site/desk.js:846-866`, `site/strings.js:189` | S | none |
| O-33. The pre-load check for a site's own peers, in the Desk's own page | build, UAT-26 | TOM-L1-12 | Tomasz, L2: "the only way to ask about Kiln Row's sellers was to import /lib/plumbline/browser/preload.js in the page by hand" | verified, `site/desk.js:60,1304-1341` | M | none |
| O-34. The Desk's revoke adds to an existing revocation list | build, UAT-27 | INE-L1-17 (uncertain, off the bound path) | no Character voice (off path); finding row only | hypothesis (code read `site/desk.js:1036-1043`) | S | none |
| O-35. `watch --url` strips control characters from a published lock | build, UAT-16 | code review 2026-11-18 | no Character reached it | verified by the review | S | none |
| O-36 to O-39. Review hypotheses: fork PR on the same branch; CI signs before review; renewal matches "expire"; duplicate skill ids | build (verify first), UAT-33 to UAT-36 | code review 2026-11-18 | no Character reached them | hypothesis (`action/report.mjs:239`, `src/watch/external.ts:59-60` located) | S, M, S, S | none; UAT-34 `ci-execution-trust/measure-apply-split` |

### Method commitments

Changes in how the team works, each with a trigger; entered in `docs/BACKLOG.md`.

| Commitment | Trigger | Rests on |
| --- | --- | --- |
| MC-1. The grounding regression: J1's `raise-price` and `cosmetic-edit` on the UNCHANGED larch-house fixture, plus `uat/runs/2026-11-18-first-five/evidence/marta/anchor-probe.mjs` | any change to `src/watch/anchors.ts`, `capture.ts`, the grounding branch of `decide.ts`; every release | MAR-L2-01, MAR-L2-02; Marta, L1: "not until the 'all clear' means the chat was actually fixed" |
| MC-2. Surface parity: a change to a verdict, a gate state word or a drift sentence lands on CLI, Desk, scan, badge and Action summary in the same change, with the REC rows as the checklist | a change to `src/core/verify.ts`, `src/gate/`, `src/scan/report.ts`, `action/report.mjs`, `site/strings.js` | REC-1 to REC-11; Ines, L2: "I cannot put two answers in one incident note" |
| MC-3. Remedies that run: every command the README, init's next steps and the issue and PR bodies print is executed by a test as printed, from the folder the text names | a change to `README.md` "Use it", `src/cli/init-command.ts` next steps, `action/report.mjs` bodies | DEV-L1-09, PRI-L1-13; Dev's suggested acceptance |
| MC-4. The second event: any change to `action/` re-runs the second-drift sequence with `uat/driver/run-action.mjs` (create, then a second change on the existing branch, then after a merge) before the template pin moves | a change to `action/action.yml` or `action/report.mjs` | DEV-L1-01, DEV-L1-02; Dev, L1: "A bot that breaks on its second run is the exact thing I said I'd drop." |
| MC-5. The destructive rehearsal: relock while a peer and the card are down, and a real-CLI relock with nothing reachable, on a copy of a pinned lock | any change to `src/watch/capture.ts` or `index.ts` relock | TOM-L2-01, TOM-L1-03, TOM-L1-04; Tomasz, L2: "never to run `--relock` unless every seller and the card answer" |
| MC-6. Correctness before guidance: no plain-language layer, tour, wizard or assistant ships over a sentence that has not been recertified at L2 on the world fixture | any guidance work (UAT-29, the onboarding concept's steps 2 to 4) | Marta's L2 verdict on stop S3 |

### Declined, with reasons

| Opportunity | Rests on | Reason |
| --- | --- | --- |
| DC-1. Lower a wording-only grounding change to `info` so an owner's typo does not cost a developer cycle | MAR-L1-07; Marta, L1: "Every time I fix a typo on the rooms page, it opens a warning too, and Jonas charges by the hour to close it." | The roadmap's rule "nothing new softens an existing severity", and the sentence it would rest on ("all N facts are still on it") was refuted live (MAR-L2-01): softening it today would silence the real price change too. Re-raise only after UAT-1 is recertified and the lock can show it watches every stated fact on the page. |
| DC-2. A guided tour of the Desk for first-time owners | Marta's stops S5 to S7 | A tour teaches a surface that already works (guided-tours golden path); the Desk's drift view says the wrong thing on her page (S3) and its labels are wrong (MAR-L1-10). A tour over it now is stale content on day one (`guided-tours/tour-lifecycle`), and a tour cannot reach her: nothing links her to the Desk (S5). Reconsider after UAT-1, UAT-7 and UAT-29 are recertified, and only if a later J1 walk shows she gets lost inside the Desk rather than before it. |
| DC-3. An assistant-led onboarding inside the Desk, now | MAR-L1-12; Marta, L2: "the chat button asks me for an 'API key' straight away, so that's closed" | The Desk's assistant runs inside the vendored runtime, which takes its model client from its own settings and may not be edited (CLAUDE.md), so it cannot answer without the visitor's key; and its tool result today carries the false all-clear (S3), so a keyed assistant would repeat it. The onboarding concept keeps the agent-host path open instead. |
| DC-4. A pre-load veto inside the reference runtime's consent card | TOM-L1-12's runtime half; Dev, L1 (the consent card shows no verdict) | Law: `site/runtime/` is copy-do-not-change; an accepted gap. The hook is proposed upstream (`docs/proposals/runtime-preload-hook.md`, owner list); the Desk-page half is UAT-26. |
| DC-5. Install from npm | Dev's and Priya's pet peeve "a build from source" (DEV-L1-09) | Covered elsewhere: roadmap D2, the owner's naming decision; an accepted gap. The friction it causes is in UAT-28 (commands that run as printed). |

### Counts

50 opportunities: 36 `build` (UAT-1 to UAT-36), 3 `concept-doc` (one document), 6 `method-commitment`, 5
`decline-with-reason`. No opportunity was recorded as covered by another active workstream: the roadmap's D1 to D10 are
built, and every item here is a defect or gap in them.

## 3. Methodology lessons

What this run taught about the method and this overlay. Each is folded into the overlay in the same change where it
was actionable, and logged in `uat/README.md`'s "Skill improvement log".

1. **Browser checks passed vacuously, twice, both in the J1 walk.** A check for "89 or 95" matched `89` inside a
   64-character hash; a check for "says what is left to do" matched `sign` inside "unsigned lock". The walker caught both
   and re-ran them with anchored patterns. Fixed: `drive-script.mjs` has `expectMatch(label, text, regex)`, which records
   the matched substring and its context; `uat/env.md` says to use it for every text check and to read the context of
   every PASS. Verified against tallow-finch's Desk.
2. **A strength was refuted at L2, and the run's only blocker hid behind it, because L1 probed a fixture it wrote
   itself.** L1 built its own throwaway rooms page (price column first), so the anchor check worked and was booked as a
   strength (MAR-L1-15); the world's tracked page (a "Sleeps" column first) never anchors the price. The fixtures are
   tracked so that L1 can run its probes against them: an L1 walker's executable probe uses the world's tracked fixture
   bytes, and a fixture is never "fixed" to make the product pass (`uat/fixtures/README.md` Observed 5).
3. **The harness scan sent world addresses to a public service.** `local-cli.mjs scan` had no Atlas stand-in, so
   `uat/env.md`'s own documented scan sent twelve loopback addresses to the public Agent Atlas; Priya's walker found it
   and built a stand-in arm. Fixed: the harness scan answers Atlas from a recorded response and Customs from recorded
   files by default, labels them on stderr and in `harness.json`, and takes `--real-atlas` / `--real-customs` as explicit
   opt-ins. Verified on tallow-finch (twelve sites, the same summary as the live run, zero requests out). Honest note:
   the drain's first verification run read Customs' public index twelve times before the Customs stand-in was added;
   nothing about a world was sent to it.
4. **The worlds lacked acts that three L2 arms needed**, so three walkers constructed them by hand inside the world
   folder (an own-origin forgery, a same-count partner change, a seller back changed under a new key). Added to
   `world.mjs`, each verified once: `forgery-own-origin`, `partner-changes-fee`, `seller-back-changed`. Still missing,
   named in `uat/env.md`: https peers with a local CA (every peer verdict of this run went through the harness), a 5xx
   toggle in `serve.mjs`, a signed site with no key record.
5. **The price fixture exposed a detection gap that the L1 walker's simpler probe missed, and the control arm is what
   proved it.** Marta's walker ran each arm with its control (price-first against the fixture's layout, words against
   symbols) and a 36-form probe over the built anchor extractor. That probe (`evidence/marta/anchor-probe.mjs`) is the
   recertify instrument for UAT-1 (MC-1). Lesson for the method: when a finding turns on a parser or a pattern, run it
   on the realistic layout AND its control before booking a strength.
6. **L1 does not chain defects or run destructive arms; L2 found every chained and destructive defect.** DEV-L1-04 with
   DEV-L1-01 (the predicted re-draft never happens), TOM-L1-01 across three relocks, and TOM-L2-01 (the real CLI's relock
   wiping a lock) were all L2-only. L1's hand-off should name "second event" and "destructive" arms explicitly for L2.
7. **The walkers left reusable rigs in the run folder.** The `gh` stub and the Action runner (Marta) are now tracked
   tools (`uat/driver/gh-stub.mjs`, `uat/driver/run-action.mjs`, with `--setup-remote` and a configurable repository
   name); verified on larch-house, where the second run reproduced the push rejection. Priya's gate and scan arms and
   Marta's anchor probe stay in the run folder as evidence; the scan arm's idea is folded into the harness.
8. **Severity was derived from rank with different thresholds by different walkers** (INE-L1-07 and PRI-L1-13 rank 18 and
   are labelled minor; Tomasz's walker wrote its own rule). Fixed: `uat/rubric.md` now states the thresholds.
9. **The certified code was not the published code.** Dev's walker checked that the template's pin exists on GitHub; it
   does not (the PR loop under test is in unpushed commits). A preflight for any surface its users fetch by pin or by
   package: is the code under certification the code they get?
10. **A known-defects list labelled HYPOTHESIS worked as intended.** The walkers confirmed four of the code review's
    leads by reproduction and widened two, rather than restating them, and said plainly which leads their journey did not
    reach. Keep labelling orchestrator leads; the list is now replaced by backlog pointers (`uat/accepted-gaps.md`).
11. **The reconciliation sweep's best concepts were not the obvious ones.** "Accept" (REC-8) and "the unit of a count"
    (REC-9) produced sharper rows than the expected "verdict word" rows. The rubric now lists the shared concepts a
    sweep must trace, including these.
12. **Parallel L2 walkers share one GitHub API quota**, so the upstream check was rate-limited in every report and added
    an `info` line to every watch. Recorded in `uat/env.md` as expected noise.
