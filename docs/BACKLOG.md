# Backlog

Created 2026-11-18 by the drain of UAT run `2026-11-18-first-five` (analysis:
`docs/product/uat-insights/2026-11-18-first-five.md`; evidence: `uat/runs/2026-11-18-first-five/`). Each item names the
Characters it serves, the finding ids it closes, an acceptance check the originating Character's criteria can re-verify,
its `standard:` (the registry technique it serves, or `none`), whether its root cause is **verified** against code and
stored evidence or a **hypothesis** the fixer verifies first, and a rough size (S, M, L).

**An item is not done at merge.** It is done when `/uat recertify` re-walks the originating Character's journey at L2
against the world fixture, the acceptance check below holds with fresh evidence, and the finding rows carry
`resolution: resolved-verified` with their ceiling.

**Law that binds every item** (`CLAUDE.md`, `docs/roadmap.md`): a wire change (`src/core/types.ts`) lands with
`docs/signature-format.md` and `npm run check:wire` in the same commit, and absent optional fields are omitted; the
three-state verdicts and gates are never folded; `site/runtime/` is never edited; core stays free of `node:*`; every
fetch of a stranger's address goes through `safeFetch` (private and loopback refused after DNS, `--allow-local` only
for loopback, with its warning); a change to a signed Desk file (`site/desk.js`, `site/strings.js`, `site/drift.js`,
...) is listed for the owner to relock and re-sign; a change to `action/` used by the watch template moves the
template's pin in a follow-up commit; a security-relevant fix ships as a tagged release with notes.

## Guardrails: what no item may break

These are the strengths the run confirmed (cited ids), stated as constraints. A change that weakens one is a regression
even if its own acceptance check passes.

1. **Unreachable is never green on the day.** A down or refused peer, card, site or checker stays warn or `unavailable`,
   with today's exit code, on every surface (DEV-L1-S1, TOM-L1-S1, PRI-L1-S1, MAR-L1-16, REC-12).
2. **Counts, never a stranger's words.** Alert surfaces say what changed in counts with named units; names appear only
   for the publisher's own files in their own terminal, with control characters stripped (DEV-L1-S2, TOM-L1-S2,
   DEV-L1-S3, REC-13).
3. **Nothing is trusted, adopted or accepted without a person.** First contact refuses without `--yes` and names the
   out-of-band channels (INE-L1-18); adopt walks the chain from a trusted key and needs `--yes` (TOM-L1-S3, INE-L1-20);
   nothing is accepted until a person merges, and an unsigned relock stays a draft (MAR-L1-17).
4. **A revoked key stays dead.** sign and rotate refuse it and say what to do instead; a revoked kid is never trusted
   again; the cascade undoes a stale-window adoption (INE-L1-19, INE-L1-20, INE-L1-21).
5. **Setup is one keyless command that pins every action by SHA and overwrites nothing** (DEV-L1-S4, TOM-L1-S6).
6. **The gate's exit contract.** Under `--fail-on fail` a real defect fails, a third party's outage alone never does, and
   nothing checked is never a pass (PRI-L1-S1).
7. **Say what is sent where before sending it** (PRI-L1-S2).
8. **The docs and the Desk name their own ceilings**: what revocation cannot do, what "verified" does not mean
   (INE-L1-22, INE-L2-4).
9. **The Desk reads drift, verifies and checks with no key and no install** (MAR-L1-16).
10. **The relock lists every ref it changed, removals included** (TOM-L1-S4); it may say more, never less.
11. **Exact-byte hashing stays exact** (`docs/gate-and-watch.md:121-127`); UAT-13 explains a line-ending difference, it
    does not ignore one.

## Owner decisions

- 2026-11-18: build UAT-1 to UAT-9 first, then recertify J1 and J5 (the two journeys that failed at L2). UAT-4 waits
  for the owner's read of its accept design.
- 2026-11-18: the CLI stays the primary surface and is kept. The run's one opposing verdict (is the Desk fit to show a
  non-technical stakeholder: Ines yes for verify, Priya and Tomasz no for check and drift) is settled for now: Priya's
  and Tomasz's ask to make the Desk's check and drift views stakeholder-facing is not taken up. Their correctness
  findings on those views (UAT-7, UAT-8, UAT-9, UAT-11) stand; only the "presentable to a client or director" bar is
  set aside until the owner reopens it.
- 2026-11-18, UAT-4's accept design, decided:
  1. A relock REFUSES while a signer change is pending on any peer (exit 1, nothing written, each peer named by its
     ref), until every such peer is named with `--accept-signer <peer>` or removed from the site. Other drift is still
     accepted by a plain relock, as today; `--accept <ref>` (repeatable) narrows a relock to the named refs, and
     everything else keeps its old pin and keeps reporting.
  2. The Action's pull request stays ONE proposal covering all changes. When a signer change is pending it does not
     relock: the pull request (or, with none open, the issue) says the relock was refused, names the peers, and gives
     the command a person runs after deciding. CI never passes `--accept-signer`.
  3. Trust file (the owner follows the recommendation): the watch keeps needing NO trust store. `--trust <file>` is
     opt-in on `watch` and on the relock. Without it the watch says what it can see without trusting anyone: "a
     rotation statement from the locked key is published (not verified here)" or "a different key, with no rotation
     published"; both stay `block`. With it, a rotation chain that verifies from a key the trust file holds for that
     origin reads "rotated from the key the lock recorded, verified against your trust file", and `--accept-signer`
     prints whether the trust file backs the new signer; an unbacked one is still accepted when named, with that
     sentence in the change list. The lock does NOT start pinning peers' public keys: that would make a published,
     signed file a second trust store, against "a verifier resolves `kid` in its own trust store".

## Order

Correctness of what the product says comes first (UAT-1 to UAT-16), completeness second (UAT-17 to UAT-27), friendliness
third (UAT-28 to UAT-32), review hypotheses last (UAT-33 to UAT-36). The reason is Marta's L2 verdict: her decisive stop
is a detection failure, and a plain-language or guided layer built on today's sentences would translate "all 5 facts
are still on it" faithfully into "your assistant is fine". UAT-28 (help, roles, README) is the one friendlier item that
may run in parallel, because it adds no claim.

## Build items: what the product says

### UAT-1. Grounding watches what it says it watches

- Serves: Marta (and her developer), Priya.
- Closes: MAR-L2-01 (blocker), MAR-L2-02, MAR-L1-02, MAR-L1-03, MAR-L1-14 (the "1 of 1 fact ... are" and init next-step
  parts), MAR-L1-15 (refuted strength), REC-9.
- Done when, on the UNCHANGED larch-house fixture: after `raise-price` the issue, the Desk and the tool result say a
  stated fact (a price) is no longer on `rooms.html`; after `cosmetic-edit` they say something different; `init` and
  `--relock` list, per `--source` page, the kinds of fact watched and say which facts the network states that are NOT
  watched (warning at zero); after `fix-network` the stale-fact sentence is gone and only "re-lock and sign" remains;
  `evidence/marta/anchor-probe.mjs` anchors the forms MAR-L2-02 lists as missed, or init names them as unwatched.
- Root cause: **verified**. `src/watch/anchors.ts:90` (a number cell before the currency symbol is read as the amount
  and consumes the symbol: "Sleeps 2 | €89" reads EUR 2); `src/cli/init-command.ts:168-176` (counts sources, not facts);
  `src/watch/decide.ts:125-127` (the unit "facts the network states" counts anchored facts). The fix design is a
  hypothesis.
- standard: `quality-gates/vacuous-by-evaluation`.
- Size: L.
- Must not break: guardrail 2 (the fact's kind may be named; the literal is a concept question, see the onboarding
  concept document); the severity stays `warn` (roadmap rule; DC-1).
- State: fixed (commit a2d1e1c), awaiting recertify. Cause confirmed as written (`anchors.ts:90` read "2 €" as EUR 2).
  Live on the unchanged larch-house: `init` (the world's `setup`) now prints "facts rooms.html: watches 7 (3 prices, 2
  times, 1 phone number, 1 e-mail address); not on it: 2 (2 times: 07:00, 22:00)" (the house rules' quiet hours, now
  counted because replacement strings are filled in), and so does `--relock`. After `raise-price` the real CLI, the
  issue (run-action r1), the Desk's drift view and the `readDrift` tool result all say "1 of 7 facts the lock watches on
  it (facts the network states) is no longer on it, and the network still states it (1 price), so the agent may now
  answer with an old fact."; after `cosmetic-edit` "all 7 facts ... are still on it, so what changed is something the
  lock does not watch."; after `fix-network` rooms.html reads "... the network no longer states it either, so no stale
  fact is left: review the change, then re-lock (watch --relock)." and the network file "... the agent now answers
  from different facts: review the change, then re-lock (watch --relock)." (no "old fact" sentence on any surface).
  `evidence/marta/anchor-probe.mjs`: all 36 forms anchored (was 23). Deviations: a page that watches none of the
  network's facts is a `warn` finding at capture (init exits 1 for it), the "warning at zero"; the lock's phone anchors
  are now the number's last nine digits (old locks' anchors still read). Ceiling: a fact written in words ("nine in the
  morning") or a bare decimal time ("12.30" with no "from"/range) is not anchored, and is only named by init as not
  on the page; the finding names the kind, never the value, so the owner still has to ask which price; "sign" in
  "re-lock and sign" comes from the relock reminder and (after UAT-2) the signature finding, not this sentence;
  `uat/fixtures/README.md`'s "Confirmed" sentences for these acts now describe the old product (not edited: fixtures).

### UAT-2. An accept never silences a stale fact; a merge never closes clean over a broken signature

- Serves: Marta (and her developer), Dev, Tomasz.
- Closes: MAR-L1-01, MAR-L2-03, REC-7.
- Done when: in larch-house arm W (`raise-price`, relock without `fix-network`, merge the unsigned relock PR), the relock
  or the PR body says plainly that the network still states a fact the page no longer does (or the relock refuses), and
  the next run is not "clean": the watch reports that the site's published signature no longer covers its files, and the
  close comment never says clean while it does not.
- Root cause: **verified**. `src/watch/capture.ts:126-135` (relock re-anchors from the page as it is now);
  `src/watch/detectors.ts:205-216` (the site's own signature is read for expiry only); `action/report.mjs:219-226`.
- standard: `signed-artifacts/import-verification-flow`.
- Size: M.
- Must not break: guardrails 3 and 6; the watch still needs no trust store (comparing the signature's subject hashes
  with the current files needs none).
- State: fixed (commits bc0064b, 6468e3d, pin aa10ad6), awaiting recertify. Causes confirmed. Design: the relock does
  not refuse; it keeps the earlier record of a page that dropped a fact the network still states (no other locked page
  stating it), so the stale-fact finding survives the accept. Live, larch-house arm W through `run-action.mjs --harness
  --relock-pr true`: after `raise-price`, draft PR #2's body opens with "What this relock does not accept, or keeps as
  it was": "warn grounding rooms.html: Not accepted: the network still states 1 fact this page no longer states (1
  price), and no other locked page states it, so the agent may answer with an old fact. ..." (rooms.html is not in its
  change list and not under "The findings this accepts"); a person merged it unsigned; the next run (r2) kept issue #1
  open with a comment led by "**A new `block` finding.**": "block grounding plumbline.signature.json: The site's
  signature no longer covers its files: 1 of 3 signed files differs from the signed version or is missing
  (plumbline.lock.json), so verifiers now answer invalid (tampered) ..." beside the still-reported rooms.html stale
  fact; no close. Ceiling: the coverage check is the checkout watch's only (`watch --url` and the Desk use `verify`); an
  unsigned site has no signature to break, so there only the kept stale fact keeps the issue open; a publisher who
  really means the network to keep a fact no page states must `--drop` the page (there is no per-fact accept).

### UAT-3. A relock never forgets what it could not re-read

- Serves: Tomasz, Dev.
- Closes: TOM-L1-03, TOM-L1-04, TOM-L2-01, TOM-L1-08, DEV-L1-05, TOM-L2-05, REC-2; code review "an unreachable external
  card is dropped on relock".
- Done when: kiln-row `seller-offline`, relock, `seller-back-changed`, watch: `block` with the outline counts (the
  world's control-arm sentence); `card-offline`, relock, watch: the card is still in the lock and still warns; a real-CLI
  relock that can reach no seller keeps every pin and the card and says so (or refuses); a signature that answers 5xx at
  capture is a finding and keeps the previous kid; meridian-trips `partner-down` with `relock-pr` opens no PR that
  removes the partner's pin; the pending line keeps its reason.
- Root cause: **verified**. `src/watch/capture.ts:157-165` (pending with nothing kept), `:172-176` (external left out),
  `:150-153` (no kid on a read error); `src/watch/index.ts:98-121`.
- standard: `quality-gates/unmeasurable-criteria`.
- Size: M.
- Must not break: guardrails 1 and 10; MC-5 runs before release.
- State: fixed (commits 010120a; harness mirror 81d8ebe), awaiting recertify. Causes confirmed as written. Live on
  kiln-row (harness relock pinning the four sellers and the card first): `seller-offline`, harness relock: "no ref
  changed" and "A peer could not be re-read (the connection failed), so the lock keeps its earlier pin (recorded
  2026-11-18) ..."; `seller-back-changed`, harness watch: `block ... In outline: agents: 1 added, 0 removed, 1
  changed` (exit 1). `card-offline`, harness relock: the card kept ("could not be re-read ... keeps its earlier
  record"), next watch still warns. Real-CLI `--relock` on a copy of the pinned lock (it reaches no seller and not
  the card): "no ref changed", five "keeps its earlier pin/record" warns, lock still 4 peers, 0 pending, 1 card. A
  500 on ashgrove's signature during a relock (built `runRelock` with a fetch wrapper, since `serve.mjs` has no 500):
  "A peer's signature could not be read at capture (its signature request answered HTTP 500), so the lock keeps the
  key it recorded before", kid unchanged. meridian-trips `partner-down` with `relock-pr` (run-action --harness): the
  issue opens, the PR plan is `none`, no PR, no `plumbline/relock` branch. MC-5 done (the two relocks above).
  Deviation: "the pending line keeps its reason" is met by asking the pending peer again at each checkout watch ("it
  answers now: review it, then run watch --relock" / "it still cannot be read (...)" / "it was not contacted now
  either: it is not an https address"), not by storing the capture-time reason (that would be a wire change); the
  published reader (watch --url, the Desk) still never contacts a pending peer, so there the line keeps "run watch
  --relock once it answers" unless the address rule refuses it. Ceiling: a pin kept through an outage is only as
  fresh as its date; a peer the site stops naming still leaves the lock (by design); the 5xx arm is constructed, not
  served by the world.

### UAT-4. Accept is per ref and knows signers

- Serves: Tomasz (and, through REC-8, Dev and Marta).
- Closes: TOM-L1-01, TOM-L2-02, TOM-L1-02 (the watch part), REC-8, REC-11.
- Done when (updated 2026-11-18 to the owner's decided design, "Owner decisions"): kiln-row `seller-rotates` +
  `seller-signer-swapped`; a plain relock refuses (exit 1, nothing written, each peer named) while a signer change is
  pending; `--accept-signer <peer>` for one seller leaves the other refused, and with `--accept <peer>` accepting the
  rotated seller does not change the swapped seller's pin; without `--trust` the watch says "a rotation statement from
  the locked key is published (not verified here)" differently from "a different key, with no rotation published"
  (both `block`); with `--trust` a verifying rotation reads "it rotated from the key the lock recorded, verified against
  your trust file" and `--accept-signer` says whether the trust file backs the new signer (an unbacked one is accepted
  when named, said in the change list); the lock pins no public key; the Action's one pull request does not relock with
  a signer change pending and says so (or the issue, with none open), CI never passing `--accept-signer`; `--drop
  <peer>` either drops the peer with a line or refuses with what `--drop` takes, never "was not in the lock".
- Root cause: **verified** (`src/watch/index.ts:98-121`, `:117-118`; `src/watch/decide.ts:283-286`); the accept design is a
  hypothesis.
- standard: `signed-artifacts/import-verification-flow`.
- Size: M.
- Must not break: guardrails 3 and 10; UAT-3 first.
- State: fixed (commits ee685bd, 5558352, harness and gh stub b6bc524, pin 7cb65c9), awaiting recertify. Built to the
  decided design. Live on kiln-row (Tomasz trusted both sellers' first keys with the real CLI; the harness relock pinned
  the four sellers; then `seller-rotates` and `seller-signer-swapped`): harness watch without `--trust`: ashgrove "... a
  rotation statement from the locked key is published (not verified here). A relock refuses it until a person decides:
  watch --relock --accept-signer <this peer>." and brackenfold "... a different key, with no rotation published. ...";
  with `--trust`: ashgrove "... it rotated from the key the lock recorded, verified against your trust file. ...". A
  plain relock: "relock refused: ... Nothing was written." naming both peers with both kids, the command, exit 1, both
  pins unchanged. After the real CLI's `adopt --yes` for ashgrove, `--accept-signer <ashgrove>` alone is still refused
  naming brackenfold; `--accept <ashgrove> --accept-signer <ashgrove> --trust` writes "changed peer ...ashgrove_studio"
  and "signer  peer ...ashgrove_studio: ae21... -> 4251... (it rotated from the key the lock recorded, verified against
  your trust file; backed by your trust file)", brackenfold's pin unchanged and still `block` at the next watch; then
  `--accept-signer <brackenfold> --trust`: "... (a different key, with no rotation published; not backed by your trust
  file)", accepted. Real CLI `--relock --drop <brackenfold>`: exit 2, "--drop takes a grounding ref or an external
  definition the lock holds; ... is a peer, which leaves the lock when no network names it ...". Point 2 through
  `run-action.mjs --harness --relock-pr true`: after `seller-back-changed` the run opened issue #1 and draft PR #2; after
  `seller-signer-swapped` the next run planned `describe`: PR #2's body says "**the relock was refused**", names
  brackenfold with both kids, gives the `--accept-signer` command, a comment notifies, and the branch did not move
  (nothing pushed); the issue body carries the refusal and the command. Deviations: `--drop <peer>` refuses rather than
  drops (a peer the site names would come back at the next relock); the refusal is an error the library throws
  (`RelockRefused`), exit 1 for a signer, 2 for `--drop <peer>`. Ceiling: "signer change" means a recorded kid replaced by
  another kid (a signature that disappears is recorded unsigned with a warn, UAT-3, not refused); the Desk's published
  reader words the change without `--trust` (it never verifies a rotation there); the stub cannot show GitHub's own
  rendering of the describe comment.

### UAT-5. The relock PR survives its second run

- Serves: Dev, Marta (her developer).
- Closes: DEV-L1-01, MAR-L1-13; code review "the relock and renewal push fails when the branch exists".
- Done when: with `uat/driver/run-action.mjs` against a world's bare remote: create, then a second drift on the existing
  branch, then a run after a merged PR whose branch remains: every push succeeds, the PR body and branch lock reflect the
  latest state, the job is green; the same for the renewal branch.
- Root cause: **verified**. `action/action.yml:253-254`: `--force-with-lease=refs/heads/$BRANCH` to a URL has no expected
  value; Dev's control arm pushed with `refs/heads/<b>:refs/remotes/plumbline/<b>`; reproduced again by the drain.
- standard: none.
- Size: S. Then move the template pin (follow-up commit), and MC-4.
- Must not break: guardrail 3 (the PR is still only a proposal); `persist-credentials: false` and the pins.
- State: fixed (commits a8599e6, pin b8552e6), awaiting recertify. The lease now names the fetched commit, or "must not
  exist" when the branch is absent. Live on larch-house through `uat/driver/run-action.mjs --harness --relock-pr true`:
  r0 created issue #1 and draft PR #2; after `cosmetic-edit` (pushed), r1 edited PR #2 and its branch moved to a new
  commit (every step exit 0; before the fix this push was `! [rejected] ... (stale info)`); after a person merged PR #2
  with the branch kept, `raise-price`, r2 created PR #3 on the same branch (exit 0). The renewal branch is proved by
  `action/report.test.mjs` with the real git against a bare remote (create, second run, after merge), not live: the
  runner never gives the Action a key, and renewal needs one. Ceiling: a real GitHub runner and branch protection are
  not exercised; a branch someone else moves between fetch and push is still refused (the step fails, by design).

### UAT-6. New evidence on an open issue or PR is announced

- Serves: Dev, Marta.
- Closes: DEV-L1-02, MAR-L1-04, DEV-L1-06; code review "a relock PR is not updated when hashes move but wording does not".
- Done when: meridian-trips `partner-adds-agent`, `partner-adds-links`, `partner-changes-again`, `partner-changes-fee`
  with the issue and PR open: each later run comments on the issue (naming the partner and what is new) and updates the
  PR (its branch lock holds the new hash); larch-house `cosmetic-edit` then `raise-price` comments; a peer that is still
  unreachable after 12 s instead of 10 s still does not.
- Root cause: **verified**. `action/report.mjs:81-93` (the digest drops the summary and any hash); `:300-301` (the PR plan
  compares bodies only). Which evidence enters the digest is a hypothesis.
- standard: none.
- Size: M.
- Must not break: the no-renotify rule for timeouts (the reason the summary was left out).
- State: fixed (commits 68c35d2, runner 46af076, pin 014377c), awaiting recertify. Cause confirmed (the digest also
  deduplicated two block rows of one peer, which is why `partner-adds-links` was silent). Evidence chosen: each
  finding's `actual`. Live on meridian-trips (run-action --harness --relock-pr true, issue #1 and PR #2 open):
  `partner-adds-links`, `partner-changes-again` and `partner-changes-fee` each commented on the issue (notifies) with
  "New: - **block** peer `http://127.0.0.1:4201/coinbridge_fx`: <its sentence>" and edited the PR, whose branch lock
  then held the served definition's hash (54f0178d8759 after `again`, 3b8891bf0cb7 after `fee`, whose outline counts
  are the same); `partner-down` run twice: the second run planned `none` for the issue and the PR. larch-house
  `cosmetic-edit` then `raise-price`: each commented, the second with "1 of 7 facts ... the network still states it (1
  price) ...". Ceiling: the 12 s vs 10 s case is proved by `action/report.test.mjs` (the world's slow site is in
  tallow-finch, not meridian), and live by two identical `partner-down` runs; during an outage the relock keeps the
  pin (UAT-3), so the open relock PR is closed ("no longer finds anything to accept") and is opened again when the
  partner answers.

### UAT-7. One verdict vocabulary on the CLI and the Desk

- Serves: Ines, Tomasz, Marta.
- Closes: INE-L1-03, INE-L1-04, INE-L1-10, INE-L1-14 (the silent-write part), TOM-L1-06, TOM-L2-04, MAR-L1-10, REC-3,
  REC-4, REC-6.
- Done when: northgate-clinic `forgery-own-origin` after the pharmacy recorded A's revocation: the CLI says
  `invalid revoked`, as the Desk does; between revoke and re-sign the CLI's `trust --url` refuses the revoked key; with
  the signature taken down, verify prints what it recorded before the error; kiln-row's unsigned seller reads
  `unverifiable` with exit 1 and a JSON verdict on the CLI; the Desk labels a signed lock whose signer is not trusted
  "signed by a key you have not trusted", never "unsigned". Ines's 15-case CLI/Desk table reads 15 of 15.
- Root cause: **verified**. `src/cli/files.ts:201-203`, `site/desk.js:771-774`, `src/cli/trust-command.ts:130-143`,
  `site/desk.js:776-783`, `src/cli/commands.ts:523-533`, `site/desk.js:580-584`.
- standard: `signed-artifacts/verification-ux`.
- Size: M. Changes verify's exit code for an unsigned site (say so in the release notes). Signed Desk files.
- Must not break: guardrails 3, 4, 8, 9; MC-2.
- State: fixed (commits 5e699b5, da9f3ce), awaiting recertify. Causes confirmed; the cross-origin revocation is fixed in
  the CLI's trust lookup (`src/cli/files.ts` trustStoreOf) and in `walkRotationChain` (so `adopt` agrees too). Live on
  northgate-clinic (real CLI, the pharmacy's trust file): `forgery-own-origin` before the revocation `unverifiable ...
  signer is unknown`; after the pharmacy recorded A's revocation `invalid revoked kid=<A> origin=http://127.0.0.1:4301`
  (exit 1), as the Desk says; between revoke and re-sign a fresh `trust --url ... --yes`: "nothing added:
  .../plumbline-revocation.json revokes this very key, so it is not trusted ..." (exit 1, no file written); the
  clinic's signature taken down, a stale list: the revocation lines ("revocation recorded in ... (1 entry)") then
  "unverifiable - This site publishes no plumbline.signature.json ...", exit 1, `--json` verdict `unverifiable`;
  `attacker-rotates` then `adopt --url <mirror>`: `invalid revoked`, nothing adopted. kiln-row's unsigned seller
  (4503): `{"results":[{"verdict":"unverifiable",...}]}`, exit 1. The Desk on larch-house (signed, key not trusted):
  "Signed lock, by a key you have not trusted: until you trust that key, the host could rewrite it." and the status
  line "... Lock signed by a key you have not trusted." (kiln-row's marketplace is not signed in the world, so it
  rightly still reads "unsigned lock"). Ines's three disagreements (cases 6, 12, 13) now agree; the 15-of-15 claim
  rests on those three plus the 12 that already agreed, not on a full re-walk. Release note: verify on an unsigned
  site exits 1 (was 2). Ceiling: a signature that cannot be fetched is still exit 2 (an I/O error, by the existing
  rule that an unreachable site is never a verdict); the wording parts of the table (no limit beside `verified`, no
  file for tampered, no date for expired, "revoked by its holder" for a cascade) are UAT-8's; `trust --revocation
  <file>` (INE-L1-14's missing command) is not built.

### UAT-8. Verdict sentences fit to paste into an incident note

- Serves: Ines, Tomasz.
- Closes: INE-L1-01, INE-L1-07, INE-L1-08, INE-L1-09, INE-L1-15, INE-L2-1, TOM-L2-03, REC-11.
- Done when: the stale and wrong-order arms of J3: a cascaded key reads "revoked because it was adopted through revoked
  key <kid>", and "revocation recorded (N entries)" names each kid; no line sets "verified" beside a revoked kid;
  `verified` carries its limit and expiry, `invalid expired` its date, `invalid tampered` the file, an origin mismatch the
  address checked; the Desk's first line on the forgery names the origin mismatch, never "not met this signer"; a swapped
  signer (kiln-row brackenfold) reads "this origin's trusted key is X; this signature is by Y, with no rotation from X" on
  both surfaces and is not offered first contact; the adopt hint does not appear for a rotation from a revoked key.
- Root cause: **verified**. `src/core/verify.ts:126-133`, `:236-262`; `src/core/revoke.ts:76-96`;
  `src/cli/commands.ts:340-346`, `:619-627`; `site/desk.js:1487`.
- standard: `signed-artifacts/verification-ux`.
- Size: M. Signed Desk files.
- Must not break: guardrails 2 (a file path is a safe subject; a reason a stranger wrote is not), 4, 8.
- State: fixed (commits d90c239, 90b26cd), awaiting recertify. Causes confirmed. Live on northgate-clinic, real CLI:
  stale arm (the thief's rotation adopted before the revocation): "revocation recorded in ... (2 entries:
  ccfba72b8f9cda05 for http://127.0.0.1:4300; a421444650ae0a1f for http://127.0.0.1:4300 (adopted through revoked key
  ccfba72b8f9cda05))", the per-entry line "the revocation statement verified under the trusted key ccfba72b8f9cda05
  (...): that key is revoked" (no `verified kid=` line), and the thief's files "invalid revoked kid=a421444650ae0a1f
  ... is revoked because it was adopted through revoked key ccfba72b8f9cda05"; wrong-order arm (A -> B rotated and
  adopted, then A revoked): B reads the same cascade sentence. `verified ... The signature is valid until 2027-02-16.
  Verified means these files are the publisher's and unchanged, not that the site is safe, honest or correct.`;
  `tamper`: "invalid tampered ... differs from the version that was signed: northgate_clinic.network.json."; `expire`:
  "invalid expired ... expired on 2026-11-17 ..."; `forgery` by the mirror's URL: CLI "The signature names
  http://127.0.0.1:4300, but these files were checked as http://127.0.0.1:4301 ..." and the Desk's first line "These
  files were signed for another address than http://127.0.0.1:4301 ..." (no "not met this signer"). kiln-row: after
  `seller-signer-swapped`, CLI "This origin's trusted key is 5369084f6f15eeaa; this signature is by 58f55da9417772e5,
  with no rotation from 5369084f6f15eeaa ..."; the Desk (trusted through its own first-contact panel, then the act)
  says the same, its first line "A different key signed this site ... this is not a first contact.", and shows no
  first-contact panel; after `seller-rotates`, CLI "... and the site publishes a rotation from 73a7a20e763e6207: check
  it with adopt ...". The adopt hint's absence for a rotation from a revoked key is proved by
  `src/test/cli-lifecycle.test.ts` (not re-walked live). Ceiling: the cascade is told from the entry's `revokedAt`
  equal to its parent's (a key that revoked itself at the same instant would read as cascaded); the Desk's trust-list
  chip for a cascaded key (INE-L1-01's "trust the publisher's new key" hint) is unchanged; the watch half of telling a
  rotation from a swap is UAT-4's.

### UAT-9. "Partly checked" is not "not checked", on every surface

- Serves: Priya.
- Closes: PRI-L1-01, PRI-L1-02, PRI-L2-2, PRI-L2-3, PRI-L1-07 (the docs placement), REC-1.
- Done when: tallow-finch: the healthy site reads "checked by 1 of 3 (validator pass); Atlas and Customs had no verdict"
  in the CLI headline, the Action summary, the scan and the Desk; the down and slow sites read "the site could not be
  reached" in an alarm state on each, and "nothing was checked" reaches the Action summary; `--fail-on unavailable`'s
  docs say Customs has receipts for few sites.
- Root cause: **verified**. `src/gate/context.ts:37-44`, `src/scan/report.ts:109-121`, `action/report.mjs:115-119`,
  `site/strings.js` (the Desk card); `nothingChecked()` at `src/cli/gate-command.ts:29-31` is used by the exit code only.
- standard: `quality-gates/policy-projection`.
- Size: M. No wire change (derive from the findings). Signed Desk file.
- Must not break: guardrail 6 (the state and the exit codes are unchanged; only the words and their derivation).
- State: fixed (commits 6da7e72, 9626832, a669572, pin 7c09e1f), awaiting recertify. Causes confirmed. Live on
  tallow-finch, with nothing sent to the public Atlas or Customs: CLI `gate --adapters validator` 4400 "gate pass: ...
  - checked by 1 of 1 (validator pass)" (exit 0); 4409 (slow) "gate unavailable: ... - the site could not be reached
  (the request timed out); nothing was checked, so this is not a pass" and 4410 (down) "... (the connection failed);
  ..." (exit 1). Harness scan (Atlas and Customs stand-ins) of 4400, 4409, 4410: the gate cells read "unavailable:
  checked by 1 of 3 (validator pass); Atlas and Customs had no verdict" (grey) and "unavailable: the site could not be
  reached (...); nothing was checked, so this is not a pass" (class s-unreachable, red). The Action's summary reader
  (`report.mjs gate`) over those three gate reports: "### Plumbline gate: unavailable" + "Checked by 1 of 3 (validator
  pass); Atlas and Customs had no verdict.", and "### Plumbline gate: unavailable: the site could not be reached (...);
  nothing was checked, so this is not a pass" for the slow and the down site. The Desk's check view (Playwright route
  stand-ins for Atlas and Customs): 4400 "Checked by 1 of 3 (validator pass); Atlas and Customs had no verdict." (not
  an alarm), 4410 "The site could not be reached (the connection failed); nothing was checked, so this is not a pass."
  with the alarm class. Docs for `--fail-on unavailable` (gate-and-watch.md, action/README.md, action.yml) say Customs
  has receipts for few sites. Ceiling: "site could not be reached" is told from the adapters' own "the target could not
  be reached" sentence, so a site that answers but serves no manifest reads "checked by ..." or "nothing was checked",
  not "down"; the Action's summary was proved through its reader over real reports, not a full Action gate run (the
  runner drives the watch path only); the badge (UAT-10) is unchanged; the slow site was not driven in the Desk.

### UAT-10. The client badge is never green over what it did not check, and is dated by the check

- Serves: Priya.
- Closes: PRI-L1-09, PRI-L1-14, PRI-L1-08, REC-5, REC-10 (the badge part).
- Done when: tallow-finch badges for the healthy, down, tampered and expired sites are distinguishable; no badge is green
  for a site whose published signature is invalid or was not checked (the badge either carries the signature verdict or
  says it does not); the date is the time the gate ran, from the report, and `--now` cannot move it silently.
- Root cause: **verified**. `src/cli/badge-command.ts:19-25,30`; `src/core/types.ts:309-314` (no time in the gate
  report).
- standard: `signed-artifacts/verification-ux`.
- Size: M (wire: a report time).
- Must not break: guardrail 1 and PRI-L1-S5 (never green for not checked; the word always written).

### UAT-11. No address to Agent Atlas that the gate itself refused; say so where it happens

- Serves: Priya.
- Closes: PRI-L1-04, PRI-L2-1.
- Done when: with an Atlas stand-in, `gate` on an http address without `--allow-local`, a private-range address, a name
  that resolves to loopback and an unresolvable staging name sends nothing to Atlas (or asks first); the gate's output
  and the Desk's check view say, before the request, that the address goes to Atlas's public API; the scan takes
  `--adapters`.
- Root cause: **verified**. `src/gate/adapter-atlas.ts:46-50`, `src/cli/gate-command.ts:104-110`, `src/scan/run.ts:113`,
  `site/strings.js:56`.
- standard: none.
- Size: S to M. Ship as a tagged release with notes. Signed Desk file.
- Must not break: guardrail 7.

### UAT-12. A keyless site is not told to sign

- Serves: Dev.
- Closes: DEV-L1-04, REC-4 (the reminder part).
- Done when: on meridian-trips (no `plumbline.signature.json`), the relock output, the issue and the PR body say nothing
  about signing again, the PR is not a draft, and a scheduled run with the PR open and unchanged is green.
- Root cause: **verified**. `src/watch/decide.ts:493` (`RESIGN_REMINDER` is unconditional); `action/report.mjs:145-148`,
  `:273-277`.
- standard: `quality-gates/refusal-names-a-reachable-remedy`.
- Size: S.
- Must not break: on a signed site the reminder and the draft rule stay exactly as they are (MAR-L1-17).

### UAT-13. Line endings are not "different facts"

- Serves: Dev.
- Closes: DEV-L2-1.
- Done when: `init` in a checkout made with `core.autocrlf=true` and no LF pin warns and names the `.gitattributes` line;
  a difference that is line endings only is reported as such, never as "the agent now answers from different facts".
- Root cause: **verified** that exact-byte hashing is by design (`src/net/canonical.ts:4-7`) and documented only at
  `docs/gate-and-watch.md:125-127`; the remedy is a hypothesis.
- standard: none.
- Size: S.
- Must not break: guardrail 11.

### UAT-14. A flag that cannot act says so

- Serves: Tomasz.
- Closes: TOM-L1-05, TOM-L1-14; code review "`watch --init --external` does nothing on an existing lock".
- Done when: `watch --root site --init --external a2a-card=<https url>` on kiln-row's existing lock refuses (or adds the
  card) with a line naming `--relock --external`, as `init` does for `--source`; `watch --init` says "wrote" or "kept" and
  its JSON carries `lockState`; the docs list the `external` relock label.
- Root cause: **verified**. `src/watch/index.ts:58-67`.
- standard: `quality-gates/refusal-names-a-reachable-remedy`.
- Size: S.
- Must not break: guardrail 5.

### UAT-15. Guardrails at the moment of a bad-day mistake

- Serves: Ines.
- Closes: INE-L1-02, INE-L1-05, INE-L1-13, INE-L2-2, INE-L1-16.
- Done when: in J3's wrong-order arm, `rotate` says it is for planned changes and not after a leak; `revoke` warns when
  the site's rotation file names a successor of the key being revoked, and says the revocation is final at every verifier
  that reads it; `sign` warns when its key was adopted through a key the site revokes; `adopt` warns or refuses a second,
  different successor of one key; `export-jws` refuses a revoked key; the revocation steps (docs and revoke's "next:")
  say to replace the DNS record with the new kid alone.
- Root cause: **verified**. `src/cli/commands.ts:781-785`, `:789-842`, `:641-674`; `src/core/rotate.ts:121,146`;
  `docs/signature-format.md:398-406`; `src/cli/trust-command.ts:214-218`.
- standard: `signed-artifacts/key-custody`.
- Size: M.
- Must not break: guardrails 3 and 4 (warnings add, they never auto-adopt or auto-trust).

### UAT-16. `watch --url` strips control characters from a published lock

- Serves: Dev and Tomasz (both read stranger-published locks in a terminal).
- Closes: code review 2026-11-18 (confirmed there; no Character reached it, since every world lock is the product's own).
- Done when: a published lock whose refs carry control characters prints them replaced, as `plumbline diff` does.
- Root cause: **verified by the code review**.
- standard: none.
- Size: S.
- Must not break: guardrail 2.

## Build items: completeness

### UAT-17. Inventory-grade output: closed reason codes, times and fields

- Serves: Tomasz, Dev.
- Closes: TOM-L1-07, TOM-L1-13, TOM-L1-10, TOM-L1-09, TOM-L1-02 (the JSON part), DEV-L1-11, REC-10 (the report part).
- Done when: Tomasz's inventory script, re-run over the J5 acts' `--json` bodies, fills all 25 cells from fields: every
  finding carries a code from a closed, documented list; the report carries the time it ran; card and peer differ by a
  field; the lock records the card's signature count; `verify --json` carries the rotation hint; adopt's JSON says
  `successors` until something is adopted; adopt on a seller with no rotation is a verdict with exit 1; the outline counts
  are numbers.
- Root cause: **verified** (absence: `src/core/types.ts:316-338`, `src/cli/commands.ts:626,630`,
  `src/cli/trust-command.ts:276-306`); the code list is a hypothesis.
- standard: `agent-host-experience/journey-shaped-tool-surface`.
- Size: L (wire).
- Must not break: guardrail 2; the sentences stay (codes are added beside them). It is the precondition for UAT-29's
  generated plain language and for the agent-host step in the onboarding concept.

### UAT-18. The old partner definition, so the change can be seen

- Serves: Dev.
- Closes: DEV-L1-03, DEV-L1-10.
- Done when: from the drift issue, one product command shows meridian-trips' partner change by name (agents added,
  removed and changed, new hosts, the changed agents' old and new text) for a partner whose old definition Dev never
  saved by hand; a `links.json` change counts the hosts it adds.
- Root cause: **verified** (absence: `src/watch/capture.ts:144-156` keeps hashes only); the design (a kept copy in the
  publisher's own repository, outside the lock, and `diff` against it) is a hypothesis.
- standard: none.
- Size: M.
- Must not break: guardrail 2 (names only in the publisher's own terminal, never in the issue).

### UAT-19. A portfolio report a junior can act on

- Serves: Priya.
- Closes: PRI-L1-03, PRI-L1-10, PRI-L1-15, PRI-L2-5.
- Done when: the tallow-finch scan lists the down site first and the healthy ones last (or carries one attention field
  and sorts by it), shows the key record per site, uses one word per state across table and summary, states the
  per-site caveat once, and does not scroll sideways at 390 px; Priya's ten-line procedure loses lines 5 and 9.
- Root cause: **verified** (absence: `src/scan/run.ts:139-144`, `src/scan/report.ts:33,141-144`).
- standard: none.
- Size: M.
- Must not break: the report stays static with no script (its CSP), and guardrail 7.

### UAT-20. An operator's scan with the operator's own trust file

- Serves: Priya.
- Closes: PRI-L1-05.
- Done when: the tallow-finch scan with `--trust <agency file>` reads glenrock-gym `invalid tampered`, fernhill-hotel
  `invalid expired` and alder-bakery `verified`; without it, it says what it says today.
- Root cause: **verified** that the scan trusts no key by design (`src/scan/run.ts:126`); the operator mode is a hypothesis.
- standard: none.
- Size: M.
- Must not break: a stranger's list stays `unverifiable` (first contact is a person's decision; guardrail 3).

### UAT-21. A publisher can rehearse before production

- Serves: Dev, Tomasz, Priya.
- Closes: DEV-L1-08, TOM-L1-11, TOM-L2-06 (the CLI part), PRI-L1-11 (the scan part).
- Done when: J2's and J5's peer acts run through the product's CLI (`init`, `watch --root`, `--relock`, `--external` and
  the scan with `--allow-local`) with the same findings the harness gives today, the `--allow-local` warning printed,
  private ranges still refused; `watch --url` still refuses a published lock's non-https peers.
- Root cause: **verified** (absence: `src/cli/watch-command.ts:92`, `src/cli/init-command.ts:217`,
  `src/watch/external.ts:141`, `src/scan/run.ts:52-55`; the library takes `fetchOptions.allowLocal`,
  `src/watch/lock.ts:15-18`).
- standard: none.
- Size: M.
- Must not break: the `safeFetch` law (private ranges refused; loopback only with the flag and its warning).

### UAT-22. A pre-launch gate over files

- Serves: Priya.
- Closes: PRI-L1-06.
- Done when: `gate --root <build output>` runs the validator's rules on tallow-finch's dunmore-books before `fix-launch`
  (fail, exit 1) and after (pass, exit 0), sending nothing to a third party, and the Action can gate a branch before
  deployment.
- Root cause: **verified** (absence); the validator's rules are pure (`src/gate/validator.ts`); the design is a hypothesis.
- standard: none.
- Size: M.
- Must not break: guardrail 6 for the address form.

### UAT-23. The trust file records when; verify reads a missing trust file as empty

- Serves: Ines.
- Closes: INE-L1-11, INE-L1-12.
- Done when: trust and adopt stamp when an entry was added; a cascaded revocation records when it was recorded here as
  well as the source's time; `verify` with no trust file says `unverifiable` (or names how to make one).
- Root cause: **verified** (`src/cli/files.ts:189-195`, `src/core/revoke.ts:76-96`, `src/cli/commands.ts:515-516`); the
  fields are a design hypothesis.
- standard: none.
- Size: M (wire).
- Must not break: guardrail 4.

### UAT-24. The validator says which file and which key

- Serves: Priya.
- Closes: PRI-L1-12.
- Done when: the two-network dunmore-books arm names the network file and the repeated key (`commondefs`) beside the rule.
- Root cause: **verified** (`src/gate/adapter-validator.ts:39-102` withholds names by design); whether a spec key name and
  the scanner's own URL are safe to show is a hypothesis to confirm against the no-quote rule.
- standard: none.
- Size: S.
- Must not break: guardrail 2.

### UAT-25. The alerts offer the cut path

- Serves: Dev.
- Closes: DEV-L2-3.
- Done when: the drift issue and the relock PR for a changed peer say "or remove the partner: delete it from <network>
  and relock"; after the cut, the watch notes an `allowed_peers` entry no network names.
- Root cause: **verified** (`action/report.mjs:141-148`; `allowed_peers` read nowhere in `src/`).
- standard: none.
- Size: S.
- Must not break: guardrail 3.

### UAT-26. The pre-load check for a site's own peers, in the Desk's own page

- Serves: Tomasz.
- Closes: TOM-L1-12.
- Done when: the Desk takes a site's address and runs `checkPeerBeforeLoad` over that site's own peers against the
  visitor's trust list, showing what differs (definition, `links.json`, signer) from its `lockFindings`.
- Root cause: **verified** (`site/desk.js:60,1304-1341`; `lockFindings` dropped); the view is a hypothesis.
- standard: none.
- Size: M. Signed Desk files; nothing in `site/runtime/` (DC-4).
- Must not break: guardrail 9.

### UAT-27. The Desk's revoke adds to an existing revocation list

- Serves: Ines (off her bound path; uncertain).
- Closes: INE-L1-17.
- Done when: `#/key` revoke on a site that already publishes a revocation offers the list with the new statement added,
  or warns that the download replaces it.
- Root cause: **hypothesis** (read at `site/desk.js:1036-1043`, not exercised).
- standard: none.
- Size: S.
- Must not break: guardrail 4.

## Build items: friendlier (after the sentences they carry are correct, MC-6)

### UAT-28. One way in: help, roles, and a README whose commands run

- Serves: Dev, Ines, Priya, Tomasz.
- Closes: DEV-L1-09, INE-L1-06, PRI-L1-13, PRI-L1-11, PRI-L2-4, PRI-L1-15 (the help part), DEV-L2-2, DEV-L1-07.
- Done when: `plumbline --help`, `plumbline help` and `<command> --help` work and group commands by role (publisher,
  verifier, operator, CI); the README's "Use it" has one working directory per block and an entry per role (publish and
  watch; check a partner or a stranger; run a portfolio; the bad day), states the Node version, and presents the one-URL
  gate as the quickest first result; every printed command runs as printed (MC-3); a clean watch says "no drift"; a
  refused http address names `--allow-local`; times are dates, not epochs; the PR loop's GitHub settings are named.
- Root cause: **verified** (`src/cli/index.ts:39-42`, `README.md:23-29`, `src/cli/init-command.ts:188-196`,
  `src/watch/detectors.ts:111`).
- standard: `quality-gates/refusal-names-a-reachable-remedy`.
- Size: M. May run in parallel with UAT-1 to UAT-16 (it adds no claim).
- Must not break: guardrail 5 (one keyless command stays the first step).

### UAT-29. An owner-facing first line, and a link that carries her address

- Serves: Marta.
- Closes: MAR-L1-06, MAR-L1-11, MAR-L1-09, MAR-L2-05.
- Done when (after UAT-1, UAT-2 and UAT-7 are recertified): the drift issue, the relock PR and the Desk's drift result
  open with one sentence in the owner's words generated from the finding's code (UAT-17), naming the page and the kind of
  fact, saying who acts and what to forward; the issue carries a Desk link that opens the drift view with the address
  filled in; the default Desk view shows no 64-character hashes; a page the browser could not read names the header to
  ask the host for; the landing starts from "your site's address". Marta's L2 jargon count on the issue drops from 23
  terms to the ones explained where they appear.
- Root cause: **verified** (absence: `action/report.mjs:127-155`, `site/shell.js:540-553`, `site/desk.js:1453-1457`).
- standard: none (the onboarding concept document governs the sequence).
- Size: M. Signed Desk files.
- Must not break: guardrail 2 and 8; the technical table stays below the owner line (Dev and Tomasz read it).

### UAT-30. The news when it lands, to a named person

- Serves: Marta.
- Closes: MAR-L1-08 (the trigger part; notification reach stays uncertain until a real repository).
- Done when: the watch template runs on a push that touches the site folder as well as daily, and the Action can mention
  or assign a named owner on the issue.
- Root cause: **verified** for the trigger list (`action/templates/plumbline-watch.yml:12-15`); reach is a hypothesis.
- standard: none.
- Size: S. Template pin follow-up.
- Must not break: guardrail 5.

### UAT-31. The assistant's tool result carries what the lock watches

- Serves: Marta (and anyone who brings a key).
- Closes: MAR-L1-12 (the grounding part: 5/6 to 6/6).
- Done when (after UAT-1): `read_drift` returns the lock's sources and, per source, the kinds of fact watched and not
  watched, so "does my chat still say 89?" can be answered from tool results.
- Root cause: **verified** (`site/desk.js:589-598`).
- standard: `agent-host-experience/journey-shaped-tool-surface`.
- Size: S. Signed Desk file; nothing in `site/runtime/`.
- Must not break: the tool-result pattern rule (`site/README.md`: strings from an inspected site pass their pattern or
  are withheld).

### UAT-32. Two small Desk honesty fixes

- Serves: Marta, Ines.
- Closes: MAR-L2-04, INE-L2-3.
- Done when: after trusting a publisher in `#/verify`, the `aria-live` status line says the new verdict; an import that
  only records revocations says "Record these 2 revocations", with singular grammar for 1.
- Root cause: **verified** (`site/desk.js:846-866`; `site/strings.js:189`).
- standard: none.
- Size: S. Signed Desk files.
- Must not break: guardrail 3 (the import still needs a confirm).

## Build items: code-review hypotheses (verify first)

No Character reached these; each cites the code review of 2026-11-18.

| Id | Hypothesis | Where to look | Done when | Size | standard |
| --- | --- | --- | --- | --- | --- |
| UAT-33 | A fork's PR on a branch named `plumbline/relock` is taken for the Action's own | `action/report.mjs` PR lookup by `--head` | the PR plan ignores a PR whose head repository is not this one (needs real `gh`) | S | none |
| UAT-34 | With a signing key, CI signs a relock before a person reviews it | `action/action.yml` "Decide on the pull request" | the signed lock is produced only after review (a separate apply job, or signing on merge) | M | `ci-execution-trust/measure-apply-split` |
| UAT-35 | Renewal decides on the English word "expire" in a summary | `action/report.mjs:239` | renewal reads a code or structured field (UAT-17), not prose | S | none |
| UAT-36 | Duplicate skill ids in an Agent Card miscount | `src/watch/external.ts:59-60` (parts keyed by the id's hash; a repeated id overwrites) | a card with a repeated skill id is counted correctly or reported | S | none |

## Method commitments

Standing commitments about how the team works, each with its trigger.

- **MC-1. The grounding regression.** Trigger: any change to `src/watch/anchors.ts`, `src/watch/capture.ts` or the
  grounding branch of `src/watch/decide.ts`, and every release. Do: J1's `raise-price` and `cosmetic-edit` on the
  unchanged larch-house fixture must read differently, and `uat/runs/2026-11-18-first-five/evidence/marta/anchor-probe.mjs`
  is re-run and its output compared. (MAR-L2-01, MAR-L2-02.)
- **MC-2. Surface parity.** Trigger: a change to `src/core/verify.ts`, `src/gate/`, `src/scan/report.ts`,
  `action/report.mjs` or `site/strings.js`. Do: the change lands on CLI, Desk, scan, badge and Action summary in the same
  change, checked against the REC rows of `uat/runs/2026-11-18-first-five/reconciliation--sweep.md`. (REC-1 to REC-11.)
- **MC-3. Remedies that run.** Trigger: a change to `README.md` "Use it", init's next steps or the issue and PR bodies.
  Do: a test runs every printed command as printed, from the folder the text names. (DEV-L1-09, PRI-L1-13.)
- **MC-4. The second event.** Trigger: a change to `action/action.yml` or `action/report.mjs`. Do: run the
  create / second-drift / after-merge sequence with `uat/driver/run-action.mjs` before moving the template pin.
  (DEV-L1-01, DEV-L1-02.)
- **MC-5. The destructive rehearsal.** Trigger: a change to `src/watch/capture.ts` or the relock in
  `src/watch/index.ts`. Do: relock with a peer and the card down, and a real-CLI relock with nothing reachable, on a copy
  of a pinned lock; nothing pinned may be lost. (TOM-L2-01, TOM-L1-03, TOM-L1-04.)
- **MC-6. Correctness before guidance.** Trigger: any plain-language, tour, wizard or assistant work (UAT-29 and the
  onboarding concept's later steps). Do: ship it only over sentences recertified at L2 on the world fixture. (Marta's L2
  verdict on stop S3.)

## Declined, with reasons

- **DC-1. Lower a wording-only grounding change to `info`** (MAR-L1-07). Declined: the roadmap's rule "nothing new
  softens an existing severity", and the sentence it would rest on was refuted live (MAR-L2-01). Re-raise only with
  UAT-1 recertified and evidence that the lock watches every fact the page states.
- **DC-2. A guided tour of the Desk** (Marta's stops S5 to S7). Declined for now: a tour teaches a surface that already
  works, and the Desk's drift view says the wrong thing on her page; a tour cannot bring her to the Desk. standard:
  `guided-tours/tour-lifecycle` (stale coaching is misinformation). Reconsider after UAT-1, UAT-7 and UAT-29 recertify,
  if a later J1 walk shows her lost inside the Desk.
- **DC-3. An assistant-led onboarding inside the Desk, now** (MAR-L1-12). Declined: the assistant runs in the vendored
  runtime, which needs the visitor's own model key and may not be changed; and its evidence today is the false all-clear.
  The agent-host path in the onboarding concept stays open.
- **DC-4. A pre-load veto inside the reference runtime's consent card** (TOM-L1-12, Dev's consent-card note). Declined
  by law (`site/runtime/` is copy-do-not-change); proposed upstream (`docs/proposals/runtime-preload-hook.md`). The Desk
  half is UAT-26.
- **DC-5. Install from npm** (DEV-L1-09, Priya's pet peeve). Covered elsewhere: roadmap D2, the owner's naming decision.

## Concept documents

- `docs/product/concepts/onboarding-and-guidance.md`: the product owner's question (can a non-technical owner onboard and
  operate, and should it be assistant-led or guided?), answered from this run's evidence, with the recommended sequence.
  It also holds two questions the drain routed there: whether the Desk's views are meant for a non-technical stakeholder
  (the run's one opposing verdict: Ines against Priya and Tomasz), and whether the publisher's own checkout may name the
  stale literal (MAR-L1-05).
