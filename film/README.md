# The demo film: "Is it still what it claims to be?"

The submission film for the Open Agentic Web Challenge: 2 to 3 minutes, three examples that span what Plumbline does,
from the smallest site owner to the agent that writes your code. The method is the registry's live-system demo film
(`ai-registry/knowledge/media-generation/production-ops/live-system-demo-film`) and its kit
(`ai-registry/skills/demo-film`): the voice is measured before anything is recorded, the capture drives the real product
and checks every claim it shows, and the cut is a command.

- **`film.json`** is the script and the one source for the lines, the beat order and each beat's capture. This page is
  its human version: the picture, what is real, how to stage it. If they disagree, `film.json` wins for the words and
  this page wins for the boundary.
- **`walk/walk.mjs`** is the provisional round: a dry walk of every capture beat, with stills instead of video, that
  spends nothing. `node film/walk/walk.mjs` (after `npm run build && npm run build:site`) writes
  `film/out/walk/contact.html`: every beat's still, its line, its estimated hold and the checks that held.
- **`walk/walk.mjs --take`** records the same beats as video and joins each beat's window into `film/take/take.mp4`
  with `film/take/take.json`, the kit's Take.
- **`local/`** holds the film's motion heroes (the kit's `@film/local`): the intro, the three examples and each
  example's concept opener. See [Motion](#motion).
- **`stage/agent-repo/`** is the third example's stage: a small agent repository with one stdio MCP server whose tools
  the walk changes.

## The idea

One sentence for someone who has never heard of the Open Agentic Web: an agentic website publishes an agent that runs
in every visitor's browser, and once it ships nobody checks it again. Plumbline is the layer after it ships. The film
proves that with three examples. Each one fails in a different way and ends on an honest verdict:

| Example | What goes wrong | What Plumbline shows | Surface |
|---|---|---|---|
| **Larch House**, a small guesthouse | the facts drift: the page's price changes and the agent still quotes the old one | the watch reads the page against the lock: "your assistant may still be telling visitors €89 where the page now says €95"; the Desk's own assistant says the same in answer to the owner | the Desk (Read drift, its assistant), one CLI command |
| **Northgate Clinic** | who published this? a copycat serves the clinic's agent, changed to ask for NHS numbers, signed with the clinic's stolen key | sign with the file list and fingerprints; unverifiable, then trusted, then verified; the copy refused for the address it names, and what it changed, sentence by sentence; one edited file: invalid, tampered | the Desk (Sign, Verify), `plumbline diff` |
| **Harbour Notes**, a team's coding agent | the agent's own tools change: a server update hides an instruction in a tool description | the guard hides the tool and refuses the call; the pull request's check fails and the sentence sits in the diff | terminal |

The open is the Desk checking a real public site live (Agent Atlas' own site: validator pass, Atlas pass, Customs no
verdict, so the verdict is unavailable, never a quiet pass). The close returns to the Desk.

The words follow one rule: a first-time viewer understands every line. "Grounding", "lock", "peer", "kid" and "MCP" stay
off the voice track.

## What is real, staged or added (said on screen)

| Layer | In the film |
|---|---|
| Real, live | The Desk as deployed from this repository; the open's gate on Agent Atlas' public site, with Agent Atlas' live answer and Agent Customs' published receipts; the CLI as built from this commit. |
| Real product, staged world | The guesthouse, the clinic, the copycat and the pharmacy are the UAT fixture worlds (`uat/fixtures/`, played by `uat/driver/world.mjs up <world> --names`): fictional businesses served on this machine at `<name>.localhost` addresses, with throwaway keys made at `up`. The film's guesthouse links no partner (the world's `solo` act). Every verdict on them is the real product's. Label: "fictional sites, served locally". |
| Scripted | The assistant's answer in the guesthouse chapter. The Desk's real runtime runs the turn and calls the real `read_drift` tool; the model's two replies (call the tool, then answer) come from a script the recorder serves at the router's address, and the answer's values are read from the tool's own result. The recorder covers the runtime's model badge with its own label, "SCRIPTED MODEL · not a live LLM". The owner decided on 2026-11-23 to keep it scripted at this stage; a live turn on the owner's own key would take the label off. |
| Staged | The coding agent's repository and its notes server (`stage/agent-repo/`); the server's poisoned update is a scripted edit of its tool list. The agent host is `walk/host.mjs`, a minimal host that lists and calls tools the way a real host does. Label: "staged tool update". |
| Added by the film | The intro, the concept diagrams that open each example, titles, the end card, the scripted-model label. A diagram draws an idea; the page after it is the evidence. Names in a diagram are the stage's real ones (the clinic's files, the stage repository's tools, the lock's file name), and fingerprints are drawn as bars, never as digits. No figure on screen is typed by hand. |

No key material is ever in frame. The keys are throwaway, and the Sign dialog shows only the public key id.

## Run of show (the take and the motion pass, 2026-11-24)

20 beats, 2:32 measured (Brian, `eleven_multilingual_v2`), against a 2:59 cap.

| Chapter | Beats | Picture |
|---|---|---|
| Intro | intro | IntroHero: the plumb line drops and settles, the name, then signed, checked, watched as they are said |
| Open | cold, gate, spectrum | Desk home; the live gate (unavailable); ExamplesHero: the three examples as cards, each named as it is said |
| Guesthouse | larch-intro to larch-cost | GuesthouseConcept (the page and its agent say €89; the lock holds the fact), then the rooms page, €95, Read drift, the assistant, the one command |
| Clinic | clinic-sign to clinic-limit | ClinicConcept (three files, a fingerprint each, the clinic's key, a signature for its own address), then the Sign dialog, unverifiable, trusted, the copy refused, its diff, tampered |
| Agent | agent-lock to agent-review | AgentConcept (instructions, settings and tools pinned into `plumbline.agent.lock.json`), then the lock, the poisoned update, the guard, the pull request |
| Close | close | the three examples again, each checked; the Desk; the end card, held 2.5 s after the last word |

## The demo-led backlog, round one: resolved

The first walk turned up eleven items. All are resolved. Seven changed the product for every user, and four changed
only the film's stage.

| # | Item | Resolution |
|---|---|---|
| 1 | The stale fact did not say which value moved | Product, `9ea9427`: a stale fact carries `facts` (was, now) and says "the network says €89 where the page now says €95"; the owner's line on the Desk, the drift issue and the relock pull request names both. The values are Plumbline's own normalised tokens, never prose or an e-mail address: the one documented exception to "a finding never quotes the site". `b28cb75` passes them to the Desk's assistant. |
| 2 | The film never showed the Desk's assistant | Stage plus a product fix, `434dc8b`: "Save and start" reloaded the page and dropped the addresses the visitor chose, so a visitor who read a site's drift, gave a key and asked about it was refused. The film's beat runs on a scripted model (see the boundary above). |
| 3 | No clean "before" frame | Stage, `408a09b`: the world's `solo` act unlinks the partner; a reading before the change says nothing differs. |
| 4 | The copycat's change was invisible | Product, `e197be5`: `plumbline diff` of two local network files prints each changed agent's removed and added sentences. |
| 5 | `127.0.0.1:4300` means nothing to a viewer | Product, `6334dda`: names under `.localhost` are loopback names for http origins, the Desk's fetches and its CSP, and `--allow-local`. Where a name resolves is still checked. safeFetch connects over IPv4 first. The world takes `--names`. |
| 6 | Terminal beats were walls of text | Stage: `plumbline` on PATH for the take (the short `plumbline guard` entry, no "not on PATH" lines), the guard in approved mode (no locked-mode notice), and fewer commands per still. |
| 7 | "fail: 0 changes to block, 1 warning" | Product, `2df0b46`: "State: fail: 1 warning. Any finding fails the check." |
| 8 | `audit` said BROKEN on the documented first run | Product, `d1b6c4e`: a real bug. The README's quick start relocks before the first commit, so the first committed lock names one git never saw. It now reads as an unseen link, listed but not counted under the default rule, and still counted under `--all`. |
| 9 | "Approved by a named person" needed a hand edit | Product, `828f6d7`: `agent init --wrap --require approved` and `agent wrap --require approved`. |
| 10 | The guesthouse page was plain at 1920 | Stage, `b9d3380`: the fixture's stylesheet is redrawn; no fact changed. |
| 11 | A still caught a view mid-animation | Stage: a still waits until no finite animation is running. |

`44d33b1` moves the templates' pinned Action to `b28cb75`, so these fixes reach copied workflows.

**Before the next deploy, the owner relocks and re-signs the Desk**: its signed files `desk.js`, `fetcher.js` and
`site-actions.js` changed in this round.

## Staging, before a take

1. `npm run build && npm run build:site`. The worlds serve this checkout's `site/` and run this checkout's CLI.
2. Playwright as `uat/driver/drive-script.mjs` resolves it (`uat/env.md`, Browser) and ffmpeg on PATH.
3. No world left up from a previous walk (`node uat/driver/world.mjs status <world>`). The walk brings each world up
   fresh and takes it down at the end (`--keep` leaves it up for a look).
4. The open needs the network: it asks the real Agent Atlas about its own public site and reads Agent Customs' receipts.
   Agent Customs answers "no receipt" for Atlas' site today; if a receipt appears, the open's verdict turns pass and the
   gate line must change (the walk's check fails first).

## Motion

The film renders at the kit's `overlay` balance: every moment is tier 1. Motion opens the film and each example, then
gives way to the product. A concept covers the first seconds of its example's first beat and lifts away to the real page
as the narration reaches what the page shows.

| Moment | Beat | Component |
|---|---|---|
| intro-hero | intro | `local/IntroHero.tsx` |
| examples, reprise | spectrum, close | `local/ExamplesHero.tsx` |
| larch-concept, clinic-concept, agent-concept | each example's first beat | `local/Concepts.tsx` |
| cold-in, larch-in, clinic-in, agent-in, close-in | chapter turns | the kit's ZoomThrough and MaskWipe |
| end | close | the kit's EndCard |

Cue times in the moments' props are milliseconds from the beat's start, read from the measured clips' pauses
(`ffmpeg -i audio/<beat>.mp3 -af silencedetect=noise=-35dB:d=0.15 -f null -`, less the chapter-turn lead of about
330 ms). Re-narrating a line moves its pauses: re-read them and move the cues.

The StyleLock's fonts are single family names. The kit quotes the whole value as one family, so a CSS list
(`Iowan Old Style, Palatino Linotype, ...`) silently fell back to a sans.

Render (on Windows ARM64 with x64 Node under emulation, as for the first cut):

```sh
node <kit>/tools/check.mjs film --balance overlay
node <kit>/tools/render.mjs film --balance overlay --stills 2.5,30,33.5,66.6,118.9,149.5   # look before a full render
node <kit>/tools/render.mjs film --balance overlay --out film/out/render/plumbline-overlay.mp4
```

## Next rounds

1. **Owner review of the motion cut.** The intro, the concept openers and the close.
2. **Music:** a quiet bed under the voice (`music.mjs`, one cue from intro to close, gain about -20 dB), made last, to
   the final length.
3. **Sandwich and led renders** only if the owner wants to compare: every moment is tier 1 today, so they would match
   overlay until tier 2 and 3 moments exist.
