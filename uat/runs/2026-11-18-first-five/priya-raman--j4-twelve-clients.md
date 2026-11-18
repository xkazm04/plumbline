# Priya Raman x j4-twelve-clients - L1

Run `2026-11-18-first-five`, commit `47ea482` (2026-11-18 10:30 +0100), built fresh in a throwaway clone. Walker: L1,
code-grounded, with execution: the real CLI and the product's own scan modules were run against twelve throwaway
sites served on `127.0.0.1:47101-47112` from an OS temp folder (not `uat/fixtures/`, which was being built by
another agent). Throwaway Ed25519 key made by `keygen` in that temp folder; no repository key read or used.

## Verdict

**L1-conditional.** The job completes structurally: the build is fast, the gate stops the defective launch with the
rule named in plain words and exit 1, the default `--fail-on fail` never goes red on a healthy site because Atlas or
Customs could not see it, one command scans twelve sites into one report, a badge exists that never draws green for
"not checked", and licence and data flows are documented. But four majors sit on exactly the surfaces Priya buys on.
(1) The gate's single state folds "two of three checkers passed, Customs has no receipt" into `unavailable`, which the
scan renders "unavailable (not checked)" and the badge "not checked". So a healthy client site and a client site that
is down get the same grey word, and nearly every real site will read that way, because Customs has receipts for few
sites. (2) The scan report is in list order with no "needs attention" rank. (3) The gate sends the target to Agent
Atlas even when it refuses to read the target itself (a non-https or private staging address), and the scan has no
way to leave Atlas out. (4) The scan cannot take her trust file, so a tampered signed client site reads exactly like
an ordinary content drift. **Estimated journey as designed:** first real result in about 10-12 minutes over 4 steps
(read README, clone, `npm ci && npm run build` measured at 7.7 s, `gate <url>`). The full first-time journey (list,
scan, read, per-site badges) takes about 35-40 minutes over about 12 steps. The steady weekly pass is about 15-20
minutes. **Time saved:** about 95 minutes a pass against her declared 120, short of the 105 she was promised, because
a junior must open each grey row's details to tell "checked and fine" from "down", and must run `verify --url` per
signed site to see tampering. Confidence: medium (scan timing measured on loopback; real-network and Atlas latency are
for L2).

## Surface model

Reachability rule (Surface binding): the CLI on her laptop, the Action in clients' repositories, the scan script and
its HTML, and the badge. She holds no client keys, does not sign, and does not use the Desk.

| # | Affordance | Code | Reachable |
| --- | --- | --- | --- |
| A1 | README "Use it" (watch first, signing second; the gate appears once, inside the signing block) | `README.md:21-71`, gate at `:54` | yes |
| A2 | Build from source: `npm ci && npm run build` (prepare also runs `tsc`) | `package.json` scripts; `README.md:26` | yes |
| A3 | `plumbline gate <target> [--adapters] [--fail-on] [--timeout] [--allow-local] [--json]` | `src/cli/gate-command.ts:62-119` | yes |
| A4 | Gate headline `gate <state>: <target>` + one line per adapter; stderr "nothing was checked" | `gate-command.ts:113-117` | yes |
| A5 | Gate exit code (0/1/2; all-unavailable exits 1 under either `--fail-on`) | `gate-command.ts:37-41` | yes |
| A6 | Report state = worst adapter state (fail > unavailable > pass) | `src/gate/context.ts:37-44`, `src/gate/run.ts:86-88` | yes |
| A7 | Validator port sentences (rule phrases, "not the reference code") | `src/gate/adapter-validator.ts:19-103`, `src/gate/validator.ts:52-72` | yes |
| A8 | Atlas adapter: always sends the target to `agent-atlas-phi.vercel.app/api/check` | `src/gate/adapter-atlas.ts:46-52` | yes |
| A9 | Customs adapter: "no receipt for this target" is `unavailable` | `docs/gate-and-watch.md:62-82` | yes |
| A10 | `--allow-local` warning; the Action never passes it | `gate-command.ts:15-16,106`; `action/action.yml:117` | yes (CLI) / no (Action) |
| A11 | `plumbline badge --report <gate json> [--out] [--now]` | `src/cli/badge-command.ts:27-59`, `src/scan/badge.ts:11-53` | yes |
| A12 | Badge state: nothing checked becomes "not checked"; otherwise the report's own state | `badge-command.ts:19-25`; words `badge.ts:18-22` | yes |
| A13 | Badge date = the time it is drawn (`--now` or now); the gate report has no timestamp | `badge-command.ts:30,45`; `src/core/types.ts:309-314` | yes |
| A14 | Scan: `node scripts/scan-ecosystem.mjs <list> --out <dir>` (a repo script, not a CLI command, not in the package `files`) | `scripts/scan-ecosystem.mjs:22-65`; `src/cli/index.ts:15-30`; `package.json` `files` | yes (from a clone only) |
| A15 | Scan list: https only, no credentials; any http line refuses the whole list (exit 2) | `src/scan/run.ts:39-60` | yes |
| A16 | Scan disclosure printed first and written into the report | `scripts/scan-ecosystem.mjs:54-55`; `src/scan/report.ts:65-71` | yes |
| A17 | Per site: gate (all three adapters, no option), `watch --url`, signature and key-record presence | `src/scan/run.ts:105-130` | yes |
| A18 | `report.json` (schema v1, summary counts, sites in list order) | `src/scan/run.ts:133-155`; `report.ts:44-62,86-102` | yes |
| A19 | `report.html`: disclosure, summary counts, one table row per site in list order, details | `report.ts:109-191` | yes |
| A20 | Scan word map: `unavailable` becomes "unavailable (not checked)"; `info` becomes "clean (info only)" | `report.ts:109-121` | yes |
| A21 | Action gate: inputs `target, adapters, fail-on`; output `state`; job summary `### Plumbline gate: <state>` | `action/action.yml:5-26,113-125`; `action/report.mjs:115-119` | yes |
| A22 | Action watch, daily template, drift issue, relock PR | `action/action.yml`, `action/README.md:45-129` | yes (not this journey's core) |
| A23 | `verify --url --trust` (per site; shows `invalid tampered` / `invalid expired`) | `src/cli/commands.ts` | yes, but needs a trust file per client; not in the scan |
| A24 | Docs: `docs/ecosystem-scan.md` (what is sent where, badge), `docs/gate-and-watch.md` (adapters, fail-on), `action/README.md` (CI cost, pinning, releases), `SECURITY.md`, `LICENSE` | as named | yes |
| A25 | The Desk (`site/`) | `site/` | no (not in her binding) |
| A26 | Help: `gate --help`, `badge --help` and the scan's `--help` are refused as unknown options (the usage line is printed) | `gate-command.ts:51-60`; `scan-ecosystem.mjs:29` | yes |

**Wiring audit** (values computed for a user-facing surface that no surface shows):

- `SiteResult.keyRecord`: two fetches per site (`run.ts:117`), shown nowhere in `report.html`
  (`grep keyRecord src/scan/report.ts` finds only the interface, `:33`), and not counted in the summary. A signed client
  that publishes no key record (her first-contact blocker) is invisible in the HTML.
- `nothingChecked()` (`gate-command.ts:29-31`) separates "none checked" from "partly checked" for the CLI exit code and
  the badge, but `report.ts` never uses it. The scan's gate column cannot tell the two apart.
- `elapsedMs` and `settings` appear in the JSON and on stderr only. Harmless.
- Lock state `refused` is counted in the CLI scan's summary ("refused 0") although only a browser can produce it
  (`docs/ecosystem-scan.md:42`). Noise.
- `summary.lock` uses the word map ("not published"), but the table's Lock column prints the raw enum ("absent") with no
  colour class (`report.ts:141,144`). Inconsistent.

## Walkthrough

**Step 1: README to the first command (about 5 minutes of reading).** Q1/Q2: she wants "run it on one real site". The
README's first block is the watch over a site checkout. The gate she actually wants (one URL in, a verdict out) is a
single line inside the signing block (`README.md:54`), with no sentence saying what it prints or that it sends the
address to Atlas. Q3: "From your site's repository root" followed by `node dist/cli/index.js` (`README.md:23-29`)
contradicts itself: `dist/` exists only in the Plumbline clone. She works that out; a junior might not. Not a blocker.
The README never mentions the scan or the badge except as a Documents bullet named "ecosystem scan" (`README.md:82`).
"Ecosystem" is not her word: she would look for "portfolio", "batch" or "many sites".

**Step 2: install (measured).** `git clone` 0.8 s (local), `npm ci` 4.75 s (3 packages; prepare runs tsc), `npm run
build` 2.96 s. Node 24.22.1, npm 11.19.1. Pet peeve "no package to install" fires (an accepted gap), but the cost is
seconds, not minutes. `action/README.md:14-21` states the CI build cost measured (7.5 s) and why there is no cache:
the "what does it cost me in CI minutes" question answered before she asks it.

**Step 3: first gate on a site.** Before go-live, her first try is a staging address over http:

```
$ node dist/cli/index.js gate http://127.0.0.1:47102/
gate unavailable: http://127.0.0.1:47102/
  unavailable validator: Plumbline's port of the reference validation rules (not the reference code) could not run: the target could not be reached (the address is not https).
  unavailable atlas: Agent Atlas could not connect to the target, so it has no verdict about the site.
  unavailable customs: Agent Customs was not asked: the target could not be reached to learn its network address (the address is not https).
plumbline gate: nothing was checked: every adapter was unavailable, so this is not a pass
exit 1
```

Q4: honest (exit 1, "not a pass"), but the sentence does not point at `--allow-local`. Note what just happened: the
validator refused the address, yet the address was sent to Agent Atlas anyway (the atlas line is Atlas's own answer).
`isHttpUrl` (`gate-command.ts:104`) is the only check before `runGate`, and the Atlas adapter fetches unconditionally
(`adapter-atlas.ts:46-50`). A `http://10.x` intranet staging address would go to Atlas the same way. With `--allow-local`
(this run sent the loopback address to Atlas a second time; that was the second and last Atlas call of this walk):

```
$ node dist/cli/index.js gate http://127.0.0.1:47102/ --allow-local
WARNING: --allow-local: http and loopback addresses are allowed for this run (private ranges stay refused); use it only for a site on this machine
gate unavailable: http://127.0.0.1:47102/
  pass        validator: ... found no problem: 1 network definition checked.
  unavailable atlas: Agent Atlas could not connect to the target, so it has no verdict about the site.
  unavailable customs: Unavailable: no receipt for this target in Agent Customs' published receipts. The live network was not rechecked.
exit 0
```

Q4: "gate unavailable" with exit 0 on her healthy site. She can parse it (validator pass, others not reached), but
her first impression of her first real result is the word "unavailable". On a public client site the Atlas line can
be `pass`, but Customs will still be `unavailable` (no receipt, `docs/gate-and-watch.md:82`), so the headline stays
`unavailable`. Time to here: about 10-12 minutes. Criterion 1 passes.

**Step 4: the twelve states through the gate** (`--allow-local --adapters validator,customs`, so Atlas was not asked
again; the live Atlas answer for loopback is the `unavailable` shown above):

| Site state | Gate headline | Validator sentence (abridged) | Exit (fail-on fail) |
| --- | --- | --- | --- |
| s01 healthy, signed | unavailable | pass, 1 network checked | 0 |
| s02 healthy, unsigned | unavailable | pass | 0 |
| s03 front_man mismatch | **fail** | "1 x a manifest front_man names a different agent than the network's front agent" | 1 |
| s04 repeated key changing instructions | **fail** | "1 x duplicate keys: the reference runtime merges them, so the file means something different from what a JSON reader sees" | 1 |
| s05 missing network file | **fail** | "a network definition named by the manifest is not published (HTTP 404) (0 network definitions checked)" | 1 |
| s06 expired signature | unavailable | pass (the gate does not look at signatures) | 0 |
| s07 tampered signed file | unavailable | pass (it does not look at signatures) | 0 |
| s08 published lock with drift | unavailable | pass | 0 |
| s09 no lock | unavailable | pass | 0 |
| s10 slow (15 s per response) | unavailable | "could not be reached (the request timed out)" + "nothing was checked" | 1 (10 s) |
| s11 down | unavailable | "could not be reached (the connection failed)" + "nothing was checked" | 1 |
| s12 manifest not JSON | **fail** | "the agent-manifest.json is not valid JSON" | 1 |

`--fail-on unavailable` on the healthy s02: exit 1. `--adapters validator --fail-on unavailable` on s02: `gate pass`,
exit 0. So: default `--fail-on fail` is the usable deploy check (it fails real defects, passes healthy sites, and fails
a down site through the nothing-checked rule). `--fail-on unavailable` fails every site Customs has no receipt for,
which is almost all of hers. And neither value can gate a launch site that is not yet public: the Action never passes
`--allow-local` (`action.yml:117`) and there is no folder mode, so in CI an unpublished site is "nothing was checked",
exit 1, under both values. The pipeline needs a public preview deployment first.

Q3/Q4 for the junior on s03: the sentence names the rule and the file kind (manifest `front_man`) and is fixable. On
s04 it does not say whether the repeated key is in the manifest or the network file, or which agent. On a single-network
site that is fine; on a multi-network client site it is a hunt.

**Step 5: one command over all twelve.** The shipped script refuses the list: "line 1 is not an https address without
credentials; ... line 12 ..." (exit 2). There is no `--allow-local` for the scan, so she cannot rehearse it on staging.
Against real https client sites it would run. To see the report a junior would read, I ran the product's own
`scanList` and `renderHtml` (built `dist/scan/*.js`) with the test hook `fetchOptions.allowLocal` and Atlas stubbed to a
transport failure, which matches the live loopback answer. Total 94 s, 70 s of it on the slow site.

```
[1/12] gate unavailable, drift info, signature published, 254 ms
[2/12] gate unavailable, drift info, signature absent
[3/12] gate fail, drift info, signature absent
[4/12] gate fail, drift info, signature absent
[5/12] gate fail, drift info, signature absent
[6/12] gate unavailable, drift block, signature published
[7/12] gate unavailable, drift warn, signature published
[8/12] gate unavailable, drift warn, signature absent
[9/12] gate unavailable, drift not-checked, signature absent
[10/12] gate unavailable, drift not-checked, signature unknown, 70066 ms
[11/12] gate unavailable, drift not-checked, signature unknown, 11 ms
[12/12] gate fail, drift not-checked, signature absent
Summary: Gate: pass 0, fail 4, unavailable (not checked) 8
```

Q4, applying her senior bar (one status word, reason, owner, date, worst first, our defects apart from others'):

- The gate column says "unavailable (not checked)" for s01, s02 and s06-s09, all of which the validator checked and
  passed. The summary's "unavailable (not checked) 8" overstates "not checked" six times. The parenthetical is a false
  sentence for a partly checked report.
- s10 (slow) and s11 (down) carry the same grey gate word as the healthy sites. The down site is told apart only by
  "unreadable" in the Lock column and "could not be read" in Signature. The most urgent row on the page is grey.
- Rows are in list order. Nothing ranks a down site or a `fail` above a healthy one, and the HTML has no script to sort.
- s07 (tampered after signing) and s08 (an ordinary edit) read the same: drift `warn`, "A grounding source changed
  since the lock was written". s07's signature cell is "published d01f47b4ff21d85d (unverifiable here)", the same as the
  healthy s01. `verify --url` with her trust file says `invalid tampered ... A signed file differs from the version that
  was signed.` (exit 1), but the scan takes no trust file.
- s06 (expired) is caught well: drift `block`, "The site's signature expired on 2025-10-31; verifiers now answer
  invalid (expired) until the site is signed again." A junior can act on that.
- s09 and s12 (no lock) are "not checked", never clean. Honest.
- s05's drift is "clean (info only)", because the lock was written without the missing file; the gate's `fail` row
  carries it. Fine, as long as the junior reads both columns.
- Every found-lock site carries the same long info line "Not checked from a published site: ..." in its details.
  Honest, but repeated twelve times it is noise.

**Step 6: the badge.** From `gate --json` reports: s02 (validator pass, Customs no receipt) gave `badge: wrote ... (unavailable)`
and drew `plumbline gate | not checked 2026-11-18` in grey #424242. s11 (down) drew the same. s03 drew red "fail". s02
with `--adapters validator` drew "pass". Under default adapters, a healthy client site's badge is grey "not checked",
identical to a down site's. The date is the day the badge is drawn (`--now` can set any date), not the day the gate ran:
the gate report has no timestamp. "plumbline gate" is product jargon on a client page. The word is always written and
there is an aria-label, which is good.

**Step 7: what was sent where, and the licence.** Licence: `README.md:93-98` and `LICENSE` (Apache-2.0), in seconds.
Data flows: `docs/ecosystem-scan.md:15-28` says it plainly, and the scan prints it before starting; the gate's case is
in `docs/gate-and-watch.md:423` (last line of the file). The README and the gate's own output say nothing about it.
Maintenance: `SECURITY.md`, tagged releases, "Watch > Custom > Releases" (`action/README.md:143-161`).

**Step 8: what she must tell a client the product does NOT do** (in the product's own words, which she can reuse): a
gate pass is not a security review (`docs/gate-and-watch.md:412`); a verified signature says who published and that
nothing changed, not that the site is safe (`README.md:19`, an accepted gap used here as a ceiling); the scan verifies
no signature; drift is checked only against the lock.

## Scored criteria

| # | Criterion | Result | Evidence |
| --- | --- | --- | --- |
| 1 | First real result on one site from the README in under 20 min | **pass** | Measured install 7.7 s; 4 steps; about 10-12 min including reading. Friction: the gate is one line inside the signing block (`README.md:54`), the cwd wording contradicts itself (`:23-29`), and the first result's headline reads "unavailable" |
| 2 | Gate fails a real defect, names the rule in actionable words, exits non-zero | **pass** | s03/s04/s05/s12 all `gate fail`, exit 1, plain rule sentences (`validator.ts:52-68`). Weakness: no file or network named for duplicate keys (PRI-L1-12) |
| 3 | Gate does not fail a healthy site because Atlas/Customs were unreachable, and says so | **pass** (under the default `--fail-on fail`) | s02 exit 0 with "Agent Atlas could not connect", "no receipt". Under `--fail-on unavailable` every such site fails (PRI-L1-07) |
| 4 | One command checks all twelve; one report sorted or sortable by needs-attention | **fail** | One command yes (`scan-ecosystem.mjs`), but rows are in list order (`run.ts:139-144`, `report.ts:139-146`), there is no attention rank in the JSON, and the HTML has no script |
| 5 | Report separates the site's own defects from unavailable checkers | **fail** | Gate column/summary: "unavailable (not checked)" for 6 validator-passed sites and for the down and slow sites alike (`report.ts:112,144,177`). Separation exists only per adapter in the details |
| 6 | A badge a client could show, state in words and a date, never a pass for "not checked" | **pass** (structurally) | `badge.ts:18-22`, live SVG "not checked 2026-11-18" in grey. Caveats: a healthy site is "not checked" under default adapters (PRI-L1-09); the date is the drawing date (PRI-L1-08) |
| 7 | Documentation says what is sent to third parties and the licence | **pass** | `docs/ecosystem-scan.md:15-28`, `docs/gate-and-watch.md:423`, `README.md:93-98`. Not in the README body or the gate's output (PRI-L1-04) |
| 8 | A junior could run the weekly pass from a procedure of 10 lines or fewer | **pass** | Pull, build, scan, open the HTML, then rules for fail / block / warn / unreadable / grey-unavailable / signed sites: about 9 lines. Two of them are interpretation rules the report should carry itself (PRI-L1-01, PRI-L1-05) |

**Score: 6 of 8 passed.**

## Findings

```json
[
  {
    "id": "PRI-L1-01",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "A healthy site that the validator passed is shown as 'unavailable (not checked)' in the scan and as a gate 'unavailable' headline",
    "expected": "A site whose validator (and Atlas) passed, with only Customs lacking a receipt, reads as checked and passing by the checkers that ran, with the unchecked one named; 'not checked' only when nothing was checked",
    "got": "The report state is the worst adapter state, so pass + unavailable = unavailable. The CLI headline reads 'gate unavailable', the scan's gate column and summary read 'unavailable (not checked)' (6 of 8 such sites in the run were validator-passed), and the Action summary reads '### Plumbline gate: unavailable'. Customs has receipts for few sites, so this is the normal state of a healthy client site",
    "evidence": ["src/gate/context.ts:37-44", "src/gate/run.ts:86-88", "src/scan/report.ts:109-121", "src/scan/report.ts:144", "src/scan/report.ts:177", "src/cli/gate-command.ts:113", "action/report.mjs:115-119", "docs/gate-and-watch.md:82", "live: scan summary 'Gate: pass 0, fail 4, unavailable (not checked) 8'"],
    "code_check": "present-broken: nothingChecked() exists (gate-command.ts:29-31) and separates none from partial for the exit code and the badge, but report.ts never uses it, and the WORDS map hard-codes '(not checked)' for every unavailable",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Run the scan and the gate on a real public healthy site (the seed list's Desk or Atlas) and on tallow-finch's healthy sites; confirm the headline, gate column and Action summary read 'unavailable' with validator pass. Precondition: tallow-finch up; the scan run against loopback needs the harness hook (the shipped script is https-only)"
  },
  {
    "id": "PRI-L1-02",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "clarity",
    "title": "A client site that is down or too slow gets the same grey gate word as a healthy site; nothing says 'site down'",
    "expected": "The report separates 'our site is down or timing out' (her defect, most urgent) from 'a third-party checker had no verdict', with the down site at the top in an alarm colour",
    "got": "s10 (slow) and s11 (down): gate 'unavailable (not checked)' in grey, lock 'unreadable' (no colour class), drift 'not checked', signature 'could not be read'. Only the details say 'the connection failed' / 'the request timed out'. The CLI gate does exit 1 for them (the nothing-checked rule), so the deploy check is right; the portfolio report is not",
    "evidence": ["src/scan/report.ts:112", "src/scan/report.ts:117", "src/scan/report.ts:141-144", "src/scan/report.ts:167", "src/gate/adapter-validator.ts:21-25", "live: report.html rows site-9 and site-10"],
    "code_check": "confirmed-absent: no site-reachability state exists in SiteResult; it must be inferred from lock 'unreadable' plus signature 'unknown'",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Play tallow-finch's down and slow sites through the scan; check whether a junior reading only the table and summary would rank them first. Precondition: tallow-finch up with its down and slow sites"
  },
  {
    "id": "PRI-L1-03",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "effort",
    "title": "The scan report is in list order with no 'needs attention' rank; the HTML cannot be sorted",
    "expected": "One report sorted worst-first (or with one attention field to sort by): fail and down first, then block, warn, not checked, clean",
    "got": "Sites appear in the order of the list file in report.json and report.html; there is no combined attention field; the page is static with no script by design (CSP default-src 'none')",
    "evidence": ["src/scan/run.ts:139-144", "src/scan/report.ts:139-146", "src/scan/report.ts:161", "docs/ecosystem-scan.md:87-91"],
    "code_check": "confirmed-absent: grep 'sort' src/scan/*.ts finds nothing",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Confirm the order on tallow-finch's twelve-site report and time how long a junior takes to list the sites needing action. Precondition: tallow-finch up"
  },
  {
    "id": "PRI-L1-04",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "The gate sends a staging address to Agent Atlas even when it refuses to read that address itself, and the scan cannot leave Atlas out",
    "expected": "A target the gate itself refuses (http without --allow-local, a private range) is not sent to a public third party. The gate says on its output that it sent the address to Atlas. The scan takes --adapters (or a no-Atlas switch) for pre-launch or confidential client lists",
    "got": "Live: 'gate http://127.0.0.1:47102/' without --allow-local -> validator 'the address is not https', yet atlas answered 'Agent Atlas could not connect to the target' (the address was sent). The only pre-check is isHttpUrl; the Atlas adapter fetches unconditionally. scanSite calls runGate({ target }) with all adapters and the script has no option. The disclosure is in docs/ecosystem-scan.md and the last line of docs/gate-and-watch.md, not in the README or the gate's output",
    "evidence": ["src/gate/adapter-atlas.ts:46-52", "src/cli/gate-command.ts:104-110", "src/scan/run.ts:113", "scripts/scan-ecosystem.mjs:22-33", "docs/gate-and-watch.md:423", "README.md:16", "README.md:54"],
    "code_check": "confirmed: no scheme or address-range guard before the Atlas fetch; a 10/8 or 192.168/16 http target would be sent the same way (by reading, not run)",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "With a recorded Atlas stand-in (env.md gap), assert which targets reach the Atlas URL: http loopback without --allow-local, a 192.168 address, an https private-resolving name. Do not send more real addresses to Atlas. Precondition: a world-local Atlas stand-in"
  },
  {
    "id": "PRI-L1-05",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "high" },
    "dimension": "missing",
    "title": "The portfolio scan cannot use the agency's trust file, so a tampered signed client site looks like an ordinary content drift",
    "expected": "An operator who holds her clients' public keys passes a trust file to the scan and gets verified / invalid tampered / invalid expired per site",
    "got": "The scan trusts no key by design: s07 (tampered after signing) reads drift 'warn, A grounding source changed' and signature 'published (unverifiable here)', the same as s08 (an ordinary edit) and s01 (healthy) apart from the drift column. 'verify --url --trust' on s07 says 'invalid tampered', exit 1, but only one site at a time",
    "evidence": ["src/scan/run.ts:126", "src/scan/report.ts:34-38", "src/scan/report.ts:143", "docs/ecosystem-scan.md:45", "live: verify --url s07 'invalid tampered', s06 'invalid expired', s01 'verified'"],
    "code_check": "by-design for a stranger's list (first contact is a person's decision); missing for an operator's own portfolio",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "On tallow-finch's tampered and expired sites, confirm the scan rows match a healthy-signed row except for drift, and that verify --url tells them apart. Precondition: the world's throwaway keys and a trust file"
  },
  {
    "id": "PRI-L1-06",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "completion",
    "title": "The deploy gate cannot check a launch site before it is public: in CI an unpublished site is 'nothing was checked', exit 1, under both --fail-on values",
    "expected": "A pre-launch gate over the build output (a folder) or a documented path for a non-public staging site in CI",
    "got": "The gate takes only an http(s) address. The Action never passes --allow-local and checks public https sites only. So the pipeline must deploy a public preview before the gate can say anything. Locally, --allow-local --adapters validator works (exit 0 on healthy, 1 on defect)",
    "evidence": ["src/cli/gate-command.ts:18-26", "src/cli/gate-command.ts:104", "action/action.yml:115-120", "action/README.md:42-43", "live: s10/s11 'nothing was checked' exit 1"],
    "code_check": "confirmed-absent: no --root mode for the gate; the validator rules are pure (validator.ts) and could run on files",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Play tallow-finch 'fix-launch': gate the defective launch site locally (--allow-local) before and after, under both --fail-on values and with --adapters validator; record exit codes and headlines. Precondition: tallow-finch up"
  },
  {
    "id": "PRI-L1-07",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "--fail-on unavailable is recommended without saying it fails almost every site, because Customs has receipts for few sites",
    "expected": "The fail-on advice warns that Customs has no receipt for most sites, so --fail-on unavailable with the default adapters goes red for a third party's coverage, and names the setting to use instead",
    "got": "docs/gate-and-watch.md:413 and action/README.md:41 recommend it 'if a partly checked site must not ship'; the coverage caveat is 70 lines earlier, in the Customs section. Live: healthy s02 exit 1 under --fail-on unavailable",
    "evidence": ["docs/gate-and-watch.md:22", "docs/gate-and-watch.md:82", "docs/gate-and-watch.md:413", "action/README.md:40-43", "action/action.yml:15-18"],
    "code_check": "behaviour as designed; the documentation placement is the gap",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Confirm on a real public site with the default adapters that --fail-on unavailable exits 1 only because of Customs. Precondition: one real public site, one Atlas call"
  },
  {
    "id": "PRI-L1-08",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "The badge's date is the day it is drawn (or any --now), not the day the gate ran",
    "expected": "The date on a client-facing badge is the date the site was checked, taken from the report",
    "got": "GateReport has no timestamp; badge uses --now or the current time. A report from last week drawn today says today; --now can write any date",
    "evidence": ["src/core/types.ts:309-314", "src/cli/badge-command.ts:30", "src/cli/badge-command.ts:45", "docs/ecosystem-scan.md:95-97"],
    "code_check": "confirmed by reading; adding a checkedAt to GateReport is a wire change (CLAUDE.md law: types.ts with signature-format.md and check:wire)",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Draw a badge from a gate report written earlier and from --now in the past; record what the SVG says. No precondition"
  },
  {
    "id": "PRI-L1-09",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "senior-quality",
    "title": "With the default adapters, a healthy client site's badge is grey 'not checked', identical to a down site's",
    "expected": "A badge a client could show for a healthy site (for example 'pass, 2 of 3 checkers', or a documented adapter choice), distinct from a site that could not be reached",
    "got": "Live: s02 (validator pass, Customs no receipt) -> 'plumbline gate | not checked 2026-11-18' in #424242; s11 (down) -> the same SVG. Only --adapters validator(,atlas) yields 'pass', and the badge docs do not mention that",
    "evidence": ["src/cli/badge-command.ts:19-25", "src/scan/badge.ts:11-22", "src/gate/context.ts:37-44", "docs/ecosystem-scan.md:93-99"],
    "code_check": "same root as PRI-L1-01 (worst() folding), on the client-facing branch; the badge's pass and fail branches are clean",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Render the healthy and down badges side by side; ask whether a client could read the difference. Precondition: tallow-finch healthy and down sites"
  },
  {
    "id": "PRI-L1-10",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "missing",
    "title": "The key record is fetched for every site but never shown in the HTML report or counted in the summary",
    "expected": "A signed client that publishes no .well-known/plumbline-key.json is flagged (first-contact verifiers cannot get the key; sign itself warns about it)",
    "got": "SiteResult.keyRecord is computed (two fetches per site) and written to report.json only; renderHtml never reads it; summary has no keyRecord count. Live: s01 signed with key record absent shows nothing in the HTML",
    "evidence": ["src/scan/run.ts:116-117", "src/scan/report.ts:33", "src/scan/report.ts:139-155", "src/scan/report.ts:86-102"],
    "code_check": "present-but-unwired (wiring audit: grep keyRecord in report.ts finds only the interface)",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Confirm in the rendered HTML for a signed site without a key record. No precondition beyond a world site"
  },
  {
    "id": "PRI-L1-11",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "The many-sites scan is hard to find: a repo script named 'ecosystem scan', absent from the README's Use it, not a CLI command, https-only with no local rehearsal",
    "expected": "A portfolio command named in her words, in the README's first screen, runnable from the CLI and on a staging list",
    "got": "'node scripts/scan-ecosystem.mjs' appears only in docs/ecosystem-scan.md, linked once from the README's Documents list; 'plumbline scan' -> 'unknown command'; the script is not in the package files; an http line refuses the whole list (exit 2); --help is refused",
    "evidence": ["README.md:21-71", "README.md:82", "src/cli/index.ts:15-30", "scripts/scan-ecosystem.mjs:15-33", "src/scan/run.ts:52-55", "package.json files"],
    "code_check": "confirmed",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Time a cold reader from the README to running the scan. No precondition"
  },
  {
    "id": "PRI-L1-12",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "Validator failures say which rule but not which file or network ('roughly where')",
    "expected": "A junior is told whether the repeated key is in agent-manifest.json or which network file, and which network a front_man mismatch concerns",
    "got": "'1 x duplicate keys: ...' and '1 x a manifest front_man names a different agent ...' with only '(1 network definition checked)'. Agent names are withheld on purpose (a stranger's words); the file path is the scanner's own URL, not a stranger's sentence",
    "evidence": ["src/gate/adapter-validator.ts:39-102", "src/gate/validator.ts:70-72"],
    "code_check": "by design for names; the file location is not withheld by any rule we found",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "On a multi-network world site with a duplicate key in one network, check whether a junior finds the file from the sentence alone. Precondition: a multi-network fixture"
  },
  {
    "id": "PRI-L1-13",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "README 'Use it' says 'from your site's repository root' and then runs node dist/cli/index.js, which exists only in the Plumbline clone; the gate is one unexplained line inside the signing block",
    "expected": "One working directory per block, and the one-URL gate presented as the quickest first result with what it prints and sends",
    "got": "README.md:23-29 mixes the two cwds; action/README.md:4 has the right form (node <clone>/dist/cli/index.js). README.md:54 shows the gate without a sentence",
    "evidence": ["README.md:23-29", "README.md:54", "action/README.md:3-6"],
    "code_check": "confirmed by reading",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Follow the README literally from a site repository root; record the first error. No precondition"
  },
  {
    "id": "PRI-L1-14",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "The launch gate passes a signed site whose signature is expired or whose signed files were tampered with",
    "expected": "A deploy gate for a signed client notices the signature is expired or broken (or says plainly that signatures are not its job, at the point of use)",
    "got": "s06 (expired) and s07 (tampered): validator pass, exit 0. Expiry is caught only by watch/scan (drift block); tampering only by verify --url with a trust file",
    "evidence": ["src/gate/run.ts:45-49", "docs/gate-and-watch.md:410-416", "live: gate s06/s07 exit 0"],
    "code_check": "by-design scope of the gate; the gap is that the deploy check does not say it",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Confirm on tallow-finch's expired and tampered sites, and through the Action's job summary. Precondition: tallow-finch up"
  },
  {
    "id": "PRI-L1-15",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "polish",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "Report noise: 'refused 0' in the CLI scan's summary, a raw 'absent' in the Lock column beside 'not published' elsewhere, and the same long 'Not checked from a published site' info on every found-lock site",
    "expected": "Only states the CLI can produce; one word per state across table and summary; a caveat stated once",
    "got": "As listed; plus --help is refused as an unknown option by gate, badge and the scan script (the usage line is printed)",
    "evidence": ["src/scan/report.ts:96-101", "src/scan/report.ts:141-144", "src/scan/report.ts:177", "src/cli/gate-command.ts:51-60", "docs/ecosystem-scan.md:42"],
    "code_check": "confirmed",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Low: glance at the rendered HTML. No precondition"
  },
  {
    "id": "PRI-L1-S1",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "strength": true,
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "Nothing checked is never a pass: a down or timing-out site exits 1 under either --fail-on, with a plain sentence; a third party down alone never fails a healthy site under the default",
    "expected": "The deploy gate is red for my outage, not for theirs",
    "got": "s10/s11: 'plumbline gate: nothing was checked: every adapter was unavailable, so this is not a pass', exit 1; s02: exit 0 with 'Agent Atlas could not connect'",
    "evidence": ["src/cli/gate-command.ts:28-41", "src/cli/gate-command.ts:117"],
    "code_check": "confirmed live",
    "verdict": "uncertain",
    "resolution": "n-a",
    "l2_priority": "Guardrail: keep it true in the Action (exit code read straight from the CLI, action.yml:118-125)"
  },
  {
    "id": "PRI-L1-S2",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "strength": true,
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "The scan says what it sends where before it starts and at the top of the report",
    "expected": "No quiet calls with my clients' addresses",
    "got": "Five fixed sentences printed to stderr before the first site and written as the report's first section",
    "evidence": ["src/scan/report.ts:65-71", "scripts/scan-ecosystem.mjs:54-55", "src/scan/report.ts:174-175"],
    "code_check": "confirmed",
    "verdict": "uncertain",
    "resolution": "n-a",
    "l2_priority": "Guardrail"
  },
  {
    "id": "PRI-L1-S3",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "strength": true,
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "senior-quality",
    "title": "Actionable, honest sentences where the scan does see a problem: an expired signature is a block with the date and the consequence; no lock is 'not checked', never clean",
    "expected": "Sentences a junior can act on",
    "got": "'The site's signature expired on 2025-10-31; verifiers now answer invalid (expired) until the site is signed again.' / 'no lock: this site publishes no plumbline.lock.json, so there is nothing to compare against.'",
    "evidence": ["src/scan/report.ts:76-83", "docs/gate-and-watch.md:114"],
    "code_check": "confirmed live",
    "verdict": "uncertain",
    "resolution": "n-a",
    "l2_priority": "Guardrail"
  },
  {
    "id": "PRI-L1-S4",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "strength": true,
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "effort",
    "title": "Buyer questions answered up front: build cost measured (7.5 s, no cache, why), pinning by SHA, releases for security fixes, Apache-2.0, a security policy",
    "expected": "Who maintains this, what it costs in CI, what licence",
    "got": "Measured install 4.75 s + build 2.96 s here, matching the documentation's claim",
    "evidence": ["action/README.md:14-21", "action/README.md:143-161", "SECURITY.md:1-40", "README.md:93-98"],
    "code_check": "confirmed live",
    "verdict": "uncertain",
    "resolution": "n-a",
    "l2_priority": "Check the runner's own number in the Action smoke log"
  },
  {
    "id": "PRI-L1-S5",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "strength": true,
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "The badge never draws green for 'not checked', and always writes its word (colour is never the only signal; title and aria-label repeat it)",
    "expected": "Never shows a pass for not checked",
    "got": "Grey #424242 'not checked'; nothing-checked reports are drawn 'not checked' whatever their state says",
    "evidence": ["src/scan/badge.ts:11-22", "src/scan/badge.ts:42-52", "src/cli/badge-command.ts:19-25"],
    "code_check": "confirmed live",
    "verdict": "uncertain",
    "resolution": "n-a",
    "l2_priority": "Guardrail"
  }
]
```

Shared-mapping audit (gate state, as each surface shows it):

| Branch | CLI headline / exit | Action summary | Scan gate column | Badge |
| --- | --- | --- | --- | --- |
| every selected adapter pass | `pass` / 0 | clean | clean | clean (green "pass") |
| any adapter fail | `fail` / 1 | clean | clean (red) | clean (red "fail") |
| all unavailable (down, slow, refused) | `unavailable` + "nothing was checked" / 1 | says `unavailable` only (the stderr sentence is not in the summary) | "unavailable (not checked)": true, but grey, the same as partial | "not checked": true, same as partial |
| partial (some pass, rest unavailable) | `unavailable` / 0 under fail | `unavailable` with a green job | **"unavailable (not checked)": false** | **"not checked": false** |

Drift mapping (`driftStateOf`, `report.ts:76-83`): clean, info->"clean (info only)", warn, block and not-checked are
all honest. `not-checked` merges no lock (s09, s12) with a site that is down (s10, s11); the Lock column tells them apart.
Signature mapping: published/absent/unknown are honest. Healthy-signed, expired and tampered all read "published
(unverifiable here)"; expired is rescued by drift, tampered is not (PRI-L1-05).

Known-defects list in `uat/accepted-gaps.md`: all six concern watch/relock/issue paths outside this journey. None were
exercised or contradicted here.

## What L2 must check

1. On tallow-finch (precondition: world up; for loopback the scan needs the `allowLocal` hook, because the shipped
   script is https-only), confirm the scan table's gate column reads "unavailable (not checked)" for validator-passed
   sites and for the down and slow sites alike, in list order (PRI-L1-01/02/03).
2. With a world-local Atlas stand-in (env.md gap), record which targets reach the Atlas URL: http loopback without
   `--allow-local`, a private-range http address (PRI-L1-04). Do not send more real addresses to the live Atlas.
3. `fix-launch` act: the gate on the launch site before and after, under `--fail-on fail`, `--fail-on unavailable`, and
   `--adapters validator`; exit codes and headlines (PRI-L1-06/07).
4. Tampered vs drifted vs healthy-signed rows in the scan, and `verify --url` on each with the world's trust file
   (PRI-L1-05/14).
5. Badges for healthy, down and defective sites side by side; a badge drawn from an older report (PRI-L1-08/09).
6. A real public site with default adapters (one Atlas call): confirm the headline is `unavailable` because of Customs
   alone, and the Action job summary for it.

Run notes: temp folder `%TEMP%\plumbline-uat-pri-l1` removed; the loopback server stopped (no process left; Windows
showed sockets on 47101/47106 owned by PID 0 in teardown). Two calls reached the live Agent Atlas, both with the
loopback address `http://127.0.0.1:47102/`. Customs' public index and key were read twelve-plus times (nothing sent to
it). Scratch scripts are in the session scratchpad, not in the repository.

## Character feedback (L1)

I gave it my twenty minutes and it held up better than most: clone, `npm ci`, build in under ten seconds, and the gate
on a broken launch site said "a manifest front_man names a different agent than the network's front agent", exit 1. My
junior can fix that without calling me. I like that it went red when the site was down and stayed green on a healthy
site when Atlas couldn't see it; that is exactly the "don't fail me for someone else's outage" rule I ask every vendor
about, and here it's written into the exit code.

Then I ran all twelve and the page told me eight of them were "unavailable (not checked)". Six of those had passed.
Two were down. Same grey word, list order, and I had to open each site's details to find out which was which. That is
a report that needs its author to interpret it, and I won't hand it to a junior or anywhere near a client. The badge
has the same problem: my healthy client gets a grey "not checked", the same picture as a client whose site is offline,
with the date I drew it rather than the date it was checked. And the tampered site looked like an ordinary content
change, because the scan won't take the trust file I'd happily give it for my own clients.

What made me sit up: when my junior forgets `--allow-local`, the gate refuses to read our staging address itself and
still sends it to Agent Atlas. The scan has no switch to leave Atlas out. They do tell me so, in the scan and in the
docs, which is more than most tools do, but "documented" is not "optional".

Would I adopt it? For the deploy gate, yes, today, with `--fail-on fail` and Atlas turned off for staging. For the
weekly portfolio pass, not until the report sorts worst-first and stops calling a checked site "not checked". I'd tell
a peer the gate is honest and the build is painless, and that the portfolio report is a good JSON file waiting for a
better page. The licence, the security policy and the measured CI cost answered my buyer questions before I asked
them, and that earns them a second look next quarter.


---

# Priya Raman x j4-twelve-clients - L2

Run `2026-11-18-first-five`, commit `47ea482`, rebuilt before driving (`npm run build` 2.9 s, `npm run build:site` 3.1 s;
`dist/cli/index.js` 11:25:55 +0100, newer than the commit at 10:30:23 +0100). Node v24.22.1 on this host (`uat/env.md`
says Node 22; the package asks `>=22`). World `tallow-finch` up at 11:26 (5.0 s), ports 4400-4411 and the Desk at 4499,
folder `%TEMP%\plumbline-uat-tallow-finch-7ZFjQl`. Evidence: `uat/runs/2026-11-18-first-five/shots/priya/` (screenshots
`pri-l2-*`, badges `badges/*.svg`, scans `scan-before/` and `scan-after/`, and the arm scripts in `arms/`).

**Agent Atlas budget: exactly two gate runs reached the public Agent Atlas.** Call 1 was the README's own example,
`gate https://agent-atlas-phi.vercel.app/` (it sends Atlas's own public address to Atlas). Call 2 was
`gate http://127.0.0.1:4403/ --allow-local` with the default adapters, which **sent a loopback address
(`http://127.0.0.1:4403/`) to Atlas**. Every other run used `--adapters validator`, `--adapters validator,customs`
(Customs is only read; nothing about the target is sent to it), or a **world-local Atlas stand-in that I built**
(`arms/gate-arm.mjs`, `arms/scan-arm.mjs`, and a Playwright `context.route` in the Desk). The stand-in answers from the
recorded response `src/test/fixtures/wp2/atlas-check-no-manifest.json` with `files[0].status` set to 0. The adapter maps
that shape to "Agent Atlas could not connect to the target", which is word for word what live call 2 returned.

**A note on the harness:** `uat/driver/local-cli.mjs scan` has **no Atlas stub**. It runs `scanList` with the real
fetcher, so a harness scan of tallow-finch sends all twelve loopback addresses to the public Atlas. The scan described
in `uat/env.md` ("all adapters", 96 s) did exactly that. For this reason I did not use the harness scan as shipped. I
used `arms/scan-arm.mjs`, which is the harness scan plus the Atlas stand-in and nothing else. This is a gap in the
overlay, not in the product.

## L2 preflight

| Carried `l2_priority` | Environment precondition | Satisfied here? | Arm used |
| --- | --- | --- | --- |
| PRI-L1-01: gate/scan/Action read "unavailable" with the validator passing, on a real public healthy site and on the world's healthy sites | world up; a scan route to loopback; one real public site | Yes. World up. The public site was the README's example (Atlas call 1). The scan route was **built**: the harness has no Atlas stub, so I added one (`arms/scan-arm.mjs`) | live CLI + stand-in + Action arm |
| PRI-L1-02: down and slow sites in the scan | world's 4409 (12 s per response) and 4410 (refuses) | Yes | stand-in scan |
| PRI-L1-03: list order, time to list action sites | world up | Yes | stand-in scan + browser |
| PRI-L1-04: which targets reach the Atlas URL (http without the flag, private range, https resolving private) | a world-local Atlas stand-in (an `uat/env.md` gap) | **Built.** `arms/gate-arm.mjs` runs the built `runGate` with the CLI's exact options and answers Atlas locally, recording each target it receives | stand-in |
| PRI-L1-05/14: tampered vs drifted vs healthy-signed rows; `verify --url` with a trust file | the world's keys and a trust file | Yes, **without touching any private key**: `trust --url ... --allow-local --yes` read each site's published `.well-known/plumbline-key.json` into a scratch trust file | live CLI |
| PRI-L1-06: `fix-launch` before and after, both `--fail-on`, `--adapters validator` | world up | Yes | live CLI + stand-in |
| PRI-L1-07: a real public site with the default adapters fails under `--fail-on unavailable` only because of Customs | one real public site, one Atlas call | Yes (Atlas call 1). I computed the `--fail-on unavailable` exit from the live report with the built `gateExitCode`, so I did not spend a third Atlas call | live + built function |
| PRI-L1-08: a badge drawn from an older report / `--now` in the past | none | Yes | live CLI |
| PRI-L1-09: healthy and down badges side by side | world's healthy and down sites | Yes | live CLI + browser |
| PRI-L1-10: HTML for a signed site without a key record | a signed site that publishes no key record | **Partly.** Every signed tallow-finch site publishes its key record, so the specific consequence cannot be shown. The general claim (the HTML never shows the key record) is checked in the render. A fixture that would close it: a signed site whose `.well-known/plumbline-key.json` answers 404 | browser |
| PRI-L1-11: a cold reader goes from the README to the scan | none | Yes | live |
| PRI-L1-12: a multi-network site with a duplicate key in one network | a multi-network fixture | **Built.** `arms/control-arm.mjs` serves dunmore-books with a second network that carries the pre-fix bytes (from the world's history). Only that one file is answered from memory | built arm |
| PRI-L1-13: follow the README literally from a site root | none | Yes | live |
| PRI-L1-15: glance at the rendered HTML | none | Yes | browser |
| PRI-L1-S1: the Action keeps the exit code | the Action's shell steps | Yes. The steps are copied verbatim into `arms/action-gate.sh`, using the clone as `GITHUB_ACTION_PATH`. A real runner is not available (`uat/env.md`) | Action arm |
| PRI-L1-S4: the runner's own build number | a real runner | **No** (`uat/env.md` gap). A local measurement stands in | local |
| Control arms for every "the gate caught X" claim | the same site with X fixed | `fix-launch` covers 4403. The other three are **built** in `arms/control-arm.mjs`, with one file answered fixed and the world's files untouched | live + built |

## L2 journal

**11:25 Rebuild and freshness.** Built, and `dist/` is newer than HEAD. Node v24.22.1.

**11:27 First-result clock, from a fresh clone.** I cloned the local checkout into `%TEMP%\plumbline-uat-pri-l2-clone`.
Measured: `git clone` 1,512 ms, `npm ci` 4,576 ms (3 packages; prepare runs tsc), `npm run build` 3,428 ms. That is
**9.5 s of machine time** before the first command.

Then I followed only the README. Its "Use it" section is 799 words, about 4 minutes to read for someone technical. It
opens with "From your site's repository root:" and then `npm ci && npm run build # in a clone of this repository`. Taken
literally, from a client site folder:

```
$ npm ci                                   (in the client site folder)
npm error code EUSAGE  ... can only install with an existing package-lock.json   exit 1
$ node dist/cli/index.js init --root ./site --workflow
node:internal/modules/cjs/loader:1568 throw err;   (MODULE_NOT_FOUND)               exit 1
```

Decision point 1: she goes back into the Plumbline clone, which the comment says to use. There, README line 27 runs
**against Plumbline's own Desk** (`./site` in the clone), and it looks like a success:

```
$ node dist/cli/index.js init --root ./site --workflow          (in the clone)
init: kept the plumbline.lock.json that is there (accept changes with watch --relock after a review)
init: wrote .github/workflows/plumbline-watch.yml (root: site)
next: 1. Commit plumbline.lock.json and .github/workflows/plumbline-watch.yml. ...                exit 0, 322 ms
$ node dist/cli/index.js watch --root ./site
info  runtime cognizant-ai-labs/agentic-web: Could not check upstream: GitHub rate-limited the request until epoch 1794999868.   exit 0
```

That is a confident "result" on the wrong site, and it wrote a workflow into the tool's own checkout. Decision point 2:
she works out that `./site` must be her own site's folder. `watch --root <client folder>` exits 0. The only thing it
prints is the rate-limit info line, with a raw epoch number; nothing says "clean".

Decision point 3: her clients' staging addresses are http. `watch --url http://127.0.0.1:4400/` printed `lock
unreadable: The lock could not be fetched (the address is not https)` with exit 1, and it does not mention
`--allow-local`. The README mentions `--allow-local` only for the gate (line 67). The gate line (54) is the one example
she can run directly: `gate https://agent-atlas-phi.vercel.app/` (Atlas call 1, 918 ms):

```
gate unavailable: https://agent-atlas-phi.vercel.app/
  pass        validator: ... found no problem: 1 network definition checked.
  pass        atlas: Agent Atlas reports the target conformant to its checks (score 100, no failed MUST checks).
  unavailable customs: Unavailable: no receipt for this target in Agent Customs' published receipts. The live network was not rechecked.
exit 0
```

On her own client: `gate http://127.0.0.1:4400/ --allow-local --adapters validator` gives `gate pass`, exit 0, in
413 ms.

**Measured result:** 9.5 s to install and build, plus about 1.5 s per command. Everything else is reading and
detours, which I estimate rather than measured: about 4 minutes for the README, 1-3 minutes for the two cwd detours, and
1-2 minutes to find `--allow-local`. **First real result on one of her sites: about 8-11 minutes, 8 steps, 3 decision
points.** The README assumes three things she does not know:
- the two blocks run from different folders;
- `./site` means her site, not the clone's;
- `--allow-local` also works for `watch --url`.

It never states the Node version. Criterion 1 holds.

**11:29 The gate, as Priya.** Healthy site 4400 and the launch site 4403. "Stand-in" means the default three adapters
with Atlas answered locally. The 4403 default `fail` row was also run live (Atlas call 2) and gave the same output.

| Site | Adapters | `--fail-on fail` | `--fail-on unavailable` |
| --- | --- | --- | --- |
| 4400 healthy | validator | `gate pass`, exit 0 | `gate pass`, exit 0 |
| 4400 healthy | default (stand-in) | `gate unavailable`, exit 0 | `gate unavailable`, **exit 1** |
| 4403 launch (duplicate `commondefs`) | validator | `gate fail`, exit 1 | `gate fail`, exit 1 |
| 4403 launch | default (live call 2 and stand-in) | `gate fail`, exit 1 | `gate fail`, exit 1 |
| 4403 after `fix-launch` | validator | `gate pass`, exit 0 | `gate pass`, exit 0 |
| 4403 after `fix-launch` | default (stand-in) | `gate unavailable`, exit 0 | `gate unavailable`, **exit 1** |
| Atlas's public site (call 1) | default | `gate unavailable`, exit 0 | exit 1 (built `gateExitCode` on the live report) |

The launch sentence: "1 x duplicate keys: the reference runtime merges them, so the file means something different
from what a JSON reader sees (1 network definition checked)." A junior knows the rule but is not told the key
(`commondefs`) or the file.

**What leaves the machine, measured with the stand-in.** I ran these exactly as the CLI runs them, with the Atlas
requests answered locally:

| Target (no other flags) | Validator says | Sent to Atlas? |
| --- | --- | --- |
| `http://127.0.0.1:4400/` (no `--allow-local`) | "the address is not https" | **yes** |
| `http://192.168.1.20/` | "the address is not https" | **yes** |
| `https://localhost:4400/` | "resolves to a private or loopback range, which Plumbline refuses to contact" | **yes** |
| `http://10.0.0.5/ --allow-local` | refuses the private range | **yes** |
| `https://staging.tallowfinch.internal/` | "the name did not resolve" | **yes** |

Each one ends "nothing was checked", exit 1, and each address went to Atlas (`ATLAS-STANDIN received: <target>`, one per
run). An agency that checks staging sites therefore sends every internal staging name to a public third party, even
when Plumbline itself refuses to read it. **The scan's loopback refusal** means the same agency cannot rehearse the
portfolio scan on staging at all:

```
$ node scripts/scan-ecosystem.mjs portfolio.txt --out ...
the list was refused: line 1 is not an https address without credentials; line 2 ...; line 12 ...   exit 2
$ node scripts/scan-ecosystem.mjs --help
unknown option --help                                                                                exit 2
```

**11:31 The whole portfolio in one pass** (the harness scan plus the Atlas stand-in, 93.8 s, 70.1 s of it on the slow
site). The summary was `Gate: pass 0, fail 4, unavailable (not checked) 8`. In the browser
(`pri-l2-scan-before-laptop.png`) every grey row looks the same. I read each row the way a junior who has to act on it
would:

| Port | Site | Intended state | Gate (CLI, validator) | Scan row: gate / lock / drift / signature | Could a junior act on the sentence? |
| --- | --- | --- | --- | --- | --- |
| 4400 | alder-bakery | healthy, signed | pass | unavailable (not checked) / found / clean (info only) / published (unverifiable here) | **No action is needed, but the row says "not checked".** Only the details show validator `pass`. A junior may chase it |
| 4401 | brightwater-swim | healthy, unsigned | pass | unavailable (not checked) / found / clean (info only) / not published | Same as 4400 |
| 4402 | copperleaf-dental | `front_man` mismatch | fail | **fail** / found / clean (info only) / not published | **Yes**: "a manifest front_man names a different agent than the network's front agent". One network, so she knows where to look; which name is right is not said |
| 4403 | dunmore-books | THE LAUNCH: repeated `commondefs` | fail | **fail** / found / clean (info only) / not published | **Mostly.** She knows the rule but not which key; on one network the file is obvious. With two networks it is not (built arm: "(2 network definitions checked)", no name) |
| 4404 | elm-street-vets | network file missing | fail | **fail** / absent / not checked / not published | **Yes**: "a network definition named by the manifest is not published (HTTP 404)". The file is not named, but it is the manifest's only one |
| 4405 | fernhill-hotel | signature expired | pass | unavailable (not checked) / found / **block** / published (unverifiable here) | **Yes on what, no on who**: "The site's signature expired on 2026-10-19; verifiers now answer invalid (expired) until the site is signed again." It does not say that the client's key holder must sign, and Priya holds no client keys |
| 4406 | glenrock-gym | signed file tampered | pass | unavailable (not checked) / found / warn / published (unverifiable here) | **No.** "glenrock_gym.network.json: A grounding source changed since the lock was written; the agent now answers from different facts." The natural move is `--relock`, which would bless the tampering. Only `verify --url` says `invalid tampered` |
| 4407 | harbourlight-cafe | menu drift | pass | unavailable (not checked) / found / warn / not published | **Mostly**: "1 of 6 facts the network states are no longer on it". Which fact is not named, so she has to diff |
| 4408 | ivy-lane-florist | no lock | pass | unavailable (not checked) / absent / not checked / not published | **Mostly**: the details say "no lock: this site publishes no plumbline.lock.json". The report does not say to run `init` |
| 4409 | juniper-yoga | slow (12 s) | unavailable, "timed out", exit 1 | unavailable (not checked) / unreadable / not checked / could not be read | **Only from the details.** The gate cell is the same grey as 4400. "Slow but working" and "down" are not told apart |
| 4410 | kestrel-plumbing | down | unavailable, "connection failed", exit 1 | unavailable (not checked) / unreadable / not checked / could not be read | **Not from the table.** The most urgent row on the page is grey and in position 11. The details say "the connection failed" |
| 4411 | lumen-opticians | manifest not JSON | fail | **fail** / absent / not checked / not published | **Yes**: "the agent-manifest.json is not valid JSON" (no line number) |

To list the sites that need action from this page, a junior has to open the details of the 8 grey rows; only the 4 red
`fail` cells point at themselves. The rows are in list order. The page has no script, so it cannot be sorted. The
drive check "the report can be sorted" **failed, driver exit 2** (`scripts: 0`), which is a finding and not a driver
fault.

The **Lock** column prints the raw words `found` / `absent` / `unreadable` with no colour class (row classes `-`),
while the summary says "not published". The CLI summary carries `refused 0`. The same long "Not checked from a
published site" info appears under every one of the 7 found-lock sites.

**11:33 Trust arm for the signed sites.** `trust --url` for 4400, 4405 and 4406 read each published key record:
`kid 9909a5d84df4e966 ... added`. Then `verify --url --allow-local --trust`:
- 4400: `verified ...`, exit 0.
- 4405: `invalid expired ... The signature has expired and must be renewed by the publisher.`, exit 1.
- 4406: `invalid tampered ... A signed file differs from the version that was signed.`, exit 1.
- 4409: `cannot fetch plumbline.signature.json ... (timeout: timed out after 10000 ms)`, exit 2.
- 4410: `... (network: ECONNREFUSED)`, exit 2. The wording differs from the gate's "the connection failed".

So the per-site `verify` tells all three apart, and the scan cannot (PRI-L1-05).

**11:34 The Action's gate path.** I ran `arms/action-gate.sh`. It contains the steps "Check the inputs" and the
`gate` branch of "Run plumbline", copied verbatim, with the clone as `GITHUB_ACTION_PATH`. `adapters:
validator,customs` keeps Atlas out.

- **Arm A (verbatim; the Action never passes `--allow-local`)**. Healthy 4400, launch 4403 and tampered 4406 all
  gave the same result: the input check passes (exit 0, so an http target is accepted), then `plumbline gate: nothing
  was checked ...` appears on stderr only, **STEP EXIT 1**, `state=unavailable`. The job summary is:
  ```
  ### Plumbline gate: unavailable
  - **validator**: unavailable. ... could not run: the target could not be reached (the address is not https).
  - **customs**: unavailable. Agent Customs was not asked: ... (the address is not https).
  ```
  A healthy site and the defective launch are red for the same reason. The summary never says "nothing was checked".
- **Arm B** (`--allow-local` inserted, as if the site were public):
  - 4400 gives STEP EXIT 0 with `### Plumbline gate: unavailable` and a validator `pass` line.
  - 4403 gives STEP EXIT 1 with `### Plumbline gate: fail` and the duplicate-keys sentence.
  - 4406 (tampered) and 4405 (expired) give STEP EXIT 0 with `### Plumbline gate: unavailable`, which is exactly the
    healthy site's summary.
  - 4400 under `fail-on: unavailable` gives STEP EXIT 1.
- `fail-on: fial` is refused before the build: `::error::fail-on must be fail or unavailable` (exit 2).

**11:36 Badges** (`badges/*.svg`, viewed in `pri-l2-badges-laptop.png` and `-phone.png`):
- `healthy-default.svg`, `down-default.svg` and `tampered-default.svg` are **byte-identical** (`cmp`). All three draw
  "plumbline gate | not checked 2026-11-18" in #424242 next to #555, which is grey on grey.
- With `--adapters validator`, the healthy site draws a green "pass 2026-11-18". So do **the tampered site
  (`4406-validator.svg`) and the expired site (`4405-validator.svg`)**.
- `--now 2025-01-01` draws "not checked 2025-01-01". The gate report carries no time.
- The launch site draws a red "fail".
- `badge --help` gives `unknown option: --help`, exit 2.

As a client would see them: grey "not checked" on a healthy site invites a "why is my site not checked?" call. Red
"fail" on a live client page is alarming. Green "pass" on a site whose signature is broken is the one I could not
defend.

**11:38 The Desk as the thing she might show a client** (`pri-l2-desk-check-{healthy,launch,down}-{laptop,phone}.png`).
`#/check` took 1.2 s on the healthy site, 1.9 s on the launch site and 1.0 s on the down site. It is visually far more
presentable than `report.html`: rings, a "Verdict" card, plain words. It has the same fold:
- Healthy 4400 shows "Verdict: Unavailable. No checker failed, but at least one could not answer. That is no verdict,
  never a pass."
- **Down 4410 shows the identical card and sentence.** There, none of the three answered.
- The launch site shows "Failed. At least one checker found a problem. Read its sentence."

**The Desk sent all three addresses to Agent Atlas from the browser**, with no consent card and no sentence on the page
saying so. My `context.route` stand-in recorded `api/check?url=http%3A%2F%2F127.0.0.1%3A4400%2F` and the matching
requests for 4403 and 4410. The page says only "Three checkers answer independently"; `grep` finds no data-flow
sentence in `site/strings.js` or `site/index.html`.

On a phone (390 px) the Desk's dashed frame and map background end about 840 px down, and the rest of the page is
plain. The report overflows the phone width: `scrollWidth` 437 at 390. That drive check **failed, exit 2**. The page is
9,148 px tall.

**11:40 `fix-launch`, then the scan again** (93.7 s): `Gate: pass 0, fail 3, unavailable (not checked) 9; drift: info 3,
warn 3, block 1, not-checked 5`. This matches `uat/fixtures/README.md`. The launch row went from red `fail` to grey
`unavailable (not checked)`, and its drift went from clean to **warn**: "dunmore_books.network.json: A grounding source
changed since the lock was written; the agent now answers from different facts." The fix shows nowhere as green, and the
row now has the same shape as the tampered glenrock-gym row. The only difference is "not published" against "published
(unverifiable here)" in the Signature column. Nothing tells the junior that a fixed network needs `watch --relock`.

**Control arms** for each "the gate caught X" claim, all validator-only. Each one fixes the single file in memory:

| Arm | Result |
| --- | --- |
| 4402 with `front_man` corrected | `gate pass`, exit 0 |
| 4411 with the comment and trailing comma removed | `gate pass`, exit 0 |
| 4404 with a network served at the named path | `gate pass`, exit 0 |
| 4403 after `fix-launch` | `gate pass`, exit 0 |

Each `fail` is caused by the named defect. The two-network arm (the second network carries the old repeated
`commondefs`) gives `gate fail ... 1 x duplicate keys ... (2 network definitions checked)` with no network or file named.

**Cold reader, README to the scan (PRI-L1-11).** The README's "Use it" never mentions the scan. The only route is the
Documents bullet "`docs/ecosystem-scan.md` - the scan of a list of agentic sites". She has to read "ecosystem" as
"my portfolio", open the doc, write a list file and run the script. I estimate 5-8 minutes, ending in a refusal on her
staging list (exit 2) and the scan running only on public https sites.

**11:42 Teardown.** `world.mjs down tallow-finch` reported `stopped: true`, `portsStillInUse: []` and `folderGone: true`.
The clone was removed. No `plumbline-uat-tallow-finch*` folder or state file is left, and nothing listens on 4400-4499.

## L2 scored criteria

| # | Criterion | L2 | L1 | Evidence |
| --- | --- | --- | --- | --- |
| 1 | First real result from the README in under 20 min | **pass** | pass | 9.5 s of install and build, plus about 1.5 s per command. About 8-11 minutes in all, almost all of it reading, with 3 decision points. Literal-README errors (`EUSAGE`, `MODULE_NOT_FOUND`), and `init` on the clone's own Desk (PRI-L2-4) |
| 2 | Gate fails a real defect, names the rule actionably, exits non-zero | **pass** | pass | 4402, 4403, 4404 and 4411 each give `gate fail`, exit 1, under every adapter set and `--fail-on`. Each control arm passes. The Action arm (as if public) gives STEP EXIT 1 with the rule in the summary. Weakness: no key, file or network named (PRI-L1-12, confirmed on the two-network arm) |
| 3 | Does not fail a healthy site because Atlas or Customs were unreachable, and says so | **pass** | pass | Under the default `--fail-on fail`: healthy 4400 with the stand-in default adapters exits 0. The public Atlas site (live) exits 0 with "no receipt". But the headline is "gate unavailable", and `--fail-on unavailable` fails both (exit 1) |
| 4 | One command checks all twelve; one report sortable by needs-attention | **fail** | fail | List order. No script (drive check exit 2). The shipped command refuses her staging list (exit 2). I had to build the run on loopback |
| 5 | Report separates own defects from unavailable checkers | **fail** | fail | The 8 (then 9) grey "unavailable (not checked)" cells cover 6 validator-passed sites, the slow one and the down one alike (`pri-l2-scan-before-laptop.png`). The Desk shows the same verdict card for healthy and down |
| 6 | A client-showable badge with a state in words and a date, never a pass for "not checked" | **fail** | pass (structural) | Default adapters: the healthy, down and tampered badges are byte-identical "not checked" (grey on grey). The only route to a showable green, `--adapters validator`, also paints the tampered (4406) and expired (4405) sites green "pass", although nothing checked their signatures. The date is the drawing date (`--now 2025-01-01` accepted). No badge passes both "client could show it" and "never green for what was not checked" |
| 7 | Documentation says what is sent to third parties, and the licence | **pass** | pass | `docs/ecosystem-scan.md:17-28`, `docs/gate-and-watch.md:423`, `README.md:93-98`. The scan prints it first. Not in the gate's output, the README body or the Desk's check view (PRI-L2-1) |
| 8 | A junior could run the weekly pass from ten lines or fewer | **pass** (qualified) | pass | Ten lines below. Three of them (5, 8, 9) exist only to correct or complete the report, and the procedure works only for public https sites |

**Score: 5 of 8** (L1: 6 of 8). Criterion 6 moved from pass to fail on live evidence: the identical SVG bytes, and the
green badge on tampered and expired sites.

**The weekly procedure for a junior (ten lines):**

1. `cd ~/plumbline && git pull && npm ci && npm run build` (about 10 s).
2. `node scripts/scan-ecosystem.mjs clients.txt --out out/$(date +%F)`. Use public https addresses only. It sends
   each address to Agent Atlas and takes about 2 minutes for twelve.
3. Open `out/<date>/report.html`. Ignore the row order and work through the rules below.
4. Gate `fail`: the validator sentence in Details names the rule. Fix it in the client repo, then rerun `gate <url>
   --adapters validator`.
5. Lock `unreadable`: the site is down or slower than 10 s. Open it in a browser now; this is ours and comes first.
6. Drift `block` (signature expired): ask the client's key holder to sign again.
7. Drift `warn`: if the change was ours and intended, run `watch --relock` in the repo (and sign again if the site is
   signed). If it was not, investigate.
8. Every site whose Signature says "published": run `verify --url <url> --trust agency.trust.json`. An `invalid
   tampered` result means stop and escalate.
9. Gate "unavailable (not checked)" with Lock `found` or `absent`: if Details shows validator `pass`, the site is fine.
10. Lock `absent`: the site has no lock; schedule `init`.

**Is it honest?** Only partly. It fits in ten lines, but line 9 tells the junior that the report's own words ("not
checked") are wrong, line 5 is how they find a down site that the report colours grey, and line 8 is a per-site loop
the scan cannot do. It covers only sites that are already public over https. For pre-launch staging there is no
product route (PRI-L1-06, PRI-L1-11).

**Time saved, re-estimated:** about **95 minutes a pass** against her 120, with **medium** confidence.
- Install: 10 s.
- Scan: 1.6 min measured on loopback (70 s of it the slow site); allow 2-3 min on the real network, which I did not
  measure.
- Reading the report and opening 8-9 grey Details: about 8-10 min (estimated).
- `verify --url` for the signed sites: about 1 min each, 4 sites here.
- Acting on the 4 fails: not counted.

That makes about 20-25 minutes against her target of 15. This is the same as L1. The live pass added no saving and
found no extra cost.

## Findings (L2)

```json
[
  {
    "id": "PRI-L1-01",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "A healthy site that the validator passed is shown as 'unavailable (not checked)' in the scan and as a gate 'unavailable' headline",
    "expected": "A site whose validator (and Atlas) passed, with only Customs lacking a receipt, reads as checked and passing by the checkers that ran, with the unchecked one named; 'not checked' only when nothing was checked",
    "got": "Confirmed live on every surface. A real public conformant site (the README's own example, Atlas score 100) reads 'gate unavailable' because Customs has no receipt. The world's healthy sites read 'unavailable (not checked)' in the scan. The Action summary reads '### Plumbline gate: unavailable'. The Desk's verdict card reads 'Unavailable'. After fix-launch, the corrected launch site also reads grey 'unavailable (not checked)'",
    "evidence": ["src/gate/context.ts:37-44", "src/scan/report.ts:109-121", "action/report.mjs:115-119", "live: Atlas call 1 'gate unavailable: https://agent-atlas-phi.vercel.app/' validator pass, atlas pass (score 100), customs unavailable, exit 0", "shots/priya/scan-before/report.json summary gate pass 0 fail 4 unavailable 8 (6 of the 8 validator-passed)", "shots/priya/pri-l2-scan-before-laptop.png", "shots/priya/pri-l2-desk-check-healthy-laptop.png", "arms/action-gate.sh arm B 4400: STEP EXIT 0, '### Plumbline gate: unavailable'"],
    "code_check": "present-broken: nothingChecked() exists (gate-command.ts:29-31) but report.ts, badge words and the Desk verdict card never separate partial from none",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Done at L2"
  },
  {
    "id": "PRI-L1-02",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "clarity",
    "title": "A client site that is down or too slow gets the same grey gate word as a healthy site; nothing says 'site down'",
    "expected": "The report separates 'our site is down or timing out' (her defect, most urgent) from 'a third-party checker had no verdict', with the down site at the top in an alarm colour",
    "got": "Live: in the scan, 4409 (slow, 12 s per response, still working) and 4410 (refuses connections) read 'unavailable (not checked)' in the same grey (class s-unavailable) as healthy 4400. The lock column says 'unreadable' with no colour class. Drift says 'not checked' even though Details hold a warn ('signature file could not be read'). Only Details say 'timed out' or 'connection failed'. The Desk shows the identical verdict card for healthy 4400 and down 4410: 'No checker failed, but at least one could not answer', although none answered. Slow-but-working and down cannot be told apart. The slow site costs 70 of the scan's 94 s",
    "evidence": ["src/scan/report.ts:112", "src/scan/report.ts:141-144", "shots/priya/pri-l2-scan-before-laptop.png rows :4409/ :4410/", "shots/priya/pri-l2-desk-check-down-laptop.png", "shots/priya/pri-l2-desk-check-healthy-laptop.png", "drive-after notes.rows: ':4410/ | s-unavailable | - unreadable | s-not-checked'"],
    "code_check": "confirmed-absent: no reachability state in SiteResult; the Desk verdict sentence has one wording for partial and none",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Done at L2"
  },
  {
    "id": "PRI-L1-03",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "effort",
    "title": "The scan report is in list order with no 'needs attention' rank; the HTML cannot be sorted",
    "expected": "One report sorted worst-first (or with one attention field to sort by): fail and down first, then block, warn, not checked, clean",
    "got": "Live: twelve rows in list order. The down site sits in position 11, below six healthy rows. document.scripts.length = 0. The drive check 'the report can be sorted' failed, driver exit 2. To list the sites needing action, a junior must open the Details of 8 grey rows",
    "evidence": ["src/scan/run.ts:139-144", "src/scan/report.ts:139-146", "shots/priya/pri-l2-scan-before-laptop.png", "shots/priya/pri-l2-scan-after-laptop.png", "drive journal: check 'the report can be sorted' pass=false, scripts 0"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Done at L2"
  },
  {
    "id": "PRI-L1-04",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "The gate sends a staging address to Agent Atlas even when it refuses to read that address itself, and the scan cannot leave Atlas out",
    "expected": "A target the gate itself refuses (http without --allow-local, a private range) is not sent to a public third party. The gate says on its output that it sent the address to Atlas. The scan takes --adapters (or a no-Atlas switch) for pre-launch or confidential client lists",
    "got": "Measured with a world-local Atlas stand-in (built gate, the CLI's exact options, Atlas answered locally). Each of these targets reached the Atlas URL while the validator refused it: http://127.0.0.1:4400/ without --allow-local, http://192.168.1.20/, https://localhost:4400/ (resolves to loopback), http://10.0.0.5/ with --allow-local, and https://staging.tallowfinch.internal/ (does not resolve). Each run ended 'nothing was checked', exit 1. Live Atlas call 2 carried http://127.0.0.1:4403/. The scan runs runGate with all adapters and no option. The Desk's check view does the same from the browser (PRI-L2-1)",
    "evidence": ["src/gate/adapter-atlas.ts:46-52", "src/cli/gate-command.ts:104-110", "src/scan/run.ts:113", "arms/gate-arm.mjs runs: 'ATLAS-STANDIN received: <target>' for all five targets", "docs/gate-and-watch.md:423"],
    "code_check": "confirmed: no scheme or range guard before the Atlas fetch",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Done at L2 with the stand-in"
  },
  {
    "id": "PRI-L1-05",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "high" },
    "dimension": "missing",
    "title": "The portfolio scan cannot use the agency's trust file, so a tampered signed client site looks like an ordinary content drift",
    "expected": "An operator who holds her clients' public keys passes a trust file to the scan and gets verified / invalid tampered / invalid expired per site",
    "got": "Live. 4406 (tampered) reads unavailable / found / warn 'glenrock_gym.network.json: ... the agent now answers from different facts' / 'published 215b9d0a02f5d1f3 (unverifiable here)'. After fix-launch, the legitimately fixed 4403 reads the same shape, apart from 'not published'. A junior's natural move on the tampered site is --relock. verify --url with a trust file built from the published key records says 4400 verified, 4405 'invalid expired', 4406 'invalid tampered', one site at a time",
    "evidence": ["src/scan/run.ts:126", "shots/priya/scan-after/report.json sites 4403 and 4406", "live: verify --url 4406 'invalid tampered ... A signed file differs from the version that was signed.' exit 1"],
    "code_check": "by-design for a stranger's list; missing for an operator's own portfolio",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Done at L2"
  },
  {
    "id": "PRI-L1-06",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "completion",
    "title": "The deploy gate cannot check a launch site before it is public: in CI an unpublished site is 'nothing was checked', exit 1, under both --fail-on values",
    "expected": "A pre-launch gate over the build output (a folder) or a documented path for a non-public staging site in CI",
    "got": "Live, with the Action's steps verbatim. Healthy 4400, the defective launch 4403 and tampered 4406 all gave STEP EXIT 1 with the same summary '### Plumbline gate: unavailable ... (the address is not https)'. The input check accepted the http target first. Locally, --allow-local --adapters validator works: launch fail, exit 1; fixed, pass, exit 0",
    "evidence": ["action/action.yml:111-121", "arms/action-gate.sh arm A outputs", "live: gate 4403 --allow-local --adapters validator before/after fix-launch exit 1/0"],
    "code_check": "confirmed-absent: no --root mode for the gate",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Done at L2"
  },
  {
    "id": "PRI-L1-07",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "--fail-on unavailable is recommended without saying it fails almost every site, because Customs has receipts for few sites",
    "expected": "The fail-on advice warns that Customs has no receipt for most sites and names the setting to use instead",
    "got": "Live. The public conformant site (validator pass, Atlas pass score 100, Customs 'no receipt') gives exit 0 under fail and exit 1 under unavailable (built gateExitCode applied to the live report, to keep within the Atlas budget). The world's healthy 4400 and the fixed launch 4403 with the default adapters exit 1 under --fail-on unavailable, as does the Action arm (STEP EXIT 1). Only Customs makes the difference",
    "evidence": ["docs/gate-and-watch.md:413", "action/README.md:40-43", "live: Atlas call 1 output", "arms/gate-arm.mjs 4400 --fail-on unavailable exit 1"],
    "code_check": "behaviour as designed; the documentation placement is the gap",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Done at L2"
  },
  {
    "id": "PRI-L1-08",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "The badge's date is the day it is drawn (or any --now), not the day the gate ran",
    "expected": "The date on a client-facing badge is the date the site was checked, taken from the report",
    "got": "Live: badge --report <today's report> --now 2025-01-01T00:00:00Z wrote 'not checked 2025-01-01' with no warning. The gate report JSON has no time field",
    "evidence": ["src/core/types.ts:309-314", "src/cli/badge-command.ts:30", "shots/priya/badges/healthy-default-now-past.svg"],
    "code_check": "confirmed; a checkedAt would be a wire change",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Done at L2"
  },
  {
    "id": "PRI-L1-09",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "severity_l1": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "impact_l1": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "senior-quality",
    "title": "With the default adapters, a healthy client site's badge is 'not checked', byte-identical to a down site's and a tampered site's; the only way to a green badge also paints broken signatures green",
    "expected": "A badge a client could show for a healthy site, distinct from a site that could not be reached, and never green for a site whose signature is broken",
    "got": "Live. healthy-default.svg, down-default.svg and tampered-default.svg are byte-identical (cmp): 'plumbline gate | not checked 2026-11-18', #424242 on #555, grey on grey. With --adapters validator (the configuration an agency would pick to get a showable badge), the healthy, tampered (4406) and expired (4405) sites all draw green 'pass 2026-11-18'. Widened from L1: L1 compared healthy with down only",
    "evidence": ["src/cli/badge-command.ts:19-25", "src/scan/badge.ts:11-22", "shots/priya/badges/*.svg", "shots/priya/pri-l2-badges-laptop.png", "shots/priya/pri-l2-badges-phone.png"],
    "code_check": "same root as PRI-L1-01 (worst() folding); the gate's scope excludes signatures (PRI-L1-14), and the badge does not say so",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Done at L2"
  },
  {
    "id": "PRI-L1-10",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "missing",
    "title": "The key record is fetched for every site but never shown in the HTML report or counted in the summary",
    "expected": "A signed client that publishes no .well-known/plumbline-key.json is flagged",
    "got": "Live: report.json carries keyRecord for all 12 sites (published for the 5 signed sites, absent or unknown otherwise). The rendered HTML has no key-record word in any row, summary or Details (pri-l2-scan-before-laptop.txt). The specific case of a signed site with no key record does not exist in tallow-finch, so its consequence was not shown",
    "evidence": ["src/scan/report.ts:33", "shots/priya/scan-before/report.json", "shots/priya/pri-l2-scan-before-laptop.txt"],
    "code_check": "present-but-unwired",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Fixture to close the consequence: a signed site whose .well-known/plumbline-key.json answers 404"
  },
  {
    "id": "PRI-L1-11",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "The many-sites scan is hard to find: a repo script named 'ecosystem scan', absent from the README's Use it, not a CLI command, https-only with no local rehearsal",
    "expected": "A portfolio command named in her words, in the README's first screen, runnable from the CLI and on a staging list",
    "got": "Live: the README's Use it never mentions the scan. The only path is the Documents bullet to docs/ecosystem-scan.md (about 5-8 min to reach a run, estimated). On her twelve http staging addresses the script refused the whole list with twelve 'line N is not an https address without credentials' clauses, exit 2. --help gives 'unknown option --help', exit 2",
    "evidence": ["README.md:21-71", "README.md:82", "scripts/scan-ecosystem.mjs", "live: scan-ecosystem.mjs portfolio.txt exit 2"],
    "code_check": "confirmed",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Done at L2"
  },
  {
    "id": "PRI-L1-12",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "Validator failures say which rule but not which file, network or key ('roughly where')",
    "expected": "A junior is told which network file holds the repeated key, and the key's name",
    "got": "Built two-network arm (dunmore-books plus a second network carrying the pre-fix bytes): 'gate fail ... 1 x duplicate keys: the reference runtime merges them, so the file means something different from what a JSON reader sees (2 network definitions checked)'. No file, network or key named. On single-network sites a junior can still find it",
    "evidence": ["src/gate/adapter-validator.ts:39-102", "arms/control-arm.mjs case dunmore-two-networks"],
    "code_check": "by design for a stranger's agent names; the file path and the key name are the scanner's own words",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Done at L2"
  },
  {
    "id": "PRI-L1-13",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "impact_l1": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "README 'Use it' says 'from your site's repository root' and then runs commands that exist only in the Plumbline clone; taken literally inside the clone, init acts on Plumbline's own Desk",
    "expected": "One working directory per block, and the one-URL gate presented as the quickest first result",
    "got": "Live, literal. From a client site folder: 'npm ci' gives 'npm error code EUSAGE' (exit 1) and 'node dist/cli/index.js init' gives MODULE_NOT_FOUND (exit 1). From the clone: 'init --root ./site --workflow' says 'kept the plumbline.lock.json that is there' and 'wrote .github/workflows/plumbline-watch.yml (root: site)', exit 0. That is a confident success on Plumbline's own Desk, and it wrote a workflow into the tool's checkout. Widened at L2: the wrong-cwd path does not fail, it succeeds on the wrong site",
    "evidence": ["README.md:23-29", "README.md:54", "live: clone git status '?? .github/workflows/plumbline-watch.yml'"],
    "code_check": "confirmed",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Done at L2"
  },
  {
    "id": "PRI-L1-14",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "severity_l1": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "impact_l1": { "frequency": "low", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "The launch gate, the Action and the badge pass a signed site whose signature is expired or whose signed files were tampered with, and none of them says signatures were not checked",
    "expected": "A deploy gate for a signed client notices the signature is expired or broken, or says plainly at the point of use (CLI line, job summary, badge) that signatures are not its job",
    "got": "Live. 4405 (expired) and 4406 (tampered): CLI validator 'gate pass', exit 0. Action arm B: STEP EXIT 0 with '### Plumbline gate: unavailable' and a validator pass line, the same summary as the healthy site. Badge with --adapters validator: green 'pass 2026-11-18' for both. Widened from L1: 2 of 12 portfolio sites, and the client-facing badge, not only the CLI exit",
    "evidence": ["src/gate/run.ts:45-49", "docs/gate-and-watch.md:410-416", "shots/priya/badges/4405-validator.svg", "shots/priya/badges/4406-validator.svg", "arms/action-gate.sh arm B 4405/4406"],
    "code_check": "by-design scope of the gate; the gap is that no surface at the point of use says it",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Done at L2"
  },
  {
    "id": "PRI-L1-15",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "polish",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "Report noise: 'refused 0' in the CLI scan's summary, a raw 'absent' in the Lock column beside 'not published' elsewhere, and the same long 'Not checked from a published site' info on every found-lock site",
    "expected": "Only states the CLI can produce; one word per state across table and summary; a caveat stated once",
    "got": "Live: summary 'Lock: found 7, not published 3, refused 0, ...'. The table's Lock cells have no class and read 'absent' / 'unreadable'. The info sentence appears 7 times. --help is refused by gate, badge and the scan script",
    "evidence": ["src/scan/report.ts:96-101", "src/scan/report.ts:141-144", "shots/priya/pri-l2-scan-after-laptop.txt"],
    "code_check": "confirmed",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Done at L2"
  },
  {
    "id": "PRI-L1-S1",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "strength": true,
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "Nothing checked is never a pass: a down or timing-out site exits 1 under either --fail-on, with a plain sentence; a third party down alone never fails a healthy site under the default",
    "expected": "The deploy gate is red for my outage, not for theirs",
    "got": "Live: 4409 and 4410 'nothing was checked', exit 1. Healthy 4400 with the stand-in default adapters, and the public Atlas site, exit 0 under --fail-on fail. The Action reads the exit code straight from the CLI (arm A STEP EXIT 1, arm B 4400 STEP EXIT 0)",
    "evidence": ["src/cli/gate-command.ts:28-41", "action/action.yml:111-121", "arms/action-gate.sh"],
    "code_check": "confirmed live",
    "verdict": "confirmed",
    "resolution": "n-a",
    "l2_priority": "Guardrail"
  },
  {
    "id": "PRI-L1-S2",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "strength": true,
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "The scan says what it sends where before it starts and at the top of the report",
    "expected": "No quiet calls with my clients' addresses",
    "got": "Live: five sentences on stderr before the first site, and 'What this scan sent where' as the report's first section (pri-l2-scan-before-laptop.png). It holds for the scan only; the gate's output and the Desk's check view carry no such sentence (PRI-L2-1)",
    "evidence": ["src/scan/report.ts:65-71", "shots/priya/pri-l2-scan-before-laptop.png"],
    "code_check": "confirmed",
    "verdict": "confirmed",
    "resolution": "n-a",
    "l2_priority": "Guardrail: extend to the gate and the Desk"
  },
  {
    "id": "PRI-L1-S3",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "strength": true,
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "senior-quality",
    "title": "Actionable, honest sentences where the scan does see a problem: an expired signature is a block with the date and the consequence; no lock is 'not checked', never clean",
    "expected": "Sentences a junior can act on",
    "got": "Live: 'The site's signature expired on 2026-10-19; verifiers now answer invalid (expired) until the site is signed again.' 'no lock: this site publishes no plumbline.lock.json, so there is nothing to compare against.' '1 of 6 facts the network states are no longer on it, so the network may now state an old fact.'",
    "evidence": ["src/scan/report.ts:76-83", "shots/priya/pri-l2-scan-before-laptop.txt"],
    "code_check": "confirmed live",
    "verdict": "confirmed",
    "resolution": "n-a",
    "l2_priority": "Guardrail"
  },
  {
    "id": "PRI-L1-S4",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "strength": true,
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "effort",
    "title": "Buyer questions answered up front: build cost measured, pinning by SHA, releases for security fixes, Apache-2.0, a security policy",
    "expected": "Who maintains this, what it costs in CI, what licence",
    "got": "Live on this host: npm ci 4.6 s plus build 3.4 s = 8.0 s, against the documented 7.5 s. The runner's own number was not measured (no real runner, uat/env.md)",
    "evidence": ["action/README.md:14-21", "SECURITY.md", "README.md:93-98"],
    "code_check": "confirmed locally; the runner figure is uncertain",
    "verdict": "confirmed",
    "resolution": "n-a",
    "l2_priority": "The runner number needs the owner's scratch repository"
  },
  {
    "id": "PRI-L1-S5",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "strength": true,
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "The badge never draws green for 'not checked', and always writes its word (title and aria-label repeat it)",
    "expected": "Never shows a pass for not checked",
    "got": "Live: every nothing-checked and partly-checked report draws 'not checked' with aria-label 'Plumbline gate: not checked on <date>'. The guardrail holds for the gate's own adapters; it does not cover the signature, which the gate never checks (PRI-L1-14)",
    "evidence": ["src/scan/badge.ts:11-22", "shots/priya/badges/*.svg"],
    "code_check": "confirmed live",
    "verdict": "confirmed",
    "resolution": "n-a",
    "l2_priority": "Guardrail"
  },
  {
    "id": "PRI-L2-1",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "med", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "The Desk's 'Check a site' view sends the typed address, including loopback and staging, to Agent Atlas from the browser with no consent and no sentence saying so",
    "expected": "The view a client might be shown says, before the click, that the address goes to Agent Atlas's public API (as the scan's report does), or asks first as the assistant's peer calls do",
    "got": "A Playwright route stand-in recorded api/check?url=http%3A%2F%2F127.0.0.1%3A4400%2F, ...4403... and ...4410... for three clicks of 'Check this site'. No consent card appeared. The page says only 'Three checkers answer independently'. grep finds no data-flow sentence in site/strings.js or site/index.html, while the assistant's peer contact does ask ('Contact Agent Atlas on your behalf?')",
    "evidence": ["site/strings.js:56", "site/strings.js:346", "shots/priya/pri-l2-desk-check-healthy-laptop.png", "desk journal notes.atlasStandinHits (3 requests)"],
    "code_check": "confirmed-absent (disclosure); the fetch is the gate's Atlas adapter running in the browser",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Recertify: a visible sentence before the button, or an Atlas toggle, on #/check"
  },
  {
    "id": "PRI-L2-2",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L2",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "The Action's job summary for a red 'nothing was checked' job reads the same heading as a green partly-checked job, and the input check accepts a target the Action can never check",
    "expected": "The summary says 'nothing was checked: this is not a pass' when every adapter was unavailable; an http or private target is refused at 'Check the inputs' with the reason, before the build",
    "got": "Arm A (verbatim steps): STEP EXIT 1 with '### Plumbline gate: unavailable'. 'nothing was checked' went to stderr only. Arm B healthy: STEP EXIT 0 with the identical heading. 'Check the inputs' exited 0 for http://127.0.0.1:4400/, which the gate step then cannot reach (no --allow-local in CI)",
    "evidence": ["action/report.mjs:115-119", "action/report.mjs:341-351", "action/action.yml:111-121", "arms/action-gate.sh arm A and arm B summaries"],
    "code_check": "confirmed: gateOutputs builds the summary from the report alone; NOTHING_CHECKED is printed by the CLI on stderr",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Recertify on a real runner once the owner's scratch repository exists"
  },
  {
    "id": "PRI-L2-3",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L2",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "A fix reads as a new warning: after fix-launch the launch row turns from red 'fail' to grey 'unavailable (not checked)' with drift 'warn', the same shape as the tampered site, and nothing says to relock",
    "expected": "A fixed defect shows as resolved (gate validator pass visible), and the drift line on a site the agency just fixed says 'if this change was yours, accept it with watch --relock'",
    "got": "scan-after row 4403: unavailable (not checked) / found / warn 'dunmore_books.network.json: A grounding source changed since the lock was written; the agent now answers from different facts.' / not published. Row 4406 (tampered): the same apart from the signature cell. watch --url after the fix: exit 1, warn",
    "evidence": ["shots/priya/scan-after/report.json", "shots/priya/pri-l2-scan-after-laptop.png", "src/scan/report.ts:109-121"],
    "code_check": "present-broken (consequence of PRI-L1-01 folding plus a drift sentence with no next step on the scan surface)",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Recertify with fix-launch"
  },
  {
    "id": "PRI-L2-4",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L2",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "The first result on her own site says almost nothing: a clean 'watch --root' prints only a GitHub rate-limit line with a raw epoch, and 'watch --url' on an http staging address does not mention --allow-local",
    "expected": "A clean watch says it is clean in words; a refused http address names the flag that allows a site on this machine; times are dates",
    "got": "'watch --root <client>' printed only 'info runtime cognizant-ai-lab/nsdeploy: Could not check upstream: GitHub rate-limited the request until epoch 1794999868.', exit 0. 'watch --url http://127.0.0.1:4400/' printed 'lock unreadable: ... (the address is not https), so no drift was checked.', exit 1, with no hint, while the README names --allow-local only for the gate (line 67)",
    "evidence": ["src/watch/detectors.ts:111", "README.md:67", "live outputs in the L2 journal 11:27"],
    "code_check": "confirmed",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Low"
  },
  {
    "id": "PRI-L2-5",
    "journey": "j4-twelve-clients",
    "character": "priya-raman",
    "cert_level": "L2",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "senior-quality",
    "title": "The scan report scrolls sideways on a phone, and the Desk's map frame ends mid-page on a phone",
    "expected": "No horizontal page scroll at 390 px; the Desk's background covers the page",
    "got": "report.html at 390x844: documentElement.scrollWidth 437 (drive check failed, exit 2), 9,148 px tall, the table cramped into 2-3-word lines. Desk #/check at 390 px: the dashed frame and map stop about 840 px down",
    "evidence": ["shots/priya/pri-l2-scan-before-phone.png", "shots/priya/pri-l2-desk-check-down-phone.png"],
    "code_check": "confirmed in render",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Low"
  }
]
```

## L2 verdict

**L2-conditional.** The deploy gate holds live, and it is honest:
- it catches all four structural defects, and each control arm passes once the defect is fixed;
- it exits 1 for a down or timing-out site;
- under the default `--fail-on fail` it never fails a healthy site because Atlas or Customs could not see it.

Every portfolio-facing surface fails her bar, though:
- The scan and the Desk show a healthy site, a down site and a fixed site in the same grey word, in list order.
- The badge is byte-identical for healthy, down and tampered sites. The one way to make it green also turns broken
  signatures green.
- Every staging address goes to Agent Atlas, even when Plumbline itself refuses to read it. The Desk's check view does
  this without saying so.

**Time saved:** about 95 minutes a pass against her 120, medium confidence (the real-network scan time and human reading
times are estimated). **Would she adopt?** The gate, yes, as a local pre-deploy check with `--allow-local --adapters
validator`, and as the Action on public preview URLs. The weekly portfolio pass and the badge, no, not yet.

**What the L1 surface model missed:**
- the Desk's undisclosed Atlas call (PRI-L2-1; L1 left the Desk out of her binding);
- the green badge for tampered and expired sites (L1 drew only the healthy validator badge, which is why PRI-L1-09 and
  PRI-L1-14 widened);
- "the fix reads as a new warning" (PRI-L2-3);
- the literal README succeeding on the wrong site (PRI-L1-13 widened);
- the Action summary missing "nothing was checked" (PRI-L2-2; L1 had it in an audit table with no finding);
- the phone layout (PRI-L2-5).

Of the 20 L1 findings (15 gaps and 5 strengths): **20 confirmed, 0 refuted, 0 uncertain.** PRI-L1-10's specific
consequence (a signed site without a key record) is not in this world. Its "never shown" claim is confirmed, and the
fixture that would close the rest is named in the finding.

## Character feedback (L2)

I timed it properly this time. Ten seconds to install and build, and a first answer on a real client in about ten
minutes, which is still the best first twenty minutes I've had from a tool this year. Most of those ten minutes went on
the README sending me to the wrong folder. When I followed it literally inside their clone, it cheerfully "initialised"
their own website and wrote a workflow into their repo. A junior would have committed that.

The gate I'd buy today. It went red on the launch site with the rule spelled out, green when the fix went in, red when a
site was down, and it didn't go red because Atlas couldn't see my staging box. That is the contract I ask every vendor
for.

Then I watched it work. The README's own example, Agent Atlas's site, scored a hundred out of a hundred and the headline still said
"unavailable". My twelve-site page put a client whose server is refusing connections eleventh, in the same grey as my
healthy bakery. When we fixed the launch site, its row went from red to grey with a new warning, and that looked exactly
like the gym whose signed files someone had edited. I can't hand that page to a junior without a crib sheet telling them
which of its words to ignore. The badge is worse than I thought on paper: healthy, offline and tampered are literally
the same file. When I switched to the validator-only setting to get a green badge, the gym with the tampered signature
got a green "pass" too. That badge is not going on any client's site.

What actually changed my mind about trust: every staging address I typed went to Agent Atlas, including ones Plumbline
itself refused to touch, and their nice-looking Desk does it without a word on the page. The scan tells you up front,
and I gave them credit for that at L1. Live, I found two other doors that don't.

The difference from my L1 review: then I'd have adopted the gate and waited on the report. Now I'd adopt the gate,
switch Atlas off for anything pre-launch, and tell the team the badge and the Desk are not for clients. I'd still tell a
peer to try it, as a deploy check and nothing more yet.

## Residue

Written outside the world's temp folder, the clone's temp folder and this run folder:

- **This session's scratchpad**
  (`C:\Users\kazda\AppData\Local\Temp\claude\28455a6400484cf1\fc95aea5-93f6-4074-8c75-4c410b771569\scratchpad\`):
  - the arm scripts (copies are kept in `shots/priya/arms/`);
  - `portfolio.txt`;
  - `agency.trust.json` (published public keys only);
  - the `g-*.json` gate reports;
  - the `runner-*` folders from the Action arm (`GITHUB_OUTPUT`, `GITHUB_STEP_SUMMARY`, reports);
  - the drive journals, `client-footer.html`, `atlas-unreachable.json`, `up.json`, `temp-before.txt` and
    `temp-after.txt`.
- **The repository:**
  - `npm run build` rewrote `dist/` and `npm run build:site` rewrote `site/lib/plumbline/`. Both are git-ignored
    (`.gitignore:2`, `:12`), and `git status` is unchanged.
  - Nothing else in the repository changed outside this run folder.
- **Public services:**
  - two gate runs reached the public Agent Atlas: `https://agent-atlas-phi.vercel.app/` and the loopback
    `http://127.0.0.1:4403/`;
  - Agent Customs' public index and key were read on every real-adapter run (nothing sent);
  - GitHub's API was asked twice by `watch --root` (rate-limited; info only).
- **Teardown:**
  - `world.mjs down tallow-finch` reported `portsStillInUse: []`, `folderGone: true` and `leftovers: []`;
  - the clone `%TEMP%\plumbline-uat-pri-l2-clone` was removed;
  - no `plumbline-uat-tallow-finch*` folder or state file is left, and nothing listens on 4400-4499;
  - the server pid 44444 is gone;
  - the pre-existing `plumbline-drift-*` and `plumbline-outside-*` temp folders, which other runs' tests had left,
    were there before this run and were not touched.
