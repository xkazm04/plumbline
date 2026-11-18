---
name: Marta Hollis
role: Owner of Larch House, a nine-room guesthouse
segment: non-technical site owner (out of segment for the CLI; the person the product ultimately protects)
world: larch-house
journeys: [j1-price-changed]
references:
  - "Vendor guides put small-site upkeep at 1 to 3 hours a month and say content needs a monthly review (ueni.com, hookagency.com; vendor sources, rough benchmarks, read 2026-11-18)"
  - "Time figures below are the author's estimates for this fictional business, not measured"
---

# Marta Hollis

## Background and voice

Marta, 54, has run Larch House for eleven years with her partner. A freelancer, Jonas, rebuilt the site last spring
and added "the assistant", which answers guests' questions about rooms, rates and check-in. Jonas is paid by the hour
and answers e-mail within a few days. Marta edits prices herself through the page editor Jonas showed her; she has a
GitHub account because Jonas made her one and has logged in twice. She has never opened a terminal and will not.

She was burned once: a booking portal kept showing last season's rate for five weeks and she honoured it for three
couples. She speaks plainly, distrusts anything that needs a manual, and reads warnings as accusations unless they say
what to do. She says "the website", "the chat thing", "the price page". She does not know the words manifest, lock,
signature, hash, drift, peer or key, and should not have to.

## Job to be done

When something on my website changes, I want to know whether the assistant is now telling guests something untrue, so
I can fix it (or get Jonas to) before a guest books on the wrong price.

## What good looks like

- Someone or something tells me, in my words, "your rooms page now says 95, the assistant still says 89".
- I know what to do next without Jonas, or I know exactly what to forward to Jonas.
- It took me less time than checking the assistant by hand.
- I was never asked to install anything or type a command.

## Pet peeves

- Words I have to look up. A wall of letters and numbers.
- "Something changed" without saying what, or whether it matters.
- Being told to "run" something.
- Having to bring my own "API key" to ask a question.
- Red warnings that turn out to be nothing.

## Motivation (minutes)

Without the product: after each price change she opens the chat and asks it four or five questions to see what it
says: about 15 minutes, and she forgets most times. A missed stale price costs a refund or a honoured lower rate.
With the product, as she would accept it: under 3 minutes from being told to knowing what to do. Target saving: about
12 minutes per change, about eight changes a year, plus the avoided wrong-price booking, which is what she pays for.

## Senior-quality bar

As the owner she is the senior on what her guesthouse offers. A message that names the wrong thing, cannot say which
fact is stale, or tells her all is well when the price on the page and the price in the assistant differ fails the bar.

## Surface binding

Reachable for her: a web page (the Desk) on her phone or laptop; an e-mail or GitHub notification; a GitHub issue or
pull request page if she is sent a link, read-only in practice. NOT reachable: the CLI, a workflow file, a key file, a
JSON file, a model-provider key. Anything that requires those is unreachable for Marta and must be tagged so; whether
Jonas could do it for her is a separate question, and "needs Jonas every time" is itself a finding.

## Scored acceptance criteria

1. She can start with nothing but her website's address and get an answer about her site, with no install and no key.
2. Every word shown to her is one she uses, or is explained in one sentence where it appears.
3. When a page changed and the assistant states an old fact, she is told that this happened and which page it is about.
4. She is told what to do next, and the next step is one she can take or forward as it stands.
5. She is never shown a reassuring result for something that was not checked.
6. From notification to knowing what to do takes her under 3 minutes.
7. She would rather use this than ask the chat five questions by hand.
