// The Desk's browser fetcher (site/fetcher.js): the one address rule, the body ceiling, the absolute timeout and the
// request it makes, against a scripted fetch. No network.
// Run: npm run test:site (builds site/lib first).
import assert from "node:assert/strict";
import test from "node:test";
import { fetchableUrl, makeBrowserFetcher } from "../fetcher.js";
import { MAX_BODY_BYTES, MAX_RUNTIME_FILE_BYTES, SafeFetchError } from "../lib/plumbline/net/fetch-types.js";

/** A Response-like object whose body is a stream of the given chunks; `endless` keeps it open forever. */
function streamed(chunks, { endless = false, status = 200 } = {}) {
  let i = 0;
  const reader = {
    read: () => {
      if (i < chunks.length) return Promise.resolve({ done: false, value: chunks[i++] });
      if (endless) return new Promise(() => {});
      return Promise.resolve({ done: true, value: undefined });
    },
  };
  return { status, ok: status >= 200 && status < 300, url: "", redirected: false, headers: new Headers({ "Content-Type": "application/json" }), body: { getReader: () => reader } };
}

async function refusal(promise) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof SafeFetchError, `not a SafeFetchError: ${error}`);
    return error.code;
  }
  assert.fail("the fetch was not refused");
}

test("the address rule: https anywhere, http only on localhost and 127.0.0.1, nothing else", async () => {
  for (const ok of ["https://a.example/", "https://a.example:8443/x?y", "http://localhost:8080/", "http://127.0.0.1/"]) assert.ok(fetchableUrl(ok), ok);
  for (const no of ["http://a.example/", "http://127.0.0.2/", "http://[::1]/", "ftp://a.example/", "file:///etc/passwd", "data:text/plain,x", "javascript:alert(1)", "", "a.example", null, 42]) {
    assert.equal(fetchableUrl(no), null, String(no));
  }
  let called = 0;
  const fetcher = makeBrowserFetcher(async () => {
    called += 1;
    return streamed([]);
  });
  assert.equal(await refusal(fetcher("http://a.example/agent-manifest.json")), "insecure-scheme");
  assert.equal(await refusal(fetcher("not a url")), "bad-url");
  assert.equal(called, 0, "a refused address was fetched");
});

test("the request carries no credentials, no referrer and no cache, with a GET and an abort signal", async () => {
  let seen;
  const fetcher = makeBrowserFetcher(async (url, init) => {
    seen = { url, init };
    return streamed([new TextEncoder().encode("{}")]);
  });
  const response = await fetcher("https://a.example/agent-manifest.json");
  assert.equal(seen.url, "https://a.example/agent-manifest.json");
  assert.equal(seen.init.method, "GET");
  assert.equal(seen.init.credentials, "omit");
  assert.equal(seen.init.referrerPolicy, "no-referrer");
  assert.equal(seen.init.cache, "no-store");
  assert.ok(seen.init.signal instanceof AbortSignal);
  assert.equal(response.ok, true);
  assert.equal(response.text(), "{}");
  assert.equal(response.headers["content-type"], "application/json");
  assert.equal(response.url, "https://a.example/agent-manifest.json");
});

test("a streamed body over the ceiling is refused and the request is aborted", async () => {
  let signal;
  const chunk = new Uint8Array(64 * 1024);
  const fetcher = makeBrowserFetcher(async (url, init) => {
    signal = init.signal;
    return streamed(Array.from({ length: Math.ceil(MAX_BODY_BYTES / chunk.byteLength) + 2 }, () => chunk), { endless: true });
  });
  assert.equal(await refusal(fetcher("https://big.example/")), "body-too-large");
  assert.equal(signal.aborted, true, "the over-ceiling download kept running");
  // A caller's smaller ceiling applies; a larger one never lifts the Desk's.
  const small = makeBrowserFetcher(async () => streamed([new Uint8Array(11)]));
  assert.equal(await refusal(small("https://a.example/", { maxBytes: 10 })), "body-too-large");
  assert.equal((await small("https://a.example/", { maxBytes: 11 })).bytes.byteLength, 11);
  const huge = makeBrowserFetcher(async () => streamed([new Uint8Array(MAX_BODY_BYTES + 1)]));
  assert.equal(await refusal(huge("https://a.example/", { maxBytes: MAX_BODY_BYTES * 4 })), "body-too-large");
});

test("a body without a stream reader is capped too", async () => {
  const fetcher = makeBrowserFetcher(async () => ({ status: 200, ok: true, url: "", redirected: false, headers: new Headers(), body: null, arrayBuffer: async () => new ArrayBuffer(21) }));
  assert.equal(await refusal(fetcher("https://a.example/", { maxBytes: 20 })), "body-too-large");
  assert.equal((await fetcher("https://a.example/", { maxBytes: 21 })).bytes.byteLength, 21);
});

test("a body that never ends, or an answer that never comes, times out", async () => {
  // A body that trickles and never ends: its reader rejects when the timeout's abort fires, as a browser's does.
  const abortable = makeBrowserFetcher(async (url, init) => {
    const reader = {
      read: () =>
        new Promise((resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    };
    return { status: 200, ok: true, url, redirected: false, headers: new Headers(), body: { getReader: () => reader } };
  });
  assert.equal(await refusal(abortable("https://slow.example/", { timeoutMs: 20 })), "timeout");
  const silent = makeBrowserFetcher(
    (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
  );
  assert.equal(await refusal(silent("https://silent.example/", { timeoutMs: 20 })), "timeout");
});

test("a fetch the browser refuses (CORS, offline) is a network error, never a response", async () => {
  const refused = makeBrowserFetcher(async () => {
    throw new TypeError("Failed to fetch");
  });
  assert.equal(await refusal(refused("https://cors.example/")), "network");
  const broken = makeBrowserFetcher(async () => ({
    status: 200,
    ok: true,
    url: "",
    redirected: false,
    headers: new Headers(),
    body: { getReader: () => ({ read: () => Promise.reject(new TypeError("network error")) }) },
  }));
  assert.equal(await refusal(broken("https://cut.example/")), "network");
});

test("a runtime file may exceed a network definition's ceiling only when the caller asks for the runtime ceiling", async () => {
  const size = 1_600_000; // just above the vendored bundle's 1,573,971 bytes
  const chunk = new Uint8Array(100_000);
  const body = () => streamed(Array.from({ length: size / chunk.length }, () => chunk));
  const fetcher = makeBrowserFetcher(async () => body());
  assert.equal(await refusal(fetcher("https://a.example/runtime/big.js")), "body-too-large", "the default ceiling still holds");
  assert.equal((await fetcher("https://a.example/runtime/big.js", { ceiling: "runtime" })).bytes.byteLength, size);
  assert.ok(MAX_RUNTIME_FILE_BYTES > size && MAX_RUNTIME_FILE_BYTES <= 4 * 1024 * 1024);
});

