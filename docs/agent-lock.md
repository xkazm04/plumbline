# Agent change control

Since 2026-11-21. The wire is `src/core/types.ts` (agent section), pinned by `src/test/wire-agent.test.ts`
(`npm run check:wire`).

A repository declares what its agent is made of, a lock pins every component by hash, a named person approves each
lock with their own key, and each lock names the one it replaces. `plumbline audit` shows who approved every change;
`plumbline agent check` fails a pull request whose agent changed without approval, and says `unavailable` for what it
could not check; `plumbline guard` hides any MCP tool whose definition differs from the lock.

## The files

| File | Where | Written by | Signed |
| --- | --- | --- | --- |
| `plumbline.agent.json` | repository | `agent init`, then the owner | covered by the lock (`declaration`) |
| `plumbline.agent.lock.json` | repository | `agent init`, `agent relock` | by the approval |
| `plumbline.agent.approval.json` | repository | `approve` | is the signature |
| `approvers.json` | user-level (`$PLUMBLINE_HOME`), or CI variable `PLUMBLINE_APPROVERS` | `approver add` | no: it is the trust store, out of the repository's reach |
| `plumbline.agent.tools/<server>.json` | repository (version 2) | `agent init`, `agent relock` | no: checked against the lock's hashes |
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

The declaration's `files` globs are expanded when the lock is written and again at every `agent check`; each file the
globs match is recorded under its repository path with a SHA-256 hash.

#### Line endings: text as git sees it

A version 2 lock says `"hashing": "text-lf"`. Under that rule a file that holds no NUL byte is text: it is hashed with
every CRLF pair read as LF, which is how git stores a text file (a lone CR is kept). A file that holds a NUL byte is
binary to git and is hashed exactly, byte for byte.

The reason: on Windows with `core.autocrlf` the working tree holds CRLF while git stores LF (`git ls-files --eol` shows
`i/lf w/crlf`). Hashing exact working-tree bytes made a lock written on Windows read every file as `file-changed` on a
Linux CI checkout of the same commit, so every pull request failed. Under the text rule both checkouts lock the same,
byte for byte, and only a change git would also see is a change.

- A version 1 lock (no `hashing`) is checked with exact bytes, as it was written. Nothing is re-read under a rule it
  did not use.
- The first `agent relock` of a version 1 lock writes version 2. A file whose exact bytes still match the version 1
  record but whose hash moved only because of the new rule is reported as re-hashed under the text rule, contents
  unchanged, never as `file changed`. Only a file whose contents changed is listed as changed. Files without a CRLF
  keep the same hash and appear in neither list.
- The rule covers declared files only. The lock's and the approval's own bytes are always hashed exactly: an approval
  signs exact bytes, and the lock is written by Plumbline with LF.
- A file that holds a NUL byte keeps its exact hash, CRLF included: that CRLF is content.

#### Links: followed, locked under the link's path, recorded by path

Skills are often installed as links (symbolic links, or junctions on Windows) into a shared folder outside the
repository. That shared folder is exactly the supply chain worth locking, so a link under a declared glob is followed,
to a file or to a folder:

- The files a link leads to are recorded in `files` under the link's own path: a junction `.claude/skills/review` to a
  registry folder locks `.claude/skills/review/SKILL.md`, not a path in the registry.
- The lock's `links` lists the repository-relative path of every link the walk followed that leads to a locked file,
  sorted; it is omitted when there is none. A link in a glob's leading folders (`.claude/skills` itself a junction) is
  recorded too. Where a link points is never recorded: it is a path on the locker's machine (often with a user name in
  it) and would mean nothing on another one.
- `agent init` says how many: "N files through M links" (nothing extra when there is no link).
- Following a link reads outside the repository: those files are hashed, and their contents go into no file and no
  output. Model discovery (`model:` in `.claude/agents/*.md`) does not follow links for the same reason: a model id is
  words copied into the declaration, not a hash; a linked agent file is still locked by its hash.
- Links outside every glob's reach are never touched.
- A link back into a folder the walk is in (to the repository, to `.claude`, to its own parent) would never end; it is
  refused with a sentence naming the link (exit 2): remove the link or narrow the glob.
- One walk reads at most 10,000 files. The bound is derived from the field trial: the largest declared tree seen was 85
  files through 7 links; 100 times that, rounded, is 10,000. Over it the walk stops with a sentence naming the bound
  (exit 2): narrow the globs, or remove a link that leads somewhere large.

At `agent check`:

- A recorded link that is not in the checkout (its path is absent, or it is a link whose target is gone) is one
  `link-absent` finding (warn) with the link's path as `ref`: "A link the lock records is not in the checkout, so the
  files under it were not checked." Its files are not reported `file-removed`: they were not checked, which is neither
  clean nor removed. `link-absent` is a not-checked code, so alone it makes the report `unavailable`, not `fail`.
  A CI checkout usually has no such link at all, because a junction into a shared folder is untracked; vendor the
  skill (commit it as a real folder) if CI should check its files.
- A link replaced by a real folder holding the same files is compared like any folder: clean. Changed contents there
  are `file-changed`, as anywhere.
- A new link under a glob brings new files: `file-added`, like any new file.
- A link named by `links` inside another absent link is covered by the outer one: one finding, not two.

A build that predates version 2 refuses a version 2 lock as `lock-unusable`; upgrade Plumbline where the lock is checked.

### Servers and host files

`agent init` declares every MCP server it finds in the three hosts' files (`.mcp.json`, `.cursor/mcp.json`,
`.vscode/mcp.json`) with `from` set to that host (`claude`, `cursor`, `vscode`). From then on the host file wins for
those servers: a version bump in `.mcp.json` is one reviewed relock, not a guard that refuses every tool because the
command it runs is no longer the one the lock holds.

What `agent relock` does before it builds the lock (`src/agent/host-sync.ts`):

| In the declaration | In the host file now | relock |
| --- | --- | --- |
| a `from` server | the same entry, same command and args (or address and header names) | nothing |
| a `from` server | the entry runs another command, names another address, or sends other headers | takes the host entry's command and args, or address; header names come from the host file, a variable the declaration already names for a header is kept |
| a `from` server | gone (removed, renamed, or now an entry init does not declare) | removes it from the declaration |
| nothing under that name | a new entry | adds it, with `from` |
| a server declared by hand (no `from`) | anything | never touches it; a new host entry under the same name is not added, and relock says so |

When that changes the declaration, relock rewrites `plumbline.agent.json` (two-space JSON and a newline, members in the
order they were) and builds the lock from it, so the guard's pending file for the new command is taken: the pending
file is matched by the command's target, and the target now comes from the re-synced declaration. When nothing
changes, the declaration's bytes are left alone. The change list says it in the caller's own words:

    Rewrote plumbline.agent.json from the host files (host config wins for servers declared from one).
      declaration: 1 server re-synced from .mcp.json
        playwright: command npx @playwright/mcp@0.0.80 -> npx @playwright/mcp@0.0.85
      server playwright (from what the guard saw): tools 0 added, 0 removed, 0 changed

A server's tool counts compare with the earlier lock's record under the same name even when its command changed, so
a version bump reads as the tools it changed, not as every tool added. Tools are kept from the earlier lock only for
the same command or address: another command is another program, and until the guard has run it the lock holds it
without tools.

`agent check` runs the same comparison, without writing anything, and reports each difference as `host-changed`
(block, ref = the server's name): the host file runs a command, names an address or sends headers the declaration does
not record, no longer declares a `from` server, or declares a server the declaration does not. The sentence is fixed;
relock is the remedy. A host file that cannot be read (not JSON, a repeated key) is `host-changed` for every `from`
server. A version 1 declaration has no `from`, so check compares nothing with the host files.

**The first relock of a version 1 declaration** marks `from` only on a server identical to a current host entry (same
name, and the same command and args, or the same address). Every other declared server stays declared by hand, because
a version 1 declaration cannot say whether a difference was a person's edit or a host's bump, and a hand edit must never
be overwritten. Relock says how many: "declaration: version 2; 2 servers now re-synced from their host file, 1 server
stays declared by hand (not identical to a host entry)". To hand a server back to its host file, set its `from`.

What init does not declare, and says why:

| Host entry | Reason printed |
| --- | --- |
| an address on this machine or a private network (`localhost`, `*.localhost`, a loopback, private or link-local literal) | "it is a local address (your own server): not locked". Plumbline never contacts such an address, so there is nothing to compare. |
| an `http:` address elsewhere | "its address is not https" |
| an address with a user name or password | "its address carries credentials" |
| an address with a query string | "its address has a query string, which may carry a token": a query string is copied into a committed file, and a token in it would be published. Move the key into the entry's `headers`; init then declares it as `auth` (below). |
| a header Plumbline cannot send as auth (`Cookie`, a protocol or hop-by-hop header, not a header name), more than 8 headers, or one header named twice | said in those words |

### Remote servers that need a key

A remote server that answers 401 without a key is declared with `auth`: header name to the NAME of an environment
variable that holds the value.

    "grinex": { "transport": "http", "url": "https://grinex.example/mcp",
                "auth": { "X-API-Key": "PLUMBLINE_GRINEX_X_API_KEY" }, "from": "claude" }

- **init writes it from the header names alone.** Seeing `headers` on an http host entry, init declares one `auth`
  entry per header with the suggested variable `PLUMBLINE_<SERVER>_<HEADER>` (upper-case, every character outside
  A-Z and 0-9 becomes `_`) and prints the variables to set. It never reads a header's value, so the value in the host
  file (or the host's own variable reference) reaches no Plumbline file and no output. Rename a variable in the
  declaration if you like; relock keeps your name for that header.
- **The value is read when the server is listed**, by `init`, `relock` and `check`, from their environment (locally,
  your shell; in CI, a secret mapped to that variable). It is held in memory for that one listing, sent with its three
  requests (`initialize`, `notifications/initialized`, `tools/list`) to that one server, and never stored, logged,
  printed or put into an error. The POST follows no redirect, so the key never reaches a second address.
- **A variable that is unset, empty, or not printable ASCII** (a CR or LF would split the request's headers) means the
  server is not contacted at all: `server-auth-missing` (warn), whose sentence names the variable and never a value.
  It is one of the codes that say something was not checked, so alone it makes the report `unavailable`, not `fail`.
  relock keeps the earlier lock's tools for the server when its address did not change, and says so.
- **A header Plumbline sets itself cannot be named**: `content-type`, `accept`, `accept-encoding`, `content-length`,
  `host`, `user-agent`, `cookie`, the MCP session and protocol headers, and the hop-by-hop and proxy headers. The
  declaration's parser refuses most of them; `safePost` refuses every one again before sending, and a value with a
  control character, with a TypeError that names neither the value nor the header past its rule. Auth is placed
  before the POST's own headers, so no entry can override one.

This is the one named exception to "no credentials" (see "What is sent" under MCP over HTTP).

### States and exit codes

`agent check` ends in one of three states, the gate's three (`AgentReport.state`, set by `agentState` in
`src/agent/check-state.ts`):

| State | When | Exit, `--fail-on fail` (default) | Exit, `--fail-on unavailable` |
| --- | --- | --- | --- |
| `fail` | any `block` finding, or any `warn` whose code is not a not-checked code (the guard saw a stdio server's tools drift) | 1 | 1 |
| `unavailable` | no such finding, but at least one `warn` with a not-checked code: `server-not-observed`, `server-unreachable`, `server-refused`, `server-auth-missing`, `peer-unreachable`, `link-absent` | 0 | 1 |
| `pass` | neither; `info` findings (what `--offline` chose not to contact, `definitions-absent`) do not count | 0 | 0 |

Usage errors and I/O errors exit 2, and so does a `--fail-on` other than `fail` or `unavailable`.

The reason for the third state: a remote server that answers 401, or a stdio server the guard has never run, was not
checked. That is neither clean nor a change. Before format version 2, any `warn` exited 1, so a pull request that
could not reach a server failed every time on something no one could fix in that pull request, and "not checked" was
folded into "failed" (repo law: the third state is never folded into either of the others). `unavailable` is never
`pass` either: the text output says it on its own line, `--json` carries `state`, and the Action's `state` output and
job summary say what was not checked.

A check that looked at nothing at all still fails: an absent or unusable lock is a `block` (`lock-absent`,
`lock-unusable`), so it is `fail` and exits 1 whatever `--fail-on` says, as the gate exits 1 when every adapter was
unavailable. An unapproved, invalid or unverifiable approval is a `block` too: `unavailable` always means the approval
verified and everything that was checked matches.

The text output ends with the state on one line, then the next steps, each chosen by the state:

```
Approval: verified, by Alice (0123456789abcdef).
State: unavailable: nothing that was checked differs from the approved lock, but 1 MCP server was not checked.
Next: check that each MCP server that could not be read answers at its address; one that answers HTTP 401 or 403 needs a key: name the environment variable under auth in plumbline.agent.json and set it, then run this again.
```

- `pass`: no next step.
- `unavailable`: one line per not-checked code present: set the variable `auth` names (`server-auth-missing`), run
  the agent once with the guard in place and then relock (`server-not-observed`), check the address
  (`server-unreachable`, `server-refused`, `peer-unreachable`; a 401 or 403 means the server needs a key), restore the
  link (`link-absent`). Never "relock" for what was not checked, and never "approve": the approval verifies.
- `fail`: when only the approval failed, the line for that (approve, approve again, or give check the approvers file);
  when anything else failed, review the change, relock, and have a person approve the new lock; then the
  not-checked lines, if any.

Use `--fail-on unavailable` where every server must have been checked before a merge (and give the job each variable
the servers' keys need); the default suits a pull request check that cannot reach every server.

### Reviewing a relock

The lock holds hashes only, so it can never show what a tool's description said before. A rug pull is exactly that: a
server keeps a tool's name and changes its description. So `init` and `relock` also write the definitions the lock's
hashes cover, one file per server, and the file is committed beside the lock:

```
plumbline.agent.tools/<server>.json      (a `:` in the server name is written `__`, as in the pending file name)
{ "type": "plumbline-agent-tools", "version": 1, "server": "<server>", "tools": [ ... ] }
```

Each tool is restricted to the defining keys (`name`, `title`, `description`, `inputSchema`, `outputSchema`,
`annotations`; `_meta` and every other key left out), sorted by name, then by occurrence, so a repeated name's later
occurrence still hashes as the lock keys it. The file is two-space JSON with LF line endings and a trailing newline, so
a pull request's diff shows a changed description as one changed line. A stdio server's file comes from the guard's
pending file that relock takes; an http server's from the list read now. A server whose tools were kept from the earlier
lock (nothing new observed) keeps its file as it is; a server the lock no longer holds, or holds without tools (its
command changed), loses its file.

The file is third-party text. Plumbline never prints it: control, C1, bidi and zero-width characters, the line and
paragraph separators and the BOM are written as `\uXXXX` escapes, so a diff view shows the escape rather than letting
the text reorder itself on screen. A coding agent that reads the repository can read the file too; it already receives
the same text from the server through MCP.

The lock's hashes stay the authority. `agent check` hashes each definition in the file exactly as the lock does and
compares it with the lock's `mcp[server].tools`:

| Code | Severity | When |
| --- | --- | --- |
| `definitions-mismatch` | block | the file does not hash to what the lock holds (edited by hand, a tool missing or added, another server's file), or it is not a definitions file at all. Restore it from version control: relock writes it again only when it observes the server's tools. |
| `definitions-absent` | info | the lock holds the server's tools and there is no file (a version 1 lock, or tools kept from a lock written before these files). The next relock that observes the server's tools writes it. |

Line endings in the file do not matter to the check (the hashes are of the parsed definitions). The folder is never
matched by the declaration's globs, whatever they say: it is checked against the lock instead, as the declaration is.

relock's change list says what to read in that diff. Per server it prints the tool counts; for a stdio server whose
tools come from the guard's pending file it names the tools added and changed (the caller's own servers, in the
caller's own terminal, control and bidi characters replaced), and for each changed tool which defining keys changed,
never their text:

```
  server playwright (from what the guard saw): tools 0 added, 0 removed, 2 changed (changed browser_navigate [description, annotations; marked: escalated], browser_type [inputSchema])
    1 of 2 changed tools is marked for a harder look.
```

The keys are found by comparing the new definitions with the committed file before relock replaces it; with no earlier
file (a version 1 lock) a changed tool is named without keys. An http server's tool names are never printed: its lines
are counts, `changed keys: description (2 tools)`, and the marked count.

A tool is marked for a harder look when its name matches `unsafe`, `exec`, `eval`, `shell`, `run_code`, `delete` or
`drop`, in any case (`name`), or when it CHANGED and its annotations now claim more power than the definition the last
lock accepted (`escalated`): it was read-only and is not, or it was not destructive or not open-world and now is. The
claims are read with the MCP specification's defaults (`readOnlyHint` false, `destructiveHint` true, `openWorldHint`
true; `destructiveHint` means nothing on a read-only tool), so dropping a `readOnlyHint: true` escalates as surely as
saying `false`. An added tool's annotations alone are never a mark: by those defaults most tools are "destructive,
open-world" (a real playwright server: 17 of 24), and a mark on most tools says nothing. Marks sit beside the added and
changed names, with a count line ("1 of 2 changed tools is marked for a harder look."). They are advice for the
reviewer: they change no severity and no exit code. Annotations are the server's own claims and the name rule is
coarse (it also marks `retrieval`, and misses a tool named `run`), so a tool without a mark is not thereby safe, and a
missing mark proves nothing.

### Putting the guard in place

The guard only protects a stdio server whose host entry runs it. The wrapped entry:

```json
{"command":"plumbline","args":["guard","--lock","plumbline.agent.lock.json","--server","<name>","--","<command>","<args>..."]}
```

`env` and every other member of the entry stay as they were. `plumbline` must resolve on the PATH the host starts the
server with, or every wrapped server fails to start. So `init --wrap` and `agent wrap` write `plumbline` only when it
resolves on PATH (Windows: PATH with PATHEXT, as the guard resolves a command; POSIX: the first executable file of that
name in a PATH folder, empty entries skipped), and otherwise the absolute form, which starts on this machine whatever
PATH holds:

```json
{"command":"<this node, process.execPath>","args":["<this Plumbline's dist/cli/index.js>","guard","--lock","plumbline.agent.lock.json","--server","<name>","--","<command>","<args>..."]}
```

and say why: those are paths on this machine, which another machine (a teammate's, or CI) may not have. To get the
short form, put `plumbline` on PATH (`npm link` in its checkout, or install it), then run `plumbline agent wrap`, which
rewrites absolute-form entries to the short form. Both forms are read as wrapped (a node executable, a path ending in
`dist/cli/index.js`, then `guard`), so an entry is never wrapped twice, and either way the server is declared with the
command the guard runs, not the guard.

`plumbline agent wrap [--root <dir>] [--json]` puts the guard in place after `init`, on an existing declaration and
lock: it wraps each stdio host entry that does not run the guard yet, copying each host file it edits to
`<file>.plumbline-backup` first, and refuses, before writing anything, when a backup exists, when there is no declaration
("run plumbline agent init --wrap") or when the lock is absent or unusable. Then it relocks, so the new lock covers the
edited host files and names the lock it replaces (`previous`); the approval of the old lock is removed, as by any relock.
With nothing to wrap it writes nothing and does not relock. `--json` prints one object: the files edited, each wrapped
entry as shown (command and args only; `env` is never printed), the entries shortened, the launcher (`plumbline` or
`absolute`), and relock's own JSON under `relock`. `init` without `--wrap` prints each entry it would write and points at
`plumbline agent wrap`; nothing has to be deleted first.

## Declaring an agent

`plumbline agent init [--root <dir>] [--wrap] [--json]` writes `plumbline.agent.json` from what the agent hosts keep in
the repository, and the first lock. It refuses (exit 2) when the declaration already exists: edit it, then
`plumbline agent relock`.

- **MCP servers** from Claude Code `.mcp.json` (`mcpServers`), Cursor `.cursor/mcp.json` (`mcpServers`, remote ones by
  `url`) and VS Code `.vscode/mcp.json` (`servers`, `type: stdio|http`). A `command` entry is a stdio server
  (`{transport: "stdio", command, args?}`, args omitted when empty); a `url` entry is an http server
  (`{transport: "http", url}`, https only). `sse` is declared as `http` (Streamable HTTP, which is what Plumbline reads),
  and init says so. A name two hosts use for different servers is declared once per host as `<host>:<name>`
  (`claude`, `cursor`, `vscode`); the same server in two hosts is declared once. Each discovered server carries `from`
  (version 2), so relock re-syncs it from its host file ("Servers and host files"). An entry that already runs the guard
  (`plumbline guard ... -- <command> ...`, or the absolute form, "Putting the guard in place") is declared with the
  command the guard runs. An entry that is neither, an address that is local, not https, carries credentials or a query
  string, or a name outside `[A-Za-z0-9._-]` is not declared, and init names it with the reason. A host file that is not
  JSON (VS Code's comments included) or repeats a key is refused.
- **Secrets**: `env` and header values are never read into any Plumbline file or output. An http entry's header NAMES
  become `auth` entries naming an environment variable to set ("Remote servers that need a key").
- **Files**: by default, each that exists of `CLAUDE.md`, `AGENTS.md`, `.mcp.json`, `.cursor/mcp.json`,
  `.vscode/mcp.json`, `.claude/settings.json`, `.claude/agents/**`, `.claude/commands/**`, `.claude/skills/**`. A glob's
  `*` matches inside one segment, `**` any number of segments; nothing else is special. Never locked, whatever a glob
  says: anything under `.git` or `node_modules` (any depth), `.plumbline/`, `.claude/worktrees/`,
  `.claude/settings.local.json`, Plumbline's own three agent files and `plumbline.agent.tools/`. A link (symbolic
  link or junction) under a glob is followed and its files are locked under the link's path ("Files, line endings and
  links"). A matched file whose name is outside `[A-Za-z0-9._/-]` cannot be named by a lock: init and relock refuse and
  name the glob; check reports `file-added` on the glob.
- **Models**: `.claude/settings.json` `model` as label `default`; each `.claude/agents/<name>.md` front matter `model:`
  as label `<name>`. Labels are `[A-Za-z0-9._-]`, ids printable without spaces (at most 256 characters).
- **Peers**: none are discovered; add A2A card addresses (https) to `peers` by hand, then relock.

init adds `.plumbline/` to `.gitignore` when no line ignores it (the guard's observations are local), prints the counts,
how many stdio servers the guard will observe, and the exact host entry that puts the guard in front of each stdio
server:

```json
{"command":"plumbline","args":["guard","--lock","plumbline.agent.lock.json","--server","<name>","--","<command>", "<args>..."]}
```

(`env` and every other member stay as they were; when `plumbline` is not on PATH, the absolute form, "Putting the
guard in place"). `--wrap` applies it to each host file that declares a stdio server, after copying the file to
`<file>.plumbline-backup`; it refuses, before writing anything, when a backup exists. The lock then holds the wrapped
host files. Without `--wrap`, `plumbline agent wrap` does the same later, on the existing declaration, and relocks.
Next step: `plumbline approve --key <your key file>`, then commit what init lists.

## The lock and its chain

`plumbline.agent.lock.json` holds `declaration` (SHA-256 of the declaration's exact bytes), `files` (each matched file
by its SHA-256, `/` separators, sorted: version 2 under the `hashing: "text-lf"` rule, version 1 of exact bytes), `links`
(version 2, when the walk followed any), `models` (copied from the declaration), `mcp` (per server:
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

- `start`: the oldest version in the history, naming no `previous`; or the first version after the lock was deleted
  from the repository, naming none (a re-init starts a new chain);
- `ok`: `previous` equals the SHA-256 of the version before it, byte for byte;
- `unseen`: the oldest version in the history names a `previous` git never saw. The documented first run does this:
  `agent init`, then `agent relock` once the guard has seen the tools, then `approve` and the first commit. It is a
  `chain-broken` finding, and under the default rule it is listed, not counted, when that version is the first approved
  one: what it replaced came before approval began. `audit --all` counts it;
- `broken` (`chain-broken`): anything else: a `previous` naming some other lock, none at all after the first (with
  no deletion between them), or bytes that are not a lock document. A lock restored after a deletion that names the
  last version before it reads `ok`.

A broken link does not say what happened (a lock rewritten by hand, history squashed, a relock outside Plumbline); it
says the history can no longer show that each change replaced the one approved before it. The lock's own bytes are
hashed exactly as committed (the text rule is for declared files only): keep `* text=auto eol=lf` (or `-text` for the lock) in `.gitattributes`, or a checkout that
rewrites line endings has a different lock from the one approved (`approve` warns when the lock holds CRLF and no
`.gitattributes` pins LF).

## Tool definitions

A tool's definition hash is SHA-256 of canonical JSON of the tool object restricted to `name`, `title`, `description`,
`inputSchema`, `outputSchema` and `annotations` (keys the server did not send are left out; `_meta` is excluded), keyed
by SHA-256 of its name; a repeated name's later occurrences are keyed by SHA-256 of `name\0<n>`. A server's own words
(names, descriptions) are hashed in the lock and never printed by `check`, `guard` or `audit`.

## check and relock

`plumbline agent check [--root <dir>] [--approvers <file>] [--offline] [--fail-on fail|unavailable] [--json]`
compares the repository with its lock. Exit by the report's state ("States and exit codes"): 1 on `fail` (an absent or
unusable lock is a `block`, so never clean), and on `unavailable` only with `--fail-on unavailable`; 0 otherwise; 2 on
usage or I/O. `--json` prints one `AgentReport`, `state` included.

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
| `server-unreachable`, `server-refused` | warn | an http server that could not be read (a 401 or 403 among them), or whose address Plumbline does not contact |
| `server-auth-missing` | warn | a variable an http server's `auth` names is unset, empty or not printable ASCII: the server is not contacted |
| `host-changed` | block | a `from` server's host file entry differs from the declaration, is gone, or a new host entry is not declared (relock re-syncs) |
| `link-absent` | warn | a link the lock records is not in the checkout: its files were not checked (never `file-removed`) |
| `definitions-mismatch` | block | a committed `plumbline.agent.tools/` file does not hash to what the lock holds |
| `definitions-absent` | info | the lock holds a server's tools and no definitions file (a version 1 lock) |
| `peer-changed` | block | a card that changed (skills counted), or a peer declared but not locked, or locked but no longer declared |
| `peer-unreachable` | warn | a card that could not be read |
| `lock-unapproved` | block | no approval, or the approval covers other lock bytes (the lock changed after it was approved) |
| `approval-invalid` | block | the approval does not verify (malformed, bad signature, defective trust entry) |
| `approval-unverifiable` | block | its kid is in no approvers entry, or no usable approvers file was found |

The `warn` codes `server-not-observed`, `server-unreachable`, `server-refused`, `server-auth-missing`,
`peer-unreachable` and `link-absent` say something was not checked: alone they make the report `unavailable`. Every
other `warn` and every `block` makes it `fail`.

`--offline` contacts nothing: each http server and peer gets one `info` finding (`server-unreachable` /
`peer-unreachable`, "not contacted (--offline)"), and the text output says in one line what was not checked. `chain-broken`
is `audit`'s: check reads one lock and its approval, not the history.

`plumbline agent relock [--root <dir>] [--json]` first re-syncs the servers declared `from` a host file ("Servers and
host files"), then rebuilds the lock from the declaration, the repository files, the guard's pending files, live http
lists and peers (see the table above), chained to the lock it replaces, and writes each server's definitions file
("Reviewing a relock"). It deletes
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
ASCII characters). No credentials except a declared server's `auth` headers, sent to that server only ("Remote
servers that need a key"); no cookies, no `tools/call`, no session `DELETE` afterwards.

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
from the agent lock (with `--require approved`, the approved agent lock). The host's config runs the guard in place of
the server:

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
  not in the agent lock (it changed, is new, or the server's tool list was not seen yet); run `plumbline agent
  relock` and approve the new lock"*; under `--require approved` it says "the approved agent lock". While all tools are
  refused, the message says the lock could not be used.
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
review, approve). The line says the tools "differ from the agent lock" under `--require locked`, and "from the approved
agent lock" only under `--require approved`, the one mode that verified an approval at start; the `--strict` answer
follows the same rule. The guard never prints a tool name or description from the server to stderr or in an error it
makes.

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

**The audit.** `plumbline audit [--root <dir>] [--approvers <file>] [--all] [--out <dir>] [--json]` reads the history of
`plumbline.agent.lock.json` with git (`git log` and `git cat-file`, run with an argument list, never a shell; a folder
that is not in a git repository is exit 2). It lists every commit that touched the lock or the approval, groups them
into distinct lock versions (a new version wherever the lock's bytes change), and for each version reports the commit
and date, the chain link (above), and the approval: an approval file committed from the version's commit up to the
next lock change whose `lock` is this version's hash, verified against the approvers. An approval committed one or
more commits after its lock counts; one committed after the next lock change does not reach back. An approval file
that is not JSON is `invalid malformed`, never `absent`. The summary counts versions, verified, invalid, unverifiable,
absent, chain breaks, and versions before approval began.

What the exit certifies, since approval began (the default): exit 0 when the current (newest) lock is `verified` and
every version from the first `verified` one on is `verified` with each link after it intact. The versions before the
first approval are listed, marked "before approval began", counted in the summary, and do not fail; their findings
are still in the report, each marked `beforeApproval`. The reason: the natural order is to commit what `agent init`
wrote and approve later, so the first lock in almost every history is unapproved, and the whole-history rule kept audit
red forever. What an auditor needs is that nothing changed without an approval once approvals began, and that the lock
in use now is approved. With no approved version at all, nothing is "before approval", and the audit fails.
`--all` keeps the whole-history rule: exit 0 only when every version is `verified` and the whole chain is intact.
Either way: 1 otherwise (no lock in the history is `lock-absent`); 2 usage or I/O. The uncommitted working-tree lock
is not part of the history.

`--json` (and `audit.json`) adds to each version and finding `beforeApproval: true` where it applies, and to the
document `rule` (`since-first-approval` or `all`), `firstApproved` (the index of the first verified version, omitted
when there is none) and `summary.beforeApproval`; it is Plumbline's own output, not part of the wire. `--out <dir>`
writes `audit.json` (the same document `--json` prints) and `audit.md`, a table of version, date, commit, lock hash,
approver (label and kid when verified, the bare kid otherwise), verdict (with "(before approval began)" where it
applies) and chain, fit to attach to a change record. The audit prints labels from the approvers file and kids, never anything a server or
the repository wrote.

## CI

The Action's `command: agent` runs `plumbline agent check --fail-on <fail-on> --json` in the repository folder at
`root`, with the approvers from the `approvers` input passed as `PLUMBLINE_APPROVERS` (`action/README.md`). Its `state`
output is the report's state, `pass`, `fail` or `unavailable` (a report from an older CLI with no `state` is read from
the exit code), or `unknown` (a report that cannot be read, or an exit other than 0 or 1: never a pass); the job
summary states what was not checked ("Not checked: 1 MCP server"), lists the findings by code and ref and the approval
in words. `fail-on` (the input the gate uses too, default `fail`) decides what `unavailable` does: with `fail` the step
passes, so a pull request is not blocked by a server it cannot reach; with `unavailable` the step fails. `offline: true`
adds `--offline`. `issues: true` keeps one issue titled `Plumbline agent drift` with the watch's issue decisions (a
digest keyed by severity, code and ref; a comment naming what is new; closed on the next clean run); warn findings that
say something was not checked keep it open too, and the issue says what to do about them. With `issues: true` findings
leave the step green; without it, the check's exit decides. CI never approves: `signing-key`, `renew` and `relock-pr`
are refused with `command: agent`. A relock pull request for the agent lock is not built yet.

`action/templates/plumbline-agent.yml` runs two jobs, the Action pinned by full commit SHA:

- **check**, on every `pull_request`: `offline: true`, `contents: read` only. Made a required status check, it blocks
  any change to the agent that is not approved by a key in `PLUMBLINE_APPROVERS`: a pull request can change the
  declaration, the lock and the approval file, but not the repository variable that says whose approval counts.
- **watch**, daily and on `workflow_dispatch`: the full check (remote MCP servers and peers) with `issues: true` and
  `issues: write`.

What it does not cover: a pull request runs the workflow file from its own branch, so `.github/workflows/` needs a
code owner's review (CODEOWNERS) or a pull request could remove the check; and stdio servers are only seen when the
guard runs them, never in CI (Plumbline does not start a server to look at it): a stdio server the guard has not
observed is `server-not-observed`, which is `unavailable`, not `fail`. A remote server that needs a key is checked in
CI only when the job has the variable its `auth` names (from a secret); without it, `server-auth-missing`, `unavailable`.
