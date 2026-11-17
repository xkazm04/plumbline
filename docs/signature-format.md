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
| `plumbline-rotation.json` | site root | `plumbline rotate` | the old key naming its successor (a planned change only) |
| `plumbline-revocation.json` | site root | `plumbline revoke` | a key declaring itself dead (after a leak) |
| `plumbline.private.json` | the publisher's private custody, **never** the site | `plumbline keygen` | the private key (git-ignored by `*.private.json`) |
| `plumbline.trust.json` | the verifier's own machine | the verifier, by hand | who this verifier trusts, per origin |

`plumbline.lock.json` (the watch's baseline, `docs/gate-and-watch.md`) is not a signature file, but when a site
publishes one it is one of the signed files (below).

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

`{ "type": "plumbline-rotation", "version": 1, "from": "<old kid>", "to": "<new kid>", "toPublicKey": "<base64url raw>", "signedAt": "<ISO UTC>", "sig": "<base64url>" }`

`sig` is made by the **old** key over `canonicalJson(the object without sig)`.

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

### `plumbline.private.json` (CLI format)

`{ "type": "plumbline-private-key", "version": 1, "alg": "Ed25519", "kid": "...", "privateKey": "<base64url PKCS#8>" }`

Written with mode `0600` where the operating system supports it, and never over an existing file.

### `plumbline.trust.json` (CLI format)

`{ "version": 1, "entries": [ { "kid": "...", "origin": "https://example.com", "publicKey": "<base64url raw>" } ] }`

An entry may also carry:

- `"revokedAt": "<ISO UTC>"`, which a verifier sets once it has accepted a revocation of that key (the CLI reads it from
  the file; `verify` itself only applies a revocation in memory and never writes the trust file);
- `"adoptedVia": "<kid>"`, the key whose verified rotation statement this entry was adopted through (see "Rotation").
  Absent for an entry made by first contact.

An entry means: "for files published from `origin`, I accept signatures by this key", unless it carries `revokedAt`. The entry's `kid` must equal the
key id derived from its own `publicKey`; an entry where it does not is a defect in the trust store, reported as
`invalid kid-mismatch`, not treated as a stranger. An entry whose `kid`, `publicKey` or `adoptedVia` fails its pattern
makes the whole file unreadable to the CLI (exit 2).

**A revocation recorded anywhere counts everywhere.** When the CLI reads the trust file, a kid that carries `revokedAt`
in ANY entry is revoked in every entry, at every origin, and so is every entry whose `adoptedVia` chain leads to a
revoked kid (`spreadRevocations` in core; the Desk applies the same rule).

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
test holds it to that.

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
3. `links.json`, if it exists;
4. `plumbline.lock.json`, if it exists. The Desk reads the published lock, so an unsigned one would be an unattested
   baseline. **Publisher order: `plumbline watch --init` first (it writes the lock), then `plumbline sign`.** After
   reviewing drift and writing a fresh lock, sign again.

It writes `plumbline.signature.json` into the site root. `signSubjects` (core) refuses a file set that does not
include everything `signedPathsOf` requires for its own manifest, so it never makes a signature that cannot verify.

## Verdicts

Three states, never two. Folding the third into either of the others is a bug.

| Verdict | Reason | Meaning |
| --- | --- | --- |
| `verified` | | the signer is in the verifier's trust store for this origin, every signed file matches, the signature covers every file the runtime loads, the signature is current and the math checks under the **trust store's** key |
| `invalid` | `malformed` | not a well-formed signature (wrong type, version or algorithm, missing or mistyped fields, a `kid` or subject path outside its pattern, duplicate paths, `expiresAt` not after `signedAt`, a value canonical JSON refuses), `signedAt` more than 5 minutes in the future, or a signed manifest whose `networks[].hocon` is not a safe site-relative path |
| `invalid` | `kid-mismatch` | a trust store entry's `kid` is not derived from its own key (or its key is not a 32-byte base64url): the trust store is defective |
| `invalid` | `tampered` | a signed file differs from what was signed, a signed path is missing from the files checked, or the signature does not cover a file the runtime loads: `agent-manifest.json`, a network the **signed** manifest names, or a `links.json` or `plumbline.lock.json` that is present |
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
them, signed or not (the CLI does; a 404 means absent).

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
  never put it in the published site directory.
- **A leaked key lets anyone sign as you, and rotate as you.** Do not rotate after a leak: revoke (below).
- **A key held in browser memory is exposed to every script running on that origin.** Anything on the page can use it
  or export it. Keep signing keys on a build machine or a hardware-backed store, not in the page.
- Signatures expire. Re-sign before `expiresAt`; a site that forgets goes `invalid expired`, not quietly stale.

## Rotation

Rotation is for a **planned** change while the old key is still safe (a scheduled replacement, a move to new hardware).
It is not the answer to a leak: a rotation is signed by the old key, so whoever holds a leaked key can publish a
rotation to a key of their own, and it verifies. After a leak, revoke instead (next section).

The old key signs a statement naming the new key:

1. `plumbline keygen --out <new dir>` makes the successor.
2. `plumbline rotate --root <site> --old-key <old private file> --new-key <new private file>` writes
   `plumbline-rotation.json`. It refuses a new key that is the old key, and a key file whose `kid` does not match its key.
3. Publish the new key record at `.well-known/plumbline-key.json`, publish `plumbline-rotation.json`, and re-sign the
   site with the new key.

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
when the statement is malformed, when `from` is not trusted for that origin, or when `from` is revoked anywhere; it
does not check the signature, which is `verifyRotation`'s job. **Plumbline's CLI and Desk never adopt a successor
automatically**: the CLI's `verify` does not read `plumbline-rotation.json` at all, and adopting is the verifier's own
decision, made by editing its trust store.

A rotation only helps a verifier that still trusts the old key. If the old key is lost and was never trusted anywhere
else, the publisher starts over with a new identity and the first-contact ceremony below.

## Revocation: what to do after a leak

A revocation is a statement, signed by the leaked key itself, that the key is dead. Anyone holding the key may make
one, the thief included, and that is fine: a revocation can only take trust away, never hand it to anyone.

After a leak, the publisher:

1. `plumbline revoke --root <site> --key <leaked private file> [--reason <text>]` writes `plumbline-revocation.json`.
   Publish it at the site base.
2. `plumbline keygen --out <new dir>` makes a **new** key. Re-sign the site with it and publish its key record.
3. Re-establish trust with every verifier through the **first-contact ceremony** below: the new key reaches them out of
   band, like the first one did. Do not publish a rotation from the leaked key; verifiers refuse it.

A verifier checks the statement with `applyRevocation(revocation, entry, trustEntries?)` against the trust entry it
**already** holds for that `kid` (never a key that arrives with the statement):

- `verified` when the signature checks under the trusted key. The result carries the entry with `revokedAt` set. When
  the verifier passes its whole store as `trustEntries`, the result also carries `entries`: the store with the
  revocation spread to every entry for that kid, at every origin, **and to every entry whose `adoptedVia` chain leads
  to it** (a successor adopted through a rotation from the revoked key, the successor's own successors, and so on).
  The verifier replaces its store with it.
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
  should also tell verifiers directly.
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

Skipping step 2 turns the trust store into a rubber stamp for whoever controls the site at that moment, which is
exactly the attacker the signature was meant to exclude.

## CLI

Exit codes: `0` clean, `1` findings, `2` usage or I/O error. Every command accepts `--json` for machine output and
`--now <ISO timestamp>` to pin the clock (tests, reproducible runs).

| Command | Does |
| --- | --- |
| `plumbline keygen --out <dir>` | writes `plumbline.private.json` and `.well-known/plumbline-key.json` under `<dir>`, prints the `kid` and the custody warnings; refuses to overwrite |
| `plumbline sign --root <site> --key <private file> --origin <origin> [--days N]` | signs the files above (the lock too, when it exists: run `watch --init` first), writes `plumbline.signature.json` |
| `plumbline verify --root <site> --trust <trust file> [--origin <origin>]` | prints the verdict line, `verified`, `invalid <reason>` or `unverifiable`, then the kid, origin and detail; exit 0 only for `verified`, 1 for `invalid` or `unverifiable`, 2 for I/O or usage errors (including a trust file with a malformed entry). Reads `.well-known/plumbline-key.json` only to say whether the math holds for an unknown signer. With `--origin`, a signature made for another origin is `unverifiable` (above). When `plumbline-revocation.json` is in the root, it is applied to the trust store **in memory** first (the trust file is never written), spread to every origin and to every entry adopted through the revoked key: the text output says `revocation applied` or `revocation not applied` with one line per trust entry checked, before the verdict line, and `--json` adds `revocation: { file, applied, results }` |
| `plumbline rotate --root <site> --old-key <file> --new-key <file>` | writes `plumbline-rotation.json` (a planned change only) |
| `plumbline revoke --root <site> --key <file> [--reason <text>]` | writes `plumbline-revocation.json`, signed by that key |

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
