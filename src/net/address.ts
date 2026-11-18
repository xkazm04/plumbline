// The one table of addresses Plumbline refuses to contact. Pure: no node:* import, so safeFetch (Node), the watch's
// decisions and the Desk's drift reader (browser, through scripts/build-site.mjs) all read the same ranges. safeFetch
// applies it to every address a name resolves to; the Desk, which cannot resolve names, applies it to IP literals.
//
// Refused, in v4 and v6: private, loopback, link-local, multicast, unique-local, documentation, benchmarking and
// reserved ranges, including the v6 forms that carry a v4 address inside: v4-mapped, v4-compatible, v4-translated
// (refused with the rest of ::/8), NAT64, 6to4 and ISATAP. Anything that does not parse as an address is refused too.

export function parseIPv4(text: string): number[] | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

export function parseIPv6(input: string): number[] | null {
  let s = input;
  const zone = s.indexOf("%");
  if (zone >= 0) {
    if (!/^[\w.-]+$/.test(s.slice(zone + 1))) return null; // a zone is an interface name or index, nothing else
    s = s.slice(0, zone);
  }
  if (!s.includes(":")) return null;
  if (s.includes(".")) {
    const lastColon = s.lastIndexOf(":");
    const v4 = parseIPv4(s.slice(lastColon + 1));
    if (!v4) return null;
    s = `${s.slice(0, lastColon + 1)}${(((v4[0] ?? 0) << 8) | (v4[1] ?? 0)).toString(16)}:${(((v4[2] ?? 0) << 8) | (v4[3] ?? 0)).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const groupsOf = (part: string): string[] => (part === "" ? [] : part.split(":"));
  const head = groupsOf(halves[0] ?? "");
  const rest = halves.length === 2 ? groupsOf(halves[1] ?? "") : [];
  let groups: string[];
  if (halves.length === 1) {
    if (head.length !== 8) return null;
    groups = head;
  } else {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    groups = [...head, ...Array<string>(fill).fill("0"), ...rest];
  }
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    bytes.push(n >> 8, n & 0xff);
  }
  return bytes;
}

export function isBlockedIPv4(b: number[], allowLoopback: boolean): boolean {
  const [a = 0, c = 0, d = 0] = b;
  if (a === 127) return !allowLoopback;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && c >= 64 && c <= 127) return true; // 100.64.0.0/10 carrier-grade NAT
  if (a === 169 && c === 254) return true; // 169.254.0.0/16 link-local, includes cloud metadata 169.254.169.254
  if (a === 172 && c >= 16 && c <= 31) return true; // 172.16.0.0/12
  if (a === 192 && c === 0 && d === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 192 && c === 0 && d === 2) return true; // 192.0.2.0/24 documentation
  if (a === 192 && c === 88 && d === 99) return true; // 192.88.99.0/24 deprecated 6to4 relay anycast (RFC 7526)
  if (a === 192 && c === 168) return true; // 192.168.0.0/16
  if (a === 198 && (c === 18 || c === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a === 198 && c === 51 && d === 100) return true; // 198.51.100.0/24 documentation
  if (a === 203 && c === 0 && d === 113) return true; // 203.0.113.0/24 documentation
  if (a >= 224) return true; // 224.0.0.0/4 multicast and 240.0.0.0/4 reserved, includes broadcast
  return false;
}

export function isBlockedIPv6(b: number[], allowLoopback: boolean): boolean {
  const at = (i: number): number => b[i] ?? 0;
  const zeroFrom = (from: number, to: number): boolean => {
    for (let i = from; i < to; i += 1) if (at(i) !== 0) return false;
    return true;
  };
  const v4At = (i: number): number[] => [at(i), at(i + 1), at(i + 2), at(i + 3)];
  if (zeroFrom(0, 15) && at(15) === 1) return !allowLoopback; // ::1
  if (zeroFrom(0, 12)) return true; // :: and ::/96 (v4-compatible, reserved)
  if (zeroFrom(0, 10) && at(10) === 0xff && at(11) === 0xff) return isBlockedIPv4(v4At(12), allowLoopback); // ::ffff:a.b.c.d
  if (at(0) === 0 && at(1) === 0x64 && at(2) === 0xff && at(3) === 0x9b) {
    // 64:ff9b::/96 NAT64 carries a v4 address; 64:ff9b:1::/48 is local-use and refused outright.
    return zeroFrom(4, 12) ? isBlockedIPv4(v4At(12), allowLoopback) : true;
  }
  // Everything else in ::/8 is IETF-reserved and never a public host: refused outright. That includes the
  // IPv4-translated form ::ffff:0:a.b.c.d (::ffff:0:0/96, RFC 2765 / 6052 SIIT), which the mapped check above does not
  // match and which earlier builds let through, and odd spellings such as 0:0:0:ffff::a.b.c.d.
  if (at(0) === 0) return true;
  if (at(0) === 0x20 && at(1) === 0x02) return isBlockedIPv4(v4At(2), allowLoopback); // 2002::/16 6to4
  // ISATAP (RFC 5214): an interface identifier ::0:5efe:a.b.c.d or ::200:5efe:a.b.c.d carries a v4 tunnel endpoint
  // under any /64 prefix; judged by the address inside, like 6to4.
  if ((at(8) & 0xfd) === 0 && at(9) === 0 && at(10) === 0x5e && at(11) === 0xfe && isBlockedIPv4(v4At(12), allowLoopback)) return true;
  if (at(0) === 0x20 && at(1) === 0x01 && at(2) === 0 && at(3) === 0) return true; // 2001::/32 Teredo
  if (at(0) === 0x20 && at(1) === 0x01 && at(2) === 0 && at(3) === 0x02 && at(4) === 0 && at(5) === 0) return true; // 2001:2::/48 benchmarking (RFC 5180)
  if (at(0) === 0x20 && at(1) === 0x01 && at(2) === 0x0d && at(3) === 0xb8) return true; // 2001:db8::/32 documentation
  if (at(0) === 0x3f && at(1) === 0xff && (at(2) & 0xf0) === 0) return true; // 3fff::/20 documentation (RFC 9637)
  if (at(0) === 0x01 && at(1) === 0 && zeroFrom(2, 8)) return true; // 100::/64 discard-only
  if ((at(0) & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
  if (at(0) === 0xfe && (at(1) & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (at(0) === 0xfe && (at(1) & 0xc0) === 0xc0) return true; // fec0::/10 deprecated site-local
  if (at(0) === 0xff) return true; // ff00::/8 multicast
  return false;
}

/**
 * True when connecting to this literal address must be refused. An unparseable address is refused too: when in
 * doubt the answer is no. `allowLoopback` (safeFetch's `allowLocal`) lets loopback through and nothing else. A
 * bracketed v6 literal (`[::1]`, as a URL's hostname holds it) and a zone suffix (`fe80::1%eth0`) are read too.
 */
export function isBlockedAddress(address: string, allowLoopback = false): boolean {
  const bare = address.startsWith("[") && address.endsWith("]") ? address.slice(1, -1) : address;
  const v4 = parseIPv4(bare);
  if (v4 !== null) return isBlockedIPv4(v4, allowLoopback);
  const v6 = parseIPv6(bare);
  if (v6 !== null) return isBlockedIPv6(v6, allowLoopback);
  return true;
}
