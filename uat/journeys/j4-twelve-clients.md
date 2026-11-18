---
id: j4-twelve-clients
title: Twelve client sites
character: priya-raman
world: tallow-finch
promotion: discovery
level: L1, L2
---

# Twelve client sites

## Situation

Tallow & Finch maintain twelve agentic client sites. Priya has twenty minutes to decide whether Plumbline goes into
the agency's pipeline. One client is about to launch with a defect nobody has noticed; the other eleven are live in a
mix of states.

## Goal

Priya gets a first real result fast, sees the gate stop the defective launch for the right reason, gets one report
across all twelve that a junior can act on, and leaves with something a client could be shown.

## Acts

- `portfolio`: twelve sites: healthy and signed; healthy and unsigned; a manifest whose front agent does not match its
  network; a network with a repeated key that changes an agent's instructions; a missing network file; an expired
  signature; a tampered signed file; a published lock with drift; no lock; a site that answers slowly; a site that is
  down; a site whose manifest is not JSON.
- `fix-launch`: the defective launch site is corrected.

## Definition of done, in Priya's words

"I had a result on one site inside twenty minutes without asking anyone. The gate went red on the launch site and
told my junior which rule and roughly where. It did not go red on healthy sites just because someone else's checker
could not see them. One command gave me all twelve, worst first, and I could tell our defects from other people's
outages. There is a badge I would put on a client's site."

## What this journey must answer

- The honest time and step count from README to first result, including the build from source.
- For each of the twelve states, what the gate and the scan say, and whether a junior could act on the sentence.
- What the gate's exit code is when the two public checkers cannot see the site, under both `--fail-on` values, and
  whether that makes the gate usable as a deploy check for a site that is not public yet.
- Whether the scan report sorts or groups by what needs attention and separates own defects from unavailable checkers.
- Whether the badge's wording is safe to show a client, and what it shows for "not checked".
- What is sent to third parties during a gate or a scan, and whether the documentation says so where she would look.
- What she would have to tell a client the product does NOT do.
