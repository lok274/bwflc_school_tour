import { escapeHtml } from "./formatting.js";

export function createExportViews() {
  function renderPhotoExport(model) {
    if (model.status === "choosing") return `<p id="photo-export-status" role="status">選擇要下載的相片：</p>
      <label><input type="radio" name="photo-export-scope" value="all" checked />全部相片（${model.allCount} 張）</label>
      <label><input type="radio" name="photo-export-scope" value="selected" ${model.selectedCount ? "" : "disabled"} />已確定選取的相片（${model.selectedCount} 張）</label>
      <button class="button button-primary" data-photo-export-prepare>準備相片</button>`;
    const ready = model.status === "ready";
    return `<p id="photo-export-status" role="status" aria-live="polite" tabindex="-1" ${model.delivery ? `aria-describedby="photo-export-location"` : ""}>${escapeHtml(model.message)}</p>
      ${model.delivery ? `<section id="photo-export-location" class="photo-export-notice" aria-label="下載與儲存位置">
        ${model.delivery.filename ? `<p class="download-filename">${escapeHtml(model.delivery.filename)}</p>` : ""}
        <p>${escapeHtml(model.delivery.locationHint)}</p>
        <p>${model.delivery.kind === "download" ? "請確認下載是否完成；相片不一定直接加入相簿。" : "分享結束不代表已儲存，請自行確認。"}</p>
      </section>` : ""}
      ${model.status === "error" ? `<button class="button button-primary" id="export-retry" data-export-retry>重新準備</button>` : ""}
      ${ready ? `${!model.delivery && model.count > 1 ? "<p>多張相片下載後須解壓。</p>" : ""}<button class="button button-primary" data-photo-export-download-all>下載相片${model.count > 1 ? `（${model.count} 張）` : ""}</button>` : ""}
      ${model.canShare || model.status === "sharing" ? `<button class="button button-secondary" data-photo-export-share ${ready ? "" : "disabled"}>手機分享</button>` : ""}`;
  }
  return { renderPhotoExport };
}
