---
name: Ines Baptista
role: Independent IT contractor serving Northgate Clinic (a publisher) and Harbour Pharmacy (a verifier)
segment: generalist IT administrator holding keys for small organisations
world: northgate-clinic
journeys: [j3-stolen-key]
references:
  - "A2A v1.0 signed Agent Cards: a signature proves integrity, not identity; binding a key to an organisation is the unsolved step (levelup.gitconnected.com, next.redhat.com, read 2026-11-16)"
  - "Time figures below are the author's estimates, not measured"
---

# Ines Baptista

## Background and voice

Ines, 46, looks after IT for nine small organisations in one town, among them a clinic whose site lets patients ask an
assistant about appointments, and the pharmacy next door whose site hands patients over to it. She is competent at a
command line, careful, and not a cryptographer: she has renewed TLS certificates, managed SSH keys and once spent a
weekend recovering from an expired code-signing certificate nobody had written down. She keeps a paper runbook per
client, because she is the only one who will be there at 7 a.m. on the bad day.

She speaks in procedures. She wants to know, before she does a thing, what it changes and how to undo it. Health data
is near enough to this work that "probably fine" is not a sentence she can say to the clinic's director.

## Job to be done

When the laptop holding the clinic's signing key is stolen, I want to kill the old key, move to a new one, and be sure
the pharmacy's check now refuses anything signed with the stolen key, so that a forged clinic assistant cannot be
passed off as the real one.

## What good looks like

- First contact is a procedure I can write on one page, and it tells me what I am vouching for.
- On the bad day there is one obvious order of operations, and each command says what it changed.
- After revoking, the pharmacy's verdict changes and says why, in a word I can put in an incident note.
- I cannot be tricked into trusting the new key just because the stolen one said so.
- I can prove afterwards what was trusted when.

## Pet peeves

- Verdicts that sound the same for different causes. "Invalid" with no reason.
- Any step where the secure option and the convenient option look alike.
- Help text that assumes I know which side (publisher or verifier) a command belongs to.
- Irreversible commands with no preview.

## Motivation (minutes)

Without the product: there is no check at all; the pharmacy simply links to the clinic. The by-hand equivalent, a
phone call to confirm and a manual comparison of files after an incident, is about 90 minutes and proves little.
With the product: first contact about 15 minutes once; the incident (revoke, rotate, re-sign, re-establish trust at
the pharmacy) about 30 minutes. Target saving: about 60 minutes per incident, with an outcome she can defend.

## Senior-quality bar

Ines would write an incident runbook with: the order of steps, who runs each, what each changes, how to confirm it
worked, and what stays exposed. Documentation and command output that would not let her write that runbook, or that
would let her write a wrong one, fails the bar.

## Surface binding

CLI on her own laptop, for both organisations, in separate folders. The Desk as a second opinion and to show a
director. She holds the clinic's private key; she never holds anyone else's. No CI in either organisation.

## Scored acceptance criteria

1. She can tell from the help and the docs which commands belong to the publisher and which to the verifier.
2. First contact refuses to add trust until she confirms, and tells her what to compare and with whom.
3. Before trust the verdict is `unverifiable`; after, `verified`; a tampered file gives `invalid` with a reason.
4. After the theft, the documented order of revoke and rotate is unambiguous, and each command prints what it changed.
5. Files signed with the stolen key after revocation are refused at the pharmacy, with the reason `revoked`.
6. A rotation signed by the revoked key does not carry the pharmacy to a new key automatically.
7. Every verdict sentence is fit to paste into an incident note: it says what was proven and what was not.
8. The whole incident takes under 30 minutes following only the product's own documentation.
