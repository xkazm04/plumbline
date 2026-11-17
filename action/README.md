# Plumbline in CI

Two pieces: a gate you run on a pull request or a schedule, and a daily drift watch.

**Gate** (`action/action.yml`, a composite action). It runs `npx plumbline gate <target> --json`.

```yaml
- uses: OWNER/plumbline/action@COMMIT_SHA   # pin by full commit SHA
  with:
    target: https://example.com/            # required: a site or network address
    adapters: validator,atlas,customs       # default: all three
    fail-on: fail                           # or `unavailable`
```

`fail-on: fail` fails the step only when an adapter says `fail`. With `fail-on: unavailable` it also fails when an
adapter could not be reached or has no receipt. `unavailable` is never `pass`; the step output `state` says which it was.

**Watch** (`action/templates/plumbline-watch.yml`). Copy it to `.github/workflows/plumbline-watch.yml`, run
`npx plumbline watch --init` once and commit `plumbline.lock.json`. It runs daily and on demand with
`contents: read` and `issues: write` only. On a `warn` or `block` finding it creates, or edits, ONE open issue titled
`Plumbline drift`; it never pushes or opens a pull request. `info` findings (upstream runtime is ahead, upstream could not be
asked) stay in the job log. Close the issue yourself once you have reviewed the drift and re-locked.

Both run `npx plumbline`, so they need the package to be published (or installed in the repository). Third-party actions
in the template are pinned by commit SHA (`actions/checkout` v7.0.1, `actions/setup-node` v7.1.0, resolved from GitHub's
tag refs on 2026-11-17). What each adapter and detector does, and what a clean report does not mean:
`docs/gate-and-watch.md`.
