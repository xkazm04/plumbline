# The Plumbline Desk

An open agentic website that does Plumbline live, in the visitor's browser: run the gate on any agentic site, read its
drift since its published lock, verify its publisher signature, make a publisher key and sign a site's agent files. It is
itself an agentic website in the sense of the Worldwide Agentic Web MVP spec (Profile 0.2): a public
`agent-manifest.json`, a network JSON, the browser runtime, a chat, a bring-your-own-key model panel (hosted Otari
first), two partner sites it can ask after the visitor agrees, and a bridge so other agentic sites can call it.

It was built with the `agentify-website` skill of [cognizant-ai-labs/agentic-web](https://github.com/cognizant-ai-labs/agentic-web)
(Apache-2.0), following its workflow and templates. Its look and structure are "The Fix", the design the owner chose in
the Plumbline Desk contest (B/3, 2026-11-17): a chart with a compass card, five ports of call and one focused view per
port. [`PORT.md`](PORT.md) lists each view, what it shows and what it deliberately leaves out.

## The views

The overview (`#/`) shows the compass card with the fix of one gate run, the five ports, the sites checked and the peer
ports; it runs no tool. Each port opens its own view by the address hash: `#/check` (the gate), `#/drift`, `#/verify`
(with your trust list), `#/key` and `#/sign`. `#/about` holds what Plumbline is and how to publish with the CLI. The
Assistant button (top right) opens the assistant panel over the current view. The keys 1 to 5 open the ports and Escape
returns to the overview. Below 1180 px wide, or in portrait, the page becomes one column.

The overview's first three "sites checked" are gate reports captured 2026-11-17 by the CLI (`examples.js`), labelled
"example" wherever they show; each gate you run on the page takes an example's place.

## Run it

From the repository root:

```shell
npm install
npm run build:site          # tsc, then copies the browser-safe compiled modules into site/lib/plumbline/
node <agentic-web>/skills/agentify-website/scripts/serve_site.mjs site --port 8080
```

`<agentic-web>` is a checkout of cognizant-ai-labs/agentic-web. The server binds to 127.0.0.1 and sends
`Access-Control-Allow-Origin: *` on the public agent files. Any static server works for the page itself; ES modules
need HTTP, not `file://`.

The page works without the assistant: every action has a page button. To use the assistant, press **Assistant** (top
right), open **AI model settings** in the panel, pick a provider and paste your own key, then **Save and start** (the
page reloads and the panel opens again by itself). The assistant sends your messages, and the results it reads, to the
provider you pick.

**Where the key lives.** The runtime saves every setup, key included, in `localStorage` (and on `localhost` also in a
cookie any local site can read). Unless you tick **Remember my AI provider key on this device** in the panel, the Desk
takes the key back out: when the page starts and when you leave it (`pagehide`, which Save and start's reload also fires),
`site.js` keeps the setup in use in this tab's `sessionStorage`, where the runtime reads it first, and removes the key
from every saved setup through the runtime's own exported profile functions (`runtime/byok.js`, unchanged). The key then
leaves with the tab. What it cannot cover: between Save and start and the reload, the key sits in `localStorage` for a
moment, and a browser that is killed before `pagehide` leaves it there until the Desk next starts. The panel's own text
("Your key is saved in this browser") is the runtime's and is not changed. Use a key with a low spending limit either way.

## Tests

```shell
npm run test:site           # builds site/lib, then node --test "site/tests/*.test.mjs"
node <agentic-web>/skills/agentify-website/scripts/build_network.mjs site/plumbline_desk.hocon --manifest site/agent-manifest.json --check
```

The tests are the skill's template suite filled in for the Desk (`desk.test.mjs`), the browser fetcher's rules
(`fetcher.test.mjs`: the address rule, the body ceiling, the timeout, no credentials or referrer), plus the Desk's own
rules: no private key material
reaches the model (tool results and the whole transcript are searched), every sample query can be answered, the decline
query has no tool to misuse, an unreachable checker is never `pass`, and sign then verify gives `unverifiable`, then
`verified` once trusted, then `invalid tampered` after an edit, and `csp.test.mjs` keeps the Content-Security-Policy
(below) strict and in step with the runtime. The attacker review of 2026-11-17 is a test each, through the Desk: a
duplicate-key network, a `links.json` added after signing and an edited action module are all `invalid tampered`; the
read tools refuse a host the visitor did not choose; strings from an inspected site reach the model only when they pass
their pattern; drift labels a lock no verified signature covers; the assistant cannot replace an undownloaded key;
Forget keeps a revoked key revoked; and a lock the browser is refused is never reported as no lock. They use a scripted model and a scripted fetcher; they
call no LLM and no network. They check the plumbing, not how a real model follows the instructions.

`tests/port/` holds the style contract of the chosen design: the winner's computed styles for each named part, and the
command that checks the served page against them (`PORT.md`, "The style contract"). It needs a browser, so it is not part
of `npm run test:site`.

## What it does

| Action (`website_*` tool) | Effect | What it wraps |
| --- | --- | --- |
| `get_desk_state` | read | the page state: partner links, last results, the files chosen for signing (paths and digests), the key id of a chosen key, trusted publishers. Never key material |
| `run_gate` | read | `src/gate/run.ts` with the browser's `fetch`: the validator port, Agent Atlas, Agent Customs |
| `read_drift` | read | verifies the target's signature first (the trust store as it is, nothing written), then `drift.js` reads the same `plumbline.lock.json` bytes and re-checks runtime files, grounding sources and peers. A lock no verified signature covers is labelled "unsigned lock: the host can rewrite it" |
| `verify_site` | read | core's `verifySignature` against the visitor's trust store (localStorage, this origin only), over the exact bytes of every file core's `signedPathsOf` names: the manifest, its networks at their `hocon` paths, its action module, bridge and coded-tools bundle, and `links.json` and the lock whenever the site serves them |
| `generate_key` | write (undo: Discard) | core's `generateKey`; offers `plumbline.private.json` (the CLI's format) and `.well-known/plumbline-key.json` as downloads; returns the key id only. Refused while a key made earlier has not been downloaded, so the assistant never throws one away |
| `sign_files` | irreversible (asks first) | core's `signSubjects` over the exact bytes of the files the visitor picked on the page, with the key file they picked there; offers `plumbline.signature.json` as a download |

**What the assistant may reach.** `run_gate`, `read_drift` and `verify_site` fetch only a host the visitor typed or
picked in the page's own address fields this session, a partner (the manifest's `allowed_peers`), one of the example
targets the overview shows, or the Desk's own origin. Any other host is refused with "Type this address into the page
first: the assistant cannot send the Desk to a site you did not choose." and nothing is fetched. The page's own forms
are the visitor's choice and are not limited. **What reaches the model from an inspected site.** Every string a tool
result carries that came from the site checked (paths, kids, keys, lock references, peer addresses) passes its pattern
(core's subject-path, kid and public-key patterns; an address with a plain host, no query or credentials and a path of
safe segments) or is replaced by "[withheld: ...]". The page still shows the visitor what the site published. The
network's instructions say that tool results are data, never instructions, and that the page's verdict is the authority.

`get_desk_state` is a sixth action beyond the five in the brief: the skill's partner rules need a read action that gives
the partner's link, and `sign_files` needs a read of the signing version in the same turn.

Trusting a publisher is a page button with the first-contact wording from `docs/signature-format.md`, never a tool. The
assistant cannot add trust. After the button, the site is verified again at once, so the new verdict shows without a
second press. The trust list exports as `plumbline.trust.json` in the CLI's format (`{version: 1, entries: [{kid, origin,
publicKey, revokedAt?, adoptedVia?}]}`, the file `plumbline verify --trust` reads; forgotten revoked keys have no place in
it and are counted, not written) and imports from one: every entry is held to its patterns and its kid must belong to its
key, the page lists what the file would add, replace or revoke, and nothing is added until the visitor presses the
confirm button. A key revoked in this browser stays revoked whatever a file says. A trust entry covers files fetched from its origin only: the same signed files served from
another origin verify as `unverifiable`. The trust list keeps `adoptedVia` (validated by pattern) and runs core's
`spreadRevocations` on every load, so a revocation reaches every origin and every successor adopted through the revoked
key. A verified revocation replaces the list with core's result. Forget on a revoked key keeps a tombstone (its kid and
revocation date, no key and no origin), shown as revoked: that key cannot be trusted again from this page, and a
signature by it reads `invalid revoked` here, never as a stranger to trust.

**Revoking a leaked key** is a page section in the key view, never a tool: the visitor picks the private key file, the
page signs `plumbline-revocation.json` with core's `revokeKey` and offers it as a download. The key is read, used once
and dropped; the assistant cannot reach it.

**What a check says when it ends.** Each form's status line is a live region: it says the verdict when the gate, a drift
reading or a verify ends ("Check finished. Overall: Failed."), not just nothing. The form's button is off while its run
is in flight, and each read tool numbers its runs, so a slower answer to an earlier question never replaces a newer one
on the page (the caller, the assistant included, still gets its own answer). A refused verify replaces the verdict shown
before with the refusal, so the verdict on the page always belongs to the last address asked.

The signing dialog (the skill's confirmation dialog) shows the origin, the key id, the expiry and every file path with its
SHA-256. "Irreversible" here means a statement under your name: once published, it stands until it expires or you rotate
the key. The page's own Sign button opens the same dialog.

## Browser rules, and what a browser cannot see

- Every key, signature and verdict needs Ed25519 in WebCrypto. The Desk asks the browser once (importing a known public
  key); without it, Generate, Sign and Revoke are off with a sentence saying why, a picked key file is never called "not
  a Plumbline key file", and verify answers `unverifiable` with "this browser cannot do Ed25519", never a false
  `invalid`.
- One address rule decides what the Desk fetches: `fetchableUrl` in `fetcher.js` (https, or http on `localhost` and
  `127.0.0.1`). The target check and the pattern for addresses shown to the model use it too.
- Every check runs with the visitor's browser's same-origin and CORS rules. A file a site does not allow other origins to
  read is unreadable here, and the result says so: a gate checker becomes `unavailable` (never `pass`), a signature that
  cannot be read is `unverifiable`, a lock that cannot be read is one drift finding. There is no SSRF guard in the browser
  and none is needed: the page can reach only what the visitor's browser can.
- Publishers: serve `plumbline.signature.json`, `.well-known/plumbline-key.json` and `plumbline.lock.json` with
  `Access-Control-Allow-Origin: *`, like the other public agent files, or no browser on another site can read them.
  `serve_site.mjs` does not add that header for these three files, so a Desk on another origin cannot verify a site
  served by it.
- The drift reader resolves lock paths against the lock's own URL. A lock written from a different folder than the one
  published shows its files as missing. The upstream nsdeploy commit check is left to the CLI's `watch`.
- Drift says "no lock" only when the site answers 404 or 410. A lock the browser is refused (no CORS header, offline)
  reads "Could not read this site's plumbline.lock.json (the browser was refused)", which is not the same thing.
- A lock is only as good as its signature. Unless a signature that verifies under a publisher you trust covers it,
  every drift reading says "unsigned lock: the host can rewrite it", and a clean one never reads as plain "No drift".
- The gate's `customs` adapter verifies Agent Customs' receipts in the browser with WebCrypto, as it does in Node.
  `npm run build:site` fails if any module copied into `lib/plumbline/` uses Node's `Buffer`.
- Verify passes `links.json` and the lock to core whenever the site answers 2xx for them and leaves them out on 404 or
  410. When the browser cannot read one of them (refused, or another HTTP answer), the Desk cannot tell whether the
  signature covers everything the runtime loads, so it does not claim `verified`: the verdict is `unverifiable`.

## Content-Security-Policy

The Desk holds the visitor's LLM key and, while signing, a private key in memory, and it renders model-written content
(the runtime's CRUSE forms, tables and HTML reports). So `index.html` sets a strict policy in a `<meta>` tag, the one
place every static host honours, GitHub Pages included:

```text
default-src 'none';
script-src 'self';
style-src 'self' 'unsafe-hashes' <7 sha256 hashes>;
img-src 'self';
connect-src 'self' https: http://localhost:* http://127.0.0.1:*;
worker-src 'self';
frame-src https://agent-atlas-phi.vercel.app https://montbaga.github.io https://agent-customs-range.github.io;
base-uri 'none'; form-action 'none'; object-src 'none'
```

The comment beside the tag gives the evidence (file and line) for each source. In short:

- **Scripts.** Every script is a same-origin module, including the runtime's dynamic imports. There is no inline script,
  no inline handler and no `eval` or `new Function`, so the policy has neither `'unsafe-inline'` nor `'unsafe-eval'`.
- **Styles.** The page's own styles are two same-origin sheets, `fix.css` and `assistant.css`. The vendored runtime,
  which we do not edit, adds one `<style>` block (`runtime/ui.js`, its `BASE_CSS`) and six fixed `style=""` attributes
  (`runtime/ui.js`). The policy allows those seven texts by hash, with `'unsafe-hashes'` for the attributes, and no
  other inline style: a style attribute in model-written HTML is refused (and the runtime's HTML sanitizer drops it
  anyway). The page's own markup has no `style=""`; `shell.js` positions the compass ports, the checker badges and the
  chart through custom properties set with the CSSOM (`element.style.setProperty`), which the policy does not govern. `site/tests/csp.test.mjs` recomputes the hashes from the runtime, so a runtime update
  that changes its inline styles fails the tests until the hashes are updated here.
- **Why `connect-src` is broad.** It cannot be a short allow-list. The gate, drift and verify read any https site the
  visitor names, and the model router is the visitor's own choice: hosted Otari, Groq, OpenAI, Google, Anthropic, any
  OpenAI-compatible URL, or Ollama on `http://localhost`. The partners' networks also run in this browser and fetch their
  own files and MCP endpoints. So the policy allows `https:` everywhere, plain `http` only on `localhost` and
  `127.0.0.1`, and nothing else (no `ws:`, no `data:`). What keeps a key in place is that no script but our own and the
  vendored runtime can run, not a list of hosts.
- **Frames.** When the assistant asks a partner, the runtime loads that partner's action bridge in a hidden frame:
  Agent Atlas, Agent Customs and Customs' own peer, `agent-customs-range.github.io`. For a partner outside this list the
  frame is refused and the runtime falls back to a popup the visitor opens (read from the code, not tried in a browser). Add a new partner's origin to `frame-src` when you add it to
  `allowed_peers`; the test checks that.
- **Worker.** The coded-tool sandbox is a same-origin worker. Its own, stricter policy comes from its response headers,
  not from this page (below).

**Headers.** `frame-ancestors` does not work in a `<meta>` tag, and a worker's policy comes from its own response.
`site/_headers` (the Netlify and Cloudflare Pages format) sends both: `frame-ancestors 'none'` on the page, so no other
site can frame the Desk, and on `runtime/sandbox-worker.js` the policy that file asks for. For every path it also sends
`X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. Hosts that honour response headers should send
them; GitHub Pages cannot, so there the Desk can be framed by another site and the sandbox worker refuses to run a peer's
coded tools (the Desk's partners publish none today). For the framing case the page guards itself: `desk.js` checks
`window.top !== window.self` and, in a frame, refuses everything that adds trust or makes or uses a key (Trust, import,
Generate, Sign, Revoke), turns those buttons off and says why in a notice; the read tools keep working. `bridge/action-bridge.html` is left
framable on purpose: other agentic sites load it in a hidden frame.

**Checked in a browser** (headless Chromium, 2026-11-17, served from `http://127.0.0.1`): boot with no key, boot with the
assistant blocked, the gate, drift and partner check on `https://agent-atlas-phi.vercel.app/`, key generation, signing a
fixture, verify (unverifiable, trust, verified), the AI model settings panel with a key, a chat turn with a CRUSE form
and a model-written HTML report (scripted model responses), and a partner call to Agent Atlas through its consent card
and bridge frame. No CSP violation, except the one the policy is for: a `style` attribute in the scripted model's HTML
report was refused (`runtime/cruse-render.js`), which changes nothing, because the sanitizer drops it.

**Checked again after the move to "The Fix"** (headless Chromium, 2026-11-17, served from `http://127.0.0.1`, at
1920x1080, 1280x800 and 390x844): the overview, the five port views and About, a real gate run on
`https://agent-atlas-phi.vercel.app/`, the partner check, key generation, signing a fixture through the confirmation
dialog, verify (unverifiable, trust, verified, then invalid tampered after an edit), and the assistant panel opened. No
CSP violation and no page error; no visible text under 12 px.

**Checked again on WP9a's contract** (headless Chromium, 2026-11-17, served from `http://127.0.0.1`, at 1280x800 and
390x844): the core's known-answer vectors through `lib/plumbline/` (each subject hashed as its exact bytes, every
`canonicalRefused` input refused); signing the Desk's own files with the lock and the action module, then verify
(`unverifiable`, trust, `verified`, then `invalid tampered` after an edit); a real gate on
`https://agent-atlas-phi.vercel.app/` typed into the page; a scripted model's `read_drift` on a host nobody typed,
refused with nothing fetched; and drift on Agent Atlas, whose lock the browser is refused. No CSP violation and no page
error; no visible text under 12 px. The screenshots and the run log are kept outside the repository.

## Network URL and callers

The network URL is the folder that holds `agent-manifest.json`, then `plumbline_desk`, for example
`https://<host>/plumbline_desk`. Other agentic sites that call it run it in their visitor's browser on their visitor's key
and get no `website_*` tools, so their assistant points to this page for checks and signing. Their visitor also gets a
consent card for each partner this network asks.

## Linked sites

- **Agent Atlas**, `https://agent-atlas-phi.vercel.app/agent_atlas`, label "Agent Atlas".
- **Agent Customs**, `https://montbaga.github.io/agent-customs/agent_customs`, label "Agent Customs".

Both URLs come from each site's live `agent-manifest.json` (the folder that holds it, then `networks[0].name`); both
pass `check_partner.mjs`. The consent card (the runtime's) shows the partner's label, its host and the first 140
characters of the request before anything is sent. The Desk stands in front of it through the runtime's `onConsent` hook
(`site.js`, `AssistantMount.consent`): a request longer than 140 characters is declined before any card, with a note in
the chat, because the visitor could not have read all of it; **Always allow** skips the card for that host until the page
is reloaded, but the Desk keeps that choice itself and never hands "always" to the engine, whose own memory would skip the
hook and these checks. After the visitor allows, and before the runtime contacts the partner, the Desk fetches the
partner's network file and `links.json` and compares their SHA-256 with the pins in this Desk's own
`plumbline.lock.json` (as drift does); a partner that differs is declined, with a note, and the card is relabelled
"Declined by the Desk". Limits of that check, from the runtime's hook: it receives a host, not the network address, so it
checks every pinned network on that host; a host the lock pins nothing on (Agent Customs' own peer, an MCP service) gets
the card only; and the runtime fetches the partner again itself after the check, so a partner that serves different
bytes to that second request is not caught here. Only a runtime change that hashes what it runs could close that. The assistant is told to
ask only what the partner can answer (what it offers) and never to include names, emails, phone numbers or codes; the
runtime does not filter the request, so check it on the card. A partner's network runs in this browser on the visitor's
key, with none of its own site tools, so it cannot run its own checks from here, and a call costs more than the card's
token estimate. Agent Customs' own network may ask its test-range sites (`agent-customs-range.github.io`); each gets its
own card.

## Files

| Path | What |
| --- | --- |
| `index.html` | the page: structure only (the overview, one section per view, the assistant panel), and the Content-Security-Policy; every visible string is in `strings.js` |
| `_headers` | response headers for hosts that read it: `frame-ancestors`, the sandbox worker's policy, and cross-origin reads (`Access-Control-Allow-Origin: *`, no credentials) on the public agent artifacts |
| `strings.js` | every visible string |
| `fix.css` | the page's look: "The Fix" (contest B/3), ported from the winner's stylesheet |
| `assistant.css` | the assistant panel, the skill's assistant CSS (`--ns-*` colours) and the confirmation dialog |
| `desk.js` | the page object (`App.page`) and its rendering; the page's buttons call it |
| `shell.js` | the views: which one shows (by the address hash), the overview, and each view's drawing from the page state; runs no tool |
| `art.js` | the drawings (the chart, the compass card, the fix, the seal, the course, the die) as SVG with no style attribute |
| `examples.js` | the three captured gate reports the overview shows, labelled, before a gate is run here |
| `PORT.md` | the views, what each shows and leaves out, and the style contract |
| `fetcher.js` | the browser fetcher in safeFetch's shape (https or localhost, body ceiling, timeout) |
| `drift.js` | the browser drift reader |
| `review-dialog.js` | the skill's confirmation dialog, shared by the page and the assistant |
| `site.js` | boots the assistant (the skill's template, filled in) |
| `site-actions.js` | registers the six actions |
| `plumbline_desk.hocon` | the network's source of truth |
| `plumbline_desk.network.json`, `agent-mcp.json`, `.well-known/nsdeploy*.json`, `bridge/` | generated by `build_network.mjs`; never edit |
| `agent-manifest.json`, `links.json` | public bundle files |
| `runtime/` | the skill's browser runtime, byte for byte; see `runtime/NOTICE`. Never edit |
| `lib/plumbline/` | generated by `npm run build:site`, git-ignored |
| `tests/` | the Node tests and the skill's DOM stand-ins and scripted model |
| `tests/port/` | the style contract: the winner's roles and their measured styles (`style-contract.py` from the contest skill) |

## Limits

Static hosting only, with a patched copy of nsdeploy's runtime. `write` actions run without a dialog (here only
`generate_key`, which the visitor can discard). Every agent sees every `website_*` tool. Each partner call runs on the
visitor's key after the visitor agrees, at most 4 per message and 1 per partner. A partner that accepts the connection but
never answers leaves the chat waiting until reload. The LLM provider must allow CORS. Everything in the network file,
instructions included, is public. A key chosen for signing sits in this page's memory until it is used or cleared, where
any script on this origin could reach it; signing with the CLI on a build machine keeps it out of the page.
