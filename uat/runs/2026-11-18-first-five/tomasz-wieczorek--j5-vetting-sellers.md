# Tomasz Wieczorek x j5-vetting-sellers - L1

Run `2026-11-18-first-five`. Walker: L1 (code-grounded, executed against a throwaway loopback world). Build: `npm run build`
on 2026-11-18 11:05 local, after HEAD `47ea482` (2026-11-18 10:30 +0100), so `dist/` was fresh.

## Verdict

**L1-conditional.** Structurally Tomasz can finish: one lock does hold the four sellers and the Agent Card
(`watch --relock --external`), every event of the week produces a finding, adopt follows a proper rotation, and the
watch never calls an unreachable seller clean on the day it is unreachable. But eight majors sit on exactly the
seams his job is about. The watch gives a proper rotation and a bare signer swap the same sentence. `--relock` is the
only way to accept anything, and it accepts everything at once: following seller A's rotation in the lock also blesses
seller B's swapped signer. A relock run while a seller is offline throws away that seller's pinned hash and kid. When
the seller comes back under a new key, it is re-added as "added peer" with no signer comparison. A relock run while
the Agent Card is offline drops the card from the lock. After that one line, every later watch exits 0 while the card
is still offline. "Unsigned" is not a state anywhere on his surfaces: the watch says nothing, the lock just has no
`kid`, and `verify` exits 2 with an I/O-style error. The `--json` output has no reason codes and no timestamp, so he
cannot build his inventory table without matching sentences. The documented-looking `watch --init --external` on an
existing lock exits 0 and does nothing (confirmed with the real CLI). The job completes only with workarounds:
hand-editing the lock, running `verify` per seller in text mode, keeping his own regexes and a side list of cards.

**Time.** In the journey's event week the review takes about **21 steps and ~28 min**. A quiet week (no events) takes
~4 steps and ~5 min. Against his declared 40 min/week that saves **~12 min in the event week (confidence: medium)** and
~35 min in a quiet week (low). A blended figure of **~20 min/week saved (low-medium)** falls short of his 30-minute
target. He would also keep a side check for unsigned sellers and dropped cards, which eats into the saving. The upside
if the majors were fixed (per-peer accept, rotation-aware finding, reason codes) is about the 30 min he declared.

## Surface model

### Reachability first (surface binding: CLI in CI and laptop, always `--json`; the lock file; the Desk's pre-load check)

How loopback peers can be reached, which decides what an L2 world can exercise:

| Path | Loopback seller `http://127.0.0.1:<port>/...` | Evidence |
| --- | --- | --- |
| `init`, `watch --root`, `watch --init`, `watch --relock` | **Not reachable.** Each peer becomes `pending` with "(the address is not https)". `--allow-local` is refused: "--allow-local goes with --url: a checkout is read from disk" (that sentence is wrong: a checkout watch fetches peers, cards and https sources over the network) | `src/cli/watch-command.ts:92`, `src/net/safe-fetch.ts:81`, run output below |
| `--external a2a-card=http://...` | **Refused**, exit 2: "--external takes an https address without credentials" | `src/watch/external.ts:141` |
| `watch --url <site> --allow-local` | Reads the site's lock on loopback, but every loopback peer and card in it is "not contacted: it is not an https address" (warn, never clean) | `src/watch/published.ts:146-147,208-209`, `src/watch/decide.ts:436-448` |
| `verify / trust / adopt --url ... --allow-local` | **Reachable** | `src/cli/commands.ts:458-472`, `src/cli/trust-command.ts:68-83` |
| Library `runWatch / runRelock` with `deps.fetchOptions.allowLocal` | **Reachable** (the injection the tests use) | `src/watch/lock.ts:15-18` |

So the watch events below were played through a 40-line harness. It calls `dist/watch/index.js` `runWatch` and
`runRelock` unchanged, with `fetchOptions: { allowLocal: true }`, and prints exactly as `printReport` and the relock
printer do (`src/cli/watch-command.ts:106-147`). Everything that has a CLI path on loopback (`init`, `watch --init`,
`watch --url`, `keygen`, `sign`, `rotate`, `trust`, `verify`, `adopt`) was run through the real CLI. The Desk's
pre-load check ran as `dist/browser/preload.js` (the module `build-site.mjs` copies to the Desk) over a fetcher that
maps `https://seller-x.example/` onto the loopback sellers, so peer addresses pass the public-host rule.

### Affordances

| Affordance | Code | Reachable for Tomasz |
| --- | --- | --- |
| `plumbline init [--root] [--source]... [--workflow] [--json]`. No `--external`. JSON `{lock, lockFile, counts:{grounding,runtime,peers,pending}, findings, next}`: no `external` count. Says "wrote" or "kept"; with an existing lock it turns each `--source` into an honest info line, "Not added" | `src/cli/init-command.ts:69,121-150,132-136` | yes (https sellers) |
| `watch --init [--external a2a-card=<https>]... [--source]...`. With a lock present it silently runs a plain watch and ignores both flags. The output never says written or kept, and the JSON has no `lockState` on the write branch | `src/watch/index.ts:58-67`, `src/cli/watch-command.ts:128-135` | yes |
| `watch --relock [--external]... [--drop <ref or card url>]... [--source]... [--json]`. JSON `{relocked, previous, changes:{added,removed,changed}, findings, reminder}`. Exit 0 whenever it writes, even with warn findings | `src/watch/index.ts:98-121`, `src/cli/watch-command.ts:106-126` | yes |
| `watch [--root] [--json]`. JSON is `DriftReport {findings[], lockState?, lockSummary?}`. A finding is `{kind, severity, ref, expected?, actual?, summary}`. No code, no timestamp. Exit 0 when only info, 1 on warn or block or any lock state but found | `src/core/types.ts:316-338`, `src/cli/watch-command.ts:139-147` | yes |
| `watch --url <site> [--allow-local] [--json]`, the published reader | `src/watch/index.ts:148-163`, `src/watch/published.ts:161-215` | yes |
| The lock: `peers[url] {sha256, links, kid?, outline?, checkedAt}`, `pendingPeers[url] {since}`, `external[url] {kind, sha256, parts?, checkedAt}`. "Unsigned" is only the absence of `kid`. Card signatures are not recorded | `src/core/types.ts:193-250`, `src/watch/capture.ts:148-156,172-185` | yes (he reads it) |
| `verify --trust (--root/--url) [--json]`. JSON `{results:[{verdict,reason?,kid?,origin?,detail?}], revocation?}`. The rotation **hint is text-only** | `src/cli/commands.ts:487-632` (hint `:621-627`, JSON `:630`) | yes |
| `adopt --trust --url [--yes] [--json]`. No rotation file means exit 2 ("not found"). JSON lists `adopted` even when `added:false` | `src/cli/trust-command.ts:222-311` (`:242`, `:306`) | yes |
| `trust --key/--url --file [--yes]` | `src/cli/trust-command.ts:122-195` | yes |
| The Desk's pre-load check `checkPeerBeforeLoad`. On the Desk it runs **only over `PARTNERS`** (Agent Atlas, Agent Customs) and the Desk's own lock. `lockFindings` is computed and then dropped | `site/desk.js:60,1304-1341`, `src/browser/preload.ts:151-189` | **no** for Kiln Row sellers (a library he could embed; no documented export, no runtime hook: accepted gap) |
| The Desk `#/verify` of an unsigned site reads `unverifiable` "publishes no plumbline.signature.json" | `site/desk.js:687`, `site/strings.js:135` | outside his binding; cited only as the reconciliation contrast |

**Wiring audit (computed for a user surface, shown by none):**

- The `verify` rotation hint is pushed to `lines` only, so `--json` drops it (`src/cli/commands.ts:626,630`). It is the
  one signal that tells a rotation from a swap at `verify`.
- `PreloadCheck.lockFindings` is computed (`src/browser/preload.ts:177`) and dropped by `site/desk.js:1328-1336`: grep
  finds 0 uses in `site/*.js`. The partner list says `differs` but not whether the definition, `links.json` or the
  signer moved.
- Card JWS signatures are counted (`src/watch/external.ts:65`), but the count reaches a sentence only when the card
  changed (`:120`) and is never written to the lock.
- `checkedAt` is written per peer and card, but no report carries when the watch itself ran.

### Finding vocabulary (every branch of every finding-producing function)

The set is **closed in the code**: every sentence is a template. On the wire it is **open**. There is no code field,
and summaries interpolate HTTP statuses, fetch-error phrases (`describeFetchError`), counts, dates and kids'
neighbours, so a consumer has to match prefixes. `kind` has three values for about 50 situations.

| # | Function (file:line) | kind / severity | Sentence template (variable parts in braces) |
| --- | --- | --- | --- |
| G1 | `groundingFinding` decide.ts:114-116 | grounding / warn | A grounding source could not be checked: it {sentence}. |
| G2 | decide.ts:121-122 | grounding / warn | A grounding source changed since the lock was written; the agent now answers from different facts. |
| G3 | decide.ts:123-124 (anchors problem) | grounding / warn | ...; its {N facts} the network states could not be checked: it {problem}. |
| G4 | decide.ts:125-126 | grounding / warn | ...; all {N facts} the network states from it are still on it. |
| G5 | decide.ts:127 | grounding / warn | ...; {K} of {N facts} the network states are no longer on it, so the network may now state an old fact. |
| R1 | `runtimeFinding` decide.ts:138-139 | runtime / block | A vendored runtime file is missing where the lock says (...) |
| R2 | decide.ts:140 | runtime / block | A vendored runtime file could not be checked: it {sentence}. |
| R3 | decide.ts:150 | runtime / block | A vendored runtime file differs from the locked copy; ... |
| R4 | `addedRuntimeFinding` decide.ts:179 | runtime / block | A file was added to the vendored runtime folder after the lock was written; ... |
| U1-U4 | `detectUpstream` detectors.ts:135,147,151,163,175 | runtime / info | Could not check upstream: {reason}. / Upstream is ahead: ... / The lock records no runtime commit, ... |
| P1 | `peerFindings` decide.ts:227 | peer / warn | A peer's network file was not contacted: {refused}, which a peer's manifest may not point a browser at. |
| P2 | decide.ts:237 | peer / warn | A peer's network definition answered HTTP {status}, so it was not checked. |
| P3 | decide.ts:238 | peer / warn | A peer could not be reached ({reason}), so it was not checked. |
| P4 | decide.ts:250 + `whatChanged` :306-314 | peer / block | A peer's network definition changed since the lock was written; ... + one of: no outline in lock / cannot be outlined now / "Formatting or non-agent content only" / "In outline: agents: a added, r removed, c changed; outbound hosts: a added, r removed; front agent: {changed or unchanged}" (outline.ts:141-147) |
| P5 | decide.ts:260 | peer / warn | The lock does not record this peer's links.json, ...; re-lock to track it. |
| P6 | decide.ts:264 | peer / warn | A peer's links.json could not be checked: it {problem}. |
| P7/P8/P9 | decide.ts:274-278 | peer / block | links.json appeared / is gone / changed |
| **P10** | decide.ts:286 | peer / block | **A peer is now signed by a different key than the one the lock recorded.** (expected = old kid, actual = new kid) |
| P11 | decide.ts:288 | peer / info | A peer that was unsigned when locked now publishes a signature; re-lock to record its key. |
| P12 | decide.ts:296 | peer / warn | A peer that was signed when locked no longer shows a usable signature ({problem} or "none is published"). |
| (none) | decide.ts:283-298 | n/a | **Unsigned when locked and still unsigned: no finding at all** |
| **P13** | `pendingPeerFindings` decide.ts:327 | peer / warn | A peer could not be captured when the lock was written (pending since {date}), so it is not watched; run watch --relock once it answers. |
| P14 | `refusedPeerFinding` decide.ts:447 | peer / warn | A peer in this lock was not contacted: {problem}, which a published lock may not point a browser at. |
| C1/C2 | `coverageFindings` decide.ts:343,347 | grounding or peer / warn | A file the site names is not in the lock ... / A network names a peer the lock does not cover ... |
| S1/S2/S3 | `signatureExpiryFinding` decide.ts:373,382,392 | grounding / warn, block, warn | no readable expiry / expired on {date} / expires on {date}, in {n} days |
| S4/S5 | detectors.ts:212, index.ts:172,176 | grounding / warn | The site's signature file could not be read to check its expiry: ... |
| E1 | `externalFinding` external.ts:99 | peer / warn | An external entry of a kind this build does not read (an MCP tool list ...) was not checked. |
| E2 | external.ts:102 | peer / warn | An external agent definition in this lock was not contacted: {refused}, ... |
| E3/E4 | external.ts:110-111 | peer / warn | An external agent definition answered HTTP {status} / could not be reached ({reason}), so it was not checked. |
| E5 | external.ts:128 + :116-121 | peer / block | An external A2A Agent Card changed since the lock was written; ... + not a card now / no outline in lock / "In outline: skills: a added, r removed, c changed; it carries {n} JWS signature(s), not verified here" or "; it carries no signature" |
| K1-K10 | capture.ts:66,73,88,99-104,123,132,138,166,177,181; index.ts:117; discover.ts:62-66,78 | various | Capture-time sentences (no runtime folder; could not lock; dropped but still named; **peer pending (`{detail}`)**; **external could not be locked, "so it is not in the lock"**; not a card; nothing to drop; unsafe hocon; network not JSON) |
| X1 | `NOT_CHECKED_FROM_URL` index.ts:130-131 | grounding / info | Not checked from a published site: ... |

`anchors.ts` and `outline.ts` produce no findings of their own. They only fill G3-G5 and P4's detail, through
`groundingFindingWithAnchors` (anchors.ts:224-228) and `whatChanged`.

**Collisions (two situations, one sentence):**

- (a) A proper rotation and a bare signer swap both give **P10** (executed, identical JSON apart from the kids).
- (b) "Never captured at init" and "was pinned, then lost its pin to a relock run while it was offline" both give
  **P13**, and `since` becomes the relock's date.
- (c) "Unsigned", "signature file errored at capture" and "kid not in the exact pattern" are all recorded as a missing
  `kid` and produce no finding (capture.ts:150-153, decide.ts:193-206).
- (d) A card and a seller both have `kind: "peer"`.

**One situation, two sentences:** an unreachable peer is P2 or P3 depending on whether an HTTP answer came back, and
P3's parentheses vary with the fetch-error code (`describeFetchError`). A changed definition under a new signer gives
P4 plus P10 for one peer, which is fair: two facts.

**Branches audited and clean:** P1, P5-P9, P11, P12, P14, E1-E4 (each distinct and never green). G1-G5, R1-R4 and
S1-S5 are not on this journey's path; they read clean.

## Walkthrough

World (built in an OS temp folder, now removed): marketplace `:4590` (`kiln_row.network.json` naming four seller
network addresses), seller A `:4591` signed with key a1, B `:4592` signed with b1, C `:4593` unsigned, D `:4594` signed
with d1, and an A2A card at `:4595/.well-known/agent-card.json` with skills `catalog` and `commission`. Tomasz's trust
file holds a1, b1 and d1 (`trust --key ... --yes`, exit 0 each).

**Act `onboarded`: the existing lock.** `init` through the harness writes four peers. Seller C's record has no `kid`
and nothing says so. The first watch prints only the upstream info and exits 0.
- Q1/Q2 (will he try, will he see it): yes. Q4: "watch: no drift" hides that C is unsigned. His "unsigned" column has
  to be inferred from a missing key in JSON he is reading by hand.

**Add the card to the lock he already has.** He reads `docs/gate-and-watch.md:264`: "`plumbline watch --init` (or
`--relock`) `--external a2a-card=<https url>`". `--init` is named first, so he tries it. Real CLI, on a checkout that
already holds a lock:

```
$ plumbline watch --root probe2 --init --external a2a-card=https://card.example/.well-known/agent-card.json --source https://example.org/prices.html
info  runtime cognizant-ai-lab/nsdeploy: The lock records no runtime commit, so upstream cannot be compared; the newest upstream commit is b12a120.
exit 0
```

The lock's SHA-256 was the same before and after (`10d3ec1d...`), and `--json` returns
`{"lockState":"found","findings":[...]}`. Nothing says the flags were ignored. Q4 fails outright: exit 0, nothing done
(`src/watch/index.ts:58-70`). Compare `init`, which on the same situation prints "Not added: a lock was already
there..." (`src/cli/init-command.ts:134-136`). He finds out only by diffing the lock, or not at all. The right command
is `--relock --external`:

```
relock: wrote plumbline.lock.json (the previous lock was found)
added   external http://127.0.0.1:4595/.well-known/agent-card.json
plumbline.lock.json is a signed file: sign the site again (plumbline sign) and commit both, ...
```

Clear, and it lists the card. Q4 passes for the relock.

**Act `card-skills-change`.**

```
"kind": "peer", "severity": "block", "ref": "http://127.0.0.1:4595/.well-known/agent-card.json",
"summary": "An external A2A Agent Card changed since the lock was written; a client that reads it now gets different skills or endpoints. In outline: skills: 1 added, 0 removed, 1 changed; it carries no signature."
```

Good: counts in a clear unit ("skills") and no stranger's words. But `kind` is `peer`, so his dashboard tells card
from seller by the summary's first words.

**Acts `seller-rotates` (A: `rotate` a1 to a2, publish the key record, re-sign) and `seller-signer-swapped` (B:
re-signed with b2, no rotation).**

```
block peer http://127.0.0.1:4591/seller_a: A peer is now signed by a different key than the one the lock recorded.
block peer http://127.0.0.1:4592/seller_b: A peer is now signed by a different key than the one the lock recorded.
```

This is his top pet peeve: two situations, one message. Q3 (connect the action): the watch names no next step that
would tell them apart. He has to know to run `verify` per seller, in text mode:

```
$ verify --url http://127.0.0.1:4591/ --allow-local --trust trust.json
hint: plumbline-rotation.json is present; if you trust a key it rotates from, check it with plumbline adopt --url http://127.0.0.1:4591/ ...
unverifiable kid=6c3a9e96191d90f6 ... The signature is internally consistent but the signer is unknown ...
$ verify --url http://127.0.0.1:4592/ ...
unverifiable kid=79aec2420f599883 ... (no hint)
```

With `--json`, which is how he always runs it, both are
`{"results":[{"verdict":"unverifiable","kid":"...","origin":"...","detail":"The signature is internally consistent but the signer is unknown: ..."}]}`.
The hint is gone. Then `adopt`:

```
A: rotation 68c8034e36eb861d -> 6c3a9e96191d90f6 ... verified ... nothing adopted: ... rerun with --yes   (exit 1)
   --json: {..., "added":false, "alreadyTrusted":false, "adopted":["6c3a9e96191d90f6"]}
B: plumbline adopt: plumbline-rotation.json not found in http://127.0.0.1:4592/   (exit 2; --json {"error":...})
```

`adopt --yes` for A leads to `verify` saying `verified` (exit 0). The adopt itself is excellent: it walks the chain,
names the trusted key and needs `--yes`. But a JSON consumer sees a field named `adopted` holding a kid that was not
adopted. And seller B, the one case that matters for policy, comes back as exit 2, the code for "usage or I/O error".

After adopt the watch **still blocks A and B**: adopt writes the trust file, the watch reads the lock. To follow A in
the lock he runs `--relock`, the only accept there is:

```
relock: wrote plumbline.lock.json (the previous lock was found)
changed peer http://127.0.0.1:4591/seller_a
changed peer http://127.0.0.1:4592/seller_b
$ watch  ->  info only, exit 0
```

**B's swapped signer is now the pinned signer.** The relock output gives the change as "changed peer", with no word
that a signer changed and no reference to the trust file. From here CI is green. Only a manual `verify` of B still
says `unverifiable`. Q4 fails badly: the progress he sees ("changed peer") does not say he just accepted an unknown
key.

**Acts `seller-offline` and `seller-back` (D), with a relock in between.** Offline gives
`warn ... A peer could not be reached (the connection failed), so it was not checked.` (exit 1). Correct and never
green. Then a routine relock that week (to accept something else) runs while D is down:

```
added   pending http://127.0.0.1:4594/seller_d
removed peer http://127.0.0.1:4594/seller_d
warn  peer ...seller_d: A peer could not be captured, so the lock holds it as pending and every watch reports it (the connection failed).
```

The lock now holds `pendingPeers.seller_d = {since}` and **nothing else**: D's pinned hash, kid d1 and outline are
gone. D comes back signed by a new key d2. The watch says only P13 ("could not be captured when the lock was
written ... run watch --relock once it answers"); it does not say D answers again. He follows the instruction:

```
added   peer http://127.0.0.1:4594/seller_d
removed pending http://127.0.0.1:4594/seller_d
$ watch -> exit 0
```

A seller that came back under a new signer was accepted, by following the product's own advice, with no P10. The
journey asks: kept, pending, or dropped? A peer is **kept as pending, but its pin is dropped**.

**Act `card-offline`, with a relock in between.** Offline gives
`warn ... An external agent definition could not be reached (the connection failed), so it was not checked.` A relock
while it is down:

```
removed external http://127.0.0.1:4595/.well-known/agent-card.json
warn  peer ...agent-card.json: An external agent definition could not be locked (the connection failed), so it is not in the lock.
(relock exit 0)
$ watch (card still offline) -> info only, exit 0
$ relock (card back)         -> no ref changed; still no "external" in the lock
```

There is one warn line, at relock time, inside an exit-0 command. After that the card is **dropped for good** and an
offline card reads clean. Peers go to `pending`; cards vanish. The same event gets two policies depending on the
protocol. That is his pet peeve "a lock that quietly drops an entry", made worse because coverage (decide.ts:337-350)
does not know cards exist.

**Act `seller-signs` (C signs with c1).**

```
info  peer http://127.0.0.1:4593/seller_c: A peer that was unsigned when locked now publishes a signature; re-lock to record its key.   (exit 0)
```

Distinct and stable, which is good. It is `info`, so CI stays green, and the advice is to re-lock, which records
whatever key showed up. Nothing points at `trust` first.

**Probe: signature file errors at capture.** With B's `plumbline.signature.json` answering HTTP 500 during `--init`,
B's lock record had the keys `['sha256','links','outline','checkedAt']`: no `kid`, and **no finding**. A signed seller
locked during a hiccup becomes "unsigned" in the lock, and the signer check drops to P11 info.

**Unsigned at every surface he reads:**
- watch: nothing.
- lock: no `kid`.
- `verify --url` (real CLI): `plumbline verify: plumbline.signature.json not found in http://127.0.0.1:4593/`, exit 2,
  `{"error":"..."}` (`src/cli/commands.ts:532`; documented at `docs/signature-format.md:513`).
- Pre-load check (`dist/browser/preload.js`):
  `{"verdict":"unverifiable","signed":false,"refuse":false,"detail":"The peer publishes no signature, so who published its definition cannot be told."}`.
  This is right, but the Desk runs it only for its own two partners (`site/desk.js:1314`).
- Desk `#/verify` for comparison: `unverifiable` (`site/desk.js:687`).

Two surfaces say `unverifiable`, one says I/O error, one says nothing.

**`watch --url` on Kiln Row's published lock (real CLI, `--allow-local`):** five warns, "not contacted: it is not an
https address", plus the X1 "Not checked from a published site" info, exit 1. Honest: refused is not clean.

## Scored criteria

| # | Criterion | Result | Evidence |
| --- | --- | --- | --- |
| 1 | One lock records every seller peer and the A2A Agent Card, and the command that adds each is documented | **pass** | `--relock --external` gave `added external ...` and the lock held four `peers` plus one `external` (run). Documented at `docs/gate-and-watch.md:264-271`, usage line `src/cli/watch-command.ts:22`. (README's quick start never mentions `--external`; the documented `--init` form is criterion 2's failure) |
| 2 | Adding the card to a site that already has a lock works or refuses with a reason; never exit 0 having done nothing | **fail** | Real CLI: `watch --init --external a2a-card=https://...` gave exit 0 with the lock hash unchanged; `--source` was ignored too. `src/watch/index.ts:58-70`, `src/cli/watch-command.ts:128-135` |
| 3 | Changed, unreachable, pending, signer-changed and unsigned each produce a distinct, stable finding | **fail** | Unsigned produces no finding (`decide.ts:283-298`). Rotation and swap share P10 (`decide.ts:286`). Pending-from-init and pin-lost-to-relock share P13 (`decide.ts:327`). Unreachable splits into P2 and P3 with variable text |
| 4 | An unreachable seller is never reported as clean, and is never dropped from the lock without a line saying so | **fail** | Peers pass (warn; pending on relock, with a line). The card fails: after a relock while offline it is removed (`capture.ts:175-178`), and every later watch while it is still offline exits 0 (run). The drop also takes D's pin with it (`capture.ts:158-166`) |
| 5 | A properly rotated seller can be followed with `adopt`; a seller whose signer just changed is a `block` | **fail** | `adopt` follows A in the trust file (pass in isolation), and B is P10 `block` until the relock. But the watch keeps blocking A until `--relock`, and that relock also accepts B (run: "changed peer ...seller_b", then exit 0). No per-peer accept exists (`src/watch/index.ts:98-121`) |
| 6 | An unsigned seller reads `unverifiable` wherever a verdict is shown, including the Desk's pre-load check | **fail** | Pre-load: `unverifiable` (`preload.ts:82`), but partner-only on the Desk (`desk.js:1314`). `verify`: exit 2 error (`commands.ts:532`). Watch: silent |
| 7 | The `--json` of each command has documented fields and is enough to build the inventory table | **fail** | No reason code (`types.ts:316-323`). `expected`/`actual` change meaning (hash, kid, date). No watch timestamp. The verify hint is not in JSON (`commands.ts:630`). `adopt` JSON says `adopted` when `added:false` (`trust-command.ts:306`). `watch --init --json` has no `lockState`, against `docs/gate-and-watch.md:94`. The plain watch JSON shape is given only in prose and `types.ts` |
| 8 | The weekly review of all sellers takes under 10 minutes | **fail** | ~28 min estimated for the event week (21 steps: verify x2 in text mode, adopt x2, relock, re-sign, commit, a hand-diff of the card, trust for C, and the workaround to keep B blocked). A quiet week is about 5 min |

**Score: 1 of 8 passed.**

## Findings

Severity is derived from impact rank (low=1, med=2, high=3; rank = f x r x t): `major` when rank >= 18, or when
trust_erosion is high and rank >= 9; `minor` for 4-17; `polish` for <= 3.

```json
[
  {
    "id": "TOM-L1-01",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Accepting one seller's proper rotation with --relock also blesses another seller's swapped signer",
    "expected": "A seller that rotated properly (adopt verified) can be accepted in the lock on its own; a seller whose signer changed without a rotation stays block.",
    "got": "--relock is the only accept and it re-captures every peer: after adopt --yes for seller A, relock printed 'changed peer ...seller_a' and 'changed peer ...seller_b' (no word about signers), and the next watch exited 0 with B pinned to its unknown key b2. Relock never consults the trust file.",
    "evidence": ["src/watch/index.ts:98-121", "src/watch/capture.ts:144-156", "src/watch/decide.ts:474-478", "src/cli/watch-command.ts:116-123"],
    "code_check": "present-broken",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "In the kiln-row world play seller-rotates and seller-signer-swapped, adopt A with the real CLI, relock with the world's driver, and confirm the watch is green while verify of B is unverifiable. Precondition: the world must make loopback peers reachable to the checkout watch (the CLI cannot; see TOM-L1-11), or serve sellers on https."
  },
  {
    "id": "TOM-L1-02",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "clarity",
    "title": "A proper key rotation and a bare signer swap produce the identical watch finding, and verify's only distinguishing line is text-only",
    "expected": "The watch says whether the new kid is named by a rotation the peer publishes (or the trust file now holds it), so rotation and swap read differently; verify --json carries the rotation hint.",
    "got": "Both are 'block peer <url>: A peer is now signed by a different key than the one the lock recorded.' with expected/actual kids. verify --json for A and B is the same shape and detail; the 'hint: plumbline-rotation.json is present' line exists only in text output.",
    "evidence": ["src/watch/decide.ts:283-286", "src/watch/observe.ts:67-76", "src/cli/commands.ts:621-630"],
    "code_check": "present-but-missed",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Confirm both P10 sentences and both verify --json bodies on the live world after seller-rotates and seller-signer-swapped. Precondition: as TOM-L1-01."
  },
  {
    "id": "TOM-L1-03",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "A relock run while a seller is offline discards its pinned hash, kid and outline; it returns under a new signer as 'added peer' with no signer check",
    "expected": "A pinned peer that cannot be re-captured keeps its previous record (or the relock refuses it), and on return the new state is compared with the old pin.",
    "got": "Relock while D was down: 'added pending ...seller_d / removed peer ...seller_d'; the lock held only {since}. D returned signed by d2; the watch said only the pending sentence (which does not say D answers again, and dates 'since' to the relock), and the relock it recommends printed 'added peer ...seller_d', then exit 0. The same pending sentence serves a peer never captured at init.",
    "evidence": ["src/watch/capture.ts:144-167", "src/watch/decide.ts:317-330", "src/watch/index.ts:98-121"],
    "code_check": "present-broken",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Play seller-offline, relock, re-key the flaky seller, seller-back, relock; confirm the lock diff and the absence of a signer finding. Precondition: as TOM-L1-01."
  },
  {
    "id": "TOM-L1-04",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "completion",
    "title": "An Agent Card offline during a relock is dropped from the lock for good, and later watches read clean while it is still offline",
    "expected": "The card is kept (pending, like a peer) and reported on every watch until it is captured or dropped on purpose with --drop.",
    "got": "Relock printed 'removed external <card>' and one warn ('so it is not in the lock') inside an exit-0 command; the next watch with the card still offline exited 0; a later relock with the card back printed 'no ref changed' and did not restore it. Coverage does not know cards, so nothing ever mentions it again.",
    "evidence": ["src/watch/capture.ts:169-185", "src/watch/index.ts:106-108", "src/watch/decide.ts:337-350", "docs/gate-and-watch.md:268-270"],
    "code_check": "present-broken",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Play card-offline, relock, watch (expect exit 0), card back, relock (expect no external). Precondition: the card on https or the world driver's allowLocal path; the CLI refuses an http --external."
  },
  {
    "id": "TOM-L1-05",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "broken-flow",
    "severity": "major",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "watch --init --external (and --source) on an existing lock exits 0 having done nothing, and watch --init never says whether it wrote or kept the lock",
    "expected": "Either the card is added, or a refusal names --relock (as init does for --source: 'Not added: a lock was already there').",
    "got": "Real CLI: lock SHA-256 unchanged, exit 0, output was a plain watch. On a fresh folder, watch --init --json printed {findings} only, with no 'wrote' and no lockState. The docs name --init first for adding a card.",
    "evidence": ["src/watch/index.ts:58-70", "src/cli/watch-command.ts:103,128-135", "src/cli/init-command.ts:132-136", "docs/gate-and-watch.md:94", "docs/gate-and-watch.md:264"],
    "code_check": "present-broken",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Re-run the exact command on the kiln-row marketplace checkout and compare lock bytes; no precondition (the CLI ignores the flag before any fetch). Matches the accepted-gaps 'Known defects' hypothesis: confirmed."
  },
  {
    "id": "TOM-L1-06",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "'Unsigned' is not a state: the watch is silent, the lock has only an absent kid, and verify exits 2 with an I/O error while the Desk and the pre-load check say unverifiable",
    "expected": "An unsigned seller reads unverifiable (or an explicit 'unsigned' state) on every surface, with one exit-code meaning.",
    "got": "watch: no finding. Lock: no kid (also written when the signature file errored or the kid was malformed). verify --url: 'plumbline.signature.json not found', exit 2, {\"error\":...}. Pre-load: unverifiable, 'The peer publishes no signature'. Desk #/verify: unverifiable.",
    "evidence": ["src/watch/decide.ts:283-298", "src/watch/capture.ts:150-153", "src/cli/commands.ts:531-533", "src/browser/preload.ts:82", "site/desk.js:687", "docs/signature-format.md:513"],
    "code_check": "by-design",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Run verify --url --json against the unsigned seller and the Desk #/verify against the same address; record both. Reconciliation item across CLI and Desk. No precondition for verify (works with --allow-local)."
  },
  {
    "id": "TOM-L1-07",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "senior-quality",
    "title": "Drift JSON has no reason code, no timestamp and polymorphic expected/actual, so an inventory needs sentence-matching",
    "expected": "Each finding carries a code from a closed, documented list (e.g. peer.signer-changed, peer.unreachable, peer.pending, external.changed); the report carries checkedAt; card and peer are told apart by a field.",
    "got": "{kind, severity, ref, expected?, actual?, summary}: three kinds for about 50 situations, summaries interpolating HTTP status, fetch-error text, counts and dates; expected/actual hold hashes, kids or a date depending on the branch; cards are kind 'peer'; no time the watch ran. The plain watch JSON shape is given only in prose and types.ts.",
    "evidence": ["src/core/types.ts:316-338", "src/watch/external.ts:96-130", "src/watch/decide.ts:224-300", "docs/gate-and-watch.md:94-99"],
    "code_check": "confirmed-absent",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Collect the watch --json bodies of every act and attempt the five-column inventory mechanically; count the columns that need a regex. No precondition."
  },
  {
    "id": "TOM-L1-08",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "A signed seller whose signature file errors during init or relock is silently locked as unsigned",
    "expected": "A signature that could not be read at capture is a finding, and the peer is pending (or keeps its previous kid), as an unreadable links.json already makes it.",
    "got": "With seller B's plumbline.signature.json answering HTTP 500 during --init, B's record was {sha256, links, outline, checkedAt}: no kid and no finding. The signer check then drops to info ('newly signed') when it reappears.",
    "evidence": ["src/watch/capture.ts:147-156", "src/watch/decide.ts:193-206", "src/watch/decide.ts:287-288"],
    "code_check": "present-broken",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "The world needs an act that makes a seller's signature file answer 5xx during a relock; confirm the lock loses the kid with no line. Precondition: a world-local server toggle for a 500."
  },
  {
    "id": "TOM-L1-09",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "adopt on a seller that published no rotation exits 2 (usage or I/O error), the most important policy signal in the journey",
    "expected": "'No rotation published: this signer change is not a rotation' as a verdict, exit 1, with a JSON field.",
    "got": "'plumbline adopt: plumbline-rotation.json not found in http://127.0.0.1:4592/', exit 2, {\"error\":...}; CI reads it as a broken step.",
    "evidence": ["src/cli/trust-command.ts:86-91", "src/cli/trust-command.ts:242"],
    "code_check": "by-design",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Run adopt --url --json on the swapped seller; no precondition."
  },
  {
    "id": "TOM-L1-10",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "adopt --json without --yes lists the successor under 'adopted' although nothing was adopted",
    "expected": "'adopted' only when added is true; a separate field (e.g. 'successors') for what would be added.",
    "got": "{\"added\":false,\"alreadyTrusted\":false,\"adopted\":[\"6c3a9e96191d90f6\"]} with exit 1.",
    "evidence": ["src/cli/trust-command.ts:276-306", "docs/signature-format.md:498"],
    "code_check": "present-broken",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Run adopt --url --json without --yes on the rotated seller; no precondition."
  },
  {
    "id": "TOM-L1-11",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "The checkout watch cannot be rehearsed against loopback sellers, and its refusal sentence says the checkout is read from disk when it also fetches peers",
    "expected": "A local rehearsal path for staging sellers (as gate, verify, trust and adopt have), or a refusal that names why peers are https-only.",
    "got": "init/watch --root put every loopback seller in pending '(the address is not https)'; '--allow-local goes with --url: a checkout is read from disk'; --external refuses http. watch --url --allow-local refuses each loopback peer.",
    "evidence": ["src/cli/watch-command.ts:92", "src/watch/external.ts:141", "src/net/safe-fetch.ts:81", "src/watch/lock.ts:15-18"],
    "code_check": "by-design",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Decides how the kiln-row world can be driven at all: check whether uat/driver/world.mjs reaches peers through the library's allowLocal injection or https fixtures, and record which; the CLI path cannot."
  },
  {
    "id": "TOM-L1-12",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "low", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "The pre-load check his shoppers' browsers would rely on runs on the Desk only for its own two partners; its lockFindings are computed and never shown",
    "expected": "A documented way to run checkPeerBeforeLoad over a site's own peers (a CLI command or a documented module export), and the Desk showing what differs.",
    "got": "site/desk.js checks PARTNERS (Agent Atlas, Agent Customs) only; package.json has no exports map documenting dist/browser/preload.js; desk.js drops lockFindings. Runtime hook absence is an accepted gap (ceiling).",
    "evidence": ["site/desk.js:60", "site/desk.js:1314-1336", "src/browser/preload.ts:151-189", "package.json:22-24"],
    "code_check": "confirmed-absent",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Open the Desk partner check and confirm there is no address input; no precondition."
  },
  {
    "id": "TOM-L1-13",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "missing",
    "title": "The card's signer column is always empty: JWS signatures are counted only in the 'changed' sentence and never written to the lock",
    "expected": "The lock records the card's signature count (or signer key ids) so 'signed / unsigned' is a column for the card too.",
    "got": "external[url] = {kind, sha256, parts, checkedAt}; 'it carries no signature' appears only when the card changed.",
    "evidence": ["src/core/types.ts:212-222", "src/watch/external.ts:65,120", "src/watch/capture.ts:184"],
    "code_check": "confirmed-absent",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Read the kiln-row lock's external entry; no precondition."
  },
  {
    "id": "TOM-L1-14",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "polish",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "Doc drift: the relock change labels omit 'external', and 'every report carries lockState' does not hold for watch --init",
    "expected": "docs/gate-and-watch.md:295 and decide.ts:459-460 list the 'external' label the code emits; the --init report carries lockState or the doc says it does not.",
    "got": "Relock printed 'added external <url>' and 'removed external <url>'; watch --init --json printed {findings} only.",
    "evidence": ["docs/gate-and-watch.md:94", "docs/gate-and-watch.md:295", "src/watch/decide.ts:459-460,479-480", "src/watch/index.ts:66"],
    "code_check": "present-but-missed",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "None beyond reading; no precondition."
  },
  {
    "id": "TOM-L1-S1",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "strength": true,
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "Unreachable and refused are never green on the day they happen",
    "expected": "An unreachable seller or card is not clean.",
    "got": "warn 'A peer could not be reached (the connection failed), so it was not checked.' and 'An external agent definition could not be reached ...', exit 1; watch --url refuses loopback peers as 'not contacted', exit 1, plus an info naming what a published read cannot check.",
    "evidence": ["src/watch/decide.ts:229-241", "src/watch/external.ts:101-112", "src/watch/published.ts:146-147", "src/watch/index.ts:130-131"],
    "code_check": "n-a",
    "verdict": "uncertain",
    "resolution": "n-a",
    "l2_priority": "Guardrail: any fix to TOM-L1-03/04 must keep this."
  },
  {
    "id": "TOM-L1-S2",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "strength": true,
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "senior-quality",
    "title": "A changed Agent Card is counted per skill in a stated unit, without quoting the stranger",
    "expected": "What changed, in counts with units.",
    "got": "'In outline: skills: 1 added, 0 removed, 1 changed; it carries no signature.' Seller outlines likewise count agents, outbound hosts and the front agent.",
    "evidence": ["src/watch/external.ts:88-93,116-121", "src/watch/outline.ts:141-147"],
    "code_check": "n-a",
    "verdict": "uncertain",
    "resolution": "n-a",
    "l2_priority": "Guardrail."
  },
  {
    "id": "TOM-L1-S3",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "strength": true,
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "adopt follows a rotation only through a key already trusted, names each hop, and needs --yes; verify's text hint names the exact adopt command",
    "expected": "Following a rotation is the verifier's decision, never automatic.",
    "got": "'rotation 68c8034e36eb861d -> 6c3a9e96191d90f6 ... verified ... nothing adopted: adopting a successor is your decision; rerun with --yes'; verify then 'verified'. The hint 'plumbline adopt --url http://127.0.0.1:4591/ --trust ... --allow-local'.",
    "evidence": ["src/cli/trust-command.ts:260-291", "src/cli/commands.ts:621-627"],
    "code_check": "n-a",
    "verdict": "uncertain",
    "resolution": "n-a",
    "l2_priority": "Guardrail."
  },
  {
    "id": "TOM-L1-S4",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "strength": true,
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "The relock prints every changed ref, including removals, with the re-sign reminder",
    "expected": "Nothing leaves the lock without a line.",
    "got": "'added external', 'removed external', 'added pending', 'removed peer', 'changed peer', and 'plumbline.lock.json is a signed file: sign the site again ...'.",
    "evidence": ["src/watch/decide.ts:462-490", "src/cli/watch-command.ts:116-123"],
    "code_check": "n-a",
    "verdict": "uncertain",
    "resolution": "n-a",
    "l2_priority": "Guardrail; TOM-L1-01/03 ask it to say more (signer words), not less."
  },
  {
    "id": "TOM-L1-S5",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "strength": true,
    "impact": { "frequency": "med", "reachability": "low", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "The pre-load check reads an unsigned peer as unverifiable in plain words and does not refuse it",
    "expected": "Unsigned is unverifiable, neither good nor bad.",
    "got": "{\"verdict\":\"unverifiable\",\"signed\":false,\"refuse\":false,\"detail\":\"The peer publishes no signature, so who published its definition cannot be told.\"}",
    "evidence": ["src/browser/preload.ts:82,187"],
    "code_check": "n-a",
    "verdict": "uncertain",
    "resolution": "n-a",
    "l2_priority": "Guardrail; the target for TOM-L1-06's other surfaces."
  },
  {
    "id": "TOM-L1-S6",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "strength": true,
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "init is honest where watch --init is not: on an existing lock it says 'kept' and turns each --source into a 'Not added' line",
    "expected": "A flag that cannot act says so.",
    "got": "'Not added: a lock was already there, and init never rewrites one; add it with watch --relock --source after a review.'",
    "evidence": ["src/cli/init-command.ts:132-136,171"],
    "code_check": "n-a",
    "verdict": "uncertain",
    "resolution": "n-a",
    "l2_priority": "Guardrail and the model for fixing TOM-L1-05."
  }
]
```

## What L2 must check

1. **Precondition first:** how `uat/driver/world.mjs` makes loopback sellers reachable to the checkout watch. The CLI
   cannot (TOM-L1-11). If the world uses https fixtures or the library's `allowLocal` injection, say which arm each
   verdict was measured on.
2. TOM-L1-01 and TOM-L1-02: rotation and swap give the same P10. After adopt A plus relock, the watch is green and
   verify B is `unverifiable`.
3. TOM-L1-03: offline seller, then relock, then re-keyed return, then relock. Confirm "added peer" and no signer
   finding.
4. TOM-L1-04: card offline, then relock, then the watch exits 0, then the card returns and relock does not restore it.
5. TOM-L1-05: real CLI `watch --init --external a2a-card=https://...` on the kiln-row marketplace checkout. Compare the
   lock bytes and the exit code.
6. TOM-L1-06: `verify --url --json` on the unsigned seller (exit 2) against Desk `#/verify` on the same address
   (`unverifiable`).
7. TOM-L1-07: build the five-column inventory from the week's `--json` bodies alone and count the columns that need
   regexes.
8. TOM-L1-08: needs a world toggle that makes a seller's signature file answer 5xx during a relock.

## Character feedback (L1)

I wanted a ledger and got a very honest smoke detector. Credit where it's due: nothing here ever told me an offline
seller was fine on the day it was offline. The card diff counts skills the way I would. And `adopt` behaves like a
payments team built it: it checks the chain against a key I already trust, it shows me each hop, and it won't do a
thing without `--yes`. I'd quote those sentences in our policy as they stand.

Then I ran the week, and the inventory came apart at exactly the joins I care about. Seller A rotated by the book and
seller B swapped keys with no rotation. The watch gave both the same sentence, word for word. The only line that
separates them is a hint `verify` prints in text, which vanishes the moment I add `--json`, and I always add `--json`.
Then I accepted A, and the only accept there is (`--relock`) accepted B too. I'd have shipped a swapped signer to
shoppers while CI went green. The flaky seller is worse: if it's down on the day I relock, its pin is gone, and when
it comes back under a new key the product tells me to relock and calls it "added peer". The card is worse still: one
warn line inside a command that exits 0, then it's gone from the lock, and every watch after that is clean while the
card is offline. And when I tried what the docs name first, `watch --init --external`, it exited 0 and did nothing. In
payments a tool that does that gets uninstalled the same afternoon.

What I'm missing for my job is small to describe and big to lack. A reason code on every finding, from a closed list,
so my dashboard stops regex-matching English. An "unsigned" state that is a state and not a missing key (`verify`
calling it an I/O error, exit 2, while the Desk calls it `unverifiable`, is the inconsistency I can't put in a policy).
A per-peer accept that refuses a signer change the trust file doesn't back. Peers and cards treated the same when
they're offline. Would I adopt it? For the watch-and-alert half, yes, next to my own script: it already beats my
hash-compare on detail. Would I let it own the inventory or the accept step? Not yet. Would I tell a peer? I'd tell
them the trust model is right and the bookkeeping isn't finished, and to never relock on a day a seller is down.

---

# L2 (empirical, live): appended 2026-11-18

World `kiln-row` (ports 4500-4505, Desk 4599), started from `onboarded`. Build: `npm run build` and `npm run build:site`
at 11:26 local (`dist/cli/index.js` mtime 11:26:10), after HEAD `47ea482` (10:30 +0100), so `dist/` and `site/lib/` were
fresh. Raw transcripts (every text and `--json` body, every lock before and after each relock, the world's request and CLI
logs) are in `uat/runs/2026-11-18-first-five/shots/tomasz/l2-transcripts/` and cited below by file name; screenshots are
in `uat/runs/2026-11-18-first-five/shots/tomasz/` by stem.

## L2 preflight

| Carried `l2_priority` | Environment precondition | On this host | Arm the verdicts were measured on |
| --- | --- | --- | --- |
| 1. How the world reaches loopback sellers (TOM-L1-11) | the checkout watch must contact `http://127.0.0.1:450x` | **CLI: no.** `init`, `watch --root`, `--relock` record every seller as pending or "could not be reached (the address is not https)"; `--external` refuses http | **harness arm** (`uat/driver/local-cli.mjs`, the built `runWatch`/`runRelock` with `allowLocal`) for every watch and relock that touches a seller or the card; the **real CLI** for `keygen`, `sign`, `trust`, `verify`, `adopt`, `watch --url`, and every refusal recorded |
| 2. TOM-L1-01/02: rotation vs swap, adopt, relock | harness for watch and relock; `verify`/`adopt --allow-local` | yes | harness + real CLI |
| 3. TOM-L1-03: offline seller, relock, re-keyed return, relock | the flaky seller must come back changed under a new signer | **not in the world**: dovetail is unsigned in this world (L1's D was signed) and `seller-back` changes nothing. **Built:** while dovetail was down I added an agent to its network and signed it with a new key made in the world folder (`tom/constructed-seller-keys`, a seller's key, never Tomasz's); control arm = the same returned seller against the lock from before the offline relock; second control = the world's own unchanged `seller-back` against the pin-kept lock | constructed arm + two control arms (harness) |
| 4. TOM-L1-04: card offline, relock, watch, back, relock | harness `--external` with http | yes | harness |
| 5. TOM-L1-05: `watch --init --external a2a-card=https://...` on the existing lock | none (ignored before any fetch) | yes | **real CLI** |
| 6. TOM-L1-06: unsigned at `verify --url --json` and at Desk `#/verify` | an unsigned seller at Desk time | copperwick was unsigned until `seller-signs`; at Desk time it was signed. **Built:** the world server's own `notFound` control on copperwick's `/plumbline.signature.json` (served 404, so the seller is unsigned as served); removed after | real CLI + Desk (Chromium) |
| 7. TOM-L1-07: inventory from `--json` alone | none | yes | harness watch JSON + real CLI verify JSON |
| 8. TOM-L1-08: signature file 5xx during a relock | a world toggle for a 500 | **not in the world** (`serve.mjs` has `down`, `slow`, `notFound`, `noCors`; no 500). **Built:** (a) 500 injected through the product's own seam `WatchDeps.fetch` (`src/watch/lock.ts:15-18`), wrapping the product's `safeFetch` so that one URL answers 500, `runRelock` unchanged, on a copy of the site (`scratchpad sig500-arm.mjs`); (b) 404 through the world's `notFound` on another copy | constructed arms (a) 500 and (b) 404 |
| TOM-L1-09/10 (adopt exit codes and JSON) | none | yes | real CLI |
| TOM-L1-12: Desk partner check has no address input; pre-load per seller | a browser; for per-state pre-load answers, sellers on https | Desk: yes. Pre-load per seller: **built** by importing the module the Desk ships (`/lib/plumbline/browser/preload.js`) in the Desk page. Live seller addresses are refused before any fetch (https rule). An https alias arm (a mapped fetcher, `https://<port>.seller.example` -> loopback) reaches the sellers, but every signed seller then fails the origin binding by design. **Not satisfiable here** for signed/rotated/swapped: needs sellers served on https and signed for those https origins (a local CA the test browser trusts, or world sellers signed for alias origins and routed with `page.route`) | Desk (Chromium) + in-page module arm |
| TOM-L1-13, TOM-L1-14 | reading the lock; `watch --init --json` on a fresh folder | yes | harness lock + real CLI |
| Freshness | `dist/` newer than HEAD | yes (11:26 > 10:30) | |
| Node | env.md says Node 22 | **Node v24.22.1** ran (from a stack trace). No behaviour depended on it that I saw | |
| Runtime upstream check | GitHub API, 60/h | rate-limited all run ("Could not check upstream: GitHub rate-limited the request until epoch 1794999868."), `info`, never an exit code | |

## L2 journal

**Monday, the existing lock.** `world.mjs up kiln-row` exit 0. The lock `onboarded` wrote is not the one L1 assumed: it
holds **no seller at all**, only four `pendingPeers` (`since 2026-11-18T10:26:40Z`), because `init` could not contact
an `http://127.0.0.1` seller. So my "existing lock" pins nothing. The real CLI watch says so four times and exits 1:

```
$ plumbline watch --root site                                         (real CLI, exit 1; 00-watch.json)
info  runtime cognizant-ai-lab/nsdeploy: Could not check upstream: GitHub rate-limited the request until epoch 1794999868.
warn  peer http://127.0.0.1:4501/ashgrove_studio: A peer could not be captured when the lock was written (pending since 2026-11-18), so it is not watched; run watch --relock once it answers.
  ... the same line for brackenfold_shop, copperwick_glass, dovetail_loom
```

"Once it answers": every one of them answers (the request log shows them serving). The reason `init` printed ("the
address is not https") is not in this line.

**Adding the card, the way the docs say first.** `docs/gate-and-watch.md:264` says `plumbline watch --init` (or
`--relock`) `--external a2a-card=<https url>`. With the studio's real address:

```
$ plumbline watch --root site --init --external a2a-card=http://127.0.0.1:4505/.well-known/agent-card.json
--external takes an https address without credentials                                         exit 2 (same with --json)
```

A refusal with a reason, for http. With an https address, which is what the doc literally asks for:

```
$ plumbline watch --root site --init --external a2a-card=https://tidewater-studio.example/.well-known/agent-card.json
info  runtime ...rate-limited...
warn  peer ...ashgrove_studio: A peer could not be captured when the lock was written (pending since 2026-11-18), ...   (x4)
exit 1      --json: {"lockState":"found","findings":[...]}   (01b-init-external.json)
lock sha256 756204dc... before and after; requests.log: 0 lines before, 0 after
```

Nothing was added, nothing was fetched, and nothing says the flag was ignored. The exit is 1 only because of the four
unrelated pending lines. `plumbline init --external ...` gives `unknown argument --external`, exit 2. The real CLI's
`--relock --external a2a-card=http://...` gives the same https refusal, exit 2. **What worked:** the harness.

```
$ local-cli watch --root site --relock --external a2a-card=http://127.0.0.1:4505/.well-known/agent-card.json   (02-relock-add-card.txt/.json, exit 0)
relock: wrote plumbline.lock.json (the previous lock was found)
added   external http://127.0.0.1:4505/.well-known/agent-card.json
added   peer http://127.0.0.1:4501/ashgrove_studio
added   peer http://127.0.0.1:4502/brackenfold_shop
added   peer http://127.0.0.1:4503/copperwick_glass
added   peer http://127.0.0.1:4504/dovetail_loom
removed pending ... (x4)
plumbline.lock.json is a signed file: sign the site again (plumbline sign) and commit both, ...
"findings": []
```

One lock now holds all five, but only through the test harness, and the command I ran to add one card also pinned four
sellers I had not reviewed, with no word about who signs them. The lock (02-...lock-after.json): ashgrove `kid
302c8e65a27575a0`, brackenfold `kid da6b4cd40dd30fdd`, copperwick and dovetail **no `kid` key at all**, every record
`checkedAt 2026-11-18T10:28:15.207Z`; the card `{kind, sha256, parts (2 skills), checkedAt}` and nothing about the one JWS
signature the card carries. I made Kiln Row's key in the world folder (`keygen`, kid `53db8504e12da0b0`), signed the site
(`signed 3 files`), and built my trust file with the real CLI: `trust --url http://127.0.0.1:4501/ --allow-local --yes`
and the same for 4502 (exit 0 each, with the "compare this kid ... out of band" warning); 4503 and 4504 `plumbline trust:
.well-known/plumbline-key.json not found`, exit 2.

Baseline, harness watch: only the upstream `info`, exit 0. The same lock through the **real CLI**: five warns, exit 1:
`A peer could not be reached (the address is not https), so it was not checked.` for each seller and `An external agent
definition could not be reached (the address is not https), so it was not checked.` for the card. "Could not be
reached" for addresses it never tried. `verify --json`: 4501 and 4502 `verified` (exit 0); 4503 and 4504
`{"error":"plumbline.signature.json not found in http://127.0.0.1:4503/"}`, exit 2.

**Tuesday, `seller-rotates`** (act exit 0: rotation 302c8e65a27575a0 -> e5e0ace512a8c3bf). Harness watch, exit 1:

```
block peer http://127.0.0.1:4501/ashgrove_studio: A peer is now signed by a different key than the one the lock recorded.
  json: {"kind":"peer","severity":"block","ref":"...4501/ashgrove_studio","expected":"302c8e65a27575a0","actual":"e5e0ace512a8c3bf","summary":"..."}
```

Control arm in the same run: brackenfold, not played, has no finding. `verify` text for 4501 prints `hint:
plumbline-rotation.json is present; if you trust a key it rotates from, check it with plumbline adopt --url
http://127.0.0.1:4501/ --trust ... --allow-local`; `verify --json` has no hint:
`{"results":[{"verdict":"unverifiable","kid":"e5e0ace512a8c3bf",...,"detail":"The signature is internally consistent but the signer is unknown: ..."}]}`, exit 1.

**Wednesday, `seller-signer-swapped`** (brackenfold signed by 8d80d8e4c1567c52, no rotation). Harness watch, exit 1
(05-swapped.json):

```
block peer http://127.0.0.1:4501/ashgrove_studio: A peer is now signed by a different key than the one the lock recorded.
block peer http://127.0.0.1:4502/brackenfold_shop: A peer is now signed by a different key than the one the lock recorded.
```

Word for word the same, and the JSON objects differ only in `ref` and the kids. `verify --json` for 4502:
`{"results":[{"verdict":"unverifiable","kid":"8d80d8e4c1567c52",...,"detail":"The signature is internally consistent but the signer is unknown: ..."}]}`, exit 1: the same shape and the same detail as ashgrove's.
`verify` text for 4502 has no hint, which is the only difference anywhere. `adopt`:

```
4501 (no --yes): rotation 302c8e65a27575a0 -> e5e0ace512a8c3bf ... verified ... A key this verifier already trusts for this origin named its successor.
                 nothing adopted: adopting a successor is your decision; rerun with --yes to add it          exit 1
                 --json: {...,"added":false,"alreadyTrusted":false,"adopted":["e5e0ace512a8c3bf"]}   (05-adopt-4501.json)
4502:            plumbline adopt: plumbline-rotation.json not found in http://127.0.0.1:4502/                 exit 2
                 --json: {"error":"plumbline-rotation.json not found in http://127.0.0.1:4502/"}          (05-adopt-4502.json)
```

**The policy decision: accept ashgrove, do not accept brackenfold.** `adopt --url 4501 --yes --json`: `"added":true`,
exit 0; `verify` 4501 then `verified` (kid e5e0ace512a8c3bf), exit 0. The harness watch still blocks both (exit 1):
`adopt` writes my trust file, the watch reads the lock. I looked for a per-seller accept. `--drop` is the only flag that
takes a ref, so I tried it on brackenfold:

```
$ local-cli watch --root site --relock --drop http://127.0.0.1:4502/brackenfold_shop            exit 0
relock: wrote plumbline.lock.json (the previous lock was found)
changed peer http://127.0.0.1:4501/ashgrove_studio
changed peer http://127.0.0.1:4502/brackenfold_shop
info  grounding http://127.0.0.1:4502/brackenfold_shop: This ref was not in the lock, so there was nothing to drop.
```

It says brackenfold "was not in the lock" (it was, as a peer; the label says `grounding`), and it accepted brackenfold's
swapped signer anyway. Then I slipped: running the real CLI's `--relock --drop ... --json` "to see how it parses", it
**wrote the lock**. I recorded it, then replayed it deliberately on a copy of the site (06-cli-relock.json):

```
$ plumbline watch --root <copy>/site --relock                                                    (real CLI) exit 0
added   pending http://127.0.0.1:4501/ashgrove_studio        (x4 sellers)
removed external http://127.0.0.1:4505/.well-known/agent-card.json
removed peer http://127.0.0.1:4501/ashgrove_studio           (x4 sellers)
warn  peer ...: A peer could not be captured, so the lock holds it as pending and every watch reports it (the address is not https).   (x4)
warn  peer ...agent-card.json: An external agent definition could not be locked (the address is not https), so it is not in the lock.
```

The product's own `--relock`, run from a host that cannot contact the sellers, wiped every pin, every kid and the card,
and exited 0 (lock after: 0 peers, 4 pending, 0 external; 06-after-cli-relock.lock.json). I restored the pre-accept lock
I had saved (sha256 `6c1db532...`, identical) and did what the product offers, a plain relock (07-accept-A):

```
relock: wrote plumbline.lock.json (the previous lock was found)
changed peer http://127.0.0.1:4501/ashgrove_studio
changed peer http://127.0.0.1:4502/brackenfold_shop                                              exit 0, "findings": []
$ local-cli watch            -> info only, exit 0        (07-after-accept.json)
$ plumbline verify --url http://127.0.0.1:4502/ ... --json  -> "unverifiable", kid 8d80d8e4c1567c52, exit 1
lock: brackenfold kid now 8d80d8e4c1567c52
```

CI is green with brackenfold pinned to a key nobody trusts; "changed peer" says nothing about a signer. My workaround:
copy brackenfold's old record back into the lock by hand (a signed file), so the watch blocks only brackenfold
(08-handedit: one `block`, exit 1), and re-sign the site.

**Thursday, `seller-offline`** (dovetail refuses). Harness watch, exit 1: `block` brackenfold (my hand-edit) and
`warn peer http://127.0.0.1:4504/dovetail_loom: A peer could not be reached (the connection failed), so it was not
checked.` (09-offline.json). Never clean. Then a relock while dovetail is down (10-relock-while-D-down):

```
added   pending http://127.0.0.1:4504/dovetail_loom
removed peer http://127.0.0.1:4504/dovetail_loom
changed peer http://127.0.0.1:4502/brackenfold_shop
warn  peer ...dovetail_loom: A peer could not be captured, so the lock holds it as pending and every watch reports it (the connection failed).   exit 0
```

Two things in one relock: dovetail's pin is gone (lock: `pendingPeers.dovetail_loom = {since: 10:30:23Z}` and nothing
else), and brackenfold's swapped signer is accepted **again**: the hand-edit lasts until the next relock. The next watch
says `warn ... dovetail_loom: A peer could not be captured when the lock was written (pending since 2026-11-18), so it
is not watched; run watch --relock once it answers.`: the same sentence, character for character, as Monday's
never-captured sellers.

Constructed arm: while dovetail was down, it added an agent `deposit_taker` and signed with a new key `afc47fd0c757f216`.
`seller-back` (exit 0). Watch (11-back-after-pin-lost.json): only the pending line above, exit 1; nothing says dovetail
answers again or changed. **Control arm** (11-control-pin-kept.json), the same returned dovetail against the lock from
before the offline relock:

```
block peer ...dovetail_loom: A peer's network definition changed since the lock was written; it runs in the visitor's browser, so a changed one is changed code. In outline: agents: 1 added, 0 removed, 1 changed; outbound hosts: 0 added, 0 removed; front agent: unchanged.
info  peer ...dovetail_loom: A peer that was unsigned when locked now publishes a signature; re-lock to record its key.
```

So the offline relock is what hid a changed definition and a new signer. Following the pending line's advice (12):
`added peer http://127.0.0.1:4504/dovetail_loom` / `removed pending ...`, exit 0, `"findings": []`; next watch exit 0. A
changed seller under a new signer, accepted by doing what the product said. Second control (24-ctl-back.json): the
world's own unchanged dovetail against the pin-kept lock gives no dovetail finding, so the `block` above is the change
and not noise.

**Friday, `card-skills-change`.** I put brackenfold's old record back (second hand-edit). Harness watch, exit 1
(13-card-change.json):

```
block peer http://127.0.0.1:4505/.well-known/agent-card.json: An external A2A Agent Card changed since the lock was written; a client that reads it now gets different skills or endpoints. In outline: skills: 1 added, 0 removed, 1 changed; it carries 1 JWS signature, not verified here.
  json: "kind":"peer", "expected":"3065c7b6...", "actual":"fdff99ba..."
```

Clear units. I reviewed and accepted the card: relock (14) printed `changed external ...agent-card.json` **and**
`changed peer http://127.0.0.1:4502/brackenfold_shop`: brackenfold accepted a third time.

**`card-offline`.** Control arm first (15-card-offline.json, no offline relock): `warn peer ...agent-card.json: An
external agent definition could not be reached (the connection failed), so it was not checked.`, exit 1. Then a relock
while it is down (16-relock-card-down.json): `removed external ...agent-card.json` and `warn ... An external agent
definition could not be locked (the connection failed), so it is not in the lock.`, **exit 0**. Lock: `external: []`.
Next watch with the card still offline (16-after-card-dropped.json): only the upstream `info`, **exit 0**. `card-back`,
relock (17): `no ref changed`, exit 0, lock still `external: []`. The card only came back when I re-ran the harness
`--relock --external ...` myself (18: `added external`). A seller in the same position became `pending` and kept
nagging; the card vanished.

**Saturday, `seller-signs`** (copperwick signs with 21906bff1dc28c1e). Before (19-pre-signs): no copperwick line, exit 0.
After (19-signs.json): `info peer http://127.0.0.1:4503/copperwick_glass: A peer that was unsigned when locked now
publishes a signature; re-lock to record its key.`, `"actual":"21906bff1dc28c1e"`, exit 0. `verify --json`:
`unverifiable`, exit 1.

**TOM-L1-08, constructed.** On a copy of the site (lock with ashgrove pinned at e5e0ace512a8c3bf):

```
(a) 500 on http://127.0.0.1:4501/plumbline.signature.json during runRelock (20-arm500.txt)
    changes.changed: ["peer ...4501/ashgrove_studio", "peer ...4503/copperwick_glass"], findings: []
    ashgrove's record: {sha256, links, outline, checkedAt}   (no kid)
    next watch, 500 gone: info peer ...ashgrove_studio: A peer that was unsigned when locked now publishes a signature; re-lock to record its key.
(b) 404 via the world's notFound: the same: "changed peer", findings [], no kid, then the same info line.
```

A seller I had just adopted became "unsigned" in the lock with no line, and its signer check fell to `info`.

**The Desk (Chromium 1255 via Playwright 1.65.1, `drive-script.mjs`, exit 2; 22-desk.json).** Drift on
`http://127.0.0.1:4500/` (shot `tom-l2-desk-drift-kilnrow`): status `Drift read: 5 findings, the worst Warning. Unsigned
lock: the host can rewrite it.`; five WARNINGs, each `A peer in this lock was not contacted: it is not an https address,
which a published lock may not point a browser at.` (the card: `An external agent definition in this lock was not
contacted: ...`), and `Not checked from a browser: the upstream nsdeploy commit`. The same as the real CLI's `watch --url
--allow-local` (21-watch-url.json, exit 1). But the lock is signed (by Kiln Row's key, `verify` with that key trusted:
`verified`). **Control arm** (23-desk-control.json, shot `tom-l2-desk-drift-kilnrow-trusted`, exit 0): the same drift
after importing a trust file that also holds Kiln Row's key reads `Signed lock: covered by a signature that verified
under a publisher you trust.` So "Unsigned lock" means "not verified by you", and every shopper's browser, which has
never trusted Kiln Row, is told our signed lock is unsigned.

Verify, after importing my trust file (the import showed the three entries and needed a confirm: `Add these 3 to my
trust list`; shot `tom-l2-desk-trust-import-offer`):

| Seller | Desk `#/verify` (shot) | CLI `verify --json` at the same moment (21-verify-*) |
| --- | --- | --- |
| ashgrove (rotated, adopted) | VERIFIED, signer e5e0ace512a8c3bf, "It does not mean the site is safe, honest or correct." (`tom-l2-desk-verify-4501`) | `verified`, exit 0 |
| brackenfold (signer swapped) | UNVERIFIABLE, "You have not met this signer yet, or the site publishes no signature." + **"First contact: trust this publisher?"** with a "Trust this publisher for this origin" button, while the trust list on the same screen shows `da6b4cd40dd30fdd http://127.0.0.1:4502` (`tom-l2-desk-verify-4502`) | `unverifiable`, "the signer is unknown", exit 1 |
| copperwick (unsigned: signature served 404) | UNVERIFIABLE, "This site publishes no plumbline.signature.json, so nothing can be verified." (`tom-l2-desk-verify-4503`) | `{"error":"plumbline.signature.json not found in http://127.0.0.1:4503/"}`, **exit 2** |
| dovetail (re-keyed, never trusted) | UNVERIFIABLE, the same text and the same first-contact offer as brackenfold (`tom-l2-desk-verify-4504`) | `unverifiable`, exit 1 |

The swapped signer and a seller I never met read identically, on the Desk and in the CLI, although my trust list holds a
different key for the swapped seller's origin.

Pre-load check (the shipped module, imported in the Desk page; the Desk itself runs it only for its two partners, and
`#partners` has 0 inputs: shot `tom-l2-desk-partners`):

| Seller | Live address | https alias arm |
| --- | --- | --- |
| ashgrove (rotated) | unverifiable, `signed:false`, `refuse:false`, "The peer was not contacted: it is not an https address." | unverifiable, "...the signature names a different origin" (origin binding; not a product fault) |
| brackenfold (swapped) | the same sentence | the same "different origin" |
| copperwick (unsigned) | the same sentence | **unverifiable, `signed:false`, `refuse:false`, "The peer publishes no signature, so who published its definition cannot be told."** |
| dovetail (re-keyed) | the same sentence | the same "different origin" |

The driver's `expect("the four sellers' states are told apart")` failed (exit 2): one sentence for four states. It is
honest (nothing was contacted, nothing is called verified), and the per-state answers for signed sellers are not
exercisable here (see preflight).

### Per-act finding table (harness watch unless marked)

| Act | kind / severity | Exact sentence | Exit |
| --- | --- | --- | --- |
| `onboarded` (real CLI) | peer / warn (x4) | A peer could not be captured when the lock was written (pending since 2026-11-18), so it is not watched; run watch --relock once it answers. | 1 |
| `onboarded`, after the harness relock pinned them | none for the two unsigned sellers | (no line; unsigned is silent) | 0 |
| `seller-rotates` | peer / block | A peer is now signed by a different key than the one the lock recorded. | 1 |
| `seller-signer-swapped` | peer / block | A peer is now signed by a different key than the one the lock recorded. **(= seller-rotates)** | 1 |
| `seller-offline` | peer / warn | A peer could not be reached (the connection failed), so it was not checked. | 1 |
| `seller-back`, pin kept, seller unchanged (control) | none | | (1, from brackenfold) |
| `seller-back`, pin kept, seller changed and re-keyed (constructed control) | peer / block **and** peer / info | A peer's network definition changed since the lock was written; ... In outline: agents: 1 added, 0 removed, 1 changed; outbound hosts: 0 added, 0 removed; front agent: unchanged. / A peer that was unsigned when locked now publishes a signature; re-lock to record its key. **(one act, two findings: fair, two facts)** | 1 |
| `seller-back` after a relock while it was offline | peer / warn | A peer could not be captured when the lock was written (pending since 2026-11-18), ... **(= `onboarded`'s never-captured line)** | 1 |
| `card-skills-change` | peer / block | An external A2A Agent Card changed since the lock was written; a client that reads it now gets different skills or endpoints. In outline: skills: 1 added, 0 removed, 1 changed; it carries 1 JWS signature, not verified here. | 1 |
| `card-offline` | peer / warn | An external agent definition could not be reached (the connection failed), so it was not checked. | 1 |
| `card-offline` after a relock while it was offline | none | **(= a healthy card)** | **0** |
| `seller-signs` | peer / info | A peer that was unsigned when locked now publishes a signature; re-lock to record its key. | 0 |
| (real CLI, any pinned loopback seller) | peer / warn | A peer could not be reached (the address is not https), so it was not checked. **(the offline template for a refusal; `watch --url` and the Desk say "was not contacted: it is not an https address")** | 1 |

Indistinguishable pairs: `seller-rotates` / `seller-signer-swapped`; never-captured / pin-lost-while-offline;
card-offline-after-relock / healthy card; unsigned / clean (no line either way). One act with two findings: a returned
seller that changed and signed (two facts, acceptable).

### Inventory from the JSON alone, after each event

Columns: pinned hash, current state, signer, last checked, reason code. A cell is "filled" only from a JSON field.
`[S]` needs the `summary` sentence, `[L]` needs a hand read of the lock, `[P]` needs a pattern guess on the polymorphic
`expected`/`actual` (a 64-hex hash or a 16-hex kid), `?` has no source. Signer cells come from a separate `verify --json`
per seller where I ran one. (Built mechanically by a scratch script; transcripts `inv-03.md` and the per-act JSON.)

| Event | Cells filled from a field | What the five rows looked like |
| --- | --- | --- |
| `onboarded` (real CLI) | **0 of 25** | four `warn [S]`; the card has no row at all |
| baseline (after the card was added) | 2 of 25 | signer for ashgrove and brackenfold from `verify`; copperwick and dovetail `verify` exit 2 `{"error"}` [S]; every state "no finding", which means clean for ashgrove and unsigned for copperwick |
| `seller-rotates` | 2 of 25 | ashgrove `block [S]`; kids from `verify` |
| `seller-signer-swapped` | 2 of 25 | two identical `block [S]` rows |
| `seller-offline` | 0 of 25 | brackenfold's kid only as `actual` [P] |
| `seller-back` (pin lost) | 0 of 25 | dovetail `warn [S]` |
| `card-skills-change` | 0 of 25 | the card's pinned hash only as `expected` [P] |
| `card-offline` | 0 of 25 | card `warn [S]` |
| `card-offline` after the relock | 0 of 25 | the card row reads exactly like the healthy baseline card row |
| `seller-signs` | 4 of 25 | four signers from four `verify` runs; copperwick `info [S]` |

Never fillable from any JSON field in any event: **last checked** (no report carries a time; only the lock's per-record
`checkedAt`), **reason code** (none exists), **pinned hash** (only through a pattern on `expected` when something
changed), **the card's signer** (no field anywhere; its JWS count appears only inside the changed sentence).

### Answers to "What this journey must answer"

- **How the card is added to an existing lock:** the documented-first `watch --init --external a2a-card=<https url>`
  does nothing, says nothing and fetches nothing on an existing lock (lock bytes unchanged, 0 requests); `init` has no
  `--external`; `--relock --external` is the working form. On this host only the harness can do it, and doing it also
  pins every pending seller.
- **Finding per act:** the table above. Indistinguishable: rotation vs swap; never-captured vs pin-lost; a dropped
  offline card vs a healthy one; unsigned vs clean.
- **Unreachable on a relock:** a seller is **kept as pending with its pin dropped** (hash, kid and outline gone; `since`
  becomes the relock's date); the card is **dropped**, one warn inside an exit-0 relock, and later relocks do not
  restore it. A relock that can reach no seller at all (the real CLI here) does both to everything at once.
- **Rotation vs bare signer change:** not told apart at the watch, nor in `verify --json`, nor on the Desk's verify; only
  `verify`'s text hint and `adopt` tell them apart. `adopt` needs a key already trusted for the origin, the published
  `plumbline-rotation.json`, and `--yes`.
- **Unsigned reads:** watch, nothing; lock, an absent `kid` (also what a 500 or 404 during capture writes); CLI
  `verify`, an error, exit 2; Desk `#/verify`, `unverifiable`; pre-load module, `unverifiable` "publishes no signature"
  (alias arm) or "not contacted" (live).
- **`--json` documented and sufficient:** the shapes are in prose and `src/core/types.ts`; insufficient (0 to 4 of 25
  cells; no reason code, no time).
- **Units of counts:** clear wherever counts appear: "agents", "outbound hosts", "skills", "1 JWS signature", "5
  findings". `init`'s "4 pending" leaves "peers" implied.

### Time

Every command answered in under half a second (harness watch 0.44 s, `verify` 0.36 s). The time is in the steps. The
event week took me, as Tomasz: 9 watches, 12 `verify` runs, 3 `adopt` runs, 7 relocks (one of them the accidental CLI
relock and its recovery), 3 hand-edits of the lock (each undone by the next relock), 3 re-signs, 2 lock restores, a
re-add of the card, and reading the lock by hand after every relock to fill my inventory: about **40 steps, ~45 min**.
A quiet week (one watch, read, done) is ~3 min of product time plus the side checks he cannot drop (which sellers are
unsigned, is the card still in the lock, is brackenfold still held): ~12 min.

## L2 scored criteria

| # | Criterion | L2 | Change from L1 | Evidence |
| --- | --- | --- | --- | --- |
| 1 | One lock records every seller and the Agent Card, and the command that adds each is documented | **pass (harness arm)** | same | 02-relock-add-card: four `peers` and one `external`; `docs/gate-and-watch.md:264-271`. On this host only the harness wrote it |
| 2 | Adding the card to an existing lock works or refuses with a reason; never exit 0 having done nothing | **fail** | same | real CLI `--init --external a2a-card=https://...`: lock sha256 unchanged, 0 requests, no line; exit 1 only from the unrelated pending warns (01b-init-external.json) |
| 3 | Changed, unreachable, pending, signer-changed, unsigned each give a distinct, stable finding | **fail** | same, widened | rotation = swap (05-swapped.json); pending-at-init = pin-lost (00-watch vs 10-after); unsigned = no line (03-baseline); a refused address uses the offline template in `watch --root` and another sentence in `watch --url` and the Desk |
| 4 | An unreachable seller is never clean, and never dropped without a line | **fail** | same, widened | card: dropped by a relock (16), next watch exit 0 while offline; seller: pin dropped (10); real CLI relock removed all four pins and the card, exit 0 (06-cli-relock.json) |
| 5 | A proper rotation can be followed with `adopt`; a bare signer change is a `block` | **fail** | same, widened | adopt follows ashgrove (pass in isolation); brackenfold is `block` only until any relock; accepted by 3 relocks in one week (07, 10, 14); `verify` and the Desk offer brackenfold "First contact: trust this publisher?" (`tom-l2-desk-verify-4502`) |
| 6 | Unsigned reads `unverifiable` everywhere, including the pre-load check | **fail** | same | Desk verify and pre-load: `unverifiable`; CLI `verify --json`: `{"error"}` exit 2 (21-verify-4503.json); watch: nothing |
| 7 | `--json` has documented fields and fills the inventory | **fail** | same, now measured | 0 to 4 of 25 cells per event |
| 8 | The weekly review takes under 10 minutes | **fail** | same, worse | event week ~45 min (L1 estimated ~28); quiet week ~12 min with the side checks |

**Score: 1 of 8 (L1: 1 of 8).** No criterion moved; criteria 3, 4, 5 and 8 failed harder live than on paper.

## Findings (L2)

```json
[
  {
    "id": "TOM-L1-01",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "severity_l1": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "impact_l1": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Accepting one seller's proper rotation with --relock also blesses another seller's swapped signer, and every later relock re-blesses it",
    "expected": "A seller that rotated properly (adopt verified) can be accepted in the lock on its own; a seller whose signer changed without a rotation stays block.",
    "got": "Live: after adopt --yes for ashgrove, the plain relock printed 'changed peer ...ashgrove_studio' and 'changed peer ...brackenfold_shop' with findings [], the next watch exited 0, and verify of brackenfold said unverifiable with brackenfold pinned to 8d80d8e4c1567c52. --drop <peer url> does not hold a peer back (TOM-L2-02). The only way to keep brackenfold blocked was to hand-edit its old record back into the signed lock and re-sign, and each later relock (to accept the card, during dovetail's outage) accepted brackenfold again: three times in one week.",
    "evidence": ["src/watch/index.ts:98-121", "src/watch/capture.ts:144-156", "src/watch/decide.ts:474-478", "src/cli/watch-command.ts:116-123", "l2-transcripts/07-accept-A.txt", "l2-transcripts/07-after-accept.json", "l2-transcripts/10-relock-while-D-down.txt", "l2-transcripts/14-accept-card.txt", "l2-transcripts/08-handedit.json"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Measured on the harness arm (the CLI cannot reach a loopback seller). Recertify: a per-peer accept, or a relock that refuses a signer the trust file does not back."
  },
  {
    "id": "TOM-L1-02",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "clarity",
    "title": "A proper key rotation and a bare signer swap produce the identical watch finding, and verify's only distinguishing line is text-only",
    "expected": "The watch says whether the new kid is named by a rotation the peer publishes (or the trust file now holds it), so rotation and swap read differently; verify --json carries the rotation hint.",
    "got": "Live: both 'block peer <url>: A peer is now signed by a different key than the one the lock recorded.', JSON differing only in ref and kids. verify --json for both: {verdict: unverifiable, kid, origin, detail: 'The signature is internally consistent but the signer is unknown: ...'}, exit 1; the 'hint: plumbline-rotation.json is present; ... plumbline adopt --url http://127.0.0.1:4501/ ...' line is in text output only.",
    "evidence": ["src/watch/decide.ts:283-286", "src/watch/observe.ts:67-76", "src/cli/commands.ts:621-630", "l2-transcripts/05-swapped.json", "l2-transcripts/05-verify-4501.json", "l2-transcripts/05-verify-4502.json"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Harness arm for the watch; real CLI for verify."
  },
  {
    "id": "TOM-L1-03",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "A relock run while a seller is offline discards its pinned hash, kid and outline; it returns changed and re-keyed as 'added peer' with no finding",
    "expected": "A pinned peer that cannot be re-captured keeps its previous record (or the relock refuses it), and on return the new state is compared with the old pin.",
    "got": "Live: relock while dovetail was down printed 'added pending ...dovetail_loom / removed peer ...dovetail_loom' and the lock held only {since}. Constructed: dovetail returned with an added agent and signed by a new key. Watch: only 'A peer could not be captured when the lock was written (pending since 2026-11-18), so it is not watched; run watch --relock once it answers.' (the never-captured sentence). Following it: 'added peer ...dovetail_loom', findings [], next watch exit 0. Control arm, same returned seller against the pre-offline lock: block 'A peer's network definition changed ... In outline: agents: 1 added, 0 removed, 1 changed; ...' plus info 'unsigned when locked now publishes a signature'. Second control: the world's unchanged seller-back against the pin-kept lock gives no line.",
    "evidence": ["src/watch/capture.ts:144-167", "src/watch/decide.ts:317-330", "src/watch/index.ts:98-121", "l2-transcripts/10-relock-while-D-down.txt", "l2-transcripts/11-back-after-pin-lost.json", "l2-transcripts/11-control-pin-kept.json", "l2-transcripts/12-relock-D-back.json", "l2-transcripts/24-ctl-back.json"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Harness arm; the seller's change and new key are a constructed arm (the world's dovetail is unsigned and its seller-back changes nothing). A world act 'seller-back-changed' would make it a fixture."
  },
  {
    "id": "TOM-L1-04",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "completion",
    "title": "An Agent Card offline during a relock is dropped from the lock for good, and later watches read clean while it is still offline",
    "expected": "The card is kept (pending, like a peer) and reported on every watch until it is captured or dropped on purpose with --drop.",
    "got": "Live: control watch with the card offline: warn 'An external agent definition could not be reached (the connection failed), so it was not checked.', exit 1. Relock while offline: 'removed external <card>' and warn '... could not be locked (the connection failed), so it is not in the lock.', exit 0; lock external: []. Next watch, card still offline: info only, exit 0. card-back, relock: 'no ref changed', external still []. Only a fresh --relock --external restored it.",
    "evidence": ["src/watch/capture.ts:169-185", "src/watch/index.ts:106-108", "src/watch/decide.ts:337-350", "docs/gate-and-watch.md:268-270", "l2-transcripts/15-card-offline.json", "l2-transcripts/16-relock-card-down.json", "l2-transcripts/16-after-card-dropped.json", "l2-transcripts/17-relock-card-back.txt", "l2-transcripts/18-readd-card.txt"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Harness arm (the CLI refuses an http card)."
  },
  {
    "id": "TOM-L1-05",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "broken-flow",
    "severity": "major",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "watch --init --external (and --source) on an existing lock does nothing and says nothing, and watch --init never says whether it wrote or kept the lock",
    "expected": "Either the card is added, or a refusal names --relock (as init does for --source: 'Not added: a lock was already there').",
    "got": "Live, real CLI on the kiln-row marketplace: 'watch --root site --init --external a2a-card=https://tidewater-studio.example/.well-known/agent-card.json' printed a plain watch; lock sha256 756204dc... before and after; the world served 0 requests; --json {lockState: found, findings}. Exit 1 here only because of four unrelated pending warns (on a clean lock the same path exits 0, as L1 measured). With the card's real http address the CLI refuses with a reason, exit 2. On a fresh folder 'watch --init --json' printed an object whose only key is findings.",
    "evidence": ["src/watch/index.ts:58-70", "src/cli/watch-command.ts:103,128-135", "src/cli/init-command.ts:132-136", "docs/gate-and-watch.md:94", "docs/gate-and-watch.md:264", "l2-transcripts/01b-init-external.json", "l2-transcripts/25-init-fresh.json"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Real CLI. Matches the accepted-gaps known-defect hypothesis."
  },
  {
    "id": "TOM-L1-06",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "'Unsigned' is not a state: the watch is silent, the lock has only an absent kid, and CLI verify exits 2 with an error while the Desk and the pre-load check say unverifiable",
    "expected": "An unsigned seller reads unverifiable (or an explicit 'unsigned' state) on every surface, with one exit-code meaning.",
    "got": "Live, same seller (copperwick, signature served 404), same minute: CLI verify --json {\"error\":\"plumbline.signature.json not found in http://127.0.0.1:4503/\"}, exit 2; Desk #/verify 'UNVERIFIABLE ... This site publishes no plumbline.signature.json, so nothing can be verified.'; pre-load module (alias arm) {verdict: unverifiable, signed: false, refuse: false, 'The peer publishes no signature, so who published its definition cannot be told.'}; harness watch: no line for an unsigned seller in any event; lock: no kid key. trust --url on an unsigned seller also exits 2 ('.well-known/plumbline-key.json not found').",
    "evidence": ["src/watch/decide.ts:283-298", "src/watch/capture.ts:150-153", "src/cli/commands.ts:531-533", "src/browser/preload.ts:82", "site/desk.js:687", "docs/signature-format.md:513", "l2-transcripts/21-verify-4503.json", "shots/tomasz/tom-l2-desk-verify-4503.png", "l2-transcripts/22-desk.json", "l2-transcripts/03-baseline.json"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Real CLI + Desk; reconciliation item across CLI and Desk."
  },
  {
    "id": "TOM-L1-07",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "senior-quality",
    "title": "Drift JSON has no reason code, no timestamp and polymorphic expected/actual, so an inventory needs sentence-matching",
    "expected": "Each finding carries a code from a closed, documented list; the report carries checkedAt; card and peer are told apart by a field.",
    "got": "Live, built mechanically from the week's JSON: 0 to 4 of 25 inventory cells per event came from a field (0 in six of ten events); 'last checked' and 'reason code' never; pinned hash only via a 64-hex pattern on expected when something changed; the card's signer has no field anywhere; 'no finding' means clean, unsigned, or (after a relock) not in the lock.",
    "evidence": ["src/core/types.ts:316-338", "src/watch/external.ts:96-130", "src/watch/decide.ts:224-300", "docs/gate-and-watch.md:94-99", "l2-transcripts/inv-03.md", "l2-transcripts/04-rotates.json", "l2-transcripts/16-after-card-dropped.json"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Recertify by re-running the same inventory script over the same acts."
  },
  {
    "id": "TOM-L1-08",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "A signed seller whose signature file errors during a relock is silently locked as unsigned",
    "expected": "A signature that could not be read at capture is a finding, and the peer is pending (or keeps its previous kid).",
    "got": "Constructed live: (a) a 500 on ashgrove's plumbline.signature.json injected through WatchDeps.fetch (the product's safeFetch for every other URL; runRelock unchanged) and (b) a 404 through the world's notFound control. Both: relock 'changed peer ...ashgrove_studio', findings []; ashgrove's record {sha256, links, outline, checkedAt} with no kid; next watch with the file back: info 'A peer that was unsigned when locked now publishes a signature; re-lock to record its key.', exit 0. ashgrove had just been adopted.",
    "evidence": ["src/watch/capture.ts:147-156", "src/watch/decide.ts:193-206", "src/watch/decide.ts:287-288", "src/watch/observe.ts:67-75", "l2-transcripts/20-arm500.txt"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Constructed arm. A world act that serves a 500 for one path (serve.mjs has no such behaviour) would make it a fixture."
  },
  {
    "id": "TOM-L1-09",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "adopt on a seller that published no rotation exits 2 (usage or I/O error), the most important policy signal in the journey",
    "expected": "'No rotation published: this signer change is not a rotation' as a verdict, exit 1, with a JSON field.",
    "got": "Live: 'plumbline adopt: plumbline-rotation.json not found in http://127.0.0.1:4502/', exit 2; --json {\"error\":\"plumbline-rotation.json not found in http://127.0.0.1:4502/\"}.",
    "evidence": ["src/cli/trust-command.ts:86-91", "src/cli/trust-command.ts:242", "l2-transcripts/05-adopt-4502.json"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Real CLI."
  },
  {
    "id": "TOM-L1-10",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "adopt --json without --yes lists the successor under 'adopted' although nothing was adopted",
    "expected": "'adopted' only when added is true; a separate field for what would be added.",
    "got": "Live: {\"added\":false,\"alreadyTrusted\":false,\"adopted\":[\"e5e0ace512a8c3bf\"]}, exit 1; with --yes the same key list and \"added\":true.",
    "evidence": ["src/cli/trust-command.ts:276-306", "docs/signature-format.md:498", "l2-transcripts/05-adopt-4501.json"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Real CLI."
  },
  {
    "id": "TOM-L1-11",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "severity_l1": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "impact_l1": { "frequency": "low", "reachability": "high", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "The checkout watch cannot be rehearsed against staged (non-https) sellers, and its refusal sentence says the checkout is read from disk when it also fetches peers",
    "expected": "A local rehearsal path for staging sellers (as gate, verify, trust and adopt have), or a refusal that names why peers are https-only.",
    "got": "Live: every seller and card event of the week was reachable only through the test harness (uat/driver/local-cli.mjs). The real CLI: onboarded left all four sellers pending; --external refused http; watch --root called each pinned seller 'could not be reached (the address is not https)'. A platform team that stages sellers before production cannot pin, watch or accept them with the product. Widened by TOM-L2-01: the CLI's relock on such a lock destroys it.",
    "evidence": ["src/cli/watch-command.ts:92", "src/watch/external.ts:141", "src/net/safe-fetch.ts:81", "src/watch/lock.ts:15-18", "l2-transcripts/00-watch.json", "l2-transcripts/03-baseline.cli.json"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Decided the arm of every peer verdict in this run: harness."
  },
  {
    "id": "TOM-L1-12",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "low", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "The pre-load check his shoppers' browsers would rely on runs on the Desk only for its own two partners; its lockFindings are computed and never shown",
    "expected": "A documented way to run checkPeerBeforeLoad over a site's own peers, and the Desk showing what differs.",
    "got": "Live: the Desk's partner section has 0 inputs (shot tom-l2-desk-partners); the only way to ask about Kiln Row's sellers was to import /lib/plumbline/browser/preload.js in the page by hand.",
    "evidence": ["site/desk.js:60", "site/desk.js:1314-1336", "src/browser/preload.ts:151-189", "package.json:22-24", "shots/tomasz/tom-l2-desk-partners.png", "l2-transcripts/22-desk.json"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Desk (Chromium)."
  },
  {
    "id": "TOM-L1-13",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "missing",
    "title": "The card's signer column is always empty: JWS signatures are counted only in the 'changed' sentence and never written to the lock",
    "expected": "The lock records the card's signature count (or signer key ids).",
    "got": "Live: the world's card carries one JWS signature; the lock's entry was {kind, sha256, parts, checkedAt}; the count appeared only in the card-skills-change sentence ('it carries 1 JWS signature, not verified here').",
    "evidence": ["src/core/types.ts:212-222", "src/watch/external.ts:65,120", "src/watch/capture.ts:184", "l2-transcripts/02-relock-add-card.lock-after.json", "l2-transcripts/13-card-change.json"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Harness lock."
  },
  {
    "id": "TOM-L1-14",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "polish",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "Doc drift: the relock change labels omit 'external', and 'every report carries lockState' does not hold for watch --init",
    "expected": "The docs list the 'external' label the code emits; the --init report carries lockState or the doc says it does not.",
    "got": "Live: relocks printed 'added external', 'removed external' and 'changed external'; docs/gate-and-watch.md:295 lists grounding, runtime, peer, pending, runtime commit, runtime via. 'watch --init --json' on a fresh folder: keys = findings only.",
    "evidence": ["docs/gate-and-watch.md:94", "docs/gate-and-watch.md:295", "src/watch/decide.ts:459-460,479-480", "src/watch/index.ts:66", "l2-transcripts/14-accept-card.txt", "l2-transcripts/25-init-fresh.json"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "None."
  },
  {
    "id": "TOM-L1-S1",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "strength": true,
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "Unreachable and refused are never green on the day they happen",
    "expected": "An unreachable seller or card is not clean.",
    "got": "Live: offline seller warn, offline card warn, both exit 1; watch --url and the Desk drift: five warns 'not contacted: it is not an https address' plus a 'Not checked from ...' line; the pre-load module never called an uncontacted seller verified and never refused it. Ceiling: after a relock on that day, the card reads clean (TOM-L1-04) and the seller's pin is gone (TOM-L1-03).",
    "evidence": ["src/watch/decide.ts:229-241", "src/watch/external.ts:101-112", "src/watch/published.ts:146-147", "l2-transcripts/09-offline.json", "l2-transcripts/15-card-offline.json", "l2-transcripts/21-watch-url.json", "shots/tomasz/tom-l2-desk-drift-kilnrow.png"],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "n-a",
    "l2_priority": "Guardrail: any fix to TOM-L1-03/04 must keep this."
  },
  {
    "id": "TOM-L1-S2",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "strength": true,
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "senior-quality",
    "title": "A changed Agent Card or seller is counted in stated units, without quoting the stranger",
    "expected": "What changed, in counts with units.",
    "got": "Live: 'In outline: skills: 1 added, 0 removed, 1 changed; it carries 1 JWS signature, not verified here.' and 'In outline: agents: 1 added, 0 removed, 1 changed; outbound hosts: 0 added, 0 removed; front agent: unchanged.' No skill or agent name was quoted.",
    "evidence": ["src/watch/external.ts:88-93,116-121", "src/watch/outline.ts:141-147", "l2-transcripts/13-card-change.json", "l2-transcripts/11-control-pin-kept.json"],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "n-a",
    "l2_priority": "Guardrail."
  },
  {
    "id": "TOM-L1-S3",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "strength": true,
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "adopt follows a rotation only through a key already trusted, names each hop, and needs --yes; verify's text hint names the exact adopt command",
    "expected": "Following a rotation is the verifier's decision, never automatic.",
    "got": "Live: 'rotation 302c8e65a27575a0 -> e5e0ace512a8c3bf ... verified ... A key this verifier already trusts for this origin named its successor. ... nothing adopted: adopting a successor is your decision; rerun with --yes to add it'; then verify 'verified'. The Desk's trust import likewise listed each entry and needed 'Add these 3 to my trust list'.",
    "evidence": ["src/cli/trust-command.ts:260-291", "src/cli/commands.ts:621-627", "l2-transcripts/05-adopt-4501.json", "shots/tomasz/tom-l2-desk-trust-import-offer.png"],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "n-a",
    "l2_priority": "Guardrail."
  },
  {
    "id": "TOM-L1-S4",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "strength": true,
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "The relock prints every changed ref, including removals, with the re-sign reminder",
    "expected": "Nothing leaves the lock without a line.",
    "got": "Live: every relock listed its added, removed and changed refs, including 'removed external' and 'added pending', and ended with the re-sign reminder. Ceiling: 'changed peer' never says that a signer changed (TOM-L1-01).",
    "evidence": ["src/watch/decide.ts:462-490", "src/cli/watch-command.ts:116-123", "l2-transcripts/10-relock-while-D-down.txt", "l2-transcripts/16-relock-card-down.json"],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "n-a",
    "l2_priority": "Guardrail; TOM-L1-01/03 ask it to say more (signer words), not less."
  },
  {
    "id": "TOM-L1-S5",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "strength": true,
    "impact": { "frequency": "med", "reachability": "low", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "The pre-load check reads an unsigned peer as unverifiable in plain words and does not refuse it",
    "expected": "Unsigned is unverifiable, neither good nor bad.",
    "got": "Live in Chromium (the shipped module, alias arm): {verdict: unverifiable, signed: false, refuse: false, detail: 'The peer publishes no signature, so who published its definition cannot be told.'}. On live loopback addresses: unverifiable 'The peer was not contacted: it is not an https address.', refuse false.",
    "evidence": ["src/browser/preload.ts:82,151-162,187", "l2-transcripts/22-desk.json"],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "n-a",
    "l2_priority": "Guardrail; the target for TOM-L1-06's other surfaces."
  },
  {
    "id": "TOM-L1-S6",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "strength": true,
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "init is honest where watch --init is not: on an existing lock it says 'kept' and turns each --source into a 'Not added' line",
    "expected": "A flag that cannot act says so.",
    "got": "Not re-run at L2 (init --source on the existing lock). Live only: 'init --external' is refused with 'unknown argument --external', exit 2, which is honest. L1's executed evidence stands.",
    "evidence": ["src/cli/init-command.ts:132-136,171"],
    "code_check": "n-a",
    "verdict": "uncertain",
    "resolution": "n-a",
    "l2_priority": "Re-run 'plumbline init --root site --source index.html' on kiln-row's onboarded lock at the next L2."
  },
  {
    "id": "TOM-L2-01",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "The CLI's --relock, run where it cannot contact the sellers, replaces every pin and the Agent Card with pending or nothing, and exits 0",
    "expected": "A relock that cannot re-capture a pinned peer or card keeps its previous record (or refuses), so accepting one change never destroys the rest of the inventory.",
    "got": "Real CLI 'watch --root site --relock' on the marketplace lock pinned through the harness (staged sellers on http): 'added pending' x4, 'removed peer' x4, 'removed external ...agent-card.json', five warns '(the address is not https)', exit 0; lock after: 0 peers, 4 pending, 0 external. Every pending line then advises 'run watch --relock once it answers', which is this command. The same happens to any lock if a relock runs during an egress outage. I ran it once by accident; recovery needed a lock copy I happened to have.",
    "evidence": ["src/watch/capture.ts:144-185", "src/watch/index.ts:98-121", "src/watch/decide.ts:327", "l2-transcripts/06-cli-relock.json", "l2-transcripts/06-after-cli-relock.lock.json", "l2-transcripts/06-pre-drop.lock.json"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Real CLI. Recertify: the same relock on the same lock keeps each previous record and says so."
  },
  {
    "id": "TOM-L2-02",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L2",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "--drop <peer url> says the peer 'was not in the lock' (it was) and then accepts it with everything else",
    "expected": "--drop either takes a peer out (with a line saying so) or refuses a peer address with a reason that names what --drop takes; never a false statement about the lock.",
    "got": "'local-cli watch --relock --drop http://127.0.0.1:4502/brackenfold_shop': 'changed peer ...ashgrove_studio', 'changed peer ...brackenfold_shop', 'info grounding http://127.0.0.1:4502/brackenfold_shop: This ref was not in the lock, so there was nothing to drop.', exit 0. brackenfold's swapped signer was accepted. The code compares the drop list with grounding refs and externals only.",
    "evidence": ["src/watch/index.ts:104-118", "docs/gate-and-watch.md:299-301", "l2-transcripts/06-pre-drop.lock.json"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Harness arm (the same code path runs in the CLI; the CLI could not reach the sellers here)."
  },
  {
    "id": "TOM-L2-03",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "verify (CLI and Desk) gives a swapped signer the same verdict as a seller never met, and the Desk offers 'First contact: trust this publisher?' while another key is trusted for that origin",
    "expected": "When the trust file holds a different key for the origin, verify says so ('this origin's trusted key is X; this signature is by Y, with no rotation from X') and does not frame it as first contact.",
    "got": "brackenfold (trust list holds da6b4cd40dd30fdd for http://127.0.0.1:4502, now signed by 8d80d8e4c1567c52): Desk 'UNVERIFIABLE ... You have not met this signer yet, or the site publishes no signature.' with 'First contact: trust this publisher?' and a 'Trust this publisher for this origin' button, the trusted key visible on the same screen; dovetail, never trusted, renders the same text and the same offer. CLI verify --json: the same detail for both, exit 1. Code: verify only looks up (kid, origin); no branch for 'another key is trusted for this origin'.",
    "evidence": ["src/core/verify.ts:236-262", "shots/tomasz/tom-l2-desk-verify-4502.png", "shots/tomasz/tom-l2-desk-verify-4504.png", "l2-transcripts/21-verify-4502.json", "l2-transcripts/21-verify-4504.json"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Desk (Chromium) + real CLI."
  },
  {
    "id": "TOM-L2-04",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L2",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "The Desk's drift view calls a signed lock 'Unsigned lock: the host can rewrite it' whenever the visitor has not trusted its signer",
    "expected": "A signed lock whose signer the visitor does not trust reads as 'signed by a key you have not trusted' (unverifiable), not 'unsigned'.",
    "got": "Kiln Row's lock, signed by 53db8504e12da0b0: with Tomasz's seller trust list, 'Drift read: 5 findings, the worst Warning. Unsigned lock: the host can rewrite it.'; control arm, same lock with Kiln Row's key imported: 'Signed lock: covered by a signature that verified under a publisher you trust.' Every shopper's browser, which has never trusted Kiln Row, sees 'unsigned'. The consequence sentence is right; the word folds unverifiable into unsigned.",
    "evidence": ["site/desk.js:577-584", "site/strings.js:90,112", "shots/tomasz/tom-l2-desk-drift-kilnrow.png", "shots/tomasz/tom-l2-desk-drift-kilnrow-trusted.png", "l2-transcripts/23-desk-control.json"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Desk (Chromium), with its control arm."
  },
  {
    "id": "TOM-L2-05",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L2",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "The pending line drops why a seller could not be captured and says 'once it answers' of sellers that answer; a refused address uses the offline template in watch --root",
    "expected": "The pending line carries the capture reason; a seller refused by the address rule reads the same on every surface ('was not contacted: it is not an https address').",
    "got": "init: '... pending ... (the address is not https).' Every later watch: '... pending since 2026-11-18), so it is not watched; run watch --relock once it answers.' for four sellers that were answering. For pinned loopback sellers, watch --root: 'A peer could not be reached (the address is not https), so it was not checked.' (the template an offline seller gets: '(the connection failed)'); watch --url and the Desk: 'A peer in this lock was not contacted: it is not an https address, ...'. One situation, two sentences.",
    "evidence": ["src/watch/decide.ts:237-238", "src/watch/decide.ts:327", "src/watch/decide.ts:446-447", "l2-transcripts/00-watch.json", "l2-transcripts/03-baseline.cli.json", "l2-transcripts/21-watch-url.json"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Real CLI."
  },
  {
    "id": "TOM-L2-06",
    "journey": "j5-vetting-sellers",
    "character": "tomasz-wieczorek",
    "cert_level": "L2",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "low", "trust_erosion": "low" },
    "dimension": "missing",
    "title": "The pre-load check cannot tell staged sellers apart: four states, one sentence, and no way to rehearse it before production",
    "expected": "A rehearsal path (as verify --allow-local has) so the platform team can see what shoppers' browsers will be told for a signed, rotated, swapped and unsigned seller before going live.",
    "got": "Live in Chromium (shipped module): all four sellers 'The peer was not contacted: it is not an https address.' (driver expect failed, exit 2). The https alias arm reaches them but every signed seller then reads 'the signature names a different origin' by design. Only the unsigned answer could be observed per state.",
    "evidence": ["src/browser/preload.ts:151-162", "src/watch/decide.ts:436-443", "l2-transcripts/22-desk.json"],
    "code_check": "by-design",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Not exercisable here for signed/rotated/swapped sellers. Fixture that closes it: kiln-row sellers served over https on loopback with a local CA the test browser trusts (or world sellers signed for https://<port>.seller.example origins and routed with page.route), then the same four pre-load calls."
  }
]
```

## L2 verdict

**L2-fail.** Nothing crashed and nothing reached the severity of a blocker: with the test harness, three hand-edits of a
signed lock, a re-add of the card and a lock copy to recover from one relock, Tomasz got through the week. But the
journey's goal is "from the product's output alone", and live that failed: 0 to 4 of 25 inventory cells per event came
from a JSON field, the swapped signer stayed blocked only through hand-edits the product undid three times, the card
vanished from the lock and then read clean, and every seller event needed the test harness. Criteria **1 of 8** (L1: 1 of
8; none moved, four failed harder). L1 findings: **19 confirmed, 0 refuted, 1 uncertain** (TOM-L1-S6, not re-run). New:
6 (TOM-L2-01 to -06; 5 confirmed, 1 uncertain).

**Time saved:** event week **about -5 min (slower than his 40-minute script; confidence medium)**: ~45 min live against
L1's estimated 28. Quiet week ~28 min saved (~12 min with the side checks; medium). Blended at one eventful week in
three: **about 17 min/week (low-medium)**, short of his 30-minute target, and the eventful weeks are the ones that matter.

**What the L1 surface model missed:** the real CLI's relock destroying a lock it cannot re-capture (TOM-L2-01); the false
`--drop` sentence (TOM-L2-02); the hand-edit workaround being undone by every relock (now in TOM-L1-01's frequency);
`verify` and the Desk treating a swapped signer as first contact while the old key is trusted (TOM-L2-03); the Desk's
"Unsigned lock" label for a signed lock (TOM-L2-04); the pending line losing its reason (TOM-L2-05); the pre-load check
being unrehearsable for staged sellers (TOM-L2-06); and that `onboarded`'s "existing lock" pins no seller at all on
this host.

## Character feedback (L2)

Live, it was worse than on paper, and in the places I care about most. On paper I lost the inventory at the joins. Live
I lost it on day one. The "existing lock" pinned none of my sellers, and the only way to pin them was a test harness the
product doesn't ship. Then I added one Agent Card and the same command pinned four sellers I hadn't reviewed.

The swapped signer is the story of my week. The watch blocked it, good. Then I accepted the seller who rotated properly,
and the swap went in too. I put the old key back by hand in a file I'm supposed to sign. The next relock, for the card,
quietly accepted the swap again, and so did the one after that. Three times in one week I re-did a manual fix to a signed
file, because the product's only accept button doesn't know what my trust file says. And when I opened the Desk to look
at that seller, it showed me the old key in my trust list on the left and "First contact: trust this publisher?" with a
button on the right. That button is how a swapped key gets trusted in a payments shop.

Then I made one honest mistake. I ran the real CLI's relock and it wiped every pin and the card, exit 0. The pending
lines had told me to run exactly that command. I recovered only because I had a copy of the lock. A tool that loses my
inventory when I follow its own advice can't be the system of record.

What's still right, and I'd defend it: nothing offline was ever green on the day it went down, the card and seller
diffs count in units I can put in a policy, and `adopt` is careful in exactly the way it should be. The Desk is honest
about what it didn't contact. But I can fill four cells of my 25-cell table from the JSON on a good day and none on a bad
one. The Desk calls our signed lock "unsigned" to every shopper. And the product still has three words for "unsigned"
and none of them is a state.

Would I adopt it? As an alarm next to my own hash script, yes; it sees signers, and my script doesn't. As the inventory,
or the thing that accepts changes, no, and live I'm less sure than I was on paper. Would I tell a peer? I'd tell them the
trust model is right, and never to run `--relock` unless every seller and the card answer and nobody's signer has moved.

## Residue

- `npm run build` and `npm run build:site` rewrote `dist/` and `site/lib/plumbline/` in the repository (build outputs;
  `git status` shows no tracked change).
- A redirect slip wrote `C:\Users\kazda\AppData\Local\tom-up.json` (the `world.mjs up` JSON); I moved it into the world's
  folder within a minute, and it was removed with the world. Confirmed absent.
- This run folder: `shots/tomasz/` (9 shots, each `.png`, `.aria.yml`, `.txt`) and `shots/tomasz/l2-transcripts/`
  (115 files, 513 KB: CLI/harness text and JSON, lock copies, trust files that hold public keys only, the world's
  `requests.log` and `cli.log`; scanned, no private key material).
- Session scratchpad (outside the repository): `tom.sh`, `inventory.mjs`, `sig500-arm.mjs`, `desk.js`.
- Everything else (Kiln Row's key, the constructed seller key, edits to dovetail's network, the world `control.json`
  toggles, the accidental CLI relock of the world's lock, site copies) was inside the world's temp folder.
  `world.mjs down kiln-row`: `stopped: true`, `portsStillInUse: []`, `folderGone: true`, `leftovers: []`; server pid
  23872 gone; no `plumbline-uat-kiln-row*` folder left. `netstat` showed only TIME_WAIT sockets (PID 0) on 4500/4501, as
  env.md expects.
- No git write, no product, doc, overlay or fixture edit, and no key under the repository or a `keys/` folder was read.

---

## Recertify 2026-11-18

Independent recertifier (not the fixer). Range under test: `15af680..c9f6a3b` (31 commits: UAT-1 to UAT-9 and their pins,
harness and stub updates). World `kiln-row` only (ports 4500-4505, Desk 4599). Raw transcripts (every text and `--json`
body with its exit code, every lock before and after each relock, the Action runs' `relock.json` and `body.md`, the gh
stub's final state, the world's request and CLI logs, the inventory script) are in `shots/tomasz-recert/t/` and cited
below by file stem; Desk shots are in `shots/tomasz-recert/` by stem.

### Freshness and fixture checks

| Check | Result |
| --- | --- |
| `npm run build`, `npm run build:site` | both exit 0 ("build:site: 28 browser modules") |
| `dist/` newer than the last commit | `dist/cli/index.js` and `dist/watch/index.js` 14:56:27, `site/lib/plumbline/browser/preload.js` 14:56:28; HEAD `c9f6a3b` 14:53:09 +0100. Fresh. `grep -c accept-signer dist/cli/watch-command.js` = 7 |
| `git diff 15af680..HEAD --stat -- uat/fixtures uat/characters uat/journeys uat/rubric.md` | **empty**: no fixture, Character, journey or rubric was changed to make the product pass |
| Harness changes in range (`uat/driver/`) | `local-cli.mjs` passes `--accept-signer`, `--accept`, `--trust` through to the built `runRelock` and prints a `RelockRefused` as `src/cli/watch-command.ts printRefusal` does (read line by line: same sentences, same JSON keys, exit 1; `--drop <peer>` exit 2). `gh-stub.mjs` learned `pr comment`. `run-action.mjs` passes `REPORT` to the issue step. None of them decides a verdict |
| Node | v24.22.1 (as at L2) |
| Arms | the real CLI wherever it reaches (`watch --root` against the lock, `--init --external`, a `--relock` that reaches no seller, `--drop`, `--accept`/`--accept-signer` parsing, `keygen`, `sign`, `trust`, `verify`, `adopt`, `init --source`); the harness (`uat/driver/local-cli.mjs`) for every watch and relock that must contact a loopback seller or the card (the CLI still cannot: UAT-21 not built); the Desk in Chromium through `drive-script.mjs` with `expectMatch`; the Action through `run-action.mjs --harness --relock-pr true`. One constructed arm: a 500 on a signature through the product's `WatchDeps.fetch` seam (`serve.mjs` has no 500), as the fixer and the L2 did |

### Journal

**Monday, the existing lock.** `world.mjs up kiln-row`, exit 0; `onboarded` again pins no seller (four `pendingPeers`).
Real CLI watch (`01-onboarded-cli`, exit 1, text and JSON):

```
warn  peer http://127.0.0.1:4501/ashgrove_studio: A peer could not be captured when the lock was written (pending since 2026-11-18), so it is not watched; it was not contacted now either: it is not an https address, an address Plumbline does not contact.
  ... the same for brackenfold_shop, copperwick_glass, dovetail_loom
```

The pending line now carries its reason (TOM-L2-05). The card, the documented-first way, real CLI
(`02-init-external-https`): `watch --root site --init --external a2a-card=https://tidewater-studio.example/...` printed a
plain watch, exit 1 only from the four pending warns, `--json` `{"lockState":"found","findings":[...]}`; lock sha256
`b6cb1619cfcbc798` before and after; the world served 0 requests. Nothing says the flag was ignored (TOM-L1-05; UAT-14 is
not built). `--relock --external a2a-card=http://127.0.0.1:4505/...` (real CLI): "--external takes an https address
without credentials", exit 2. Harness `--relock --external` (`03-relock-add-card`, exit 0): `added external
...agent-card.json`, `added peer` x4, `removed pending` x4, findings `[]`. Lock after: ashgrove `kid fb6fcb1b539f9c72`,
brackenfold `kid 94b090a84b42fb09`, copperwick and dovetail no `kid`; the card `{kind, sha256, parts, checkedAt}` (no
signature count: TOM-L1-13). Then, with the real CLI: `keygen` Kiln Row's key in the world folder (`c8c0f280b50e432d`),
`sign` the site, publish its key record, `trust --url` 4501 and 4502 (`--yes`, exit 0 each; 4503 and 4504 "key.json not
found", exit 2).

Baseline: harness watch `04-baseline` shows only the upstream `info`, exit 0 (the two unsigned sellers: no line). Real
CLI watch `04-baseline-cli`, exit 1: five warns `A peer in this lock was not contacted: it is not an https address, an
address Plumbline does not contact, so it was not checked.` (one sentence for one situation now: the CLI, `watch --url`
and the Desk agree). `verify --url --json` (`04-verify-450x`): 4501 and 4502 `verified`, exit 0; **4503 and 4504
`{"results":[{"verdict":"unverifiable","detail":"This site publishes no plumbline.signature.json (http://127.0.0.1:4503/), so nothing can be verified."}]}`, exit 1** (was `{"error"}`, exit 2).

**Tuesday and Wednesday, `seller-rotates` and `seller-signer-swapped` together** (ashgrove fb6f... -> 56f28eb50f669067
by a published rotation; brackenfold 94b0... -> 08825631fb57f303, no rotation). Harness watch, exit 1 (`05-watch`):

```
block peer http://127.0.0.1:4501/ashgrove_studio: A peer is now signed by a different key than the one the lock recorded: a rotation statement from the locked key is published (not verified here). A relock refuses it until a person decides: watch --relock --accept-signer <this peer>.
block peer http://127.0.0.1:4502/brackenfold_shop: A peer is now signed by a different key than the one the lock recorded: a different key, with no rotation published. A relock refuses it until a person decides: watch --relock --accept-signer <this peer>.
```

With `--trust` (`05-watch-trust`): ashgrove "...: it rotated from the key the lock recorded, verified against your trust
file. ..."; brackenfold unchanged. The JSON objects differ only by `ref`, the kids and that `summary` (no field says
rotation or swap). `verify --json` (`06-verify-4501/4502`, exit 1 each): ashgrove "This origin's trusted key is
fb6fcb1b539f9c72; this signature is by 56f28eb50f669067, and the site publishes a rotation from fb6fcb1b539f9c72: check
it with adopt before trusting 56f28eb50f669067."; brackenfold "This origin's trusted key is 94b090a84b42fb09; this
signature is by 08825631fb57f303, with no rotation from 94b090a84b42fb09: a different key signing for an origin you trust
is not a first contact, so ask the publisher out of band before trusting it." `adopt` (`06-adopt-*`): ashgrove without
`--yes` exit 1, `--json` still `"added":false, ... "adopted":["56f28eb50f669067"]` (TOM-L1-10); brackenfold
`{"error":"plumbline-rotation.json not found in http://127.0.0.1:4502/"}`, exit 2 (TOM-L1-09).

**The plain relock refuses** (`07-plain-relock`, exit 1 text and JSON; lock bytes identical before and after both runs):

```
relock refused: a peer is signed by another key than the lock recorded, and a relock does not accept a new signer unless a person names it. Nothing was written.
  peer http://127.0.0.1:4501/ashgrove_studio: the lock recorded fb6fcb1b539f9c72; it is now signed by 56f28eb50f669067 (a rotation statement from the locked key is published (not verified here))
  peer http://127.0.0.1:4502/brackenfold_shop: the lock recorded 94b090a84b42fb09; it is now signed by 08825631fb57f303 (a different key, with no rotation published)
After deciding whether you trust the new key (verify --url, adopt for a rotation), run: plumbline watch --root .../kiln-row/site --relock --accept-signer http://127.0.0.1:4501/ashgrove_studio --accept-signer http://127.0.0.1:4502/brackenfold_shop
json: {"relocked":false,"refused":"signer","peers":[{peer,from,to,how} x2],"command":"..."}
```

The same with `--trust` (`07b`), with ashgrove's `how` reading "verified against your trust file". **The policy
decision.** `adopt --url 4501 --yes --json`: `"added":true`, exit 0. `--relock --accept-signer <ashgrove>` alone
(`08a`): refused, exit 1, naming brackenfold only, lock unchanged. `--relock --accept <ashgrove> --accept-signer
<ashgrove> --trust` (`08b`, exit 0):

```
relock: wrote plumbline.lock.json (the previous lock was found)
changed peer http://127.0.0.1:4501/ashgrove_studio
signer  peer http://127.0.0.1:4501/ashgrove_studio: fb6fcb1b539f9c72 -> 56f28eb50f669067 (it rotated from the key the lock recorded, verified against your trust file; backed by your trust file)
```

Lock after: ashgrove `56f28eb50f669067`, brackenfold still `94b090a84b42fb09`. Before re-signing, the watch
(`09-watch-before-resign`) adds `block grounding plumbline.signature.json: The site's signature no longer covers its
files ...`; after `sign`, `09-watch` (with `--trust`) shows brackenfold's `block` alone, exit 1.

**Trying to break the accept path** (each arm on a copy of the site; refusals on the live lock wrote nothing):

| Arm | What a person runs | Result | Holds? |
| --- | --- | --- | --- |
| B4 (`10-B4`) | `--relock --accept <brackenfold>` without `--accept-signer` | refused, exit 1, lock unchanged | yes |
| B5 (`10-B5`, `10-B5b`) | `--accept-signer` with a trailing slash, or `HTTP://` | refused, exit 1, naming the real ref | yes |
| B2 (`10-B2`) | pastes the first refusal's own command | exit 0: `signer peer ...ashgrove_studio ... (a rotation statement ... (not verified here); not checked: no --trust file given)` and `signer peer ...brackenfold_shop: 94b090a84b42fb09 -> 08825631fb57f303 (a different key, with no rotation published; not checked: no --trust file given)`. The swap is accepted beside the rotation, by the command the refusal composed | named only by the product's own one-line command (TOM-RC-3) |
| **B1** (`11-B1-0` to `11-B1-5`) | brackenfold's `plumbline.signature.json` answers 404 for a while (the world's own `notFound` control); Tomasz runs an ordinary plain relock that day, and another after it returns | 404 watch: `warn ... no longer shows a usable signature (none is published).` Plain relock: **exit 0, not refused**, `changed peer ...brackenfold_shop`, `warn ... A peer the lock recorded as signed publishes no signature now; the new lock records it as unsigned.`; the record is now `{sha256, links, outline, checkedAt}` with no kid. Signature back: `info ... A peer that was unsigned when locked now publishes a signature; re-lock to record its key.` (with the site signed, that watch exits 0). Plain relock: exit 0, `changed peer ...brackenfold_shop`, no `signer` line; brackenfold pinned `08825631fb57f303`. Watch after `sign`, **with and without `--trust`: exit 0, only the upstream info** | **no: broken.** Plain relocks only, brackenfold never named, swapped key pinned, watch clean (TOM-RC-1) |
| B3 (`12-B3-1` to `12-B3-4`) | delists brackenfold from `kiln_row.network.json` (a policy hold), relocks, relists, relocks | `removed peer`, then `added peer ...brackenfold_shop` with no signer line; kid `08825631fb57f303`; watch with `--trust` exit 0 | no, but he removed and re-added the seller himself (TOM-RC-4) |
| Action (`40` to `44`, `action-r0` to `action-r4`) | CI with `relock-pr: true`, `--harness` | r0, signer change pending: relock.json `{"relocked":false,"refused":"signer",...}`, no PR, issue #1 carries "**A relock refuses while a peer's signer changed** ... run `... --relock --accept-signer http://127.0.0.1:4502/brackenfold_shop`". **r1, brackenfold's signature 404**: CI's plain relock was not refused; draft PR #2 "What the new lock changes: changed `peer ...brackenfold_shop`" and, under "**What this relock does not accept, or keeps as it was** (these keep reporting after a merge)": "warn ... the new lock records it as unsigned." The issue comment: "No longer reported: **block** peer `...brackenfold_shop`". A person signs and merges PR #2 with the signature back (a first attempt failed on my clone's line endings and left main unmerged; r2 then raised the `block` again, which is the control arm). r3: watch `info` only, findings 0, **issue #1 closed: "Plumbline watch is clean ..."**. r4, after an unrelated drift (`card-offline`): draft PR #4 relocks with `changed peer ...brackenfold_shop` and nothing else about it; its branch lock pins brackenfold `08825631fb57f303` | **no: CI relocks over the swap** once a 404 window has passed, and its PR files the kid's removal under "keeps reporting after a merge" (TOM-RC-1, TOM-RC-2) |

**Thursday, `seller-offline`** (dovetail refuses). Watch `13-offline`: brackenfold `block` and `warn ... dovetail_loom: A
peer could not be reached (the connection failed), so it was not checked.`, exit 1. Control copy taken (no relock). A
plain relock is refused for brackenfold (`14a`, exit 1). With `--accept <dovetail>` (`14-accept-D-offline`, exit 0):
`no ref changed` and `warn ... dovetail_loom: A peer could not be re-read (the connection failed), so the lock keeps its
earlier pin (recorded 2026-11-18); every watch compares the peer with that pin.`; dovetail's record identical before and
after, `pendingPeers` empty. **Real-CLI relock that can reach no seller** (copy, `15-cli-relock-reaches-none`, exit 0):
`no ref changed`, four "could not be re-read (it is not an https address), so the lock keeps its earlier pin" warns and
"An external agent definition could not be re-read (it could not be read), so the lock keeps its earlier record"; lock
after: 4 peers with their kids (ashgrove 56f2..., brackenfold still 94b0...), 0 pending, 1 external.

**`seller-back-changed`** (dovetail returns with `deposit_taker` added, signed for the first time by `c195cf32f3013c23`).
Main arm, after the relock during the outage (`16-back-changed`), and control arm with no relock
(`16-back-changed-control`): **identical**, exit 1:

```
block peer http://127.0.0.1:4504/dovetail_loom: A peer's network definition changed since the lock was written; ... In outline: agents: 1 added, 0 removed, 1 changed; outbound hosts: 0 added, 0 removed; front agent: unchanged.
info  peer http://127.0.0.1:4504/dovetail_loom: A peer that was unsigned when locked now publishes a signature; re-lock to record its key.
```

Accepted after review with `--accept <dovetail> --trust` (`17-accept-D`): `changed peer ...dovetail_loom`, and no
`signer` line although `--trust` was given and `c195cf32f3013c23` is in no trust file. `17-watch`: brackenfold alone.

**Friday, the card.** `card-offline`: `warn ... agent-card.json: An external agent definition could not be reached (the
connection failed), so it was not checked.` (`18`). Relock while it is down (`19-relock-card-down`, `--accept <card>`,
exit 0): `no ref changed`, `warn ... could not be re-read (the connection failed), so the lock keeps its earlier record
(recorded 2026-11-18)`; `external` still holds the card. Next watch with the card still down
(`19-watch-card-still-down`): the same `warn`, exit 1. `card-back` (`20`): the card line is gone. `card-skills-change`
(`21`): `block ... In outline: skills: 1 added, 0 removed, 1 changed; it carries 1 JWS signature, not verified here.`;
`--accept <card>` (`22`): `changed external ...`; the card entry is still `{kind, sha256, parts, checkedAt}`.

**Saturday, `seller-signs`** (copperwick `e071876104539b5a`). `23-seller-signs`: `info ... copperwick_glass: A peer that
was unsigned when locked now publishes a signature; re-lock to record its key.`; `verify --json` `unverifiable` with the
kid, exit 1. `--accept <copperwick> --trust` (`24`): `changed peer ...copperwick_glass`, no signer line. **`--drop
<peer>`** (`25-drop-peer-cli`, real CLI, and `25-drop-peer-har`): exit 2, "--drop takes a grounding ref or an external
definition the lock holds; http://127.0.0.1:4502/brackenfold_shop is a peer, which leaves the lock when no network names
it: remove it from the site's network (or links.json), then relock"; lock unchanged. **End of week** (`26-watch-final`):
brackenfold's `block` is still there after six relocks (two refused, four narrowed); `26-verify-450x` give four kids.

Other checks: the constructed 500 on ashgrove's signature during a relock (`27-arm500`): `warn ... A peer's signature
could not be read at capture (its signature request answered HTTP 500), so the lock keeps the key it recorded before`;
the kid is still `56f28eb50f669067`. `init --root <copy> --source index.html` on the existing lock (`28`): "init: kept
the plumbline.lock.json that is there ..." and "Not added: a lock was already there ...", lock unchanged (TOM-L1-S6
confirmed live). `watch --init --json` on a fresh folder (`29`): keys `findings`, `facts`, no `lockState` (TOM-L1-14).
Real CLI `--relock --accept <brackenfold> --accept-signer <brackenfold> --trust` on a copy (`31`): the flags parse and act
("Named with --accept-signer, but this relock changes no signer for it"), but the CLI still reaches no loopback seller.

**The Desk** (Chromium via `drive-script.mjs`, exit 0, `30-desk.json`; the trust file was imported through the Desk's own
offer, shot `tom-rc-desk-trust-import-offer`):

| Surface | Matched text (expectMatch) | Shot |
| --- | --- | --- |
| verify 4501 (rotated, adopted) | "VERIFIED ... It does not mean the site is safe, honest or correct.", signer 56f28eb50f669067 | `tom-rc-desk-verify-4501` |
| verify 4502 (swapped, old key trusted) | "A different key signed this site than the one you trust for its address, and no rotation you can check links them: this is not a first contact." and the CLI's detail; **0 first-contact panels** | `tom-rc-desk-verify-4502` |
| verify 4503 (signature served 404 for the check) | "UNVERIFIABLE ... This site publishes no plumbline.signature.json, so nothing can be verified." | `tom-rc-desk-verify-4503-unsigned` |
| drift of `http://127.0.0.1:4500/` (signed by Kiln Row; the visitor trusts only the sellers) | status "Drift read: 5 findings, the worst Warning. Lock signed by a key you have not trusted."; body "Signed lock, by a key you have not trusted: until you trust that key, the host could rewrite it." and five "was not contacted: it is not an https address" warns | `tom-rc-desk-drift-kilnrow` |
| partners | 0 inputs (no way to ask about Kiln Row's sellers) | `tom-rc-desk-partners` |

One of my checks was vacuous and is not cited: "4502 never reads verified" read the first line, which is the icon `?`.

### Per-act finding table (recertify; harness watch unless marked)

| Act | kind / severity | Exact sentence (abridged after the first clause where long) | Exit |
| --- | --- | --- | --- |
| `onboarded` (real CLI) | peer / warn x4 | A peer could not be captured when the lock was written (pending since 2026-11-18), so it is not watched; it was not contacted now either: it is not an https address, an address Plumbline does not contact. | 1 |
| baseline, unsigned sellers | none | (no line: unsigned is still silent) | 0 |
| baseline (real CLI, pinned loopback sellers) | peer / warn x5 | A peer in this lock was not contacted: it is not an https address, ... so it was not checked. | 1 |
| `seller-rotates` | peer / block | ... different key than the one the lock recorded: a rotation statement from the locked key is published (not verified here). ... (with `--trust`: it rotated from the key the lock recorded, verified against your trust file.) | 1 |
| `seller-signer-swapped` | peer / block | ... different key than the one the lock recorded: a different key, with no rotation published. ... | 1 |
| `seller-offline` | peer / warn | A peer could not be reached (the connection failed), so it was not checked. | 1 |
| relock during the outage | (relock) peer / warn | A peer could not be re-read (the connection failed), so the lock keeps its earlier pin (recorded 2026-11-18); ... | relock 0 |
| `seller-back-changed`, after that relock | peer / block + peer / info | ... In outline: agents: 1 added, 0 removed, 1 changed; ... / A peer that was unsigned when locked now publishes a signature; re-lock to record its key. (**= control arm**) | 1 |
| `card-offline`, before and after a relock | peer / warn | An external agent definition could not be reached (the connection failed), so it was not checked. | 1 |
| `card-skills-change` | peer / block | An external A2A Agent Card changed ... In outline: skills: 1 added, 0 removed, 1 changed; it carries 1 JWS signature, not verified here. | 1 |
| `seller-signs` | peer / info | A peer that was unsigned when locked now publishes a signature; re-lock to record its key. | 0 alone |
| a signed seller's signature 404 (B1) | peer / warn | A peer that was signed when locked no longer shows a usable signature (none is published). | 1 |
| the swapped seller's signature back, after a relock during the 404 | peer / info | A peer that was unsigned when locked now publishes a signature; re-lock to record its key. **(= `seller-signs`)** | 0 |

Still indistinguishable: an unsigned seller and a clean one (no line either way); a swapped signer whose hold a
404-window relock erased and a seller signing for the first time (the same `info`). No longer indistinguishable: rotation
vs swap (by sentence), never-captured vs pin-lost (pins are no longer lost), a dropped card vs a healthy one (cards are no
longer dropped), a refused address vs an offline seller.

### Per-finding table

"Reachable" means Tomasz can do it with the product. In this world a relock or watch that must contact a seller runs
through the harness (the CLI's flags are the same and parse: `31`); with https sellers the CLI reaches them.

| Finding | Landed | Reachable | Unblocks his job | Resolution | Ceiling or what is missing |
| --- | --- | --- | --- | --- | --- |
| TOM-L1-01 accept blesses the swap | yes (`07`, `08a`, `08b`) | yes | yes for the week as written: ashgrove accepted alone, brackenfold held through six relocks (`26-watch-final`) | resolved-verified | a 404 window erases the hold (TOM-RC-1); the refusal's one-line command accepts both (TOM-RC-3); on loopback only through the harness |
| TOM-L1-02 rotation = swap | yes (`05-watch`, `06-verify-*`) | yes | yes: the watch and `verify --json` tell them apart | resolved-verified | by sentence only: no field says rotation or swap (UAT-17); `verify`'s `hint:` line is still text-only (the `detail` now carries the fact) |
| TOM-L1-03 offline relock loses the pin | yes (`14`, `15`) | yes | yes: main arm = control arm (`16-*`) | resolved-verified | a kept pin is as fresh as its date; dovetail's first key was recorded with no signer line (TOM-RC-4) |
| TOM-L1-04 offline card dropped | yes (`19`) | yes | yes: still in the lock, still warns while down | resolved-verified | the card's signature count is still not in the lock (TOM-L1-13) |
| TOM-L1-05 `--init --external` silent | no (`02`: lock unchanged, 0 requests) | n/a | no | open | UAT-14 not built |
| TOM-L1-06 unsigned is not a state | partly: `verify` unverifiable exit 1 with a JSON verdict (`04-verify-4503`); Desk unverifiable | yes for `verify` and the Desk | no: the watch still prints nothing for an unsigned seller and the lock still holds only an absent kid | fixed | the watch and lock half |
| TOM-L1-07 no reason codes or time | no | n/a | no: 0 to 6 of 25 cells | open | UAT-17 not built |
| TOM-L1-08 signature error at capture | yes for 5xx (`27-arm500`: kid kept, with a line) | yes (constructed arm) | no: a 404 still drops the kid (now with a line), and that is the hole the accept path breaks through | fixed | the 404 arm (TOM-RC-1); the 5xx arm is constructed, not served by the world |
| TOM-L1-09 adopt without a rotation exits 2 | no (`06-adopt-4502`) | n/a | no | open | UAT-17 |
| TOM-L1-10 `adopted` when `added:false` | no (`06-adopt-4501`) | n/a | no | open | UAT-17 |
| TOM-L1-11 no local rehearsal | no (`01`, `04-baseline-cli`) | n/a | no | open | UAT-21 not built |
| TOM-L1-12 pre-load for own peers | no (`tom-rc-desk-partners`: 0 inputs) | n/a | no | open | UAT-26 |
| TOM-L1-13 card signer column | no (`22` lock: `kind,sha256,parts,checkedAt`) | n/a | no | open | UAT-17 |
| TOM-L1-14 doc drift | no: `docs/gate-and-watch.md:346-347` lists no `external` (nor the new `signer` line); `29`: no `lockState` | n/a | no | open | UAT-14 |
| TOM-L2-01 CLI relock wipes the lock | yes (`15`) | yes, real CLI | yes | resolved-verified | exit 0 "relock: wrote" although nothing was re-read; the card's reason reads "(it could not be read)" where the peers' reads "(it is not an https address)" (TOM-RC-5) |
| TOM-L2-02 false `--drop` sentence | yes (`25-*`) | yes, real CLI | yes: never "was not in the lock" | resolved-verified | refuses rather than drops; its advice (remove from the network, relock) leads to TOM-RC-4 if the seller is relisted |
| TOM-L2-03 swap = first contact | yes (`06-verify-4502`, `tom-rc-desk-verify-4502`) | yes, CLI and Desk | yes: "not a first contact", no trust offer | resolved-verified | in `detail` text only (no field) |
| TOM-L2-04 Desk "Unsigned lock" | yes (`tom-rc-desk-drift-kilnrow`) | yes | yes | resolved-verified | the Desk still contacts no loopback seller |
| TOM-L2-05 pending line drops its reason | yes (`01`, `04-baseline-cli`) | yes, real CLI | yes: one sentence per situation | resolved-verified | the published reader's pending wording was not re-walked (no pending peer in a published lock this week) |
| TOM-L2-06 pre-load unrehearsable | no (`src/browser/preload.ts` unchanged in range) | n/a | no | open | UAT-21, UAT-26 |

Counts: **9 resolved-verified, 2 fixed (not unblocking), 9 open, 0 regressed.** Strengths S1 to S6 re-checked: none
regressed (S6, uncertain at L2, is confirmed live: `28`).

### Inventory from the JSON alone (`t/inventory.mjs`, rules in its header; `t/inv.md`)

| Event | Cells filled from a field | Which |
| --- | --- | --- |
| `onboarded` (real CLI) | **0 of 25** | none |
| baseline, card added | 2 of 25 | signer A, B (verify) |
| rotates + swapped | 2 of 25 | signer A, B (verify) |
| plain relock (refused) | **6 of 25** | A, B: state, signer, reason (`refused:"signer"`, `peers[].to`) |
| accept ashgrove | 1 of 25 | signer A (`signers[].to`) |
| seller-offline | 3 of 25 | B: state, signer, reason (the refused plain relock) |
| seller-back-changed | 0 of 25 | none |
| card-offline | 0 of 25 | none |
| card-skills-change | 0 of 25 | none |
| seller-signs (+ four verifies) | 4 of 25 | signer A to D |

**0 to 6 of 25 (L2: 0 to 4).** The gain comes only from the relock refusal's JSON, a document he gets only by trying to
write the lock. Never fillable: pinned hash, last checked, the card's signer; a reason code exists only as
`refused:"signer"`.

### Scored criteria (recertify)

| # | Criterion | L1 | L2 | Recertify | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | One lock records every seller and the card; the command is documented | pass | pass (harness) | **pass (harness arm)** | `03`; `docs/gate-and-watch.md`; the CLI still cannot reach loopback sellers |
| 2 | Adding the card to an existing lock works or refuses with a reason | fail | fail | **fail** | `02`: lock unchanged, 0 requests, no line |
| 3 | Changed, unreachable, pending, signer-changed and unsigned are distinct and stable | fail | fail | **fail** (narrower) | four of five are now distinct; unsigned still has no line (`04-baseline`) |
| 4 | Unreachable is never clean, never dropped without a line | fail | fail | **pass** | `14`, `15`, `19`, `19-watch-card-still-down` |
| 5 | A rotation is followed with adopt; a bare signer change is a `block` | fail | fail | **fail** (passes on the week as written) | held through six relocks (`26-watch-final`), but B1 ends with the swap pinned and a clean watch, through plain relocks and through the Action (`11-B1-*`, `44`) |
| 6 | Unsigned reads `unverifiable` wherever a verdict is shown | fail | fail | **pass** | CLI `verify` exit 1 with a JSON verdict (`04-verify-4503`), Desk `tom-rc-desk-verify-4503-unsigned`, the pre-load module (unchanged; L2's evidence). Ceiling: the Desk still runs no pre-load for sellers (TOM-L1-12) |
| 7 | `--json` is documented and enough for the inventory | fail | fail | **fail** | 0 to 6 of 25 |
| 8 | The weekly review takes under 10 minutes | fail | fail | **fail** | event week ~25 min (below) |

**Score: 3 of 8** (L1: 1 of 8; L2: 1 of 8). Criterion 5 passes on the journey's own acts and fails on a plausible variant
of them; read on the written acts alone, the score is 4 of 8.

### Time

Every command answered in under a second. The event week as Tomasz would run it (without this recertifier's extra
watches and break arms): 6 watches; 2 verifies and 3 adopts at the signer acts; 1 refused relock, read and turned into an
`--accept`/`--accept-signer` command; 4 narrowed relocks (ashgrove, dovetail, card, copperwick: while brackenfold is held
a plain relock is refused all week, so every accept names its ref); 4 re-signs; a verify at the end; and reading the lock
by hand for the pinned-hash, last-checked and card columns. That is **about 26 steps, ~25 min** (L2: ~40 steps, ~45 min),
with no hand-edits, no lock restore and no card re-add. Against his 40 minutes that is **~15 min saved in the event week
(medium)**, against -5 at L2. A quiet week is one watch plus the side checks he still cannot drop (which sellers are
unsigned, by a `verify` per seller; the inventory columns from the lock): ~8 min, **~32 min saved (low-medium)**, against
~28. Blended at one eventful week in three: **~26 min/week (low-medium)**, against ~17; his target is 30. Grounding: n/a
(J5 uses no AI surface).

### Recertify verdict

**Conditional.** The week now works. The swapped signer stays blocked through every accept, nothing offline loses its
pin, the card survives its outage, and the CLI and the Desk name a swap as a swap and an unsigned seller as unverifiable.
What keeps it from a pass:

- The hold on a swapped signer can be erased without anyone naming the seller: a 404 window at one ordinary relock, then
  any later relock, run by hand or by the Action's pull request, pins the swap.
- Unsigned is still not a state at the watch.
- The inventory still fills only 0 to 6 of 25 cells.
- `watch --init --external` still says nothing.
- Every seller event in this world still needs the test harness.

## Character feedback (recertify)

This is the first time the accept step behaved like a payments tool. I accepted the seller who rotated by the book. I
named it, I gave my trust file, and the change list said "backed by your trust file". The seller who swapped keys stayed
red through four more relocks that week. When I tried to sneak it in with `--accept` alone, or with a trailing slash, the
relock refused. The flaky seller kept its pin through the outage and came back with the same block my control copy
showed. The card stayed in the lock and kept nagging. The relock I ran by accident last time, the one that wiped
everything, now keeps every pin and says so. The Desk calls the swap "not a first contact" and offers no button. That's
what I asked for.

Then I tried to break it the way a seller would, and it broke. Brackenfold took its signature down for an afternoon. My
routine relock that day said "records it as unsigned", in a warn, inside a command that exits 0. When the signature came
back under the swapped key, the watch called it "newly signed": info, green. The next relock pinned the swapped key.
Nobody ever typed brackenfold's name. CI did the same thing on its own. Its pull request filed the dropped key under
"keeps reporting after a merge", the issue closed as clean, and the next pull request pinned the swap with the words
"changed peer". The refusal is solid. The product just forgets what it was refusing when the signature goes missing.

Smaller things. The refusal hands me one command that accepts every peer it refused, the swap included, with no
`--trust`. I'd want one command per seller, or no command at all for a swap. "Unsigned" still makes no sound at the
watch. And my table: six cells out of twenty-five on the best day, and those six come from a refusal message. I still
can't fill "last checked", a reason code or the card's signer.

Would I adopt it? For the watch and the accept step, yes now, with one rule in our policy: a seller who loses its
signature stays on hold, by hand, until it is back under the key we had. For the inventory, not yet. Would I tell a peer?
I'd tell them it finally knows the difference between a rotation and a swap, and that it forgets that difference the
moment a seller blinks.

## Findings (recertify)

```json
[
  {"id": "TOM-L1-01", "journey": "j5-vetting-sellers", "character": "tomasz-wieczorek", "cert_level": "L1", "type": "trust", "severity": "major", "impact": {"frequency": "high", "reachability": "high", "trust_erosion": "high"}, "dimension": "trust", "title": "Accepting one seller's proper rotation with --relock also blesses another seller's swapped signer, and every later relock re-blesses it", "expected": "A seller that rotated properly (adopt verified) can be accepted in the lock on its own; a seller whose signer changed without a rotation stays block.", "got": "Recertify: a plain relock refuses (exit 1, nothing written, both peers named with both kids and how); --accept-signer <ashgrove> alone is refused naming brackenfold; --accept <ashgrove> --accept-signer <ashgrove> --trust writes ashgrove only, with 'signer peer ... (it rotated from the key the lock recorded, verified against your trust file; backed by your trust file)'; brackenfold's pin and block survived six later relocks (two refused, four narrowed).", "evidence": ["shots/tomasz-recert/t/07-plain-relock.json", "shots/tomasz-recert/t/08a-accept-signer-A-only.txt", "shots/tomasz-recert/t/08b-accept-A.txt", "shots/tomasz-recert/t/26-watch-final.json", "src/watch/index.ts:154-211"], "code_check": "present-broken", "verdict": "confirmed", "resolution": "resolved-verified", "ceiling": "The hold lives only in the recorded kid: a relock while the held seller's signature is absent (404) records it unsigned, and the swapped key then returns as 'newly signed' info and is pinned by any plain relock, by hand or by the Action (TOM-RC-1); the refusal's one-line command accepts every refused peer, a swap included (TOM-RC-3); on loopback sellers only through the test harness (UAT-21).", "recertified_in": "15af680..c9f6a3b", "recertify_evidence": "kiln-row, harness relocks with the real CLI's trust and adopt: 07-plain-relock (refused, lock bytes unchanged), 08a, 08b, 10-B4, 10-B5, 26-watch-final (brackenfold still block at the end of the week)"},
  {"id": "TOM-L1-02", "journey": "j5-vetting-sellers", "character": "tomasz-wieczorek", "cert_level": "L1", "type": "confusion", "severity": "major", "impact": {"frequency": "med", "reachability": "high", "trust_erosion": "high"}, "dimension": "clarity", "title": "A proper key rotation and a bare signer swap produce the identical watch finding, and verify's only distinguishing line is text-only", "expected": "The watch says whether the new kid is named by a rotation the peer publishes, so rotation and swap read differently; verify --json carries the rotation hint.", "got": "Recertify: watch 'a rotation statement from the locked key is published (not verified here)' vs 'a different key, with no rotation published' (with --trust: 'it rotated from the key the lock recorded, verified against your trust file'); verify --json detail '... and the site publishes a rotation from fb6fcb1b539f9c72: check it with adopt before trusting ...' vs '... with no rotation from 94b090a84b42fb09: ... not a first contact ...'.", "evidence": ["shots/tomasz-recert/t/05-watch.txt", "shots/tomasz-recert/t/05-watch-trust.json", "shots/tomasz-recert/t/06-verify-4501.json", "shots/tomasz-recert/t/06-verify-4502.json"], "code_check": "present-but-missed", "verdict": "confirmed", "resolution": "resolved-verified", "ceiling": "Told apart by sentence only: neither the finding nor the verify JSON has a field naming rotation or swap (UAT-17); verify's 'hint:' line is still text-only, though the detail now carries the same fact.", "recertified_in": "15af680..c9f6a3b", "recertify_evidence": "05-watch, 05-watch-trust, 06-verify-4501/4502 (real CLI verify --json, exit 1 each)"},
  {"id": "TOM-L1-03", "journey": "j5-vetting-sellers", "character": "tomasz-wieczorek", "cert_level": "L1", "type": "trust", "severity": "major", "impact": {"frequency": "med", "reachability": "high", "trust_erosion": "high"}, "dimension": "trust", "title": "A relock run while a seller is offline discards its pinned hash, kid and outline; it returns changed and re-keyed as 'added peer' with no finding", "expected": "A pinned peer that cannot be re-captured keeps its previous record, and on return the new state is compared with the old pin.", "got": "Recertify: relock during seller-offline: 'no ref changed' and 'A peer could not be re-read (the connection failed), so the lock keeps its earlier pin (recorded 2026-11-18) ...'; record identical, no pending. After seller-back-changed the main arm and the no-relock control arm print the same block 'In outline: agents: 1 added, 0 removed, 1 changed; ...' and info 'unsigned when locked now publishes a signature'.", "evidence": ["shots/tomasz-recert/t/14-accept-D-offline.txt", "shots/tomasz-recert/t/16-back-changed.json", "shots/tomasz-recert/t/16-back-changed-control.json", "shots/tomasz-recert/t/15-cli-relock-reaches-none.txt"], "code_check": "present-broken", "verdict": "confirmed", "resolution": "resolved-verified", "ceiling": "A kept pin is only as fresh as its date; a seller's first signature (dovetail's c195cf32f3013c23) is recorded by a relock with no signer line even with --trust (TOM-RC-4); harness arm on loopback.", "recertified_in": "15af680..c9f6a3b", "recertify_evidence": "14-accept-D-offline, 15-cli-relock-reaches-none, 16-back-changed vs 16-back-changed-control (identical)"},
  {"id": "TOM-L1-04", "journey": "j5-vetting-sellers", "character": "tomasz-wieczorek", "cert_level": "L1", "type": "trust", "severity": "major", "impact": {"frequency": "med", "reachability": "high", "trust_erosion": "high"}, "dimension": "completion", "title": "An Agent Card offline during a relock is dropped from the lock for good, and later watches read clean while it is still offline", "expected": "The card is kept and reported on every watch until it is captured or dropped on purpose.", "got": "Recertify: relock while the card was down: 'no ref changed' and '... could not be re-read (the connection failed), so the lock keeps its earlier record ...'; external still holds the card; next watch with the card still down: the same warn, exit 1; after card-back the line is gone.", "evidence": ["shots/tomasz-recert/t/18-card-offline.txt", "shots/tomasz-recert/t/19-relock-card-down.txt", "shots/tomasz-recert/t/19-watch-card-still-down.json", "shots/tomasz-recert/t/20-card-back.txt"], "code_check": "present-broken", "verdict": "confirmed", "resolution": "resolved-verified", "ceiling": "The card's record still carries no signature count (TOM-L1-13); a real-CLI relock that refuses the card's address says '(it could not be read)' where it says '(it is not an https address)' for peers (TOM-RC-5).", "recertified_in": "15af680..c9f6a3b", "recertify_evidence": "18, 19-relock-card-down, 19-watch-card-still-down, 20-card-back"},
  {"id": "TOM-L1-05", "journey": "j5-vetting-sellers", "character": "tomasz-wieczorek", "cert_level": "L1", "type": "broken-flow", "severity": "major", "impact": {"frequency": "low", "reachability": "high", "trust_erosion": "high"}, "dimension": "trust", "title": "watch --init --external (and --source) on an existing lock does nothing and says nothing, and watch --init never says whether it wrote or kept the lock", "expected": "Either the card is added, or a refusal names --relock.", "got": "Recertify, real CLI: lock sha256 b6cb1619cfcbc798 before and after, 0 requests served, a plain watch printed, --json {lockState: found, findings}; exit 1 only from the pending warns.", "evidence": ["shots/tomasz-recert/t/02-init-external-https.txt", "shots/tomasz-recert/t/02-init-external-https.json"], "code_check": "present-broken", "verdict": "confirmed", "resolution": "open", "recertified_in": "15af680..c9f6a3b", "recertify_evidence": "02-init-external-https: unchanged (UAT-14 not built)"},
  {"id": "TOM-L1-06", "journey": "j5-vetting-sellers", "character": "tomasz-wieczorek", "cert_level": "L1", "type": "trust", "severity": "major", "impact": {"frequency": "high", "reachability": "high", "trust_erosion": "med"}, "dimension": "trust", "title": "'Unsigned' is not a state: the watch is silent, the lock has only an absent kid, and CLI verify exits 2 with an error while the Desk and the pre-load check say unverifiable", "expected": "An unsigned seller reads unverifiable (or an explicit 'unsigned' state) on every surface, with one exit-code meaning.", "got": "Recertify: CLI verify --json {verdict: unverifiable, detail: 'This site publishes no plumbline.signature.json ...'}, exit 1 (landed); Desk verify UNVERIFIABLE. But the watch still prints no line for copperwick and dovetail while they are unsigned, and their lock records still only lack a kid.", "evidence": ["shots/tomasz-recert/t/04-verify-4503.json", "shots/tomasz-recert/tom-rc-desk-verify-4503-unsigned.png", "shots/tomasz-recert/t/04-baseline.json", "shots/tomasz-recert/t/03-relock-add-card.lock-after.json"], "code_check": "by-design", "verdict": "confirmed", "resolution": "fixed", "recertified_in": "15af680..c9f6a3b", "recertify_evidence": "Landed and reachable for verify (real CLI) and the Desk. Does not unblock: the watch and the lock still have no unsigned state, so his unsigned column still needs a verify per seller."},
  {"id": "TOM-L1-07", "journey": "j5-vetting-sellers", "character": "tomasz-wieczorek", "cert_level": "L1", "type": "missing-feature", "severity": "major", "impact": {"frequency": "high", "reachability": "high", "trust_erosion": "med"}, "dimension": "senior-quality", "title": "Drift JSON has no reason code, no timestamp and polymorphic expected/actual, so an inventory needs sentence-matching", "expected": "Each finding carries a code from a closed, documented list; the report carries checkedAt; card and peer are told apart by a field.", "got": "Recertify, the same rules applied mechanically: 0 to 6 of 25 cells per event (L2: 0 to 4); the extra cells come only from the relock refusal's JSON (refused: 'signer', peers[].to); never pinned hash, last checked or the card's signer.", "evidence": ["shots/tomasz-recert/t/inv.md", "shots/tomasz-recert/t/inventory.mjs", "shots/tomasz-recert/t/26-watch-final.json"], "code_check": "confirmed-absent", "verdict": "confirmed", "resolution": "open", "recertified_in": "15af680..c9f6a3b", "recertify_evidence": "inv.md (UAT-17 not built)"},
  {"id": "TOM-L1-08", "journey": "j5-vetting-sellers", "character": "tomasz-wieczorek", "cert_level": "L1", "type": "trust", "severity": "major", "impact": {"frequency": "low", "reachability": "high", "trust_erosion": "high"}, "dimension": "trust", "title": "A signed seller whose signature file errors during a relock is silently locked as unsigned", "expected": "A signature that could not be read at capture is a finding, and the peer keeps its previous kid.", "got": "Recertify: a 500 (constructed through WatchDeps.fetch) gives 'A peer's signature could not be read at capture (its signature request answered HTTP 500), so the lock keeps the key it recorded before', kid kept. A 404 (the world's notFound) gives 'A peer the lock recorded as signed publishes no signature now; the new lock records it as unsigned.', kid dropped, relock exit 0.", "evidence": ["shots/tomasz-recert/t/27-arm500.txt", "shots/tomasz-recert/t/11-B1-2-plain-relock-404.txt", "src/watch/capture.ts:209-224"], "code_check": "present-broken", "verdict": "confirmed", "resolution": "fixed", "recertified_in": "15af680..c9f6a3b", "recertify_evidence": "Landed for 5xx (constructed arm: kid kept, with a line). The 404 arm is no longer silent but still drops the kid, which does not unblock his job: it is how the signer hold is erased (TOM-RC-1)."},
  {"id": "TOM-L1-09", "journey": "j5-vetting-sellers", "character": "tomasz-wieczorek", "cert_level": "L1", "type": "confusion", "severity": "minor", "impact": {"frequency": "med", "reachability": "high", "trust_erosion": "low"}, "dimension": "clarity", "title": "adopt on a seller that published no rotation exits 2 (usage or I/O error), the most important policy signal in the journey", "expected": "A verdict, exit 1, with a JSON field.", "got": "Recertify: unchanged, 'plumbline adopt: plumbline-rotation.json not found in http://127.0.0.1:4502/', exit 2, {\"error\":...}.", "evidence": ["shots/tomasz-recert/t/06-adopt-4502.json"], "code_check": "by-design", "verdict": "confirmed", "resolution": "open", "recertified_in": "15af680..c9f6a3b", "recertify_evidence": "06-adopt-4502 (UAT-17 not built)"},
  {"id": "TOM-L1-10", "journey": "j5-vetting-sellers", "character": "tomasz-wieczorek", "cert_level": "L1", "type": "trust", "severity": "minor", "impact": {"frequency": "med", "reachability": "high", "trust_erosion": "med"}, "dimension": "trust", "title": "adopt --json without --yes lists the successor under 'adopted' although nothing was adopted", "expected": "'adopted' only when added is true.", "got": "Recertify: unchanged, {\"added\":false,\"alreadyTrusted\":false,\"adopted\":[\"56f28eb50f669067\"]}, exit 1.", "evidence": ["shots/tomasz-recert/t/06-adopt-4501.json"], "code_check": "present-broken", "verdict": "confirmed", "resolution": "open", "recertified_in": "15af680..c9f6a3b", "recertify_evidence": "06-adopt-4501 (UAT-17 not built)"},
  {"id": "TOM-L1-11", "journey": "j5-vetting-sellers", "character": "tomasz-wieczorek", "cert_level": "L1", "type": "missing-feature", "severity": "minor", "impact": {"frequency": "med", "reachability": "high", "trust_erosion": "med"}, "dimension": "missing", "title": "The checkout watch cannot be rehearsed against staged (non-https) sellers, and its refusal sentence says the checkout is read from disk when it also fetches peers", "expected": "A local rehearsal path for staging sellers.", "got": "Recertify: unchanged; every seller and card event again needed the harness. The CLI now says 'was not contacted: it is not an https address' consistently (TOM-L2-05) and its relock keeps every pin (TOM-L2-01), so here the CLI is no longer destructive, only blind.", "evidence": ["shots/tomasz-recert/t/01-onboarded-cli.txt", "shots/tomasz-recert/t/04-baseline-cli.txt", "shots/tomasz-recert/t/31-cli-accept-flags.txt"], "code_check": "by-design", "verdict": "confirmed", "resolution": "open", "recertified_in": "15af680..c9f6a3b", "recertify_evidence": "01, 04-baseline-cli, 31 (UAT-21 not built)"},
  {"id": "TOM-L1-12", "journey": "j5-vetting-sellers", "character": "tomasz-wieczorek", "cert_level": "L1", "type": "missing-feature", "severity": "minor", "impact": {"frequency": "high", "reachability": "low", "trust_erosion": "med"}, "dimension": "missing", "title": "The pre-load check his shoppers' browsers would rely on runs on the Desk only for its own two partners; its lockFindings are computed and never shown", "expected": "A documented way to run checkPeerBeforeLoad over a site's own peers, and the Desk showing what differs.", "got": "Recertify: the Desk's partner section still has 0 inputs.", "evidence": ["shots/tomasz-recert/tom-rc-desk-partners.png", "shots/tomasz-recert/t/30-desk.json"], "code_check": "confirmed-absent", "verdict": "confirmed", "resolution": "open", "recertified_in": "15af680..c9f6a3b", "recertify_evidence": "30-desk partners_inputs 0 (UAT-26 not built)"},
  {"id": "TOM-L1-13", "journey": "j5-vetting-sellers", "character": "tomasz-wieczorek", "cert_level": "L1", "type": "missing-feature", "severity": "minor", "impact": {"frequency": "high", "reachability": "high", "trust_erosion": "low"}, "dimension": "missing", "title": "The card's signer column is always empty: JWS signatures are counted only in the 'changed' sentence and never written to the lock", "expected": "The lock records the card's signature count.", "got": "Recertify: the card entry after the add and after card-skills-change is {kind, sha256, parts, checkedAt}.", "evidence": ["shots/tomasz-recert/t/03-relock-add-card.lock-after.json", "shots/tomasz-recert/t/22-accept-card.lock-after.json"], "code_check": "confirmed-absent", "verdict": "confirmed", "resolution": "open", "recertified_in": "15af680..c9f6a3b", "recertify_evidence": "03 and 22 locks (UAT-17 not built)"},
  {"id": "TOM-L1-14", "journey": "j5-vetting-sellers", "character": "tomasz-wieczorek", "cert_level": "L1", "type": "confusion", "severity": "polish", "impact": {"frequency": "low", "reachability": "high", "trust_erosion": "low"}, "dimension": "clarity", "title": "Doc drift: the relock change labels omit 'external', and 'every report carries lockState' does not hold for watch --init", "expected": "The docs list the labels the code emits; the --init report carries lockState or the doc says it does not.", "got": "Recertify: docs/gate-and-watch.md:346-347 still lists grounding, runtime, peer, pending, runtime commit, runtime via (no 'external', and not the new 'signer' line); watch --init --json on a fresh folder has the keys findings and facts.", "evidence": ["docs/gate-and-watch.md:346-347", "shots/tomasz-recert/t/29-watch-init-fresh.json", "shots/tomasz-recert/t/08b-accept-A.txt"], "code_check": "present-but-missed", "verdict": "confirmed", "resolution": "open", "recertified_in": "15af680..c9f6a3b", "recertify_evidence": "29, docs read (UAT-14 not built)"},
  {"id": "TOM-L2-01", "journey": "j5-vetting-sellers", "character": "tomasz-wieczorek", "cert_level": "L2", "type": "trust", "severity": "major", "impact": {"frequency": "med", "reachability": "high", "trust_erosion": "high"}, "dimension": "trust", "title": "The CLI's --relock, run where it cannot contact the sellers, replaces every pin and the Agent Card with pending or nothing, and exits 0", "expected": "A relock that cannot re-capture a pinned peer or card keeps its previous record and says so.", "got": "Recertify, real CLI on a copy of the week's lock: 'no ref changed', four 'could not be re-read (it is not an https address), so the lock keeps its earlier pin' warns and one 'keeps its earlier record' for the card; lock after: 4 peers with their kids, 0 pending, 1 external.", "evidence": ["shots/tomasz-recert/t/15-cli-relock-reaches-none.txt", "shots/tomasz-recert/t/15-cli-relock-reaches-none.lock-after.json"], "code_check": "present-broken", "verdict": "confirmed", "resolution": "resolved-verified", "ceiling": "It still exits 0 with 'relock: wrote' when it re-read nothing; the card's reason reads '(it could not be read)' beside the peers' '(it is not an https address)' (TOM-RC-5); a kept pin is as fresh as its date.", "recertified_in": "15af680..c9f6a3b", "recertify_evidence": "15-cli-relock-reaches-none (real CLI)"},
  {"id": "TOM-L2-02", "journey": "j5-vetting-sellers", "character": "tomasz-wieczorek", "cert_level": "L2", "type": "trust", "severity": "minor", "impact": {"frequency": "med", "reachability": "high", "trust_erosion": "med"}, "dimension": "trust", "title": "--drop <peer url> says the peer 'was not in the lock' (it was) and then accepts it with everything else", "expected": "--drop takes a peer out with a line, or refuses with what --drop takes; never a false statement.", "got": "Recertify, real CLI and harness: exit 2, '--drop takes a grounding ref or an external definition the lock holds; http://127.0.0.1:4502/brackenfold_shop is a peer, which leaves the lock when no network names it: remove it from the site's network (or links.json), then relock'; lock unchanged.", "evidence": ["shots/tomasz-recert/t/25-drop-peer-cli.txt", "shots/tomasz-recert/t/25-drop-peer-har.txt"], "code_check": "present-broken", "verdict": "confirmed", "resolution": "resolved-verified", "ceiling": "It refuses rather than drops; following its advice (remove from the network, relock) and later relisting the seller pins whatever key the seller then has, with no signer line (TOM-RC-4).", "recertified_in": "15af680..c9f6a3b", "recertify_evidence": "25-drop-peer-cli (real CLI), 25-drop-peer-har"},
  {"id": "TOM-L2-03", "journey": "j5-vetting-sellers", "character": "tomasz-wieczorek", "cert_level": "L2", "type": "trust", "severity": "major", "impact": {"frequency": "med", "reachability": "high", "trust_erosion": "high"}, "dimension": "trust", "title": "verify (CLI and Desk) gives a swapped signer the same verdict as a seller never met, and the Desk offers 'First contact: trust this publisher?' while another key is trusted for that origin", "expected": "verify says this origin's trusted key is X and this signature is by Y with no rotation from X, and does not frame it as first contact.", "got": "Recertify: CLI verify --json detail 'This origin's trusted key is 94b090a84b42fb09; this signature is by 08825631fb57f303, with no rotation from 94b090a84b42fb09: a different key signing for an origin you trust is not a first contact, ...'; Desk 'A different key signed this site than the one you trust for its address, and no rotation you can check links them: this is not a first contact.' with 0 first-contact panels.", "evidence": ["shots/tomasz-recert/t/06-verify-4502.json", "shots/tomasz-recert/tom-rc-desk-verify-4502.png", "shots/tomasz-recert/t/30-desk.json"], "code_check": "confirmed-absent", "verdict": "confirmed", "resolution": "resolved-verified", "ceiling": "The distinction is in the detail text only; no JSON field names it (UAT-17).", "recertified_in": "15af680..c9f6a3b", "recertify_evidence": "06-verify-4502 (real CLI); 30-desk expectMatch 'different key signed this site' and 'not a first contact', 0 panels"},
  {"id": "TOM-L2-04", "journey": "j5-vetting-sellers", "character": "tomasz-wieczorek", "cert_level": "L2", "type": "confusion", "severity": "minor", "impact": {"frequency": "med", "reachability": "high", "trust_erosion": "med"}, "dimension": "trust", "title": "The Desk's drift view calls a signed lock 'Unsigned lock: the host can rewrite it' whenever the visitor has not trusted its signer", "expected": "A signed lock whose signer the visitor does not trust reads 'signed by a key you have not trusted'.", "got": "Recertify: Kiln Row's lock, signed by c8c0f280b50e432d, with a visitor who trusts only the sellers: status 'Drift read: 5 findings, the worst Warning. Lock signed by a key you have not trusted.'; body 'Signed lock, by a key you have not trusted: until you trust that key, the host could rewrite it.'", "evidence": ["shots/tomasz-recert/tom-rc-desk-drift-kilnrow.png", "shots/tomasz-recert/t/30-desk.json"], "code_check": "present-broken", "verdict": "confirmed", "resolution": "resolved-verified", "ceiling": "The Desk's drift reader still contacts no loopback seller (five 'was not contacted' warns), so here it says nothing about the sellers' states.", "recertified_in": "15af680..c9f6a3b", "recertify_evidence": "30-desk expectMatch 'signed by a key you have not trusted'"},
  {"id": "TOM-L2-05", "journey": "j5-vetting-sellers", "character": "tomasz-wieczorek", "cert_level": "L2", "type": "confusion", "severity": "minor", "impact": {"frequency": "med", "reachability": "high", "trust_erosion": "low"}, "dimension": "clarity", "title": "The pending line drops why a seller could not be captured and says 'once it answers' of sellers that answer; a refused address uses the offline template in watch --root", "expected": "The pending line carries the capture reason; a refused seller reads the same on every surface.", "got": "Recertify, real CLI: pending '... so it is not watched; it was not contacted now either: it is not an https address, an address Plumbline does not contact.'; pinned loopback sellers 'A peer in this lock was not contacted: it is not an https address, ... so it was not checked.', the sentence the Desk prints.", "evidence": ["shots/tomasz-recert/t/01-onboarded-cli.txt", "shots/tomasz-recert/t/04-baseline-cli.txt", "shots/tomasz-recert/tom-rc-desk-drift-kilnrow.png"], "code_check": "present-but-missed", "verdict": "confirmed", "resolution": "resolved-verified", "ceiling": "The reason is asked again at each watch, not stored from capture time; the published reader's (watch --url, Desk) pending wording was not re-walked this week.", "recertified_in": "15af680..c9f6a3b", "recertify_evidence": "01-onboarded-cli, 04-baseline-cli (real CLI), Desk drift"},
  {"id": "TOM-L2-06", "journey": "j5-vetting-sellers", "character": "tomasz-wieczorek", "cert_level": "L2", "type": "missing-feature", "severity": "minor", "impact": {"frequency": "med", "reachability": "low", "trust_erosion": "low"}, "dimension": "missing", "title": "The pre-load check cannot tell staged sellers apart: four states, one sentence, and no way to rehearse it before production", "expected": "A rehearsal path so the platform team can see what shoppers' browsers will be told per seller state.", "got": "Recertify: src/browser/preload.ts is unchanged in the range; it returns 'The peer was not contacted: it is not an https address.' before any fetch for every loopback seller.", "evidence": ["src/browser/preload.ts:151-162"], "code_check": "by-design", "verdict": "uncertain", "resolution": "open", "recertified_in": "15af680..c9f6a3b", "recertify_evidence": "git diff 15af680..HEAD -- src/browser is empty (UAT-21, UAT-26 not built)"},
  {"id": "TOM-L1-S1", "journey": "j5-vetting-sellers", "character": "tomasz-wieczorek", "cert_level": "L1", "type": "trust", "severity": "polish", "strength": true, "impact": {"frequency": "high", "reachability": "high", "trust_erosion": "low"}, "dimension": "trust", "title": "Unreachable and refused are never green on the day they happen", "expected": "An unreachable seller or card is not clean.", "got": "Recertify: seller-offline warn, card-offline warn (still warn after a relock), refused addresses 'was not contacted', all exit 1.", "evidence": ["shots/tomasz-recert/t/13-offline.txt", "shots/tomasz-recert/t/19-watch-card-still-down.txt", "shots/tomasz-recert/t/04-baseline-cli.txt"], "code_check": "n-a", "verdict": "confirmed", "resolution": "n-a", "recertified_in": "15af680..c9f6a3b", "recertify_evidence": "not regressed"},
  {"id": "TOM-L1-S2", "journey": "j5-vetting-sellers", "character": "tomasz-wieczorek", "cert_level": "L1", "type": "trust", "severity": "polish", "strength": true, "impact": {"frequency": "med", "reachability": "high", "trust_erosion": "low"}, "dimension": "senior-quality", "title": "A changed Agent Card or seller is counted in stated units, without quoting the stranger", "expected": "What changed, in counts with units.", "got": "Recertify: 'skills: 1 added, 0 removed, 1 changed; it carries 1 JWS signature' and 'agents: 1 added, 0 removed, 1 changed; outbound hosts: 0 added, 0 removed; front agent: unchanged'.", "evidence": ["shots/tomasz-recert/t/21-card-change.txt", "shots/tomasz-recert/t/16-back-changed.txt"], "code_check": "n-a", "verdict": "confirmed", "resolution": "n-a", "recertified_in": "15af680..c9f6a3b", "recertify_evidence": "not regressed"},
  {"id": "TOM-L1-S3", "journey": "j5-vetting-sellers", "character": "tomasz-wieczorek", "cert_level": "L1", "type": "trust", "severity": "polish", "strength": true, "impact": {"frequency": "med", "reachability": "high", "trust_erosion": "low"}, "dimension": "trust", "title": "adopt follows a rotation only through a key already trusted, names each hop, and needs --yes; verify's text hint names the exact adopt command", "expected": "Following a rotation is the verifier's decision, never automatic.", "got": "Recertify: adopt without --yes: 'nothing adopted: adopting a successor is your decision; rerun with --yes to add it', trust file byte-identical; with --yes the key is added; the Desk's trust import needed its confirm.", "evidence": ["shots/tomasz-recert/t/06-adopt-4501.txt", "shots/tomasz-recert/t/08-adopt-yes-4501.json", "shots/tomasz-recert/tom-rc-desk-trust-import-offer.png"], "code_check": "n-a", "verdict": "confirmed", "resolution": "n-a", "recertified_in": "15af680..c9f6a3b", "recertify_evidence": "not regressed"},
  {"id": "TOM-L1-S4", "journey": "j5-vetting-sellers", "character": "tomasz-wieczorek", "cert_level": "L1", "type": "trust", "severity": "polish", "strength": true, "impact": {"frequency": "med", "reachability": "high", "trust_erosion": "low"}, "dimension": "clarity", "title": "The relock prints every changed ref, including removals, with the re-sign reminder", "expected": "Nothing leaves the lock without a line.", "got": "Recertify: every relock listed its refs and the reminder, and an accepted signer now adds a 'signer peer ... (how; backing)' line. Ceiling: a peer's first key, or a key that returns after the lock recorded the peer unsigned, gets only 'changed peer' (TOM-RC-1, TOM-RC-4).", "evidence": ["shots/tomasz-recert/t/08b-accept-A.txt", "shots/tomasz-recert/t/17-accept-D.txt", "shots/tomasz-recert/t/11-B1-4-plain-relock-back.txt"], "code_check": "n-a", "verdict": "confirmed", "resolution": "n-a", "recertified_in": "15af680..c9f6a3b", "recertify_evidence": "not regressed"},
  {"id": "TOM-L1-S5", "journey": "j5-vetting-sellers", "character": "tomasz-wieczorek", "cert_level": "L1", "type": "trust", "severity": "polish", "strength": true, "impact": {"frequency": "med", "reachability": "low", "trust_erosion": "low"}, "dimension": "trust", "title": "The pre-load check reads an unsigned peer as unverifiable in plain words and does not refuse it", "expected": "Unsigned is unverifiable, neither good nor bad.", "got": "Recertify: src/browser/preload.ts is unchanged in the range; L2's live evidence stands.", "evidence": ["src/browser/preload.ts:82,151-162"], "code_check": "n-a", "verdict": "confirmed", "resolution": "n-a", "recertified_in": "15af680..c9f6a3b", "recertify_evidence": "code unchanged; not re-driven"},
  {"id": "TOM-L1-S6", "journey": "j5-vetting-sellers", "character": "tomasz-wieczorek", "cert_level": "L1", "type": "trust", "severity": "polish", "strength": true, "impact": {"frequency": "low", "reachability": "high", "trust_erosion": "low"}, "dimension": "clarity", "title": "init is honest where watch --init is not: on an existing lock it says 'kept' and turns each --source into a 'Not added' line", "expected": "A flag that cannot act says so.", "got": "Recertify, real CLI on kiln-row's lock: 'init: kept the plumbline.lock.json that is there (accept changes with watch --relock after a review)' and 'info grounding index.html: Not added: a lock was already there, and init never rewrites one; add it with watch --relock --source after a review.'; lock unchanged.", "evidence": ["shots/tomasz-recert/t/28-init-source-existing.txt"], "code_check": "n-a", "verdict": "confirmed", "resolution": "n-a", "recertified_in": "15af680..c9f6a3b", "recertify_evidence": "confirmed live (uncertain at L2)"},
  {"id": "TOM-RC-1", "journey": "j5-vetting-sellers", "character": "tomasz-wieczorek", "cert_level": "L2", "type": "trust", "severity": "major", "impact": {"frequency": "low", "reachability": "high", "trust_erosion": "high"}, "dimension": "trust", "title": "A held signer change is erased by any relock that runs while the seller's signature is absent; the swapped key then returns as 'newly signed' info, and the next plain relock, by hand or by the Action, pins it with the watch clean", "expected": "A signer the lock recorded is never forgotten because a signature is missing for a while: the relock keeps the recorded kid (as it does for a 5xx) or refuses, and a key that later differs from the last recorded kid is a signer change that needs --accept-signer.", "got": "brackenfold was held (block, 'a different key, with no rotation published'). Its plumbline.signature.json answered 404 (the world's notFound): watch warn 'no longer shows a usable signature (none is published)'. A plain relock was not refused: exit 0, 'changed peer ...brackenfold_shop' and warn 'A peer the lock recorded as signed publishes no signature now; the new lock records it as unsigned.'; the kid was gone. The signature came back under 08825631fb57f303: info 'A peer that was unsigned when locked now publishes a signature; re-lock to record its key.' (a signed site's watch exits 0). A plain relock: exit 0, 'changed peer', no signer line. The watch, with and without --trust: exit 0. Through the Action (run-action --harness --relock-pr true): r1 during the 404 opened draft PR #2, which drops the kid; after a merge, r3 closed issue #1 as clean; r4 (an unrelated card-offline) opened draft PR #4, whose lock pins 08825631fb57f303 under 'changed peer'. No one named brackenfold with --accept-signer.", "evidence": ["shots/tomasz-recert/t/11-B1-1-watch-404.txt", "shots/tomasz-recert/t/11-B1-2-plain-relock-404.txt", "shots/tomasz-recert/t/11-B1-3-watch-back.txt", "shots/tomasz-recert/t/11-B1-4-plain-relock-back.txt", "shots/tomasz-recert/t/11-B1-5-watch-final-trust.txt", "shots/tomasz-recert/t/action-r1/relock.json", "shots/tomasz-recert/t/43-action-r3.json", "shots/tomasz-recert/t/action-r4/relock.json", "shots/tomasz-recert/t/44-gh-state.json", "src/watch/capture.ts:209-224", "src/watch/index.ts:185-188", "src/watch/decide.ts:369-370"], "code_check": "present-broken", "verdict": "confirmed", "resolution": "open", "suggested_acceptance": "kiln-row: seller-signer-swapped, brackenfold held, its signature 404, a plain relock, the signature back, a plain relock: the lock still records 94b090a84b42fb09 (or the first relock refuses), and the second relock refuses naming brackenfold. The same through run-action --harness --relock-pr true opens no PR that removes or replaces the kid."},
  {"id": "TOM-RC-2", "journey": "j5-vetting-sellers", "character": "tomasz-wieczorek", "cert_level": "L2", "type": "trust", "severity": "major", "impact": {"frequency": "low", "reachability": "high", "trust_erosion": "high"}, "dimension": "trust", "title": "The Action's relock pull request lists a recorded signer it removes under 'What this relock does not accept, or keeps as it was (these keep reporting after a merge)'", "expected": "A relock that removes or replaces a recorded kid says so under what the pull request changes ('brackenfold: the lock no longer records its signer 94b090a84b42fb09'), never under what keeps reporting.", "got": "Draft PR #2 (r1, during brackenfold's signature 404): 'What the new lock changes: changed peer ...brackenfold_shop' and, under 'What this relock does not accept, or keeps as it was (these keep reporting after a merge)', 'warn ... the new lock records it as unsigned.' After the merge nothing about it reports again: r3 closed the issue as clean. r1's issue comment said 'No longer reported: block peer ...brackenfold_shop'.", "evidence": ["shots/tomasz-recert/t/action-r1/body.md", "shots/tomasz-recert/t/41-action-r1.json", "shots/tomasz-recert/t/43-action-r3.json", "action/report.mjs:342-346"], "code_check": "present-broken", "verdict": "confirmed", "resolution": "open", "suggested_acceptance": "In the TOM-RC-1 Action arm, the pull request body says the relock removes brackenfold's recorded signer, outside the 'keeps reporting after a merge' table (or no pull request is opened)."},
  {"id": "TOM-RC-3", "journey": "j5-vetting-sellers", "character": "tomasz-wieczorek", "cert_level": "L2", "type": "trust", "severity": "minor", "impact": {"frequency": "low", "reachability": "high", "trust_erosion": "med"}, "dimension": "trust", "title": "The refused relock's suggested command accepts every refused peer in one line, a swap with no rotation included, and runs without --trust", "expected": "One command per peer (or none composed for 'a different key, with no rotation published'), carrying --trust when the refusal could check a rotation, so following the rotated seller cannot also accept the swapped one.", "got": "First refusal: 'run: plumbline watch --root ... --relock --accept-signer http://127.0.0.1:4501/ashgrove_studio --accept-signer http://127.0.0.1:4502/brackenfold_shop'. Pasted on a copy: exit 0, both accepted, brackenfold '(a different key, with no rotation published; not checked: no --trust file given)'. The Action's issue and pull request text have the same shape.", "evidence": ["shots/tomasz-recert/t/07-plain-relock.txt", "shots/tomasz-recert/t/10-B2-paste-refusal-command.txt", "src/cli/watch-command.ts:188", "action/report.mjs:198,324"], "code_check": "present-but-missed", "verdict": "confirmed", "resolution": "open", "suggested_acceptance": "After seller-rotates and seller-signer-swapped, no single command the refusal prints accepts both sellers."},
  {"id": "TOM-RC-4", "journey": "j5-vetting-sellers", "character": "tomasz-wieczorek", "cert_level": "L2", "type": "trust", "severity": "minor", "impact": {"frequency": "low", "reachability": "high", "trust_erosion": "med"}, "dimension": "trust", "title": "A relock records a peer's first key, or a relisted peer's key, with only 'changed peer' or 'added peer': no signer line, even with --trust given", "expected": "Every kid a relock writes that the previous lock did not hold for that peer is printed as a signer line, with its backing when --trust is given; a relisted peer is compared with the kid it last had.", "got": "dovetail's first key c195cf32f3013c23 with '--accept <dovetail> --trust': 'changed peer ...dovetail_loom' only. copperwick's first key with --trust: 'changed peer' only. brackenfold delisted, relocked ('removed peer'), relisted and relocked: 'added peer ...brackenfold_shop', pinned 08825631fb57f303, watch with --trust exit 0. The --drop refusal advises exactly this delist path.", "evidence": ["shots/tomasz-recert/t/17-accept-D.txt", "shots/tomasz-recert/t/24-accept-C.txt", "shots/tomasz-recert/t/12-B3-1-relock-delisted.txt", "shots/tomasz-recert/t/12-B3-3-relock-relisted.txt", "shots/tomasz-recert/t/12-B3-4-watch-final.txt", "src/watch/index.ts:185-188"], "code_check": "present-but-missed", "verdict": "confirmed", "resolution": "open", "suggested_acceptance": "--accept <a seller signing for the first time> --trust prints 'signer peer <url>: (none) -> <kid> (...; not backed by your trust file)'; a relisted peer's relock says it had another kid before."},
  {"id": "TOM-RC-5", "journey": "j5-vetting-sellers", "character": "tomasz-wieczorek", "cert_level": "L2", "type": "confusion", "severity": "polish", "impact": {"frequency": "low", "reachability": "low", "trust_erosion": "low"}, "dimension": "clarity", "title": "One relock, one situation, two reasons: a peer refused by the address rule 'could not be re-read (it is not an https address)', the card refused by the same rule '(it could not be read)'", "expected": "The same reason words for a peer and a card that the address rule refused.", "got": "Real CLI relock reaching no seller: four peers '... could not be re-read (it is not an https address), so the lock keeps its earlier pin ...' and the card 'An external agent definition could not be re-read (it could not be read), so the lock keeps its earlier record ...'.", "evidence": ["shots/tomasz-recert/t/15-cli-relock-reaches-none.txt"], "code_check": "present-but-missed", "verdict": "confirmed", "resolution": "open", "suggested_acceptance": "The same relock names the address rule for the card as it does for the peers."}
]
```
