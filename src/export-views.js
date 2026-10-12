import { escapeHtml } from "./formatting.js";
import { PHOTO_PAGE_SIZE } from "./app-settings.js";

export function createExportViews() {
  function renderCompactExport(model, { page = 0, moreOpen = false } = {}) {
    const ready = model.status === "ready", pages = Math.max(1, Math.ceil(model.files.length / PHOTO_PAGE_SIZE));
    page = Math.max(0, Math.min(page, pages - 1));
    return `<p id="photo-export-status" role="status" aria-live="polite" tabindex="-1" ${model.delivery ? `aria-describedby="photo-export-location"` : ""}>${escapeHtml(model.message)}</p>
      ${ready ? `<button class="button button-primary export-primary" data-photo-export-download-all>${model.count === 1 ? "下載相片" : `下載相片（${model.count} 張）`}</button>${!model.delivery && model.count > 1 ? "<p>多張相片下載後須解壓。</p>" : ""}` : ""}
      ${model.status === "error" ? `<button class="button button-primary" id="export-retry" data-export-retry>重新準備</button>` : ""}
      ${model.delivery ? `<section id="photo-export-location" class="photo-export-notice" aria-label="下載與儲存位置">${model.delivery.filename ? `<p class="download-filename">${escapeHtml(model.delivery.filename)}</p>` : ""}<p>${escapeHtml(model.delivery.locationHint)}</p><p>${model.delivery.kind === "download" ? "請確認下載是否完成；相片不一定直接加入相簿。" : "分享結束不代表已儲存，請自行確認。"}</p></section>` : ""}
      <p class="privacy-note">分享前請留意相片中的個人資料。</p>
      ${model.canShare || model.status === "sharing" ? `<button class="button button-secondary" data-photo-export-share ${ready ? "" : "disabled"}>手機分享</button>` : ""}
      ${model.files.length ? `<button class="text-link" id="export-more" data-export-more aria-expanded="${moreOpen}">更多選項</button>${moreOpen ? `<ul class="photo-export-files">${model.files.slice(page * PHOTO_PAGE_SIZE, page * PHOTO_PAGE_SIZE + PHOTO_PAGE_SIZE).map(file => `<li><span>${escapeHtml(file.name)}</span><button class="button button-secondary" data-photo-export-download="${file.index}" ${ready ? "" : "disabled"}>下載第 ${file.index + 1} 張</button></li>`).join("")}</ul><div class="memory-pagination"><button class="button button-secondary button-small" id="export-prev-page" data-export-page="${page - 1}" ${page === 0 ? "disabled" : ""}>上一頁</button><p>第 ${page + 1}／${pages} 頁</p><button class="button button-secondary button-small" id="export-next-page" data-export-page="${page + 1}" ${page + 1 === pages ? "disabled" : ""}>下一頁</button></div>` : ""}` : ""}`;
  }
  function renderPhotoExport(model, compact = null) {
    if (compact) return renderCompactExport(model, compact);
    const ready = model.status === "ready";
    return `
      <p id="photo-export-status" role="status" aria-live="polite" tabindex="-1" ${model.delivery ? `aria-describedby="photo-export-location"` : ""}>${escapeHtml(model.message)}</p>
      ${model.delivery ? `<section id="photo-export-location" class="photo-export-notice" aria-label="下載與儲存位置">
        ${model.delivery.filename ? `<p class="download-filename">${escapeHtml(model.delivery.filename)}</p>` : ""}
        <p>${escapeHtml(model.delivery.locationHint)}</p>
        <p>${model.delivery.kind === "download" ? "請確認下載是否完成；相片不一定直接加入相簿。" : "分享結束不代表已儲存，請自行確認。"}</p>
      </section>` : ""}
      <p class="privacy-note">分享前請留意相片中的個人資料。</p>
      ${model.canShare || model.status === "sharing" ? `<button class="button button-primary" data-photo-export-share ${ready ? "" : "disabled"}>開啟手機分享選單</button>` : ready ? `<p>此瀏覽器不支援分享這組檔案，請使用一鍵下載。</p>` : ""}
      ${model.files.length ? `${!model.delivery && model.files.length > 1 ? "<p>多張相片下載後須解壓。</p>" : ""}
        <button class="button button-primary" data-photo-export-download-all ${ready ? "" : "disabled"}>下載相片${model.files.length > 1 ? `（${model.files.length} 張）` : ""}</button>
        <details><summary>逐張下載</summary>
        <ul class="photo-export-files">${model.files.map(file => `<li><span>${escapeHtml(file.name)}</span><button class="button button-secondary" data-photo-export-download="${file.index}" ${ready ? "" : "disabled"}>下載第 ${file.index + 1} 張</button></li>`).join("")}</ul></details>` : ""}`;
  }
  return { renderPhotoExport };
}
