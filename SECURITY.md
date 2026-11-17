# Security policy

Plumbline signs and verifies the agent files of a website, gates a site through three checkers and watches it for
drift. A flaw in any of that can make a verifier trust what it should not, so reports are welcome.

## How to report

Report privately through GitHub: **Security > Report a vulnerability** on
[xkazm04/plumbline](https://github.com/xkazm04/plumbline/security/advisories/new) (GitHub's private vulnerability
reporting). Only the maintainer sees the report, and the fix and the advisory are worked out in it.

Please do not open a public issue, pull request or discussion with the details. If the private form is not available
to you, open a public issue that says only that you have a security report and need a private channel, with no details.

A useful report says what is affected (file, command or Desk tool, and the commit), what an attacker gains, and the
smallest steps or input that show it. A report about a verdict should include the trust file, the signed files and the
command, or the Desk view, that produced it.

## What is in scope

- **The signature format and the verifier**: `docs/signature-format.md` and its code in `src/core` and the CLI
  (`keygen`, `sign`, `verify`, `trust`, `rotate`, `revoke`). For example a `verified` verdict for files a trusted key did
  not sign, a stranger's key reaching `verified`, a revoked key's signature accepted, a rotation adopted that the old
  key did not sign, or a signed file the runtime loads that the signature does not cover.
- **The gate's and the watch's guarded fetch** (`src/net`): every fetch of a stranger's address must refuse private and
  loopback ranges after DNS resolution, cap the body and time out. A way to reach a private address, to read past the
  cap or to hang it is in scope, as is a gate or watch result that turns `unavailable` into `pass` or hides a `block`.
- **The Plumbline Desk** (`site/`, apart from `site/runtime/`): its pages, its tools, its Content-Security-Policy,
  the visitor's trust store kept in their browser, and the signed files it serves.
- **The GitHub Action and the watch template** (`action/`): for example a way for a checked site, a report or an issue
  to inject commands into the runner, or to make the Action run code other than the commit an adopter pinned.

## What is out of scope, and where to report it instead

- **The vendored browser runtime, `site/runtime/`.** It is a byte-for-byte copy of the browser runtime in the
  agentic-web project's `agentify-website` skill, which is nsdeploy's runtime with that skill's edits
  (`site/runtime/NOTICE`, `site/runtime/README.md`, `THIRD_PARTY.md`). Plumbline does not change it, so a fix has to
  come from upstream: report it to [cognizant-ai-labs/agentic-web](https://github.com/cognizant-ai-labs/agentic-web)
  (for the edited files `site/runtime/README.md` lists) or to [nsdeploy](https://github.com/cognizant-ai-lab/nsdeploy)
  (for the rest). Tell us too if the Desk is exposed, so the copy can be updated once upstream ships the fix.
- **Agent Atlas and Agent Customs**, the services the gate asks. Report to their maintainers.
- **The npm package named `plumbline`.** It is an unrelated project; this one is not published to npm.
- **What a verdict does not claim.** A `verified` signature proves who published the files and that they did not
  change, never that a site is safe; a clean watch means nothing locked has drifted. A site that is signed and harmful
  is not a Plumbline vulnerability.
- **A publisher's own leaked key.** That is the publisher's to handle with `plumbline revoke`
  (`docs/signature-format.md`, "Revocation").

## What to expect

Plumbline is maintained by one person, with no security team and no bug bounty, so these are honest aims rather than
guarantees:

- an acknowledgement within 7 days; if you have heard nothing after 14, open a public issue (no details) asking for the
  report to be looked at;
- an assessment, and a plan or a reason for not fixing, within 30 days;
- coordinated disclosure: the advisory is published when a fix is released, or after 90 days if no fix is possible,
  with credit to you unless you ask otherwise.

Only the latest commit on `master` and the latest release are supported. There is no backport to older commits.

## How fixes reach you

Security fixes ship as **tagged GitHub releases with release notes** on
[xkazm04/plumbline](https://github.com/xkazm04/plumbline/releases), and the notes name the fix and what it affects
(the release-note categories are in `.github/release.yml`, with security fixes first). To hear about them, watch the
repository for releases (**Watch > Custom > Releases**). A published GitHub security advisory also accompanies each
fix that has one.

The Action is pinned by commit SHA, so nothing updates under you. To take a fix, move the pin to the release's commit:
`action/README.md` ("Updating the pinned commit") shows how.
