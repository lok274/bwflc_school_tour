import { ATTRACTIONS, BUILTIN_CHECKLIST, TRIP_DATA } from "./data.js";
import { evaluateGeofence, formatDistance } from "./geo.js";
import {
  STORAGE_KEY,
  checklistProgress,
  createDefaultState,
  getTripPhase,
  loadState,
  saveState
} from "./state.js";
import {
  clearPhotoRecords,
  compressPhoto,
  createTravelCard,
  deletePhotoRecord,
  getAllPhotoRecords,
  getPhotoRecord,
  savePhotoRecord
} from "./photos.js";

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const networkStatus = document.querySelector("#network-status");
const cameraDialog = document.querySelector("#camera-dialog");
const cameraVideo = document.querySelector("#camera-video");
const cameraCanvas = document.querySelector("#camera-canvas");
const cameraPreview = document.querySelector("#camera-preview");
const cameraLoading = document.querySelector("#camera-loading");
const photoInput = document.querySelector("#photo-input");
const confirmDialog = document.querySelector("#confirm-dialog");

let state = loadState();
let photoRecords = new Map();
let photoUrls = new Map();
let cameraStream = null;
let pendingCapture = null;
let pendingPreviewUrl = null;
let installPrompt = null;
let toastTimer = null;
let dataGeneration = 0;
let isResetting = false;
let cameraRequestGeneration = 0;
let captureGeneration = 0;
const attractionGenerations = new Map();
const activePhotoTasks = new Map();
let renderedRouteKey = null;
let confirmationQueue = Promise.resolve();

const htmlEscapeMap = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => htmlEscapeMap[character]);

function getAttraction(id) {
  return ATTRACTIONS.find((item) => item.id === id);
}

function operationToken(attractionId) {
  return {
    dataGeneration,
    attractionGeneration: attractionGenerations.get(attractionId) || 0
  };
}

function isCurrentOperation(attractionId, token) {
  return !isResetting &&
    token?.dataGeneration === dataGeneration &&
    token?.attractionGeneration === (attractionGenerations.get(attractionId) || 0);
}

function invalidateAttractionOperations(attractionId) {
  attractionGenerations.set(attractionId, (attractionGenerations.get(attractionId) || 0) + 1);
}

function invalidateAllOperations() {
  dataGeneration += 1;
}

function isCurrentDataGeneration(token) {
  return !isResetting && token === dataGeneration;
}

function trackPhotoTask(attractionId, task) {
  const tasks = activePhotoTasks.get(attractionId) || new Set();
  tasks.add(task);
  activePhotoTasks.set(attractionId, tasks);
  const finish = () => {
    tasks.delete(task);
    if (!tasks.size) activePhotoTasks.delete(attractionId);
  };
  task.then(finish, finish);
  return task;
}

async function waitForPhotoTasks(attractionId) {
  const tasks = attractionId
    ? [...(activePhotoTasks.get(attractionId) || [])]
    : [...activePhotoTasks.values()].flatMap((items) => [...items]);
  if (tasks.length) await Promise.allSettled(tasks);
}

function currentRoute() {
  const route = location.hash.replace(/^#/, "") || "home";
  if (route.startsWith("attraction/")) {
    const attractionId = route.split("/")[1];
    return getAttraction(attractionId) ? { view: "attraction", attractionId } : { view: "attractions" };
  }
  const allowed = ["home", "itinerary", "attractions", "prepare", "info"];
  return { view: allowed.includes(route) ? route : "home" };
}

function setActiveNavigation(route) {
  const active = route.view === "attraction" ? "attractions" : route.view;
  document.querySelectorAll("[data-nav]").forEach((item) => {
    const selected = item.dataset.nav === active;
    item.classList.toggle("is-active", selected);
    if (selected) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
}

function formatDateTime(iso) {
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(iso));
}

function showToast(message, tone = "default") {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.dataset.tone = tone;
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add("is-visible"));
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
    window.setTimeout(() => { toast.hidden = true; }, 220);
  }, 4200);
}

function persist() {
  try {
    state = saveState(state);
    return true;
  } catch {
    showToast("未能保存進度，可能是瀏覽器儲存空間不足。", "warning");
    return false;
  }
}

function progressRing(percent, label) {
  const radius = 42;
  const circumference = Math.PI * 2 * radius;
  const offset = circumference - (percent / 100) * circumference;
  return `
    <div class="progress-ring" aria-label="${escapeHtml(label)} ${percent}%">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle class="progress-ring-track" cx="50" cy="50" r="${radius}"></circle>
        <circle class="progress-ring-value" cx="50" cy="50" r="${radius}" style="stroke-dasharray:${circumference};stroke-dashoffset:${offset}"></circle>
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
  const checkIn = state.checkIns[attractionId];
  if (!checkIn) return `<span class="status-badge status-pending"><span aria-hidden="true">○</span> 未打卡</span>`;
  return `<span class="status-badge ${checkIn.verified ? "status-verified" : "status-manual"}">
    <span aria-hidden="true">${checkIn.verified ? "✓" : "◇"}</span>
    ${checkIn.verified ? "GPS 已核實" : "手動記錄"}
  </span>`;
}

function attractionCard(attraction) {
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
  const checkedIn = Object.keys(state.checkIns).length;
  return `
    <section class="page-shell">
      ${viewHeading("景點護照", "五站嶺南導覽", `已完成 ${checkedIn} / ${ATTRACTIONS.length} 個景點。打卡與相片只屬個人旅程紀錄。`)}
      <div class="attraction-grid">${ATTRACTIONS.map(attractionCard).join("")}</div>
    </section>`;
}

function photoPanel(attraction, checkIn) {
  const record = photoRecords.get(attraction.id);
  const photoUrl = photoUrls.get(attraction.id);
  if (!checkIn) {
    return `<section class="photo-panel photo-locked"><span aria-hidden="true">▧</span><div><h2>紀念相片</h2><p>完成景點打卡後即可影相或從相簿加入一張照片。</p></div></section>`;
  }
  if (!record || !photoUrl) {
    return `
      <section class="photo-panel">
        <div><p class="eyebrow">只存在裝置</p><h2>留下一張紀念照</h2><p>相片會縮小、重新編碼並移除 EXIF 位置資料；不影相亦不影響打卡。</p></div>
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
        <p>已壓縮為 ${record.width} × ${record.height}，原始拍攝資料不會保留。</p>
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
      <section class="data-control-section">
        <div><p class="eyebrow">私隱與本機資料</p><h2>你掌握自己的旅程紀錄</h2><p>清單和打卡存在瀏覽器；相片另存在 IndexedDB。清除後無法復原。</p></div>
        <button class="button button-danger" data-reset-all>清除所有本機資料</button>
      </section>
    </section>`;
}

function render({ moveFocus = false } = {}) {
  const focused = document.activeElement;
  const hadFocus = focused && app.contains(focused);
  const focusId = focused?.id;
  const focusData = ["checkItem", "customCheck", "customDelete"].find((key) => focused?.dataset?.[key]);
  const focusValue = focusData ? focused.dataset[focusData] : null;
  const route = currentRoute();
  const routeKey = route.view === "attraction" ? `attraction/${route.attractionId}` : route.view;
  setActiveNavigation(route);
  document.body.dataset.view = route.view;

  if (route.view === "home") app.innerHTML = renderHome();
  if (route.view === "itinerary") app.innerHTML = renderItinerary();
  if (route.view === "attractions") app.innerHTML = renderAttractions();
  if (route.view === "attraction") app.innerHTML = renderAttraction(route.attractionId);
  if (route.view === "prepare") app.innerHTML = renderPrepare();
  if (route.view === "info") app.innerHTML = renderInfo();
  if (moveFocus && routeKey !== renderedRouteKey) app.focus({ preventScroll: true });
  else if (hadFocus) {
    const replacement = focusId ? document.getElementById(focusId)
      : [...app.querySelectorAll("input, button")].find((item) => focusData && item.dataset[focusData] === focusValue);
    replacement?.focus({ preventScroll: true });
  }
  renderedRouteKey = routeKey;
}

async function refreshPhotos() {
  try {
    const records = await getAllPhotoRecords();
    for (const url of photoUrls.values()) URL.revokeObjectURL(url);
    photoRecords = new Map(records.map((record) => [record.attractionId, record]));
    photoUrls = new Map(records.map((record) => [record.attractionId, URL.createObjectURL(record.blob)]));
  } catch {
    photoRecords = new Map();
    photoUrls = new Map();
  }
}

function askConfirmation(options) {
  const request = confirmationQueue.then(() => {
    if (options.isRelevant && !options.isRelevant()) return false;
    return showConfirmation(options);
  });
  confirmationQueue = request.catch(() => false);
  return request;
}

function showConfirmation({ title, message, confirmText = "確認", danger = false }) {
  if (!confirmDialog?.showModal) return Promise.resolve(window.confirm(message));
  document.querySelector("#confirm-title").textContent = title;
  document.querySelector("#confirm-message").textContent = message;
  const button = document.querySelector("#confirm-button");
  button.textContent = confirmText;
  button.classList.toggle("button-danger", danger);
  button.classList.toggle("button-primary", !danger);
  confirmDialog.returnValue = "";
  confirmDialog.showModal();
  return new Promise((resolve) => {
    confirmDialog.addEventListener("close", () => resolve(confirmDialog.returnValue === "confirm"), { once: true });
  });
}

function celebrateStamp(attraction) {
  const stamp = document.createElement("div");
  stamp.className = "stamp-celebration";
  stamp.innerHTML = `<span>已到埗</span><strong>${escapeHtml(attraction.name)}</strong>`;
  document.body.append(stamp);
  window.setTimeout(() => stamp.remove(), 1800);
}

function recordCheckIn(attraction, method, verified, token) {
  if (!isCurrentOperation(attraction.id, token) || state.checkIns[attraction.id]) return false;
  state.checkIns[attraction.id] = {
    attractionId: attraction.id,
    checkedInAt: new Date().toISOString(),
    method,
    verified
  };
  const saved = persist();
  render();
  celebrateStamp(attraction);
  showToast(
    saved ? `${attraction.name}打卡完成！` : "打卡只暫存於目前頁面，未能寫入這部裝置。",
    saved ? "success" : "warning"
  );
  return true;
}

async function offerManualCheckIn(attraction, reason, token) {
  if (!isCurrentOperation(attraction.id, token)) return false;
  const accepted = await askConfirmation({
    title: `在${attraction.name}手動記錄？`,
    message: `${reason} 你可以把這次到訪記錄為「未核實手動打卡」，但它不會顯示 GPS 已核實。`,
    isRelevant: () => isCurrentOperation(attraction.id, token) && !state.checkIns[attraction.id],
    confirmText: "手動打卡"
  });
  return accepted ? recordCheckIn(attraction, "manual", false, token) : false;
}

async function startCheckIn(attractionId, button) {
  const attraction = getAttraction(attractionId);
  if (isResetting || !attraction || state.checkIns[attractionId]) return;
  const token = operationToken(attractionId);
  button?.setAttribute("aria-busy", "true");
  if (button) button.disabled = true;

  if (!navigator.geolocation) {
    await offerManualCheckIn(attraction, "此瀏覽器不支援位置功能。 ", token);
    if (isCurrentOperation(attractionId, token)) render();
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async ({ coords }) => {
      if (!isCurrentOperation(attractionId, token) || state.checkIns[attractionId]) return;
      const result = evaluateGeofence(
        { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy },
        attraction.geo
      );
      if (result.status === "verified") {
        recordCheckIn(attraction, "gps", true, token);
      } else if (result.status === "inaccurate") {
        await offerManualCheckIn(attraction, `目前定位誤差約 ${Math.round(result.accuracy || 0)} 米，未能可靠核實。`, token);
        if (isCurrentOperation(attractionId, token)) render();
      } else {
        showToast(`你的位置距離景點約 ${formatDistance(result.distance)}，尚未進入打卡範圍。`, "warning");
        if (isCurrentOperation(attractionId, token)) render();
      }
    },
    async (error) => {
      if (!isCurrentOperation(attractionId, token) || state.checkIns[attractionId]) return;
      const reason = error.code === 1 ? "你沒有允許位置權限。" : error.code === 3 ? "位置要求逾時。" : "暫時未能取得位置。";
      await offerManualCheckIn(attraction, reason, token);
      if (isCurrentOperation(attractionId, token)) render();
    },
    { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
  );
}

async function undoCheckIn(attractionId) {
  const attraction = getAttraction(attractionId);
  if (isResetting || !attraction || !state.checkIns[attractionId]) return;
  const hasPhoto = photoRecords.has(attractionId);
  const accepted = await askConfirmation({
    title: "取消這次打卡？",
    message: hasPhoto ? "取消後，這個景點的紀念照亦會一併刪除，無法復原。" : "取消後會移除時間及核實狀態。",
    confirmText: "取消打卡",
    danger: true
  });
  if (!accepted) return;

  const dataToken = dataGeneration;
  invalidateAttractionOperations(attractionId);
  await waitForPhotoTasks(attractionId);
  if (!isCurrentDataGeneration(dataToken)) return;
  try {
    if (globalThis.indexedDB || photoRecords.has(attractionId)) await deletePhotoRecord(attractionId);
  } catch {
    if (!isCurrentDataGeneration(dataToken)) return;
    await refreshPhotos();
    render();
    showToast("未能刪除這個景點的紀念照；打卡紀錄會暫時保留，請再試一次。", "warning");
    return;
  }

  if (!isCurrentDataGeneration(dataToken)) return;

  delete state.checkIns[attractionId];
  const saved = persist();
  await refreshPhotos();
  render();
  showToast(saved ? "打卡紀錄及相關紀念照已取消。" : "紀念照已刪除，但未能保存打卡更新。", saved ? "default" : "warning");
}

function clearPendingCapture() {
  captureGeneration += 1;
  pendingCapture = null;
  if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
  pendingPreviewUrl = null;
  cameraPreview.removeAttribute("src");
  cameraPreview.hidden = true;
  cameraVideo.hidden = false;
  document.querySelector("[data-camera-retake]").hidden = true;
  document.querySelector("[data-camera-save]").hidden = true;
  document.querySelector("[data-camera-capture]").hidden = false;
}

function stopCamera() {
  cameraRequestGeneration += 1;
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  cameraVideo.srcObject = null;
  clearPendingCapture();
}

function openGallery(attractionId) {
  if (isResetting || !state.checkIns[attractionId]) return;
  photoInput.dataset.attractionId = attractionId;
  photoInput.value = "";
  photoInput.click();
}

async function openCamera(attractionId) {
  if (isResetting || !state.checkIns[attractionId]) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast("這個瀏覽器未能開啟相機，已改用相簿選擇器。", "warning");
    openGallery(attractionId);
    return;
  }

  stopCamera();
  const requestGeneration = ++cameraRequestGeneration;
  const token = operationToken(attractionId);
  cameraDialog.dataset.attractionId = attractionId;
  cameraDialog.dataset.cameraRequestGeneration = String(requestGeneration);
  document.querySelector("#camera-title").textContent = `在${getAttraction(attractionId).name}影相`;
  cameraLoading.hidden = false;
  clearPendingCapture();
  if (!cameraDialog.open) cameraDialog.showModal();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    const stillCurrent = !isResetting &&
      cameraRequestGeneration === requestGeneration &&
      cameraDialog.open &&
      cameraDialog.dataset.attractionId === attractionId &&
      cameraDialog.dataset.cameraRequestGeneration === String(requestGeneration) &&
      isCurrentOperation(attractionId, token);
    if (!stillCurrent) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    cameraStream?.getTracks().forEach((track) => track.stop());
    cameraStream = stream;
    cameraVideo.srcObject = stream;
    await cameraVideo.play();
    if (cameraRequestGeneration !== requestGeneration || !cameraDialog.open) {
      stream.getTracks().forEach((track) => track.stop());
      if (cameraStream === stream) cameraStream = null;
      return;
    }
    cameraLoading.hidden = true;
  } catch {
    if (cameraRequestGeneration !== requestGeneration) return;
    stopCamera();
    cameraDialog.close();
    showToast("未能開啟相機，已改用相簿選擇器。", "warning");
    openGallery(attractionId);
  }
}

function captureCameraFrame() {
  if (!cameraStream || !cameraVideo.videoWidth) return;
  const requestGeneration = cameraRequestGeneration;
  const attractionId = cameraDialog.dataset.attractionId;
  const captureToken = ++captureGeneration;
  cameraCanvas.width = cameraVideo.videoWidth;
  cameraCanvas.height = cameraVideo.videoHeight;
  const context = cameraCanvas.getContext("2d");
  context.drawImage(cameraVideo, 0, 0);
  cameraCanvas.toBlob((blob) => {
    const stillCurrent = blob &&
      cameraRequestGeneration === requestGeneration &&
      captureGeneration === captureToken &&
      cameraDialog.open &&
      cameraDialog.dataset.attractionId === attractionId &&
      cameraStream;
    if (!stillCurrent) return;
    pendingCapture = blob;
    pendingPreviewUrl = URL.createObjectURL(blob);
    cameraPreview.src = pendingPreviewUrl;
    cameraPreview.hidden = false;
    cameraVideo.hidden = true;
    document.querySelector("[data-camera-retake]").hidden = false;
    document.querySelector("[data-camera-save]").hidden = false;
    document.querySelector("[data-camera-capture]").hidden = true;
  }, "image/jpeg", 0.92);
}

async function removeStalePhotoRecord(record) {
  try {
    const saved = await getPhotoRecord(record.attractionId);
    if (saved?.writeId === record.writeId) await deletePhotoRecord(record.attractionId);
  } catch {
    // The caller that invalidated this operation will surface a deletion failure
    // or perform the final database clear after this task settles.
  }
}

async function processPhotoInternal(input, attractionId) {
  const token = operationToken(attractionId);
  if (!isCurrentOperation(attractionId, token) || !state.checkIns[attractionId]) return;
  showToast("正在壓縮相片及移除位置資料…");
  try {
    const record = await compressPhoto(input, attractionId);
    record.writeId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    if (!isCurrentOperation(attractionId, token) || !state.checkIns[attractionId]) return;
    await savePhotoRecord(record);
    if (!isCurrentOperation(attractionId, token) || !state.checkIns[attractionId]) {
      await removeStalePhotoRecord(record);
      return;
    }
    await refreshPhotos();
    render();
    showToast("紀念照已安全保存在這部裝置。", "success");
  } catch (error) {
    if (!isCurrentOperation(attractionId, token)) return;
    const quotaMessage = error?.name === "QuotaExceededError" ? "裝置儲存空間不足，未能保存相片。" : error?.message;
    showToast(quotaMessage || "未能處理相片，請再試一次。", "warning");
  }
}

function processPhoto(input, attractionId) {
  return trackPhotoTask(attractionId, processPhotoInternal(input, attractionId));
}

async function saveCameraPhoto() {
  const attractionId = cameraDialog.dataset.attractionId;
  const capture = pendingCapture;
  stopCamera();
  cameraDialog.close();
  if (capture) await processPhoto(capture, attractionId);
}

async function removePhoto(attractionId) {
  if (isResetting || !state.checkIns[attractionId]) return;
  const accepted = await askConfirmation({ title: "刪除紀念照？", message: "照片只存在這部裝置，刪除後無法復原。", confirmText: "刪除照片", danger: true });
  if (!accepted) return;
  const dataToken = dataGeneration;
  invalidateAttractionOperations(attractionId);
  await waitForPhotoTasks(attractionId);
  if (!isCurrentDataGeneration(dataToken)) return;
  try {
    await deletePhotoRecord(attractionId);
  } catch {
    if (!isCurrentDataGeneration(dataToken)) return;
    await refreshPhotos();
    render();
    showToast("未能刪除紀念照；它仍保存在這部裝置，請再試一次。", "warning");
    return;
  }
  if (!isCurrentDataGeneration(dataToken)) return;
  await refreshPhotos();
  render();
  showToast("紀念照已刪除。 ");
}

async function downloadTravelCard(attractionId) {
  const record = photoRecords.get(attractionId);
  const attraction = getAttraction(attractionId);
  const checkIn = state.checkIns[attractionId];
  if (isResetting || !record || !attraction || !checkIn) return;
  showToast("正在製作旅程卡…");
  try {
    const blob = await createTravelCard({ photoRecord: record, attraction, checkIn, tripTitle: TRIP_DATA.title });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${attraction.name}-旅程卡.png`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("旅程卡已下載。", "success");
  } catch {
    showToast("未能製作旅程卡，請稍後再試。", "warning");
  }
}

async function resetAllData() {
  if (isResetting) return;
  const first = await askConfirmation({ title: "清除所有本機資料？", message: "這會移除準備清單、所有打卡和五個景點的紀念照。", confirmText: "繼續", danger: true });
  if (!first) return;
  const second = await askConfirmation({ title: "最後確認", message: "資料一經清除便無法復原。你確定要重新開始嗎？", confirmText: "永久清除", danger: true });
  if (!second) return;

  isResetting = true;
  invalidateAllOperations();
  stopCamera();
  showToast("正在安全清除本機資料…");
  await waitForPhotoTasks();

  try {
    if (globalThis.indexedDB || photoRecords.size) await clearPhotoRecords();
  } catch {
    isResetting = false;
    await refreshPhotos();
    render();
    showToast("未能清除所有紀念照；其他本機資料仍保留，請再試一次。", "warning");
    return;
  }

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    isResetting = false;
    await refreshPhotos();
    render();
    showToast("紀念照已清除，但未能清除行程紀錄；請檢查瀏覽器儲存設定後再試。", "warning");
    return;
  }

  state = createDefaultState();
  await refreshPhotos();
  isResetting = false;
  render();
  showToast("所有本機旅程資料已清除。", "success");
}

function handleChecklistChange(target) {
  if (target.matches("[data-check-item]")) {
    state.checklist[target.dataset.checkItem] = target.checked;
  } else if (target.matches("[data-custom-check]")) {
    const item = state.customItems.find((entry) => entry.id === target.dataset.customCheck);
    if (item) item.done = target.checked;
  } else return;
  persist();
  render();
}

document.addEventListener("change", (event) => handleChecklistChange(event.target));

document.addEventListener("submit", (event) => {
  if (event.target.id !== "custom-item-form") return;
  event.preventDefault();
  const input = event.target.elements.label;
  const label = input.value.trim();
  if (!label) return;
  const id = globalThis.crypto?.randomUUID?.() || `custom-${Date.now()}`;
  state.customItems.push({ id, label: label.slice(0, 120), done: false });
  persist();
  render();
});

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button, a");
  if (!target) return;
  if (target.matches(".skip-link")) {
    event.preventDefault();
    app.focus();
    return;
  }
  if (target.matches("[data-checkin]")) await startCheckIn(target.dataset.checkin, target);
  if (target.matches("[data-checkin-undo]")) await undoCheckIn(target.dataset.checkinUndo);
  if (target.matches("[data-camera-open]")) await openCamera(target.dataset.cameraOpen);
  if (target.matches("[data-gallery-open]")) openGallery(target.dataset.galleryOpen);
  if (target.matches("[data-photo-delete]")) await removePhoto(target.dataset.photoDelete);
  if (target.matches("[data-card-download]")) await downloadTravelCard(target.dataset.cardDownload);
  if (target.matches("[data-reset-all]")) await resetAllData();
  if (target.matches("[data-custom-delete]")) {
    state.customItems = state.customItems.filter((item) => item.id !== target.dataset.customDelete);
    persist();
    render();
  }
  if (target.matches("[data-camera-close]")) stopCamera();
  if (target.matches("[data-camera-capture]")) captureCameraFrame();
  if (target.matches("[data-camera-retake]")) clearPendingCapture();
  if (target.matches("[data-camera-save]")) await saveCameraPhoto();
  if (target.id === "install-button" && installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    render();
  }
});

photoInput.addEventListener("change", async () => {
  const file = photoInput.files?.[0];
  const attractionId = photoInput.dataset.attractionId;
  if (file && attractionId) await processPhoto(file, attractionId);
});

cameraDialog.addEventListener("close", stopCamera);
window.addEventListener("hashchange", () => {
  stopCamera();
  if (cameraDialog.open) cameraDialog.close();
  render({ moveFocus: true });
  const reduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
});
window.addEventListener("online", updateNetworkStatus);
window.addEventListener("offline", updateNetworkStatus);
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  render();
});
window.addEventListener("beforeunload", () => {
  stopCamera();
  for (const url of photoUrls.values()) URL.revokeObjectURL(url);
});
window.addEventListener("pagehide", stopCamera);

function updateNetworkStatus() {
  const online = navigator.onLine;
  networkStatus.textContent = online ? "已連線" : "離線可用";
  networkStatus.classList.toggle("is-offline", !online);
}

async function start() {
  updateNetworkStatus();
  await refreshPhotos();
  render();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register(new URL("../sw.js", import.meta.url)).catch(() => {
      showToast("離線功能暫時未能啟用。", "warning");
    });
  }
}

start();
