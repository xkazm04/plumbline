# Plumbline

Agent change control: know what your agent is made of, and who approved each change to it.

An AI agent is its prompt and instruction files, its host settings and hooks, its model ids, the MCP servers it calls
and the tool definitions those servers advertise, and the agents it talks to. Any of these can change under you: a
pull request edits `CLAUDE.md`, a hook appears in `.claude/settings.json`, an MCP server ships a new tool description
the model will read and obey. Plumbline pins all of it by hash, has a named person sign each accepted state with their
own key, and enforces the approved state in CI and at the moment a tool would run.

| Part | What it does |
|---|---|
| **lock** | `plumbline agent init` declares the agent (`plumbline.agent.json`) and pins every component by hash in `plumbline.agent.lock.json`; `agent relock` accepts a reviewed change, and each lock names the one it replaces. |
| **approve** | `plumbline approve` signs the lock's exact bytes with a person's own Ed25519 key (`plumbline.agent.approval.json`). Approvers are listed in a trust store held outside the repository (`plumbline approver add`), so a pull request cannot approve itself. |
| **check** | `plumbline agent check` fails when anything differs from the approved lock, or when the lock's approval is absent, invalid or unverifiable. In CI it is a required check on every pull request. |
| **guard** | `plumbline guard` sits between the agent host and each stdio MCP server: tools whose definition differs from the lock are hidden, and a call to one is refused. |
| **audit** | `plumbline audit` walks the lock's git history: every version, who approved it, and where the chain breaks; `--out` writes a table to attach as change-management evidence. |

A verified approval proves that a person you listed accepted exactly this agent. It does not prove the agent is safe.

### Quick start

From your agent's repository root, with your approval key kept outside it:

```sh
plumbline keygen --out ../plumbline-approver                                         # your own key; never commit it
plumbline approver add --key ../plumbline-approver/.well-known/plumbline-key.json --label "Your Name"
plumbline agent init --wrap         # declares and locks the agent; puts the guard in front of each stdio server in .mcp.json
plumbline approve --key ../plumbline-approver/plumbline.private.json   # signs the lock: commit the lock and the approval
plumbline agent check               # exit 0: the agent is what you approved
```

`approver add` writes your trust store at `$PLUMBLINE_HOME/approvers.json` (by default `~/.config/plumbline/`), never
inside a repository. From then on your agent host starts each stdio MCP server through `plumbline guard`, which lets
through only the tools the approved lock pins. After a change you accept: `plumbline agent relock`, review what it
lists, `plumbline approve`, commit both files. `plumbline audit --out evidence` shows every approved change since the
first lock.

**In CI**, copy `action/templates/plumbline-agent.yml` into `.github/workflows/` and set the repository variable
`PLUMBLINE_APPROVERS` to your approvers file's JSON text. Every pull request runs the offline check; make it a required
status check and an approval becomes mandatory for any change to the agent. A daily run also checks remote MCP servers
and peers and keeps one issue (`action/README.md`). The formats: `docs/agent-lock.md`.

## The same engine for agentic websites

Keep an agentic website true after it ships.

An agentic website publishes `agent-manifest.json` and an agent network that runs in the visitor's browser (the
[Worldwide Agentic Web MVP spec](https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/worldwide_agentic_web_mvp_spec.md)).
Those files go stale and nothing says who published them: the site changes under the network's frozen facts, the copied
browser runtime falls behind its upstream, and a linked peer's definition changes under you, which is new code running in
your visitor's tab. Generation is solved elsewhere; Plumbline is the layer after it.

| Part | What it does |
|---|---|
| **watch** | Grounding, runtime and peer drift against `plumbline.lock.json`, each `info`, `warn` or `block`; `init` writes the lock and the daily workflow with no key, `watch --url` re-checks a site's published lock; a scheduled workflow keeps one drift issue. |
| **sign** | The publisher signs the exact bytes of the agent files (`agent-manifest.json`, its networks, the action module, bridge and coded-tools bundle it names, `links.json`, the lock) with an Ed25519 key they hold: `plumbline.signature.json`, with `.well-known/plumbline-key.json`. Rotation for planned changes, self-signed revocation for leaks. |
| **verify** | Three honest verdicts against the verifier's own trust store: `verified`, `invalid` (tampered, expired, bad-signature, kid-mismatch, malformed, revoked) or `unverifiable`. A stranger is never `verified`, whatever the math says. |
| **gate** | One report from three independent checkers: a port of the reference validation rules, Agent Atlas and Agent Customs' signed receipts. Each `pass`, `fail` or `unavailable`; unavailable is never a pass. |
| **the Desk** | `site/`: an open agentic website where a visitor or another site's agent does all of the above in the browser. It runs on the reference browser runtime as the agentic-web skill ships it: nsdeploy's runtime with the skill's edits, copied here unchanged (`site/runtime/README.md` lists the edits). Agent Atlas and Agent Customs are its consented peers. |

A verified signature proves who published the files and that they did not change. It does not prove a site is safe.

## Use it for an agentic website

Every block below names the folder it runs in. `plumbline --help` lists the commands by role, and `plumbline <command>
--help` gives one command's options. Exit codes everywhere: 0 clean, 1 findings (for `trust` without `--yes`: nothing
added), 2 usage or I/O error.

### Install, once (Node 22 or later)

In the folder where you keep tools (not your site's repository):

```sh
git clone https://github.com/xkazm04/plumbline.git
cd plumbline
npm ci            # installs TypeScript and builds dist/
npm link          # puts the plumbline command on your PATH
plumbline --help
```

Without `npm link`, type `node <path to the clone>/dist/cli/index.js` wherever this page and the CLI's own output say
`plumbline`. The Action builds the same code in CI; nothing is installed from npm.

### The quickest first result: gate one address

From any folder:

```sh
plumbline gate https://your-site.example/
```

One report from three checkers (Plumbline's port of the reference validation rules, Agent Atlas and Agent Customs),
each `pass`, `fail` or `unavailable`; unavailable is never a pass. The gate sends the address to Agent Atlas and says so
before it does; `--adapters validator` sends it nowhere.

### Publisher: publish and watch your own site

From your site's repository root (the folder that holds `.github/`), with the site's files in `site/`:

```sh
plumbline init --root site --workflow    # writes site/plumbline.lock.json and .github/workflows/plumbline-watch.yml; no key
plumbline watch --root site              # "watch: no drift" and exit 0, or the findings and exit 1
```

`init` makes no key and asks for no trust decision; it prints what to commit and what to run next. Commit what it
lists, and the daily workflow keeps one drift issue. `--source <page>` names a page whose facts the network states (a
price list, opening hours), so a change to it is drift, and `init` prints which of those facts the page states and which
no page states. After you review a drift you accept, `plumbline watch --root site --relock` rewrites the lock and prints
what changed.

**Then sign: the upgrade.** A signature lets anyone check who published the agent files. From the same folder, with
the key outside the repository:

```sh
plumbline keygen --out ../plumbline-keys     # never commit plumbline.private.json
mkdir -p site/.well-known && cp ../plumbline-keys/.well-known/plumbline-key.json site/.well-known/
plumbline sign --root site --key ../plumbline-keys/plumbline.private.json --origin https://your-site.example
```

The lock is one of the signed files, so once the site is signed, accepting a drift is `plumbline watch --root site
--relock` and then the same `plumbline sign` again.

### Verifier: check a partner or a stranger

From any folder; the trust file is yours and lives where you keep it:

```sh
plumbline trust --url https://partner.example --file plumbline.trust.json
#   prints the kid and adds nothing (exit 1). Confirm that kid with the publisher out of band, then:
plumbline trust --url https://partner.example --file plumbline.trust.json --yes
plumbline verify --url https://partner.example --trust plumbline.trust.json    # verified, invalid or unverifiable
plumbline watch --url https://partner.example/                                 # re-checks the lock the site publishes
plumbline adopt --url https://partner.example --trust plumbline.trust.json     # follows a rotation the site publishes
```

`verify` only ever trusts its own trust file: a stranger is never `verified`, whatever the math says. To rehearse
against a site on this machine (`http://127.0.0.1:<port>`), add `--allow-local` to each command; private ranges stay
refused.

### Operator: run a portfolio

From any folder, with `sites.txt` holding one https address per line:

```sh
plumbline scan sites.txt --out scan-report
```

It writes `scan-report/report.json` and `scan-report/report.html`, the sites that need attention first, and says what
it sends where before it starts. `--adapters validator` sends no address to a third party; `--trust <your trust file>`
checks each site's signature against your own trust file; `--allow-local` takes a staging list on this machine. Before a
launch, `plumbline gate --root <build folder>` checks the files with the validator's rules and sends nothing anywhere.

### The bad day: your signing key leaked

From your site's repository root. Do not `rotate` after a leak: whoever holds the leaked key can rotate too.

```sh
plumbline revoke --root site --key ../plumbline-keys/plumbline.private.json    # writes site/plumbline-revocation.json; it is final
plumbline keygen --out ../plumbline-keys-new                                  # a NEW key, one no rotation names
cp ../plumbline-keys-new/.well-known/plumbline-key.json site/.well-known/
plumbline sign --root site --key ../plumbline-keys-new/plumbline.private.json --origin https://your-site.example
plumbline dns --key ../plumbline-keys-new/.well-known/plumbline-key.json --origin https://your-site.example
```

Publish the site (the revocation included), replace the `_plumbline` TXT record with the one `dns` printed, and give
each verifier the new kid out of band, as at first contact (`docs/signature-format.md`, "Revocation").

### CI

The workflow `init --workflow` wrote runs the Action pinned by commit SHA: `uses: xkazm04/plumbline/action@<commit
sha>` (gate, watch or agent; `issues: true` keeps one drift issue, with a comment when its findings change). The Action builds
Plumbline from the commit you pin, so the code that runs is exactly that commit's. To have it propose the relock as one
pull request, the repository needs three settings, which the workflow's header and `action/README.md` name (it also
says how to gate a branch before deployment, how to hear about security fixes and how to move the pin).

## Documents

- `SECURITY.md` - how to report a security problem, what is in scope, and how fixes are released.
- `THIRD_PARTY.md` - the third-party code the Desk ships (the vendored runtime and its bundle), with sizes and hashes.
- `docs/signature-format.md` - every file, field and verdict; key custody, rotation, revocation, first contact.
- `docs/gate-and-watch.md` - the adapters, the detectors, the severity rules and the guarded fetch.
- `docs/jws-profile.md` - the same signature as a detached JWS (EdDSA), and the canonical bytes against RFC 8785.
- `docs/proposals/` - texts written to be submitted upstream as they stand.
- `docs/trust-bootstrap.md` - first contact through a second channel (a DNS record naming the kid), and the designs not built yet.
- `docs/ecosystem-scan.md` - `plumbline scan` over a list of sites, its report schema, and the gate badge.
- `site/README.md` - how the Desk is built, its Content-Security-Policy, and how to serve it.
- `docs/agent-lock.md` - agent change control: the declaration, the lock and its chain, approval, the guard, audit and CI.
- `action/README.md` - the Action, the watch template and the agent template.

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
