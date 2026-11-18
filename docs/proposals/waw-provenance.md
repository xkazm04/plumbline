# Proposal: publisher provenance for agentic websites

**For:** the Worldwide Agentic Web MVP specification (cognizant-ai-labs/agentic-web,
`docs/worldwide_agentic_web_mvp_spec.md`). **Status:** proposal, optional profile. **Reference implementation:**
Plumbline (https://github.com/xkazm04/plumbline, Apache-2.0), `docs/signature-format.md` and `docs/jws-profile.md`.

## Problem

An agentic website publishes `agent-manifest.json` and network definitions that run in the visitor's browser, and links
to partner networks that run there too. Nothing in the specification says who published those files, whether they
changed since, or whether a partner's definition is the one a site reviewed. A cached, mirrored or compromised host can
serve different agent instructions under the same address, and a partner can change what runs in another site's
visitor's tab without that site knowing.

## Proposal

An optional profile, "signed agent files", in four parts. A site that does not adopt it is unaffected, and a client
that does not know it ignores the files.

**1. Files at the site base.**

| File | Content |
| --- | --- |
| `plumbline.signature.json` | an Ed25519 signature over the SHA-256 of the exact bytes of every file the runtime loads: the manifest, every `networks[].hocon` file at exactly that path, the action module(s), bridge, catalogue, action pages and coded-tools bundle the manifest names, and `links.json` when present |
| `.well-known/plumbline-key.json` | the public key record (a convenience for first contact; never trusted on its own) |
| `plumbline-rotation.json` | optional: the old key naming its successor (planned changes) |
| `plumbline-revocation.json` | optional: a key declaring itself dead, signed by itself (after a leak) |

Files are hashed as their exact bytes, not as parsed JSON: the reference runtime reads network files with a HOCON parser
that merges duplicate keys, so two files with one JSON reading can run differently. The signed object is canonical JSON
(identical to RFC 8785 on these documents) and can also be carried as a detached JWS with `alg: EdDSA` and the key id
as `kid` (`docs/jws-profile.md`).

**2. Three verdicts, never two.** A verifier answers `verified` (a key it already trusts for this origin signed exactly
these files, and the signature covers everything the runtime loads), `invalid` with a reason (`tampered`, `expired`,
`bad-signature`, `revoked`, `malformed`, `kid-mismatch`), or `unverifiable` (a signer it has never met, or a file it
could not read). A verdict says who published the files and that they did not change. It does not say the site is safe.

**3. Identity from the key, trust from the verifier.** The key id is the first 16 hex characters of SHA-256 of the raw
public key. A verifier resolves it in its own trust store and never trusts a key that arrives inside the artifact it is
checking. First contact is a person's decision: the key id is compared out of band; a publisher may also name it in DNS
(`_plumbline.<host> TXT "v=plumbline1; kid=<kid>"`) as a second channel an attacker of the web host alone does not
control (`docs/trust-bootstrap.md`).

**4. A reviewed baseline for partners.** A site may publish `plumbline.lock.json`, which records the SHA-256 of each
partner network it links to (and the partner's `links.json` and signer key id). The lock is one of the signed files. A
client, or the site's own CI, compares a partner with it before trusting a change; a changed partner definition is
changed code.

## What we ask the specification to do

1. Reserve the four file names above at the site base and in `.well-known/`, so no other use collides with them.
2. State, in the section on partner networks, that a runtime SHOULD offer a hook called with a partner's address and
   bytes before the partner network is instantiated, which may refuse it (a proposal for the reference runtime is in
   `docs/proposals/runtime-preload-hook.md`).
3. Reference this profile as optional, with the three verdicts and the first-contact rule as its normative core.

## What it costs a publisher

One key, kept off the site; one command after each release (`plumbline sign`), and again after accepting a partner
change. A site that never signs loses nothing. A site that signs gains a verdict any visitor, partner or crawler can
reproduce from public files.
