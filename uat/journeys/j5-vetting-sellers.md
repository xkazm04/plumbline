---
id: j5-vetting-sellers
title: Vetting the sellers
character: tomasz-wieczorek
world: kiln-row
promotion: discovery
level: L1, L2
---

# Vetting the sellers

## Situation

Kiln Row's marketplace site hands shoppers to sellers' own agents. Four sellers are peers under this spec: one signs
and will rotate its key properly, one signs and will change signer without a rotation, one is unsigned, one is flaky.
A fifth, larger studio publishes an A2A Agent Card instead. Kiln Row already has a lock from an earlier setup that
did not include the Agent Card.

## Goal

Tomasz builds one inventory of everything the marketplace loads, keeps it current through a week of seller events, and
can state for each seller, from the product's output alone, what was pinned, what it is now, who signed it and what
policy action follows.

## Acts

- `onboarded`: the marketplace with an existing lock over the four peers; sellers in their starting states.
- `seller-rotates`: the first seller publishes a rotation and signs with the new key.
- `seller-signer-swapped`: the second seller's signature now carries a different key, with no rotation.
- `seller-offline`: the flaky seller stops answering.
- `seller-back`: the flaky seller answers again.
- `seller-back-changed`: the flaky seller comes back changed (an agent added) and signed under a key it never had.
  Added after run 2026-11-18-first-five (TOM-L1-03): is the change seen, with and without a relock during the outage?
- `card-skills-change`: the Agent Card gains a skill and changes another.
- `card-offline`: the Agent Card stops answering.
- `seller-signs`: the unsigned seller starts publishing a signature.

## Definition of done, in Tomasz's words

"One lock holds all five. I added the card to the lock we already had. Every event that week produced a different,
stable finding, and nothing unreachable was ever called clean or silently dropped. I followed the proper rotation with
adopt and the swapped signer stayed blocked. The JSON gave me every column of my inventory."

## What this journey must answer

- How the Agent Card is added to an existing lock, and what happens with the documented command.
- The finding, severity and exact sentence for each act; whether any two acts are indistinguishable.
- What happens to an unreachable peer and to an unreachable Agent Card on a relock (kept, pending, or dropped).
- Whether a proper rotation and a bare signer change are told apart at the watch, and what `adopt` needs.
- What "unsigned" reads as at the watch, at `verify`, and in the Desk's pre-load check.
- Whether `--json` output is documented and sufficient for an inventory with a closed list of reason codes.
- Whether counts in summaries have a clear unit (agents, skills, hosts).
