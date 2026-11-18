---
id: j2-partner-changed
title: The partner changed overnight
character: dev-okafor
world: meridian-trips
promotion: discovery
level: L1, L2
---

# The partner changed overnight

## Situation

Meridian Trips' agentic site links a currency converter run by another company. Dev has a fresh checkout of the site
and has never used Plumbline. A week after Dev sets it up, the converter's definition gains an agent and starts calling
a host it did not call before. Later it also starts serving a `links.json` it never had. Then it changes again while
Dev's first alert is still open.

## Goal

Dev sets up the watch from nothing, is alerted the day the partner changes, sees what changed, and decides: accept and
re-lock through a reviewable change, or remove the partner. The second change is handled as smoothly as the first.

## Acts

- `fresh`: the site with no lock, no key, no workflow; the partner serving its original definition.
- `partner-adds-agent`: the partner's definition gains one agent and one new outbound host.
- `partner-adds-links`: the partner starts serving a `links.json`.
- `partner-changes-again`: a second change to the partner while the first is unaccepted.
- `partner-changes-fee`: the partner changes code again while every outline count stays the same (a fee edit inside
  the added agent). Added after run 2026-11-18-first-five (DEV-L1-06): is the open issue or pull request updated?
- `partner-reformats`: the partner re-serialises its file with no change to any agent.
- `partner-down`: the partner stops answering.

## Definition of done, in Dev's words

"One command to lock, one file to schedule it. The alert told me an agent was added and a new host appeared. I looked
at the real diff with the tool, accepted it through a pull request I reviewed, and the second change updated that same
pull request. When I chose to drop the partner instead, the watch went clean."

## What this journey must answer

- Time and steps from a fresh checkout to a lock and a workflow file. Is there any install friction first?
- What the alert says for each act, and whether each is told apart from the others.
- Whether Dev can see the actual old-versus-new difference with a product command, given the lock holds only hashes.
- The accept path end to end against a real git remote: branch, pull request plan, the SECOND run on an existing branch.
- Whether anything is signed or locked on Dev's behalf before Dev reviews it.
- The remove path: what Dev edits, what the watch then says.
- What the Desk's pre-load check shows for the changed partner.
