import { escapeHtml, formatDateTime } from "./formatting.js";
import { MAX_REFLECTION_LENGTH, countReflectionCharacters, SUMMARY_IDENTITY_LIMITS } from "./card-reflection.js";

export function renderCheckInCompletion(complete) {
  if (!complete) return "";
  return `<div class="checkin-completion" role="status" aria-live="polite" aria-atomic="true">
    <span class="checkin-completion-mark" aria-hidden="true">✓</span>
    <p>已完成所有打卡行程</p>
  </div>`;
}

// Views read the latest model, return HTML, and never persist data or request permissions.
export function createViews() {
  function renderSummaryEntry(complete) {
    return complete ? `<div class="summary-entry"><a class="button button-accent" href="#memories">前往旅途回憶準備 AI 融合圖片作品</a><p>五個景點須各選一張相片；缺相片時須先補拍。學校相片可額外加入第六張，並非必需。</p></div>` : "";
  }
  function viewHeading(eyebrow, title, description = "") {
    return `
      <header class="view-heading">
        <p class="eyebrow">${escapeHtml(eyebrow)}</p>
        <h1>${escapeHtml(title)}</h1>
        ${description ? `<p>${escapeHtml(description)}</p>` : ""}
      </header>`;
  }

  function checkInBadge(checkIn) {
    if (!checkIn) return `<span class="status-badge status-pending"><span aria-hidden="true">○</span> 未打卡</span>`;
    return `<span class="status-badge ${checkIn.verified ? "status-verified" : "status-manual"}">
      <span aria-hidden="true">${checkIn.verified ? "✓" : "◇"}</span>
      ${checkIn.verified ? "GPS 已核實" : "未核實手動記錄"}
    </span>`;
  }

  function renderPush(push = {}) {
    return `<section class="content-section push-section" aria-labelledby="push-heading">
      <div class="push-heading"><p class="eyebrow">旅程消息</p><h2 id="push-heading">手機通知</h2></div>
      <p>開啟後，老師發佈公告時可收到手機通知。App 不保留公告歷史列表。</p>
      <p>通知可顯示在鎖定畫面。iPhone 須先把 App 加入主畫面，再開啟通知。</p>
      <p>訂閱會向推送服務傳送此裝置的通知地址及加密金鑰，並不傳送相片、位置或打卡紀錄。為防止濫用，後台也會短暫保留連線識別資料。</p>
      <p id="push-status" class="push-status" role="status" aria-live="polite">${escapeHtml(push.statusMessage || "訊息通知暫未開放。")}</p>
      <div class="push-actions">
        <button id="push-enable" class="button button-primary" data-push-enable ${push.canEnable ? "" : "disabled"}>${push.subscribed && !push.serverRegistered ? "重試開啟通知" : "開啟手機通知"}</button>
        <button id="push-disable" class="button button-secondary" data-push-disable ${push.canDisable ? "" : "disabled"}>關閉通知</button>
      </div>
    </section>`;
  }

  function bookletLink(booklet, label, page = null, className = "text-link") {
    return `<a class="${className}" href="${escapeHtml(booklet.url)}${page ? `#page=${page}` : ""}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}<span class="sr-only">（PDF，另開分頁）</span> <span aria-hidden="true">↗</span></a>`;
  }

  function renderBooklet(booklet, learning) {
    if (!booklet) return "";
    return `<section class="content-section booklet-section" aria-labelledby="booklet-heading">
      <p class="eyebrow">隨身團刊</p><h2 id="booklet-heading">行程、課業，一處查閱</h2>
      <p>原版團刊 · ${booklet.pageCount} 頁 · ${escapeHtml(booklet.sizeLabel)}</p>
      <div class="booklet-actions">${bookletLink(booklet, "查看團刊 PDF", null, "button button-primary")}<a class="button button-secondary" href="${escapeHtml(booklet.url)}" download="${escapeHtml(booklet.filename)}">下載團刊 PDF</a></div>
      <p class="privacy-note">PDF 另開分頁。首次連線並完成離線快取後，可離線查看；也可先下載到裝置。頁碼捷徑是否生效視 PDF 閱讀器而定。</p>
      <nav class="booklet-shortcuts" aria-label="團刊章節">${booklet.sections.map(section => bookletLink(booklet, `${section.label}（第 ${section.printedPages} 頁）`, section.page)).join("")}</nav>
      ${learning ? `<details class="booklet-details"><summary>活動課業與反思重點</summary><ol class="learning-tasks">${learning.tasks.map(task => `<li><h3>${escapeHtml(task.title)}</h3><p>${escapeHtml(task.text)}</p></li>`).join("")}</ol>
        <p class="booklet-card-note">${escapeHtml(learning.cardNote)} <a class="text-link" href="#memories">前往旅途回憶</a></p>
        <h3>每天留下觀察與反思</h3><ul class="reflection-prompts">${learning.reflections.map(text => `<li>${escapeHtml(text)}</li>`).join("")}</ul>
        <p>${bookletLink(booklet, "查看完整課業（第 13–14 頁）", 14)} · ${bookletLink(booklet, "查看日記與反思（第 15–18 頁）", 16)}</p>
      </details>` : ""}
    </section>`;
  }

  function renderHotels(hotels, booklet) {
    if (!hotels?.length) return "";
    return `<section class="itinerary-hotels" aria-labelledby="hotels-heading"><p class="eyebrow">團刊所列住宿</p><h2 id="hotels-heading">酒店資料</h2><div class="hotel-grid">${hotels.map(hotel => `<article class="hotel-card"><h3>${escapeHtml(hotel.name)}</h3><p>${escapeHtml(hotel.address)}</p><p>酒店電話：<a class="text-link" href="tel:${escapeHtml(hotel.dial)}">${escapeHtml(hotel.phone)}</a></p></article>`).join("")}</div>${booklet ? `<p>${bookletLink(booklet, "查看團刊行程與住宿（第 1 頁）", 2)}</p>` : ""}</section>`;
  }

  function renderHome({ trip, booklet, learning, canInstall, install = { mode: "native", helpOpen: false }, push }) {

    return `
      <section class="hero-section">
        <div class="hero-grid">
          <div class="hero-copy">
            <p class="eyebrow">2026 戶外學習日</p>
            <h1>帶着好奇心<br />走進嶺南</h1>
            ${trip.dateLabel ? `<p class="trip-date">${escapeHtml(trip.dateLabel)} · ${escapeHtml(trip.duration)}</p>` : ""}
            <p>${escapeHtml(trip.title)}三天團，把校際交流、近代歷史、非遺飲食與嶺南建築連成一段旅程。</p>
            <div class="hero-actions" ${canInstall ? "" : "hidden"}>
              <button id="install-button" type="button" class="button button-ghost" ${canInstall ? "" : "hidden"} ${install.mode === "ios" ? `aria-expanded="${install.helpOpen}" aria-controls="ios-install-guide"` : ""}>${install.mode === "ios" ? "iPhone／iPad 安裝方法" : "安裝 App"}</button>
            </div>
            ${install.mode === "ios" ? `<section id="ios-install-guide" class="install-guide" aria-labelledby="ios-install-title" ${install.helpOpen ? "" : "hidden"}>
              <h2 id="ios-install-title">加入 iPhone／iPad 主畫面</h2>
              <ol>
                <li>用 Safari 開啟此網站。若從 WhatsApp 等 App 開啟，請先把網址複製到 Safari。</li>
                <li>按 Safari 的「分享」按鈕（正方形向上箭嘴）；部分版面須先按「頁面選單」，再按「分享」。</li>
                <li>向下捲動分享選項，選擇「加至主畫面」（部分版本顯示「加入主畫面」）。</li>
                <li>如有「開啟為網頁 App」選項，保持開啟，再按「加入」。</li>
                <li>返回手機主畫面，按新圖示開啟 App。</li>
              </ol>
              <p>如找不到「加至主畫面」，到分享列表底部按「編輯動作」，把它加入。</p>
            </section>` : ""}
          </div>
        </div>
      </section>

      ${renderBooklet(booklet, learning)}

      ${renderPush(push)}

      <section class="content-section privacy-banner">
        <div class="privacy-icon" aria-hidden="true">◎</div>
        <div><p class="eyebrow">旅程資料留在你的裝置</p><h2>位置與相片不會上傳</h2><p>GPS 只在你按下打卡時使用一次；照片會移除位置資料並保存在本機。</p></div>
      </section>

      <section class="content-section data-control-section">
        <div><p class="eyebrow">私隱與本機資料</p><h2>你掌握自己的旅程紀錄</h2><p>打卡紀錄存在瀏覽器；相片另存在 IndexedDB。清除後無法復原。通知訂閱由上方的「關閉通知」另行管理。</p></div>
        <button class="button button-danger" data-reset-all>清除所有本機旅程資料</button>
      </section>`;
  }

  function renderItinerary({ days, checkIns, allCheckInsComplete, booklet, hotels }) {
    return `
      <section class="page-shell">
        ${viewHeading("三天兩夜", "沿着路線學習")}
        ${booklet ? `<p class="itinerary-booklet">${bookletLink(booklet, "查看團刊行程（第 1 頁）", 2)}</p>` : ""}
        ${renderCheckInCompletion(allCheckInsComplete)}
        ${renderSummaryEntry(allCheckInsComplete)}
        <div class="itinerary-list">
          ${days.map((day) => `
            <article class="day-panel">
              <div class="day-marker"><span>DAY</span><strong>${day.day}</strong></div>
              <div class="day-content">
                <div class="day-heading"><div><time>${escapeHtml(day.date)}</time><h2>${escapeHtml(day.theme)}</h2></div><span>${day.route.length} 個節點</span></div>
                <p>${escapeHtml(day.summary)}</p>
                <ol class="route-line">
                  ${day.route.map((stop) => {
                    return `<li>${stop.attractionId ? `<a href="#attraction/${stop.attractionId}">${escapeHtml(stop.label)}</a>${checkInBadge(checkIns[stop.attractionId])}` : `<span>${escapeHtml(stop.label)}</span>`}</li>`;
                  }).join("")}
                </ol>
              </div>
            </article>`).join("")}
        </div>
        ${renderHotels(hotels, booklet)}
      </section>`;
  }

  function photoPanel({ attraction, checkIn, photos = [] }) {
    if (!checkIn) return `<section class="photo-panel photo-locked"><span aria-hidden="true">▧</span><div><h2>紀念相片</h2><p>完成景點打卡後即可拍攝相片。</p></div></section>`;
    return `
      <section class="photo-panel">
        <div><p class="eyebrow">只存在裝置</p><h2>${photos.length ? `已保存 ${photos.length} 張相片` : "留下旅程紀念照"}</h2>
          <p>打卡後拍攝的相片會自動加入「旅途回憶」。新增相片會保留之前的照片；不影相亦不影響打卡。</p>
          <p class="privacy-note">相片會縮小及移除 EXIF 位置資料；人樣、校服及背景仍可能透露身份，請避免拍攝敏感內容。</p>
          <p class="privacy-note">支援靜態 JPEG、PNG、WebP；HEIC／HEIF 請先轉成 JPEG。每張最多 20MB、寬高 8192px、5000 萬像素；超限請先縮小。</p>
        </div>
        <div class="photo-actions">
          <button class="button button-primary" data-native-camera-open="${attraction.id}">用手機相機拍攝</button>
          <button class="button button-secondary" data-camera-open="${attraction.id}">使用網頁相機</button>
          <a class="button button-accent" href="#memories">查看旅途回憶</a>
        </div>
      </section>`;
  }

  function summaryProgress(card) {
    return card.readState === "ready" ? `<div class="summary-progress" role="status" aria-live="polite"><p>已有相片的景點：${card.photoStationCount}／${card.requiredCount}（必需）</p><p>已選取：${card.requiredSelectedCount}／${card.requiredCount}（必需）</p><p>學校相片：${card.stations.some(item => !item.required && item.selectedPhotoId) ? "已加入（選填）" : "未加入（選填）"}</p></div>` : `<p role="status">${card.readState === "loading" ? "正在讀取相片，請稍候。" : "暫時未能讀取相片，無法確認哪些景點需要補拍。請重新讀取相片。"}</p>`;
  }
  function summaryMissing(card) {
    if (card.readState !== "ready") return "";
    const missing = card.stations.filter(item => item.required && !item.photoCount);
    return missing.length ? `<p class="summary-warning">已完成五個景點打卡，仍欠 ${missing.length} 個景點的相片。每個必需景點須有一張相片，請先補拍，才能準備完整的 AI 融合圖片素材包。</p><ul class="summary-missing">${missing.map(item => `<li><span>${escapeHtml(item.attraction.name)}</span><a class="text-link" href="#attraction/${escapeHtml(item.attraction.id)}">返回景點補拍<span class="sr-only">：${escapeHtml(item.attraction.name)}</span></a></li>`).join("")}</ul>` : "";
  }
  function renderSummaryStatus(card) {
    if (!card) return "";
    return `<section class="summary-card-builder summary-compact" aria-labelledby="summary-card-heading"><h2 id="summary-card-heading">AI 融合圖片作品</h2><p>五個景點各選一張；學校相片可額外加入第六張，並非必需。下載相片及生成指令，再到你使用的 AI 工具完成作品。</p>${summaryProgress(card)}${summaryMissing(card)}<button id="memory-summary-open" class="button button-accent" data-memory-summary-open ${card.readState === "ready" ? "" : "disabled"}>準備 AI 融合圖片作品</button></section>`;
  }
  function renderSummaryRequirements(card) {
    const pending = card.stations.filter(item => item.required && !item.selectedPhotoId);
    return `${card.readState === "ready" ? pending.length ? `<p>尚未選齊五個必需景點：</p><ul>${pending.map(item => `<li>${escapeHtml(item.attraction.name)}：${item.photoCount ? "請選取一張相片" : "尚未拍照，請先補拍"}</li>`).join("")}</ul>` : `<p>已選齊五個必需景點，共 ${card.selectedCount} 張相片。</p>` : "相片讀取完成後，才能選取並下載。"}${card.missingIdentity?.length ? `<p>請填寫${card.missingIdentity.map(escapeHtml).join("、")}，才能下載素材包。</p>` : ""}${card.canDownload ? `<p>資料已齊全，可以下載 ZIP 素材包。這是相片與指令，融合圖片須在 AI 工具完成。</p>` : ""}`;
  }
  function renderSummaryCard(card) {
    if (!card) return "";
    const ready = card.readState === "ready";
    const stations = [...card.stations.filter(item => item.required), ...card.stations.filter(item => !item.required)];
    return `<section class="summary-editor"><p>每個必需景點選一張相片；學校可加第六張。團刊要求相片具有當地特色，並包含自己或同學。素材包包含完整 JPEG 相片及生成指令；下載後解壓 ZIP，再交給支援多張參考相片的 AI 工具製作融合圖片。</p>${summaryProgress(card)}${summaryMissing(card)}
      <div class="summary-slots">${stations.map((station, index) => `<section class="summary-slot" aria-label="${escapeHtml(station.attraction.name)}${station.required ? "" : "（選填）"}"><h3>${station.required ? `${index + 1}.` : "選填："} ${escapeHtml(station.attraction.name)}</h3>
        ${station.selectedPhoto?.url ? `<img src="${escapeHtml(station.selectedPhoto.url)}" alt="已選取的${escapeHtml(station.attraction.name)}相片" />` : `<div class="summary-slot-empty">${station.selectedPhotoId ? "暫時未能顯示預覽" : station.required ? "尚未選取" : "不加入學校相片"}</div>`}
        <button id="memory-pick-${escapeHtml(station.attraction.id)}" class="button button-secondary" data-memory-pick="${escapeHtml(station.attraction.id)}" ${!ready || !station.photoCount || card.busy ? "disabled" : ""}>${station.selectedPhotoId ? "更換相片" : "選取相片"}</button>
        ${!station.required && station.selectedPhotoId ? `<button class="text-link" id="memory-omit-school" data-memory-summary-omit="departure-school" ${card.busy ? "disabled" : ""}>移除學校相片</button>` : ""}
        ${ready && !station.photoCount ? `<p>${station.required ? "尚未拍照，請先補拍。" : "學校相片為選填，不影響下載素材包。"}</p>${!station.required ? `<a class="text-link" href="#attraction/${escapeHtml(station.attraction.id)}">前往學校打卡拍照（選填）</a>` : ""}` : ""}</section>`).join("")}</div>
      <div class="summary-identity">${[["studentName", "姓名"], ["className", "班別"], ["studentNumber", "學號"]].map(([field, label]) => `<div><label for="summary-${field}">${label}（必填）</label><input id="summary-${field}" type="text" required data-summary-field="${field}" value="${escapeHtml(card[field] || "")}" autocomplete="off" aria-describedby="summary-${field}-hint summary-draft-note" ${card.busy ? "disabled" : ""} /><p id="summary-${field}-hint">${Array.from(card[field] || "").length}／${SUMMARY_IDENTITY_LIMITS[field]} 字</p></div>`).join("")}</div>
      <p id="summary-draft-note" class="privacy-note">姓名、班別、學號必填，會加入生成指令，要求 AI 在作品上顯示。網站不儲存或上傳這些資料；你把素材交給 AI 工具時，該工具會收到。關閉視窗保留草稿；離開旅途回憶或重載後，填寫內容及選取會清除。</p>
      <div id="summary-requirements" class="summary-requirements" aria-live="polite">${renderSummaryRequirements(card)}</div>
      <button id="summary-download" class="button button-accent" data-summary-download aria-describedby="summary-requirements" ${card.canDownload ? "" : "disabled"}>${card.busy ? "正在準備…" : `下載 AI 素材包 ZIP${card.canDownload ? `（${card.selectedCount} 張）` : ""}`}</button></section>`;
  }
  function renderMemories({ albums, photoCount, selectedCount, readState, summaryCard }) {
    return `<section class="page-shell memories-page">${viewHeading("把沿途的片刻留下", "旅途回憶")}
      ${readState === "ready" ? `<section class="memory-toolbar" aria-label="相片下載"><p role="status">共 ${photoCount} 張相片 · 全旅程已選 ${selectedCount} 張</p><div class="photo-actions"><button id="memory-download-all" class="button button-primary" data-memory-download-all ${photoCount ? "" : "disabled"}>下載全部</button><button id="memory-download-selected" id="memory-download-selected-album" class="button button-secondary" data-photo-export-selected="memories" ${selectedCount ? "" : "disabled"}>下載已選（${selectedCount} 張）</button>${selectedCount ? `<button id="memory-clear-selected" class="text-link" data-photo-select-none="memories">清除全部勾選</button>` : ""}</div></section>` : `<section class="memory-empty"><h2>${readState === "loading" ? "正在讀取相片" : "暫時未能讀取相片"}</h2><p role="status">${readState === "loading" ? "請稍候，讀取完成後便可查看回憶。" : "請重試；這不代表已保存的相片被刪除。"}</p>${readState === "error" ? `<button class="button button-primary" data-photos-retry>重新讀取相片</button>` : ""}</section>`}
      ${readState === "ready" ? photoCount ? `<div class="memory-albums">${albums.map(album => `<button id="memory-album-${escapeHtml(album.attraction.id)}" class="memory-album" data-memory-album="${escapeHtml(album.attraction.id)}" aria-label="開啟${escapeHtml(album.attraction.name)}相簿，${album.photoCount} 張相片">${album.cover?.url ? `<img src="${escapeHtml(album.cover.url)}" alt="${escapeHtml(album.attraction.name)}相簿封面" loading="lazy" />` : `<span class="memory-cover-empty" aria-hidden="true">▧</span>`}<span class="memory-album-copy"><strong>${escapeHtml(album.attraction.name)}</strong><span>${album.photoCount} 張相片${album.selectedCount ? ` · 已選 ${album.selectedCount} 張` : ""}</span></span></button>`).join("")}</div>` : `<section class="memory-empty"><span aria-hidden="true">▧</span><h2>第一段回憶，從一張相片開始</h2><p>到景點打卡後拍攝，相片便會集中在這裏。</p><a class="button button-primary" href="#itinerary">前往行程</a></section>` : ""}
      ${renderSummaryStatus(summaryCard)}
      <details class="memory-privacy"><summary>相片及私隱說明</summary><p>相片只保存在這部裝置，未上傳或加入手機相簿。相片已縮小並移除 EXIF，但人樣、校服及背景仍可能透露身份。取消景點打卡會刪除該站全部相片；已下載或分享的檔案不受 App 清除資料功能控制。</p></details></section>`;
  }
  function reflectionField(photo) {
    const hint = `card-reflection-hint-${escapeHtml(photo.photoId)}`;
    return `<div class="card-reflection-field"><label for="memory-reflection">感想文字（選填）</label><textarea id="memory-reflection" rows="3" data-card-reflection="${escapeHtml(photo.photoId)}" aria-describedby="${hint}" placeholder="例如：今天最深刻的是……">${escapeHtml(photo.reflection || "")}</textarea><p class="privacy-note" id="${hint}">${countReflectionCharacters(photo.reflection)} / ${MAX_REFLECTION_LENGTH} 字。留空不加入感想；只留在目前頁面，離開或重新載入後會清除。</p></div>`;
  }
  function renderMemoryOverlay(model) {
    const { mode, attraction, busy } = model;
    const title = mode === "summary" ? "準備 AI 融合圖片作品" : mode === "picker" ? `選取${attraction.name}相片` : attraction?.name || "旅途回憶";
    let body = "", footer = "";
    if (model.readState !== "ready") body = `<p role="status">${model.readState === "loading" ? "正在讀取相片…" : "暫時未能讀取相片，請重試。"}</p>${model.readState === "error" ? `<button class="button button-primary" data-photos-retry>重新讀取相片</button>` : ""}`;
    else if (mode === "summary") body = renderSummaryCard(model.summaryCard);
    else if (mode === "album" || mode === "picker") {
      body = `<p>${model.photoCount} 張相片${mode === "album" ? ` · 全旅程已選 ${model.selectedCount} 張` : " · 每個景點只選一張"}</p><div class="memory-thumbnails">${model.photos.map((photo, index) => mode === "picker" ? `<label class="memory-thumbnail memory-picker" for="summary-photo-${escapeHtml(attraction.id)}-${index}">${photo.url ? `<img src="${escapeHtml(photo.url)}" alt="${escapeHtml(attraction.name)}第 ${model.page * 12 + index + 1} 張相片" />` : `<span>預覽未能顯示</span>`}<span><input type="radio" id="summary-photo-${escapeHtml(attraction.id)}-${index}" name="summary-${escapeHtml(attraction.id)}" data-summary-select="${escapeHtml(attraction.id)}" data-summary-photo-id="${escapeHtml(photo.photoId)}" ${photo.summarySelected ? "checked" : ""} />選取第 ${model.page * 12 + index + 1} 張</span></label>` : `<article class="memory-thumbnail"><button id="memory-photo-${escapeHtml(photo.photoId)}" class="memory-thumbnail-open" data-memory-photo="${escapeHtml(photo.photoId)}" aria-label="查看第 ${model.page * 12 + index + 1} 張相片">${photo.url ? `<img src="${escapeHtml(photo.url)}" alt="${escapeHtml(attraction.name)}第 ${model.page * 12 + index + 1} 張相片" />` : `<span>預覽未能顯示</span>`}</button><label for="memory-select-${escapeHtml(photo.photoId)}"><input id="memory-select-${escapeHtml(photo.photoId)}" type="checkbox" data-photo-select="${escapeHtml(photo.photoId)}" ${photo.selected ? "checked" : ""} />第 ${model.page * 12 + index + 1} 張</label></article>`).join("")}</div>`;
      footer = `<div class="memory-pagination"><button class="button button-secondary button-small" id="memory-prev-page" data-memory-page="${model.page - 1}" ${model.page === 0 ? "disabled" : ""}>上一頁</button><p role="status">第 ${model.page + 1}／${model.pageCount} 頁</p><button class="button button-secondary button-small" id="memory-next-page" data-memory-page="${model.page + 1}" ${model.page + 1 === model.pageCount ? "disabled" : ""}>下一頁</button></div>${mode === "album" ? `<div class="memory-album-actions"><button class="text-link" id="memory-album-selection" data-memory-album-select="${model.albumSelectedCount === model.photoCount ? "none" : "all"}">${model.albumSelectedCount === model.photoCount ? "清除此相簿勾選" : "全選此相簿"}</button><button class="button button-primary" id="memory-download-album" data-memory-download-album>下載此相簿</button><button id="memory-download-selected-album" class="button button-secondary" data-photo-export-selected="memories" ${model.selectedCount ? "" : "disabled"}>下載已選（全旅程 ${model.selectedCount} 張）</button></div>` : ""}`;
    } else if (model.photo) {
      const photo = model.photo;
      body = `${photo.url ? `<img class="memory-full-photo" src="${escapeHtml(photo.url)}" alt="${escapeHtml(attraction.name)}的完整相片" />` : `<p>暫時未能顯示預覽。</p>`}<p>第 ${model.photoIndex + 1}／${model.photoCount} 張 · ${escapeHtml(photo.width)} × ${escapeHtml(photo.height)}</p><p>${formatDateTime(model.checkIn.checkedInAt)} ${checkInBadge(model.checkIn)}</p><div class="photo-actions"><button class="button button-primary" id="memory-download-photo" data-memory-download-photo ${busy ? "disabled" : ""}>下載此相片</button><button class="button button-secondary" id="memory-card-toggle" data-memory-card-toggle ${busy ? "disabled" : ""} aria-expanded="${model.cardOpen}">${model.cardOpen ? "收起單張旅程卡" : "製作單張旅程卡"}</button></div>${model.cardOpen ? `${reflectionField(photo)}<p class="privacy-note">感想、相片、景點及打卡時間會印在卡上，分享前請留意個人資料。</p><button class="button button-accent" id="memory-download-card" data-card-download="${escapeHtml(attraction.id)}" data-photo-id="${escapeHtml(photo.photoId)}" ${busy ? "disabled" : ""}>${busy ? "正在製作…" : "下載旅程卡"}</button>` : ""}`;
      footer = `<div class="memory-pagination"><button class="button button-secondary" id="memory-prev-photo" data-memory-photo-step="previous" ${model.previousPhotoId ? "" : "disabled"}>上一張</button><button class="button button-secondary" id="memory-next-photo" data-memory-photo-step="next" ${model.nextPhotoId ? "" : "disabled"}>下一張</button></div>`;
    }
    return `<div class="memory-dialog-heading"><div>${model.depth > 1 ? `<button id="memory-back" class="text-link" data-memory-back>← 返回</button>` : ""}<h2 id="memory-title" tabindex="-1">${escapeHtml(title)}</h2></div><button id="memory-close" class="icon-button" data-memory-close aria-label="關閉旅途回憶視窗">×</button></div><div id="memory-body" class="memory-dialog-body">${body}</div>${footer ? `<footer class="memory-dialog-footer">${footer}</footer>` : ""}`;
  }

  function renderAttraction(model) {
    const { attraction, checkIn } = model;
    const checkInAction = checkIn
      ? `<div class="checked-in-panel">
           <div class="stamp-mark ${checkIn.verified ? "verified" : "manual"}" aria-hidden="true">${checkIn.verified ? "已到埗" : "已記錄"}</div>
           <div><p class="eyebrow">${checkIn.verified ? "GPS 已核實" : "未核實手動記錄"}</p><h2>${formatDateTime(checkIn.checkedInAt)}</h2><p>這是個人旅程記錄，不作校方出席證明。</p></div>
           <button class="button button-secondary button-small" data-checkin-undo="${attraction.id}">取消打卡</button>
         </div>`
      : `<div class="checkin-panel">
           <div><p class="eyebrow">到達後使用</p><h2>在景點附近打卡</h2><p>只會讀取一次位置作距離核對，不保存你的座標。</p></div>
           <button class="button button-accent" data-checkin="${attraction.id}"><span aria-hidden="true">⌖</span> 到埗打卡</button>
         </div>`;

    return `
      <article class="attraction-detail">
        <div class="detail-hero${attraction.id === "departure-school" ? " school-hero" : ""}">
          ${attraction.image ? `<img src="${escapeHtml(attraction.image)}" alt="${escapeHtml(attraction.alt)}" width="1200" height="800" />` : ""}
          <div class="detail-hero-overlay">
            <a href="#itinerary" class="back-link">← 返回行程</a>
            <div><p class="eyebrow">第 ${attraction.day} 日 · ${escapeHtml(attraction.city)}</p><h1>${escapeHtml(attraction.name)}</h1><p>${escapeHtml(attraction.address)}</p></div>
          </div>
        </div>
        <div class="detail-content">
          ${attraction.imageCredit ? `<p class="image-credit">校舍照片：<a href="${escapeHtml(attraction.imageCredit.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(attraction.imageCredit.author)}（${escapeHtml(attraction.imageCredit.year)}）／Wikimedia Commons</a> · <a href="${escapeHtml(attraction.imageCredit.licenseUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(attraction.imageCredit.license)}</a> · 按版面裁切顯示</p>` : ""}
          ${attraction.intro ? `<section class="story-panel">
            <div class="story-main"><p class="eyebrow">景點簡介</p><p class="lead-paragraph">${escapeHtml(attraction.intro)}</p></div>
          </section>` : ""}
          <div class="learning-grid">
            <section><span class="learning-number">01</span><p class="eyebrow">現場觀察</p><h2>${escapeHtml(attraction.observe)}</h2></section>
            <section><span class="learning-number">02</span><p class="eyebrow">學習提示</p><h2>${escapeHtml(attraction.prompt)}</h2></section>
          </div>
          <p class="source-link">資料來源：<a href="${escapeHtml(attraction.source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(attraction.source.label)} <span aria-hidden="true">↗</span></a> · <a href="${escapeHtml(attraction.mapUrl || attraction.geo.sourceUrl)}" target="_blank" rel="noopener noreferrer">${attraction.mapUrl ? "在 Google Maps 查看地點" : "位置資料"} <span aria-hidden="true">↗</span></a></p>
          ${attraction.bookletPage && model.booklet ? `<p class="source-link">${bookletLink(model.booklet, `團刊學習資料（第 ${attraction.bookletPage.printedPages} 頁）`, attraction.bookletPage.page)}</p>` : ""}
          ${checkInAction}
          ${renderCheckInCompletion(model.allCheckInsComplete)}
          ${renderSummaryEntry(model.allCheckInsComplete)}
          ${photoPanel(model)}
        </div>
      </article>`;
  }

  function renderCompactExport(model, { page = 0, moreOpen = false } = {}) {
    const ready = model.status === "ready", pages = Math.max(1, Math.ceil(model.files.length / 12));
    page = Math.max(0, Math.min(page, pages - 1));
    return `<p id="photo-export-status" role="status" aria-live="polite" tabindex="-1" ${model.delivery ? `aria-describedby="photo-export-location"` : ""}>${escapeHtml(model.message)}</p>
      ${ready ? `<button class="button button-primary export-primary" data-photo-export-download-all>${model.count === 1 ? "下載 JPEG" : `下載 ZIP（${model.count} 張）`}</button><p>${model.count === 1 ? "下載一張 JPEG 相片。" : "相片會合成一個 ZIP 檔；下載後請先解壓，再把 JPEG 加入相簿。"}</p>` : ""}
      ${model.status === "error" ? `<button class="button button-primary" id="export-retry" data-export-retry>重新準備</button>` : ""}
      ${model.delivery ? `<section id="photo-export-location" class="photo-export-notice" aria-label="下載與儲存位置"><h3>${model.delivery.kind === "download" ? "下載檔案的位置" : "分享後的儲存位置"}</h3>${model.delivery.filename ? `<p class="download-filename">${escapeHtml(model.delivery.filename)}</p>` : ""}<p>${escapeHtml(model.delivery.locationHint)}</p><p>${model.delivery.kind === "download" ? "請在瀏覽器下載列表確認是否完成；檔案不一定直接加入相簿。" : "分享結束不代表已儲存，請自行確認。"}</p></section>` : ""}
      <p class="privacy-note">相片仍可能透露身份，請留意是否適合保存及分享。App 內相片會保留。</p>
      ${model.canShare || model.status === "sharing" ? `<button class="button button-secondary" data-photo-export-share ${ready ? "" : "disabled"}>手機分享</button>` : ""}
      ${model.files.length ? `<button class="text-link" id="export-more" data-export-more aria-expanded="${moreOpen}">更多選項</button>${moreOpen ? `<ul class="photo-export-files">${model.files.slice(page * 12, page * 12 + 12).map(file => `<li><span>${escapeHtml(file.name)}</span><button class="button button-secondary" data-photo-export-download="${file.index}" ${ready ? "" : "disabled"}>下載第 ${file.index + 1} 張</button></li>`).join("")}</ul><div class="memory-pagination"><button class="button button-secondary button-small" id="export-prev-page" data-export-page="${page - 1}" ${page === 0 ? "disabled" : ""}>上一頁</button><p>第 ${page + 1}／${pages} 頁</p><button class="button button-secondary button-small" id="export-next-page" data-export-page="${page + 1}" ${page + 1 === pages ? "disabled" : ""}>下一頁</button></div>` : ""}` : ""}`;
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
  return { renderHome, renderItinerary, renderAttraction, renderMemories, renderMemoryOverlay, renderSummaryRequirements, photoPanel, renderPhotoExport };
}
