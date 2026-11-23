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
- **`stage/agent-repo/`** is the third example's stage: a small agent repository with one stdio MCP server whose tools
  the walk changes.

## The idea

One sentence for someone who has never heard of the Open Agentic Web: an agentic website publishes an agent that runs
in every visitor's browser, and once it ships nobody checks it again. Plumbline is the layer after it ships. The film
proves that with three examples. Each one fails in a different way and ends on an honest verdict:

| Example | What goes wrong | What Plumbline shows | Surface |
|---|---|---|---|
| **Larch House**, a small guesthouse | the facts drift: the page's price changes and the agent still quotes the old one | the watch reads the page against the lock: "your assistant may still be telling visitors an old price" | the Desk (Read drift), one CLI command |
| **Northgate Clinic** | who published this? a copycat serves the clinic's agent, changed to ask for NHS numbers, signed with the clinic's stolen key | sign with the file list and fingerprints; unverifiable, then trusted, then verified; the copy refused for the address it names; one edited file: invalid, tampered | the Desk (Sign, Verify) |
| **Harbour Notes**, a team's coding agent | the agent's own tools change: a server update hides an instruction in a tool description | the guard hides the tool and refuses the call; the pull request's check fails and the sentence sits in the diff | terminal |

The open is the Desk checking a real public site live (Agent Atlas' own site: validator pass, Atlas pass, Customs no
verdict, so the verdict is unavailable, never a quiet pass). The close returns to the Desk.

The words follow one rule: a first-time viewer understands every line. "Grounding", "lock", "peer", "kid" and "MCP" stay
off the voice track.

## What is real, staged or added (said on screen)

| Layer | In the film |
|---|---|
| Real, live | The Desk as deployed from this repository; the open's gate on Agent Atlas' public site, with Agent Atlas' live answer and Agent Customs' published receipts; the CLI as built from this commit. |
| Real product, staged world | The guesthouse, the clinic, the copycat and the pharmacy are the UAT fixture worlds (`uat/fixtures/`, played by `uat/driver/world.mjs`): fictional businesses served on this machine, with throwaway keys made at `up`. Every verdict on them is the real product's. Label: "fictional sites, served locally". |
| Staged | The coding agent's repository and its notes server (`stage/agent-repo/`); the server's poisoned update is a scripted edit of its tool list. The agent host is `walk/host.mjs`, a minimal host that lists and calls tools the way a real host does. Label: "staged tool update". |
| Added by the film | Titles, captions, zooms. No figure on screen is typed by hand. |

No key material is ever in frame. The keys are throwaway, and the Sign dialog shows only the public key id.

## Run of show (provisional round, 2026-11-23)

17 beats, estimated 2:20 against a 2:59 cap. The estimate is the kit's (15 characters a second, plus the breath and each
beat's settle), so narration is not measured yet. The walk passed every check: 16 captures, 0 failed assertions.

| Chapter | Beats | Estimated |
|---|---|---|
| Open | cold (Desk home), gate (live, unavailable), spectrum (title plate) | 0:24 |
| Guesthouse | rooms page at €89, at €95, Read drift, the one command | 0:27 |
| Clinic | Sign dialog, unverifiable, trusted then verified, the copy refused, tampered | 0:49 |
| Agent | locked and approved, the poisoned update, the guard refuses, the pull request | 0:32 |
| Close | Desk home | 0:09 |

358 words in all. Narration speed varies about twofold between narrators, so expect the measured length to move by
±20 s.

## What the walk taught: the demo-led backlog

The walk turned up the items below. Each is ranked by how much the film gains, then by cost. Items marked **stage**
change only the film's world or script. Items marked **product** change what users get too, which is the point of
demo-led work.

| # | Item | Seen in | Kind | Film gain |
|---|---|---|---|---|
| 1 | **Name the fact that moved.** The finding says "1 of 7 facts ... (1 price)"; the viewer should read "the double room at €89 is no longer on rooms.html; the agent still says €89". Facts are typed values Plumbline extracts (prices, times, phones), not a stranger's prose, but the roadmap rule "a site's own words are never copied into a finding" needs an owner call: at least for the owner's own checkout (`watch --root`). | larch-drift | product | high: the guesthouse story lands in one frame |
| 2 | **Show the Desk's assistant.** The film never shows the agentic part: the Desk is an agentic website whose assistant runs each tool. One beat where the visitor asks the assistant to read the guesthouse's drift, and it runs the tool, shows the spec in use. It needs a model on camera: the visitor's own key on hosted Otari, or the scripted model (`site/tests/scripted_model.mjs`) labelled as scripted. | (absent) | product + stage | high: judges score use of the spec |
| 3 | **A clean baseline.** The guesthouse world's bike peer is pending (http on loopback), so every reading carries a peer warning, `init` exits 1, and the drift shows "2 findings" where the story has one. Capture the peer in the world, or drop the link for the film. | larch-init, larch-drift | stage | high: no "before" frame is green today |
| 4 | **Show what the copycat changed.** The strongest fact (the copy asks for the NHS number) appears nowhere on screen. A beat with `plumbline diff` of the clinic's network against the copy's would show it with no product change. Later, the Desk's Verify could compare the copy against the version you trust. | clinic-mirror | stage, then product | high |
| 5 | **Readable addresses.** `http://127.0.0.1:4300` against `:4301` means nothing to a viewer. `*.localhost` names (RFC 6761: loopback) in the worlds would let the film read `northgate-clinic.localhost` against `northgate-copy.localhost`. The Desk's address rule allows only `localhost` and `127.0.0.1` exactly, so this touches the fetch rules. Investigate Node's resolution of `*.localhost` on Windows before promising it. | every Desk beat | product (fetch rule) | medium-high |
| 6 | **Terminal beats are walls of text.** `agent init --wrap` prints 10 lines, including "plumbline is not on PATH" (a stage artifact: put a `plumbline` shim on PATH for the take). The guard prints its `--require locked` notice on every start. Either a terse mode for the beats or zooms on 2 to 3 lines per beat. | agent-locked, agent-guarded | stage + product | medium |
| 7 | **"State: fail: 0 changes to block, 1 warning."** reads as a contradiction on camera. Say what failed: "fail: 1 tool changed since the approved lock". | agent-review | product (wording) | medium |
| 8 | **`audit` says "chain BROKEN" on the first approved version** of a fresh repository whose lock was relocked before its first commit (its `previous` names a lock git never saw). This may be a real bug. Audit is the closing proof for agent change control, so it cannot show BROKEN on a clean story. | agent-review notes | product (bug?) | medium; must fix before audit appears on screen |
| 9 | **`agent wrap --require approved`.** The film's claim is "approved by a named person". The guard enforces that only with `--require approved`, which today is a hand edit of `.mcp.json`. | agent-locked | product | medium |
| 10 | **The guesthouse page is small and plain at 1920.** Restyle the fixture (larger type, a drawn header) or zoom on the price table. | larch-rooms-* | stage | low-medium |
| 11 | **View transitions in a still.** One capture caught the compass mid-animation over the title. The take must start a page-change beat once the view is still (`capture.from: "ready"`). | (hand walk) | stage | low |

The backlog is the bridge to demo-led development. Take items 1 to 4 first, walk again, compare the contact sheets,
then measure the narration.

## Staging, before a take

1. `npm run build && npm run build:site`. The worlds serve this checkout's `site/` and run this checkout's CLI.
2. Playwright as `uat/driver/drive-script.mjs` resolves it (`uat/env.md`, Browser) and ffmpeg on PATH.
3. No world left up from a previous walk (`node uat/driver/world.mjs status <world>`). The walk brings each world up
   fresh and takes it down at the end (`--keep` leaves it up for a look).
4. The open needs the network: it asks the real Agent Atlas about its own public site and reads Agent Customs' receipts.
   Agent Customs answers "no receipt" for Atlas' site today; if a receipt appears, the open's verdict turns pass and the
   gate line must change (the walk's check fails first).

## Next rounds

1. **Owner review of the contact sheet.** Approve the three examples and the order, or change them. Approve the lines
   with their stills beside them.
2. **Demo-led round:** the backlog items the owner picks, then walk again.
3. **Narration:** audition voices on two real lines (`narrator-chosen-by-audition`). Then `narrate`, which measures
   every clip. The take paces to the measured holds.
4. **The take:** the walk becomes the capture adapter (same beats, video instead of stills, with per-beat sync marks),
   writing `film/take/take.json` for the kit's `check` and `render`.
