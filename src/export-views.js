import { escapeHtml } from "./formatting.js";
import { PHOTO_PAGE_SIZE } from "./app-settings.js";

export function createExportViews() {
  function renderCompactExport(model, { page = 0, moreOpen = false } = {}) {
    const ready = model.status === "ready", pages = Math.max(1, Math.ceil(model.files.length / PHOTO_PAGE_SIZE));
    page = Math.max(0, Math.min(page, pages - 1));
    return `<p id="photo-export-status" role="status" aria-live="polite" tabindex="-1" ${model.delivery ? `aria-describedby="photo-export-location"` : ""}>${escapeHtml(model.message)}</p>
      ${ready ? `<button class="button button-primary export-primary" data-photo-export-download-all>${model.count === 1 ? "下載 JPEG" : `下載 ZIP（${model.count} 張）`}</button><p>${model.count === 1 ? "下載一張 JPEG 相片。" : "相片會合成一個 ZIP 檔；下載後請先解壓，再把 JPEG 加入相簿。"}</p>` : ""}
      ${model.status === "error" ? `<button class="button button-primary" id="export-retry" data-export-retry>重新準備</button>` : ""}
      ${model.delivery ? `<section id="photo-export-location" class="photo-export-notice" aria-label="下載與儲存位置"><h3>${model.delivery.kind === "download" ? "下載檔案的位置" : "分享後的儲存位置"}</h3>${model.delivery.filename ? `<p class="download-filename">${escapeHtml(model.delivery.filename)}</p>` : ""}<p>${escapeHtml(model.delivery.locationHint)}</p><p>${model.delivery.kind === "download" ? "請在瀏覽器下載列表確認是否完成；檔案不一定直接加入相簿。" : "分享結束不代表已儲存，請自行確認。"}</p></section>` : ""}
      <p class="privacy-note">相片仍可能透露身份，請留意是否適合保存及分享。App 內相片會保留。</p>
      ${model.canShare || model.status === "sharing" ? `<button class="button button-secondary" data-photo-export-share ${ready ? "" : "disabled"}>手機分享</button>` : ""}
      ${model.files.length ? `<button class="text-link" id="export-more" data-export-more aria-expanded="${moreOpen}">更多選項</button>${moreOpen ? `<ul class="photo-export-files">${model.files.slice(page * PHOTO_PAGE_SIZE, page * PHOTO_PAGE_SIZE + PHOTO_PAGE_SIZE).map(file => `<li><span>${escapeHtml(file.name)}</span><button class="button button-secondary" data-photo-export-download="${file.index}" ${ready ? "" : "disabled"}>下載第 ${file.index + 1} 張</button></li>`).join("")}</ul><div class="memory-pagination"><button class="button button-secondary button-small" id="export-prev-page" data-export-page="${page - 1}" ${page === 0 ? "disabled" : ""}>上一頁</button><p>第 ${page + 1}／${pages} 頁</p><button class="button button-secondary button-small" id="export-next-page" data-export-page="${page + 1}" ${page + 1 === pages ? "disabled" : ""}>下一頁</button></div>` : ""}` : ""}`;
  }
  function renderPhotoExport(model, compact = null) {
    if (compact) return renderCompactExport(model, compact);
    const ready = model.status === "ready";
    return `
      <p id="photo-export-status" role="status" aria-live="polite" tabindex="-1" ${model.delivery ? `aria-describedby="photo-export-location"` : ""}>${escapeHtml(model.message)}</p>
      ${model.delivery ? `<section id="photo-export-location" class="photo-export-notice" aria-label="下載與儲存位置">
        <h3>${model.delivery.kind === "download" ? "下載檔案的位置" : "分享後的儲存位置"}</h3>
        ${model.delivery.filename ? `<p class="download-filename"><strong>檔名：</strong>${escapeHtml(model.delivery.filename)}</p>` : ""}
        <p>${escapeHtml(model.delivery.locationHint)}</p>
        ${model.delivery.kind === "download" ? "<p>網頁無法確認下載是否完成或讀取實際儲存路徑。下載檔案不一定直接加入相簿；如找不到檔案，請查看瀏覽器下載列表並重試。</p>" : ""}
      </section>` : ""}
      <p>相片中的人樣、校服及背景仍可能透露身份，請確認適合儲存或分享。App 內的相片副本會保留；清除 App 資料不會刪除已匯出的相片。</p>
      ${model.canShare || model.status === "sharing" ? `<button class="button button-primary" data-photo-export-share ${ready ? "" : "disabled"}>開啟手機分享選單</button>` : ready ? `<p>此瀏覽器不支援分享這組檔案，請使用一鍵下載。</p>` : ""}
      ${model.files.length ? `<p>${model.files.length > 1 ? "一鍵下載會把已選取的相片合成一個 ZIP 檔。下載後請解壓，再把 JPEG 相片加入相簿。" : "下載 JPEG 相片後，可在手機將相片加入相簿。"} 檔案可能存於「下載」或「檔案」。</p>
        <button class="button button-primary" data-photo-export-download-all ${ready ? "" : "disabled"}>一鍵下載全部（${model.files.length} 張${model.files.length > 1 ? "・ZIP" : ""}）</button>
        <details><summary>逐張下載</summary>
        <ul class="photo-export-files">${model.files.map(file => `<li><span>${escapeHtml(file.name)}</span><button class="button button-secondary" data-photo-export-download="${file.index}" ${ready ? "" : "disabled"}>下載第 ${file.index + 1} 張</button></li>`).join("")}</ul></details>` : ""}`;
  }
  return { renderPhotoExport };
}
