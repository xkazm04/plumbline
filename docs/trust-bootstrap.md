# First contact: a second channel, and what is not built yet

The first time a verifier meets a signer, the verdict is `unverifiable`, by design (`docs/signature-format.md`, "First
contact"). The verifier learns the publisher's key id out of band and only then trusts it. That step is the cost of a
signature that means something, and it is the step people skip. This document says what Plumbline does to make it
cheaper without ever letting a site vouch for itself, and why two larger ideas are not built yet.

## Built: the publisher names its kid in DNS

A publisher adds one TXT record to the site's DNS zone:

```text
_plumbline.<host>  TXT  "v=plumbline1; kid=<16 lowercase hex>"
```

`plumbline dns --key <plumbline-key.json> [--origin <https origin>]` prints it. Several records are allowed: during a
rotation the publisher lists the old and the new kid until verifiers have moved. A record that starts with
`v=plumbline1` and is not exactly this form (a separator `;`, spaces around either part, a trailing `;` allowed) is
malformed: it is counted and never read for a kid. Records that do not start with `v=plumbline1` belong to something
else and are ignored. Text from a record never reaches a line Plumbline prints, except a kid in its exact pattern.

`plumbline trust --url <site>` asks DNS for that name (one TXT lookup through the system's resolver, 4 s per try, 2
tries, and an absolute 10 s bound; `src/net/dns.ts`) and prints one of four answers:

| Answer | Means |
| --- | --- |
| `agrees` | a well-formed record names this kid (among others, during a rotation) |
| `disagrees` | well-formed records name other kids, and not this one |
| `no record` | the name has no Plumbline record (NXDOMAIN, no TXT, or only malformed ones, which are counted) |
| `could not ask` | the lookup failed or timed out, or the host has no DNS name to ask (an IP literal, `localhost`, a single label) |

What it changes:

- **It adds nothing by itself.** Without `--yes`, `trust` still adds nothing and exits 1, whatever DNS says: an
  agreement is evidence for a person, not consent.
- **A disagreement is never overridden silently.** With `--yes` and DNS that disagrees, `trust --url` refuses (exit 1,
  `refusedBy: "dns"` in `--json`). A person who confirmed the kid out of band and knows why DNS differs adds the record
  they checked with `trust --key <file> --origin <origin> --yes`, a separate, deliberate command that asks no DNS.
- **`--require-dns`** (with `--url`) makes `--yes` refuse unless DNS agrees: for a verifier who wants the second channel
  every time.
- **`verify` is unchanged.** It trusts only the trust file. DNS is asked at first contact, never at verification.

What it is: a second channel that an attacker of the web host alone does not control. Someone who can replace the
site's files and its `.well-known/plumbline-key.json` still cannot change the TXT record, so `disagrees` exposes them.
What it is not: proof against an attacker who holds the DNS zone, the registrar account or the resolver the verifier
uses (no DNSSEC validation is done; Node's resolver does not validate). Comparing the kid with the publisher out of band
stays the strong step; DNS makes a mismatch loud and an agreement cheap to see.

## Not built: keyless signing through CI identity

The idea: instead of a long-lived Ed25519 key, the publisher's CI signs with a short-lived key bound to its workload
identity (an OIDC token from the CI provider, a certificate from a public CA such as Sigstore's Fulcio, the signature
recorded in a public transparency log such as Rekor). A verifier then trusts "files signed by workflow W of repository
R", not a key, and key custody disappears.

Threat model. It moves trust from "whoever holds the key" to "whoever can run workflow W" plus the CA and the log
operators. It defends against key theft from a laptop and makes rotation free. It does not defend against a compromised
repository or CI configuration (that attacker can run W), and it adds two third parties whose availability and honesty
the verifier depends on.

Why not now. It needs a dependency for the certificate chain and the log's inclusion proofs (Plumbline has none at run
time), a network round trip to third-party services at sign and verify time (the gate already depends on two), and a
second identity model beside `kid`, which the wire contract and the three verdicts would have to carry. The detached JWS
profile (`docs/jws-profile.md`) is the first step that would let such a signature sit beside the native one.

## Not built: a public append-only log of key and lock changes

The idea: every key record, rotation, revocation and lock a site publishes is also appended to a public log (a
transparency log with signed tree heads), so a verifier can ask "is this the key the site has always shown, and has it
shown anyone else a different one?" and a publisher can monitor the log for keys it never made.

Threat model. It defends against a split view (the site shows one key to one verifier and another to the next) and
makes a quiet key swap visible after the fact; it is the answer to rollback (`docs/signature-format.md`, "Known limit of
version 1: rollback") for anyone who checks the log. It does not stop a first contact with a key that was malicious from
the start, and the log operator must be trusted not to fork it, or be watched by gossiping monitors.

Why not now. Someone must run the log and its monitors, which no part of this project does, and a log nobody watches
protects nobody. The lock and signature formats need no change for it: a log would record their exact bytes.
