# MCP fixture: mcp.deepwiki.com

- URL: https://mcp.deepwiki.com/mcp
- Recorded: 2026-11-21T12:32:35.395Z (UTC), recorded by scripts/record-mcp-fixture.mjs through the built safePost.
- Outcome: listed 3 tools; protocol version negotiated 2025-06-18

| file | request | status | content type | session id header | bytes | ms |
| --- | --- | --- | --- | --- | --- | --- |
| 01-initialize.body | initialize | 200 | text/event-stream | absent | 4258 | 744 |
| 02-notifications-initialized.body | notifications/initialized | 202 | application/json | absent | 0 | 663 |
| 03-tools-list.body | tools/list | 200 | text/event-stream | absent | 1779 | 634 |

Each `.body` file is the answer's exact bytes. `answers.json` holds the same table for the tests.

Notes (added by hand after the recording, 2026-11-21):

- An event-stream answer is read until the event that answers the request has arrived whole (safePost's early
  stop), so a `.body` file is the bytes read up to that point; each ends at the blank line closing that event.
- The session id's value is not recorded, only whether the header was there and its length; the tests replay a
  stand-in of the same length.
- These bytes derive MAX_MCP_BODY_BYTES, MAX_MCP_SESSION_ID_LENGTH, MAX_MCP_CURSOR_LENGTH and MAX_MCP_PAGES
  (src/net/fetch-types.ts, derivations beside each). Do not re-record over them: the script refuses to.
