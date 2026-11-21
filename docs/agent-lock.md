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

(WP2, WP4)

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

(WP4)

## CI

(WP4)
