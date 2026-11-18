// The Desk's shell: "The Fix" (contest B/3). It draws the chart and the compass card, shows one focused view at a time
// by the address hash, and draws each view's art from the page state after desk.js renders it. It runs no tool and
// holds no rule: every button that does something is wired in desk.js, and every result comes from App.page.
// It starts only in a browser; the Node tests import it for its pure helpers. site/PORT.md lists the views and what
// each one leaves out.
//
// Routes: #/ (the overview), #/check, #/drift, #/verify, #/key, #/sign (the five ports) and #/about. A hash that does
// not start with "#/" (the skip link's #main) leaves the view as it is.

import { App, PARTNERS, onRender } from "./desk.js";
import { t } from "./strings.js";
import { EXAMPLE_CAPTURED, EXAMPLE_RUNS } from "./examples.js";
import * as Art from "./art.js";
import { gateSentence, siteUnreachable } from "./lib/plumbline/gate/context.js";

const PORTS = [
  { id: "check", n: 1, bearing: 0, section: "gate" },
  { id: "drift", n: 2, bearing: 55, section: "drift" },
  { id: "verify", n: 3, bearing: 110, section: "verify" },
  { id: "key", n: 4, bearing: -110, section: "key" },
  { id: "sign", n: 5, bearing: -55, section: "sign" },
];
const PORT_BY = Object.fromEntries(PORTS.map((p) => [p.id, p]));
const VIEWS = { check: "gate", drift: "drift", verify: "verify", key: "key", sign: "sign", about: "about" };
const ADAPTERS = ["validator", "atlas", "customs"];
const SEVERITY_RANK = { info: 0, warn: 1, block: 2 };

const $ = (id) => document.getElementById(id);
const reduceMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

/** An element holding one drawing from art.js (SVG markup with no style attribute). */
function drawing(tag, className, svg) {
  const node = make(tag, className);
  node.innerHTML = svg;
  return node;
}

function portName(id) {
  return id === "about" ? t("about.heading") : t(`fix.ports.${id}.name`);
}

function say(text) {
  const live = $("live");
  live.textContent = "";
  setTimeout(() => {
    live.textContent = text;
  }, 40);
}

// ---- the sites checked: live runs from this page, newest first, then the labelled examples, three in all (the
// winner's three pennants: the list never grows into the peer ports below it) ----

const SITES_SHOWN = 3;

const shell = { live: [], selected: 0, lastGate: null, view: null, first: true };

function siteName(target) {
  try {
    const url = new URL(target);
    const partner = PARTNERS.find((p) => new URL(p.page).host === url.host);
    return partner ? partner.name : url.host;
  } catch {
    return String(target);
  }
}

function sites() {
  // An example of a site already run here is left out: the live run says what is true now.
  const examples = EXAMPLE_RUNS.filter((report) => !shell.live.some((site) => site.name === report.name)).map((report) => ({ report, name: report.name, live: false }));
  return [...shell.live, ...examples].slice(0, SITES_SHOWN);
}

function statesOf(report) {
  const states = {};
  for (const f of report.findings) states[f.adapter] = f.state;
  return states;
}

// ---- the verdict card (the cartouche) ----

function setCart(card, o) {
  card.dataset.state = o.state || "";
  card.dataset.mode = o.mode || "verdict";
  // UAT-9: a site that did not answer, or a run that checked nothing, is an alarm, not the grey of "no verdict"
  if (o.alarm) card.dataset.alarm = "true";
  else delete card.dataset.alarm;
  if (o.tool) card.dataset.tool = o.tool;
  else delete card.dataset.tool;
  const kicker = make("span", "cartouche__kicker", o.kicker);
  const word = make("span", `cartouche__word${o.word.length > 9 ? " is-long" : ""}`, o.word);
  const nodes = [kicker, word];
  if (o.sub) nodes.push(make("span", "cartouche__sub", o.sub));
  if (card.id === "cartouche") {
    kicker.dataset.role = "verdict-kicker";
    word.dataset.role = "verdict-word";
    if (nodes[2]) nodes[2].dataset.role = "verdict-sub";
  }
  card.replaceChildren(...nodes);
  card.insertAdjacentHTML("afterbegin", o.icon);
}

function verdictCart(site) {
  const state = site.report.state;
  return {
    state,
    icon: Art.glyph(state),
    kicker: site.live ? t("fix.verdictKicker", { site: site.name }) : t("fix.exampleKicker", { site: site.name }),
    word: t(`fix.short.${state}`),
    // UAT-9: an unavailable gate says what WAS checked ("checked by 1 of 3 ...") or that nothing was, in the words every
    // surface uses (gate/context.js); partly checked never reads as nothing checked
    sub: state === "unavailable" ? `${capitalise(gateSentence(site.report))}. ${t("fix.gateMeanings.unavailable")}` : t(`fix.gateMeanings.${state}`),
    alarm: state === "unavailable" && (siteUnreachable(site.report) !== null || site.report.findings.every((f) => f.state === "unavailable")),
  };
}

function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function noFixCart() {
  return { state: "", mode: "empty", icon: Art.emblem("check"), kicker: t("fix.noFixKicker"), word: t("fix.noFixWord"), sub: t("fix.noFixSub") };
}

function checkerCart(report, adapter) {
  const f = report.findings.find((x) => x.adapter === adapter);
  return {
    state: f.state,
    mode: "checker",
    icon: Art.glyph(f.state),
    kicker: t("fix.checkerKicker", { state: t(`fix.short.${f.state}`) }),
    word: t(`gate.adapters.${adapter}`),
    sub: f.summary.length > 160 ? `${f.summary.slice(0, f.summary.lastIndexOf(" ", 158))}…` : f.summary,
  };
}

function portCart(port) {
  return {
    state: "",
    mode: "port",
    tool: port.id,
    icon: Art.emblem(port.id),
    kicker: t("fix.portPreviewKicker", { n: port.n, sub: t(`fix.ports.${port.id}.sub`) }),
    word: portName(port.id),
    sub: t(`fix.ports.${port.id}.what`),
  };
}

// ---- the fix: rings and labelled checker badges ----

/**
 * Draws a fix into holder and wires its badges to the card: hovering or focusing a checker puts its sentence in the
 * card. report null draws the stations only (no run yet).
 */
function drawFix(holder, card, report, restore, roles) {
  const fixNode = make("div", "fix");
  if (report) fixNode.dataset.state = report.state;
  fixNode.innerHTML = Art.fix(report ? statesOf(report) : null, report ? report.state : null);
  if (report) {
    for (const adapter of ADAPTERS) {
      const f = report.findings.find((x) => x.adapter === adapter);
      if (!f) continue;
      const [x, y] = Art.stationPct(adapter);
      const badge = make("button", "badge");
      badge.type = "button";
      badge.dataset.state = f.state;
      badge.dataset.k = adapter;
      badge.style.setProperty("--x", x.toFixed(2));
      badge.style.setProperty("--y", y.toFixed(2));
      badge.setAttribute("aria-label", t("fix.badgeLabel", { name: t(`gate.adapters.${adapter}`), state: t(`states.${f.state}`) }));
      if (roles && adapter === "validator") badge.dataset.role = "checker-badge";
      badge.append(
        make("span", "badge__name", t(`gate.adapters.${adapter}`)),
        make("span", "badge__short", t(`fix.shortAdapters.${adapter}`)),
        make("span", "badge__word", t(`fix.short.${f.state}`)),
      );
      badge.insertAdjacentHTML("afterbegin", Art.glyph(f.state));
      const hot = () => {
        fixNode.dataset.hot = adapter;
        setCart(card, checkerCart(report, adapter));
      };
      const cool = () => {
        delete fixNode.dataset.hot;
        setCart(card, restore());
      };
      badge.addEventListener("mouseenter", hot);
      badge.addEventListener("focus", hot);
      badge.addEventListener("click", hot);
      badge.addEventListener("mouseleave", cool);
      badge.addEventListener("blur", cool);
      fixNode.append(badge);
    }
  }
  holder.replaceChildren(fixNode);
  setCart(card, restore());
  return fixNode;
}

// ---- the overview ----

function buildPaper() {
  const paper = $("paper");
  paper.innerHTML = Art.chart();
  for (const [x, y, depth] of [[31, 6, "12"], [41, 95, "31"], [63, 96, "24"], [79, 5, "18"], [97, 56, "9"], [3, 62, "7"], [2, 90, "27"], [78, 50, "15"], [30, 52, "11"], [71, 97, "22"]]) {
    const sound = make("span", "sound", depth);
    sound.style.setProperty("--x", x);
    sound.style.setProperty("--y", y);
    paper.append(sound);
  }
  if (reduceMotion) return;
  let frame = 0;
  let px = 0;
  let py = 0;
  document.addEventListener(
    "pointermove",
    (event) => {
      px = (event.clientX / window.innerWidth - 0.5) * 2;
      py = (event.clientY / window.innerHeight - 0.5) * 2;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        paper.style.setProperty("--px", px.toFixed(3));
        paper.style.setProperty("--py", py.toFixed(3));
      });
    },
    { passive: true },
  );
}

function previewPort(port) {
  for (const node of document.querySelectorAll(".port, .pl")) node.classList.toggle("is-hot", node.dataset.tool === port.id);
  const fixNode = document.querySelector("#dial-fix .fix");
  if (fixNode) fixNode.dataset.hot = "none";
  setCart($("cartouche"), portCart(port));
}

function previewEnd() {
  for (const node of document.querySelectorAll(".port, .pl")) node.classList.remove("is-hot");
  const fixNode = document.querySelector("#dial-fix .fix");
  if (fixNode) delete fixNode.dataset.hot;
  setCart($("cartouche"), verdictCart(sites()[shell.selected]));
}

function wirePreview(node, port) {
  node.addEventListener("mouseenter", () => previewPort(port));
  node.addEventListener("focus", () => previewPort(port));
  node.addEventListener("mouseleave", previewEnd);
  node.addEventListener("blur", previewEnd);
}

function buildDial() {
  const dial = $("dial");
  const box = drawing("div", "dial__box", Art.dialCard());
  const holder = make("div", "dial__fixholder");
  holder.id = "dial-fix";
  box.append(holder);
  for (const port of PORTS) {
    const link = make("a", "port");
    link.href = `#/${port.id}`;
    link.dataset.tool = port.id;
    if (port.n === 1) link.dataset.role = "compass-port";
    link.style.setProperty("--a", `${port.bearing}deg`);
    link.style.setProperty("--i", String(port.n - 1));
    link.setAttribute("aria-label", `${port.n}. ${portName(port.id)} (${t(`fix.ports.${port.id}.sub`)})`);
    link.innerHTML = Art.emblem(port.id);
    const number = make("span", "port__n", String(port.n));
    number.setAttribute("aria-hidden", "true");
    link.append(number);
    wirePreview(link, port);
    box.append(link);
  }
  const card = make("div", "cartouche");
  card.id = "cartouche";
  card.dataset.role = "verdict-card";
  dial.replaceChildren(box, card);
}

function buildPortList() {
  const list = $("portlist-items");
  list.replaceChildren(
    ...PORTS.map((port) => {
      const link = make("a", "pl");
      link.href = `#/${port.id}`;
      link.dataset.tool = port.id;
      const name = make("span", "pl__name", `${port.n}. ${portName(port.id)}`);
      const sub = make("span", "pl__sub", t(`fix.ports.${port.id}.sub`));
      if (port.n === 1) {
        link.dataset.role = "port-item";
        name.dataset.role = "port-name";
        sub.dataset.role = "port-sub";
      }
      const text = make("span", "pl__t");
      text.append(name, sub);
      link.append(text);
      link.insertAdjacentHTML("afterbegin", Art.emblem(port.id));
      wirePreview(link, port);
      const item = make("li");
      item.append(link);
      return item;
    }),
  );
}

function buildPager() {
  const list = $("pager-list");
  const all = sites();
  list.replaceChildren(
    ...all.map((site, index) => {
      const state = site.report.state;
      const button = make("button", "pennant");
      button.type = "button";
      button.dataset.state = state;
      button.setAttribute("aria-pressed", String(index === shell.selected));
      const name = make("span", "pennant__name", site.name);
      const word = make("span", "pennant__word", `${t(`fix.short.${state}`)} · ${site.live ? t("fix.live") : t("fix.example")}`);
      if (index === 0) {
        button.dataset.role = "site-row";
        name.dataset.role = "site-name";
        word.dataset.role = "site-word";
      }
      button.append(name, word);
      button.insertAdjacentHTML("afterbegin", Art.glyph(state));
      button.addEventListener("click", () => {
        shell.selected = index;
        updateHome(true);
      });
      return button;
    }),
  );
  $("pager-note").textContent = all.some((site) => !site.live) ? t("fix.examplesNote", { date: EXAMPLE_CAPTURED }) : "";
}

function updateHome(swap = false) {
  const site = sites()[shell.selected];
  const card = $("cartouche");
  const fixNode = drawFix($("dial-fix"), card, site.report, () => verdictCart(site), true);
  if (swap) {
    fixNode.classList.add("is-swap");
    card.classList.remove("is-stamp");
    void card.offsetWidth;
    card.classList.add("is-stamp");
  }
  const ghost = $("ghost");
  const word = t(`fix.short.${site.report.state}`).toUpperCase();
  ghost.textContent = word;
  ghost.dataset.state = site.report.state;
  ghost.style.setProperty("--gs", `${Math.min(10, 78 / (word.length * 0.8)).toFixed(2)}rem`);
  for (const [index, button] of [...$("pager-list").children].entries()) button.setAttribute("aria-pressed", String(index === shell.selected));
  // On a narrow screen the checkers' sentences are listed under the compass card.
  $("homelogs").replaceChildren(
    ...site.report.findings.map((f) => {
      const row = make("li", "log");
      row.dataset.state = f.state;
      row.append(make("span", "log__name", t(`gate.adapters.${f.adapter}`)), make("span", "log__word", t(`fix.short.${f.state}`)), make("span", "log__sum", f.summary));
      row.insertAdjacentHTML("afterbegin", Art.glyph(f.state));
      return row;
    }),
  );
  if (swap) say(`${site.name}, ${site.live ? t("fix.live") : t("fix.example")}: ${t(`states.${site.report.state}`)}.`);
}

// ---- each view's art, drawn from the page state ----

function drawGate(page) {
  const report = page.gate;
  if (report && report !== shell.lastGate) {
    shell.lastGate = report;
    const name = siteName(report.target);
    shell.live = [{ report, name, live: true }, ...shell.live.filter((s) => s.report.target !== report.target)].slice(0, SITES_SHOWN);
    shell.selected = 0;
    buildPager();
    updateHome(false);
  }
  const wrap = $("gate-fix");
  const card = make("div", "cartouche");
  const holder = make("div", "fixwrap__fix");
  wrap.replaceChildren(holder, card);
  const site = report ? { report, name: siteName(report.target), live: true } : null;
  drawFix(holder, card, report, () => (site ? verdictCart(site) : noFixCart()), false);
}

/**
 * The course to plot for a drift reading: null (nothing plotted) when there is no reading or no lock was read (absent,
 * refused or unusable: nothing was compared, so a calm course would claim a fix that was never taken), else the worst
 * severity found, "info" for a clean reading.
 */
export function driftCourse(d) {
  if (!d || !d.lockFound) return null;
  return d.findings.reduce((w, f) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[w] ? f.severity : w), "info");
}

function drawDrift(page) {
  const d = page.drift;
  const worst = driftCourse(d);
  const course = $("drift-course");
  course.dataset.state = worst || "";
  course.innerHTML = Art.course(worst);
  $("drift-caption").textContent = !d ? t("drift.noReading") : worst === null ? t("drift.noLockCaption") : t("drift.caption");
}

function drawVerify(page) {
  const sheet = $("verify-sheet");
  const v = page.verification;
  if (!v || v.refused) {
    sheet.replaceChildren(make("p", "sheet__h", "plumbline.signature.json"), make("p", "ledger__empty", v ? t("verify.sheetRefused") : t("verify.sheetEmpty")));
    sheet.insertAdjacentHTML("beforeend", `<div class="sheet__seal">${Art.seal(null, "blank")}</div>`);
    return;
  }
  const r = v.result;
  const facts = make("dl");
  const fact = (label, value) => {
    if (value === undefined || value === null || value === "") return;
    facts.append(make("dt", null, label), make("dd", null, String(value)));
  };
  fact(t("verify.signer"), r.kid);
  fact(t("verify.origin"), r.origin);
  fact(t("verify.fetchedFrom"), r.fetchedFrom);
  const nodes = [make("p", "sheet__h", "plumbline.signature.json"), facts];
  if (r.signedFiles && r.signedFiles.length) {
    nodes.push(make("p", "sheet__h sheet__h--files", t("verify.sheetFiles")));
    const files = make("ul", "sheet__files");
    files.append(...r.signedFiles.map((path) => make("li", null, path)));
    nodes.push(files);
  }
  const stamp = make("div", "stamp");
  stamp.dataset.state = r.verdict;
  stamp.append(make("span", "stamp__w", t(`fix.short.${r.verdict}`)));
  if (r.reason) stamp.append(make("span", "stamp__r", r.reason));
  stamp.insertAdjacentHTML("afterbegin", Art.glyph(r.verdict));
  nodes.push(stamp);
  sheet.replaceChildren(...nodes);
  if (r.signed !== false) sheet.insertAdjacentHTML("beforeend", `<div class="sheet__seal">${Art.seal(r.kid || null, r.verdict)}</div>`);
}

function drawKey(page) {
  const kid = page.key ? page.key.kid : null;
  $("key-seal").innerHTML = Art.seal(kid, kid ? "verified" : "blank");
  $("key-seal").classList.toggle("is-pressing", Boolean(kid) && !reduceMotion);
  $("key-seal-kid").textContent = kid ? kid.replace(/(.{4})/g, "$1 ").trim() : t("key.sealBlank");
}

const DRAW = { gate: drawGate, drift: drawDrift, verify: drawVerify, key: drawKey };

// ---- the views ----

function buildStrips() {
  for (const strip of document.querySelectorAll("[data-strip]")) {
    const current = strip.dataset.strip;
    strip.setAttribute("aria-label", t("fix.portsLabel"));
    strip.replaceChildren(
      ...PORTS.map((port) => {
        const link = make("a", "strip__b");
        link.href = `#/${port.id}`;
        link.dataset.tool = port.id;
        link.setAttribute("aria-label", `${port.n}. ${portName(port.id)}`);
        if (port.id === current) link.setAttribute("aria-current", "page");
        if (current === "check" && port.n === 1) link.dataset.role = "strip-button";
        link.innerHTML = Art.emblem(port.id);
        const number = make("span", "port__n", String(port.n));
        const tip = make("span", "strip__tip", portName(port.id));
        number.setAttribute("aria-hidden", "true");
        tip.setAttribute("aria-hidden", "true");
        link.append(number, tip);
        const item = make("li");
        item.append(link);
        return item;
      }),
    );
  }
  for (const kicker of document.querySelectorAll("[data-port-kicker]")) kicker.textContent = t("fix.portKicker", { n: kicker.dataset.portKicker });
}

function setTrail(view) {
  const trail = $("trail");
  const nodes = [];
  if (view) {
    const back = make("button", "trail__back", `← ${t("fix.back")}`);
    back.type = "button";
    back.dataset.role = "trail-back";
    back.setAttribute("aria-label", t("fix.homeCompass"));
    back.addEventListener("click", () => {
      location.hash = "#/";
    });
    nodes.push(back);
  }
  const crumbs = make("ol");
  const home = make("li");
  if (view) {
    const link = make("a", null, t("fix.home"));
    link.href = "#/";
    home.append(link);
  } else {
    const here = make("span", null, t("fix.home"));
    here.setAttribute("aria-current", "page");
    home.append(here);
  }
  crumbs.append(home);
  if (view) {
    const item = make("li");
    const here = make("span", null, portName(view));
    here.setAttribute("aria-current", "page");
    item.append(here);
    crumbs.append(item);
  }
  nodes.push(crumbs);
  trail.replaceChildren(...nodes);
}

function show(view) {
  const from = shell.view;
  shell.view = view;
  const stage = $("stage");
  const level = view ? "2" : "1";
  stage.dataset.level = level;
  $("paper").dataset.level = level;
  for (const [id, section] of Object.entries(VIEWS)) {
    const node = $(section);
    const on = id === view;
    if (on && node.hidden && !reduceMotion) {
      node.classList.add("is-entering");
      setTimeout(() => node.classList.remove("is-entering"), 1200);
    }
    node.hidden = !on;
  }
  $("home").inert = Boolean(view);
  $("title").inert = Boolean(view);
  $("home-compass").hidden = !view;
  $("dial").style.setProperty("--spin", `${view && PORT_BY[view] ? -PORT_BY[view].bearing : 0}deg`);
  setTrail(view);
  document.title = view ? `${portName(view)} · ${t("meta.title")}` : t("meta.title");
  if (shell.first) {
    shell.first = false;
    return;
  }
  if (view) {
    window.scrollTo(0, 0);
    $(VIEWS[view]).querySelector(".tool__title").focus({ preventScroll: true });
  } else if (from) {
    const back = document.querySelector(`#portlist-items .pl[data-tool="${from}"]`) || $("main");
    back.focus({ preventScroll: false });
  }
}

function route() {
  const hash = location.hash;
  // A plain anchor (the skip link's #main) keeps the current view; on a first load it means the overview.
  if (hash !== "" && !hash.startsWith("#/")) {
    if (shell.view === null && shell.first) show(null);
    return;
  }
  const name = hash.replace(/^#\/?/, "").split("/")[0];
  show(Object.hasOwn(VIEWS, name) ? name : null);
}

function go(view) {
  const want = view ? `#/${view}` : "#/";
  if (location.hash === want) route();
  else location.hash = want;
}

// ---- the assistant panel ----

// "Save and start" in the runtime's settings reloads the page (runtime/ui.js, location.reload()), and the panel starts
// closed after a load. A note in this tab's sessionStorage, made as the button is pressed, reopens it after the reload.
// The note holds the time it was made and counts for a minute only, so a press that did not reload (a missing key)
// does not reopen the panel on some later, unrelated load.
const DOCK_REOPEN_ITEM = "plumbline-desk.reopen-assistant";
const DOCK_REOPEN_MS = 60_000;

/** Notes that the panel should reopen after the coming reload. */
export function noteDockReopen(store, now = Date.now()) {
  try {
    store.setItem(DOCK_REOPEN_ITEM, String(now));
  } catch {
    // no storage: the panel starts closed, as before
  }
}

/** True once when a fresh note is waiting; the note is removed either way. */
export function takeDockReopen(store, now = Date.now()) {
  try {
    const at = Number(store.getItem(DOCK_REOPEN_ITEM));
    store.removeItem(DOCK_REOPEN_ITEM);
    return Number.isFinite(at) && at > 0 && now - at >= 0 && now - at < DOCK_REOPEN_MS;
  } catch {
    return false;
  }
}

function tabStore() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function setDock(open) {
  const dock = $("assistant");
  const tab = $("dock-tab");
  dock.hidden = !open;
  tab.setAttribute("aria-expanded", String(open));
  if (open) {
    // Focus goes to the chat's message box, and the panel opens at its top, so its heading and Close stay in view.
    const input = document.getElementById("ns-input");
    (input || $("dock-close")).focus({ preventScroll: true });
    dock.scrollTop = 0;
  } else {
    tab.focus();
  }
}

function wireShell() {
  $("dock-tab").addEventListener("click", () => setDock($("assistant").hidden));
  $("dock-close").addEventListener("click", () => setDock(false));
  $("home-compass").addEventListener("click", () => go(null));
  // Captured before the runtime's own handler, which may reload the page before anything else runs.
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const store = tabStore();
      if (store && target && target.closest("#ns-apply")) noteDockReopen(store);
    },
    true,
  );
  window.addEventListener("hashchange", route);
  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    // A modal dialog (the signing confirmation, the runtime's own) handles its own keys.
    if (document.querySelector("dialog[open]")) return;
    const target = event.target instanceof Element ? event.target : null;
    const inAssistant = target && target.closest("#assistant");
    if (event.key === "Escape") {
      if (!$("assistant").hidden) {
        setDock(false);
        return;
      }
      if (shell.view && !inAssistant) {
        event.preventDefault();
        go(null);
      }
      return;
    }
    if (inAssistant || (target && target.closest("input, textarea, select, [contenteditable]"))) return;
    if (/^[1-5]$/.test(event.key)) go(PORTS[Number(event.key) - 1].id);
  });
}

function start() {
  buildPaper();
  buildDial();
  buildPortList();
  buildPager();
  buildStrips();
  updateHome(false);
  for (const draw of Object.values(DRAW)) draw(App.page);
  onRender((part, page) => {
    if (Object.hasOwn(DRAW, part)) DRAW[part](page);
  });
  wireShell();
  route();
  const store = tabStore();
  if (store && takeDockReopen(store)) setDock(true);
  document.documentElement.classList.add("is-ready");
}

// Browser only: the Node tests import this module for its helpers and never start it.
if (typeof window !== "undefined") start();
