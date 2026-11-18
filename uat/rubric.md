# Rubric

## Seven dimensions

| Dimension | The question |
| --- | --- |
| completion | Did the Character finish the job, by their own definition of done? |
| effort | How many steps, commands, files and context switches did it take, against what they would accept? |
| clarity | At each step, did they know what to do next and what the output meant, in their own vocabulary? |
| trust | Would they act on what the product said? Did it ever say something greener than it knew? |
| missing | What did they need that is not there at all? |
| time-saved | Minutes saved against the Character's declared way of doing it without the product. Slower is a finding. |
| senior-quality | Is the output at least what this Character would produce as a senior in their role? |

## Cognitive walkthrough, asked at every step

1. Will the Character try to achieve the right thing here? (Do they know this step exists?)
2. Will they notice that the right action is available? (Is it visible where they are looking?)
3. Will they connect the action with what they want? (Is it named in their words?)
4. After acting, will they see progress and understand it? (Does the output say what happened and what is next?)

A "no" is a finding. Getting lost is a finding. A step that only works because the walker read the source is a finding.

## Finding types

`missing-feature | quality-gap | broken-flow | confusion | trust`

## Severity legend (copy verbatim; derive it from impact, never pick it free-hand)

- `blocker`: the Character cannot finish the job.
- `major`: they finish, but only with outside help, a workaround, or by accepting a result they do not trust.
- `minor`: they finish alone, with friction they would mention.
- `polish`: they would notice only if asked.

No other vocabulary (no P0..P4, no high/medium/low as severity).

## Impact

`impact: { frequency, reachability, trust_erosion }`, each `low | med | high`.

- frequency: how often this Character hits it (every run of the job is `high`).
- reachability: can this Character reach the surface at all, given their surface binding? Unreachable is `low` and the
  gating itself may be the real finding.
- trust_erosion: how much it teaches them to doubt the rest of the product.

Rank = frequency x reachability x trust_erosion with low=1, med=2, high=3. Rank work by this number, not by the word.

Severity from rank (added by the drain of run 2026-11-18-first-five, where walkers used different thresholds and two
rank-18 findings were labelled minor): `blocker` only when the Character cannot finish the job (the legend above),
whatever the rank; otherwise `major` at 18 and above, or at 9 and above when trust_erosion is high; `minor` from 4 to
17; `polish` at 3 and below.

## Shared concepts the reconciliation sweep traces (every multi-Character run)

The word for "a checker could not answer" (gate, Action summary, scan, badge, Desk); a peer or card that was not
checked (watch --root, watch --url, Desk, pending, relock); the verdict for an unsigned site and for a revoked key on
every surface (CLI, Desk, pre-load, scan, watch, lock); what "signed" and "unsigned" are said of; one broken signature
across verify, scan, gate, Action and badge; what "clean" means at the watch, the issue, the PR, the scan and the Desk;
what "accept" does (issue, PR, relock, `--drop`, adopt, trust); the unit of every count (facts, agents, hosts, skills,
findings); the date of a check; a signer change. Run 2026-11-18-first-five's rows are REC-1 to REC-13 in
`runs/2026-11-18-first-five/reconciliation--sweep.md`; a later sweep re-traces each and records agreement or mismatch.

## Plumbline's own trust checks (apply to every journey)

- A third state is never shown as a greener one: `unverifiable` is not `verified`, `unavailable` is not `pass`, a lock
  that was not read is not "no drift".
- Whatever was not checked is said to be not checked, in the place the Character is looking.
- A sentence shown to the Character never repeats words a stranger's site chose.
- A verdict says what it proves and what it does not (who published and that nothing changed; never "safe").

A place where the product is honest in a way the Character can see is a **strength**; record it, it is a guardrail.

## Units (shared by every walker; never invent another)

- "command": one entry of the CLI's handler table (`src/cli/index.ts`).
- "Desk view": one hash route of the Desk (`site/README.md`).
- "step": one thing the Character does: a command run, a file edited, a click, a page read, a person asked.
- "decision point": a step where the Character must choose between options the product does not choose for them.

## Grounding sources of the one AI surface (the Desk's assistant)

The shared denominator, 6: (1) the site address the visitor gave, (2) the gate report for it, (3) its drift report,
(4) its signature verdict, (5) the visitor's own trust list, (6) the contents of its lock. Score `grounding n/6` by how
many reach the model through tool results. A Character's extra sources are named additions, not a new denominator.
