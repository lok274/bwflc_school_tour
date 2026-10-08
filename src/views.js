import { escapeHtml, formatDateTime } from "./formatting.js";

// Views read the latest model, return HTML, and never persist data or request permissions.
export function createViews() {
  function progressRing(percent, label) {
    const radius = 42;
    const circumference = Math.PI * 2 * radius;
    const offset = circumference - (percent / 100) * circumference;
    return `
      <div class="progress-ring" aria-label="${escapeHtml(label)} ${percent}%">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle class="progress-ring-track" cx="50" cy="50" r="${radius}"></circle>
          <circle class="progress-ring-value" cx="50" cy="50" r="${radius}" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"></circle>
        </svg>
        <strong>${percent}%</strong>
      </div>`;
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
      ${checkIn.verified ? "GPS 已核實" : "手動記錄"}
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
        <button id="push-test" class="button button-secondary" data-push-test ${push.canTest ? "" : "disabled"}>發送一則測試通知給自己</button>
      </div>
    </section>`;
  }

  function renderHome({ trip, canInstall, push }) {

    return `
      <section class="hero-section">
        <div class="hero-grid">
          <div class="hero-copy">
            <p class="eyebrow">2026 戶外學習日</p>
            <h1>帶着好奇心<br />走進嶺南</h1>
            <p>${escapeHtml(trip.title)}三天團，把校際交流、近代歷史、非遺飲食與嶺南建築連成一段旅程。</p>
            <div class="hero-actions" ${canInstall ? "" : "hidden"}>
              <button id="install-button" class="button button-ghost" ${canInstall ? "" : "hidden"}>安裝 App</button>
            </div>
          </div>
        </div>
      </section>

      ${renderPush(push)}

      <section class="content-section privacy-banner">
        <div class="privacy-icon" aria-hidden="true">◎</div>
        <div><p class="eyebrow">旅程資料留在你的裝置</p><h2>位置與相片不會上傳</h2><p>GPS 只在你按下打卡時使用一次；照片會移除位置資料並保存在本機。</p></div>
      </section>

      <section class="content-section data-control-section">
        <div><p class="eyebrow">私隱與本機資料</p><h2>你掌握自己的旅程紀錄</h2><p>清單和打卡存在瀏覽器；相片另存在 IndexedDB。清除後無法復原。通知訂閱由上方的「關閉通知」另行管理。</p></div>
        <button class="button button-danger" data-reset-all>清除所有本機旅程資料</button>
      </section>`;
  }

  function renderItinerary({ days, checkIns }) {
    return `
      <section class="page-shell">
        ${viewHeading("三天兩夜", "沿着路線學習", "行程或會按實際情況微調，請以校方最新通知為準。")}
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
      </section>`;
  }

  function photoPanel({ attraction, checkIn, photo, photos = photo ? [photo] : [] }) {
    const inputNote = `<p class="privacy-note">支援靜態 JPEG、PNG、WebP；HEIC／HEIF 請先轉成 JPEG。每張最多 20MB、寬高 8192px、5000 萬像素；超限請先縮小。</p>`;
    if (!checkIn) {
      return `<section class="photo-panel photo-locked"><span aria-hidden="true">▧</span><div><h2>紀念相片</h2><p>完成景點打卡後即可影相或從相簿加入多張照片。</p></div></section>`;
    }
    if (!photos.length) {
      return `
        <section class="photo-panel">
          <div><p class="eyebrow">只存在裝置</p><h2>留下旅程紀念照</h2><p>可以連續拍攝或從相簿一次加入多張相片。相片會縮小、重新編碼並移除 EXIF 位置資料；不影相亦不影響打卡。照片中的人樣、校服及背景仍可能透露身份，請避免拍攝敏感內容。</p>${inputNote}</div>
          <div class="photo-actions">
            <button class="button button-primary" data-native-camera-open="${attraction.id}">用手機相機拍攝</button>
            <button class="button button-secondary" data-camera-open="${attraction.id}">使用網頁相機</button>
            <button class="button button-secondary" data-gallery-open="${attraction.id}">從相簿選取</button>
          </div>
        </section>`;
    }
    return `
      <section class="photo-panel">
        <div><p class="eyebrow">本機紀念照</p><h2>已保存 ${photos.length} 張相片</h2><p>新增相片會保留之前的照片。可儲存到手機、逐張刪除或製作旅程卡。</p><p class="privacy-note">App 內保存不等於手機相簿。儲存到手機時需自行選擇儲存位置。</p>${inputNote}</div>
        <div class="photo-actions">
          <button class="button button-primary" data-native-camera-open="${attraction.id}">用手機相機拍攝</button>
          <button class="button button-secondary" data-camera-open="${attraction.id}">使用網頁相機</button>
          <button class="button button-secondary" data-gallery-open="${attraction.id}">從相簿加入相片</button>
        </div>
      </section>
      <section class="photo-selection" aria-label="選取相片匯出">
        <p role="status">已選取 ${photos.filter(photo => photo.selected).length} / ${photos.length} 張相片</p>
        <div class="photo-actions">
          <button class="button button-secondary" data-photo-select-all="${attraction.id}">選取全部</button>
          <button class="button button-secondary" data-photo-select-none="${attraction.id}" ${photos.some(photo => photo.selected) ? "" : "disabled"}>取消選取</button>
          <button class="button button-primary" data-photo-export-selected="${attraction.id}" ${photos.some(photo => photo.selected) ? "" : "disabled"}>匯出已選相片</button>
        </div>
      </section>
      ${photos.map((photo, index) => `
      <section class="photo-panel has-photo">
        ${photo.url ? `<img src="${escapeHtml(photo.url)}" alt="你在${escapeHtml(attraction.name)}保存的第 ${index + 1} 張紀念照" loading="lazy" />` : `<p>暫時未能顯示相片預覽。</p>`}
        <div class="photo-panel-copy">
          <p class="eyebrow">第 ${index + 1} 張紀念照</p><h2>製作你的旅程卡</h2>
          <label class="photo-select-label"><input type="checkbox" data-photo-select="${escapeHtml(photo.photoId || "")}" ${photo.selected ? "checked" : ""} /> 選取第 ${index + 1} 張相片</label>
          <p>已壓縮為 ${escapeHtml(photo.width)} × ${escapeHtml(photo.height)}，原始拍攝資料不會保留。</p>
          <p class="privacy-note">旅程卡包含照片、景點及打卡時間。移除 EXIF 不等於匿名化；分享前請留意人樣、校服及背景。</p>
          <div class="photo-actions">
            <button class="button button-primary" data-photo-export="${attraction.id}" data-photo-id="${escapeHtml(photo.photoId || "")}">儲存到手機</button>
            <button class="button button-accent" data-card-download="${attraction.id}" data-photo-id="${escapeHtml(photo.photoId || "")}">下載旅程卡</button>
            <button class="text-danger" data-photo-delete="${attraction.id}" data-photo-id="${escapeHtml(photo.photoId || "")}">刪除這張相片</button>
          </div>
        </div>
      </section>`).join("")}`;
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
        <div class="detail-hero">
          <img src="${attraction.image}" alt="${escapeHtml(attraction.alt)}" width="1200" height="800" />
          <div class="detail-hero-overlay">
            <a href="#itinerary" class="back-link">← 返回行程</a>
            <div><p class="eyebrow">第 ${attraction.day} 日 · ${escapeHtml(attraction.city)}</p><h1>${escapeHtml(attraction.name)}</h1><p>${escapeHtml(attraction.address)}</p></div>
          </div>
        </div>
        <div class="detail-content">
          <section class="story-panel">
            <div class="story-main"><p class="eyebrow">景點簡介</p><p class="lead-paragraph">${escapeHtml(attraction.intro)}</p></div>
          </section>
          <div class="learning-grid">
            <section><span class="learning-number">01</span><p class="eyebrow">現場觀察</p><h2>${escapeHtml(attraction.observe)}</h2></section>
            <section><span class="learning-number">02</span><p class="eyebrow">學習提示</p><h2>${escapeHtml(attraction.prompt)}</h2></section>
          </div>
          <p class="source-link">資料來源：<a href="${attraction.source.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(attraction.source.label)} <span aria-hidden="true">↗</span></a> · <a href="${attraction.geo.sourceUrl}" target="_blank" rel="noopener noreferrer">位置資料 <span aria-hidden="true">↗</span></a></p>
          ${checkInAction}
          ${photoPanel(model)}
        </div>
      </article>`;
  }

  function renderPrepare({ items, checklist, customItems, progress }) {
    const groups = [...new Set(items.map((item) => item.group))];
    return `
      <section class="page-shell">
        ${viewHeading("出發準備", "一項一項 安心出發", "清單狀態只儲存在這部裝置；你也可以加入自己的提醒。")}
        <div class="checklist-summary">
          ${progressRing(progress.percent, "準備完成進度")}
          <div><strong>${progress.done} / ${progress.total}</strong><span>項已完成</span></div>
        </div>
        <div class="checklist-groups">
          ${groups.map((group) => `
            <section class="checklist-group">
              <h2>${escapeHtml(group)}</h2>
              ${items.filter((item) => item.group === group).map((item) => `
                <label class="check-row ${checklist[item.id] ? "is-done" : ""}">
                  <input type="checkbox" data-check-item="${item.id}" ${checklist[item.id] ? "checked" : ""} />
                  <span class="custom-checkbox" aria-hidden="true"></span>
                  <span>${escapeHtml(item.label)}</span>
                </label>`).join("")}
            </section>`).join("")}
          <section class="checklist-group custom-checklist">
            <h2>我的提醒</h2>
            ${customItems.length ? customItems.map((item) => `
              <div class="custom-check-row ${item.done ? "is-done" : ""}">
                <label class="check-row">
                  <input type="checkbox" data-custom-check="${escapeHtml(item.id)}" ${item.done ? "checked" : ""} />
                  <span class="custom-checkbox" aria-hidden="true"></span>
                  <span>${escapeHtml(item.label)}</span>
                </label>
                <button data-custom-delete="${escapeHtml(item.id)}" aria-label="刪除提醒：${escapeHtml(item.label)}">×</button>
              </div>`).join("") : `<p class="empty-note">還未加入個人提醒。</p>`}
            <form id="custom-item-form" class="add-item-form">
              <label for="custom-item-input">新增提醒</label>
              <div><input id="custom-item-input" name="label" maxlength="120" required placeholder="例如：準備充電器" /><button class="button button-primary" type="submit">加入</button></div>
            </form>
          </section>
        </div>
      </section>`;
  }

  function renderPhotoExport(model) {
    const ready = model.status === "ready";
    return `
      <p id="photo-export-status" role="status" aria-live="polite">${escapeHtml(model.message)}</p>
      <p>相片中的人樣、校服及背景仍可能透露身份，請確認適合儲存或分享。App 內的相片副本會保留；清除 App 資料不會刪除已匯出的相片。</p>
      ${model.canShare || model.status === "sharing" ? `<button class="button button-primary" data-photo-export-share ${ready ? "" : "disabled"}>開啟手機分享選單</button>` : ready ? `<p>此瀏覽器不支援分享這組檔案，請逐張下載。</p>` : ""}
      ${model.files.length ? `<p>如果手機分享選單沒有儲存到相簿的選項，可用以下按鈕逐張下載。檔案可能存於「下載」或「檔案」，不一定直接進入相簿。</p>
        <ul class="photo-export-files">${model.files.map(file => `<li><span>${escapeHtml(file.name)}</span><button class="button button-secondary" data-photo-export-download="${file.index}" ${ready ? "" : "disabled"}>下載第 ${file.index + 1} 張</button></li>`).join("")}</ul>` : ""}`;
  }
  return { renderHome, renderItinerary, renderAttraction, renderPrepare, progressRing, photoPanel, renderPhotoExport };
}
