Plumbline watch found drift as of https://github.com/larchhouse/larchhouse-site/actions/runs/w1-relockpr-at-raise, and this pull request accepts it: `plumbline watch --relock` rewrote `plumbline.lock.json` from the current state.

**What the new lock changes:**

- changed `grounding rooms.html`

**The findings this accepts** (review each before merging; a `block` is changed code):

| Severity | Kind | Ref | What |
| --- | --- | --- | --- |
| warn | grounding | rooms.html | A grounding source changed since the lock was written; all 5 facts the network states from it are still on it. |

**Not signed.** The lock is a signed file, so the site's signature reads invalid (tampered) until it is signed again. Check out this branch, run `plumbline sign` with your key, push, and mark this pull request ready. It stays a draft until then.

Nothing is accepted until a person merges this. A clean watch closes it.
