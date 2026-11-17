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

`plumbline watch [--root <dir>] [--init] [--source <ref>]... [--timeout <ms>] [--json]`. It is a dry run: it reports, and with
`--init` and no lock yet it writes `plumbline.lock.json`. With a lock present, `--init` does not overwrite it. Opening an issue
is the workflow template's job (`action/templates/plumbline-watch.yml`), never the library's. Exit 0 when no finding is `warn` or
`block` (`info` alone is clean), 1 otherwise, 2 for a usage or I/O error. No lock and no `--init` is one finding: grounding,
`warn`, `plumbline.lock.json`, "no lock". A lock that is unreadable or has the wrong shape is one `warn` finding and nothing else
is checked.

| Detector | What it re-checks | Finding and severity |
| --- | --- | --- |
| `grounding` | each `grounding.sources[].ref` (a path under the root, or an https URL through `safeFetch`), hashed again | changed: `warn`. Unreadable, missing or outside the root: `warn`, saying so |
| `runtime` (a) | each file in `runtime.files`, under the root | changed or missing: `block` (the vendored runtime is copy-do-not-change) |
| `runtime` (b) | newest commit of `cognizant-ai-lab/nsdeploy` from the GitHub API, unauthenticated | differs from `runtime.commit`: `info` "Upstream is ahead" with both short SHAs. Cannot ask (timeout, rate limit, HTTP error, odd answer): `info` "Could not check upstream". Never `block` |
| `peer` | each `peers[url]`: the network JSON, hashed again | changed or no longer JSON: `block` (a peer's definition runs in the visitor's browser, so a changed one is changed code). Unreachable: `warn` |
| `peer` signer | the peer's `plumbline.signature.json`, if it has one | kid differs from the lock's: `block`. Signed when locked, no usable signature now: `warn`. Unsigned when locked, signed now: `info` |

Hashing: the canonical JSON (sorted keys, no whitespace, `undefined` dropped, UTF-8; the same bytes as `canonicalJson` in
`src/core`) when the text parses as JSON, else the text with CRLF folded to LF and a leading BOM ignored, so re-serialising a
JSON file or checking out files on Windows is not drift. Bytes that are not UTF-8 are hashed as they are. The signer check
compares the kid only; verifying a signature needs a trust store and is `src/core`'s job.

`--init` captures: every file under `runtime/` (else `site/runtime/`) and the nsdeploy commit its README or NOTICE names
(`nsdeploy commit \`53a787c\``, else `unknown`); `agent-manifest.json`, `links.json` and every `*.network.json` at the root plus any
`--source` as grounding; and as peers the keys of `link_labels`, the `http(s)` non-MCP entries of an agent's `tools`, and the
`http(s)` values in `links.json`. Something that cannot be captured (an unreachable peer, a missing source) is left OUT of the
lock and returned as a finding, so a lock with a gap is never mistaken for a complete one.

## `safeFetch` (`src/net/safe-fetch.ts`)

Every fetch of an address we do not own goes through this one function. Its rules:

1. **https only.** `http` and loopback addresses are accepted only behind the `allowLocal` option, which defaults to false:
   the tests' loopback server and `plumbline gate --allow-local` set it. Private ranges stay refused even then, and so
   does `http` to a public address.
2. **Resolve, then check every answer**, with `node:dns`, before connecting. Refused: `0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`,
   `169.254/16` (cloud metadata), `172.16/12`, `192.0.0/24`, `192.0.2/24`, `192.168/16`, `198.18/15`, `198.51.100/24`, `203.0.113/24`,
   multicast and reserved `224/3`; in v6 `::`, `::1`, `fc00::/7`, `fe80::/10`, `fec0::/10`, `ff00::/8`, `2001:db8::/32`, Teredo, and the
   v6 forms that carry a v4 address (`::ffff:a.b.c.d`, `::a.b.c.d`, `64:ff9b::/96`, `2002::/16`) judged by the address inside. One bad
   answer among several refuses the host. An unparseable address is refused.
3. **Connect to the address that was checked** (a `lookup` that returns it): no second resolution, so DNS rebinding between check and connect does not work.
4. **At most 3 redirects**, each hop re-validated from rule 1. Custom headers are dropped when a hop changes origin.
5. **Body ceiling: 512 KiB (524,288 bytes).** Measured 2026-11-17: the largest real `*.network.json` among the example sites in
   cognizant-ai-labs/agentic-web is `examples/sites/pizza_restaurant_website_assistant_static/...network.json` at 41,156 bytes (the next
   is 9,370). 41,156 x 10 = 411,560, rounded up to 512 KiB. A caller may lower the ceiling, never raise it. No `accept-encoding` is sent, so no decompression bomb.
6. **One absolute timeout** (default 10 s) covers resolution, connect, redirects and the whole body; a body that drips forever trips it.

Failures carry their own code: `blocked-address`, `insecure-scheme`, `dns-failed`, `too-many-redirects`, `body-too-large`,
`timeout`, `network`, `bad-url`. A caller turns any of them into `unavailable` (gate) or a `warn` or `info` finding (watch), never an exception that stops the run.

## What a clean report does NOT mean

- **A gate `pass` is not a security review.** The validator port checks structure, not what the instructions say. Atlas checks public files against a spec profile ("not that a site's agents are safe to trust"). A Customs receipt is a stamp on one inspection on one date; the live network was not rechecked.
- **`unavailable` is not `pass`.** A gate where every adapter was `unavailable` exits 1 under either `--fail-on`. Fail the build on any `unavailable` (`--fail-on unavailable`) if a partly checked site must not ship.
- **A clean watch means the locked things match the lock.** It does not cover anything not in the lock: a new grounding file, a new peer, a runtime file added next to the locked ones. Re-run `--init` into a fresh lock and diff it to find those.
- **It does not verify signatures.** The peer check compares signer kids; the signature itself is verified by the verifier in `src/core` against a trust store.
- **It sees only public files and only what the fetch could reach.** A peer that serves different bytes to different visitors, or only to browsers, is not seen. A peer on a private address is never contacted.
- **The upstream check is informational.** "Upstream is ahead" means the newest commit differs, not that the vendored copy is vulnerable; the vendored runtime also carries local edits listed in its README.
- **The lock itself is trusted.** Anyone who can commit a changed lock can bless a drift; review lock changes like code.

## Known deviations and temporary pieces

- `src/net/canonical.ts` re-exports core's `canonicalJson` and `sha256Hex` (core is the one authority for the canonical bytes) and adds the document fingerprints; the parity test against `src/core` stays.
- The Agent Customs public key is pinned in source (first seen 2026-11-17, key id `-DC99sDa-qJjBp2N`); if Customs rotates it, the customs adapter is `unavailable` until the pin is updated.
- The gate sends the target address to Agent Atlas' public API, as the adapter's job.
