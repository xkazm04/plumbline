Plumbline watch found drift since `plumbline.lock.json` was written.

| Severity | Kind | Ref | What |
| --- | --- | --- | --- |
| warn | grounding | larch_house.network.json | A grounding source changed since the lock was written; the agent now answers from different facts: review the change, then re-lock (watch --relock). |
| warn | grounding | rooms.html | A grounding source changed since the lock was written; 1 of 7 facts the lock watches on it (facts the network states) is no longer on it, and the network no longer states it either, so no stale fact is left: review the change, then re-lock (watch --relock). |
| block | grounding | plumbline.signature.json | The site's signature no longer covers its files: 1 of 3 signed files differs from the signed version or is missing (larch_house.network.json), so verifiers now answer invalid (tampered) until the site is signed again (plumbline sign). |

`block` means a vendored runtime file, a peer's definition or a peer's links.json changed: look before the next release. After reviewing a change you accept, in a clone of xkazm04/plumbline at the commit this workflow pins, run `node dist/cli/index.js watch --root <path to your site> --relock`, sign the site again (the lock is a signed file) and commit both. The next clean run closes this issue.


A clean report does not mean the site is safe: it means the locked files, peers and runtime match what was locked.

<!-- plumbline:digest [["block","grounding","plumbline.signature.json"],["warn","grounding","larch_house.network.json","09c35b8d4813be73049252ea49425f6b0aa595ebc411c13f048a592eeab3d43c"],["warn","grounding","rooms.html","fb8204b47dab5d270492f2959c1632e5da4b54312354ffabdf8661abd08e0c12"]] -->
