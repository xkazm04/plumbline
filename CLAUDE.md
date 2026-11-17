# Plumbline - project guidance

Plumbline keeps an agentic website true after it ships: a publisher-held Ed25519 signature over the site's agent
files, a CI gate that runs Plumbline's own port of the reference validator's rules (`src/gate/validator.ts`; the
reference code is never executed) and asks Agent Atlas and Agent Customs, and a scheduled watch for three drifts
(grounding, runtime, peer). The Plumbline Desk (`site/`) is an open agentic website that does all of it live in
the browser. This is an entry to the Open Agentic Web Challenge (Devpost deadline 2027-01-11 16:00 UTC) and is built and
maintained through the bp product blueprint (the sibling checkout `../bp`).

## Law

- **The wire contract is `src/core/types.ts`.** Every file name, field name and enum string there is exact; change one
  only with `docs/signature-format.md` and `npm run check:wire` in the same commit. Absent optional fields are omitted,
  never `null`.
- **Verdicts have three states** (`verified | invalid | unverifiable`) and gates have three (`pass | fail | unavailable`).
  Never fold the third into either of the others. A peer or adapter that cannot be reached is `unavailable`, not `pass`.
- **Identity is derived from the key.** A verifier resolves `kid` in its own trust store; it never trusts a key that
  arrives inside the artifact it is checking.
- **Secrets.** Never commit a private key, an LLM key or a `.env`. `*.key`, `*.pem`, `*.private.json` and `.env*` are
  git-ignored. Run the secret scan before every push.
- **The vendored runtime is copy-do-not-change** (`site/runtime/`, Apache-2.0, with its LICENSE.txt and a NOTICE). It is
  the agentic-web `agentify-website` skill's runtime at commit 7ee54a3, which is nsdeploy's runtime at commit 53a787c
  WITH the skill's edits (`site/runtime/README.md` lists them); never call it unmodified nsdeploy. We write no runtime
  of our own and do not edit the copy. `THIRD_PARTY.md` lists its files and hashes; update it when the copy changes.
- **Every fetch of a stranger's address** refuses private and loopback ranges after DNS resolution, caps the body and has
  an absolute timeout. The ceiling is derived from a measured size and the derivation is written beside the number.
- Core is pure (no `node:*` imports) so it runs in Node 22 and in a browser through WebCrypto.

## Gates

`npm run typecheck`, `npm test`, `npm run check:wire`. `npm run check` runs typecheck and the tests.
`node --test "action/*.test.mjs"` tests the Action's report reader and the watch workflows (no build, no npm).

## Git

Small atomic commits on `master`. The repository is public on GitHub (`xkazm04/plumbline`) since 2026-11-17: push
only through the owner's publish gate, never force-push or rewrite pushed history. Security fixes ship as tagged
GitHub releases with notes (`SECURITY.md`, `.github/release.yml`); a change to `action/` used by the watch template
also moves the template's pinned SHA in a follow-up commit, once the Action's commit exists.
