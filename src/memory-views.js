import { escapeHtml, formatDateTime, formatSmallCount } from "./formatting.js";
import { MEMORY_SECTIONS } from "./routes.js";
import { PHOTO_PAGE_SIZE } from "./app-settings.js";
import { MAX_REFLECTION_LENGTH, countReflectionCharacters } from "./card-reflection.js";
import { createViewComponents, renderIcon } from "./view-components.js";
import { renderAIArtwork } from "./ai-artwork-controller.js";

export function createMemoryViews({ testOnly = false } = {}) {
  const { viewHeading, checkInBadge } = createViewComponents({ testOnly });
  function summaryProgress(card) {
    return card.readState === "ready" ? `<div class="summary-progress" role="status" aria-live="polite"><p>已選取：${card.requiredSelectedCount}／${card.requiredCount} 個景點${card.stations.some(item => !item.required && item.selectedPhotoId) ? " · 已加入學校相片" : ""}</p></div>` : `<p role="status">${card.readState === "loading" ? "正在讀取相片…" : "相片讀取失敗，請重試。"}</p>${card.readState === "error" ? '<button class="button button-secondary" data-photos-retry>重新讀取相片</button>' : ""}`;
  }
  function summaryMissing(card) {
    if (card.readState !== "ready") return "";
    const missing = card.stations.filter(item => item.required && !item.photoCount);
    return missing.length ? `<p class="summary-warning">仍欠 ${missing.length} 個景點的相片，請先補拍。</p><ul class="summary-missing">${missing.map(item => `<li><span>${escapeHtml(item.attraction.name)}</span><a class="text-link" href="#attraction/${escapeHtml(item.attraction.id)}">返回景點補拍<span class="sr-only">：${escapeHtml(item.attraction.name)}</span></a></li>`).join("")}</ul>` : "";
  }
  function renderSummaryStatus(card, selectionOpen, artworkOpen) {
    if (!card) return "";
    const status = selectionOpen || artworkOpen ? "" : `<p>${formatSmallCount(card.requiredCount)}個景點各選一張；學校相片選填。</p>${summaryProgress(card)}${summaryMissing(card)}`;
    return `<section class="summary-card-builder summary-compact" aria-labelledby="memory-tab-ai">${status}<ol class="ai-steps"><li><button id="memory-summary-open" class="button button-primary" data-memory-summary-open aria-expanded="${selectionOpen}" aria-controls="memory-ai-inline" ${card.readState === "ready" ? "" : "disabled"}>${selectionOpen ? "收起選圖" : "選取素材相片"}</button></li><li>解壓後，到支援多張相片的 AI 工具製作圖片。</li><li><button id="memory-artwork-open" class="button button-primary" data-memory-artwork-open aria-expanded="${artworkOpen}" aria-controls="memory-artwork-inline">為 AI 成品加上署名</button></li></ol></section>`;
  }
  function renderSummaryRequirements(card) {
    const pending = card.stations.filter(item => item.required && !item.selectedPhotoId);
    return card.readState === "ready" ? `<p>${pending.length ? `尚欠 ${pending.length} 個景點未選相片。` : `已選 ${card.selectedCount} 張，可以下載。`}</p>` : "讀取完成後才可下載。";
  }
  function renderSummaryCard(card) {
    if (!card) return "";
    const ready = card.readState === "ready";
    const stations = [...card.stations.filter(item => item.required), ...card.stations.filter(item => !item.required)];
    return `<section class="summary-editor"><p>每個景點選一張有當地特色、包含自己或同學的相片；學校選填。</p>
      <div class="summary-slots">${stations.map((station, index) => `<section class="summary-slot" aria-label="${escapeHtml(station.attraction.name)}${station.required ? "" : "（選填）"}"><h3>${station.required ? `${index + 1}.` : "選填："} ${escapeHtml(station.attraction.name)}</h3>
        ${station.selectedPhoto?.url ? `<img src="${escapeHtml(station.selectedPhoto.url)}" alt="已選取的${escapeHtml(station.attraction.name)}相片" />` : `<div class="summary-slot-empty">${station.selectedPhotoId ? "暫時未能顯示預覽" : station.required ? "尚未選取" : "不加入學校相片"}</div>`}
        <button id="memory-pick-${escapeHtml(station.attraction.id)}" class="button button-secondary" data-memory-pick="${escapeHtml(station.attraction.id)}" ${!ready || !station.photoCount || card.busy ? "disabled" : ""}>${station.selectedPhotoId ? "更換相片" : "選取相片"}</button>
        ${!station.required && station.selectedPhotoId ? `<button class="text-link" id="memory-omit-school" data-memory-summary-omit="departure-school" ${card.busy ? "disabled" : ""}>移除學校相片</button>` : ""}
        ${ready && !station.photoCount ? `${station.required ? "<p>尚未拍照。</p>" : ""}<a class="text-link" href="#attraction/${escapeHtml(station.attraction.id)}">${station.required ? "補拍" : "拍攝學校相片（選填）"}<span class="sr-only">：${escapeHtml(station.attraction.name)}</span></a>` : ""}</section>`).join("")}</div>
      <p id="summary-draft-note" class="privacy-note">離開旅途回憶或重新載入會清除選取。</p>
      <div id="summary-requirements" class="summary-requirements" aria-live="polite">${renderSummaryRequirements(card)}</div>
      <button id="summary-download" class="button button-accent" data-summary-download aria-describedby="summary-requirements" ${card.canDownload ? "" : "disabled"}>${card.busy ? "正在準備…" : `下載 AI 素材包${card.canDownload ? `（${card.selectedCount} 張）` : ""}`}</button></section>`;
  }
  function renderCheckInCardEntry(available) {
    return available ? `<section class="checkin-card-entry" aria-label="${testOnly ? "五站測試打卡紀錄" : "五站打卡完成紀錄"}"><button id="memory-checkin-card-open" class="button button-primary" data-memory-checkin-card-open>製作五站打卡紀錄卡</button></section>` : "";
  }
  function renderPendingCheckIns(progress) {
    return `<p class="task-progress" role="status">必需景點打卡：${progress.filled}／${progress.total}</p><ul class="checkin-station-list">${progress.stations.map(station => `<li><span>${escapeHtml(station.name)}</span>${checkInBadge(station.checkIn)}${station.checkIn ? "" : `<a class="text-link" href="#attraction/${escapeHtml(station.id)}">前往打卡<span class="sr-only">：${escapeHtml(station.name)}</span></a>`}</li>`).join("")}</ul>`;
  }
  function renderMemories({ albums, photoCount, selectedCount, readState, summaryCard, memoryOverlay, artwork, checkInCardAvailable, section = "albums", checkInProgress = { filled: 0, total: 0, stations: [] } }) {
    const inline = ["album", "photo"].includes(memoryOverlay?.mode) ? memoryOverlay : null;
    let body = "";
    if (section === "albums") body = `
      ${inline ? "" : readState === "ready" ? `<section class="memory-toolbar" aria-label="相片下載"><p role="status">${photoCount} 張相片 · 已選 ${selectedCount} 張</p><div class="photo-actions"><button id="memory-download-all" class="button button-primary" data-memory-download-all ${photoCount ? "" : "disabled"}>下載全部</button><button id="memory-download-selected" class="button button-secondary" data-photo-export-selected="memories" ${selectedCount ? "" : "disabled"}>下載已選（${selectedCount} 張）</button>${selectedCount ? `<button id="memory-clear-selected" class="text-link" data-photo-select-none="memories">清除全部勾選</button>` : ""}</div></section>` : `<section class="memory-empty"><h2 role="status">${readState === "loading" ? "正在讀取相片…" : "相片讀取失敗"}</h2>${readState === "error" ? `<p>不代表相片已刪除。</p><button class="button button-primary" data-photos-retry>重新讀取相片</button>` : ""}</section>`}
      ${readState === "ready" ? photoCount ? `<div class="memory-albums">${albums.map(album => `<button id="memory-album-${escapeHtml(album.attraction.id)}" class="memory-album" data-memory-album="${escapeHtml(album.attraction.id)}" aria-expanded="${inline?.attraction.id === album.attraction.id}" aria-controls="memory-inline" aria-label="${inline?.attraction.id === album.attraction.id ? "收起" : "展開"}${escapeHtml(album.attraction.name)}相簿，${album.photoCount} 張相片">${album.cover?.url ? `<img src="${escapeHtml(album.cover.url)}" alt="${escapeHtml(album.attraction.name)}相簿封面" loading="lazy" />` : `<span class="memory-cover-empty" aria-hidden="true">▧</span>`}<span class="memory-album-copy"><strong>${escapeHtml(album.attraction.name)}</strong><span>${album.photoCount} 張相片${album.selectedCount ? ` · 已選 ${album.selectedCount} 張` : ""}</span></span></button>`).join("")}</div>` : `<section class="memory-empty"><h2>尚未有相片</h2><p>打卡後即可拍照。</p><a class="button button-primary" href="#itinerary">前往行程</a></section>` : ""}
      <section id="memory-inline" class="memory-inline" ${inline ? 'aria-labelledby="memory-title"' : "hidden"}>${inline ? renderMemoryOverlay(inline, { inline: true }) : ""}</section>

      <details id="memory-privacy" class="memory-privacy" data-ui-disclosure><summary>相片與私隱</summary><p>相片只存在這部裝置，不會上傳或自動加入手機相簿；人樣及背景仍可能透露身份。</p><p>取消打卡會刪除本站全部相片，無法復原；已下載或分享的檔案會保留。</p></details>`;
    else if (section === "ai") {
      const selection = ["summary", "picker"].includes(memoryOverlay?.mode) ? memoryOverlay : null;
      body = summaryCard ? `${renderSummaryStatus(summaryCard, Boolean(selection), Boolean(artwork?.visible))}
        <section id="memory-ai-inline" class="memory-inline" ${selection ? 'aria-labelledby="memory-title"' : "hidden"}>${selection ? renderMemoryOverlay(selection, { inline: true }) : ""}</section>
        <section id="memory-artwork-inline" class="memory-inline" ${artwork?.visible ? 'aria-labelledby="artwork-title"' : "hidden"}>${artwork?.visible ? renderAIArtwork(artwork, { inline: true }) : ""}</section>`
        : `<section class="memory-task-panel"><p>請先完成五站打卡；學校選填。</p>${renderPendingCheckIns(checkInProgress)}</section>`;
    }
    else if (section === "checkins") body = `<section class="memory-task-panel">${renderPendingCheckIns(checkInProgress)}${renderCheckInCardEntry(checkInCardAvailable)}${checkInCardAvailable ? "" : "<p>完成五站打卡即可製卡；學校選填。</p>"}</section>`;
    return `<section class="page-shell memories-page">${viewHeading("旅途回憶")}<div class="memory-tabs" role="group" aria-label="回憶分類">${MEMORY_SECTIONS.map(item => `<button id="memory-tab-${item.id}" class="section-toggle memory-tab" data-section-view="memories" data-section-id="${item.id}" aria-expanded="${item.id === section}" aria-controls="memory-section-${item.id}">${renderIcon({ albums: "Images", ai: "Sparkles", checkins: "ShieldCheck" }[item.id])}<span>${item.label}</span></button>`).join("")}</div>${MEMORY_SECTIONS.map(item => `<section id="memory-section-${item.id}" class="section-content" aria-labelledby="memory-tab-${item.id}" ${item.id === section ? "" : "hidden"}>${item.id === section ? body : ""}</section>`).join("")}</section>`;
  }
  function reflectionField(photo) {
    const hint = `card-reflection-hint-${escapeHtml(photo.photoId)}`;
    return `<div class="card-reflection-field"><label for="memory-reflection">感想（選填）</label><textarea id="memory-reflection" rows="3" data-card-reflection="${escapeHtml(photo.photoId)}" aria-describedby="${hint}">${escapeHtml(photo.reflection || "")}</textarea><p class="privacy-note" id="${hint}">${countReflectionCharacters(photo.reflection)} / ${MAX_REFLECTION_LENGTH} 字。離頁或重新載入會清除感想。</p></div>`;
  }
  function renderMemoryOverlay(model, { inline = false } = {}) {
    const { mode, attraction, busy } = model;
    const title = mode === "summary" ? "準備 AI 融合圖片作品" : mode === "picker" ? `選取${attraction.name}相片` : attraction?.name || "旅途回憶";
    let body = "", footer = "";
    if (model.readState !== "ready") body = `<p role="status">${model.readState === "loading" ? "正在讀取相片…" : "暫時未能讀取相片，請重試。"}</p>${model.readState === "error" ? `<button class="button button-primary" data-photos-retry>重新讀取相片</button>` : ""}`;
    else if (mode === "summary") body = renderSummaryCard(model.summaryCard);
    else if (mode === "album" || mode === "picker") {
      body = `<p>${model.photoCount} 張相片${mode === "album" ? ` · 全旅程已選 ${model.selectedCount} 張${model.selectionChanged ? "（待確定）" : ""}` : " · 每個景點只選一張"}</p><div class="memory-thumbnails">${model.photos.map((photo, index) => mode === "picker" ? `<label class="memory-thumbnail memory-picker" for="summary-photo-${escapeHtml(attraction.id)}-${index}">${photo.url ? `<img src="${escapeHtml(photo.url)}" alt="${escapeHtml(attraction.name)}第 ${model.page * PHOTO_PAGE_SIZE + index + 1} 張相片" />` : `<span>預覽未能顯示</span>`}<span><input type="radio" id="summary-photo-${escapeHtml(attraction.id)}-${index}" name="summary-${escapeHtml(attraction.id)}" data-summary-select="${escapeHtml(attraction.id)}" data-summary-photo-id="${escapeHtml(photo.photoId)}" ${photo.summarySelected ? "checked" : ""} />選取第 ${model.page * PHOTO_PAGE_SIZE + index + 1} 張</span></label>` : `<article class="memory-thumbnail"><button id="memory-photo-${escapeHtml(photo.photoId)}" class="memory-thumbnail-open" data-memory-photo="${escapeHtml(photo.photoId)}" aria-label="查看第 ${model.page * PHOTO_PAGE_SIZE + index + 1} 張相片">${photo.url ? `<img src="${escapeHtml(photo.url)}" alt="${escapeHtml(attraction.name)}第 ${model.page * PHOTO_PAGE_SIZE + index + 1} 張相片" />` : `<span>預覽未能顯示</span>`}</button><label for="memory-select-${escapeHtml(photo.photoId)}"><input id="memory-select-${escapeHtml(photo.photoId)}" type="checkbox" data-photo-select="${escapeHtml(photo.photoId)}" ${photo.selected ? "checked" : ""} />第 ${model.page * PHOTO_PAGE_SIZE + index + 1} 張</label></article>`).join("")}</div>`;
      footer = `<div class="memory-pagination"><button class="button button-secondary button-small" id="memory-prev-page" data-memory-page="${model.page - 1}" ${model.page === 0 ? "disabled" : ""}>上一頁</button><p role="status">第 ${model.page + 1}／${model.pageCount} 頁</p><button class="button button-secondary button-small" id="memory-next-page" data-memory-page="${model.page + 1}" ${model.page + 1 === model.pageCount ? "disabled" : ""}>下一頁</button></div>${mode === "album" ? `<p id="memory-selection-hint" class="privacy-note">勾選後請按「確定」保留；收起或切換相簿會取消未確定的勾選。</p><button id="memory-selection-confirm" class="button button-accent memory-selection-confirm" data-memory-selection-confirm>確定</button><details id="memory-more-${attraction.id}" class="memory-more-actions" data-ui-disclosure><summary>更多操作</summary><div class="memory-album-actions"><button class="text-link" id="memory-album-selection" data-memory-album-select="${model.albumSelectedCount === model.photoCount ? "none" : "all"}">${model.albumSelectedCount === model.photoCount ? "清除此相簿勾選" : "全選此相簿"}</button><button class="button button-primary" id="memory-download-album" data-memory-download-album>下載此相簿</button><button id="memory-download-selected-album" class="button button-secondary" data-photo-export-selected="memories" ${model.confirmedSelectedCount && !model.selectionChanged ? "" : "disabled"} aria-describedby="memory-selection-hint">下載已選（全旅程 ${model.confirmedSelectedCount} 張）</button></div></details>` : ""}`;
    } else if (model.photo) {
      const photo = model.photo;
      body = `${photo.url ? `<img class="memory-full-photo" src="${escapeHtml(photo.url)}" alt="${escapeHtml(attraction.name)}的完整相片" />` : `<p>暫時未能顯示預覽。</p>`}<p>第 ${model.photoIndex + 1}／${model.photoCount} 張</p><p>${formatDateTime(model.checkIn.checkedInAt)} ${checkInBadge(model.checkIn)}</p><div class="photo-actions"><button class="button button-primary" id="memory-download-photo" data-memory-download-photo ${busy ? "disabled" : ""}>下載此相片</button><button class="button button-secondary" id="memory-card-toggle" data-memory-card-toggle ${busy ? "disabled" : ""} aria-expanded="${model.cardOpen}">${model.cardOpen ? "收起單張旅程卡" : "製作單張旅程卡"}</button></div>${model.cardOpen ? `${reflectionField(photo)}<p class="privacy-note">卡片含相片、感想及打卡時間，分享前請留意個人資料。</p><button class="button button-accent" id="memory-download-card" data-card-download="${escapeHtml(attraction.id)}" data-photo-id="${escapeHtml(photo.photoId)}" ${busy ? "disabled" : ""}>${busy ? "正在製作…" : "下載旅程卡"}</button>` : ""}`;
      footer = `<div class="memory-pagination"><button class="button button-secondary" id="memory-prev-photo" data-memory-photo-step="previous" ${model.previousPhotoId ? "" : "disabled"}>上一張</button><button class="button button-secondary" id="memory-next-photo" data-memory-photo-step="next" ${model.nextPhotoId ? "" : "disabled"}>下一張</button></div>`;
    }
    const heading = inline ? "h3" : "h2";
    const ai = ["summary", "picker"].includes(mode);
    return `<div class="memory-dialog-heading"><div>${model.depth > 1 ? `<button id="memory-back" class="text-link" data-memory-back>${inline ? ai ? "返回素材選圖" : "返回相簿" : "返回"}</button>` : ""}<${heading} id="memory-title" tabindex="-1">${escapeHtml(title)}</${heading}></div><button id="memory-close" class="icon-button" data-memory-close aria-label="${inline ? ai ? "收起素材選圖，保留已選相片" : "收起相簿並取消未確定的相片選取" : "關閉旅途回憶視窗"}">${inline ? "−" : "×"}</button></div><div id="memory-body" class="${inline ? "memory-inline-body" : "memory-dialog-body"}">${body}</div>${footer ? `<footer class="${inline ? "memory-inline-footer" : "memory-dialog-footer"}">${footer}</footer>` : ""}`;
  }

  return { renderMemories, renderMemoryOverlay, renderSummaryRequirements };
}
