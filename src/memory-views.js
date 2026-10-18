import { escapeHtml, formatDateTime } from "./formatting.js";
import { MEMORY_SECTIONS } from "./routes.js";
import { PHOTO_PAGE_SIZE } from "./app-settings.js";
import { createViewComponents, renderIcon } from "./view-components.js";

export function createMemoryViews({ testOnly = false } = {}) {
  const { viewHeading, checkInBadge } = createViewComponents({ testOnly });
  function renderCheckInCardEntry(available) {
    return available ? `<section class="checkin-card-entry" aria-label="${testOnly ? "五站測試打卡紀錄" : "五站打卡完成紀錄"}"><button id="memory-checkin-card-open" class="button button-primary" data-memory-checkin-card-open>製作五站打卡紀錄卡</button></section>` : "";
  }
  function renderPendingCheckIns(progress) {
    return `<p class="task-progress" role="status">必需景點打卡：${progress.filled}／${progress.total}</p><ul class="checkin-station-list">${progress.stations.map(station => `<li><span>${escapeHtml(station.name)}</span>${checkInBadge(station.checkIn)}${station.checkIn ? "" : `<a class="text-link" href="#attraction/${escapeHtml(station.id)}">前往打卡<span class="sr-only">：${escapeHtml(station.name)}</span></a>`}</li>`).join("")}</ul>`;
  }
  function renderMemories({ albums, photoCount, selectedCount, readState, memoryOverlay, checkInCardAvailable, section = "albums", checkInProgress = { filled: 0, total: 0, stations: [] } }) {
    const inline = ["album", "photo"].includes(memoryOverlay?.mode) ? memoryOverlay : null;
    let body = "";
    if (section === "albums") body = `
      ${inline ? "" : readState === "ready" ? `<section class="memory-toolbar" aria-label="相片下載"><p role="status">${photoCount} 張相片 · 已選 ${selectedCount} 張</p><div class="photo-actions"><button id="memory-download-all" class="button button-primary" data-memory-download-all ${photoCount ? "" : "disabled"}>下載相片</button>${selectedCount ? `<button id="memory-clear-selected" class="text-link" data-photo-select-none="memories">清除全部勾選</button>` : ""}</div></section>` : `<section class="memory-empty"><h2 role="status">${readState === "loading" ? "正在讀取相片…" : "相片讀取失敗"}</h2>${readState === "error" ? `<p>不代表相片已刪除。</p><button class="button button-primary" data-photos-retry>重新讀取相片</button>` : ""}</section>`}
      ${readState === "ready" ? photoCount ? `<div class="memory-albums">${albums.map(album => `<button id="memory-album-${escapeHtml(album.attraction.id)}" class="memory-album" data-memory-album="${escapeHtml(album.attraction.id)}" aria-expanded="${inline?.attraction.id === album.attraction.id}" aria-controls="memory-inline" aria-label="${inline?.attraction.id === album.attraction.id ? "收起" : "展開"}${escapeHtml(album.attraction.name)}相簿，${album.photoCount} 張相片">${album.cover?.url ? `<img src="${escapeHtml(album.cover.url)}" alt="${escapeHtml(album.attraction.name)}相簿封面" loading="lazy" />` : `<span class="memory-cover-empty" aria-hidden="true">▧</span>`}<span class="memory-album-copy"><strong>${escapeHtml(album.attraction.name)}</strong><span>${album.photoCount} 張相片${album.selectedCount ? ` · 已選 ${album.selectedCount} 張` : ""}</span></span></button>`).join("")}</div>` : `<section class="memory-empty"><h2>尚未有相片</h2><p>打卡後即可拍照。</p><a class="button button-primary" href="#itinerary">前往行程</a></section>` : ""}
      <section id="memory-inline" class="memory-inline" ${inline ? 'aria-labelledby="memory-title"' : "hidden"}>${inline ? renderMemoryOverlay(inline) : ""}</section>

      <details id="memory-privacy" class="memory-privacy" data-ui-disclosure><summary>相片與私隱</summary><p>取消打卡會刪除本站全部相片，無法復原；已下載或分享的檔案會保留。</p></details>`;
    else if (section === "checkins") body = `<section class="memory-task-panel">${renderPendingCheckIns(checkInProgress)}${renderCheckInCardEntry(checkInCardAvailable)}${checkInCardAvailable ? "" : "<p>完成五站打卡即可製卡；學校選填。</p>"}</section>`;
    return `<section class="page-shell memories-page">${viewHeading("旅途回憶")}<div class="memory-tabs" role="group" aria-label="回憶分類">${MEMORY_SECTIONS.map(item => `<button id="memory-tab-${item.id}" class="section-toggle memory-tab" data-section-view="memories" data-section-id="${item.id}" aria-expanded="${item.id === section}" aria-controls="memory-section-${item.id}">${renderIcon({ albums: "Images", checkins: "ShieldCheck" }[item.id])}<span>${item.label}</span></button>`).join("")}</div>${MEMORY_SECTIONS.map(item => `<section id="memory-section-${item.id}" class="section-content" aria-labelledby="memory-tab-${item.id}" ${item.id === section ? "" : "hidden"}>${item.id === section ? body : ""}</section>`).join("")}</section>`;
  }
  function renderMemoryOverlay(model) {
    const { mode, attraction } = model;
    const title = attraction?.name || "旅途回憶";
    let body = "", footer = "";
    if (model.readState !== "ready") body = `<p role="status">${model.readState === "loading" ? "正在讀取相片…" : "暫時未能讀取相片，請重試。"}</p>${model.readState === "error" ? `<button class="button button-primary" data-photos-retry>重新讀取相片</button>` : ""}`;
    else if (mode === "album") {
      body = `<p>${model.photoCount} 張相片 · 全旅程已選 ${model.selectedCount} 張${model.selectionChanged ? "（待確定）" : ""}</p><div class="memory-thumbnails">${model.photos.map((photo, index) => `<article class="memory-thumbnail"><button id="memory-photo-${escapeHtml(photo.photoId)}" class="memory-thumbnail-open" data-memory-photo="${escapeHtml(photo.photoId)}" aria-label="查看第 ${model.page * PHOTO_PAGE_SIZE + index + 1} 張相片">${photo.url ? `<img src="${escapeHtml(photo.url)}" alt="${escapeHtml(attraction.name)}第 ${model.page * PHOTO_PAGE_SIZE + index + 1} 張相片" />` : `<span>預覽未能顯示</span>`}</button><label for="memory-select-${escapeHtml(photo.photoId)}"><input id="memory-select-${escapeHtml(photo.photoId)}" type="checkbox" data-photo-select="${escapeHtml(photo.photoId)}" ${photo.selected ? "checked" : ""} />第 ${model.page * PHOTO_PAGE_SIZE + index + 1} 張</label></article>`).join("")}</div>`;
      footer = `<div class="memory-pagination"><button class="button button-secondary button-small" id="memory-prev-page" data-memory-page="${model.page - 1}" ${model.page === 0 ? "disabled" : ""}>上一頁</button><p role="status">第 ${model.page + 1}／${model.pageCount} 頁</p><button class="button button-secondary button-small" id="memory-next-page" data-memory-page="${model.page + 1}" ${model.page + 1 === model.pageCount ? "disabled" : ""}>下一頁</button></div><button id="memory-selection-confirm" class="button button-accent memory-selection-confirm" data-memory-selection-confirm>確定</button><div class="memory-album-actions"><button class="text-link" id="memory-album-selection" data-memory-album-select="${model.albumSelectedCount === model.photoCount ? "none" : "all"}">${model.albumSelectedCount === model.photoCount ? "清除此相簿勾選" : "全選此相簿"}</button></div>`;
    } else if (model.photo) {
      const photo = model.photo;
      body = `${photo.url ? `<img class="memory-full-photo" src="${escapeHtml(photo.url)}" alt="${escapeHtml(attraction.name)}的完整相片" />` : `<p>暫時未能顯示預覽。</p>`}<p>第 ${model.photoIndex + 1}／${model.photoCount} 張</p><p>${formatDateTime(model.checkIn.checkedInAt)} ${checkInBadge(model.checkIn)}</p>`;
      footer = `<div class="memory-pagination"><button class="button button-secondary" id="memory-prev-photo" data-memory-photo-step="previous" ${model.previousPhotoId ? "" : "disabled"}>上一張</button><button class="button button-secondary" id="memory-next-photo" data-memory-photo-step="next" ${model.nextPhotoId ? "" : "disabled"}>下一張</button></div>`;
    }
    return `<div class="memory-dialog-heading"><div>${model.depth > 1 ? `<button id="memory-back" class="text-link" data-memory-back>返回相簿</button>` : ""}<h3 id="memory-title" tabindex="-1">${escapeHtml(title)}</h3></div><button id="memory-close" class="icon-button" data-memory-close aria-label="收起相簿並取消未確定的相片選取">−</button></div><div id="memory-body" class="memory-inline-body">${body}</div>${footer ? `<footer class="memory-inline-footer">${footer}</footer>` : ""}`;
  }

  return { renderMemories, renderMemoryOverlay };
}
