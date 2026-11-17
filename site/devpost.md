# Plumbline: keep an agentic website true after it ships (draft submission)

> Draft. Every claim below was checked on 2026-11-17 on a local build; re-check before submitting. Placeholders are in
> square brackets.

**Video:** [VIDEO URL]

**Screenshots:** [SCREENSHOT: the gate on Agent Atlas] [SCREENSHOT: the signing dialog] [SCREENSHOT: verified,
unverifiable and invalid side by side]

**Live Desk:** https://plumbline.xkazm04.workers.dev · **Repository:** https://github.com/xkazm04/plumbline

## What it does

An agentic website publishes `agent-manifest.json` and a network file, and every visitor's browser runs them. Two things
are missing once it ships: nobody can tell who published those files, and nobody notices when they drift (the facts the
network was built from change, the copied runtime falls behind, a linked peer changes under you).

Plumbline adds the layer after generation:

- **Sign.** The publisher signs the agent files with an Ed25519 key only they hold. A verifier checks the signature
  against its own trust store and gets one of three verdicts: `verified`, `invalid` (with a reason such as `tampered` or
  `expired`) or `unverifiable`. A verdict proves who published the files and that they did not change. It never says a
  site is safe, and the Desk declines to "certify" one.
- **Gate.** One check asks three independent checkers about a site: Plumbline's port of the reference validation rules,
  Agent Atlas and Agent Customs. Each answers `pass`, `fail` or `unavailable`, and `unavailable` is never folded into `pass`.
- **Watch.** A published `plumbline.lock.json` records the runtime files, grounding sources and peers a site depends on;
  drift is any change since.
- **The Desk**, the part judges can open: an open agentic website that does all of the above live in your browser.

## How it uses the spec

The Desk is itself an agentic website under the Worldwide Agentic Web MVP spec (Profile 0.2). It was built with the
`agentify-website` skill from cognizant-ai-labs/agentic-web:

- a public `agent-manifest.json`, the `plumbline_desk` network JSON built from HOCON by the skill's `build_network.mjs`
  (no errors, no warnings), and the discovery files the build writes;
- the skill's browser runtime, copied unchanged, with the bring-your-own-key settings panel listing hosted Otari first;
  the manifest's router is hosted Otari, with no key anywhere in the site;
- six site actions as `website_*` tools. Reads run directly; making a key is undoable; signing is irreversible and opens
  a confirmation dialog that shows the origin, the key id and every file with its SHA-256;
- two partner sites called by their full network URLs after the visitor agrees on a consent card: Agent Atlas and Agent
  Customs. Both pass the skill's `check_partner.mjs`;
- a bridge, so other agentic sites can call the Desk's network (the Desk passes `check_partner.mjs` as a partner too).

## What it adds to the community

- **Provenance for agent files.** A small, documented signature format (`plumbline.signature.json`) with a first-contact
  ceremony: trust is something the visitor decides on the page after comparing a key id out of band, never something the
  assistant or the site can grant.
- **An honest gate.** Three checkers, three states, and "the browser could not read it" is said in words, never shown as a
  green check.
- **Drift you can see from outside.** Any site that publishes its lock lets anyone see what changed since.
- **Everything in the visitor's browser.** Keys are made with WebCrypto and offered as downloads; nothing is stored or
  uploaded, and no private key material reaches the model (the tests search every tool result and the whole transcript).

## Tools it builds on

- cognizant-ai-labs/agentic-web, the `agentify-website` skill and its browser runtime (Apache-2.0), itself
  cognizant-ai-lab/nsdeploy's runtime with the skill's edits;
- Agent Atlas (its `/api/check`) and Agent Customs (its signed receipts), as gate checkers and as partner sites;
- WebCrypto Ed25519 in the browser and Node 22+; TypeScript; Playwright for the headless browser checks.

## What we checked, and how

- The core's known-answer vectors pass in headless Chromium through the same compiled modules the Desk loads (34 of 34
  checks on 2026-11-17: each subject hashed as its exact bytes, every input canonical JSON must refuse refused).
- In headless Chromium: key made on the page, a site's files signed through the dialog (the manifest, its network, its
  action module and bridge, `links.json` and the lock), then verified: `unverifiable` before trusting the key,
  `verified` after, `invalid tampered` after editing the action module.
- The gate on Agent Atlas' own site from the browser: validator port `pass`, Agent Atlas `pass`, Agent Customs
  `unavailable` (no receipt for that site).
- The page works with the assistant blocked from loading.

## Known limits

[Keep in sync with site/README.md: CORS headers publishers must add, a lock no verified signature covers, static hosting,
write actions without a dialog, partner calls on the visitor's key.]
