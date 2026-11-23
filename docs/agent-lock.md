# Agent change control

Since 2026-11-21. The wire is `src/core/types.ts` (agent section), pinned by `src/test/wire-agent.test.ts`
(`npm run check:wire`).

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

## Format version 2 (2026-11-23)

Found by running agent change control on three real repositories (a version bump that silently emptied the guard, a
Windows working tree that would fail every pull request in CI, skills installed as links left out of the lock, a
remote server that needs a key never locked). The declaration and the lock move to version 2; the approval, the
approvers file and the pending file stay at 1. Every reader accepts versions 1 and 2; `init` and `relock` write 2, so the
first relock after upgrading moves a repository to version 2. A Plumbline older than 2026-11-23 refuses a version 2
lock (`lock-unusable`; the guard refuses every tool).

| Where | Field | Version 2 |
| --- | --- | --- |
| declaration, each MCP server | `from` | `claude`, `cursor` or `vscode`: the host file a discovered server came from; `relock` re-syncs it from that file. Omitted for a server declared by hand. |
| declaration, http server | `auth` | header name to the NAME of an environment variable holding its value (at most 8). The value is read when the server is listed, sent to that server only, never written or printed. A header Plumbline sets itself (content-type, accept, the MCP session and protocol headers, cookies, hop-by-hop) cannot be named. |
| lock | `hashing` | required: `text-lf`. A declared file with no NUL byte is hashed with every CRLF replaced by LF; one with a NUL byte exactly. A version 1 lock hashed every file exactly. |
| lock | `links` | the repository-relative paths of the links (symbolic links, Windows junctions) the walk followed; never their targets. |
| report | `state` | `pass`, `fail` or `unavailable` (see "States and exit codes"). |
| `plumbline.agent.tools/<server>.json` | new file | the accepted tool definitions the lock's hashes cover, written by `relock` and committed (see "Reviewing a relock"). |

New finding codes, appended: `host-changed`, `link-absent`, `server-auth-missing`, `definitions-mismatch`,
`definitions-absent`. The codes that say something was not checked (`AGENT_NOT_CHECKED_CODES`): `server-not-observed`,
`server-unreachable`, `server-refused`, `server-auth-missing`, `peer-unreachable`, `link-absent`.

### Files, line endings and links

(to be written)

### Servers and host files

(to be written)

### Remote servers that need a key

(to be written)

### States and exit codes

(to be written)

### Reviewing a relock

(to be written)

### Putting the guard in place

(to be written)

## Declaring an agent

`plumbline agent init [--root <dir>] [--wrap] [--json]` writes `plumbline.agent.json` from what the agent hosts keep in
the repository, and the first lock. It refuses (exit 2) when the declaration already exists: edit it, then
`plumbline agent relock`.

- **MCP servers** from Claude Code `.mcp.json` (`mcpServers`), Cursor `.cursor/mcp.json` (`mcpServers`, remote ones by
  `url`) and VS Code `.vscode/mcp.json` (`servers`, `type: stdio|http`). A `command` entry is a stdio server
  (`{transport: "stdio", command, args?}`, args omitted when empty); a `url` entry is an http server
  (`{transport: "http", url}`, https only). `sse` is declared as `http` (Streamable HTTP, which is what Plumbline reads),
  and init says so. A name two hosts use for different servers is declared once per host as `<host>:<name>`
  (`claude`, `cursor`, `vscode`); the same server in two hosts is declared once. An entry that already runs the guard
  (`plumbline guard ... -- <command> ...`) is declared with the command the guard runs. An entry that is neither, an
  address that is not https, or a name outside `[A-Za-z0-9._-]` is not declared, and init names it. A host file that is
  not JSON (VS Code's comments included) or repeats a key is refused.
- **Secrets**: `env` and `headers` are never read into any Plumbline file or output.
- **Files**: by default, each that exists of `CLAUDE.md`, `AGENTS.md`, `.mcp.json`, `.cursor/mcp.json`,
  `.vscode/mcp.json`, `.claude/settings.json`, `.claude/agents/**`, `.claude/commands/**`, `.claude/skills/**`. A glob's
  `*` matches inside one segment, `**` any number of segments; nothing else is special. Never locked, whatever a glob
  says: anything under `.git` or `node_modules` (any depth), `.plumbline/`, `.claude/worktrees/`,
  `.claude/settings.local.json`, and Plumbline's own three agent files. Symbolic links are not followed (a declared
  file replaced by a link reads as removed). A matched file whose name is outside `[A-Za-z0-9._/-]` cannot be named by a
  lock: init and relock refuse and name the glob; check reports `file-added` on the glob.
- **Models**: `.claude/settings.json` `model` as label `default`; each `.claude/agents/<name>.md` front matter `model:`
  as label `<name>`. Labels are `[A-Za-z0-9._-]`, ids printable without spaces (at most 256 characters).
- **Peers**: none are discovered; add A2A card addresses (https) to `peers` by hand, then relock.

init adds `.plumbline/` to `.gitignore` when no line ignores it (the guard's observations are local), prints the counts,
how many stdio servers the guard will observe, and the exact host entry that puts the guard in front of each stdio
server:

```json
{"command":"plumbline","args":["guard","--lock","plumbline.agent.lock.json","--server","<name>","--","<command>", "<args>..."]}
```

(`env` and every other member stay as they were). `--wrap` applies it to each host file that declares a stdio server,
after copying the file to `<file>.plumbline-backup`; it refuses, before writing anything, when a backup exists. The
lock then holds the wrapped host files. Next step: `plumbline approve --key <your key file>`, then commit what init
lists.

## The lock and its chain

`plumbline.agent.lock.json` holds `declaration` (SHA-256 of the declaration's exact bytes), `files` (each matched file
by the SHA-256 of its exact bytes, `/` separators, sorted), `models` (copied from the declaration), `mcp` (per server:
`transport`, `target`, and `tools` with `observedAt` once observed) and `peers` (per address, an `a2a-card` record as
the site lock records an external card), and `lockedAt`. The first lock has no `previous`; every relock sets `previous`
to the SHA-256 of the exact bytes of the lock it replaces, so the locks form a chain `plumbline audit` can follow.

Where each server's `tools` come from:

| Server | At init | At relock |
| --- | --- | --- |
| stdio | none ("not yet observed": Plumbline never starts a server) | the guard's `.plumbline/pending/<name>.json` when its `target` is the declared command's; else the earlier lock's tools when the command did not change; else none |
| http | listed now (`initialize` + `tools/list` through the guarded POST) | listed now; unreadable or refused: the earlier record kept when the address did not change (warn), else locked without tools (warn) |
| peer | (none discovered) | read now; unreadable: the earlier record kept (warn), else left out (warn) |

A lock is read strictly (`parseAgentLock`, `parseDeclaration` in `src/agent/lock.ts`): not JSON, a repeated key, another
type or version, a key the format does not define (top level and inside each member), a hash that is not lowercase
SHA-256, a time that is not UTC ISO, an unsafe path, or an address that is not https without credentials is refused
with a fixed sentence that never quotes the value.

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

`plumbline agent check [--root <dir>] [--approvers <file>] [--offline] [--json]` compares the repository with its lock.
Exit 0 when nothing is `warn` or `block`; 1 otherwise (an absent or unusable lock is never clean); 2 on usage or I/O.
`--json` prints one `AgentReport`.

| Code | Severity | When |
| --- | --- | --- |
| `lock-absent` | block | no lock (nothing else is checked) |
| `lock-unusable` | block | the lock is refused by the reader (nothing else is checked) |
| `declaration-changed` | block | the declaration's bytes differ from the lock's `declaration` (missing or unreadable: only the locked files are checked) |
| `file-changed`, `file-added`, `file-removed` | block | the declaration's globs, expanded now, against the lock's files |
| `model-changed` | block | per label whose id differs, or that was added or removed |
| `server-added`, `server-removed`, `server-target-changed` | block | the declaration's servers against the lock's (`target`) |
| `server-not-observed` | warn | a stdio server the lock holds no tools for |
| `tool-changed`, `tool-added`, `tool-removed` | warn (stdio, from the guard's pending file) / block (http, listed now) | per kind of difference, each with the counts; never a tool's name |
| `server-unreachable`, `server-refused` | warn | an http server that could not be read, or whose address Plumbline does not contact |
| `peer-changed` | block | a card that changed (skills counted), or a peer declared but not locked, or locked but no longer declared |
| `peer-unreachable` | warn | a card that could not be read |
| `lock-unapproved` | block | no approval, or the approval covers other lock bytes (the lock changed after it was approved) |
| `approval-invalid` | block | the approval does not verify (malformed, bad signature, defective trust entry) |
| `approval-unverifiable` | block | its kid is in no approvers entry, or no usable approvers file was found |

`--offline` contacts nothing: each http server and peer gets one `info` finding (`server-unreachable` /
`peer-unreachable`, "not contacted (--offline)"), and the text output says in one line what was not checked. `chain-broken`
is `audit`'s: check reads one lock and its approval, not the history.

`plumbline agent relock [--root <dir>] [--json]` rebuilds the lock from the declaration, the repository files, the
guard's pending files, live http lists and peers (see the table above), chained to the lock it replaces. It deletes
`plumbline.agent.approval.json` when there is one ("the approval covered the old lock; approve the new one") and prints
the change list: files added, removed and changed by path; model labels; servers added and removed; per server, tool
counts and where they came from, with the names of tools added or changed when they come from the guard's pending file
(the caller's own servers, in the caller's own terminal, control and bidi characters replaced); removed tools by count
only; an http server's tool names never. It refuses (exit 2) with no lock ("run plumbline agent init"), an unusable lock,
or an unusable declaration.

## MCP over HTTP

An `http` server in `plumbline.agent.json` (`{ "transport": "http", "url": "https://..." }`) is read, never run:
Plumbline asks it for its tool list over Streamable HTTP and compares that list with the lock. The reader is
`listMcpTools` (`src/net/mcp-http.ts`); every byte it sends goes through `safePost` (`src/net/safe-fetch.ts`), the
one POST Plumbline sends to an address it does not own.

### What is sent

Three kinds of request, and nothing else. The bodies are a closed set (`McpRequestBody`), written by `safePost`
itself; no caller passes text, and a value outside the set is refused before anything is sent.

| request | body |
| --- | --- |
| `initialize` | `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"plumbline","version":"0.1.0"}}}` |
| `notifications/initialized` | `{"jsonrpc":"2.0","method":"notifications/initialized"}` |
| `tools/list` | `{"jsonrpc":"2.0","id":N,"method":"tools/list"}`, with `"params":{"cursor":...}` when the server returned a `nextCursor` |

Headers: `content-type: application/json`, `accept: application/json, text/event-stream`, `accept-encoding:
identity`, `user-agent: plumbline`; after `initialize`, `MCP-Protocol-Version` (the version the server answered,
which must be a date) and `Mcp-Session-Id` when the server issued one (sent back only if it is 1 to 2,048 visible
ASCII characters). No credentials, no cookies, no `tools/call`, no session `DELETE` afterwards.

### What is refused

- The address rules of every fetch: https only (http only with `--allow-local`, and then only to loopback); the name
  is resolved once, every answer must be public, and the connection goes to the address that was checked.
- **Redirects.** A POST is never redirected: a 3xx with a `Location` is a failure ("the address answered a POST with
  a redirect, which Plumbline never follows"), and nothing is sent to the new address.
- An answer that is not `application/json` or `text/event-stream`; not strict UTF-8; not a JSON-RPC 2.0 response
  with the request's id; a JSON-RPC error; a key repeated in one object (it reads two ways); an `initialize` answer
  without a protocol version Plumbline reads (2024-11-05, 2025-03-26, 2025-06-18, 2025-11-25); a `tools/list` answer
  without a list of tool objects; a cursor longer than the cap, or one the server already returned.
- In an event stream, only the event carrying the request's id is read; notifications, comments and other ids are
  ignored. A stream the server keeps open is closed as soon as that event has arrived.

Every failure is one of Plumbline's fixed sentences, and a non-2xx answer is reported by its status. The server's
own words (an error message, a tool's name or description, a header) are never copied into a result.

### The ceilings and their derivations

Measured once, on 2026-11-21, by `scripts/record-mcp-fixture.mjs` against `https://mcp.deepwiki.com/mcp` and
`https://learn.microsoft.com/api/mcp` (both public, no auth; the recordings are in `src/test/fixtures/mcp/`). Both
answered over event streams, negotiated 2025-06-18 and listed 3 tools in one page.

| constant | value | derivation |
| --- | --- | --- |
| `MAX_MCP_BODY_BYTES` | 524,288 (512 KiB) | re-derived at merge per tool: the larger recording is 4,950 bytes for 3 tools, 1,650 bytes per tool; a 100-tool single page is 165,000 bytes, x3 for longer descriptions and schemas, 495,000, rounded up to a power-of-two KiB. (x10 of the 3-tool recording, 64 KiB, would refuse ordinary servers with about 40 tools in one page.) |
| `MAX_MCP_SESSION_ID_LENGTH` | 2,048 characters | the one recorded session id (learn.microsoft.com), 200 characters, x10, rounded up to a power of two. |
| `MAX_MCP_CURSOR_LENGTH` | 2,048 characters | no recorded server paginated; a cursor is, like a session id, an opaque token the server issues, so it takes the session id's ceiling. |
| `MAX_MCP_PAGES` | 8 | no recorded server paginated; 8 full pages at 512 KiB is 4 MiB, the order of the largest read the guarded fetch makes at all (`MAX_RUNTIME_FILE_BYTES`). |
| deadline | 10 s for the whole listing | `DEFAULT_TIMEOUT_MS`; the slower recorded listing took 2,041 ms for its three requests, so about five times that. |

A server whose single `tools/list` page is larger than 512 KiB is refused with the ceiling's sentence rather than read in part. To watch such a server, record it and re-derive the ceiling.

## The guard

`plumbline guard` runs between an agent host and one stdio MCP server. It hides every tool whose definition differs
from the agent lock. The host's config runs the guard in place of the server:

```json
{ "mcpServers": { "docs": { "command": "plumbline",
  "args": ["guard", "--lock", "plumbline.agent.lock.json", "--server", "docs", "--", "npx", "-y", "some-mcp-server"] } } }
```

```
plumbline guard --lock <file> --server <name> [--require locked|approved] [--approvers <file>] [--strict]
  [--pending <dir>] -- <command> [args...]
```

The guard's stdout is the MCP channel, so everything it says goes to stderr. It has no `--json`.

### What it reads, and when

The guard reads the lock once, before the server starts. With `--require approved` it also reads
`plumbline.agent.approval.json` beside the lock and your approvers file (`--approvers`, then `PLUMBLINE_APPROVERS`,
then `$PLUMBLINE_HOME/approvers.json`; the repository root is the lock's folder). It never reads any of them again
while it runs (registry rule `agent-runtime-assembly/guard-input-custody`).

- `--require locked` (the default) compares hashes only. At start it prints one stderr line: the lock is not checked
  for approval, and anything that can write the repository can change it.
- `--require approved` also requires an approval that verifies against your approvers file, which sits outside the
  repository.

### When it refuses every tool

If the guard cannot use the lock for this server, it refuses every tool and prints one fixed stderr line that names
the reason. It still relays the protocol so the host does not hang: every `tools/list` result is empty, and every
`tools/call` gets the error below. It never falls back to passing tools.

| Reason | Cause |
| --- | --- |
| `lock-absent` | the lock file could not be read |
| `lock-unusable` | the lock is not a plumbline agent lock (not JSON, a repeated key, a wrong type or shape) |
| `server-absent` | the lock has no `mcp` entry with the `--server` name |
| `server-not-stdio` | the lock records the server as `http` |
| `server-target-changed` | `serverTarget({transport: "stdio", command, args})` of the command after `--` is not the lock's `target` (with no arguments, both the omitted and the empty `args` spellings match) |
| `lock-unapproved` | `--require approved`: there is no approval file |
| `lock-changed-after-approval` | `--require approved`: the approval covers other lock bytes (`tampered`) |
| `approval-invalid` | `--require approved`: the approval is malformed or its signature is bad |
| `approval-unverifiable` | `--require approved`: no approvers entry has its key, or no approvers file could be used. Anything that cannot be checked counts as unverifiable, never as verified |

### What it filters

- **Lists.** A response to a `tools/list` the host sent (the guard tracks request ids) keeps only passing tools. A
  tool passes when its definition hash equals the lock's under the same name key (`toolsDecision`). A changed tool, a
  tool the lock does not hold, and an entry that is not a tool are all dropped. `nextCursor` is kept. The guard
  decides over every page seen so far, so a name that repeats on a later page is keyed by its occurrence.
- **Calls.** A `tools/call` for a tool that is not passing gets a local answer. That covers a changed tool, an
  unpinned tool, a call made before the host has listed tools, and a name that has a hidden twin. The call is never
  forwarded. The answer is a JSON-RPC error with code `-32601` and a fixed message: *"Plumbline guard: this tool is
  not in the approved agent lock (it changed, is new, or the server's tool list was not seen yet); run `plumbline
  agent relock` and approve the new lock"*. While all tools are refused, the message says the lock could not be used.
- **`notifications/tools/list_changed`** passes through. From then on no tool is callable until the host lists again,
  and the guard filters that list again.
- **Everything else** passes through unchanged, in both directions: initialize, resources, prompts, server requests
  and responses.
- **Batches** are filtered one item at a time. In a host batch, the refused calls are answered in one array and the
  rest are forwarded in another.

### The observation (pending file)

When a list completes (a page with no `nextCursor`), the guard writes `<pending>/<server>.json`. The default folder is
`.plumbline/pending` beside the lock. The file is written atomically (temp file, then rename). It is a
`plumbline-agent-pending` document that holds the `target` of the command that was run and every tool the server
listed, each restricted to the defining keys. `agent relock` reads it. The file is local and git-ignored, and it is
never signed. If the server name cannot be a file name, no file is written and the guard says so.

If the list differs from the lock, the guard prints one stderr line with counts (hidden: changed, not in the lock, not
a tool; in the lock but no longer listed), the pending file's path, and the next step (`plumbline agent relock`,
review, approve). The guard never prints a tool name or description from the server to stderr or in an error it makes.

### `--strict`

With `--strict`, any drift in a completed list stops the server. Every open host request (including that list) gets
JSON-RPC error `-32000` with a fixed message, and the guard exits 1.

### Protocol errors and limits

- A line that is not UTF-8 or not JSON, or that repeats a key inside one object, is a protocol error. This applies in
  either direction. The line is not forwarded, it is counted, and one stderr line is printed without quoting it.
  (`JSON.parse` keeps the last of two equal keys while another reader may keep the first, so such a message would mean
  two things.)
- A single message larger than `GUARD_MAX_MESSAGE_BYTES` (16 MiB: the largest legitimate message is a tool result carrying an image; a host accepts an image of at most 5 MB, 6.67 MB in base64, twice that for text beside it, rounded up) closes both sides
  with a stderr line, and the guard exits 1.

### Exit

The guard exits with the server's exit code, or 1 if a signal ended the server. When the host closes the guard's
stdin, the guard closes the server's stdin. If the server is still running 2 s later it gets SIGTERM, and 2 s after
that SIGKILL. When the server exits, any request it left open is answered with an error. Other exit codes:

- 1: `--strict` stopped the server, or a message was too large.
- 2: a usage error, or the command could not be started.

### Windows

The guard spawns the command with no shell. On Windows, Node will not spawn a `.cmd` file without a shell, and `npx`
is `npx.cmd`. The guard resolves the command on `PATH` with `PATHEXT`:

- `npx` and `npm` run as `node <their folder>\node_modules\npm\bin\<name>-cli.js`.
- An npm cmd-shim of a package bin (`"%dp0%\...\x.js" %*`) runs its script with node.
- Any other batch file is refused with a sentence.

The lock's `target` is always the command as the host's config wrote it.

### Measured cost

Measured 2026-11-21 on Node 24.22.1 (Windows 11, a 4 GHz virtual CPU) with
`src/test/fixtures/guard/fake-server.mjs`. The fake server advertised 50 tools, each with a 200-character description
and a small schema (one `tools/list` response is about 15 KB). The test sent 1,000 sequential round trips straight to
the server and 1,000 through the spawned `dist/cli/index.js guard`, after 50 warm-up trips each, and took the median of
3 runs:

| Message | Direct, ms per round trip | Guarded, ms per round trip | Added |
| --- | --- | --- | --- |
| `ping` (passes through) | 0.33 | 0.53 | 0.20 ms |
| `tools/list` of 50 tools (filtered) | 0.24 | 10.08 | 9.8 ms |

A message that passes through costs about 0.2 ms: one JSON parse and one duplicate-key scan. A list costs about
0.2 ms per tool, almost all of it two WebCrypto SHA-256 digests per tool (`toolsParts`). Hosts list tools once per
session and again after `list_changed`, so this is paid rarely.

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
