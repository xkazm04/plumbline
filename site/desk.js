// The Desk's page object: one instance, App.page, created at load. The page's own buttons and the assistant's
// website_* tools (site-actions.js) call the same methods, so both follow one set of rules. Each operation checks its
// whole input first and refuses by returning {ok: false, reason, field} without changing anything; it throws only on
// an unexpected failure. Operations never move focus; the page's handlers do.
//
// Private keys: generateKey() puts the private key file only into a downloadable Blob on this page; it is never kept
// in storage, never sent anywhere and never returned to a caller. A key file the visitor picks for signing is held in a
// private field until it is signed with or cleared. No result of any operation contains private key material.

import { t, STRINGS } from "./strings.js";
import { makeBrowserFetcher } from "./fetcher.js";
import { publishedUrl, readDrift, siteBase } from "./drift.js";
import { openReviewDialog } from "./review-dialog.js";
import { runGateWith, ALL_ADAPTERS } from "./lib/plumbline/gate/run.js";
import { DEFAULT_TIMEOUT_MS } from "./lib/plumbline/net/fetch-types.js";
import {
  ALG,
  FORMAT_VERSION,
  KEY_FILE,
  KEY_TYPE,
  REVOCATION_FILE,
  SIGNATURE_FILE,
  applyRevocation,
  derivePublicKey,
  LOCK_FILE,
  generateKey,
  isAcceptableOrigin,
  isKid,
  isPublicKey,
  isSafeSubjectPath,
  keyId,
  keyIdOfPrivate,
  parseManifest,
  signSubjects,
  signedPathsOf,
  spreadRevocations,
  subjectDigest,
  verifySignature,
} from "./lib/plumbline/core/index.js";
import { LINKS_FILE, MANIFEST_FILE } from "./lib/plumbline/core/signed-paths.js";
import { isIsoUtc, revokedResult } from "./lib/plumbline/core/verify.js";
import { EXAMPLE_RUNS } from "./examples.js";

/** The CLI's private key file format (docs/signature-format.md, "plumbline.private.json (CLI format)"). */
export const PRIVATE_KEY_FILE = "plumbline.private.json";
export const PRIVATE_KEY_TYPE = "plumbline-private-key";
const TRUST_STORAGE_KEY = "plumbline-desk.trust.v1";
const MAX_DAYS = 3650;
const DAY_MS = 86_400_000;

export const PARTNERS = [
  { name: STRINGS.partners.atlasName, page: STRINGS.partners.atlasLink, network: "https://agent-atlas-phi.vercel.app/agent_atlas" },
  { name: STRINGS.partners.customsName, page: STRINGS.partners.customsLink, network: "https://montbaga.github.io/agent-customs/agent_customs" },
];

// D1: the hosts the assistant may send the read tools to without the visitor typing them into the page: the manifest's
// partners (agent-manifest.json allowed_peers; a test holds PARTNERS to it), the example targets the overview shows and
// the Desk's own origin. Anything else needs the visitor to have typed or picked it on the page this session.
const PARTNER_ORIGINS = PARTNERS.map((p) => new URL(p.network).origin);
const EXAMPLE_ORIGINS = EXAMPLE_RUNS.map((r) => new URL(r.target).origin);

// ---- D2: every string a tool result carries that came from an inspected site passes its pattern, or is withheld ----

const HOSTNAME = /^[a-z0-9.-]+$/;
const DIGEST_LIKE = /^(?:[0-9a-f]{7,64}|absent)$/;
const withheld = () => t("safety.withheld");

/** A site-relative path from an inspected file: core's subject-path pattern, or withheld. */
export function safePath(value) {
  return isSafeSubjectPath(value) ? value : withheld();
}

/**
 * An address from an inspected file: http(s) as the Desk fetches (https, or http on localhost), no credentials, query
 * or fragment, a plain host name, and a path whose segments pass the subject-path pattern; else withheld.
 */
export function safeUrl(value) {
  if (typeof value !== "string" || value.length > 2000) return withheld();
  let url;
  try {
    url = new URL(value);
  } catch {
    return withheld();
  }
  const local = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if ((url.protocol !== "https:" && !local) || url.username || url.password || url.search || url.hash || !HOSTNAME.test(url.hostname)) return withheld();
  if (url.href !== value && url.href !== `${value}/`) return withheld();
  const path = url.pathname.replace(/^\//, "").replace(/\/$/, "");
  return path === "" || isSafeSubjectPath(path) ? value : withheld();
}

/** A lock reference: a site-relative path or an address, by the rules above. */
export function safeRef(value) {
  return isSafeSubjectPath(value) ? value : safeUrl(value);
}

function safeDigest(value) {
  return typeof value === "string" && DIGEST_LIKE.test(value) ? value : withheld();
}

/** A drift finding as the model may see it: the summary is the Desk's own sentence; ref, expected and actual are checked. */
function safeFinding(f) {
  return {
    kind: f.kind,
    severity: f.severity,
    ref: safeRef(f.ref),
    ...(f.expected !== undefined ? { expected: safeDigest(f.expected) } : {}),
    ...(f.actual !== undefined ? { actual: safeDigest(f.actual) } : {}),
    summary: f.summary,
  };
}

/** The name a file picker gives a site-relative path: its last segment (`./x.network.json` -> `x.network.json`). */
function lastSegment(path) {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || "";
}

function refuse(reason, field) {
  return field === undefined ? { ok: false, reason } : { ok: false, reason, field };
}

/** A target address the Desk will fetch: https, or http on localhost and 127.0.0.1 only. */
export function checkTarget(target) {
  if (typeof target !== "string" || target.trim() === "") return null;
  let url;
  try {
    url = new URL(target.trim());
  } catch {
    return null;
  }
  if (url.protocol === "https:") return url.href;
  if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) return url.href;
  return null;
}

const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** A stored trust entry is used only when every field holds its pattern; anything else is dropped, never repaired. */
function storedEntryOk(e) {
  return (
    isRecord(e) &&
    isKid(e.kid) &&
    isAcceptableOrigin(e.origin) &&
    isPublicKey(e.publicKey) &&
    (e.revokedAt === undefined || isIsoUtc(e.revokedAt)) &&
    (e.adoptedVia === undefined || isKid(e.adoptedVia))
  );
}

/**
 * The visitor's trust store: who they trust, per origin. Kept in localStorage for this origin, if the browser allows.
 *
 * Stored shape: {version: 1, entries: [{kid, origin, publicKey, revokedAt?, adoptedVia?}], revoked: [{kid, revokedAt}]}.
 * `revoked` holds tombstones: a revoked key the visitor forgot. A tombstone carries no trust (no origin, no key), only
 * the mark, so a forgotten revoked key cannot be trusted again from the page. On every load and change the store runs
 * core's spreadRevocations: a mark on any entry or tombstone revokes the key at every origin, and every entry adopted
 * through it (adoptedVia).
 */
export class TrustBook {
  constructor(storage) {
    this.storage = storage;
    this.entries = [];
    this.tombstones = [];
    this.persistent = false;
    try {
      if (storage) {
        const raw = storage.getItem(TRUST_STORAGE_KEY);
        this.persistent = true;
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && parsed.version === 1 && Array.isArray(parsed.entries)) {
          // An entry whose revokedAt or adoptedVia is unreadable is dropped, never kept without it: losing a mark must
          // not restore trust.
          this.entries = parsed.entries.filter(storedEntryOk).map(TrustBook.#entry);
          const stones = Array.isArray(parsed.revoked) ? parsed.revoked : [];
          for (const t of stones) if (isRecord(t) && isKid(t.kid) && isIsoUtc(t.revokedAt)) this.#bury(t.kid, t.revokedAt);
          this.#spread();
        }
      }
    } catch {
      this.persistent = false;
    }
  }

  /** The stored shape of an entry: kid, origin, publicKey and, when set, revokedAt and adoptedVia. */
  static #entry(e) {
    return {
      kid: e.kid,
      origin: e.origin,
      publicKey: e.publicKey,
      ...(typeof e.revokedAt === "string" ? { revokedAt: e.revokedAt } : {}),
      ...(typeof e.adoptedVia === "string" ? { adoptedVia: e.adoptedVia } : {}),
    };
  }

  /** Records a tombstone for a revoked kid, keeping the earliest mark. */
  #bury(kid, revokedAt) {
    const known = this.tombstones.find((t) => t.kid === kid);
    if (!known) this.tombstones.push({ kid, revokedAt });
    else if (Date.parse(revokedAt) < Date.parse(known.revokedAt)) known.revokedAt = revokedAt;
  }

  /** core's spreadRevocations over the entries, with each tombstone standing in as a revoked entry for its kid. */
  #spread() {
    const stand = this.tombstones.map((t) => ({ kid: t.kid, origin: "", publicKey: "", revokedAt: t.revokedAt }));
    this.entries = spreadRevocations([...stand, ...this.entries]).slice(stand.length).map(TrustBook.#entry);
  }

  find(kid, origin) {
    return this.entries.find((e) => e.kid === kid && e.origin === origin);
  }

  /** Every entry for a key id, whatever the origin: a revocation names no origin. */
  forKid(kid) {
    return this.entries.filter((e) => e.kid === kid);
  }

  /** The tombstone for a kid the visitor forgot after it was revoked, if any. */
  tombstone(kid) {
    return this.tombstones.find((t) => t.kid === kid);
  }

  /** What the page and the assistant may see: no keys. A tombstone is listed only while no entry holds its kid. */
  list() {
    const live = this.entries.map((e) => ({ kid: e.kid, origin: e.origin, ...(e.revokedAt !== undefined ? { revokedAt: e.revokedAt } : {}) }));
    const stones = this.tombstones.filter((t) => !this.entries.some((e) => e.kid === t.kid)).map((t) => ({ kid: t.kid, revokedAt: t.revokedAt, forgotten: true }));
    return [...live, ...stones];
  }

  save() {
    if (!this.storage) return false;
    try {
      this.storage.setItem(TRUST_STORAGE_KEY, JSON.stringify({ version: 1, entries: this.entries, revoked: this.tombstones }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Adds or replaces the entry for (kid, origin). A key already marked revoked under any origin, or forgotten after it
   * was revoked, stays revoked.
   */
  add(entry) {
    const revokedAt = entry.revokedAt ?? this.forKid(entry.kid).find((e) => e.revokedAt !== undefined)?.revokedAt ?? this.tombstone(entry.kid)?.revokedAt;
    this.entries = this.entries.filter((e) => !(e.kid === entry.kid && e.origin === entry.origin));
    this.entries.push(TrustBook.#entry({ ...entry, ...(revokedAt !== undefined ? { revokedAt } : {}) }));
    this.#spread();
    return this.save();
  }

  /** Replaces the whole store with the entries a VERIFIED revocation returned (applyRevocation's result.entries). */
  replaceEntries(entries) {
    this.entries = entries.filter(storedEntryOk).map(TrustBook.#entry);
    this.#spread();
  }

  /** Forgets an entry. A revoked one leaves a tombstone, so the key cannot be trusted again from the page. */
  remove(kid, origin) {
    const gone = this.find(kid, origin);
    if (gone && gone.revokedAt !== undefined) this.#bury(gone.kid, gone.revokedAt);
    this.entries = this.entries.filter((e) => !(e.kid === kid && e.origin === origin));
    return this.save();
  }
}

function defaultStorage() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function offer(name, text, type = "application/json") {
  const blob = new Blob([text], { type });
  let url = null;
  try {
    url = URL.createObjectURL(blob);
  } catch {
    url = null;
  }
  return { name, blob, url };
}

function revoke(item) {
  if (item && item.url) {
    try {
      URL.revokeObjectURL(item.url);
    } catch {
      // nothing to free
    }
  }
}

/** A private key file is the CLI's JSON format, read as text. Site files are read as bytes (readFileBytes). */
async function readFileText(file) {
  if (typeof file.text === "function") return file.text();
  throw new Error("not a file");
}

/** A site file's exact bytes: a subject is its bytes, never a parse of them. */
async function readFileBytes(file) {
  if (typeof file.arrayBuffer === "function") return new Uint8Array(await file.arrayBuffer());
  throw new Error("not a file");
}

/** One optional site file (links.json, the lock): present (2xx), absent (404/410), or unknown (anything else). */
async function fetchOptional(fetcher, url) {
  try {
    const response = await fetcher(url);
    if (response.ok) return { state: "present", response };
    if (response.status === 404 || response.status === 410) return { state: "absent", response };
    return { state: "unknown", response };
  } catch (error) {
    return { state: "unknown", error };
  }
}

/**
 * The Desk's state and operations. One instance per page: App.page.
 */
export class DeskPage {
  #signingKey = null;

  constructor(deps = {}) {
    this.fetch = deps.fetch || makeBrowserFetcher();
    this.now = deps.now || (() => new Date());
    this.ownOrigin = deps.ownOrigin || (typeof location !== "undefined" && location.origin ? location.origin : null);
    // Origins the visitor typed or picked in the page's own address fields this session (D1).
    this.visitorOrigins = new Set();
    this.trust = new TrustBook(deps.storage === undefined ? defaultStorage() : deps.storage);
    this.gate = null;
    this.drift = null;
    this.verification = null;
    this.key = null;
    this.signature = null;
    this.partners = null;
    this.signing = { version: 0, busy: false, origin: "", days: 90, keyFile: null, siteFiles: [], subjects: [], ignored: [], problem: null };
    this.notices = {};
  }

  /** Test and embedding hook: replace the fetcher, the clock or the storage. */
  configure(deps = {}) {
    if (deps.fetch) this.fetch = deps.fetch;
    if (deps.ownOrigin) this.ownOrigin = deps.ownOrigin;
    if (deps.now) this.now = deps.now;
    if (deps.storage !== undefined) this.trust = new TrustBook(deps.storage);
  }

  // ---- read: the page state the assistant may see (never key material) ----

  getState() {
    const s = this.signing;
    const check = this.checkSign();
    return {
      desk: "Plumbline Desk: runs the gate, reads drift from a published plumbline.lock.json, verifies plumbline.signature.json against the visitor's trust store, makes publisher keys and signs agent files in this browser.",
      today: this.now().toISOString().slice(0, 10),
      partners: PARTNERS.map((p) => ({ name: p.name, page: p.page })),
      lastGate: this.gate ? { target: this.gate.target, state: this.gate.state, findings: this.gate.findings } : null,
      lastDrift: this.drift
        ? { target: this.drift.target, lockFound: this.drift.lockFound, findings: this.drift.findings.length, blocking: this.drift.findings.filter((f) => f.severity === "block").length }
        : null,
      lastVerification: this.verification ? this.verification.result : null,
      generatedKey: this.key ? { kid: this.key.kid, offeredOnPage: this.key.offers.map((o) => o.path), downloaded: this.key.downloaded } : null,
      signing: {
        version: s.version,
        origin: s.origin,
        days: s.days,
        keyChosen: s.keyFile !== null && s.keyFile.kid !== undefined,
        kid: s.keyFile && s.keyFile.kid ? s.keyFile.kid : null,
        files: s.subjects.map((x) => ({ path: x.path, sha256: x.sha256 })),
        ready: check.ok,
        problem: check.ok ? null : check.reason,
      },
      lastSignature: this.signature ? { kid: this.signature.kid, origin: this.signature.origin, expiresAt: this.signature.expiresAt, files: this.signature.files } : null,
      trustedPublishers: this.trust.list(),
    };
  }

  // ---- D1: which hosts the assistant may send the read tools to ----

  /** The visitor typed or picked an address in one of the page's own fields. */
  noteVisitorTarget(value) {
    const target = checkTarget(value);
    if (target !== null) this.visitorOrigins.add(new URL(target).origin);
  }

  /** True when the assistant may fetch this target: typed or picked on the page, a partner, an example, or this Desk. */
  assistantMayFetch(target) {
    const origin = new URL(target).origin;
    return this.visitorOrigins.has(origin) || PARTNER_ORIGINS.includes(origin) || EXAMPLE_ORIGINS.includes(origin) || origin === this.ownOrigin;
  }

  /** The refusal for an assistant call to a host the visitor did not choose, else null. Page calls pass no caller. */
  #refuseUnchosen(target, how) {
    if (how && how.caller === "assistant" && !this.assistantMayFetch(target)) return refuse(t("assistant.untypedHost"));
    return null;
  }

  // ---- read: the gate ----

  async runGate(args, how = {}) {
    const target = checkTarget(args && args.target);
    if (target === null) return refuse(t("errors.badTarget"), "target");
    const denied = this.#refuseUnchosen(target, how);
    if (denied) return denied;
    const report = await runGateWith({ target, adapters: [...ALL_ADAPTERS] }, { fetch: this.fetch, defaultTimeoutMs: DEFAULT_TIMEOUT_MS, now: this.now });
    this.gate = report;
    this.render("gate");
    return report;
  }

  // ---- read: drift ----

  async readDrift(args, how = {}) {
    const target = checkTarget(args && args.target);
    if (target === null) return refuse(t("errors.badTarget"), "target");
    const denied = this.#refuseUnchosen(target, how);
    if (denied) return denied;
    const base = await siteBase(target, this.fetch);
    // D3: the signature is verified first, against the trust store as it is (nothing is written), and the lock bytes it
    // read are the ones drift compares, so a host cannot serve the signed lock to the check and another to the reading.
    // A lock not covered by a VERIFIED signature is labelled, on every result: the host can rewrite it.
    const check = await this.#verifyAt(base, { persist: false });
    const lockSigned = check.result !== undefined && check.result.verdict === "verified" && check.subjects.includes(LOCK_FILE);
    const result = await readDrift(target, this.fetch, { timeoutMs: DEFAULT_TIMEOUT_MS, base, lockFetch: check.lockFetch });
    result.lockSigned = lockSigned;
    result.lockLabel = lockSigned ? t("drift.signedLock") : t("drift.unsignedLock");
    this.drift = result;
    this.render("drift");
    return {
      target: result.target,
      lockUrl: safeUrl(result.lockUrl),
      lockFound: result.lockFound,
      lockState: result.lockState,
      lockSigned,
      lock: result.lockLabel,
      findings: result.findings.map(safeFinding),
      unreachablePeers: result.unreachablePeers.map(safeRef),
    };
  }

  // ---- read: verify ----

  async verifySite(args, how = {}) {
    const target = checkTarget(args && args.target);
    if (target === null) return refuse(t("errors.badTarget"), "target");
    const denied = this.#refuseUnchosen(target, how);
    if (denied) return denied;
    const base = await siteBase(target, this.fetch);
    // The revocation is read first, so a key the site has revoked is dead for this verdict (and in the trust store),
    // whether or not the site still publishes a signature.
    const check = await this.#verifyAt(base, { persist: true });
    if (check.revocation.state === "applied") this.render("trust");
    if (check.refusal) return refuse(check.refusal, "target");
    const r = check.result;
    const full = {
      target,
      base: safeUrl(base),
      fetchedFrom: safeUrl(check.fetchedFrom),
      verdict: r.verdict,
      ...(r.reason ? { reason: r.reason, reasonInWords: t(`verify.reasons.${r.reason}`) } : {}),
      // kid and origin in a result are core's, already held to their patterns; detail is always the verifier's sentence
      ...(r.kid ? { kid: r.kid } : {}),
      ...(r.origin ? { origin: r.origin } : {}),
      ...(r.detail ? { detail: r.detail } : {}),
      meaning: t(`verdicts.${r.verdict}Meaning`),
      revocation: { ...check.revocation.report, file: safeUrl(check.revocation.report.file) },
      signed: check.signed,
      ...(check.signed
        ? {
            originMismatch: check.originMismatch,
            ...(check.keyRevokedBySite ? { keyRevokedBySite: true } : {}),
            signedFiles: check.signedFiles.map(safePath),
            ...(check.firstContact ? { publishedKey: check.firstContact } : {}),
          }
        : {}),
    };
    this.verification = { result: full, publishedKey: check.firstContact || null };
    this.render("verify");
    return full;
  }

  /**
   * Verifies the signature at a site base, the way `plumbline verify` does over the network (WP9a's contract): the set
   * of files is core's signedPathsOf over the manifest's bytes, every file is its exact bytes, links.json and the lock
   * are passed whenever the site answers 2xx for them (signed or not) and left out on 404 or 410, and the manifest's
   * code files (action module, bridge, coded-tools bundle) are fetched and passed too.
   *
   * :param persist: true for verify_site (an accepted revocation is written to the trust store); false for drift (the
   *   trust store as it is: a revocation is applied in memory only).
   * :return: {fetchedFrom, revocation, lockFetch, subjects, result?, refusal?, signed?, ...}. lockFetch is the lock as
   *   fetched here ({response} or {error}), for drift to read the same bytes.
   */
  async #verifyAt(base, { persist }) {
    const fetchedFrom = new URL(base).origin;
    const revocation = await this.#checkRevocation(base, { persist });
    const trust = revocation.store || this.trust;
    const links = await fetchOptional(this.fetch, `${base}${LINKS_FILE}`);
    const lock = await fetchOptional(this.fetch, `${base}${LOCK_FILE}`);
    const out = { fetchedFrom, revocation, lockFetch: lock.response ? { response: lock.response } : { error: lock.error }, subjects: [] };
    const unsigned = (detail) => ({ ...out, signed: false, result: { verdict: "unverifiable", detail } });

    let sigResponse;
    try {
      sigResponse = await this.fetch(`${base}${SIGNATURE_FILE}`);
    } catch {
      return unsigned(t("verify.sigUnreadable"));
    }
    if (sigResponse.status === 404 || sigResponse.status === 410) return unsigned(t("verify.unsigned"));
    if (!sigResponse.ok) return unsigned(t("verify.sigHttpStatus", { status: sigResponse.status }));
    let signature;
    try {
      signature = JSON.parse(sigResponse.text());
    } catch {
      return { ...out, signed: true, originMismatch: false, signedFiles: [], result: { verdict: "invalid", reason: "malformed", detail: t("verify.sigNotJson") } };
    }

    let publishedKey;
    try {
      const keyResponse = await this.fetch(`${base}${KEY_FILE}`);
      if (keyResponse.ok) {
        const parsed = JSON.parse(keyResponse.text());
        if (isRecord(parsed)) publishedKey = parsed;
      }
    } catch {
      publishedKey = undefined;
    }

    // The signed set, from the manifest's exact bytes. An unsafe path is refused, never fetched.
    let manifestBytes = null;
    try {
      const response = await this.fetch(`${base}${MANIFEST_FILE}`);
      if (response.ok) manifestBytes = response.bytes;
    } catch {
      manifestBytes = null;
    }
    let required;
    try {
      required = signedPathsOf(parseManifest(manifestBytes || new Uint8Array(0)), { links: links.state === "present", lock: lock.state === "present" });
    } catch (error) {
      return { ...out, refusal: t("verify.refusedUnsafe", { why: error.message }) };
    }
    const have = new Map();
    if (manifestBytes) have.set(MANIFEST_FILE, manifestBytes);
    if (links.state === "present") have.set(LINKS_FILE, links.response.bytes);
    if (lock.state === "present") have.set(LOCK_FILE, lock.response.bytes);
    const listed = isRecord(signature) && Array.isArray(signature.subjects) ? signature.subjects : [];
    const wanted = new Set(required);
    for (const subject of listed) if (subject && isSafeSubjectPath(subject.path)) wanted.add(subject.path);
    for (const rel of wanted) {
      if (have.has(rel)) continue;
      const url = publishedUrl(rel, base);
      if (url === null) continue; // a path that leaves the site is simply not a present file: tampered
      try {
        const response = await this.fetch(url);
        if (response.ok) have.set(rel, response.bytes);
      } catch {
        // not present: core reports a signed file that is missing as tampered
      }
    }
    const files = [...have].map(([path, content]) => ({ path, content }));

    // Trust covers files published FROM an origin: core's expectedOrigin turns a signature made for another origin into
    // unverifiable (an invalid one stays invalid), exactly as `plumbline verify --origin` does.
    let result = await verifySignature(signature, files, trust, { now: this.now(), expectedOrigin: fetchedFrom, ...(publishedKey ? { publishedKey } : {}) });
    // links.json or the lock could not be read (refused, or an HTTP error): the Desk cannot tell whether the signature
    // covers everything the runtime loads, so a verified result is not claimed.
    const unknown = [[links, LINKS_FILE], [lock, LOCK_FILE]].filter(([x]) => x.state === "unknown").map(([, name]) => name);
    if (result.verdict === "verified" && unknown.length) {
      result = { verdict: "unverifiable", kid: result.kid, origin: result.origin, detail: t("verify.coverageUnknown", { files: unknown.join(" and ") }) };
    }
    const signedKid = isRecord(signature) && isKid(signature.kid) ? signature.kid : null;
    // D5: a key this browser holds as revoked (an entry for another origin, or a tombstone the visitor kept by
    // forgetting it) is dead here too: a revocation recorded anywhere counts everywhere, so never a stranger to trust.
    const knownRevoked = signedKid !== null && (this.trust.tombstone(signedKid) !== undefined || this.trust.forKid(signedKid).some((e) => e.revokedAt !== undefined));
    if (knownRevoked && result.verdict !== "invalid") result = revokedResult("signature", signedKid, signature.origin);
    const originMismatch = isRecord(signature) && typeof signature.origin === "string" && signature.origin !== fetchedFrom;
    // A site that publishes a revocation of the very key it signs with gets no first-contact offer: a revocation only
    // ever takes trust away, so it is honoured here even when this browser never trusted the key.
    const keyRevokedBySite = signedKid !== null && revocation.kid === signedKid;
    const firstContact =
      result.verdict === "unverifiable" && !originMismatch && !keyRevokedBySite && !knownRevoked && publishedKey && isKid(publishedKey.kid) && publishedKey.kid === signedKid && isPublicKey(publishedKey.publicKey)
        ? { kid: publishedKey.kid, publicKey: publishedKey.publicKey }
        : null;
    return {
      ...out,
      result,
      signed: true,
      originMismatch,
      keyRevokedBySite,
      firstContact,
      signedFiles: listed.map((x) => (x && typeof x.path === "string" ? x.path : "?")),
      subjects: listed.filter((x) => x && isSafeSubjectPath(x.path)).map((x) => x.path),
    };
  }

  /**
   * Reads plumbline-revocation.json from the site base and applies it with core's applyRevocation(statement, entry,
   * allEntries) to every trust entry for its kid (a revocation names no origin). Only a VERIFIED revocation changes
   * anything, and only by taking trust away: the store becomes result.entries, the revocation spread to every origin
   * and down every adoptedVia chain. Absent (404/410) is normal and changes nothing; a file that cannot be read is
   * reported as unavailable, never as "no revocation".
   *
   * :param persist: write an accepted revocation to the trust store (verify_site), or keep it in memory (drift).
   * :return: {report, kid?, state, store?}: report is the part the verdict carries (no key material); store is the
   *   in-memory trust store when persist is false and a revocation applied.
   */
  async #checkRevocation(base, { persist }) {
    const file = `${base}${REVOCATION_FILE}`;
    const unavailable = (detail) => ({ state: "unavailable", report: { file, state: "unavailable", detail } });
    let response;
    try {
      response = await this.fetch(file);
    } catch {
      return unavailable(t("verify.revocation.unreadable"));
    }
    if (response.status === 404 || response.status === 410) return { state: "absent", report: { file, state: "absent" } };
    if (!response.ok) return unavailable(t("verify.revocation.httpStatus", { status: response.status }));
    let statement;
    try {
      statement = JSON.parse(response.text());
    } catch {
      statement = undefined;
    }
    // A kid outside its pattern is never quoted: core reports such a statement as malformed.
    const kid = isRecord(statement) && isKid(statement.kid) ? statement.kid : undefined;
    const results = [];
    let working = this.trust.entries;
    let applied = false;
    if (statement === undefined) {
      results.push({ verdict: "invalid", reason: "malformed", detail: "The revocation file is not valid JSON." });
    } else {
      const entries = kid === undefined ? [] : this.trust.forKid(kid);
      if (entries.length === 0) {
        const { entry: _none, entries: _all, ...result } = await applyRevocation(statement, undefined);
        void _none;
        void _all;
        results.push(result);
      }
      for (const entry of entries) {
        const current = working.find((e) => e.kid === entry.kid && e.origin === entry.origin) || entry;
        const { entry: _one, entries: next, ...result } = await applyRevocation(statement, current, working);
        void _one;
        results.push(result);
        if (result.verdict === "verified" && Array.isArray(next)) {
          working = next;
          applied = true;
        }
      }
    }
    let persisted = false;
    if (applied && persist) {
      this.trust.replaceEntries(working);
      persisted = this.trust.save();
    }
    const state = applied ? "applied" : "not-applied";
    return {
      state,
      ...(kid !== undefined ? { kid } : {}),
      ...(applied && !persist ? { store: { find: (k, o) => working.find((e) => e.kid === k && e.origin === o) } } : {}),
      report: {
        file,
        state,
        ...(kid !== undefined ? { kid } : {}),
        results,
        detail: applied ? t("verify.revocation.applied") : t("verify.revocation.notApplied"),
        ...(applied && persist && !persisted ? { note: t("verify.storageUnavailable") } : {}),
      },
    };
  }

  /**
   * Page-only: adopt the published key of the last verified site after the visitor's out-of-band comparison. Never a
   * tool: the assistant cannot add trust.
   */
  async trustPublisher(compared) {
    const v = this.verification;
    if (!v || !v.publishedKey) return refuse(t("errors.unexpected"));
    if (compared !== true) return refuse(t("verify.trustNeedsCheck"), "compared");
    const { kid, publicKey } = v.publishedKey;
    let derived;
    try {
      derived = await keyId(publicKey);
    } catch {
      derived = null;
    }
    if (derived !== kid) return refuse(t("verify.trustBadKey"));
    const saved = this.trust.add({ kid, origin: v.result.fetchedFrom, publicKey });
    this.notices.trust = saved ? t("verify.trusted") : `${t("verify.trusted")} ${t("verify.storageUnavailable")}`;
    this.render("verify");
    this.render("trust");
    return { ok: true, kid, origin: v.result.fetchedFrom };
  }

  forgetPublisher(kid, origin) {
    this.trust.remove(kid, origin);
    this.render("trust");
    return { ok: true };
  }

  // ---- write (undoable): generate a key ----

  async generateKey(how = {}) {
    // D4: the assistant never throws away a key the visitor has not downloaded; only the visitor can (Discard).
    if (how.caller === "assistant" && this.key && !this.key.downloaded) return refuse(t("key.keepUndownloaded"));
    const { key, privateKey } = await generateKey(this.now());
    const privateFile = { type: PRIVATE_KEY_TYPE, version: FORMAT_VERSION, alg: ALG, kid: key.kid, privateKey };
    this.discardKey(true);
    const privateOffer = offer(PRIVATE_KEY_FILE, `${JSON.stringify(privateFile, null, 2)}\n`);
    privateOffer.path = PRIVATE_KEY_FILE;
    privateOffer.label = t("key.downloadPrivate");
    const publicOffer = offer("plumbline-key.json", `${JSON.stringify(key, null, 2)}\n`);
    publicOffer.path = KEY_FILE;
    publicOffer.label = t("key.downloadPublic");
    this.key = { kid: key.kid, createdAt: key.createdAt, offers: [privateOffer, publicOffer], downloaded: false };
    this.notices.key = null;
    this.render("key");
    return {
      ok: true,
      kid: key.kid,
      offeredOnPage: [PRIVATE_KEY_FILE, KEY_FILE],
      note: "The visitor downloads both files from the page. The private key is not in this result, is not stored and was not sent anywhere.",
    };
  }

  /** The visitor used the private key file's download link. */
  markKeyDownloaded() {
    if (this.key) this.key.downloaded = true;
    return { ok: true };
  }

  /** Undo generateKey: drop the key and its downloads from the page. */
  discardKey(silent = false) {
    if (this.key) for (const o of this.key.offers) revoke(o);
    const had = this.key !== null;
    this.key = null;
    if (!silent) {
      this.notices.key = had ? t("key.discarded") : null;
      this.render("key");
    }
    return { ok: true, discarded: had };
  }

  // ---- signing: choosing files (page only) ----

  setSignOrigin(origin) {
    this.signing.origin = typeof origin === "string" ? origin.trim() : "";
    this.signing.version += 1;
    this.render("sign");
  }

  setSignDays(days) {
    this.signing.days = Number(days);
    this.signing.version += 1;
    this.render("sign");
  }

  /** The visitor picked a private key file. Its key stays in a private field; only its kid is kept in state. */
  async chooseKeyFile(file) {
    this.#signingKey = null;
    this.signing.keyFile = null;
    this.signing.version += 1;
    if (!file) {
      this.render("sign");
      return;
    }
    this.signing.busy = true;
    this.render("sign");
    try {
      let parsed;
      try {
        parsed = JSON.parse(await readFileText(file));
      } catch {
        parsed = null;
      }
      const ok =
        parsed &&
        parsed.type === PRIVATE_KEY_TYPE &&
        parsed.version === FORMAT_VERSION &&
        parsed.alg === ALG &&
        typeof parsed.kid === "string" &&
        typeof parsed.privateKey === "string";
      let derived = null;
      if (ok) {
        try {
          derived = await keyIdOfPrivate(parsed.privateKey);
        } catch {
          derived = null;
        }
      }
      if (ok && derived === parsed.kid) {
        this.#signingKey = parsed.privateKey;
        this.signing.keyFile = { name: file.name, kid: parsed.kid };
      } else {
        this.signing.keyFile = { name: file.name, invalid: true };
      }
    } finally {
      this.signing.busy = false;
      this.signing.version += 1;
      this.render("sign");
    }
  }

  /** The visitor picked their site's files. Works out what `plumbline sign` would sign, with each digest. */
  async chooseSiteFiles(fileList) {
    this.signing.version += 1;
    this.signing.busy = true;
    this.render("sign");
    try {
      const files = [];
      for (const file of Array.from(fileList || [])) files.push({ name: file.name, bytes: await readFileBytes(file) });
      this.signing.siteFiles = files;
      await this.#prepareSubjects();
    } finally {
      this.signing.busy = false;
      this.signing.version += 1;
      this.render("sign");
    }
  }

  clearSigning() {
    this.#signingKey = null;
    this.signing = { version: this.signing.version + 1, busy: false, origin: this.signing.origin, days: this.signing.days, keyFile: null, siteFiles: [], subjects: [], ignored: [], problem: null };
    this.render("sign");
    return { ok: true };
  }

  async #prepareSubjects() {
    const s = this.signing;
    s.subjects = [];
    s.ignored = [];
    s.problem = null;
    const byName = new Map();
    for (const f of s.siteFiles) {
      if (byName.has(f.name)) {
        s.problem = t("sign.refusals.duplicate", { path: f.name });
        return;
      }
      byName.set(f.name, f);
    }
    const manifestFile = byName.get(MANIFEST_FILE);
    if (!manifestFile) {
      s.problem = s.siteFiles.length ? t("sign.refusals.noManifest") : null;
      return;
    }
    const manifest = parseManifest(manifestFile.bytes);
    if (manifest === undefined) {
      s.problem = t("sign.refusals.badManifest");
      return;
    }
    // One signed-file rule, shared with `plumbline sign`: core's signedPathsOf, with links.json and the lock when they
    // were chosen. A file picker gives names, not paths, so each signed path is matched to the chosen file by its last
    // segment; two signed paths with one file name cannot be told apart here, so that is refused.
    let paths;
    try {
      paths = signedPathsOf(manifest, { links: byName.has(LINKS_FILE), lock: byName.has(LOCK_FILE) });
    } catch (error) {
      s.problem = t("sign.refusals.unsafePath", { why: error.message });
      return;
    }
    const seen = new Set();
    for (const path of paths) {
      const name = lastSegment(path);
      if (seen.has(name)) {
        s.problem = t("sign.refusals.sameName", { name });
        return;
      }
      seen.add(name);
    }
    const subjects = [];
    const used = new Set();
    for (const path of paths) {
      const file = byName.get(lastSegment(path));
      if (!file) {
        s.problem = t("sign.refusals.missingNetwork", { path });
        return;
      }
      // The exact bytes the visitor chose: no parse, no re-serialisation.
      subjects.push({ path, content: file.bytes });
      used.add(file.name);
    }
    for (const subject of subjects) subject.sha256 = await subjectDigest(subject.content);
    subjects.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    s.subjects = subjects;
    s.ignored = s.siteFiles.map((f) => f.name).filter((n) => !used.has(n));
  }

  // ---- irreversible: sign ----

  /**
   * The read-only check that signFiles() runs first, and that the confirmation dialog runs before it opens.
   *
   * :param expectedVersion: The version from getState(), or undefined from the page's own button.
   * :return: {ok: true, ...what will be signed} or {ok: false, reason, field}.
   */
  checkSign(expectedVersion) {
    const s = this.signing;
    if (s.busy) return refuse(t("sign.refusals.busy"));
    if (expectedVersion !== undefined && expectedVersion !== s.version) return refuse(t("sign.refusals.stale"), "expectedVersion");
    if (!s.keyFile) return refuse(t("sign.refusals.noKey"), "key");
    if (s.keyFile.invalid || this.#signingKey === null) return refuse(t("sign.refusals.badKey"), "key");
    if (s.problem) return refuse(s.problem, "files");
    if (!s.subjects.length) return refuse(t("sign.refusals.noManifest"), "files");
    if (!isAcceptableOrigin(s.origin)) return refuse(t("sign.refusals.badOrigin"), "origin");
    if (!Number.isInteger(s.days) || s.days < 1 || s.days > MAX_DAYS) return refuse(t("sign.refusals.badDays"), "days");
    return {
      ok: true,
      version: s.version,
      origin: s.origin,
      kid: s.keyFile.kid,
      days: s.days,
      expiresAt: new Date(this.now().getTime() + s.days * DAY_MS).toISOString(),
      subjects: s.subjects.map((x) => ({ path: x.path, sha256: x.sha256 })),
    };
  }

  /** Sign the chosen files and offer plumbline.signature.json as a download. Drops the private key afterwards. */
  async signFiles(args = {}) {
    const check = this.checkSign(args.expectedVersion);
    if (!check.ok) return check;
    const privateKey = this.#signingKey;
    const now = this.now();
    const key = { type: KEY_TYPE, version: FORMAT_VERSION, alg: ALG, kid: check.kid, publicKey: await derivePublicKey(privateKey), createdAt: now.toISOString() };
    const signature = await signSubjects({
      privateKey,
      key,
      origin: check.origin,
      files: this.signing.subjects.map((x) => ({ path: x.path, content: x.content })),
      now,
      lifetimeDays: check.days,
    });
    if (this.signature) revoke(this.signature.offer);
    this.signature = {
      kid: signature.kid,
      origin: signature.origin,
      signedAt: signature.signedAt,
      expiresAt: signature.expiresAt,
      files: signature.subjects.map((x) => x.path),
      offer: offer(SIGNATURE_FILE, `${JSON.stringify(signature, null, 2)}\n`),
    };
    // The key is dropped once used; the chosen site files stay, so the page still shows what was signed.
    this.#signingKey = null;
    this.signing.keyFile = null;
    this.signing.version += 1;
    this.render("sign");
    return {
      ok: true,
      kid: signature.kid,
      origin: signature.origin,
      signedAt: signature.signedAt,
      expiresAt: signature.expiresAt,
      files: this.signature.files,
      offeredOnPage: SIGNATURE_FILE,
    };
  }

  /** The words and details of the signing dialog for a check that passed. */
  signDialogContent(check, exact) {
    return {
      title: t("dialog.signTitle"),
      sentence: t("dialog.signSentence"),
      confirm: t("dialog.signConfirm"),
      decline: t("dialog.signDecline"),
      details: {
        [t("dialog.origin")]: check.origin,
        [t("dialog.kid")]: check.kid,
        [t("dialog.expires")]: check.expiresAt,
        [t("dialog.files")]: check.subjects.map((x) => `${x.path}  sha256 ${x.sha256}`).join("\n"),
      },
      exact,
    };
  }

  // ---- partners (page only) ----

  async checkPartners() {
    this.partners = { checking: true, results: [] };
    this.render("partners");
    const results = [];
    for (const p of PARTNERS) {
      let reachable = false;
      try {
        const response = await this.fetch(new URL("agent-manifest.json", p.page).href);
        reachable = response.ok;
      } catch {
        reachable = false;
      }
      results.push({ name: p.name, reachable });
    }
    this.partners = { checking: false, results };
    this.render("partners");
    return results;
  }

  // ---- rendering ----

  render(part) {
    if (typeof document === "undefined") return;
    const view = VIEWS[part];
    if (view) view(this);
    for (const hook of RENDER_HOOKS) {
      // A drawing that fails must never break a tool: the hook's error is logged, the result stays on the page.
      try {
        hook(part, this);
      } catch (error) {
        console.error(error);
      }
    }
  }
}

/** Browser-only listeners (shell.js draws the art of each view from the page state). Tests register none. */
const RENDER_HOOKS = [];

/** Call fn(part, page) after each part of the page is rendered. */
export function onRender(fn) {
  RENDER_HOOKS.push(fn);
}

// ---- DOM helpers: only #id lookups and createElement, so the Node DOM stand-in can run them ----

function byId(id) {
  return document.getElementById(id);
}

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

const ICONS = { pass: "✓", verified: "✓", fail: "✕", invalid: "✕", unavailable: "⊘", unverifiable: "?", info: "i", warn: "!", block: "■" };

/** A state chip: an icon AND words, never colour alone. The icon is hidden from screen readers; the words are not. */
export function chip(state, words) {
  const node = el("span", null, `chip chip-${state}`);
  const icon = el("span", ICONS[state] || "•", "chip-icon");
  icon.setAttribute("aria-hidden", "true");
  node.append(icon, el("span", words, "chip-words"));
  return node;
}

function adapterName(adapter) {
  return Object.hasOwn(STRINGS.gate.adapters, adapter) ? STRINGS.gate.adapters[adapter] : adapter;
}

function renderGate(page) {
  const out = byId("gate-result");
  const report = page.gate;
  if (!report) {
    out.replaceChildren(el("p", t("gate.empty"), "empty"));
    return;
  }
  const head = el("p", null, "overall");
  head.append(el("span", `${t("gate.overall")}: `), chip(report.state, t(`states.${report.state}`)), el("span", ` ${report.target}`, "target"));
  const list = el("ul", null, "findings");
  for (const f of report.findings) {
    const item = el("li", null, `finding finding-${f.state}`);
    const name = el("strong", adapterName(f.adapter));
    item.append(name, el("span", " "), chip(f.state, t(`states.${f.state}`)));
    // A checker service the browser could not read is said in words. The validator port runs here, so only Atlas and
    // Customs can be unreachable; "the target could not be reached" is about the site, not the checker.
    if (f.state === "unavailable" && (f.adapter === "atlas" || f.adapter === "customs") && !f.summary.includes("the target could not be reached") && /could not be (reached|fetched)/.test(f.summary)) {
      item.append(el("p", t("gate.unreachable", { name: adapterName(f.adapter) }), "unreachable"));
    }
    item.append(el("p", f.summary, "summary"));
    list.append(item);
  }
  out.replaceChildren(head, list, el("p", t("gate.corsNote"), "note"));
}

function renderDrift(page) {
  const out = byId("drift-result");
  const d = page.drift;
  if (!d) {
    out.replaceChildren(el("p", t("drift.empty"), "empty"));
    return;
  }
  const nodes = [];
  const where = el("p", `${t("drift.lockAt")} ${d.lockUrl}`, "target");
  nodes.push(where);
  // Only a 404 or 410 is "no lock" (D6); a refused read says so.
  if (d.lockState === "absent") nodes.push(el("p", t("drift.noLock"), "notice"));
  else if (d.lockState === "refused") nodes.push(el("p", t("drift.refused"), "notice"));
  else if (!d.lockFound) nodes.push(el("p", t("drift.notRead"), "notice"));
  // D3: a lock not covered by a signature verified under a publisher you trust is labelled, and a clean reading of one
  // never reads as plain "No drift".
  if (d.lockFound) nodes.push(el("p", d.lockLabel || t("drift.unsignedLock"), d.lockSigned ? "note" : "notice lock-unsigned"));
  if (d.lockFound && d.findings.length === 0) nodes.push(el("p", d.lockSigned ? t("drift.clean") : t("drift.cleanUnsigned"), "notice"));
  for (const kind of ["grounding", "runtime", "peer"]) {
    const group = d.findings.filter((f) => f.kind === kind);
    if (!group.length) continue;
    const section = el("section", null, "drift-group");
    section.append(el("h4", `${t(`drift.kinds.${kind}`)} (${group.length})`));
    const list = el("ul", null, "findings");
    for (const f of group) {
      const item = el("li", null, `finding finding-${f.severity}`);
      item.append(chip(f.severity, t(`drift.severity.${f.severity}`)), el("span", " "), el("code", f.ref));
      if (kind === "peer" && d.unreachablePeers.includes(f.ref)) {
        const peer = PARTNERS.find((p) => f.ref === p.network);
        item.append(el("p", t("gate.unreachable", { name: peer ? peer.name : f.ref }), "unreachable"));
      }
      item.append(el("p", f.summary, "summary"));
      if (f.expected || f.actual) {
        const pair = [];
        if (f.expected) pair.push(`${t("drift.expected")} ${f.expected}`);
        if (f.actual) pair.push(`${t("drift.actual")} ${f.actual}`);
        item.append(el("p", pair.join(" · "), "hashes"));
      }
      list.append(item);
    }
    section.append(list);
    nodes.push(section);
  }
  if (d.lockFound) nodes.push(el("p", t("drift.notChecked"), "note"));
  out.replaceChildren(...nodes);
}

function renderVerify(page) {
  const out = byId("verify-result");
  const v = page.verification;
  if (!v) {
    out.replaceChildren(el("p", t("verify.empty"), "empty"));
    return;
  }
  const r = v.result;
  const nodes = [];
  const head = el("p", null, "overall");
  const words = r.reason ? `${t(`states.${r.verdict}`)}: ${r.reasonInWords}` : t(`states.${r.verdict}`);
  head.append(chip(r.verdict, words), el("span", ` ${r.target}`, "target"));
  nodes.push(head, el("p", r.meaning, "meaning"));
  if (r.detail) nodes.push(el("p", r.detail, "summary"));
  const facts = el("dl", null, "facts");
  const fact = (label, value) => {
    if (value === undefined || value === null || value === "") return;
    facts.append(el("dt", label), el("dd", String(value)));
  };
  fact(t("verify.signer"), r.kid);
  fact(t("verify.origin"), r.origin);
  fact(t("verify.fetchedFrom"), r.fetchedFrom);
  if (r.signedFiles && r.signedFiles.length) fact(t("verify.covered"), r.signedFiles.join(", "));
  nodes.push(facts);
  if (r.originMismatch) nodes.push(el("p", t("verify.originMismatch"), "notice"));
  const rev = r.revocation;
  if (rev && rev.state !== "absent") {
    const box = el("div", null, `revocation revocation-${rev.state}`);
    box.append(el("p", rev.detail, "notice"));
    for (const one of rev.results || []) box.append(el("p", one.detail, "summary"));
    if (rev.note) box.append(el("p", rev.note, "note"));
    nodes.push(box);
  }
  if (r.keyRevokedBySite) nodes.push(el("p", t("verify.keyRevokedBySite"), "notice"));
  if (v.publishedKey && !page.trust.find(v.publishedKey.kid, r.fetchedFrom)) {
    const box = el("section", null, "first-contact");
    box.setAttribute("aria-labelledby", "first-contact-heading");
    const h = el("h4", t("verify.firstContactHeading"));
    h.id = "first-contact-heading";
    const steps = el("ol");
    steps.append(el("li", t("verify.firstContactStep1")), el("li", t("verify.firstContactStep2")), el("li", t("verify.firstContactStep3")));
    const keyFacts = el("dl", null, "facts");
    keyFacts.append(el("dt", t("verify.publishedKid")), el("dd", v.publishedKey.kid, "kid"), el("dt", t("verify.publishedKey")), el("dd", v.publishedKey.publicKey, "pubkey"));
    const label = el("label", null, "check");
    const box1 = document.createElement("input");
    box1.type = "checkbox";
    box1.id = "trust-compared";
    label.append(box1, el("span", ` ${t("verify.compared")}`));
    const button = el("button", t("verify.trustButton"));
    button.type = "button";
    button.id = "trust-button";
    const status = el("p", page.notices.trustError || "", "status");
    status.setAttribute("role", "status");
    button.addEventListener("click", async () => {
      const result = await page.trustPublisher(box1.checked === true);
      if (!result.ok) {
        page.notices.trustError = result.reason;
        status.textContent = result.reason;
      } else {
        page.notices.trustError = null;
      }
    });
    box.append(h, el("p", t("verify.firstContactLead")), steps, keyFacts, label, button, status);
    nodes.push(box);
  } else if (page.notices.trust) {
    nodes.push(el("p", page.notices.trust, "notice"));
  }
  out.replaceChildren(...nodes);
}

function renderTrust(page) {
  const out = byId("trust-list");
  const entries = page.trust.list();
  const nodes = [];
  if (!entries.length) nodes.push(el("p", t("verify.trustListEmpty"), "empty"));
  else {
    const list = el("ul", null, "trust-entries");
    for (const e of entries) {
      const item = el("li");
      if (e.forgotten) {
        // A tombstone (D5): the key was revoked, then forgotten. It carries no trust and has no Forget: it stays, so the
        // key cannot be trusted again from this page.
        item.className = "revoked";
        item.append(el("code", e.kid), el("span", " "), chip("invalid", t("verify.trustForgotten", { date: e.revokedAt.slice(0, 10) })));
        list.append(item);
        continue;
      }
      const forget = el("button", t("verify.forget"));
      forget.type = "button";
      forget.setAttribute("aria-label", `${t("verify.forget")} ${e.kid} ${e.origin}`);
      forget.addEventListener("click", () => page.forgetPublisher(e.kid, e.origin));
      item.append(el("code", e.kid), el("span", ` ${e.origin} `));
      if (e.revokedAt !== undefined) {
        item.className = "revoked";
        item.append(chip("invalid", t("verify.trustRevoked", { date: e.revokedAt.slice(0, 10) })), el("span", " "));
      }
      item.append(forget);
      list.append(item);
    }
    nodes.push(list);
  }
  if (!page.trust.persistent) nodes.push(el("p", t("verify.storageUnavailable"), "note"));
  out.replaceChildren(...nodes);
}

function downloadLink(item, label) {
  const a = el("a", label, "download");
  if (item.url) a.setAttribute("href", item.url);
  a.setAttribute("download", item.name);
  return a;
}

function renderKey(page) {
  const out = byId("key-result");
  const discard = byId("key-discard");
  const nodes = [];
  if (page.key) {
    const made = el("p", null, "notice");
    made.append(el("span", `${t("key.made")} `), el("code", page.key.kid, "kid"));
    const list = el("ul", null, "downloads");
    for (const o of page.key.offers) {
      const li = el("li");
      const link = downloadLink(o, o.label);
      // D4: once the visitor has used the private key's download, the assistant may make another key.
      if (o.path === PRIVATE_KEY_FILE) link.addEventListener("click", () => page.markKeyDownloaded());
      li.append(link);
      list.append(li);
    }
    nodes.push(made, list);
    discard.hidden = false;
  } else {
    if (page.notices.key) nodes.push(el("p", page.notices.key, "notice"));
    discard.hidden = true;
  }
  out.replaceChildren(...nodes);
}

function renderSign(page) {
  const out = byId("sign-result");
  const s = page.signing;
  renderLedger(page);
  const nodes = [];
  if (s.busy) nodes.push(el("p", t("sign.preparing"), "status"));
  const check = page.checkSign();
  const state = el("p", null, "overall");
  state.append(el("strong", check.ok ? t("sign.ready") : t("sign.notReady")));
  if (!check.ok && (s.keyFile || s.siteFiles.length || s.origin)) state.append(el("span", ` ${check.reason}`));
  nodes.push(state);
  if (s.keyFile && s.keyFile.kid) {
    const k = el("p");
    k.append(el("span", `${t("dialog.kid")}: `), el("code", s.keyFile.kid, "kid"));
    nodes.push(k, el("p", t("sign.keyMemory"), "note"));
  }
  if (page.signature) {
    nodes.push(el("p", t("sign.signed"), "notice"));
    nodes.push(downloadLink(page.signature.offer, t("sign.download")));
  }
  if (page.notices.sign) nodes.push(el("p", page.notices.sign, "notice"));
  out.replaceChildren(...nodes);
}

/** The manifest beside the signing form: every file the signature will cover, with its SHA-256. */
function renderLedger(page) {
  const out = byId("sign-ledger");
  const s = page.signing;
  const nodes = [];
  if (!s.subjects.length) nodes.push(el("p", t("sign.ledgerEmpty"), "ledger__empty"));
  for (const x of s.subjects) {
    const row = el("div", null, "cargo__row");
    const dot = el("span", null, "cargo__dot");
    dot.setAttribute("aria-hidden", "true");
    row.append(dot, el("code", x.path, "cargo__p"), el("span", `sha256 ${x.sha256}`, "cargo__d"));
    nodes.push(row);
  }
  if (s.subjects.length && s.ignored.length) nodes.push(el("p", t("sign.ledgerIgnored", { names: s.ignored.join(", ") }), "note"));
  out.replaceChildren(...nodes);
}

function renderPartners(page) {
  const out = byId("partners-result");
  const p = page.partners;
  if (!p) {
    out.replaceChildren();
    return;
  }
  if (p.checking) {
    out.replaceChildren(el("p", t("partners.checking"), "status"));
    return;
  }
  const list = el("ul", null, "partner-status");
  for (const r of p.results) {
    // Reachable is not a verdict, so it gets no check mark; unreachable is said in words.
    list.append(el("li", r.reachable ? t("partners.reachable", { name: r.name }) : t("partners.unreachable", { name: r.name }), r.reachable ? "reachable" : "unreachable"));
  }
  out.replaceChildren(list);
}

const VIEWS = {
  gate: renderGate,
  drift: renderDrift,
  verify: renderVerify,
  trust: renderTrust,
  key: renderKey,
  sign: renderSign,
  partners: renderPartners,
};

/** The one page object. site-actions.js and site.js import it by this module's URL. */
export class App {
  static page = new DeskPage();
}

// ---- page wiring (browser only) ----

function fillStrings() {
  for (const node of document.querySelectorAll("[data-s]")) node.textContent = t(node.dataset.s);
  for (const node of document.querySelectorAll("[data-href]")) node.setAttribute("href", t(node.dataset.href));
  for (const node of document.querySelectorAll("[data-placeholder]")) node.setAttribute("placeholder", t(node.dataset.placeholder));
  for (const node of document.querySelectorAll("[data-label]")) node.setAttribute("aria-label", t(node.dataset.label));
  const custody = byId("custody-list");
  custody.replaceChildren(...STRINGS.key.custody.map((line) => el("li", line)));
  document.title = t("meta.title");
}

function busy(statusId, text) {
  const node = byId(statusId);
  node.textContent = text || "";
}

/** Run a page handler: show a status while it runs, show a refusal, never leave the page broken. */
async function handle(statusId, runningText, work) {
  busy(statusId, runningText);
  try {
    const result = await work();
    busy(statusId, result && result.ok === false ? result.reason : "");
  } catch (error) {
    console.error(error);
    busy(statusId, t("errors.unexpected"));
  }
}

function wireForm(formId, inputId, statusId, runningKey, method) {
  // D1: an address the visitor types into the page's own field is one the assistant may then use.
  byId(inputId).addEventListener("change", (event) => App.page.noteVisitorTarget(event.target.value));
  byId(formId).addEventListener("submit", (event) => {
    event.preventDefault();
    const target = byId(inputId).value;
    App.page.noteVisitorTarget(target);
    void handle(statusId, t(runningKey), () => App.page[method]({ target }));
  });
}

async function signFromPage() {
  const page = App.page;
  const check = page.checkSign();
  if (!check.ok) return check;
  const content = page.signDialogContent(check, `sign_files on ${location.origin} (irreversible)\n${JSON.stringify({ expectedVersion: check.version }, null, 2)}`);
  const confirmed = await new Promise((resolve) => openReviewDialog(content, resolve));
  if (!confirmed) {
    page.notices.sign = t("sign.declined");
    page.render("sign");
    return { ok: true };
  }
  page.notices.sign = null;
  return page.signFiles({ expectedVersion: check.version });
}

function wire() {
  const page = App.page;
  wireForm("gate-form", "gate-target", "gate-status", "gate.running", "runGate");
  wireForm("drift-form", "drift-target", "drift-status", "drift.running", "readDrift");
  wireForm("verify-form", "verify-target", "verify-status", "verify.running", "verifySite");
  byId("key-generate").addEventListener("click", () => void handle("key-status", "", () => page.generateKey()));
  byId("key-discard").addEventListener("click", () => page.discardKey());
  byId("sign-origin").addEventListener("change", (event) => page.setSignOrigin(event.target.value));
  byId("sign-days").addEventListener("change", (event) => page.setSignDays(event.target.value));
  byId("sign-key").addEventListener("change", (event) => void handle("sign-status", "", () => page.chooseKeyFile(event.target.files && event.target.files[0])));
  byId("sign-files").addEventListener("change", (event) => void handle("sign-status", "", () => page.chooseSiteFiles(event.target.files)));
  byId("sign-button").addEventListener("click", () => void handle("sign-status", "", signFromPage));
  byId("sign-clear").addEventListener("click", () => {
    byId("sign-key").value = "";
    byId("sign-files").value = "";
    page.notices.sign = null;
    page.clearSigning();
  });
  byId("partners-check").addEventListener("click", () => void handle("partners-status", "", () => page.checkPartners()));
}

if (typeof window !== "undefined" && typeof document !== "undefined" && typeof document.querySelectorAll === "function" && !globalThis.__deskNoWire) {
  fillStrings();
  const page = App.page;
  page.signing.origin = byId("sign-origin").value.trim();
  page.signing.days = Number(byId("sign-days").value) || 90;
  wire();
  for (const part of Object.keys(VIEWS)) page.render(part);
}
