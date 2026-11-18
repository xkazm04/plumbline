# Ines Baptista x The stolen key - L1

Run `2026-11-18-first-five`. Walker: L1 (code-grounded). `dist/` rebuilt with `npm run build` at 11:03 on 2026-11-18,
after the last commit (10:30). Every CLI line quoted below came from running `node dist/cli/index.js` against
throwaway sites, keys and trust files in a scratchpad folder outside the repository. The key I revoked was made there.
Loopback sites were served by a 15-line static server on 127.0.0.1:4391 (the clinic) and :4392 (the attacker's mirror).
No key in the repository was read. `uat/fixtures/` and `uat/driver/` were not used.

## Verdict

**L1-conditional.** The cryptography and the trust rules hold. Every security property the journey asks for showed up
when I ran the real CLI. First contact refuses without `--yes`. The pharmacy goes `unverifiable`, then `verified`, then
`invalid tampered`. After revocation, the forgery is `invalid revoked` even from a mirror that does not serve the
revocation. A rotation from the stolen key is refused even with `--yes`, and a successor adopted during the stale
window is revoked by the cascade. What falls short is the words Ines would paste into her incident note, and one trap
in the order of operations:

- The `revoked` sentence says "revoked by its holder" about keys nobody revoked. Those keys died by cascade.
- The CLI calls a signer whose key it records as revoked "unknown". The Desk calls the same signer `invalid revoked`.
- Every verify after a revocation prints a line that starts `verified kid=<the stolen kid>`.
- If she rotates before she revokes (the "move to a new one" reflex), her new, uncompromised key is burned at every
  verifier that adopted it. No command warns her, and `sign` with that key still succeeds.

None of this blocks the job. Several of these make her runbook or incident note wrong, which fails her senior bar.

**Scores and estimates**

- **Criteria:** 6 of 8 passed.
- **Time as designed:**
  - First contact: about 12 minutes and 10 steps.
  - The bad day: about 22 minutes and 14 steps (8 of them reading the revocation and first-contact sections of
    `docs/signature-format.md`).
  - Total: about 35 minutes.
- **Time saved:** about 65 minutes per incident against her declared 90 by hand. Confidence is medium. Her declared
  target saving was 60, so it is met.
- **In the wrong order:** the saving falls to about 45 minutes, and she ends with a third key and a second first-contact
  call.

## Surface model

Reachability comes from her Surface binding:

- The CLI on her own laptop, with one folder per organisation.
- The Desk as a second opinion.
- She holds the clinic's private key, and no CI.

**R** = reachable, **U** = unreachable, **R-2** = reachable but secondary (the Desk).

### CLI (handler table `src/cli/index.ts:16-31`)

| Affordance | Code | Role | Reach |
| --- | --- | --- | --- |
| Top-level usage: a flat list of 14 commands, no roles. `--help` and `help` are "unknown command", exit 2 | `src/cli/index.ts:39-42` | both | R |
| Per-command usage line, printed only after a usage error (`trust --help` gives "unknown option: --help") | `src/cli/commands.ts:67-79`, `src/cli/index.ts:51-54` | both | R |
| `keygen --out`: kid, both paths, two custody WARNINGs; warns when `--out` looks like a site | `src/cli/commands.ts:107-141` | publisher | R |
| `sign`: "signed N files as <kid> for <origin>, expires ..."; WARNING when the published key record is absent or another key's; refuses a key the site revokes (exit 2, points to keygen and first contact) | `src/cli/commands.ts:185-284`, `200-212`, `256-268` | publisher | R |
| `revoke`: "revoked <kid> at <t>", "wrote" or "appended", and a "next:" mini-runbook. No preview, no `--yes`, no word that it is irreversible. Never reads `plumbline-rotation.json` | `src/cli/commands.ts:789-842`, `838-839` | publisher | R |
| `rotate`: "rotation A -> B", "next: publish the new key record, then run sign". No leak warning in its output or usage. Refuses a revoked old or new key | `src/cli/commands.ts:713-787`, `730-741`, `781-785`, `73` | publisher | R |
| `dns`: prints the TXT record. "During a rotation, publish one record per key"; nothing about revocation | `src/cli/trust-command.ts:201-220` (216) | publisher | R |
| `export-jws`: needs the private key; signs even with a key the site's revocation revokes | `src/cli/commands.ts:641-674` | publisher | R (no use in her world) |
| `trust --key/--url [--yes]`: kid, public key, DNS line (`--url`), first-contact WARNING; "nothing added: confirm out of band, then rerun with --yes" (exit 1); refuses a kid the trust file records as revoked (exit 2). Does not read the site's revocation file | `src/cli/trust-command.ts:52-57`, `122-195`, `130-143`, `153` | verifier | R |
| `trust` DNS decision: disagrees refuses `--yes`; `--require-dns` | `src/cli/trust-command.ts:96-115` | verifier | R (no real zone here) |
| `verify --root/--url`: revocation applied first and recorded in the trust file ("revocation recorded in <file> (N entries)"), then the verdict line; adopt hint when a rotation file is present; exit 0 only for `verified` | `src/cli/commands.ts:487-632`, `523-528`, `618-631` | verifier | R |
| Revocation sub-lines reuse `formatResult`, so they print `verified kid=<revoked kid>` | `src/cli/commands.ts:340-363` | verifier | R |
| `adopt`: applies the revocation first (written only with `--yes`), walks the chain, prints each hop; `--yes` needed; refuses a revoked signer | `src/cli/trust-command.ts:222-311` | verifier | R |
| Trust file: `{kid, origin, publicKey, revokedAt?, adoptedVia?}`. No time added, no time adopted | `src/cli/files.ts:149-203`, `docs/signature-format.md:139-165` | verifier | R |

### Verdict sentences (the shared mapping; every branch checked below)

| Branch | Sentence source | Clean? |
| --- | --- | --- |
| `verified` | `src/core/verify.ts:237-245` | Says what is proven. Not what is not, not the expiry |
| `unverifiable` stranger (consistent / not checkable) | `src/core/verify.ts:248-261` | Clean for a true stranger. **False** for a kid the trust file records as revoked at another origin ("the signer is unknown") |
| `unverifiable` origin mismatch | `src/core/verify.ts:163-171` | "The files may be genuine" over a forgery; the line's `origin=` is the signed origin, and the checked origin is printed nowhere in the CLI |
| `unverifiable` unread files | `src/cli/commands.ts:601-615` | Clean |
| `invalid malformed` / `kid-mismatch` / `bad-signature` | `src/core/verify.ts:181-201`, `245` | Clean |
| `invalid tampered` | `src/core/verify.ts:209-213`, `268-302` | Reason given; **which** file is not named |
| `invalid expired` | `src/core/verify.ts:222-224` | Reason given; when it expired is not said |
| `invalid revoked` (`revokedResult`) | `src/core/verify.ts:126-133` | Clean for the key that revoked itself. **False** for a key revoked by cascade (`adoptedVia`, `src/core/revoke.ts:76-96`): "revoked by its holder" |
| Rotation: unknown `from` | `src/core/rotate.ts:105-113` | **False** for a kid known as revoked at another origin ("unknown to this verifier") |
| Rotation: successor revoked | `src/core/rotate.ts:267-274` | Clean, its own sentence |
| `trust` refusal of a revoked kid | `src/cli/trust-command.ts:60-62` | Neutral ("records key ... as revoked"). "Ask the publisher for its new key" reads oddly to the publisher whose *new* key it is |
| Revocation statement verified | `src/core/revoke.ts:152-157` | The sentence is fine; the CLI prefixes it with the verdict word `verified` |

### Desk (R-2: second opinion and showing the director)

| Affordance | Code | Reach |
| --- | --- | --- |
| `#/verify`: address, Verify, verdict chip with reason in words, the verdict's *meaning* (verified: "It does not mean the site is safe"), detail, signer, signed-for origin, fetched-from origin, signed files | `site/index.html:156-194`, `site/desk.js:1482-1499`, `site/strings.js:29-38`, `119-150` | R-2 |
| Revocation box: applied, not applied, unreadable | `site/desk.js:1500-1507`, `site/strings.js:151-156` | R-2 |
| A revoked kid at any origin, or a tombstone, gives `invalid revoked`, never a stranger | `site/desk.js:771-774`, `site/README.md:110-112` | R-2 (**CLI has no equivalent**) |
| No first-contact offer when the site revokes its own signing key | `site/desk.js:776-783`, `site/strings.js:157` | R-2 (**CLI `trust --url` has no equivalent**) |
| First contact: three steps, a checkbox, then Trust | `site/desk.js:1509-1539`, `site/strings.js:158-169` | R-2 |
| Trust list with revoked chips, Forget (tombstone), export and import of `plumbline.trust.json` | `site/desk.js:1546-1579`, `877-933`, `site/strings.js:173-204` | R-2 (how she would carry the pharmacy's file in) |
| `#/key` revoke section: "it cannot be taken back". Offers one statement, never appends | `site/index.html:235-247`, `site/desk.js:1013-1046`, `site/strings.js:231-241` | R-2 (she revokes with the CLI) |
| No adopt on the Desk | (absent) | n/a |

### Documents

| Page | What it gives her | Reach |
| --- | --- | --- |
| `README.md:14-15`, `44-56` | Rotation is for planned changes, revocation for leaks. The verifier block mixes `trust`, `verify`, `gate` and `adopt`. **No `revoke` example anywhere in the README** | R |
| `docs/signature-format.md:20-27` | Files table with "Who writes it": the clearest publisher/verifier split in the product | R |
| `docs/signature-format.md:323`, `328-332` | "Do not rotate after a leak: revoke" | R |
| `docs/signature-format.md:393-443` | The bad-day order (revoke, keygen and re-sign, first contact), the stale-trust window, what revocation cannot do | R |
| `docs/signature-format.md:445-476`, `docs/trust-bootstrap.md:8-47` | The first-contact ceremony; DNS as a second channel. The revocation steps never mention DNS | R |
| `docs/signature-format.md:489-499` | CLI table, no role column | R |
| `docs/jws-profile.md:46-49`, `73-78` | The JWS needs the private key, and is for JOSE verifiers; nothing in her world | R |

### Wiring audit (values computed for a user and never shown)

- `expectedOrigin`, the origin `verify --url` checked as, is computed (`src/cli/commands.ts:511`) and printed nowhere.
  The origin-mismatch line shows only the signed origin. The Desk shows both ("Files fetched from", `site/desk.js:1496`).
- Cascaded revocations: `applyRevocationText(...).entries` marks the successors adopted through the revoked key
  (`src/core/revoke.ts:151`). The CLI prints only "(2 entries)" and a result line for the self-revoked kid
  (`src/cli/commands.ts:345-351`). Which successor died is never named.
- `RevocationOutcome.kids` (`src/core/revoke.ts:172-173`): read by the Desk (`site/desk.js:779`); the CLI never uses it.
  The CLI's `trust --url` does not read the revocation at all (`src/cli/trust-command.ts:130-143`).
- A revocation's `reason` is never shown, by design (strings from inspected files are not quoted). This is not a finding.

## Walkthrough

Ines has two folders, `clinic/` and `pharmacy/`, and a paper runbook open beside the terminal.

### First contact (once)

1. **She looks for help.** `plumbline --help` gives "unknown command: --help" and a flat list of 14 commands.
   - Q1 yes.
   - Q2 no: there is no help.
   - Q3: nothing says `revoke` is hers as publisher and `adopt` is the pharmacy's.
   - She falls back to the README, then to `docs/signature-format.md`. The Files table (lines 20-27) is the first thing
     that tells her which side writes what. (INE-L1-06)
2. **keygen.** `kid 8319bbfb9d16d9e6`, both paths, two custody warnings. Q4 yes. She writes the kid in the runbook.
3. **sign without the key record.** The output gives the signed files and the expiry, then: "WARNING: clinic/site
   publishes no .well-known/plumbline-key.json; first-contact verifiers need this key's record ... publish it". She
   copies the record into the site and signs again; the warning is gone. Q4 yes.
4. **Pharmacy verify before trust.**
   - With no trust file: `plumbline verify: trust store not found: pharmacy/plumbline.trust.json`, exit 2.
   - She wanted to see "unverifiable" first, and `trust` without `--yes` writes nothing. So she hand-writes
     `{"version":1,"entries":[]}`. (INE-L1-12)
   - Then: `unverifiable kid=8319bbfb9d16d9e6 origin=https://northgate-clinic.example - The signature is internally
     consistent but the signer is unknown: this verifier has no trust entry for the key, so it proves nothing about who
     published the files.` Exit 1.
   - Good: honest, and fit for a note.
5. **trust without `--yes`.** The kid, the public key, then "WARNING: Compare this kid, character by character, with the
   one the publisher gave you out of band (in person, on a call, in a signed message or a repository you already trust)
   ...", then "nothing added: confirm out of band, then rerun with --yes". Exit 1, no file written.
   - Q1 to Q4 yes. This is exactly her ceremony.
   - With `--url` it adds `dns 127.0.0.1: could not ask (the address is an IP literal, which has no DNS name)`, and
     `--require-dns --yes` refuses: "nothing added: --require-dns needs DNS to agree ... could not ask".
6. **trust `--yes`.** "added to pharmacy/plumbline.trust.json"; run again, "already trusted ... nothing to add", exit 0.
   - The file holds no date. Her "I can prove afterwards what was trusted when" has nothing to stand on except her own
     git. (INE-L1-11)
7. **verify.** `verified kid=... - The files match a signature made by a key this verifier already trusts for this
   origin.` Exit 0.
   - Her note wants "until 2027-02-16" and "this does not mean the site is safe". The Desk says the second
     (`site/strings.js:33`); the CLI says neither. (INE-L1-09)
8. **Tamper.** `invalid tampered ... - A signed file differs from the version that was signed.` Exit 1.
   - "Which file?" Not in the text and not in `--json`, though the signed paths are safe strings already held to a
     pattern. She diffs by hand. (INE-L1-08)
9. **Expire** (`--now 2027-03-01`). `invalid expired ... - The signature has expired and must be renewed by the
   publisher.` Distinct and correct. It does not say when it expired.

### The bad day

10. **Before the pharmacy knows.** The thief signs a mirror with altered instructions, using key A, for the clinic's
    origin.
    - `verify --root mirror --origin https://northgate-clinic.example` gives `verified`. This is the documented
      stale-trust window (`docs/signature-format.md:436-439`).
    - From the mirror's own address (`--url http://127.0.0.1:4392/`) it is `unverifiable`, with detail "The files may be
      genuine but are not attested for the origin they were checked as". "May be genuine" is about a forgery, and
      `origin=` shows the clinic's origin, not the address checked. (INE-L1-09)
11. **She reads the order.** `docs/signature-format.md:393-406` gives three steps: revoke, keygen and re-sign, first
    contact. "Do not publish a rotation from the leaked key; verifiers refuse it." The key-custody list (line 323) says
    the same. Q1 to Q3 yes, if she reads the docs before acting.
    - The README has no `revoke` example at all, and its table row says only "Rotation for planned changes,
      self-signed revocation for leaks".
12. **revoke.** "revoked 8319bbfb9d16d9e6 at 2026-11-18T10:05:03.954Z / wrote clinic\site\plumbline-revocation.json /
    next: publish it at the site base, make a NEW key with keygen, re-sign the site with it, and re-establish trust with
    your verifiers through the first-contact ceremony. Never rotate from the revoked key: verifiers refuse it."
    - A second run gives "already revoked ... nothing written". Q4 yes, a good mini-runbook.
    - Missing: that it is final at every verifier who reads it (the Desk says "it cannot be taken back",
      `site/strings.js:240`), a preview, and the DNS record. (INE-L1-13, INE-L1-05)
13. **Signing with A is refused.** "this key (8319bbfb9d16d9e6) is revoked by the site's plumbline-revocation.json ...
    make a new key with plumbline keygen, sign with it, and re-establish trust through the first-contact ceremony".
    Exit 2. Strength.
14. **keygen B, sign with B.**
    - With A's record still in `.well-known`: "WARNING: the .well-known/plumbline-key.json in clinic/site is not the
      record of the key that signed (6af23b00afd7c042); publish this key's record". She copies it and signs again,
      cleanly. Q4 yes.
15. **Pharmacy verify of the clinic.** The output, verbatim:
    ```
    revocation applied: plumbline-revocation.json revokes a trusted key, so nothing that key signs is accepted
      verified kid=8319bbfb9d16d9e6 origin=https://northgate-clinic.example - A key this verifier trusts has revoked itself: nothing signed by it is accepted any more.
    revocation recorded in pharmacy/plumbline.trust.json (1 entry)
    unverifiable kid=6af23b00afd7c042 ... signer is unknown ...
    ```
    - She can paste "revocation recorded" into the note.
    - The second line starts `verified kid=<the stolen kid>`. Grep her log for "verified kid=8319" and the stolen key
      shows up as verified. (INE-L1-07)
16. **The forgery after the revocation was recorded.**
    - `verify --root mirror --origin <clinic>`, `--url` of the mirror, and the mirror signed again: all
      `invalid revoked ... - The key that made this signature has been revoked by its holder, so nothing it signs is
      accepted, whatever the dates.` Exit 1.
    - The mirror does not serve the revocation; the trust file remembers it. Criterion 5 met.
    - But when the thief signs the mirror for **its own** origin, the CLI says `unverifiable ... The signature is
      internally consistent but the signer is unknown`, although this trust file records that kid as revoked. The Desk
      would say `invalid revoked` (`site/desk.js:771-774`). Her two opinions disagree. (INE-L1-03)
17. **First contact for B.** `trust --key clinic-key-b.json --yes` gives "added", and verify gives `verified kid=6af2...`.
    Re-trusting A gives "records key 8319bbfb9d16d9e6 as revoked; a revoked key is never trusted again", exit 2. Strength.
18. **The attacker rotates A -> X on the mirror.**
    - `adopt` with or without `--yes`: `invalid revoked ... The key that made this rotation has been revoked by its
      holder ...` then "nothing adopted: only a rotation signed by a key you already trust, unrevoked, for this origin
      is adopted". Exit 1. Criterion 6 met.
    - `adopt --url` of the mirror instead says "The old key that signed this rotation is unknown to this verifier": the
      same false "unknown" as step 16. (INE-L1-03)
    - Verifying the X-signed mirror prints "hint: plumbline-rotation.json is present; if you trust a key it rotates
      from, check it with plumbline adopt ...", although that key is revoked in this very file. (INE-L1-15)
19. **The stale arm** (a pharmacy trust file copied before step 15).
    - `adopt` shows `verified` and "rerun with --yes to add it". With `--yes`: "adopted 9aa82c50dfa8ea55 ... recorded as
      adopted via 8319bbfb9d16d9e6", and the mirror then verifies.
    - Adoption is never automatic; that is the documented window.
    - When the pharmacy next verifies the real clinic: "revocation recorded ... (2 entries)", and the mirror becomes
      `invalid revoked` for X. The cascade works. Strength.
    - But X's verdict says X "has been revoked by its holder", which is false: X was never revoked, it died because it
      was adopted through A. "(2 entries)" never names X. (INE-L1-01)
20. **The wrong order** (a fresh copy). Ines thinks "move to a new key" means `rotate`.
    - `rotate` A->B prints no leak warning. Signing with B works. The pharmacy follows the hint and runs `adopt --yes`.
    - Then she reads the docs and runs `revoke` on A. `revoke` does not mention that the site's rotation file names B as
      A's successor.
    - The pharmacy's verify: "revocation recorded ... (2 entries)" and `invalid revoked kid=b99fcd3bada1ae53 ...
      revoked by its holder`. She never revoked B.
    - `trust` of B: "records key b99fcd3bada1ae53 as revoked; a revoked key is never trusted again: ask the publisher
      for its new key". She *is* the publisher, and B *is* the new key.
    - Meanwhile `sign` with B on the clinic still succeeds, exit 0, with no warning.
    - She needs key C and a second first-contact call. The security outcome is right; nothing told her. (INE-L1-02)
21. **The signature taken down mid-incident.** On a site that serves only the revocation, `verify` gives "plumbline
    verify: plumbline.signature.json not found", exit 2, and nothing else. But the trust file now carries `revokedAt`:
    written at `src/cli/commands.ts:527`, before the throw at `532`. The command changed her trust file and said only that
    it failed. (INE-L1-04)
22. **JWS.** Running `export-jws` from the pharmacy folder gives "not a Plumbline private key file", exit 2. The doc
    (`docs/jws-profile.md:46-49`) says why the private key is needed; she has no JOSE verifier, so it is irrelevant to
    her. With the revoked key A it still exports a JWS, exit 0, while `sign` and `rotate` refuse. (INE-L1-16)

## Scored criteria

| # | Criterion | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Publisher and verifier commands distinguishable in the help and the docs | **FAIL** | No help at all: `--help` and `help` are unknown commands, and the usage line is a flat list (`src/cli/index.ts:39-42`). The CLI table has no role column (`docs/signature-format.md:489-499`). Only the Files table (`docs/signature-format.md:20-27`) and the prose of the revocation section separate the sides |
| 2 | First contact refuses until she confirms; says what to compare and with whom | PASS | "nothing added: confirm out of band, then rerun with --yes", exit 1, nothing written; the WARNING names the kid, character by character, the publisher, and four channels (`src/cli/trust-command.ts:52-57`, `109`) |
| 3 | `unverifiable` before trust, `verified` after, `invalid` with a reason on tamper | PASS (with friction) | Run output in steps 4, 7 and 8. With no trust file at all, verify exits 2 instead (INE-L1-12); tamper does not name the file (INE-L1-08) |
| 4 | The order of revoke and rotate is unambiguous; each command prints what it changed | PASS | `docs/signature-format.md:323`, `393-406`; revoke's "next:" line (`src/cli/commands.ts:838-839`); sign, trust and verify each print what they wrote. Exceptions: the wrong order goes unwarned (INE-L1-02), and the silent write on exit 2 (INE-L1-04) |
| 5 | The forgery after revocation is refused with the reason `revoked` | PASS | `invalid revoked` for the mirror signed for the clinic's origin, by `--root` and by `--url`, without the mirror serving the revocation (step 16). Caveat: signed for the attacker's own origin, it is `unverifiable` "signer is unknown" (INE-L1-03) |
| 6 | A rotation signed by the revoked key does not carry the pharmacy to a new key automatically | PASS | `adopt --yes` is refused, `invalid revoked` (`src/core/rotate.ts:98`). In the stale window `--yes` is still required, and the cascade revokes the adopted key later (`src/core/revoke.ts:76-96`) |
| 7 | Every verdict sentence fits an incident note: what was proven and what was not | **FAIL** | False sentences: "revoked by its holder" on cascaded keys (`src/core/verify.ts:126-133`), "signer is unknown" for a recorded-revoked kid (`src/core/verify.ts:248-261`), the `verified kid=<revoked>` prefix (`src/cli/commands.ts:345`), "files may be genuine" over a forgery (`src/core/verify.ts:170`). `verified` omits its limits and expiry |
| 8 | The whole incident under 30 minutes from the product's documentation alone | PASS (estimate) | About 22 minutes and 14 steps in the documented order, medium confidence. In the wrong order about 45 minutes and a third key. If she had published a DNS record, the docs do not cover it (INE-L1-05) |

**6 of 8 passed.**

## Findings

```json
[
  {
    "id": "INE-L1-01",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "The revoked verdict says a key was 'revoked by its holder' when it was revoked by cascade, and the cascade never names the key it killed",
    "expected": "A key revoked because it was adopted through the revoked key reads as such ('revoked because it was adopted through revoked key <kid>'), and 'revocation recorded (N entries)' names each kid that died.",
    "got": "The attacker's key X (adopted in the stale window) and, in the wrong order, the clinic's clean new key B both read 'invalid revoked ... The key that made this signature has been revoked by its holder'. Neither was ever revoked by anyone. The line before says only '(2 entries)'. Same wording on the Desk.",
    "evidence": ["src/core/verify.ts:126-133", "src/core/verify.ts:203", "src/core/revoke.ts:76-96", "src/cli/commands.ts:340-351", "site/strings.js:149", "site/desk.js:774"],
    "code_check": "revokedResult has one sentence for every revoked entry; spreadRevocations marks adoptedVia successors with the same revokedAt and no provenance. Branches: self-revoked key, clean; cascaded successor, false; Desk tombstone, clean; rotation successor-revoked (rotate.ts:267-274), clean, its own sentence. Ran: stale adopt then verify gives 'revocation recorded in pharmacy/stale.trust.json (2 entries)' then 'invalid revoked kid=9aa82c50dfa8ea55 ... revoked by its holder'.",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "high: play attacker-rotates on a pharmacy trust file copied before the revocation, adopt --yes, then verify the clinic and the mirror. Read the CLI line and the Desk (after importing that trust file) for the cascaded key. Needs the northgate-clinic world, or two loopback sites."
  },
  {
    "id": "INE-L1-02",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "broken-flow",
    "severity": "major",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "high" },
    "dimension": "completion",
    "title": "Rotating before revoking burns the new key at every verifier that adopted it, and no command says so",
    "expected": "rotate's output and usage say it is for planned changes only, and not after a leak. revoke warns when the site's plumbline-rotation.json names a successor of the key being revoked ('verifiers that adopted <B> through it will refuse <B>: make another key'). sign warns when its key was adopted through a key the site revokes.",
    "got": "rotate prints 'rotation A -> B / wrote / next: publish the new key record, then run sign'. revoke never reads the rotation file. sign with B succeeds, exit 0. The pharmacy then gets 'invalid revoked kid=<B> ... revoked by its holder'. trust B gives 'a revoked key is never trusted again: ask the publisher for its new key', said to the publisher about her new key.",
    "evidence": ["src/cli/commands.ts:73", "src/cli/commands.ts:781-785", "src/cli/commands.ts:789-842", "src/cli/commands.ts:200-212", "src/cli/trust-command.ts:60-62", "docs/signature-format.md:323", "docs/signature-format.md:429-432"],
    "code_check": "Ran: rotate A->B, sign B, adopt --yes at the pharmacy, revoke A, verify, trust B. Outputs as in walkthrough step 20. The docs (signature-format.md:323, 330-332, 429-432) do state the rule and the cascade, so the security outcome is correct and documented. The gap is that no command tells her at the moment she errs.",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "med: replay the wrong order against the world's clinic and pharmacy, and confirm no warning at rotate, revoke or sign. No special environment."
  },
  {
    "id": "INE-L1-03",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "The CLI calls a signer it records as revoked 'unknown'; the Desk calls the same signature invalid revoked",
    "expected": "The same trust list gives the same verdict on both surfaces. A signature or rotation by a kid recorded as revoked at any origin is 'invalid revoked' (the docs: 'a revocation recorded anywhere counts everywhere').",
    "got": "A mirror signed with the stolen key for the attacker's own origin, after the pharmacy recorded the revocation: the CLI says 'unverifiable ... The signature is internally consistent but the signer is unknown'. adopt --url of the mirror says 'The old key that signed this rotation is unknown to this verifier'. The Desk applies knownRevoked and says invalid revoked.",
    "evidence": ["src/core/verify.ts:248-261", "src/core/rotate.ts:105-113", "src/cli/files.ts:201-203", "site/desk.js:771-774", "site/README.md:110-112", "docs/signature-format.md:163-165"],
    "code_check": "trustStoreOf.find matches kid AND origin, so spreadRevocations only reaches origins the verifier has an entry for. The Desk adds a kid-wide check after core; the CLI has none. Both refuse (exit 1, not green), but the CLI's sentence is false and the two opinions differ. Ran: mirror2 signed for https://northgate-c1inic.example.",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "high: with the world's forgery act, check which origin the mirror is signed for. Verify it with the CLI and with the Desk on the same trust file (Desk import), and compare the verdict and words. Needs the Desk served and able to fetch loopback."
  },
  {
    "id": "INE-L1-04",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "verify writes the revocation into the trust file and then exits 2 saying only that the signature was not found",
    "expected": "When verify records a revocation and then fails to read the signature, it still prints 'revocation recorded in <file> (N entries)' before the error.",
    "got": "On a site that serves plumbline-revocation.json but no signature (plausible mid-incident, while the old signature is taken down), it prints 'plumbline verify: plumbline.signature.json not found in oob', exit 2. The trust file now carries revokedAt, unannounced.",
    "evidence": ["src/cli/commands.ts:523-528", "src/cli/commands.ts:531-533", "src/cli/index.ts:45-55"],
    "code_check": "applyRevocationToTrust(..., true) writes at line 527; the throw at 532 discards the report lines built later (618). Ran: folder with only the revocation; the trust file gained revokedAt. The write itself is correct (it only takes trust away); the silence is the defect. adopt has the same shape with --yes (trust-command.ts:239 before 242).",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "med: remove the signature from the clinic's served folder after publishing the revocation, run verify --url --allow-local from the pharmacy, and diff the trust file."
  },
  {
    "id": "INE-L1-05",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "high" },
    "dimension": "senior-quality",
    "title": "The bad-day runbook never mentions the DNS record, so DNS keeps vouching for the stolen kid",
    "expected": "The revocation steps (docs and revoke's 'next:' line) say to remove the revoked kid's _plumbline TXT record and add the new kid's. 'plumbline dns' says one record per key 'during a rotation', not after a revocation.",
    "got": "docs/signature-format.md:398-406 and the revoke output omit DNS. The dns command says 'During a rotation, publish one record per key until verifiers have moved'. A publisher who keeps A's record leaves DNS saying 'agrees' for the stolen key to any fresh verifier whose web host the thief controls, which is the attack DNS exists to expose. If A's record is replaced only later, trust --url --yes for B is refused ('DNS names another key').",
    "evidence": ["docs/signature-format.md:398-406", "src/cli/commands.ts:838-839", "src/cli/trust-command.ts:214-218", "docs/trust-bootstrap.md:16-18", "docs/trust-bootstrap.md:43-47", "src/cli/trust-command.ts:96-115"],
    "code_check": "Read only: no zone here (env.md). trustDecision refuses on disagreement and adds on agreement plus --yes; trust --url never reads the site's revocation file (trust-command.ts:130-143).",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "med: precondition is an injected TXT resolver (as in src/test/dns.test.ts), since the world has no zone. Arm 1: the record still names A after the revocation, so a fresh verifier's trust --url of a host serving A's record agrees. Arm 2: it names A only, so trust --url --yes for B is refused. Judge whether the docs lead her out of each. Otherwise resolve uncertain, not reproducible here."
  },
  {
    "id": "INE-L1-06",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "No help, and nothing in the CLI says which commands are the publisher's and which the verifier's",
    "expected": "`plumbline --help` (and `<command> --help`) list commands under 'publisher' (keygen, sign, revoke, rotate, dns, export-jws) and 'verifier' (trust, verify, adopt), each with one line on what it changes.",
    "got": "'plumbline: unknown command: --help' and a flat list of 14 commands. 'trust --help' gives 'unknown option: --help' plus the usage line. The README's verifier block mixes trust, verify, gate and adopt, and the README never shows revoke.",
    "evidence": ["src/cli/index.ts:39-42", "src/cli/commands.ts:67-79", "README.md:44-56", "docs/signature-format.md:489-499", "docs/signature-format.md:20-27"],
    "code_check": "Ran: --help, help and trust --help, as quoted. The best role split is the Files table's 'Who writes it' column (signature-format.md:20-27), which is not in any help.",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "low: confirm with a cold read of the README and the help that the roles cannot be told apart without signature-format.md."
  },
  {
    "id": "INE-L1-07",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "After every revocation, verify prints a line that starts 'verified kid=<the stolen kid>'",
    "expected": "The revocation sub-line names what verified: 'revocation statement verified for kid=<A> ...' or 'key <A> revoked'. The verdict word 'verified' is never set beside a revoked key.",
    "got": "'  verified kid=8319bbfb9d16d9e6 origin=https://northgate-clinic.example - A key this verifier trusts has revoked itself: nothing signed by it is accepted any more.' This prints on every verify while the site serves the revocation, and in adopt.",
    "evidence": ["src/cli/commands.ts:340-346", "src/cli/commands.ts:356-363", "src/core/revoke.ts:152-157", "src/cli/trust-command.ts:251"],
    "code_check": "revocationLines maps each applyRevocation result through formatResult, the signature verdict formatter. The Desk shows only the detail sentences (site/desk.js:1504), so this is CLI only.",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "low: confirm in the world's pharmacy log; grep 'verified kid=<A>' across a bad-day transcript."
  },
  {
    "id": "INE-L1-08",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "senior-quality",
    "title": "invalid tampered does not say which signed file changed",
    "expected": "The line (and --json) names the signed path that differs or is missing. These paths are already held to the safe-subject pattern, so quoting them repeats no free text.",
    "got": "'invalid tampered ... - A signed file differs from the version that was signed.' The --json result has no path. The Desk lists every signed file but not which one failed.",
    "evidence": ["src/core/verify.ts:209-213", "src/core/verify.ts:94-103", "site/desk.js:1497"],
    "code_check": "The subject path is known at verify.ts:208-212 and passes isSafeSubjectPath at shape time; the detail is fixed text. Ran the tamper act, output as quoted.",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "low: play the tamper act and see whether the Desk or CLI output lets her name the file without hashing by hand."
  },
  {
    "id": "INE-L1-09",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "senior-quality",
    "title": "CLI verdict lines omit what an incident note needs: the limits of verified, the dates, and the origin checked",
    "expected": "verified carries its limit ('not a statement that the site is safe') and expiresAt; expired says when; an origin mismatch says the address checked and does not call a mismatched copy 'may be genuine' without saying it is not attested.",
    "got": "'verified ... The files match a signature made by a key this verifier already trusts for this origin.' gives no limit and no expiry. 'invalid expired' gives no date. Origin mismatch: 'The files may be genuine but are not attested ...' with origin= showing the signed origin, and the checked origin printed nowhere. The Desk shows the verdict's meaning and 'Files fetched from'.",
    "evidence": ["src/core/verify.ts:237-245", "src/core/verify.ts:222-224", "src/core/verify.ts:163-171", "src/cli/commands.ts:511", "src/cli/commands.ts:356-363", "site/strings.js:33", "site/desk.js:1487", "site/desk.js:1496"],
    "code_check": "Wiring: expectedOrigin is computed for the run and never printed by the CLI. The Desk renders r.meaning and fetchedFrom; the CLI has no meaning line.",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "med: put the CLI and Desk outputs for the verified, expire and forgery acts side by side and judge them as incident-note text."
  },
  {
    "id": "INE-L1-10",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "trust --url adds a key that the same site publishes a revocation of; the Desk refuses to offer it",
    "expected": "trust --url reads the site's plumbline-revocation.json and refuses (or at least warns) when it revokes the key record it is offering, as the Desk's keyRevokedBySite does.",
    "got": "A fresh verifier, after the clinic revoked A but before the old key record was replaced: 'kid 8319bbfb9d16d9e6 ... added to u/fresh.trust.json', exit 0. The next verify revokes it ('revocation recorded ... invalid revoked').",
    "evidence": ["src/cli/trust-command.ts:130-143", "site/desk.js:776-783", "site/strings.js:157"],
    "code_check": "Ran it against the loopback clinic, output as quoted. It self-heals on the next verify only while the site still serves the revocation.",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "low: replay it in the world between the revoke and the re-sign."
  },
  {
    "id": "INE-L1-11",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "missing",
    "title": "Nothing records when a key was trusted or adopted, so she cannot prove afterwards what was trusted when",
    "expected": "trust and adopt stamp the time an entry was added (or keep a log), and a command lists the trust file with those dates.",
    "got": "Entries are {kid, origin, publicKey, revokedAt?, adoptedVia?}. Only revocation carries a time. There is no list command; she reads the JSON.",
    "evidence": ["src/cli/files.ts:189-195", "docs/signature-format.md:139-148", "src/cli/trust-command.ts:155", "src/core/rotate.ts:146"],
    "code_check": "Read. A new member would be wire-contract work (types.ts and check:wire), so this is a design choice for the owner, not a bug.",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "low: none beyond confirming the trust file after the journey."
  },
  {
    "id": "INE-L1-12",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "effort",
    "title": "Before first contact, verify cannot say unverifiable: with no trust file it exits 2",
    "expected": "A missing trust file reads as an empty one for verify, as it does for trust; or the error says how to make one.",
    "got": "'plumbline verify: trust store not found: pharmacy/plumbline.trust.json', exit 2. trust without --yes writes nothing, so she hand-writes {\"version\":1,\"entries\":[]}.",
    "evidence": ["src/cli/commands.ts:515-516", "src/cli/files.ts:163-169", "src/cli/trust-command.ts:151"],
    "code_check": "readTrustFile treats a missing file as empty only with missingIsEmpty, which trust sets and verify does not.",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "low: the world's 'pharmacy has an empty trust file' act may already ship a file; note whether it does."
  },
  {
    "id": "INE-L1-13",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "CLI revoke gives no preview and never says the revocation is final; the Desk says 'it cannot be taken back'",
    "expected": "revoke says the revocation is final at every verifier who reads it (no un-revoke, the key is never trusted again), and to tell verifiers directly, as the docs say.",
    "got": "'revoked <kid> at <t> / wrote ... / next: publish it ...'. It writes at once with no --yes. Finality and 'tell your verifiers directly' are only in docs/signature-format.md:436-439 and the Desk string.",
    "evidence": ["src/cli/commands.ts:834-839", "site/strings.js:240", "docs/signature-format.md:436-439"],
    "code_check": "The write is to the local site folder, so publishing is the real point of no return; the output never says that either.",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "low: none."
  },
  {
    "id": "INE-L1-14",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "A verifier told of a revocation out of band has no command to record it",
    "expected": "A verifier holding a revocation file (sent by the publisher because the site is down or held by the thief) records it with one command, for example 'trust --revocation <file>'.",
    "got": "The docs tell the publisher to 'tell verifiers directly' but give the verifier nothing to run. The working path is an undocumented side effect: verify --root on a folder holding only the revocation records it and exits 2 (see INE-L1-04). Otherwise she hand-edits revokedAt.",
    "evidence": ["docs/signature-format.md:436-439", "src/cli/commands.ts:523-533", "src/cli/trust-command.ts:122-195"],
    "code_check": "Ran: folder with only plumbline-revocation.json, then verify --root; revokedAt was written, exit 2.",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "low: none."
  },
  {
    "id": "INE-L1-15",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "polish",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "verify's adopt hint appears for a rotation whose from-key this trust file records as revoked",
    "expected": "No adopt hint when the rotation starts from a key recorded as revoked, or a hint that says adopt will refuse it.",
    "got": "'hint: plumbline-rotation.json is present; if you trust a key it rotates from, check it with plumbline adopt ...' over the attacker's mirror after the revocation was recorded; adopt then refuses.",
    "evidence": ["src/cli/commands.ts:619-627"],
    "code_check": "The hint checks only that the rotation file is present and the verdict is unverifiable.",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "low: none."
  },
  {
    "id": "INE-L1-16",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "low", "reachability": "med", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "export-jws signs with a key the site's own revocation revokes, where sign and rotate refuse",
    "expected": "export-jws refuses a key that the root's plumbline-revocation.json revokes, as sign and rotate do.",
    "got": "With revoked key A on the revoked clinic, export-jws printed a JWS, exit 0. Verifiers would refuse it as invalid revoked.",
    "evidence": ["src/cli/commands.ts:641-674", "src/cli/commands.ts:200-212", "src/cli/commands.ts:704-711"],
    "code_check": "Ran it. No revocation check in exportJws.",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "low: none."
  },
  {
    "id": "INE-L1-17",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "low", "reachability": "low", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "The Desk's revoke offers a one-statement file, so publishing it over an existing list drops earlier revocations",
    "expected": "Like the CLI (p-c30007), the Desk lets the visitor add to an existing revocation file, or warns that the download replaces it.",
    "got": "revokeWithKeyFile offers JSON.stringify(statement) only.",
    "evidence": ["site/desk.js:1036-1043", "src/cli/commands.ts:812-836", "docs/signature-format.md:121-127"],
    "code_check": "Read only. Outside her bound path (she revokes with the CLI) and not hit on a first revocation.",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "low: none."
  },
  {
    "id": "INE-L1-18",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "strength": true,
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "First contact is a real ceremony: nothing without --yes, compare character by character out of band, and a revoked kid is refused forever",
    "expected": "A verifier cannot be rushed into trust.",
    "got": "'nothing added: confirm out of band, then rerun with --yes' (exit 1, no file). The WARNING names four channels. Re-trusting the stolen key gives 'records key ... as revoked; a revoked key is never trusted again' (exit 2).",
    "evidence": ["src/cli/trust-command.ts:52-57", "src/cli/trust-command.ts:104-115", "src/cli/trust-command.ts:153"],
    "code_check": "Ran all three.",
    "verdict": "uncertain",
    "resolution": "n-a",
    "l2_priority": "low: protect; the Desk equivalent is the checkbox and Trust button."
  },
  {
    "id": "INE-L1-19",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "strength": true,
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "A revocation, once seen, is recorded and announced, and the forgery is then invalid revoked even from a mirror that hides the revocation",
    "expected": "The pharmacy refuses the forgery for the right reason once it has learned of the revocation.",
    "got": "'revocation recorded in pharmacy/plumbline.trust.json (1 entry)', then 'invalid revoked' for the mirror by --root and --url, with no revocation file on the mirror.",
    "evidence": ["src/cli/commands.ts:319-354", "src/cli/commands.ts:523-528", "src/core/verify.ts:202-203"],
    "code_check": "Ran all of it.",
    "verdict": "uncertain",
    "resolution": "n-a",
    "l2_priority": "med: confirm with the world's forgery act."
  },
  {
    "id": "INE-L1-20",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "strength": true,
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "The attacker's rotation gets them nowhere: adopt is never automatic, a revoked signer is refused even with --yes, and the cascade undoes an adoption made in the stale window",
    "expected": "Criterion 6.",
    "got": "'invalid revoked ... The key that made this rotation has been revoked ...' and 'nothing adopted', exit 1, with --yes. Stale arm: X adopted, then revoked by the cascade on the next verify of the real clinic.",
    "evidence": ["src/cli/trust-command.ts:233-240", "src/core/rotate.ts:98", "src/core/revoke.ts:76-96"],
    "code_check": "Ran both arms.",
    "verdict": "uncertain",
    "resolution": "n-a",
    "l2_priority": "med: confirm with the attacker-rotates act."
  },
  {
    "id": "INE-L1-21",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "strength": true,
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "senior-quality",
    "title": "The publisher commands stop her from re-using the stolen key and say what to do instead",
    "expected": "No way to sign or rotate with a key the site revoked.",
    "got": "sign and rotate with A after the revocation: exit 2, 'make a new key with plumbline keygen, sign with it, and re-establish trust through the first-contact ceremony'. revoke's 'next:' line is a correct three-step runbook. sign warns when the published key record is the old key's.",
    "evidence": ["src/cli/commands.ts:200-212", "src/cli/commands.ts:730-741", "src/cli/commands.ts:838-839", "src/cli/commands.ts:260-268"],
    "code_check": "Ran.",
    "verdict": "uncertain",
    "resolution": "n-a",
    "l2_priority": "low: protect."
  },
  {
    "id": "INE-L1-22",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "strength": true,
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "The docs name their own ceilings: the stale-trust window, a lost key cannot revoke, a successor added by hand escapes the cascade",
    "expected": "Whatever is not covered is said.",
    "got": "'What revocation cannot do' and 'Known limit of version 1: rollback' read like an incident runbook's 'what stays exposed' section.",
    "evidence": ["docs/signature-format.md:434-443", "docs/signature-format.md:297-304", "docs/trust-bootstrap.md:43-47"],
    "code_check": "Read.",
    "verdict": "uncertain",
    "resolution": "n-a",
    "l2_priority": "low: protect."
  }
]
```

## What L2 must check

1. **The forgery act, on both surfaces** (INE-L1-03).
   - Which origin does the world's mirror sign for?
   - Verify it from the pharmacy with the CLI (`--url --allow-local`) and on the Desk after importing the same
     `plumbline.trust.json`, before and after the revocation is recorded.
   - Compare the verdicts and sentences word for word.
2. **The attacker-rotates act, stale arm** (INE-L1-01, INE-L1-20).
   - Use a pharmacy trust file from before the revocation: run `adopt --yes`, then verify the real clinic, then the
     mirror.
   - Read the cascaded key's sentence on the CLI and on the Desk.
3. **The wrong order** (INE-L1-02): rotate, sign, adopt, revoke, verify, trust B. Confirm no warning at any step.
4. **The signature taken down** (INE-L1-04): serve the clinic with the revocation but no signature, run
   `verify --url`, and diff the trust file.
5. **DNS arms** (INE-L1-05): only with an injected TXT resolver. Without one, resolve `uncertain`: not reproducible
   on this host.
6. **The expire and tamper acts:** judge the CLI and Desk sentences as incident-note text (INE-L1-08, INE-L1-09).
7. **Freshness:** `dist/` must be newer than the last commit before L2. It was at this run.

## Character feedback (L1)

"I wrote the runbook from `docs/signature-format.md` in about ten minutes, and on paper it is right: revoke, new key,
sign, publish the key record, call the pharmacy, trust, verify. When I ran it, every step said what it wrote. `sign`
refused the stolen key and told me what to do instead, which is the sort of guard rail I wish my code-signing vendor had
had that weekend. The first-contact step makes me stop and compare the kid. The pharmacy refused the forgery as
`revoked` even from a copy of the site that hid the revocation, and the thief's rotation went nowhere. That is the job.

Then I tried to write the incident note from the output, and it would have been wrong in three places:

- It told me a key was 'revoked by its holder' when nobody had revoked it. It had died because of how it was adopted.
- It called the thief 'unknown' while my own trust file had him down as revoked. The Desk, which I meant to show the
  director as a second opinion, called the same file revoked. I cannot hand a director two different answers.
- Every check after the revocation printed a line beginning 'verified' next to the stolen key's id. That is precisely
  the line someone greps for at 7 a.m.

What frightened me was the order. 'Move to a new key' sounds like `rotate`. If I had rotated first, my clean new key
would have been dead at the pharmacy for good. `revoke` would not have mentioned it, `sign` would still have worked, and
the refusal would have told me to 'ask the publisher for its new key'. I am the publisher. The docs do warn you, but the
command in my hand did not. And there is no `--help`, so on the bad day the only thing that tells me which side a
command belongs to is a table in a 500-line document.

Would I adopt it? Yes, for both organisations. It is far better than a phone call and a hash I compare by eye, and it is
honest about its limits: it says what revocation cannot do, which most security tools never admit. Before I put it in
front of a clinic director I need verdict sentences that never say something untrue about a key, the CLI and the Desk to
agree, a date on every trust entry so I can prove what was trusted when, and a warning at the exact moment I am about to
use the convenient command instead of the safe one. Would I tell a peer? I would tell them it is sound underneath, to
read the revocation section before the bad day rather than during it, and never to rotate after a theft."


---

# L2 (live)

Walker: L2. `npm run build` and `npm run build:site` re-run at 11:25 on 2026-11-18, after the last commit (47ea482,
10:30), so `dist/` and `site/lib/plumbline/` were current. The builds changed no tracked file. World `northgate-clinic`
on ports 4300 (the clinic), 4301 (the mirror) and 4399 (the Desk). I brought it up twice, fresh each time: run 1 in the
documented order, run 2 in the other order. Every CLI line below is `node dist/cli/index.js` against the SERVED sites
with `--url ... --allow-local`, unless `--root` is named. The Desk ran in Playwright 1.65.1 Chromium through
`uat/driver/drive-script.mjs`, one fresh browser per check. Each check imported the pharmacy's
`plumbline.trust.json` through the Desk's own import and confirm buttons, then verified. Shots are in
`shots/ines/l2-desk-*` (`.png`, `.aria.yml`, `.txt`).

Keys: the world's throwaway key A (`<world>/keys/clinic-a`, made by `up`) is the clinic's key, which Ines holds. I used
it by path for `sign`, `revoke` and `rotate`, and never read its content. Ines made keys B and C with `keygen` under
`<world>/ines/`. No key under the repository or the owner's `keys/` folder was touched.

## L2 preflight

| Carried `l2_priority` | Environment precondition | This host | Arm measured on |
| --- | --- | --- | --- |
| INE-L1-01 cascade wording (high) | world `attacker-rotates`, a pharmacy file copied before the revocation, the Desk with import | satisfied | world acts + copied trust file (`ines-stale`), Desk import |
| INE-L1-03 CLI vs Desk on a revoked signer (high) | the mirror signed for an origin where the kid is not trusted; the Desk able to fetch loopback | **partly**: the world's `forgery` signs for the CLINIC's origin, so the verify arm does not arise from the acts. The `adopt --url` arm does | **built**: after the acts, the attacker re-signed the mirror with A for the mirror's own origin (a `sign` in the world folder, restored afterwards). The adopt arm is the world as shipped |
| INE-L1-02 wrong order (med) | none | satisfied | a fresh world (run 2) |
| INE-L1-04 signature taken down (med) | clinic serves the revocation, no signature | **built**: the signature moved aside for two checks, then restored | world + a stale trust file copy |
| INE-L1-05 DNS arms (med) | an injected TXT resolver; env.md lists DNS as not exercisable | **partly built**. The built `trust()` takes `deps.resolveTxt`, but DNS is asked only for a DNS hostname: the world's `127.0.0.1` is an IP literal ('could not ask'). `trust --url http://northgate-clinic.example:4300/` is refused ('http only for localhost and 127.0.0.1'). No built CLI entry point reaches a world host with a resolver | the built `askDns` + `describeDns` + `trustDecision` modules with an injected resolver (six arms), plus `plumbline dns` live. The full CLI path with a real zone stays unexercised |
| INE-L1-06 help and roles (low) | none | satisfied | live help, cold README read |
| INE-L1-07 `verified kid=<A>` (low) | none | satisfied | every pharmacy verify in both runs |
| INE-L1-08, -09 tamper/expire sentences (low, med) | world `tamper`, `expire` | satisfied | world acts, CLI and Desk |
| INE-L1-10 trust between revoke and re-sign (low) | a fresh verifier in that window | satisfied | a fresh trust file in run 1 |
| INE-L1-12 missing trust file (low) | the world ships an empty file | the world ships one, so the CLI arm is not hit | control arm with a missing file |
| INE-L1-14 out-of-band revocation | an emailed revocation file | satisfied | a folder holding only the clinic's revocation |
| INE-L1-17 Desk revoke file | the Desk's `#/key` revoke on a site already holding a revocation | not on her bound path; not exercised | none (uncertain) |
| INE-L1-19, -20, -21, -22 strengths | world acts | satisfied | both runs |
| Freshness | `dist/` newer than the last commit | satisfied (11:25 vs 10:30) | |
| Desk assistant (grounding n/6) | a model key | not in this journey's path; not exercised | n/a |

## L2 journal

I keep two folders, as on my laptop. The clinic is `northgate-clinic/` (its `site/` is what the web server serves). The
pharmacy is `harbour-pharmacy/` (its `plumbline.trust.json`). The world's clinic is at `http://127.0.0.1:4300/`, and
the thief's copy will be at `:4301`.

### Run 1: the documented order (world `...-EhVeNS`, key A = `3f4c72b95ab6f6a1`)

**1. Help.** I typed what I always type first.

```
$ plumbline --help        -> plumbline: unknown command: --help / usage: plumbline <init|watch|diff|gate|badge|keygen|sign|verify|rotate|revoke|trust|adopt|dns|export-jws> [options]   [exit 2]
$ plumbline help          -> plumbline: unknown command: help  (same list)   [exit 2]
$ plumbline revoke --help -> plumbline revoke: unknown option: --help / usage: plumbline revoke --root <site dir> --key <private file> [--reason <text>] [--now <iso>] [--json]   [exit 2]
$ plumbline trust --help  -> unknown option: --help / usage: plumbline trust --file <plumbline.trust.json> (--key ... | --url ...) [--yes] [--json]   [exit 2]
$ plumbline adopt -h      -> unknown option: -h / usage ...   [exit 2]
```

Fourteen words, no sides. The usage lines at least give the flags. Nothing tells me `revoke` is mine as publisher and
`adopt` is the pharmacy's. The README shows no `revoke` at all. So I went to `docs/signature-format.md` and its Files
table ("Who writes it"). (INE-L1-06)

**2. The pharmacy before trust.** The world gives the pharmacy an empty trust file, so I did not have to hand-write one.

```
$ plumbline verify --url http://127.0.0.1:4300/ --allow-local --trust plumbline.trust.json
unverifiable kid=3f4c72b95ab6f6a1 origin=http://127.0.0.1:4300 - The signature is internally consistent but the signer is unknown: this verifier has no trust entry for the key, so it proves nothing about who published the files.   [exit 1]
control, no trust file:  plumbline verify: trust store not found: nonexistent.trust.json   [exit 2]
$ plumbline trust --url http://127.0.0.1:4300/ --allow-local --file plumbline.trust.json
kid 3f4c72b95ab6f6a1 for http://127.0.0.1:4300 / public key mun87Ip... / dns 127.0.0.1: could not ask (the address is an IP literal, which has no DNS name)
WARNING: Compare this kid, character by character, with the one the publisher gave you out of band (...) never with one the site itself shows ...
nothing added: confirm out of band, then rerun with --yes   [exit 1]   (file unchanged)
```

Desk, same empty list (`l2-desk-01-before-trust-1`): "UNVERIFIABLE", the same detail, then "First contact: trust this
publisher?" with three steps, the kid, a checkbox ("I compared this key id, character by character ...") and a button.

**3. Trust and verify.** I compared the kid with the one in the clinic's key record I keep on paper, then ran it again
with `--yes`: "added to plumbline.trust.json", exit 0. Verify: `verified kid=3f4c72b95ab6f6a1 origin=http://127.0.0.1:4300
- The files match a signature made by a key this verifier already trusts for this origin.` exit 0. Running trust again:
"already trusted ... nothing to add", exit 0. The trust entry holds no date. (INE-L1-11)

**4. `tamper`.** CLI: `invalid tampered ... - A signed file differs from the version that was signed.` exit 1, and `--json`
has no path. Desk (`l2-desk-02-after-trust-tampered-1`): "INVALID: A SIGNED FILE CHANGED, OR IS MISSING", then all three
signed files listed, none marked. Neither surface tells me which file. (INE-L1-08)

**5. `expire`.** CLI: `invalid expired ... - The signature has expired and must be renewed by the publisher.` Desk
(`l2-desk-03-expired-1`): "INVALID: THE SIGNATURE HAS EXPIRED". Neither says when. (INE-L1-09) Then, as in real life, I
renewed with A: `signed 3 files as 3f4c72b95ab6f6a1 ... expires 2027-02-16T10:28:20.958Z`, and the pharmacy said
`verified` again.

**6. `forgery`, before anyone knows.**

```
mirror by its own URL:   unverifiable kid=3f4c72b95ab6f6a1 origin=http://127.0.0.1:4300 - The files may be genuine but are not attested for the origin they were checked as: the signature names a different origin (see the result's origin field).   [exit 1]
mirror served at the clinic's address (verify --root <mirror> --origin http://127.0.0.1:4300):   verified kid=3f4c72b95ab6f6a1 ...   [exit 0]
```

The second line is the documented stale-trust window, live: a thief who controls the clinic's host gets `verified`.
The first line calls a copy whose prescriptions agent asks for date of birth and NHS number "may be genuine". Its
`origin=` is the clinic's, and 4301 appears nowhere. The Desk (`l2-desk-04-forgery-prerevoke-2`) shows "Files fetched
from http://127.0.0.1:4301" and a correct notice at the bottom. But its headline says "You have not met this signer
yet, or the site publishes no signature. The files may be fine", about key A, which sits in my trust list on the left
of the same page. (INE-L1-09, new INE-L2-1)

**Here I stopped and wrote the runbook** (below), from the README and `docs/signature-format.md` only.

**7. R1, revoke** (10:28:40).

```
$ plumbline revoke --root site --key <A> --reason "laptop stolen 2026-11-18"
revoked 3f4c72b95ab6f6a1 at 2026-11-18T10:28:41.105Z
wrote site\plumbline-revocation.json
next: publish it at the site base, make a NEW key with keygen, re-sign the site with it, and re-establish trust with your verifiers through the first-contact ceremony. Never rotate from the revoked key: verifiers refuse it.   [exit 0]
again:  already revoked: ... nothing written   [exit 0]
sign with A:  plumbline sign: this key (3f4c72b95ab6f6a1) is revoked by the site's plumbline-revocation.json, so verifiers refuse everything it signs: make a new key with plumbline keygen, ...   [exit 2]
export-jws with A:  eyJhbGciOiJFZERTQSIsImtpZCI6IjNmNGM3MmI5NWFiNmY2YTEifQ..W4ftdKzO...   [exit 0]
```

The "next:" line is my runbook in one sentence. It did not ask me to confirm, and it did not say this is final.
(INE-L1-13) `export-jws` still signs with the dead key. (INE-L1-16)

**8. A pharmacy copy, between revoke and re-sign.** `revocation applied ... / verified kid=3f4c72b95ab6f6a1 ... has
revoked itself ... / revocation recorded in ... (1 entry) / invalid revoked kid=3f4c72b95ab6f6a1 ...`, exit 1.

**9. A fresh verifier in the same window** (INE-L1-10). `trust --url http://127.0.0.1:4300/ --allow-local --yes`
printed "added to fresh.trust.json", exit 0: the CLI trusted the key the site had just revoked. The next verify revoked it
again. The Desk (`l2-desk-05-fresh-between-revoke-resign-1`) said "This site publishes a revocation of the key it signs
with, so the page does not offer to trust that key", and offered no button. The Desk was right and the CLI was not.

**10. R2 to R4.** `keygen` gave `kid ebb2efb758d6682e` and two custody warnings. I signed before copying the record, which
the docs' own wording ("Re-sign the site with it and publish its key record") invites: `WARNING: the
.well-known/plumbline-key.json in site is not the record of the key that signed (ebb2efb758d6682e); publish this key's
record ...`. I copied it and signed again cleanly. Good catch by the tool.

**11. The pharmacy hears of it (V1).**

```
revocation applied: plumbline-revocation.json revokes a trusted key, so nothing that key signs is accepted
  verified kid=3f4c72b95ab6f6a1 origin=http://127.0.0.1:4300 - A key this verifier trusts has revoked itself: nothing signed by it is accepted any more.
revocation recorded in plumbline.trust.json (1 entry)
unverifiable kid=ebb2efb758d6682e origin=http://127.0.0.1:4300 - The signature is internally consistent but the signer is unknown: ...   [exit 1]
```

The trust file gained `"revokedAt": "2026-11-18T10:28:41.105Z"` on A. Run again: "revocation already recorded". The
forgery, both ways: `invalid revoked kid=3f4c72b95ab6f6a1 ... revoked by its holder, so nothing it signs is accepted,
whatever the dates.` exit 1. That sentence is right for A. (INE-L1-19)

**12. Re-establishing trust (V2 to V4).** Without `--yes`: "nothing added". With `--yes`: "added". Then:

```
revocation applied: ...
  verified kid=3f4c72b95ab6f6a1 origin=http://127.0.0.1:4300 - A key this verifier trusts has revoked itself: ...
revocation already recorded in plumbline.trust.json
verified kid=ebb2efb758d6682e origin=http://127.0.0.1:4300 - The files match a signature made by a key this verifier already trusts for this origin.   [exit 0]
```

Two lines in one output match `verified kid=`, and one of them is the stolen key's. (INE-L1-07) Re-trusting A from its
record: "records key 3f4c72b95ab6f6a1 as revoked; a revoked key is never trusted again: ask the publisher for its new
key", exit 2. Good.

**13. `attacker-rotates`** (A -> `4920bb8f5410b106`).

```
verify --url mirror:  hint: plumbline-rotation.json is present; if you trust a key it rotates from, check it with plumbline adopt --url http://127.0.0.1:4301/ ...
                      unverifiable kid=4920bb8f5410b106 origin=http://127.0.0.1:4300 - The files may be genuine ...   [exit 1]
adopt --url mirror [--yes]:  unverifiable kid=3f4c72b95ab6f6a1 origin=http://127.0.0.1:4301 - The old key that signed this rotation is unknown to this verifier, ...
                             nothing adopted: only a rotation signed by a key you already trust, unrevoked, for this origin is adopted   [exit 1]
adopt --root mirror --origin <clinic> --yes:  invalid revoked kid=3f4c72b95ab6f6a1 ... The key that made this rotation has been revoked by its holder ... / nothing adopted   [exit 1]
```

The hint sends me to a command that answers "unknown" about a key my own file has down as revoked. The refusal is right,
but the reason is false. (INE-L1-15, INE-L1-03) The trust file's md5 did not change.

**14. The stale arm** (a pharmacy file copied before step 11). `adopt --root <mirror> --origin <clinic>` said "verified
... named its successor ... nothing adopted: adopting a successor is your decision; rerun with --yes". With `--yes`:
"adopted 4920bb8f5410b106 ... recorded as adopted via 3f4c72b95ab6f6a1", and the forgery then verified. Then that
pharmacy verified the real clinic: "revocation recorded in plumbline.trust.json (2 entries)". The mirror became `invalid
revoked kid=4920bb8f5410b106 ... has been revoked by its holder`, by `--root` and by URL. The cascade works. But nobody
revoked 4920bb8f: it died through A, "(2 entries)" never names it, and its `revokedAt` reads 10:28:41, about two minutes
before it was adopted. The Desk, from the same file (`l2-desk-08-stale-after-cascade-1`), uses the same "revoked by its
holder" words, and the trust-list chip on the attacker's key says "FORGET IT, AND TRUST THE PUBLISHER'S NEW KEY THROUGH
FIRST CONTACT". (INE-L1-01, INE-L1-11) Imported before the cascade and pointed at the real clinic
(`l2-desk-09-stale-adopted-then-clinic-1`), the Desk revoked both A and the attacker's key. Its cascade matches the CLI's.
(INE-L1-20)

**15. The thief signs for his own address** (built arm, INE-L1-03). I re-signed the mirror with A for
`http://127.0.0.1:4301`, without its rotation file. Pharmacy file: A revoked at 4300, B trusted.

```
CLI:   unverifiable kid=3f4c72b95ab6f6a1 origin=http://127.0.0.1:4301 - The signature is internally consistent but the signer is unknown: this verifier has no trust entry for the key, ...   [exit 1]
       --json: {"verdict":"unverifiable","kid":"3f4c72b95ab6f6a1","origin":"http://127.0.0.1:4301",...}
Desk:  INVALID: THE KEY THAT SIGNED IT HAS BEEN REVOKED BY ITS HOLDER, SO NOTHING IT SIGNS IS ACCEPTED, WHATEVER THE DATES   (l2-desk-10-mirror-own-origin-A-1)
```

I re-checked both twice (`l2-desk-10a-recheck-1`, `l2-desk-10b-recheck-1`): three out of three the same. On the same
file, my two opinions disagree. The CLI's "unknown" is false about a key my file records as stolen. Then I restored the
mirror.

**16. The signature taken down** (INE-L1-04). The signature was moved aside with the revocation still served, and the
pharmacy's file was from before the revocation.
`plumbline verify: plumbline.signature.json not found in http://127.0.0.1:4300/`, exit 2. md5 before `69df2bb3...`,
after `c7b37a1f...`: the file now carries `revokedAt`, and the command said only that it failed. `--json`: only
`{"error": ...}`. The Desk in the same state (`l2-desk-11-takedown-1`): "This site publishes no
plumbline.signature.json" and "It is now marked revoked in your trust list". The Desk tells me what it changed and the
CLI does not.

### Run 2: rotate before revoke (a fresh world `...-wyu9jr`, key A = `6e682ef5fda03dda`)

**17. "Move to a new key."** First contact as before (`verified`), then `forgery`. Then, without the docs (10:32:14):

```
$ plumbline keygen --out <ines>/clinic-key-b        -> kid 35e8650a4b055f85
$ plumbline rotate --root site --old-key <A> --new-key <B>
rotation 6e682ef5fda03dda -> 35e8650a4b055f85
wrote site\plumbline-rotation.json
next: publish the new key record, then run sign with the new key so the site is signed by it.   [exit 0]
$ (copy B's record) plumbline sign --root site --key <B> ...   -> signed 3 files as 35e8650a4b055f85 ...   [exit 0]
```

Nothing here says "not after a leak". (INE-L1-02)

**18. The pharmacy follows the hint.** Verify: `hint: ... plumbline adopt --url http://127.0.0.1:4300/ ...` and
`unverifiable kid=35e8650a4b055f85`. adopt: "verified ... named its successor", then with `--yes` "adopted 35e8650a4b055f85
..., recorded as adopted via 6e682ef5fda03dda". Verify: `verified kid=35e8650a4b055f85`. **Meanwhile the forgery at the
clinic's origin is still `verified kid=6e682ef5fda03dda`**: rotating did not retire A anywhere. After
`attacker-rotates`, a copy of this pharmacy file was offered the thief's rotation from the same A: "verified ... A key this
verifier already trusts for this origin named its successor ... successor 230cec299eda2822". With `--yes` it was
adopted, and the file then held two different successors of A: `35e8650a4b055f85 via 6e682ef5fda03dda` and
`230cec299eda2822 via 6e682ef5fda03dda`. No word about a fork. (new INE-L2-2)

**19 and 20. Then I read the docs and revoked A.** `revoke`: the same generic "next:" line, nothing about the rotation file
that names B. `sign` with B, as a renewal: "signed 3 files as 35e8650a4b055f85", exit 0, no warning. The pharmacy:

```
revocation recorded in plumbline.trust.json (2 entries)
invalid revoked kid=35e8650a4b055f85 origin=http://127.0.0.1:4300 - The key that made this signature has been revoked by its holder, ...   [exit 1]
$ plumbline trust --url http://127.0.0.1:4300/ --allow-local --file plumbline.trust.json --yes
plumbline trust: plumbline.trust.json records key 35e8650a4b055f85 as revoked; a revoked key is never trusted again: ask the publisher for its new key   [exit 2]
```

I am the publisher, B is my new key, and I never revoked it. The forgery and the attacker's rotation were then refused
correctly (`invalid revoked`, "nothing adopted").

**21. The Desk agrees, word for word** (`l2-desk-12-wrongorder-B-burned-1`): "INVALID: THE KEY THAT SIGNED IT HAS BEEN
REVOKED BY ITS HOLDER" for B, and both A and B carry the "REVOKED ... trust the publisher's new key" chip.

**22. Recovery.** `keygen` gave key C `432cd67da602f899`. I copied its record, signed, and made a second first-contact call
to the pharmacy. Its verify printed the revocation lines, then `hint: plumbline-rotation.json is present; ... adopt`,
because the A->B rotation file is still published and nothing told me to remove it, then `unverifiable` for C. trust
C `--yes`, verify: `verified kid=432cd67da602f899`, beneath another `verified kid=6e682ef5fda03dda` revocation line. B
is now a clean key I can never use with this pharmacy. A fresh verifier that never adopted B would still trust it, so B
must also be retired by hand.

**23. DNS** (INE-L1-05, built arms; see the preflight). I used the built `askDns`, `describeDns` and `trustDecision`,
with an injected resolver, for `northgate-clinic.example`:

```
zone still names A, thief serves A's record:  dns ...: agrees (it names this kid)                    with --yes: add
zone still names A, pharmacy trusts B:         dns ...: disagrees (it names 3f4c72b95ab6f6a1, ...)   with --yes: refuse - nothing added: DNS names another key for this host ... Ask the publisher which kid is theirs (during a rotation they publish both); ...
zone names A and B (the dns command's advice): A: agrees (it names this kid among 2) -> add;  B: agrees -> add
zone replaced with B only:                     A: disagrees -> refuse;  B: agrees -> add
```

Only the last arm protects anyone, and no page of the docs tells me to do it after a revocation.

**24.** `plumbline dns --key <B record> --origin https://northgate-clinic.example` printed `_plumbline.northgate-clinic.example TXT
"v=plumbline1; kid=ebb2efb758d6682e" / Publish it in the site's DNS zone. During a rotation, publish one record per key
until verifiers have moved.` Nothing about revocation.

**25. A revocation sent by e-mail** (INE-L1-14). `trust --file ... --revocation emailed/plumbline-revocation.json`
gave "unknown option: --revocation", exit 2. `verify --root emailed --origin <clinic>` gave "plumbline.signature.json not found in
emailed", exit 2, and the trust file silently gained two `revokedAt` (A and the adopted B).

**26. The forgery after the revocation, both surfaces** (run 2: the mirror re-signed with A for the clinic's origin, as
the `forgery` act makes it): CLI `invalid revoked kid=6e682ef5fda03dda`, and the Desk
(`l2-desk-13-forgery-after-revoke-1`) "INVALID: THE KEY THAT SIGNED IT HAS BEEN REVOKED BY ITS HOLDER". They agree.

**27. The JWS.** From the pharmacy: `export-jws` gave "missing --root / usage: plumbline export-jws --root <site dir> --key
<plumbline.private.json> ...". With the downloaded public record as `--key`: "not a Plumbline private key file:
clinic-key.json", exit 2. The usage line says "private" before I try, and `docs/jws-profile.md` says why ("making a JWS
needs the private key"). From the clinic with B: "wrote .../clinic.jws (detached JWS, EdDSA, kid ebb2efb758d6682e)",
and the pharmacy's `verify --jws` says `verified`. Nothing in my world speaks JOSE, so it is for someone else's verifier.
It is harmless, except that it signed with the revoked key in step 7.

### The runbook, written from the docs before the bad day, then marked

```
PUBLISHER (clinic)
 R1. revoke --root site --key <A> --reason "..."; publish plumbline-revocation.json            OK
 R2. keygen --out <B dir>; note kid B                                                          OK
 R3. copy B's .well-known/plumbline-key.json into site/                                       OK. The docs word it "re-sign ... and publish its key record" (sign first); sign's WARNING catches that order
 R4. sign --root site --key <B> --origin <clinic>                                             OK
 R5. NEVER rotate from A                                                                       OK. Run 2 proved it: the cost is a third key and a second call
 R6. phone every verifier with kid B                                                           OK, but MISSING: the verifier has no command for an e-mailed revocation (step 25); it learns only by verifying the live clinic
 R7. DNS: ??? (guess: replace A's record with B's)                                             MISSING in the docs. The guess is right, but the dns command's "publish one record per key" would keep DNS agreeing with the thief (step 23)
VERIFIER (pharmacy)
 V1. verify --url <clinic>: expect "revocation recorded (1 entry)", then unverifiable for B    OK, but the output also prints "verified kid=<A>" (step 11)
 V2-V3. trust --url <clinic>, compare, --yes                                                    OK
 V4. verify: expect "verified kid=<B>"                                                         OK, with a second "verified kid=<A>" line above it
 V5. verify --url <mirror>: expect invalid revoked                                              OK for the world's forgery. WRONG if the thief signs for his own address: the CLI says "unverifiable ... signer is unknown" (step 15)
 V6. adopt --url <mirror>: expect refused, invalid revoked                                      Refused, but WRONG reason: "unknown to this verifier" (step 13). Only adopt --root <copy> --origin <clinic> says invalid revoked
CONFIRM: A carries revokedAt; B has no adoptedVia; V4 verified; V5 invalid revoked              OK
INCIDENT NOTE: paste the verdict words                                                          WRONG: three of the sentences cannot be pasted as they stand ("verified kid=<A>", "revoked by its holder" on cascaded keys, "unknown")
EXPOSED: verifiers that have not fetched the revocation                                         OK (step 6, live). MISSING: a fresh verifier can trust A between revoke and re-sign (step 9)
UNDO: none; revoke is final                                                                     OK, but only the docs and the Desk say so, not revoke's output
MISSING ENTIRELY: if I rotated by mistake, B is burned at every verifier that adopted it; delete the rotation file (or the hint keeps inviting adopt).
```

Of 16 lines: 6 right as written, 6 right but missing something or carrying a surprise, 3 wrong (V5, V6, the incident note) and
1 the docs could not answer (R7). Plus one line missing entirely (the wrong-order recovery).

### CLI versus Desk, the same trust list, the same site

| # | Case (trust list) | CLI | Desk | Agree? |
| --- | --- | --- | --- | --- |
| 1 | clinic, empty list | `unverifiable` "signer is unknown" | UNVERIFIABLE, same detail, first-contact panel | yes |
| 2 | clinic, A trusted | `verified` (no limit, no expiry) | VERIFIED, "It does not mean the site is safe, honest or correct" | verdict yes; only the Desk states the limit |
| 3 | `tamper` | `invalid tampered`, no file | INVALID: A SIGNED FILE CHANGED, OR IS MISSING; all files listed | yes (neither names the file) |
| 4 | `expire` | `invalid expired`, no date | INVALID: THE SIGNATURE HAS EXPIRED | yes (neither dates it) |
| 5 | forgery by its URL, before revocation | `unverifiable` "may be genuine", `origin=` the clinic's, 4301 nowhere | UNVERIFIABLE, "You have not met this signer yet ... The files may be fine", fetched from 4301, correct notice | verdict yes; the Desk's headline is false (INE-L2-1) |
| 6 | fresh verifier between revoke and re-sign | `trust --url --yes` ADDS A | refuses to offer trust: "publishes a revocation of the key it signs with" | **no** (INE-L1-10) |
| 7 | clinic signed by B, A trusted (first sight of revocation) | revocation lines incl. `verified kid=<A>`, "(1 entry)", `unverifiable` B | "that key revoked itself. It is now marked revoked", UNVERIFIABLE B, first-contact panel | verdict yes; CLI wording worse (INE-L1-07) |
| 8 | clinic, A revoked + B trusted | `verified` B (+ `verified kid=<A>` line) | VERIFIED B + revocation box | yes |
| 9 | rotated mirror by URL | `unverifiable` origin mismatch + adopt hint | UNVERIFIABLE origin mismatch, no hint | yes |
| 10 | stale + attacker adopted, mirror by URL | `unverifiable` origin mismatch | same | yes |
| 11 | stale after cascade, mirror by URL | `invalid revoked` 4920bb8f "revoked by its holder" | same words; chip "trust the publisher's new key" | yes, both false (INE-L1-01) |
| 12 | mirror signed with A for its own origin, A revoked at 4300 (built) | `unverifiable` "signer is unknown" (x3) | INVALID revoked (x3) | **no** (INE-L1-03) |
| 13 | signature taken down, stale list | exit 2 "not found"; file silently gains `revokedAt` | UNVERIFIABLE "publishes no signature" + "now marked revoked" | **no** in what each says it did (INE-L1-04) |
| 14 | wrong order: B adopted then A revoked | `invalid revoked` B "revoked by its holder" | same words | yes, both false (INE-L1-01, -02) |
| 15 | forgery after revocation, by URL | `invalid revoked` A | INVALID revoked A | yes |

Three disagreements. In each, the Desk is the more correct one.

**Time, as Ines.** Run 1 (documented order): help and the README, 3 minutes. Writing the runbook from the 500-line
document, about 12 minutes. That is once, before the bad day, and it is where the time goes. The bad day itself is 13
steps (revoke, keygen, a slipped sign, record, sign, call, verify, trust twice, verify, the mirror, adopt, the incident
note). The commands answer in under a second, so about 20 minutes of my time, 5 of them rewriting the three sentences
I cannot paste. Run 2 (wrong order): 24 steps and about 45 to 50 minutes. That includes a second call to the pharmacy,
re-reading the revocation section to understand why my new key was "revoked by its holder", key C, and a dead key B to
retire by hand.

## What this journey must answer (L2 answers)

- **Roles in the help, README and command names.** They cannot be told apart. `--help` and `help` are unknown
  commands, and `<command> --help` is an unknown option. The README never shows `revoke`. Only the Files table in
  `docs/signature-format.md` says who writes what. (INE-L1-06)
- **The first-contact ceremony.** She is told to compare the kid "character by character" with the one the publisher
  gave "out of band (in person, on a call, in a signed message or a repository you already trust)". Nothing is added
  without `--yes`, and the Desk adds a checkbox. DNS answers "could not ask" for every world host. The built arms show it
  adds evidence, never trust. A disagreement refuses `--yes`. After a revocation it vouches for the stolen key unless
  the zone is replaced with the new kid alone, which no document says. (INE-L1-18, INE-L1-05)
- **Each verdict, distinct and fit for a note.** The verdicts are distinct: `unverifiable` (stranger; origin mismatch),
  `verified`, `invalid tampered`, `invalid expired`, `invalid revoked`. Four sentences are not fit to paste: `verified
  kid=<stolen>`, "revoked by its holder" on keys that died by cascade, "unknown" for a recorded-revoked kid, and "may be
  genuine" over a forgery (plus the Desk's "You have not met this signer yet"). Tamper names no file, and expiry gives no
  date. (INE-L1-01, -03, -07, -08, -09, INE-L2-1)
- **The order on the bad day.** It is documented unambiguously (revoke, new key, re-sign, first contact; "Do not rotate
  after a leak"), and revoke's "next:" line repeats it. In the other order, `rotate` says nothing, the forgery keeps
  verifying meanwhile, and the new key is burned at the pharmacy. It costs a third key, a second call and about 25
  extra minutes. Irreversible without a preview: `revoke` (no `--yes`, no word of finality on the CLI) and `adopt
  --yes`, which does preview without `--yes`. (INE-L1-02, -13)
- **How the pharmacy learns of the revocation.** Only by verifying the clinic's live site, or by an undocumented `verify
  --root` on a folder holding the file, which exits 2 and writes silently. Before that, the forgery served at the clinic's
  origin is `verified`, and the thief's rotation is offered for adoption. (INE-L1-14, -22)
- **What `adopt` does with a rotation signed by a revoked key.** It refuses, `--yes` or not ("nothing adopted"). The
  reason given is `invalid revoked` at the clinic's origin, but "unknown to this verifier" by the mirror's URL. A
  rotation adopted during the stale window is revoked by the cascade. (INE-L1-20, INE-L1-03)
- **The Desk as a second opinion.** 12 of 15 cases agree. The three that do not are first contact during the revocation
  window, a revoked key signing for another origin, and the takedown. In all three the Desk is more correct than the
  CLI.
- **The JWS export.** It is for a JOSE verifier she does not have. The usage line says it needs `plumbline.private.json`
  before she tries, and the error from the public record is plain. It still signs with a revoked key. (INE-L1-16)

## L2 scored criteria

| # | Criterion | L1 | L2 | Evidence (journal step) |
| --- | --- | --- | --- | --- |
| 1 | Publisher and verifier commands distinguishable in help and docs | FAIL | **FAIL** (same) | Step 1: no help at all; the README never shows `revoke` |
| 2 | First contact refuses until she confirms; says what to compare and with whom | PASS | **PASS** (same) | Steps 2-3: "nothing added: confirm out of band", exit 1, file unchanged; the Desk's checkbox |
| 3 | `unverifiable` before trust, `verified` after, `invalid` with a reason on tamper | PASS | **PASS** (same) | Steps 2-4, both surfaces. Friction: no file named (INE-L1-08); a missing trust file exits 2 (control arm) |
| 4 | Order unambiguous; each command prints what it changed | PASS | **PASS, narrower** | The documented order held (steps 7-12) and every command on that path printed its write. Not on the path: `verify` writes silently on a takedown (step 16), and the wrong order is unwarned (steps 17-20) |
| 5 | Forgery after revocation refused, reason `revoked` | PASS | **PASS** (same) | Steps 11, 26: `invalid revoked` by URL and by `--root`, CLI and Desk. Caveat: the thief's own-origin signature reads "unknown" on the CLI (step 15) |
| 6 | A rotation signed by the revoked key does not carry the pharmacy to a new key | PASS | **PASS** (same) | Steps 13-14: refused with `--yes`; the cascade undoes a stale-window adoption |
| 7 | Every verdict sentence fit to paste into an incident note | FAIL | **FAIL, wider** | Steps 11, 14, 15, 6: four false or misleading sentences on the CLI, two of them on the Desk too, plus the Desk's "You have not met this signer yet" (INE-L2-1) |
| 8 | The whole incident under 30 minutes from the product's documentation alone | PASS (est.) | **PASS (documented order), medium** | About 20 minutes on the day plus 12 minutes of runbook writing beforehand. 3 of 16 runbook lines were wrong and 1 unanswerable, and none of them blocked the job. The other order: about 45 to 50 minutes |

**6 of 8 passed: no change from L1.** Criterion 4 narrows and criterion 7 widens.

## Findings (L2)

```json
[
  {
    "id": "INE-L1-01",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": {
      "frequency": "med",
      "reachability": "high",
      "trust_erosion": "high"
    },
    "dimension": "trust",
    "title": "The revoked verdict says a key was 'revoked by its holder' when it was revoked by cascade, and the cascade never names the key it killed",
    "expected": "A key revoked because it was adopted through the revoked key reads as such ('revoked because it was adopted through revoked key <kid>'), and 'revocation recorded (N entries)' names each kid that died.",
    "got": "Live, both arms, both surfaces. Stale arm: the attacker's key 4920bb8f5410b106, adopted through A, then 'revocation recorded in plumbline.trust.json (2 entries)' and 'invalid revoked kid=4920bb8f5410b106 ... revoked by its holder'. Wrong order: the clinic's clean key B 35e8650a4b055f85 reads 'invalid revoked ... revoked by its holder'. The Desk says the same words, and its trust-list chip tells her to 'trust the publisher's new key through first contact' about the attacker's key. The cascaded entry's revokedAt is A's time (10:28:41), earlier than the moment the attacker's key was adopted (about 10:30).",
    "evidence": [
      "src/core/verify.ts:126-133",
      "src/core/revoke.ts:76-96",
      "src/cli/commands.ts:340-351",
      "site/strings.js:149",
      "site/desk.js:774",
      "L2 journal step 14 (stale arm, CLI: '(2 entries)' then 'invalid revoked kid=4920bb8f5410b106 ... revoked by its holder')",
      "L2 journal step 20 (wrong order, CLI: 'invalid revoked kid=35e8650a4b055f85 ... revoked by its holder')",
      "shots/ines/l2-desk-08-stale-after-cascade-1 (Desk: 'INVALID: THE KEY THAT SIGNED IT HAS BEEN REVOKED BY ITS HOLDER' for 4920bb8f5410b106; chip 'TRUST THE PUBLISHER'S NEW KEY')",
      "shots/ines/l2-desk-12-wrongorder-B-burned-1 (Desk, same words for B)"
    ],
    "code_check": "present-broken: revokedResult has one sentence for every revoked entry; spreadRevocations copies the source's revokedAt to adoptedVia successors with no provenance. Branches checked live: self-revoked key A (clean), cascaded attacker key (false), cascaded clean B (false), Desk tombstone (not exercised).",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "done at L2."
  },
  {
    "id": "INE-L1-02",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "broken-flow",
    "severity": "major",
    "impact": {
      "frequency": "low",
      "reachability": "high",
      "trust_erosion": "high"
    },
    "dimension": "completion",
    "title": "Rotating before revoking burns the new key at every verifier that adopted it, and no command says so",
    "expected": "rotate's output and usage say it is for planned changes only, and not after a leak. revoke warns when the site's plumbline-rotation.json names a successor of the key being revoked. sign warns when its key was adopted through a key the site revokes.",
    "got": "Live in a fresh world: rotate printed 'rotation 6e682ef5fda03dda -> 35e8650a4b055f85 / wrote site\\plumbline-rotation.json / next: publish the new key record, then run sign with the new key', no word about leaks. While rotated and not yet revoked, the pharmacy still trusts A, so the forgery verifies at the clinic's origin ('verified kid=6e682ef5fda03dda'). revoke then printed its generic 'next:' line with no mention of B. sign with B after the revocation: exit 0, no warning. The pharmacy: '(2 entries)' and 'invalid revoked kid=35e8650a4b055f85 ... revoked by its holder'. trust B: 'a revoked key is never trusted again: ask the publisher for its new key', exit 2. Recovery needed key C (432cd67da602f899), a re-sign and a second first-contact call. The leftover A->B rotation file kept triggering the adopt hint on the pharmacy's verify of C.",
    "evidence": [
      "src/cli/commands.ts:73",
      "src/cli/commands.ts:781-785",
      "src/cli/commands.ts:789-842",
      "src/cli/trust-command.ts:60-62",
      "docs/signature-format.md:323",
      "L2 journal steps 17-22 (wrong order, fresh world, outputs quoted)",
      "shots/ines/l2-desk-12-wrongorder-B-burned-1"
    ],
    "code_check": "confirmed-absent: no command reads the rotation file at revoke time or the trust implications at sign time. The docs state the rule (signature-format.md:323, 330-332, 429-432), and the Desk's key page states it too (site/strings.js:224), so the security outcome is correct and documented. The CLI command in her hand is silent.",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "done at L2."
  },
  {
    "id": "INE-L1-03",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": {
      "frequency": "med",
      "reachability": "high",
      "trust_erosion": "high"
    },
    "dimension": "trust",
    "title": "The CLI calls a signer it records as revoked 'unknown'; the Desk calls the same signature invalid revoked",
    "expected": "The same trust list gives the same verdict on both surfaces. A signature or rotation by a kid recorded as revoked at any origin is 'invalid revoked' (the docs: 'a revocation recorded anywhere counts everywhere').",
    "got": "Two arms. (a) In the world's own acts: following verify's hint, 'adopt --url http://127.0.0.1:4301/' says 'unverifiable kid=3f4c72b95ab6f6a1 origin=http://127.0.0.1:4301 - The old key that signed this rotation is unknown to this verifier', while the same trust file records that kid as revoked. (b) A constructed arm: the attacker re-signs the mirror with stolen key A for the mirror's own origin. On the same trust file, the CLI gives 'unverifiable kid=3f4c72b95ab6f6a1 origin=http://127.0.0.1:4301 - ... the signer is unknown' and the Desk gives 'INVALID: THE KEY THAT SIGNED IT HAS BEEN REVOKED BY ITS HOLDER'. Re-checked: 3 out of 3 the same.",
    "evidence": [
      "src/core/verify.ts:248-261",
      "src/core/rotate.ts:105-113",
      "site/desk.js:771-774",
      "docs/signature-format.md:163-165",
      "L2 journal step 13 (adopt --url of the mirror)",
      "L2 journal step 15 (constructed own-origin signature, CLI and --json)",
      "shots/ines/l2-desk-10-mirror-own-origin-A-1",
      "shots/ines/l2-desk-10a-recheck-1",
      "shots/ines/l2-desk-10b-recheck-1"
    ],
    "code_check": "present-broken: trustStoreOf matches kid AND origin, so a kid revoked at 4300 is a stranger at 4301 for core and the CLI; the Desk adds a kid-wide knownRevoked check. The world's forgery act signs for the clinic's origin, so arm (b) needed one extra sign by the attacker. Arm (a) is reached in the world as it ships.",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "done at L2. A fixture act 'forgery-own-origin' would make arm (b) reproducible without construction."
  },
  {
    "id": "INE-L1-04",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": {
      "frequency": "med",
      "reachability": "high",
      "trust_erosion": "med"
    },
    "dimension": "clarity",
    "title": "verify writes the revocation into the trust file and then exits 2 saying only that the signature was not found",
    "expected": "When verify records a revocation and then fails to read the signature, it still prints 'revocation recorded in <file> (N entries)' before the error, as the Desk does.",
    "got": "Live: the clinic serves the revocation with its signature taken down. A pharmacy trust file from before the revocation: 'plumbline verify: plumbline.signature.json not found in http://127.0.0.1:4300/', exit 2. The file's md5 changed (69df2bb3 -> c7b37a1f) and it now carries revokedAt. --json printed only {\"error\":...}. The Desk in the same state says 'This site publishes no plumbline.signature.json' and 'It is now marked revoked in your trust list'.",
    "evidence": [
      "src/cli/commands.ts:523-533",
      "L2 journal step 16",
      "shots/ines/l2-desk-11-takedown-1"
    ],
    "code_check": "present-broken: the write at commands.ts:527 precedes the throw at 532; the report lines are discarded.",
    "verdict": "confirmed",
    "resolution": "open"
  },
  {
    "id": "INE-L1-05",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "severity_l1": "major",
    "impact": {
      "frequency": "low",
      "reachability": "med",
      "trust_erosion": "high"
    },
    "impact_l1": {
      "frequency": "low",
      "reachability": "high",
      "trust_erosion": "high"
    },
    "dimension": "senior-quality",
    "title": "The bad-day runbook never mentions the DNS record, and the product's own DNS advice keeps DNS vouching for the stolen kid",
    "expected": "The revocation steps (docs and revoke's 'next:' line) say to remove the revoked kid's _plumbline TXT record and publish the new kid's. 'plumbline dns' and trust's DNS refusal do not point her at 'publish both' after a revocation.",
    "got": "Arms built with the built askDns, describeDns and trustDecision and an injected resolver (no CLI entry point can reach a world host: DNS is skipped for the IP literal, and 'trust --url http://northgate-clinic.example:4300/' is refused, 'http only for localhost and 127.0.0.1'). Zone still naming A after the revocation, with a thief serving A's record: 'agrees (it names this kid)', --yes adds. Zone naming A only, pharmacy trusting B: 'disagrees ... Ask the publisher which kid is theirs (during a rotation they publish both)', --yes refused. Zone naming A and B, as 'plumbline dns' advises ('During a rotation, publish one record per key'): A 'agrees ... among 2'. Only a zone replaced with B alone refuses A and agrees with B. Her docs-only runbook could not say which to do (runbook line R7).",
    "evidence": [
      "docs/signature-format.md:398-406",
      "docs/signature-format.md:470-476",
      "docs/trust-bootstrap.md:16-18",
      "src/cli/trust-command.ts:96-115",
      "src/cli/trust-command.ts:214-218",
      "L2 journal step 23 (six DNS arms quoted)",
      "L2 journal step 24 (plumbline dns output)"
    ],
    "code_check": "confirmed-absent: no DNS step in the revocation section, the revoke output or the dns command. The decision logic and wording were exercised at the module level with an injected resolver, as env.md names. The full CLI path with a real zone remains unexercised.",
    "verdict": "confirmed",
    "resolution": "open",
    "scope_note": "Reachability lowered to med: it bites only a publisher who published a _plumbline record. The fixture that would close the CLI path is a world-local name resolving to loopback with an https stand-in, or a resolver injection seam in the CLI entry."
  },
  {
    "id": "INE-L1-06",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": {
      "frequency": "high",
      "reachability": "high",
      "trust_erosion": "low"
    },
    "dimension": "clarity",
    "title": "No help, and nothing in the CLI says which commands are the publisher's and which the verifier's",
    "expected": "`plumbline --help` (and `<command> --help`) list commands under 'publisher' and 'verifier', each with one line on what it changes.",
    "got": "Live: '--help' and 'help' give 'plumbline: unknown command: --help' and the flat usage list, exit 2. 'revoke --help', 'trust --help', 'rotate --help', 'verify --help' and 'adopt -h' give 'unknown option' and a usage line, exit 2. A cold read of the README: the word 'revoke' appears only in the table row 'self-signed revocation for leaks'. There is no revoke example. The verifier block mixes trust, verify, gate and adopt.",
    "evidence": [
      "src/cli/index.ts:39-42",
      "README.md:14",
      "README.md:44-56",
      "docs/signature-format.md:20-27",
      "L2 journal step 1 (eight help invocations quoted)"
    ],
    "code_check": "confirmed-absent.",
    "verdict": "confirmed",
    "resolution": "open"
  },
  {
    "id": "INE-L1-07",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": {
      "frequency": "high",
      "reachability": "high",
      "trust_erosion": "med"
    },
    "dimension": "trust",
    "title": "After every revocation, verify prints a line that starts 'verified kid=<the stolen kid>'",
    "expected": "The revocation sub-line names what verified ('revocation statement by <A> verified: key <A> revoked'). The verdict word 'verified' is never set beside a revoked key.",
    "got": "Live on every pharmacy verify of the clinic after the revocation, in both worlds (V1, V1 again, V4, the wrong order W8, the recovery): '  verified kid=3f4c72b95ab6f6a1 origin=http://127.0.0.1:4300 - A key this verifier trusts has revoked itself'. After she trusts B, the output of one command holds two lines that match 'verified kid=', one of them the stolen key's. The Desk shows only the sentence.",
    "evidence": [
      "src/cli/commands.ts:340-346",
      "L2 journal steps 11, 12, 20, 22",
      "shots/ines/l2-desk-06-order1-final-1 (Desk: no verdict word beside A)"
    ],
    "code_check": "present-broken: revocationLines formats with the signature verdict formatter.",
    "verdict": "confirmed",
    "resolution": "open"
  },
  {
    "id": "INE-L1-08",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": {
      "frequency": "med",
      "reachability": "high",
      "trust_erosion": "low"
    },
    "dimension": "senior-quality",
    "title": "invalid tampered does not say which signed file changed",
    "expected": "The line, --json and the Desk name the signed path that differs or is missing.",
    "got": "Live tamper act: CLI 'invalid tampered ... A signed file differs from the version that was signed.' and --json carries no path. The Desk: 'INVALID: A SIGNED FILE CHANGED, OR IS MISSING' and 'Signed files: agent-manifest.json, links.json, northgate_clinic.network.json' (all three, none marked).",
    "evidence": [
      "src/core/verify.ts:209-213",
      "L2 journal step 4",
      "shots/ines/l2-desk-02-after-trust-tampered-1"
    ],
    "code_check": "present-but-missed: the path is known at verify.ts:208-212 and already held to the safe-subject pattern.",
    "verdict": "confirmed",
    "resolution": "open"
  },
  {
    "id": "INE-L1-09",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": {
      "frequency": "high",
      "reachability": "high",
      "trust_erosion": "med"
    },
    "dimension": "senior-quality",
    "title": "CLI verdict lines omit what an incident note needs: the limits of verified, the dates, and the origin checked",
    "expected": "verified carries its limit and expiresAt; expired says when; an origin mismatch names the address checked and does not call a mismatched copy 'may be genuine'.",
    "got": "Live: the CLI's verified line has no limit and no expiry. 'invalid expired' has no date on either surface. On the mirror's own URL the CLI says 'unverifiable kid=3f4c72b95ab6f6a1 origin=http://127.0.0.1:4300 - The files may be genuine but are not attested ... (see the result's origin field)', and 4301, the address checked, is printed nowhere. The Desk adds 'It does not mean the site is safe, honest or correct' and 'Files fetched from http://127.0.0.1:4301'. This is over a forgery whose prescriptions agent asks for date of birth and NHS number.",
    "evidence": [
      "src/core/verify.ts:163-171",
      "src/core/verify.ts:222-224",
      "src/cli/commands.ts:511",
      "L2 journal steps 3, 5, 6",
      "shots/ines/l2-desk-03-expired-1",
      "shots/ines/l2-desk-04-forgery-prerevoke-1",
      "shots/ines/l2-desk-04-forgery-prerevoke-2"
    ],
    "code_check": "present-but-missed: expectedOrigin and expiresAt are held and never printed by the CLI.",
    "verdict": "confirmed",
    "resolution": "open"
  },
  {
    "id": "INE-L1-10",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": {
      "frequency": "low",
      "reachability": "high",
      "trust_erosion": "med"
    },
    "dimension": "trust",
    "title": "trust --url adds a key that the same site publishes a revocation of; the Desk refuses to offer it",
    "expected": "trust --url reads the site's plumbline-revocation.json and refuses or warns when it revokes the key record it offers, as the Desk does.",
    "got": "Live, between revoke and re-sign: a fresh verifier's 'trust --url http://127.0.0.1:4300/ --allow-local --yes' gives 'added to fresh.trust.json', exit 0. The next verify revokes it. The Desk in the same state: 'This site publishes a revocation of the key it signs with, so the page does not offer to trust that key. Ask the publisher for their new key id through another channel.'",
    "evidence": [
      "src/cli/trust-command.ts:130-143",
      "site/desk.js:776-783",
      "L2 journal step 9",
      "shots/ines/l2-desk-05-fresh-between-revoke-resign-1"
    ],
    "code_check": "confirmed-absent in the CLI.",
    "verdict": "confirmed",
    "resolution": "open"
  },
  {
    "id": "INE-L1-11",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "severity_l1": "minor",
    "impact": {
      "frequency": "med",
      "reachability": "high",
      "trust_erosion": "med"
    },
    "impact_l1": {
      "frequency": "med",
      "reachability": "high",
      "trust_erosion": "low"
    },
    "dimension": "missing",
    "title": "Nothing records when a key was trusted or adopted, and the one time the file does carry can predate the entry",
    "expected": "trust and adopt stamp the time an entry was added; a cascaded revocation records when it was recorded here as well as the source's revokedAt.",
    "got": "Live: entries carry no time. The attacker's key adopted at about 10:30 shows 'revokedAt: 2026-11-18T10:28:41.105Z', A's time, so the file says it was revoked before it was trusted.",
    "evidence": [
      "src/cli/files.ts:189-195",
      "src/core/revoke.ts:76-96",
      "L2 journal step 14 (trust file quoted)"
    ],
    "code_check": "by-design for the shape (wire contract); the copied revokedAt is how spreadRevocations works.",
    "verdict": "confirmed",
    "resolution": "open"
  },
  {
    "id": "INE-L1-12",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "severity_l1": "minor",
    "impact": {
      "frequency": "low",
      "reachability": "high",
      "trust_erosion": "low"
    },
    "impact_l1": {
      "frequency": "med",
      "reachability": "high",
      "trust_erosion": "low"
    },
    "dimension": "effort",
    "title": "Before first contact, verify cannot say unverifiable: with no trust file it exits 2",
    "expected": "A missing trust file reads as empty for verify, as for trust, or the error says how to make one.",
    "got": "The world ships an empty trust file, so Ines did not hit it in the world. Control arm: 'plumbline verify: trust store not found: nonexistent.trust.json', exit 2.",
    "evidence": [
      "src/cli/commands.ts:515-516",
      "L2 journal step 2 (control arm)"
    ],
    "code_check": "present-broken (asymmetry with trust's missingIsEmpty).",
    "verdict": "confirmed",
    "resolution": "open",
    "scope_note": "Frequency lowered: once per verifier, at first contact."
  },
  {
    "id": "INE-L1-13",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": {
      "frequency": "low",
      "reachability": "high",
      "trust_erosion": "med"
    },
    "dimension": "clarity",
    "title": "CLI revoke gives no preview and never says the revocation is final; the Desk says 'it cannot be taken back'",
    "expected": "revoke says the revocation is final at every verifier who reads it, and to tell verifiers directly.",
    "got": "Live: 'revoked 3f4c72b95ab6f6a1 at 2026-11-18T10:28:41.105Z / wrote site\\plumbline-revocation.json / next: publish it at the site base, make a NEW key ...'. No preview, no --yes, no word of finality. A second run: 'already revoked ... nothing written'.",
    "evidence": [
      "src/cli/commands.ts:834-839",
      "site/strings.js:240",
      "L2 journal step 7"
    ],
    "code_check": "confirmed-absent.",
    "verdict": "confirmed",
    "resolution": "open"
  },
  {
    "id": "INE-L1-14",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": {
      "frequency": "low",
      "reachability": "high",
      "trust_erosion": "med"
    },
    "dimension": "missing",
    "title": "A verifier told of a revocation out of band has no command to record it",
    "expected": "One command records an emailed revocation file, for example 'trust --revocation <file>'.",
    "got": "Live: 'plumbline trust: unknown option: --revocation', exit 2. 'verify --root emailed --origin <clinic>' on a folder holding only the revocation: 'plumbline.signature.json not found in emailed', exit 2, and the trust file gained two revokedAt (A and the adopted B), unannounced.",
    "evidence": [
      "docs/signature-format.md:436-439",
      "src/cli/trust-command.ts:122-195",
      "L2 journal step 25"
    ],
    "code_check": "confirmed-absent.",
    "verdict": "confirmed",
    "resolution": "open"
  },
  {
    "id": "INE-L1-15",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "severity_l1": "polish",
    "impact": {
      "frequency": "med",
      "reachability": "high",
      "trust_erosion": "low"
    },
    "impact_l1": {
      "frequency": "low",
      "reachability": "high",
      "trust_erosion": "low"
    },
    "dimension": "clarity",
    "title": "verify's adopt hint appears for a rotation whose from-key is recorded as revoked, and for a URL adopt can never use",
    "expected": "No adopt hint when the rotation starts from a key recorded as revoked, or a hint that says adopt will refuse it.",
    "got": "Live: over the attacker's mirror, after the revocation was recorded, verify printed 'hint: ... check it with plumbline adopt --url http://127.0.0.1:4301/ ...'. That command then answered 'unknown to this verifier'. After the wrong-order recovery, the clinic's own verify of key C printed the same hint, because the A->B rotation file stays published and nothing tells her to remove it.",
    "evidence": [
      "src/cli/commands.ts:619-627",
      "L2 journal steps 13, 22"
    ],
    "code_check": "present-broken: the hint checks only that a rotation file is present and the verdict is unverifiable.",
    "verdict": "confirmed",
    "resolution": "open"
  },
  {
    "id": "INE-L1-16",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": {
      "frequency": "low",
      "reachability": "med",
      "trust_erosion": "low"
    },
    "dimension": "trust",
    "title": "export-jws signs with a key the site's own revocation revokes, where sign and rotate refuse",
    "expected": "export-jws refuses a key that the root's plumbline-revocation.json revokes.",
    "got": "Live: right after the revocation, sign with A gives exit 2, and export-jws with A prints 'eyJhbGciOiJFZERTQSIsImtpZCI6IjNmNGM3MmI5NWFiNmY2YTEifQ..W4ft...' and exits 0.",
    "evidence": [
      "src/cli/commands.ts:641-674",
      "L2 journal step 7"
    ],
    "code_check": "confirmed-absent.",
    "verdict": "confirmed",
    "resolution": "open"
  },
  {
    "id": "INE-L1-17",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": {
      "frequency": "low",
      "reachability": "low",
      "trust_erosion": "med"
    },
    "dimension": "trust",
    "title": "The Desk's revoke offers a one-statement file, so publishing it over an existing list drops earlier revocations",
    "expected": "The Desk lets the visitor add to an existing revocation file, or warns that the download replaces it.",
    "got": "Not exercised live. She revokes with the CLI, and this is not on her bound path.",
    "evidence": [
      "site/desk.js:1036-1043"
    ],
    "code_check": "present-broken by code read only.",
    "verdict": "uncertain",
    "resolution": "open",
    "scope_note": "Uncertain: not on Ines's bound path. It closes by driving #/key's revoke with a site that already publishes a revocation, and diffing the offered file."
  },
  {
    "id": "INE-L1-18",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "strength": true,
    "type": "trust",
    "severity": "polish",
    "impact": {
      "frequency": "high",
      "reachability": "high",
      "trust_erosion": "low"
    },
    "dimension": "trust",
    "title": "First contact is a real ceremony: nothing without --yes, compare character by character out of band, and a revoked kid is refused forever",
    "expected": "A verifier cannot be rushed into trust.",
    "got": "Live: 'nothing added: confirm out of band, then rerun with --yes', exit 1, file unchanged. With --yes: 'added'. Again: 'already trusted ... nothing to add'. Re-trusting A: 'records key 3f4c72b95ab6f6a1 as revoked; a revoked key is never trusted again', exit 2. The Desk: a checkbox, 'I compared this key id, character by character ...', and its import 'Nothing is added until you confirm'.",
    "evidence": [
      "src/cli/trust-command.ts:52-57",
      "L2 journal steps 2, 3, 12",
      "shots/ines/l2-desk-01-before-trust-1"
    ],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "n-a"
  },
  {
    "id": "INE-L1-19",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "strength": true,
    "type": "trust",
    "severity": "polish",
    "impact": {
      "frequency": "high",
      "reachability": "high",
      "trust_erosion": "low"
    },
    "dimension": "trust",
    "title": "A revocation, once seen, is recorded and announced, and the forgery is then invalid revoked even from a mirror that hides the revocation",
    "expected": "The pharmacy refuses the forgery for the right reason once it has learned of the revocation.",
    "got": "Live in both worlds: 'revocation recorded in plumbline.trust.json (1 entry)', then the world's forgery is 'invalid revoked' by the mirror's URL and by --root at the clinic's origin. The mirror serves no revocation. The Desk agrees.",
    "evidence": [
      "L2 journal steps 11, 26",
      "shots/ines/l2-desk-13-forgery-after-revoke-1"
    ],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "n-a"
  },
  {
    "id": "INE-L1-20",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "strength": true,
    "type": "trust",
    "severity": "polish",
    "impact": {
      "frequency": "med",
      "reachability": "high",
      "trust_erosion": "low"
    },
    "dimension": "trust",
    "title": "The attacker's rotation gets them nowhere: adopt is never automatic, a revoked signer is refused even with --yes, and the cascade undoes an adoption made in the stale window",
    "expected": "Criterion 6.",
    "got": "Live: 'adopt --root <mirror> --origin <clinic> --yes' after the revocation: 'invalid revoked ... nothing adopted', exit 1. Stale arm: adopted only with --yes, then revoked by the cascade on the next verify of the real clinic. The Desk's cascade works the same, from an imported trust file.",
    "evidence": [
      "L2 journal steps 13, 14",
      "shots/ines/l2-desk-09-stale-adopted-then-clinic-1"
    ],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "n-a"
  },
  {
    "id": "INE-L1-21",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "strength": true,
    "type": "trust",
    "severity": "polish",
    "impact": {
      "frequency": "med",
      "reachability": "high",
      "trust_erosion": "low"
    },
    "dimension": "senior-quality",
    "title": "The publisher commands stop her from re-using the stolen key and say what to do instead",
    "expected": "No way to sign or rotate with a key the site revoked.",
    "got": "Live: sign with A after the revocation: exit 2, 'make a new key with plumbline keygen, sign with it, and re-establish trust through the first-contact ceremony'. Signing B before publishing B's record warned: 'the .well-known/plumbline-key.json in site is not the record of the key that signed (ebb2efb758d6682e); publish this key's record'.",
    "evidence": [
      "L2 journal steps 7, 10"
    ],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "n-a"
  },
  {
    "id": "INE-L1-22",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L1",
    "strength": true,
    "type": "trust",
    "severity": "polish",
    "impact": {
      "frequency": "high",
      "reachability": "high",
      "trust_erosion": "low"
    },
    "dimension": "trust",
    "title": "The docs name their own ceilings: the stale-trust window, a lost key cannot revoke, a successor added by hand escapes the cascade",
    "expected": "Whatever is not covered is said.",
    "got": "Live, the stale-trust window behaved exactly as documented. Before the pharmacy verified the real clinic, the forgery at the clinic's origin was 'verified kid=3f4c72b95ab6f6a1'. Afterwards it was 'invalid revoked'.",
    "evidence": [
      "docs/signature-format.md:434-443",
      "L2 journal steps 6, 11"
    ],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "n-a"
  },
  {
    "id": "INE-L2-1",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L2",
    "type": "trust",
    "severity": "minor",
    "impact": {
      "frequency": "med",
      "reachability": "med",
      "trust_erosion": "med"
    },
    "dimension": "trust",
    "title": "On a copy signed for another origin, the Desk's headline says 'You have not met this signer yet ... The files may be fine' about a signer her trust list holds",
    "expected": "When the signature names another origin, the meaning line says so: 'a key you trust signed these files for another address; this copy is not attested here'. The detail does not point at 'the result's origin field', a name the Desk never shows.",
    "got": "The forgery at http://127.0.0.1:4301/, signed by trusted key A for the clinic's origin, with a prescriptions agent that asks for date of birth and NHS number: 'UNVERIFIABLE / You have not met this signer yet, or the site publishes no signature. The files may be fine, but nothing here can vouch for them ...' then 'The files may be genuine but are not attested ... (see the result's origin field)'. The notice at the bottom is right. The same happens for the attacker's rotated mirror.",
    "evidence": [
      "site/strings.js:37",
      "site/desk.js:645",
      "site/desk.js:1487",
      "shots/ines/l2-desk-04-forgery-prerevoke-2",
      "shots/ines/l2-desk-06-order1-final-2",
      "shots/ines/l2-desk-07-stale-adopted-1"
    ],
    "code_check": "present-broken: the meaning is chosen by verdict alone (t(`verdicts.${r.verdict}Meaning`)), and originMismatch does not change it. The CLI shares the detail sentence but has no meaning line.",
    "verdict": "confirmed",
    "resolution": "open",
    "suggested_acceptance": "On the forgery act, the Desk's first sentence under the chip names the origin mismatch and never says 'not met this signer' or 'may be fine'."
  },
  {
    "id": "INE-L2-2",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L2",
    "type": "trust",
    "severity": "minor",
    "impact": {
      "frequency": "low",
      "reachability": "med",
      "trust_erosion": "high"
    },
    "dimension": "trust",
    "title": "adopt accepts a second, different successor of a key that already rotated (a fork) without remark",
    "expected": "When the trust file already holds a successor adopted via key A, a rotation from A to a different key is flagged: two successors of one key is the signature of a stolen key.",
    "got": "Wrong-order world, pharmacy holding A plus B (adoptedVia A): adopt of the attacker's mirror at the clinic's origin said 'verified ... A key this verifier already trusts for this origin named its successor' for 230cec299eda2822. With --yes: 'adopted 230cec299eda2822 ... recorded as adopted via 6e682ef5fda03dda'. The file then holds two successors of A.",
    "evidence": [
      "src/core/rotate.ts:121",
      "src/core/rotate.ts:146",
      "L2 journal step 18 (both adopt outputs, trust file listed)"
    ],
    "code_check": "confirmed-absent: walkRotationChain and adoptRotation never consult existing adoptedVia entries. The cascade undoes the fork once A's revocation is seen.",
    "verdict": "confirmed",
    "resolution": "open",
    "suggested_acceptance": "adopt with a rotation from A, when the file already holds an entry adoptedVia A for another kid, refuses or prints a fork warning."
  },
  {
    "id": "INE-L2-3",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L2",
    "type": "confusion",
    "severity": "polish",
    "impact": {
      "frequency": "med",
      "reachability": "med",
      "trust_erosion": "low"
    },
    "dimension": "clarity",
    "title": "The Desk's import button says 'Add these N to my trust list' when the changes take trust away",
    "expected": "A revocation-only import reads 'Record these 2 revocations', and the grammar holds for 1.",
    "got": "Importing the post-cascade pharmacy file: both rows say 'marked revoked: takes trust away', and the button says 'Add these 2 to my trust list'. With one entry: 'Add these 1 to my trust list'.",
    "evidence": [
      "site/strings.js:189",
      "shots/ines/l2-desk-08-stale-after-cascade-1 (desk-l2-desk-08 journal importPreview)",
      "desk-l2-desk-02 journal importPreview"
    ],
    "code_check": "present-broken: one label for every import.",
    "verdict": "confirmed",
    "resolution": "open"
  },
  {
    "id": "INE-L2-4",
    "journey": "j3-stolen-key",
    "character": "ines-baptista",
    "cert_level": "L2",
    "strength": true,
    "type": "trust",
    "severity": "polish",
    "impact": {
      "frequency": "high",
      "reachability": "med",
      "trust_erosion": "low"
    },
    "dimension": "trust",
    "title": "The Desk reports a revocation in plain words, refuses first contact with a key the site revokes, and still says what it recorded when the signature is gone",
    "expected": "The second opinion is at least as honest as the CLI.",
    "got": "'This site publishes plumbline-revocation.json, and it verifies under a key you trust: that key revoked itself. It is now marked revoked in your trust list.' No verdict word sits beside the stolen key. The same box appears with the signature taken down. Between revoke and re-sign it says 'the page does not offer to trust that key'. Its key page says 'Do not rotate after a leak: revoke'.",
    "evidence": [
      "shots/ines/l2-desk-06-order1-final-1",
      "shots/ines/l2-desk-11-takedown-1",
      "shots/ines/l2-desk-05-fresh-between-revoke-resign-1",
      "site/strings.js:152",
      "site/strings.js:224"
    ],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "n-a"
  }
]
```

## L2 verdict

**L2-conditional.** The job completes live, in the documented order, and every security property held on the real
served sites. The pharmacy went `unverifiable`, `verified`, `invalid tampered`, `invalid expired`. The forgery was `invalid
revoked` once the revocation was seen. The thief's rotation was refused, and the cascade undid a stale-window adoption.
The CLI and the Desk agree on every verdict except three. Four majors are confirmed live: INE-L1-01 (cascade wording on
both surfaces), INE-L1-02 (wrong order, unwarned, a third key), INE-L1-03 (CLI "unknown" vs Desk "revoked", 3 of 3) and
INE-L1-05 (DNS keeps vouching for the stolen key; module-level arms).

- **Time saved:** about 65 minutes per incident in the documented order (90 by hand, about 20 on the day plus a
  12-minute runbook written once), medium confidence. About 40 minutes in the other order, medium-low confidence.
- **L1 findings:** 21 confirmed, 0 refuted, 1 uncertain (INE-L1-17, off her bound path).
- **Re-scored:** INE-L1-05 reachability high to med; INE-L1-11 trust_erosion low to med; INE-L1-12 frequency med to low;
  INE-L1-15 polish to minor.
- **What the L1 surface model missed (surface-model gaps):**
  - INE-L2-1: the Desk's verdict meaning ignores the origin mismatch.
  - INE-L2-2: adopt accepts a forked second successor.
  - INE-L2-3: the import button says "Add" for revocations.
  - Three widenings L1 could not see. A cascaded `revokedAt` predates the adoption. The leftover rotation file keeps the
    adopt hint firing on the clinic's own new key. Rotating first leaves the forgery `verified` until the revocation.
  - The world's `forgery` act signs for the clinic's origin, so INE-L1-03's verify arm needed one constructed signature.
    A fixture act `forgery-own-origin` would make it reproducible.

## Character feedback (L2)

"On paper I said it was sound underneath. Live, it is. I watched the pharmacy refuse the copy of our site as revoked, and
I watched the thief's new key get revoked by a key he never touched. The commands for my side behaved like a careful
colleague: `sign` would not use the stolen key, it noticed I had signed before publishing the new record, and `revoke`
told me the next three steps in one line. I wrote my runbook from the documentation in about twelve minutes. It was
mostly right, and the bad day itself took me twenty.

What changed from my first reading is which surface I believe. I meant the Desk as the thing I show the director. It
turned out to be the more honest of the two. It refused to let a fresh verifier trust the key the clinic had just
revoked, where the command line simply added it. When the clinic's signature was down, it told me what it had written
into the trust list, where the command line failed and changed my file without a word. And for the thief signing for
his own address, the Desk said 'revoked' and the command line said 'unknown'. I asked three times and got the same split
three times. I cannot put two answers in one incident note, and the one I would normally trust, the command line, is the
wrong one.

The incident note is still where it fails me. Three of my runbook's lines were wrong, and every one of them was about
words, not cryptography. There is a line beginning 'verified' next to the stolen key in every check I ran after the
revocation, twice in one output once the new key was trusted. 'Revoked by its holder' is printed about my own new key
and about the thief's, and neither was revoked by anyone. The trust file says the thief's key was revoked two minutes
before it was ever trusted. And the Desk greeted the forged copy, the one asking patients for their NHS number, with 'You
have not met this signer yet. The files may be fine', while my trust list on the same screen showed that I had.

The other order frightened me more live than on paper. `rotate` did not say a word. For as long as I had not revoked,
the forgery still checked out as verified at the pharmacy, and the thief's rotation from the same stolen key was
offered alongside mine, two successors to one key, with no remark. When I did revoke, my new key died with the old
one, and the refusal told me, the publisher, to 'ask the publisher'. That cost me a third key, a second call to the
pharmacy and half an hour.

I would adopt it for both organisations, in the documented order, with the incident note written by me from the
verdicts rather than pasted from them. Before I hand it to a director I want: the command line to say 'revoked' wherever
the Desk does; no 'verified' beside a dead key; 'revoked because it was adopted through <kid>' for the keys that died by
cascade; `rotate` to say 'not after a leak' at the moment I type it; and one line in the revocation steps about the DNS
record. Would I tell a peer? Yes. I would tell them to rehearse the bad day once in a test folder, as I just did, because
the documentation is right and the command in your hand at 7 a.m. is the only thing that is not."

## Residue

- **Inside this run folder:** `shots/ines/` holds 18 shot stems, 54 files (`l2-desk-01-before-trust-1` through
  `l2-desk-13-forgery-after-revoke-2`, each `.png`, `.aria.yml`, `.txt`). This report has the L2 sections appended.
- **Outside the world's temp folder and this run folder:**
  - The session scratchpad (outside the repository, session-scoped): `env.sh`, `desk.sh`, `desk-*.js`, `desk-*.json`,
    `desk-*.err` (the Desk scripts and journals), `dns-arms.mjs`, `runbook.md`, `findings-l2.json`, `l2-*.md`,
    `up1.json`, `up2.json`.
  - `npm run build` and `npm run build:site` rewrote `dist/` and `site/lib/plumbline/` in place, with no change to any
    tracked file (`git status` shows only the pre-existing untracked `.ai/consults.jsonl`, `.claude/`, `uat/`).
- **The world:** both copies were removed by `down` (`folderGone: true`, `portsStillInUse: []`, `leftovers: []`), and so
  was `plumbline-uat-northgate-clinic.state.json`. No `plumbline-uat-northgate*` folder remains. `netstat` showed only
  `TIME_WAIT` sockets (PID 0) on 4301 and 4399 right after `down`, as `uat/env.md` describes. No listener, and no process
  of mine left.
- **Keys:** keys B and C were made inside the world's temp folder (`<world>/ines/`) and went with it. The world's key A
  was used by path only.
- **No git writes, and no calls to public services.** DNS was never asked: the arms used an injected resolver. The
  `curl` in step 27 went to the loopback clinic.
