# Plumbline - project guidance

Plumbline keeps an agentic website true after it ships: a publisher-held Ed25519 signature over the site's agent
files, a CI gate that wraps the reference validator, Agent Atlas and Agent Customs, and a scheduled watch for three
drifts (grounding, runtime, peer). The Plumbline Desk (`site/`) is an open agentic website that does all of it live in
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
- **The vendored runtime is copy-do-not-change** (`site/runtime/`, from nsdeploy commit 53a787c, Apache-2.0, with its
  LICENSE.txt and a NOTICE). We write no runtime of our own and do not edit the copy.
- **Every fetch of a stranger's address** refuses private and loopback ranges after DNS resolution, caps the body and has
  an absolute timeout. The ceiling is derived from a measured size and the derivation is written beside the number.
- Core is pure (no `node:*` imports) so it runs in Node 22 and in a browser through WebCrypto.

## Gates

`npm run typecheck`, `npm test`, `npm run check:wire`. `npm run check` runs typecheck and the tests.

## Git

Small atomic commits on `master`. Never push to the public GitHub repo without the owner's publish gate; the repo is
local until then. Never force-push or rewrite pushed history.
