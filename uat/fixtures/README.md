# UAT fixture worlds

Source material for the five worlds `uat/driver/world.mjs` materialises (`uat/env.md` is the contract). Each world folder
holds `world.json` (ports, sites, roles, the starting act and every act's one-line description) and one folder per site.
A site with `"repo": true` is a repository whose `site/` folder is served. `{{site:<name>}}` is replaced at `up` with
`http://127.0.0.1:<port>`. `_runtime/` holds two small stand-ins for a vendored browser runtime (copied into a site's
`runtime/` at `up`): `agentic-web-7ee54a3` (a NOTICE naming the agentic-web folder and commit, so the lock records `via`)
and `nsdeploy-53a787c` (nsdeploy directly). They are not the runtime; `site/runtime/` is never copied.

All businesses, people, phone numbers (the +44 1632 960xxx drama range) and `.example` domains are fictional. Keys are
made by `keygen` inside the world's temp folder at `up` or during an act; none is stored here.

"Confirmed" below is what the real product printed when the act was played on 2026-11-18 (abridged). "Harness" means
`uat/driver/local-cli.mjs` (the built modules with `allowLocal`), needed because the CLI cannot reach a loopback peer
(`uat/env.md`, "Reaching a world").

## larch-house (J1, Marta) - ports 4100, 4101, Desk 4199

| Site | What it is |
| --- | --- |
| `larch-house` (repo) | the guesthouse. `larch_house.network.json`: front agent `larch_concierge` states the double room €89, single €69, check-in 15:00, check-out 10:30, breakfast €12, phone +44 1632 960418, `stay@larchhouse.example`; it links the bike peer. `rooms.html` states the same facts (a price table with a "Sleeps" column, then prose). |
| `fellside-cycles` | the bike-rental peer, network `fellside_bikes` (two agents) |

| Act | What it changes | Confirmed |
| --- | --- | --- |
| `setup` (by up) | keygen `keys/larch-house` (Jonas's key), key record published, `init --root site --source rooms.html --workflow` from the repo (exit 1: the peer is pending), `sign` | `init: wrote plumbline.lock.json (3 grounding sources, 4 runtime files, 0 peers, 1 pending)`; `verify --url ... --allow-local` with the key trusted: `verified` |
| `solo` (the demo film; needs setup) | unlinks the bike-rental partner from the network and `allowed_peers`, `watch --root site --relock`, `sign` | `watch --root`: `no drift (nothing at warn or block)`, exit 0; `watch --url --allow-local`: exit 0 (2026-11-23) |
| `raise-price` | `rooms.html`: double €89 -> €95 | `watch --root`: `warn grounding rooms.html: A grounding source changed since the lock was written; all 5 facts the network states from it are still on it.` (see Observed 1); `verify`: still `verified` (the page is not a signed file) |
| `fix-network` | network: €89 -> €95 (needs raise-price) | `warn grounding larch_house.network.json: ... the agent now answers from different facts.`; `verify`: `invalid tampered` |
| `cosmetic-edit` | `rooms.html` wording only | `warn grounding rooms.html: ... all 5 facts the network states from it are still on it.` |
| `rooms-no-cors` / `rooms-cors` | `rooms.html` served without / with `Access-Control-Allow-Origin` (coordinator's addition; not in the journey file) | `curl -I`: the header is absent on `/rooms.html` only, then back |

## meridian-trips (J2, Dev) - ports 4200, 4201, Desk 4299

| Site | What it is |
| --- | --- |
| `meridian-trips` (repo) | the agency: a fresh checkout, no lock, no key, no workflow. Network `meridian_trips` (trip planner, visa helper) links the converter. `tours.html` |
| `coinbridge` | the converter peer (another company): network `coinbridge_fx` (`fx_front`, `rate_lookup` with an MCP endpoint), no `links.json` |

| Act | What it changes | Confirmed (harness watch after a harness `--relock` captured the peer; the CLI says only "could not be reached (the address is not https)") |
| --- | --- | --- |
| `fresh` (by up) | nothing | `init --root site --workflow`: `1 pending`, exit 1 |
| `partner-adds-agent` | agent `fee_estimator` added and called by `fx_front`; new host `mcp.ledgerline.example` | `block peer ...coinbridge_fx: ... In outline: agents: 1 added, 0 removed, 1 changed; outbound hosts: 1 added, 0 removed; front agent: unchanged.` |
| `partner-adds-links` | Coinbridge serves `links.json` | adds `block peer ...: A peer now publishes a links.json it did not have when locked; ...` |
| `partner-changes-again` | fee 0.5% -> 0.9%, `rate_lookup` instructions (needs partner-adds-agent; refused before it, exit 1) | outline becomes `agents: 1 added, 0 removed, 2 changed` |
| `partner-changes-fee` | fee_estimator's conversion margin becomes 1.1%: partner code changes and every outline count against the lock stays what it was (needs partner-adds-agent). Added by the drain of run 2026-11-18-first-five, where Dev's walker had to edit the served file by hand (DEV-L1-06) | harness watch after partner-adds-agent and after this act: the same sentence both times, `agents: 1 added, 0 removed, 1 changed; outbound hosts: 1 added, 0 removed; front agent: unchanged`; `plumbline diff` of the bytes it replaced: `agents: 0 added, 0 removed, 1 changed ... agents changed: fee_estimator` |
| `partner-reformats` | re-serialised with tabs | alone after a fresh lock: `block ... Formatting or non-agent content only: no agent, outbound host or front agent changed.` |
| `partner-down` / `partner-back` | Coinbridge's port refuses / answers (`partner-back` is a world convenience) | `warn peer ...: A peer could not be reached (the connection failed), so it was not checked.`; `gate --allow-local`: `unavailable ... (the connection failed)` |

`plumbline diff <old> <new>` on the bytes kept under `_world/history/` printed `agents added: fee_estimator`,
`agents changed: fx_front, rate_lookup`, `outbound hosts added: mcp.ledgerline.example`.

## northgate-clinic (J3, Ines) - ports 4300, 4301, Desk 4399

| Site / folder | What it is |
| --- | --- |
| `northgate-clinic` (repo) | the clinic: network `northgate_clinic` (reception, appointments, prescriptions), `links.json`, `hours.html` |
| `northgate-mirror` | the attacker's address: a parked page until `forgery` |
| `harbour-pharmacy` (extra, not served) | the verifier: `plumbline.trust.json`, empty |

| Act | What it changes | Confirmed (`verify` with the pharmacy's trust file) |
| --- | --- | --- |
| `signed` (by up) | keygen `keys/clinic-a`, record published, `sign` | empty trust: `unverifiable ... the signer is unknown`; after `trust --url ... --allow-local --yes`: `verified` |
| `tamper` | out-of-hours number edited in the signed network | `invalid tampered ... A signed file differs from the version that was signed.` |
| `forgery` | the mirror serves the clinic's files with a changed out-of-hours number and a prescriptions agent that asks for date of birth and NHS number at the mirror; key A's record; signed with key A for the CLINIC's origin | by the mirror's own URL: `unverifiable ... the signature names a different origin`; as if served at the clinic's address (`verify --root <mirror> --origin http://127.0.0.1:4300`): `verified` before any revocation; `invalid revoked` once the pharmacy has verified the clinic after Ines revoked key A (until then still `verified`) |
| `expire` | the clinic re-signed with key A, dated 31 days ago for 30 days (refused if the clinic is signed by another key; `sign` itself refuses a revoked key) | `invalid expired`; `watch --root`: `block grounding plumbline.signature.json: The site's signature expired on ...` |
| `forgery-own-origin` | the thief re-signs the mirror's altered files with key A for the MIRROR's own origin (needs forgery; refused once attacker-rotates is played). Added by the drain of run 2026-11-18-first-five, where Ines's walker had to sign it by hand | `sign --origin http://127.0.0.1:4301` with key A; `verify --url <mirror> --allow-local --json` with A trusted for the clinic's origin: `unverifiable`, `origin=http://127.0.0.1:4301`, "the signer is unknown" (the kid is trusted, at another origin: the arm of INE-L1-03; after the pharmacy records A's revocation the CLI still says "unknown" and the Desk says `invalid revoked`) |
| `attacker-rotates` | the mirror publishes a rotation A -> `keys/attacker`, that key's record, and is signed with it (needs forgery) | `verify`: `unverifiable` with the hint to run `adopt`; `adopt` before revocation: `verified ... A key this verifier already trusts for this origin named its successor` and offers the attacker's key (adds it with `--yes`); after revocation: `invalid revoked ... nothing adopted` |

## tallow-finch (J4, Priya) - ports 4400 to 4411, Desk 4499

`portfolio` (by up) makes each state with `init`, `keygen` and `sign` (one throwaway key per client) and the edits named.
Confirmed with `gate --allow-local --adapters validator` and `watch --url --allow-local`:

| Port | Site | State | Gate (validator) | Published lock |
| --- | --- | --- | --- | --- |
| 4400 | `alder-bakery` | healthy, locked, signed | pass | clean (exit 0); `verify`: `verified` once trusted |
| 4401 | `brightwater-swim` | healthy, locked, unsigned | pass | clean; `verify`: "plumbline.signature.json not found", exit 2 |
| 4402 | `copperleaf-dental` | manifest `front_man` != the network's front agent | fail: "1 x a manifest front_man names a different agent than the network's front agent" | clean |
| 4403 | `dunmore-books` | THE LAUNCH: `commondefs` repeated (JSON readers see "All sales are final", the runtime merges, the page says 30-day refunds) | fail: "1 x duplicate keys: the reference runtime merges them, ..." | clean |
| 4404 | `elm-street-vets` | the manifest's network file is missing | fail: "a network definition named by the manifest is not published (HTTP 404)" | `absent` |
| 4405 | `fernhill-hotel` | signature expired (dated 60 days ago for 30) | pass | `block grounding plumbline.signature.json: The site's signature expired ...`; `verify`: `invalid expired` |
| 4406 | `glenrock-gym` | signed network edited after signing (£34 -> £39) | pass | `warn grounding glenrock_gym.network.json: ... the agent now answers from different facts.`; `verify`: `invalid tampered` |
| 4407 | `harbourlight-cafe` | locked with `--source menu.html`, then fish soup £9.50 -> £10.50 | pass | `warn grounding menu.html: ... 1 of 6 facts the network states are no longer on it, ...` |
| 4408 | `ivy-lane-florist` | no lock, unsigned | pass | `absent` |
| 4409 | `juniper-yoga` | every response held 12 s (the default per-fetch timeout is 10 s) | unavailable "(the request timed out)" | `unreadable` (timed out) |
| 4410 | `kestrel-plumbing` | down (port refuses) | unavailable "(the connection failed)" | `unreadable` (connection failed) |
| 4411 | `lumen-opticians` | `agent-manifest.json` is not JSON (a comment, a trailing comma) | fail: "the agent-manifest.json is not valid JSON" | `absent` |

`fix-launch` removes the repeated `commondefs`: the gate then passes and `watch --url` says `warn grounding
dunmore_books.network.json: ... the agent now answers from different facts` (the lock is not rewritten). The harness scan
of all twelve (all adapters) summarised `gate: pass 0, fail 3, unavailable 9; lock: found 7, absent 3, unreadable 2;
drift: info 3, warn 3, block 1, not-checked 5; signature: published 3, absent 7, unknown 2` (taken after `fix-launch`;
Atlas and Customs were `unavailable` for every site, so no site is a gate `pass`). That scan predates the harness's
Atlas stand-in and sent the twelve loopback addresses to the public Agent Atlas; since the drain of run
2026-11-18-first-five the harness scan answers Atlas and Customs locally by default (`uat/env.md`). Re-run with the
stand-ins on 2026-11-18 (before `fix-launch`): `gate: pass 0, fail 4, unavailable 8`, as the live run gave.

## kiln-row (J5, Tomasz) - ports 4500 to 4505, Desk 4599

| Port | Site | What it is |
| --- | --- | --- |
| 4500 | `kiln-row` (repo) | the marketplace: network `kiln_row` links the four sellers by `link_labels` and `tools` |
| 4501 | `ashgrove-pottery` | seller, signed (`ashgrove-1`), will rotate properly |
| 4502 | `brackenfold-ceramics` | seller, signed (`brackenfold-1`), will change signer without a rotation |
| 4503 | `copperwick-glass` | seller, unsigned |
| 4504 | `dovetail-weaving` | seller, flaky |
| 4505 | `tidewater-studio` | the studio: A2A Agent Card at `/.well-known/agent-card.json` (the A2A sample card's shape, two skills, one JWS signature entry copied from the spec sample, which does not verify over this card) |

| Act | What it changes | Confirmed (harness watch, after a harness `--relock --external a2a-card=http://127.0.0.1:4505/.well-known/agent-card.json` captured the four sellers and the card; the CLI's `--relock --external` with that address exits 2) |
| --- | --- | --- |
| `onboarded` (by up) | two sellers signed; `init --root site --workflow` (all four sellers pending, exit 1) | |
| `seller-rotates` | rotation ashgrove-1 -> ashgrove-2, new record, signed with ashgrove-2 | `block peer ...ashgrove_studio: A peer is now signed by a different key than the one the lock recorded.`; `verify`: `unverifiable`; `adopt --yes`: adopted, then `verified` |
| `seller-signer-swapped` | brackenfold signed by `brackenfold-other`, no rotation | the same sentence as `seller-rotates` (Observed 3); `verify`: `unverifiable`; `adopt`: "plumbline-rotation.json not found" |
| `seller-offline` / `seller-back` | dovetail refuses / answers | `warn peer ...dovetail_loom: A peer could not be reached (the connection failed), so it was not checked.` / gone |
| `seller-back-changed` | dovetail comes back from an outage CHANGED: agent `deposit_taker` added (loom_keeper calls it) and signed for the first time with a new key `dovetail-new` (needs seller-offline; it brings the seller up). Added by the drain of run 2026-11-18-first-five, where Tomasz's walker had to construct it (TOM-L1-03) | harness relock pinning the four sellers, seller-offline, this act, harness watch (pin kept): `block peer ...dovetail_loom: ... In outline: agents: 1 added, 0 removed, 1 changed; outbound hosts: 0 added, 0 removed; front agent: unchanged.` and `info peer ...dovetail_loom: A peer that was unsigned when locked now publishes a signature; re-lock to record its key.` (after a relock while it was offline, the same return reads only the pending line: TOM-L1-03) |
| `card-skills-change` | skill `glaze-matcher` added, `commission-quote` changed | `block peer ...agent-card.json: An external A2A Agent Card changed ...; In outline: skills: 1 added, 0 removed, 1 changed; it carries 1 JWS signature, not verified here.` |
| `card-offline` / `card-back` | the studio refuses / answers (`card-back` is a world convenience) | `warn peer ...agent-card.json: An external agent definition could not be reached (the connection failed), so it was not checked.` |
| `seller-signs` | copperwick signs with `copperwick-1` | `info peer ...copperwick_glass: A peer that was unsigned when locked now publishes a signature; re-lock to record its key.` |

## Observed

Where an act could not produce what its journey assumes because of how the product works (not the fixture). Each act
was left doing the realistic thing.

1. **larch-house, `raise-price`: the watch does not see that €89 left the page.** The lock anchors 5 facts, not 7: the
   double (€89) and single (€69) prices are never anchored. `rooms.html` is a price table whose "Sleeps" column comes
   before the price cell; the page reduced to text reads `Double room  2  €89 per night`, and the money pattern (which
   accepts a number before or after the symbol) takes `2 €` as €2 and masks it, leaving `89` bare. Checked with the
   built `extractLiterals(reduceToText(...))`: the row gives `money:eur 2`; with the price cell first, or in prose
   ("sleeps 2: €89"), it gives `money:eur 89`. So after `raise-price` the watch says "all 5 facts the network states
   from it are still on it", the same sentence as after `cosmetic-edit`: J1's question whether the watch tells the two
   apart is answered by the product as "no" for this page layout.
2. **Peers and the Agent Card (J1, J2, J5) are invisible to the CLI in a world.** `init` and `watch --root` have no
   `--allow-local`; every loopback peer stays pending or "could not be reached (the address is not https)", whatever
   the act; `--external` refuses http; `watch --url` refuses non-https peers by design. The acts were confirmed through
   the harness only. In J1 every watch also carries the pending bike-rental peer's `warn`, so the watch never exits 0
   for Marta's site through the CLI.
3. **kiln-row: a proper rotation and a bare signer change read the same at the watch.** Both give `block ... A peer is
   now signed by a different key than the one the lock recorded.` The difference shows only at `verify` (the rotated
   seller's hint to `adopt`) and at `adopt` (which follows the rotation and refuses the swapped signer).
4. **northgate-clinic: until the pharmacy fetches the revocation, the key-A forgery verifies** when it is served at the
   clinic's address (checked with `verify --root <mirror> --origin <clinic origin>`), and `adopt` offers the attacker's
   rotation. The pharmacy learns the revocation only by verifying the clinic's own site (`verify` records it in the
   trust file); after that the forgery is `invalid revoked` and the rotation is refused.
5. **Observed 1 is a product defect, kept as the fixture on purpose.** The drain of run 2026-11-18-first-five recorded
   it as MAR-L2-01 (a blocker: on this realistic price table the watch tells the owner "all 5 facts ... are still on
   it" after the price changed) and it is `docs/BACKLOG.md` UAT-1. Do not "fix" the fixture to a price-first layout:
   recertifying UAT-1 means this unchanged page must read differently after `raise-price` and after `cosmetic-edit`.
