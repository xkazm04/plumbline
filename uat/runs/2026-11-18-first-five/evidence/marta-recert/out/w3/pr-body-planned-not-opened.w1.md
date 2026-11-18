Plumbline watch found drift as of https://github.com/larchhouse/larchhouse-site/actions/runs/w1-relockpr-at-raise, and this pull request accepts it: `plumbline watch --relock` rewrote `plumbline.lock.json` from the current state.

**What the new lock changes:**

- no ref changed (only the capture times)

**What this relock does not accept, or keeps as it was** (these keep reporting after a merge):

| Severity | Kind | Ref | What |
| --- | --- | --- | --- |
| warn | grounding | rooms.html | Not accepted: the network still states 1 fact this page no longer states (1 price), and no other locked page states it, so the agent may answer with an old fact. The lock keeps its earlier record of this page, so every watch still reports it: correct the network (or the page), then re-lock, or take the page out with --drop. |

**Not signed.** The lock is a signed file, so the site's signature reads invalid (tampered) until it is signed again. Check out this branch, run `plumbline sign` with your key, push, and mark this pull request ready. It stays a draft until then.

Nothing is accepted until a person merges this. A clean watch closes it.

<!-- plumbline:digest [["warn","grounding","rooms.html","fb8204b47dab5d270492f2959c1632e5da4b54312354ffabdf8661abd08e0c12"]] -->
