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
checked). With `fail-on: unavailable` it also fails when any one adapter could not be reached or has no receipt; Agent
Customs has published receipts for few sites, so with `fail-on: unavailable` nearly every site fails on Customs alone
unless `adapters: validator,atlas` leaves it out. `unavailable` is never `pass`; the step output `state` says which it
was, and the job summary says what was checked in the CLI's words: "Checked by 1 of 3 (validator pass); Atlas and
Customs had no verdict." under the heading, or, in the heading itself, "the site could not be reached (...); nothing was
checked, so this is not a pass" and "nothing was checked: every checker was unavailable, so this is not a pass". The
summary ends with a signature line: the Action's gate is not given a trust file, so it reads "**signature**: not
checked", and a site's signature is checked with `plumbline verify` (or `plumbline gate --trust <file>`, whose report
the summary reads the same way). The Action never passes `--allow-local`: in CI the gate checks public https sites only.

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
the open one. Editing a body notifies nobody, so when the findings themselves change it also comments, naming what is
new (each with its sentence, which says what changed in counts) and what is no longer reported, and a new `block` comes
first. A finding that is back with new evidence but the same sentence the issue's table already holds (a page edited
again while the same fact is still stale) is listed under "Changed again, and what the finding says is unchanged",
without repeating the sentence. When the only new `block` is the site's own signature no longer covering its files (what
a relock looks like until the site is signed again), the comment leads with that and says to sign again if you or your
developer relocked, instead of the general alarm. A finding changes when its severity, kind or ref does, or when its evidence does: the hash of what it found
changed (`actual`), so a partner that changed again (a second agent, a links.json, a fee change that keeps every
outline count) or a page whose price changed after a wording edit is news on an issue already open. A summary's
wording alone is not, and an unreachable peer carries no evidence, so one that is still unreachable after 12 s instead
of 10 s notifies nobody. The body carries the findings, with their evidence, in a hidden `<!-- plumbline:digest ... -->`
marker, which is how the next run tells what is new (an issue written before the evidence was carried is read as
before, so an upgrade is not news). The relock pull request carries the same marker, so new evidence edits it and
pushes the branch's lock with the new hash. An unchanged run writes nothing. The next clean run closes the issue with a comment linking that run and saying
what clean covers: the locked files, peers and runtime match the lock, and the site's signature, if it has one, still
covers its files (the watch reports a signature that does not as `block`, so a merged unsigned relock never closes the
issue as clean). Output
`issue-action` says which it did: `create`, `edit`, `close` or `none`. Without `issues: true` the Action touches no
issue, and you can keep your own with `findings` and `issue-body`.

**Accepting drift in one review** (`relock-pr: true`, watch only). On `warn` or `block` findings the Action runs
`watch --relock` on the branch `plumbline/relock` (made from the commit the job checked out) and keeps ONE pull request
from it, titled `Plumbline: accept the drift (relock)`. Its body lists what the new lock changes (`added`, `removed`,
`changed`, as `--relock` prints them), what the relock does not accept or keeps as it was (a page that dropped a fact the
network still states, a pin it could not re-read: those keep reporting after a merge, and are not listed as accepted),
the signers it records for the first time (a peer first seen, a relisted one included, or one recorded unsigned before),
and the findings it accepts. When a peer's recorded signer changed (another key, or no signature at all now: TOM-RC-1),
the relock refuses (UAT-4: CI never passes `--accept-signer`), so nothing is pushed and no pull request removes or
replaces a recorded signer: an open pull request's body says the relock was refused, names each peer (the kid the lock
recorded, and the kid it is signed by now with what it publishes about it, or that it publishes no signature) and gives
one command per peer that a person runs after deciding (with several peers each is narrowed with `--accept`, and a new
key gets `--trust <your trust file>`), with a comment (`pr-action: describe`); with none open, the drift issue says it,
with the same commands. The watch keeps reporting such a peer as `block`, so the issue stays open until a person
decides. The findings' summaries carry the counts (what changed in a
peer, how many facts a page no longer states, how many skills a card added). With `signing-key` (a secret holding the
JSON of `plumbline.private.json`) and `origin`, it also signs, and the body names the kid; without a key, the body says
to sign locally and the pull request stays a draft. A site that publishes no `plumbline.signature.json` has nothing to
sign: its pull request is not a draft and its body and issue say nothing about signing (UAT-12), so a scheduled run with
the pull request open, marked ready and unchanged does nothing. A person merges; the run accepts nothing. A relock that changes no
ref opens nothing; a body that has not changed pushes nothing; the next run with nothing to accept closes the pull
request with a comment. Output `pr-action`: `create`, `edit`, `describe`, `close` or `none`. The job needs `contents: write` and
`pull-requests: write`, and the branch is the Action's own: it is replaced on each push, with a lease that names what
the run fetched (`--force-with-lease=refs/heads/<branch>:<the fetched commit>`, or `:` with nothing after it, "must not
exist", when there was no branch). So a second drift while the pull request is open replaces the branch and edits the
same pull request, and a run after a merged pull request whose branch was kept opens a new one on it. A branch someone
else moved between the fetch and the push is not overwritten: the push is refused and the step fails.

```yaml
- uses: xkazm04/plumbline/action@COMMIT_SHA
  with:
    command: watch
    root: site
    issues: true
    relock-pr: true
    signing-key: ${{ secrets.PLUMBLINE_SIGNING_KEY }}   # optional: without it, a draft to sign locally
    origin: https://example.org                          # with signing-key
```

**Renewing the signature** (`renew: true`, watch only, needs `signing-key` and `origin`). When the watch reports that
the site's signature expires within 14 days, or has expired, the Action signs the same files again on the branch
`plumbline/renew` and keeps ONE pull request `Plumbline: renew the signature`. `action/templates/plumbline-renew.yml`
runs it weekly. The key reaches the CLI as an environment variable only (`plumbline sign --key-env`): it is never an
argument, never written to disk and never printed; the CLI's notes on CI custody are printed with the signature.

**Forwarding the drift issue to a chat** needs no new code: the `issue-body` output is the path of the issue's Markdown.
For example, after the Action step (`id: watch`), with a webhook URL in a secret:

```yaml
- name: Tell the team
  if: steps.watch.outputs.findings != '0'
  shell: bash
  env:
    WEBHOOK: ${{ secrets.CHAT_WEBHOOK_URL }}
    BODY: ${{ steps.watch.outputs.issue-body }}
  run: jq -Rs '{text: .}' "$BODY" | curl -fsS -X POST -H 'content-type: application/json' --data @- "$WEBHOOK"
```

The body holds Plumbline's sentences, the findings' refs and the digest marker; a site's own words are never in it.

**Refusals.** Before the build, the Action refuses a `command` other than `gate` or `watch`, a gate without `target`, a
`fail-on` other than `fail` or `unavailable`, an `issues` other than `true` or `false`, `issues: true` with the gate,
a watch `root` that is not a folder in the workspace, a `relock-pr` or `renew` other than `true` or `false` or with the gate, both together, `renew` without `signing-key`, a `signing-key` without an https `origin`, and a `signing-key` with neither. Each fails the step with its reason.

Every decision is in `action/report.mjs` (plain Node, no dependencies): the input check, the one read of the report, and
what to do with the drift issue; the Action's shell only carries them out. `node --test "action/*.test.mjs"` tests them,
and runs the Action's issue steps and its pull request step through bash against a stub `gh` (the push once with the
real `git` against a local bare remote: create, a second drift on the existing branch, and a run after a merge whose
branch remains, for the relock and the renewal branch; on Windows, set `PLUMBLINE_TEST_BASH` to Git Bash, or those
tests are skipped).

**The watch template** (`action/templates/plumbline-watch.yml`) uses the Action pinned by commit SHA. `plumbline init
--workflow` writes it to `.github/workflows/plumbline-watch.yml` with your site folder as `root:`, or copy it there by
hand. Once, in a clone of this repository at the pinned commit, run `npm ci && node dist/cli/index.js init --root <your
site>` (the same capture as `watch --init`) and commit the lock; if the site is signed, sign it again after the lock is
written (the lock is a signed file) and commit both. It runs daily and on demand with `contents: read` and `issues: write` only, and passes `issues: true`, so
the Action keeps the drift issue as above. `info` findings
(upstream runtime is ahead, upstream could not be asked) stay in the job log. When you have reviewed a drift and accept
it, run `node dist/cli/index.js watch --root <your site> --relock` in that clone: it rewrites the lock from the current
state and prints what changed. If the site is signed, sign it again (the lock is a signed file) and commit both; if not,
commit the lock. The next run that
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
