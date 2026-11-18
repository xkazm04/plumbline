# Onboarding and guidance: what a first-time user needs, from the evidence

Status: concept, 2026-11-18. Written by the drain of UAT run `2026-11-18-first-five`
(`docs/product/uat-insights/2026-11-18-first-five.md`). Every claim cites a finding id or a quoted Character; the
evidence is in `uat/runs/2026-11-18-first-five/`. Backlog ids (UAT-n, MC-n, DC-n) are in `docs/BACKLOG.md`.

## The question

The product owner, in their words: "the UX for non-technical users can be an issue, the use case onboarding and run will
not be understandable for them; it may lead into an AI-led onboarding experience or another technique of onboard-and-use
UX we have." This document treats that as a question the run's evidence answers, not as a conclusion.

## The answer in short

The concern is real, and it is aimed one step too early. The non-technical owner in the run (Marta, a guesthouse owner)
never onboards: her developer does. She can operate the one surface built for her, the Desk's drift view, with only her
site's address, no key and no install, on a phone. She stops in ten places, and **the decisive stop is not a
comprehension stop: the product told her "all 5 facts the network states from it are still on it" after her price
changed, because the price was never watched** (MAR-L2-01). No guidance technique can carry her past that; a guided or
assistant-led layer built on today's sentences would make the false all-clear more convincing. The other four
Characters, all technical, stop at discoverability (no `--help`, no roles, a README that sends them to the wrong folder),
at missing capability (no local rehearsal) and, again, at wrong output.

So the recommendation is a sequence: make what the product says true first; give each role a door second (cheap, in
parallel); add a plain-language layer generated from the same vocabulary third; make every journey complete as text and
structured data so the user's own assistant can operate it fourth; and do not build a Desk tour or an assistant inside
the Desk now. A wizard earns a place only for the bad-day key procedure, and only if guardrails at the moment of the
mistake are not enough.

## The evidence, per Character

Each stop is classified once: **wording** (the right thing is said in words the person does not use), **navigation**
(the person cannot find the place or the command), **capability** (what the person needs does not exist), **wrong
output** (the product says something false or greener than it knows).

### Marta Hollis, guesthouse owner (out of segment for the CLI; the person the product protects)

Her ten stops, as her L2 walker recorded them (the hypothesis table in her report):

| Stop | Where | Class | Findings |
| --- | --- | --- | --- |
| S1 | the notification "Plumbline drift", up to a day late, only if she watches the repository | wording, capability | MAR-L1-08 |
| S2 | the issue's first line: "found drift since `plumbline.lock.json` was written" | wording | MAR-L1-06 |
| **S3** | **"... all 5 facts the network states from it are still on it."** | **wrong output (decisive)** | MAR-L2-01, MAR-L2-02, REC-9 |
| S4 | the next step: "run ... --relock" "in a clone"; nothing says "forward this to Jonas" | wording, capability | MAR-L1-06, MAR-L1-07 |
| S5 | getting to the Desk: no link in the issue or README; `#/drift?target=` opens the overview | navigation | MAR-L1-11 |
| S6 | the Desk's landing: a green "Passed" example and "Five ports of call" | navigation, wording | MAR-L2-05 |
| S7 | the Desk's result: "unsigned lock" (her site is signed), two 64-character hashes, "the upstream nsdeploy commit" | wrong output (the label), wording | MAR-L1-10, MAR-L1-06 |
| S8 | the assistant: "Assistant needs your AI provider key" | capability | MAR-L1-12 |
| S9 | after the right fix: a new warning, and "Do not treat these files as the publisher's" about her own site | wrong output, wording | MAR-L1-02, MAR-L2-03 |
| S10 | the "accept the drift" pull request, which reads as safe and closes everything as clean | wrong output | MAR-L1-01, MAR-L2-03 |

Her voice moved between the two levels in the direction that matters here. L1: "I have to read it. 'Drift.' 'Grounding
source.' 'Lock.' 'Relock.' What network?" L2: "At L1 I thought my problem would be the words. The words are bad,
twenty-odd of them I'd have to look up, but the worse thing is that when I finally understood a sentence, it was wrong."
And on the one surface she could use: "The checking page itself was easier than I expected. I typed my address on my
phone and got an answer without a key or an install." The walker's own verdict: "a guided layer would faithfully
translate 'all 5 facts still on it' into 'your assistant is fine'."

### Dev Okafor, sole web developer (the core user, first-time setup)

| Stop | Class | Findings |
| --- | --- | --- |
| the README's "from your site's repository root" runs a path that exists only in the clone; `plumbline ...` is not on PATH; `--help` is an unknown command | navigation | DEV-L1-09 |
| the accept-by-PR loop is not in the workflow init writes, and the GitHub settings it needs are named nowhere | navigation | DEV-L1-07 |
| no way to rehearse the watch against a local partner | capability | DEV-L1-08 |
| on Windows, Git's default line endings make the first CI run report four runtime blocks and "the agent now answers from different facts" | wrong output | DEV-L2-1 |
| a keyless site is told its signature will read tampered | wrong output | DEV-L1-04 |

Dev, L2: "I'd tell a peer to try it, with a written list of workarounds. That the list exists is the problem." Setup
itself passed his bar: one keyless command, 303 ms, about 6 to 8 minutes of his time (DEV-L1-S4).

### Ines Baptista, IT contractor (first contact, then the bad day)

| Stop | Class | Findings |
| --- | --- | --- |
| no help, and nothing says which commands are the publisher's and which the verifier's; the README never shows `revoke` | navigation | INE-L1-06 |
| the runbook takes 12 minutes to write from a 500-line document | navigation | (journal, run 1) |
| verify with no trust file exits 2 instead of saying `unverifiable` | capability | INE-L1-12 |
| "move to a new key" sounds like `rotate`, and nothing warns her | capability | INE-L1-02 |
| the DNS record is in no revocation step | capability | INE-L1-05 |
| the CLI says "unknown" where the Desk says "revoked"; "verified kid=<stolen kid>"; "revoked by its holder" about keys nobody revoked | wrong output | INE-L1-03, INE-L1-07, INE-L1-01 |

Ines, L1: "there is no `--help`, so on the bad day the only thing that tells me which side a command belongs to is a
table in a 500-line document." L2: "the documentation is right and the command in your hand at 7 a.m. is the only thing
that is not."

### Priya Raman, agency buyer (twenty minutes to decide)

| Stop | Class | Findings |
| --- | --- | --- |
| the README taken literally fails from the site folder, and inside the clone it "initialises" Plumbline's own Desk | navigation, wrong output | PRI-L1-13 |
| the portfolio scan is a script called "ecosystem", absent from the README's "Use it", https-only | navigation, capability | PRI-L1-11 |
| `watch --url` on an http staging address does not mention `--allow-local`; a clean watch prints only a rate-limit line | wording | PRI-L2-4 |
| her first real result on a healthy site reads "gate unavailable" | wrong output | PRI-L1-01 |

She still reached a first real result in 8 to 11 minutes (criterion 1 passed). Priya, L2: "Most of those ten minutes went
on the README sending me to the wrong folder."

### Tomasz Wieczorek, platform engineer

| Stop | Class | Findings |
| --- | --- | --- |
| the "existing lock" pins no seller, and only a test harness can pin a staged seller | capability | TOM-L1-11 |
| the documented-first `watch --init --external` exits having done nothing | wrong output | TOM-L1-05 |
| the pending line says "once it answers" of sellers that answer | wording | TOM-L2-05 |
| the JSON's shape is in prose and `types.ts` only; no reason codes | capability | TOM-L1-07 |

Tomasz, L2: "The 'existing lock' pinned none of my sellers, and the only way to pin them was a test harness the product
doesn't ship."

### The count

| Class | Marta | Dev | Ines | Priya | Tomasz | All |
| --- | --- | --- | --- | --- | --- | --- |
| wording | 6 (S1, S2, S4, S6, S7, S9) | 0 | 0 | 1 | 1 | 8 |
| navigation | 2 (S5, S6) | 2 | 2 | 2 | 0 | 8 |
| capability | 3 (S1, S4, S8) | 1 | 3 | 1 | 2 | 10 |
| wrong output | 4 (S3, S7, S9, S10) | 2 | 1 (three sentences) | 2 | 1 | 10 |

(A stop with two classes is counted in both.) Two things follow. Wrong output is as common as any other class and holds
every decisive stop (Marta's S3, Dev's CRLF, Ines's "unknown", Priya's healthy-as-unavailable, Tomasz's silent flag).
And wording stops belong almost entirely to the one non-technical Character: for the four technical ones, the getting-in
problem is navigation (help, roles, the README) and capability (rehearsal), not vocabulary.

## The candidate techniques

Judged against the registry's golden paths (guided-tours, wizard-flows, agent-host-experience) and this product's law:
the vendored runtime is copy-do-not-change, the Desk is a signed artifact (every change needs the owner's relock and
re-sign), the third state is never folded, and a stranger's words are never repeated.

### (a) A plain-language layer on the existing sentences and on the issue and PR bodies

What: one sentence in the reader's words before the technical table: what happened, to which page, whether it matters,
who acts, what to forward. Hashes off the default view; each label explained where it appears.

Removes: Marta's S1, S2, S4 (with a "forward this to whoever maintains your assistant" line), S7's wording, S9's
wording; Priya's "unavailable" headline once UAT-9 gives it a true sentence; Ines's incident-note stops once UAT-8 makes
the sentences true.

Cannot remove: S3, S10 and every other wrong-output stop (it would translate them faithfully); S5 and S8; the developer
cycle per edit (MAR-L1-07); the missing rehearsal.

Cost: M. Depends on: UAT-1, UAT-2, UAT-7, UAT-8, UAT-9 (the sentences must be true), and UAT-17 (closed reason codes), so
the plain sentence is generated from the same code as the technical one. One authority per vocabulary is the rule both
`agent-host-experience/journey-shaped-tool-surface` and `signed-artifacts/verification-ux` state: a second,
hand-written vocabulary drifts the first time a finding changes, and Tomasz quotes the technical sentences in policy
("the same situation must produce the same words every time"), so they stay, below the plain line.

Verdict: **build, as step 3** (UAT-29), gated by MC-6.

### (b) A guided tour of the Desk

What: in-product coaching that spotlights the Desk's real controls (guided-tours).

The golden path's own boundary decides it: "A tour teaches: it transfers a mental model of surfaces that already work
without it." Today the drift view says the wrong thing on Marta's page (S3) and labels her signed lock "unsigned" (S7);
a spotlight on those is the product's own chrome vouching for a false sentence, the medium's worst failure ("a tour
pointing at a moved element is worse than no tour"). A tour also cannot reach her: nothing links her to the Desk (S5).
Her use is about eight readings a year; per-user completion tracking (`tour-lifecycle`) means she would see it once.
The Desk is signed, so every tour content change is an owner relock and re-sign; the assistant panel and the consent
card are the vendored runtime's, which cannot carry anchors.

Removes: part of S6 (orientation on the landing). Cannot remove: anything decisive.

Verdict: **decline now** (DC-2, `guided-tours/tour-lifecycle`). Evidence that would reopen it: a J1 walk after UAT-1,
UAT-7 and UAT-29, in which Marta reaches the Desk by the link and then gets lost inside it.

### (c) A wizard, for the publisher's setup or for the bad-day key procedure

What: a staged commitment with dependent steps, one review and one commit (wizard-flows).

- **Publisher setup.** The steps do depend on each other (which pages ground which facts, then a preview of what will be
  watched, then the PR loop, which depends on whether there is a key), and the golden path's commit-boundary discipline
  ("the accumulated draft is shown whole before the commit") is exactly what would have caught S3 at setup: Marta's
  walker found "the only place that gap can be caught early is Jonas's setup". But Dev's bar is "one command and one
  workflow file", in CI as well as at a terminal, and an interactive flow breaks it. The commit-boundary idea is taken
  without the wizard: `init` and `--relock` print the watched and unwatched facts before (or as) they write (UAT-1).
- **The bad-day key procedure.** Here the shape is a genuine wizard: revoke, make a new key, publish its record, re-sign,
  replace the DNS record, tell each verifier; dependent steps (the new kid feeds the record and DNS), an irreversible step
  in the middle, and interruption as the normal case ("I am the only one who will be there at 7 a.m. on the bad day"),
  so the golden path's snapshot-and-resume rule applies ("state lives where the side effects live"). The evidence for the
  need: the wrong order cost Ines a third key, a second call to the pharmacy and about 25 minutes (INE-L1-02); 4 of her
  16 runbook lines were wrong or unanswerable (INE-L1-05, the incident-note lines). The cheaper fix for the same stops is
  UAT-15 (warnings at the moment of the mistake) plus UAT-8 (true sentences). `ai-driven-elicitation` does not apply:
  the questions are few and fixed; nothing is to be elicited.

Removes (bad-day wizard): the wrong order, the DNS gap, "which side is this command", the runbook-writing time. Cannot
remove: the verdict sentences (UAT-8 does). Cost: L (a durable, resumable flow in the clinic's folder, a review step,
partial-failure reporting). Depends on: UAT-8 and UAT-15.

Verdict: **no setup wizard; the bad-day wizard deferred** behind UAT-15. Evidence that would decide it: a recertified J3
in which Ines, with the guardrails in place, still takes the wrong order or misses the DNS step. If built, it must keep
guardrail 3 (nothing irreversible without her confirmation) and the golden path's commit-boundary.

### (d) An assistant-led experience inside the Desk

What: the Desk's own assistant leading the owner through her reading or her setup.

Blocked twice. The Desk's assistant runs inside the vendored runtime, which takes its model client and key from its own
settings and may not be edited, so it cannot answer without the visitor's own model key; for Marta that is a hard stop by
her own rule ("Having to bring my own 'API key' to ask a question", S8). And its evidence today is the false all-clear:
the live `read_drift` result handed to the model carries "all 5 facts ... still on it" and nothing about which facts are
watched (grounding 5 of 6; MAR-L1-12). If it were used for setup elicitation, `wizard-flows/ai-driven-elicitation` would
apply: the generator proposes, the flow owns structure and completion; the model never declares the step done.

Removes: S8's comprehension half, for someone who brings a key. Cannot remove: S8 for Marta, S3, S10.

Verdict: **decline now** (DC-3). After UAT-1 and UAT-31 (the tool result carries what the lock watches), it is a fair
optional path for a developer who brings a key, not for the owner.

### (e) The product as a capability the user's own assistant operates (agent-host)

What: the user's own general assistant or coding agent calls the product's operations and explains the result. The
golden path (`agent-host-experience`): every operation completes as text with a structured result; operations are
journeys, not endpoints; one state read names the next moves; refusals carry a closed code; irreversible acts complete in
the product's own consent surface, and secrets never pass through anything the model can read.

Where the product is: the CLI already has `--json` on most commands, but its JSON has no reason codes, polymorphic
fields, a rotation hint only in text and an exit code 2 for a policy verdict (TOM-L1-07, TOM-L1-09, TOM-L1-02). The Desk
exposes six `website_*` operations to its own assistant and a bridge to other agentic sites, but `site/agent-mcp.json`
says `"available": false` (a static bundle has no MCP facade). The journeys, in the users' words: "is my site still
telling guests the truth?" (Marta), "what changed in my partner, and should I accept it?" (Dev), "which of my twelve
sites need attention?" (Priya), "is each seller still who we pinned?" (Tomasz). Ines's "my key was stolen" is a journey
whose irreversible steps must come home to the CLI or the Desk (`depth-handoff`).

Removes: for Marta, S8 (her assistant, her key, already paid for) and much of the wording (her assistant explains);
for the technical four, the JSON gap. Cannot remove: S3 and every wrong-output stop (the assistant repeats them as
evidence), and S5 if Marta has no assistant the product can reach.

Cost: the text-and-JSON completeness is UAT-17 (L, a wire change) plus a state read that names the next moves (M). An MCP
facade over four or five journeys is new product surface (M to L), held to `safeFetch`, and nothing in it may take a
private key. Depends on: the correctness items and UAT-17.

Verdict: **build the text-and-JSON completeness as step 4; decide the MCP facade on evidence.** The run has no evidence
that an owner like Marta uses a general assistant for her site; her Character file says only that she will not open a
terminal. A J6 journey (below) is the evidence that would decide it.

### (f) Role-based entry points: publisher, verifier, owner, agency

What: `--help` grouped by role, a README with one entry per role and one working directory per block, a Desk landing
that starts from the visitor's address and question rather than another site's verdict.

Removes: INE-L1-06, DEV-L1-09, PRI-L1-13, PRI-L1-11 (the scan named in her words), Marta's S6 and, with a link that
carries her address (UAT-29), S5. Cannot remove: any wrong output.

Cost: S to M (UAT-28; the Desk landing within UAT-29). Depends on: nothing for the CLI and README, which add no claim; the
Desk landing should follow UAT-1 and UAT-7, because it leads straight into the drift result. It follows the guided-tours
idea of a path in the order a person meets the product (`tour-path-curriculum`) without the tour.

Verdict: **build, step 2, in parallel with step 1.**

## Recommended sequence

| Step | What | Backlog | Why this position |
| --- | --- | --- | --- |
| 1 | Make what the product says true: grounding, accept and relock, CLI = Desk verdicts, incident-note sentences, partly-checked words, the alert loop | UAT-1 to UAT-9 (and UAT-11, UAT-12) | Every decisive stop is wrong output; guidance on top of it amplifies it (MC-6) |
| 2 | A door per role: help, README, remedies that run; the Desk landing after step 1 | UAT-28 (MC-3); landing in UAT-29 | Cheap, adds no claim, removes most technical stops; runs in parallel with step 1 |
| 3 | A plain-language owner layer, generated from the same codes, with a link that carries her address | UAT-17, then UAT-29, UAT-31 | Needs true sentences (step 1) and one vocabulary (UAT-17) |
| 4 | Every journey completes as text and JSON, with a state read that names the next moves; then decide on an MCP facade | UAT-17 plus a status read; the facade only on J6's evidence | The one assistant-led path that avoids the key wall and the runtime law |
| 5 | The bad day: guardrails first; a wizard only if a recertified J3 still goes wrong | UAT-15, UAT-8; a wizard later | Rare, high-stakes; the cheaper fix may be enough |
| not now | A Desk tour; an assistant inside the Desk | DC-2, DC-3 | A tour teaches working surfaces; the Desk assistant needs the visitor's key and today's evidence is false |

**What must be true before guidance is worth building:** on the unchanged world fixtures, (1) J1's `raise-price` and
`cosmetic-edit` read differently, and no accept or merge can produce a clean close over a stale fact or a broken
signature; (2) J3's and J5's verdicts read the same on the CLI and the Desk for the same trust list, and no sentence an
incident note would quote is false; (3) J4's healthy site reads "checked and passing by the checkers that ran" and its
down site reads "down". Each is a recertify at L2 (MC-6).

## Open questions for the owner

1. **Who is the product's user for a site like Larch House: the owner, or the owner through her developer?** Marta never
   onboards and needs Jonas to close every alert (MAR-L1-07). If owners are a segment in their own right, they need a
   channel that is not a GitHub repository they opened twice (MAR-L1-08: e-mail, or a Desk subscription), and an
   owner-safe way to acknowledge a change that lost no fact. Both are new scope.
2. **May the publisher's own checkout name the stale literal** ("your rooms page says 95, the assistant still says 89")?
   The rule against repeating a site's own words was written for strangers' sites (`docs/roadmap.md`); the checkout watch
   reads the publisher's own files (MAR-L1-05). UAT-1 names the kind of fact meanwhile.
3. **Which Desk views are for a non-technical reader?** The run's one opposing verdict: Ines found the verify view more
   honest than the CLI ("I meant the Desk as the thing I show the director. It turned out to be the more honest of the
   two"), Priya found the check view and the badge not fit for clients ("the badge and the Desk are not for clients"), and
   Tomasz found the drift label tells every shopper a signed lock is unsigned. Proposed answer, for the owner to confirm:
   verify and drift are owner-facing once UAT-7, UAT-8 and UAT-1 recertify; check is not until UAT-9 and UAT-11; the badge
   is not until UAT-10.
4. **Is an MCP facade in scope for the challenge?** `site/agent-mcp.json` says a static bundle cannot host one.
5. **The Desk's landing example** (another site's large green "Passed") is labelled honestly and read first by a
   first-time owner (MAR-L2-05). Keep it as a demonstration, or start from the visitor's own address?

## What a future UAT journey must show for each step to count as done

| Step | Journey and arm | Passes when |
| --- | --- | --- |
| 1 | Recertify J1 (unchanged larch-house), J3 (Ines's 15-case table), J4 (scan and badge), J5 (inventory and relocks) at L2 | Marta's criteria 3 and 5, Ines's 7, Priya's 5 and 6, Tomasz's 3, 4 and 5 pass |
| 2 | A cold start by Dev, Ines and Priya from the README and `--help` only | Ines's criterion 1 passes; Priya reaches a first real result with no wrong-folder detour; every printed command runs as printed (MC-3) |
| 3 | J1 at L2, after `raise-price`, from the notification | Marta's criteria 2, 4, 6 and 7 pass; the issue's out-of-vocabulary terms that are not explained where they appear drop from 23 to none |
| 4 | A new journey J6, "ask my own assistant": a scripted general assistant (a deterministic stand-in, never the vendored runtime) operating the CLI's text and JSON, or the facade, for Marta and for Tomasz | it answers "does my chat still say 89?" correctly from text alone; Tomasz's inventory fills 25 of 25 cells from fields; signing and revoking are refused in-host and handed back to the product |
| 5 | J3's wrong-order arm; if a wizard is built, J3 walked through it with an interruption after the revoke | the command warns at the moment of the mistake; with a wizard, the flow resumes from the revoke and Ines's incident note is pasted from the output unedited |

## Constraints any of this must keep

The backlog's guardrails, of which four bind guidance most: nothing is trusted, adopted or accepted without a person
(no assistant, wizard or one-click accept may remove a confirmation); the third state is never shown greener; a
stranger's words are never repeated; the Desk keeps working with no key and no install. And the law: nothing in
`site/runtime/`; every Desk change is listed for the owner's relock and re-sign.
