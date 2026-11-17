// Mounts the assistant inside the Desk page (the skill's templates/site.js, filled in for the Desk). Loaded with
//   <script type="module" src="site.js"></script>
// The page itself (desk.js) works without it: every action has a page button.
import { App } from "./desk.js";
import { openReviewDialog, finishReviewDialog } from "./review-dialog.js";
import { t } from "./strings.js";

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

  static async start() {
    const status = document.querySelector("#assistant-status");
    const siteBase = new URL("./", import.meta.url).href;
    try {
      const { boot } = await import("./runtime/index.js");
      const booted = await boot("#agent-app", {
        originUrl: siteBase,
        sandboxWorkerUrl: new URL("runtime/sandbox-worker.js", siteBase).href,
      });
      AssistantMount.engine = booted.engine;
      AssistantMount.defaultReview = booted.engine.onActionConfirm;
      booted.engine.onActionConfirm = AssistantMount.review;
      AssistantMount.defaultConsent = booted.engine.onConsent;
      booted.engine.onConsent = AssistantMount.consent;
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

  static async consent(info) {
    const answer = AssistantMount.defaultConsent(info);
    AssistantMount.focusConsentCard();
    const decision = await answer;
    AssistantMount.keepFocusInChat();
    return decision;
  }

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
