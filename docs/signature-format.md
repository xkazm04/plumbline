# Plumbline signature format, version 1

This document is the format. The code that implements it is `src/core` (pure: it runs in Node 22 and in a browser
through WebCrypto) and `src/cli`; the exact names live in `src/core/types.ts`, and `npm run check:wire` pins them.
If a name here and a name there ever differ, the wire contract in `types.ts` wins and this document has a bug.

## What a signature is for, and what it is not

A publisher signs the agent files of a website with an Ed25519 key that only the publisher holds. A verifier checks
that signature against a **trust store** it already holds. That is all it does.

**A `verified` verdict proves one thing: these files came from the holder of a key this verifier already trusts for
this origin, and they have not changed since they were signed.** It does **not** mean the site is safe, honest,
correct, free of malware, well behaved, compliant, or that its agents do what they say. A publisher can sign a bad
file. A verdict says nothing about the people behind the key, and it says nothing about files that were not signed.
Treat it as provenance and integrity, never as endorsement.

## Files

| File | Where | Who writes it | What it is |
| --- | --- | --- | --- |
| `plumbline.signature.json` | site root | `plumbline sign` | the signature over the agent files |
| `.well-known/plumbline-key.json` | site root | `plumbline keygen` | the public key record (a convenience; never trusted on its own say-so) |
| `plumbline-rotation.json` | site root | `plumbline rotate` | the old key naming its successor (a planned change only); after more than one rotation, the chain of them |
| `plumbline-revocation.json` | site root | `plumbline revoke` | a key declaring itself dead (after a leak); after more than one revocation, every one of them |
| `plumbline.private.json` | the publisher's private custody, **never** the site | `plumbline keygen` | the private key (git-ignored by `*.private.json`) |
| `plumbline.trust.json` | the verifier's own machine | the verifier: `plumbline trust` (first contact), `plumbline adopt` (a rotation), `plumbline verify` (an accepted revocation), or by hand | who this verifier trusts, per origin |

`plumbline.lock.json` (the watch's baseline, `docs/gate-and-watch.md`) is not a signature file, but when a site
publishes one it is one of the signed files (below). Its wire shape is `PlumblineLock` in `types.ts`; since 2026-11-18 a
peer record may carry `outline` (`PeerOutline`: `agents`, `hosts`, `front`, every string a lowercase hex SHA-256, so no
peer's names or hosts are written in clear), omitted when absent, never `null`. A reader older than this change ignores
the member; a lock that carries a malformed one is `unusable`. A peer record may also carry `formerKid` (since
2026-11-18, TOM-RC-1), a kid in its exact pattern, present only when `kid` is absent: the kid the lock recorded before a
person accepted, with `watch --relock --accept-signer <peer>`, that the peer publishes no signature now. A later
signature by any other key is a signer change from it, which a relock refuses until a person names the peer again. It is
compared, never verified, and never a public key: the lock is not a trust store. A record carrying both `kid` and
`formerKid`, or a malformed one, makes the lock `unusable`. Likewise a grounding source may carry `anchors`
(`GroundingSource.anchors`, since 2026-11-18): the sorted SHA-256 of each normalised literal (a price, a time, a date, a
phone number, an e-mail address, a percentage) that the network's instructions and that page both state, so no literal
is written in clear; omitted when there are none. Such a source may also carry `places` (`GroundingSource.places`, since
2026-11-18, MAR-RC-1): keyed by a member of its `anchors`, the sorted SHA-256 of "<literal>\n<place>" for each place on
the page the network's fact is stated in (a place is the nearest heading and, in a table row, the row's first cell), so a
value that moved on the page is told from one still in place, again with nothing in clear; omitted when no place could
be told. A key that is not one of the source's anchors, or an empty list, makes the lock `unusable`. And a lock may
carry `external` (since 2026-11-18): agent definitions
from outside the agentic-web spec, keyed by address, each `{ kind, sha256, parts?, signatures?, checkedAt }` (`ExternalRecord`,
`EXTERNAL_KINDS`: `a2a-card`, and `mcp-tools`, reserved and not read by this build); `parts` maps SHA-256 of a part's id
to SHA-256 of its canonical JSON, and `signatures` (since 2026-11-18, UAT-17) is how many JWS signatures a card read as
one carried when locked, a non-negative integer, counted and never verified; omitted when it could not be read as a
card and in every lock written before. A malformed `signatures` makes the lock `unusable`.

**The watch report** (`DriftReport` in `types.ts`, `plumbline watch --json`) is `{ findings, lockState?, lockSummary?,
checkedAt?, records? }`, each finding `{ kind, severity, code, ref, expected?, actual?, summary, counts? }`. Since
2026-11-18 (UAT-17), each omitted when absent, never `null`: every finding carries `code`, one of `DRIFT_CODES` (a
closed list; `docs/gate-and-watch.md` "Reason codes" gives each one's kind, severity and what `expected` and `actual`
hold), and a changed peer or card carries `counts` (`DriftCounts`, the numbers its sentence says); the report carries
`checkedAt`, the UTC ISO time the watch ran, and, when the lock was found, `records` (`WatchedRecord`: one row per peer,
pending peer and external definition the lock holds, with its pin, recorded signer, `lockedAt`, a `state` from
`RECORD_STATES` and this report's codes for it). A report written before has none of these.

### `plumbline.signature.json`

```json
{
  "type": "plumbline-signature",
  "version": 1,
  "alg": "Ed25519",
  "kid": "56475aa75463474c",
  "origin": "https://example.com",
  "signedAt": "2026-11-17T12:00:00.000Z",
  "expiresAt": "2026-12-17T12:00:00.000Z",
  "subjects": [{ "path": "agent-manifest.json", "sha256": "<64 lowercase hex>" }],
  "sig": "<base64url Ed25519 signature>"
}
```

| Field | Meaning |
| --- | --- |
| `type` | always `plumbline-signature` |
| `version` | always `1` |
| `alg` | always `Ed25519` |
| `kid` | key id: the first 16 hex characters of the SHA-256 of the raw 32-byte public key. Derived from the key, never claimed. Exactly `^[0-9a-f]{16}$` |
| `origin` | the origin the files are published from: `https://host[:port]`, no path, no trailing slash. `http` is accepted only for `localhost` and `127.0.0.1`, for tests |
| `signedAt` | when it was signed, UTC, `Date.toISOString()` form |
| `expiresAt` | when it stops being valid, same form. The default lifetime is 90 days; the publisher chooses |
| `subjects` | the signed files, sorted by `path`. `path` is relative to the site base with `/` separators, uses only `[A-Za-z0-9._/-]`, and has no empty, `.` or `..` segment (anything else is `invalid malformed`); `sha256` is the lowercase hex SHA-256 of the file's **exact bytes** (below) |
| `sig` | base64url (no padding) Ed25519 signature over the UTF-8 bytes of `canonicalJson(the object without sig)` |

Absent optional fields are omitted, never `null`.

### `.well-known/plumbline-key.json`

`{ "type": "plumbline-key", "version": 1, "alg": "Ed25519", "kid": "...", "publicKey": "<base64url raw 32 bytes>", "createdAt": "<ISO UTC>" }`

A verifier **never** trusts this file about itself. It is read only so a verifier that has never met the signer can say
"the signature is internally consistent but the signer is unknown", and so a person has a key to compare out of band.
A record whose `kid` or `publicKey` fails its pattern is ignored.

**Patterns.** Every inbound document (signature, key record, rotation, revocation, trust entry) is held to these
before anything else is done with it, and a string that fails its pattern is never copied into a `detail`:

- a kid: exactly 16 lowercase hex characters, `^[0-9a-f]{16}$`;
- a public key: base64url, no padding, of exactly 32 bytes, so 43 characters whose last one carries two zero bits:
  `^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$`.

### `plumbline-rotation.json`

One statement:

`{ "type": "plumbline-rotation", "version": 1, "from": "<old kid>", "to": "<new kid>", "toPublicKey": "<base64url raw>", "signedAt": "<ISO UTC>", "sig": "<base64url>" }`

`sig` is made by the **old** key over `canonicalJson(the object without sig)`.

**A chain (since 2026-11-18).** The file holds either one statement (the form above, which every file written before
2026-11-18 has and which `plumbline rotate` still writes for a site's first rotation), or a JSON **array** of
1 to `MAX_STATEMENTS_PER_FILE` (64) statements in chain order, oldest first: `[A -> B, B -> C, ...]`, where each
statement's `from` is the previous statement's `to`, so each is signed by the key before it. The statements are
unchanged; the array adds no member of its own (`RotationFileBody` in `types.ts`). A verifier still on `A` follows the
whole chain (see "Rotation"). An empty array or one longer than 64 is `invalid malformed`. A verifier older than this
change reads an array as a malformed statement and adopts nothing, which is the safe failure: it can still be brought
forward by first contact.

### `plumbline-revocation.json`

```json
{
  "type": "plumbline-revocation",
  "version": 1,
  "alg": "Ed25519",
  "kid": "<the revoked kid>",
  "revokedAt": "<ISO UTC>",
  "reason": "<optional note for people>",
  "sig": "<base64url Ed25519 by the REVOKED key>"
}
```

`sig` is made by the **revoked** key over `canonicalJson(the object without sig)`. `reason` is optional and omitted when
absent, never `null`; it is covered by the signature. There is no `origin`: a revoked key is dead for every origin a
verifier trusts it for. See "Revocation" below for what a verifier does with it.

**Every revocation stays published (since 2026-11-18).** The file holds either one statement (the form above, which
every file written before 2026-11-18 has and which `plumbline revoke` still writes for a site's first revocation), or a
JSON **array** of 1 to `MAX_STATEMENTS_PER_FILE` (64) statements, oldest first, one per revoked key (`RevocationFileBody`
in `types.ts`). Each statement is unchanged and is checked on its own: a statement that does not verify changes nothing
and does not stop the others. Before this, a second `revoke` overwrote the first statement, so a verifier that had missed
the first revocation never saw it. A verifier older than this change reads an array as a malformed revocation and
applies none of it; a site whose only revocation is one statement is read the same by both.

### `plumbline.private.json` (CLI format)

`{ "type": "plumbline-private-key", "version": 1, "alg": "Ed25519", "kid": "...", "privateKey": "<base64url PKCS#8>" }`

Written with mode `0600` where the operating system supports it, and never over an existing file. The name and the
type string are core's (`PRIVATE_KEY_FILE`, `PRIVATE_KEY_TYPE`), and `isPrivateKeyFile(value)` is the one shape test
the CLI and the Desk share; it does not check that `kid` belongs to the key (signing refuses a mismatch).

### `plumbline.trust.json` (CLI format)

`{ "version": 1, "entries": [ { "kid": "...", "origin": "https://example.com", "publicKey": "<base64url raw>" } ] }`

An entry may also carry:

- `"revokedAt": "<ISO UTC>"`, set once the verifier has accepted a revocation of that key. `plumbline verify` writes it
  itself (since 2026-11-17): when a `plumbline-revocation.json` verifies under the trusted key, every entry it reaches
  (every origin, every `adoptedVia` chain) gets `revokedAt` in the trust file at once, so the key stays dead when a
  later copy of the site no longer serves the revocation;
- `"adoptedVia": "<kid>"`, the key whose verified rotation statement this entry was adopted through (see "Rotation").
  Absent for an entry made by first contact;
- `"addedAt": "<ISO UTC>"` (since 2026-11-18, UAT-23), when this verifier added the entry: `trust --yes` and
  `adopt --yes` write it (`--now` pins it);
- `"revokedRecordedAt": "<ISO UTC>"` (since 2026-11-18, UAT-23), when this verifier recorded `revokedAt` in the file
  (`verify`, or `adopt --yes`, applying a revocation). `revokedAt` stays the revocation's own time, and for a key revoked
  by cascade the time of the key it was adopted through, so a successor adopted after that time reads revoked "before"
  it was added; `addedAt` and `revokedRecordedAt` say what happened here, and when.

Both stamps are informational (no verdict reads them), are omitted when absent (never `null`), and an entry written
before has neither. A stamp that is not an ISO UTC time makes the whole file unreadable to the CLI (exit 2), as any other
malformed member does. The Desk's own trust list does not stamp them, and drops them when it imports a file.

**A trust file that is not there is an empty one for `verify`** (since 2026-11-18, UAT-23): nothing is trusted yet, so
the verdict is `unverifiable` (exit 1, a `--json` verdict with `trustFileAbsent: true`), with a note naming how to make
one by first contact (`plumbline trust --file <it> --url <site>`), never an I/O error. `trust` creates the file;
`adopt` still needs one (it adopts from a key it already holds).

An entry's `origin` is held to the same rule as a signature's (`https://host[:port]`, no path, no trailing slash; `http`
only for `localhost` and `127.0.0.1`): an entry with `https://example.com/` would never equal any signature's origin and
would silently trust nothing, so the CLI refuses the whole file instead (since 2026-11-18).

An entry means: "for files published from `origin`, I accept signatures by this key", unless it carries `revokedAt`. The entry's `kid` must equal the
key id derived from its own `publicKey`; an entry where it does not is a defect in the trust store, reported as
`invalid kid-mismatch`, not treated as a stranger. An entry whose `kid`, `publicKey` or `adoptedVia` fails its pattern
makes the whole file unreadable to the CLI (exit 2), as does an `origin` that breaks the origin rule.

**When the CLI writes the trust file** (`trust`, `adopt`, `verify` recording a revocation) it writes a temporary file
beside it and renames it over the original, so a reader never sees half a file, and it keeps every member it does not
know, at the top level and in each entry. It only ever appends an entry or adds `revokedAt`; it never removes one.

**A revocation recorded anywhere counts everywhere.** When the CLI reads the trust file, a kid that carries `revokedAt`
in ANY entry is revoked in every entry, at every origin, and so is every entry whose `adoptedVia` chain leads to a
revoked kid (`spreadRevocations` in core; the Desk applies the same rule). And a kid revoked in any entry is found as
revoked for an origin the trust file holds no entry for (the CLI's trust store lookup, `trustStoreOf`): a stolen key
signing, or publishing a rotation, for another origin reads `invalid revoked` (`verify`, `adopt`), as on the Desk, never
"the signer is unknown". Only a revoked entry is found that way, so it can only take trust away.

## Bytes: what is hashed and what is signed

**A subject is hashed as the file's exact bytes**, as the web server serves them: no JSON parse, no re-serialisation,
no newline or byte-order-mark change. A verifier hashes the bytes it fetched (or read from disk) and nothing else.

Why exact bytes and not a canonical form of the JSON: the reference runtime does not read a network file with
`JSON.parse`. It reads it with its own HOCON parser, which **merges** duplicate keys (a second `commondefs` object is
deep-merged into the first), where `JSON.parse` keeps only the last. Two files with one canonical JSON can therefore
run differently: an attacker could put a `commondefs.replacement_values` entry in a duplicate key that every JSON
reader drops and the runtime applies, and swap an agent's instructions while the canonical digest stays the same. Only
the bytes the runtime receives pin what it runs. Repositories pin LF line endings (`.gitattributes`:
`* text=auto eol=lf`), and web servers serve bytes as stored, so the bytes a publisher signs on any machine are the
bytes a visitor gets.

Until 2026-11-17 a JSON subject was hashed as the canonical JSON of its parsed value, so its digest matched Agent
Customs' fingerprint style. That compatibility is gone for subjects, on purpose. It was never reproducible against
Customs' own fingerprint anyway, which is taken over the runtime-filtered configuration (replacement strings expanded,
defaults pushed down, links split off), not over the published file.

**Canonical JSON is used for Plumbline's own objects only**: the signature without `sig`, and the rotation and
revocation statements, each signed over `canonicalJson(the object without sig)`:

- object keys sorted (by UTF-16 code unit, the default JavaScript sort), no whitespace anywhere,
- members whose value is `undefined` are dropped; `null` is kept,
- strings and numbers are written exactly as `JSON.stringify` writes them (`-0` becomes `0`, `1e21` becomes `1e+21`),
- a non-finite number (`Infinity`, `-Infinity`, `NaN`, and so `1e999` once parsed) is **refused**: `canonicalJson`
  throws, where `JSON.stringify` would write `null` and give `1e999` and `null` one encoding. A signature, rotation or
  revocation carrying one is `invalid malformed`,
- the result is encoded as UTF-8.

On every finite value it is byte-identical to the `canonicalJson` of Agent Customs (Apache-2.0), and a differential
test holds it to that. On Plumbline's own documents it is also exactly RFC 8785 (JCS), tested against the RFC's samples
(since 2026-11-18); the differences are outside JCS's domain (`docs/jws-profile.md`). The same statement can be carried
as a detached JWS (`alg: EdDSA`, the kid as `kid`), checked through the same trust store with the same verdicts; the
native file stays the wire format (`docs/jws-profile.md`).

Core has one function for these bytes, `unsignedBytesOf(statement)` (canonical JSON of the object without `sig`), and
one identity check, `isDerivedKid(kid, publicKey)` (the kid is well formed, the key is 32 bytes of base64url, and the kid
is derived from it; never throws). Signatures, rotations, revocations and the CLI's `trust` all use them, so a change to
either rule is made in one place.

The signature is over `canonicalJson(signature without sig)`, so every field above, including `origin`, the
timestamps and every digest, is covered.

## What `sign` signs

The rule is one pure function in core, `signedPathsOf(manifest, { links, lock })`, shared by the CLI and the Desk. It
follows what the reference runtime **fetches**: it loads each network from `networks[].hocon` exactly as the manifest
writes it (`resolveUrl(base, entry.hocon)`), and it fetches the site's `links.json` and lays it over every network's
links. `plumbline sign --root <site> --key <plumbline.private.json> --origin <origin> [--days N]` signs:

1. `agent-manifest.json` (required, and it must be JSON);
2. every network file named by the manifest's `networks[].hocon`, **at exactly that path**, with one leading `./`
   removed (`./x.hocon` and `x.hocon` are the same address to the runtime). There is no mapping between names: a
   `hocon` of `x.hocon` signs the file `x.hocon`. A `hocon` that is an absolute URL or path, contains `..`, `.` or an
   empty segment, a backslash, or any character outside `[A-Za-z0-9._/-]` is refused (exit 2): the runtime would fetch
   it from somewhere a signature cannot pin. A named file that is missing is an error (exit 2);
3. every code file the manifest makes the runtime load, by the same rule as a `hocon` (one leading `./` removed; an
   absolute URL or path, `..`, `.` or an empty segment, a backslash or a character outside `[A-Za-z0-9._/-]` is
   refused, exit 2, and the error names the field, never its value):
   - `actions.module` and each string in `actions.modules`, the website-tools modules the runtime imports
     (`runtime/action-transport.js`, `loadActionModule`: `import(sameOriginAsset(base, path))`);
   - `actions.bridge`, the HTML page the runtime frames for partner sites (`action-transport.js`, the bridge frame);
   - `coded_tools.bundle`, the executable bundle of coded tools (`runtime/engine.js`, `_compile`).

   A value that is not a string is skipped (the runtime cannot load it either);
4. `links.json`, if it exists;
5. `plumbline.lock.json`, if it exists. The Desk reads the published lock, so an unsigned one would be an unattested
   baseline. **Publisher order: `plumbline watch --init` first (it writes the lock), then `plumbline sign`.** After
   reviewing drift and writing a fresh lock, sign again.

**What the signature does NOT cover**, so a verifier knows where `verified` stops:

- **Modules those files import in turn.** A signed action module that does `import "./helpers.js"` pins the import
  statement, not `helpers.js`. Keep action code in the files the manifest names, or name every module in
  `actions.modules`.
- **The page's own scripts and the runtime folder** (`index.html`, its scripts and styles, `runtime/`). They are loaded
  by the page, not named by the manifest. They rest on the HTTPS origin, and the watch's runtime lock
  (`docs/gate-and-watch.md`) records every file under `runtime/` and blocks on any change.
- **What the pages named in `actions.pages` load in turn.** The pages themselves are signed (their forms become
  actions, `runtime/form-actions.js`), as is `actions.catalog` (a JSON catalogue of HTTP actions,
  `runtime/discovered-actions.js`); their own scripts and the endpoints a catalogue calls are not.
- Anything fetched from another origin: partner networks (the watch's peer check covers those) and the model router.

It writes `plumbline.signature.json` into the site root. `signSubjects` (core) refuses a file set that does not
include everything `signedPathsOf` requires for its own manifest, so it never makes a signature that cannot verify.

## Verdicts

Three states, never two. Folding the third into either of the others is a bug.

| Verdict | Reason | Meaning |
| --- | --- | --- |
| `verified` | | the signer is in the verifier's trust store for this origin, every signed file matches, the signature covers every file the runtime loads, the signature is current and the math checks under the **trust store's** key |
| `invalid` | `malformed` | not a well-formed signature (wrong type, version or algorithm, missing or mistyped fields, a `kid` or subject path outside its pattern, duplicate paths, more than `MAX_SUBJECTS` (256) subjects, `expiresAt` not after `signedAt`, a value canonical JSON refuses), `signedAt` more than 5 minutes in the future, or a signed manifest whose `networks[].hocon` or code file path (above) is not a safe site-relative path |
| `invalid` | `kid-mismatch` | a trust store entry's `kid` is not derived from its own key (or its key is not a 32-byte base64url): the trust store is defective |
| `invalid` | `tampered` | a signed file differs from what was signed, a signed path is missing from the files checked, or the signature does not cover a file the runtime loads: `agent-manifest.json`, a network or code file (action module, bridge, coded-tools bundle) the **signed** manifest names, or a `links.json` or `plumbline.lock.json` that is present |
| `invalid` | `expired` | `now >= expiresAt` |
| `invalid` | `bad-signature` | the signer is trusted but the signature does not verify under the trusted key (the signature was edited, or was made by a different key than the `kid` it claims) |
| `invalid` | `revoked` | the signer's trust entry carries `revokedAt`: the key revoked itself, so nothing it signs is accepted, **whatever the dates** (whoever holds a leaked key can backdate `signedAt`) |
| `unverifiable` | | the signer is not in this verifier's trust store. Whether the math holds under the published key is stated in the `detail`, but the verdict is **never** `verified` |

Checks run in this order and stop at the first failure: shape; trust entry sanity; revocation (a revoked signer is
`revoked` before anything else is looked at); every signed file present and its digest equal; coverage; time
(`expired`, then future `signedAt`); then the signature math (trusted signer) or the stranger verdict. So editing a
signed digest inside the signature file is reported as `tampered`, not `bad-signature`, because the file check runs
first.

**Coverage.** After the digests match, the verifier reads the networks from the **signed** manifest's bytes (as the
runtime does: UTF-8, a leading BOM dropped, `JSON.parse`) and recomputes `signedPathsOf(manifest, { links, lock })`,
where `links` and `lock` say whether a `links.json` or `plumbline.lock.json` is among the files handed to it. Every
path in that set must be a signed subject. So a `links.json` added after signing (the runtime would lay it over the
network's links) and a lock added after signing are `invalid tampered`, with a detail that names the kind of file and
never its content. Other files that are not listed in `subjects` are ignored: they are simply unsigned, and nothing
the runtime loads. A verifier must therefore hand over `links.json` and `plumbline.lock.json` whenever the site serves
them, signed or not (the CLI does; a 404 means absent), and every code file the manifest names.

`detail` is always a sentence written by the verifier. Text from inspected files is never copied into it, with one
exception: the `--origin` mismatch sentence names the signature's `origin`, which the shape check has already held to a
bare `https://host[:port]` origin.

**Checking as an origin** (`verifySignature(..., { expectedOrigin })`, `plumbline verify --origin <origin>`). A signature
names the origin it was made for, and the trust store is looked up under that origin. A verifier that knows where the
files actually came from passes it: when it differs from the signature's `origin`, a result that is not already
`invalid` becomes `unverifiable`; the detail says the signature names a different origin, and the result's `origin` field carries the signed one (the detail never quotes the inspected file). The files may be genuine, but they
are not attested for this origin (a mirror, a copy, or someone serving another site's signed files as their own). An
`invalid` result stays `invalid`. Without it, nothing changes.

Every result carries `kid` and `origin` whenever they were readable.

### Known limit of version 1: rollback

**An older signature, still unexpired, served together with the older files it covers, still verifies.** Nothing in a
signature says it is the newest one, so an attacker who can serve the site (or a stale mirror or cache) can roll it
back to an earlier signed state, for example one before a dangerous instruction was fixed, as long as that signature
has not expired. The defences in version 1 are short signature lifetimes (choose `--days` as short as your re-signing
routine allows; the 90-day default is illustrative) and the watch, whose lock records what the site should be serving
now. Version 1 has no freshness or sequence field; this is a known limit, not an oversight.

## Identity: the key inside the artifact is never trusted

The verifier resolves `kid` and `origin` in **its own trust store** and verifies with the key found there. It never
verifies with the key shipped beside the signature. A forged signature can carry a perfectly self-consistent key record
(its `kid` really is derived from that key, the math really holds), and it is still only an `unverifiable` stranger,
because nothing in the artifact can vouch for itself.

## Key custody

- **Key loss is identity loss.** There is no recovery: nobody else holds the private key. Back up
  `plumbline.private.json` to somewhere offline, and keep a second copy apart from the first.
- **Never commit the private key.** `*.private.json` is git-ignored here; do the same in your site's repository, and
  never put it in the published site directory. `plumbline sign` and `plumbline rotate` refuse (exit 2) when the
  private key file resolves inside `--root` (symlinks followed), or when the root holds a `plumbline.private.json` at
  all: a folder deploy would publish it. `plumbline revoke` never refuses (the key in the site may be the leak being
  revoked) but warns. `plumbline keygen` warns when `--out` already looks like a site (it holds `agent-manifest.json` or
  `plumbline.signature.json`).
- **A leaked key lets anyone sign as you, and rotate as you.** Do not rotate after a leak: revoke (below).
- **A key held in browser memory is exposed to every script running on that origin.** Anything on the page can use it
  or export it. Keep signing keys on a build machine or a hardware-backed store, not in the page.
- Signatures expire. Re-sign before `expiresAt`; a site that forgets goes `invalid expired`, not quietly stale.

## Rotation

Rotation is for a **planned** change while the old key is still safe (a scheduled replacement, a move to new hardware).
It is not the answer to a leak: a rotation is signed by the old key, so whoever holds a leaked key can publish a
rotation to a key of their own, and it verifies. After a leak, revoke instead (next section). `rotate` says so in its
usage line and its output every time (UAT-15): "rotate is for a planned change of key, not for a leak ...". And a
rotation made before a leak is found is no way out of it: a verifier that adopted the successor through the leaked key
revokes the successor with it (below), so `revoke` warns about every successor the root's `plumbline-rotation.json`
names for the key it revokes, and `sign` warns when its key is named there as the successor of a key the root's
`plumbline-revocation.json` revokes (checked under that key when the chain or the root's key record carries its public
key; otherwise said as "holds a revocation of", not checked). Both still write: a warning adds, it never decides.

The old key signs a statement naming the new key:

1. `plumbline keygen --out <new dir>` makes the successor.
2. `plumbline rotate --root <site> --old-key <old private file> --new-key <new private file>` writes
   `plumbline-rotation.json`. It refuses a new key that is the old key, a key file whose `kid` does not match its key,
   a key file inside the site root, and (exit 2, pointing at `keygen` and first contact) an old key, or a new key, that
   the root's `plumbline-revocation.json` revokes, checked under that key: every verifier refuses such a rotation. When
   the file already holds a rotation, the new statement is **appended**, making a chain: it must continue from the
   chain's newest key (otherwise exit 2: rotate from that key, or move the file aside if the chain belongs to an identity
   you retired), it may not return to a key the chain already left, and the same rotation twice writes nothing.
3. Publish the new key record at `.well-known/plumbline-key.json`, publish `plumbline-rotation.json`, and re-sign the
   site with the new key. `plumbline sign` warns when the root's `.well-known/plumbline-key.json` is absent or is not
   the signing key's record (it does not refuse: the record may be served from elsewhere).

A verifier checks the statement with `verifyRotation(rotation, trust, origin)`:

- `verified` only when `from` is in the trust store for that origin, the signature checks under the **trust store's**
  key and `to` equals the key id derived from `toPublicKey`. On `verified` the verifier may add the successor to its
  trust store for that origin.
- `from` unknown to the verifier: `unverifiable`. A stranger cannot hand a verifier a new key.
- `from` revoked (its trust entry carries `revokedAt`): `invalid revoked`, whenever the rotation says it was signed.
- `to` not derived from `toPublicKey`, a `toPublicKey` that is not the base64url of 32 bytes, a bad signature, or a
  malformed statement: `invalid`.

**Adopting the successor.** A verifier that decides to adopt it builds the entry with
`adoptRotation(rotation, trustEntries, origin)` (core), only after `verifyRotation` returned `verified` for that origin.
It returns `{ kid: to, origin, publicKey: toPublicKey, adoptedVia: from }`; the `adoptedVia` field records that this
entry exists on the old key's word, so revoking the old key later revokes this entry too (next section). It throws
when the statement is malformed, when `from` is not trusted for that origin, when `from` is revoked anywhere, or when
`to` is recorded as revoked anywhere (a revoked key is never trusted again, the rule first contact follows); it does
not check the signature, which is `verifyRotation`'s job.

**Following a chain.** `walkRotationChain(statements, trustEntries, origin)` (core) takes the statements of a rotation
file (one statement is a chain of one) and starts at the **newest** key the verifier holds for that origin: the last
statement whose `from` has an entry there. From that statement to the end, each must continue from the previous one's
`to`, verify under the key trusted so far (`verifyRotation`, each successor already walked counting as trusted) and
name a successor `adoptRotation` accepts. It returns `{ result, hops, entries, brokenAt?, newest? }`: `entries` are the
successors to add, in chain order, each with `adoptedVia` naming the key before it, so a revocation of any key up the
chain revokes every key after it. The first statement that breaks the chain, does not verify, or names a revoked key
**stops the walk**: `brokenAt` is its index (0 is the oldest), `result` is its verdict, and `entries` is empty: a broken
chain adopts nothing, not even the hops before the break. Statements before the starting point are checked for shape
only. No trusted key in the chain is `unverifiable`. **Plumbline's CLI and Desk never adopt a successor
automatically**: adopting is the verifier's own decision. From the CLI it is
`plumbline adopt --trust <trust file> (--root <site> --origin <origin> | --url <site base> [--allow-local]) [--yes]`: it
applies the site's `plumbline-revocation.json` first (a rotation from a revoked key is refused), walks the rotation file
with `walkRotationChain` against the trust file for that origin, and prints each hop's `from -> to` and verdict and each
successor's public key. Without `--yes` it writes nothing and exits 1; with `--yes` it appends every successor's entry
(and records a revocation it accepted) and exits 0. A rotation that does not verify, a chain that breaks (the line names
the statement, and `--json` carries `brokenAt` and `chainLength`), and a successor the trust file records as revoked
(with `trust`'s own sentence) are refused (exit 1); a rotation file that is not JSON is `invalid malformed` (exit 1); a
successor already trusted for that origin is not added twice (exit 0). With `--url` the site is read through the same
guarded fetch as `verify --url` and the origin is the URL's own (`--origin` is refused beside it); a revocation the site
does not serve cleanly (an error, not a 404) refuses the adoption (exit 2), because it might revoke the key the rotation
comes from. `plumbline verify` never adopts; when the signer is unknown and the site (folder or URL) serves a
`plumbline-rotation.json`, it prints a hint that names the matching `plumbline adopt --root ...` or `--url ...` command.

A rotation only helps a verifier that still trusts the old key. If the old key is lost and was never trusted anywhere
else, the publisher starts over with a new identity and the first-contact ceremony below.

## Revocation: what to do after a leak

A revocation is a statement, signed by the leaked key itself, that the key is dead. Anyone holding the key may make
one, the thief included, and that is fine: a revocation can only take trust away, never hand it to anyone.

After a leak, the publisher:

1. `plumbline revoke --root <site> --key <leaked private file> [--reason <text>]` writes `plumbline-revocation.json`.
   Publish it at the site base. When the file already holds a revocation of another key, the new statement is
   **appended** (the file becomes a list), so the earlier revocation stays published; a revocation of the same key that
   already verifies in the file writes nothing; a file that holds no statement is never overwritten (exit 2).
   `revoke` says the revocation is final (every verifier that reads it refuses the key from then on, whatever the
   dates, and never trusts it again; there is no un-revoke), and warns when the root's `plumbline-rotation.json` names
   a successor of the key: that successor is revoked with it wherever it was adopted, so it is not the key to re-sign
   with (`--json`: `successors`).
2. `plumbline keygen --out <new dir>` makes a **new** key, one no rotation names. Re-sign the site with it and publish
   its key record.
3. Replace the site's `_plumbline` TXT record (`docs/trust-bootstrap.md`) so it names the new kid alone:
   `plumbline dns --key <new key record> --origin <origin>`. A record that still names the revoked kid tells a fresh
   verifier, whose web host the thief may control, that DNS agrees with the stolen key.
4. Re-establish trust with every verifier through the **first-contact ceremony** below: the new key reaches them out of
   band, like the first one did. Do not publish a rotation from the leaked key; verifiers refuse it.

A verifier checks the statement with `applyRevocation(revocation, entry, trustEntries?)` against the trust entry it
**already** holds for that `kid` (never a key that arrives with the statement):

- `verified` when the signature checks under the trusted key. The result carries the entry with `revokedAt` set. When
  the verifier passes its whole store as `trustEntries`, the result also carries `entries`: the store with the
  revocation spread to every entry for that kid, at every origin, **and to every entry whose `adoptedVia` chain leads
  to it** (a successor adopted through a rotation from the revoked key, the successor's own successors, and so on).
  The verifier replaces its store with it.

`applyRevocationText(text, entries)` (core) is the same rule over a revocation file's text, as read or fetched: it
parses it (text that is not JSON is `invalid malformed`, "The revocation file is not valid JSON."), takes its statements
(one, or a list), checks each against every entry held for its kid, and returns `{ applied, kid?, kids?, results,
entries }`: `applied` when at least one statement verified, the entries in the order given with every verified
revocation spread, and one result per entry checked, statement by statement. `kid` is the single statement's kid, or the
last well-formed kid of a list (the newest, since `revoke` appends); `kids` (since 2026-11-18) names every well-formed
kid in the file once, in file order: read it to ask "does this site revoke key X". The CLI and the Desk both apply revocations through it; the caller decides
whether to keep the result in memory or write it to its store (`plumbline verify` writes it).
- no trust entry for that `kid`: `unverifiable`, and nothing changes. A key this verifier never trusted needs no revoking.
- a bad signature (someone else's statement), a malformed statement, or a defective trust entry: `invalid`, and
  nothing changes.

From then on the key is dead for everything, whatever the dates: every signature by it is `invalid revoked`, including
one that claims to predate the revocation (`signedAt` is chosen by whoever holds the key), and every rotation from it is
`invalid revoked`. So **a rotation signed by a key that later turns out to be leaked is not honoured once the revocation
is seen**, and a successor already adopted through it, with `adoptedVia` recorded, is revoked with it.

What revocation cannot do:

- **A verifier who never sees the revocation cannot know.** Until it fetches `plumbline-revocation.json` (or hears of
  it out of band), it keeps accepting the leaked key. That is the stale-trust window, and it is why the publisher
  should also tell verifiers directly. Once seen, it is not forgotten: `plumbline verify` records it in the trust file,
  so a mirror, a cache or a restored host that serves the old files without the revocation is still `invalid revoked`.
- **It reaches only what the trust store recorded.** A successor that a verifier added by hand, without `adoptedVia`,
  looks like a first-contact entry and is not revoked by the cascade. Adopt successors with `adoptRotation`.
- **It does not recover a lost key.** A key that is lost (not leaked) cannot sign its own revocation; let the
  signatures expire and start over with first contact.

## First contact: how a verifier comes to trust a key

The first time a verifier meets a signer, the verdict is `unverifiable`, by design. Trust is a decision a person makes,
not something the artifact can announce about itself. The ceremony:

1. Fetch the site's `.well-known/plumbline-key.json`. Note the `kid` and the `publicKey`.
2. Learn the `kid` **through a channel that is not the site itself**: the publisher tells you in person, on a call, in a
   signed message, in a repository you already trust, or in a printed document. Compare it character by character.
3. Check that the `kid` really is derived from the `publicKey` (the tools do this for you).
4. Only then add an entry `{ kid, origin, publicKey }` to `plumbline.trust.json`.
5. Verify again. Now `verified` means something.

From the CLI, steps 3 and 4 are `plumbline trust --key <the fetched plumbline-key.json> --origin <origin> --file
<plumbline.trust.json>`, or, folding step 1 in, `plumbline trust --url <site base> [--allow-local] --file
<plumbline.trust.json>`: it fetches `.well-known/plumbline-key.json` through the same guarded fetch as `verify --url`
and takes the origin from the URL (`--origin` is refused beside it). Fetching the record from the site adds no trust:
the kid is still compared out of band, and the same warning is printed. It refuses a record whose `kid` is not derived from its `publicKey` (exit 2), a bad origin
(exit 2), and a kid this trust file records as revoked at any origin (exit 2: a revoked key is never trusted again).
With `--url` it also reads the site's `plumbline-revocation.json`: a site that publishes a revocation of the very key
it offers is refused, `--yes` or not (exit 1, nothing written, `--json` `refusedBy: "revocation"`), as the Desk does
not offer it; the revocation is honoured unverified there because it can only take trust away.
Otherwise it prints the kid and the first-contact warning and, **without `--yes`, adds nothing and exits 1** ("confirm
out of band, then rerun with --yes"). With `--yes` it appends `{ kid, origin, publicKey }` (creating the file when it
does not exist) and exits 0; a key already trusted for that origin is not added twice (exit 0).

Skipping step 2 turns the trust store into a rubber stamp for whoever controls the site at that moment, which is
exactly the attacker the signature was meant to exclude.

**A second channel in DNS (since 2026-11-18).** A publisher may name its kid at `_plumbline.<host>` in a TXT record
`v=plumbline1; kid=<kid>` (`plumbline dns --key <record> [--origin <origin>]` prints it; one record per key during a
rotation). `trust --url` asks for it and prints `agrees`, `disagrees`, `no record` or `could not ask`; `--json` carries
`dns: { name, state, kids?, malformed?, why? }`. It adds no trust: without `--yes` nothing is added whatever DNS says; a
disagreement refuses `--yes` (exit 1, `refusedBy: "dns"`), never overridden silently; `--require-dns` refuses `--yes`
unless DNS agrees. `verify` never asks DNS. It is a channel an attacker of the web host alone does not control, not
proof against one who holds the DNS zone or the registrar (`docs/trust-bootstrap.md`).

## CLI

Exit codes: `0` clean, `1` findings, `2` usage or I/O error. Every command accepts `--json` for machine output, and
every command that reads the clock accepts `--now <ISO timestamp>` to pin it (tests, reproducible runs). On a usage
error (an unknown or missing option, an option without its value, a bad `--origin`, `--days` or `--now`) a command
prints the message and then its own usage line; with `--json` the error object carries it as `usage`. An I/O error
prints no usage line. The commands are `init`, `watch`, `gate`, `badge`, `keygen`, `sign`, `verify`, `rotate`, `revoke`,
`trust`, `adopt`, `dns` and `export-jws`; anything else is an unknown command, exit 2. `badge` draws a gate report as a small SVG
(`docs/ecosystem-scan.md`); it reads no clock, so it refuses `--now`: its date is the report's `checkedAt`.

**The gate report** (`GateReport` in `src/core/types.ts`, `plumbline gate --json`) is `{ target, state, findings,
checkedAt?, signature? }`. Two members were added on 2026-11-18 (UAT-10), each omitted when absent, never `null`:
`checkedAt`, the UTC ISO time the gate ran (every run since writes it; an older report has none), and `signature`, a
`VerifyResult` (`{ verdict, reason?, kid?, origin?, detail? }`, the verdicts and reasons above) present only when the
gate was given `--trust <file>` and checked the site's signature as `verify --url` does. A report without `signature`
says nothing about the signature. Neither member changes `state`. `init` (since 2026-11-18) writes the watch's lock and, with
`--workflow`, its daily workflow, and makes no key (`docs/gate-and-watch.md`).

| Command | Does |
| --- | --- |
| `plumbline keygen --out <dir>` | writes `plumbline.private.json` and `.well-known/plumbline-key.json` under `<dir>`, prints the `kid` and the custody warnings; refuses to overwrite |
| `plumbline sign --root <site> (--key <private file> \| --key-env <NAME>) --origin <origin> [--days N]` | with `--key-env`, the private key file's JSON is read from that environment variable (a CI secret): never printed, never written; a refusal names the variable, never its content, and the output adds notes on CI custody (`--json`: `keyFrom: "env"`, `custody`). It signs the files above (the lock too, when it exists: run `watch --init` first), writes `plumbline.signature.json`. Refuses (exit 2, pointing at `keygen`) when the root's `plumbline-revocation.json` revokes the signing key, checked under that key; a revocation of another key, one that does not verify under this key, or one that is not JSON does not stop it. Refuses (exit 2) a private key file inside the root, or a root holding `plumbline.private.json`. Warns when the root's `.well-known/plumbline-key.json` is absent or another key's; `--json` carries `keyRecord: "match" \| "mismatch" \| "absent"` |
| `plumbline verify --trust <trust file> (--root <site> [--origin <origin>] \| --url <site base> [--allow-local] [--timeout <seconds>]) [--jws <file>]` | with `--jws`, the signature is checked through that detached JWS instead of its native `sig`, everything else unchanged (`docs/jws-profile.md`); prints the verdict line, `verified`, `invalid <reason>` or `unverifiable`, then the kid, origin and detail; exit 0 only for `verified`, 1 for `invalid` or `unverifiable`, 2 for I/O or usage errors (including a trust file with a malformed entry, though not an absent one, which is empty since UAT-23, and a `plumbline.signature.json` that could
not be fetched). A site or folder with no `plumbline.signature.json` is `unverifiable` (exit 1, a `--json` verdict),
printed after the revocation lines, so a revocation recorded on the way is never written silently. Reads `.well-known/plumbline-key.json` only to say whether the math holds for an unknown signer. With `--origin`, a signature made for another origin is `unverifiable` (above). When a `plumbline-revocation.json` is found beside the site, it is applied first with `applyRevocationText`, spread to every origin and to every entry adopted through the revoked key, and **recorded in the trust file** when it verified: the text output says `revocation applied` or `revocation not applied` with one line per trust entry checked (for a statement that verified: `the revocation statement verified under the trusted key <kid> (<origin>): that key is revoked`; the verdict word `verified` is never set beside a revoked kid), then `revocation recorded in <file> (N entries: <kid> for <origin>; <kid> for <origin> (adopted through revoked key <kid>))` or `revocation already recorded in <file>`, before the verdict line; `--json` adds `revocation: { file, applied, recorded, trustFile?, recordedEntries?, recordedKeys?, results }`. When the signer is unknown and the site holds a `plumbline-rotation.json`, a hint names `plumbline adopt` (with `--url` for a site read by URL), except when a statement of it is from a key the trust file records as revoked (adopt refuses that). The verdict line is fit to paste into a note (UAT-8): `verified` ends with the signature's expiry and its limit ("The signature is valid until <date>. Verified means these files are the publisher's and unchanged, not that the site is safe, honest or correct."); `invalid tampered` names the signed file that differs or is missing; `invalid expired` its date; `invalid revoked` says "revoked because it was adopted through revoked key <kid>" for a key that died by cascade (the entry's `revokedAt` is the key it was adopted through's) and "revoked by its holder" otherwise; a signature made for another origin names both ("The signature names <origin>, but these files were checked as <origin> ..."); and a signer the trust file does not hold for the origin while it holds another, unrevoked key there reads "This origin's trusted key is X; this signature is by Y, with no rotation from X ..." (or "and the site publishes a rotation from X: check it with adopt ..."), never as a stranger's. Since 2026-11-18 (UAT-17) `--json` carries the same two facts as fields: `signerChange: { trusted, signer, rotation: "published" \| "none", rotationFrom? }` for a signer the trust file does not hold while it holds another key for the origin, and `hint: { code: "rotation-published", rotationFrom, command }` when the hint names `adopt`. The Desk says the same sentences, names an origin mismatch or a swapped signer in its first line, shows the signature's expiry, and offers no first contact for a swapped signer |
| `plumbline rotate --root <site> --old-key <file> --new-key <file>` | writes `plumbline-rotation.json` (a planned change only), or appends to the chain it holds; refuses a revoked old or new key and a key file inside the root (see "Rotation"). `--json`: `{ from, to, rotationFile, written, chainLength }` |
| `plumbline revoke --root <site> --key <file> [--reason <text>]` | writes `plumbline-revocation.json`, signed by that key, or appends to the list it holds (see "Revocation"); says the revocation is final, warns about a successor the root's rotation file names for the key, and its `next:` line includes replacing the DNS record with the new kid alone. `--json`: `{ kid, revokedAt?, revocationFile, written, revocations, successors? }` |
| `plumbline trust --file <trust file> (--key <plumbline-key.json> --origin <origin> \| --url <site base> [--allow-local] [--require-dns]) [--yes]` | first contact (above): prints the kid, what DNS says (with `--url`) and the warning; adds `{ kid, origin, publicKey }` only with `--yes` (exit 0), otherwise exit 1 and nothing written; a DNS disagreement, or `--require-dns` without agreement, refuses `--yes` (exit 1). `--json`: `{ kid, origin, publicKey, trustFile, added, alreadyTrusted, warning, keyRecord?, dns?, refusedBy? }` (`keyRecord`: the URL the record was fetched from) |
| `plumbline dns --key <plumbline-key.json> [--origin <origin>]` | prints the `_plumbline.<host>` TXT record that names the key's kid; refuses a record whose kid is not derived from its key. `--json`: `{ name, type, value, kid }` |
| `plumbline adopt --trust <trust file> (--root <site> --origin <origin> \| --url <site base> [--allow-local]) [--yes]` | a published rotation or chain (see "Rotation"): `walkRotationChain`, then with `--yes` every successor's entry is appended (exit 0); without `--yes`, or when the chain breaks or does not verify, exit 1 and nothing written. A successor of a key the trust file already holds a different successor of, for the origin, is never adopted, with or without `--yes` (UAT-15: two successors of one key is how a stolen key looks): exit 1, a warning naming both, nothing written, `--json` `refusedBy: "fork"` and `forks: [{ of, trusted, offered }]`. `--json`: `{ results, revocation?, chainLength, brokenAt?, from?, to, added, adopted?, successors?, ... }`: since 2026-11-18 (UAT-17) `adopted` lists the keys only once they were added, and `successors` the keys the rotation offers while nothing is. A site that publishes no `plumbline-rotation.json` is a verdict, not an error: `unverifiable`, "nothing adopted: there is no rotation to adopt", exit 1, `--json` `refusedBy: "no-rotation"` (one that cannot be fetched is still exit 2) |
| `plumbline export-jws --root <site> --key <private file> [--out <file>]` | the site's `plumbline.signature.json` as a detached JWS (`docs/jws-profile.md`), signed by the key that made it; refuses another key, a signature that does not verify under this one, and (UAT-15) a key the root's `plumbline-revocation.json` revokes, checked under that key, as `sign` and `rotate` do (exit 2). Changes nothing on the site. `--json`: `{ jws, kid, file? }` |

**`verify --url <site base>`** fetches the site instead of reading a folder, through the same guarded fetch as the gate
and the watch (`src/net/safe-fetch.ts`: https only, every resolved address public, at most 3 redirects, a 512 KiB body
ceiling and a 10 s timeout per file). A signed file (a subject) is asked for with the runtime-file ceiling
(`ceiling: "runtime"`, `MAX_RUNTIME_FILE_BYTES`, 4 MiB), because a signed action module or coded-tools bundle can be
larger than a network definition, and one over the ceiling is reported as over it, never as not served or tampered.
The whole run has one overall deadline, 60 s unless `--timeout <seconds>` (at most 3600) says otherwise; a file asked
for after it passed is not served. A signature that lists more than `MAX_SUBJECTS` (256) files is `invalid malformed`
and **none** of its files is fetched, so a hostile signature cannot hold a verifier for hours. The base is read as a folder (a missing trailing `/` is added; query and
fragment are dropped), and the files are checked **as the URL's origin**: `--url` binds `expectedOrigin` itself, so
`--origin` is refused beside it, and a signature made for another origin is `unverifiable`. It fetches, as exact bytes:
`plumbline-revocation.json` (first), `plumbline.signature.json`, every signed path (a path that is not a safe
site-relative path is never fetched), `links.json`, `plumbline.lock.json` and `.well-known/plumbline-key.json`. A 404 or
410 means absent. Any other answer, or a fetch that fails, is never read as absent: a signature that answers 404 or 410
is the verdict `unverifiable` ("This site publishes no plumbline.signature.json ..., so nothing can be verified.",
exit 1, with a `--json` verdict, as the Desk says it; since 2026-11-19, before which it was exit 2), and one that cannot
be fetched is an I/O error (exit 2) after the revocation lines, if any, are printed on stderr; and when the revocation, `links.json`, the lock or a signed file could not be read, a result that would be
`verified` or `invalid tampered` becomes `unverifiable`, naming what was not served. `--allow-local` accepts http and
loopback addresses (private ranges stay refused), for a site on this machine and for tests; it prints a warning.

`verify` reads each signed file from disk as bytes, plus `links.json` and `plumbline.lock.json` whenever they exist (so
an unsigned one is caught by the coverage check). A signed file that was edited in any way, including one that no
longer parses, fails as `invalid tampered` rather than as an I/O error.

## Known-answer vectors

`src/test/vectors.json` holds canonical strings, inputs canonical JSON must refuse (`canonicalRefused`), SHA-256
digests, a key id, a complete signature with its key pair and verification cases (verified, expired at the boundary,
tampered, a duplicate-key `commondefs`, a re-serialised file, CRLF and BOM changes, a missing file, an unsigned
`links.json` or lock added after signing, a signature that leaves out a network the manifest names, stranger, poisoned
trust entry). Each file's `content` is its exact text; a subject digest is SHA-256 of that text's UTF-8 bytes. It is
plain JSON, generated from a fixed seed (regenerated on 2026-11-17 with the same seed, when subjects became exact
bytes), and any implementation, including a browser, can run it. The key in it is a **published test key**: never add
its `kid` to a real trust store.
