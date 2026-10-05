import { escapeHtml } from "./formatting.js";

export function createFeedback({ document, window, requestAnimationFrame }) {
  const toast = document.querySelector("#toast");
  const confirmDialog = document.querySelector("#confirm-dialog");
  let toastTimer = null;
  let confirmationQueue = Promise.resolve();
  function showToast(message, tone = "default") {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.dataset.tone = tone;
    toast.hidden = false;
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    toastTimer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
      window.setTimeout(() => { toast.hidden = true; }, 220);
    }, 4200);
  }

  function askConfirmation(options) {
    const request = confirmationQueue.then(() => {
      if (options.isRelevant && !options.isRelevant()) return false;
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
    stamp.innerHTML = `<span>已到埗</span><strong>${escapeHtml(attraction.name)}</strong>`;
    document.body.append(stamp);
    window.setTimeout(() => stamp.remove(), 1800);
  }

  return { showToast, askConfirmation, celebrateStamp };
}
