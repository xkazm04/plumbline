# Run 2026-11-18-first-five: synthesis

Five Characters, one journey each, L1 over the code then L2 live against fixture worlds. Code under test: `47ea482`
(2026-11-18 10:30 +0100), `dist/` and `site/lib/plumbline/` rebuilt at 11:25 by every L2 walker. Registry: declared
(`../ai-registry`, bundle `software-engineering`), mapped (`.ai/registry-map.json`). Inputs read for this synthesis: the
five per-Character reports end to end (both voices of each), `findings.json` (118 rows before this sweep, 131 after),
the L2 journals and the stored evidence they cite, the overlay, `docs/roadmap.md`, and the code review of the same
commits (2026-11-18). The drain that follows is `docs/product/uat-insights/2026-11-18-first-five.md`; the backlog is
`docs/BACKLOG.md`.

## Scorecard

No journey earned L1 certification ("structurally sound" needs `L1-pass`); all five were `L1-conditional`, so every
one went on to L2 with its majors carried. None earned L2.

| Journey | Character | L1 verdict | L1 criteria | L2 verdict | L2 criteria | Time saved: target / L1 claimed / L2 measured (confidence) | Grounding (Desk assistant) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| J1 the price changed | Marta Hollis, guesthouse owner | conditional | 2 of 7 | **fail** (a blocker) | 1 of 7 | 12 min a change / ~7 (low) / **none, worse than none** on her page; ~7 on a price-first layout (medium) | 5/6 shared; Marta's additions 0/2 (L1 and live) |
| J2 the partner changed | Dev Okafor, sole web developer | conditional | 5 of 8 | conditional | 5 of 8 | 25 min a week per partner / ~20 (medium-low) / **15 to 18** (medium); a second drift costs 15 to 30 | n/a |
| J3 the stolen key | Ines Baptista, IT contractor | conditional | 6 of 8 | conditional | 6 of 8 | 60 min an incident / ~65 (medium) / **~65** in the documented order (medium), ~40 in the other order | n/a |
| J4 twelve client sites | Priya Raman, agency buyer | conditional | 6 of 8 | conditional | 5 of 8 | 105 min a pass / ~95 (medium) / **~95** (medium); 20 to 25 min a pass against her 15 | n/a |
| J5 vetting the sellers | Tomasz Wieczorek, platform engineer | conditional | 1 of 8 | **fail** | 1 of 8 | 30 min a week / ~20 blended (low-medium) / **~17 blended**; the event week is **5 min slower** than his own script (medium) | n/a |

Findings: 118 rows from the walkers (1 blocker, 38 major, 43 minor, 11 polish, 25 strengths) plus 13 reconciliation
rows below. Of the 71 L1 gaps, L2 confirmed 68 and left 3 uncertain (each needs real GitHub or is off the bound path);
none was refuted. Of the 24 L1 strengths, 22 were confirmed, 1 is uncertain (not re-run) and **1 was refuted**
(MAR-L1-15, "the watch tells a price change from a wording change", false on the guesthouse's real page). L2 added 23
rows, 22 of them gaps. Uncertain at the end: MAR-L1-08, DEV-L1-07 (both need a real GitHub repository), INE-L1-17 (off
the bound path), TOM-L2-06 (needs https sellers), TOM-L1-S6 (not re-run). Severity labels were derived by each walker
with slightly different thresholds (INE-L1-07 and PRI-L1-13 rank 18 and are labelled minor); the backlog ranks by the
number, not the label.

## Cross-cutting themes

Deduplicated across Characters. Each theme cites every finding it rests on.

**T1. The product's last sentence is greener than what it knows, exactly where a person decides.** The machinery is
honest; the sentence a person acts on is not. The watch tells the owner "all 5 facts the network states from it are
still on it" after her price changed, because the price was never watched (MAR-L2-01, MAR-L2-02, MAR-L1-03, REC-9; the
L1 strength MAR-L1-15 refuted). After the right fix the sentence stays wrong and the alert gets louder (MAR-L1-02). A
clean close follows an accept that silenced the stale fact or a merge that broke the signature (MAR-L1-01, MAR-L2-03,
REC-7). The gate, scan, badge, Action summary and Desk say "unavailable (not checked)" of a site that was checked and
passed (PRI-L1-01, PRI-L1-02, PRI-L2-2, REC-1). The badge draws green over a tampered signature (PRI-L1-09, PRI-L1-14,
REC-5). The Desk calls a signed lock "unsigned" (MAR-L1-10, TOM-L2-04, REC-4) and greets a forged copy with "you have not
met this signer yet ... the files may be fine" (INE-L2-1) or offers first contact to a swapped signer while the old key
sits in the trust list (TOM-L2-03, REC-11). The CLI calls a key its own trust file records as revoked "unknown"
(INE-L1-03, REC-6), prints "verified kid=<stolen kid>" (INE-L1-07) and "revoked by its holder" of keys nobody revoked
(INE-L1-01). A line-endings difference reads "the agent now answers from different facts" (DEV-L2-1). A keyless site is
told its signature will read tampered (DEV-L1-04).

**T2. "Accept" is one blunt instrument that can also forget.** The only accept is `--relock`, which re-captures
everything reachable at once and reads no trust file: accepting one seller's rotation pins another seller's swapped
signer, three times in one week (TOM-L1-01, TOM-L2-02); a relock during an outage replaces a pin with "pending" and the
PR calls that "accept the drift" (DEV-L1-05, TOM-L1-03); a card down at a relock leaves the lock for good (TOM-L1-04); the
real CLI's relock with no reachable seller wiped every pin and the card, exit 0 (TOM-L2-01); a signature unreadable at
capture is locked as "unsigned" (TOM-L1-08); a relock over a stale price drops its anchor (MAR-L1-01). The cut path is
offered nowhere (DEV-L2-3). REC-8 traces the word across surfaces.

**T3. The alert loop goes red or silent at the second event.** The relock PR's push is rejected (`stale info`) on every
run after its branch exists, and after any merge whose branch was kept (DEV-L1-01, MAR-L1-13; the code review; reproduced
again by the drain's tracked runner). A second change, a `links.json`, a cosmetic-then-real edit or a same-count change
edits the issue silently or changes nothing at all (DEV-L1-02, MAR-L1-04, DEV-L1-06). A keyless publisher can merge only
by marking the draft ready, which makes every later run red (DEV-L1-04).

**T4. "Changed" without enough "what" for a senior.** No product path to the old partner definition (DEV-L1-03), the
hosts a `links.json` adds are not counted (DEV-L1-10), the stale fact is not named (MAR-L1-05), the tampered file is not
named (INE-L1-08), the duplicate key's file is not named (PRI-L1-12), and the JSON has no reason codes, no timestamps and
polymorphic fields (TOM-L1-07, TOM-L1-13, DEV-L1-11, REC-10).

**T5. Addresses go to a third party without a word, even ones Plumbline refuses itself.** The gate sends any target to
Agent Atlas, including http, private-range and unresolvable staging names it will not read itself (PRI-L1-04); the
Desk's check view does it from the browser with no sentence on the page (PRI-L2-1); the scan has no way to leave Atlas
out. The scan's own up-front disclosure is a strength (PRI-L1-S2). The overlay had the same defect (see the drain's
methodology section).

**T6. Two surfaces, two answers.** Where the CLI and the Desk differ on the same trust list, the Desk is right every
time (INE-L1-03, INE-L1-04, INE-L1-10, TOM-L1-06; INE-L2-4 as the strength). Where they agree, both can be wrong in the
same words (INE-L1-01, TOM-L2-03).

**T7. Nobody can rehearse before production.** `init`, `watch --root`, `--external` and the scan refuse every loopback or
staging address; `gate` and `verify` take `--allow-local` and the watch does not (DEV-L1-08, TOM-L1-11, TOM-L2-06,
PRI-L1-06, PRI-L1-11). Every peer verdict in this run was measured through the test harness, which is itself the
finding.

**T8. Getting in: no help, no roles, a README that sends you to the wrong folder.** `--help` is an unknown command
everywhere (DEV-L1-09, INE-L1-06, PRI-L1-15); publisher and verifier commands cannot be told apart (INE-L1-06); the
README's "from your site's root" runs a path that exists only in the clone, and taken literally inside the clone it
"initialises" Plumbline's own Desk (PRI-L1-13, DEV-L1-09); the scan is a script called "ecosystem" (PRI-L1-11); the PR
loop's GitHub settings are not named (DEV-L1-07); a clean watch prints a rate-limit line with a raw epoch and no "clean"
(PRI-L2-4, DEV-L2-2); the CRLF rule lives three sentences deep in one document (DEV-L2-1).

**T9. A non-technical owner has no surface of her own.** She is reached, if at all, by a GitHub notification titled
"Plumbline drift" up to a day late (MAR-L1-08); the issue speaks 23 terms she does not use and tells her to "run" a
command "in a clone" (MAR-L1-06); nothing leads her to the Desk or carries her address there (MAR-L1-11); the Desk lands
on another site's green "Passed" in a nautical vocabulary (MAR-L2-05); the assistant asks for an API key first
(MAR-L1-12); every wording edit costs a paid developer cycle (MAR-L1-07). Her decisive stop is not here but in T1.

**T10. The bad-day procedure is documented right and enforced nowhere.** Rotating before revoking burns the new key, and
no command says so (INE-L1-02); the DNS record is in no revocation step, and the `dns` command's "publish one record per
key" keeps DNS vouching for the stolen key (INE-L1-05); revoke has no word of finality (INE-L1-13); a verifier has no
command for an e-mailed revocation (INE-L1-14); adopt accepts a forked second successor (INE-L2-2); export-jws signs with
a revoked key (INE-L1-16).

## Reconciliation sweep

Eleven shared concepts were traced across every surface that states them; two agreements are recorded as strengths. The
full rows are in the block below and in `reconciliation--sweep.md` (the file the collector reads).

| Concept | Surfaces traced | Agree | Mismatch | Row |
| --- | --- | --- | --- | --- |
| The word for "a checker could not answer" | gate CLI, stderr, Action summary, scan, badge, Desk check | exit codes | partly checked and nothing checked fold on five surfaces | REC-1 |
| A peer the watch did not check | watch --root, harness, watch --url, Desk, pending line, relock | never green on the day | five sentences; one cause, two sentences; pin lost = never captured | REC-2 |
| A site with no signature | verify, trust --url, Desk verify, pre-load, scan, watch, lock | Desk and pre-load | an I/O error with exit 2; silence; a missing key also written for read errors | REC-3 |
| "Signed / unsigned" | Desk drift label, Desk verify, relock reminder, issue, PR | none | untrusted = "unsigned"; an unsigned site told it will read tampered | REC-4 |
| One broken signature | verify, scan, gate, Action, badge | verify (CLI = Desk) | a content warning in the scan, healthy at the gate, green on the badge | REC-5 |
| A revoked key | CLI verify, adopt, trust; Desk | 12 of 15 cases | 3 cases, the Desk right each time; "verified kid=<revoked>"; cascade wording on both | REC-6 |
| "Clean" | watch, issue close, PR close, scan, Desk | "clean is not safe" everywhere | clean after the lock was emptied or the signature broken | REC-7 |
| "Accept" | issue, PR, relock, --drop, adopt, trust | "nothing accepted until a person merges" | accepts everything reachable; adopt and relock ignore each other | REC-8 |
| The grounding count's unit | watch, issue, PR, Desk, tool result, init, scan | the same count everywhere | it counts anchored facts and calls them "facts the network states" | REC-9 |
| The date of a check | gate report, badge, watch report, lock, upstream line, trust file | none | badge dated when drawn; raw epoch; a cascaded revokedAt predates the adoption | REC-10 |
| A signer change | watch, verify text and JSON, Desk verify, adopt, relock | adopt | rotation = swap = stranger on four surfaces | REC-11 |
| The third state on the day | watch, Desk, issue, PR, scan, badge, gate exit | all | (ceiling: a later relock) | REC-12, strength |
| What changed in a peer | watch, issue, PR, Desk, diff | all, in units | (ceiling: prose only, no old copy) | REC-13, strength |

## Findings (reconciliation)

The same rows as `reconciliation--sweep.md`, which is the file `collect-findings.mjs` reads (its pattern takes only
`<x>--<y>.md` files).

```json
[
  {
    "id": "REC-1",
    "journey": "reconciliation",
    "character": "reconciliation",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "The gate's 'not checked' word: partly checked and nothing checked read the same on five of six surfaces",
    "concept": "the word shown when a checker could not answer",
    "surfaces": ["gate CLI headline and exit", "gate CLI stderr", "Action job summary", "scan table and summary", "badge", "Desk check view"],
    "expected": "One projection of one state: 'checked by N of 3, the rest named as not reached' when some adapter answered; 'nothing was checked, this is not a pass' only when none did; the site's own unreachability named apart from a third party's missing verdict.",
    "got": "Agree: the exit code (gate-command.ts:28-41) separates the two under --fail-on fail. Mismatch: the CLI headline says 'gate unavailable' for both and only stderr says 'nothing was checked' (none); the Action summary reads '### Plumbline gate: unavailable' for a red nothing-checked job and a green partly-checked one; the scan writes 'unavailable (not checked)' for six validator-passed sites and for the down and slow ones; the badge draws byte-identical 'not checked' for healthy, down and tampered; the Desk card says 'No checker failed, but at least one could not answer' for a healthy site and for a site where none answered.",
    "evidence": ["src/gate/context.ts:37-44", "src/cli/gate-command.ts:28-41", "src/scan/report.ts:109-121", "action/report.mjs:115-119", "src/cli/badge-command.ts:19-25", "PRI-L1-01", "PRI-L1-02", "PRI-L1-09", "PRI-L2-2", "shots/priya/pri-l2-desk-check-healthy-laptop.png", "shots/priya/pri-l2-desk-check-down-laptop.png", "shots/priya/badges/*.svg"],
    "related": ["PRI-L1-01", "PRI-L1-02", "PRI-L1-09", "PRI-L2-2", "PRI-L2-3"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open"
  },
  {
    "id": "REC-2",
    "journey": "reconciliation",
    "character": "reconciliation",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "A peer that was not checked has five sentences, and one situation (refused by the https rule) has two",
    "concept": "a peer or card the watch did not check",
    "surfaces": ["watch --root (CLI)", "watch --root (harness, a real outage)", "watch --url (CLI)", "Desk drift view", "pending line on every later watch", "relock while a card is down"],
    "expected": "One closed set: refused by the address rule, could not be reached (with the cause), never captured, pin kept but not re-read, dropped on purpose. Each surface uses the same words for the same cause.",
    "got": "Agree: none is ever green on the day (TOM-L1-S1, DEV-L1-S1). Mismatch: a peer refused by the https rule reads 'could not be reached (the address is not https)' in watch --root (the outage template) and 'was not contacted: it is not an https address' in watch --url and the Desk; the pending line drops the capture reason and says 'once it answers' of sellers that answer; a pin lost to a relock during an outage reads exactly like 'never captured at init'; a card that was down at a relock reads 'could not be locked ... so it is not in the lock' once, inside an exit-0 command, and then nothing at all.",
    "evidence": ["src/watch/decide.ts:237-238", "src/watch/decide.ts:327", "src/watch/decide.ts:446-447", "src/watch/capture.ts:157-176", "TOM-L2-05", "TOM-L1-04", "TOM-L1-03", "shots/tomasz/l2-transcripts/00-watch.json", "shots/tomasz/l2-transcripts/21-watch-url.json", "shots/tomasz/l2-transcripts/16-after-card-dropped.json"],
    "related": ["TOM-L2-05", "TOM-L1-03", "TOM-L1-04", "DEV-L1-05", "DEV-L1-08"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "open"
  },
  {
    "id": "REC-3",
    "journey": "reconciliation",
    "character": "reconciliation",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "One unsigned site, six readings: an I/O error, unverifiable twice, 'not published', silence, and a missing key",
    "concept": "the verdict for a site that publishes no signature",
    "surfaces": ["verify (CLI)", "trust --url (CLI)", "Desk #/verify", "pre-load check", "scan", "watch", "the lock"],
    "expected": "`unverifiable` with one sentence ('publishes no signature') and one exit-code meaning wherever a verdict is shown; a lock that records 'unsigned when locked' as a state, distinct from 'the signature could not be read at capture'.",
    "got": "verify --url: 'plumbline.signature.json not found', exit 2, {\"error\"} (the usage-or-I/O code). trust --url: '.well-known/plumbline-key.json not found', exit 2. Desk: 'UNVERIFIABLE ... This site publishes no plumbline.signature.json'. Pre-load: unverifiable, 'The peer publishes no signature'. Scan: 'not published'. Watch: no line. Lock: no kid, which is also what a 500 or 404 on the signature at capture writes.",
    "evidence": ["src/cli/commands.ts:531-533", "src/browser/preload.ts:82", "site/desk.js:687", "src/watch/decide.ts:283-298", "src/watch/capture.ts:150-153", "TOM-L1-06", "TOM-L1-08", "shots/tomasz/l2-transcripts/21-verify-4503.json", "shots/tomasz/tom-l2-desk-verify-4503.png"],
    "related": ["TOM-L1-06", "TOM-L1-08", "TOM-L1-S5"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open"
  },
  {
    "id": "REC-4",
    "journey": "reconciliation",
    "character": "reconciliation",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "'Signed' and 'unsigned' mean different things on the Desk's drift label, the relock reminder and the PR body",
    "concept": "whether a site or its lock is signed",
    "surfaces": ["Desk drift lock label", "Desk #/verify", "CLI relock reminder", "drift issue next step", "relock PR body and draft flag"],
    "expected": "'Unsigned' is said only of a site with no signature; a signed lock whose signer the visitor has not trusted reads 'signed by a key you have not trusted' (unverifiable); a site with no signature is never told its signature will read tampered.",
    "got": "The Desk's drift label says 'unsigned lock: the host can rewrite it' for Larch House's and Kiln Row's SIGNED locks until the visitor trusts the signer in that browser (verify on the same page says unverifiable); the control arm with the key trusted reads 'Signed lock'. The CLI relock, the issue and the PR tell Meridian's never-signed site that its signature will read 'invalid (tampered)' and keep the PR a draft for a key ceremony the README said was not needed.",
    "evidence": ["site/desk.js:580-584", "src/watch/decide.ts:493", "action/report.mjs:145-148", "action/report.mjs:273-277", "MAR-L1-10", "TOM-L2-04", "DEV-L1-04", "shots/marta/l2-03-setup-drift-read.png", "shots/marta/l2-13-raise-drift-after-trust.png", "shots/tomasz/tom-l2-desk-drift-kilnrow-trusted.png", "shots/dev/ci-r1-adds-agent.txt"],
    "related": ["MAR-L1-10", "TOM-L2-04", "DEV-L1-04"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open"
  },
  {
    "id": "REC-5",
    "journey": "reconciliation",
    "character": "reconciliation",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "A tampered signed site is 'invalid tampered' at verify, an ordinary content warning in the scan, a healthy site at the gate and the Action, and a green badge",
    "concept": "the verdict for one broken signature across verify, scan, gate, Action summary and badge",
    "surfaces": ["verify (CLI and Desk)", "scan", "gate (CLI)", "Action job summary", "badge"],
    "expected": "Every surface that shows a status for a signed site either carries the signature verdict or says plainly that it did not check signatures; no surface shows a pass beside a signature it did not check.",
    "got": "verify: 'invalid tampered' (glenrock-gym) and 'invalid expired' (fernhill-hotel). Scan: 'published (unverifiable here)' plus drift warn 'the agent now answers from different facts', the same shape as a legitimately fixed site; expiry is caught (drift block). Gate and Action: validator pass, '### Plumbline gate: unavailable', the healthy site's summary. Badge with --adapters validator, the only way to a green badge: green 'pass' for both broken sites.",
    "evidence": ["src/gate/run.ts:45-49", "src/scan/run.ts:126", "src/cli/badge-command.ts:19-25", "PRI-L1-05", "PRI-L1-14", "PRI-L1-09", "shots/priya/badges/4405-validator.svg", "shots/priya/badges/4406-validator.svg", "shots/priya/scan-after/report.json"],
    "related": ["PRI-L1-05", "PRI-L1-14", "PRI-L1-09", "PRI-L2-3"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "resolution": "open"
  },
  {
    "id": "REC-6",
    "journey": "reconciliation",
    "character": "reconciliation",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "A revoked key: the CLI and the Desk agree in 12 of 15 cases; in the three that differ the Desk is right",
    "concept": "the verdict for a signature by a revoked key, on the same trust list",
    "surfaces": ["verify (CLI)", "adopt --url (CLI)", "trust --url (CLI)", "Desk #/verify and trust panel"],
    "expected": "The same trust list gives the same verdict and the same words on both surfaces; a revocation recorded anywhere counts everywhere (docs/signature-format.md:163-165); no line sets the verdict word 'verified' beside a revoked key; a key revoked by cascade says so.",
    "got": "Agree in 12 of 15 cases (Ines's table). Mismatch: (1) the stolen key signing for another origin is 'unverifiable ... the signer is unknown' on the CLI (x3) and 'invalid revoked' on the Desk (x3); adopt --url of the mirror calls the revoked key 'unknown'; (2) between revoke and re-sign the CLI's trust --url adds the key the site revokes, the Desk refuses to offer it; (3) with the signature taken down the CLI writes revokedAt silently and exits 2, the Desk says what it recorded. Both surfaces say 'revoked by its holder' of keys revoked by cascade; only the CLI prints 'verified kid=<revoked kid>'. The drain re-ran arm (1) on the new act forgery-own-origin: with key A trusted for the clinic, the CLI reads the mirror as 'unverifiable ... signer is unknown', origin http://127.0.0.1:4301.",
    "evidence": ["src/cli/files.ts:201-203", "site/desk.js:771-774", "site/desk.js:776-783", "src/cli/commands.ts:523-533", "src/cli/commands.ts:340-346", "src/core/verify.ts:126-133", "INE-L1-01", "INE-L1-03", "INE-L1-04", "INE-L1-07", "INE-L1-10", "shots/ines/l2-desk-10-mirror-own-origin-A-1", "shots/ines/l2-desk-05-fresh-between-revoke-resign-1", "shots/ines/l2-desk-11-takedown-1"],
    "related": ["INE-L1-01", "INE-L1-03", "INE-L1-04", "INE-L1-07", "INE-L1-10", "INE-L2-4"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open"
  },
  {
    "id": "REC-7",
    "journey": "reconciliation",
    "character": "reconciliation",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "'Clean' means 'nothing in the lock drifted', and an accept can empty the lock: the issue closes clean over a stale price, a dropped pin, a dropped card and a broken signature",
    "concept": "what 'clean' means at the watch, the issue, the pull request, the scan and the Desk",
    "surfaces": ["watch (CLI)", "issue close comment", "relock PR close comment", "scan drift column", "Desk drift view"],
    "expected": "'Clean' is said only when everything the site states or loads is still watched and its own signature still covers the files; when an accept narrowed what is watched, the close says what is no longer watched.",
    "got": "Agree: every surface says clean is not safe ('Clean is not safe: it means nothing locked has drifted'; the Desk never shows 'No drift' for an unverified lock). Mismatch: the CLI prints 'watch: no drift' only at zero findings, and an info-only watch exits 0 with no headline; the issue closed 'clean' after a relock dropped the stale price's anchor (6 -> 5) while the network still said EUR 89, after a merged outage PR replaced a pin with 'pending', after a relock dropped the Agent Card, and after an unsigned relock was merged while every verifier reads the site invalid (tampered).",
    "evidence": ["action/report.mjs:219-226", "src/watch/detectors.ts:205-216", "src/watch/capture.ts:126-135", "src/watch/capture.ts:157-176", "src/cli/watch-command.ts:139-147", "MAR-L1-01", "MAR-L2-03", "DEV-L1-05", "TOM-L1-04", "uat/runs/2026-11-18-first-five/evidence/marta/out/runner.w3.json", "shots/marta/l2-21-W-after-merge-verify.png", "shots/tomasz/l2-transcripts/16-after-card-dropped.json"],
    "related": ["MAR-L1-01", "MAR-L2-03", "DEV-L1-05", "TOM-L1-03", "TOM-L1-04", "TOM-L2-01", "DEV-L1-11", "MAR-L1-17"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open"
  },
  {
    "id": "REC-8",
    "journey": "reconciliation",
    "character": "reconciliation",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "'Accept' names a finding on the issue and the PR, but the relock behind it re-captures everything reachable, and adopt's accept and the lock's accept do not know each other",
    "concept": "what 'accept' does",
    "surfaces": ["drift issue next step", "relock PR title and body", "CLI watch --relock and --drop", "adopt", "trust --yes"],
    "expected": "Accepting a finding changes the lock for that finding only, says what else it changes, never turns 'could not read' into 'stop watching', and a signer change is accepted only against the trust file (or with a flag that names the signer change).",
    "got": "The PR is titled 'accept the drift' and lists 'The findings this accepts'; the relock behind it re-captures every peer, card and source at once: accepting seller A's rotation also pinned seller B's swapped signer (three times in one week); --drop of a peer said 'This ref was not in the lock' and accepted it anyway; a relock during an outage replaced pins with 'pending' and dropped the card; a relock over a stale price dropped its anchor. adopt writes the trust file, the lock still blocks; the relock reads no trust file. 'Nothing is accepted until a person merges' holds (MAR-L1-17).",
    "evidence": ["src/watch/index.ts:98-121", "src/watch/capture.ts:144-185", "action/report.mjs:141-148", "action/report.mjs:254-266", "src/cli/trust-command.ts:222-311", "TOM-L1-01", "TOM-L2-02", "DEV-L1-05", "MAR-L1-01", "shots/tomasz/l2-transcripts/07-accept-A.txt", "shots/tomasz/l2-transcripts/14-accept-card.txt", "shots/dev/ci-r12-partner-down.txt"],
    "related": ["TOM-L1-01", "TOM-L2-02", "TOM-L1-03", "TOM-L1-04", "TOM-L2-01", "DEV-L1-05", "MAR-L1-01", "DEV-L2-3"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open"
  },
  {
    "id": "REC-9",
    "journey": "reconciliation",
    "character": "reconciliation",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "'Facts the network states' counts only the facts the lock happened to anchor, and no surface says which those are",
    "concept": "the unit of the grounding count",
    "surfaces": ["watch (CLI)", "drift issue", "relock PR body", "Desk drift view", "read_drift tool result", "init output", "scan drift details"],
    "expected": "The count names its unit truthfully ('5 of the 7 facts the network states are watched on this page; the double and single room prices are not'), set up at init and repeated wherever the count is shown.",
    "got": "Larch House's network states 7 facts on rooms.html; the lock anchors 5 (neither room price: the money pattern reads 'Sleeps 2 | EUR 89' as EUR 2). Every surface says 'all 5 facts the network states from it are still on it' after the price changed, and init says '3 grounding sources' with no fact count, whether 6, 5 or 0 facts anchored. The same unit reaches the assistant's tool result, which would repeat it.",
    "evidence": ["src/watch/anchors.ts:90", "src/watch/decide.ts:125-127", "src/cli/init-command.ts:168-176", "site/desk.js:589-598", "MAR-L2-01", "MAR-L2-02", "uat/runs/2026-11-18-first-five/evidence/marta/out/issue-body.d1-raise-price.md", "uat/runs/2026-11-18-first-five/evidence/marta/out/j-tool.json", "uat/runs/2026-11-18-first-five/evidence/marta/out/anchor-probe.txt"],
    "related": ["MAR-L2-01", "MAR-L2-02", "MAR-L1-03", "MAR-L1-15", "MAR-L1-14"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open"
  },
  {
    "id": "REC-10",
    "journey": "reconciliation",
    "character": "reconciliation",
    "cert_level": "L2",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "When something was checked or trusted is recorded in one place, shown in none, and invented in two",
    "concept": "the date of a check, a trust or a revocation",
    "surfaces": ["gate report", "badge", "watch report", "lock records", "upstream info line", "trust file", "drift issue"],
    "expected": "Every report carries the time it was made; every surface that shows a date shows that one; a trust or adoption carries its own time; times are readable.",
    "got": "The gate report has no time, so the badge prints the drawing date and accepts any --now (2025-01-01 drawn from today's report). The watch report has no time; the lock's per-record checkedAt is shown nowhere. The upstream line prints 'until epoch 1794999868'. Trust entries carry no time, and a cascaded revokedAt copies the source key's time, so the attacker's key reads revoked two minutes before it was adopted.",
    "evidence": ["src/core/types.ts:309-314", "src/cli/badge-command.ts:30", "src/watch/capture.ts:154", "src/watch/detectors.ts:111", "src/core/revoke.ts:76-96", "PRI-L1-08", "DEV-L1-11", "DEV-L2-2", "INE-L1-11", "TOM-L1-07", "shots/priya/badges/healthy-default-now-past.svg"],
    "related": ["PRI-L1-08", "DEV-L1-11", "DEV-L2-2", "INE-L1-11", "TOM-L1-07"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open"
  },
  {
    "id": "REC-11",
    "journey": "reconciliation",
    "character": "reconciliation",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "A proper rotation, a swapped signer and a stranger read the same at the watch, in verify --json and on the Desk; only adopt and a text-only hint tell them apart",
    "concept": "a signer change",
    "surfaces": ["watch", "verify (text)", "verify --json", "Desk #/verify", "adopt", "relock change list"],
    "expected": "Each surface says which of three it is: a rotation from a trusted key, a different key while another is trusted for this origin, a key never met.",
    "got": "Watch: 'A peer is now signed by a different key than the one the lock recorded.' for both the rotation and the swap. verify text: a rotation hint for the rotated seller only; verify --json: the same body for both. Desk: the swapped seller reads 'You have not met this signer yet' with 'First contact: trust this publisher?' while the trust list on the same screen holds the seller's old key, exactly as for a seller never met. adopt: 'verified ... named its successor' (exit 1) vs 'plumbline-rotation.json not found' (exit 2). Relock: 'changed peer' for both.",
    "evidence": ["src/watch/decide.ts:283-286", "src/cli/commands.ts:621-630", "src/core/verify.ts:236-262", "TOM-L1-02", "TOM-L2-03", "TOM-L1-09", "shots/tomasz/tom-l2-desk-verify-4502.png", "shots/tomasz/tom-l2-desk-verify-4504.png", "shots/tomasz/l2-transcripts/05-swapped.json"],
    "related": ["TOM-L1-02", "TOM-L2-03", "TOM-L1-09", "TOM-L1-01"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "open"
  },
  {
    "id": "REC-12",
    "journey": "reconciliation",
    "character": "reconciliation",
    "cert_level": "L2",
    "type": "trust",
    "strength": true,
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "Agreement: on the day it happens, nothing unreachable is shown green, and 'clean is not safe' is said everywhere clean is said",
    "concept": "the third state on the day it happens",
    "surfaces": ["watch (CLI and harness)", "Desk drift view", "drift issue and close comment", "relock PR", "scan", "badge", "gate exit code"],
    "expected": "No surface shows a pass, clean or green for what it could not read.",
    "got": "Held on every surface walked: a down partner or seller is warn 'so it was not checked' (exit 1); the Desk says 'was not contacted'; a lock not read is never 'No drift'; the badge never draws green for not checked; nothing-checked gates exit 1 under either --fail-on; the issue and the PR say clean is not safe and nothing is accepted until a person merges. Ceiling: the next relock can convert the unreachable thing into an unwatched one (REC-7, REC-8).",
    "evidence": ["src/watch/decide.ts:229-241", "site/desk.js:1431-1438", "src/scan/badge.ts:11-22", "src/cli/gate-command.ts:28-41", "action/report.mjs:150", "DEV-L1-S1", "TOM-L1-S1", "MAR-L1-16", "MAR-L1-17", "PRI-L1-S1", "PRI-L1-S5"],
    "related": ["DEV-L1-S1", "TOM-L1-S1", "MAR-L1-16", "MAR-L1-17", "PRI-L1-S1", "PRI-L1-S5"],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "n-a",
    "ceiling": "On the day it is true; a later relock or merge can make the unreachable thing silently unwatched."
  },
  {
    "id": "REC-13",
    "journey": "reconciliation",
    "character": "reconciliation",
    "cert_level": "L2",
    "type": "trust",
    "strength": true,
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "senior-quality",
    "title": "Agreement: a changed peer or card is counted in named units, without a stranger's words, on every surface that reports it",
    "concept": "what changed in someone else's definition",
    "surfaces": ["watch (CLI)", "drift issue", "relock PR body", "Desk drift (shared reader)", "plumbline diff"],
    "expected": "Counts with units and no quoted names on alert surfaces; names only for the caller's own files.",
    "got": "'In outline: agents: 1 added, 0 removed, 1 changed; outbound hosts: 1 added, 0 removed; front agent: unchanged.' and 'skills: 1 added, 0 removed, 1 changed; it carries 1 JWS signature, not verified here.' on every surface; a reformat is told apart and stays block; diff names agents and hosts only for local files and strips control characters. Ceiling: the counts are prose only (no fields), links.json hosts are not counted, and the old definition is kept nowhere (DEV-L1-03).",
    "evidence": ["src/watch/decide.ts:243-252", "src/watch/outline.ts:141-147", "src/watch/external.ts:116-121", "src/cli/diff-command.ts:179-182", "DEV-L1-S2", "TOM-L1-S2", "DEV-L1-S3"],
    "related": ["DEV-L1-S2", "TOM-L1-S2", "DEV-L1-S3"],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "n-a",
    "ceiling": "Counts only, in prose; the old definition is not kept, so the publisher cannot see the difference itself."
  }
]
```

## Impact-ranked backlog preview

Rank is frequency x reachability x trust erosion (low 1, med 2, high 3), taken from the highest-ranked confirmed finding
in each cluster; convergence (how many Characters hit it) breaks ties. Recurrence does not apply: this is the first run.
The full ordering, with dispositions, is in the drain.

| # | Cluster | Rank | Characters | Findings | Backlog |
| --- | --- | --- | --- | --- | --- |
| 1 | Grounding says "all facts still on it" about facts it never watched; after the right fix it stays wrong | 27 (blocker) | Marta, Priya | MAR-L2-01, MAR-L2-02, MAR-L1-02, MAR-L1-03, REC-9 | UAT-1 |
| 2 | Accept re-captures everything and forgets what it could not read | 27 | Tomasz, Dev, Marta | TOM-L1-01, TOM-L1-03, TOM-L1-04, TOM-L2-01, TOM-L2-02, TOM-L1-08, DEV-L1-05, MAR-L1-01, REC-8 | UAT-2, UAT-3, UAT-4 |
| 3 | The PR push fails on the second run | 27 | Dev, Marta | DEV-L1-01, MAR-L1-13 | UAT-5 |
| 4 | New evidence on an open issue or PR is silent | 27 | Dev, Marta | DEV-L1-02, MAR-L1-04, DEV-L1-06 | UAT-6 |
| 5 | Gate "partly checked" = "not checked", on every surface | 27 | Priya | PRI-L1-01, PRI-L1-02, PRI-L2-2, REC-1 | UAT-9 |
| 6 | The badge: "not checked" for healthy, green for broken | 27 | Priya | PRI-L1-09, PRI-L1-14, PRI-L1-08, REC-5 | UAT-10 |
| 7 | CLI and Desk disagree on revoked and unsigned; "unsigned lock" | 18 | Ines, Tomasz, Marta | INE-L1-03, INE-L1-10, INE-L1-04, TOM-L1-06, TOM-L2-04, MAR-L1-10, REC-3, REC-4, REC-6 | UAT-7 |
| 8 | Verdict sentences unfit for an incident note | 18 | Ines, Tomasz | INE-L1-01, INE-L1-07, INE-L1-09, INE-L2-1, TOM-L2-03, REC-11 | UAT-8 |
| 9 | Addresses sent to Atlas that Plumbline itself refuses | 18 | Priya | PRI-L1-04, PRI-L2-1 | UAT-11 |
| 10 | The keyless site told to sign | 18 | Dev | DEV-L1-04 | UAT-12 |
| 11 | Windows line endings read as changed facts | 18 | Dev | DEV-L2-1 | UAT-13 |
| 12 | No old definition to diff against | 18 | Dev | DEV-L1-03, DEV-L1-10 | UAT-18 |
| 13 | No inventory-grade JSON | 18 | Tomasz, Dev | TOM-L1-07, TOM-L1-13, DEV-L1-11 | UAT-17 |
| 14 | No owner-facing words; no way to the Desk | 18 | Marta | MAR-L1-06, MAR-L1-11, MAR-L2-05 | UAT-29, concept document |
| 15 | Portfolio report unsorted | 18 | Priya | PRI-L1-03, PRI-L1-10 | UAT-19 |
| 16 | No help, no roles, a README that misleads | 18 (PRI-L1-13) | Dev, Ines, Priya, Tomasz | DEV-L1-09, INE-L1-06, PRI-L1-13, PRI-L1-11, PRI-L2-4 | UAT-28 |
| 17 | Bad-day guardrails | 12 (voice escalates) | Ines | INE-L1-02, INE-L1-05, INE-L1-13, INE-L2-2 | UAT-15 |
| 18 | No local rehearsal | 12 | Dev, Tomasz, Priya | DEV-L1-08, TOM-L1-11, PRI-L1-06 | UAT-21, UAT-22 |

## Value ledger

Promised is the Character's own declared saving; claimed is the L1 walker's estimate of the designed experience; live is
what L2 measured. Machine time was measured everywhere (every command answered in under a second; the twelve-site scan
took 94 s, 70 s of it the slow site); human time is the walkers' estimate.

| Character | Without the product | Promised with it | Promised saving | L1 claimed | L2 live | What the gap is made of |
| --- | --- | --- | --- | --- | --- | --- |
| Marta | 15 min a price change, often forgotten | under 3 min | ~12 min a change, ~8 a year | ~7 min (low) | **none on her page; negative if she believes it** (medium) | the price is never watched (UAT-1); every wording edit costs a paid developer cycle (MAR-L1-07) |
| Dev | ~25 min a week per partner, lapses within a month | 0 in a quiet week, ~10 a change | ~25 min a week | ~20 (medium-low) | **15 to 18** (medium) | hand-fetching the new definition and hashing names after reading the source; a red job and a branch deleted by hand on each second drift; 20 to 30 min once for CRLF |
| Ines | ~90 min an incident, proving little | ~15 once + ~30 an incident | ~60 an incident | ~65 (medium) | **~65** in the documented order (medium); ~40 in the other order | 12 min writing the runbook from a 500-line document; 5 min rewriting three sentences she cannot paste; the wrong order costs a third key and a second call |
| Priya | ~120 min a monthly pass | ~15 a weekly pass | ~105 a pass | ~95 (medium) | **~95** (medium), 20 to 25 min a pass | opening 8 grey rows' details; verify per signed site; nothing sorted |
| Tomasz | ~40 min a week with his own hash script | ~10 | ~30 a week | ~20 blended (low-medium) | **~17 blended**; the event week **-5** (medium) | 3 hand-edits of a signed lock undone by the next relock; 12 verify runs; reading the lock by hand for 21 of the 25 inventory cells |

The value that is not in minutes, the change that would otherwise go unseen, is live for Dev's first partner change,
Priya's launch defect and Ines's revoked forgery. It is not live for Marta's price, Dev's same-count fee change, Dev's
change after an outage, Tomasz's swapped signer after any relock, or Tomasz's card after a relock during its outage:
each went unseen while the product was running, and each was reported in a calm voice.

## Strengths worth protecting (constraints on every build)

Phrased as constraints; the backlog repeats them as guardrails at its top.

1. **Unreachable is never green on the day.** Any change to capture, relock or a surface keeps a down or refused peer,
   card, site or checker at warn or `unavailable`, with the exit code it has today (DEV-L1-S1, TOM-L1-S1, PRI-L1-S1,
   MAR-L1-16, REC-12). Fixing T2 must add to this, never trade it.
2. **Counts, never a stranger's words.** Any richer "what changed" keeps alert surfaces to counts in named units, and
   names only for the publisher's own files in their own terminal (DEV-L1-S2, TOM-L1-S2, DEV-L1-S3, REC-13).
3. **Nothing is trusted, adopted or accepted without a person.** First contact refuses without `--yes` and names the
   channels (INE-L1-18); adopt walks the chain from a trusted key and needs `--yes` (TOM-L1-S3, INE-L1-20); the PR says
   nothing is accepted until a person merges and stays a draft when unsigned (MAR-L1-17). No convenience (a one-click
   accept, an assistant, a wizard) may remove a confirmation.
4. **A revoked key stays dead.** sign and rotate refuse it and say what to do instead; a revoked kid is never trusted
   again; the cascade undoes a stale-window adoption (INE-L1-19, INE-L1-20, INE-L1-21).
5. **Setup is one keyless command that pins by SHA and overwrites nothing** (DEV-L1-S4); `init` says "kept" and "Not
   added" rather than ignoring a flag (TOM-L1-S6).
6. **The gate's exit contract:** under the default `--fail-on fail`, a real defect fails, a third party's outage alone
   never does, and nothing checked is never a pass (PRI-L1-S1). Changing the words of the third state may not change
   this.
7. **Say what is sent where before sending it** (PRI-L1-S2); extend it to the gate and the Desk, never shorten it.
8. **The docs name their own ceilings** (INE-L1-22), and the Desk's verify view says what a verdict does not mean
   (INE-L2-4). A plain-language layer keeps both.
9. **The Desk needs no key and no install for drift, verify and check** (MAR-L1-16). Nothing added to it may put a key
   or an install in front of a reading.
10. **The relock lists every ref it changed, removals included** (TOM-L1-S4); it should say more (signers), never less.
11. **The buyer's questions are answered before they are asked:** the measured CI cost, pinning, releases, licence and a
    security policy (PRI-L1-S4).

## Honest ceilings

What this run could not exercise, and the fixture or arm that would close each.

| Ceiling | Findings left uncertain, constructed, or measured on a stand-in | What would close it |
| --- | --- | --- |
| A real GitHub runner, repository settings and notifications | MAR-L1-08 (who is notified), DEV-L1-07 (Actions creating PRs), PRI-L2-2 on a runner, PRI-L1-S4's runner number, the code review's fork-PR hypothesis | a scratch GitHub repository the owner creates; run the watch template with `relock-pr` once with "Allow GitHub Actions to create pull requests" off and once on |
| Any peer, seller, partner or card over https | every peer verdict of J2 and J5 was measured through the harness; the Desk's drift view cannot show Dev a changed partner; the pre-load check per seller state (TOM-L2-06) | world sites served over https on loopback with a local CA the test browser and Node trust |
| The Desk's assistant answering | MAR-L1-12's keyed answer | a tester's own key, or a test-only provider hook in the Desk's own code (never `site/runtime/`) that loads `site/tests/scripted_model.mjs` |
| DNS in a real zone | INE-L1-05, measured at module level with an injected resolver | a world-local name resolving to loopback with an https stand-in, or a resolver seam in the CLI |
| A signature file answering 5xx; a signed site with no key record | TOM-L1-08 (constructed through `WatchDeps.fetch`), PRI-L1-10's consequence | a `status500` behaviour per path in `serve.mjs`; a tallow-finch site whose key record answers 404 |
| Off the bound path | INE-L1-17 (the Desk's revoke), TOM-L1-S6 (not re-run) | a journey that binds the Desk's `#/key` revoke; re-run `init --source` on kiln-row's lock |
| The pinned Action as published | DEV-L1-S4's ceiling: the template pins `6b47457`, which is not on GitHub yet, and the published Action has no `relock-pr` | the owner's push (roadmap owner list) |
| Acts the worlds lacked | INE-L1-03 (own-origin forgery), DEV-L1-06 (same-count change), TOM-L1-03 (seller back changed) were constructed by hand | closed by the drain: `forgery-own-origin`, `partner-changes-fee`, `seller-back-changed` (each verified once) |

## Surface-model gaps: what L2 found that L1 missed

| Character | Found only at L2 | Why L1 missed it |
| --- | --- | --- |
| Marta | MAR-L2-01 (the blocker), MAR-L2-02, MAR-L2-03, MAR-L2-04, MAR-L2-05; refuted MAR-L1-15 | L1 ran the anchor check on a page it wrote itself (price column first) instead of the world's tracked fixture; it traced the relock to the clean issue but not the signature after an unsigned merge; rendering |
| Dev | DEV-L2-1 (CRLF), DEV-L2-2, DEV-L2-3; the interaction of DEV-L1-04 with DEV-L1-01 (the predicted re-draft never happens, the push fails first); the issue, not only the PR, is silent on a same-count change | L1 did not read the exact-bytes rule against the publisher's OS; interactions between two defects |
| Ines | INE-L2-1, INE-L2-2, INE-L2-3; a cascaded revokedAt that predates the adoption; a leftover rotation file keeps the adopt hint firing | Desk rendering; L1 never adopted twice from one key |
| Priya | PRI-L2-1 (the Desk's undisclosed Atlas call), PRI-L2-2 to PRI-L2-5; the green badge for tampered and expired sites | L1 left the Desk out of her binding; L1 drew only the healthy validator-only badge |
| Tomasz | TOM-L2-01 (the CLI relock wipes the lock), TOM-L2-02 to TOM-L2-06; the "existing lock" pins no seller at all | the destructive arm and the CLI arm were not run at L1; Desk rendering |

What this says about L1 here: it was accurate (68 of 71 gaps confirmed, none refuted) and strong on structure, wiring
and single defects. It was blind in four repeated ways: (1) it executed its probes against fixtures it made itself
rather than the world's tracked fixtures, which is how the run's only refuted strength and its only blocker arose; (2)
it did not chain defects (DEV-L1-04 with DEV-L1-01, TOM-L1-01 across three relocks); (3) it skipped the destructive arm
(a real-CLI relock over a harness lock); (4) rendering and the Desk's own copy. The drain turns these into rules for the
next L1.

## Opposing verdicts

One. **Is the Desk fit to show a non-technical stakeholder?** Ines: "I meant the Desk as the thing I show the director.
It turned out to be the more honest of the two." Priya: "tell the team the badge and the Desk are not for clients."
Tomasz: "The Desk calls our signed lock 'unsigned' to every shopper." Marta: "The checking page itself was easier than I
expected." The evidence splits by view, not by person: `#/verify` beat the CLI in three of three disagreements
(INE-L2-4) and yet offers first contact to a swapped signer (TOM-L2-03); `#/check` folds healthy and down and calls
Atlas silently (PRI-L1-02, PRI-L2-1); `#/drift` is honest about what it read and wrong about the lock label and the
grounding count (MAR-L1-10, MAR-L2-01). Not averaged: the per-view defects are build items, and which views are meant for
a non-technical reader is routed to the onboarding concept document.

## Panel verdict

The five voices add up to one sentence: **the trust model underneath is right, and the last sentence, the last button
and the bookkeeping on top of it are not, so each of them would adopt the alarm and none would let it be the record or
the accept.** Dev keeps the watch and skips the PR loop; Priya buys the gate and keeps the badge and the Desk away from
clients; Ines adopts it for both organisations and writes her incident notes herself; Tomasz runs it beside his own
script; Marta, the person the product exists to protect, would not adopt it as it is. The escalation from L1 to L2 runs
the same way in four of five voices: the words they expected to be the problem were not the worst of it; a confident,
wrong sentence was. Three quotes carry it:

- Marta, L2: "At L1 I thought my problem would be the words. The words are bad, twenty-odd of them I'd have to look up,
  but the worse thing is that when I finally understood a sentence, it was wrong."
- Tomasz, L2: "A tool that loses my inventory when I follow its own advice can't be the system of record."
- Ines, L2: "the documentation is right and the command in your hand at 7 a.m. is the only thing that is not."
