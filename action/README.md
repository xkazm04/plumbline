# Plumbline in CI

**Start here: the watch, with no key.** In a clone of this repository, from your site repository's root:
`node <clone>/dist/cli/index.js init --root <your site> --workflow` writes `plumbline.lock.json` into the site and
`.github/workflows/plumbline-watch.yml` from the template below (with `root:` set to your site folder; it never
overwrites a workflow that is there). Commit both: the daily watch runs on the lock alone and keeps one drift issue.
Signing the site is the upgrade, and the lock is then one of the signed files.

One composite Action (`action/action.yml`) with two commands, and a daily watch template that uses it. The Action
builds Plumbline from its own checkout (`npm ci`, then the build) and runs `node dist/cli/index.js`, so **pinning the
Action by commit SHA pins the code that runs**: no package registry is involved. (The npm name `plumbline` belongs to
an unrelated package, and `npx`'s git installs fail on the runner's npm.)

**What the build costs.** Measured 2026-11-18 on a Windows 11 workstation (Node 24.22, npm 11.19) in a fresh folder
holding `package.json`, `package-lock.json`, `tsconfig.json` and `src/`: `npm ci --offline` 4.6 s (it installs only the
dev dependencies, TypeScript and `@types/node`, 26 MB; Plumbline has no runtime dependency) and `npm run build` 2.9 s,
7.5 s together. The runner downloads those 26 MB instead of reading a local cache, which adds seconds, not tens of
seconds. The roadmap's threshold for caching `~/.npm` is 30 s, so the Action does not cache: a cache key, a restore and
a save would add steps and a cache to trust for a few seconds at most. The `Action smoke` workflow's log shows the
runner's own number; if it ever passes 30 s, cache `~/.npm` keyed on `package-lock.json`. `dist/` is never committed:
the code that runs stays the commit you pin.

**As a package.** `npm pack` makes a tarball with the built CLI (`bin: plumbline`), the watch template `init --workflow`
writes from, the README and the licence, and nothing else (no tests, no source maps, no key); `prepack` empties `dist/`
and builds again, so nothing stale rides along. A test packs it, unpacks it and runs its `init`. It stays
`"private": true` until the owner chooses a scoped name and publishes; then `npx <that name> watch --url <site>` works
with no clone.

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
peer drift; outputs `report` (the JSON path), `findings` (how many are `warn` or `block`) and `issue-body` (the path of a
Markdown file with the drift issue's text). Exit 1 from the CLI (findings) does not fail the step; a real error does,
and so does a report that cannot be read, so a broken run is never taken for a clean one.

```yaml
- uses: xkazm04/plumbline/action@COMMIT_SHA
  with:
    command: watch
    root: site                              # a folder in the workspace
    issues: true                            # keep the drift issue; the job needs `issues: write`
```

**The drift issue** (`issues: true`, watch only). The Action keeps ONE open issue titled `Plumbline drift` with the
job's token (input `token`, default `github.token`), so the job needs `permissions: issues: write` (and `contents: read`
for the checkout); it never pushes or opens a pull request. On `warn` or `block` findings it opens the issue, or edits
the open one. Editing a body notifies nobody, so when the findings themselves change (a severity, kind or ref, not a
summary's wording) it also comments, naming what is new and what is no longer reported, and a new `block` comes first.
The body carries the findings in a hidden `<!-- plumbline:digest ... -->` marker, which is how the next run tells what
is new. An unchanged run writes nothing. The next clean run closes the issue with a comment linking that run. Output
`issue-action` says which it did: `create`, `edit`, `close` or `none`. Without `issues: true` the Action touches no
issue, and you can keep your own with `findings` and `issue-body`.

**Refusals.** Before the build, the Action refuses a `command` other than `gate` or `watch`, a gate without `target`, a
`fail-on` other than `fail` or `unavailable`, an `issues` other than `true` or `false`, `issues: true` with the gate,
and a watch `root` that is not a folder in the workspace. Each fails the step with its reason.

Every decision is in `action/report.mjs` (plain Node, no dependencies): the input check, the one read of the report, and
what to do with the drift issue; the Action's shell only carries them out. `node --test "action/*.test.mjs"` tests them,
and runs the Action's two issue steps through bash against a stub `gh` (on Windows, set `PLUMBLINE_TEST_BASH` to Git
Bash, or that one test is skipped).

**The watch template** (`action/templates/plumbline-watch.yml`) uses the Action pinned by commit SHA. `plumbline init
--workflow` writes it to `.github/workflows/plumbline-watch.yml` with your site folder as `root:`, or copy it there by
hand. Once, in a clone of this repository at the pinned commit, run `npm ci && node dist/cli/index.js init --root <your
site>` (the same capture as `watch --init`) and commit the lock; if the site is signed, sign it again after the lock is
written (the lock is a signed file) and commit both. It runs daily and on demand with `contents: read` and `issues: write` only, and passes `issues: true`, so
the Action keeps the drift issue as above. `info` findings
(upstream runtime is ahead, upstream could not be asked) stay in the job log. When you have reviewed a drift and accept
it, run `node dist/cli/index.js watch --root <your site> --relock` in that clone: it rewrites the lock from the current
state and prints what changed. Sign the site again (the lock is a signed file) and commit both. The next run that
finds nothing to report closes the issue with a comment linking that run; a clean run with no open issue does nothing.

This repository runs the same template on its own Desk (`.github/workflows/watch-desk.yml`), with `uses: ./action` in
place of the pinned SHA so every commit's Action is the one that runs.

A test (`src/test/action-pin.test.ts`) holds this: the Action builds itself, nothing installs Plumbline by name, and
the template's pinned commit exists in this repository's history and holds the self-building Action. The
`Action smoke` workflow runs both commands through the Action on a GitHub runner every Monday and on demand, and checks
that each refusal above fails the step before the build.

Third-party actions are pinned by commit SHA (`actions/checkout` v7.0.1, `actions/setup-node` v7.1.0, resolved from
GitHub's tag refs on 2026-11-17). What each adapter and detector does, and what a clean report does not mean:
`docs/gate-and-watch.md`.

## Security fixes and updating the pinned commit

Security fixes ship as **tagged GitHub releases with release notes** on
[xkazm04/plumbline](https://github.com/xkazm04/plumbline/releases), security fixes first (`.github/release.yml`); a fix
with a published advisory links it. Because the Action is pinned by commit SHA, nothing changes under you, and nothing
tells you either: watch the repository for releases (**Watch > Custom > Releases**). How to report a problem:
`SECURITY.md`.

To move the pin to a release:

```sh
git ls-remote https://github.com/xkazm04/plumbline "refs/tags/<tag>^{}" "refs/tags/<tag>"   # the commit the tag names
```

Use the line ending in `^{}` when there is one (an annotated tag), else the plain one. Replace the 40-character SHA in
your workflow's `uses: xkazm04/plumbline/action@<sha>` and keep the tag as a comment for humans
(`@<sha> # <tag>`). Read the release notes first: a fix may also change the lock or the signature format, and the notes
say what to re-run (`watch --relock`, `sign`). Never pin a branch or a tag name in place of the SHA: either can be moved
under you.
