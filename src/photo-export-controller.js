// Presentation only: image conversion and result validation stay in photo-actions.
export function createPhotoExportController({ document, dialog, views, suspendMemory, resumeMemory }) {
  let exportOptions = { page: 0, moreOpen: false };
  function showPhotoExport(model) {
    if (!dialog || !model) return;
    const content = document.querySelector("#photo-export-content");
    if (!content) return;
    const oldStatus = content.dataset.status;
    const focused = document.activeElement;
    const focusedIndex = focused?.dataset?.photoExportDownload;
    const focusedAll = focused?.matches?.("[data-photo-export-download-all]");
    const focusedShare = focused?.matches?.("[data-photo-export-share]");
    const focusedId = focused?.id;
    if (model.status === "preparing" && oldStatus !== "preparing") exportOptions = { page: 0, moreOpen: false };
    suspendMemory();
    content.innerHTML = views.renderPhotoExport(model, exportOptions);
    content.dataset.status = model.status;
    if (!dialog.open) dialog.showModal();
    if (model.delivery) {
      content.querySelector?.("#photo-export-status")?.focus();
    } else if (model.status === "ready" && oldStatus === "preparing") {
      content.querySelector?.("[data-photo-export-download-all], [data-photo-export-share], [data-photo-export-download]")?.focus();
    } else if (focusedIndex !== undefined) {
      [...content.querySelectorAll("[data-photo-export-download]")].find(item => item.dataset.photoExportDownload === focusedIndex)?.focus();
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

  return { show: showPhotoExport, hide: hidePhotoExport,
    toggleMore() { exportOptions.moreOpen = !exportOptions.moreOpen; },
    setPage(page) { exportOptions.page = page; } };
}
