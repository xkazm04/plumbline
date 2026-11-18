# Environment

Written 2026-11-18. Windows 11, Git Bash, Node 22 or later (the package asks `>=22`; the run of 2026-11-18 ran on Node
24.22.1, and no behaviour was seen to depend on it). Language: English. No accounts and no sign-in anywhere.

## The product under test

| Surface | How to reach it |
| --- | --- |
| CLI | `npm ci && npm run build`, then `node dist/cli/index.js <command>` |
| The Desk (browser) | `npm run build:site`, then serve `site/` on loopback (the world driver does it; see below) |
| GitHub Action | `action/action.yml`; its decisions are `action/report.mjs`. Its git steps run here against a local bare remote with the real `git`; `gh` is a stub that records calls (there is no GitHub in a world) |

Freshness: rebuild (`npm run build`, `npm run build:site`) before any L2 or recertify pass, and compare `dist/`'s
modification time with `git log -1 --format=%ci`. A stale `dist/` certifies old code.

## Worlds

A world is a set of fictional sites and the events that happen to them. Worlds live in `uat/fixtures/<world>/` and are
materialised into a throwaway folder outside the repository, never edited in place.

```
node uat/driver/world.mjs up <world> [--port-base <n>] [--no-start]   # copy to a temp folder, serve, play the start act, print a JSON map
node uat/driver/world.mjs act <world> <act>                # play one event (a price changes, a peer changes, ...)
node uat/driver/world.mjs status <world>                   # print the same JSON map again (plus serverRunning)
node uat/driver/world.mjs down <world>                     # stop the servers, remove the temp folder
node uat/driver/world.mjs list                             # worlds, ports and their acts (JSON)
```

`up` copies `uat/fixtures/<world>/` to `<OS temp>/plumbline-uat-<world>-<random>/`, replaces each `{{site:<name>}}`
placeholder with that site's address, starts ONE detached server process (`uat/driver/serve.mjs`) for every site and the
Desk, and records its pid and the folder in `<OS temp>/plumbline-uat-<world>.state.json`. It then plays the journey's
starting act (`setup`, `fresh`, `signed`, `portfolio`, `onboarded`) with the real built CLI and throwaway keys;
`--no-start` leaves the world as the fixtures are. Only one copy of a world runs at a time. Every command prints one JSON
document; exit 0 done (an act already in place answers `"already": true` and changes nothing), 1 an act refused (its
precondition is not met: `{"refused": "<why>"}`), 2 usage or environment (`{"error": ...}`).

The JSON map `up` (and `status`) prints:

| Field | What it holds |
| --- | --- |
| `dir`, `stateFile`, `serverPid` | the world's temp folder, its state file, the server process |
| `sites[]` | `name`, `role`, `state` (tallow-finch: what is wrong with it), `folder` (the served root), `repo` (for a publisher's site: the repository folder that holds `site/`), `address` (`http://127.0.0.1:<port>/`), `origin` (no slash, what `sign --origin` takes), `port`, `behaviour` (`up`, `down`, `slow`, per-path settings) |
| `extras[]` | folders that are not sites (northgate-clinic: `harbour-pharmacy`, the verifier's trust file) |
| `desk` | the built Desk (this repository's `site/`, served read-only) at `http://127.0.0.1:<port base + 99>/` |
| `keys`, `keyFiles` | `<dir>/keys/`; per key made so far: its private file, its record and its kid |
| `played`, `acts` | the acts played so far, in order; every act of the world with what it does |
| `logs` | `requests.log` (every request the world served: time, site, method, path, status: what the product fetched), `cli.log` (every CLI command the driver ran, with its output), `history/` (the bytes an act replaced, per act: the world's record, not something a Character has) |
| `start` | the starting act's note and the CLI commands it ran |

| World | Port base | Desk | Sites |
| --- | --- | --- | --- |
| `larch-house` | 4100 | 4199 | the guesthouse (4100), a bike-rental peer (4101) |
| `meridian-trips` | 4200 | 4299 | the travel agency (4200), a currency-converter peer (4201) |
| `northgate-clinic` | 4300 | 4399 | the clinic (4300), the attacker's address (4301: parked until `forgery`); the pharmacy is a folder with a trust file, not a site |
| `tallow-finch` | 4400 | 4499 | twelve client sites, 4400 to 4411, in the order `uat/fixtures/README.md` lists |
| `kiln-row` | 4500 | 4599 | the marketplace (4500), four seller peers (4501 to 4504), the studio with the A2A Agent Card (4505) |

Sites are served over `http` on `127.0.0.1` with `Access-Control-Allow-Origin: *` (except where an act removes it) and
`Cache-Control: no-store`. `uat/fixtures/README.md` lists each world's sites, what each act changes, and what was
observed when each act was played against the real product.

## Reaching a world

Facts, from the built CLI against running worlds on 2026-11-18 (outputs abridged to the lines that decide; the full
transcripts were taken during the driver's verification).

**Reaches a loopback site with `--allow-local`:** `gate`, `verify --url`, `trust --url`, `adopt --url`, `watch --url`.
Without the flag each refuses: `verify --url http://127.0.0.1:4100/` exits 2 with "--url must be an https:// address of
the site base (http only with --allow-local, for a site on this machine)"; `gate http://127.0.0.1:4100/` exits 1 with
every adapter `unavailable` ("the address is not https") and "nothing was checked: every adapter was unavailable, so
this is not a pass". `sign --origin http://127.0.0.1:<port>` is accepted ("http only for localhost and 127.0.0.1").
`--root` commands read the world's folders from disk and need no flag.

```
$ node dist/cli/index.js gate http://127.0.0.1:4100/ --allow-local
gate unavailable: http://127.0.0.1:4100/
  pass        validator: ... found no problem: 1 network definition checked.
  unavailable atlas: Agent Atlas could not connect to the target, so it has no verdict about the site.
  unavailable customs: Unavailable: no receipt for this target in Agent Customs' published receipts. ...
exit 0      (--fail-on unavailable: exit 1)
```

The default adapters send the loopback address to Agent Atlas' public API, which cannot connect to it; for a run that
sends nothing out, pass `--adapters validator`. Atlas and Customs are therefore always `unavailable` in a world.

**Cannot reach a loopback peer at all (a rule of the product, not of the world):**

- `init` and `watch --root` (and `--init`, `--relock`) take no `--allow-local` ("--allow-local goes with --url: a
  checkout is read from disk"). Every peer of a world is `http://127.0.0.1:...`, so `init` records it as pending and
  exits 1: `warn peer http://127.0.0.1:4101/fellside_bikes: A peer could not be captured, so the lock holds it as
  pending and every watch reports it (the address is not https).` After that, every `watch --root` says the same peer
  "could not be captured when the lock was written ... run watch --relock once it answers", or, for a peer already in
  the lock, "A peer could not be reached (the address is not https), so it was not checked." No peer act of J2 or J5
  changes this output.
- `watch --url --allow-local` reads a loopback site's published lock, but refuses every non-https peer address in that
  lock, by design (the lock is a stranger's document).
- `--external a2a-card=http://127.0.0.1:4505/.well-known/agent-card.json` is refused, exit 2: "--external takes an https
  address without credentials". The documented way to add the Agent Card to Kiln Row's lock cannot run in the world.
- `scripts/scan-ecosystem.mjs` refuses a list with an http address ("is not an https address without credentials").

**The harness, `uat/driver/local-cli.mjs`.** Because of the rule above, this TEST HARNESS calls the built product
modules unchanged (`runWatch`, `runRelock`, `scanList`) with the dependency the product's own tests pass
(`fetchOptions: { allowLocal: true }`), and prints what the CLI would print:

```
node uat/driver/local-cli.mjs watch --root <dir> [--init] [--source <ref>]... [--external a2a-card=<url>]... [--json]
node uat/driver/local-cli.mjs watch --root <dir> --relock [--source <ref>]... [--drop <ref>]... [--external a2a-card=<url>]... [--json]
node uat/driver/local-cli.mjs scan <address>... [--out <dir>] [--json] [--real-atlas] [--real-customs]
```

Its `--external` also takes `http://127.0.0.1` addresses. It writes a banner to stderr. With it, the peer and card acts
produce their findings (see `uat/fixtures/README.md`). **Anything a Character does through the harness is "reachable
only through the test harness"**, and that is a finding to record in its own right: the publisher could not have done
it with the product before going live.

**The harness scan sends nothing out by default (since the drain of 2026-11-18).** The product's scan sends every
address to Agent Atlas' public API and reads Agent Customs' public index. Until the drain of run `2026-11-18-first-five`
the harness did the same, so the scan recorded in `uat/fixtures/README.md` sent twelve loopback addresses to the public
Atlas (Priya's L2 walker found it). Now `local-cli.mjs scan` answers every Atlas request locally from the recorded
`src/test/fixtures/wp2/atlas-check-no-manifest.json` with `files[0].status` set to 0 (the shape the adapter reads as
"Agent Atlas could not connect to the target", word for word what the live Atlas answered for a loopback address), and
answers Customs' index and key from the recorded `customs-index.json` and `customs-key.json` (a receipt path answers
404). Every stand-in answer is printed on stderr (`ATLAS STAND-IN answered: <target>`), the counts are printed at the
end, and `--out` writes `harness.json` beside the report saying which checker was a stand-in. `--real-atlas` and
`--real-customs` are the explicit opt-ins to the public services. Verified 2026-11-18 on tallow-finch: all twelve sites,
94 s (70 s of it the slow site), the same summary as the live run (`gate: pass 0, fail 4, unavailable 8`), "ATLAS
STAND-IN answered 12 request(s); 0 went to the public service".

The product's own `gate` still calls Atlas: in a world, run it with `--adapters validator` (sends nothing) or
`--adapters validator,customs` (Customs' index is read; no address is sent).

**The Desk** fetches `http://127.0.0.1:*` itself (its fetcher allows http on `localhost` and `127.0.0.1`, and its CSP's
`connect-src` lists both), so the Desk served at `<port base + 99>` can read a world's sites from the browser. Its drift
reader holds peer addresses in a lock to the same https rule as `watch --url`.

**The runtime upstream check** in every `watch --root` asks the GitHub API (unauthenticated, 60 requests an hour per
address); on 2026-11-18 it answered `info runtime cognizant-ai-labs/agentic-web: Upstream is ahead ... (copied at
7ee54a3; the folder's newest commit is 997c4fb)` for the worlds whose stand-in runtime names agentic-web, and it will
say "Could not check upstream" once the quota is spent. It is `info` and never changes an exit code.

**Git.** A world creates no git repository and no remote. The Action's paths (J1's issue, J2's accept) need one:
`uat/driver/run-action.mjs --setup-remote` makes both (below).

**The Action, run locally: `uat/driver/run-action.mjs` and `uat/driver/gh-stub.mjs`.** Tracked since the drain of
2026-11-18 (first written by Marta's L2 walker; her copies stay in `runs/2026-11-18-first-five/evidence/marta/`). The
runner executes the `run:` blocks of `action/action.yml` verbatim, in bash with `-eo pipefail`, against a fresh clone of
a local bare remote, with the Action's own push URL mapped onto that remote by `url.<remote>.insteadOf` (given through
`GIT_CONFIG_*` env; no git config file is written), and `gh` replaced by the stub (it refuses to start otherwise). The
stub keeps issues and pull requests in `<world>/_uat/gh-state.json` and marks each call with whether GitHub would
notify a watcher (create and comment do; a body edit does not). It never signs (no key is given to the Action), so a
relock pull request is the unsigned draft.

```
node uat/driver/run-action.mjs --world <world dir> --repo <sites[].repo> --setup-remote --label r0 [--harness] [--relock-pr true]
git -C <sites[].repo> commit -am "<what the Character did>" && git -C <sites[].repo> push <world dir>/_uat/remote.git HEAD:refs/heads/main
node uat/driver/run-action.mjs --world <world dir> --label r1 [--harness] [--relock-pr true]
```

`--harness` sends the Action's `watch` to `local-cli.mjs` (so a loopback peer is watched); everything measured that
way is "reachable only through the test harness". Verified 2026-11-18 on larch-house: r0 (`--harness --relock-pr
true`) created the issue and the draft PR (both notify); after `cosmetic-edit`, committed and pushed, r1 edited the
issue, commented, and the PR step failed with `! [rejected] HEAD -> plumbline/relock (stale info)` (the defect the run
found, BACKLOG UAT-5). A real runner, real GitHub notifications and repository settings stay out of reach (see below).

**Browser checks must say what they matched.** Two browser checks in run 2026-11-18-first-five passed vacuously, both
in the J1 walk: a check for "89 or 95" matched the digits `89` inside a 64-character hash, and a check for "says what is
left to do" matched `sign` inside "unsigned lock". The walker caught both and re-ran them with anchored patterns. Since
the drain, `drive-script.mjs` has `expectMatch(label, text, regex)`, which records the matched substring with 40
characters of context in the journal and on stderr. Use it for every text check, anchor the pattern (a currency symbol
before a price, a word boundary around a word), and read the `context` of every PASS before citing it. Verified
2026-11-18 against tallow-finch's Desk: a PASS printed `matched "drift" in "...reads how it has drifted from..."`, and a
FAIL recorded `match: null`.

**Windows residue note.** Right after `down`, `netstat -ano` can still list a port as `LISTENING` with PID 0 for a
minute or two (sockets of the exited server waiting out TIME_WAIT); the port binds normally. `down` itself checks each
port by binding it (`portsStillInUse`) and reports `folderGone`.

## Keys

Worlds make their own throwaway Ed25519 keys in the temp folder. Never read, copy or use any key under the repository
or the owner's `keys/` folder. No model key is committed anywhere.

## What cannot be exercised here, and what would close it

| Gap | State | What would close it |
| --- | --- | --- |
| The Desk's assistant answering live | needs a model key the visitor brings | a key in the tester's own browser profile, or wiring `site/tests/scripted_model.mjs` as a provider for a scripted arm |
| Agent Atlas and Agent Customs verdicts for fictional sites | both are public services that cannot see a loopback site; expect `unavailable` | the harness scan has a labelled stand-in (above); the CLI `gate` and the Desk's check view still call the real Atlas, so in a world use `--adapters validator`, or Priya's `runs/2026-11-18-first-five/shots/priya/arms/gate-arm.mjs`, or a Playwright `context.route` stand-in in the Desk |
| A peer, seller or partner served over https | every world peer is `http://127.0.0.1`, so the CLI reaches none and the Desk contacts none; every peer verdict in run 2026-11-18-first-five was measured through the harness | sites served over https on loopback with a local CA the test browser and Node trust (also closes the pre-load check per seller state, TOM-L2-06) |
| A signature file answering 5xx during a relock; a signed site with no key record | `serve.mjs` has `down`, `slow`, `notFound`, `noCors`, no 500 | a `status500: [paths]` behaviour in `serve.mjs`, and a tallow-finch site whose key record answers 404 |
| The GitHub Action on a real runner, real pull requests | not run | a scratch GitHub repository the owner creates |
| DNS TXT agreement (`trust --require-dns`) | no real zone | an injected resolver, as the unit tests use; the live prompt wording is still judged |
| Upstream runtime check | asks the real GitHub API; rate limits apply | none needed; a rate-limited answer is `info` and is itself part of the experience |

A finding that depends on one of these resolves `uncertain` with the reason, never a silent pass and never `refuted`.

## Residue

A run writes only inside the world's temp folder and `uat/runs/<id>/`. Record anything else written. `down` every
world at the end; list leftover `plumbline-uat-*` temp folders and listening ports in the run notes.

Copy the lock before any relock you did not mean to keep: in run 2026-11-18-first-five a walker ran the real CLI's
`--relock` on a harness-pinned lock "to see how it parses", and it replaced every pin and the Agent Card (TOM-L2-01);
only a saved copy recovered the walk. Parallel L2 walkers share one address, so the runtime upstream check's GitHub
quota (60 an hour) is spent early and every watch then carries an `info` "Could not check upstream ... rate-limited"
line; that is expected noise, not a finding about the walk.

## Browser

`uat/driver/drive-script.mjs` drives the Desk with Playwright (not a dependency of this package). Wait on predicates,
never on sleeps; exit 0 ran and passed, 1 driver error, 2 an `expect()` failed, which is a finding.

Playwright is resolved from `PLAYWRIGHT_MODULE` (a `playwright` package folder) if set, else a plain
`import("playwright")`, else the npx cache, which is where `npx --no-install playwright --version` (1.65.1) resolves it
on this machine: `%LOCALAPPDATA%\npm-cache\_npx\e41f203b7505f1fb\node_modules\playwright` (the driver picks the highest
version under `<npm cache>/_npx/*/node_modules/playwright`). Its Chromium (revision 1255) was installed on 2026-11-18
with `npx --no-install playwright install chromium`; if it is missing, the driver exits 1 and names that command. The
journal's `playwright` field records which copy ran.

```sh
node uat/driver/world.mjs up larch-house              # the Desk is at desk.address, here http://127.0.0.1:4199/
BASE_URL=http://127.0.0.1:4199/ SHOT_DIR=uat/runs/<id>/shots node uat/driver/drive-script.mjs <<'EOF'
await goto(BASE_URL);
await waitUntil(() => document.querySelectorAll('#portlist-items li').length >= 5, { label: 'the five ports are rendered' });
await snap('overview');
expect('the overview lists five ports', (await page.locator('#portlist-items li').count()) === 5);
EOF
```

stdout is one JSON journal (`checks[]`, `snaps[]`, `probes`, `console[]`, `pageErrors[]`); progress is on stderr.
Helpers: `goto`, `click`, `fill`, `probe()`, `snap(name)`, `waitFor`, `waitForText`, `waitUntil(fn, {label})` (fn runs in
the page), `expect(label, condition, extra)`, `expectMatch(label, text, regex)` (records what it matched; prefer it for
any text check), `log`, `note`; the header of the file lists them with their arguments and
the environment variables (`BASE_URL`, `SHOT_DIR`, `TIMEOUT`, `HEADED`, `VIEWPORT`). Verified 2026-11-18: the script
above against kiln-row's Desk at 4599 exited 0 with both checks passing.
