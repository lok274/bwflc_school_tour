import { escapeHtml } from "./formatting.js";

export function createFeedback({ document, window, requestAnimationFrame, stampLabel = "已到埗" }) {
  const toast = document.querySelector("#toast");
  const confirmDialog = document.querySelector("#confirm-dialog");
  let toastTimer = null;
  let toastHideTimer = null;
  let confirmationQueue = Promise.resolve();
  let confirmationGeneration = 0;
  const stamps = new Set();
  // A platform close request cancels this prompt and any already queued prompts.
  // The native close event still resolves the active promise exactly once.
  confirmDialog?.addEventListener("cancel", () => {
    confirmationGeneration += 1;
    confirmDialog.returnValue = "cancel";
  });
  function showToast(message, tone = "default", durationMs = 4200) {
    window.clearTimeout(toastTimer);
    window.clearTimeout(toastHideTimer);
    toast.textContent = message;
    toast.dataset.tone = tone;
    toast.hidden = false;
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    toastTimer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
      toastHideTimer = window.setTimeout(() => { toast.hidden = true; }, 220);
    }, durationMs);
  }

  function askConfirmation(options) {
    const generation = confirmationGeneration;
    const request = confirmationQueue.then(() => {
      if (generation !== confirmationGeneration || (options.isRelevant && !options.isRelevant())) return false;
      return showConfirmation(options);
    });
    confirmationQueue = request.catch(() => false);
    return request;
  }

  function showConfirmation({ title, message, confirmText = "確認", danger = false }) {
    if (!confirmDialog?.showModal) return Promise.resolve(window.confirm(message));
    document.querySelector("#confirm-title").textContent = title;
    document.querySelector("#confirm-message").textContent = message;
    const button = document.querySelector("#confirm-button");
    button.textContent = confirmText;
    button.classList.toggle("button-danger", danger);
    button.classList.toggle("button-primary", !danger);
    confirmDialog.returnValue = "";
    confirmDialog.showModal();
    return new Promise((resolve) => {
      confirmDialog.addEventListener("close", () => resolve(confirmDialog.returnValue === "confirm"), { once: true });
    });
  }

  function celebrateStamp(attraction) {
    const stamp = document.createElement("div");
    stamp.className = "stamp-celebration";
    stamp.innerHTML = `<span>${escapeHtml(stampLabel)}</span><strong>${escapeHtml(attraction.name)}</strong>`;
    document.body.append(stamp);
    stamps.add(stamp);
    window.setTimeout(() => { stamp.remove(); stamps.delete(stamp); }, 1800);
  }

  function cancelConfirmations() {
    confirmationGeneration += 1;
    if (confirmDialog?.open) confirmDialog.close("cancel");
    window.clearTimeout(toastTimer);
    window.clearTimeout(toastHideTimer);
    toast.classList.remove("is-visible");
    toast.hidden = true;
    for (const stamp of stamps) stamp.remove();
    stamps.clear();
  }

  return { showToast, askConfirmation, celebrateStamp, cancelConfirmations };
}
