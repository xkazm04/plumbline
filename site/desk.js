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
  SIGNATURE_FILE,
  derivePublicKey,
  generateKey,
  isAcceptableOrigin,
  keyId,
  keyIdOfPrivate,
  signSubjects,
  subjectDigest,
  verifySignature,
} from "./lib/plumbline/core/index.js";

/** The CLI's private key file format (docs/signature-format.md, "plumbline.private.json (CLI format)"). */
export const PRIVATE_KEY_FILE = "plumbline.private.json";
export const PRIVATE_KEY_TYPE = "plumbline-private-key";
const MANIFEST_FILE = "agent-manifest.json";
const LINKS_FILE = "links.json";
const TRUST_STORAGE_KEY = "plumbline-desk.trust.v1";
const MAX_DAYS = 3650;
const DAY_MS = 86_400_000;

export const PARTNERS = [
  { name: STRINGS.partners.atlasName, page: STRINGS.partners.atlasLink, network: "https://agent-atlas-phi.vercel.app/agent_atlas" },
  { name: STRINGS.partners.customsName, page: STRINGS.partners.customsLink, network: "https://montbaga.github.io/agent-customs/agent_customs" },
];

/** `x.hocon` names `x.network.json`; any other path is used as written (the CLI's networkFileFor). */
export function networkFileFor(hocon) {
  return hocon.endsWith(".hocon") ? `${hocon.slice(0, -".hocon".length)}.network.json` : hocon;
}

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

/** The visitor's trust store: who they trust, per origin. Kept in localStorage for this origin, if the browser allows. */
export class TrustBook {
  constructor(storage) {
    this.storage = storage;
    this.entries = [];
    this.persistent = false;
    try {
      if (storage) {
        const raw = storage.getItem(TRUST_STORAGE_KEY);
        this.persistent = true;
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && parsed.version === 1 && Array.isArray(parsed.entries)) {
          this.entries = parsed.entries.filter((e) => e && typeof e.kid === "string" && typeof e.origin === "string" && typeof e.publicKey === "string");
        }
      }
    } catch {
      this.persistent = false;
    }
  }

  find(kid, origin) {
    return this.entries.find((e) => e.kid === kid && e.origin === origin);
  }

  list() {
    return this.entries.map((e) => ({ kid: e.kid, origin: e.origin }));
  }

  save() {
    if (!this.storage) return false;
    try {
      this.storage.setItem(TRUST_STORAGE_KEY, JSON.stringify({ version: 1, entries: this.entries }));
      return true;
    } catch {
      return false;
    }
  }

  add(entry) {
    this.entries = this.entries.filter((e) => !(e.kid === entry.kid && e.origin === entry.origin));
    this.entries.push({ kid: entry.kid, origin: entry.origin, publicKey: entry.publicKey });
    return this.save();
  }

  remove(kid, origin) {
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

async function readFileText(file) {
  if (typeof file.text === "function") return file.text();
  throw new Error("not a file");
}

/**
 * The Desk's state and operations. One instance per page: App.page.
 */
export class DeskPage {
  #signingKey = null;

  constructor(deps = {}) {
    this.fetch = deps.fetch || makeBrowserFetcher();
    this.now = deps.now || (() => new Date());
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
      generatedKey: this.key ? { kid: this.key.kid, offeredOnPage: this.key.offers.map((o) => o.path) } : null,
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

  // ---- read: the gate ----

  async runGate(args) {
    const target = checkTarget(args && args.target);
    if (target === null) return refuse(t("errors.badTarget"), "target");
    const report = await runGateWith({ target, adapters: [...ALL_ADAPTERS] }, { fetch: this.fetch, defaultTimeoutMs: DEFAULT_TIMEOUT_MS, now: this.now });
    this.gate = report;
    this.render("gate");
    return report;
  }

  // ---- read: drift ----

  async readDrift(args) {
    const target = checkTarget(args && args.target);
    if (target === null) return refuse(t("errors.badTarget"), "target");
    const result = await readDrift(target, this.fetch, { timeoutMs: DEFAULT_TIMEOUT_MS });
    this.drift = result;
    this.render("drift");
    return { target: result.target, lockUrl: result.lockUrl, lockFound: result.lockFound, findings: result.findings, unreachablePeers: result.unreachablePeers };
  }

  // ---- read: verify ----

  async verifySite(args) {
    const target = checkTarget(args && args.target);
    if (target === null) return refuse(t("errors.badTarget"), "target");
    const base = await siteBase(target, this.fetch);
    const fetchedFrom = new URL(base).origin;
    const done = (result, extra = {}) => {
      const meaning = t(`verdicts.${result.verdict}Meaning`);
      const full = {
        target,
        base,
        fetchedFrom,
        verdict: result.verdict,
        ...(result.reason ? { reason: result.reason, reasonInWords: t(`verify.reasons.${result.reason}`) } : {}),
        ...(result.kid ? { kid: result.kid } : {}),
        ...(result.origin ? { origin: result.origin } : {}),
        ...(result.detail ? { detail: result.detail } : {}),
        meaning,
        ...extra,
      };
      this.verification = { result: full, publishedKey: extra.publishedKey || null };
      this.render("verify");
      return full;
    };

    let sigResponse;
    try {
      sigResponse = await this.fetch(`${base}${SIGNATURE_FILE}`);
    } catch {
      return done({ verdict: "unverifiable", detail: "The signature file could not be fetched (the browser could not read it), so nothing was verified." }, { signed: false });
    }
    if (sigResponse.status === 404 || sigResponse.status === 410) {
      return done({ verdict: "unverifiable", detail: t("verify.unsigned") }, { signed: false });
    }
    if (!sigResponse.ok) {
      return done({ verdict: "unverifiable", detail: `The signature request answered HTTP ${sigResponse.status}, so nothing was verified.` }, { signed: false });
    }
    let signature;
    try {
      signature = JSON.parse(sigResponse.text());
    } catch {
      return done({ verdict: "invalid", reason: "malformed", detail: "The signature file is not valid JSON." }, { signed: true });
    }

    let publishedKey;
    try {
      const keyResponse = await this.fetch(`${base}${KEY_FILE}`);
      if (keyResponse.ok) {
        const parsed = JSON.parse(keyResponse.text());
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) publishedKey = parsed;
      }
    } catch {
      publishedKey = undefined;
    }

    const files = [];
    const subjects = signature && Array.isArray(signature.subjects) ? signature.subjects : [];
    for (const subject of subjects) {
      const rel = subject && typeof subject.path === "string" ? subject.path : null;
      if (rel === null) continue;
      const url = publishedUrl(rel, base);
      if (url === null) continue; // a path that leaves the site is simply not a present file: tampered
      let response;
      try {
        response = await this.fetch(url);
      } catch {
        continue;
      }
      if (!response.ok) continue;
      const text = response.text();
      let content = text;
      if (rel.endsWith(".json")) {
        try {
          content = JSON.parse(text);
        } catch {
          content = text;
        }
      }
      files.push({ path: rel, content });
    }

    // Trust covers files published FROM an origin. Files fetched from somewhere else are not covered by any entry.
    const trustView = { find: (kid, origin) => (origin === fetchedFrom ? this.trust.find(kid, origin) : undefined) };
    const result = await verifySignature(signature, files, trustView, { now: this.now(), ...(publishedKey ? { publishedKey } : {}) });
    const originMismatch = typeof signature.origin === "string" && signature.origin !== fetchedFrom;
    const firstContact =
      result.verdict === "unverifiable" && !originMismatch && publishedKey && typeof publishedKey.kid === "string" && publishedKey.kid === signature.kid && typeof publishedKey.publicKey === "string"
        ? { kid: publishedKey.kid, publicKey: publishedKey.publicKey }
        : null;
    return done(result, {
      signed: true,
      originMismatch,
      signedFiles: subjects.map((s) => (s && typeof s.path === "string" ? s.path : "?")),
      ...(firstContact ? { publishedKey: firstContact } : {}),
    });
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

  async generateKey() {
    const { key, privateKey } = await generateKey(this.now());
    const privateFile = { type: PRIVATE_KEY_TYPE, version: FORMAT_VERSION, alg: ALG, kid: key.kid, privateKey };
    this.discardKey(true);
    const privateOffer = offer(PRIVATE_KEY_FILE, `${JSON.stringify(privateFile, null, 2)}\n`);
    privateOffer.path = PRIVATE_KEY_FILE;
    privateOffer.label = t("key.downloadPrivate");
    const publicOffer = offer("plumbline-key.json", `${JSON.stringify(key, null, 2)}\n`);
    publicOffer.path = KEY_FILE;
    publicOffer.label = t("key.downloadPublic");
    this.key = { kid: key.kid, createdAt: key.createdAt, offers: [privateOffer, publicOffer] };
    this.notices.key = null;
    this.render("key");
    return {
      ok: true,
      kid: key.kid,
      offeredOnPage: [PRIVATE_KEY_FILE, KEY_FILE],
      note: "The visitor downloads both files from the page. The private key is not in this result, is not stored and was not sent anywhere.",
    };
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
      for (const file of Array.from(fileList || [])) files.push({ name: file.name, text: await readFileText(file) });
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
    let manifest;
    try {
      manifest = JSON.parse(manifestFile.text);
    } catch {
      s.problem = t("sign.refusals.badManifest");
      return;
    }
    const subjects = [{ path: MANIFEST_FILE, content: manifest }];
    const used = new Set([MANIFEST_FILE]);
    const named = new Set([MANIFEST_FILE]);
    const networks = manifest && Array.isArray(manifest.networks) ? manifest.networks : [];
    for (const entry of networks) {
      const hocon = entry && typeof entry.hocon === "string" ? entry.hocon : null;
      if (hocon === null) continue;
      const path = networkFileFor(hocon);
      if (named.has(path)) continue;
      const file = byName.get(lastSegment(path));
      if (!file) {
        s.problem = t("sign.refusals.missingNetwork", { path });
        return;
      }
      try {
        subjects.push({ path, content: JSON.parse(file.text) });
      } catch {
        s.problem = t("sign.refusals.badJson", { path });
        return;
      }
      named.add(path);
      used.add(file.name);
    }
    const links = byName.get(LINKS_FILE);
    if (links) {
      try {
        subjects.push({ path: LINKS_FILE, content: JSON.parse(links.text) });
      } catch {
        s.problem = t("sign.refusals.badJson", { path: LINKS_FILE });
        return;
      }
      used.add(LINKS_FILE);
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
  }
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
  if (!d.lockFound) {
    nodes.push(el("p", t("drift.noLock"), "notice"));
  }
  if (d.lockFound && d.findings.length === 0) nodes.push(el("p", t("drift.clean"), "notice"));
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
      const forget = el("button", t("verify.forget"));
      forget.type = "button";
      forget.setAttribute("aria-label", `${t("verify.forget")} ${e.kid} ${e.origin}`);
      forget.addEventListener("click", () => page.forgetPublisher(e.kid, e.origin));
      item.append(el("code", e.kid), el("span", ` ${e.origin} `), forget);
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
      li.append(downloadLink(o, o.label));
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
  if (s.subjects.length) {
    const list = el("ul", null, "subjects");
    for (const x of s.subjects) {
      const li = el("li");
      li.append(el("code", x.path), el("span", ` sha256 ${x.sha256}`, "hashes"));
      list.append(li);
    }
    nodes.push(list);
  }
  if (page.signature) {
    nodes.push(el("p", t("sign.signed"), "notice"));
    nodes.push(downloadLink(page.signature.offer, t("sign.download")));
  }
  if (page.notices.sign) nodes.push(el("p", page.notices.sign, "notice"));
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
  byId(formId).addEventListener("submit", (event) => {
    event.preventDefault();
    const target = byId(inputId).value;
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
