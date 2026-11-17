# Plumbline in CI

One composite Action (`action/action.yml`) with two commands, and a daily watch template that uses it. The Action
builds Plumbline from its own checkout (`npm ci`, then the build) and runs `node dist/cli/index.js`, so **pinning the
Action by commit SHA pins the code that runs**: no package registry is involved. (The npm name `plumbline` belongs to
an unrelated package, and `npx`'s git installs fail on the runner's npm.)

**Gate.**

```yaml
- uses: xkazm04/plumbline/action@COMMIT_SHA   # pin by full commit SHA
  with:
    command: gate                           # default
    target: https://example.com/            # required for gate: a site or network address
    adapters: validator,atlas,customs       # default: all three
    fail-on: fail                           # or `unavailable`
```

`fail-on: fail` fails the step when an adapter says `fail`, and when **every** adapter was `unavailable` (nothing was
checked). With `fail-on: unavailable` it also fails when any one adapter could not be reached or has no receipt.
`unavailable` is never `pass`; the step output `state` says which it was. The Action never passes `--allow-local`: in
CI the gate checks public https sites only.

**Watch** (`command: watch`, `root:` the site folder holding `plumbline.lock.json`). It reports grounding, runtime and
peer drift; outputs `report` (the JSON path) and `findings` (how many are `warn` or `block`). Exit 1 from the CLI
(findings) does not fail the step; a real error does.

**The watch template** (`action/templates/plumbline-watch.yml`) uses the Action pinned by commit SHA. Copy it to
`.github/workflows/plumbline-watch.yml`. Once, in a clone of this repository at the pinned commit, run
`npm ci && node dist/cli/index.js watch --root <your site> --init`, then sign the site (the lock is a signed file) and
commit both. It runs daily and on demand with `contents: read` and `issues: write` only. On a `warn` or `block` finding
it creates, or edits, ONE open issue titled `Plumbline drift`; it never pushes or opens a pull request. `info` findings
(upstream runtime is ahead, upstream could not be asked) stay in the job log. Close the issue yourself once you have
reviewed the drift, re-locked and signed again.

A test (`src/test/action-pin.test.ts`) holds this: the Action builds itself, nothing installs Plumbline by name, and
the template's pinned commit exists in this repository's history and holds the self-building Action. The
`Action smoke` workflow runs both commands through the Action on a GitHub runner every Monday and on demand.

Third-party actions are pinned by commit SHA (`actions/checkout` v7.0.1, `actions/setup-node` v7.1.0, resolved from
GitHub's tag refs on 2026-11-17). What each adapter and detector does, and what a clean report does not mean:
`docs/gate-and-watch.md`.
