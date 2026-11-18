import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_BODY_BYTES, SafeFetchError, isBlockedAddress, safeFetch, type SafeFetchErrorCode } from "../net/safe-fetch.js";
import { loopbackServer } from "./net-helpers.js";

async function codeOf(promise: Promise<unknown>): Promise<SafeFetchErrorCode | "resolved"> {
  try {
    await promise;
    return "resolved";
  } catch (error) {
    assert.ok(error instanceof SafeFetchError, `expected a SafeFetchError, got ${String(error)}`);
    return error.code;
  }
}

const never = async (): Promise<never> => {
  throw new Error("the resolver must not be called for a literal address");
};

test("address classification: private, loopback, link-local, multicast, unique-local and mapped forms are blocked", () => {
  const blocked = [
    "127.0.0.1", "127.255.255.254", "10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.255", "192.168.0.1",
    "192.168.255.255", "169.254.169.254", "169.254.0.1", "0.0.0.0", "100.64.0.1", "224.0.0.1", "239.255.255.250",
    "255.255.255.255", "192.0.2.1", "198.18.0.1",
    "::1", "::", "fc00::1", "fdff:ffff::1", "fe80::1", "febf::1", "ff02::1", "ff00::", "2001:db8::1",
    "::ffff:10.0.0.1", "::ffff:7f00:1", "::ffff:192.168.1.1", "::ffff:a9fe:a9fe", "[::1]",
    "64:ff9b::a00:1", "2002:7f00:1::", "2002:a9fe:a9fe::1", "::10.0.0.1", "fe80::1%eth0",
    "not an address", "",
  ];
  for (const a of blocked) assert.equal(isBlockedAddress(a), true, `${a} should be blocked`);
  const allowed = [
    "8.8.8.8", "1.1.1.1", "93.184.216.34", "172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1",
    "2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8", "::ffff:808:808",
  ];
  for (const a of allowed) assert.equal(isBlockedAddress(a), false, `${a} should be allowed`);
});

test("REGRESSION (reviewer finding 11): the IPv4-translated form ::ffff:0:a.b.c.d is refused, with every other embedded-v4 form", () => {
  // Old code: ::ffff:0:0/96 matched neither the mapped check (bytes 10-11 = ffff) nor ::/96, so it fell through as public.
  const blocked = [
    "::ffff:0:127.0.0.1", "::ffff:0:10.0.0.1", "::ffff:0:169.254.169.254", "::ffff:0:7f00:1", "::ffff:0:8.8.8.8",
    "0:0:0:0:ffff:0:a9fe:a9fe", "[::ffff:0:192.168.1.1]",
    // the rest of ::/8 (IETF reserved), whatever it carries
    "0:0:0:ffff::10.0.0.1", "::1:0:0:1", "ff::1",
    // ISATAP interface identifiers carrying a private v4 endpoint, under a public-looking prefix
    "2001:4860:1:2:0:5efe:10.0.0.1", "2001:4860:1:2:200:5efe:127.0.0.1", "2001:4860:1:2:0:5efe:a9fe:a9fe",
    // the deprecated 6to4 relay anycast prefix
    "192.88.99.1",
  ];
  for (const a of blocked) assert.equal(isBlockedAddress(a), true, `${a} should be blocked`);
  // loopback through the translated form is still refused under allowLocal: only ::1, 127/8 and ::ffff:127/104 are loopback
  assert.equal(isBlockedAddress("::ffff:0:127.0.0.1", true), true);
  // a public v4 endpoint in an ISATAP identifier is judged by the address inside, like 6to4
  assert.equal(isBlockedAddress("2001:4860:1:2:0:5efe:8.8.8.8"), false);
});

test("REGRESSION (reviewer finding 11): a literal ::ffff:0: address is refused before any connection", async () => {
  for (const url of ["https://[::ffff:0:127.0.0.1]/", "https://[::ffff:0:a9fe:a9fe]/latest/meta-data/"]) {
    assert.equal(await codeOf(safeFetch(url, { resolver: never, timeoutMs: 2000 })), "blocked-address", url);
  }
  const resolvesTo = async () => [{ address: "::ffff:0:10.0.0.1", family: 6 }];
  assert.equal(await codeOf(safeFetch("https://translated.example/", { resolver: resolvesTo, timeoutMs: 2000 })), "blocked-address");
});

test("REGRESSION (p-10277d): the IPv6 documentation prefix 3fff::/20 and benchmarking prefix 2001:2::/48 are refused, as the header says", () => {
  // Old code: isBlockedIPv6 refused 2001:db8::/32 only; these fell through as public (the v4 side refuses both kinds).
  for (const a of ["3fff::1", "3fff:fff:ffff::1", "[3fff:abc::1]", "2001:2::1", "2001:2:0:ffff::1"]) {
    assert.equal(isBlockedAddress(a), true, `${a} should be blocked`);
  }
  // the edges stay public: just past each prefix
  for (const a of ["3fff:1000::1", "2001:2:1::1"]) assert.equal(isBlockedAddress(a), false, `${a} should be allowed`);
});

test("loopback is allowed by the test flag alone, and private ranges stay blocked", () => {
  assert.equal(isBlockedAddress("127.0.0.1", true), false);
  assert.equal(isBlockedAddress("::1", true), false);
  assert.equal(isBlockedAddress("::ffff:127.0.0.1", true), false);
  assert.equal(isBlockedAddress("10.0.0.1", true), true);
  assert.equal(isBlockedAddress("169.254.169.254", true), true);
  assert.equal(isBlockedAddress("fc00::1", true), true);
});

test("literal private addresses are refused before any resolution or connection", async () => {
  const urls = [
    "https://127.0.0.1/", "https://[::1]/", "https://10.0.0.5/", "https://172.16.4.4/", "https://192.168.1.1/",
    "https://169.254.169.254/latest/meta-data/", "https://[fc00::1]/", "https://[fd12:3456::1]/", "https://[::ffff:10.0.0.1]/",
    "https://[::ffff:7f00:1]/", "https://2130706433/", "https://0x7f.1/", "https://0/",
  ];
  for (const url of urls) {
    assert.equal(await codeOf(safeFetch(url, { resolver: never, timeoutMs: 2000 })), "blocked-address", url);
  }
});

test("a hostname that resolves to a private address is refused, even when one of its answers is public", async () => {
  const resolvesTo = (...addresses: string[]) => async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  assert.equal(await codeOf(safeFetch("https://rebind.example/", { resolver: resolvesTo("10.1.2.3") })), "blocked-address");
  assert.equal(await codeOf(safeFetch("https://rebind.example/", { resolver: resolvesTo("93.184.216.34", "192.168.0.9") })), "blocked-address");
  assert.equal(await codeOf(safeFetch("https://rebind.example/", { resolver: resolvesTo("::ffff:127.0.0.1") })), "blocked-address");
  assert.equal(await codeOf(safeFetch("https://rebind.example/", { resolver: resolvesTo() })), "dns-failed");
  assert.equal(
    await codeOf(safeFetch("https://rebind.example/", { resolver: async () => { throw new Error("ENOTFOUND"); } })),
    "dns-failed",
  );
});

test("http and other schemes are refused, and so is a URL that is not one", async () => {
  const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];
  assert.equal(await codeOf(safeFetch("http://example.com/", { resolver: publicResolver })), "insecure-scheme");
  assert.equal(await codeOf(safeFetch("ftp://example.com/", { resolver: publicResolver })), "insecure-scheme");
  assert.equal(await codeOf(safeFetch("file:///etc/passwd", { resolver: publicResolver })), "insecure-scheme");
  assert.equal(await codeOf(safeFetch("not a url")), "bad-url");
});

test("a local loopback server is reachable ONLY with the test option", async () => {
  const server = await loopbackServer((_req, res) => res.end("hello"));
  try {
    assert.equal(await codeOf(safeFetch(`${server.url}/`)), "insecure-scheme");
    assert.equal(await codeOf(safeFetch(`https://127.0.0.1:${server.port}/`)), "blocked-address");
    assert.equal(await codeOf(safeFetch(`${server.url}/`, { allowLocal: false })), "insecure-scheme");
    const ok = await safeFetch(`${server.url}/`, { allowLocal: true });
    assert.equal(ok.status, 200);
    assert.equal(ok.text(), "hello");
    // The option opens loopback only: a private address is still refused.
    assert.equal(await codeOf(safeFetch("http://10.0.0.1/", { allowLocal: true })), "blocked-address");
    assert.equal(await codeOf(safeFetch("http://169.254.169.254/", { allowLocal: true })), "blocked-address");
  } finally {
    await server.close();
  }
});

test("the connection goes to the address that was checked: one lookup, the Host header keeps the name", async () => {
  let host = "";
  const server = await loopbackServer((req, res) => {
    host = req.headers.host ?? "";
    res.end("pinned");
  });
  let lookups = 0;
  try {
    const result = await safeFetch(`http://pinned.test:${server.port}/x`, {
      allowLocal: true,
      resolver: async () => {
        lookups += 1;
        return [{ address: "127.0.0.1", family: 4 }];
      },
    });
    assert.equal(result.text(), "pinned");
    assert.equal(lookups, 1);
    assert.equal(host, `pinned.test:${server.port}`);
  } finally {
    await server.close();
  }
});

test("a redirect hop to a private address is refused, each hop being re-checked", async () => {
  const server = await loopbackServer((req, res) => {
    const targets: Record<string, string> = {
      "/to-private": "http://10.0.0.1/secret",
      "/to-metadata": "https://169.254.169.254/latest/meta-data/",
      "/to-mapped": "https://[::ffff:192.168.0.1]/",
      "/to-http": "http://example.com/",
    };
    res.writeHead(302, { location: targets[req.url ?? ""] ?? "/" });
    res.end();
  });
  try {
    for (const path of ["/to-private", "/to-metadata", "/to-mapped"]) {
      assert.equal(await codeOf(safeFetch(`${server.url}${path}`, { allowLocal: true })), "blocked-address", path);
    }
    // A hop to a public-looking host that resolves to a private address is refused through the resolver as well.
    assert.equal(
      await codeOf(
        safeFetch(`${server.url}/to-http`, {
          allowLocal: true,
          resolver: async () => [{ address: "10.9.9.9", family: 4 }],
        }),
      ),
      "blocked-address",
    );
  } finally {
    await server.close();
  }
});

test("at most 3 redirects are followed", async () => {
  const server = await loopbackServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    const n = Number(u.pathname.replace("/hop", ""));
    const until = Number(u.searchParams.get("until"));
    if (n < until) {
      res.writeHead(302, { location: `/hop${n + 1}?until=${until}` });
      res.end();
      return;
    }
    res.end("arrived");
  });
  try {
    const three = await safeFetch(`${server.url}/hop0?until=3`, { allowLocal: true });
    assert.equal(three.text(), "arrived");
    assert.equal(three.redirects, 3);
    assert.equal(await codeOf(safeFetch(`${server.url}/hop0?until=4`, { allowLocal: true })), "too-many-redirects");
    assert.equal(await codeOf(safeFetch(`${server.url}/hop0?until=99`, { allowLocal: true, maxRedirects: 50 })), "too-many-redirects");
  } finally {
    await server.close();
  }
});

test("the body ceiling trips with its own error, by declared length and by streamed bytes", async () => {
  const server = await loopbackServer((req, res) => {
    if (req.url === "/declared") {
      res.end("x".repeat(1000));
    } else if (req.url === "/streamed") {
      res.writeHead(200); // no content-length: chunked
      res.write("y".repeat(60));
      res.write("y".repeat(60));
      res.end("y".repeat(60));
    } else res.end("x".repeat(100));
  });
  try {
    const opts = { allowLocal: true, maxBytes: 100 } as const;
    assert.equal(await codeOf(safeFetch(`${server.url}/declared`, opts)), "body-too-large");
    assert.equal(await codeOf(safeFetch(`${server.url}/streamed`, opts)), "body-too-large");
    const exact = await safeFetch(`${server.url}/exact`, opts);
    assert.equal(exact.bytes.length, 100, "a body exactly at the ceiling is accepted");
  } finally {
    await server.close();
  }
});

test("the ceiling constant is 512 KiB and a caller cannot raise it", async () => {
  assert.equal(MAX_BODY_BYTES, 524_288);
  assert.ok(MAX_BODY_BYTES >= 41_156 * 10, "ceiling is the measured largest network (41,156 bytes) times ten, or more");
  const server = await loopbackServer((_req, res) => res.end("z".repeat(MAX_BODY_BYTES + 1)));
  try {
    assert.equal(await codeOf(safeFetch(`${server.url}/`, { allowLocal: true, maxBytes: MAX_BODY_BYTES * 10 })), "body-too-large");
  } finally {
    await server.close();
  }
});

test("the absolute timeout trips with its own error, including on a body that never finishes", async () => {
  const server = await loopbackServer((req, res) => {
    if (req.url === "/silent") return; // never answers
    res.writeHead(200);
    const timer = setInterval(() => res.write("."), 20); // drips forever
    res.on("close", () => clearInterval(timer));
  });
  try {
    const opts = { allowLocal: true, timeoutMs: 250 } as const;
    const started = Date.now();
    assert.equal(await codeOf(safeFetch(`${server.url}/silent`, opts)), "timeout");
    assert.equal(await codeOf(safeFetch(`${server.url}/drip`, opts)), "timeout");
    assert.ok(Date.now() - started < 3000);
    // A hung resolver is bounded by the same timeout.
    assert.equal(await codeOf(safeFetch("https://slow-dns.example/", { timeoutMs: 100, resolver: () => new Promise(() => undefined) })), "timeout");
  } finally {
    await server.close();
  }
});

test("REGRESSION (p-e945d0): a redirect whose body drips forever has its connection closed, not drained past the timeout", async () => {
  let redirectClosed: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    redirectClosed = resolve;
  });
  const server = await loopbackServer((req, res) => {
    if (req.url === "/start") {
      res.writeHead(302, { location: "/arrived" }); // no content-length: a chunked body that never ends
      const timer = setInterval(() => res.write("."), 20);
      res.on("close", () => {
        clearInterval(timer);
        redirectClosed();
      });
      return;
    }
    res.end("arrived");
  });
  try {
    const result = await safeFetch(`${server.url}/start`, { allowLocal: true, timeoutMs: 5000 });
    assert.equal(result.text(), "arrived");
    assert.equal(result.redirects, 1);
    // Old code: response.resume() kept reading the redirect's body after safeFetch returned and cleared its timer, so
    // nothing ever closed that connection. The server must see it close promptly, well inside the timeout.
    const outcome = await Promise.race([closed.then(() => "closed"), new Promise((resolve) => setTimeout(() => resolve("still open"), 1000))]);
    assert.equal(outcome, "closed", "the redirect hop's connection must be closed once its Location is read");
  } finally {
    await server.close();
  }
});

test("the three failure modes are distinct errors", async () => {
  const server = await loopbackServer((req, res) => {
    if (req.url === "/silent") return;
    res.end("x".repeat(500));
  });
  try {
    const codes = new Set([
      await codeOf(safeFetch(`${server.url}/big`, { allowLocal: true, maxBytes: 10 })),
      await codeOf(safeFetch(`${server.url}/silent`, { allowLocal: true, timeoutMs: 100 })),
      await codeOf(safeFetch("https://10.0.0.1/")),
    ]);
    assert.deepEqual([...codes].sort(), ["blocked-address", "body-too-large", "timeout"]);
  } finally {
    await server.close();
  }
});

test("non-2xx answers are returned, not thrown, and custom headers are dropped on a cross-origin hop", async () => {
  const seen: Record<string, string | undefined> = {};
  const other = await loopbackServer((req, res) => {
    seen.other = req.headers["x-secret"] as string | undefined;
    res.writeHead(404);
    res.end("nope");
  });
  const first = await loopbackServer((req, res) => {
    seen.first = req.headers["x-secret"] as string | undefined;
    res.writeHead(302, { location: `${other.url}/target` });
    res.end();
  });
  try {
    const result = await safeFetch(`${first.url}/start`, { allowLocal: true, headers: { "x-secret": "token" } });
    assert.equal(result.status, 404);
    assert.equal(result.ok, false);
    assert.equal(result.redirects, 1);
    assert.equal(seen.first, "token");
    assert.equal(seen.other, undefined, "the header must not follow a redirect to another origin");
  } finally {
    await first.close();
    await other.close();
  }
});
