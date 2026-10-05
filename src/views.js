import { ATTRACTIONS, BUILTIN_CHECKLIST, TRIP_DATA } from "./data.js";
import { checklistProgress, getTripPhase } from "./state.js";
import { escapeHtml, getAttraction, formatDateTime } from "./formatting.js";

// Views read the latest model, return HTML, and never persist data or request permissions.
export function createViews({ getModel }) {
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

  function checkInBadge(attractionId) {
    const { state } = getModel();
    const checkIn = state.checkIns[attractionId];
    if (!checkIn) return `<span class="status-badge status-pending"><span aria-hidden="true">○</span> 未打卡</span>`;
    return `<span class="status-badge ${checkIn.verified ? "status-verified" : "status-manual"}">
      <span aria-hidden="true">${checkIn.verified ? "✓" : "◇"}</span>
      ${checkIn.verified ? "GPS 已核實" : "手動記錄"}
    </span>`;
  }

  function attractionCard(attraction) {
    const { photoRecords } = getModel();
    const hasPhoto = photoRecords.has(attraction.id);
    return `
      <article class="attraction-card">
        <a class="attraction-image-link" href="#attraction/${attraction.id}" aria-label="查看${escapeHtml(attraction.name)}詳情">
          <img src="${attraction.image}" alt="${escapeHtml(attraction.alt)}" width="1200" height="800" loading="lazy" />
          <span class="day-chip">第 ${attraction.day} 日 · ${escapeHtml(attraction.city)}</span>
        </a>
        <div class="attraction-card-body">
          <div class="card-status-row">${checkInBadge(attraction.id)}${hasPhoto ? `<span class="photo-chip">有紀念照</span>` : ""}</div>
          <h2><a href="#attraction/${attraction.id}">${escapeHtml(attraction.name)}</a></h2>
          <p>${escapeHtml(attraction.intro.slice(0, 84))}…</p>
          <div class="tag-list">${attraction.highlights.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
          <a class="text-link" href="#attraction/${attraction.id}">查看導覽與打卡 <span aria-hidden="true">→</span></a>
        </div>
      </article>`;
  }

  function renderHome() {
    const { state, installPrompt } = getModel();
    const phase = getTripPhase(new Date());
    const checkedIn = Object.keys(state.checkIns).length;
    const checkInPercent = Math.round((checkedIn / ATTRACTIONS.length) * 100);
    const checklist = checklistProgress(state);
    const countdown = phase.phase === "before"
      ? `<strong>${phase.days}</strong><span>日</span>`
      : `<strong class="countdown-message">${phase.label}</strong>`;

    return `
      <section class="hero-section">
        <div class="hero-grid">
          <div class="hero-copy">
            <p class="eyebrow">2026 戶外學習日</p>
            <h1>帶着好奇心<br />走進嶺南</h1>
            <p>${escapeHtml(TRIP_DATA.title)}三天團，把校際交流、近代歷史、非遺飲食與嶺南建築連成一段旅程。</p>
            <div class="hero-actions">
              <a class="button button-accent" href="#itinerary">查看三日行程</a>
              <a class="button button-ghost" href="#attractions">開始景點導覽</a>
            </div>
          </div>
          <div class="journey-pass" aria-label="活動摘要">
            <div class="pass-topline"><span>LEARNING PASS</span><span>HK ↗ GBA</span></div>
            <div class="countdown-block"><small>${phase.label}</small>${countdown}</div>
            <div class="pass-route"><span>香港</span><i></i><span>粵港澳大灣區</span></div>
            <dl>
              <div><dt>日期</dt><dd>${TRIP_DATA.dateLabel}</dd></div>
              <div><dt>旅程</dt><dd>${TRIP_DATA.duration}</dd></div>
            </dl>
          </div>
        </div>
      </section>

      <section class="content-section dashboard-section">
        <div class="section-heading">
          <div><p class="eyebrow">你的旅程</p><h2>準備到哪一步？</h2></div>
          <button id="install-button" class="button button-secondary button-small" ${installPrompt ? "" : "hidden"}>安裝 App</button>
        </div>
        <div class="progress-grid">
          <article class="progress-card">
            ${progressRing(checkInPercent, "景點打卡進度")}
            <div><p class="eyebrow">景點護照</p><h3>${checkedIn} / ${ATTRACTIONS.length} 個打卡</h3><a href="#attractions">繼續探索</a></div>
          </article>
          <article class="progress-card">
            ${progressRing(checklist.percent, "準備清單進度")}
            <div><p class="eyebrow">出發準備</p><h3>${checklist.done} / ${checklist.total} 項完成</h3><a href="#prepare">檢查清單</a></div>
          </article>
        </div>
      </section>

      <section class="content-section milestones-section">
        <div class="section-heading"><div><p class="eyebrow">不要錯過</p><h2>四個重要時刻</h2></div></div>
        <div class="milestone-list">
          ${TRIP_DATA.milestones.map((item, index) => `
            <article class="milestone-item">
              <span class="milestone-number">0${index + 1}</span>
              <div><time>${escapeHtml(item.date)}</time><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.detail)}</p></div>
            </article>`).join("")}
        </div>
      </section>

      <section class="content-section route-preview-section">
        <div class="section-heading"><div><p class="eyebrow">行程焦點</p><h2>五站 五種學習視角</h2></div><a href="#attractions" class="text-link">全部景點 →</a></div>
        <div class="horizontal-cards">${ATTRACTIONS.map(attractionCard).join("")}</div>
      </section>

      <section class="content-section privacy-banner">
        <div class="privacy-icon" aria-hidden="true">◎</div>
        <div><p class="eyebrow">只留在你的裝置</p><h2>位置與相片不會上傳</h2><p>GPS 只在你按下打卡時使用一次；照片會移除位置資料並保存在本機。</p></div>
      </section>`;
  }

  function renderItinerary() {
    return `
      <section class="page-shell">
        ${viewHeading("三天兩夜", "沿着路線學習", "行程或會按實際情況微調，請以校方最新通知為準。")}
        <div class="itinerary-list">
          ${TRIP_DATA.itinerary.map((day) => `
            <article class="day-panel">
              <div class="day-marker"><span>DAY</span><strong>${day.day}</strong></div>
              <div class="day-content">
                <div class="day-heading"><div><time>${escapeHtml(day.date)}</time><h2>${escapeHtml(day.theme)}</h2></div><span>${day.route.length} 個節點</span></div>
                <p>${escapeHtml(day.summary)}</p>
                <ol class="route-line">
                  ${day.route.map((stop) => {
                    const attraction = ATTRACTIONS.find((item) => stop.includes(item.name.replace("歡姐", "")) || stop.includes(item.name));
                    return `<li>${attraction ? `<a href="#attraction/${attraction.id}">${escapeHtml(stop)}</a>${checkInBadge(attraction.id)}` : `<span>${escapeHtml(stop)}</span>`}</li>`;
                  }).join("")}
                </ol>
              </div>
            </article>`).join("")}
        </div>
        <div class="source-note"><strong>行程備註</strong><p>酒店、集合地點及精確時間未載於通告，不會在 App 內自行補寫。</p></div>
      </section>`;
  }

  function renderAttractions() {
    const { state } = getModel();
    const checkedIn = Object.keys(state.checkIns).length;
    return `
      <section class="page-shell">
        ${viewHeading("景點護照", "五站嶺南導覽", `已完成 ${checkedIn} / ${ATTRACTIONS.length} 個景點。打卡與相片只屬個人旅程紀錄。`)}
        <div class="attraction-grid">${ATTRACTIONS.map(attractionCard).join("")}</div>
      </section>`;
  }

  function photoPanel(attraction, checkIn) {
    const { photoRecords, photoUrls } = getModel();
    const record = photoRecords.get(attraction.id);
    const photoUrl = photoUrls.get(attraction.id);
    if (!checkIn) {
      return `<section class="photo-panel photo-locked"><span aria-hidden="true">▧</span><div><h2>紀念相片</h2><p>完成景點打卡後即可影相或從相簿加入一張照片。</p></div></section>`;
    }
    if (!record || !photoUrl) {
      return `
        <section class="photo-panel">
          <div><p class="eyebrow">只存在裝置</p><h2>留下一張紀念照</h2><p>相片會縮小、重新編碼並移除 EXIF 位置資料；不影相亦不影響打卡。照片中的人樣、校服及背景仍可能透露身份，請避免拍攝敏感內容。</p></div>
          <div class="photo-actions">
            <button class="button button-primary" data-camera-open="${attraction.id}">開啟相機</button>
            <button class="button button-secondary" data-gallery-open="${attraction.id}">從相簿選取</button>
          </div>
        </section>`;
    }
    return `
      <section class="photo-panel has-photo">
        <img src="${photoUrl}" alt="你在${escapeHtml(attraction.name)}保存的紀念照" />
        <div class="photo-panel-copy">
          <p class="eyebrow">本機紀念照</p><h2>製作你的旅程卡</h2>
          <p>已壓縮為 ${escapeHtml(record.width)} × ${escapeHtml(record.height)}，原始拍攝資料不會保留。</p>
          <p class="privacy-note">旅程卡包含照片、景點及打卡時間。移除 EXIF 不等於匿名化；分享前請留意人樣、校服及背景。</p>
          <div class="photo-actions">
            <button class="button button-accent" data-card-download="${attraction.id}">下載旅程卡</button>
            <button class="button button-secondary" data-camera-open="${attraction.id}">重新拍攝</button>
            <button class="button button-secondary" data-gallery-open="${attraction.id}">更換相片</button>
            <button class="text-danger" data-photo-delete="${attraction.id}">刪除相片</button>
          </div>
        </div>
      </section>`;
  }

  function renderAttraction(attractionId) {
    const { state } = getModel();
    const attraction = getAttraction(attractionId);
    const checkIn = state.checkIns[attractionId];
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
            <a href="#attractions" class="back-link">← 返回景點</a>
            <div><p class="eyebrow">第 ${attraction.day} 日 · ${escapeHtml(attraction.city)}</p><h1>${escapeHtml(attraction.name)}</h1><p>${escapeHtml(attraction.address)}</p></div>
          </div>
        </div>
        <div class="detail-content">
          <section class="story-panel">
            <div class="story-main"><p class="eyebrow">景點簡介</p><h2>先了解 再觀察</h2><p class="lead-paragraph">${escapeHtml(attraction.intro)}</p></div>
            <div class="tag-list large">${attraction.highlights.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
          </section>
          <div class="learning-grid">
            <section><span class="learning-number">01</span><p class="eyebrow">現場觀察</p><h2>${escapeHtml(attraction.observe)}</h2></section>
            <section><span class="learning-number">02</span><p class="eyebrow">學習提示</p><h2>${escapeHtml(attraction.prompt)}</h2></section>
          </div>
          <p class="source-link">資料來源：<a href="${attraction.source.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(attraction.source.label)} <span aria-hidden="true">↗</span></a> · <a href="${attraction.geo.sourceUrl}" target="_blank" rel="noopener noreferrer">位置資料 <span aria-hidden="true">↗</span></a></p>
          ${checkInAction}
          ${photoPanel(attraction, checkIn)}
        </div>
      </article>`;
  }

  function renderPrepare() {
    const { state } = getModel();
    const progress = checklistProgress(state);
    const groups = [...new Set(BUILTIN_CHECKLIST.map((item) => item.group))];
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
              ${BUILTIN_CHECKLIST.filter((item) => item.group === group).map((item) => `
                <label class="check-row ${state.checklist[item.id] ? "is-done" : ""}">
                  <input type="checkbox" data-check-item="${item.id}" ${state.checklist[item.id] ? "checked" : ""} />
                  <span class="custom-checkbox" aria-hidden="true"></span>
                  <span>${escapeHtml(item.label)}</span>
                </label>`).join("")}
            </section>`).join("")}
          <section class="checklist-group custom-checklist">
            <h2>我的提醒</h2>
            ${state.customItems.length ? state.customItems.map((item) => `
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

  function renderInfo() {
    return `
      <section class="page-shell">
        ${viewHeading("活動須知", "出發前要知道的事", "內容根據學校通告整理；任何更新以校方最新公布為準。")}
        <div class="fact-strip">
          <div><span>日期</span><strong>${TRIP_DATA.dateLabel}</strong></div>
          <div><span>城市</span><strong>${TRIP_DATA.cities.join(" · ")}</strong></div>
        </div>
        <div class="notice-grid">
          ${TRIP_DATA.notices.map((notice, index) => `
            <article class="notice-card"><span>0${index + 1}</span><h2>${escapeHtml(notice.title)}</h2><p>${escapeHtml(notice.body)}</p></article>`).join("")}
        </div>
        ${TRIP_DATA.participants.length ? `<section class="info-section">
          <p class="eyebrow">參加對象</p><h2>班別及服務隊伍</h2>
          <div class="tag-list large">${TRIP_DATA.participants.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
        </section>` : ""}
        ${TRIP_DATA.leaders.length ? `<section class="info-section">
          <p class="eyebrow">領隊老師</p><h2>同行教職員</h2>
          <ul class="leader-list">${TRIP_DATA.leaders.map((name) => `<li>${escapeHtml(name)}</li>`).join("")}</ul>
        </section>` : ""}
        ${!TRIP_DATA.participants.length && !TRIP_DATA.leaders.length ? `<section class="source-note"><strong>公開版本私隱提示</strong><p>此網站不提供班別及教職員姓名；相關資料請參閱校方通告。</p></section>` : ""}
        <section class="source-note"><strong>本機資料安全提示</strong><p>此 App 不會上傳照片、原始座標或個人紀錄，也不設分析追蹤。資料只存在目前瀏覽器，沒有由 App 額外加密或密碼保護；可使用此裝置及瀏覽器的人可能查看紀錄，請啟用裝置鎖定，避免在共用裝置保存敏感照片。</p><p>瀏覽器按網站來源（origin）隔離儲存，不按網址子目錄隔離；同一網域下其他應用可能共用儲存權限。清除本機資料不會刪除已下載、分享或另外備份的旅程卡。</p></section>
        <section class="data-control-section">
          <div><p class="eyebrow">私隱與本機資料</p><h2>你掌握自己的旅程紀錄</h2><p>清單和打卡存在瀏覽器；相片另存在 IndexedDB。清除後無法復原。</p></div>
          <button class="button button-danger" data-reset-all>清除所有本機資料</button>
        </section>
      </section>`;
  }

  return { renderHome, renderItinerary, renderAttractions, renderAttraction, renderPrepare, renderInfo, progressRing, photoPanel };
}
