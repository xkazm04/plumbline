A2A Agent Cards copied from the A2A specification (a2aproject/A2A, `docs/specification.md`, branch `main` at commit
`b30ab16ad11c2b28b0d335b2119a5633c41c2b8e`), read from raw.githubusercontent.com on 2026-11-18. No live agent card was
recorded: none of the hosts this repository already talks to (the Desk, Agent Atlas, Agent Customs) publishes one
(`/.well-known/agent-card.json` and `/.well-known/agent.json` answered 404 on each, 2026-11-18), so the specification's
own samples stand in for a recorded response.

| File | Source |
| --- | --- |
| `sample-agent-card.json` | section 8.5, "Sample Agent Card": two skills and one JWS signature (`protected` and `signature`), exactly as printed between the code fences |
| `example-agent-card.json` | the one-line canonical example in the section on signing ("Example Agent", one skill, no signature), exactly as printed |
