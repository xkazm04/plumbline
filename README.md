# Plumbline

Keep an agentic website true after it ships.

An agentic website publishes `agent-manifest.json` and a network file, and a visitor's browser runs them. Those files
go stale: the site changes under the network's frozen facts, the copied runtime falls behind upstream, and linked peers
change under you. Nothing in the spec says who published them either. Plumbline is the layer after generation:

- **sign** - the publisher signs the agent files with an Ed25519 key they hold (`plumbline.signature.json`).
- **gate** - one command runs the reference validator, Agent Atlas and Agent Customs against a site.
- **watch** - a scheduled job reports grounding, runtime and peer drift and opens a PR for it.
- **Desk** - an open agentic website in `site/` that audits, signs and watches any site in the visitor's browser.

Status: design done, scaffold only. Nothing here is implemented yet beyond the wire types in `src/core/types.ts`.
See `CLAUDE.md` for the working rules and `docs/` as the documents land.

Apache-2.0. The browser runtime in `site/runtime/` will be a copy of nsdeploy's (Apache-2.0).
