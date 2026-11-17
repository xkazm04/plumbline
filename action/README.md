# Plumbline in CI

Two pieces: a gate you run on a pull request or a schedule, and a daily drift watch. Both install Plumbline from this
repository at one exact commit (`npx --yes github:xkazm04/plumbline#<commit sha>`), never from npm: the npm name
`plumbline` belongs to an unrelated package, so `npx plumbline` would run someone else's code.

**Gate** (`action/action.yml`, a composite action). It runs `plumbline gate <target> --json`.

```yaml
- uses: xkazm04/plumbline/action@COMMIT_SHA   # pin the action by full commit SHA
  with:
    target: https://example.com/            # required: a site or network address
    adapters: validator,atlas,customs       # default: all three
    fail-on: fail                           # or `unavailable`
    # plumbline-ref: <full commit sha>      # default: the commit this action pins; override only deliberately
```

`fail-on: fail` fails the step when an adapter says `fail`, and when **every** adapter was `unavailable` (nothing was
checked). With `fail-on: unavailable` it also fails when any one adapter could not be reached or has no receipt.
`unavailable` is never `pass`; the step output `state` says which it was. The Action never passes `--allow-local`: in
CI the gate checks public https sites only.

**The code that runs is pinned.** `plumbline-ref` must be a full 40-character commit SHA (a branch, tag or short SHA
fails the step with exit 2), and its default is a commit of this repository that builds itself on a git install, so
pinning the action by commit SHA pins the code that runs too. The watch template pins the same commit through its
`PLUMBLINE_REF` environment variable. A test (`src/test/action-pin.test.ts`) holds both to one commit that exists in
this repository's history, is marked private (never publishable to npm) and has a `prepare` build.

**Watch** (`action/templates/plumbline-watch.yml`). Copy it to `.github/workflows/plumbline-watch.yml`. Once, run
`npx --yes github:xkazm04/plumbline#<PLUMBLINE_REF> watch --init`, then sign the site (the lock is a signed file) and
commit both. It runs daily and on demand with `contents: read` and `issues: write` only. On a `warn` or `block` finding
it creates, or edits, ONE open issue titled `Plumbline drift`; it never pushes or opens a pull request. `info` findings
(upstream runtime is ahead, upstream could not be asked) stay in the job log. Close the issue yourself once you have
reviewed the drift, re-locked and signed again.

Third-party actions in the template are pinned by commit SHA (`actions/checkout` v7.0.1, `actions/setup-node` v7.1.0,
resolved from GitHub's tag refs on 2026-11-17). What each adapter and detector does, and what a clean report does not
mean: `docs/gate-and-watch.md`.
