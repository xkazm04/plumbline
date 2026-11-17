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
| `kid` | key id: the first 16 hex characters of the SHA-256 of the raw 32-byte public key. Derived from the key, never claimed |
| `origin` | the origin the files are published from: `https://host[:port]`, no path, no trailing slash. `http` is accepted only for `localhost` and `127.0.0.1`, for tests |
| `signedAt` | when it was signed, UTC, `Date.toISOString()` form |
| `expiresAt` | when it stops being valid, same form. The default lifetime is 90 days; the publisher chooses |
| `subjects` | the signed files, sorted by `path`. `path` is relative to the site base with `/` separators; `sha256` is the lowercase hex digest of the file's canonical bytes (below) |
| `sig` | base64url (no padding) Ed25519 signature over the UTF-8 bytes of `canonicalJson(the object without sig)` |

Absent optional fields are omitted, never `null`.

### `.well-known/plumbline-key.json`

`{ "type": "plumbline-key", "version": 1, "alg": "Ed25519", "kid": "...", "publicKey": "<base64url raw 32 bytes>", "createdAt": "<ISO UTC>" }`

A verifier **never** trusts this file about itself. It is read only so a verifier that has never met the signer can say
"the signature is internally consistent but the signer is unknown", and so a person has a key to compare out of band.

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

An entry may also carry `"revokedAt": "<ISO UTC>"`, which a verifier sets once it has accepted a revocation of that key
(the CLI reads it from the file; `verify` itself only applies a revocation in memory and never writes the trust file).

An entry means: "for files published from `origin`, I accept signatures by this key", unless it carries `revokedAt`. The entry's `kid` must equal the
key id derived from its own `publicKey`; an entry where it does not is a defect in the trust store, reported as
`invalid kid-mismatch`, not treated as a stranger.

## Canonical bytes

Everything signed or hashed goes through one rule, `canonicalJson`:

- object keys sorted (by UTF-16 code unit, the default JavaScript sort), no whitespace anywhere,
- members whose value is `undefined` are dropped; `null` is kept,
- strings and numbers are written exactly as `JSON.stringify` writes them (`-0` becomes `0`, `1e21` becomes `1e+21`),
- the result is encoded as UTF-8.

It is byte-identical to the `canonicalJson` of Agent Customs (Apache-2.0), and a differential test holds it to that.

A **subject** is hashed like this: if the file is JSON, parse it and hash the canonical bytes of the parsed value, so
reformatting a file (whitespace, key order) does not change its digest while changing any value does. If the content is
text, hash its UTF-8 bytes. The CLI treats a path ending `.json` as JSON and every other path as text.

The signature itself is over `canonicalJson(signature without sig)`, so every field above, including `origin`, the
timestamps and every digest, is covered.

## What `sign` signs

The rule is one pure function in core, `signedPathsOf(manifest, hasLinks)`, shared by the CLI and the Desk.
`plumbline sign --root <site> --key <plumbline.private.json> --origin <origin> [--days N]` signs:

1. `agent-manifest.json` (required);
2. every network file named by the manifest's `networks[].hocon`. A path ending `.hocon` maps to the same name ending
   `.network.json`; any other path is used as written. A named file that is missing is an error (exit 2);
3. `links.json`, if it exists.

It writes `plumbline.signature.json` into the site root. Paths that are absolute or climb out of the root are refused.

## Verdicts

Three states, never two. Folding the third into either of the others is a bug.

| Verdict | Reason | Meaning |
| --- | --- | --- |
| `verified` | | the signer is in the verifier's trust store for this origin, every signed file matches, the signature is current and the math checks under the **trust store's** key |
| `invalid` | `malformed` | not a well-formed signature (wrong type, version or algorithm, missing or mistyped fields, duplicate paths, `expiresAt` not after `signedAt`), or `signedAt` more than 5 minutes in the future |
| `invalid` | `kid-mismatch` | a trust store entry's `kid` is not derived from its own key: the trust store is defective |
| `invalid` | `tampered` | a signed file differs from what was signed, or a signed path is missing from the files checked |
| `invalid` | `expired` | `now >= expiresAt` |
| `invalid` | `bad-signature` | the signer is trusted but the signature does not verify under the trusted key (the signature was edited, or was made by a different key than the `kid` it claims) |
| `invalid` | `revoked` | the signer's trust entry carries `revokedAt`: the key revoked itself, so nothing it signs is accepted, **whatever the dates** (whoever holds a leaked key can backdate `signedAt`) |
| `unverifiable` | | the signer is not in this verifier's trust store. Whether the math holds under the published key is stated in the `detail`, but the verdict is **never** `verified` |

Checks run in this order and stop at the first failure: shape; trust entry sanity; revocation (a revoked signer is
`revoked` before anything else is looked at); every signed file present and its digest equal; time (`expired`, then
future `signedAt`); then the signature math (trusted signer) or the stranger verdict. So editing a signed digest inside the signature file is reported as `tampered`, not `bad-signature`, because
the file check runs first. Files that are not listed in `subjects` are ignored: they are simply unsigned.

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
  key and `to` equals the key id derived from `toPublicKey`. On `verified` the verifier may add `to` / `toPublicKey` to
  its trust store for that origin.
- `from` unknown to the verifier: `unverifiable`. A stranger cannot hand a verifier a new key.
- `from` revoked (its trust entry carries `revokedAt`): `invalid revoked`, whenever the rotation says it was signed.
- `to` not derived from `toPublicKey`, a bad signature, or a malformed statement: `invalid`.

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

A verifier checks the statement with `applyRevocation(revocation, entry)` against the trust entry it **already** holds
for that `kid` (never a key that arrives with the statement):

- `verified` when the signature checks under the trusted key. The result carries the entry with `revokedAt` set; the
  verifier replaces its entry with it, for every origin it trusts that key for.
- no trust entry for that `kid`: `unverifiable`, and nothing changes. A key this verifier never trusted needs no revoking.
- a bad signature (someone else's statement), a malformed statement, or a defective trust entry: `invalid`, and
  nothing changes.

From then on the key is dead for everything, whatever the dates: every signature by it is `invalid revoked`, including
one that claims to predate the revocation (`signedAt` is chosen by whoever holds the key), and every rotation from it is
`invalid revoked`. So **a rotation signed by a key that later turns out to be leaked is not honoured once the revocation
is seen**.

What revocation cannot do:

- **A verifier who never sees the revocation cannot know.** Until it fetches `plumbline-revocation.json` (or hears of
  it out of band), it keeps accepting the leaked key. That is the stale-trust window, and it is why the publisher
  should also tell verifiers directly.
- **It does not undo what a verifier already did.** If a verifier adopted a successor key through a rotation from the
  leaked key before it saw the revocation, that successor's trust entry is not revoked by it: a trust entry does not
  record how it was adopted. Such a verifier should remove entries it adopted through a rotation from the revoked key.
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
| `plumbline sign --root <site> --key <private file> --origin <origin> [--days N]` | signs the files above, writes `plumbline.signature.json` |
| `plumbline verify --root <site> --trust <trust file> [--origin <origin>]` | prints the verdict line, `verified`, `invalid <reason>` or `unverifiable`, then the kid, origin and detail; exit 0 only for `verified`, 1 for `invalid` or `unverifiable`, 2 for I/O or usage errors. Reads `.well-known/plumbline-key.json` only to say whether the math holds for an unknown signer. With `--origin`, a signature made for another origin is `unverifiable` (above). When `plumbline-revocation.json` is in the root, it is applied to the trust store **in memory** first (the trust file is never written): the text output says `revocation applied` or `revocation not applied` with one line per trust entry checked, before the verdict line, and `--json` adds `revocation: { file, applied, results }` |
| `plumbline rotate --root <site> --old-key <file> --new-key <file>` | writes `plumbline-rotation.json` (a planned change only) |
| `plumbline revoke --root <site> --key <file> [--reason <text>]` | writes `plumbline-revocation.json`, signed by that key |

`verify` reads each signed file from disk. A signed `.json` file that no longer parses is checked as text, so it fails
as `invalid tampered` rather than as an I/O error.

## Known-answer vectors

`src/test/vectors.json` holds canonical strings, SHA-256 digests, a key id, a complete signature with its key pair and
verification cases (verified, expired at the boundary, tampered, missing file, stranger, poisoned trust entry). It is
plain JSON, generated once from a fixed seed, and any implementation, including a browser, can run it. The key in it is
a **published test key**: never add its `kid` to a real trust store.
