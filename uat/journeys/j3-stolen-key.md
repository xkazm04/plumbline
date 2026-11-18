---
id: j3-stolen-key
title: The stolen key
character: ines-baptista
world: northgate-clinic
promotion: discovery
level: L1, L2
---

# The stolen key

## Situation

Ines signs Northgate Clinic's agentic site and, wearing her other hat, sets up Harbour Pharmacy to check the clinic's
signature before its site hands patients over. Months later the laptop holding the clinic's private key is stolen.
Someone stands up a copy of the clinic's site with altered files, signed with the stolen key.

## Goal

Ines establishes trust properly at the start, and on the bad day revokes the stolen key, moves the clinic to a new
one, and confirms that the pharmacy refuses the forgery and accepts the clinic's new signature only after she has
deliberately trusted the new key.

## Acts

- `signed`: the clinic's site, signed with key A; the pharmacy has an empty trust file.
- `tamper`: one signed file on the clinic's site is edited after signing.
- `forgery`: a mirror of the clinic's site with altered files, validly signed with key A.
- `forgery-own-origin`: the thief signs the mirror with the stolen key for the mirror's own address. Added after run
  2026-11-18-first-five (INE-L1-03): does the pharmacy's CLI call the stolen key what the Desk calls it?
- `expire`: the clinic's signature is past its `expiresAt`.
- `attacker-rotates`: the mirror publishes a rotation from key A to the attacker's key.

(Revoking, rotating, re-signing and trusting are things Ines does with the product; they are not acts.)

## Definition of done, in Ines's words

"I wrote a one-page runbook from the product's own documentation and it was right. Before I trusted the clinic the
pharmacy said unverifiable, after it said verified, and when a file was altered it said invalid and why. On the bad
day I revoked, made a new key, signed again and re-established trust at the pharmacy, in that order, and every command
told me what it had changed. The forgery was refused as revoked, and the attacker's rotation got them nowhere."

## What this journey must answer

- Whether publisher and verifier roles are distinguishable in the help, the README and the command names.
- The first-contact ceremony: what she is told to compare, with whom, and what the DNS check adds and does not.
- Each verdict and reason for each act, and whether the sentences are distinct and fit for an incident note.
- The documented order on the bad day (revoke before rotate? rotate before revoke?) and what goes wrong in the other
  order; whether any step is irreversible without a preview.
- How the pharmacy learns of the revocation, and what it sees if it has not yet fetched it.
- What `adopt` does with a rotation signed by a revoked key.
- The Desk as a second opinion: do its verdicts match the CLI's for the same site and the same trust list?
- What the JWS export is for in her world, and whether its need for the private key is clear before she tries.
