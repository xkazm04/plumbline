# Dev Okafor x The partner changed overnight - L1

Run `2026-11-18-first-five`. Walker: L1 (theoretical, code-grounded). Code at `47ea482` plus the working tree; `dist/`
rebuilt at 2026-11-18 11:04 (+0100) before every run below. Reproductions ran in a throwaway folder
(`%TEMP%/plumbline-uat-dev-*`, removed at the end) with the real CLI, the real `action/report.mjs` and `dist/watch/decide.js`,
and real `git` 2.56 against a local bare remote. No key was made or read. Network contact: only what the CLI itself did
(GitHub's commits API for the upstream runtime check; `.invalid` partner names that never resolve).

## Verdict

**L1-conditional.** Structurally the job completes: one command writes the lock and the workflow with no key, a changed
partner is a `block` with counts and no quoted words, an unreachable partner is never clean, and both accepting (local
`--relock` or the relock pull request) and cutting the partner (edit the network, `--relock`) end in a clean watch.
But four majors sit on the parts of the loop Dev cares most about. The relock pull request's branch push is rejected
(`stale info`) on every run after the branch first exists, so the second drift fails the job (reproduced). The second
change to the same partner, and a `links.json` appearing on it, only edit the drift issue body, with no comment and so no
notification (reproduced). There is no product path to the actual old-versus-new difference: `plumbline diff` is good,
but it needs two local files, and the old definition is kept nowhere. And the keyless publisher the README courts is
told on every accept surface that their non-existent signature will read "invalid (tampered)", and gets a pull request
that stays a draft forever. **Journey as designed:** about 23 steps and 35 to 45 minutes over the whole story: setup with
the pull-request loop, about 10 to 12 minutes and 8 steps; first alert to decision, about 10 to 14 minutes and 6 steps;
second change, 15 to 25 minutes of debugging a red run; cut path, about 5 minutes and 4 steps. **Time saved:** about 20
minutes a week per partner against Dev's declared 25 (one change a month, setup spread over a quarter). The real gain is
the change Dev would otherwise never see. Confidence medium-low: the second-change path costs back most of one week's
saving each time it fires until the push is fixed. Grounding score: n/a (this journey does not reach the Desk's
assistant).

## Surface model

Dev's binding: CLI on their laptop, `.github/workflows`, GitHub issues and pull requests, the Desk for a quick look at
other sites; all commands; no one else's keys.

| Affordance | Where (file:line) | Reachable for Dev |
| --- | --- | --- |
| Install: clone, `npm ci && npm run build`, run `node <clone>/dist/cli/index.js` | `README.md:23-30`, `action/README.md:3-7`, `package.json` (`"private": true`, `prepare: tsc`) | yes (build from source) |
| `init [--root] [--source]... [--workflow] [--timeout] [--json]`, writes the lock and `.github/workflows/plumbline-watch.yml`, never overwrites either | `src/cli/init-command.ts:214-327`; refusal on existing workflow `:250-253`; next steps `:188-196` | yes |
| `watch --root` report, exit 0/1/2; no headline line | `src/cli/watch-command.ts:128-147` | yes |
| `watch --relock [--drop]`, writes then prints `added/removed/changed` + `RESIGN_REMINDER` | `src/cli/watch-command.ts:106-126`; `src/watch/index.ts:98-121`; `src/watch/decide.ts:462-493` | yes |
| `watch --url [--allow-local]` (published lock) | `src/cli/watch-command.ts:75-91`; `src/watch/index.ts:148-163` | yes; loopback peers refused regardless (`src/watch/published.ts:146-147`) |
| `--allow-local` on `init` / `watch --root` | refused: `src/cli/watch-command.ts:92`; not declared: `src/cli/init-command.ts:217` | **absent** |
| `diff <old> <new> [--json]`, names and hosts for the caller's own files, control chars replaced | `src/cli/diff-command.ts:198-246`; docs `docs/gate-and-watch.md:258-260` | yes, but needs both files on disk |
| A command that fetches or keeps a partner's definition | none: the lock stores hashes only (`src/watch/outline.ts:222-226`, `src/watch/capture.ts:144-156`) | **absent** |
| `--help` | top level: "unknown command: --help" (`src/cli/index.ts:39-42`); per command: "unknown argument --help" plus the usage line (`src/cli/watch-command.ts:36-44`) | yes, thin |
| Peer finding sentences (changed / links appeared, changed, gone / kid / unreachable / pending / not covered) | `src/watch/decide.ts:224-350` | yes |
| Outline counts ("agents: n added ..."), reformat sentence | `src/watch/decide.ts:306-314`; `src/watch/outline.ts:356-362` | yes, as prose only |
| Lock fields `peers[].checkedAt`, `grounding.builtAt` | written `src/watch/capture.ts:154,191`; shown nowhere (grep of `action/report.mjs src/cli site/*.js`: 0 hits) | **unwired** |
| Watch template: daily cron, `contents: read`, `issues: write`, `issues: true`, Action pinned by SHA, third-party actions pinned | `action/templates/plumbline-watch.yml:1-53` (header says "It never pushes or opens a PR", `:9`) | yes |
| Action inputs `relock-pr`, `signing-key`, `origin`, `token`; refusals | `action/action.yml:5-49`; `action/report.mjs:35-55` | yes, by editing the workflow |
| Drift issue: body, digest marker, create/edit/comment/close | `action/report.mjs:65-227`; steps `action/action.yml:145-187` | yes |
| Relock pull request: branch `plumbline/relock`, body, draft rule, push with `--force-with-lease` | `action/report.mjs:229-303,401-430`; steps `action/action.yml:193-273` | yes when `relock-pr: true` |
| Desk "Read drift" view on Meridian's published lock | `site/strings.js:75-99`; `site/drift.js` | yes; loopback/http peers are "not contacted" |
| Desk pre-load partner pin check ("Not sent to {name} ...") | `site/site.js:107-210`; `site/strings.js:335-336` | **unreachable for Meridian**: it guards only the Desk's own partners against the Desk's own lock; Meridian's runtime is unmodified (accepted gap) |
| Docs: relock, `--drop`, "a peer leaves the lock when no network names it any more" | `docs/gate-and-watch.md:289-304` | yes |

Wiring audit: two values computed for the lock reach no surface (`checkedAt`, `builtAt`). The outline's five counts reach
surfaces only inside a sentence, never as fields of `--json`. `expected`/`actual` hashes reach `--json` and the Desk but
not the issue (that is fine).

## Walkthrough

**1. Install (act `fresh`).** Dev reads `README.md` "Use it": "From your site's repository root: `npm ci && npm run build`
# in a clone of this repository; `node dist/cli/index.js init --root ./site --workflow`". Q1 yes, Q2 yes, Q3 half: the
same block says "from your site's root" and runs a path that exists only in the clone (`README.md:23-27`). Dev works it
out (`node ~/src/plumbline/dist/cli/index.js`). Building from source is Dev's first pet peeve; the not-on-npm decision is
accepted, the friction is not (DEV-L1-09). `plumbline --help` says "unknown command: --help".

**2. Lock and workflow.** `init --root ./site --workflow` (reproduced): "init: wrote plumbline.lock.json (2 grounding
sources, 2 runtime files, 0 peers, 1 pending) ... init: wrote .github/workflows/plumbline-watch.yml (root: site)", then
four numbered next steps in 0.36 s. With a reachable partner the peer is captured with its outline. The next steps say
`plumbline watch --root ./site`, a command Dev does not have on PATH. Q4 yes: Dev knows what happened. One command, no
key: criterion 1 holds.

**3. The pull-request loop.** Dev wants "accepting is a reviewable diff". The written template keeps an issue only, and
its header says "It never pushes or opens a PR" (`action/templates/plumbline-watch.yml:9`). `action/README.md:68-88`
shows `relock-pr: true` and the two extra permissions. Dev edits the workflow (Q1 depends on reading the Action README:
DEV-L1-07). Nothing says that GitHub must "Allow GitHub Actions to create and approve pull requests" or that a pull request
opened with the job token runs none of Dev's own checks. Dev also notices the template pins
`6b4745751f985cba9c61ac4e532e5e8e91fb4217`, and that the third-party actions are pinned by SHA too. That earns real trust.

**4. Alert (act `partner-adds-agent`).** The next 06:17 UTC run opens "Plumbline drift" (reproduced through
`report.mjs`): `| block | peer | https://fx-partner.../converter | A peer's network definition changed since the lock was
written; it runs in the visitor's browser, so a changed one is changed code. In outline: agents: 1 added, 0 removed, 0
changed; outbound hosts: 1 added, 0 removed; front agent: unchanged. |`. Q4 yes: block, counts, no partner words.
Criterion 2 holds. Up to 24 h may pass between the partner's change and this alert. Meanwhile Meridian's visitors run
the changed partner: the consent card shows no verdict (accepted gap), and the Desk's pre-load check guards only the Desk.

**5. "What was added, and where does it talk to now?"** Dev's senior bar is a diff with names and hosts. Q1 yes, Q2 no:
the issue offers no command. Dev finds `plumbline diff <old> <new>` in `docs/gate-and-watch.md:258`. It works well
(reproduced: `agents added: upsell?[31m`, `outbound hosts added: track.adnet.example`, the escape replaced), but there is
no old file. The lock holds hashes. Capture had the bytes and dropped them (`src/watch/capture.ts:144-156`). The new file
means fetching the partner's `agent-manifest.json`, finding the network by name and fetching its `hocon`, by hand, the way
`locatePeerFile` does (`src/net/locate.ts:146-158`). Dev can read the new definition and cannot see the difference.
Criterion 3 fails (DEV-L1-03).

**6. Accept.** The relock pull request is a draft. Its body lists "changed `peer https://...`" and the findings table,
then: "**Not signed.** The lock is a signed file, so the site's signature reads invalid (tampered) until it is signed
again. Check out this branch, run `plumbline sign` with your key..." (reproduced). Meridian has no signature. Q3 fails:
the product's own no-key path tells Dev to do a key ceremony to merge. Dev marks it ready and merges (DEV-L1-04). Locally,
`watch --relock` prints the same misleading reminder. Criterion 4 holds: nothing was signed, and the lock moved only
through a pull request Dev merged.

**7. `partner-adds-links`, then `partner-changes-again`, before Dev has merged.** The issue: each run is `edit` with
**no comment** (reproduced): the digest is `[severity, kind, ref]`, and both partner findings collapse into one row
`["block","peer",url]` (`action/report.mjs:81-93,173-179`). Nobody is notified that the partner changed again. The pull
request: the body changed, so `edit` pushes the branch again. Reproduced against a bare remote, the push is
`! [rejected] HEAD -> plumbline/relock (stale info)`, exit 1, and the step fails. The pull request keeps the first change's
lock. The only notice of the second change is a red workflow run whose log says `stale info`. Criterion 6 fails
(DEV-L1-01, DEV-L1-02). After any merged or closed relock pull request whose branch was not deleted, the next `create` hits
the same rejection, so the loop works once per repository.

**8. `partner-reformats`.** `block`, "Formatting or non-agent content only: no agent, outbound host or front agent
changed." Told apart and honest. Dev would grumble about a block for whitespace, but it is defended (non-agent content can
matter) and it is said.

**9. `partner-down`.** `warn`, "A peer could not be reached (the name did not resolve), so it was not checked." Exit 1,
the issue stays open, and when the partner returns its block comes back with "**A new `block` finding.**" first.
Criterion 7 holds. But a relock during the outage, local or by the pull request (wanted = open findings and a changed
ref, `action/report.mjs:410-413`), writes "added pending ..., removed peer ..." (reproduced). Every later watch then
says only "pending ... so it is not watched" (`src/watch/decide.ts:316-329`): the pin is gone, and the pull request
offered that as "accept the drift" (DEV-L1-05).

**10. Cut instead.** Dev deletes the partner from `meridian.network.json`. `watch` still reports the partner (and the
network change as grounding) until `--relock`. The relock prints "removed peer https://..., changed grounding
meridian.network.json", and the next watch is clean apart from an info line (reproduced). The one documenting sentence
sits in the `--drop` paragraph (`docs/gate-and-watch.md:304`). The issue and pull request offer only "accept". Criterion 5
holds narrowly: the mechanics are clean and the path is written down, but neither alert surface names it.

## Scored criteria

| # | Criterion | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Clean checkout to lock and watch workflow: one command each, under 10 minutes, no key | **pass** | `init --root ./site --workflow` wrote both in 0.36 s (reproduced); about 5 minutes with clone and build. Build from source is friction (DEV-L1-09) |
| 2 | Changed partner is `block`, with counts, without quoting the partner | **pass** | `src/watch/decide.ts:243-251,306-314`; reproduced sentence in step 4 |
| 3 | The actual old-versus-new difference with a product command | **fail** | `src/cli/diff-command.ts:198-203` needs two files; the lock keeps hashes only (`src/watch/outline.ts:222-226`); nothing keeps or fetches the definition (DEV-L1-03) |
| 4 | Accepting produces a reviewable change list before anything is locked or signed for them | **pass** | PR body `action/report.mjs:254-281`; nothing merged by the run (`:278`); no key, so nothing is signed. Text is misleading for unsigned sites (DEV-L1-04) |
| 5 | Removing the partner is a documented path that leaves the watch clean | **pass** | reproduced: relock "removed peer", then clean; `docs/gate-and-watch.md:304`. Not offered by the issue or PR (`action/report.mjs:141-148`) |
| 6 | A second drift while the first is open updates the same issue or PR and does not fail | **fail** | issue edited silently (`action/report.mjs:81-93,179`); PR push rejected `stale info` (`action/action.yml:253-254`, reproduced) |
| 7 | Whatever was unreachable is not checked, never clean | **pass** | `src/watch/decide.ts:229-241`; `src/cli/watch-command.ts:139-147`; `action/report.mjs:68-73` |
| 8 | Alert to decision under 10 minutes | **fail** | about 10 to 14 minutes: issue (1), hand-fetching the partner's manifest and network to see the new hosts (5 to 8), PR read, mark ready, merge (3). Under 10 only if Dev decides on counts alone, which their bar rejects. Confidence medium |

**Score: 5 of 8.**

## Findings

```json
[
  {
    "id": "DEV-L1-01",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L1",
    "type": "broken-flow",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "completion",
    "title": "The relock pull request's branch push is rejected (stale info) on every run after the branch exists",
    "expected": "A second drift while the relock PR is open replaces the Action's own branch and edits the same PR (action/README.md:77: 'it is replaced on each push, --force-with-lease').",
    "got": "The push names a URL, not a remote, so --force-with-lease=refs/heads/plumbline/relock has no remote-tracking ref to compare with and expects the branch to be absent. The fetch into refs/remotes/plumbline/... does not supply it. Reproduced with git 2.56 against a local bare remote: run 1 push exit 0; run 2 (fresh clone, branch exists) '! [rejected] HEAD -> plumbline/relock (stale info)', exit 1. The step fails, `gh pr edit` never runs, and the PR keeps the first change's lock. The same rejection hits `create` after any merged or closed relock PR whose branch was not deleted (GitHub keeps head branches by default), so the loop works once per repository. The renew branch shares the push.",
    "evidence": ["action/action.yml:246-255", "action/action.yml:261-265", "action/README.md:77", "action/report.test.mjs:530"],
    "code_check": "present-broken",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Replay the Action's push function twice against a local bare remote, with the branch created in run 1 and a fresh clone in run 2 (no GitHub needed; the stub gh in action/report.test.mjs records only command lines, so it cannot catch this). Confirms the known-defects lead. On a real runner, needs a scratch GitHub repository (env.md gap)."
  },
  {
    "id": "DEV-L1-02",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "A partner that changes again, or starts serving links.json, while the drift issue is open edits the body with no comment, so no one is notified",
    "expected": "New changed code from the same partner is news: the issue comments (which notifies) naming that the partner changed again.",
    "got": "The digest is [severity, kind, ref] with summaries dropped. Both partner findings (definition changed, links.json appeared) are ['block','peer',url] and collapse into one row, so act 2 and act 3 give issuePlan 'edit' with comment=(none) (reproduced through action/report.mjs). The doc says summaries are left out on purpose, so that a slower timeout does not re-notify. That rule also silences 'the partner shipped new code again'.",
    "evidence": ["action/report.mjs:77-93", "action/report.mjs:173-179", "action/report.mjs:206-218", "action/README.md:60-62"],
    "code_check": "by-design",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Play partner-adds-agent, partner-adds-links and partner-changes-again in meridian-trips, feed each watch report to `report.mjs issue` with the stub gh, and assert whether a comment file is written for acts 2 and 3. Precondition: a watch report showing peer drift, which the CLI cannot produce against a loopback partner (see DEV-L1-08). Use a labelled harness that calls runWatch with deps.fetchOptions.allowLocal."
  },
  {
    "id": "DEV-L1-03",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "senior-quality",
    "title": "No product path to the actual old-versus-new partner definition: diff needs two local files and the old one is kept nowhere",
    "expected": "From the alert, one command shows the agents added, removed and changed and every new host, by name. That is Dev's own `diff` of two saved files, the senior bar.",
    "got": "`plumbline diff` names agents and hosts well (reproduced, control characters replaced), but only for two files on disk. The lock stores SHA-256 of names, agents and hosts (to avoid quoting a stranger). Capture reads the partner's bytes and keeps only hashes. No command fetches a partner's current definition (the manifest-then-hocon lookup is internal). Dev can hand-fetch the new file and can never get the old one, so the alert's counts are all they have unless they had saved a copy on their own initiative, which nothing suggests.",
    "evidence": ["src/cli/diff-command.ts:198-203", "src/watch/outline.ts:222-226", "src/watch/outline.ts:299-308", "src/watch/capture.ts:144-156", "src/net/locate.ts:146-158", "docs/gate-and-watch.md:258-260", "action/report.mjs:141-148"],
    "code_check": "confirmed-absent",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Time Dev's hand path from the issue to seeing the new hosts in the meridian-trips world (fetch the partner's manifest, find the network, read it). Confirm no CLI or Desk surface yields the old definition."
  },
  {
    "id": "DEV-L1-04",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "The keyless publisher is told on every accept surface that their signature will read 'invalid (tampered)', and their relock pull request stays a draft that the Action re-drafts",
    "expected": "The no-key watch path the README leads with ('Start with the watch: one command, no key') accepts drift without mentioning a signature the site does not have.",
    "got": "The CLI relock prints 'plumbline.lock.json is a signed file: sign the site again ... or its signature reads invalid (tampered)' unconditionally (reproduced on an unsigned site). The issue says 'sign the site again (the lock is a signed file)'. The PR body says '**Not signed.** ... the site's signature reads invalid (tampered) ... run `plumbline sign` with your key ... It stays a draft until then.' None of them checks whether plumbline.signature.json exists (the push step does, action.yml:251). For an unsigned site the PR is always a draft. If Dev marks it ready and the Action runs before the merge, prPlan returns 'edit' (isDraft differs) and runs `gh pr ready --undo` (reproduced plan: {action: edit, draft: true}), and that edit's push then fails (DEV-L1-01).",
    "evidence": ["src/watch/decide.ts:492-493", "src/cli/watch-command.ts:123", "action/report.mjs:145-148", "action/report.mjs:273-277", "action/report.mjs:291-302", "action/action.yml:264", "README.md:23"],
    "code_check": "present-broken",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Run `watch --relock` on the unsigned meridian-trips site and quote the reminder. Render the relock PR body from a real report and check the draft flag; with the stub gh, mark it ready and run the Action's decide step again to confirm the re-draft."
  },
  {
    "id": "DEV-L1-05",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "A relock during a partner outage replaces the partner's pin with 'pending', and the relock PR offers that as 'accept the drift'",
    "expected": "An unreachable partner keeps its pin: the outage is reported, and nothing proposes to stop comparing the partner.",
    "got": "The relock PR is wanted whenever there are warn findings and the relock changed a ref. During an outage, captureLock moves the partner to pendingPeers (reproduced: 'added pending https://...', 'removed peer https://...'). From then on detectPeers never compares it: every watch says only 'pending ... so it is not watched; run watch --relock once it answers'. The next relock then locks whatever the partner serves. Each outage opens or edits a PR titled 'accept the drift', and its body does not say that 'pending' means unpinned.",
    "evidence": ["src/watch/capture.ts:144-167", "src/watch/detectors.ts:180-187", "src/watch/decide.ts:316-329", "action/report.mjs:410-413", "action/report.mjs:254-266"],
    "code_check": "present-broken",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Play partner-down in meridian-trips with relock-pr on (stub gh, local bare remote). Confirm a PR is planned, quote its change list, merge it, bring the partner back changed (partner-changes-again), and see whether any block is raised. Same loopback precondition as DEV-L1-02."
  },
  {
    "id": "DEV-L1-06",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "The relock PR is not updated when the partner's bytes move but the counts do not, so Dev can merge a lock of what the partner no longer serves",
    "expected": "A PR that says it accepts the current drift locks the current hash.",
    "got": "prPlan compares only the body, with the run address masked. The body carries the change list ('changed peer <url>') and the summaries (counts), never a hash. A second change with the same counts (for example the added agent's instructions edited again) gives 'none', and the branch keeps the earlier hash. After the merge the next watch is block again, a false 'new' alert from Dev's point of view.",
    "evidence": ["action/report.mjs:254-281", "action/report.mjs:300-301"],
    "code_check": "present-broken",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Needs a partner act that changes the definition without changing the outline counts (not among the journey's acts; add one, or edit the added agent's text). Then check the PR plan is 'none' and the branch lock hash is stale."
  },
  {
    "id": "DEV-L1-07",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "med" },
    "dimension": "effort",
    "title": "The accept-by-pull-request loop is not in the workflow init writes, and the GitHub settings it needs are not named",
    "expected": "One workflow file gives the whole loop, or init offers it, and the docs name every repository setting it depends on.",
    "got": "The template keeps an issue only, and its header says 'It never pushes or opens a PR'. Dev must find relock-pr in action/README.md, add it, and widen the permissions to contents: write and pull-requests: write. Nowhere is it said that the repository (or organisation) must allow GitHub Actions to create pull requests, or that a PR opened with the job token triggers none of Dev's own checks, which matters under branch protection.",
    "evidence": ["action/templates/plumbline-watch.yml:7-9", "action/templates/plumbline-watch.yml:17-19", "action/templates/plumbline-watch.yml:41-47", "action/README.md:68-88", "src/cli/init-command.ts:184-196"],
    "code_check": "confirmed-absent",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "The settings behaviour needs a scratch GitHub repository (env.md gap). It cannot be confirmed locally; resolve uncertain with that reason."
  },
  {
    "id": "DEV-L1-08",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "missing",
    "title": "A publisher cannot rehearse the watch against a local or staging partner: no --allow-local on init or watch --root, and loopback peers are refused even by watch --url --allow-local",
    "expected": "Like gate --allow-local, a documented local path to capture and watch a partner on this machine, private ranges still refused.",
    "got": "init with a loopback partner: 'A peer could not be captured ... (the address is not https)', pending. `init --allow-local`: 'unknown argument'. `watch --root --allow-local`: '--allow-local goes with --url: a checkout is read from disk' (all reproduced). The published reader applies peerAddressProblem (https and a public host) regardless of allowLocal. The journey file does not say that this world's partner is unreachable by every CLI surface, which env.md asks of it.",
    "evidence": ["src/cli/watch-command.ts:92", "src/cli/init-command.ts:217", "src/watch/published.ts:146-147", "src/watch/decide.ts:436-443", "uat/env.md:43-45"],
    "code_check": "confirmed-absent",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "PRECONDITION for all of J2 at L2: decide the arm before driving. Either a labelled harness calling runWatch/runRelock with deps.fetchOptions.allowLocal (the tests' hook), or a partner on a public https host. Record which arm each verdict was measured on."
  },
  {
    "id": "DEV-L1-09",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "Getting started needs a build from source, then speaks commands Dev does not have: 'plumbline ...' is not on PATH, the README runs a clone path 'from your site's root', and there is no --help",
    "expected": "A first-time terminal user can copy each printed command and run it, and `--help` explains each command in a line.",
    "got": "README's block says 'From your site's repository root' and runs `node dist/cli/index.js`, which exists only in the clone. init's next steps and the PR body say `plumbline watch ...` / `plumbline sign`, which no install step puts on PATH (no npm link step, not on npm). `plumbline --help` prints 'unknown command: --help' and a list of bare names; `watch --help` prints 'unknown argument --help' and the usage. The diff command's purpose appears only in docs/gate-and-watch.md.",
    "evidence": ["README.md:23-30", "src/cli/init-command.ts:188-196", "src/cli/index.ts:39-42", "src/cli/watch-command.ts:36-44", "action/report.mjs:276"],
    "code_check": "present-but-missed",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Time a cold start from a fresh clone to a written lock in the world; quote the --help outputs."
  },
  {
    "id": "DEV-L1-10",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "senior-quality",
    "title": "A partner's links.json that appears or changes is reported without what it routes to, and diff cannot read one",
    "expected": "Like the definition, a links.json change says in counts whether it adds outbound hosts, since links.json maps a network's links to addresses.",
    "got": "The finding says only appeared, changed or gone ('...so this is changed code'). links.json values are URLs (discover reads them as peers), so it can introduce new hosts the outline never counts. `plumbline diff` refuses a links.json ('not a network definition').",
    "evidence": ["src/watch/decide.ts:262-280", "src/watch/discover.ts:290-293", "src/cli/diff-command.ts:191-194"],
    "code_check": "confirmed-absent",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Play partner-adds-links and quote the finding; check whether the served links.json introduces a host."
  },
  {
    "id": "DEV-L1-11",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "Unwired and prose-only values: when the partner was last known good, and the outline counts as fields; no one-line headline on the CLI watch",
    "expected": "The alert says since when (the lock's checkedAt for the partner), --json carries the five counts as numbers for scripting, and the terminal report starts with one line ('1 block, 0 warn').",
    "got": "peers[].checkedAt and grounding.builtAt are written by capture and shown nowhere (grep of action/report.mjs, src/cli and site/*.js: 0 hits). The counts exist only inside a summary sentence. printReport prints 'watch: no drift' only when there are zero findings; otherwise it prints rows with no headline, and with info-only it prints info rows and exits 0 without saying clean.",
    "evidence": ["src/watch/capture.ts:154", "src/watch/capture.ts:191", "src/watch/decide.ts:306-314", "src/cli/watch-command.ts:139-147"],
    "code_check": "confirmed-absent",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Low; quote a live terminal report and --json in the world."
  },
  {
    "id": "DEV-L1-S1",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "strength": true,
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "Unreachable is never clean: a down partner is warn 'so it was not checked', a missing lock keeps the issue open, and a returning block is said first",
    "expected": "No green tick for what could not be reached.",
    "got": "As expected. Reproduced: 'warn peer ...: A peer could not be reached (the name did not resolve), so it was not checked.', exit 1. A pending partner at init is warn with exit 1. An absent or unusable lock is an open finding in the Action. The partner coming back changed yields '**A new `block` finding.**' first.",
    "evidence": ["src/watch/decide.ts:229-241", "src/cli/watch-command.ts:139-147", "action/report.mjs:65-75", "action/report.mjs:181"],
    "code_check": "n-a",
    "verdict": "uncertain",
    "resolution": "n-a",
    "l2_priority": "Keep as a guardrail: partner-down must stay warn and exit 1."
  },
  {
    "id": "DEV-L1-S2",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "strength": true,
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "Changed partner code is said in counts without a stranger's words, and a reformat is told apart yet stays block",
    "expected": "'Changed' with a what.",
    "got": "'In outline: agents: 1 added, 0 removed, 0 changed; outbound hosts: 1 added, 0 removed; front agent: unchanged.' and 'Formatting or non-agent content only: no agent, outbound host or front agent changed.', both block (reproduced through dist/watch/decide.js). The issue body states 'A clean report does not mean the site is safe'.",
    "evidence": ["src/watch/decide.ts:243-252", "src/watch/decide.ts:306-314", "action/report.mjs:150"],
    "code_check": "n-a",
    "verdict": "uncertain",
    "resolution": "n-a",
    "l2_priority": "Quote the live sentences for partner-adds-agent and partner-reformats."
  },
  {
    "id": "DEV-L1-S3",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "strength": true,
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "senior-quality",
    "title": "plumbline diff is exactly Dev's own diff for files they hold, and refuses to let a name rewrite the terminal",
    "expected": "Names and hosts, safe to print.",
    "got": "Reproduced: 'agents added: upsell?[31m', 'agents changed: fx_front', 'outbound hosts added: track.adnet.example', exit 1; a re-serialised file gives 'Formatting or non-agent content only', exit 0.",
    "evidence": ["src/cli/diff-command.ts:179-182", "src/cli/diff-command.ts:198-246"],
    "code_check": "n-a",
    "verdict": "uncertain",
    "resolution": "n-a",
    "l2_priority": "None beyond DEV-L1-03 (it needs an old file to be useful)."
  },
  {
    "id": "DEV-L1-S4",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "strength": true,
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "effort",
    "title": "Setup is one keyless command, the written workflow pins every action by full SHA, and nothing is overwritten",
    "expected": "Pinned everything, no key ceremony to start.",
    "got": "init --workflow wrote the lock and the workflow in 0.36 s (reproduced), refuses an existing workflow before writing anything, keeps an existing lock. The Action is pinned by SHA and builds from that commit; checkout and setup-node are SHA-pinned with the tag as a comment; persist-credentials: false.",
    "evidence": ["src/cli/init-command.ts:242-267", "action/templates/plumbline-watch.yml:31-43", "action/README.md:9-12"],
    "code_check": "n-a",
    "verdict": "uncertain",
    "resolution": "n-a",
    "l2_priority": "Preflight that the pinned 6b47457 exists on GitHub before any live run: locally master is 19 commits ahead of origin/master and 6b47457 is not on origin/master."
  },
  {
    "id": "DEV-L1-S5",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "strength": true,
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "completion",
    "title": "Cutting the partner ends clean, and the relock says so in Dev's terms",
    "expected": "Cut is as clear as accept.",
    "got": "Reproduced: after removing the partner from the network, relock printed 'removed peer https://...', 'changed grounding meridian.network.json', and the next watch showed only an info line, exit 0. (The alert surfaces still never offer this path: see criterion 5.)",
    "evidence": ["src/watch/index.ts:98-121", "src/watch/decide.ts:462-490", "docs/gate-and-watch.md:304"],
    "code_check": "n-a",
    "verdict": "uncertain",
    "resolution": "n-a",
    "l2_priority": "Replay the cut in the world and confirm the open PR and issue close on the next clean run."
  }
]
```

Impact ranks (frequency x reachability x trust erosion): 01 = 27, 02 = 27, 03 = 18, 04 = 18, 05 = 18, 06 = 18, 10 = 12,
11 = 9, 07 = 6, 09 = 6, 08 = 3.

Known-defect leads from `uat/accepted-gaps.md`, checked against this journey:
- Relock/renew push fails when the branch exists: **confirmed by reproduction** (DEV-L1-01). It is wider than the lead:
  it also breaks `create` after a merged or closed PR whose branch remains.
- Relock PR not updated when hashes move but wording does not: **confirmed by code** (DEV-L1-06), not run end to end.
- CI signs a relock before review: not reachable for Dev (no key, no `signing-key`). With a key, the signature lands on
  an unmerged branch.
- `watch --url` control characters, `--init --external` silence, fork PR on the same branch name: outside this journey,
  not checked.

## What L2 must check

1. **Preflight the arm (DEV-L1-08).** No CLI surface can capture or watch the meridian-trips partner on loopback. Pick a
   labelled harness (runWatch/runRelock with `deps.fetchOptions.allowLocal`) or a public https partner, and write it in
   `_L2-PREFLIGHT`.
2. The relock branch push on its second run against a local bare remote (DEV-L1-01). Quote the `stale info` line.
3. The issue plan across `partner-adds-agent` -> `partner-adds-links` -> `partner-changes-again`: is a comment written
   (DEV-L1-02)?
4. The relock PR body and draft state for the unsigned site, and the re-draft after a manual "ready" (DEV-L1-04).
5. `partner-down` with relock-pr on: the PR's change list, then whether the returning changed partner is ever a `block`
   (DEV-L1-05).
6. Time-on-task from the issue to seeing the new hosts by hand, against Dev's 10 minutes (criterion 8, DEV-L1-03).
7. The Desk's "Read drift" on Meridian's published lock: expect the loopback partner "not contacted"; quote it.
8. Preflight that the template's pinned SHA exists on GitHub before any real-runner test.

## Character feedback (L1)

I'd adopt the watch half today, and I wouldn't switch on the pull-request half yet. One command gave me a lock and a
workflow, no key. Every action in that file is pinned by full SHA. When my partner is down it says "not checked" and keeps
the issue open, which is the opposite of the tool that burned me. The alert line is good: "agents: 1 added; outbound hosts:
1 added", block, and none of their words in my issue tracker. That's the right instinct.

Then I hit the wall I care about most. It tells me a host was added and won't tell me which one. `plumbline diff` does
exactly what I'd do by hand, but it needs the old file, and the tool threw that file away the moment it hashed it. So I'm
back to curl and jq against a partner whose old version no longer exists anywhere. For my MD's question "is it fine?",
"one new host, name unknown" isn't an answer I can give.

The pull request is where it turns on me. I never made a key, because the README told me I didn't need one. The pull
request still tells me my signature will read "tampered" and sits as a draft until I sign, and if I mark it ready the bot
flips it back. Then the partner changed a second time while that pull request was open: the issue changed silently, and the
bot's push to its own branch was rejected. A bot that breaks on its second run is the exact thing I said I'd drop.

There's a second trust problem in the same place. If the partner has an outage, the "accept the drift" PR quietly proposes
to stop pinning it.

Would I tell a peer? Yes, as "use the daily issue, ignore the PR loop until the push is fixed, and save a copy of every
partner file yourself". What I'd need to stop doing that last part: keep the partner's definition beside the lock in my
own repo, so `diff` has something to compare.

---

# L2 (empirical, live)

Walker: L2. Code at `47ea482` plus the working tree. `npm run build` and `npm run build:site` were run first;
`dist/cli/index.js` is dated 2026-11-18 11:25:43 (+0100), after HEAD's 10:30:23. World `meridian-trips` (ports 4200 and
4201, Desk 4299) was up at 11:26 and taken down at the end. Evidence stems are under
`uat/runs/2026-11-18-first-five/shots/dev/`. Each `ci-r<n>-*.txt` is the full transcript of one replayed scheduled run.
`dev-desk-*` holds the Desk captures (`.png`, `.aria.yml`, `.txt`).

**The rig.** The Action's steps ran for real. Their `run:`, `env:` and `if:` text came from `action/action.yml` in the
Action's checkout, read at run time. That checkout's `action.yml` and `report.mjs` hashed the same as the repository's
(`2c56f950af35` / `9e961b55bf2f`, printed at the head of every transcript). Each step ran in
`bash --noprofile --norc -eo pipefail`, which is GitHub's bash. Around that, the walker's rig (scratchpad
`ci/run-action.mjs`) did four things:

- Emulated `actions/checkout`: a fresh shallow fetch of `main` from a local bare remote, with `core.autocrlf=false` (as
  on a Linux runner) and no credentials kept.
- Mapped the exact `https://x-access-token:<token>@github.com/<repo>.git` URL the push step builds onto the bare remote
  with `url.<bare>.insteadOf`. The push and fetch command lines are therefore byte-for-byte the Action's.
- Put a stub `gh` first on PATH (`ci/ghstub.mjs`). It records every call and keeps issues and pull requests in a state
  file the walker edits to stand for a person. Like the real `gh`, it refuses `pr create` for a branch the remote does
  not have.
- Skipped the Build step, because `dist/` is the build of the same commit.

There were two arms:

- **cli**: the Action's own `dist/cli/index.js`.
- **harness**: that path is a wrapper that sends `watch --root` to `uat/driver/local-cli.mjs` and everything else to the
  real CLI. Everything measured on the harness arm is "reachable only through the test harness".

## L2 preflight

`_L2-PREFLIGHT`

| Carried `l2_priority` | Environment precondition | This host | Arm used |
| --- | --- | --- | --- |
| DEV-L1-08: pick the arm | a watch that can reach the partner | **no** for the CLI: every loopback peer is pending or "could not be reached (the address is not https)". There is no public https partner. | **Built:** the harness arm for every peer-level fact (r0-r13). The CLI arm is the control (terminal comparisons, r14). |
| DEV-L1-01: push twice to a bare remote | git, a bare remote, the push's own github.com URL | yes, through `insteadOf` on the exact URL. A real runner is not exercisable (env.md), but git decides "stale info" on the client before anything is sent, so the server does not enter into it. | harness |
| DEV-L1-02: is a comment written on acts 2 and 3? | a watch report with peer drift | yes, on the harness arm | harness |
| DEV-L1-03: time the hand path | the partner readable by curl | yes (loopback) | the plain terminal |
| DEV-L1-04: unsigned PR, draft, re-draft | an unsigned site; a stub gh whose draft flag can be flipped | yes | harness |
| DEV-L1-05: partner-down with relock-pr | the harness, plus a partner change after it comes back | yes. The change after `partner-back` was made by the walker (fee 0.9% to 1.4%, restored afterwards). | harness |
| DEV-L1-06: new bytes, same counts | a partner act that does not move the outline counts | not among the world's acts. **Built:** the walker edited the served partner file inside the world's temp folder (fee 0.9% to 1.1%), then restored it. `plumbline diff` confirms the shape: "agents: 0 added, 0 removed, 1 changed ... agents changed: fee_estimator". | harness |
| DEV-L1-07: GitHub settings for PRs | a real GitHub repository | **no**. It needs a scratch GitHub repository, so it resolves `uncertain`. | none |
| DEV-L1-09: cold start | a fresh clone; the npm registry | a `git clone` of the local repository at 47ea482 stands in for GitHub; `npm ci --prefer-offline` | the plain terminal |
| DEV-L1-10, -11 | the partner act; the CLI | yes | harness, cli |
| DEV-L1-S4: the pin exists on GitHub | a read of GitHub's refs | checked with `git ls-remote` (read-only). GitHub's `master` is `94d7bf7`, 19 commits behind local HEAD. **`6b47457` is not on GitHub.** The template published there pins `0a50bb1`, whose `action.yml` has no `relock-pr` at all. | recorded; not run on a runner |
| A Linux runner's line endings | LF checkouts | emulated with `core.autocrlf=false` in every Action workspace. Dev's laptop is this host: global `core.autocrlf=true`, which is Git for Windows' default. | both |
| The runtime upstream check | a GitHub API quota | rate-limited for the whole run (other walkers share the address). It added an `info` row to every watch. | as found |

## L2 journal

**Setup from a clean site folder (act `fresh`).** I read the README's "Use it". It says "From your site's repository
root:" and then `node dist/cli/index.js init ...`. I typed that literally in my site repository and got `Error: Cannot
find module ...dist\cli\index.js`, so the line means the clone. I cloned Plumbline (0.84 s from the local stand-in), ran
`npm ci` (4.69 s) and `npm run build` (2.84 s), then ran `node <clone>/dist/cli/index.js init --root ./site --workflow`
from my repository. It took 303 ms and exited 1:

```
init: wrote plumbline.lock.json (2 grounding sources, 4 runtime files, 0 peers, 1 pending)
warn  peer http://127.0.0.1:4201/coinbridge_fx: A peer could not be captured, so the lock holds it as pending and every watch reports it (the address is not https).
init: wrote .github/workflows/plumbline-watch.yml (root: site)
next:
  1. Commit plumbline.lock.json and .github/workflows/plumbline-watch.yml. The watch needs nothing else: no key, no trust file.
  ...
```

Setup cost:

- Commands: six (clone, `npm ci && npm run build`, `init`, `git add`, `commit`, `push`), plus one failed literal attempt.
- Files: two written by the product, none by hand.
- Time: about 9 s of machine time and 6 to 8 minutes of mine, mostly reading and sorting out the path. No key.

The next steps say `plumbline watch ...`, and my shell says `plumbline: command not found`. The help flags do not help:

- `plumbline --help`: `plumbline: unknown command: --help` and a list of names, exit 2.
- `watch --help` and `init --help`: `unknown argument --help` and the usage.
- `diff --help`: `plumbline diff: unknown option: --help`.

To turn on the accept-by-pull-request loop I edit the workflow `init` wrote: three lines (`relock-pr: true`,
`contents: write`, `pull-requests: write`). Its own header still says "It never pushes or opens a PR". In this world the
partner is pending. That is the world's rule; a real https partner would be captured. So I captured it through the
harness (`--relock`: "added peer ..., removed pending ...") and committed that as my starting lock.

**The Windows trap.** My laptop runs Git for Windows with `core.autocrlf=true`, the installer's default. I ran `init` in a
checkout made that way, committed, and watched the same commit as the Linux runner checks it out (LF). It exited 1:

```
warn  grounding agent-manifest.json: A grounding source changed since the lock was written; the agent now answers from different facts.
warn  grounding meridian_trips.network.json: A grounding source changed since the lock was written; the agent now answers from different facts.
block runtime runtime/NOTICE: A vendored runtime file differs from the locked copy; the runtime is copy-do-not-change.
block runtime runtime/README.md: ...   block runtime runtime/engine.js: ...   block runtime runtime/ui.js: ...
```

Not one byte of meaning had changed. It bit again later: when I `git checkout`-ed an older commit, Git rewrote the network
file with CRLF, and my own terminal said "the agent now answers from different facts". The only warning anywhere is three
sentences deep in `docs/gate-and-watch.md:125-127` ("a site repository that does not pin LF will see drift ... and should
add that line"). `init` does not check for CRLF or for `.gitattributes`, and neither the README nor the next steps
mention it (DEV-L2-1).

**Quiet days.** r0 (partner unchanged): watch exit 0, issue `none`, PR `none`. r2 (no change, with the issue and PR open):
issue `none`, PR `none`. Silence on a quiet day works. Every watch carried
`info runtime cognizant-ai-labs/agentic-web: Could not check upstream: GitHub rate-limited the request until epoch 1794999868.`
I would have to convert that raw epoch by hand (DEV-L2-2).

**`partner-adds-agent`.** My terminal, with the product CLI:
`warn peer http://127.0.0.1:4201/coinbridge_fx: A peer could not be reached (the address is not https), so it was not checked.`
That is the same sentence it prints when the partner is unchanged and when it is down. The harness printed:
`block peer ...: A peer's network definition changed since the lock was written; it runs in the visitor's browser, so a changed one is changed code. In outline: agents: 1 added, 0 removed, 1 changed; outbound hosts: 1 added, 0 removed; front agent: unchanged.`

Scheduled run r1: issue `create`, PR `create --draft`, push exit 0, job succeeded.

- The issue body is the one-row table above. Its advice is "run `node dist/cli/index.js watch --root <path to your site>
  --relock`, sign the site again (the lock is a signed file) and commit both". I have no signature.
- The PR body says "changed `peer ...`", repeats the findings table, and then: "**Not signed.** The lock is a signed file,
  so the site's signature reads invalid (tampered) until it is signed again. ... It stays a draft until then."

**"Which host?"** I fetched the partner's manifest and network by hand: three commands, 3 s of machine time, about
3 minutes of mine. I can see two hosts, `mcp.coinbridge-rates.example` and `mcp.ledgerline.example`, and nothing says
which one is new. `plumbline diff` needs the old file. My repository history holds only hashes, and nothing in it names
`fee_estimator` or `fx_front`.

Reading `src/watch/outline.ts:89-90` showed me the lock stores the plain SHA-256 of each host and agent name. Hashing my
candidates against the lock then told me `mcp.ledgerline.example` and `fee_estimator` are the new ones. That took about
5 more minutes, and only because I read the source. What changed inside `fx_front` I cannot learn at all.

**I mark the draft ready (r3).** A keyless publisher cannot merge a draft, so I marked it ready. The next scheduled run had
nothing new, but it planned `{"action":"edit","draft":"true"}` and ran the push. The step exited 1 and the job failed:

```
 ! [rejected]        HEAD -> plumbline/relock (stale info)
error: failed to push some refs to '...remote.git'
```

`gh pr ready --undo` never ran, so the PR stays ready, and every later run goes red the same way until I merge.

Control arm, in the same workspace: `refs/remotes/plumbline/plumbline/relock` had been fetched. The Action's own push
failed again. The same push with `--force-with-lease=refs/heads/plumbline/relock:refs/remotes/plumbline/plumbline/relock`
succeeded (dry run, exit 0). The lease form is the cause.

**Second drift while the first is open.** I put the PR back to draft to isolate this.

- `partner-adds-links` (r4): the harness added
  `block peer ...: A peer now publishes a links.json it did not have when locked; the runtime lays it over the peer's links, so this is changed code.`
  The issue was edited with comment `""`, and no comment was written. The PR edit's push was rejected (stale info) and the
  job FAILED. The served `links.json` points `settlement_partner` at
  `https://agents.ledgerline.example/ledger_settlement`, a third host the finding never mentions.
- `partner-changes-again` (r5): the outline became "agents: 1 added, 0 removed, 2 changed". The issue was edited with no
  comment again. The PR push was rejected and the job FAILED.
- What GitHub would show after r5: the PR still says "1 changed" and has no links.json row, and its branch lock still holds
  `links: absent` and the first change's hash. The issue's digest stayed
  `[["block","peer","http://127.0.0.1:4201/coinbridge_fx"]]` throughout. Nobody was notified.

**New bytes, same counts (walker-built act, r6).** The partner's fee went from 0.9% to 1.1%. I set the stub PR's body to
r5's, as if r5's update had worked. The issue plan was `none` and the PR plan was `none`: both bodies were identical once
the run URL was masked. A fee change in a partner my visitors run produced no signal at all, on any surface.

**I merge the stale PR (r7).** GitHub keeps the head branch by default. The next run:

- The watch was still `block` ("agents: 0 added, 0 removed, 2 changed" plus the links.json row).
- The issue was edited with no comment.
- The PR plan was `create`, but the push was rejected (stale info), `gh pr create` never ran, and the job FAILED.

The loop stays dead until someone deletes the branch. I deleted it by hand (r8: PR created, push exit 0), then merged.
r9 was clean, and issue #1 closed with "Plumbline watch is clean as of ... Closing. (Clean is not safe: it means nothing
locked has drifted.)". That closing note was its only comment across four partner states.

**`partner-reformats` against `partner-adds-agent` (the control).** The reformat gave `block peer ...: ... Formatting or
non-agent content only: no agent, outbound host or front agent changed.`. The added agent gave "agents: 1 added ...;
outbound hosts: 1 added". Told apart, and both stay block. `--json` carries the `expected` and `actual` hashes and no
count fields. Scheduled run r10: issue `create`, PR `create`, push rejected because r8's merged branch was kept, job
FAILED.

**`partner-down` (r12; I had accepted the reformat locally and deleted the branch first).** The harness and the Action
printed `warn peer ...: A peer could not be reached (the connection failed), so it was not checked.`, exit 1, and the
issue was created. A PR titled "Plumbline: accept the drift (relock)" was created with this change list:

```
- added `pending http://127.0.0.1:4201/coinbridge_fx`
- removed `peer http://127.0.0.1:4201/coinbridge_fx`
```

I merged it, as its title invites. The partner came back with its fee at 1.4% (a walker edit after `partner-back`). r13
said `warn peer ...: A peer could not be captured when the lock was written (pending since 2026-11-18), so it is not
watched; run watch --relock once it answers.`. There was no block, and the issue was edited with no comment. The new PR
offers "added `peer ...`": merging it would lock the 1.4% definition without anyone having been told it changed.

**Cut the partner instead (r14, the CLI arm, no harness).** I removed the link label, the tool reference and the sentence
from `meridian_trips.network.json`.

- Before the relock: a grounding warn plus the pending peer.
- The relock printed `removed pending http://127.0.0.1:4201/coinbridge_fx`, `changed grounding
  meridian_trips.network.json`, and the "signed file" reminder (on my unsigned site).
- After the relock: only the info row, exit 0, and no "no drift" line.
- The scheduled run closed issue #5, and closed PR #7 with "Plumbline watch no longer finds anything to accept as of ...
  Closing.".

`agent-manifest.json` still lists `"allowed_peers": ["http://127.0.0.1:4201"]` and nothing says so; `allowed_peers` is
read nowhere in `src/` (DEV-L2-3). The branch `plumbline/relock` from r13 is still on the remote, so the next drift's PR
will fail to push again.

**The Desk** (`#/drift`, `http://127.0.0.1:4200/`). I read it twice:

- "Before": Meridian's lock pins the partner's current bytes. The reading took 206 ms.
- "After": the lock pins the original bytes, and the harness says `block ... agents: 1 added, 0 removed, 2 changed ...`
  plus the links.json block.

Both readings were word for word "Drift read: 1 finding, Warning. Unsigned lock: the host can rewrite it." and "A peer in
this lock was not contacted: it is not an https address, which a published lock may not point a browser at."
(`dev-desk-drift-before`, `dev-desk-drift-after`). That is never clean, and it is honest, but in this world it cannot tell
me that the partner changed. The driver exited 2 on my expectation "the Desk tells Dev the partner changed". That is a
finding about the world's http partner, not the Desk.

The pre-load partner check ("Check the partners now") covers Agent Atlas and Agent Customs only, a list fixed in
`site/desk.js:61-62`. I cannot point it at Coinbridge (`dev-desk-partners`, the second exit-2 expectation). The answer to
"what does the pre-load check show for the changed partner" is: nothing, by design. Meridian's visitors run the unmodified
runtime (accepted gap).

## L2 scored criteria

| # | Criterion | L2 | Live evidence | Change from L1 |
| --- | --- | --- | --- | --- |
| 1 | Clean checkout to lock and watch workflow: one command each, under 10 min, no key | **pass** | `init` took 303 ms; the whole setup about 9 s of machine time and 6 to 8 min of mine; no key. Friction: the README's literal line fails ("Cannot find module"), `plumbline` is not on PATH, and on Windows the default `autocrlf` makes the first CI run cry block (DEV-L2-1). | same; a new trap found |
| 2 | A changed partner is block, with counts, and no partner words | **pass** | r1 issue row, quoted above | same |
| 3 | The actual old-versus-new difference with a product command | **fail** | The old file exists nowhere. The hand fetch gives the new file only. Names are recoverable only by hashing candidates after reading `outline.ts`, and the changed agents' content never. | same; slightly narrowed |
| 4 | Accepting gives a reviewable change list before anything is locked or signed on Dev's behalf | **pass** | r1 PR body. Nothing was signed (no key), and the lock moved only on merges and relocks I made. Caveats: the body tells a keyless site it will read "invalid (tampered)", and after a second drift the reviewable list is stale (r5). | same |
| 5 | Removing the partner is a documented path that leaves the watch clean | **pass** | r14: relock "removed pending ...", CLI exit 0, issue and PR closed. Neither the issue nor the PR offers it, and `allowed_peers` is left behind silently. | same |
| 6 | A second drift while the first is open updates the same issue or PR and does not fail | **fail** | r4, r5: the issue was edited with no comment, the PR push was rejected "stale info", the job FAILED, and the PR still shows the first change. r7, r10: after any merge, the create fails too. | same, wider |
| 7 | Whatever was unreachable is reported as not checked, never clean | **pass** | r12: warn "so it was not checked", exit 1. The Desk: "was not contacted". Ceiling: once an outage relock is merged, the partner is "not watched" rather than compared (DEV-L1-05). | same |
| 8 | Alert to decision under 10 minutes | **fail** | First drift: about 1 min for the issue, 3 to hand-fetch the new file, 5 to identify the new host by hashing after reading the source, 2 for the PR: 10 to 12 min, and over the bar without the source-reading trick. Second drift: 15 to 30 min debugging a red job and deleting a branch. | same |

**Score: 5 of 8**, unchanged from L1. The failures go deeper (criterion 6), and one trap sits outside the criteria
(CRLF).

## Findings (L2)

```json
[
  {
    "id": "DEV-L1-01",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L1",
    "type": "broken-flow",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "completion",
    "title": "The relock pull request's branch push is rejected (stale info) on every run after the branch exists",
    "expected": "A second drift while the relock PR is open replaces the Action's own branch and edits the same PR (action/README.md:77: 'it is replaced on each push, --force-with-lease').",
    "got": "Live, through action.yml's own step text with real git. The push was rejected in r3 (PR marked ready, plan edit), r4 (partner-adds-links), r5 (partner-changes-again), r7 (create after a merged PR whose branch GitHub keeps) and r10 (create again). Each time the step exited 1 and the job FAILED; `gh pr edit`, `gh pr ready` and `gh pr create` never ran. The PR kept the first change's body and lock. After a merge, no new PR could be opened until a person deleted the branch by hand (r8). Control arm: the fetched ref refs/remotes/plumbline/plumbline/relock existed; the Action's `--force-with-lease=refs/heads/plumbline/relock` failed, and `--force-with-lease=refs/heads/plumbline/relock:refs/remotes/plumbline/plumbline/relock` succeeded (dry run, exit 0).",
    "evidence": ["action/action.yml:246-255", "action/action.yml:261-265", "action/README.md:77", "action/report.test.mjs:530", "shots/dev/ci-r3-marked-ready.txt", "shots/dev/ci-r4-adds-links.txt", "shots/dev/ci-r5-changes-again.txt", "shots/dev/ci-r7-after-merge.txt", "shots/dev/ci-r10-reformats.txt", "live control arm: an explicit lease value pushes (journal, r3)"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "scope_note": "Measured with a local bare remote behind the exact github.com URL (insteadOf). 'stale info' is git's client-side refusal of a lease with no expected value, so a real runner behaves the same. GitHub's 'Automatically delete head branches' setting would avoid only the create-after-merge case, not the edit case.",
    "suggested_acceptance": "Two scheduled runs in a row with different drift, the second on the existing branch: the second push succeeds, the PR body and branch lock reflect the second state, and the job is green. The same holds after a merged PR whose branch remains."
  },
  {
    "id": "DEV-L1-02",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "A partner that changes again, or starts serving links.json, while the drift issue is open edits the body with no comment, so no one is notified",
    "expected": "New changed code from the same partner is news: the issue comments (which notifies) naming that the partner changed again.",
    "got": "Live: four runs each planned issue `edit` with comment `\"\"`, and no comment file was written. They were r4 (links.json appeared, a second block row), r5 (outline 1 changed -> 2 changed), r7 (after Dev merged the 'accept' PR the partner still differed) and r13 (the partner came back changed after an outage). The digest stayed [[\"block\",\"peer\",\"http://127.0.0.1:4201/coinbridge_fx\"]] throughout. Issue #1 lived through four partner states and closed with exactly one comment: the closing one.",
    "evidence": ["action/report.mjs:77-93", "action/report.mjs:173-179", "action/report.mjs:206-218", "action/README.md:60-62", "shots/dev/ci-r4-adds-links.txt", "shots/dev/ci-r5-changes-again.txt", "shots/dev/ci-r7-after-merge.txt", "shots/dev/ci-r13-back-changed.txt"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "resolution": "open",
    "suggested_acceptance": "partner-adds-agent, then partner-adds-links, then partner-changes-again with the issue open: runs 2 and 3 each post a comment naming the partner and what is new, while a slower timeout on an unreachable peer still does not."
  },
  {
    "id": "DEV-L1-03",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "senior-quality",
    "title": "No product path to the actual old-versus-new partner definition: diff needs two local files and the old one is kept nowhere",
    "expected": "From the alert, one command shows the agents added, removed and changed and every new host, by name. That is Dev's own `diff` of two saved files: the senior bar.",
    "got": "Live: hand-fetching the manifest and network took three commands and about 3 minutes. It showed two hosts without saying which is new. Dev's repository history holds only hashes; nothing in it names fee_estimator or fx_front. Narrowed: the lock stores the plain SHA-256 of each host and agent name (src/watch/outline.ts:89-90). A reader of the source can hash candidates and identify the added host and agent (mcp.ledgerline.example = f8412fc8..., fee_estimator = ab4737a5...). That path is undocumented, and what changed inside a 'changed' agent can never be recovered.",
    "evidence": ["src/cli/diff-command.ts:198-203", "src/watch/outline.ts:89-91", "src/watch/outline.ts:222-226", "src/watch/capture.ts:144-156", "src/net/locate.ts:146-158", "docs/gate-and-watch.md:258-260", "action/report.mjs:141-148", "journal: hand path and hash check"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "suggested_acceptance": "From the drift issue, one product command (or the issue itself) names the added and removed agents and hosts and shows the changed agents' old-versus-new text, for a partner whose old definition Dev never saved."
  },
  {
    "id": "DEV-L1-04",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "The keyless publisher is told on every accept surface that their signature will read 'invalid (tampered)', and their relock pull request stays a draft that the Action re-drafts",
    "expected": "The no-key watch path the README leads with ('Start with the watch: one command, no key') accepts drift without mentioning a signature the site does not have.",
    "got": "Live, on the unsigned site. Every CLI relock, including the cut, printed 'plumbline.lock.json is a signed file: sign the site again (plumbline sign) and commit both, or its signature reads invalid (tampered).'. The issue says 'sign the site again (the lock is a signed file)'. Every relock PR body says '**Not signed.** ... reads invalid (tampered) ... It stays a draft until then.'. Widened: marking the draft ready is the only way a keyless publisher can merge it, and it made the next run plan {action: edit, draft: true}. Its push was rejected (DEV-L1-01), so `gh pr ready --undo` never ran and the job went red. It goes red on every scheduled run until the merge (r3).",
    "evidence": ["src/watch/decide.ts:492-493", "src/cli/watch-command.ts:123", "action/report.mjs:145-148", "action/report.mjs:273-277", "action/report.mjs:291-302", "action/action.yml:264", "README.md:23", "shots/dev/ci-r1-adds-agent.txt", "shots/dev/ci-r3-marked-ready.txt"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "suggested_acceptance": "On a site with no plumbline.signature.json: the relock output, the issue and the PR body say nothing about signing again, the PR is not a draft, and a scheduled run with the PR open and unchanged is green."
  },
  {
    "id": "DEV-L1-05",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "A relock during a partner outage replaces the partner's pin with 'pending', and the relock PR offers that as 'accept the drift'",
    "expected": "An unreachable partner keeps its pin: the outage is reported, and nothing proposes to stop comparing the partner.",
    "got": "Live (r12): partner-down opened 'Plumbline: accept the drift (relock)' with '- added `pending http://127.0.0.1:4201/coinbridge_fx`' and '- removed `peer http://127.0.0.1:4201/coinbridge_fx`', under a warn saying the peer could not be reached. After the merge, the partner came back with its fee changed 0.9% -> 1.4% (r13). No block was raised, only 'A peer could not be captured when the lock was written (pending since 2026-11-18), so it is not watched'. The issue was edited with no comment. The next PR offered '- added `peer ...`', which, merged, locks the changed definition without anyone having been told it changed.",
    "evidence": ["src/watch/capture.ts:144-167", "src/watch/detectors.ts:180-187", "src/watch/decide.ts:316-329", "action/report.mjs:410-413", "action/report.mjs:254-266", "shots/dev/ci-r12-partner-down.txt", "shots/dev/ci-r13-back-changed.txt"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "suggested_acceptance": "partner-down with relock-pr on: no PR proposes removing the peer's pin; when the partner returns changed, the watch says block with the outline counts."
  },
  {
    "id": "DEV-L1-06",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "severity_l1": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "impact_l1": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "When the partner's bytes move but the outline counts do not, neither the open issue nor the relock PR changes: a fee change goes unannounced",
    "expected": "A PR that says it accepts the current drift locks the current hash, and a new change to partner code is news on the issue.",
    "got": "Live, with a walker-built act: the fee in the added agent's instructions went 0.9% -> 1.1% (`plumbline diff` confirms 'agents changed: fee_estimator'). The issue plan was `none` and the PR plan was `none`, because both bodies were byte-identical once the run URL was masked. The PR branch kept the earlier hash. Widened from L1: the issue is silent too, not only the PR. A money-relevant change in partner code produced no signal on any surface while the issue was open.",
    "evidence": ["action/report.mjs:254-281", "action/report.mjs:300-301", "action/report.mjs:81-93", "shots/dev/ci-r6-walker-act-same-counts.txt"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "scope_note": "The act is the walker's edit of the served partner file in the world's temp folder, restored afterwards. The world has no such act.",
    "suggested_acceptance": "With the issue and PR open, a partner change that keeps the counts produces a PR update (the branch lock holds the new hash) and an issue comment."
  },
  {
    "id": "DEV-L1-07",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "med" },
    "dimension": "effort",
    "title": "The accept-by-pull-request loop is not in the workflow init writes, and the GitHub settings it needs are not named",
    "expected": "One workflow file gives the whole loop, or init offers it, and the docs name every repository setting it depends on.",
    "got": "Live: the workflow init wrote equals the template with root: \"site\". Its header says 'It never pushes or opens a PR', and the loop needs three hand-edited lines. The settings behaviour (whether Actions may create PRs; job-token PRs triggering no checks) cannot be exercised here. Also: the Action published on GitHub today (template pin 0a50bb1) has no relock-pr input at all. The loop exists only in the 19 unpublished commits.",
    "evidence": ["action/templates/plumbline-watch.yml:7-9", "action/templates/plumbline-watch.yml:17-19", "action/README.md:68-88", "git ls-remote: GitHub master 94d7bf7; `git show 94d7bf7:action/action.yml` has 0 'relock-pr'"],
    "code_check": "confirmed-absent",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Needs a scratch GitHub repository (env.md: 'The GitHub Action on a real runner, real pull requests'). The fixture that closes it: a throwaway repository with the template plus relock-pr, run once with 'Allow GitHub Actions to create and approve pull requests' off (the default), then on."
  },
  {
    "id": "DEV-L1-08",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "med" },
    "impact_l1": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "missing",
    "title": "A publisher cannot rehearse the watch against a local or staging partner: no --allow-local on init or watch --root, and loopback peers are refused even by watch --url --allow-local",
    "expected": "Like gate --allow-local, a documented local path to capture and watch a partner on this machine, with private ranges still refused.",
    "got": "Live: every peer-level fact of this journey (r0-r13) was reachable only through the test harness. The product CLI said 'A peer could not be reached (the address is not https), so it was not checked.' identically when the partner was unchanged, changed and down, so a rehearsal tells Dev nothing about the partner. `watch --url --allow-local` said the peer 'was not contacted: it is not an https address'. The cut (r14) worked through the CLI only because the partner was gone.",
    "evidence": ["src/cli/watch-command.ts:92", "src/cli/init-command.ts:217", "src/watch/published.ts:146-147", "src/watch/decide.ts:436-443", "journal: CLI vs harness after partner-adds-agent and partner-down"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "suggested_acceptance": "A documented flag captures and watches a loopback partner (private ranges refused), so a publisher can rehearse partner-adds-agent before going live."
  },
  {
    "id": "DEV-L1-09",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "Getting started needs a build from source, then speaks commands Dev does not have: 'plumbline ...' is not on PATH, the README runs a clone path 'from your site's root', and there is no --help",
    "expected": "A first-time terminal user can copy each printed command and run it, and `--help` explains each command in a line.",
    "got": "Live: the README's line typed from the site repository root gives 'Error: Cannot find module ...dist\\cli\\index.js'. init's next step `plumbline watch ...` gives 'plumbline: command not found'. `plumbline --help`: 'plumbline: unknown command: --help' (exit 2). `watch --help` and `init --help`: 'unknown argument --help' plus the usage. `diff --help`: 'plumbline diff: unknown option: --help'. Cold start: clone 0.84 s, npm ci 4.69 s, build 2.84 s.",
    "evidence": ["README.md:23-30", "src/cli/init-command.ts:188-196", "src/cli/index.ts:39-42", "src/cli/watch-command.ts:36-44", "action/report.mjs:276", "journal: setup"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "open",
    "suggested_acceptance": "Every command the README, init and the alert surfaces print runs as printed after the documented install, and `--help` works on the top level and on each command."
  },
  {
    "id": "DEV-L1-10",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "senior-quality",
    "title": "A partner's links.json that appears or changes is reported without what it routes to, and diff cannot read one",
    "expected": "Like the definition, a links.json change says in counts whether it adds outbound hosts, since links.json maps a network's links to addresses.",
    "got": "Live: the served links.json routes settlement_partner to https://agents.ledgerline.example/ledger_settlement, a host the partner's definition never names. The finding said only 'A peer now publishes a links.json it did not have when locked; the runtime lays it over the peer's links, so this is changed code.'. The definition's outline still read 'outbound hosts: 1 added', which is the MCP host, not this one.",
    "evidence": ["src/watch/decide.ts:262-280", "src/watch/discover.ts:290-293", "src/cli/diff-command.ts:191-194", "shots/dev/ci-r4-adds-links.txt"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "suggested_acceptance": "partner-adds-links: the finding counts the hosts the links.json adds (here 1)."
  },
  {
    "id": "DEV-L1-11",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "Unwired and prose-only values: when the partner was last known good, and the outline counts as fields; no one-line headline on the CLI watch",
    "expected": "The alert says since when (the lock's checkedAt for the partner), --json carries the five counts as numbers for scripting, and the terminal report starts with one line ('1 block, 0 warn').",
    "got": "Live: after the cut, the CLI printed only 'info  runtime cognizant-ai-labs/agentic-web: Could not check upstream: ...' and exited 0, with no 'no drift' line. `--json` on partner-reformats carried the expected and actual hashes and the summary sentence, and no count fields.",
    "evidence": ["src/watch/capture.ts:154", "src/watch/capture.ts:191", "src/watch/decide.ts:306-314", "src/cli/watch-command.ts:139-147", "journal: the cut, and partner-reformats --json"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open"
  },
  {
    "id": "DEV-L1-S1",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "strength": true,
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "Unreachable is never clean: a down partner is warn 'so it was not checked', a missing lock keeps the issue open, and a returning block is said first",
    "expected": "No green tick for what could not be reached.",
    "got": "Live: partner-down gave 'warn peer ...: A peer could not be reached (the connection failed), so it was not checked.', exit 1, and the issue was opened (r12). The Desk said 'was not contacted', never 'No drift'. Ceiling: once an outage relock is merged, the partner is 'not watched' (DEV-L1-05).",
    "evidence": ["src/watch/decide.ts:229-241", "src/cli/watch-command.ts:139-147", "action/report.mjs:65-75", "shots/dev/ci-r12-partner-down.txt", "shots/dev/dev-desk-drift-after.txt"],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "n-a"
  },
  {
    "id": "DEV-L1-S2",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "strength": true,
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "Changed partner code is said in counts without a stranger's words, and a reformat is told apart yet stays block",
    "expected": "'Changed' with a what.",
    "got": "Live control arm: partner-adds-agent gave 'In outline: agents: 1 added, 0 removed, 1 changed; outbound hosts: 1 added, 0 removed; front agent: unchanged.', and partner-reformats gave 'Formatting or non-agent content only: no agent, outbound host or front agent changed.'. Both were block. The issue body says 'A clean report does not mean the site is safe'.",
    "evidence": ["src/watch/decide.ts:243-252", "src/watch/decide.ts:306-314", "action/report.mjs:150", "shots/dev/ci-r1-adds-agent.txt", "shots/dev/ci-r10-reformats.txt"],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "n-a"
  },
  {
    "id": "DEV-L1-S3",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "strength": true,
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "senior-quality",
    "title": "plumbline diff is exactly Dev's own diff for files they hold, and refuses to let a name rewrite the terminal",
    "expected": "Names and hosts, safe to print.",
    "got": "Live on two saved partner files: 'In outline: agents: 0 added, 0 removed, 1 changed; ... agents changed: fee_estimator', exit 1. On identical files: 'The files are identical.', exit 0. Ceiling: Dev never holds the old file (DEV-L1-03).",
    "evidence": ["src/cli/diff-command.ts:179-182", "src/cli/diff-command.ts:198-246", "journal: walker-built act"],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "n-a"
  },
  {
    "id": "DEV-L1-S4",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "strength": true,
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "effort",
    "title": "Setup is one keyless command, the written workflow pins every action by full SHA, and nothing is overwritten",
    "expected": "Pinned everything, no key ceremony to start.",
    "got": "Live: init --workflow wrote the lock and the workflow in 303 ms with no key. The workflow pins checkout, setup-node and the Action by full SHA. The refusal to overwrite was not re-run live. Ceiling: the pin 6b4745751f985cba9c61ac4e532e5e8e91fb4217 is not on GitHub today (GitHub master 94d7bf7 is 19 commits behind), so a workflow written from this tree would not resolve on a runner until the owner's publish gate pushes.",
    "evidence": ["src/cli/init-command.ts:242-267", "action/templates/plumbline-watch.yml:31-43", "git ls-remote https://github.com/xkazm04/plumbline (read-only)"],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "n-a"
  },
  {
    "id": "DEV-L1-S5",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "strength": true,
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "completion",
    "title": "Cutting the partner ends clean, and the relock says so in Dev's terms",
    "expected": "Cut is as clear as accept.",
    "got": "Live, with the product CLI only: the relock printed 'removed pending http://127.0.0.1:4201/coinbridge_fx' and 'changed grounding meridian_trips.network.json', and the watch exited 0. The next scheduled run closed issue #5, and closed PR #7 with 'Plumbline watch no longer finds anything to accept ... Closing.' (r14). Ceilings: no alert surface offers the cut, and agent-manifest's allowed_peers is left naming the partner (DEV-L2-3).",
    "evidence": ["src/watch/index.ts:98-121", "src/watch/decide.ts:462-490", "docs/gate-and-watch.md:304", "shots/dev/ci-r14-cut-cli.txt"],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "n-a"
  },
  {
    "id": "DEV-L2-1",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "A lock written in a Windows checkout (Git's default core.autocrlf=true) makes every CI watch report four runtime blocks and say 'the agent now answers from different facts'; nothing at init warns",
    "expected": "init either checks the bytes it locks for CRLF (or the repository for a .gitattributes LF pin) and says so, or the watch says 'line endings only', and never that the agent's facts changed.",
    "got": "Reproduced: init ran in a checkout made with core.autocrlf=true, was committed, then watched as a Linux runner checks it out (LF). Exit 1 with 'warn grounding agent-manifest.json: ... the agent now answers from different facts.', the same for meridian_trips.network.json, and 'block runtime runtime/NOTICE | README.md | engine.js | ui.js: A vendored runtime file differs from the locked copy'. On Dev's own laptop, `git checkout` of an older commit rewrote the network file with CRLF and the watch said 'the agent now answers from different facts'. The rule (hash exact bytes, pin LF) is deliberate and tested. The only place a publisher is told is docs/gate-and-watch.md:125-127. The README, init's next steps and the issue body say nothing, and the sentence claims a semantic change that did not happen.",
    "evidence": ["docs/gate-and-watch.md:121-127", "src/net/canonical.ts:4-7", "src/test/watch-runtime.test.ts:38", "src/cli/init-command.ts:184-196", "journal: 'The Windows trap'"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "open",
    "scope_note": "Reachability is med: Dev's OS is not stated in the Character, and Git for Windows installs with core.autocrlf=true. The published site is LF (served from git), so watch --url and verify would see the same mismatch.",
    "suggested_acceptance": "init on a CRLF working copy without an LF pin warns and names the .gitattributes line; a CRLF-only difference is reported as such, not as changed facts."
  },
  {
    "id": "DEV-L2-2",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L2",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "The rate-limited upstream check prints a raw Unix epoch: 'until epoch 1794999868'",
    "expected": "A time Dev can read ('until 10:24 UTC').",
    "got": "Every watch in this run carried 'info runtime cognizant-ai-labs/agentic-web: Could not check upstream: GitHub rate-limited the request until epoch 1794999868.'. The quota is per address (60 an hour, unauthenticated), so a pool of CI runners, or several sites, hits it routinely.",
    "evidence": ["src/watch/detectors.ts:111", "shots/dev/ci-r0-baseline.txt"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open"
  },
  {
    "id": "DEV-L2-3",
    "journey": "j2-partner-changed",
    "character": "dev-okafor",
    "cert_level": "L2",
    "type": "missing-feature",
    "severity": "polish",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "completion",
    "title": "No alert surface offers the cut path, and cutting leaves agent-manifest.json's allowed_peers naming the cut partner, without a word",
    "expected": "The issue or PR says 'or remove the partner: delete it from <network> and relock', and the watch notes a manifest that still allows a partner no network names.",
    "got": "The issue and the PR offer only 'accept'. After the cut, the watch was clean (exit 0) while agent-manifest.json still read '\"allowed_peers\": [\"http://127.0.0.1:4201\"]'. allowed_peers is read nowhere in src/.",
    "evidence": ["action/report.mjs:141-148", "docs/gate-and-watch.md:304", "grep allowed_peers src/: test fixtures only", "shots/dev/ci-r14-cut-cli.txt"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open"
  }
]
```

Impact ranks after L2:

- 27: DEV-L1-01, DEV-L1-02
- 18: DEV-L1-03, -04, -05, -06 (now major), DEV-L2-1
- 12: DEV-L1-10
- 9: DEV-L1-11
- 6: DEV-L1-07 (uncertain), DEV-L1-08, DEV-L1-09, DEV-L2-2
- 3: DEV-L2-3

Two things are not raised as findings; the journal answers them:

- **The Desk's drift view reads the same for a changed and an unchanged partner in this world.** A published lock's http
  peer is never contacted, by design, and the world has no https partner. The fixture that would answer this for real is
  a partner on a public https host, or a world-local TLS stand-in with a resolvable name.
- **The Desk's pre-load partner check covers only the Desk's own partners.** That is the accepted gap of the unmodified
  runtime.

## L2 verdict

**L2-conditional.** The path holds live, and Dev finishes every act:

- One keyless command gives a lock and a workflow.
- A changed partner is a block, with counts and none of the partner's words, and a reformat is told apart.
- An outage is never reported clean.
- The first relock pull request opens with a reviewable change list.
- Cutting the partner closes both the issue and the PR.

But seven majors are confirmed live, and most sit exactly where Dev's job lives:

- The bot's push fails on the second drift, after any merge, and after a keyless "mark ready" (DEV-L1-01, -04).
- New partner code arriving while the issue is open notifies no one, and a same-count change reaches no surface at all
  (DEV-L1-02, -06).
- The old definition cannot be recovered (DEV-L1-03).
- A merged outage PR silently stops pinning the partner (DEV-L1-05).
- On Windows, a default Git install makes CI cry block on every runtime file from day one (DEV-L2-1).

**Time saved: about 15 to 18 minutes a week per partner**, against the declared 25. Confidence medium: the machine times
are measured, the human times estimated.

- Quiet weeks really are 0 minutes (r0, r2).
- A change week costs 10 to 12 minutes on a first drift, and 15 to 30 on a second (a red job, a branch deleted by hand).
- The CRLF trap is a one-time 20 to 30 minutes for a Windows user.

The value of catching "the change that would otherwise go unseen" is live, with two holes. The same-count change
(DEV-L1-06) and the change after an outage (DEV-L1-05) both went unseen while the product was running.

**L1 findings: 11 re-verified. 10 confirmed, 0 refuted, 1 uncertain** (DEV-L1-07: it needs a scratch GitHub repository).
All 5 strengths confirmed. The live pass moved these:

- DEV-L1-06: minor -> major (the issue is silent too, not only the PR).
- DEV-L1-08: trust erosion low -> med.
- DEV-L1-03: narrowed (names are recoverable by hashing, after reading the source).
- DEV-L1-01, -02, -04 and -05: widened.

**What the L1 surface model missed:**

- The exact-bytes rule meeting Git for Windows' default line endings (DEV-L2-1). L1 never read the hashing note against
  the publisher's OS.
- How DEV-L1-04 and DEV-L1-01 interact: the re-draft L1 predicted never happens, because the push fails first. What Dev
  sees is a daily red job.
- That the issue, not only the PR, is silent on a same-count change.
- The raw epoch (DEV-L2-2) and the leftover `allowed_peers` (DEV-L2-3).
- Reachability: the PR loop under certification exists only in commits GitHub does not have yet.

## Character feedback (L2)

The watch half is real. One command gave me a lock and a workflow with no key, every action pinned by SHA, and quiet days
were actually quiet. "agents: 1 added; outbound hosts: 1 added" as a block, with none of their words in my issue tracker,
is still the right instinct. When my partner went down it said "not checked", not green.

Then I lived the PR loop, and it is worse than it looked on paper. The first PR opened fine. After that, the bot's push
was rejected with "stale info" every time it mattered: when the partner changed again, after I merged, and after I marked
the draft ready. Marking it ready is the only way I can merge it without a key I was told I didn't need. The issue sat
through four different partner states, edited silently, and got exactly one comment: the one closing it. When Coinbridge
moved a fee from 0.9% to 1.1% while the issue was open, nothing anywhere changed. That is the change I bought this to
catch.

The outage case is the one I'd lose sleep over. The bot offered "accept the drift" with "removed peer". I merged it,
because that's what the title says. The partner came back with a different fee, and the tool said "not watched". No
block.

To see which host was added, I had to read `outline.ts` and hash candidate names against the lock. That's a party trick,
not a product. And on my Windows box, Git's default line endings would have had CI scream "block" on four runtime files on
day one, telling me "the agent now answers from different facts" when nothing had changed. That's crying wolf on day one.

L1 me said "use the issue, skip the PR loop". Live me agrees, and adds two rules: put `* text=auto eol=lf` in
`.gitattributes` before you run init, and never merge a PR that says "removed peer". I'd tell a peer to try it, with a
written list of workarounds. That the list exists is the problem.

## Residue

Written outside the world's temp folder and this run folder:

- `dist/` and `site/lib/plumbline/` in this repository, rebuilt by `npm run build` and `npm run build:site`. `git status`
  was unchanged afterwards: `?? .ai/consults.jsonl`, `?? .claude/`, `?? uat/` only.
- The walker's rig, in the session scratchpad
  (`C:\Users\kazda\AppData\Local\Temp\claude\28455a6400484cf1\fc95aea5-93f6-4074-8c75-4c410b771569\scratchpad\`):
  `ci\ghstub.mjs`, `ci\run-action.mjs`, `ci\ci.sh`, `desk-before.json`, `desk-after.json`, `l2-append.md`.
- `npm ci --prefer-offline` in the world's clone may have touched the user npm cache.

Network contact outside the world:

- Two read-only `git ls-remote https://github.com/xkazm04/plumbline`.
- The CLI's own upstream-runtime check to the GitHub API on each watch (rate-limited throughout).
- One Desk "Check the partners now", which contacts Agent Atlas and Agent Customs.

No git command wrote to this repository (the clone and `ls-remote` only read it). No key was read or made; Dev is keyless.

Teardown: `node uat/driver/world.mjs down meridian-trips` reported `folderGone: true`, `portsStillInUse: []` and
`leftovers: []`. No `plumbline-uat-meridian-trips*` temp folder or state file remains. Right after `down`, `netstat` still
listed 127.0.0.1:4200 and :4299 as `LISTENING` with PID 0; that is the TIME_WAIT residue `env.md` describes. Another
walker's `plumbline-uat-larch-house-*` folder was there before this run and was not touched. No skill run log or registry
lead was written: reflection belongs to the orchestrator.
