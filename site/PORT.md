# The Desk's structure: "The Fix" (contest B/3)

The owner chose B/3 on 2026-11-17:

> "Lets go with B/3, all variants have weakness they try to express too much info in their pages instead of splitting
> the content. The visual design is often not balanced, creativity winning over practical use. B/3 seems like a variant
> we can work with the best"

So the Desk is **balanced and practical, with its content split into focused views**. Each view below has one job. When
a change adds something to a view, it goes in the view whose job it is, or into a new view; it never goes onto the
overview. The winner is `.contest/arena/plumbline-desk/entries/claude-claude-sonnet-5-5_max/variant-3/`. Its look is
ported (`fix.css`, `art.js`); its behaviour is not: every tool is the live Desk's (`desk.js` and the core in
`lib/plumbline/`), and the winner's demo crypto and staged verdicts are not used.

## The views

One view shows at a time, chosen by the address hash. `shell.js` switches them and draws their art; `desk.js` runs the
tools. The keys 1 to 5 open the ports and Escape goes back to the overview (not while typing, and not in the
assistant).

| View | Hash | Shows | Deliberately does not show |
| --- | --- | --- | --- |
| Overview | `#/` | The title; the compass card with the five ports on its bezel and, inside it, the fix of one gate run with its calm verdict card; the five ports as a list; the sites checked (at most three); the two peer ports and their reachability check. | No tool form and no tool result. No about text, no CLI, no verdict legend. Example runs are labelled "example" on the card and on the list, with a note saying when and how they were captured; a gate run on this page takes an example's place. |
| 1. Check a site | `#/check` | The fix of the last gate run you made here (rings that cross for pass, miss for fail, a dotted unfinished ring for unavailable), its verdict card and a labelled badge per checker; the address form; the three checkers' sentences; how to read the fix. | No example runs (only what you ran), no other tool. |
| 2. Read drift | `#/drift` | The plotted course of the last reading (the vector shows the worst severity, labelled as stylised); the address form; the lock and its findings by kind. | No staged or illustrative courses. |
| 3. Verify a signature | `#/verify` | The papers: the last signature read (its key id, origin and files, a stamp and a seal of the verdict) and your register of trusted publishers with Forget, with the trust file under it (Export `plumbline.trust.json`, Import one, listed and confirmed by a button); the address form; the verdict, its meaning, the revocation and first contact (Trust verifies again at once); the three verdicts explained. | No staged papers, no signing. |
| 4. Make a publisher key | `#/key` | The die and the seal of the key you made (or a blank die); Generate and Discard; the two downloads (the private key's link gives way to a sentence a moment after it is used); key custody; Revoke a leaked key (pick its private key file, download `plumbline-revocation.json`). | No CLI commands (they are in About), no signing. |
| 5. Sign a site's files | `#/sign` | The manifest: every file the signature will cover with its SHA-256; the files, the key file, the origin and the lifetime, in that order; Sign (which opens the confirmation that lists every file and its SHA-256) and Clear; the download. | No verification of what you signed (that is the Verify view's job), no signature JSON. |
| About | `#/about` | What Plumbline is (sign, gate, watch, and what the Desk does), the repository link, how to publish with the CLI (keygen, the lock, then sign), the licence. | No tool. It is not a port, so it is linked from the title, not from the compass. |
| Assistant | the Assistant button | The vendored runtime's chat, agents and settings, in a panel over the current view; what the assistant can do and where your messages go; the "remember my AI provider key" box. After Save and start reloads the page, the panel opens again by itself. | No list of the tools (the ports are the list), no tool forms. Escape or Close returns to the view underneath. |

## Where this goes further than the winner

- **States the winner never designed.** A drift reading that read no lock (absent, refused or unusable) plots no course
  and says so, instead of the calm course of a clean reading; a refused verify replaces the papers and the verdict with
  the refusal. What the Desk will not do here (inside another site's frame, or in a browser without Ed25519) is one notice
  fixed at the foot of the window, so no view's layout moves.

- **About is its own view.** The live Desk's long page led with "What Plumbline is", "Three verdicts, never two" and
  "Publish a signature and a lock". The winner had no place for them. Putting them on the overview would crowd it, so
  the first and third became the About view and the second sits in the Verify view, where a verdict is read.
- **The key view leaves the CLI out.** The winner showed CLI commands under the key. They moved to About, so the key view
  is the key and its custody only.
- **The sign view leaves verification out.** The winner's sign view also printed the signature JSON and verified it in
  place ("Verify what you just signed", "Change one byte"). Here signing offers the download, and verifying is the
  Verify view's job, on the published files, against your own trust list.
- **The assistant panel holds only the assistant.** The winner's dock repeated the five tools as a run list and showed
  colour swatches. Both are gone; the ports are the run list.
- **The sites checked stay at three.** Live runs push the examples out, so the list never grows into the peer ports.
- **On a phone, the tool comes first.** In each port view the form and the result come before the drawing.

## Where this departs from the winner, and why

- **No arrival animation.** The winner's 2.9-second intro (the chart inking in, a "Skip intro" button) is dropped as
  decoration with a cost; the rings still grow when a site is chosen and the seal still presses when a key is made.
- **No per-checker log page** (`#/check/1/atlas`). A checker's sentence shows in the verdict card when you hover or
  focus its badge, and all three are in the panel.
- **Labelled rings on a phone.** At 390 px the winner hid the ring labels; here each ring keeps a compact badge (its
  shape, a short name and the state word, all 12 px or larger).
- **Real data only.** Verify's nine staged papers, drift's captured courses and the illustration are not ported. The
  three captured gate reports are kept as labelled examples on the overview (`examples.js`).
- **Links, not buttons, for navigation.** The ports, the port list and the strip are links to their hash, so they work
  with the keyboard, open in a new tab and show in the history.

## The style contract

`tests/port/` holds the winner's measured contract: `roles.json` (the overview, at load) and `roles-view.json` (the
Check a site view, after one click; one check run sees one view). Each role maps a winner selector to a `data-role`
hook here. To check the served Desk against it (Playwright for Python):

```shell
python <ai-registry>/skills/contest/scripts/style-contract.py check http://127.0.0.1:<port>/ site/tests/port/roles.json site/tests/port/contract.json
python <ai-registry>/skills/contest/scripts/style-contract.py check http://127.0.0.1:<port>/ site/tests/port/roles-view.json site/tests/port/contract-view.json --drive "click:[data-role=port-item][data-tool=check]" --drive wait:1500
```

Both read 0 deviations on 2026-11-17 at 1440x900. Never widen a tolerance to pass: fix the port, or the selector when the
two sides name different elements for the same idea.
