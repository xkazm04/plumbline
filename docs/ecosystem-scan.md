# The ecosystem scan

One command gives the state of a list of agentic sites:

```sh
npm run build
node scripts/scan-ecosystem.mjs ecosystem/sites.txt --out ecosystem/out
```

For each address it records the gate report (`plumbline gate`), the drift report of the lock the site publishes
(`plumbline watch --url`, the reader the Desk runs) and whether the site publishes a signature and a key record. It
writes `report.json` (the schema below) and `report.html` (a static page). `ecosystem/out/` is git-ignored: publishing
results that name other people's sites is the owner's decision, not the tool's.

## What it sends where

The report opens with these sentences, and the script prints them before it starts:

- The gate sends each address to Agent Atlas' public check API (`https://agent-atlas-phi.vercel.app/api/check?url=<address>`).
  That is the Atlas adapter's job (`docs/gate-and-watch.md`). An address the gate itself refuses (not https, a private
  or loopback address, a name that does not resolve) is not sent.
- Agent Customs' published receipts, index and key are read; nothing is sent to it.
- Each site is read through `safeFetch`: https only, every resolved address public, a capped body and an absolute
  timeout per request, at most 3 redirects. A lock's peer addresses and absolute grounding refs are held to the
  address rule before anything is fetched.
- Sites are scanned one at a time, with a fixed pause between them (`DELAY_MS`, 2 s) and one absolute deadline per site
  (`SITE_DEADLINE_MS`, 120 s). The derivation of each number is beside it in `src/scan/run.ts`. Every fetch for a site
  gets at most the time left before its deadline, and a fetch asked after it is refused as a timeout: the site's gate is
  then `unavailable` and its lock `unreadable`, never `pass` or clean.

`--adapters validator,atlas,customs` (UAT-11) names the gate's checkers, all three by default. For a pre-launch or
confidential list, `--adapters validator,customs` (or `validator`) sends no address to Agent Atlas: the report's first
sentence then reads "Agent Atlas was not asked (--adapters left it out), so no address was sent to it." (and the Customs
sentence "Agent Customs was not asked ..." when it is left out too), and `settings.adapters` records the list. An unknown
checker is refused (exit 2) before anything is read.

## The list

`ecosystem/sites.txt`: one https address per line, `#` starts a comment, blank lines are skipped, each address counts
once, at most `MAX_SITES` (200). An address that is not https or carries credentials refuses the whole list (exit 2),
so a typo is never scanned as something else. The seed list holds only the sites this repository already names: the
Desk, Agent Atlas and Agent Customs. The owner extends it.

## What each word means

| Field | Values | Meaning |
| --- | --- | --- |
| gate | `pass`, `fail`, `unavailable` | the gate's report state; `unavailable` was not checked and is never a pass |
| lock | `found`, `absent`, `unreadable`, `unusable` | the published lock's state (`refused` exists only in a browser) |
| drift | `clean`, `info`, `warn`, `block`, `not-checked` | the worst severity of a found lock; `info` alone is clean; a lock that was not found is `not-checked`, never clean |
| signature | `published`, `absent`, `unknown` | `plumbline.signature.json` at the site base answered 2xx, 404 or 410, or anything else |
| verdict | `unverifiable` or omitted | present when a signature is published: this scan trusts no key, so a signature is `unverifiable` here, whatever its math. A verifier who has met the publisher may verify it with `plumbline verify --url`. A site that publishes no signature is "not signed", which is the publisher's choice, not a failure |

A kid is recorded only when it is exactly 16 lowercase hex characters; anything else is left out, never quoted. Every
summary in the report is Plumbline's own sentence, built from counts and fixed phrases; a site's own words are not
copied into it.

## `report.json`, version 1

```json
{
  "schema": "plumbline-ecosystem-scan",
  "version": 1,
  "scannedAt": "<ISO UTC>",
  "tool": { "name": "plumbline", "version": "<package version>" },
  "disclosure": ["<the sentences above>"],
  "settings": { "siteDeadlineMs": 120000, "delayMs": 2000 },
  "summary": {
    "sites": 3,
    "gate": { "pass": 0, "fail": 0, "unavailable": 0 },
    "lock": { "found": 0, "absent": 0, "refused": 0, "unreadable": 0, "unusable": 0 },
    "drift": { "clean": 0, "info": 0, "warn": 0, "block": 0, "not-checked": 0 },
    "signature": { "published": 0, "absent": 0, "unknown": 0 }
  },
  "sites": [
    {
      "address": "https://site.example/",
      "gate": { "target": "...", "state": "pass", "findings": [{ "adapter": "validator", "state": "pass", "summary": "..." }] },
      "watch": { "lockState": "found", "findings": [{ "kind": "peer", "severity": "block", "ref": "...", "summary": "..." }] },
      "drift": "block",
      "signature": { "state": "published", "kid": "<16 hex>" },
      "keyRecord": { "state": "published", "kid": "<16 hex>" },
      "verdict": "unverifiable",
      "elapsedMs": 2216,
      "deadlinePassed": false
    }
  ]
}
```

`gate` is the `GateReport` and `watch` the `DriftReport` of `src/core/types.ts`, unchanged. Absent optional fields are
omitted, never `null`. A new member may be added in version 1; a change to an existing one moves `version`.

## `report.html`

A static page: no script, no external resource (its own Content-Security-Policy is `default-src 'none'; style-src
'unsafe-inline'`), and every string from the report escaped. It shows the disclosure first, then the summary, one row
per site (each state in a word as well as a colour) and each site's findings.

## A badge for one gate report

`plumbline badge --report <gate report .json> [--out <file.svg>]` writes a small static SVG from `plumbline gate
--json`'s output: what the gate checked, what it says about the site's signature, and the day the gate ran, with the
words always written and a title and an `aria-label` that say them again (`src/scan/badge.ts`). Since UAT-10:

- The gate part is `pass`, `fail`, `partly checked` (some checkers answered, some had no verdict), `unreachable` (the
  site itself did not answer) or `not checked` (no checker answered), the way every surface words a gate (UAT-9).
- The signature part is the verdict `plumbline gate --trust <file>` recorded (`signature verified`, `signature invalid
  (<reason>)`, `signature unverifiable`), or `signature not checked` for a report made without `--trust`.
- Green only for a gate that passed on every checker **and** a verified signature; red for a failed checker or an
  invalid signature, whatever else the badge says; dark amber for a site that could not be reached; grey for anything
  else. So a healthy, a down, a tampered and an expired site draw four different badges (with `--trust`), and a badge
  is never green over a signature it did not check. A site that publishes no signature is `signature unverifiable`, so
  it is never green either.
- The date is the report's `checkedAt` (when the gate ran), never the day the badge is drawn: `--now` is refused, and a
  report with no `checkedAt` (written before 2026-11-18) is refused with "run plumbline gate --json again".

A file that is not a gate report, or whose `signature` is not a verdict, is refused (exit 2). `--json` prints `{ badge,
state, gate, signature, date, colour }`.
