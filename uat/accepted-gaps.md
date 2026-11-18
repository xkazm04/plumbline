# Accepted gaps

Known and accepted. A run does not raise these again; it may cite them as a ceiling.

| Gap | Why it is accepted | Since |
| --- | --- | --- |
| A verified signature does not say a site is safe | By design: it proves who published and that nothing changed (`README.md`) | 2026-11-18 |
| The vendored runtime is not modified, so the partner consent card cannot show a verdict | Law (`CLAUDE.md`); the result is shown beside the partner list; a hook is proposed upstream | 2026-11-18 |
| Agent Customs has receipts for few sites, so that checker is usually `unavailable` | Customs' own coverage; said in the report | 2026-11-18 |
| MCP tool lists cannot be locked | Blocked on a GET-only fetch and a recordable server (`docs/roadmap.md`, D6) | 2026-11-18 |
| The package is not on npm | Owner decision pending on the name (`docs/roadmap.md`, D2). The friction it causes a Character IS still a finding; only "it is not published" is accepted | 2026-11-18 |

## Known defects (open, not accepted): see the backlog

The code review of 2026-11-18 and run `2026-11-18-first-five` are triaged in `docs/BACKLOG.md` (drain:
`docs/product/uat-insights/2026-11-18-first-five.md`). They are open defects, not accepted gaps, and a walker that meets
one cites its backlog id instead of rediscovering it; a walker still confirms or contradicts it on its own arm.

| Review lead | Settled by the run | Backlog |
| --- | --- | --- |
| The relock and renewal PR push fails when the branch exists | confirmed (DEV-L1-01, MAR-L1-13) | UAT-5 |
| `watch --url` prints control characters from a published lock | confirmed by the review; no Character reached it | UAT-16 |
| `watch --init --external` does nothing on an existing lock | confirmed (TOM-L1-05) | UAT-14 |
| A relock PR is not updated when hashes move but wording does not | confirmed, and the issue too (DEV-L1-06) | UAT-6 |
| An unreachable external card is dropped on relock | confirmed (TOM-L1-04) | UAT-3 |
| A fork's PR on a branch of the same name is taken for the Action's own | not reached (needs real `gh`) | UAT-33, hypothesis |
| CI signs a relock before a person has reviewed it | not reached (no Character had a key in CI) | UAT-34, hypothesis |
| Renewal matches the English word "expire" | not reached (`action/report.mjs:239`) | UAT-35, hypothesis |
| Duplicate skill ids miscount | not reached (`src/watch/external.ts:59-60`) | UAT-36, hypothesis |

Every other finding of run `2026-11-18-first-five` that is open is in the backlog by id; the declined ones (DC-1 to
DC-5) carry their reasons there and are not accepted gaps either: they return only with new evidence.
