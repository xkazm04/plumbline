// Mounts the assistant inside the Desk page (the skill's templates/site.js, filled in for the Desk). Loaded with
//   <script type="module" src="site.js"></script>
// The page itself (desk.js) works without it: every action has a page button.
import { App } from "./desk.js";
import { openReviewDialog, finishReviewDialog } from "./review-dialog.js";
import { t } from "./strings.js";
import { LOCK_FILE, PEER_LINKS_ABSENT } from "./lib/plumbline/core/index.js";
import { hashBytes } from "./lib/plumbline/net/canonical.js";
import { locatePeerFile } from "./lib/plumbline/net/locate.js";

/** The most of a partner request the runtime's consent card shows (runtime/ui.js, requestText.slice(0, 140)). */
export const CARD_CHARS = 140;
/** The page's own choice (a flag, never a secret): keep the AI provider key in this browser's saved setups. */
const REMEMBER_ITEM = "plumbline-desk.remember-ai-key";

function storage(name) {
  try {
    return globalThis[name] || null;
  } catch {
    return null;
  }
}

/**
 * Boots the browser runtime in the page's assistant section. Before each irreversible action, it shows its own
 * confirmation dialog, written for the visitor.
 */
export class AssistantMount {
  /** The first chat message once the visitor has a key. */
  static GREETING = t("assistant.greeting");

  /** The confirmation dialog's words for each irreversible action. */
  static DIALOGS = {
    sign_files: {
      title: t("dialog.signTitle"),
      sentence: t("dialog.signSentence"),
      confirm: t("dialog.signConfirm"),
      decline: t("dialog.signDecline"),
    },
  };

  /** Loads the vendored runtime. Tests replace it with one that fails, to check that the page keeps working. */
  static loadRuntime = () => import("./runtime/index.js");

  static async start() {
    const status = document.querySelector("#assistant-status");
    const siteBase = new URL("./", import.meta.url).href;
    try {
      const { boot } = await AssistantMount.loadRuntime();
      const booted = await boot("#agent-app", {
        originUrl: siteBase,
        sandboxWorkerUrl: new URL("runtime/sandbox-worker.js", siteBase).href,
      });
      AssistantMount.engine = booted.engine;
      AssistantMount.defaultReview = booted.engine.onActionConfirm;
      booted.engine.onActionConfirm = AssistantMount.review;
      AssistantMount.defaultConsent = booted.engine.onConsent;
      booted.engine.onConsent = AssistantMount.consent;
      // The engine has read the key; unless the visitor asked to remember it, it stays in this tab only.
      await AssistantMount.wireKeyChoice();
      const needsKey = !booted.engine.mockLLM
        && (!booted.engine.byokKey || booted.engine.byokKey === "demo");
      status.textContent = needsKey ? t("assistant.needsKey") : t("assistant.connected");
      if (!needsKey) {
        AssistantMount.greet();
      }
      return booted.engine;
    } catch (error) {
      // The page must keep working without the assistant.
      status.textContent = t("assistant.failed");
      console.error("Assistant startup failed", error);
      return null;
    }
  }

  static greet() {
    const first = document.querySelector("#ns-msgs .ns-msg.bot");
    if (first) {
      first.textContent = AssistantMount.GREETING;
    }
  }

  static async review(items) {
    let confirmed = false;
    const pageOrigin = new URL(document.URL).origin;
    if (items.length > 1) {
      for (const item of items) {
        if (item.origin === pageOrigin && Object.hasOwn(AssistantMount.DIALOGS, item.action)) {
          throw new Error(t("assistant.bundled", { confirm: AssistantMount.DIALOGS[item.action].confirm }));
        }
      }
    }
    const own = items.length === 1 && items[0].origin === pageOrigin;
    if (own && Object.hasOwn(AssistantMount.DIALOGS, items[0].action)) {
      const content = AssistantMount.dialogContent(items[0]);
      if (content.refusal) {
        throw new Error(content.refusal);
      }
      confirmed = await new Promise(AssistantMount.openDialog.bind(null, content));
    } else {
      confirmed = await AssistantMount.defaultReview(items);
    }
    AssistantMount.keepFocusInChat();
    return confirmed;
  }

  /**
   * The Desk's gate in front of the runtime's consent card (engine.onConsent), the one hook the vendored runtime gives
   * for a partner call. In order:
   *   1. A request longer than the card can show (CARD_CHARS) is declined before any card: the visitor could not have
   *      read all of what would be sent. A note in the chat says why.
   *   2. A host the visitor allowed always this session skips the card. The Desk keeps that "always" itself and never
   *      hands it to the engine, because the engine's own "always" would skip this hook, and so rules 1 and 3.
   *   3. After the visitor allows, and before the runtime contacts the partner, a partner network this Desk's lock
   *      pins is fetched and hashed (its network file and its links.json, as drift does); one that differs from the
   *      lock is declined, with a note. Once per host per page load. The fetch comes after consent, so consent still
   *      precedes any contact with the partner.
   *
   * :param info: The runtime's consent request ({kind, peerLabel, peerOrigin (a host), requestText, est}).
   * :return: "allow" or "decline" (never "always": see 2).
   */
  static async consent(info) {
    const name = info && info.peerLabel ? String(info.peerLabel) : String(info && info.peerOrigin);
    const text = info && typeof info.requestText === "string" ? info.requestText : "";
    if (text.length > CARD_CHARS) {
      AssistantMount.note(t("assistant.tooLong", { name, n: text.length }));
      return "decline";
    }
    let decision = "allow";
    if (!AssistantMount.alwaysHosts.has(info.peerOrigin)) {
      const answer = AssistantMount.defaultConsent(info);
      AssistantMount.focusConsentCard();
      decision = await answer;
      AssistantMount.keepFocusInChat();
      if (decision === "decline") return "decline";
    }
    if (info.kind === "network") {
      const pin = await AssistantMount.checkPin(info.peerOrigin);
      if (!pin.ok) {
        AssistantMount.note(pin.unread ? t("assistant.pinUnread", { name, why: pin.why }) : t("assistant.notPinned", { name, why: pin.why }));
        AssistantMount.markCardDeclined();
        return "decline";
      }
    }
    if (decision === "always") AssistantMount.alwaysHosts.add(info.peerOrigin);
    return "allow";
  }

  /** Hosts the visitor chose "Always allow" for, this page load. */
  static alwaysHosts = new Set();

  /** The pin checks done this page load, by host: a promise of {ok, why?, unread?}. */
  static pins = new Map();

  /** Where this Desk's own lock is published (beside agent-manifest.json). Tests point it at their scripted site. */
  static lockUrl = new URL(LOCK_FILE, new URL("./", import.meta.url)).href;

  static checkPin(host) {
    if (!AssistantMount.pins.has(host)) {
      const pending = AssistantMount.pinOf(host).then((pin) => {
        // A lock this page could not read is asked again next time; an answer about the partner stands.
        if (pin.unread) AssistantMount.pins.delete(host);
        return pin;
      });
      AssistantMount.pins.set(host, pending);
    }
    return AssistantMount.pins.get(host);
  }

  /**
   * Compares each partner network on `host` that this Desk's lock pins with what the partner publishes now: the
   * network file's sha256 and its links.json (or its absence), exactly as the drift reader hashes them. A host the lock
   * pins nothing on (a partner's own peer, an MCP service) is not checked here: the card is all there is for it.
   */
  static async pinOf(host) {
    const fetcher = App.page.fetch;
    let lock;
    try {
      const response = await fetcher(AssistantMount.lockUrl);
      if (!response.ok) return { ok: false, unread: true, why: `HTTP ${response.status}` };
      lock = JSON.parse(response.text());
    } catch {
      return { ok: false, unread: true, why: "not readable" };
    }
    const peers = lock && typeof lock.peers === "object" && lock.peers !== null ? Object.entries(lock.peers) : [];
    for (const [url, record] of peers) {
      let pinnedHost;
      try {
        pinnedHost = new URL(url).host;
      } catch {
        continue;
      }
      if (pinnedHost !== host) continue;
      try {
        const located = await locatePeerFile(url, fetcher);
        const network = await fetcher(located.fileUrl);
        if (!network.ok) return { ok: false, why: `its network file answered HTTP ${network.status}` };
        if ((await hashBytes(network.bytes)) !== record.sha256) return { ok: false, why: "its network file changed" };
        if (typeof record.links === "string") {
          const links = await fetcher(`${located.base}links.json`);
          const now = links.status === 404 || links.status === 410 ? PEER_LINKS_ABSENT : links.ok ? await hashBytes(links.bytes) : null;
          if (now === null) return { ok: false, why: `its links.json answered HTTP ${links.status}` };
          if (now !== record.links) return { ok: false, why: "its links.json changed" };
        }
      } catch {
        return { ok: false, why: "it could not be read" };
      }
    }
    return { ok: true };
  }

  /** A line from the Desk in the chat (not the model's): why a partner request was not sent. */
  static note(text) {
    AssistantMount.notes.push(text);
    let msgs = null;
    try {
      msgs = document.querySelector("#ns-msgs");
    } catch {
      msgs = null;
    }
    if (!msgs) return;
    const line = document.createElement("div");
    line.className = "ns-msg bot desk-note";
    line.setAttribute("role", "status");
    line.textContent = text;
    msgs.appendChild(line);
  }

  /** Every note this page load, newest last (the tests read it). */
  static notes = [];

  /** The runtime's card already says "Allowed" when the Desk then declines: it is relabelled, so it does not mislead. */
  static markCardDeclined() {
    try {
      const cards = document.querySelectorAll("#ns-msgs .ns-consent");
      const done = cards.length ? cards[cards.length - 1].querySelector(".ns-consent-done") : null;
      if (done) done.textContent = t("assistant.declinedByDesk");
    } catch {
      // no card to relabel (the visitor allowed always earlier)
    }
  }

  // ---- the AI provider key: in this tab only, unless the visitor ticks "remember" ----

  static remembering() {
    try {
      return storage("localStorage")?.getItem(REMEMBER_ITEM) === "yes";
    } catch {
      return false;
    }
  }

  static setRemembering(on) {
    try {
      if (on) storage("localStorage")?.setItem(REMEMBER_ITEM, "yes");
      else storage("localStorage")?.removeItem(REMEMBER_ITEM);
    } catch {
      // the choice lasts this page load only
    }
  }

  /**
   * Keeps the AI provider key in this tab only: the setup in use is kept in this tab's sessionStorage (where the
   * runtime reads it first after a reload, runtime/byok.js loadTabByokSetup), and every saved setup in localStorage
   * (and its loopback cookie mirror) loses its key, through the runtime's own exported profile functions. Nothing
   * happens while the visitor has ticked "remember".
   *
   * Synchronous, so it also runs to the end in "pagehide", which Save and start's reload fires.
   *
   * :param mod: The runtime's byok module (loaded once by wireKeyChoice; tests pass it).
   * :return: The number of saved setups a key was removed from.
   */
  static keepKeyInTab(mod = AssistantMount.byok) {
    if (!mod || AssistantMount.remembering()) return 0;
    const inUse = mod.loadTabByokSetup(mod.getSelectedByokProfile());
    if (inUse.key) mod.saveTabByokSetup(inUse);
    let cleared = 0;
    for (const profile of mod.loadByokStore().profiles) {
      if (!profile.key) continue;
      cleared += 1;
      // A setup that is only a key has nothing left to keep.
      if (!profile.model && !profile.router) mod.deleteByokProfile(profile.id);
      else mod.upsertByokProfile({ ...profile, key: "" }, { select: false });
    }
    return cleared;
  }

  /** The "remember my key" box in the panel: the key leaves the browser's storage at start and when the page goes. */
  static async wireKeyChoice() {
    AssistantMount.byok = await import("./runtime/byok.js");
    const box = document.querySelector("#remember-ai-key");
    if (box) {
      box.checked = AssistantMount.remembering();
      box.addEventListener("change", () => {
        AssistantMount.setRemembering(box.checked);
        if (!box.checked) AssistantMount.keepKeyInTab();
      });
    }
    window.addEventListener("pagehide", () => AssistantMount.keepKeyInTab());
    AssistantMount.keepKeyInTab();
  }

  /** The runtime's byok module, once loaded. */
  static byok = null;

  static focusConsentCard() {
    const cards = document.querySelectorAll("#ns-msgs .ns-consent");
    const card = cards[cards.length - 1];
    const title = card ? card.querySelector(".ns-consent-title") : null;
    if (!title) {
      return;
    }
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", title.textContent);
    const active = document.activeElement;
    if (active && active !== document.body && !active.closest("#agent-app")) {
      return;
    }
    title.tabIndex = -1;
    title.focus();
  }

  static dialogContent(item) {
    let details = {};
    try {
      details = AssistantMount.reviewDetails(item.action, item.arguments) || {};
    } catch (error) {
      console.error("Could not add details to the confirmation dialog", error);
    }
    const { refusal, ...shown } = details;
    return {
      ...AssistantMount.DIALOGS[item.action],
      details: shown,
      refusal,
      exact: `${item.action} on ${item.origin} (${item.effect})\n${JSON.stringify(item.arguments, null, 2)}`,
    };
  }

  /**
   * The readable details of the signing dialog, from the page's own read-only check, so no rule is copied here: the
   * origin, the visitor's key id, the expiry and every file path with its SHA-256. When the check refuses, return
   * {refusal: reason}, and review() opens no dialog.
   */
  static reviewDetails(action, args) {
    if (action === "sign_files") {
      const check = App.page.checkSign(args.expectedVersion);
      if (!check.ok) {
        return { refusal: check.reason };
      }
      return App.page.signDialogContent(check, "").details;
    }
    return {};
  }

  static openDialog(content, resolve) {
    openReviewDialog(content, resolve);
  }

  static finishDialog(dialog, resolve) {
    finishReviewDialog(dialog, resolve);
  }

  static keepFocusInChat() {
    if (document.activeElement === document.body || document.activeElement === null) {
      document.querySelector("#ns-input")?.focus();
    }
  }
}

// Boot only in a browser. Node tests import this file to check the dialog's words.
if (typeof window !== "undefined") {
  await AssistantMount.start();
}
