import { decorateInterface } from "./view-components.js";

// Presentation only: image conversion and result validation stay in photo-actions.
export function createPhotoExportController({ document, dialog, views, suspendMemory, resumeMemory }) {
  function showPhotoExport(model) {
    if (!dialog || !model) return;
    const content = document.querySelector("#photo-export-content");
    if (!content) return;
    const title = document.getElementById("photo-export-title");
    if (title) title.textContent = model.purpose === "upload" ? "上傳相片至學校" : "儲存相片到手機";
    const oldStatus = content.dataset.status;
    const focused = document.activeElement;
    const focusedAll = focused?.matches?.("[data-photo-export-download-all]");
    const focusedShare = focused?.matches?.("[data-photo-export-share]");
    const focusedId = focused?.id;
    suspendMemory();
    content.innerHTML = views.renderPhotoExport(model);
    decorateInterface(content);
    content.dataset.status = model.status;
    content.dataset.purpose = model.purpose || "download";
    if (!dialog.open) dialog.showModal();
    if (model.status === "choosing") {
      content.querySelector("[name=photo-export-scope]")?.focus();
    } else if (model.delivery) {
      content.querySelector?.("#photo-export-status")?.focus();
    } else if (model.status === "ready" && oldStatus === "preparing") {
      content.querySelector?.("#photo-upload-code, [data-photo-export-download-all], [data-photo-export-share]")?.focus();
    } else if (focusedAll) content.querySelector?.("[data-photo-export-download-all]")?.focus();
    else if (focusedShare) content.querySelector?.("[data-photo-export-share]")?.focus();
    else if (focusedId) document.getElementById(focusedId)?.focus({ preventScroll: true });
  }
  function hidePhotoExport() {
    if (dialog?.open) dialog.close();
    const content = document.querySelector("#photo-export-content");
    if (content) { content.innerHTML = ""; delete content.dataset.status; }
    resumeMemory();
  }

  return { show: showPhotoExport, hide: hidePhotoExport };
}
