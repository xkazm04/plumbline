# Agent change control

Status: being built (spark `agent-change-control`, 2026-11-21). The wire is fixed in `src/core/types.ts` (agent
section) and pinned by `src/test/wire-agent.test.ts`; the sections below are filled as each part lands. WP4 owns this
file and merges the sections the other packages write.

A repository declares what its agent is made of, a lock pins every component by hash, a named person approves each
lock with their own key, and each lock names the one it replaces. `plumbline audit` shows who approved every change;
`plumbline agent check` fails a pull request whose agent changed without approval; `plumbline guard` hides any MCP tool
whose definition differs from the approved lock.

## The files

| File | Where | Written by | Signed |
| --- | --- | --- | --- |
| `plumbline.agent.json` | repository | `agent init`, then the owner | covered by the lock (`declaration`) |
| `plumbline.agent.lock.json` | repository | `agent init`, `agent relock` | by the approval |
| `plumbline.agent.approval.json` | repository | `approve` | is the signature |
| `approvers.json` | user-level (`$PLUMBLINE_HOME`), or CI variable `PLUMBLINE_APPROVERS` | `approver add` | no: it is the trust store, out of the repository's reach |
| `.plumbline/pending/<server>.json` | repository, git-ignored | `guard` | never |

## Declaring an agent

(WP2)

## The lock and its chain

(WP2: the lock's fields.)

**The chain.** Every lock after the first names the lock it replaces: `previous` is SHA-256 of that lock's exact bytes
as committed (`agent relock` sets it; the first lock of a chain omits it). An approval repeats its lock's `previous`,
so the chain can be followed from the approvals alone. `plumbline audit` follows it through git: for each distinct
lock version, oldest first, the link is

- `start`: the oldest version in the history, naming no `previous`;
- `ok`: `previous` equals the SHA-256 of the version before it, byte for byte;
- `broken` (`chain-broken`): anything else: a `previous` naming some other lock, none at all after the first, a first
  lock in the history that names one the history does not hold, or bytes that are not a lock document.

A broken link does not say what happened (a lock rewritten by hand, history squashed, a relock outside Plumbline); it
says the history can no longer show that each change replaced the one approved before it. The lock's bytes are hashed
exactly as committed: keep `* text=auto eol=lf` (or `-text` for the lock) in `.gitattributes`, or a checkout that
rewrites line endings has a different lock from the one approved (`approve` warns when the lock holds CRLF and no
`.gitattributes` pins LF).

## Tool definitions

A tool's definition hash is SHA-256 of canonical JSON of the tool object restricted to `name`, `title`, `description`,
`inputSchema`, `outputSchema` and `annotations` (keys the server did not send are left out; `_meta` is excluded), keyed
by SHA-256 of its name; a repeated name's later occurrences are keyed by SHA-256 of `name\0<n>`. A server's own words
(names, descriptions) are hashed in the lock and never printed by `check`, `guard` or `audit`.

## check and relock

(WP2)

## MCP over HTTP

(WP1)

## The guard

(WP3)

## Approval and audit

**An approval** (`plumbline.agent.approval.json`) is a person's Ed25519 signature over one lock's exact bytes:

```json
{ "type": "plumbline-agent-approval", "version": 1, "alg": "Ed25519", "kid": "<16 hex>",
  "lock": "<SHA-256 of the lock's exact bytes>", "previous": "<the lock's previous; omitted with it>",
  "approvedAt": "<UTC ISO>", "sig": "<base64url>" }
```

`sig` is Ed25519 over canonical JSON of the statement without `sig` (the rule signatures, rotations and revocations
share: `unsignedBytesOf`, `docs/signature-format.md`). `kid` is derived from the approver's key (the first 16 hex of
SHA-256 of the raw public key) and names a person, not a site. The approval carries no key: a verifier never trusts a
key inside the artifact it checks.

`plumbline approve (--key <file> | --key-env <NAME>) [--root <dir>]` reads the lock's bytes and writes the approval
beside it. It refuses when there is no lock or the lock does not parse, when the key file resolves inside the
repository, and when the repository holds a `plumbline.private.json` (a key in the repository is one commit from
published). `--key-env` takes the private key file's JSON from an environment variable and prints the CI custody notes
`sign --key-env` prints. Commit the lock and the approval together; `agent relock` deletes an approval that no longer
covers the lock.

**The approvers file** is the trust store: `{ "type": "plumbline-approvers", "version": 1, "approvers": [{ "kid",
"publicKey", "label", "addedAt" }] }`. Each kid must be derived from its key, a key appears once, and a label is 1 to 80
characters with no control or bidi character (it is the store owner's own words, shown beside a verified approval).
It is held OUTSIDE the repository it governs: whoever can write the trust store can approve. Where it is read from,
in order:

1. `--approvers <file>` (`audit`, `guard`, `agent check`);
2. the environment variable `PLUMBLINE_APPROVERS`, holding the file's JSON text (CI: a repository variable, which a
   pull request cannot edit);
3. `$PLUMBLINE_HOME/approvers.json`, where `PLUMBLINE_HOME` defaults to `~/.config/plumbline`.

A file at 1 or 3 that resolves inside the repository being checked is refused with a fixed sentence, and nothing is
verified with it. `plumbline approver add --key <plumbline-key.json> --label <name> [--file <approvers file>]` adds a
public key record (the one `keygen` writes as `.well-known/plumbline-key.json`), refuses a kid already present, and
refuses a folder that is a git repository's top or lies inside a repository holding `plumbline.agent.json`.

**Verifying** (`verifyApproval`, pure, the same in `agent check`, `guard --require approved` and `audit`):

| Verdict | When |
| --- | --- |
| `invalid malformed` | not an approval statement (type, version, alg, kid, lock, previous, approvedAt, sig patterns; no other member), or validly signed but repeating a `previous` that differs from the lock's own |
| `invalid tampered` | `lock` is not the SHA-256 of these lock bytes: the lock changed after it was approved (checked first: it needs no trust) |
| `unverifiable` | no approvers entry holds the kid (or there is no approvers file) |
| `invalid kid-mismatch` | the approvers entry for the kid is not derived from its key: the trust store itself is defective |
| `invalid bad-signature` | the signature does not verify under the entry's key |
| `verified` | everything above holds; the result names the approvers entry (its label and kid) |

With no approval file the state is `absent`. The four are never folded together: `unverifiable` and `absent` fail a
check as surely as `invalid`, and none of them is ever shown as approved. `agent check` and `guard --require approved`
map them to findings: `absent` and `tampered` to `lock-unapproved`, other `invalid` to `approval-invalid`,
`unverifiable` to `approval-unverifiable`.

**The audit.** `plumbline audit [--root <dir>] [--approvers <file>] [--out <dir>] [--json]` reads the history of
`plumbline.agent.lock.json` with git (`git log` and `git cat-file`, run with an argument list, never a shell; a folder
that is not in a git repository is exit 2). It lists every commit that touched the lock or the approval, groups them
into distinct lock versions (a new version wherever the lock's bytes change), and for each version reports the commit
and date, the chain link (above), and the approval: an approval file committed from the version's commit up to the
next lock change whose `lock` is this version's hash, verified against the approvers. An approval committed one or
more commits after its lock counts; one committed after the next lock change does not reach back. An approval file
that is not JSON is `invalid malformed`, never `absent`. The summary counts versions, verified, invalid, unverifiable,
absent and chain breaks. Exit 0 only when there is at least one version, every version is `verified` and the chain is
whole; 1 otherwise (no lock in the history is `lock-absent`); 2 usage or I/O. The uncommitted working-tree lock is not
part of the history. `--out <dir>` writes `audit.json` (the same document `--json` prints) and `audit.md`, a table of
version, date, commit, lock hash, approver (label and kid when verified, the bare kid otherwise), verdict and chain,
fit to attach to a change record. The audit prints labels from the approvers file and kids, never anything a server or
the repository wrote.

## CI

The Action's `command: agent` runs `plumbline agent check --json` in the repository folder at `root`, with the
approvers from the `approvers` input passed as `PLUMBLINE_APPROVERS` (`action/README.md`). Its `state` output is
`pass` (exit 0), `fail` (exit 1: findings) or `unknown` (a report that cannot be read: never a pass); the job summary
lists the findings by code and ref and the approval in words. `offline: true` adds `--offline`. `issues: true` keeps
one issue titled `Plumbline agent drift` with the watch's issue decisions (a digest keyed by severity, code and ref; a
comment naming what is new; closed on the next clean run), and then findings leave the step green; without it,
findings fail the step. CI never approves: `signing-key`, `renew` and `relock-pr` are refused with `command: agent`. A
relock pull request for the agent lock is not built yet.

`action/templates/plumbline-agent.yml` runs two jobs, the Action pinned by full commit SHA:

- **check**, on every `pull_request`: `offline: true`, `contents: read` only. Made a required status check, it blocks
  any change to the agent that is not approved by a key in `PLUMBLINE_APPROVERS`: a pull request can change the
  declaration, the lock and the approval file, but not the repository variable that says whose approval counts.
- **watch**, daily and on `workflow_dispatch`: the full check (remote MCP servers and peers) with `issues: true` and
  `issues: write`.

What it does not cover: a pull request runs the workflow file from its own branch, so `.github/workflows/` needs a
code owner's review (CODEOWNERS) or a pull request could remove the check; and stdio servers are only seen when the
guard runs them, never in CI (Plumbline does not start a server to look at it).
