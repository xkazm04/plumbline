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
| `plumbline-rotation.json` | site root | `plumbline rotate` | the old key naming its successor |
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

### `plumbline.private.json` (CLI format)

`{ "type": "plumbline-private-key", "version": 1, "alg": "Ed25519", "kid": "...", "privateKey": "<base64url PKCS#8>" }`

Written with mode `0600` where the operating system supports it, and never over an existing file.

### `plumbline.trust.json` (CLI format)

`{ "version": 1, "entries": [ { "kid": "...", "origin": "https://example.com", "publicKey": "<base64url raw>" } ] }`

An entry means: "for files published from `origin`, I accept signatures by this key". The entry's `kid` must equal the
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
| `unverifiable` | | the signer is not in this verifier's trust store. Whether the math holds under the published key is stated in the `detail`, but the verdict is **never** `verified` |

Checks run in this order and stop at the first failure: shape; trust entry sanity; every signed file present and its
digest equal; time (`expired`, then future `signedAt`); then the signature math (trusted signer) or the stranger
verdict. So editing a signed digest inside the signature file is reported as `tampered`, not `bad-signature`, because
the file check runs first. Files that are not listed in `subjects` are ignored: they are simply unsigned.

`detail` is always a sentence written by the verifier. Text from inspected files is never copied into it.

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
- **A leaked key lets anyone sign as you.** Rotate at once (below) and tell your verifiers out of band.
- **A key held in browser memory is exposed to every script running on that origin.** Anything on the page can use it
  or export it. Keep signing keys on a build machine or a hardware-backed store, not in the page.
- Signatures expire. Re-sign before `expiresAt`; a site that forgets goes `invalid expired`, not quietly stale.

## Rotation

Because key loss is identity loss, rotation is part of the format. The old key signs a statement naming the new key:

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
- `to` not derived from `toPublicKey`, a bad signature, or a malformed statement: `invalid`.

A rotation only helps a verifier that still trusts the old key. If the old key is lost and was never trusted anywhere
else, the publisher starts over with a new identity and the first-contact ceremony below.

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
| `plumbline verify --root <site> --trust <trust file>` | prints one line, `verified`, `invalid <reason>` or `unverifiable`, then the kid, origin and detail; exit 0 only for `verified`, 1 for `invalid` or `unverifiable`, 2 for I/O or usage errors. Reads `.well-known/plumbline-key.json` only to say whether the math holds for an unknown signer |
| `plumbline rotate --root <site> --old-key <file> --new-key <file>` | writes `plumbline-rotation.json` |

`verify` reads each signed file from disk. A signed `.json` file that no longer parses is checked as text, so it fails
as `invalid tampered` rather than as an I/O error.

## Known-answer vectors

`src/test/vectors.json` holds canonical strings, SHA-256 digests, a key id, a complete signature with its key pair and
verification cases (verified, expired at the boundary, tampered, missing file, stranger, poisoned trust entry). It is
plain JSON, generated once from a fixed seed, and any implementation, including a browser, can run it. The key in it is
a **published test key**: never add its `kid` to a real trust store.
