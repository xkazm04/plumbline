Plumbline watch found drift since `plumbline.lock.json` was written.

| Severity | Kind | Ref | What |
| --- | --- | --- | --- |
| warn | grounding | rooms.html | A grounding source changed since the lock was written; 1 of 7 facts the lock watches on it (facts the network states) is no longer on it, and the network still states it (1 price), so the agent may now answer with an old fact. |
| block | grounding | plumbline.signature.json | The site's signature no longer covers its files: 1 of 3 signed files differs from the signed version or is missing (plumbline.lock.json), so verifiers now answer invalid (tampered) until the site is signed again (plumbline sign). |

`block` means a vendored runtime file, a peer's definition or a peer's links.json changed: look before the next release. After reviewing a change you accept, in a clone of xkazm04/plumbline at the commit this workflow pins, run `node dist/cli/index.js watch --root <path to your site> --relock`, sign the site again (the lock is a signed file) and commit both. The next clean run closes this issue.


A clean report does not mean the site is safe: it means the locked files, peers and runtime match what was locked.

<!-- plumbline:digest [["block","grounding","plumbline.signature.json"],["warn","grounding","rooms.html","fb8204b47dab5d270492f2959c1632e5da4b54312354ffabdf8661abd08e0c12"]] -->
