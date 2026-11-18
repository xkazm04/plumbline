---
name: Priya Raman
role: Technical director of Tallow & Finch, a web agency with twelve agentic client sites
segment: the buyer (external prospect deciding whether to adopt across a portfolio)
world: tallow-finch
journeys: [j4-twelve-clients]
references:
  - "Freelancer and agency maintenance retainers run roughly 100 to 1,500 USD a month per site (ueni.com, expertmarket.com; vendor sources, rough benchmarks, read 2026-11-18). A portfolio check has to fit inside that margin"
  - "Time figures below are the author's estimates, not measured"
---

# Priya Raman

## Background and voice

Priya, 39, runs delivery for an agency of fourteen. They sold twelve clients an "assistant on your site" package this
year and now carry twelve maintenance retainers. She has evaluated a tool a month for a decade and gives each one
twenty minutes: install, run it on one real site, look at the output, decide. She is technical enough to read the
code and too busy to. She buys on three things: does it fit the deploy pipeline, can a junior run it, and can she
show a client something that makes the retainer look earned.

She is direct and commercial. She asks "who maintains this?" and "what happens when your checker is down?" early.

## Job to be done

Before a client site goes live and every week after, I want one pass that tells me which of my twelve sites are
broken, stale or changed, so that a junior can act on it and I can show each client a status they understand.

## What good looks like

- Twenty minutes from first reading to a result on a real site.
- One command over a list of sites, one report I can sort by "needs attention".
- The deploy gate fails for a real defect and says which rule, and does not fail because a third party was down.
- Something client-facing: a badge or a page that is honest and not alarming.
- Clear answer on licence, maintenance and what it costs me in CI minutes.

## Pet peeves

- No package to install. Build steps before first value.
- A gate that goes red for reasons outside my control. Flaky third-party dependencies.
- Reports that need the author to interpret. Jargon in anything a client sees.
- Tools that quietly send my clients' addresses somewhere.

## Motivation (minutes)

Without the product: a junior opens each site and its assistant by hand once a month: about 10 minutes a site, 120
minutes a pass, and it finds only what is visible. With the product: one scan of twelve sites and reading the report:
about 15 minutes. Target saving: about 105 minutes a pass, weekly instead of monthly, plus defects the eye misses.

## Senior-quality bar

Priya's own portfolio report would list every site with one status word, the reason, the owner of the next action and
the date checked, sorted worst first, and would separate "we broke it" from "someone else's service was down". A
report that mixes those, or that a client could misread as "your site is unsafe", fails the bar.

## Surface binding

CLI on her laptop for the evaluation; the Action in clients' repositories; the scan script and its HTML report; the
badge on a client's site. She does not sign on clients' behalf in this journey and holds no client keys.

## Scored acceptance criteria

1. From the README alone she reaches a first real result on one site in under 20 minutes.
2. The gate fails a site with a real defect, names the rule in words a junior can act on, and exits non-zero.
3. The gate does not fail a healthy site because Agent Atlas or Agent Customs could not be reached, and says they were
   not reached.
4. One command checks all twelve sites and produces one report sorted or sortable by what needs attention.
5. The report separates the site's own defects from checkers that were unavailable.
6. A badge exists that a client could show, with a state in words and a date, and never shows a pass for "not checked".
7. She can find, in the documentation, what is sent to third parties and what the licence is.
8. A junior could run the weekly pass from a written procedure of ten lines or fewer.
