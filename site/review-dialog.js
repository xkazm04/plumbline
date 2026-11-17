// The confirmation dialog for an irreversible action, shared by the page's own Sign button and the assistant
// (site.js). It is the skill template's AssistantMount.openDialog and finishDialog, moved into a module so the page
// can use it when the assistant is not loaded: a question, one plain sentence, the readable details, the exact call
// under "Technical details", and two buttons named after what they do. Focus starts on the heading, which Enter cannot
// activate, so a stray Enter confirms nothing. Escape declines.

import { t } from "./strings.js";

/**
 * Open the dialog. It is added to <body> at once (synchronously).
 *
 * :param content: {title, sentence, confirm, decline, details, exact}.
 * :param resolve: Receives true when the visitor confirms, and false otherwise.
 */
export function openReviewDialog(content, resolve) {
  const dialog = document.createElement("dialog");
  dialog.className = "assistant-review";
  dialog.setAttribute("aria-labelledby", "assistant-review-title");
  const heading = document.createElement("h2");
  heading.id = "assistant-review-title";
  heading.textContent = content.title;
  heading.tabIndex = -1;
  heading.autofocus = true;
  const sentence = document.createElement("p");
  sentence.textContent = content.sentence;
  dialog.append(heading, sentence);
  const exact = document.createElement("details");
  const exactLabel = document.createElement("summary");
  exactLabel.textContent = t("dialog.technical");
  const exactText = document.createElement("pre");
  exactText.textContent = content.exact;
  exact.append(exactLabel, exactText);
  const entries = Object.entries(content.details || {});
  if (entries.length) {
    const list = document.createElement("dl");
    for (const [label, value] of entries) {
      const term = document.createElement("dt");
      term.textContent = label;
      const description = document.createElement("dd");
      description.textContent = String(value);
      list.append(term, description);
    }
    dialog.append(list);
  } else {
    exact.open = true;
  }
  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.textContent = content.confirm;
  confirmButton.addEventListener("click", dialog.close.bind(dialog, "confirm"));
  const declineButton = document.createElement("button");
  declineButton.type = "button";
  declineButton.className = "assistant-decline";
  declineButton.textContent = content.decline;
  declineButton.addEventListener("click", dialog.close.bind(dialog, "decline"));
  dialog.addEventListener("close", finishReviewDialog.bind(null, dialog, resolve));
  dialog.append(exact, confirmButton, declineButton);
  document.body.append(dialog);
  dialog.showModal();
}

/**
 * Remove the closed dialog and report the visitor's choice.
 *
 * :param dialog: The dialog that just closed.
 * :param resolve: Receives true when the visitor pressed the confirm button.
 */
export function finishReviewDialog(dialog, resolve) {
  dialog.remove();
  resolve(dialog.returnValue === "confirm");
}
