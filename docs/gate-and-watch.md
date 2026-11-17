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

Exit code: 0 passed by `--fail-on`, 1 failed by it, 2 usage. One rule sits above `--fail-on`: when **every** adapter is
`unavailable`, nothing was checked, and the gate exits 1 whatever `--fail-on` says, with the line
`plumbline gate: nothing was checked: every adapter was unavailable, so this is not a pass` on stderr (so `--json` output
stays one JSON document). Otherwise `--fail-on fail` fails only on a `fail`, so a run where some adapters were
`unavailable` and the rest passed exits 0, and `--fail-on unavailable` fails on any `unavailable` too. Earlier builds exited 0
for an all-unavailable run under `--fail-on fail`; bp's adoption review recorded that as a deviation from "unavailable is
never pass", and this rule closes it.

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
| duplicate keys (ours, not in the reference) | the manifest or a network definition repeats a key inside one object, anywhere in the file (keys compared after unescaping). The summary says "duplicate keys: the reference runtime merges them, so the file means something different from what a JSON reader sees": `JSON.parse` keeps the last value, the runtime's HOCON reader deep-merges them, so a duplicate `commondefs` can change an agent's instructions while every JSON tool, this port included, sees a clean file |

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
A failed signature is `fail`. A validly signed receipt for another network, an index that contradicts the receipt, or a receipt
past its own `expiresAt` or 35 days after `inspectedAt` (whichever is first) is `unavailable`. `CLEARED` and `CONDITIONS` are
`pass`; `HOLD`, `DENIED` and `INVALID` are `fail`; `UNREADABLE` or an unknown code is `unavailable`.

**Not done, and the summary says so:** the live network is not rechecked against the receipt's fingerprint. Customs fingerprints the
runtime's normalised config (replacement strings expanded, defaults pushed down, `links` split off), which cannot be reproduced
from the published file without the runtime. A network that changed after it was stamped is not noticed by this adapter. Only
networks Customs lists get receipts (its `tools/receipt-sites.json`), so most targets are `unavailable` here.

## The watch

`plumbline watch [--root <dir>] [--init | --relock] [--source <ref>]... [--timeout <ms>] [--json]`. It is a dry run: it
reports, and with `--init` and no lock yet it writes `plumbline.lock.json`. With a lock present, `--init` does not
overwrite it; `--relock` does (below). Opening an issue is the workflow template's job (`action/templates/plumbline-watch.yml`),
never the library's. Exit 0 when no finding is `warn` or `block` (`info` alone is clean), 1 otherwise, 2 for a usage or
I/O error.

**The lock's state is not a finding.** Every report carries `lockState`: `found` (the lock was read and checked),
`absent` (no lock), `unreadable` (it could not be read, or it is reached through a link that leaves the root) or
`unusable` (not JSON, or not the lock's shape). For any state but `found`, `lockSummary` says why no drift was checked
(for `absent` it starts "no lock") and `findings` holds only the signature-expiry check below. Nothing was checked, so
the exit is 1, never a clean 0. The Desk's drift reader reports the same states by the same rule (it adds `refused`, for
a lock the browser was refused), so a drift count is a count of drift.

| Detector | What it re-checks | Finding and severity |
| --- | --- | --- |
| `grounding` | each `grounding.sources[].ref` (a path under the root, or an https URL through `safeFetch`), hashed again | changed: `warn`. Unreadable, missing or outside the root: `warn`, saying so |
| `runtime` (a) | each file in `runtime.files`, under the root | changed or missing: `block` (the vendored runtime is copy-do-not-change) |
| `runtime` (b) | the runtime's upstream, from the GitHub API, unauthenticated (see "Which upstream the runtime check asks") | upstream moved on: `info` "Upstream is ahead" with both short SHAs. Cannot ask (timeout, rate limit, HTTP error, odd answer): `info` "Could not check upstream". Never `block` |
| `peer` | each `peers[url]`: the network definition, hashed again | changed in any byte: `block` (a peer's definition runs in the visitor's browser, so a changed one is changed code). Unreachable: `warn` |
| `peer` links | each `peers[url].links`: the peer's `links.json` at the same site base (the runtime fetches it for every peer network it loads and lays it over that network's links) | appeared (locked `absent`, now served), changed, or gone (404/410 now): `block`. Cannot be read (timeout, HTTP 5xx): `warn`. A lock written before 2026-11-17 has no `links` for the peer: `warn`, "re-lock to track it", never a silent pass |
| `peer` signer | the peer's `plumbline.signature.json`, if it has one | kid differs from the lock's: `block`. Signed when locked, no usable signature now: `warn`. Unsigned when locked, signed now: `info`. A `kid` that is not exactly 16 lowercase hex characters is never recorded or quoted; it counts as no usable signature |
| `peer` pending | each `pendingPeers[url]`: a peer that could not be captured when the lock was written | `warn` on every watch, reachable or not, until `--relock` captures it |
| coverage | what the site names now (the discovery `--init` uses, below) against what the lock holds | a root agent file or a manifest-named network file not in `grounding.sources`: `warn` (grounding). A peer a network or `links.json` names that is neither in `peers` nor pending: `warn` (peer). A network file that is not JSON, so its peers cannot be read: `warn` (peer). An unsafe `hocon`: `warn`, as at init |
| signature expiry | the site's own `plumbline.signature.json` at the root, its `expiresAt` | expired: `block` (verifiers answer `invalid expired`). Expiring within 14 days: `warn`, with the date and the days left. No signature file: no finding (signing is the publisher's choice). A file with no readable `expiresAt`: `warn`. Kind `grounding`, ref `plumbline.signature.json` (the wire has three drift kinds; the signed files are the grounding). Checked whatever the lock's state |

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
`cognizant-ai-labs/agentic-web`'s `skills/agentify-website/runtime` at commit `7817c1f`, which is itself nsdeploy's
runtime at `53a787c` with agentic-web's edits on top (its README lists them). The edits live in agentic-web, so a new
nsdeploy commit reaches this copy only through agentic-web, and a new agentic-web commit to that folder is invisible to
a check that asks nsdeploy. (Checked read-only against the GitHub API on 2026-11-17: the folder's newest commit as of
`7817c1f` is `63a1b15`; on `main` it is `7ee54a3`, "Send Otari EU keys to the EU gateway", made after the copy.) So:

- a lock whose runtime records `via` is checked against that folder: the newest commit that touched `via.path` on the
  default branch (`GET /repos/<repo>/commits?path=<path>&per_page=1`) against the newest that had touched it as of the
  copied commit (`GET /repos/<repo>/commits?sha=<via.commit>&path=<path>&per_page=1`). Equal means the folder has not
  changed since the copy, whatever else the repository did; different is `info` "Upstream is ahead". Two requests of
  about 4 KB each.
- a lock with no `via` (a site that vendors nsdeploy's runtime directly, or a lock written before 2026-11-18) is checked
  against nsdeploy's newest commit, as before.

`via` is checked before it becomes part of an address: `repo` is `owner/name` in GitHub's characters, `path` a safe
relative path, `commit` 7 to 40 hex characters; anything else makes the lock `unusable`.

### Accepting drift: `--relock`

`plumbline watch --root <dir> --relock [--json]`, after a person reviewed the drift and accepts it. It captures the
current state exactly as `--init` does, plus every grounding ref the previous lock held (so a `--source` given at init is
kept; one that is gone now is a finding and leaves the lock), writes the lock in place (beside it, then renamed over it,
so a failed write leaves the old one), and prints what changed: `added`, `removed` and `changed` refs, each labelled
`grounding`, `runtime`, `peer`, `pending`, `runtime commit` or `runtime via`. It ends with the reminder that the lock is a
signed file. With `--json` it prints `{ relocked, previous, changes: { added, removed, changed }, findings, reminder }`.
Exit 0 when it wrote the lock. `--init` and `--relock` together are a usage error.

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
  "grounding": { "sources": [{ "ref": "agent-manifest.json", "sha256": "<sha256>" }], "builtAt": "<ISO UTC>" },
  "peers": {
    "https://peer.example/partner": { "sha256": "<sha256>", "links": "<sha256> or absent", "kid": "<kid>", "checkedAt": "<ISO UTC>" }
  },
  "pendingPeers": { "https://later.example/partner": { "since": "<ISO UTC>" } }
}
```

Every `<sha256>` is the lowercase hex SHA-256 of exact bytes. `peers[url].links` is the hash of the peer's `links.json`
at its site base, or the literal string `absent` when the peer answered 404 or 410, so a `links.json` that appears later
is drift. `kid` is present only when the peer published a signature. `runtime.via` is present only when the runtime
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

The Desk re-checks a site's PUBLISHED lock in the browser. What every read means (the lock's shape rule, each finding
and its severity, the peer signer rule, pending peers) is `src/watch/decide.ts`, an I/O-free module the CLI's watch
loads too, so the two cannot disagree; a test gives both the same lock and the same bytes and compares the findings.
What the Desk does differently is I/O only: lock references resolve against the lock's URL, and the upstream, coverage
and signature-expiry checks are the CLI's. And the lock is a stranger's document, so its peer addresses are
destinations a stranger chose: one that is not `https`, carries credentials, a query or a fragment, or names
`localhost`, a single-label host, a private or loopback IPv4 literal or any IPv6 literal is never contacted, and is a
`warn` whose sentence does not quote it (the page's fetcher allows `http` to `localhost`, so a lock could otherwise aim
the visitor's browser at their own machine).

## `safeFetch` (`src/net/safe-fetch.ts`)

Every fetch of an address we do not own goes through this one function. Its rules:

1. **https only.** `http` and loopback addresses are accepted only behind the `allowLocal` option, which defaults to false:
   the tests' loopback server and `plumbline gate --allow-local` set it. Private ranges stay refused even then, and so
   does `http` to a public address.
2. **Resolve, then check every answer**, with `node:dns`, before connecting. Refused: `0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`,
   `169.254/16` (cloud metadata), `172.16/12`, `192.0.0/24`, `192.0.2/24`, `192.88.99/24` (deprecated 6to4 relay anycast),
   `192.168/16`, `198.18/15`, `198.51.100/24`, `203.0.113/24`, multicast and reserved `224/3`; in v6 `::`, `::1`, `fc00::/7`,
   `fe80::/10`, `fec0::/10`, `ff00::/8`, `2001:db8::/32`, Teredo, the v4-compatible `::a.b.c.d`, the v4-translated
   `::ffff:0:a.b.c.d` and everything else in the IETF-reserved `::/8`, and the v6 forms that carry a v4 address judged by the
   address inside (`::ffff:a.b.c.d`, `64:ff9b::/96`, `2002::/16`, and ISATAP interface identifiers `::0:5efe:a.b.c.d` and
   `::200:5efe:a.b.c.d` under any prefix). One bad answer among several refuses the host. An unparseable address is refused.
3. **Connect to the address that was checked** (a `lookup` that returns it): no second resolution, so DNS rebinding between check and connect does not work.
4. **At most 3 redirects**, each hop re-validated from rule 1. Custom headers are dropped when a hop changes origin.
5. **Body ceiling: 512 KiB (524,288 bytes).** Measured 2026-11-17: the largest real `*.network.json` among the example sites in
   cognizant-ai-labs/agentic-web is `examples/sites/pizza_restaurant_website_assistant_static/...network.json` at 41,156 bytes (the next
   is 9,370). 41,156 x 10 = 411,560, rounded up to 512 KiB. A caller may lower the ceiling, never raise it. No `accept-encoding` is sent, so no decompression bomb.
6. **One absolute timeout** (default 10 s) covers resolution, connect, redirects and the whole body; a body that drips forever trips it.

Failures carry their own code, and one table words them for the gate, the watch and the Desk (`describeFetchError` in
`src/net/fetch-types.ts`, which has no Node import, so the browser build carries it): `blocked-address`, `insecure-scheme`, `dns-failed`, `too-many-redirects`, `body-too-large`,
`timeout`, `network`, `bad-url`. A caller turns any of them into `unavailable` (gate) or a `warn` or `info` finding (watch), never an exception that stops the run.

## What a clean report does NOT mean

- **A gate `pass` is not a security review.** The validator port checks structure, not what the instructions say. Atlas checks public files against a spec profile ("not that a site's agents are safe to trust"). A Customs receipt is a stamp on one inspection on one date; the live network was not rechecked.
- **`unavailable` is not `pass`.** A gate where every adapter was `unavailable` exits 1 under either `--fail-on`. Fail the build on any `unavailable` (`--fail-on unavailable`) if a partly checked site must not ship.
- **A clean watch means the locked things match the lock, and the site names nothing the lock misses.** The coverage check sees a new root agent file, a new manifest-named network and a new peer. It does not see a runtime file added next to the locked ones, or a new file of the kind only `--source` locks; the added refs `--relock` lists show those.
- **It does not verify signatures.** The peer check compares signer kids; the signature itself is verified by the verifier in `src/core` against a trust store.
- **It sees only public files and only what the fetch could reach.** A peer that serves different bytes to different visitors, or only to browsers, is not seen. A peer on a private address is never contacted.
- **The upstream check is informational.** "Upstream is ahead" means the newest commit differs, not that the vendored copy is vulnerable; the vendored runtime also carries local edits listed in its README.
- **The lock itself is trusted.** Anyone who can commit a changed lock can bless a drift; review lock changes like code.

## Known deviations and temporary pieces

- The Agent Customs public key is pinned in source (first seen 2026-11-17, key id `-DC99sDa-qJjBp2N`); if Customs rotates it, the customs adapter is `unavailable` until the pin is updated.
- The gate sends the target address to Agent Atlas' public API, as the adapter's job.
