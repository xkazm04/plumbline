# Plumbline in CI

Two pieces: a gate you run on a pull request or a schedule, and a daily drift watch.

**Gate** (`action/action.yml`, a composite action). It runs `npx plumbline gate <target> --json`.

```yaml
- uses: OWNER/plumbline/action@COMMIT_SHA   # pin by full commit SHA
  with:
    target: https://example.com/            # required: a site or network address
    adapters: validator,atlas,customs       # default: all three
    fail-on: fail                           # or `unavailable`
    plumbline-version: 0.1.0                # default: the version this action was released with
```

`fail-on: fail` fails the step when an adapter says `fail`, and when **every** adapter was `unavailable` (nothing was
checked). With `fail-on: unavailable` it also fails when any one adapter could not be reached or has no receipt.
`unavailable` is never `pass`; the step output `state` says which it was. The Action never passes `--allow-local`: in
CI the gate checks public https sites only.

**The version that runs is pinned.** The Action runs `npx --yes plumbline@<plumbline-version>`, and the input's default
is the package version this action was released with, so pinning the action by commit SHA pins the code that runs too,
not whatever npm serves that day. Only an exact version (`1.2.3` or `1.2.3-rc.1`) is accepted; a range or a tag fails the
step with exit 2. Override it only deliberately, after reading that release. The watch template pins the same way through
its `PLUMBLINE_VERSION` environment variable. A test (`src/test/action-pin.test.ts`) fails when either default differs
from `package.json`'s version, so a release that bumps the package bumps both.

**Watch** (`action/templates/plumbline-watch.yml`). Copy it to `.github/workflows/plumbline-watch.yml`, run
`npx plumbline@0.1.0 watch --init` once and commit `plumbline.lock.json`. It runs daily and on demand with
`contents: read` and `issues: write` only. On a `warn` or `block` finding it creates, or edits, ONE open issue titled
`Plumbline drift`; it never pushes or opens a pull request. `info` findings (upstream runtime is ahead, upstream could not be
asked) stay in the job log. Close the issue yourself once you have reviewed the drift and re-locked.

Both run `npx plumbline@<version>`, so they need that version to be published (or installed in the repository). Third-party actions
in the template are pinned by commit SHA (`actions/checkout` v7.0.1, `actions/setup-node` v7.1.0, resolved from GitHub's
tag refs on 2026-11-17). What each adapter and detector does, and what a clean report does not mean:
`docs/gate-and-watch.md`.
