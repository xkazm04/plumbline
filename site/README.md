# The Plumbline Desk

An open agentic website that does Plumbline live, in the visitor's browser: run the gate on any agentic site, read its
drift since its published lock, verify its publisher signature, make a publisher key and sign a site's agent files. It is
itself an agentic website in the sense of the Worldwide Agentic Web MVP spec (Profile 0.2): a public
`agent-manifest.json`, a network JSON, the browser runtime, a chat, a bring-your-own-key model panel (hosted Otari
first), two partner sites it can ask after the visitor agrees, and a bridge so other agentic sites can call it.

It was built with the `agentify-website` skill of [cognizant-ai-labs/agentic-web](https://github.com/cognizant-ai-labs/agentic-web)
(Apache-2.0), following its workflow and templates rather than a design of our own.

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

The page works without the assistant: every action has a page button. To use the assistant, open **AI model settings**,
pick a provider and paste your own key. The assistant sends your messages, and the results it reads, to the provider you
pick. On `localhost` the runtime also keeps saved setups, keys included, in a cookie any local site can read, so use a
key with a low spending limit, and afterwards delete the saved setup (Advanced settings) and close the tab.

## Tests

```shell
npm run test:site           # builds site/lib, then node --test "site/tests/*.test.mjs"
node <agentic-web>/skills/agentify-website/scripts/build_network.mjs site/plumbline_desk.hocon --manifest site/agent-manifest.json --check
```

The tests are the skill's template suite filled in for the Desk, plus the Desk's own rules: no private key material
reaches the model (tool results and the whole transcript are searched), every sample query can be answered, the decline
query has no tool to misuse, an unreachable checker is never `pass`, and sign then verify gives `unverifiable`, then
`verified` once trusted, then `invalid tampered` after an edit, and `csp.test.mjs` keeps the Content-Security-Policy
(below) strict and in step with the runtime. They use a scripted model and a scripted fetcher; they
call no LLM and no network. They check the plumbing, not how a real model follows the instructions.

## What it does

| Action (`website_*` tool) | Effect | What it wraps |
| --- | --- | --- |
| `get_desk_state` | read | the page state: partner links, last results, the files chosen for signing (paths and digests), the key id of a chosen key, trusted publishers. Never key material |
| `run_gate` | read | `src/gate/run.ts` with the browser's `fetch`: the validator port, Agent Atlas, Agent Customs |
| `read_drift` | read | `drift.js`: reads the target's published `plumbline.lock.json` and re-checks runtime files, grounding sources and peers |
| `verify_site` | read | core's `verifySignature` against the visitor's trust store (localStorage, this origin only) |
| `generate_key` | write (undo: Discard) | core's `generateKey`; offers `plumbline.private.json` (the CLI's format) and `.well-known/plumbline-key.json` as downloads; returns the key id only |
| `sign_files` | irreversible (asks first) | core's `signSubjects` over the files the visitor picked on the page, with the key file they picked there; offers `plumbline.signature.json` as a download |

`get_desk_state` is a sixth action beyond the five in the brief: the skill's partner rules need a read action that gives
the partner's link, and `sign_files` needs a read of the signing version in the same turn.

Trusting a publisher is a page button with the first-contact wording from `docs/signature-format.md`, never a tool. The
assistant cannot add trust. A trust entry covers files fetched from its origin only: the same signed files served from
another origin verify as `unverifiable`.

The signing dialog (the skill's confirmation dialog) shows the origin, the key id, the expiry and every file path with its
SHA-256. "Irreversible" here means a statement under your name: once published, it stands until it expires or you rotate
the key. The page's own Sign button opens the same dialog.

## Browser rules, and what a browser cannot see

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
- In a browser the gate's `customs` adapter reports "failed unexpectedly" (`unavailable`) for targets that have an Agent
  Customs receipt: `src/gate/adapter-customs.ts` uses Node's `Buffer`. Targets without a receipt are unaffected.

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
- **Styles.** The vendored runtime, which we do not edit, adds one `<style>` block (`runtime/ui.js`, its `BASE_CSS`) and
  six fixed `style=""` attributes (`runtime/ui.js`). The policy allows those seven texts by hash, with `'unsafe-hashes'`
  for the attributes, and no other inline style: a style attribute in model-written HTML is refused (and the runtime's
  HTML sanitizer drops it anyway). `site/tests/csp.test.mjs` recomputes the hashes from the runtime, so a runtime update
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
site can frame the Desk, and on `runtime/sandbox-worker.js` the policy that file asks for. Hosts that honour response
headers should send them; GitHub Pages cannot, so there the Desk can be framed by another site and the sandbox worker
refuses to run a peer's coded tools (the Desk's partners publish none today). `bridge/action-bridge.html` is left
framable on purpose: other agentic sites load it in a hidden frame.

**Checked in a browser** (headless Chromium, 2026-11-17, served from `http://127.0.0.1`): boot with no key, boot with the
assistant blocked, the gate, drift and partner check on `https://agent-atlas-phi.vercel.app/`, key generation, signing a
fixture, verify (unverifiable, trust, verified), the AI model settings panel with a key, a chat turn with a CRUSE form
and a model-written HTML report (scripted model responses), and a partner call to Agent Atlas through its consent card
and bridge frame. No CSP violation, except the one the policy is for: a `style` attribute in the scripted model's HTML
report was refused (`runtime/cruse-render.js`), which changes nothing, because the sanitizer drops it.

## Network URL and callers

The network URL is the folder that holds `agent-manifest.json`, then `plumbline_desk`, for example
`https://<host>/plumbline_desk`. Other agentic sites that call it run it in their visitor's browser on their visitor's key
and get no `website_*` tools, so their assistant points to this page for checks and signing. Their visitor also gets a
consent card for each partner this network asks.

## Linked sites

- **Agent Atlas**, `https://agent-atlas-phi.vercel.app/agent_atlas`, label "Agent Atlas".
- **Agent Customs**, `https://montbaga.github.io/agent-customs/agent_customs`, label "Agent Customs".

Both URLs come from each site's live `agent-manifest.json` (the folder that holds it, then `networks[0].name`); both
pass `check_partner.mjs`. The consent card shows the partner's label, its host and the first 140 characters of the request
before anything is sent; **Always allow** skips the card for that host until the page is reloaded. The assistant is told to
ask only what the partner can answer (what it offers) and never to include names, emails, phone numbers or codes; the
runtime does not filter the request, so check it on the card. A partner's network runs in this browser on the visitor's
key, with none of its own site tools, so it cannot run its own checks from here, and a call costs more than the card's
token estimate. Agent Customs' own network may ask its test-range sites (`agent-customs-range.github.io`); each gets its
own card.

## Files

| Path | What |
| --- | --- |
| `index.html` | the page: structure only, and the Content-Security-Policy; every visible string is in `strings.js` |
| `_headers` | response headers for hosts that read it: `frame-ancestors` and the sandbox worker's policy |
| `strings.js` | every visible string |
| `assistant.css` | the page's baseline styles and the skill's assistant CSS (`--ns-*` colours) |
| `desk.js` | the page object (`App.page`) and its rendering; the page's buttons call it |
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

## Limits

Static hosting only, with a patched copy of nsdeploy's runtime. `write` actions run without a dialog (here only
`generate_key`, which the visitor can discard). Every agent sees every `website_*` tool. Each partner call runs on the
visitor's key after the visitor agrees, at most 4 per message and 1 per partner. A partner that accepts the connection but
never answers leaves the chat waiting until reload. The LLM provider must allow CORS. Everything in the network file,
instructions included, is public. A key chosen for signing sits in this page's memory until it is used or cleared, where
any script on this origin could reach it; signing with the CLI on a build machine keeps it out of the page.
