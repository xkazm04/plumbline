Plumbline watch found drift since `plumbline.lock.json` was written.

| Severity | Kind | Ref | What |
| --- | --- | --- | --- |
| warn | grounding | rooms.html | A grounding source changed since the lock was written; all 5 facts the network states from it are still on it. |

`block` means a vendored runtime file, a peer's definition or a peer's links.json changed: look before the next release. After reviewing a change you accept, in a clone of xkazm04/plumbline at the commit this workflow pins, run `node dist/cli/index.js watch --root <path to your site> --relock`, sign the site again (the lock is a signed file) and commit both. The next clean run closes this issue.

A clean report does not mean the site is safe: it means the locked files, peers and runtime match what was locked.

<!-- plumbline:digest [["warn","grounding","rooms.html"]] -->
