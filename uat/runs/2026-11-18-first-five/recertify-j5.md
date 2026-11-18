# Recertify: J5 (Tomasz Wieczorek, vetting the sellers)

Run `2026-11-18-first-five`, recertified 2026-11-18 by an independent walker (not the fixer). Range `15af680..c9f6a3b`.
World `kiln-row`. The full journal, quoted output, exit codes and finding rows are in
`tomasz-wieczorek--j5-vetting-sellers.md`, sections "Recertify 2026-11-18" and "Findings (recertify)". Transcripts are in
`shots/tomasz-recert/t/`; Desk shots are `shots/tomasz-recert/tom-rc-desk-*`.

## Preconditions

- Fresh build: `dist/` 14:56:27, HEAD 14:53:09 (+0100).
- `git diff 15af680..HEAD --stat -- uat/fixtures uat/characters uat/journeys uat/rubric.md` is empty.
- The harness changes in range (`local-cli.mjs`, `gh-stub.mjs`, `run-action.mjs`) only pass the new flags through and
  print the product's own refusal. Read line by line.
- Arms:
  - real CLI where it reaches;
  - `uat/driver/local-cli.mjs` for every seller and card contact (UAT-21 is not built, so the CLI still cannot reach a
    loopback seller);
  - the Desk in Chromium with `expectMatch`;
  - the Action through `run-action.mjs --harness --relock-pr true`;
  - one constructed 5xx arm.
- The world was taken down at the end: ports free, folder gone, no leftovers.

## Verdict

**Conditional** (L2 was a fail).

- The week now works:
  - the swapped signer stays blocked through every accept;
  - the plain relock refuses and writes nothing;
  - nothing offline loses its pin;
  - the card survives its outage;
  - CLI and Desk call a swap "not a first contact" and an unsigned seller `unverifiable`.
- The accept path can still be broken, and the Action follows the break: a relock that runs while the held seller's
  signature answers 404 records the seller as unsigned. The swapped key then returns as "newly signed" `info`, and the
  next plain relock pins it with a clean watch. Nobody ever names the seller.

## Resolved (resolved-verified, with ceilings)

| Finding | What holds live | Ceiling |
| --- | --- | --- |
| TOM-L1-01 | A plain relock refuses with a signer change pending. `--accept <A> --accept-signer <A> --trust` accepts only A. B is still `block` after six more relocks. | 404 window (TOM-RC-1); the refusal's one-line command (TOM-RC-3); harness only on loopback |
| TOM-L1-02 | The watch and `verify --json` tell a rotation from a swap. | By sentence only, no field (UAT-17) |
| TOM-L1-03 | A pin is kept through an outage relock. The main arm prints the same as the control arm after `seller-back-changed`. | Pin freshness; a first key is recorded with no signer line (TOM-RC-4) |
| TOM-L1-04 | The card is kept through an outage relock and still warns. | No card signature count (TOM-L1-13) |
| TOM-L2-01 | A real-CLI relock that reaches no seller keeps 4 pins and the card ("no ref changed"). | Exits 0 "wrote" having re-read nothing; card reason wording (TOM-RC-5) |
| TOM-L2-02 | `--drop <peer>` exits 2 with what `--drop` takes. It never says "was not in the lock". | Its advice leads to TOM-RC-4 on relist |
| TOM-L2-03 | CLI and Desk: "this origin's trusted key is X ... not a first contact", with 0 first-contact panels. | Detail text only |
| TOM-L2-04 | Desk: "Lock signed by a key you have not trusted". | The Desk contacts no loopback seller |
| TOM-L2-05 | The pending line carries its reason. One "was not contacted" sentence on CLI and Desk. | The published reader's pending wording was not re-walked |

## Fixed, not unblocking

| Finding | Landed | Why it does not unblock |
| --- | --- | --- |
| TOM-L1-06 | `verify` on an unsigned seller is `unverifiable`, exit 1, with a JSON verdict; the Desk agrees. | The watch still prints nothing for an unsigned seller, and the lock only lacks a kid. |
| TOM-L1-08 | A 5xx at capture keeps the kid, with a line (constructed arm). | A 404 still drops the kid (now with a line). That is the hole in TOM-RC-1. |

## Still open (9)

TOM-L1-05 and TOM-L1-14 (UAT-14), TOM-L1-07, TOM-L1-09, TOM-L1-10 and TOM-L1-13 (UAT-17), TOM-L1-11 (UAT-21), TOM-L1-12
(UAT-26), TOM-L2-06 (UAT-21/26). All were expected open: none of these items was built. Each was re-checked live and is
unchanged.

## Regressed

None. Strengths S1 to S6 hold; S6 (uncertain at L2) is now confirmed live.

## Metric deltas

| Metric | L1 | L2 | Recertify |
| --- | --- | --- | --- |
| Scored criteria | 1 of 8 | 1 of 8 | **3 of 8** (4 of 8 on the journey's written acts; criterion 5 falls to the 404 window) |
| Criteria that moved | | | 4 (unreachable never clean or dropped) and 6 (unsigned reads unverifiable) now pass |
| Inventory cells from JSON, per event | n/a | 0 to 4 of 25 | **0 to 6 of 25** (the gain is only the refusal JSON) |
| Event week | ~21 steps, ~28 min | ~40 steps, ~45 min | **~26 steps, ~25 min** |
| Time saved, event week | ~12 min (medium) | about -5 min (medium) | **~15 min (medium)** |
| Time saved, quiet week | ~35 min (low) | ~28 min (medium) | **~32 min (low-medium)** |
| Time saved, blended (one eventful week in three) | ~20 min/week | ~17 min/week | **~26 min/week (low-medium)**; target 30 |
| Indistinguishable act pairs | 4 | 4 | **2**: unsigned vs clean; a swap after a 404-window relock vs a first signature |
| Grounding | n/a | n/a | n/a (no AI surface in J5) |

## Can the new accept path be broken?

Yes. Two sequences end with the swapped signer pinned and the watch clean, and neither uses `--accept-signer` for that
seller.

1. **Plain relocks across a signature gap (TOM-RC-1).**
   - The held seller's `plumbline.signature.json` answers 404 during an ordinary `--relock`. The seller can cause this
     on purpose, or it can be a deploy blip.
   - The relock exits 0 and writes "records it as unsigned".
   - The signature comes back under the swapped key and reads as `info` "newly signed".
   - The next plain relock pins the swapped key with only "changed peer". The watch exits 0 with or without `--trust`.
2. **The Action (TOM-RC-1, TOM-RC-2).**
   - With the signer change pending, CI correctly refused to relock and said so on the issue.
   - During the 404 window, CI's relock was not refused. Its draft pull request dropped the kid and listed that drop
     under "What this relock does not accept, or keeps as it was (these keep reporting after a merge)".
   - After a person merged it, the issue closed as "clean".
   - The next unrelated drift opened a pull request whose lock pins the swapped key under "changed peer".

Nearer misses:

- Pasting the refusal's own suggested command accepts the swap beside the rotation, without `--trust` (TOM-RC-3).
- Delisting the seller, relocking, then relisting it pins whatever key it then has, with no signer line (TOM-RC-4). The
  `--drop` refusal suggests that delist path.

Held:

- `--accept <B>` without `--accept-signer` is refused.
- Variant spellings of the ref are refused.
- `--accept-signer <A>` alone is refused while B is pending.
- A real-CLI relock that reaches no seller keeps B's old kid.

## New findings for the next drain

| Id | Severity (rank) | One line | Suggested acceptance |
| --- | --- | --- | --- |
| TOM-RC-1 | major (low x high x high = 9, trust high) | A relock during a held seller's signature 404 records it unsigned. The swapped key then returns as "newly signed" `info`, and any plain relock (hand or Action) pins it with the watch clean. | Swap, hold, 404, plain relock, signature back, plain relock: the lock keeps `94b090a84b42fb09` or refuses, and the second relock refuses naming the seller. The Action opens no PR that removes or replaces the kid. |
| TOM-RC-2 | major (9, trust high) | The Action's relock PR lists a kid it removes under "does not accept, or keeps as it was (these keep reporting after a merge)". After the merge, nothing reports it and the issue closes as clean. | The PR says it removes the recorded signer, outside that table, or opens no PR. |
| TOM-RC-3 | minor (6) | The refused relock's suggested command accepts every refused peer in one line, a "different key, with no rotation published" included, and without `--trust`. The Action's text has the same shape. | No single printed command accepts both the rotated and the swapped seller. |
| TOM-RC-4 | minor (6) | A relock records a peer's first key, or a relisted peer's key, as "changed peer" or "added peer" with no signer line, even with `--trust`. | A first or relisted key prints a signer line with its backing; a relisted peer is compared with its last kid. |
| TOM-RC-5 | polish (1) | In one relock, a peer refused by the address rule reads "(it is not an https address)" and the card refused by the same rule reads "(it could not be read)". | The same reason words for both. |

Hypothesis for the fixer (verify before building): `src/watch/capture.ts:222-224` writes a record without `kid` when a
pinned peer publishes no signature, unlike the `problem` branch above it, which keeps `pinned.kid`. `src/watch/index.ts`
then skips the signer comparison when either side's kid is undefined (`:187`). Keeping the last recorded kid, or a
separate "last signer" beside it, would let the later key count as a signer change. Whether that is a wire change
(`src/core/types.ts`) is the fixer's call.

## Method notes

- One of my Desk checks was vacuous: it read the first line, which is an icon. I re-read the matched text and cite only
  that text.
- My first merge attempt of an Action PR failed on my clone's line endings (`core.autocrlf`). Use
  `-c core.autocrlf=false` as the runner does. The failed run became a useful control arm.
- `uat/fixtures/README.md`'s "Confirmed" sentences for `kiln-row` describe the pre-fix product. For example, it still
  says a rotation and a swap read the same at the watch. The fixtures are unchanged, as required; the drain should
  refresh the README.
