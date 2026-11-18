# Proposal: a preload hook for partner networks in the reference runtime

**For:** the browser runtime of cognizant-ai-labs/agentic-web (`skills/agentify-website/runtime`) and nsdeploy, which
it is built on. **Status:** proposal. **Reference implementation of a hook body:** `checkPeerBeforeLoad` in Plumbline's
`src/browser/preload.ts` (Apache-2.0, pure, fetcher-injected, no dependency).

## Problem

When a site's assistant asks a partner, the runtime fetches the partner's network definition (and its `links.json`)
and instantiates it in the visitor's browser, on the visitor's model key. The site has no point at which to look at the
exact bytes the runtime is about to run. The runtime's `onConsent` hook (used by the Plumbline Desk, `site/site.js`)
runs before the request is sent, but it receives a host, not the network address, and the runtime fetches the partner
again after it returns, so a partner that serves different bytes to that second request is not caught. Only the
runtime can close that gap, because only the runtime holds the bytes it runs.

## Proposal

An optional hook in the runtime's mount options, called once per partner network, after the runtime has fetched the
definition and its `links.json`, and before it instantiates the network:

```js
mountAssistant({
  // ...
  async beforeRemoteNetwork({ address, definition, links }) {
    // address:    the partner's network address, as the site's network or links.json names it
    // definition: Uint8Array, the exact bytes the runtime fetched and is about to parse
    // links:      Uint8Array of the partner's links.json, or null when it answered 404 or 410
    // return { allow: true } to continue, or { allow: false, reason } to refuse; the runtime shows `reason` in the
    // chat as the site's words and does not instantiate the network
  },
});
```

Rules the runtime would follow:

1. The hook receives the bytes the runtime will parse, not a second fetch of them, so "what was checked" is "what runs".
2. A refusal stops that partner only, with the site's sentence in the chat; the turn continues without it.
3. A hook that throws or does not answer within a bound the runtime sets (for example 10 s) is a refusal, never an
   approval: a check that could not be made is not a pass.
4. Without the hook, nothing changes.

## What a site can do with it

With Plumbline, the hook body is a few lines: hash `definition` and `links` and compare them with the pins in the
site's own signed `plumbline.lock.json`, and check the partner's publisher signature against the visitor's trust list.
`checkPeerBeforeLoad(address, { trust, fetcher, lock })` does both today, reading the partner itself; with the hook it
would compare the bytes handed in instead of fetching them. It answers with three signature states (`verified`,
`invalid`, `unverifiable`) and a lock state (`matches`, `differs`, `unread`, `not-locked`), and says what an enforcing
caller would do (`refuse` for an `invalid` signature or a definition that differs from the lock). An unsigned partner
is `unverifiable`, which a site may allow: the hook lets the site decide, it does not decide for every site.

## Cost

One awaited call per partner network load, in the code path that already fetches the partner. No new dependency, no
change for sites that do not pass the hook.
