# Recertify: J1 (Marta Hollis, the price changed)

Recertified 2026-11-18 by an independent recertifier against `15af680..c9f6a3b`, at L2, in four fresh `larch-house`
worlds. Full journal, per-finding table, criteria, stops and the Character's voice: `marta-hollis--j1-price-changed.md`,
section "Recertify 2026-11-18" (appended; earlier sections unchanged). Evidence: `evidence/marta-recert/` (scripts and
`out/`). Shots: `shots/marta-recert/rc-*` (16 stems).

## Preconditions

- **Freshness:** `npm run build` and `npm run build:site` at 14:55:32/33; HEAD `c9f6a3b` committed 14:53:09 (+0100).
  `dist/` is newer than the last commit.
- **Fixtures unchanged:** `git diff 15af680..HEAD --stat -- uat/fixtures uat/characters uat/journeys uat/rubric.md` is
  empty. `uat/fixtures/README.md`'s larch-house "Confirmed" sentences now describe the old product (not edited, not used).
- **Keys:** no key under the repository or any `keys/` folder was used. Jonas signed with a throwaway key made in each
  world's own folder (`<world>/jonas-recert`), whose public record replaced the site's.

## Verdict

**Conditional** (L2: fail). Blocker MAR-L2-01 is **resolved-verified** on the unchanged fixture: after `raise-price` the
issue, the Desk (1280 and 390 px) and the assistant's tool result say "1 of 7 facts the lock watches on it (facts the
network states) is no longer on it, and the network still states it (1 price), so the agent may now answer with an old
fact."; `cosmetic-edit` says "all 7 facts ... are still on it, so what changed is something the lock does not watch."
Its ceiling: the price is named by kind, never by value, and a value that also appears elsewhere on the page hides the
change (MAR-RC-1, new, major). She still finishes only by forwarding the link to her developer.

## Resolved (resolved-verified, with ceiling)

| Id | What now holds, live | Ceiling |
| --- | --- | --- |
| MAR-L2-01 (blocker) | raise-price and cosmetic-edit read differently on every surface she reaches | kind not value; MAR-RC-1 layouts; unwatched forms named only to the developer |
| MAR-L2-02 | the L2 probe: 36/36 forms anchor (was 23); 29 more forms: 15 anchor, 13 do not and init names each by value, 1 anchors but is not counted | the "not watched" list is the developer's terminal only |
| MAR-L1-01 | a relock with the network still at €89 prints "Not accepted ... (1 price)" and keeps the record; the issue stays open; no PR is offered when the stale page is the only change; a PR that exists opens with "What this relock does not accept" | `--drop rooms.html` still silences it; the PR title is still "accept the drift" |
| MAR-L1-02 | after fix-network: "no stale fact is left: review the change, then re-lock" on the issue and the Desk | the right fix is announced as "A new `block` finding" (MAR-RC-2) |
| MAR-L1-03 | "89 euros" anchors; a zero-anchor page warns at init and reads "is not checked" | a network written in words prints "0 (none)" with no warning |
| MAR-L1-04 | a raise on an open cosmetic issue comments (notifies) with the stale-fact sentence | every later edit re-announces it as "New:" (MAR-RC-3) |
| MAR-L1-10 | her signed site reads "Signed lock, by a key you have not trusted", never "unsigned" | each new browser starts untrusted |
| MAR-L1-13 | three consecutive pushes to the existing relock branch, each exit 0; the branch lock follows €89 -> €95 -> €89 | bare remote, not a real runner |
| MAR-L2-03 | merged unsigned relock: the issue stays open with "block ... The site's signature no longer covers its files"; the close comment now covers the signature | checkout watch only; nothing to break on an unsigned site |
| MAR-L1-15 (strength) | restored on her page | not on MAR-RC-1 layouts |

## Still open

| Id | Why | Backlog |
| --- | --- | --- |
| MAR-L1-05 | the kind and count are named ("1 price"), never 89 or 95 | concept doc |
| MAR-L1-06 | issue 167 words, 22 of 28 counted terms outside her vocabulary (L2: 143, 21); Desk 9 terms and two 64-character hashes | UAT-29 (not built) |
| MAR-L1-07 | a cosmetic edit still opens a notifying warn issue only the developer can close | DC-1 (declined) |
| MAR-L1-08 | template triggers unchanged (cron, dispatch); reach uncertain | UAT-30 (not built) |
| MAR-L1-09 | no-CORS reading names no header | UAT-29 |
| MAR-L1-11 | a fresh deep link opens the overview with an empty field | UAT-29 |
| MAR-L1-12 | needs her key; tool result lacks the lock's sources (5/6); its L2 widening is reversed (the evidence is now correct) | UAT-31 (not built) |
| MAR-L1-14 | singular fixed; init step 3 printed when nothing is unwatched; `lockSummary` unwired | none |
| MAR-L2-04 | `#verify-status` still "Unverifiable" after trust | UAT-32 (not built) |
| MAR-L2-05 | landing unchanged | UAT-29 |

**Fixed but not reachable or not unblocking:** none.

## Regressed

None. MAR-L1-16 and MAR-L1-17 (strengths) held. One behaviour got louder without breaking a passing check: the right fix
now arrives as a `block` comment (MAR-RC-2), where L2 saw a warn comment.

## Fixer claims checked

- UAT-1, UAT-2, UAT-5, UAT-6, UAT-7 claims reproduced on Marta's surfaces, except as below.
- **UAT-2, contradicted in part:** "after `raise-price`, draft PR #2's body opens with 'What this relock does not
  accept'". With the peer already pinned (the original L2's baseline) no PR is opened at raise-price (`pr-plan: none`,
  "no ref changed"; `action/report.mjs:509-512`). The quoted body appears only when the relock also accepts something
  else (W4, the peer pending). Safer than claimed.
- **UAT-1's probe claim** ("all 36 forms anchored") holds; the fix's probe never states one value twice on a page,
  which is where MAR-RC-1 lives.

## Metric deltas

| Metric | L1 | L2 | Recertify |
| --- | --- | --- | --- |
| Criteria passed | 2 of 7 | 1 of 7 | **4 of 7** (1, 3, 5 conditional, 7 narrowly) |
| Stops S1 to S10 still stopping | n-a | 10 | **8** (S3 and S10 gone; S7 narrower; S9 louder) |
| Time saved per price change | ~7 min (low) | none, worse than none (medium) | **~10 min, ~80 min a year (medium)**; none on MAR-RC-1 layouts |
| Grounding (assistant) | 5/6, additions 0/2 | 5/6, 0/2 | 5/6, 0/2 (the stale fact's kind now reaches the tool's summary) |
| Anchor probe (L2's 36 forms) | n-a | 23 anchored | **36 anchored** |
| Issue jargon (28-term list) | n-a | 21 terms, 143 words | 22 terms, 167 words |
| Findings (19, strengths apart) | 14 open | 19 open | **9 resolved-verified, 10 open, 0 fixed-only, 0 regressed** |

## New findings for the next drain

- **MAR-RC-1 (major, trust; rank 18).** A changed price that still appears elsewhere on the page is invisible: a twin
  room at the same €89 (the double raised), a struck-through winter offer (`<del>€89</del> €79`), or an intro "Doubles
  from €89" each give "all 7 facts the lock watches on it ... are still on it, so what changed is something the lock
  does not watch." while the network says €89, and init gives no hint. An anchor is a value's presence anywhere on the
  page (`src/watch/anchors.ts:376-381`, `:466-471`; sentence `src/watch/decide.ts:148-149`). Reproduce:
  `evidence/marta-recert/mini.mjs` (arms M1, M2, M4). Suggested: at least never say "something the lock does not watch"
  when a watched value stays on the page; init flags a value stated twice. Add the three arms to MC-1.
- **MAR-RC-2 (minor, clarity; rank 12).** The right fix (network corrected before the re-sign) is announced as "**A new
  `block` finding.** Look before the next release." and the Desk says "the host may have rewritten it" and verify "Do not
  treat these files as the publisher's" about her own site. True for the developer, alarming for the owner
  (`action/report.mjs:242`, `site/strings.js:95`). Belongs with UAT-29's owner-facing line.
- **MAR-RC-3 (minor, clarity; rank 6).** While the issue is open, every later edit of the page, wording included,
  comments "New:" with the same stale-fact sentence (`action/report.mjs:84-101`, `:251`): the price of MAR-L1-04's fix.
  A comment should say when the finding's sentence is unchanged.
- **MAR-RC-4 (strength).** Nothing accepts a stale fact (relock, PR, no PR when it is the only change, unsigned merge).
  Guardrail for any later accept design.
- **Fixture note (not a finding):** `uat/fixtures/README.md`'s larch-house "Confirmed" column is now stale (it quotes
  "all 5 facts ... still on it" for raise-price and cosmetic-edit, and "the agent now answers from different facts" for
  fix-network without the "review the change, then re-lock" tail and the signature block). The drain should refresh it
  from `evidence/marta-recert/out/`.
