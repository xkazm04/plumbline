---
id: j1-price-changed
title: The price changed and the assistant still says the old one
character: marta-hollis
world: larch-house
promotion: discovery
level: L1, L2
---

# The price changed

## Situation

Larch House's site was set up by Jonas, the freelancer: an agentic site whose assistant states room rates, check-in
time and the breakfast price, all taken from the rooms page. Jonas ran the setup once (a lock that names the rooms page
as a source, a daily watch in the repository) and moved on. The site links one partner, a bike-rental shop.

On Monday Marta raises the double room from 89 to 95 in the page editor. The assistant's definition still says 89.

## Goal

Marta finds out that the assistant is now quoting a price her page no longer shows, understands which page and that it
matters, and either fixes it or sends Jonas something he can act on without a call. She does this as herself.

## Acts (events the world can play)

- `setup`: the site as Jonas left it: locked with the rooms page as a source, signed, watch workflow present.
- `raise-price`: the rooms page changes 89 to 95; the network still says 89.
- `fix-network`: the network is corrected to 95 (what Jonas would do).
- `cosmetic-edit`: the rooms page changes wording only; every stated fact is still on it.

## Definition of done, in Marta's words

"I knew within a few minutes of changing the price that the chat thing was out of date, I knew it was the rooms page,
and I either sorted it or sent Jonas one message he understood. Nobody asked me to type commands."

## What this journey must answer

- Through which surface, if any, does the news reach Marta at all? (An issue in a repository she never opens?)
- Can she, with only her site's address, get the answer from the Desk? Does that need a model key?
- Does the watch tell a fact that is gone from the page (`raise-price`) apart from an edit that changed nothing she
  states (`cosmetic-edit`), in words she understands?
- After `fix-network`, what has to happen before the alert goes away, and who can do it? (Relock, sign, the key.)
- The same journey as Jonas would walk it is NOT this journey; note where Marta needs Jonas, every time she does.

HYPOTHESIS, from the product owner, to verify independently and contradict if the product says otherwise: a
non-technical owner cannot onboard to or operate this product today, and the onboarding and use experience may need
to be led by an assistant or guided in the page. Do not assume it; find out where exactly she stops, and why.
