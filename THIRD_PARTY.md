# Third-party code

What the Plumbline Desk (`site/`) serves to a visitor that Plumbline did not write, and what the build uses that never
ships. Listed so it can be audited: every shipped file below has its size and SHA-256, and the same hashes are locked in
`site/plumbline.lock.json` (`runtime.files`), so `plumbline watch` reports any change to them as `block`.

## Shipped to the visitor: the browser runtime, `site/runtime/`

| | |
| --- | --- |
| What | The browser runtime that runs an agentic site's agent network in the visitor's tab |
| Copied from | [cognizant-ai-labs/agentic-web](https://github.com/cognizant-ai-labs/agentic-web), `skills/agentify-website/runtime`, at commit `7ee54a3eaf6339d2d05226e844c2e9c6eee2bf1b` (`site/runtime/NOTICE`) |
| Which is | [nsdeploy](https://github.com/cognizant-ai-lab/nsdeploy)'s browser runtime at commit `53a787c` (2026-11-11), **with the agentic-web skill's edits**: `runner.js`, `engine.js`, `cruse.js`, `ui.js`, `action-transport.js`, `index.js` and `llm.js` are changed, and each says so near its top. `site/runtime/README.md` lists every edit and why |
| Licence | Apache-2.0, `site/runtime/LICENSE.txt` |
| Changed here | Nothing. Plumbline copies the skill's runtime byte for byte and does not edit it (copy-do-not-change) |
| Size | 34 files, 1,907,873 bytes |

This list was not re-checked against upstream when it was written (2026-11-17): the "byte for byte" rests on `NOTICE`,
and the lock pins the bytes that were copied. To audit it, check out agentic-web at the commit above and compare the
hashes below with `sha256sum` of its `skills/agentify-website/runtime/` files.

### The generated LangChain bundle

`site/runtime/generated/agent-runner.bundle.js` (1,573,971 bytes, 1.5 MiB, SHA-256
`c8851e5d28fc751d2ead9f809e66c60d2d3595ed80cb136e59f2219452974a61`) is a minified build of `langchain-runner.mjs` and its
dependencies, made upstream by its `build/bundle-runner.mjs`; it is most of the runtime's size. It ships third-party
code that is not in this repository as source:

- LangChain.js, `@langchain/core` and `@langchain/openai` (MIT), the only imports of `langchain-runner.mjs`, and what
  they pull in: strings in the bundle also name `langsmith` and `zod` and carry the OpenAI client's request headers.
- The bundle carries one `@license MIT` banner.

The bundle does not record which versions of these packages it holds, and Plumbline has not reconstructed them. To
audit it, rebuild it at the upstream commit with its lockfile and compare the hash above.

`site/runtime/generated/*.gen.mjs` are generated from neuro-san's Python kernel (`neuro_san/kernel/graph.py`,
`sly_data.py`, `validation.py`) by the `nsxc` transpiler, as each file's header says.

### Every file

| File (under `site/runtime/`) | Bytes | SHA-256 |
| --- | ---: | --- |
| `LICENSE.txt` | 10173 | `a6cba85bc92e0cff7a450b1d873c0eaa2e9fc96bf472df0247a26bec77bf3ff9` |
| `NOTICE` | 257 | `5b61bc35b065432d546db951b773609960c46c4db4b01c58264d6520e3f85ae6` |
| `README.md` | 4506 | `849a70b33e2565a875791c36d908be179e3b9f553fc57eb1b891ac374905f7cf` |
| `action-bridge.js` | 169 | `c6446e47af1ccefa3e4e9a99f0fcd142081ad31202de7289bf38714d3a4d0dbc` |
| `action-transport.js` | 14018 | `b2d998f7778121a38da1f6307e2de68412f98cd9814622d09562d91a686f302f` |
| `actions.js` | 11691 | `899a1eb474f09ac2521b550eea936ff621ccf42fdd2b74e0729676eeec013fca` |
| `byok.js` | 9094 | `da921db02f6817c037ec88f155160c8aca404bd62b0f0f3bb85c42451e56c73c` |
| `cruse-render.js` | 11637 | `ee5ff2ecafac86b00cc4302ec455e6d738d95c3d4d7ba517df99bcb170ccaadd` |
| `cruse.js` | 10813 | `ee53db4db813441f67041870348ecbcfa6e82b1e9c095cc05fd7fbac711a0510` |
| `discovered-actions.js` | 7568 | `4295ceb269844058c553c811846b05b6b0773520a6f64d9e694d2fba7b9c1e43` |
| `engine.js` | 28330 | `48f30e80ba724f807eb745f8e2dd5a630f9aa518184307981fe5cf5863bcd5ac` |
| `execution-stream.js` | 6926 | `ffe6bdd5e627535708f2c19ce6eec5bb5a7c0fac0fab9141fba569fc4341ad66` |
| `form-actions.js` | 15561 | `28526800bec03179fdb23c664e4172d2e5c3645f88ea9597c497bd2e681c95e2` |
| `generated/agent-runner.bundle.js` | 1573971 | `c8851e5d28fc751d2ead9f809e66c60d2d3595ed80cb136e59f2219452974a61` |
| `generated/graph.gen.mjs` | 2339 | `d3344326b105069bfd7cd2de2bfa42a5e8963f88859a0fc33e678c5113b624af` |
| `generated/sly_data.gen.mjs` | 1241 | `653d3d6988109151f3200636ac4f143d66d4e363d4f1ab03af00216ee3c70c04` |
| `generated/validation.gen.mjs` | 2088 | `fc56d29878e18fa94f988311fe60f5f2e7823a45498f43139f87619015a59b3a` |
| `hocon.js` | 7319 | `4b11ae05268c11b3fac016eec0cc67090537cef424a0b4ce7d84122130b7e4ce` |
| `index.js` | 5042 | `ef2300a5bd916e08248f2bb82ad0cd24fa9c98ccf2f23a4644902a96f16a8a10` |
| `kernel.js` | 8226 | `e850a02ea2e46498df5dcc8df342fddbbe407dc8871479c65825b09fc361b63b` |
| `langchain-runner.mjs` | 6593 | `eba4db2a9305f75405312930628123e61f503f8d1b1132a185a23ee04f14f137` |
| `llm.js` | 9812 | `204fc5476727aa6def28cc8f36b8062573f832883dc2d3320c201998b5271e7d` |
| `mcp.js` | 7152 | `eb2b5a46fd24affbd6e009e6941c9929e5a11cd1e88e70b90c609a045fcfd128` |
| `model.js` | 1952 | `9714913d44e3db658de0d1fd1d9b250662d798a568ecbadb37fa2e3b629b646c` |
| `provider-error.js` | 4226 | `80fb6d491009e5867ea54e13419dbeb2f795ca5df4609e5f8d4340464acf80a1` |
| `remote.js` | 2077 | `2be37fcc67a1f18dea7013deae640a526400c3e1c1db7d9e021d672d8bf3193e` |
| `runner.js` | 30572 | `57d9d91e1c05ae4078ed7b361ff4c2481e0e1a78ad02d2007464b7f9b0e08f78` |
| `sandbox-worker.js` | 6449 | `21a94a5ccd3b3605f0fcd4f6e34d19355e1ac341cb585f5e65cb2fcc0ee4d527` |
| `sandbox.js` | 5337 | `0242f47f5481d3b2e64487b26b6a0a7a44f22a7c2a019ed7dc659ae809be71dc` |
| `trace.js` | 2047 | `b2186480f683649795f76ce371241da1c53c24cfcb140f0c57487caf5c7e0f43` |
| `turn-control.js` | 4069 | `f291b4733b3b08860b3516f6feffca433b9d7b3939993aa626e9996ebe6eabca` |
| `turn-status.js` | 2559 | `378393e6a8939c5f1cd5dc3bc659c4e6835d6fb6aeff5adf09900db9986edbc0` |
| `ui.js` | 91260 | `136d5935338d7454470cf44e2c4a1a1d57714cd8990fdc545ce96fb87280c57a` |
| `web-crypto.js` | 3920 | `7af171a63243d1dc9257f40c234c4a67760898505f37ffcae18474cec3d64361` |

## Not shipped: fonts and other assets

The Desk loads no fonts, no images from other origins and no script from a CDN. Its Content-Security-Policy
(`site/index.html`, `site/_headers`) leaves `font-src` at `default-src 'none'`. Everything else under `site/` outside
`runtime/` is Plumbline's own code, Apache-2.0, including `site/lib/plumbline/`, which `scripts/build-site.mjs`
generates from `src/`.

## Not shipped: npm devDependencies

Plumbline has no runtime dependencies (`package.json` has no `dependencies`). The npm packages below are used to build
and type-check it; none of them is in `dist/`, in the Desk or in what the Action runs beyond the build step. Versions
are the ones `package-lock.json` pins.

| Package | Version | Licence | Why |
| --- | --- | --- | --- |
| `typescript` | 5.9.3 | Apache-2.0 | the compiler (`tsc`) |
| `@types/node` | 22.20.5 | MIT | Node's type declarations |
| `undici-types` | 6.21.0 | MIT | pulled in by `@types/node` |

The GitHub workflows also use `actions/checkout` and `actions/setup-node`, pinned by commit SHA (`action/README.md`);
they run on the CI runner and ship nowhere.
