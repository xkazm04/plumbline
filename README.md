# Plumbline

Keep an agentic website true after it ships.

An agentic website publishes `agent-manifest.json` and an agent network that runs in the visitor's browser (the
[Worldwide Agentic Web MVP spec](https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/worldwide_agentic_web_mvp_spec.md)).
Those files go stale and nothing says who published them: the site changes under the network's frozen facts, the copied
browser runtime falls behind its upstream, and a linked peer's definition changes under you, which is new code running in
your visitor's tab. Generation is solved elsewhere; Plumbline is the layer after it.

| Part | What it does |
|---|---|
| **sign** | The publisher signs the exact bytes of the agent files (`agent-manifest.json`, its networks, the action module, bridge and coded-tools bundle it names, `links.json`, the lock) with an Ed25519 key they hold: `plumbline.signature.json`, with `.well-known/plumbline-key.json`. Rotation for planned changes, self-signed revocation for leaks. |
| **verify** | Three honest verdicts against the verifier's own trust store: `verified`, `invalid` (tampered, expired, bad-signature, kid-mismatch, malformed, revoked) or `unverifiable`. A stranger is never `verified`, whatever the math says. |
| **gate** | One report from three independent checkers: a port of the reference validation rules, Agent Atlas and Agent Customs' signed receipts. Each `pass`, `fail` or `unavailable`; unavailable is never a pass. |
| **watch** | Grounding, runtime and peer drift against `plumbline.lock.json`, each `info`, `warn` or `block`; a scheduled workflow keeps one drift issue up to date. |
| **the Desk** | `site/`: an open agentic website where a visitor or another site's agent does all of the above in the browser. It runs on the reference browser runtime as the agentic-web skill ships it: nsdeploy's runtime with the skill's edits, copied here unchanged (`site/runtime/README.md` lists the edits). Agent Atlas and Agent Customs are its consented peers. |

A verified signature proves who published the files and that they did not change. It does not prove a site is safe.

## Use it

A publisher, in order (the lock comes before the signature, because the lock is one of the signed files):

```sh
npm ci && npm run build
node dist/cli/index.js keygen --out ./keys            # keep keys/plumbline.private.json out of git
node dist/cli/index.js watch --root ./site --init     # 1. writes plumbline.lock.json
node dist/cli/index.js sign --root ./site --key ./keys/plumbline.private.json --origin https://example.org   # 2. signs the lock too
```

A verifier first decides whom to trust; `verify` only ever trusts its own trust file. Here the publisher checks their
own site; a verifier who is not the publisher first downloads the site's `.well-known/plumbline-key.json` and passes that:

```sh
node dist/cli/index.js trust --key ./keys/.well-known/plumbline-key.json --origin https://example.org --file ./plumbline.trust.json
#   prints the kid and adds nothing (exit 1). Confirm that kid with the publisher out of band, then rerun with --yes.
node dist/cli/index.js trust --key ./keys/.well-known/plumbline-key.json --origin https://example.org --file ./plumbline.trust.json --yes
#   or read the key record from the live site: trust --url https://example.org --file ./plumbline.trust.json [--yes]
node dist/cli/index.js verify --root ./site --trust ./plumbline.trust.json --origin https://example.org   # a local copy
node dist/cli/index.js verify --url https://example.org --trust ./plumbline.trust.json                    # the live site
node dist/cli/index.js gate https://agent-atlas-phi.vercel.app/
node dist/cli/index.js adopt --url https://example.org --trust ./plumbline.trust.json        # follow a published rotation
```

Later, the watch reports drift against the lock. Once a person has reviewed a drift and accepts it, `--relock` rewrites
the lock and prints what changed; sign again, because the lock is a signed file:

```sh
node dist/cli/index.js watch --root ./site
node dist/cli/index.js watch --root ./site --relock
node dist/cli/index.js sign --root ./site --key ./keys/plumbline.private.json --origin https://example.org
```

Exit codes: 0 clean, 1 findings (for `trust` without `--yes`: nothing added), 2 usage or I/O error.
`gate --allow-local` checks a site on your own machine over http and still refuses every private range. In CI:
`uses: xkazm04/plumbline/action@<commit sha>` (gate or watch; `issues: true` keeps one drift issue, with a comment when
its findings change) and `action/templates/plumbline-watch.yml` (a daily drift issue, closed by the next clean run).
The Action builds Plumbline from the commit you pin, so the code that runs is exactly that commit's (`action/README.md`,
which also says how to hear about security fixes and move the pin).

## Documents

- `SECURITY.md` - how to report a security problem, what is in scope, and how fixes are released.
- `THIRD_PARTY.md` - the third-party code the Desk ships (the vendored runtime and its bundle), with sizes and hashes.
- `docs/signature-format.md` - every file, field and verdict; key custody, rotation, revocation, first contact.
- `docs/gate-and-watch.md` - the adapters, the detectors, the severity rules and the guarded fetch.
- `site/README.md` - how the Desk is built, its Content-Security-Policy, and how to serve it.
- `action/README.md` - the Action and the watch template.

## Develop

`npm run check` (typecheck and tests), `npm run check:wire` (the format's exact strings), `npm run test:site` (the Desk),
`node --test "action/*.test.mjs"` (the Action's input checks, report reader and drift-issue decisions).
`CLAUDE.md` holds the working rules. This repository is maintained through bp, a
product blueprint: its scans and stand-ups decide what is built next.

## Licence

Apache-2.0. `site/runtime/` is a byte-for-byte copy of the browser runtime in the agentic-web project's
`agentify-website` skill (commit `7ee54a3`), which is nsdeploy's runtime (commit `53a787c`) with the edits its
`README.md` lists; Apache-2.0, see its `LICENSE.txt` and `NOTICE`. Plumbline does not modify it further. `THIRD_PARTY.md`
lists every file with its hash.
