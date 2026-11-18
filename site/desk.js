// The Desk's page object: one instance, App.page, created at load. The page's own buttons and the assistant's
// website_* tools (site-actions.js) call the same methods, so both follow one set of rules. Each operation checks its
// whole input first and refuses by returning {ok: false, reason, field} without changing anything; it throws only on
// an unexpected failure. Operations never move focus; the page's handlers do.
//
// Private keys: generateKey() puts the private key file only into a downloadable Blob on this page; it is never kept
// in storage, never sent anywhere and never returned to a caller. A key file the visitor picks for signing is held in a
// private field until it is signed with or cleared. No result of any operation contains private key material.

import { t, STRINGS } from "./strings.js";
import { fetchableUrl, makeBrowserFetcher } from "./fetcher.js";
import { lockProblem, publishedUrl, readDrift, siteBase } from "./drift.js";
import { checkPeerBeforeLoad } from "./lib/plumbline/browser/preload.js";
import { openReviewDialog } from "./review-dialog.js";
import { runGateWith, ALL_ADAPTERS } from "./lib/plumbline/gate/run.js";
import { gateSentence, siteUnreachable } from "./lib/plumbline/gate/context.js";
import { DEFAULT_TIMEOUT_MS } from "./lib/plumbline/net/fetch-types.js";
import {
  ALG,
  FORMAT_VERSION,
  KEY_FILE,
  KEY_TYPE,
  REVOCATION_FILE,
  ROTATION_FILE,
  SIGNATURE_FILE,
  applyRevocationText,
  derivePublicKey,
  LOCK_FILE,
  generateKey,
  isAcceptableOrigin,
  isKid,
  isPrivateKeyFile,
  isPublicKey,
  isSafeSubjectPath,
  keyId,
  keyIdOfPrivate,
  parseManifest,
  revokeKey,
  signSubjects,
  signedPathsOf,
  signerChangeDetail,
  spreadRevocations,
  statementsOf,
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
/** The CLI's trust file (docs/signature-format.md, "plumbline.trust.json (CLI format)"); core names no constant for it. */
export const TRUST_FILE = "plumbline.trust.json";
const MAX_DAYS = 3650;
// How long the private key's object URL outlives the click on its download link. The browser reads a blob: URL when
// the download starts, right after the click's event handlers return; revoking it inside the handler can cancel the
// download, and a second is far longer than that start takes. Not a measured ceiling: a margin over "after the click".
const RELEASE_AFTER_MS = 1000;
const DAY_MS = 86_400_000;

/**
 * The most partners of one site a page check reads (UAT-26). Derivation: each check reads about eight files of the
 * partner plus the files its signature lists; the largest lock in the UAT worlds pins four sellers and a card, the
 * Desk's own two; 24 is several times a real marketplace page's partners and keeps one check to a few hundred reads
 * of the page's fetcher. The page says when it checked only the first ones.
 */
const MAX_SITE_PEERS = 24;

/** Which part of a partner a lock finding is about, by its code (UAT-17): its definition, its links.json or its signer. */
function partOf(finding) {
  const code = String(finding.code || "");
  if (code === "peer-changed") return "definition";
  if (code.startsWith("peer-links-")) return "links";
  if (code.startsWith("signer-")) return "signer";
  return "other";
}

/** A stranger's string made safe for a line of text: control and bidi-override characters become `?`. */
function printable(text) {
  return String(text).replace(/[\u0000-\u001f\u007f-\u009f\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "?");
}

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
  const url = fetchableUrl(value);
  if (url === null || url.username || url.password || url.search || url.hash || !HOSTNAME.test(url.hostname)) return withheld();
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
  const url = fetchableUrl(target.trim());
  return url === null ? null : url.href;
}

/**
 * True when this page runs inside another page's frame. GitHub Pages cannot send frame-ancestors (site/_headers), so a
 * framing site could lay its own buttons over the Desk's (click-jacking); in a frame the Desk refuses every action that
 * adds trust, makes or uses a key. A frame whose top cannot even be compared counts as framed.
 */
export function isFramed(win = typeof window === "undefined" ? undefined : window) {
  if (!win) return false;
  try {
    return win.top !== win.self;
  } catch {
    return true;
  }
}

// RFC 8032, test 1: a valid Ed25519 public key, used only to ask the browser whether it can import one.
const PROBE_PUBLIC_KEY = new Uint8Array("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a".match(/../g).map((h) => parseInt(h, 16)));

/** True when this browser's WebCrypto does Ed25519 (the Desk's keys, signatures and verdicts all need it). */
export async function probeEd25519(subtle = globalThis.crypto && globalThis.crypto.subtle) {
  if (!subtle || typeof subtle.importKey !== "function") return false;
  try {
    await subtle.importKey("raw", PROBE_PUBLIC_KEY, "Ed25519", false, ["verify"]);
    return true;
  } catch {
    return false;
  }
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
    return this.addAll([entry]);
  }

  /** The stored shape of an entry (kid, origin, publicKey, and revokedAt and adoptedVia when set). */
  static entryOf(e) {
    return TrustBook.#entry(e);
  }

  /** Replaces the whole store with the entries a VERIFIED revocation returned (applyRevocationText's outcome.entries). */
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

  /**
   * The store in the CLI's trust file format (docs/signature-format.md, "plumbline.trust.json (CLI format)"):
   * {version: 1, entries: [{kid, origin, publicKey, revokedAt?, adoptedVia?}]}. Tombstones have no place in it (an
   * entry needs an origin and a key), so they are counted, not written.
   */
  exportFile() {
    return { file: { version: 1, entries: this.entries.map(TrustBook.#entry) }, leftOut: this.list().filter((e) => e.forgotten).length };
  }

  /**
   * Adds or replaces the entries for each (kid, origin), saved once. A key already marked revoked under any origin, or
   * forgotten after it was revoked, stays revoked.
   */
  addAll(entries) {
    for (const entry of entries) {
      const revokedAt = entry.revokedAt ?? this.forKid(entry.kid).find((e) => e.revokedAt !== undefined)?.revokedAt ?? this.tombstone(entry.kid)?.revokedAt;
      this.entries = this.entries.filter((e) => !(e.kid === entry.kid && e.origin === entry.origin));
      this.entries.push(TrustBook.#entry({ ...entry, ...(revokedAt !== undefined ? { revokedAt } : {}) }));
    }
    this.#spread();
    return this.save();
  }
}

/**
 * Reads a trust file in the CLI's format for import. Every entry is held to the Desk's stored-entry patterns (core's
 * isKid and isPublicKey, an acceptable origin, an ISO revokedAt, a kid adoptedVia) and its kid must be derived from
 * its own key; anything else is rejected, never repaired. Nothing is added here: the page lists the result and the
 * visitor confirms it with a button.
 *
 * :return: {ok: true, entries, rejected} or {ok: false, reason}.
 */
export async function readTrustFile(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return refuse(t("verify.import.notJson"));
  }
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.entries)) return refuse(t("verify.import.notTrustFile"));
  const entries = [];
  let rejected = 0;
  for (const raw of value.entries) {
    let derived = null;
    if (storedEntryOk(raw)) {
      try {
        derived = await keyId(raw.publicKey);
      } catch {
        derived = null;
      }
    }
    if (derived !== null && derived === raw.kid) entries.push(TrustBook.entryOf(raw));
    else rejected += 1;
  }
  return { ok: true, entries, rejected };
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

/**
 * True when every signed subject the Desk read has its signed digest: a tampered verdict then rests only on files that
 * could not be read. Only safe paths are in `have`, so a listed path outside the pattern is never looked up.
 */
async function readSubjectsMatch(listed, have) {
  for (const subject of listed) {
    if (!subject || !isSafeSubjectPath(subject.path) || !have.has(subject.path)) continue;
    if ((await subjectDigest(have.get(subject.path))) !== subject.sha256) return false;
  }
  return true;
}

/**
 * The files a verdict names, sorted, joined as words: "a", "a and b", "a, b and c"; past five, the first five and how
 * many more. Every name is a fixed file name or a path that passed core's subject-path pattern.
 */
function fileList(names) {
  const sorted = [...names].sort();
  const shown = sorted.length > 5 ? [...sorted.slice(0, 5), `${sorted.length - 5} more`] : sorted;
  return shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
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
    // This Desk's own lock, beside this module: the pins the partner check compares with (as site.js's consent check).
    this.ownLockUrl = deps.ownLockUrl || new URL(LOCK_FILE, new URL("./", import.meta.url)).href;
    // Origins the visitor typed or picked in the page's own address fields this session (D1).
    this.visitorOrigins = new Set();
    this.trust = new TrustBook(deps.storage === undefined ? defaultStorage() : deps.storage);
    this.gate = null;
    this.drift = null;
    this.verification = null;
    this.key = null;
    this.signature = null;
    this.partners = null;
    this.sitePeers = null;
    this.signing = { version: 0, busy: false, origin: "", days: 90, keyFile: null, siteFiles: [], subjects: [], ignored: [], problem: null };
    this.notices = {};
    // In another site's frame, nothing that adds trust or makes or uses a key runs (isFramed).
    this.framed = deps.framed === undefined ? isFramed() : deps.framed;
    // Whether this browser does Ed25519: null until probed once (ed25519Ready), then true or false.
    this.probe = deps.probe || probeEd25519;
    this.ed25519 = null;
    this.ed25519Probe = null;
    // Each read tool's run number: a slower answer to an earlier question never replaces the newer one on the page.
    this.runs = { gate: 0, drift: 0, verify: 0, sitePeers: 0 };
    this.trustImport = null;
    this.trustExport = null;
    this.revocation = null;
    // Runs a step a moment later: after a click on a download link, once the browser has started the download.
    this.later = deps.later || ((fn) => setTimeout(fn, RELEASE_AFTER_MS));
  }

  /** Test and embedding hook: replace the fetcher, the clock, the storage, the frame test, the Ed25519 probe or later. */
  configure(deps = {}) {
    if (deps.fetch) this.fetch = deps.fetch;
    if (deps.ownOrigin) this.ownOrigin = deps.ownOrigin;
    if (deps.ownLockUrl) this.ownLockUrl = deps.ownLockUrl;
    if (deps.now) this.now = deps.now;
    if (deps.storage !== undefined) this.trust = new TrustBook(deps.storage);
    if (deps.framed !== undefined) this.framed = deps.framed;
    if (deps.later) this.later = deps.later;
    if (deps.probe) {
      this.probe = deps.probe;
      this.ed25519 = null;
      this.ed25519Probe = null;
    }
  }

  /** Asks the browser once whether it does Ed25519; every later call returns the same answer. */
  async ed25519Ready() {
    if (this.ed25519Probe === null) {
      this.ed25519Probe = Promise.resolve()
        .then(() => this.probe())
        .then(
          (ok) => ok === true,
          () => false,
        )
        .then((ok) => {
          this.ed25519 = ok;
          return ok;
        });
    }
    return this.ed25519Probe;
  }

  /** The refusal for an action that adds trust or makes or uses a key, when the page is framed or lacks Ed25519. */
  async #refuseKeyWork() {
    if (this.framed) return refuse(t("errors.framed"));
    if (!(await this.ed25519Ready())) return refuse(t("errors.noEd25519"));
    return null;
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
      lastVerification: this.verification ? (this.verification.refused ? { refused: this.verification.refused.reason } : this.verification.result) : null,
      generatedKey: this.key ? { kid: this.key.kid, offeredOnPage: this.key.offers.filter((o) => !o.released).map((o) => o.path), downloaded: this.key.downloaded } : null,
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
    const run = ++this.runs.gate;
    const report = await runGateWith({ target, adapters: [...ALL_ADAPTERS] }, { fetch: this.fetch, defaultTimeoutMs: DEFAULT_TIMEOUT_MS, now: this.now });
    // The caller gets its own answer; the page keeps showing the answer to the last question asked.
    if (run === this.runs.gate) {
      this.gate = report;
      this.render("gate");
    }
    return report;
  }

  // ---- read: drift ----

  async readDrift(args, how = {}) {
    const target = checkTarget(args && args.target);
    if (target === null) return refuse(t("errors.badTarget"), "target");
    const denied = this.#refuseUnchosen(target, how);
    if (denied) return denied;
    const run = ++this.runs.drift;
    const base = await siteBase(target, this.fetch);
    // D3: the signature is verified first, against the trust store as it is (nothing is written), and the lock bytes it
    // read are the ones drift compares, so a host cannot serve the signed lock to the check and another to the reading.
    // A lock not covered by a VERIFIED signature is labelled, on every result: the host can rewrite it.
    const check = await this.#verifyAt(base, { persist: false });
    const lockSigned = check.result !== undefined && check.result.verdict === "verified" && check.subjects.includes(LOCK_FILE);
    const result = await readDrift(target, this.fetch, { timeoutMs: DEFAULT_TIMEOUT_MS, base, lockFetch: check.lockFetch });
    result.lockSigned = lockSigned;
    // UAT-7 (MAR-L1-10, TOM-L2-04, REC-4): "unsigned" is said only of a lock no signature covers. A lock the site's
    // signature covers reads "signed by a key you have not trusted" while that signature is unverifiable here, and
    // "its signature does not hold" when it is invalid; only a verified one is "Signed lock".
    result.lockCover = lockCoverOf(check);
    result.lockLabel = t(`drift.${result.lockCover}Lock`);
    if (run === this.runs.drift) {
      this.drift = result;
      this.render("drift");
    }
    return {
      target: result.target,
      lockUrl: safeUrl(result.lockUrl),
      lockFound: result.lockFound,
      lockState: result.lockState,
      lockSigned,
      lockCover: result.lockCover,
      lock: result.lockLabel,
      findings: result.findings.map(safeFinding),
      unreachablePeers: result.unreachablePeers.map(safeRef),
    };
  }

  // ---- read: verify ----

  async verifySite(args, how = {}) {
    const run = ++this.runs.verify;
    // "Trusted" belongs to the verdict right after the Trust button only (trustPublisher sets it again).
    this.notices.trust = null;
    // The verdict on the page always belongs to the last address asked: a refusal replaces the one shown before.
    const show = (verification) => {
      if (run !== this.runs.verify) return;
      this.verification = verification;
      this.render("verify");
    };
    const refused = (refusal) => {
      const asked = args && typeof args.target === "string" ? args.target.trim().slice(0, 300) : "";
      show({ result: null, refused: { target: asked, reason: refusal.reason }, publishedKey: null });
      return refusal;
    };
    const target = checkTarget(args && args.target);
    if (target === null) return refused(refuse(t("errors.badTarget"), "target"));
    const denied = this.#refuseUnchosen(target, how);
    if (denied) return refused(denied);
    // Without Ed25519 every signature check would fail and read as a false "invalid": say why nothing was verified.
    if (!(await this.ed25519Ready())) {
      const none = { target, verdict: "unverifiable", detail: t("errors.noEd25519Verify"), meaning: t("verdicts.unverifiableMeaning"), signed: false };
      show({ result: none, publishedKey: null });
      return none;
    }
    const base = await siteBase(target, this.fetch);
    // The revocation is read first, so a key the site has revoked is dead for this verdict (and in the trust store),
    // whether or not the site still publishes a signature.
    const check = await this.#verifyAt(base, { persist: true });
    if (check.revocation.state === "applied") this.render("trust");
    if (check.refusal) return refused(refuse(check.refusal, "target"));
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
      // UAT-8 (INE-L2-1): the first line names an origin mismatch or a swapped signer, never "not met this signer"
      meaning:
        r.verdict === "unverifiable" && check.signed && check.originMismatch
          ? t("verdicts.unverifiableOriginMeaning", { fetchedFrom: safeUrl(check.fetchedFrom) })
          : r.verdict === "unverifiable" && check.signed && check.swapped
            ? t(check.swapped === "rotation" ? "verdicts.unverifiableRotatedMeaning" : "verdicts.unverifiableSwappedMeaning")
            : t(`verdicts.${r.verdict}Meaning`),
      ...(check.signed && check.expiresAt ? { expiresAt: check.expiresAt } : {}),
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
    show({ result: full, publishedKey: check.firstContact || null });
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
    // A file the site says is gone (404 or 410, or a path that leaves the site) is missing: core calls a missing signed
    // file tampered. A file the browser could not read (refused, offline, a timeout or another HTTP answer) is unread:
    // it may be intact, so it can make the verdict neither tampered nor verified.
    const unreadFiles = [];
    let gone = false;
    for (const rel of wanted) {
      if (have.has(rel)) continue;
      const url = publishedUrl(rel, base);
      if (url === null) {
        gone = true;
        continue;
      }
      try {
        const response = await this.fetch(url);
        if (response.ok) have.set(rel, response.bytes);
        else if (response.status === 404 || response.status === 410) gone = true;
        else unreadFiles.push(rel);
      } catch {
        unreadFiles.push(rel);
      }
    }
    const files = [...have].map(([path, content]) => ({ path, content }));

    // Trust covers files published FROM an origin: core's expectedOrigin turns a signature made for another origin into
    // unverifiable (an invalid one stays invalid), exactly as `plumbline verify --origin` does.
    let result = await verifySignature(signature, files, trust, { now: this.now(), expectedOrigin: fetchedFrom, ...(publishedKey ? { publishedKey } : {}) });
    // links.json or the lock could not be read (refused, or an HTTP error): the Desk cannot tell whether the signature
    // covers everything the runtime loads, so a verified result is not claimed.
    const unknown = [[links, LINKS_FILE], [lock, LOCK_FILE]].filter(([x]) => x.state === "unknown").map(([, name]) => name);
    const revocationUnread = revocation.state === "unavailable";
    if (result.verdict === "verified" && unknown.length && !unreadFiles.length && !revocationUnread) {
      result = { verdict: "unverifiable", kid: result.kid, origin: result.origin, detail: t("verify.coverageUnknown", { files: unknown.join(" and ") }) };
    } else if (unreadFiles.length || revocationUnread || unknown.length) {
      // Like `plumbline verify --url`: a verified result is not claimed over a file that could not be read, the
      // revocation included (it might revoke this very key). A tampered result is withdrawn only when it may rest on an
      // unread signed file: no signed file is gone, and every signed file that was read has its signed digest.
      const tamperedByUnread = result.reason === "tampered" && unreadFiles.length > 0 && !gone && (await readSubjectsMatch(listed, have));
      if (result.verdict === "verified" || tamperedByUnread) {
        const names = [...new Set([...(revocationUnread ? [REVOCATION_FILE] : []), ...unreadFiles, ...unknown])];
        result = { verdict: "unverifiable", ...(result.kid ? { kid: result.kid } : {}), ...(result.origin ? { origin: result.origin } : {}), detail: t("verify.unread", { files: fileList(names) }) };
      }
    }
    const signedKid = isRecord(signature) && isKid(signature.kid) ? signature.kid : null;
    // D5: a key this browser holds as revoked (an entry for another origin, or a tombstone the visitor kept by
    // forgetting it) is dead here too: a revocation recorded anywhere counts everywhere, so never a stranger to trust.
    const knownRevoked = signedKid !== null && (this.trust.tombstone(signedKid) !== undefined || this.trust.forKid(signedKid).some((e) => e.revokedAt !== undefined));
    if (knownRevoked && result.verdict !== "invalid") result = revokedResult("signature", signedKid, signature.origin);
    const originMismatch = isRecord(signature) && typeof signature.origin === "string" && signature.origin !== fetchedFrom;
    // A site that publishes a revocation of the very key it signs with gets no first-contact offer: a revocation only
    // ever takes trust away, so it is honoured here even when this browser never trusted the key.
    // a revocation file may list several keys (core: kids); the site revokes its own signing key if any of them is it
    const keyRevokedBySite = signedKid !== null && (Array.isArray(revocation.kids) ? revocation.kids.includes(signedKid) : revocation.kid === signedKid);
    // UAT-8 (TOM-L2-03): a signer this browser has not trusted here while it trusts another key for this origin is a
    // swapped signer: said as such (core's sentence, the CLI's too), and never offered as a first contact
    let swapped;
    if (result.verdict === "unverifiable" && !originMismatch && signedKid !== null) {
      let rotationFrom = [];
      try {
        const rotation = await this.fetch(`${base}${ROTATION_FILE}`);
        const listed = rotation.ok ? statementsOf(JSON.parse(rotation.text())) : {};
        if (Array.isArray(listed.statements)) rotationFrom = listed.statements.map((s) => (isRecord(s) ? s.from : undefined)).filter(isKid);
      } catch {
        rotationFrom = [];
      }
      const sentence = signerChangeDetail(this.trust.entries, signedKid, fetchedFrom, rotationFrom);
      if (sentence !== undefined) {
        result = { ...result, detail: sentence };
        swapped = this.trust.entries.some((e) => e.origin === fetchedFrom && e.revokedAt === undefined && rotationFrom.includes(e.kid)) ? "rotation" : "none";
      }
    }
    const firstContact =
      result.verdict === "unverifiable" && swapped === undefined && !originMismatch && !keyRevokedBySite && !knownRevoked && publishedKey && isKid(publishedKey.kid) && publishedKey.kid === signedKid && isPublicKey(publishedKey.publicKey)
        ? { kid: publishedKey.kid, publicKey: publishedKey.publicKey }
        : null;
    return {
      ...out,
      result,
      signed: true,
      originMismatch,
      keyRevokedBySite,
      ...(swapped !== undefined ? { swapped } : {}),
      expiresAt: isRecord(signature) && isIsoUtc(signature.expiresAt) ? signature.expiresAt : undefined,
      firstContact,
      signedFiles: listed.map((x) => (x && typeof x.path === "string" ? x.path : "?")),
      subjects: listed.filter((x) => x && isSafeSubjectPath(x.path)).map((x) => x.path),
    };
  }

  /**
   * Reads plumbline-revocation.json from the site base and applies its text with core's applyRevocationText(text,
   * entries), the one rule the CLI shares: it checks the revocation against every trust entry for its kid (a revocation
   * names no origin). Only a VERIFIED revocation changes anything, and only by taking trust away: the store becomes the
   * outcome's entries, the revocation spread to every origin and down every adoptedVia chain. Absent (404/410) is normal
   * and changes nothing; a file that cannot be read is reported as unavailable, never as "no revocation".
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
    // core parses the text and quotes a kid only when it holds its pattern; whatever file format core accepts, the
    // Desk accepts with no code of its own.
    const { applied, kid, results, entries: working } = await applyRevocationText(response.text(), this.trust.entries);
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
    if (this.framed) return refuse(t("errors.framed"));
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
    this.render("trust");
    // The verdict under the new trust store, right away: the same site verified again (a page call, as the visitor's).
    const again = await this.verifySite({ target: v.result.target });
    this.notices.trust = saved ? t("verify.trusted") : `${t("verify.trusted")} ${t("verify.storageUnavailable")}`;
    this.render("verify");
    return { ok: true, kid, origin: v.result.fetchedFrom, ...(again && again.verdict ? { verdict: again.verdict } : {}) };
  }

  forgetPublisher(kid, origin) {
    this.trust.remove(kid, origin);
    this.render("trust");
    return { ok: true };
  }

  // ---- the trust store as the CLI's plumbline.trust.json (page only; never a tool) ----

  /** Offers the trust store as plumbline.trust.json, the file `plumbline verify --trust` reads. */
  exportTrust() {
    const { file, leftOut } = this.trust.exportFile();
    if (this.trustExport) revoke(this.trustExport.offer);
    this.trustExport = { offer: offer(TRUST_FILE, `${JSON.stringify(file, null, 2)}\n`), count: file.entries.length, leftOut };
    this.render("trust");
    return { ok: true, entries: file.entries.length, leftOut };
  }

  /**
   * The visitor picked a trust file to import. It is read and checked, and what it would change is listed on the page;
   * nothing is added until the visitor presses the confirm button (confirmTrustImport).
   */
  async chooseTrustImport(file) {
    this.trustImport = null;
    if (!file) {
      this.render("trust");
      return { ok: true };
    }
    let text;
    try {
      text = await readFileText(file);
    } catch {
      text = "";
    }
    const read = await readTrustFile(text);
    if (!read.ok) {
      this.trustImport = { problem: read.reason };
      this.render("trust");
      return read;
    }
    const changes = [];
    let unchanged = 0;
    for (const entry of read.entries) {
      const known = this.trust.find(entry.kid, entry.origin);
      const revokedHere = this.trust.tombstone(entry.kid) !== undefined || this.trust.forKid(entry.kid).some((e) => e.revokedAt !== undefined);
      if (known && known.publicKey === entry.publicKey && (known.revokedAt !== undefined || entry.revokedAt === undefined) && known.adoptedVia === entry.adoptedVia) {
        unchanged += 1;
        continue;
      }
      const kind = entry.revokedAt !== undefined ? "revokes" : revokedHere ? "staysRevoked" : known ? "replaces" : "adds";
      changes.push({ entry, kind });
    }
    this.trustImport = { name: file.name, changes, unchanged, rejected: read.rejected };
    this.render("trust");
    return { ok: true, changes: changes.length, unchanged, rejected: read.rejected };
  }

  /** The visitor confirmed the listed import: the entries are added (a revocation in them only takes trust away). */
  confirmTrustImport() {
    if (this.framed) return refuse(t("errors.framed"));
    const pending = this.trustImport;
    if (!pending || !Array.isArray(pending.changes) || pending.changes.length === 0) return refuse(t("verify.import.nothing"));
    const saved = this.trust.addAll(pending.changes.map((c) => c.entry));
    this.trustImport = { done: t("verify.import.done", { n: pending.changes.length }), saved };
    this.render("trust");
    return { ok: true, added: pending.changes.length };
  }

  cancelTrustImport() {
    this.trustImport = null;
    this.render("trust");
    return { ok: true };
  }

  // ---- write (undoable): generate a key ----

  async generateKey(how = {}) {
    // D4: the assistant never throws away a key the visitor has not downloaded; only the visitor can (Discard).
    if (how.caller === "assistant" && this.key && !this.key.downloaded) return refuse(t("key.keepUndownloaded"));
    const blocked = await this.#refuseKeyWork();
    if (blocked) return blocked;
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

  /**
   * The visitor used the private key file's download link. The download starts from the click; a moment later
   * (this.later) the page lets go of the file: its object URL is revoked, its Blob dropped and the link replaced by a
   * sentence, so the private key stays in page memory only as long as its download needs.
   */
  markKeyDownloaded() {
    const key = this.key;
    if (!key) return { ok: true };
    key.downloaded = true;
    const file = key.offers.find((o) => o.path === PRIVATE_KEY_FILE);
    if (file && !file.releasing) {
      file.releasing = true;
      this.later(() => {
        revoke(file);
        file.url = null;
        file.blob = null;
        file.released = true;
        if (this.key === key) this.render("key");
      });
    }
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

  // ---- revoke a leaked key (page only; never a tool) ----

  /**
   * Makes plumbline-revocation.json with core's revokeKey from a private key file the visitor picked, and offers it as
   * a download. The private key is read here, used once and dropped: it is never stored, returned or shown, and the
   * assistant has no way to reach it. Publishing the file is the visitor's step.
   *
   * :param file: The plumbline.private.json the visitor picked.
   * :param reason: An optional note for people, kept in the statement.
   */
  async revokeWithKeyFile(file, reason = "") {
    const blocked = await this.#refuseKeyWork();
    if (blocked) return this.#revocationRefused(blocked);
    if (!file) return this.#revocationRefused(refuse(t("revoke.noKey"), "key"));
    let parsed;
    try {
      parsed = JSON.parse(await readFileText(file));
    } catch {
      parsed = null;
    }
    // core's shape test, shared with the CLI; a revocation also quotes the kid, so it must hold its pattern.
    const shaped = isPrivateKeyFile(parsed) && isKid(parsed.kid);
    let publicKey = null;
    if (shaped) {
      try {
        publicKey = (await keyIdOfPrivate(parsed.privateKey)) === parsed.kid ? await derivePublicKey(parsed.privateKey) : null;
      } catch {
        publicKey = null;
      }
    }
    if (publicKey === null) return this.#revocationRefused(refuse(t("sign.refusals.badKey"), "key"));
    const note = typeof reason === "string" ? reason.trim().slice(0, 500) : "";
    const now = this.now();
    const statement = await revokeKey({
      privateKey: parsed.privateKey,
      key: { type: KEY_TYPE, version: FORMAT_VERSION, alg: ALG, kid: parsed.kid, publicKey, createdAt: now.toISOString() },
      now,
      ...(note ? { reason: note } : {}),
    });
    if (this.revocation && this.revocation.offer) revoke(this.revocation.offer);
    this.revocation = { kid: statement.kid, revokedAt: statement.revokedAt, offer: offer(REVOCATION_FILE, `${JSON.stringify(statement, null, 2)}\n`) };
    this.render("revoke");
    return { ok: true, kid: statement.kid, revokedAt: statement.revokedAt, offeredOnPage: REVOCATION_FILE };
  }

  #revocationRefused(refusal) {
    if (this.revocation && this.revocation.offer) revoke(this.revocation.offer);
    this.revocation = { problem: refusal.reason };
    this.render("revoke");
    return refusal;
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
      // A browser without Ed25519 cannot read any key: say that, never "not a Plumbline key file".
      if (!(await this.ed25519Ready())) {
        this.signing.keyFile = { name: file.name, unsupported: true };
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(await readFileText(file));
      } catch {
        parsed = null;
      }
      // core's shape test, shared with the CLI; the kid must then belong to the key (keyIdOfPrivate below).
      const ok = isPrivateKeyFile(parsed);
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
    if (this.framed) return refuse(t("errors.framed"));
    if (this.ed25519 === false || (s.keyFile && s.keyFile.unsupported)) return refuse(t("errors.noEd25519"), "key");
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
    // Everything signed is captured here, in the same step as the check: the files the check (and the dialog) listed,
    // never the live list read again after an await, when a change of files could have landed.
    const privateKey = this.#signingKey;
    const files = this.signing.subjects.map((x) => ({ path: x.path, content: x.content }));
    const now = this.now();
    const key = { type: KEY_TYPE, version: FORMAT_VERSION, alg: ALG, kid: check.kid, publicKey: await derivePublicKey(privateKey), createdAt: now.toISOString() };
    const signature = await signSubjects({
      privateKey,
      key,
      origin: check.origin,
      files,
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

  /** This Desk's own published lock, parsed and held to the lock's shape, or undefined when it cannot be read. */
  async #ownLock() {
    try {
      const response = await this.fetch(this.ownLockUrl);
      if (!response.ok) return undefined;
      const parsed = JSON.parse(response.text());
      return lockProblem(parsed) === null ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  async checkPartners() {
    this.partners = { checking: true, results: [] };
    this.render("partners");
    // D3: before a partner's network would run, what a load-path check says of it (lib/plumbline/browser/preload.js,
    // src/browser/preload.ts): its signature against the visitor's trust list, and whether it matches this Desk's own
    // lock. The consent card is the runtime's and is not touched; the result is shown here, beside the partner list. An
    // unsigned partner reads unverifiable, in words, and is not blocked by this check (the consent-time pin check in
    // site.js still declines a partner whose definition differs from the lock).
    const lock = await this.#ownLock();
    const results = [];
    for (const p of PARTNERS) {
      let reachable = false;
      try {
        const response = await this.fetch(new URL("agent-manifest.json", p.page).href);
        reachable = response.ok;
      } catch {
        reachable = false;
      }
      if (!reachable) {
        results.push({ name: p.name, reachable });
        continue;
      }
      const check = await checkPeerBeforeLoad(p.network, { trust: this.trust.entries, fetcher: this.fetch, now: this.now(), ...(lock ? { lock } : {}) });
      const s = check.signature;
      results.push({
        name: p.name,
        reachable,
        verdict: s.verdict,
        ...(s.reason ? { reason: s.reason } : {}),
        ...(s.detail ? { detail: s.detail } : {}),
        lock: check.lock,
        refuse: check.refuse,
      });
    }
    this.partners = { checking: false, results };
    this.render("partners");
    return results;
  }

  // ---- a site's own partners (page only), UAT-26 ----

  /**
   * UAT-26 (TOM-L1-12): another site's own partners, checked before they load. The lock the site publishes names its
   * peers; each pinned one gets the load-path check (checkPeerBeforeLoad: its signature against the visitor's trust list,
   * its network against that lock's pin), and what differs from the pin is said by part (network definition, links.json,
   * signer) from the check's lockFindings, in Plumbline's own sentences. A pending peer was never pinned and is counted,
   * not fetched. Reads only; nothing is trusted or written.
   */
  async checkSitePeers(args) {
    const target = checkTarget(args && args.target);
    if (target === null) return refuse(t("sitePeers.badTarget"), "target");
    const run = ++this.runs.sitePeers;
    this.sitePeers = { checking: true };
    this.render("sitePeers");
    const base = await siteBase(target, this.fetch);
    let lock;
    let lockState = "found";
    try {
      const response = await this.fetch(`${base}${LOCK_FILE}`);
      if (response.status === 404 || response.status === 410) lockState = "absent";
      else if (!response.ok) lockState = "unreadable";
      else {
        try {
          const parsed = JSON.parse(response.text());
          if (lockProblem(parsed) === null) lock = parsed;
          else lockState = "unusable";
        } catch {
          lockState = "unusable";
        }
      }
    } catch (error) {
      lockState = error && error.name === "SafeFetchError" && error.code === "network" ? "refused" : "unreadable";
    }
    const result = { target, lockState, results: [], pending: 0, count: 0 };
    if (lock !== undefined) {
      const peers = Object.keys(lock.peers).sort();
      result.count = peers.length;
      result.pending = Object.keys(lock.pendingPeers || {}).length;
      for (const peer of peers.slice(0, MAX_SITE_PEERS)) {
        const check = await checkPeerBeforeLoad(peer, { trust: this.trust.entries, fetcher: this.fetch, now: this.now(), lock });
        const s = check.signature;
        result.results.push({
          peer: printable(peer),
          verdict: s.verdict,
          ...(s.reason ? { reason: s.reason } : {}),
          ...(s.detail ? { detail: s.detail } : {}),
          lock: check.lock,
          refuse: check.refuse,
          ...(check.refused ? { refused: check.refused } : {}),
          differs: (check.lockFindings || []).filter((f) => f.severity !== "info" || check.lock === "differs").map((f) => ({ part: partOf(f), severity: f.severity, code: f.code, summary: f.summary })),
        });
      }
    }
    if (run === this.runs.sitePeers) {
      this.sitePeers = result;
      this.render("sitePeers");
    }
    return { ok: true, ...result };
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
  // UAT-9: what was checked, in the words every surface uses; a site that did not answer, or nothing checked, is an alarm
  const sentence = gateSentence(report);
  const alarm = report.state === "unavailable" && (siteUnreachable(report) !== null || report.findings.every((f) => f.state === "unavailable"));
  const head = el("p", null, alarm ? "overall is-alarm" : "overall");
  head.append(el("span", `${t("gate.overall")}: `), chip(report.state, t(`states.${report.state}`)), el("span", ` ${report.target}`, "target"));
  head.append(el("span", ` ${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`, "gate-sentence"));
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
  // UAT-10 (PRI-L1-14): a pass here says nothing about the signature, and the view says so where the result is read
  out.replaceChildren(head, list, el("p", t("gate.signatureNote"), "note signature-note"), el("p", t("gate.corsNote"), "note"));
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
  if (d.lockFound && d.findings.length === 0) nodes.push(el("p", d.lockSigned ? t("drift.clean") : t(`drift.clean${capital(d.lockCover || "unsigned")}`), "notice"));
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
  if (v.refused) {
    // A refused address replaces the verdict shown before: nothing was read, so nothing is claimed about any site.
    const head = el("p", null, "overall");
    head.append(el("strong", t("verify.refusedHead")), el("span", ` ${v.refused.target}`, "target"));
    out.replaceChildren(head, el("p", v.refused.reason, "notice"));
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
  // UAT-8: a verdict carries the signature's expiry, so a note can date it
  fact(t("verify.validUntil"), r.expiresAt ? r.expiresAt.slice(0, 10) : undefined);
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
    button.disabled = page.framed;
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
  renderTrustFile(page);
}

/** The export download and the import that waits for the visitor's confirmation. */
function renderTrustFile(page) {
  const out = byId("trust-io-result");
  const nodes = [];
  const x = page.trustExport;
  if (x) {
    nodes.push(downloadLink(x.offer, t("verify.export.download", { n: x.count })));
    if (x.leftOut) nodes.push(el("p", t("verify.export.leftOut", { n: x.leftOut }), "note"));
  }
  const imp = page.trustImport;
  if (imp && imp.problem) nodes.push(el("p", imp.problem, "notice"));
  else if (imp && imp.done) nodes.push(el("p", imp.saved ? imp.done : `${imp.done} ${t("verify.storageUnavailable")}`, "notice"));
  else if (imp) {
    const box = el("section", null, "first-contact trust-import");
    box.setAttribute("aria-labelledby", "trust-import-heading");
    const h = el("h4", t("verify.import.heading", { name: imp.name }));
    h.id = "trust-import-heading";
    box.append(h);
    if (imp.changes.length) {
      box.append(el("p", t("verify.import.lead")));
      const list = el("ul", null, "trust-entries");
      for (const c of imp.changes) {
        const item = el("li");
        item.append(el("code", c.entry.kid), el("span", ` ${c.entry.origin} `), el("span", t(`verify.import.kinds.${c.kind}`), c.kind === "adds" || c.kind === "replaces" ? "import-adds" : "import-revokes"));
        list.append(item);
      }
      box.append(list);
    } else box.append(el("p", t("verify.import.nothing")));
    if (imp.unchanged) box.append(el("p", t("verify.import.unchanged", { n: imp.unchanged }), "note"));
    if (imp.rejected) box.append(el("p", t("verify.import.rejected", { n: imp.rejected }), "notice"));
    const row = el("div", null, "btnrow");
    if (imp.changes.length) {
      const confirm = el("button", t("verify.import.confirm", { n: imp.changes.length }));
      confirm.type = "button";
      confirm.id = "trust-import-confirm";
      confirm.disabled = page.framed;
      confirm.addEventListener("click", () => {
        const result = page.confirmTrustImport();
        if (!result.ok) byId("trust-io-status").textContent = result.reason;
      });
      row.append(confirm);
    }
    const cancel = el("button", t("verify.import.cancel"));
    cancel.type = "button";
    cancel.id = "trust-import-cancel";
    cancel.addEventListener("click", () => page.cancelTrustImport());
    row.append(cancel);
    box.append(row);
    nodes.push(box);
  }
  out.replaceChildren(...nodes);
  // Once an import is settled, the picker is emptied, so the same file can be picked again.
  if (!imp || imp.done || imp.problem) byId("trust-import").value = "";
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
      // A private key file already downloaded is no longer on the page: a sentence takes its link's place.
      if (o.released) {
        list.append(el("li", t("key.privateReleased"), "note"));
        continue;
      }
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
  // No key held (signed with, cleared, or never chosen): the key picker is emptied too, so picking the same file again
  // is a change the page hears, and signing twice needs no hidden step.
  if (!s.keyFile && !s.busy) byId("sign-key").value = "";
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

/** The revocation made on the page: its download, or why none was made. */
function renderRevoke(page) {
  const out = byId("revoke-result");
  const r = page.revocation;
  if (!r) {
    out.replaceChildren();
    return;
  }
  // The private key file has been used (or refused): the picker lets go of it.
  byId("revoke-key").value = "";
  if (r.problem) {
    // The refusal is said once, in the status line under the button (a live region).
    out.replaceChildren();
    return;
  }
  const made = el("p", null, "notice");
  made.append(el("span", `${t("revoke.made")} `), el("code", r.kid, "kid"));
  out.replaceChildren(made, downloadLink(r.offer, t("revoke.download")), el("p", t("revoke.next"), "note"));
}

function renderSitePeers(page) {
  const out = byId("site-peers-result");
  const p = page.sitePeers;
  if (!p) {
    out.replaceChildren();
    return;
  }
  if (p.checking) {
    out.replaceChildren(el("p", t("sitePeers.checking"), "status"));
    return;
  }
  if (p.lockState !== "found") {
    out.replaceChildren(el("p", t(`sitePeers.noLock.${p.lockState}`), "notice"));
    return;
  }
  const parts = [];
  if (p.count === 0) parts.push(el("p", t("sitePeers.none"), "note"));
  const list = el("ul", null, "partner-status");
  for (const r of p.results) {
    const item = el("li", null, r.refuse ? "unreachable" : "reachable");
    item.append(el("code", r.peer));
    const words = [];
    if (r.refused) words.push(t("sitePeers.notContacted", { why: r.refused }));
    else if (r.verdict === "verified") words.push(t("partners.signatureVerified"));
    else if (r.verdict === "invalid") words.push(t("partners.signatureInvalid", { reason: t(`verify.reasons.${r.reason}`) }));
    else if (r.verdict === "unverifiable") words.push(t("partners.signatureUnverifiable", { detail: r.detail || "" }));
    if (!r.refused && t(`sitePeers.lock.${r.lock}`) !== `sitePeers.lock.${r.lock}`) words.push(t(`sitePeers.lock.${r.lock}`));
    item.append(el("span", ` ${words.join(" ")}`));
    if (r.differs.length > 0) {
      const sub = el("ul", null, "partner-differs");
      for (const d of r.differs) sub.append(el("li", `${t(`sitePeers.part.${d.part}`)}: ${d.summary}`, d.severity));
      item.append(sub);
    }
    if (r.refuse) item.append(el("p", t("sitePeers.refuse"), "note"));
    list.append(item);
  }
  parts.push(list);
  if (p.count > p.results.length) parts.push(el("p", t("sitePeers.capped", { max: p.results.length, count: p.count }), "note"));
  if (p.pending > 0) parts.push(el("p", t("sitePeers.pending", { count: p.pending }), "note"));
  out.replaceChildren(...parts);
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
    // Reachable is not a verdict, so it gets no check mark; unreachable is said in words. Then the load-path check (D3):
    // the signature verdict in words (unverifiable is not a failure) and what this Desk's lock says of the partner.
    const words = [r.reachable ? t("partners.reachable", { name: r.name }) : t("partners.unreachable", { name: r.name })];
    if (r.verdict === "verified") words.push(t("partners.signatureVerified"));
    else if (r.verdict === "invalid") words.push(t("partners.signatureInvalid", { reason: t(`verify.reasons.${r.reason}`) }));
    else if (r.verdict === "unverifiable") words.push(t("partners.signatureUnverifiable", { detail: r.detail || "" }));
    if (r.lock) words.push(t(`partners.lock.${r.lock}`));
    list.append(el("li", words.join(" "), r.reachable ? "reachable" : "unreachable"));
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
  revoke: renderRevoke,
  partners: renderPartners,
  sitePeers: renderSitePeers,
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

/**
 * Run a page handler: show a status while it runs, show a refusal, never leave the page broken. The status lines are
 * live regions (role=status), so what is set here at the end is read out: the refusal, or done(result) when given.
 */
async function handle(statusId, runningText, work, done) {
  busy(statusId, runningText);
  try {
    const result = await work();
    busy(statusId, result && result.ok === false ? result.reason : done ? done(result) : "");
  } catch (error) {
    console.error(error);
    busy(statusId, t("errors.unexpected"));
  }
}

/** "untrusted" -> "Untrusted": the strings key of a lock's cover in a sentence. */
function capital(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * What covers a published lock, from the signature check drift ran first: "signed" (a verified signature lists it),
 * "untrusted" (a signature lists it and is unverifiable here: a key the visitor has not trusted, or a check that could
 * not finish), "invalid" (a signature lists it and does not hold) or "unsigned" (no signature, or one that does not
 * list the lock).
 */
export function lockCoverOf(check) {
  const listed = Array.isArray(check.subjects) && check.subjects.includes(LOCK_FILE);
  if (!check.signed || check.result === undefined) return "unsigned";
  // an invalid signature is invalid whatever it lists (a lock it should cover and does not is itself `tampered`)
  if (check.result.verdict === "invalid") return "invalid";
  if (!listed) return "unsigned";
  return check.result.verdict === "verified" ? "signed" : "untrusted";
}

/**
 * The sentence the status line says when a check, a drift reading or a verify ends, so a screen reader hears the
 * verdict, not silence. Only the page's own words and verdicts: nothing a site wrote.
 *
 * :param kind: "gate", "drift" or "verify".
 * :param result: What the page method returned (not a refusal).
 */
export function doneSentence(kind, result) {
  if (kind === "gate") return t("gate.done", { state: t(`states.${result.state}`) });
  if (kind === "sitePeers") {
    if (result.lockState !== "found") return t(`sitePeers.noLock.${result.lockState}`);
    return result.results.length === 1 ? t("sitePeers.doneOne") : t("sitePeers.done", { n: result.results.length });
  }
  if (kind === "drift") {
    if (result.lockState === "absent") return t("drift.doneNoLock");
    if (result.lockState === "refused") return t("drift.doneRefused");
    if (!result.lockFound) return t("drift.doneNotRead");
    const lock = result.lockSigned ? t("drift.doneSigned") : t(`drift.done${capital(result.lockCover || "unsigned")}`);
    if (!result.findings.length) return t("drift.doneClean", { lock });
    const worst = result.findings.reduce((w, f) => (SEVERITY_ORDER[f.severity] > SEVERITY_ORDER[w] ? f.severity : w), "info");
    const words = { n: result.findings.length, worst: t(`drift.severity.${worst}`), lock };
    return result.findings.length === 1 ? t("drift.doneOne", words) : t("drift.done", words);
  }
  const words = result.reason ? `${t(`states.${result.verdict}`)}: ${result.reasonInWords}` : t(`states.${result.verdict}`);
  return t("verify.done", { verdict: words });
}

const SEVERITY_ORDER = { info: 0, warn: 1, block: 2 };

function wireForm(formId, inputId, buttonId, statusId, runningKey, method, kind) {
  // D1: an address the visitor types into the page's own field is one the assistant may then use.
  byId(inputId).addEventListener("change", (event) => App.page.noteVisitorTarget(event.target.value));
  byId(formId).addEventListener("submit", (event) => {
    event.preventDefault();
    const button = byId(buttonId);
    // One run per form at a time: a second press while one is in flight does nothing.
    if (button.disabled) return;
    const target = byId(inputId).value;
    App.page.noteVisitorTarget(target);
    button.disabled = true;
    void handle(statusId, t(runningKey), () => App.page[method]({ target }), (result) => doneSentence(kind, result)).finally(() => {
      button.disabled = false;
    });
  });
}

async function signFromPage() {
  const page = App.page;
  const check = page.checkSign();
  if (!check.ok) return check;
  const content = page.signDialogContent(check, `sign_files on ${page.ownOrigin} (irreversible)\n${JSON.stringify({ expectedVersion: check.version }, null, 2)}`);
  const confirmed = await new Promise((resolve) => openReviewDialog(content, resolve));
  if (!confirmed) {
    page.notices.sign = t("sign.declined");
    page.render("sign");
    return { ok: true };
  }
  page.notices.sign = null;
  return page.signFiles({ expectedVersion: check.version });
}

/** The buttons that add trust, or make or use a key: refused in a frame, and without Ed25519. */
const KEY_WORK_BUTTONS = ["key-generate", "sign-button", "revoke-make"];

/**
 * Says on the page what the Desk will not do here, and disables those buttons: in another site's frame (click-
 * jacking) nothing that adds trust or makes or uses a key; in a browser without Ed25519, no key, signature or verdict.
 */
export async function showLimits(page = App.page) {
  const lines = [];
  if (page.framed) lines.push(t("errors.framed"));
  if (!(await page.ed25519Ready())) lines.push(t("errors.noEd25519"));
  const blocked = lines.length > 0;
  for (const id of KEY_WORK_BUTTONS) byId(id).disabled = blocked;
  if (page.framed) byId("trust-import").disabled = true;
  const notice = byId("desk-notice");
  notice.textContent = lines.join(" ");
  notice.hidden = !blocked;
  if (blocked) {
    page.render("verify");
    page.render("sign");
  }
  return lines;
}

/** Wires the page's own controls to App.page. Exported for the tests, which run it on the DOM stand-in. */
export function wirePage() {
  const page = App.page;
  wireForm("gate-form", "gate-target", "gate-run", "gate-status", "gate.running", "runGate", "gate");
  wireForm("drift-form", "drift-target", "drift-run", "drift-status", "drift.running", "readDrift", "drift");
  wireForm("verify-form", "verify-target", "verify-run", "verify-status", "verify.running", "verifySite", "verify");
  byId("key-generate").addEventListener("click", () => void handle("key-status", "", () => page.generateKey()));
  byId("key-discard").addEventListener("click", () => page.discardKey());
  byId("revoke-make").addEventListener("click", () => {
    const input = byId("revoke-key");
    void handle("revoke-status", "", () => page.revokeWithKeyFile(input.files && input.files[0], byId("revoke-reason").value));
  });
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
  byId("trust-export").addEventListener("click", () => void handle("trust-io-status", "", () => page.exportTrust()));
  byId("trust-import").addEventListener("change", (event) => void handle("trust-io-status", "", () => page.chooseTrustImport(event.target.files && event.target.files[0])));
  byId("partners-check").addEventListener("click", () => void handle("partners-status", "", () => page.checkPartners()));
  wireForm("site-peers-form", "site-peers-target", "site-peers-run", "site-peers-status", "sitePeers.checking", "checkSitePeers", "sitePeers");
}

if (typeof window !== "undefined" && typeof document !== "undefined" && typeof document.querySelectorAll === "function" && !globalThis.__deskNoWire) {
  fillStrings();
  const page = App.page;
  page.signing.origin = byId("sign-origin").value.trim();
  page.signing.days = Number(byId("sign-days").value) || 90;
  wirePage();
  for (const part of Object.keys(VIEWS)) page.render(part);
  void showLimits(page);
}

/**
 * Registers nothing. agent-manifest.json lists this module in actions.modules so that the Desk's signature covers it
 * (core's signedPathsOf signs every module named there), and the runtime imports each listed module and requires this
 * export (runtime/action-transport.js loadActionModule). The Desk's actions are registered by site-actions.js only.
 */
export function registerActions() {}
