# A Plumbline signature as a JWS

A verifier that speaks JWS (RFC 7515) can check a Plumbline signature, through the same trust store and with the same
three verdicts. This document is the profile. The native `plumbline.signature.json` stays the wire format: nothing new
is published by default, and no field of the format changes. The code is `src/core/jws.ts` (pure, so it runs in a
browser too); the CLI is `plumbline export-jws` and `plumbline verify --jws`.

## The canonical bytes are RFC 8785 (JCS) on Plumbline's documents

A Plumbline signature, rotation or revocation is signed over `canonicalJson(the object without sig)`
(`docs/signature-format.md`, "Bytes"). Tested 2026-11-18 (`src/test/jws.test.ts`): on Plumbline's own documents
`canonicalJson` gives exactly the bytes of the JSON Canonicalization Scheme, RFC 8785:

- it gives the RFC's canonical form of its section 3.2.2 sample, and the RFC's property order for its section 3.2.3
  sorting data (both recorded in `src/test/fixtures/rfc/`, copied from the RFC);
- on a generated signature, rotation, revocation (with a reason in several scripts, an emoji, quotes, a backslash and a
  newline) and key record, it equals a transcription of the RFC's Appendix A canonicalizer.

Both sort keys by UTF-16 code units, write no whitespace and write strings and numbers as ECMAScript's `JSON.stringify`
does. The differences are all outside JCS's domain (I-JSON), and none can occur in a well-formed Plumbline document:

| Input | `canonicalJson` | JCS |
| --- | --- | --- |
| a non-finite number | throws (the statement is `invalid malformed`) | an error: I-JSON has none |
| a member whose value is `undefined` | dropped | not JSON: a parsed document has none |
| a lone surrogate in a string | escaped (`\ud800`), as `JSON.stringify` does | an error: I-JSON forbids it |

So a JCS library can rebuild the signed bytes of any Plumbline document, and the canonical bytes do not change: a change
would break every signature already published.

## The profile

| Part | Value |
| --- | --- |
| protected header | exactly `{"alg":"EdDSA","kid":"<the Plumbline kid>"}`, serialised with canonical JSON (so `alg` then `kid`, no whitespace). `EdDSA` with an Ed25519 key is RFC 8037. `kid` is the signature document's `kid`: the first 16 hex characters of SHA-256 of the raw public key, never a key itself |
| payload | the UTF-8 bytes of `canonicalJson(plumbline.signature.json without sig)`, the bytes the native `sig` covers (`signedBytesOf` in `src/core/verify.ts`) |
| serialisation | JWS compact serialisation with a **detached** payload (RFC 7515, Appendix F): `BASE64URL(header) ".." BASE64URL(signature)`. The verifier rebuilds the payload from the signature document it reads anyway |
| signing input | `BASE64URL(header) "." BASE64URL(payload)`, as RFC 7515 defines it |

A verifier refuses, as `invalid malformed`: a JWS that is not three dot-separated parts; one with a payload (this
profile is detached); a header that is not a JSON object, whose `alg` is not `EdDSA` or whose `kid` is not 16 lowercase
hex; a header with `jwk`, `jku`, `x5c`, `x5u`, `x5t`, `x5t#S256` (a key inside the artifact is never trusted), `crit` (no
extension is understood) or `b64` (RFC 7797's unencoded payload is not part of the profile); and a header `kid` that is
not the signature document's.

**A JWS is not a re-encoding of the native signature.** Ed25519 signs a message; the native `sig` signs the payload,
the JWS signs the signing input (the header with the payload). One signature cannot be moved to the other message, so
making a JWS needs the private key. `plumbline export-jws` refuses a key whose kid is not the signature's and a
signature that does not verify under that key: it signs only a statement that key already signed.

## Verifying: the same trust store, the same verdicts

`verifyDetachedJws(signature, jws, files, trust, options)` runs `verifyStatement`, the native verifier's pipeline, with
the signature math swapped: shape, trust entry, revocation, every subject's exact bytes, coverage, time, then the
math under the **trust store's** key (`verified`) or the stranger's published key (`unverifiable`, saying whether the
math holds). The statement's own `sig` plays no part. A test gives both paths the same documents and the same trust
store in six cases (stranger, trusted, tampered, expired, revoked, another origin) and gets the same result in each.

```sh
plumbline export-jws --root ./site --key ./keys/plumbline.private.json --out ./site.jws
plumbline verify --root ./site --trust ./plumbline.trust.json --origin https://example.org --jws ./site.jws
plumbline verify --url https://example.org/ --trust ./plumbline.trust.json --jws ./site.jws
```

`verify --jws <file>` reads the JWS from a local file (the verifier's copy) and everything else as `verify` always does,
from the folder or the URL; its exit codes and output are `verify`'s.

Known-answer checks (`src/test/jws.test.ts`): RFC 8037 Appendix A.4 (the Ed25519 key and signing example) gives the
RFC's signature through the same primitive Plumbline signs with; a detached JWS made independently in the test with
WebCrypto (a hand-written header, the payload by the transcribed JCS reference) verifies here; and the JWS
`export-jws` makes verifies under an independent WebCrypto check.

## What this is for, and what it is not

It lets a JOSE library check a Plumbline signature with no Plumbline code, given the trust decision a person already
made. It aligns with A2A's signed Agent Cards, which carry JWS signatures over the card's JCS form; checking those
against a trust store is a follow-up (`docs/gate-and-watch.md` names what the watch reports of them today). It changes
nothing about first contact: a verifier still trusts a kid it learned out of band, never a key in the artifact.
