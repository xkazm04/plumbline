# Plumbline

Keep an agentic website true after it ships.

An agentic website publishes `agent-manifest.json` and an agent network that runs in the visitor's browser (the
[Worldwide Agentic Web MVP spec](https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/worldwide_agentic_web_mvp_spec.md)).
Those files go stale and nothing says who published them: the site changes under the network's frozen facts, the copied
browser runtime falls behind its upstream, and a linked peer's definition changes under you, which is new code running in
your visitor's tab. Generation is solved elsewhere; Plumbline is the layer after it.

| Part | What it does |
|---|---|
| **sign** | The publisher signs the agent files (`agent-manifest.json`, its networks, `links.json`) with an Ed25519 key they hold: `plumbline.signature.json`, with `.well-known/plumbline-key.json`. Rotation for planned changes, self-signed revocation for leaks. |
| **verify** | Three honest verdicts against the verifier's own trust store: `verified`, `invalid` (tampered, expired, bad-signature, kid-mismatch, malformed, revoked) or `unverifiable`. A stranger is never `verified`, whatever the math says. |
| **gate** | One report from three independent checkers: a port of the reference validation rules, Agent Atlas and Agent Customs' signed receipts. Each `pass`, `fail` or `unavailable`; unavailable is never a pass. |
| **watch** | Grounding, runtime and peer drift against `plumbline.lock.json`, each `info`, `warn` or `block`; a scheduled workflow keeps one drift issue up to date. |
| **the Desk** | `site/`: an open agentic website, on the unmodified reference runtime, where a visitor or another site's agent does all of the above in the browser. Agent Atlas and Agent Customs are its consented peers. |

A verified signature proves who published the files and that they did not change. It does not prove a site is safe.

## Use it

```sh
npm ci && npm run build
node dist/cli/index.js keygen --out ./keys            # keep keys/plumbline.private.json out of git
node dist/cli/index.js sign --root ./site --key ./keys/plumbline.private.json --origin https://example.org
node dist/cli/index.js verify --root ./site --trust ./plumbline.trust.json --origin https://example.org
node dist/cli/index.js gate https://agent-atlas-phi.vercel.app/
node dist/cli/index.js watch --root ./site --init     # writes plumbline.lock.json; later runs report drift
```

Exit codes: 0 clean, 1 findings, 2 usage or I/O error. `gate --allow-local` checks a site on your own machine over
http and still refuses every private range. In CI: `action/action.yml` (gate) and `action/templates/plumbline-watch.yml`
(daily drift issue); both run an exact plumbline version.

## Documents

- `docs/signature-format.md` - every file, field and verdict; key custody, rotation, revocation, first contact.
- `docs/gate-and-watch.md` - the adapters, the detectors, the severity rules and the guarded fetch.
- `site/README.md` - how the Desk is built, its Content-Security-Policy, and how to serve it.
- `action/README.md` - the Action and the watch template.

## Develop

`npm run check` (typecheck and tests), `npm run check:wire` (the format's exact strings), `npm run test:site` (the Desk).
`CLAUDE.md` holds the working rules. This repository is maintained through bp, a
product blueprint: its scans and stand-ups decide what is built next.

## Licence

Apache-2.0. `site/runtime/` is a byte-for-byte copy of the reference browser runtime (nsdeploy, Apache-2.0, see its
`LICENSE.txt` and `NOTICE`); Plumbline does not modify it.
