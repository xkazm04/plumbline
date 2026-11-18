---
name: Dev Okafor
role: Sole web developer at Meridian Trips, a twelve-person travel agency
segment: in-house developer who owns the site and its CI (the core user)
world: meridian-trips
journeys: [j2-partner-changed]
references:
  - "PCI DSS 6.4.3 and 11.6.1 made script inventory and change detection mandatory on 2025-03-31; guides call manual tracking unrealistic as a weekly task (barradvisory.com, pagecrawl.io, read 2026-11-18). The nearest established practice for 'a third party's code changed under my page'"
  - "Time figures below are the author's estimates, not measured"
---

# Dev Okafor

## Background and voice

Dev, 31, is the whole web team. They built Meridian's agentic site in a fortnight with the agentify skill and linked a
currency converter run by a small fintech, because writing one was not worth a sprint. Dev lives in a terminal, reads
`--help` before docs and docs before source, and pins every GitHub Action by SHA after a supply-chain scare at a
previous job, where a tag was moved under them. They answer to a managing director who asks one question: "is it fine?"

Dev is terse and exact. They respect a tool that says what it did not check, and drop a tool the second time it cries
wolf. They will read a JSON report but want the one-line answer first.

## Job to be done

When a partner I link to changes what it runs in my visitors' browsers, I want to know the same day what changed and
decide to accept it or cut it, so that I never ship someone else's surprise to my customers.

## What good looks like

- Setup is one command and one workflow file, in under ten minutes, with no key ceremony to start.
- The alert says what changed in terms I can reason about (agents, where it now talks to), not only "bytes differ".
- Accepting is a reviewable diff, and nothing is accepted without me.
- Cutting the partner is as clear as accepting it.
- The second alert on the same pull request works as well as the first.

## Pet peeves

- Tools that need a build from source to try. Unpinned anything.
- "Changed" with no what. A block I cannot inspect.
- An issue that reopens or duplicates. A bot that pushes to a branch and breaks on its second run.
- Being asked to trust a green tick for something that could not be reached.

## Motivation (minutes)

Without the product: nobody checks. Doing it by hand would be fetching the partner's definition weekly, diffing it
against a saved copy and reading the diff: about 25 minutes a week per partner, and it would lapse within a month.
With the product: 0 minutes in a quiet week; a changed partner is about 10 minutes from alert to decision.
Target saving: about 25 minutes a week per partner, and the real value is the change that would otherwise go unseen.

## Senior-quality bar

Dev would, by hand, produce a diff naming the agents added, removed and changed and every new host the partner now
calls. A report that tells them less than their own `diff` of two saved files fails the bar.

## Surface binding

CLI on their laptop; the repository's `.github/workflows`; GitHub issues and pull requests; the Desk for a quick look
at a site that is not theirs. All commands. No custody of anyone else's keys.

## Scored acceptance criteria

1. From a clean checkout of their site to a written lock and a watch workflow file takes one command each and under
   10 minutes, without creating a key.
2. A changed partner is reported as `block`, and the report states counts of what changed without quoting the partner.
3. They can see the actual difference between the old and new definition with a product command, not their own tooling.
4. Accepting the change produces a change list they can review before anything is locked or signed on their behalf.
5. Removing the partner instead is a documented path that leaves the watch clean.
6. A second drift while the first is still open updates the same issue or pull request and does not fail.
7. Whatever was unreachable is reported as not checked, never as clean.
8. Alert to decision takes under 10 minutes.
