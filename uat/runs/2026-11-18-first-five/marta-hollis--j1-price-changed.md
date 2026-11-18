# Marta Hollis x j1-price-changed - L1

## Verdict

**L1-conditional.** The job can be finished on paper: the daily watch catches the price change with no model
(`1 of 6 facts the network states are no longer on it`), and the drift issue names the page (`rooms.html`). Marta can
forward that issue link to Jonas, and Jonas can act on it. But every step of the designed experience carries a major.
The issue speaks only in the product's own words (drift, lock, grounding source, network, relock, sign). It never names
the fact (95 against 89), even though the watch has both texts in hand. The one remedy it offers, `--relock`, silences
the alarm without fixing the assistant. Reproduced: relock while the network still says €89, and the next watch is
clean, the issue would close as "clean" and the assistant keeps quoting €89. After the *right* fix (Jonas corrects the
network) the alert gets louder: two warnings, one still saying "the network may now state an old fact". A cosmetic
edit opens the same warning. A real price change that lands on an issue already open from a cosmetic edit edits the
issue body silently, with no comment and no notification. Nothing she can reach lets her close the alert herself, so
every edit to the rooms page needs Jonas. The assistant, the only surface that could translate any of this, needs a
model key she will never bring. The product owner's hypothesis holds, but more narrowly than stated: she is not stopped
at onboarding (Jonas does that). She stops at the first sentence of the alert, and the alert's remedy is unsafe even
for Jonas.

- **Time and steps as designed (issue path):** Marta takes 4 steps (open the notification, open the issue, read it,
  forward the link), about 3 to 5 minutes, and the notice reaches her up to about 24 hours after the change (daily cron).
  Jonas then takes about 8 steps and about 20 to 40 billable minutes (fix the network, build Plumbline from a clone,
  `--relock`, `sign`, commit, push, then wait for or dispatch the next run).
- **Desk path:** 5 or 6 steps, about 4 to 6 minutes, and it only works if she knows the Desk exists and her host
  serves the rooms page cross-origin.
- **Time saved:** about 7 minutes per price change against her declared 15 (she skips most of her chat questions, but
  "1 of 6 facts" sends her or Jonas back to the chat to find which one), so about 1 hour a year over eight changes.
  Confidence **low**. Against that, every cosmetic edit now costs a paid Jonas cycle. The real value, never forgetting
  to check, is real but is not in minutes.
- **Grounding** (the Desk's assistant, unreachable for Marta): **5/6**. Named additions for her job (the page's current
  stated facts, the network's current instructions): **0/2**.
- **Criteria:** 2 of 7 passed.

## Surface model

Reachability follows Marta's surface binding: a web page (the Desk), an e-mail or GitHub notification, a GitHub issue
or pull request page, read-only in practice. NOT reachable: the CLI, workflow files, key files, JSON, a model key.

| # | Affordance | What it does or says | Code | Reachable for Marta |
| --- | --- | --- | --- | --- |
| A1 | Daily watch workflow | `cron: "17 6 * * *"` + `workflow_dispatch`; no `push` trigger | `action/templates/plumbline-watch.yml:12-15` | indirect (runs for her; she never sees the file) |
| A2 | Drift issue title | fixed `Plumbline drift` | `action/report.mjs:27`, `action/action.yml:173` | yes, if GitHub notifies her (she must watch the repository; nothing mentions or assigns her) |
| A3 | Drift issue body | table Severity / Kind / Ref / What; next step "in a clone of xkazm04/plumbline ... run `node dist/cli/index.js watch --root <path to your site> --relock`, sign the site again" | `action/report.mjs:127-155` (next step `:141-148`) | yes (read-only) |
| A4 | Issue update | edit; a comment only when the digest (severity, kind, ref; summary left out) changes | `action/report.mjs:77-93`, `:206-218`; `action/action.yml:175-179` | yes (a body edit notifies nobody) |
| A5 | Issue close comment | "Plumbline watch is clean ... (Clean is not safe ...)" | `action/report.mjs:219-226` | yes |
| A6 | Relock pull request (opt-in `relock-pr`) | title "Plumbline: accept the drift (relock)"; body lists changes and "the findings this accepts"; a draft when unsigned | `action/report.mjs:232-281`, `action/action.yml:193-273` | page yes, read-only in practice; merging is a click she *could* make |
| A7 | Grounding finding sentences | "...; K of N facts the network states are no longer on it, so the network may now state an old fact." / "...; all N facts ... are still on it." / with no anchors: "...; the agent now answers from different facts." | `src/watch/decide.ts:113-129` | via A3 and D4 |
| A8 | Anchors (no model) | money needs a symbol or ISO code; facts are hashed in the lock, never quoted | `src/watch/anchors.ts:7-10`, `:57`, `:88-97`, `:205-218`; `src/watch/capture.ts:107-136` | indirect |
| A9 | `init` / `watch` / `--relock` / `sign` (CLI) | Jonas's tools; `init` prints counts of sources, not of anchored facts | `src/cli/init-command.ts:40-49`, `:168-176`; `src/cli/watch-command.ts:106-126` | **unreachable** (Jonas only) |
| D1 | The Desk, `#/drift` view | address field, "Read drift"; no deep link with the address filled in | `site/index.html:126-149`, `site/shell.js:539-554`, `site/desk.js:1896` | yes, **if** she is told the address (it is not in `README.md`, the issue or `init`'s output; only `site/devpost.md:11`) |
| D2 | Drift reading | published lock, rooms page re-fetched, the same anchors count as the CLI | `site/desk.js:570-599`, `site/drift.js:46-55`, `src/watch/published.ts:114-132` | yes, if the lock and the rooms page are served with `Access-Control-Allow-Origin` |
| D3 | Lock label | "unsigned lock: the host can rewrite it" unless the signature is *verified under a publisher she trusts* | `site/desk.js:580-584`, `site/strings.js:88-90`, `:111-112` | yes |
| D4 | Rendered finding | chip "Warning", `rooms.html`, the summary, then "locked <64 hex> · now <64 hex>" | `site/desk.js:1439-1463` | yes |
| D5 | Not-checked note | "Not checked from a browser: the upstream nsdeploy commit ..." | `site/desk.js:1464`, `site/strings.js:95` | yes |
| D6 | Status line | "Drift read: 1 finding, Warning. Unsigned lock: the host can rewrite it." | `site/desk.js:1820-1828` | yes |
| D7 | The assistant | needs an AI provider key ("Assistant needs your AI provider key"); `read_drift` returns findings and lock label | `site/site.js:61-63`, `site/strings.js:326`, `site/plumbline_desk.hocon:103-117`, `site/desk.js:589-598` | **unreachable** (a model key) |
| D8 | Trust a publisher (first contact) | page button after an out-of-band key-id comparison | `site/strings.js:158-169` | technically yes; in practice no (the concept is beyond her) |

**Grounding audit, the Desk's assistant (shared denominator of 6):** (1) the site address: yes, `read_drift` returns
`target` (`site/desk.js:590`). (2) The gate report: yes, `run_gate`. (3) The drift report: yes, findings with summaries
(`site/desk.js:596`). (4) The signature verdict: yes, `verify_site`, and `lockSigned` in `read_drift`
(`site/desk.js:594`). (5) The trust list: yes, `get_desk_state.trustedPublishers` (`site/desk.js:527`). (6) The lock's
contents: **no**. Only findings and `lockUrl` reach the model: which sources are locked and how many facts each anchors
do not. **5/6.** Named additions for Marta: the page's current facts and the network's current instructions, **0/2**.
Her question ("does it still say 89?") cannot be answered from tool results.

**Wiring audit:** of the published reader's user-facing fields (`lockUrl`, `lockFound`, `lockState`, `lockSummary`,
`unreachablePeers`, `findings`), `lockSummary` is computed for every lock that cannot be used
(`src/watch/published.ts:166-195`, documented in `site/drift.js:18`, `:42`). It is rendered nowhere in `site/` and is
left out of the tool result (`site/desk.js:589-598`). That is 5 of 6 wired. The page falls back to the generic "could
not be used" (`site/strings.js:93`) and never says why.

**Known defect from the review, checked:** "the relock PR push fails when the branch already exists" is
**confirmed** by reproduction (finding MAR-L1-13).

## Walkthrough

*Monday, 10:40. I have just changed the double room from 89 to 95 in the page editor Jonas showed me.*

**Step 0: does anything tell me?** (Q1 *will she try?*) No: I would not go looking. I would have to be told. The
watch runs once a day at 06:17 UTC (`plumbline-watch.yml:14`), so the earliest anything can happen is Tuesday morning.
My definition of done says "within a few minutes". (Q2) If GitHub e-mails me, the subject is the fixed title
`Plumbline drift` (`report.mjs:27`). That word means nothing to me, and I would read it as spam. Whether I get the
e-mail at all depends on my watching a repository I have opened twice. The Action mentions and assigns nobody
(`action.yml:173`).

**Step 1: the issue.** (Q3 *named in her words?*) The first sentence is "Plumbline watch found drift since
`plumbline.lock.json` was written." Then a table: `warn | grounding | rooms.html | A grounding source changed since the
lock was written; 1 of 6 facts the network states are no longer on it, so the network may now state an old fact.`
(reproduced with the real CLI and `report.mjs watch`). I recognise "rooms", and "old fact" sounds like my fear. But
"network" is not my chat thing, "may" is a hedge, and it does not say *which* fact. Is it the price, the breakfast or
the check-in time? (Q4 *does she know what is next?*) The next paragraph tells me to run a command "in a clone of
xkazm04/plumbline". I will not. The only thing I can do is forward the link to Jonas, and nothing on the page tells me
that is the right move.

**Step 1b: the Desk instead** (if Jonas told me it exists). I open it and see "Five ports of call", "Set and drift",
"Take a fix". I find "Read drift", type my address and press the button. No key, nothing to install: good. The result
says "unsigned lock: the host can rewrite it" in a notice box, although Jonas signed my site. The label is about *my
browser* not trusting the key (`desk.js:581`), not about the lock. Then "Grounding (1)", a Warning chip, `rooms.html`,
the same sentence, and two 64-character strings of letters and numbers. Then a note about "the upstream nsdeploy
commit". If my host does not let other sites read the rooms page, I get "A grounding source could not be checked: it
could not be fetched (the browser could not read it)" instead. That is honest, but it is no answer.

**Step 2: Jonas acts** (not my journey, but the question asks who closes the alert). Two paths:

- **The path the issue names:** `--relock`, then sign. Reproduced: if he relocks *before* fixing the assistant, the
  relock drops the €89 anchor (6 anchors become 5), prints only `changed grounding rooms.html`, and the next watch is
  clean (exit 0). The issue closes with "Plumbline watch is clean". The chat thing still says 89. With `relock-pr`, a
  pull request titled "accept the drift" invites exactly this. If I ever merge a green button, it would be that one.
- **The right path:** fix the network to €95 first. Reproduced: the watch then reports TWO warnings, the network file
  ("the agent now answers from different facts") and `rooms.html`, which still says "1 of 6 facts ... the network may
  now state an old fact", though it no longer does. The alarm stays up, louder, until Jonas relocks and signs, and the
  next daily run (or a manual dispatch) closes it.

**Step 3: a week later, a wording change on the rooms page** (`cosmetic-edit`). Reproduced: the same warning, "all 6
facts the network states from it are still on it". It is honest, but it is still a Warning and still an open issue that
only Jonas can close: a red warning that turns out to be nothing. If that issue is still open when I next raise a
price, the issue body changes to "1 of 6 ... no longer on it" with **no comment** (`issuePlan` returns `edit` with no
comment; reproduced). Nobody is told: the one alert that mattered arrives silently.

## Scored criteria

| # | Criterion | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Start with only her address; an answer; no install, no key | **pass** (conditional) | The Desk's `#/drift` needs only an address (`site/index.html:141-144`, `site/desk.js:570-599`); no key on that path. Conditional on knowing the Desk's address (not in `README.md` or the issue) and on her host serving the lock and the rooms page cross-origin (`site/README.md:140-145`; MAR-L1-09). The assistant, by contrast, needs a key (`site/site.js:61-63`). |
| 2 | Every word is hers, or explained where it appears | **fail** | Issue: drift, lock, grounding source, network, vendored runtime, peer, relock, sign (`action/report.mjs:135-150`). Desk: grounding, runtime, peers, unsigned lock, hex pairs (`site/strings.js:75-116`, `site/desk.js:1453-1457`). No sentence explains any of them where they appear. |
| 3 | When a page changed and the assistant states an old fact, she is told, and which page | **pass** (with caveats) | "1 of 6 facts the network states are no longer on it, so the network may now state an old fact" with Ref `rooms.html` (`src/watch/decide.ts:127`; reproduced). Caveats: the fact is not named (MAR-L1-05); when the price is written "89 euros" there is no anchor and the sentence becomes "the agent now answers from different facts" (MAR-L1-03); after the fix the sentence is wrong (MAR-L1-02). |
| 4 | Told what to do next; a step she can take or forward as it stands | **fail** | The only next step is a CLI relock in a Plumbline clone (`action/report.mjs:145-148`). It is not hers, and for a stale price it is the wrong step (MAR-L1-01). The Desk gives no next step for a grounding finding (`site/desk.js:1445-1460`). Forwarding the link works, but nothing tells her to. |
| 5 | Never a reassuring result for something not checked | **fail** | After a relock that drops the stale price's anchor, the watch is clean and the issue closes as "clean" while nothing checks the €89 any more (MAR-L1-01). "The agent now answers from different facts" reassures her that the assistant updated when it did not (MAR-L1-03). |
| 6 | Notification to knowing what to do in under 3 minutes | **fail** | The notice comes up to about 24 hours after the change (`plumbline-watch.yml:14`). On arrival, the issue gives her no step of her own (criterion 4). Reading it alone is about 3 to 5 minutes for her. |
| 7 | She would rather use this than ask the chat five questions | **fail** (narrowly) | It remembers for her, which is her real pain. But it does not say which fact, so she still asks the chat to find out. Every edit, cosmetic ones included, now costs a paid Jonas cycle to clear. Its remedy can silence the problem without fixing it. |

**2 of 7 passed.**

## Findings

```json
[
  {
    "id": "MAR-L1-01",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "The only remedy the alert offers (relock) silences a stale price without fixing it, and the issue then closes as clean",
    "expected": "When the page no longer states a fact the assistant states, accepting the change either refuses or says plainly that the assistant still states a fact no source supports; the alert stays until the assistant is fixed, or the accept is explicit about what it gives up.",
    "got": "Reproduced: page at €95, network still €89, `watch --relock` exits 0, prints only `changed grounding rooms.html`, and silently drops the €89 anchor (6 anchors to 5). The next `watch` is clean (exit 0), so the Action would close the issue with 'Plumbline watch is clean'. The issue body's only next step is exactly this relock; the relock pull request is titled 'Plumbline: accept the drift (relock)' and lists the stale-fact warning under 'The findings this accepts'.",
    "evidence": ["action/report.mjs:141-148", "action/report.mjs:219-226", "action/report.mjs:233", "action/report.mjs:254-266", "src/watch/capture.ts:126-135", "src/watch/decide.ts:462-490", "src/cli/watch-command.ts:106-126"],
    "code_check": "present-broken",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "In larch-house: act raise-price, then relock WITHOUT fix-network (CLI, and the Action's relock-pr against the local bare remote); assert the next watch is clean and the issue plan is close. Precondition: the world's network instructions state the price with a currency symbol (else see MAR-L1-03)."
  },
  {
    "id": "MAR-L1-02",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "After the right fix (network corrected to 95) the alert gets louder and still says the network may state an old fact",
    "expected": "Once the network states what the page states, the stale-fact sentence is gone; what remains says only that the corrected files need re-locking (and signing).",
    "got": "Reproduced after fix-network: two warnings, `larch_house.network.json` ('the agent now answers from different facts') and `rooms.html` ('1 of 6 facts the network states are no longer on it, so the network may now state an old fact'). The anchors are counted against the literals hashed at lock time, not against what the network states now, though the checkout watch reads the current network.",
    "evidence": ["src/watch/decide.ts:120-127", "src/watch/anchors.ts:213-218", "src/watch/anchors.ts:224-228", "docs/gate-and-watch.md:233-236"],
    "code_check": "by-design",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "larch-house: raise-price then fix-network, watch from the checkout and the Desk; record the exact sentences and the issue body. No precondition."
  },
  {
    "id": "MAR-L1-03",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "A price written '89 euros' is never anchored, init says nothing, and a changed page then reads 'the agent now answers from different facts' (the opposite of the truth)",
    "expected": "init/relock says how many facts were anchored on each --source page (and warns at 0), currency words are recognised, and a changed un-anchored page says the assistant may still state the page's old facts.",
    "got": "Reproduced: instructions 'The double room costs 89 euros a night' and page '89 euros' give no anchor (only symbols and ISO codes count; 'euros', 'pounds', 'dollars' and '89,- €' do not). `init` prints '3 grounding sources' and no anchor count. After the page moves to 95 the watch says 'A grounding source changed since the lock was written; the agent now answers from different facts.' For a page source the agent does NOT answer from the page; it still answers 89.",
    "evidence": ["src/watch/anchors.ts:57", "src/watch/anchors.ts:88-97", "src/watch/capture.ts:126-135", "src/cli/init-command.ts:168-176", "src/watch/decide.ts:121-122"],
    "code_check": "present-broken",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Check how the larch-house fixture writes its prices; run one arm with prices written in words ('89 euros') to show the anchor-less sentence. Precondition: a fixture variant, or a throwaway copy edited outside the repository."
  },
  {
    "id": "MAR-L1-04",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "broken-flow",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "A real price change on an issue already open for a cosmetic edit is a silent body edit: no comment, no notification",
    "expected": "Going from 'all N facts are still on it' to 'K of N facts are no longer on it' counts as a change in the findings and is announced with a comment.",
    "got": "Reproduced with `report.mjs issue`: open issue body from cosmetic-edit, this run's body from raise-price -> action=edit, comment empty. The digest is severity+kind+ref only (summary deliberately left out), and both are ['warn','grounding','rooms.html'].",
    "evidence": ["action/report.mjs:77-93", "action/report.mjs:206-218", "action/action.yml:175-179", "action/README.md:60-62"],
    "code_check": "present-broken",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "larch-house: cosmetic-edit, run the Action (issue opens), then raise-price, run again; assert the gh stub records an edit and no comment. Precondition: the world's gh stub and local bare remote."
  },
  {
    "id": "MAR-L1-05",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "The alert never names the stale fact ('page says 95, assistant says 89'), only '1 of 6 facts'",
    "expected": "On the publisher's own checkout (their own words, not a stranger's), the watch says which fact the network states that the page no longer does, and what the page states now.",
    "got": "'1 of 6 facts the network states are no longer on it'. The lock stores only hashes, but the checkout watch reads the current network and page and could name the literal; the no-quote rule (rubric: a stranger's words) is applied to the owner's own site too.",
    "evidence": ["src/watch/anchors.ts:7-10", "src/watch/decide.ts:127", "action/report.mjs:129"],
    "code_check": "by-design",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Read the live issue body and Desk reading after raise-price; confirm no surface names the price. No precondition."
  },
  {
    "id": "MAR-L1-06",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "No plain-words layer for a site owner: the issue title, body and Desk speak only drift/lock/grounding/network/relock/sign and show hex hashes",
    "expected": "An owner-facing line first ('Your rooms page changed; the chat assistant may still quote an old price. Forward this to whoever maintains your assistant.'), with the technical table after it; no 64-character hashes in the default view.",
    "got": "Title 'Plumbline drift'; body opens 'found drift since plumbline.lock.json was written'; next step is a CLI command in a clone of Plumbline. The Desk shows 'Grounding (1)', 'Warning', 'unsigned lock: the host can rewrite it', 'locked <hex> · now <hex>', and a note about 'the upstream nsdeploy commit'.",
    "evidence": ["action/report.mjs:27", "action/report.mjs:133-150", "site/strings.js:75-116", "site/desk.js:1437", "site/desk.js:1453-1457", "site/desk.js:1464"],
    "code_check": "confirmed-absent",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Screenshot the Desk's drift result and the rendered issue after raise-price; count words outside Marta's vocabulary. No precondition."
  },
  {
    "id": "MAR-L1-07",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "effort",
    "title": "Every edit of the rooms page, cosmetic included, opens a warning only Jonas can clear: 'needs Jonas every time'",
    "expected": "An edit that leaves every stated fact on the page is acknowledged without a paid developer cycle (for example info, or an owner-clickable accept that relocks and signs in CI), and the warning severity reflects whether a stated fact went missing.",
    "got": "Reproduced cosmetic-edit: 'all 6 facts the network states from it are still on it', severity warn, exit 1, issue opened. The severity is warn whatever the anchors say, by design. Clearing it needs --relock plus sign from a Plumbline clone, or a signed relock PR that Jonas must set up with a key secret.",
    "evidence": ["src/watch/decide.ts:119", "src/watch/decide.ts:126", "action/report.mjs:64-75", "action/report.mjs:141-148", "action/action.yml:34-49"],
    "code_check": "by-design",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "larch-house cosmetic-edit through the Action: confirm the issue opens and record what it takes to close it. No precondition."
  },
  {
    "id": "MAR-L1-08",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "time-saved",
    "title": "The news reaches her up to a day late (daily cron, no push trigger) and through a notification she may never get",
    "expected": "A change to a watched page is checked when it lands (a push trigger in the template, scoped to the site folder), and the issue can mention or assign a named owner.",
    "got": "`cron: \"17 6 * * *\"` and `workflow_dispatch` only; the Action has no assignee or mention input, so only repository watchers are notified, and edits without a comment notify nobody.",
    "evidence": ["action/templates/plumbline-watch.yml:12-15", "action/action.yml:5-49", "action/action.yml:171-174"],
    "code_check": "confirmed-absent",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Not checkable with the gh stub (who GitHub notifies). L2 records only the trigger list; resolves uncertain for notification reach. Precondition: a scratch GitHub repository the owner creates (env.md)."
  },
  {
    "id": "MAR-L1-09",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "med" },
    "dimension": "completion",
    "title": "On an ordinary host the Desk cannot read the rooms page (no CORS on HTML pages), and nothing tells the publisher a --source page needs it",
    "expected": "init/--source, the Desk's publish note and the docs say that each grounding page must also be served with Access-Control-Allow-Origin for any browser check, or the Desk says which header is missing.",
    "got": "The publish note names the signature, key, lock, revocation and signed files only. A --source page is not a signed file. Fetched cross-origin without the header, it reads 'A grounding source could not be checked: it could not be fetched (the browser could not read it).' This is honest, but she gets no answer. The worlds serve every file with ACAO *, so L2 will not see this unless an arm removes it.",
    "evidence": ["site/strings.js:46", "site/README.md:140-145", "src/watch/published.ts:114-132", "src/watch/observe.ts:36-46", "uat/env.md:39"],
    "code_check": "confirmed-absent",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Run a larch-house arm where the rooms page is served WITHOUT Access-Control-Allow-Origin (agent files keep it) and read drift from the Desk. Precondition: world driver able to drop the header per path."
  },
  {
    "id": "MAR-L1-10",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "The Desk calls her own signed lock 'unsigned lock: the host can rewrite it' until she trusts her own key",
    "expected": "A lock covered by a signature that is valid but from a key she has not trusted says so ('signed, by a key you have not trusted yet'), distinct from a lock no signature covers.",
    "got": "lockSigned is true only for a VERIFIED signature under a trusted publisher; otherwise the label is 'unsigned lock' in a notice box, and the status line says 'Unsigned lock: the host can rewrite it.'",
    "evidence": ["site/desk.js:580-584", "site/desk.js:1437", "site/strings.js:88", "site/strings.js:90", "site/strings.js:112"],
    "code_check": "present-broken",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "larch-house (signed by setup) read from a fresh browser profile with an empty trust list; quote the label. No precondition."
  },
  {
    "id": "MAR-L1-11",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "low" },
    "dimension": "effort",
    "title": "Nothing leads a site owner to the Desk: no address in README, the issue or init's output, and no link with her address filled in",
    "expected": "The drift issue (and init's next steps) carry a Desk link that opens the drift view with the site's address prefilled, e.g. #/drift?target=...",
    "got": "The live Desk address appears only in site/devpost.md. Routing reads the view name from the hash and nothing else, so every visit starts with typing the address.",
    "evidence": ["README.md:17", "site/devpost.md:11", "action/report.mjs:127-155", "src/cli/init-command.ts:40-49", "site/shell.js:539-554"],
    "code_check": "confirmed-absent",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "None beyond confirming no prefill on the served Desk."
  },
  {
    "id": "MAR-L1-12",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "low", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "The assistant, the one surface that could translate, needs her own model key; even keyed it is told to repeat the jargon and cannot see which facts are locked (grounding 5/6, Marta additions 0/2)",
    "expected": "A keyless explanation of a drift reading (fixed templates are enough for a grounding finding), or an assistant instructed to explain findings in the owner's terms with the lock's sources and anchor counts in its tool result.",
    "got": "needsKey unless a real key is saved; instructions say 'Give its lock label; group findings by kind'; read_drift returns findings and the label, not the lock's sources or anchor counts.",
    "evidence": ["site/site.js:61-63", "site/strings.js:326", "site/plumbline_desk.hocon:109", "site/desk.js:589-598", "site/README.md:39-42"],
    "code_check": "by-design",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Keyless: confirm the panel shows needsKey. Keyed or scripted arm (env.md: scripted_model.mjs): ask 'does my chat still say 89?' after raise-price and quote the answer. Precondition: a model key in the tester's profile, or the scripted provider wired."
  },
  {
    "id": "MAR-L1-13",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "broken-flow",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "low", "trust_erosion": "med" },
    "dimension": "completion",
    "title": "Known defect confirmed: once a relock PR is open, the next run cannot update it (push rejected 'stale info'), so a PR accepting the stale price outlives the fix",
    "expected": "After fix-network the open relock PR is updated to the corrected lock (or closed).",
    "got": "Reproduced the Action's push sequence with plain git against a local bare remote: fetch into refs/remotes/plumbline/<branch>, then push --force-with-lease=refs/heads/<branch> to a URL -> '! [rejected] (stale info)', exit 1. The edit path of the pull request fails.",
    "evidence": ["action/action.yml:253-254", "action/action.yml:261-265"],
    "code_check": "present-broken",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "In the world's local bare remote: relock-pr at raise-price, then fix-network, run again; assert the push step fails. Precondition: world git remote and gh stub."
  },
  {
    "id": "MAR-L1-14",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "Wiring and wording papercuts: lockSummary never shown; '1 of 1 fact ... are'; init's next step tells you to add --source after you already gave one",
    "expected": "The reason a lock cannot be used is shown; counts agree in number; next steps reflect what was done.",
    "got": "lockSummary is computed and reaches no screen or tool result; with one anchor the sentence reads '1 of 1 fact the network states are no longer on it'; init with --source still prints step 3 'Name the pages whose facts your network states ... --relock --source <page>'.",
    "evidence": ["src/watch/published.ts:166-195", "site/desk.js:1432-1434", "site/desk.js:589-598", "src/watch/decide.ts:118", "src/watch/decide.ts:127", "src/cli/init-command.ts:46"],
    "code_check": "present-broken",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Low; read along while doing the others."
  },
  {
    "id": "MAR-L1-15",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "trust",
    "strength": true,
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "senior-quality",
    "title": "Strength: with no model, the watch tells a price change apart from a wording change",
    "expected": "The raise-price and cosmetic-edit acts read differently.",
    "got": "Reproduced: '1 of 6 facts the network states are no longer on it, so the network may now state an old fact' against 'all 6 facts the network states from it are still on it'. The Desk counts the same through the shared reader (CLI watch --url gave the identical sentence).",
    "evidence": ["src/watch/decide.ts:120-127", "src/watch/anchors.ts:205-218", "src/watch/published.ts:127-128"],
    "code_check": "n-a",
    "verdict": "uncertain",
    "resolution": "n-a",
    "l2_priority": "Confirm both sentences live in the Desk and the issue."
  },
  {
    "id": "MAR-L1-16",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "trust",
    "strength": true,
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "Strength: the Desk's drift view needs no key and no install, and never calls an unread thing clean",
    "expected": "An owner with only an address gets a reading, and gaps are named.",
    "got": "Address in, reading out; a refused lock is 'refused', not 'no lock'; an unverified lock never reads as plain 'No drift'; what a browser could not check is stated under the result.",
    "evidence": ["site/desk.js:1431-1438", "site/desk.js:1464", "site/strings.js:87-95", "src/watch/published.ts:183-187"],
    "code_check": "n-a",
    "verdict": "uncertain",
    "resolution": "n-a",
    "l2_priority": "Confirm on the served Desk against larch-house."
  },
  {
    "id": "MAR-L1-17",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "trust",
    "strength": true,
    "severity": "polish",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "Strength: the issue and the pull request refuse to oversell: 'clean is not safe', 'nothing is accepted until a person merges', an unsigned relock is a draft",
    "expected": "No verdict greener than what was checked.",
    "got": "Issue footer and close comment both say clean is not safe; the relock PR body says a person must merge and stays a draft when unsigned.",
    "evidence": ["action/report.mjs:150", "action/report.mjs:224-225", "action/report.mjs:274-278"],
    "code_check": "n-a",
    "verdict": "uncertain",
    "resolution": "n-a",
    "l2_priority": "Quote both from the gh stub's recorded calls."
  }
]
```

Severity is derived from impact rank (low=1, med=2, high=3): MAR-L1-02 27; MAR-L1-01, -03, -04, -05, -06 and -07 are 18;
MAR-L1-09 and -10 are 12; MAR-L1-08 9; MAR-L1-11 6; MAR-L1-13 4; MAR-L1-12 2. MAR-L1-01 is ranked first despite its
18 because it is the one place where following the product's own advice ends in a false clean, and its reachability is
`med` only because Jonas, not Marta, runs the relock. Branches of the shared grounding sentence (`decide.ts:113-129`),
all exercised: unreadable source (honest, MAR-L1-09); unchanged (clean); changed with no anchors (inverted for a page
source, MAR-L1-03; correct for an agent file); anchors not reducible (honest); all anchors present (honest, MAR-L1-15);
some missing (honest before the fix, wrong after it, MAR-L1-02). Issue plan branches (`report.mjs:206-226`): create and
close are clean; edit-with-comment is clean for a new ref; edit-without-comment is the defect (MAR-L1-04); none is clean.

Reproductions: the built CLI (`dist/` newer than HEAD) run against a throwaway Larch House site in an OS temp folder
(`init --source rooms.html --workflow`, `watch`, `watch --relock [--json]`, `watch --url --allow-local` against a
loopback server), `action/report.mjs watch|issue|pr` on the reports, and plain git against a local bare remote. No keys
were made or read. The temp folder was removed.

## What L2 must check

1. **The false clean** (MAR-L1-01): raise-price, then relock without fix-network (the CLI and the Action's
   `relock-pr`). Is the next run clean and the issue closed while the network says 89?
2. **After fix-network** (MAR-L1-02): the exact sentences on the Desk and in the issue, and what it takes to close the
   issue.
3. **Silent escalation** (MAR-L1-04): cosmetic-edit, then raise-price, through the Action with the gh stub. Is there an
   edit and no comment?
4. **The CORS arm** (MAR-L1-09): the rooms page served without `Access-Control-Allow-Origin`, read from the Desk. The
   world's blanket ACAO hides this otherwise.
5. **The fixture's price format** (MAR-L1-03): are the world's prices symbol-based? Run one arm with "89 euros".
6. **The Desk's label for a signed site with an empty trust list** (MAR-L1-10) and the hex pair (MAR-L1-06), as screenshots.
7. **The assistant** (MAR-L1-12): keyless shows needsKey; scripted or keyed, ask "does my chat still say 89?".
8. **The relock PR update after fix-network** (MAR-L1-13): the push step on the local bare remote.

## Character feedback (L1)

I'll be honest: when Jonas first said "it watches the website for you", I thought, finally, something that remembers
so I don't have to. And it does catch it. I changed the double to 95, and the next morning there is a note that says
the rooms page changed and "the network may now state an old fact". I would have missed that for weeks on my own, the
way I did with that booking portal. That part I like.

But then I have to read it. "Drift." "Grounding source." "Lock." "Relock." What network? I have a website and a chat
thing. It says one of six facts is no longer on the page. Which one? The price? Breakfast? The check-in time? I know
exactly which, because I changed it ten minutes before, but the note doesn't, or won't say. So I still open the chat
and ask it what a double costs, which is the thing this was meant to save me. And the only instruction on the page is a
command to "run" in some "clone". I don't run things. I'd forward it to Jonas, and nothing on the page even tells me
that's what I'm supposed to do.

What actually worries me is what happens next. If I understand it right, the button that makes the warning go away,
"accept the drift", would make it go away even if nobody fixed the chat. It would say "clean" and close, and the chat
would carry on telling people 89. That's the booking portal all over again, except this time with a green tick on it.
And when Jonas does fix it properly, the warning gets *bigger* until he does his signing thing. Every time I fix a typo
on the rooms page, it opens a warning too, and Jonas charges by the hour to close it.

Would I adopt it? If Jonas sets it up, yes, because it remembers when I don't. Would I trust it? Not yet. Would I tell
the woman who runs the B&B up the valley? Not until it can say, in one line, "your rooms page says 95, your chat
assistant still says 89, send this to your web person", and not until the "all clear" means the chat was actually
fixed. And please, no "API key" to ask a question about my own website.

---

# Marta Hollis x j1-price-changed - L2

Walked 2026-11-18 against `dist/` and `site/lib/plumbline/` rebuilt at 11:25 (+0100) from HEAD `47ea482` (committed
10:30). World `larch-house` (ports 4100, 4101, Desk 4199), up 11:25, down at the end. Shots:
`uat/runs/2026-11-18-first-five/shots/marta/l2-*`. Everything else the walk produced (the Action runner and `gh` stub
built for it, issue and PR bodies, watch reports, the `gh` stub's recorded calls, the anchor probe, the browser journals)
is in `uat/runs/2026-11-18-first-five/evidence/marta/` (`out/` holds the outputs).

## L2 preflight

`_L2-PREFLIGHT`. "Built" means this host lacked the arm and the walk constructed it inside the world's temp folder or
the run folder.

| Carried `l2_priority` | Environment precondition | On this host |
| --- | --- | --- |
| Freshness | `dist/` newer than HEAD | **yes**: `npm run build` (exit 0) and `npm run build:site` ("28 browser modules") at 11:25; HEAD 10:30; `git status` clean apart from the untracked `uat/`, `.claude/`, `.ai/` |
| MAR-L1-01 false clean (CLI and the Action's `relock-pr`) | (a) the network states the price with a symbol; (b) a git remote and a `gh` for the Action | (a) **yes, but**: the network says `€89`, while the fixture's rooms page never anchors it (fixtures Observed 1, reproduced below), so the anchored arm was **built** as a small price-first copy of the site (`mini/B-pricefirst`, `B2-wrongrelock`). (b) **built**: `evidence/marta/run-action.mjs` runs the `run:` blocks of `action/action.yml` verbatim in `bash -eo pipefail` against a fresh clone of a local bare remote (the Action's push URL mapped with `url.insteadOf` through `GIT_CONFIG_*` env), `gh` is `evidence/marta/gh-stub.mjs` (first on PATH; the runner refuses to start otherwise), the build step is skipped (dist already built), and `--harness` swaps `node "$cli" watch` for `uat/driver/local-cli.mjs watch` so the loopback bike peer is watched as an https one would be. With `relock-pr: true` the Action cannot sign in a world: `inputProblem` requires an https `origin` with a key, so every PR here is the unsigned draft. |
| MAR-L1-02 after fix-network | none | **yes** (world), plus the anchored copy for the "1 of 6" sentence |
| MAR-L1-04 silent escalation | `gh` stub and remote; a layout where the price anchors | **built**: a second small repository `mini/E-esc` (price column first, 6 anchors) with its own bare remote, run through the same runner |
| MAR-L1-09 CORS arm | per-path header removal | **yes**: the world's `rooms-no-cors` / `rooms-cors` acts (`curl -I`: no `Access-Control-Allow-Origin` on `/rooms.html` only) |
| MAR-L1-03 price format | a variant written in words | **built**: `mini/C-words` and `mini/C0-words-only` in the world folder, real CLI `init`/`watch`; plus `evidence/marta/anchor-probe.mjs` over 36 ways of writing a fact, calling the built `dist/watch/anchors.js` (the functions the watch and the Desk use) |
| MAR-L1-10 / -06 empty trust list, hex pair | fresh browser profile | **yes**: every `drive-script` run is a new Playwright context (empty storage) |
| MAR-L1-12 the assistant | keyless: none. Keyed or scripted: a model key, or `site/tests/scripted_model.mjs` wired as a provider | keyless **yes**. Keyed: **no** (no key on this host and none may be used). Scripted: **not buildable without editing the vendored runtime** (`site/runtime/` is copy-do-not-change; the runtime takes its LLM client from its own settings). Built instead: the exact tool result, by calling in the live page the method the `read_drift` tool calls (`App.page.readDrift`, `site/site-actions.js:56`). The keyed answer stays open; what would close it: a test-only provider hook in the Desk that loads `ScriptedModel`, or a key in a tester's own profile. |
| MAR-L1-13 relock PR update | bare remote and `gh` | **built** (as above) |
| MAR-L1-08 notification reach | real GitHub | **no**: the stub only models who GitHub would notify (create and comment notify, a body edit does not). Closes with a scratch GitHub repository the owner creates (`uat/env.md`). |
| MAR-L1-11 prefill | served Desk | **yes** |
| Baseline peer | an https peer is captured at `init`; the world's is loopback, so `init` leaves it pending and every CLI watch warns (fixtures Observed 2) | **built**: Jonas's baseline was re-locked through the harness to capture the bike peer, then signed with the world's own throwaway key (`sign` only; the key file was never read). Reachable only through the test harness; a world rule, not a Marta finding. |
| Atlas, Customs, GitHub upstream | public services | Atlas and Customs answer `unavailable` for a loopback site (one call each, from the Desk's check view at `setup`); the upstream runtime check was already rate-limited by GitHub at the first watch (`info`, never an exit code) |

## L2 journal

*Separation: paragraphs marked **Marta** are her journey, on the surfaces her binding allows (the Desk in a browser, the
GitHub issue and pull request she would be linked to). Paragraphs marked **Jonas** establish what he must do for her and
how often; they are not her journey.*

**Setup (the site as Jonas left it).**

**Marta.** Jonas sent me "the checking page". It opens on a big compass, "Is it still what it claims to be?", a large
green "Passed" card and three "Passed" circles. It says "EXAMPLE · AGENT CUSTOMS" above the card, but the first thing I
read is *Passed* (`l2-01-setup-overview`). There are five "ports of call": "Take a fix", "Set and drift", "Read the
papers", "Cast a seal", "Sign the manifest". I'm a guesthouse, not a ship. I pick "2. Read drift", because Jonas said
"drift". I type my address and press the button, with no key and nothing to install. The page says "Drift read: 1
finding, Warning. Unsigned lock: the host can rewrite it." (`l2-03-setup-drift-read`). That's on the day Jonas finished,
before I changed anything. The warning is about the bike shop ("A peer could not be captured ... run watch --relock").
*World note: that warning exists only because the world's partner is on http; an https partner is captured at `init`.
The "unsigned lock" label is real; see below.*

"Verify a signature" says "UNVERIFIABLE ... You have not met this signer yet" and asks me to compare a key id "character
by character" with one "the publisher gave me through another channel" (`l2-04-setup-verify`). The publisher is Jonas.
I'd have to phone him to read me sixteen letters. "Check a site" says "Overall: UNAVAILABLE: NO VERDICT" (`l2-05-setup-
check`; in a world Atlas and Customs cannot see the site, so this is expected here). The "Assistant" button opens a
panel that says "Assistant needs your AI provider key", with "API key required", "LLM provider", a "⚙ Developer" chip,
and a list of providers with "Billing may be required" (`l2-06-setup-assistant`; at phone width the same,
`l2-42b-phone-assistant-viewport`). That's where I close it.

**Jonas (baseline).** The real CLI's `watch --root site` exits 1 with the pending-peer warn on an untouched site. After
the harness relock that captures the peer and a fresh `sign`, the Action run `d0-setup` is clean: `findings=0`, issue
plan `none` (`out/runner.d0.json`).

**Act `raise-price`: Monday, I change the double room from €89 to €95 in the page editor.** (Committed to `master` as
the page editor would; the assistant's definition still says €89.)

**Marta, the issue.** The next run (`d1-raise-price`) opens issue #1, "Plumbline drift" (`gh issue create`, which would
notify watchers). Its body, in full apart from the hidden marker (`out/issue-body.d1-raise-price.md`):

> Plumbline watch found drift since `plumbline.lock.json` was written.
>
> | warn | grounding | rooms.html | A grounding source changed since the lock was written; all 5 facts the network
> states from it are still on it. |
>
> `block` means a vendored runtime file, a peer's definition or a peer's links.json changed: look before the next
> release. After reviewing a change you accept, in a clone of xkazm04/plumbline at the commit this workflow pins, run
> `node dist/cli/index.js watch --root <path to your site> --relock`, sign the site again (the lock is a signed file) and
> commit both. The next clean run closes this issue.

I recognise "rooms". "All 5 facts ... are still on it." So it's fine? The chat thing is saying 89 to every guest who
asks, and this note, the one thing meant to catch exactly that, tells me the facts are still there. I'd close the tab.
The body has 143 words, with 23 distinct terms I don't use (drift, lock, grounding, source, network, relock, sign,
clone, commit, block, warn, ref, runtime, vendored, peer, links.json, workflow, ...). The only instruction is to "run"
something "in a clone". Nothing says "send this to Jonas". There's no link to the checking page.

**Marta, the Desk.** Same address, "Read drift" (`l2-10-raise-drift-laptop`, `l2-10-raise-drift-phone`; at 390 px there
is no sideways scroll: `scrollWidth` 390). "Drift read: 2 findings, the worst Warning. Unsigned lock: the host can
rewrite it." Then "GROUNDING (1) · WARNING · rooms.html · A grounding source changed since the lock was written; all 5
facts the network states from it are still on it.", then "locked 87b52e6f…a9a · now fb8204b4…0c12" (two 64-character
strings), then the bike shop, then "Not checked from a browser: the upstream nsdeploy commit". It's the same reassurance
as the issue, with more letters. Nowhere does it say 89 or 95, or what to do. *(My browser check "names 89 or 95" first
PASSED because the hex hashes contain the digits "89": a void check. Re-run with a currency-anchored pattern
(`l2-13-raise-drift-after-trust` journal) it FAILS: no surface names the price.)*

**Why "all 5" and not 6: reproduced and widened.** The lock anchors 5 facts on `rooms.html`, not the 7 the fixture
README lists. The network's literals are `money:eur 89`, `money:eur 69`, `money:eur 12`, two times, the phone and the
e-mail. On the page the price row reduces to `Double room 2 €89 per night`, and the money pattern (`src/watch/anchors.ts:90`,
which takes a number before or after the symbol) reads `2 €` as €2, then `1 €` as €1. So neither room price is ever
anchored. The probe (`out/anchor-probe.txt`, the built `extractLiterals(reduceToText(...))`) shows this is not one
layout but a class:

| Not anchored (a change is invisible as a fact) | Anchored (a change is counted) |
| --- | --- |
| `Sleeps 2 \| €89` (the fixture), `Room 4 \| €89`, `Summer 2027 \| €89` (reads €2027), `7 \| €560` (nights), `2 \| £89` | `€89 \| 2` (price column first), "sleeps 2: €89" (prose), `2 \| 89 €` (symbol after), `2 adults \| $89` |
| `€89 \| 120` (a 3-digit cell after the price: reads €89120) | `€89.00`, `89,00 €`, `EUR 89`, `&euro;89`, `<span>€</span><span>89</span>`, "from €89/night" |
| "89 euros" (page, or both page and network) | `15:00`, `3pm`, `3 p.m.`, `15:00–20:00`, a `Check-in \| 15:00` cell |
| `15.00`, `10.30am`, `15h` | `+44 1632 960418`, `+44-1632-960418` |
| `01632 960418` (national), `+44 (0)1632 960418` (reads +4401632960418) | a plain e-mail address; `10%` after a number cell |
| a phone only in a `tel:` link, an e-mail only in a `mailto:` link (the link text "Call us") | |

End to end with the real CLI on small sites in the world folder (`init --root site --source rooms.html`, edit,
`watch --root site`). Each arm has its control:

- `B-pricefirst` (6 anchors): raise 89 to 95 gives "**1 of 6 facts the network states are no longer on it**, so the
  network may now state an old fact." Control `B-pricefirst-control` (wording only) gives "all 6 facts the network
  states from it are still on it." The control arm holds: on this layout the product does tell the two apart.
- Fixture layout, no edit (control): no grounding finding at all.
- `D-season` ("Double room, summer 2027 | €89"): raise gives "all 5 facts ... still on it". **Not noticed.**
- `C-words` ("89 euros a night" on page and network, other facts in symbols): raise gives "all 5 facts ... still on
  it". **Not noticed**, and *not* L1's "the agent now answers from different facts".
- `C0-words-only` (a page with no anchorable fact): raise gives "the agent now answers from different facts" (L1's
  sentence; it appears only at zero anchors).
- `init` prints "3 grounding sources" in every arm, whether the page anchored 6, 5 or 0 facts. It never says which
  facts, or that the room prices are not among them.

**Act `rooms-no-cors` (an ordinary host), still at raise-price.** **Marta.** "A grounding source could not be checked:
it could not be fetched (the browser could not read it)." with "locked 87b5…" (`l2-11-raise-nocors-drift-laptop`). It
is honest and not green. It doesn't tell me what to ask my host for: no header, no "CORS", nothing to forward. Then
`rooms-cors` put the header back.

**Trusting Jonas's key, at raise-price (MAR-L1-10).** **Marta.** If Jonas reads me the key id, I tick "I compared this
key id" and press "Trust this publisher". The seal says VERIFIED ("It does not mean the site is safe, honest or
correct."). But the status line under the button still says "**Verify finished: Unverifiable.**" (journal
`j-trust.json`; `site/desk.js:846-866` re-verifies and re-renders the card but never writes `#verify-status`, which is
`aria-live`). Read drift again: "Signed lock: covered by a signature that verified under a publisher you trust."
(`l2-13-raise-drift-after-trust`). So "unsigned lock" meant "you haven't trusted Jonas in this browser", not "your lock
is unsigned". On her phone or a new laptop it says "unsigned" again.

**The wrong path (arm W, branched from raise-price and rolled back afterwards): "accept the drift".** The template
(`action/templates/plumbline-watch.yml`) keeps the issue only. `relock-pr: true` is opt-in, run here to settle
MAR-L1-01 and -13.

- `w1-relockpr-at-raise`: the issue needs nothing (same body). A draft pull request #2 opens, "**Plumbline: accept the
  drift (relock)**" (`out/pr-body.w1-relockpr-at-raise.md`): "What the new lock changes: changed `grounding rooms.html`
  ... **The findings this accepts** ... `all 5 facts the network states from it are still on it.` ... **Not signed.**
  ... It stays a draft until then. Nothing is accepted until a person merges this." **Marta:** it says it accepts a
  change in which all facts are still there. To me that reads as safe to merge.
- `w2-relockpr-after-fix` (MAR-L1-13; fix-network on a temporary commit): the issue gets an edit and a comment
  ("New: **warn** grounding `larch_house.network.json`"). The pull request step **fails**: `! [rejected] HEAD ->
  plumbline/relock (stale info)`, step exit 1. The open PR keeps the pre-fix lock (`7ef9b47`).
- Rolled back to raise-price; then "Marta (GitHub merge button)" merges PR #2 (on GitHub she would first press "Ready
  for review": the draft is a speed bump, not a lock). `w3-after-merge`: `findings=0`; **issue #1 closed** with
  "Plumbline watch is clean ... (Clean is not safe: it means nothing locked has drifted.)"; **PR #2 closed** with "no
  longer finds anything to accept". The network still says €89. Desk after the merge (`l2-20-W-after-merge-drift`):
  rooms.html is no longer mentioned. Only `verify` shows anything (`l2-21-W-after-merge-verify`): "INVALID: A SIGNED
  FILE CHANGED, OR IS MISSING". The watch checks only the signature's *expiry* (`src/watch/decide.ts:356-392`), so the
  run that closed the issue as clean said nothing about the site's signature now reading tampered for every verifier.
- **Jonas, CLI, anchored layout** (`mini/B2-wrongrelock`): `watch --relock` with the network still at €89 prints only
  `changed grounding rooms.html` and the re-sign reminder; the lock's anchors go from 6 to 5; the next `watch` has no
  grounding finding. Following the issue's own instruction ends in a false clean.

**Act `fix-network`: Jonas corrects the assistant to €95 (main path).** `d2-fix-network`: issue #1 is edited **and
commented** ("Plumbline watch's findings changed ... New: **warn** grounding `larch_house.network.json`"), so the correct
fix notifies me of a *new* warning. The body now has two rows: the network ("the agent now answers from different
facts") and rooms.html ("all 5 facts ... still on it") (`out/issue-body.d2-fix-network.md`). **Marta, Desk**
(`l2-30-fix-drift-laptop`): "Drift read: 3 findings, the worst Warning. Unsigned lock". Verify (`l2-31-fix-verify`):
"Invalid: a signed file changed, or is missing" and "Do not treat these files as the publisher's". That's about my own
website, the day Jonas fixed it. *(My browser check "says what is left to do" passed only because "unsigned lock"
contains "sign": a void check. Code: `site/desk.js:1439-1466` renders no next step.)* On the anchored layout
(`mini/B-pricefirst` with the network at €95) rooms.html still says "**1 of 6 facts ... no longer on it, so the
network may now state an old fact**", which is false once the network is fixed.

**Jonas closes it.** He relocks (through the harness here, a world rule), signs with his key file, then commits and
pushes. `d3-after-relock-sign`: issue #1 closed as clean. For one price change, Jonas: reads the forwarded issue, which
cannot tell him whether a price is stale on this layout, so he must diff the page himself; edits the network JSON; then,
in a Plumbline clone (`npm ci && npm run build` the first time), `watch --root <site> --relock`, `sign --root <site>
--key <file> --origin <https origin>`, `git add`, `commit`, `push`, and dispatches the workflow or waits up to a day.
That is about 7 commands and 1 file edit, every time.

**Act `cosmetic-edit`: a week later I reword the introduction.** `d4-cosmetic`: a **new** issue #2 (notifies), whose
body is **byte-identical** to the raise-price issue's (`cmp` of the two bodies without the marker: identical). The red
warning that turns out to be nothing, and the warning that mattered, look exactly the same. Each costs a Jonas cycle of
4 commands (relock, sign, commit, push).

**Silent escalation (MAR-L1-04), arm E (`mini/E-esc`, price column first so the price anchors).** `e1-cosmetic` creates
the issue (notifies), "all 6 ... still on it". `e2-raise-after-cosmetic`: **`issue edit` only, no comment** (stub
history: created, body edited; 0 comments). The body now says "1 of 6 facts ... no longer on it". Nobody is told. On the
fixture layout it is worse: the body does not change at all, so the plan is `none`.

**The assistant's inputs, live (MAR-L1-12).** The object the `read_drift` tool returns to the model, taken from the live
page (`j-tool.json`): `target`, `lockUrl`, `lockFound`, `lockState`, `lockSigned: false`, `lock: "unsigned lock: the
host can rewrite it"`, and per finding `kind`, `severity`, `ref`, the two hashes and the summary "...all 5 facts the
network states from it are still on it.". There's no price, no list of the lock's sources and no anchor count. A keyed
assistant asked "does my chat still say 89?" would be handed the false reassurance as its evidence.

**Deep link (MAR-L1-11).** `#/drift?target=http://127.0.0.1:4100/` shows the overview, not the drift view, with nothing
filled in (`l2-43-phone-deeplink-query`; `site/shell.js:546` takes the view name from the hash and ignores the rest).

## L2 scored criteria

| # | Criterion | L2 | Change from L1 | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Start with only her address; an answer; no install, no key | **pass** (conditional) | = | `l2-03`, `l2-10` (laptop and phone): address in, reading out, no key. Conditional as at L1: nothing links her to the Desk (issue body, README) and a link cannot carry her address (`l2-43`) |
| 2 | Every word hers, or explained where it appears | **fail** | = | 23 distinct out-of-vocabulary terms in the issue, 16 plus two 64-character hashes on the Desk, 13 in the PR; nautical subtitles add a second vocabulary (`l2-01`) |
| 3 | Page changed and the assistant states an old fact: she is told so, and which page | **fail** | pass to **fail** | On her page she is told the page changed (`rooms.html`) and that "all 5 facts the network states from it are still on it" (`out/issue-body.d1-raise-price.md`, `l2-10`), the opposite of what happened. The sentence L1 relied on ("1 of 6 ... no longer on it") appears only when the price column comes first (`mini/B-pricefirst`) |
| 4 | Told what to do next; a step she can take or forward | **fail** | = | Issue: "run ... --relock" in a clone; Desk: no next step (`site/desk.js:1439-1466`); PR: "accept the drift", which on merge closes everything as clean (`w3`) |
| 5 | Never a reassuring result for something not checked | **fail** | = (stronger) | "all 5 facts ... still on it" when the price was never one of the 5; the clean close after an unsigned relock is merged (`w3`), while `verify` reads invalid |
| 6 | Notification to knowing what to do in under 3 minutes | **fail** | = | Daily cron (generated workflow: `cron` + `workflow_dispatch`, no push trigger); on arrival the reading is wrong, so the time to the *right* knowledge is unbounded |
| 7 | She would rather use this than ask the chat five questions | **fail** | = | On her layout it tells her not to worry; she would have to ask the chat anyway, and every wording edit now costs a Jonas cycle |

**1 of 7 passed** (L1: 2 of 7).

## Findings (L2)

```json
[
  {
    "id": "MAR-L1-01",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "severity_l1": "major",
    "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "high" },
    "impact_l1": { "frequency": "high", "reachability": "med", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "The only remedy the alert offers (relock) silences a stale price without fixing it, and the issue then closes as clean",
    "expected": "When the page no longer states a fact the assistant states, accepting the change either refuses or says plainly that the assistant still states a fact no source supports; the alert stays until the assistant is fixed, or the accept is explicit about what it gives up.",
    "got": "Confirmed live, both ways. CLI on the anchored layout: `watch --relock` with the network still at €89 prints only `changed grounding rooms.html`, the anchors go 6 -> 5, the next watch has no grounding finding. The Action's opt-in `relock-pr`: a draft PR 'Plumbline: accept the drift (relock)' whose 'findings this accepts' row says 'all 5 facts ... still on it'; merged, the next run closes the issue ('Plumbline watch is clean ...') and the PR, the Desk no longer mentions rooms.html, and the network still says €89. Widened: on the fixture layout the price was never anchored, so the PR body itself reassures the person deciding to merge.",
    "evidence": ["action/report.mjs:141-148", "action/report.mjs:219-226", "action/report.mjs:254-266", "src/watch/capture.ts:126-135", "uat/runs/2026-11-18-first-five/evidence/marta/out/pr-body.w1-relockpr-at-raise.md", "uat/runs/2026-11-18-first-five/evidence/marta/out/runner.w3.json", "uat/runs/2026-11-18-first-five/evidence/marta/out/gh-state.arm-W-relock-pr.json", "shots/marta/l2-20-W-after-merge-drift.png", "L2 journal: mini/B2-wrongrelock (anchors 6 -> 5, next watch clean of grounding)"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Done at L2. Recertify: same two arms."
  },
  {
    "id": "MAR-L1-02",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "severity_l1": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "impact_l1": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "After the right fix (network corrected to 95) the alert gets louder and still says the network may state an old fact",
    "expected": "Once the network states what the page states, the stale-fact sentence is gone; what remains says only that the corrected files need re-locking (and signing).",
    "got": "Confirmed live. Fixture layout: the fix adds a second warning (the network: 'the agent now answers from different facts') and the issue gets a COMMENT ('New: warn grounding larch_house.network.json'), so the correct fix notifies the owner of a new warning; the Desk shows 3 findings; verify shows 'INVALID ... Do not treat these files as the publisher's' on her own site until Jonas relocks and signs. Anchored layout (mini/B-pricefirst, network at €95): rooms.html still says '1 of 6 facts ... no longer on it, so the network may now state an old fact'.",
    "evidence": ["src/watch/decide.ts:120-127", "src/watch/anchors.ts:213-218", "uat/runs/2026-11-18-first-five/evidence/marta/out/issue-body.d2-fix-network.md", "uat/runs/2026-11-18-first-five/evidence/marta/out/gh-state.main-path.json", "shots/marta/l2-30-fix-drift-laptop.png", "shots/marta/l2-31-fix-verify.png"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Done."
  },
  {
    "id": "MAR-L1-03",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "severity_l1": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "impact_l1": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "A price written '89 euros' is never anchored, init says nothing, and a changed page then reads 'the agent now answers from different facts' (the opposite of the truth)",
    "expected": "init/relock says how many facts were anchored on each --source page (and warns at 0), currency words are recognised, and a changed un-anchored page says the assistant may still state the page's old facts.",
    "got": "Confirmed live, with the sentence narrowed: 'the agent now answers from different facts' appears only when the page anchors nothing at all (mini/C0-words-only). On a realistic page where other facts anchor (mini/C-words), a price change in words reads 'all 5 facts the network states from it are still on it', the same false reassurance as MAR-L2-01. init prints '3 grounding sources' whether 6, 5 or 0 facts anchored. Breadth beyond currency words is MAR-L2-02.",
    "evidence": ["src/watch/anchors.ts:57", "src/watch/anchors.ts:88-97", "src/cli/init-command.ts:168-176", "src/watch/decide.ts:121-122", "uat/runs/2026-11-18-first-five/evidence/marta/out/anchor-probe.txt", "L2 journal: mini/C-words, mini/C0-words-only"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Done."
  },
  {
    "id": "MAR-L1-04",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "broken-flow",
    "severity": "major",
    "severity_l1": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "impact_l1": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "A real price change on an issue already open for a cosmetic edit is a silent body edit: no comment, no notification",
    "expected": "Going from 'all N facts are still on it' to 'K of N facts are no longer on it' counts as a change in the findings and is announced with a comment.",
    "got": "Confirmed live through the Action (mini/E-esc, price column first): e1 cosmetic -> `issue create` (notifies); e2 raise -> `issue edit` only, 0 comments; the body now says '1 of 6 facts ... no longer on it'. On the fixture layout it is worse: the two bodies are byte-identical, so the plan is `none`.",
    "evidence": ["action/report.mjs:77-93", "action/report.mjs:206-218", "action/action.yml:175-179", "uat/runs/2026-11-18-first-five/evidence/marta/out/gh-state.arm-E-escalation.json"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Done."
  },
  {
    "id": "MAR-L1-05",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "severity_l1": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "impact_l1": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "The alert never names the stale fact ('page says 95, assistant says 89'), only '1 of 6 facts'",
    "expected": "On the publisher's own checkout (their own words, not a stranger's), the watch says which fact the network states that the page no longer does, and what the page states now.",
    "got": "Confirmed live: neither the issue body, the Desk reading, the PR body nor the read_drift tool result contains a price (checked with a currency-anchored pattern; an earlier loose check matched '89' inside a hash and is void).",
    "evidence": ["src/watch/anchors.ts:7-10", "src/watch/decide.ts:127", "uat/runs/2026-11-18-first-five/evidence/marta/out/issue-body.d1-raise-price.md", "shots/marta/l2-13-raise-drift-after-trust.txt", "uat/runs/2026-11-18-first-five/evidence/marta/out/j-tool.json"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Done."
  },
  {
    "id": "MAR-L1-06",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "major",
    "severity_l1": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "impact_l1": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "No plain-words layer for a site owner: the issue title, body and Desk speak only drift/lock/grounding/network/relock/sign and show hex hashes",
    "expected": "An owner-facing line first ('Your rooms page changed; the chat assistant may still quote an old price. Forward this to whoever maintains your assistant.'), with the technical table after it; no 64-character hashes in the default view.",
    "got": "Confirmed live and counted: issue body 143 words, 23 distinct terms outside her vocabulary; Desk reading 236 words, 16 terms and two 64-character hashes; PR body 147 words, 13 terms. Same on a 390 px phone. The overview adds nautical subtitles ('Take a fix', 'Set and drift', 'Read the papers', 'Cast a seal').",
    "evidence": ["action/report.mjs:27", "action/report.mjs:133-150", "site/desk.js:1453-1457", "shots/marta/l2-10-raise-drift-laptop.png", "shots/marta/l2-10-raise-drift-phone.png", "shots/marta/l2-01-setup-overview.png"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Done."
  },
  {
    "id": "MAR-L1-07",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "severity_l1": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "impact_l1": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "effort",
    "title": "Every edit of the rooms page, cosmetic included, opens a warning only Jonas can clear: 'needs Jonas every time'",
    "expected": "An edit that leaves every stated fact on the page is acknowledged without a paid developer cycle (for example info, or an owner-clickable accept that relocks and signs in CI), and the warning severity reflects whether a stated fact went missing.",
    "got": "Confirmed live: cosmetic-edit opened issue #2 (a notification) whose body is byte-identical to the raise-price issue's. Clearing it took Jonas relock, sign, commit, push (4 commands; ~7 commands plus a file edit for a price change). The signed relock PR that could make it one click needs an https origin and a key secret, which Jonas must set up.",
    "evidence": ["src/watch/decide.ts:119", "action/report.mjs:141-148", "action/report.mjs:50-52", "uat/runs/2026-11-18-first-five/evidence/marta/out/issue-body.d4-cosmetic.md", "uat/runs/2026-11-18-first-five/evidence/marta/out/runner.d4.json"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Done."
  },
  {
    "id": "MAR-L1-08",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "time-saved",
    "title": "The news reaches her up to a day late (daily cron, no push trigger) and through a notification she may never get",
    "expected": "A change to a watched page is checked when it lands (a push trigger in the template, scoped to the site folder), and the issue can mention or assign a named owner.",
    "got": "Trigger list confirmed live in the workflow init wrote for the world (`cron: \"17 6 * * *\"`, `workflow_dispatch`, no push). Who GitHub notifies is modelled by the stub only (create and comment notify, a body edit does not); not verifiable without GitHub.",
    "evidence": ["action/templates/plumbline-watch.yml:12-15", "action/action.yml:171-174", "uat/runs/2026-11-18-first-five/evidence/marta/out/world-cli.log"],
    "code_check": "confirmed-absent",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Uncertain: notification reach needs real GitHub. Fixture that closes it: a scratch GitHub repository the owner creates, with Marta's account watching (or not) the repository."
  },
  {
    "id": "MAR-L1-09",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "med" },
    "dimension": "completion",
    "title": "On an ordinary host the Desk cannot read the rooms page (no CORS on HTML pages), and nothing tells the publisher a --source page needs it",
    "expected": "init/--source, the Desk's publish note and the docs say that each grounding page must also be served with Access-Control-Allow-Origin for any browser check, or the Desk says which header is missing.",
    "got": "Confirmed live (act rooms-no-cors): 'A grounding source could not be checked: it could not be fetched (the browser could not read it).' Honest and not green, but it names no header and gives her nothing to send her host. Whether a given host sends the header by default varies by host; not measured here.",
    "evidence": ["site/strings.js:46", "src/watch/published.ts:114-132", "shots/marta/l2-11-raise-nocors-drift-laptop.png"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Done."
  },
  {
    "id": "MAR-L1-10",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "The Desk calls her own signed lock 'unsigned lock: the host can rewrite it' until she trusts her own key",
    "expected": "A lock covered by a signature that is valid but from a key she has not trusted says so ('signed, by a key you have not trusted yet'), distinct from a lock no signature covers.",
    "got": "Confirmed live: fresh profile -> 'unsigned lock: the host can rewrite it' (setup and raise-price) while verify says the signature is internally consistent and the signer unknown; after she trusts the key in this browser -> 'Signed lock: covered by a signature that verified under a publisher you trust.' Every new browser or phone starts over.",
    "evidence": ["site/desk.js:580-584", "shots/marta/l2-03-setup-drift-read.png", "shots/marta/l2-04-setup-verify.png", "shots/marta/l2-13-raise-drift-after-trust.png"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Done."
  },
  {
    "id": "MAR-L1-11",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "low" },
    "dimension": "effort",
    "title": "Nothing leads a site owner to the Desk: no address in README, the issue or init's output, and no link with her address filled in",
    "expected": "The drift issue (and init's next steps) carry a Desk link that opens the drift view with the site's address prefilled, e.g. #/drift?target=...",
    "got": "Confirmed live: the issue body has no Desk link; `#/drift?target=http://127.0.0.1:4100/` shows the overview, not the drift view, and fills nothing.",
    "evidence": ["action/report.mjs:127-155", "site/shell.js:540-553", "shots/marta/l2-43-phone-deeplink-query.png", "uat/runs/2026-11-18-first-five/evidence/marta/out/issue-body.d1-raise-price.md"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Done."
  },
  {
    "id": "MAR-L1-12",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "low", "trust_erosion": "high" },
    "impact_l1": { "frequency": "low", "reachability": "low", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "The assistant, the one surface that could translate, needs her own model key; even keyed it is told to repeat the jargon and cannot see which facts are locked (grounding 5/6, Marta additions 0/2)",
    "expected": "A keyless explanation of a drift reading (fixed templates are enough for a grounding finding), or an assistant instructed to explain findings in the owner's terms with the lock's sources and anchor counts in its tool result.",
    "got": "Confirmed live, keyless: 'Assistant needs your AI provider key', 'API key required', 'LLM provider', providers with 'Billing may be required' (laptop and phone). The live read_drift tool result holds target, lock URL and state, lockSigned:false, the lock label, and per finding kind/severity/ref/two hashes/summary: no price, no sources, no anchor counts. Widened (trust_erosion med -> high): at raise-price the model's only evidence is 'all 5 facts ... still on it', so a keyed assistant would reassure her. The keyed answer itself was not run (no key may be used; a scripted provider needs runtime edits).",
    "evidence": ["site/site.js:61-63", "site/plumbline_desk.hocon:109", "site/desk.js:589-598", "uat/runs/2026-11-18-first-five/evidence/marta/out/j-tool.json", "shots/marta/l2-06-setup-assistant.png", "shots/marta/l2-42b-phone-assistant-viewport.png"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Keyed answer still open: a test-only provider hook in the Desk loading ScriptedModel, or a tester's own key; ask 'does my chat still say 89?' at raise-price."
  },
  {
    "id": "MAR-L1-13",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "broken-flow",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "low", "trust_erosion": "med" },
    "dimension": "completion",
    "title": "Known defect confirmed: once a relock PR is open, the next run cannot update it (push rejected 'stale info'), so a PR accepting the stale price outlives the fix",
    "expected": "After fix-network the open relock PR is updated to the corrected lock (or closed).",
    "got": "Confirmed live with the Action's own step text: `! [rejected] HEAD -> plumbline/relock (stale info)`, step exit 1 (the job goes red), the PR body is not edited and its branch keeps the pre-fix lock (7ef9b47).",
    "evidence": ["action/action.yml:253-254", "action/action.yml:261-265", "uat/runs/2026-11-18-first-five/evidence/marta/out/runner.w2.json"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Done."
  },
  {
    "id": "MAR-L1-14",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "Wiring and wording papercuts: lockSummary never shown; '1 of 1 fact ... are'; init's next step tells you to add --source after you already gave one",
    "expected": "The reason a lock cannot be used is shown; counts agree in number; next steps reflect what was done.",
    "got": "Live: `init --root site --source rooms.html --workflow` printed step 3 'Name the pages whose facts your network states ... --relock --source <page>'. The other two parts were not reached live (no unusable lock, no one-anchor page) and rest on code.",
    "evidence": ["src/cli/init-command.ts:46", "src/watch/decide.ts:118", "src/watch/published.ts:166-195", "uat/runs/2026-11-18-first-five/evidence/marta/out/world-cli.log"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Low."
  },
  {
    "id": "MAR-L1-15",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "trust",
    "strength": true,
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "senior-quality",
    "title": "Strength: with no model, the watch tells a price change apart from a wording change",
    "expected": "The raise-price and cosmetic-edit acts read differently.",
    "got": "Refuted for Marta's site: on the guesthouse's rooms page the raise-price and cosmetic-edit issue bodies are byte-identical ('all 5 facts ... still on it'), on the issue, the Desk and the tool result. The distinction holds only when the price anchors (mini/B-pricefirst: '1 of 6 ... no longer on it' against the control's 'all 6 ... still on it'). L1 measured it on its own throwaway page, whose layout anchored the price. See MAR-L2-01.",
    "evidence": ["uat/runs/2026-11-18-first-five/evidence/marta/out/issue-body.d1-raise-price.md", "uat/runs/2026-11-18-first-five/evidence/marta/out/issue-body.d4-cosmetic.md", "src/watch/anchors.ts:90"],
    "code_check": "n-a",
    "verdict": "refuted",
    "resolution": "n-a",
    "l2_priority": "n-a"
  },
  {
    "id": "MAR-L1-16",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "trust",
    "strength": true,
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "Strength: the Desk's drift view needs no key and no install, and never calls an unread thing clean",
    "expected": "An owner with only an address gets a reading, and gaps are named.",
    "got": "Confirmed live: address in, reading out, laptop and phone; a page it could not read is 'could not be checked', a lock not covered by a verified signature is labelled, and 'Not checked from a browser: ...' sits under every result. Ceiling: it faithfully reports what the lock watches; when the lock never watched the price (MAR-L2-01) or was relocked over it (MAR-L1-01), the reading is calm and wrong.",
    "evidence": ["site/desk.js:1431-1438", "site/desk.js:1464", "shots/marta/l2-03-setup-drift-read.png", "shots/marta/l2-11-raise-nocors-drift-laptop.png"],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "n-a",
    "ceiling": "Honest about what it did not read; silent about what the lock never watched."
  },
  {
    "id": "MAR-L1-17",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L1",
    "type": "trust",
    "strength": true,
    "severity": "polish",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "Strength: the issue and the pull request refuse to oversell: 'clean is not safe', 'nothing is accepted until a person merges', an unsigned relock is a draft",
    "expected": "No verdict greener than what was checked.",
    "got": "Confirmed live from the stub's recorded calls: close comment '(Clean is not safe: it means nothing locked has drifted.)'; PR 'Nothing is accepted until a person merges this', '**Not signed.** ... reads invalid (tampered) until it is signed again ... It stays a draft until then.' Ceiling: after that draft is merged, the close comment says nothing about the signature now reading invalid (MAR-L2-03).",
    "evidence": ["action/report.mjs:150", "action/report.mjs:224-225", "action/report.mjs:274-278", "uat/runs/2026-11-18-first-five/evidence/marta/out/gh-state.arm-W-relock-pr.json"],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "n-a",
    "ceiling": "The words are careful; the clean close after an unsigned merge is not."
  },
  {
    "id": "MAR-L2-01",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L2",
    "type": "trust",
    "severity": "blocker",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "On her real rooms page the price change is invisible as a fact: every surface says 'all 5 facts the network states from it are still on it' while the assistant still quotes €89",
    "expected": "When the page no longer states a price the assistant states, the issue, the Desk and the assistant's tool result say that a stated fact is gone (and which page); a wording-only edit reads differently.",
    "got": "Reproduced live: the guesthouse's price table (Room | Sleeps | Price, '€89 per night') anchors 5 facts, not the room prices: the money pattern reads the Sleeps cell and the symbol as '€2' ('2 €'). After raise-price the issue (#1), the Desk at laptop and phone width and the read_drift tool result all say 'all 5 facts ... still on it'; the issue body is byte-identical to the cosmetic-edit one. The owner is told the opposite of what happened, and a keyed assistant would repeat it.",
    "evidence": ["src/watch/anchors.ts:90", "src/watch/anchors.ts:132-152", "uat/fixtures/README.md:119-126", "uat/runs/2026-11-18-first-five/evidence/marta/out/issue-body.d1-raise-price.md", "uat/runs/2026-11-18-first-five/evidence/marta/out/issue-body.d4-cosmetic.md", "shots/marta/l2-10-raise-drift-laptop.png", "shots/marta/l2-10-raise-drift-phone.png", "uat/runs/2026-11-18-first-five/evidence/marta/out/j-tool.json", "uat/runs/2026-11-18-first-five/evidence/marta/out/anchor-probe.txt"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l1_missed": "L1 measured anchoring on its own throwaway page, whose layout anchored the price ('1 of 6'), and recorded the distinction as a strength (MAR-L1-15).",
    "l2_priority": "Recertify: larch-house raise-price, unchanged fixture; the issue and the Desk must say a stated fact is gone, and cosmetic-edit must not."
  },
  {
    "id": "MAR-L2-02",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L2",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "senior-quality",
    "title": "Many common ways a real page writes a price, time or phone number are never anchored, and nothing tells the publisher which facts are watched",
    "expected": "Either the common forms anchor, or init/relock lists (to the publisher, in their own checkout) which stated facts each --source page anchors and which it does not, so a gap is seen at setup, not after a wrong price.",
    "got": "Probe of the built extractLiterals(reduceToText()) over 36 forms. NOT anchored: a symbol-first price after any number cell (Sleeps 2, Room 4, Summer 2027 -> €2027, 7 nights, '2 | £89'); a 3-digit cell after a price ('€89 | 120' -> €89120); currency words; times '15.00', '10.30am', '15h'; phones '01632 960418', '+44 (0)1632 960418'; a phone or e-mail only in a tel:/mailto: link. Anchored: price column first, prose, symbol after the number, ISO codes, decimals, entities, split spans, '15:00', '3pm', international phones, plain e-mails. End to end (real CLI, with controls): price-first counts the change, season row and words do not. init prints only '3 grounding sources' in every case.",
    "evidence": ["src/watch/anchors.ts:58", "src/watch/anchors.ts:90", "src/watch/anchors.ts:105", "src/watch/anchors.ts:118", "src/watch/anchors.ts:162-174", "src/cli/init-command.ts:168-176", "uat/runs/2026-11-18-first-five/evidence/marta/anchor-probe.mjs", "uat/runs/2026-11-18-first-five/evidence/marta/out/anchor-probe.txt"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Recertify by re-running anchor-probe.mjs and the mini-site arms."
  },
  {
    "id": "MAR-L2-03",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L2",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "med", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "After an unsigned relock is merged, the watch is clean and closes the issue while every verifier reads the site invalid (tampered); nothing in the watch or the close comment says so",
    "expected": "A watch over a signed site notices that the published signature no longer covers the files' current hashes (no trust store needed for that), and a close comment never says clean while the site's own signature is broken.",
    "got": "Live (arm W): PR #2 (unsigned draft) merged; next run findings=0, issue closed 'Plumbline watch is clean ...', PR closed. The Desk's verify: 'INVALID: A SIGNED FILE CHANGED, OR IS MISSING'. The watch reads the signature only for expiry.",
    "evidence": ["src/watch/decide.ts:352-392", "src/watch/detectors.ts:205-216", "action/report.mjs:219-226", "uat/runs/2026-11-18-first-five/evidence/marta/out/runner.w3.json", "shots/marta/l2-21-W-after-merge-verify.png"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l1_missed": "L1 traced the relock to a clean issue but not the signature state after an unsigned merge.",
    "l2_priority": "Recertify: arm W (relock-pr, merge without signing), assert the next run is not clean or says the signature no longer covers the lock."
  },
  {
    "id": "MAR-L2-04",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L2",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "med", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "After she trusts the key, the Verify card says VERIFIED but the status line (aria-live) still says 'Verify finished: Unverifiable.'",
    "expected": "One verdict on the page: the status line follows the re-verification.",
    "got": "Live: trustPublisher re-verifies and re-renders the card and the notice, never #verify-status; a screen reader announces the stale 'Unverifiable'.",
    "evidence": ["site/desk.js:846-866", "site/desk.js:1897", "uat/runs/2026-11-18-first-five/evidence/marta/out/j-trust.json", "shots/marta/l2-12-raise-verify-after-trust.png"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l1_missed": "A rendering defect L1 could not see.",
    "l2_priority": "Recertify: trust from the verify view, read #verify-status."
  },
  {
    "id": "MAR-L2-05",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L2",
    "type": "confusion",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "The Desk's landing shows a large green 'Passed' (an example about another site) and a second, nautical vocabulary before she has checked anything",
    "expected": "A first-time owner lands on 'What do you want to know about your site?' with her address field, not on another site's verdict.",
    "got": "Live: a big 'Passed' card ('EXAMPLE · AGENT CUSTOMS') and three 'Passed' circles, labelled as examples; the ports carry 'Take a fix', 'Set and drift', 'Read the papers', 'Cast a seal', 'Sign the manifest'. Labelled honestly; whether she misreads it is inference, so polish.",
    "evidence": ["shots/marta/l2-01-setup-overview.png", "shots/marta/l2-41-phone-overview.png"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "resolution": "open",
    "l1_missed": "Visual; L1 read strings, not the layout."
  }
]
```

Rank (low=1, med=2, high=3): MAR-L2-01 27 (a blocker by the rubric's definition: she cannot finish the job, because the
product tells her the stale fact is still on the page); MAR-L1-02 27; MAR-L1-01, -03, -04, -05, -06, -07 and MAR-L2-02
18; MAR-L1-09, -10 and MAR-L2-03 12; MAR-L1-08 9; MAR-L1-11 6; MAR-L1-12 3 (trust erosion widened); MAR-L1-13 and
MAR-L2-04 4. Tally of the 17 L1 findings: **15 confirmed, 1 refuted (MAR-L1-15), 1 uncertain (MAR-L1-08)**.

### The product owner's HYPOTHESIS, settled with evidence

*"A non-technical owner cannot onboard to or operate this product today, and the experience may need to be led by an
assistant or guided in the page."* **Partly true, and aimed at the wrong first stop.** Marta never has to onboard: Jonas
does (`init`, `sign`, the workflow). She *can* operate the one part built for her: the Desk's drift view took only her
address, with no key and nothing to install, at laptop and phone width. Where she stops, in order:

| # | Surface | Exactly where | Why she stops | What a guided or onboarding experience would have to do there (described, not designed) |
| --- | --- | --- | --- | --- |
| S1 | GitHub notification | Subject "Plumbline drift"; the word "drift"; arriving up to a day later (daily cron) | She doesn't know the word and reads it as spam; it comes the next day, not "within a few minutes" | Reach her when the page changes, named after her site and page, saying in one line that it may concern what the chat tells guests |
| S2 | Issue, first line | "Plumbline watch found drift since `plumbline.lock.json` was written." | Two unknown terms before any meaning | Open with what happened in her words, before any table |
| **S3** | **Issue row / Desk finding** | **"... all 5 facts the network states from it are still on it."** (the words "still on it") | **Not a comprehension stop but a false all-clear: on her page the €89 was never watched.** She stops because she is told she can. | No guidance can carry her past this stop: a guided layer would faithfully translate "all 5 facts still on it" into "your assistant is fine". It would have to know which facts are watched and say so. The only place that gap can be caught early is Jonas's setup: `init` says "3 grounding sources" and never "watching check-in, check-out, breakfast, phone, e-mail; NOT the room prices". |
| S4 | Issue, next step | "in a clone of xkazm04/plumbline ... run `node dist/cli/index.js watch ... --relock`" (the words "run", "clone") | Her pet peeve; and nothing says "forward this to Jonas" | Say who acts (whoever maintains the assistant) and give her the one thing to forward; keep the commands for that person |
| S5 | Desk, getting there | No link in the issue or the README; `#/drift?target=` opens the overview | She must be told the address and type her own | A link from the alert that lands on her reading |
| S6 | Desk, landing | "Five ports of call", "Take a fix", "Set and drift"; a large "Passed" example | A second vocabulary between her and her question | Start from her question about her site |
| S7 | Desk, result | "unsigned lock: the host can rewrite it" (her site is signed); two 64-character strings; "the upstream nsdeploy commit"; with an ordinary host, "could not be fetched (the browser could not read it)" | Reads as an accusation, a wall of letters, or a dead end with nothing to ask the host | Explain each label in one sentence where it appears; for the header, a line she can send her host |
| S8 | Desk, assistant | "Assistant needs your AI provider key." / "API key required" / "LLM provider" / "⚙ Developer" | A hard stop by her own rule ("Having to bring my own 'API key'") | Explain a drift reading without her key; an assistant-led flow that needs her key never starts for her. Keyed, it would be fed S3's sentence (live tool result) |
| S9 | After Jonas's correct fix | A new comment "New: warn grounding `larch_house.network.json`"; verify "INVALID ... Do not treat these files as the publisher's" | The right fix looks like a new, worse problem on her own site | Tell her the fix landed and what is still pending (a re-lock and signature by Jonas), without the stranger-danger wording |
| S10 | Relock PR (opt-in) | "Plumbline: accept the drift (relock)" listing "all 5 facts ... still on it" | The one green button she could press, and it reads as safe; merged, everything closes as clean (S3 plus MAR-L1-01, MAR-L2-03) | Before offering acceptance, say what accepting gives up, in her words |

So the hypothesis holds for the comprehension stops (S1, S2, S4 to S9), and an in-page guide could carry her past most
of them. It does **not** hold for the decisive stop, S3. That one is a detection failure, and a guided or
assistant-led layer built on today's sentences would make it more convincing, not less. The assistant-led variant is
also blocked at S8 by the key she will never bring.

## L2 verdict

**L2-fail.** A blocker is confirmed live (MAR-L2-01): on the guesthouse's own rooms page, the product tells the owner
that the facts are still on the page after the price changed, on every surface she can reach. The path L1 certified
(the issue says "1 of 6 facts ... no longer on it") exists only for pages whose price column comes first. Even there,
every L1 major holds live (false clean after relock, louder alert after the right fix, silent escalation, no fact
named, no plain words, a Jonas cycle per edit).

- **Criteria:** 1 of 7 (L1: 2 of 7; criterion 3 went from pass to fail).
- **Time saved**, against her 15 minutes of asking the chat by hand. On her page: **none, and worse than none**. She
  reads the issue (about 3 to 5 minutes) and is told all facts are still there; if she believes it, the stale price
  stays and the minutes "saved" buy the booking-portal failure she fears. If she doesn't, she asks the chat anyway (+15).
  Every wording edit adds a read and a paid Jonas cycle (4 commands; about 7 plus a file edit for a price change).
  On an anchored layout: about 7 minutes per change, as L1 estimated, still needing Jonas to close it.
  **Confidence: medium** (live, one host, one layout family; notification timing not measured).
- **Grounding** (assistant): 5/6 shared, as L1 (the lock's contents still absent, confirmed in the live tool result);
  Marta additions 0/2, confirmed live.
- **What the L1 surface model missed:** MAR-L2-01 (L1 tested anchoring on its own page, not the world's layout, and
  booked the distinction as a strength, MAR-L1-15, now refuted); MAR-L2-02 (the breadth of unanchored forms);
  MAR-L2-03 (the clean close while the signature reads invalid); MAR-L2-04 (a stale status line, a rendering defect);
  MAR-L2-05 (the landing's examples and nautical vocabulary). It also predicted "the agent now answers from different
  facts" for a price in words, which appears only on a page with no anchored fact at all.

## Character feedback (L2)

I did what Jonas said. I changed the double to 95, and next morning there was a note about my rooms page. It said all
five facts are still on it. All five! So I thought, good, the chat is fine. It wasn't. It was still telling people 89,
and the one thing that was supposed to catch that told me not to worry. At L1 I thought my problem would be the words.
The words are bad, twenty-odd of them I'd have to look up, but the worse thing is that when I finally understood a
sentence, it was wrong.

Then a week later I fixed a typo in the introduction and got exactly the same note, word for word. So now a warning
from it means either "nothing happened" or "your price is wrong", and I can't tell which. That's the red-warning-that's-
nothing I hate, except one of them isn't nothing.

The checking page itself was easier than I expected. I typed my address on my phone and got an answer without a key or
an install, and when it couldn't read my page it said so instead of pretending. I'll give it that. But it calls my site
"unsigned" until I've typed in Jonas's sixteen letters on every device, it shows me two long strings of letters and
numbers, and the chat button asks me for an "API key" straight away, so that's closed. When Jonas fixed it properly, the
page told me in red "Do not treat these files as the publisher's". The publisher is me.

And the button that says "accept the drift": if I'd pressed it, everything would have gone quiet and said "clean" while
the chat kept saying 89. That's the booking portal again, with a tick on it this time.

Would I adopt it? Not as it is. Would I trust it? Less than before I tried it, because it told me something false in a
calm voice. Would I tell the woman up the valley? No. I'd tell her to ask her chat what a double room costs every time
she changes a price. That's still what I do.

## Residue

- **Inside this run folder (kept as evidence):** `shots/marta/l2-*` (20 screenshots with `.aria.yml` and `.txt`), and
  `evidence/marta/`: `gh-stub.mjs`, `run-action.mjs`, `anchor-probe.mjs` (reusable for recertify) and `out/` (34 files:
  issue and PR bodies, watch reports, relock output, the stub's state per arm, runner journals, browser journals, the
  world's `cli.log`, the probe output). No key material: checked; the runner never signs, and `cli.log` holds key file
  *paths* only.
- **Outside the world's temp folder and this run folder:** `dist/` and `site/lib/plumbline/` rebuilt by `npm run build`
  and `npm run build:site` (git-ignored build output; `git status` shows no tracked change). Scratch files in the
  session scratchpad (`up1.json`, `j-*.json` browser journals, also copied to `out/`, `jargon.mjs`, `prbody.md`). No git
  config was written (the runner passes `url.insteadOf` and `core.autocrlf=false` through `GIT_CONFIG_*` env); the
  world's two git repositories and bare remotes lived in the world folder.
- **Calls to public services:** the Desk's check view sent `http://127.0.0.1:4100/` to Agent Atlas and read Agent
  Customs' receipts once (at `setup`); each `watch --root` asked the GitHub API for the runtime upstream (rate-limited
  from the first call). No call to a model provider.
- **Keys:** the world's own throwaway key (`<world>/keys/larch-house`) was used twice through `plumbline sign --key` as
  Jonas; its file was never read or copied. No key under the repository was touched.
- **Teardown:** `world.mjs down larch-house`: `stopped: true`, `portsStillInUse: []`, `folderGone: true`,
  `leftovers: []`; no `plumbline-uat-larch-house*` folder or state file remains; `netstat` shows only TIME_WAIT/FIN_WAIT
  sockets with PID 0 on 4199, nothing LISTENING on 4100, 4101 or 4199.

---

## Recertify 2026-11-18

Independent recertifier (did not write the fixes). Range under test: `15af680..c9f6a3b` (36 commits; the ones that
touch J1 are UAT-1 `a2d1e1c`, UAT-2 `bc0064b` `6468e3d`, UAT-3 `010120a`, UAT-5 `a8599e6`, UAT-6 `68c35d2`, UAT-7
`5e699b5` `da9f3ce`, and the template pins). The fixer's `- State:` lines in `docs/BACKLOG.md` were read as hypotheses.
Shots: `uat/runs/2026-11-18-first-five/shots/marta-recert/rc-*`. Everything else the walk produced (runner journals,
issue and PR bodies, the stub's state per arm, browser journals, probes, the break-arm script and its output, each
world's `cli.log`) is in `uat/runs/2026-11-18-first-five/evidence/marta-recert/` (`out/`).

### Freshness and fixture checks

- **Freshness.** HEAD `c9f6a3b`, committed 2026-11-18 14:53:09 +0100. `npm run build` exit 0, `npm run build:site`
  "28 browser modules in site/lib/plumbline/" exit 0; `dist/cli/index.js` and `dist/watch/anchors.js` 14:55:32, the
  browser modules 14:55:33. `dist/` is newer than the last commit. The Desk served by every world is this checkout's
  `site/` (read-only).
- **Fixtures untouched.** `git diff 15af680..HEAD --stat -- uat/fixtures uat/characters uat/journeys uat/rubric.md`
  printed nothing (exit 0). The product was not made to pass by changing the world, the Character, the journey or the
  rubric. `uat/fixtures/README.md`'s "Confirmed" sentences for larch-house still describe the old product ("all 5
  facts ... still on it"); they were not used as current.
- **Arms and worlds.** Four fresh `larch-house` worlds, one after another: W1 main path (setup, raise-price,
  rooms-no-cors, fix-network, Jonas closes), W2 control (cosmetic-edit, then raise-price on the open issue, then a
  second wording edit), W3 the issue's own remedy (raise-price, relock without fix-network, sign), W4 arm W with a real
  pull request (setup as the world leaves it, raise-price, a temporary fix-network rolled back, Marta merges the
  unsigned draft). Each `down` reported `portsStillInUse: []`, `folderGone: true`, `leftovers: []`.
- **Signing.** The brief forbids using any key under a `keys/` folder, so the world's own `keys/larch-house` was never
  used. In W1 to W3 Jonas's baseline is the original L2's (a harness relock to pin the loopback bike peer, a world rule)
  signed with a throwaway key made by `plumbline keygen --out <world>/jonas-recert` (outside `keys/`), whose public
  record replaced the site's `.well-known/plumbline-key.json`; its private file was passed to `sign --key` and never
  read. W4 was not re-signed (the world's own `setup` signature only). Each world's baseline run was clean (`findings=0`,
  plan `none`) except W4, which keeps the pending peer on purpose.

### Journal

*As at L2: **Marta** paragraphs are her surfaces (the Desk, the issue and pull request pages); **Jonas** paragraphs are
what he has to do for her.*

**Setup.** **Marta.** The landing is unchanged: "PASSED ... VALIDATOR PORT Passed AGENT ATLAS Passed AGENT CUSTOMS
Passed ... EXAMPLE · AGENT CUSTOMS", then "FIVE PORTS OF CALL 1. Check a site Take a fix 2. Read drift Set and drift"
(`rc-01-setup-overview`; `expectMatch` matched "Passed" and "Take a fix"). "Read drift" with my address: "Drift read: 1
finding, Warning. **Lock signed by a key you have not trusted.**" and "Signed lock, by a key you have not trusted: until
you trust that key, the host could rewrite it." (`rc-02-setup-drift`). It no longer calls my site unsigned. **Jonas.**
`init --root site --source rooms.html --workflow` (the world's setup, `out/w1/world-cli.log`) now prints what it
watches:

```
facts the network states: 9 (3 prices, 4 times, 1 phone number, 1 e-mail address)
facts rooms.html: watches 7 (3 prices, 2 times, 1 phone number, 1 e-mail address); not on it: 2 (2 times: 07:00, 22:00)
facts not watched on any page: 2 (2 times: 07:00, 22:00); a change to them is not seen until a --source page states them
```

and its step 3 points at those lines. It names the literals it does NOT watch (the quiet hours), and only the kinds of
those it does.

**Act `raise-price`.** **Jonas, real CLI:** `warn grounding rooms.html: A grounding source changed since the lock was
written; 1 of 7 facts the lock watches on it (facts the network states) is no longer on it, and the network still
states it (1 price), so the agent may now answer with an old fact.` **Marta, the issue** (run `r1-raise`, `gh issue
create`, notifies; `out/issue-body.r1-raise.md`): the same sentence in the rooms.html row, under the unchanged first
line "Plumbline watch found drift since `plumbline.lock.json` was written." and the unchanged next step "in a clone of
xkazm04/plumbline ... run `node dist/cli/index.js watch --root <path to your site> --relock`, sign the site again". 167
words; 22 of the 28 counted terms outside her vocabulary (`evidence/marta-recert/jargon.mjs`; the L2 body: 143 words,
21 on the same list). **Marta, the Desk** at 1280 px and 390 px (`rc-10-raise-drift-laptop`, `rc-10-raise-drift-phone`;
`scrollWidth` 1280 and 390): "Drift read: 2 findings, the worst Warning. Lock signed by a key you have not trusted.",
then "GROUNDING (1) · WARNING · rooms.html" with the sentence above (`expectMatch` matched "1 of 7 facts the lock watches
on it (facts the network states) is no longer on it, and the network still states it (1 price), so the agent may now
answer with an old fact"). Three checks FAILED, as findings, not driver faults: no price with a currency is named
(`/€\s?(89|95)\b|\b(89|95)\s?€|EUR\s?(89|95)/`, match null), the two 64-character hashes are still in the default view
("locked 87b52e6f…7fbee · now fb8204b4…0c12"), and no next step is named (`/forward|send this|ask .. developer|re-?lock|
whoever maintains/`, match null). **The assistant's tool result** (`App.page.readDrift` called in the live page, as
`read_drift` calls it; `j-raise-laptop.json` notes): `lockCover: "untrusted"`, the label above, and the rooms.html
summary with "(1 price) ... old fact" (matched); a check for what the lock watches (`"watched"|"sources"|"coverage"`)
FAILED: the lock's sources and kinds are still not in it.

So the price change is now visible as a fact, on the unchanged fixture, on every surface I can reach. I still can't
tell from it which price, and "network" and "agent" are still not my words; but I know it's my rooms page and that the
chat may now quote an old price. I'd forward it to Jonas, though nothing tells me to.

**Deep link (MAR-L1-11).** A fresh context on `#/drift?target=http://127.0.0.1:4100/` shows the overview: `driftVisible:
false, value: ""` (`rc-12-deeplink-fresh`; FAILED). (The same-page attempt `rc-11-deeplink` showed a filled field only
because the previous step had typed it: not evidence of a prefill.)

**Trusting Jonas's key (MAR-L1-10, MAR-L2-04).** Verify before trust: "UNVERIFIABLE ... You have not met this signer
yet" (`rc-13-raise-verify-before-trust`). After ticking "I compared this key id" and "Trust this publisher for this
origin", the card reads "VERIFIED ... Trusted. The site was verified again under your trust store: the verdict above is
the new one." while `#verify-status` (aria-live) still reads "**Verify finished: Unverifiable.**"
(`rc-14-raise-verify-after-trust`; `expectMatch` FAILED, match null). Read drift again: "Signed lock." / "Signed lock:
covered by a signature that verified under a publisher you trust." (`rc-15-raise-drift-after-trust`). A new browser
starts at "a key you have not trusted" again (the next script's fresh context did). **The assistant button**: "Assistant
needs your AI provider key. Add it in AI model settings below." (`rc-16-assistant`).

**Act `rooms-no-cors`.** `curl -I`: no `Access-Control-Allow-Origin` on `/rooms.html`, `*` on the lock. **Marta, Desk**
(`rc-17-raise-nocors-drift`): "A grounding source could not be checked: it could not be fetched (the browser could not
read it)." Not green (matched); names no header (`/Access-Control-Allow-Origin|CORS|ask your host/`, FAILED). Then
`rooms-cors`.

**Act `fix-network` (the right fix).** **Jonas, real CLI**: network "the agent now answers from different facts: review
the change, then re-lock (watch --relock)."; rooms.html "... 1 of 7 facts ... is no longer on it, and the network no
longer states it either, so no stale fact is left: review the change, then re-lock (watch --relock)."; and `block
grounding plumbline.signature.json: The site's signature no longer covers its files: 1 of 3 signed files differs from
the signed version or is missing (larch_house.network.json), so verifiers now answer invalid (tampered) until the site
is signed again (plumbline sign).` **Marta, the issue** (`r2-fix`: `issue edit` and `issue comment`, notifies;
`out/issue-body.r2-fix.md`). The comment opens:

> **A new `block` finding.** Look before the next release.
>
> New:
> - **block** grounding `plumbline.signature.json`: The site's signature no longer covers its files: ...
> - **warn** grounding `larch_house.network.json`: ... the agent now answers from different facts: review the change, then re-lock (watch --relock).

**Marta, Desk** (`rc-20-fix-drift`): "Drift read: 3 findings, the worst Warning. The lock's signature does not hold.",
"The signature over this lock does not hold (verify says why): the host may have rewritten it.", the rooms.html
"no stale fact is left" (matched) and no "old fact" anywhere (negative check passed). Verify (`rc-21-fix-verify`):
"INVALID: A SIGNED FILE CHANGED, OR IS MISSING ... Do not treat these files as the publisher's." The false sentence is
gone. The day Jonas fixes my chat thing, I get the loudest message of the whole journey.

**Jonas closes it.** Real CLI `watch --root site --relock`: "changed grounding larch_house.network.json / changed
grounding rooms.html", the facts lines, and "A peer could not be re-read (it is not an https address), so the lock
keeps its earlier pin (recorded 2026-11-18)" (the real CLI's relock no longer drops the harness-pinned peer: 1 peer
before and after). `sign`, commit, push; `r3-closed`: `issue close` with "Plumbline watch is clean ... and the site's
signature, if it has one, still covers its files. Closing. (Clean is not safe: it means nothing locked has drifted.)"
For one price change Jonas still does: read the forwarded issue, edit the network JSON, relock, sign, commit, push,
dispatch or wait (about 6 commands and a file edit).

**Control arm, fresh world W2: `cosmetic-edit`.** Real CLI and issue #1 (`c1-cosmetic`, created, notifies): "... all 7
facts the lock watches on it (facts the network states) are still on it, so what changed is something the lock does
not watch." `diff` against the raise-price body: the rooms.html row differs, nothing else. Desk (`rc-30-cosmetic-drift`):
the same sentence (matched), no "old fact" (negative passed). **The two acts now read differently.** It is still a
Warning, still an issue, still a Jonas cycle to close.

**Escalation on an open issue (MAR-L1-04), W2.** `raise-price` on top: `c2-raise-on-open` = `issue edit` + `issue
comment` (notifies): "New: - **warn** grounding `rooms.html`: ... 1 of 7 facts ... is no longer on it, and the network
still states it (1 price), so the agent may now answer with an old fact." **Then a second wording-only edit** (breakfast
"eggs, bacon and honey", a page-editor change): `c3-second-wording` = `issue edit` + `issue comment` (notifies), "New:"
and **the same sentence again**: nothing new is stale, but I am told "New". (`out/gh-state.escalation.json`.)

**The issue's own remedy, W3 (MAR-L1-01, CLI).** Raise-price, `r1` opens issue #1; with `relock-pr: true` the PR plan
is `none`: the relock would change nothing ("What the new lock changes: no ref changed (only the capture times)",
`out/w3/pr-body-planned-not-opened.w1.md`), so no "accept the drift" pull request is offered at all. Jonas follows the
issue's own instruction with the real CLI, network still €89:

```
relock: wrote plumbline.lock.json (the previous lock was found)
no ref changed
facts rooms.html: watches 6 (2 prices, 2 times, 1 phone number, 1 e-mail address); not on it: 3 (1 price, 2 times: EUR 89, 07:00, 22:00)
warn  grounding rooms.html: Not accepted: the network still states 1 fact this page no longer states (1 price), and no other locked page states it, so the agent may answer with an old fact. The lock keeps its earlier record of this page, so every watch still reports it: correct the network (or the page), then re-lock, or take the page out with --drop.
```

He signs, commits, pushes: the next real CLI watch still says "1 of 7 ... (1 price) ... old fact" (exit 1), and the
Action's next run keeps issue #1 open (plan `none`, no close). Following the alert's own advice no longer ends in a false
clean.

**Arm W with a real pull request, W4.** The site as `setup` leaves it (peer pending), `relock-pr: true`. `v0`: issue #1
and draft PR #2 "Plumbline: accept the drift (relock)" (both notify; the relock captures the peer). `raise-price`, `v1`:
PR #2 edited, branch pushed to the existing branch (`d972990`), every step exit 0. Its body now opens with:

> **What this relock does not accept, or keeps as it was** (these keep reporting after a merge):
> | warn | grounding | rooms.html | Not accepted: the network still states 1 fact this page no longer states (1 price), and no other locked page states it, so the agent may answer with an old fact. ... |

and rooms.html is not under "The findings this accepts" (only the peer). Temporary `fix-network`, `v2-fix-temp`: PR #2
edited, branch moved to `491049a`, whose network says "double room costs €95" (MAR-L1-13: the push the L2 saw rejected
"stale info" now succeeds). Rolled back (`git revert`), `v3b-rolled-back`: branch `fea0321`, network €89 again, body
back to "Not accepted". **Marta presses the merge button** (merged unsigned into `main`; the stub PR marked merged as
GitHub would). `v4-after-merge`: **issue #1 stays open**, comment (notifies) "**A new `block` finding.** ... block
grounding `plumbline.signature.json`: The site's signature no longer covers its files: 1 of 3 signed files differs ...
(plumbline.lock.json) ..."; the body still carries the rooms.html stale price. Desk after the merge
(`rc-40-W-after-merge-drift`): rooms.html "... network still states it (1 price)" (matched) and "The signature over
this lock does not hold" (matched); verify INVALID (`rc-41-W-after-merge-verify`). The green button is no longer a trap.

**Trying to break it (Jonas's setup, then the page Marta edits).** All in the world folder, real CLI (`init --root site
--source rooms.html`, edit, `watch --root site`), each a copy of the pristine fixture site
(`evidence/marta-recert/mini.mjs`, output `out/mini.out.txt`); and the built anchor functions over more forms
(`probe2.mjs`, `out/probe2.out.txt`). The L2 probe re-run (`out/anchor-probe.recert.txt`): **36 of 36 forms anchored
and counted** (L2: 23).

| Arm | What Marta's page does | init (Jonas's terminal) | watch after the edit |
| --- | --- | --- | --- |
| M1 | a twin room at the same €89; she raises the double only | "watches 7 (3 prices ...)": no hint | **"all 7 facts ... are still on it, so what changed is something the lock does not watch."** (false: the double's €89 was watched; the twin's €89 hides the change) |
| M2 | a winter offer: `<del>€89</del> €79 per night this winter` | "watches 7" | **the same false all-clear** (the struck price is still "on" the page) |
| M3 | control: check-in 15:00 rewritten "3pm" | "watches 7" | "all 7 ... still on it, so what changed is something the lock does not watch" (right: same fact) |
| M4 | the intro also says "Doubles from €89"; she changes the table | "watches 7" | **the same false all-clear** |
| M5 | `EUR89` (no space) | "not on it: 3 (1 price, 2 times: EUR 89, 07:00, 22:00)" | "all 6 ... still on it, so what changed is something the lock does not watch" (true; named at setup) |
| M6 | "eighty-nine euros a night" | names EUR 89 as not on it | as M5 |
| M7 | "from 3 o'clock" | names 15:00 as not on it | as M5 |
| M8 | phone "01632 96 04 18" | names "the phone number ending 960418" | as M5 |
| M9 | prices filled in by a script (empty cells) | names EUR 89 | as M5 |
| zero | a page with none of the network's facts | `warn grounding rooms.html: No fact is watched on this page: none of the 9 facts ...` (init exit 1) | "the lock watches no fact the network states on it, so whether the network now states an old fact is not checked" (honest) |

Probe2, 29 more forms: 15 anchored and counted (`€ 89`, `89€`, `89,- €`, `89 Euro`, `<sup>€</sup>89`, `€89pp`, two
season ranges, `€&nbsp;89`, `&#8364;89`, a booking-form `<option>`, `+44 (0) 1632 960 418`, `01632-960-418`,
`(01632) 960418`, `Tel 01632960418`); 13 not anchored, which init names by value as not on the page (`EUR89`, `Euro 89`,
"eighty-nine euros", JSON-LD only, an image's alt, `3 o'clock`, `from 3`, `3-6pm` (read as 18:00 only), `15 Uhr`, `noon`,
a bare `15.00` cell, `1500 hrs`, `01632 96 04 18`); 1 anchored but **not counted**: the struck-through offer. **What setup tells Jonas now:** per page, the count and kinds
it watches, and by value what the network states that the page does not (and that no page watches). It does not say
which prices are watched, and it cannot see that one value stands for two facts (M1).

### Per-finding table

"Reachable" is for Marta's surface binding (the Desk, the issue and pull request pages); a CLI-only change is reachable
only through Jonas.

| Id | Landed | Reachable for Marta | Unblocks her job | Resolution | Ceiling / what is missing |
| --- | --- | --- | --- | --- | --- |
| MAR-L2-01 (blocker) | yes (`a2d1e1c`) | yes: issue, Desk 1280 and 390 px, tool result | yes: on her unchanged page she is told a price is no longer on rooms.html and the chat may quote an old one; cosmetic reads differently | **resolved-verified** | the price is a kind ("1 price"), never a value; a value that stays elsewhere on the page hides the change (MAR-RC-1); a fact written in a form the watch does not read is named only to Jonas at setup |
| MAR-L2-02 | yes | the anchoring yes; the "not watched" list only in Jonas's terminal | yes, for the forms on her page | **resolved-verified** | 36/36 L2 forms and 15/29 new forms anchor and count; 13 do not and are named by value at init; once set up, a change to an unwatched fact reads "something the lock does not watch" on her surfaces |
| MAR-L1-01 | yes (`bc0064b`, `6468e3d`) | yes: the PR page; the issue stays open | yes: the relock and the PR refuse to accept the stale price; no PR is offered when it is the only change | **resolved-verified** | `--relock --drop rooms.html` still removes the page and its alert; the PR is still titled "accept the drift" |
| MAR-L1-02 | yes | yes | yes: "no stale fact is left: review the change, then re-lock" on the issue and the Desk | **resolved-verified** | the right fix is now announced as "A new `block` finding" (MAR-RC-2), and the Desk and verify say "the host may have rewritten it" / "Do not treat these files as the publisher's" about her own site until Jonas signs |
| MAR-L1-03 | yes | yes | yes: "89 euros" anchors; zero-anchor pages read "is not checked"; init warns at zero | **resolved-verified** | a network written entirely in words prints "facts the network states: 0 (none)" at init with no warning; number words ("eighty-nine") never anchor |
| MAR-L1-04 | yes (`68c35d2`) | yes (the comment notifies) | yes | **resolved-verified** | every later edit while the issue is open is announced "New:" with the same sentence (MAR-RC-3) |
| MAR-L1-05 | partly: the kind and count ("1 price") | yes | partly: she can infer the double from "1 price" only because she just changed it | **open** | no surface names 95 or 89 (the currency-anchored check FAILED on the Desk; the issue body has none) |
| MAR-L1-06 | no (UAT-29 not built) | n-a | no | **open** | issue 167 words, 22 terms; Desk 9 terms plus two 64-character hashes; landing unchanged |
| MAR-L1-07 | no (declined, DC-1) | n-a | no | **open** | cosmetic still opens a notifying warn issue only Jonas can close; it now reads differently from a price change |
| MAR-L1-08 | no (UAT-30 not built) | n-a | no | **open** (reach uncertain) | the written workflow: `cron: "17 6 * * *"` and `workflow_dispatch` only |
| MAR-L1-09 | no (UAT-29) | n-a | no | **open** | "could not be fetched (the browser could not read it)", no header named |
| MAR-L1-10 | yes (`da9f3ce`) | yes | yes: her signed site is never "unsigned" | **resolved-verified** | every new browser starts at "signed by a key you have not trusted ... the host could rewrite it" until she compares 16 characters with Jonas |
| MAR-L1-11 | no (UAT-29) | n-a | no | **open** | fresh deep link: overview, empty field |
| MAR-L1-12 | no (UAT-31; DC-3) | n-a | no | **open** | needs her key; the tool result has no lock sources or kinds (grounding 5/6). Its L2 widening is reversed: the tool's evidence is no longer the false all-clear |
| MAR-L1-13 | yes (`a8599e6`) | yes: the PR page shows the latest lock | yes | **resolved-verified** | `relock-pr` is opt-in; a real runner and branch protection are not exercised |
| MAR-L1-14 | one of three parts | yes | n-a | **open** | "1 of 1 fact ... is" fixed; init step 3 still says "To watch those too" when "facts not watched on any page: none"; `lockSummary` still reaches no Desk view or tool result |
| MAR-L2-03 | yes (`bc0064b`) | yes: the issue stays open, the Desk labels the lock | yes | **resolved-verified** | the coverage finding is the checkout watch's only; on an unsigned site only the kept stale fact holds the issue open |
| MAR-L2-04 | no (UAT-32 not built) | n-a | no | **open** | `#verify-status` still "Verify finished: Unverifiable." after trust |
| MAR-L2-05 | no (UAT-29) | n-a | no | **open** | landing unchanged |
| MAR-L1-15 (refuted strength) | yes | yes | n-a | **resolved-verified** (restored on her page) | not on the M1, M2, M4 layouts |

Counts over the 19 findings (strength rows apart): **9 resolved-verified, 0 fixed-only, 10 open, 0 regressed.** The
strengths MAR-L1-16 and MAR-L1-17 held: an unread page is "could not be checked", the close comment still says "Clean is
not safe", an unsigned relock is still a draft and "Nothing is accepted until a person merges".

**One fixer claim contradicted in part.** UAT-2's State says that after `raise-price` "draft PR #2's body opens with
'What this relock does not accept'". On a baseline whose peer is already pinned (W3, as the original L2 set it up) no PR
is opened at raise-price at all (`pr-plan: none`, "no ref changed"; `action/report.mjs:509-512` wants a PR only when the
relock changed a ref); the claim holds only when something else is accepted too (W4, the peer pending). This is safer
than the claim, not a defect.

### Criteria, re-applied

| # | Criterion | Recertify | L2 | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Only her address; an answer; no install, no key | **pass** (conditional) | pass (cond.) | `rc-02`, `rc-10` laptop and phone. Still nothing links her to the Desk, and a link cannot carry her address (`rc-12`) |
| 2 | Every word hers, or explained where it appears | **fail** | fail | issue 22 terms; Desk 9 terms and two hashes; "network", "agent", "re-lock" in the key sentence |
| 3 | Page changed, assistant states an old fact: told, and which page | **pass** | fail | issue, Desk and tool: "rooms.html ... 1 of 7 facts ... is no longer on it, and the network still states it (1 price), so the agent may now answer with an old fact" on the unchanged fixture. Caveat: M1, M2, M4 |
| 4 | Told what to do next; a step she can take or forward | **fail** | fail | the issue's next step is still "in a clone ... run ... --relock"; the Desk names no step (FAILED check); nothing says "forward this" |
| 5 | Never reassuring for something not checked | **pass** (conditional) | fail | on her page: told at raise, not silenced by a relock, not clean after an unsigned merge, cosmetic says "something the lock does not watch", no-CORS "could not be checked", zero anchors "is not checked". Conditional: a twin at the same price, a struck-through offer or a repeated intro price gives "all 7 facts ... still on it" (MAR-RC-1) |
| 6 | Notification to knowing what to do in under 3 minutes | **fail** | fail | daily cron; 167 words with 22 unknown terms; no step of hers |
| 7 | Rather this than asking the chat five questions | **pass** (narrowly) | fail | it remembers for her and is now right on her page; she still forwards to Jonas and pays for each wording edit |

**4 of 7** (L1: 2 of 7; L2: 1 of 7).

### Her ten stops (S1 to S10 of her L2 report)

| Stop | Still stops her? | Now |
| --- | --- | --- |
| S1 notification "Plumbline drift", next day | **yes** | unchanged title and daily trigger |
| S2 issue first line | **yes** | "Plumbline watch found drift since `plumbline.lock.json` was written." unchanged |
| S3 the false all-clear | **no** (resolved) | "1 of 7 ... no longer on it ... (1 price) ... old fact" on every surface she reaches. Returns on the M1, M2, M4 layouts |
| S4 "run ... in a clone" | **yes** | unchanged |
| S5 getting to the Desk | **yes** | no link; the deep link opens the overview |
| S6 Desk landing | **yes** | the Passed example and nautical subtitles unchanged |
| S7 Desk result | **yes, narrower** | "unsigned" is gone ("signed by a key you have not trusted"); the hashes, the nsdeploy note and the header-less CORS sentence remain |
| S8 assistant key | **yes** | unchanged; its evidence is now correct |
| S9 after Jonas's right fix | **yes, louder** | the old-fact sentence is gone, but the comment opens "A new `block` finding. Look before the next release.", and the Desk and verify say "the host may have rewritten it" / "Do not treat these files as the publisher's" |
| S10 the "accept the drift" PR | **no** (its harm resolved) | not offered when the stale page is the only change; when offered it opens "Not accepted: ... (1 price)"; merged unsigned, the issue stays open with a `block`. The title is unchanged |

Eight of ten stops remain. The two that were detection and acceptance failures (S3, S10) are gone; the rest are
comprehension, reach and cost, which the backlog deliberately puts after correctness (MC-6).

### Time saved, re-measured

Against her 15 minutes of asking the chat after a price change (and forgetting most times). On her page now: she reads
the issue (about 3 to 5 minutes; 167 words she mostly skips to "rooms.html" and "old fact"), knows the chat may quote an
old price for that page, and forwards the link; she does not need to ask the chat which page. Saved about **10 minutes
per price change**, about 80 minutes a year over eight changes, plus the real value, never forgetting to check, which is
not in minutes. Against that: the news comes up to a day late, every wording edit is an issue and a paid Jonas cycle
(relock, sign, commit, push), and the right fix is announced as a `block`. On the M1, M2 and M4 layouts: none (back to
the L2 failure). **Confidence: medium** (live on the fixture, one host; reading time estimated; notification reach not
measured). L2: none, and worse than none. Grounding of the assistant: 5/6 (unchanged; the lock's contents still absent);
Marta additions 0/2 (the kind of the stale fact now reaches the tool's summary; no value does).

### Verdict

**Conditional.** The blocker MAR-L2-01 is resolved on her unchanged page, with live evidence on every surface she can
reach; the false clean is gone on both accept paths; nothing regressed. Majors remain: the price is never named
(MAR-L1-05), there is no plain-words line (MAR-L1-06), each wording edit needs Jonas (MAR-L1-07), and a page that states
the same value twice still hides a change (MAR-RC-1). She finishes the job only by forwarding the link to Jonas.

## Character feedback (recertify)

I changed the double to 95 again, and this time the note said the rooms page no longer has one of the prices the chat
gives, and that the chat may now be quoting an old one. That's the sentence I asked for. It didn't say 89 or 95, but I'd
just changed the double, so I knew. When I fixed a typo the week after, it said something different: all the facts are
still there, and what changed isn't something it watches. I could tell the two apart, which I couldn't before.

The button that scared me isn't a trap any more. If nobody fixes the chat, the warning doesn't go away, even if somebody
merges the thing it calls "accept the drift". Good. I trust it more than last time, because last time it told me
something false in a calm voice, and on my page it doesn't now.

But I still had to read a hundred and sixty words, twenty-odd of them ones I don't use, to get there. The note still
tells me to "run" something "in a clone", and it still doesn't say "send this to Jonas". When Jonas fixed the chat
properly, I got the loudest message of the lot, "a new block finding", and the checking page told me not to treat my own
files as mine. Every wording change still opens a note only Jonas can close, and every later change while it's open
pings me again with the same sentence marked "New".

Then I tried it on a page like my neighbour's, where the twin and the double are both 89. She raises the double, and it
tells her all the facts are still there. So it's right on my page and wrong on hers.

Would I adopt it? Yes, if Jonas sets it up, because it remembers when I don't and it's no longer wrong about my price.
Would I tell the woman up the valley? I'd tell her it works if every price on her page is different, and to make Jonas
read the "facts" lines when he sets it up.

## Findings (recertify)

```json
[
  {
    "id": "MAR-L2-01", "journey": "j1-price-changed", "character": "marta-hollis", "cert_level": "L2", "type": "trust", "severity": "blocker",
    "title": "On her real rooms page the price change is invisible as a fact: every surface says 'all 5 facts the network states from it are still on it' while the assistant still quotes €89",
    "resolution": "resolved-verified",
    "ceiling": "The stale fact is named by kind and count ('1 price'), never by value; a value that still appears elsewhere on the page (a twin at the same price, a struck-through offer, an intro 'from €89') hides the change (MAR-RC-1); a fact written in a form the watch does not read is named only in the developer's terminal at setup.",
    "recertified_in": "15af680..c9f6a3b",
    "recertify_evidence": ["Unchanged fixture, four fresh worlds. raise-price: '1 of 7 facts the lock watches on it (facts the network states) is no longer on it, and the network still states it (1 price), so the agent may now answer with an old fact.' on the real CLI, issue #1 (run r1-raise), the Desk at 1280 and 390 px and the live read_drift result; cosmetic-edit: 'all 7 facts ... are still on it, so what changed is something the lock does not watch.'", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/issue-body.r1-raise.md", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/issue-body.c1-cosmetic.md", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/j-raise-laptop.json", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/j-raise-phone.json", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/j-cos.json", "shots/marta-recert/rc-10-raise-drift-laptop.png", "shots/marta-recert/rc-10-raise-drift-phone.png", "shots/marta-recert/rc-30-cosmetic-drift.png"]
  },
  {
    "id": "MAR-L2-02", "journey": "j1-price-changed", "character": "marta-hollis", "cert_level": "L2", "type": "quality-gap", "severity": "major",
    "title": "Many common ways a real page writes a price, time or phone number are never anchored, and nothing tells the publisher which facts are watched",
    "resolution": "resolved-verified",
    "ceiling": "36 of 36 L2 forms anchor; of 29 further forms 15 anchor and count, 13 do not (EUR89, 'Euro 89', number words, JSON-LD only, an image alt, \"3 o'clock\", 'from 3', '3-6pm', '15 Uhr', 'noon', a bare '15.00' cell, '1500 hrs', '01632 96 04 18') and init names each by value as not on the page, 1 anchors but is not counted (MAR-RC-1). The list reaches the developer's terminal only; once set up, a change to an unwatched fact reads 'something the lock does not watch' on her surfaces; init names the facts it does NOT watch by value and only the kinds of those it does.",
    "recertified_in": "15af680..c9f6a3b",
    "recertify_evidence": ["uat/runs/2026-11-18-first-five/evidence/marta-recert/out/anchor-probe.recert.txt", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/probe2.out.txt", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/mini.out.txt", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/w1/world-cli.log"]
  },
  {
    "id": "MAR-L1-01", "journey": "j1-price-changed", "character": "marta-hollis", "cert_level": "L1", "type": "trust", "severity": "major",
    "title": "The only remedy the alert offers (relock) silences a stale price without fixing it, and the issue then closes as clean",
    "resolution": "resolved-verified",
    "ceiling": "A relock keeps the stale page record ('Not accepted ... (1 price)'), the next watch and the Action keep the issue open, and with nothing else to accept no relock PR is offered; but `--relock --drop rooms.html` still removes the page and its alert, and the PR is still titled 'accept the drift'.",
    "recertified_in": "15af680..c9f6a3b",
    "recertify_evidence": ["W3: real CLI relock with the network at €89 printed 'no ref changed' and 'Not accepted: the network still states 1 fact this page no longer states (1 price) ...'; after sign and push the next run kept issue #1 open (plan none); the relock-pr plan was none. W4: PR #2 body opens 'What this relock does not accept'; merged unsigned, issue #1 stayed open.", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/runner.w1.json", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/runner.w2cli.json", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/w3/gh-state.arm-cli-relock.json", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/w3/pr-body-planned-not-opened.w1.md", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/pr-body.v1-raise.md", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/runner.v4.json", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/w4/gh-state.arm-W.json", "shots/marta-recert/rc-40-W-after-merge-drift.png"]
  },
  {
    "id": "MAR-L1-02", "journey": "j1-price-changed", "character": "marta-hollis", "cert_level": "L1", "type": "trust", "severity": "major",
    "title": "After the right fix (network corrected to 95) the alert gets louder and still says the network may state an old fact",
    "resolution": "resolved-verified",
    "ceiling": "After fix-network no surface says 'old fact': rooms.html reads '... the network no longer states it either, so no stale fact is left: review the change, then re-lock (watch --relock).' But the fix is announced louder than before: a comment headed 'A new `block` finding' (the signature no longer covers the network) and the Desk and verify say 'the host may have rewritten it' / 'Do not treat these files as the publisher's' about her own site until the developer signs (MAR-RC-2).",
    "recertified_in": "15af680..c9f6a3b",
    "recertify_evidence": ["uat/runs/2026-11-18-first-five/evidence/marta-recert/out/issue-body.r2-fix.md", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/gh-state.main-path.json", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/j-fix.json", "shots/marta-recert/rc-20-fix-drift.png", "shots/marta-recert/rc-21-fix-verify.png"]
  },
  {
    "id": "MAR-L1-03", "journey": "j1-price-changed", "character": "marta-hollis", "cert_level": "L1", "type": "trust", "severity": "major",
    "title": "A price written '89 euros' is never anchored, init says nothing, and a changed page then reads 'the agent now answers from different facts' (the opposite of the truth)",
    "resolution": "resolved-verified",
    "ceiling": "'89 euros' anchors on page and network; a page with no anchored fact is a warn at init ('No fact is watched on this page ...', exit 1) and a change to it reads '... whether the network now states an old fact is not checked'. A network that states its facts only in words prints 'facts the network states: 0 (none)' with no warning; number words ('eighty-nine') never anchor.",
    "recertified_in": "15af680..c9f6a3b",
    "recertify_evidence": ["uat/runs/2026-11-18-first-five/evidence/marta-recert/out/anchor-probe.recert.txt", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/mini.out.txt", "Recertify journal: mini/zero (a network in words: init 'facts the network states: 0 (none)', exit 0) and mini/zero2 (the fixture network, a page with no fact: init warn, exit 1); both watches read 'is not checked'."]
  },
  {
    "id": "MAR-L1-04", "journey": "j1-price-changed", "character": "marta-hollis", "cert_level": "L1", "type": "broken-flow", "severity": "major",
    "title": "A real price change on an issue already open for a cosmetic edit is a silent body edit: no comment, no notification",
    "resolution": "resolved-verified",
    "ceiling": "The raise after a cosmetic edit comments (notifies) with the stale-fact sentence; every later page edit while the issue is open comments 'New:' with the same sentence again (MAR-RC-3).",
    "recertified_in": "15af680..c9f6a3b",
    "recertify_evidence": ["W2 c2-raise-on-open: issue edit + issue comment (notifies) 'New: - **warn** grounding `rooms.html`: ... 1 of 7 facts ... (1 price) ...'", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/runner.c2.json", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/gh-state.escalation.json"]
  },
  {
    "id": "MAR-L1-05", "journey": "j1-price-changed", "character": "marta-hollis", "cert_level": "L1", "type": "missing-feature", "severity": "major",
    "title": "The alert never names the stale fact ('page says 95, assistant says 89'), only '1 of 6 facts'",
    "resolution": "open",
    "recertified_in": "15af680..c9f6a3b",
    "recertify_evidence": ["Narrowed, not resolved: the kind and count reach every surface ('(1 price)'). No value: the Desk check /€\\s?(89|95)\\b|\\b(89|95)\\s?€|EUR\\s?(89|95)/ FAILED (match null) at 1280 and 390 px; the issue body and the tool result hold no price.", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/j-raise-laptop.json", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/issue-body.r1-raise.md"]
  },
  {
    "id": "MAR-L1-06", "journey": "j1-price-changed", "character": "marta-hollis", "cert_level": "L1", "type": "confusion", "severity": "major",
    "title": "No plain-words layer for a site owner: the issue title, body and Desk speak only drift/lock/grounding/network/relock/sign and show hex hashes",
    "resolution": "open",
    "recertified_in": "15af680..c9f6a3b",
    "recertify_evidence": ["Not built (UAT-29). The issue at raise-price: 167 words, 22 of 28 counted terms outside her vocabulary (the L2 body: 143 words, 21 on the same list); the Desk reading: 9 terms plus two 64-character hashes; the landing unchanged.", "uat/runs/2026-11-18-first-five/evidence/marta-recert/jargon.mjs", "shots/marta-recert/rc-10-raise-drift-laptop.png", "shots/marta-recert/rc-01-setup-overview.png"]
  },
  {
    "id": "MAR-L1-07", "journey": "j1-price-changed", "character": "marta-hollis", "cert_level": "L1", "type": "missing-feature", "severity": "major",
    "title": "Every edit of the rooms page, cosmetic included, opens a warning only Jonas can clear: 'needs Jonas every time'",
    "resolution": "open",
    "recertified_in": "15af680..c9f6a3b",
    "recertify_evidence": ["Declined for now (DC-1). cosmetic-edit still opens issue #1 (notifies), severity warn; it now reads differently from a price change ('... so what changed is something the lock does not watch'). Closing still takes relock, sign, commit, push.", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/runner.c1.json", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/issue-body.c1-cosmetic.md"]
  },
  {
    "id": "MAR-L1-08", "journey": "j1-price-changed", "character": "marta-hollis", "cert_level": "L1", "type": "missing-feature", "severity": "minor",
    "title": "The news reaches her up to a day late (daily cron, no push trigger) and through a notification she may never get",
    "resolution": "open",
    "recertified_in": "15af680..c9f6a3b",
    "recertify_evidence": ["Not built (UAT-30). The workflow init wrote for the world: cron \"17 6 * * *\" and workflow_dispatch only; no assignee input. Notification reach still uncertain without real GitHub.", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/w1/world-cli.log"]
  },
  {
    "id": "MAR-L1-09", "journey": "j1-price-changed", "character": "marta-hollis", "cert_level": "L1", "type": "missing-feature", "severity": "minor",
    "title": "On an ordinary host the Desk cannot read the rooms page (no CORS on HTML pages), and nothing tells the publisher a --source page needs it",
    "resolution": "open",
    "recertified_in": "15af680..c9f6a3b",
    "recertify_evidence": ["Not built (UAT-29). rooms-no-cors: 'A grounding source could not be checked: it could not be fetched (the browser could not read it).'; /Access-Control-Allow-Origin|CORS|ask your host/ FAILED.", "shots/marta-recert/rc-17-raise-nocors-drift.png", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/j-nocors.json"]
  },
  {
    "id": "MAR-L1-10", "journey": "j1-price-changed", "character": "marta-hollis", "cert_level": "L1", "type": "trust", "severity": "minor",
    "title": "The Desk calls her own signed lock 'unsigned lock: the host can rewrite it' until she trusts her own key",
    "resolution": "resolved-verified",
    "ceiling": "Every new browser or device reads 'Signed lock, by a key you have not trusted: until you trust that key, the host could rewrite it.' until she compares the 16-character key id with Jonas out of band.",
    "recertified_in": "15af680..c9f6a3b",
    "recertify_evidence": ["Fresh profile: 'Drift read: 1 finding, Warning. Lock signed by a key you have not trusted.'; after trust: 'Signed lock: covered by a signature that verified under a publisher you trust.'", "shots/marta-recert/rc-02-setup-drift.png", "shots/marta-recert/rc-10-raise-drift-phone.png", "shots/marta-recert/rc-15-raise-drift-after-trust.png", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/j-setup.json"]
  },
  {
    "id": "MAR-L1-11", "journey": "j1-price-changed", "character": "marta-hollis", "cert_level": "L1", "type": "missing-feature", "severity": "minor",
    "title": "Nothing leads a site owner to the Desk: no address in README, the issue or init's output, and no link with her address filled in",
    "resolution": "open",
    "recertified_in": "15af680..c9f6a3b",
    "recertify_evidence": ["Not built (UAT-29). A fresh context on #/drift?target=http://127.0.0.1:4100/: driftVisible false, field empty; the issue body has no Desk link.", "shots/marta-recert/rc-12-deeplink-fresh.png", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/j-trust1.json"]
  },
  {
    "id": "MAR-L1-12", "journey": "j1-price-changed", "character": "marta-hollis", "cert_level": "L1", "type": "missing-feature", "severity": "minor",
    "title": "The assistant, the one surface that could translate, needs her own model key; even keyed it is told to repeat the jargon and cannot see which facts are locked (grounding 5/6, Marta additions 0/2)",
    "resolution": "open",
    "recertified_in": "15af680..c9f6a3b",
    "recertify_evidence": ["Not built (UAT-31; DC-3). 'Assistant needs your AI provider key.' The live read_drift result carries lockCover, the label and the corrected summary ('(1 price) ... old fact'), so the L2 widening (a keyed assistant would repeat a false all-clear) no longer holds on her page; no lock sources or kinds (check FAILED). Grounding 5/6, additions 0/2.", "shots/marta-recert/rc-16-assistant.png", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/j-raise-laptop.json"]
  },
  {
    "id": "MAR-L1-13", "journey": "j1-price-changed", "character": "marta-hollis", "cert_level": "L1", "type": "broken-flow", "severity": "minor",
    "title": "Known defect confirmed: once a relock PR is open, the next run cannot update it (push rejected 'stale info'), so a PR accepting the stale price outlives the fix",
    "resolution": "resolved-verified",
    "ceiling": "Proved against a local bare remote with the Action's own step text: three consecutive pushes to the existing branch, each exit 0, the branch lock following the network €89 -> €95 -> €89. relock-pr is opt-in; a real runner, GitHub and branch protection are not exercised.",
    "recertified_in": "15af680..c9f6a3b",
    "recertify_evidence": ["branch plumbline/relock: d972990 (raise), 491049a (network €95), fea0321 (network €89 again)", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/runner.v1.json", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/runner.v2.json", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/runner.v3.json"]
  },
  {
    "id": "MAR-L1-14", "journey": "j1-price-changed", "character": "marta-hollis", "cert_level": "L1", "type": "quality-gap", "severity": "polish",
    "title": "Wiring and wording papercuts: lockSummary never shown; '1 of 1 fact ... are'; init's next step tells you to add --source after you already gave one",
    "resolution": "open",
    "recertified_in": "15af680..c9f6a3b",
    "recertify_evidence": ["One part fixed: '1 of 1 fact the lock watches on it (facts the network states) is no longer on it'. Open: init step 3 says 'To watch those too, name the pages that state them' when 'facts not watched on any page: none'; lockSummary is mentioned in site/drift.js comments only and rendered nowhere (grep of site/*.js and site/*.html).", "Recertify journal: mini/one (real CLI init and watch)"]
  },
  {
    "id": "MAR-L1-15", "journey": "j1-price-changed", "character": "marta-hollis", "cert_level": "L1", "type": "trust", "strength": true, "severity": "polish",
    "title": "Strength: with no model, the watch tells a price change apart from a wording change",
    "verdict": "confirmed",
    "resolution": "resolved-verified",
    "ceiling": "Restored on her unchanged page (issue, Desk, tool result); not on a page that states the changed value elsewhere too (MAR-RC-1).",
    "recertified_in": "15af680..c9f6a3b",
    "recertify_evidence": ["uat/runs/2026-11-18-first-five/evidence/marta-recert/out/issue-body.r1-raise.md", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/issue-body.c1-cosmetic.md"]
  },
  {
    "id": "MAR-L1-16", "journey": "j1-price-changed", "character": "marta-hollis", "cert_level": "L1", "type": "trust", "strength": true, "severity": "polish",
    "title": "Strength: the Desk's drift view needs no key and no install, and never calls an unread thing clean",
    "resolution": "n-a",
    "recertified_in": "15af680..c9f6a3b",
    "recertify_evidence": ["Held, not regressed: address in, reading out at 1280 and 390 px; rooms-no-cors reads 'could not be checked'; 'Not checked from a browser: ...' under every result.", "shots/marta-recert/rc-10-raise-drift-phone.png", "shots/marta-recert/rc-17-raise-nocors-drift.png"]
  },
  {
    "id": "MAR-L1-17", "journey": "j1-price-changed", "character": "marta-hollis", "cert_level": "L1", "type": "trust", "strength": true, "severity": "polish",
    "title": "Strength: the issue and the pull request refuse to oversell: 'clean is not safe', 'nothing is accepted until a person merges', an unsigned relock is a draft",
    "resolution": "n-a",
    "recertified_in": "15af680..c9f6a3b",
    "recertify_evidence": ["Held, not regressed: close comment '(Clean is not safe: it means nothing locked has drifted.)'; PR '**Not signed.** ... It stays a draft until then. Nothing is accepted until a person merges this.'", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/gh-state.main-path.json", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/pr-body.v1-raise.md"]
  },
  {
    "id": "MAR-L2-03", "journey": "j1-price-changed", "character": "marta-hollis", "cert_level": "L2", "type": "trust", "severity": "minor",
    "title": "After an unsigned relock is merged, the watch is clean and closes the issue while every verifier reads the site invalid (tampered); nothing in the watch or the close comment says so",
    "resolution": "resolved-verified",
    "ceiling": "The coverage finding is the checkout watch's only (the Desk labels the lock 'does not hold' through verify); on an unsigned site there is no signature to break, so only the kept stale fact holds the issue open; the close comment now says 'the site's signature, if it has one, still covers its files'.",
    "recertified_in": "15af680..c9f6a3b",
    "recertify_evidence": ["W4 v4-after-merge: issue #1 kept open, comment '**A new `block` finding.** ... The site's signature no longer covers its files: 1 of 3 signed files differs ... (plumbline.lock.json) ...'", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/runner.v4.json", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/issue-body.v4-after-merge.md", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/w4/gh-state.arm-W.json", "shots/marta-recert/rc-40-W-after-merge-drift.png", "shots/marta-recert/rc-41-W-after-merge-verify.png"]
  },
  {
    "id": "MAR-L2-04", "journey": "j1-price-changed", "character": "marta-hollis", "cert_level": "L2", "type": "trust", "severity": "minor",
    "title": "After she trusts the key, the Verify card says VERIFIED but the status line (aria-live) still says 'Verify finished: Unverifiable.'",
    "resolution": "open",
    "recertified_in": "15af680..c9f6a3b",
    "recertify_evidence": ["Not built (UAT-32). After Trust: the card 'VERIFIED ... the verdict above is the new one.'; #verify-status 'Verify finished: Unverifiable.'", "shots/marta-recert/rc-14-raise-verify-after-trust.png", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/j-trust2.json"]
  },
  {
    "id": "MAR-L2-05", "journey": "j1-price-changed", "character": "marta-hollis", "cert_level": "L2", "type": "confusion", "severity": "polish",
    "title": "The Desk's landing shows a large green 'Passed' (an example about another site) and a second, nautical vocabulary before she has checked anything",
    "resolution": "open",
    "recertified_in": "15af680..c9f6a3b",
    "recertify_evidence": ["Not built (UAT-29). expectMatch matched 'Passed' and 'Take a fix' on the landing.", "shots/marta-recert/rc-01-setup-overview.png"]
  },
  {
    "id": "MAR-RC-1",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "A changed price that still appears elsewhere on the page is invisible: a twin at the same price, a struck-through offer or an intro 'from €89' gives 'all 7 facts ... are still on it, so what changed is something the lock does not watch'",
    "expected": "When the page no longer states a fact where it stated it (the double room's €89), the watch either counts it as gone or says the value is still found elsewhere on the page so it cannot tell; it never says 'what changed is something the lock does not watch' about a value the lock watches. init says when one value on the page stands for more than one fact the network states, or appears more than once.",
    "got": "Real CLI on copies of the fixture site: M1 (a twin room at €89; the double raised to €95), M2 ('<del>€89</del> €79 per night this winter') and M4 (intro 'Doubles from €89'; the table raised) each read 'warn grounding rooms.html: A grounding source changed since the lock was written; all 7 facts the lock watches on it (facts the network states) are still on it, so what changed is something the lock does not watch.' while the network still says €89 for the double. init printed 'watches 7 (3 prices ...)' each time, with no hint. An anchor is the presence of a value anywhere on the page, not the fact at its place.",
    "evidence": ["src/watch/anchors.ts:376-381", "src/watch/anchors.ts:466-471", "src/watch/decide.ts:148-149", "uat/runs/2026-11-18-first-five/evidence/marta-recert/mini.mjs", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/mini.out.txt", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/probe2.out.txt"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l1_missed": "The fix's own probe (36 forms) changes one value per page; no form states the same value twice.",
    "l2_priority": "Next recertify: add M1, M2 and M4 to MC-1's grounding regression (the fixture plus these three copies) and assert none reads 'something the lock does not watch'."
  },
  {
    "id": "MAR-RC-2",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L2",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "The right fix is announced as the loudest event of the journey: a comment headed 'A new `block` finding. Look before the next release.', and the Desk says of her own site 'the host may have rewritten it'",
    "expected": "When the network is corrected to what the page states, the owner is told the stale fact is gone and that one step remains (the developer re-locks and signs), without block or stranger-danger wording about her own site.",
    "got": "fix-network committed before the developer re-signs (the world's act): run r2 comments (notifies) '**A new `block` finding.** Look before the next release. ... block grounding plumbline.signature.json: The site's signature no longer covers its files ... verifiers now answer invalid (tampered) ...'; the Desk: 'The signature over this lock does not hold (verify says why): the host may have rewritten it.'; verify: 'INVALID ... Do not treat these files as the publisher's.' At L2 the same moment was a warn comment.",
    "evidence": ["action/report.mjs:242", "site/strings.js:95", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/gh-state.main-path.json", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/issue-body.r2-fix.md", "shots/marta-recert/rc-20-fix-drift.png", "shots/marta-recert/rc-21-fix-verify.png"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "resolution": "open",
    "l1_missed": "Born of UAT-2's signature-coverage finding (correct and useful for the developer), read from the owner's side.",
    "l2_priority": "Read the r2 comment and the Desk after fix-network; a fix, relock and sign in one commit avoids it, so record whether the issue tells the developer to do them together."
  },
  {
    "id": "MAR-RC-3",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L2",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "While the issue is open, every later edit of the page (wording included) comments 'New:' with the same stale-fact sentence, so a notification cannot say whether anything new is stale",
    "expected": "A comment says what is new: a finding whose sentence did not change is either not re-announced, or announced as 'the page changed again; the same stale fact is still reported'.",
    "got": "W2: c2 (raise on the open cosmetic issue) commented correctly; c3 (a breakfast wording edit, the price still stale) commented again (notifies) 'New: - **warn** grounding `rooms.html`: ... 1 of 7 facts ... is no longer on it, and the network still states it (1 price) ...', word for word the c2 comment. The digest carries the page hash, so every edit is new evidence.",
    "evidence": ["action/report.mjs:84-101", "action/report.mjs:251", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/runner.c3.json", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/gh-state.escalation.json"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "resolution": "open",
    "l1_missed": "A consequence of UAT-6's evidence choice (each finding's actual), which MAR-L1-04's fix needed.",
    "l2_priority": "Two wording edits on an open stale-price issue; read both comments."
  },
  {
    "id": "MAR-RC-4",
    "journey": "j1-price-changed",
    "character": "marta-hollis",
    "cert_level": "L2",
    "type": "trust",
    "strength": true,
    "severity": "polish",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "Strength: nothing accepts a stale fact: the relock keeps it ('Not accepted ...'), the PR lists it first under 'does not accept', no PR is offered when it is the only change, and an unsigned merge leaves the issue open with a block",
    "expected": "No accept path ends in a clean report while the assistant states a fact the page no longer does.",
    "got": "CLI relock: 'no ref changed' and 'Not accepted: the network still states 1 fact this page no longer states (1 price) ...'; W3 pr-plan none; W4 PR body opens 'What this relock does not accept'; after the unsigned merge, issue #1 open with the stale price and a block.",
    "evidence": ["src/watch/capture.ts:175", "action/report.mjs:509-512", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/runner.w2cli.json", "uat/runs/2026-11-18-first-five/evidence/marta-recert/out/runner.v4.json"],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "n-a",
    "ceiling": "`--drop <page>` still removes a page and its alert; that is a deliberate developer act, not an accept."
  }
]
```

Rank (low=1, med=2, high=3): MAR-RC-1 18 (major); MAR-RC-2 12 (minor); MAR-RC-3 6 (minor).

### Recertify residue

Four `larch-house` worlds, each `down` with `folderGone: true`, `portsStillInUse: []`, `leftovers: []` (`netstat`
showed only a PID 0 `LISTENING` line on 4101 after the last one, the Windows TIME_WAIT residue `uat/env.md` describes).
Written outside the worlds: `dist/` and `site/lib/plumbline/` (rebuilt, git-ignored), `shots/marta-recert/` (16 stems),
`evidence/marta-recert/` (the scripts and `out/`), and scratch copies in the session scratchpad. No key under the
repository or any `keys/` folder was read or used; the throwaway `jonas-recert` keys lived and died in the world
folders, and their private files were only passed to `sign --key`. Public services: the runtime upstream check of each
`watch --root` (GitHub API) only; the Desk's check view was not run; no model provider was called.
`collect-findings.mjs` was not run (the orchestrator runs it).
