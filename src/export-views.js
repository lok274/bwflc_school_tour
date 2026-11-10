import { escapeHtml } from "./formatting.js";

export function createExportViews() {
  function renderPhotoExport(model) {
    if (model.status === "choosing") return `<p id="photo-export-status" role="status">選擇要${model.purpose === "upload" ? "上傳" : "下載"}的相片：</p>
      <label><input type="radio" name="photo-export-scope" value="all" checked />全部相片（${model.allCount} 張）</label>
      <label><input type="radio" name="photo-export-scope" value="selected" ${model.selectedCount ? "" : "disabled"} />已確定選取的相片（${model.selectedCount} 張）</label>
      <button class="button button-primary" data-photo-export-prepare>準備相片</button>`;
    if (model.purpose === "upload") {
      const rows = model.upload?.rows || [];
      const running = model.upload?.running;
      const done = rows.length && rows.every(row => row.state === "saved");
      const labels = { queued: "等候上傳", uploading: "正在上傳", saved: "已儲存", failed: "未能確認儲存" };
      return `<p id="photo-export-status" role="status" aria-live="polite" tabindex="-1">${escapeHtml(model.message)}</p>
        <p>收相人：bwc-ykl@bwflc.edu.hk · ${model.count} 張相片</p>
        <p>截止：香港時間 2026-11-30 23:59。每批最多 30 張。</p>
        <p>只傳送相簿的 JPEG 相片，不附加姓名、班別、學號、定位或打卡資料；相片畫面本身可能包含個人資料。本機相片會保留。</p>
        <p>關閉或離頁會停止後續傳送，但無法撤回 Google 已接收的資料，亦會失去本次續傳進度。離頁後請收相人先核對 Drive，再重新選取，以免重複上傳。</p>
        <ul>${rows.map(row => `<li>${escapeHtml(row.name)}：${labels[row.state]}（${Math.floor(100 * row.offset / row.size)}%）${row.error ? `<p>${escapeHtml(row.error)}</p>` : ""}</li>`).join("")}</ul>
        ${model.status === "ready" && !done ? `<label for="photo-upload-code">固定上傳碼（重試時輸入同一個）</label><input id="photo-upload-code" type="password" autocomplete="off" spellcheck="false" ${running ? "disabled" : ""} />
        <button class="button button-primary" data-photo-upload-confirm ${running ? "disabled" : ""}>${running ? "正在上傳…" : rows.length ? "重試未完成的相片" : "確認上傳"}</button>` : ""}`;
    }
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
