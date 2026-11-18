# UAT overlay: Plumbline

Simulated user acceptance testing with the `uat` skill (ai-registry `skills/uat`, v1.11.2). The skill is the engine;
this folder is everything specific to Plumbline. It is evaluative testing: can a real person finish their job, and is
the result good enough for them? It is a deliberate periodic pass, never a per-commit gate.

Five Characters each own one journey, and each journey plays out in a fictional world of fixture sites served on this
machine (`uat/fixtures/`, started by `uat/driver/world.mjs`; see `env.md`). Together they are the suite to re-run
before a release and after any change to the surfaces they touch.

| Character | Role | Journey | World |
| --- | --- | --- | --- |
| [Marta Hollis](characters/marta-hollis.md) | guesthouse owner, not technical | [the price changed](journeys/j1-price-changed.md) | `larch-house` |
| [Dev Okafor](characters/dev-okafor.md) | sole web developer, travel agency | [the partner changed overnight](journeys/j2-partner-changed.md) | `meridian-trips` |
| [Ines Baptista](characters/ines-baptista.md) | IT contractor for a clinic and a pharmacy | [the stolen key](journeys/j3-stolen-key.md) | `northgate-clinic` |
| [Priya Raman](characters/priya-raman.md) | technical director of a web agency, the buyer | [twelve client sites](journeys/j4-twelve-clients.md) | `tallow-finch` |
| [Tomasz Wieczorek](characters/tomasz-wieczorek.md) | platform engineer, craft marketplace | [vetting the sellers](journeys/j5-vetting-sellers.md) | `kiln-row` |

## Layout

```
uat/
  characters/*.md     durable users: job, expectations, pet peeves, motivation in minutes, senior bar, scored criteria
  journeys/*.md       goals and a user's definition of done, never step scripts
  rubric.md           the seven dimensions, impact scoring, finding types, severity legend
  env.md              how to reach a known start state; worlds, ports, keys, what cannot be exercised here
  accepted-gaps.md    known and accepted issues that a run does not raise again
  fixtures/           the five worlds (tracked: an instrument one machine can run validates nothing)
  driver/             world.mjs (start a world, play an act), drive-script.mjs (the browser, for the Desk),
                      local-cli.mjs (the test harness: watch and scan with allowLocal; Atlas and Customs stand-ins),
                      run-action.mjs + gh-stub.mjs (the Action's watch path against a local remote),
                      collect-findings.mjs (builds findings.json from the reports' ## Findings blocks)
  runs/<id>/          per-Character reports, reconciliation--sweep.md, findings.json, SUMMARY.md (shots/ is git-ignored)
```

## How to run

`/uat run` for the full pass (L1 over the code, then L2 live against the worlds), `/uat run --l1` for the cheap sweep,
`/uat recertify` after fixes, `/uat drain` after every run. No journey here is conversational, so there is no LC level;
the Desk's assistant is an AI surface inside J1 and is judged at L1 and, when a model key is available, at L2.

## Drain homes

- Analysis document: `docs/product/uat-insights/<run-id>.md`
- Backlog: `docs/BACKLOG.md`
- Concept documents: `docs/product/concepts/`

## Character template

Front matter: `name`, `role`, `segment`, `world`, `journeys`, `references`. Sections: Background and voice · Job to be
done · What good looks like · Pet peeves · Motivation (minutes without the product, minutes with it) · Senior-quality
bar · Surface binding · Scored acceptance criteria (pass or fail, applied identically every run).

## Skill improvement log

(One dated line per observation that would change how a later run behaves.)

- 2026-11-18 (run first-five): two browser checks passed vacuously (`/89/` inside a hash, `/sign/` inside "unsigned");
  use `expectMatch` for every text check, anchor the pattern, and read the matched context of every PASS before citing it.
- 2026-11-18: L1 booked a strength (MAR-L1-15) that L2 refuted, and missed the run's only blocker, because it probed a
  page it wrote itself; an L1 walker's executable probe runs on the world's tracked fixture bytes, and a fixture is
  never changed to make the product pass.
- 2026-11-18: the harness scan sent twelve loopback addresses to the public Agent Atlas; `local-cli.mjs scan` now answers
  Atlas and Customs from recorded responses by default (`--real-atlas`, `--real-customs` opt in), and any new harness
  path that reaches a third party gets a stand-in before it is used in a world.
- 2026-11-18: three L2 arms had to construct acts by hand; when a walker builds an act, the drain adds it to `world.mjs`
  and the fixture README (done: `forgery-own-origin`, `partner-changes-fee`, `seller-back-changed`).
- 2026-11-18: chained and destructive defects were found only at L2 (a push failure masking a re-draft; a real-CLI relock
  wiping a lock); the L1 hand-off names a "second event" arm and a "destructive" arm for each journey that writes state.
- 2026-11-18: the certified PR loop existed only in unpushed commits (the template's pin was not on GitHub); preflight
  whether the code under certification is the code its users fetch by pin or package.
- 2026-11-18: walkers derived severity from rank with different thresholds; `rubric.md` now states them, and lists the
  shared concepts the reconciliation sweep must trace ("accept" and "the unit of a count" gave the sharpest rows).
- 2026-11-18: reusable rigs built inside a run folder (the `gh` stub, the Action runner) are moved into `driver/` by the
  drain as tracked tools, generalised and verified once; the run folder keeps its copies as evidence.
