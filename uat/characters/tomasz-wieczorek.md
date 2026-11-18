---
name: Tomasz Wieczorek
role: Platform engineer at Kiln Row, a marketplace where independent craft sellers plug in their own agents
segment: platform integrator consuming many third-party agent definitions, across more than one protocol
world: kiln-row
journeys: [j5-vetting-sellers]
references:
  - "A2A v1.0 Agent Cards are served from a well-known address and may carry JWS signatures (a2a spec; dev.to, tyk.io, read 2026-11-16)"
  - "Time figures below are the author's estimates, not measured"
---

# Tomasz Wieczorek

## Background and voice

Tomasz, 35, is one of four engineers at Kiln Row. Sellers, mostly one-person studios, each bring an agent that answers
questions about their work; Kiln Row's own assistant hands shoppers to them. Most sellers used the same generator; one
larger studio publishes an A2A Agent Card instead. Tomasz came from payments, where every third-party script on a
checkout page had to be inventoried and watched, and he assumes the same discipline will be asked of agents soon.

He thinks in inventories and states. He wants a table: every seller, what we pinned, what it is now, who signed it,
when we last looked. He is patient with a strict tool and impatient with an inconsistent one: the same situation must
produce the same words every time. He writes the internal policy, so he quotes tools' output in it.

## Job to be done

When I onboard sellers and every day after, I want an inventory of every agent definition our marketplace loads, with
its signer and its state, so that a changed, vanished or re-keyed seller is caught and handled by policy before a
shopper is handed to it.

## What good looks like

- One lock covering every seller, including the one that is not this spec's format.
- Each state is distinct and stable: changed, unreachable, never captured, signer changed, unsigned.
- An unsigned seller is "unverifiable", said plainly, and is not treated as bad or as good.
- A seller's proper key rotation looks different from a seller whose signer simply changed.
- The output is structured enough to feed our own dashboard.

## Pet peeves

- Two situations that produce the same message. One situation that produces two.
- Flags that silently do nothing. A lock that quietly drops an entry.
- JSON that is not a stable schema. Counts whose unit is unclear.
- A tool that calls an unreachable seller clean.

## Motivation (minutes)

Without the product: a script of his own that fetches each seller's file and compares a hash, plus manual triage when
it fires: about 40 minutes a week across sellers, and it says nothing about signers or what changed. With the product:
about 10 minutes a week. Target saving: about 30 minutes a week, plus signer and change detail his script lacks.

## Senior-quality bar

Tomasz would build an inventory with one row per seller and columns for pinned hash, current state, signer, last
checked, and a reason code from a closed list. Output he cannot map onto that table without guessing, or a state
vocabulary that is not closed, fails the bar.

## Surface binding

CLI in CI and on his laptop, always with `--json`; the lock file itself, which he reads; the Desk's pre-load check as
the thing shoppers' browsers would rely on. He holds Kiln Row's key and a trust file of sellers' keys. No seller keys.

## Scored acceptance criteria

1. One lock records every seller peer and the A2A Agent Card, and the command that adds each is documented.
2. Adding the Agent Card to a site that already has a lock either works or refuses with a reason; it never exits 0
   having done nothing.
3. Changed, unreachable, pending, signer-changed and unsigned each produce a distinct, stable finding.
4. An unreachable seller is never reported as clean, and is never dropped from the lock without a line saying so.
5. A seller who rotated keys properly can be followed with `adopt`; a seller whose signer just changed is a `block`.
6. An unsigned seller reads `unverifiable` wherever a verdict is shown, including the Desk's pre-load check.
7. The `--json` output of each command has documented fields and is enough to build his inventory table.
8. The weekly review of all sellers takes under 10 minutes.
