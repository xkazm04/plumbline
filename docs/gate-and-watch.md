# Gate and watch

The gate asks three independent checkers about a site, once, and says `pass`, `fail` or `unavailable`. The watch compares a
site against `plumbline.lock.json`, daily, and reports three kinds of drift. Both fetch only through one function, `safeFetch`.
Everything here was checked against the live services on 2026-11-17; the recorded responses are in
`src/test/fixtures/wp2/`.

## The gate

`plumbline gate <target> [--adapters validator,atlas,customs] [--fail-on fail|unavailable] [--timeout <ms>] [--allow-local] [--json]`.
The target is a site address, a network address (site address plus network name), the address of an `agent-manifest.json`, or
the address of a `<name>.network.json`. The report state is the worst finding: `fail`, then `unavailable`, then `pass`. Asking
for no adapters is `unavailable`, not `pass`. Adapters run independently, each with its own deadline (five times the per-fetch
timeout); one failing, hanging or throwing never hides the others.

Exit code: 0 passed by `--fail-on`, 1 failed by it, 2 usage. A target that is not an absolute `http(s)` URL (`example.com`,
`ftp://...`) is a usage error: it exits 2 with "the target must be an http(s) URL" before any adapter runs, so nothing
is sent to Agent Atlas and CI shows a configuration error, not a failed or partial check. One rule sits above `--fail-on`: when **every** adapter is
`unavailable`, nothing was checked, and the gate exits 1 whatever `--fail-on` says, with the line
`plumbline gate: nothing was checked: every adapter was unavailable, so this is not a pass` on stderr (so `--json` output
stays one JSON document). Otherwise `--fail-on fail` fails only on a `fail`, so a run where some adapters were
`unavailable` and the rest passed exits 0, and `--fail-on unavailable` fails on any `unavailable` too. Earlier builds exited 0
for an all-unavailable run under `--fail-on fail`; bp's adoption review recorded that as a deviation from "unavailable is
never pass", and this rule closes it.

**`--fail-on unavailable` fails almost every site today.** Agent Customs has published receipts for few sites (its
`receipts/index.json` listed a handful on 2026-11-18), so its adapter is `unavailable` ("no receipt for this target")
for nearly every site, and with `--fail-on unavailable` a site the validator and Agent Atlas passed fails the build on
Customs alone. To fail on a partly checked site without that, leave Customs out (`--adapters validator,atlas`) and use
`--fail-on unavailable`; or keep the default `--fail-on fail`, which fails on a real defect and on a run that checked
nothing.

**What was checked, in words (UAT-9).** The headline says it beside the state, in one sentence every surface uses (the
CLI, the Action's job summary, the scan, the Desk; `src/gate/context.ts` `gateSentence`, derived from the findings, no
new field): `gate unavailable: <target> - checked by 1 of 3 (validator pass); Atlas and Customs had no verdict` when some
checker answered; `- the site could not be reached (<why>); nothing was checked, so this is not a pass` when the site
itself did not answer (an adapter's own "the target could not be reached" sentence); `- nothing was checked: every
checker was unavailable, so this is not a pass` when no checker answered. The state and the exit codes are unchanged.
The Action's summary puts the last two in its heading; the scan's gate cell carries the sentence and draws a site that
could not be reached in red; the Desk's result and verdict card do the same.

`--allow-local` lets the gate check a site on this machine: it allows `http` and loopback addresses (`127/8`, `::1`) for
this run, and prints a one-line warning to stderr. It still refuses every private range (`10/8`, `172.16/12`,
`192.168/16`, `169.254/16`, `fc00::/7` and the rest of rule 2 below) and `http` to a public address. The Action never
passes it.

### `validator`: a port, not the reference validator

The reference runtime's validator (`validation.gen.mjs`, transpiled from `neuro_san/kernel/validation.py`, in
cognizant-ai-labs/agentic-web under `skills/agentify-website/runtime/generated/`) is not on npm, imports a sibling generated
module, and the repository law is that we do not execute code fetched from a third party. So this adapter is **Plumbline's own
port of the rules**, written from reading that code, and its summary says "port" and "not the reference code". The ported rules:

| Rule | Fails when |
| --- | --- |
| shape | `tools` is missing, not an array or empty; an agent has no `name` |
| front agent | no agent exists (the front agent is the first with `instructions` and no `class` or `toolbox`, else the first) |
| missing references | an agent's `tools` entry is not an MCP endpoint, a remote agent address, a declared `link_slots` name, or an agent in this network |
| manifest | `networks[]` has no entry, or an entry lacks `name`, `front_man` or `hocon`; `front_man` differs from the network's front agent |
| duplicates (ours, not in the reference) | two agents share a name |
| duplicate keys (ours, not in the reference) | the manifest or a network definition repeats a key inside one object, anywhere in the file (keys compared after unescaping). The summary says "duplicate keys: the reference runtime merges them, so the file means something different from what a JSON reader sees": `JSON.parse` keeps the last value, the runtime's HOCON reader deep-merges them, so a duplicate `commondefs` can change an agent's instructions while every JSON tool, this port included, sees a clean file. A file `JSON.parse` accepts that the key counter cannot read fails too ("could not be checked for duplicate keys ... so the rule fails closed"): an unchecked file is never reported as one without duplicates |

Not ported: HOCON parsing, `{token}` expansion before validation, partner and action-tool checks. States: `pass` when every
network definition checked is clean; `fail` for a rule violation, a manifest or network that answers 404 or is not JSON, or an
address naming a network the manifest does not list; `unavailable` for a timeout, a refused address, a body over the ceiling, an
HTTP 5xx, or when no definition could be checked. Summaries are built from counts and fixed phrases. A site's own words (agent
names, references) are never copied into a finding.

### `atlas`: Agent Atlas

`GET https://agent-atlas-phi.vercel.app/api/check?url=<target>`. The adapter was derived from recorded real responses, not a
guess. It reads `summary.verdict`, `summary.score`, `summary.mustFails`, `summary.counts.warn`, `files[0].status` and the ids of
failing `checks`. `conformant` and `conformant-with-warnings` are `pass` (the second says how many warnings); `not-conformant` is
`fail`; `unreachable` is `fail` when Atlas got an HTTP answer without a manifest and `unavailable` when Atlas could not connect
at all (`files[0].status` is 0, which is Atlas' trouble, not a finding about the site). A transport error, a non-200, a body that
is not JSON, an unrecognised shape, an unknown verdict, or a verdict that contradicts its own counts is `unavailable`.

### `customs`: Agent Customs receipts

Agent Customs (https://montbaga.github.io/agent-customs) inspects in the visitor's browser and has **no HTTP check API**. It does
publish ES256-signed receipts, a public key and an index. The adapter: works out the target's network address; looks it up in
`receipts/index.json` (no entry is `unavailable`, "no receipt for this target", never `pass`); fetches the receipt; verifies its
ECDSA P-256 / SHA-256 signature over `canonicalJson(receipt)` with Node WebCrypto against the published key, which must equal the
key pinned in `src/gate/context.ts` (a changed key is `unavailable` until Plumbline is updated); and reports the stamped verdict.
A failed signature is `fail`. A receipt signed with a key other than the published one, and naming it, is `unavailable`
("signed with a key this build does not trust ... ask Customs to re-stamp"), not `fail`: an unknown signer is not a forged
receipt, and after Customs rotates its key the receipts it signed with the old one stay in its index until re-stamped. A
receipt whose inspector names another key than its signature, a published key file whose key id does not match its key, an
index entry whose path breaks Customs' naming rule (never followed), a receipt with unusable dates, and a target with no
network address are each `unavailable` with their own reason. A target with several networks shows the worst outcome with
"(N networks on this target; the worst is shown)". A validly signed receipt for another network, an index that contradicts the receipt, or a receipt
past its own `expiresAt` or 35 days after `inspectedAt` (whichever is first) is `unavailable`. `CLEARED` and `CONDITIONS` are
`pass`; `HOLD`, `DENIED` and `INVALID` are `fail`; `UNREADABLE` or an unknown code is `unavailable`.

**Not done, and the summary says so:** the live network is not rechecked against the receipt's fingerprint. Customs fingerprints the
runtime's normalised config (replacement strings expanded, defaults pushed down, `links` split off), which cannot be reproduced
from the published file without the runtime. A network that changed after it was stamped is not noticed by this adapter. Only
networks Customs lists get receipts (its `tools/receipt-sites.json`), so most targets are `unavailable` here.

## The watch

`plumbline watch [--root <dir>] [--init | --relock [--drop <ref>]...] [--source <ref>]... [--external a2a-card=<url>]... [--timeout <ms>] [--json]`. It is a dry run: it
reports, and with `--init` and no lock yet it writes `plumbline.lock.json`. With a lock present, `--init` does not
overwrite it; `--relock` does (below). Opening, editing and closing the drift issue is the Action's job (`issues: true`,
`action/action.yml`), never the library's. Exit 0 when no finding is `warn` or `block` (`info` alone is clean), 1 otherwise, 2 for a usage or
I/O error: a usage error prints its reason and the usage line on stderr and nothing on stdout; an I/O error (a lock that
cannot be written, a `--root` that is a file under `--relock`) prints `watch failed: <reason>`, which the Action reads as
a failed step.

**The lock's state is not a finding.** Every report carries `lockState`: `found` (the lock was read and checked),
`absent` (no lock), `unreadable` (it could not be read, or it is reached through a link that leaves the root) or
`unusable` (not JSON, or not the lock's shape). For any state but `found`, `lockSummary` says why no drift was checked
(for `absent` it starts "no lock") and `findings` holds only the signature-expiry check below. Nothing was checked, so
the exit is 1, never a clean 0. The Desk's drift reader reports the same states by the same rule (it adds `refused`, for
a lock the browser was refused), so a drift count is a count of drift.

| Detector | What it re-checks | Finding and severity |
| --- | --- | --- |
| `grounding` | each `grounding.sources[].ref` (a path under the root, or an https URL through `safeFetch`), hashed again | changed: `warn`. Unreadable, missing or outside the root: `warn`, saying so. A changed page with `anchors` is re-read and the summary counts them against what the networks state now (still `warn`; below). A changed network or agent file: "the agent now answers from different facts: review the change, then re-lock". A changed page the lock watches no fact on says so, never that the agent answers differently |
| `runtime` (a) | each file in `runtime.files`, under the root | changed or missing: `block` (the vendored runtime is copy-do-not-change) |
| `runtime` added | the locked runtime folder (the deepest folder holding every `runtime.files` key, such as `runtime` or `site/runtime`), listed | a file in it the lock does not hold: `block`, with its hash as `actual`, "added to the vendored runtime folder after the lock was written". Remove it, or review it and `--relock`. CLI only: a browser cannot list a folder |
| `runtime` (b) | the runtime's upstream, from the GitHub API, unauthenticated (see "Which upstream the runtime check asks") | upstream moved on: `info` "Upstream is ahead" with both short SHAs. Cannot ask (timeout, rate limit, HTTP error, odd answer): `info` "Could not check upstream". Never `block` |
| `peer` | each `peers[url]`: the network definition, hashed again | changed in any byte: `block` (a peer's definition runs in the visitor's browser, so a changed one is changed code). Unreachable: `warn`. An address the address rule refuses (not https, a private or loopback address) reads the same on every surface: "A peer in this lock was not contacted: it is not an https address, an address Plumbline does not contact, so it was not checked." |
| `peer` outline | with a changed definition, its outline against the lock's (`src/watch/outline.ts`) | the same `block`; the summary adds what changed in counts: "In outline: agents: N added, N removed, N changed; outbound hosts: N added, N removed; front agent: changed or unchanged". The same outline is "Formatting or non-agent content only" (still `block`: the bytes the runtime reads changed). No outline in the lock: "re-lock to record one". A definition that cannot be outlined now (not JSON, a repeated key): said so |
| `peer` links | each `peers[url].links`: the peer's `links.json` at the same site base (the runtime fetches it for every peer network it loads and lays it over that network's links) | appeared (locked `absent`, now served), changed, or gone (404/410 now): `block`. Cannot be read (timeout, HTTP 5xx): `warn`. A lock written before 2026-11-17 has no `links` for the peer: `warn`, "re-lock to track it", never a silent pass |
| `peer` signer | the peer's `plumbline.signature.json`, if it has one | kid differs from the lock's: `block`, saying what the peer publishes about it (UAT-4): "a rotation statement from the locked key is published (not verified here)" or "a different key, with no rotation published" (its `plumbline-rotation.json` is read only then); with `watch --trust <file>` (opt-in: the watch never needs a trust store), a chain that verifies from a key that file holds for the peer's origin to the new kid reads "it rotated from the key the lock recorded, verified against your trust file". Each ends "A relock refuses it until a person decides: watch --relock --accept-signer <this peer>". Signed when locked and no signature now (its `plumbline.signature.json` answers 404 or 410): `block`, the same refusal (TOM-RC-1: a peer that says it has no signature is a signer change, not "unsigned"). Signed when locked and the signature cannot be read now (a fetch error, an HTTP 5xx, not JSON, no valid kid): `warn`, "its signer was not checked; a relock keeps the key the lock recorded". A peer a person accepted as no longer signing (the lock's `formerKid`) that is signed again: by the key it last had, `info`; by any other key, `block` with the same refusal. Unsigned when locked, signed now: `info`. A `kid` that is not exactly 16 lowercase hex characters is never recorded or quoted; it counts as no usable signature |
| `peer` external | each `external[url]` (an A2A Agent Card, `src/watch/external.ts`), fetched and hashed again | changed in any byte: `block`, with "In outline: skills: N added, N removed, N changed" and whether it carries JWS signatures (counted, not verified). Unreachable or an HTTP error: `warn`. An `mcp-tools` entry: `warn`, not checked by this build |
| `peer` pending | each `pendingPeers[url]`: a peer that could not be captured when the lock was written | `warn` on every watch, reachable or not, until `--relock` captures it. The checkout's watch asks it again and says why it is still pending today: "it answers now: review it, then run watch --relock to capture it", "it still cannot be read (<cause>)", or "it was not contacted now either: it is not an https address". A reader of a published lock (`watch --url`, the Desk) never contacts a pending peer; it applies the address rule only |
| coverage | what the site names now (the discovery `--init` uses, below) against what the lock holds | a root agent file or a manifest-named network file not in `grounding.sources`: `warn` (grounding). A peer a network or `links.json` names that is neither in `peers` nor pending: `warn` (peer). A network file that is not JSON, so its peers cannot be read: `warn` (peer). An unsafe `hocon`: `warn`, as at init |
| signature expiry | the site's own `plumbline.signature.json` at the root, its `expiresAt` | expired: `block` (verifiers answer `invalid expired`). Expiring within 14 days: `warn`, with the date and the days left. No signature file: no finding (signing is the publisher's choice). A file with no readable `expiresAt`: `warn`. Kind `grounding`, ref `plumbline.signature.json` (the wire has three drift kinds; the signed files are the grounding). Checked whatever the lock's state |
| signature coverage | the same file's `subjects`: each path's SHA-256 against the exact bytes of the file at that path now (no trust store: the subject list is compared, not verified) | a signed file that differs or is gone: `block`, "The site's signature no longer covers its files: K of N signed files differ from the signed version or are missing (<paths>), so verifiers now answer invalid (tampered) until the site is signed again (plumbline sign)." This is how an unsigned relock that was merged shows up: the lock is a signed file. Checkout only (`watch --url` and the Desk check the signature with `verify`) |

**Reading under the root.** Every local file the watch reads (lock references, the lock itself, the manifest, network
files, the signature) must stay under the root twice: lexically, and, after every symlink and junction is resolved
(`realpath`), under the root's real path. A committed link that points out of the site is refused as "outside the site
root" and is never read or hashed.

Hashing: every hash the watch writes or compares is SHA-256 of the **exact bytes**, read from disk or fetched (`hashBytes`
in `src/net/canonical.ts`). Nothing is normalised: no JSON canonicalisation, no CRLF folding, no BOM stripping. So
re-serialising a JSON file (key order, spacing) is drift. That is deliberate: the reference runtime reads network files
with its own HOCON parser, which merges duplicate keys that `JSON.parse` collapses, so "the same JSON" is not "the same
program". Line endings do not cause false drift because repositories pin LF (`.gitattributes`: `* text=auto eol=lf`, as
this one does) and web servers serve bytes as stored; a site repository that does not pin LF will see drift when it is
checked out with CRLF, and should add that line. Locks written before 2026-11-17 hashed JSON canonically, so their
JSON hashes no longer match: write a fresh lock (below). The signer check compares the kid only; verifying a signature
needs a trust store and is `src/core`'s job.

### The entry point: `plumbline init`

`plumbline init [--root <dir>] [--source <ref>]... [--workflow] [--timeout <ms>] [--json]` is where a publisher starts:
no key and no trust decision. It writes the lock exactly as `watch --init` does (below), keeps a lock that is already
there (never rewrites it: accepting drift is `--relock`, after a review), and with `--workflow` writes
`.github/workflows/plumbline-watch.yml` under the current folder from `action/templates/plumbline-watch.yml`, with the
Action's `root:` set to the site folder. `--workflow` refuses, before anything is written, a workflow file that is
already there (it is never overwritten) and a `--root` outside the current folder or named with characters other than
letters, digits, `.`, `_`, `-` and `/` (run it from the repository root). It then prints the next steps: commit the
lock, run the watch, name with `--source` the pages whose facts the network states, and, as the upgrade, `keygen` and
`sign`. It makes no key and reads none. Exit 0 when the lock was written or kept with nothing `warn` or `block`, 1 for a
capture with a gap (a pending peer, a source that could not be read) or a lock that is there and cannot be used, 2 for
a usage or I/O error. `--json`: `{ lock: "written" | "kept", lockFile, counts: { grounding, runtime, peers, pending },
facts?, findings, workflow?, workflowRoot?, next }`.

What the new lock watches is printed with it (and by `watch --init` and `--relock`), one `facts` line each: how many
facts the networks state, by kind; per `--source` page, how many it watches by kind and which of the network's facts
are not on it; and which facts no page watches. Those lines name the facts, normalised (`EUR 89`, `22:00`, "the phone
number ending 960418"), because they are the publisher's own network's facts in the publisher's own terminal; `--json`
carries the same as counts by kind (`facts: { network, pages: [{ ref, watched, notOnPage, problem? }], unwatched }`)
and never a literal, and no finding quotes one. A page that states none of the facts the network states is a `warn` at
capture ("No fact is watched on this page ..."), so init exits 1 for it. With `--source` given, the next steps say to
read those lines instead of asking for `--source` again.

### A published lock: `plumbline watch --url`

`plumbline watch --url <site> [--allow-local] [--timeout <ms>] [--json]` re-checks the lock a site PUBLISHES, from its
address, as the Desk's drift reader does. The reader is one module, `src/watch/published.ts` (pure, fetcher-injected,
copied into the Desk by `build-site.mjs`): the CLI runs it through `safeFetch`, the Desk's `site/drift.js` through the
page's fetcher, and a test gives both the same published lock and the same bytes and compares the findings. Lock
references resolve against the lock's own URL; the lock is a stranger's document, so its peer addresses and absolute
grounding refs are held to the address rule below ("The Desk's drift reader") before anything is fetched, with
`--allow-local` too (it lets the CLI read a site on this machine, never send a stranger's lock there). The lock states
and the exit rule are the watch's: anything but `found` is exit 1. A connection failure is `unreadable`; `refused` is the
browser's alone.

What the CLI adds to the shared reader: the site's own signature expiry, read from the published
`plumbline.signature.json` by the rule the watch applies to the file on disk; and, when a lock was found, one `info`
finding (kind `grounding`, ref `plumbline.lock.json`) that says what was **not** checked: a file added to the vendored
runtime folder (a folder cannot be listed over HTTP), whether the lock covers every file and peer the site names
(coverage reads the checkout), the runtime's upstream (the checkout's watch asks GitHub; a scan of many sites would spend
the unauthenticated quota), and whether a signature the caller trusts covers the lock (`verify --url`).

`--init` captures (`src/watch/capture.ts`, `src/watch/discover.ts`):

- **runtime**: every file under `runtime/` (else `site/runtime/`); the nsdeploy commit its README or NOTICE names
  (``nsdeploy commit `53a787c` ``, else `unknown`); and `via` when the NOTICE or README says the copy was taken from
  another repository's folder, in the form ``<owner>/<repo> `<path>` at commit <sha>`` (as `site/runtime/NOTICE` does).
- **grounding**: `agent-manifest.json`, `links.json` and every `*.network.json` at the root, every network file the
  manifest names in `networks[].hocon` (at exactly that path, by the rule `sign` uses, so a `hocon` that is an absolute
  URL, leaves the root or has an unsafe character is a `warn` finding naming the entry and is never read), plus any
  `--source`.
- **peers**: read from **every** network file above, root `*.network.json` and manifest-named alike: the keys of
  `link_labels` and the `http(s)` non-MCP entries of an agent's `tools`; plus the `http(s)` values in `links.json`. Each
  is recorded with the hash of its network definition, the state of its `links.json` and its signer kid.

A peer that cannot be captured (unreachable, or its `links.json` answers neither 2xx nor 404/410) is recorded in
`pendingPeers` with the time and reported now and on every watch. Anything else that cannot be captured (a missing
source) is left OUT of the lock and returned as a finding, so a lock with a gap is never mistaken for a complete one.

### Which upstream the runtime check asks

The Desk's runtime is not a copy of nsdeploy: `site/runtime/NOTICE` says it is a copy of
`cognizant-ai-labs/agentic-web`'s `skills/agentify-website/runtime` at commit `7ee54a3`, which is itself nsdeploy's
runtime at `53a787c` with agentic-web's edits on top (its README lists them). The edits live in agentic-web, so a new
nsdeploy commit reaches this copy only through agentic-web, and a new agentic-web commit to that folder is invisible to
a check that asks nsdeploy. (Checked read-only against the GitHub API on 2026-11-17: the folder's newest commit as of
`7817c1f` was `63a1b15`; on `main` it was `7ee54a3`, "Send Otari EU keys to the EU gateway", made after that copy. The
watch reported it as info, and the copy was refreshed to `7ee54a3` on 2026-11-18.) So:

- a lock whose runtime records `via` is checked against that folder: the newest commit that touched `via.path` on the
  default branch (`GET /repos/<repo>/commits?path=<path>&per_page=1`) against the newest that had touched it as of the
  copied commit (`GET /repos/<repo>/commits?sha=<via.commit>&path=<path>&per_page=1`). Equal means the folder has not
  changed since the copy, whatever else the repository did; different is `info` "Upstream is ahead". Two requests of
  about 4 KB each.
- a lock with no `via` (a site that vendors nsdeploy's runtime directly, or a lock written before 2026-11-18) is checked
  against nsdeploy's newest commit, as before.

`via` is checked before it becomes part of an address: `repo` is `owner/name` in GitHub's characters (a name of `.` or
`..` is refused: it would climb the API's path), `path` a safe relative path, `commit` 7 to 40 hex characters; anything
else makes the lock `unusable`, and `--init` does not record such a `via` from a NOTICE.

### What a grounding page still states: anchors

Hashing a page's bytes says that it changed, not whether the network now states something the page no longer does. An
**anchor** turns that into a check, with no model. At `--init` and `--relock`, the watch takes the literals the
networks' instructions state (every agent's `instructions`, with the `{name}` placeholders the runtime fills from
`commondefs.replacement_strings` filled in), found with fixed patterns (`src/watch/anchors.ts`):

| Kind | Found | Normalised |
| --- | --- | --- |
| money | a currency symbol or code (`$ € £ ¥`, `USD EUR GBP JPY CHF CZK`, `Kč`) or word (`euro(s)`, `pound(s)`, `dollar(s)`) before or after a number, `89,- €` included | the currency code and the number: thousands separators removed, the decimal mark `.`, a zero fraction dropped (`€1.250,00` and `EUR 1250` are `eur 1250`) |
| time | `H:MM` (24-hour, with or without am/pm), `H am`/`H pm`, `H.MM am`, `15h` and `15h30`, and `H.MM` after a word that introduces a time (from, until, till, to, at, by, before, after, opens, closes, between, and) or as the first of a range (`08.00-09.30`). A bare decimal (`12.30` alone) is not a time | `HH:MM`, 24-hour |
| date | ISO `YYYY-MM-DD`, `24 December 2026`, `Dec. 24, 2026`, `D.M.YYYY` or `M/D/YYYY` | ISO for the first three; numeric dates keep their order (the writer's), separators unified |
| phone | an international number (`+` or `00`), a national one with its trunk `0` (`01632 960418`), or a grouped one; 7 to 15 digits | the last nine digits (all of them when shorter), so `+44 1632 960418`, `01632 960418` and `+44 (0)1632 960418` are one number |
| e-mail | `name@host.tld` | lowercased |
| percentage | a number with `%`, `percent` or `per cent` | the number with `%` |

The text is lowercased and its whitespace collapsed first, and the kinds are taken in the order the code lists them
(e-mail, date, money, percentage, time, phone), each match masked before the next looks, so a date is not also a phone
number and a price is not also a percentage. Money is taken in three passes: a symbol written against its number
(`€89`) first, then a symbol, code or word after a number (`89 €`, `89 euros`), then one before a number with a space
(`EUR 89`), so a number before a price is never read as the amount ("Sleeps 2 €89" is EUR 89, not EUR 2; UAT-1).

A literal that a grounding page also states is an anchor, and the lock records SHA-256 of each one in
`grounding.sources[].anchors`. The page is reduced to its text by a small scanner (no parser dependency): script,
style, template and noscript contents and comments dropped; a table cell, row, paragraph, list item, heading, line
break or other block tag becomes ` | `, which no pattern reads across, so a number in one cell never joins a price in
the next (`Sleeps | 2 | €89`, `€89 | 120`); every other tag (a span, a link, emphasis) is a space; the common entities
decoded; and the target of a `tel:` or `mailto:` link is written out beside the link's text (a visitor who taps "Call
us" dials it, so the page states it). Every pattern's repetitions are bounded and the scanner is linear, so a 512 KiB
page of pathological markup is read in milliseconds. The network and manifest files themselves are not anchored on
themselves.

When an anchored page changes, the watch reduces it again, takes its literals by the same patterns, counts the anchors
no longer among them, and asks the networks among the lock's grounding sources, as they are now, whether they still
state the ones gone. The sentence says which of three things happened:

- **A fact the network still states is gone from the page** (the stale fact): "K of N facts the lock watches on it
  (facts the network states) is/are no longer on it, and the network still states it/them (1 price), so the agent may
  now answer with an old fact." (Or "the network still states S of them (...)" when only some.)
- **None of the watched facts changed**: "all N facts the lock watches on it (facts the network states) are still on
  it, so what changed is something the lock does not watch."
- **The network no longer states it either** (both sides were corrected): "... is no longer on it, and the network no
  longer states it either, so no stale fact is left: review the change, then re-lock (watch --relock)."

When the networks cannot be read now, the sentence is the one before this check: "... so the network may now state an
old fact". The severity is `warn` in every case, and no literal is quoted: the finding names the kind of fact, never its
value. A page that cannot be reduced (binary, not UTF-8, or larger than the 512 KiB fetch ceiling) says so ("its N facts
the network states could not be checked: it ..."); at capture it is an `info` and the page's bytes are still locked. A
changed page that anchors no fact says that the lock watches no fact on it, never that the agent answers differently.
The Desk counts the same (`watch/published.js` calls the same module).

Locks written before 2026-11-19 anchored a phone number with its country code (`+441632960418`); the watch still reads
such an anchor (a changed page's numbers are hashed in both forms), and the next `--relock` writes the new form.

What an anchor is **not**: it is the presence of the same literal in two texts, not truth. A page can state a price in
a sentence that says it no longer applies; a fact written in words ("nine in the morning"), or in a form the table above
does not list, is not seen, which is why init and `--relock` print what each page watches and which of the network's
facts no page states. A page becomes a grounding source with `--source <page>` at `init`, `--init` or `--relock`: that
is what turns byte hashing into a check of the facts the network states.

### What changed in a peer: the outline

A peer's changed bytes are changed code, so the finding is `block` whatever changed. The outline says what changed
without quoting the peer (`src/watch/outline.ts`, pure, run by the CLI's watch and capture and by the Desk through
`observe.ts`, so both count the same):

- **agents**: per agent, SHA-256 of `canonicalJson(the agent object)`, keyed by SHA-256 of the agent's name. A name is
  a stranger's word, so it is hashed; equal hashes mean the same agent. An agent without a string name is keyed by its
  position.
- **hosts**: the host of every http(s) address in an agent's `tools` (remote agents and MCP endpoints alike) and of
  every `link_labels` key, lowercased, each as SHA-256, sorted. A new outbound host is where a changed peer can now send
  the visitor's words.
- **front**: SHA-256 of the front agent's name by the reference's rule (the validator port's `findFrontAgent`).

A file the outline cannot stand for has none: text that is not JSON, a value without a `tools` array, a value canonical
JSON refuses, and a file that repeats a key inside one object (the runtime merges duplicates, so `JSON.parse`'s reading
is not what runs; the validator port fails closed on the same files). The outline is a reading aid: it never lowers the
severity, and a peer whose outline is unchanged is still `block`.

`plumbline diff <old> <new> [--json]` gives the same diff for two network files on your own disk, with the names and
hosts shown (your files, your terminal; control and bidirectional-override characters are replaced by `?`). Exit 0 when
the outlines are the same, 1 when they differ, 2 for a file that cannot be outlined.

### Beyond this spec: an A2A Agent Card in the lock

A site whose assistant also depends on an A2A agent can lock that agent's card: `plumbline watch --init` (or `--relock`)
`--external a2a-card=<https url>` (repeatable). The card is fetched through
`safeFetch` and recorded in the lock's `external` member (since 2026-11-18): its exact-byte SHA-256 and, per skill,
SHA-256 of `canonicalJson(skill)` keyed by SHA-256 of the skill's `id` (by position when it has none), so a change is
counted without quoting the card. A new card that cannot be fetched is left out of the lock and is a `warn` at capture
(one the previous lock held keeps its record through a `--relock`: below); one
that is not readable as a card (not JSON, a repeated key) is locked by its bytes only, with an `info`. `--relock` captures
every card the lock held again; `--drop <url>` takes one out. On every watch a changed card is `block` (kind `peer`: a
client that reads it now gets different skills or endpoints), with the counts; an unreachable one is `warn`. If the card
carries JWS signatures (A2A's `signatures`), the summary says how many; verifying them against a trust store is a
follow-up (the JWS profile in `docs/jws-profile.md` is the first half of it). The Desk's published reader holds a card's
address to the peers' address rule before fetching it, and counts the same (parity test).

The fixtures are the A2A specification's own sample cards (`src/test/fixtures/a2a/README.md`): none of the hosts this
repository talks to publishes a card (2026-11-18).

**MCP tool lists: designed, not built.** An MCP server's tools (`kind: "mcp-tools"`, reserved on the wire) would be
read with `initialize`, then `tools/list`: JSON-RPC over HTTP POST, with the session id the server returns. `safeFetch`
makes GET requests only. The narrow extension would be: POST with a fixed, small request body built by Plumbline (no
caller-supplied body), `content-type: application/json`, the same address checks after DNS, the same body ceiling and
absolute timeout, no redirects followed for a POST, and `parts` = per tool SHA-256 of `canonicalJson({ name,
description, inputSchema })` keyed by SHA-256 of the name. It is not built because no MCP server among the hosts this
repository already talks to could be recorded as a fixture within the rules this work runs under (no POST to a third
party), and a reader derived from no recorded response is a guess. `--external mcp-tools=...` is refused with that
reason, and a lock that holds an `mcp-tools` entry gets a `warn` saying it was not checked.

### Accepting drift: `--relock`

`plumbline watch --root <dir> --relock [--drop <ref>]... [--json]`, after a person reviewed the drift and accepts it. It captures the
current state exactly as `--init` does, plus every grounding ref the previous lock held (so a `--source` given at init is
kept; one that is gone now is a finding and leaves the lock), writes the lock in place (beside it, then renamed over it,
so a failed write leaves the old one), and prints what changed: `added`, `removed` and `changed` refs, each labelled
`grounding`, `runtime`, `peer`, `pending`, `runtime commit` or `runtime via`. It ends with the reminder that the lock is a
signed file. With `--json` it prints `{ relocked, previous, changes: { added, removed, changed }, findings, facts,
reminder }`. Exit 0 when it wrote the lock. `--init` and `--relock` together are a usage error.

**A relock never forgets what it could not re-read** (UAT-3). What the previous lock held and cannot be read now is
kept, with a `warn` that says so, never replaced by `pending` or dropped because something is down today: a pinned
peer that cannot be reached (or whose address the address rule refuses) keeps its pin ("A peer could not be re-read
(...), so the lock keeps its earlier pin (recorded <date>); every watch compares the peer with that pin."), so when it
returns changed the next watch blocks with the outline; a pending peer keeps the date it was first held pending; an
external definition keeps its record; and a peer whose `plumbline.signature.json` cannot be read (an HTTP 5xx, not JSON,
no valid kid) keeps the kid the lock recorded (a `warn`: "A peer's signature could not be read at capture ..."; at
`init`, with no kid to keep, the lock records none and says so). A peer that was signed and publishes no signature now
(404 or 410) is a signer change (TOM-RC-1, below): the relock refuses it. So a relock with nothing reachable changes no
peer or card ref. A peer leaves the lock only when no network names it any more.

**A relock never silences a stale fact** (UAT-2). A page given with `--source` that no longer states a fact the lock
watched on it, while the network still states that fact and no page in the new lock states it, is not accepted: the
relock keeps the lock's earlier record of that page (its hash and anchors) with a `warn` ("Not accepted: the network
still states 1 fact this page no longer states (1 price), and no other locked page states it, ..."), so every later
watch still reports the stale fact, and the change list does not show the page as changed. It leaves when the network
(or the page) is corrected and relocked, or when the page is taken out with `--drop`. A fact moved to another locked
page is not stale.

`--drop <ref>` (repeatable, with `--relock` only) takes a grounding source the publisher no longer wants watched out of
the lock: it is not captured again, and `removed grounding <ref>` lists it. A later `--relock` does not bring it back. A
ref the site itself still names (a root agent file, a manifest-named network) can be dropped too, and the relock says so
with a `warn`: every watch's coverage check will report it as not covered while the site names it. A ref the lock did not
hold is an `info`, "nothing to drop". `--drop` without `--relock`, or naming the same ref as a `--source`, is a usage
error. Only grounding refs and external definitions are dropped; a peer leaves the lock when no network names it any
more, so `--drop <peer>` is refused (exit 2) with that sentence, and nothing is written.

**Accept is per ref and knows signers** (UAT-4, the owner's design of 2026-11-18). A relock **refuses** while a peer is
signed by another key than the one the lock recorded: exit 1, nothing written, each such peer named with the kid the
lock recorded, the kid it is signed by now and what it publishes about it, and the command to run after deciding.
`--accept-signer <peer>` (repeatable) names a peer whose new signer a person accepts; the relock refuses until every
such peer is named or the site stops naming it. **Once the lock has recorded a signer for a peer, only a person naming
the peer moves it** (TOM-RC-1): to another kid; to no signature (the peer answers 404 or 410 for its
`plumbline.signature.json`; accepted, the lock records the peer unsigned and keeps the kid it had as `formerKid`); and,
for a peer accepted as no longer signing, to any kid other than its `formerKid`. A signature that cannot be read is
none of these: the relock keeps the recorded kid and says so. The refusal names each peer with the kid the lock
recorded and what it is signed by now (or that it publishes no signature), and gives one command per peer (TOM-RC-3): with
one peer, `--relock --accept-signer <peer>`; with several, `--relock --accept <peer> --accept-signer <peer>` each, since
naming one still leaves the relock refused for the others; each with `--trust <your trust file>` when no trust file was
given and the peer has a new key to back. `--json`: `{ relocked: false, refused: "signer", peers: [{ peer, from, to?,
how }], commands }`. An accepted signer is listed in the change list (`signer  peer <url>:
<old> -> <new> (...)`, `--json` `signers`), with `--trust <file>` saying whether that trust file backs the new key (it
holds it for the peer's origin, or the published rotation verifies from a key it holds); an unbacked one is still
accepted when named, and the line says "not backed by your trust file". `--accept <ref>` (repeatable) narrows a relock to
the named refs (a grounding ref, a peer address, an external address or a runtime file): everything else keeps the
previous lock's record and keeps reporting, so accepting a rotated seller does not touch a swapped one. A first signer
is never recorded without a line (TOM-RC-4): `init`, `watch --init` and the relock print `signer  peer <url>: first seen,
recorded <kid>; compared with no earlier key (...)` for a peer the lock did not hold, and `recorded <kid>, its first
signer (the lock recorded it unsigned)` for one recorded unsigned, each with its backing (`--json`: `firstSigners: [{
peer, kid, was: "added" | "unsigned", backing }]`). The lock keeps no record of a peer it no longer holds, so a peer
the site stops naming and names again is first seen: its key is compared with nothing earlier, and the line says so.
The lock still
pins a peer's kid only, never its public key: a published, signed file is not a second trust store. The Action never
passes `--accept-signer`: with a signer change pending its pull request is not relocked, and says so (below).

### The lock (`plumbline.lock.json`)

```json
{
  "version": 1,
  "runtime": {
    "source": "nsdeploy",
    "commit": "53a787c",
    "via": { "repo": "cognizant-ai-labs/agentic-web", "path": "skills/agentify-website/runtime", "commit": "7817c1f75b8d4f497c869540212be17dda94dcae" },
    "files": { "runtime/engine.js": "<sha256>" }
  },
  "grounding": {
    "sources": [
      { "ref": "agent-manifest.json", "sha256": "<sha256>" },
      { "ref": "pages/prices.html", "sha256": "<sha256>", "anchors": ["<sha256 of a normalised literal>"] }
    ],
    "builtAt": "<ISO UTC>"
  },
  "peers": {
    "https://peer.example/partner": {
      "sha256": "<sha256>", "links": "<sha256> or absent", "kid": "<kid>, or formerKid: <kid> once a person accepted that it stopped signing",
      "outline": { "agents": { "<sha256 of a name>": "<sha256 of the agent>" }, "hosts": ["<sha256 of a host>"], "front": "<sha256 of a name>" },
      "checkedAt": "<ISO UTC>"
    }
  },
  "pendingPeers": { "https://later.example/partner": { "since": "<ISO UTC>" } },
  "external": {
    "https://agent.example/.well-known/agent-card.json": { "kind": "a2a-card", "sha256": "<sha256>", "parts": { "<sha256 of a skill id>": "<sha256 of the skill>" }, "checkedAt": "<ISO UTC>" }
  }
}
```

Every `<sha256>` is the lowercase hex SHA-256 of exact bytes. `peers[url].links` is the hash of the peer's `links.json`
at its site base, or the literal string `absent` when the peer answered 404 or 410, so a `links.json` that appears later
is drift. `kid` is present only when the peer published a signature. `formerKid` (since 2026-11-18) is present only
without `kid`: the kid the lock recorded before a person accepted, with `--accept-signer`, that the peer publishes no
signature now; a later signature by any other key is a signer change from it. `outline` (since 2026-11-18) is the peer's
definition in outline, below; it is omitted when the definition could not be outlined, and every lock written before
has none. `runtime.via` is present only when the runtime
names the repository folder it was copied from, and `pendingPeers` only when a peer could not be captured. Absent
optional fields are omitted, never `null`.

**The lock is a published, signed file.** When a site serves `plumbline.lock.json`, `plumbline sign` signs it (the Desk
reads it, and an unsigned baseline would be anyone's word), and a lock that is present but not signed makes the
signature `invalid tampered` (`docs/signature-format.md`). So the publisher's order is:

1. `plumbline watch --init` writes the lock;
2. `plumbline sign` signs the site, the lock included;
3. later, when the watch reports drift you accept: review it, run `plumbline watch --relock`, read what it says changed,
   and **sign again**. Re-signing after accepting drift is part of the workflow: a lock changed after signing makes the
   signature `invalid tampered` until you do.

### The Desk's drift reader (`site/drift.js`)

The Desk re-checks a site's PUBLISHED lock in the browser, with the reader `plumbline watch --url` runs
(`src/watch/published.ts`); `drift.js` only gives it the browser's error sentence and the `refused` lock state. What every read means (the lock's shape rule, each finding
and its severity, the peer signer rule, pending peers) is `src/watch/decide.ts`, an I/O-free module the CLI's watch
loads too, so the two cannot disagree; a test gives both the same lock and the same bytes and compares the findings.
What is read of a published file or a peer, and in what order (the network definition located through the peer's
manifest, then its `links.json`, then its signer kid), is `src/watch/observe.ts`, a fetcher-injected module with no Node
import that the CLI's watch, its `--init` capture and the Desk all run; only the fetcher, the error sentence and an
address guard are the Desk's own. What the Desk does differently is I/O only: lock references resolve against the lock's
URL, and the upstream, coverage, added-runtime-file and signature-expiry checks are the CLI's. And the lock is a
stranger's document, so the addresses in it are destinations a stranger chose:

- a **peer address** that is not `https`, carries credentials, a query or a fragment, or names `localhost`, a
  single-label host, any IPv6 literal, or an IPv4 literal in a range `safeFetch` refuses is never contacted, and is a
  `warn` whose sentence does not quote it (decide.ts `peerAddressProblem`);
- an absolute **grounding ref** in the lock, and the **network file a peer's own manifest names** (its `hocon` can be an
  absolute address on any host), are held to the same rule less the query check (decide.ts `destinationProblem`): never
  fetched, a `warn` ("was not fetched, because ...", "A peer's network file was not contacted: ..."), and a refused
  network file is not listed as an unreachable peer.

The IPv4 ranges are not a second list: `peerAddressProblem` and `destinationProblem` call `isBlockedAddress` from
`src/net/address.ts`, the table `safeFetch` enforces (the page's fetcher allows `http` to `localhost`, so a lock could
otherwise aim the visitor's browser at their own machine).

## `safeFetch` (`src/net/safe-fetch.ts`)

Every fetch of an address we do not own goes through this one function. Its rules:

1. **https only.** `http` and loopback addresses are accepted only behind the `allowLocal` option, which defaults to false:
   the tests' loopback server and `plumbline gate --allow-local` set it. Private ranges stay refused even then, and so
   does `http` to a public address.
2. **Resolve, then check every answer**, with `node:dns`, before connecting. The table is `src/net/address.ts` (no Node
   import; the Desk's drift reader holds IP literals to the same one). Refused: `0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`,
   `169.254/16` (cloud metadata), `172.16/12`, `192.0.0/24`, `192.0.2/24`, `192.88.99/24` (deprecated 6to4 relay anycast),
   `192.168/16`, `198.18/15`, `198.51.100/24`, `203.0.113/24`, multicast and reserved `224/3`; in v6 `::`, `::1`, `fc00::/7`,
   `fe80::/10`, `fec0::/10`, `ff00::/8`, the documentation prefixes `2001:db8::/32` and `3fff::/20` (RFC 9637), the
   benchmarking prefix `2001:2::/48` (RFC 5180), Teredo, the v4-compatible `::a.b.c.d`, the v4-translated
   `::ffff:0:a.b.c.d` and everything else in the IETF-reserved `::/8`, and the v6 forms that carry a v4 address judged by the
   address inside (`::ffff:a.b.c.d`, `64:ff9b::/96`, `2002::/16`, and ISATAP interface identifiers `::0:5efe:a.b.c.d` and
   `::200:5efe:a.b.c.d` under any prefix). One bad answer among several refuses the host. An unparseable address is refused.
3. **Connect to the address that was checked** (a `lookup` that returns it): no second resolution, so DNS rebinding between check and connect does not work.
4. **At most 3 redirects**, each hop re-validated from rule 1. Custom headers are dropped when a hop changes origin.
5. **Body ceiling: 512 KiB (524,288 bytes).** Measured 2026-11-17: the largest real `*.network.json` among the example sites in
   cognizant-ai-labs/agentic-web is `examples/sites/pizza_restaurant_website_assistant_static/...network.json` at 41,156 bytes (the next
   is 9,370). 41,156 x 10 = 411,560, rounded up to 512 KiB. A caller may lower the ceiling, never raise it. No `accept-encoding` is sent, so no decompression bomb.
6. **One absolute timeout** (default 10 s) covers resolution, connect, redirects and the whole body; a body that drips forever trips it.
   A redirect's body is never read: its connection is closed as soon as the `Location` is known, so a redirecting host whose
   body never ends cannot hold the socket (and the CLI process) open after `safeFetch` returns.

Failures carry their own code, and one table words them for the gate, the watch and the Desk (`describeFetchError` in
`src/net/fetch-types.ts`, which has no Node import, so the browser build carries it): `blocked-address`, `insecure-scheme`, `dns-failed`, `too-many-redirects`, `body-too-large`,
`timeout`, `network`, `bad-url`. A caller turns any of them into `unavailable` (gate) or a `warn` or `info` finding (watch), never an exception that stops the run.

## What a clean report does NOT mean

- **A gate `pass` is not a security review.** The validator port checks structure, not what the instructions say. Atlas checks public files against a spec profile ("not that a site's agents are safe to trust"). A Customs receipt is a stamp on one inspection on one date; the live network was not rechecked.
- **`unavailable` is not `pass`.** A gate where every adapter was `unavailable` exits 1 under either `--fail-on`. Fail the build on any `unavailable` (`--fail-on unavailable`) if a partly checked site must not ship; Agent Customs has receipts for few sites, so pair it with `--adapters validator,atlas` (above).
- **A clean watch means the locked things match the lock, and the site names nothing the lock misses.** The coverage check sees a new root agent file, a new manifest-named network and a new peer. The CLI's watch also sees a file added to the locked runtime folder (the Desk does not: a browser cannot list a folder). It does not see a new file of the kind only `--source` locks; the added refs `--relock` lists show those.
- **It does not verify signatures.** The peer check compares signer kids; the signature itself is verified by the verifier in `src/core` against a trust store.
- **It sees only public files and only what the fetch could reach.** A peer that serves different bytes to different visitors, or only to browsers, is not seen. A peer on a private address is never contacted.
- **The upstream check is informational.** "Upstream is ahead" means the newest commit differs, not that the vendored copy is vulnerable; the vendored runtime also carries local edits listed in its README.
- **The lock itself is trusted.** Anyone who can commit a changed lock can bless a drift; review lock changes like code.

## Known deviations and temporary pieces

- The Agent Customs public key is pinned in source (first seen 2026-11-17, key id `-DC99sDa-qJjBp2N`); if Customs rotates it, the customs adapter is `unavailable` until the pin is updated.
- The gate sends the target address to Agent Atlas' public API, as the adapter's job.
