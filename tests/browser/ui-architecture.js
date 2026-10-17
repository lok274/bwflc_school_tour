import { FIXTURE_IDENTITY, createFixtureIndexedDB } from "../helpers/browser-environment.js";
import { STUDENT_IDENTITY_STORAGE_KEY } from "../../src/student-identity.js";
import { createAppController } from "../../src/controller.js";
import { createDefaultState, STORAGE_KEY } from "../../src/state.js";
import { REQUIRED_CHECK_IN_LOCATIONS } from "../../src/data.js";
import { createCheckInSync, createSyncRepository, SYNC_DATABASE_NAME, SYNC_ACTIVITY_ID, SYNC_UPLOAD_CUTOFF } from "../../src/check-in-sync.js";

const assert = (condition, message) => { if (!condition) throw Error(message); };
if (new URLSearchParams(location.search).get("textZoom") === "200") document.documentElement.classList.add("text-zoom");
const ids = REQUIRED_CHECK_IN_LOCATIONS.map(item => item.id);
const state = createDefaultState();
for (const id of ids) state.checkIns[id] = { attractionId: id, checkedInAt: "2026-11-05T04:00:00Z", verified: false, method: "manual" };
const values = new Map(), records = new Map(), live = new Set();
const canvas = document.createElement("canvas"); canvas.width = 80; canvas.height = 60;
canvas.getContext("2d").fillRect(0, 0, 80, 60);
const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg"));
function photo(index, station = 0) { return { attractionId: ids[station], photoId: `${ids[station]}-${index}`, writeId: `${station}-${index}`,
  width: 80, height: 60, createdAt: new Date(Date.UTC(2026, 10, 5, 4, 0, index)).toISOString(), blob }; }
class FixtureURL extends URL {
  static createObjectURL(value) { const url = URL.createObjectURL(value); live.add(url); return url; }
  static revokeObjectURL(url) { live.delete(url); URL.revokeObjectURL(url); }
}
let readFailure = false, completionOverride;
const syncTesting = new URLSearchParams(location.search).get("sync") === "1";
class SyncFixtureDate extends Date { static now() { return Date.parse("2026-10-14T00:00:00Z"); } }
const syncDatabase = `fixture-sync-ui-${crypto.randomUUID()}`, syncRequests = [];
let syncSession, syncReply = "normal", releaseSync;
const syncRepository = createSyncRepository({ open(name, version) { assert(name === SYNC_DATABASE_NAME, "不得讀正式同步資料"); return indexedDB.open(syncDatabase, version); } });
async function syntheticGoogle(_url, options) {
  const body = JSON.parse(options.body); syncRequests.push(body);
  assert(!("code" in body), "仍傳送活動碼");
  if (syncReply === "fail") throw new TypeError("合成斷線");
  if (syncReply === "closed") return { ok: true, text: async () => JSON.stringify({ version: 1, activityId: SYNC_ACTIVITY_ID, ok: false, error: "CLOSED" }) };
  if (syncReply === "wait") await new Promise(resolve => { releaseSync = resolve; });
  if (body.action === "enable") { syncSession = body.sessionId; return { ok: true, text: async () => JSON.stringify({ version: 1, activityId: SYNC_ACTIVITY_ID, ok: true, sessionId: syncSession, ticket: "fixture", expiresAt: SYNC_UPLOAD_CUTOFF }) }; }
  return { ok: true, text: async () => JSON.stringify({ version: 1, activityId: SYNC_ACTIVITY_ID, ok: true, sessionId: syncSession, accepted: body.events.map(item => item.eventId) }) };
}
const controller = createAppController({
  environment: { document, window, Math: { random: () => 0 }, location, Date: SyncFixtureDate, URL: FixtureURL, requestAnimationFrame, crypto, fetch: syntheticGoogle, indexedDB: createFixtureIndexedDB(indexedDB),
    localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    navigator: { onLine: true } },
  photoService: { getAllPhotoRecords: async () => { if (readFailure) throw Error("fixture error"); return [...records.values()]; },
    deletePhotoRecord: async id => { for (const [key, value] of records) if (value.attractionId === id) records.delete(key); }, clearPhotoRecords: async () => records.clear() },
  syncEndpoint: syncTesting ? "https://script.google.com/macros/s/fixture/exec" : "", syncRepository,
  completionCardService: options => completionOverride(options)
});
const pause = () => new Promise(resolve => setTimeout(resolve, 10));
async function until(condition, timeout = 12000) { const end = Date.now() + timeout; while (!condition()) { if (Date.now() > end) throw Error("等待逾時"); await pause(); } }
const click = selector => { const target = document.querySelector(selector); assert(target, `缺少 ${selector}`); target.click(); };
async function dismissSyncInvitation() { await pause(); if (syncTesting && document.querySelector('#check-in-sync-dialog[open]')) click('[data-sync-dismiss]'); }
function input(selector, value) { const target = document.querySelector(selector); assert(target, selector); target.value = value; target.dispatchEvent(new Event("input", { bubbles: true })); }
async function navigate(hash) {
  if (location.hash !== hash) location.hash = hash;
  await until(() => {
    const route = controller.currentRoute();
    return route.view === "memories" ? document.getElementById(`memory-tab-${route.section}`)?.getAttribute("aria-expanded") === "true" :
      document.body.dataset.view === route.view && (!route.attractionId || document.getElementById(`itinerary-stop-${route.attractionId}`)?.checkVisibility());
  }); await pause();
}
async function load(items) { records.clear(); items.forEach(item => records.set(item.photoId, item)); await controller.start(); }
let passed = 0, failed = 0;
async function check(label, fn) {
  const li = document.createElement("li");
  try { await fn(); passed++; li.textContent = `通過：${label}`; }
  catch (error) { failed++; li.textContent = `失敗：${label} — ${error.message}`; }
  document.getElementById("test-results").append(li);
}
location.hash = "#memories"; await controller.start();
if (document.querySelector('#install-invitation[open]')) click('[data-install-dismiss]');
if (syncTesting && document.querySelector('#check-in-sync-dialog[open]')) click('[data-sync-dismiss]');
await check("登入門檻、逐欄錯誤及中文組字：不重畫輸入，登入後保留舊網址", async () => {
  const journey = values.get(STORAGE_KEY), hash = location.hash;
  assert(document.querySelector(".bottom-nav").hidden && controller.getPageSnapshot().view === "login", "未登入顯示旅程");
  document.getElementById("student-login-form").requestSubmit(); await pause();
  assert(document.activeElement.id === "student-login-studentName" && document.querySelectorAll('.student-login-fields [aria-invalid="true"]').length === 3, "必填錯誤或焦點不正確");
  const name = document.getElementById("student-login-studentName");
  name.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  name.value = FIXTURE_IDENTITY.studentName; name.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
  controller.render(); document.getElementById("student-login-form").requestSubmit();
  assert(name.isConnected && document.getElementById("student-login-studentName") === name && !values.has(STUDENT_IDENTITY_STORAGE_KEY), "組字時重畫或提前登入");
  name.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  for (const [key, value] of Object.entries(FIXTURE_IDENTITY)) input(`[data-student-identity-field="${key}"]`, value);
  assertUsableLayout(); document.getElementById("student-login-form").requestSubmit();
  await until(() => document.body.dataset.view === "memories");
  await dismissSyncInvitation();
  assert(location.hash === hash && values.get(STORAGE_KEY) === journey && JSON.parse(values.get(STUDENT_IDENTITY_STORAGE_KEY)).studentNumber === "001", "登入改動網址、旅程或前置零");
});
values.set(STORAGE_KEY, JSON.stringify(state));
window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
await check("學生資料唯讀，返回及登出登入保留原身份與旅程", async () => {
  const profile = values.get(STUDENT_IDENTITY_STORAGE_KEY), journey = values.get(STORAGE_KEY);
  click("#student-profile-open");
  assert(!document.getElementById("student-login-form") && !document.querySelector("[data-student-identity-field]"), "資料仍可修改");
  assertUsableLayout(); click("[data-student-identity-return]"); await until(() => document.body.dataset.view === "memories");
  assert(values.get(STUDENT_IDENTITY_STORAGE_KEY) === profile, "返回改動身份");
  click("#student-profile-open"); click("[data-student-identity-logout]");
  await until(() => document.getElementById("confirm-dialog").open);
  assert(document.getElementById("confirm-message").textContent.includes("學生資料、相片、打卡及已保存的待傳紀錄會保留"), "缺少登出提醒");
  click("#confirm-button"); await until(() => controller.getPageSnapshot().mode === "signedOut");
  assert(values.get(STUDENT_IDENTITY_STORAGE_KEY) === profile && values.get(STORAGE_KEY) === journey, "登出刪除身份或旅程");
  assertUsableLayout(); click("[data-student-identity-login]"); await until(() => document.body.dataset.view === "memories");
  await dismissSyncInvitation();
  assert(values.get(STUDENT_IDENTITY_STORAGE_KEY) === profile && values.get(STORAGE_KEY) === journey, "重新登入改動身份或旅程");
});
await check("0、1、12、13、120 張相片：相簿不混入製卡，隱藏相簿釋放預覽，紀錄卡仍可找到", async () => {
  for (const count of [0, 1, 12, 13, 120]) {
    await navigate("#memories"); await load(Array.from({ length: count }, (_, index) => photo(index)));
    assert(document.querySelectorAll(".memory-album").length === (count ? 1 : 0), "相簿數量錯誤");
    assert(!document.querySelector("[data-memory-summary-open], [data-memory-checkin-card-open]"), "分頁混入其他操作");
    click("#memory-tab-checkins"); await navigate("#memories/checkins");
    assert(live.size === 0 && document.querySelector("[data-memory-checkin-card-open]") && !document.querySelector("#memory-tab-ai, [data-memory-summary-open]"), "預覽未釋放或紀錄分頁混亂");
  }
});
await check("確定保留、× 取消；跨分頁保留已確定勾選，更多操作按需展開", async () => {
  await navigate("#memories"); await load(ids.map((_, index) => photo(0, index)));
  click(`[data-memory-album="${ids[0]}"]`); click(`[data-photo-select="${ids[0]}-0"]`); click("[data-memory-selection-confirm]");
  click(`[data-memory-album="${ids[1]}"]`);
  assert(!document.querySelector("[data-memory-download-album]").checkVisibility(), "更多操作預設展開");
  click(`[data-photo-select="${ids[1]}-0"]`); click("[data-memory-close]");
  assert(controller.getPageSnapshot().selectedCount === 1, "× 套用了未確定勾選");
  click("#memory-tab-checkins"); await navigate("#memories/checkins"); click("#memory-tab-albums"); await navigate("#memories");
  assert(controller.getPageSnapshot().selectedCount === 1, "切分頁清除已確定勾選");
});
await check("紀錄卡身份跨分頁保留；關閉與離開的規則不同", async () => {
  await navigate("#memories/checkins"); click("[data-memory-checkin-card-open]");
  input('[data-checkin-card-field="studentName"]', "合成學生"); input('[data-checkin-card-field="className"]', "測試班"); input('[data-checkin-card-field="studentNumber"]', "007");
  click("[data-checkin-card-close]"); assert(document.activeElement.id === "memory-checkin-card-open", "關閉未還原焦點");
  await navigate("#memories");
  await navigate("#memories/checkins"); click("[data-memory-checkin-card-open]");
  assert(document.getElementById("checkin-card-studentNumber").value === "007", "身份未保留前置零");
  click("[data-checkin-card-close]"); await navigate("#home"); await navigate("#memories/checkins"); click("[data-memory-checkin-card-open]");
  assert(document.getElementById("checkin-card-studentName").value === FIXTURE_IDENTITY.studentName && document.getElementById("checkin-card-studentNumber").value === FIXTURE_IDENTITY.studentNumber, "新草稿未重新帶入登入資料"); click("[data-checkin-card-close]");
});
await check("生成途中切分頁取消舊預覽，姓名草稿仍可重新開啟", async () => {
  click("[data-memory-checkin-card-open]");
  for (const [key, value] of Object.entries({ studentName: "合成學生", className: "測試班", studentNumber: "007" })) input(`[data-checkin-card-field="${key}"]`, value);
  let release; completionOverride = () => new Promise(resolve => { release = () => resolve(blob); });
  click("[data-checkin-card-preview]"); await until(() => release);
  await navigate("#memories"); release(); await pause(); await navigate("#memories/checkins"); click("[data-memory-checkin-card-open]");
  assert(!document.querySelector("#checkin-card-dialog .artwork-preview") && document.getElementById("checkin-card-studentName").value === "合成學生", "過期預覽恢復或草稿遺失");
  click("[data-checkin-card-close]");
});
await check("相簿讀取失敗有重試入口，紀錄卡仍可開啟", async () => {
  await navigate("#memories"); readFailure = true; await controller.start();
  assert(document.querySelector("[data-photos-retry]") && !document.querySelector("[data-memory-album]"), "讀取失敗沒有重試入口");
  await navigate("#memories/checkins"); click("[data-memory-checkin-card-open]"); assert(document.getElementById("checkin-card-dialog").open, "讀取失敗阻擋紀錄卡");
  click("[data-checkin-card-close]"); await navigate("#memories"); readFailure = false; click("[data-photos-retry]"); await until(() => controller.getPageSnapshot().readState === "ready");
});
await check("同頁收起、重新展開、進度及瀏覽器返回，不丟輸入或留下隱藏預覽", async () => {
  await navigate("#memories");
  click("#memory-tab-albums"); await until(() => controller.getPageSnapshot().section === null);
  assert(live.size === 0 && document.querySelectorAll('[data-section-view="memories"]').length === 2, "收起後仍有预覽或缺少標題");
  assert(document.activeElement.id === "memory-tab-albums", "收起後焦點丟失");
  click("#memory-tab-albums"); await until(() => document.getElementById("memory-tab-albums").getAttribute("aria-expanded") === "true");
  click("#memory-tab-checkins"); await navigate("#memories/checkins");
  assert(document.activeElement.id === "memory-tab-checkins" && document.querySelectorAll('.section-toggle[aria-expanded="true"]').length === 1, "沒有在原位切換");
  history.back(); await until(() => location.hash === "#memories" && document.getElementById("memory-tab-albums").getAttribute("aria-expanded") === "true");
  assert(controller.getPageSnapshot().selectedCount === 0, "離開回憶後選取未清除");
});
await check("六站打卡拍照常開，舊網址及返回仍可定位，日期定位不改資料", async () => {
  await navigate("#itinerary");
  assert(!document.querySelector('[data-attraction-toggle]') && document.querySelectorAll('.itinerary-stop-details').length === 6, "仍有收起操作或缺少景點");
  const allVisible = () => ["departure-school", ...ids].every(id => document.getElementById("itinerary-details-" + id)?.checkVisibility());
  assert(allVisible(), "部分景點仍被隱藏");
  for (const id of ["departure-school", ...ids]) {
    await navigate("#attraction/" + id);
    assert(controller.getPageSnapshot().view === "itinerary" && document.querySelectorAll('#app h1').length === 1 && document.querySelector('#app h1').textContent === "行程", "仍是獨立景點頁");
    assert(document.activeElement.id === "itinerary-stop-" + id && allVisible(), "焦點錯誤或隱藏其他站");
    const stop = document.querySelector('[data-stop-id="' + id + '"]');
    assert(stop.querySelector(id === "departure-school" ? '[data-checkin="' + id + '"]' : '[data-checkin-undo="' + id + '"]'), "本站操作缺失");
    assert(!document.querySelector('.back-link'), "仍需返回行程");
  }
  await navigate("#attraction/" + ids[0]);
  await navigate("#attraction/" + ids[1]);
  history.back(); await until(() => location.hash === "#attraction/" + ids[0] && document.activeElement.id === "itinerary-stop-" + ids[0]);
  assert(controller.getPageSnapshot().attraction.id === ids[0] && allVisible(), "返回隱藏其他景點");
  const beforeHash = location.hash, beforeState = values.get(STORAGE_KEY);
  click('[data-itinerary-day="3"]');
  assert(location.hash === beforeHash && values.get(STORAGE_KEY) === beforeState, "日期定位改變了網址或資料");
  assert(document.activeElement.id === "itinerary-day-3", "日期定位沒有移動鍵盤焦點");
  assert(document.querySelectorAll('.detail-hero img').length === ids.length && !document.querySelector('.stop-cover') && document.querySelectorAll('.stop-number').length === 11, "圖片重複或路線編號缺失");
  assert(!document.querySelector('[data-stop-id="departure-school"] .detail-hero img'), "已刪除的校舍照片重新出現");
});
await check("六站學習問題及提示已移除，打卡拍照和兩項導航入口正常", async () => {
  for (const id of ["departure-school", ...ids]) {
    await navigate(`#attraction/${id}`);
    assert(!document.querySelector('.learning-disclosure, .learning-grid, .question-label, [id^="learning-questions-"]'), "仍有學習問題控制項");
    assert(!/學習問題|現場觀察|學習提示/.test(document.getElementById("app").textContent), "仍有學習題目或提示");
    assert(!/個人紀錄，不作校方出席證明。|相片不會上傳；拍到同學前請先取得同意。|查看及下載相片，請按底部的「旅途回憶」。/.test(document.getElementById("app").textContent), "仍有已刪除的打卡或拍照說明");
    for (const field of ["questions", "questionNumbers", "observe", "prompt"]) assert(!Object.hasOwn(controller.getPageSnapshot().attraction, field), "仍有學習問題資料");
    const stop = document.querySelector('[data-stop-id="' + id + '"]');
    assert(stop.querySelector('.checkin-panel, .checked-in-panel') && stop.querySelector('.photo-panel'), "打卡或拍照被刪除");
    assert(!document.querySelector('.source-link') && !/在景點附近打卡|只讀取一次位置，不保存座標|資料來源：|位置資料/.test(document.getElementById("app").textContent), "仍有已刪除的說明或來源連結列");
    if (id !== "departure-school") assert(stop.querySelector('[data-native-camera-open]') && stop.querySelector('[data-camera-open]'), "拍照入口缺失");
    else assert(document.getElementById("app").textContent.includes("請在安全位置打卡及拍攝"), "安全提醒遺失");
  }
  assert(document.querySelectorAll('.bottom-nav a').length === 2 && !document.querySelector('#app a[href="#workbook"]'), "主入口重複");
});
await check("舊手冊網址顯示行程，不再有手冊操作，重新載入和返回正常", async () => {
  for (const hash of ["#workbook", "#workbook/essay", "#workbook/day1", "#workbook/works"]) {
    await navigate(hash);
    assert(controller.getPageSnapshot().view === "itinerary" && location.hash === hash, "舊網址未正常顯示行程");
    assert(!document.querySelector('[data-nav="workbook"], [data-workbook-field], [data-workbook-export-open]'), "仍有手冊入口或程式");
    await controller.start(); assert(controller.getPageSnapshot().view === "itinerary", "重新啟動恢復手冊頁");
  }
  await navigate("#memories"); history.back();
  await until(() => location.hash === "#workbook/works" && document.body.dataset.view === "itinerary");
});
function assertUsableLayout() {
  const width = document.documentElement.clientWidth;
  assert(document.documentElement.scrollWidth <= width + 1, `頁面橫向溢出：${location.hash}`);
  const roots = [document.getElementById("app"), ...document.querySelectorAll("dialog[open]")];
  const syncDialog = document.querySelector('.sync-dialog[open]');
  if (syncDialog) {
    assert(syncDialog.scrollWidth <= syncDialog.clientWidth + 1, "同步視窗出現橫向捲動");
    assert(syncDialog.querySelector('form').getBoundingClientRect().width <= syncDialog.clientWidth + 1, "同步表單超出視窗");
  }
  for (const root of roots) {
    for (const control of root.querySelectorAll(".button, .itinerary-day-link, .section-toggle, .icon-button, .text-link, summary, select, textarea, input:not([type=hidden]):not([type=radio]):not([type=checkbox])")) {
      if (!control.checkVisibility()) continue;
      const rect = control.getBoundingClientRect();
      const minHeight = control.matches(".icon-button, .text-link") ? 48 : control.matches("textarea, input, select") ? 52 : 56;
      assert(rect.height >= minHeight - .1, `操作太細：${control.textContent || control.id}`);
      assert(rect.right <= width + 1 && rect.left >= -1, `操作超出螢幕：${control.textContent || control.id}`);
      assert(control.scrollWidth <= control.clientWidth + 1, `操作文字被裁切：${control.textContent || control.id}`);
    }
  }
  const links = [...document.querySelectorAll(".bottom-nav a")];
  assert(links.length === 2 && links.every(link => link.querySelectorAll('svg[aria-hidden="true"][focusable="false"]').length === 1), "底部不是兩項導航及文字入口");
  assert(links.map(link => link.textContent.trim()).join("、") === "行程、旅途回憶", "導航名稱改變或圖示重複讀屏名稱");
  assert(!document.querySelector('svg:not([aria-hidden="true"]), svg title'), "裝飾圖示重複讀屏名稱");
  const widths = links.map(link => link.getBoundingClientRect().width);
  assert(Math.max(...widths) - Math.min(...widths) < 1, "導航不等寬");
}
await check("行程介紹各段可收合，標題與圖片保留，重畫和返回不丟狀態或改打卡", async () => {
  await navigate("#introduction");
  let introduction = document.getElementById("itinerary-introduction");
  assert(introduction.open && introduction.querySelector("summary").innerText.trim() === "返回打卡", "展開時入口未顯示返回打卡");
  click("#itinerary-introduction-heading");
  assert(!introduction.open && introduction.querySelector("summary").innerText.trim() === "行程介紹", "收起時入口未顯示行程介紹");
  click("#itinerary-introduction-heading");
  assert(introduction.open && introduction.querySelector("summary").innerText.trim() === "返回打卡", "再次展開時入口未顯示返回打卡");
  controller.render();
  introduction = document.getElementById("itinerary-introduction");
  assert(introduction.open && introduction.querySelector("summary").innerText.trim() === "返回打卡", "重畫改動介紹入口狀態或文字");
  const before = values.get(STORAGE_KEY), photos = [...records.values()];
  let topics = [...document.querySelectorAll(".introduction-topic-disclosure")];
  assert(topics.length === 7 && topics.every(topic => !topic.open), "介紹未分七段或預設沒有收起");
  assert(document.querySelectorAll(".introduction-source img").length === 10, "原圖片遺失");
  for (const topic of topics) {
    const toggle = topic.querySelector("summary"), content = document.getElementById(toggle.getAttribute("aria-controls"));
    assert(content && !content.checkVisibility(), "收起時正文仍顯示或讀屏關聯遺失");
    toggle.focus(); click(`#${toggle.id}`);
    assert(topic.open && content.checkVisibility() && document.activeElement === toggle, "展開失敗或焦點移走");
    assertUsableLayout();
    click(`#${toggle.id}`); assert(!topic.open && !content.checkVisibility(), "再次點標題未收起");
  }
  const firstId = topics[0].id, secondId = topics[1].id, toggleId = topics[0].querySelector("summary").id;
  document.getElementById(toggleId).focus(); click(`#${toggleId}`);
  controller.render();
  assert(document.getElementById(firstId).open && !document.getElementById(secondId).open && document.activeElement.id === toggleId, "重畫改動開關或焦點");
  await navigate("#memories"); history.back(); await until(() => location.hash === "#introduction" && document.querySelector(".introduction-source"));
  assert(document.getElementById(firstId).open && !document.getElementById(secondId).open, "返回丟失收合狀態");
  assert(!document.querySelector(".introduction-source").textContent.includes("點選即可開啟側邊面板，查看更多資訊"), "仍有指定提示");
  assert(values.get(STORAGE_KEY) === before && [...records.values()].every((record, index) => record === photos[index]), "介紹收合改動打卡或相片");
  assert(document.querySelectorAll(".itinerary-stop-details").length === 6 && !document.querySelector(".itinerary-stop details"), "打卡拍照被改成收合");
  click(`#${toggleId}`); assert(location.hash === "#introduction", "收合改動網址"); assertUsableLayout();
});
await check("正式行程底部測試控制可收起，五情境跨重畫及返回保留，不改正式資料", async () => {
  await navigate("#itinerary");
  let tools = document.getElementById("itinerary-test-controls");
  assert(tools && !tools.open && !tools.querySelector("select").checkVisibility(), "測試控制預設未收起");
  assert(tools === document.querySelector(".itinerary-page").lastElementChild, "測試工具不在行程底部");
  const before = values.get(STORAGE_KEY), beforePhotos = [...records.values()];
  click("#itinerary-test-title"); assert(tools.open, "無法展開測試工具"); assertUsableLayout();
  for (const scenario of ["within", "too-far", "inaccurate", "denied", "timeout"]) {
    const select = document.getElementById("itinerary-rehearsal-scenario");
    select.value = scenario; select.dispatchEvent(new Event("change", { bubbles: true }));
    const link = document.getElementById("itinerary-rehearsal-open");
    assert(new URL(link.href).searchParams.get("scenario") === scenario && new URL(link.href).hash === "#itinerary", "情境連結錯誤");
    assert(link.target === "_blank" && link.rel.includes("noopener"), "預演未分開開啟");
    controller.render(); tools = document.getElementById("itinerary-test-controls");
    assert(tools.open && document.getElementById("itinerary-rehearsal-scenario").value === scenario, "重畫丟失情境或收起工具");
  }
  document.getElementById("itinerary-test-title").focus(); click("#itinerary-test-title");
  assert(!tools.open && document.activeElement.id === "itinerary-test-title", "收起丟失焦點");
  await navigate("#memories"); assert(!document.getElementById("itinerary-test-controls"), "測試工具干擾回憶頁");
  history.back(); await until(() => location.hash === "#itinerary" && document.getElementById("itinerary-test-controls"));
  tools = document.getElementById("itinerary-test-controls");
  assert(!tools.open && document.getElementById("itinerary-rehearsal-scenario").value === "timeout", "返回丟失選擇或折疊狀態");
  click("#itinerary-test-title"); assertUsableLayout();
  assert(tools.querySelector('a[href="./device-test.html?mode=diagnostics"]'), "診斷入口遺失");
  assert(values.get(STORAGE_KEY) === before && [...records.values()].every((record, index) => record === beforePhotos[index]), "測試控制改動正式紀錄或相片");
  click("#itinerary-test-title");
});
function contrastRatio(element) {
  const rgb = color => color.match(/[\d.]+/g).map(Number).slice(0, 3).map(value => { const v = value / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
  const luminance = color => { const [r, g, b] = rgb(color); return .2126 * r + .7152 * g + .0722 * b; };
  let parent = element, background = "rgb(255, 255, 255)";
  while (parent) {
    const color = getComputedStyle(parent).backgroundColor;
    if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent") { background = color; break; }
    parent = parent.parentElement;
  }
  const values = [luminance(getComputedStyle(element).color), luminance(background)].sort((a, b) => a - b);
  return (values[1] + .05) / (values[0] + .05);
}
await check("所有頁面及正常／未核實狀態：文字對比、觸控尺寸、暖灰背景與兩項導航", async () => {
  await load(ids.map((_, index) => photo(0, index)));
  for (const hash of ["#home", "#itinerary", "#introduction", "#attraction/departure-school", ...ids.map(id => `#attraction/${id}`), "#memories", "#memories/ai", "#memories/checkins", "#workbook", ...["essay", "share", "day1", "day2", "day3", "reflection", "works"].map(id => `#workbook/${id}`)]) {
    await navigate(hash); assertUsableLayout();
    assert(!/在景點附近打卡|只讀取一次位置，不保存座標|相片只存在這部裝置，不會上傳或自動加入手機相簿；人樣及背景仍可能透露身份/.test(document.getElementById("app").textContent), "仍有已刪除的說明");
    assert(!document.querySelector('.privacy-banner') && !document.getElementById("app").textContent.includes("位置與相片不會上傳"), "仍有已刪除的說明區塊");
    assert(!document.querySelector('.learning-disclosure, .learning-grid, .question-label'), "仍有學習問題區域");
    assert(getComputedStyle(document.body).backgroundColor === "rgb(247, 248, 245)", "頁面不是近白暖灰背景");
    const heading = document.querySelector("#app h1"); assert(heading && getComputedStyle(heading).fontWeight === "700", "主標題或字重錯誤");
    for (const node of document.querySelectorAll("#app h1, #app h2, #app h3, #app p, #app small, #app label, #app .button, #app .status-badge, .bottom-nav a, .itinerary-day-link, .section-toggle, .stop-number")) {
      if (node.checkVisibility() && !node.disabled) assert(contrastRatio(node) >= 4.5, `文字對比不足：${node.textContent}`);
    }
    assert(!document.querySelector("#app .day-marker, #app .stamp-mark, #app .learning-number, .confirm-icon"), "裝飾仍在頁面");
    if (hash === "#memories") assert(document.querySelectorAll('.memory-tabs > button').length === 2 && !document.querySelector("#memory-tab-ai"), "回憶不是同頁兩項分段按鈕");
    if (hash === "#itinerary") assert(document.querySelector('.itinerary-progress progress').value === controller.getPageSnapshot().checkInProgress.filled, "打卡進度不是實際資料");
  }
});
await check("相簿／大圖／紀錄卡：窄螢幕及放大文字仍可確認與關閉", async () => {
  await navigate("#memories"); click(`[data-memory-album="${ids[0]}"]`); assertUsableLayout();
  click(`[data-memory-photo="${ids[0]}-0"]`); assertUsableLayout(); click("[data-memory-card-toggle]"); assertUsableLayout(); click("[data-memory-close]");
  await navigate("#memories/checkins"); click("[data-memory-checkin-card-open]"); assertUsableLayout(); click("[data-checkin-card-close]");
});
if (syncTesting) await check("同步確認：毋須活動碼、錯誤可重試、取消等待不啟用、手動補傳及等待狀態", async () => {
  await navigate("#itinerary"); click("[data-check-in-sync]"); assertUsableLayout();
  assert(!document.querySelector('#check-in-sync-form input'), "仍有活動碼欄位");
  assert(document.getElementById("sync-dialog-cutoff").textContent.includes("2026年11月9日晚上11:59（香港時間）"), "啟用前沒有顯示正確截止");
  const enableButton = document.getElementById("sync-enable");
  assert(document.activeElement === enableButton, "啟用確認焦點不正確");
  syncReply = "fail";
  document.getElementById("check-in-sync-form").requestSubmit(); await until(() => !document.getElementById("sync-dialog-error").hidden);
  assert(document.activeElement === enableButton && !enableButton.disabled, "錯誤沒有重試入口及焦點"); assertUsableLayout();
  syncReply = "wait"; document.getElementById("check-in-sync-form").requestSubmit(); await until(() => Boolean(releaseSync));
  const enablingCount = syncRequests.length; document.getElementById("check-in-sync-form").requestSubmit(); await pause();
  assert(enableButton.disabled && syncRequests.length === enablingCount, "等待啟用時可重複提交"); assertUsableLayout();
  click('[data-sync-dismiss]'); releaseSync(); releaseSync = null; await pause();
  assert(!controller.getPageSnapshot().sync.enabled && !(await syncRepository.read())?.enrollment, "取消後的遲來回覆仍啟用同步");
  syncReply = "normal"; click("[data-check-in-sync]"); document.getElementById("check-in-sync-form").requestSubmit();
  await until(() => !document.getElementById("check-in-sync-dialog").open);
  assert(controller.getPageSnapshot().sync.enabled && controller.getPageSnapshot().sync.pending === 0, "啟用回傳了舊打卡");
  assert(document.getElementById("check-in-sync-action").disabled, "沒有待傳紀錄仍可上傳");
  click(`[data-checkin-undo="${ids[0]}"]`); await until(() => document.querySelector('#confirm-dialog[open]')); click("#confirm-button");
  await until(() => !controller.getPageSnapshot().checkIns[ids[0]]);
  assert((await syncRepository.read()).pending.length === 0, "取消啟用前的舊紀錄也上傳了");
  syncReply = "fail"; click(`[data-checkin="${ids[0]}"]`); await until(() => document.querySelector('#confirm-dialog[open]')); click("#confirm-button");
  await until(() => controller.getPageSnapshot().sync.status === "排隊上傳" && controller.getPageSnapshot().sync.reason.includes("自動重試"));
  assert(controller.getPageSnapshot().checkIns[ids[0]] && controller.getPageSnapshot().sync.pending === 1, "上傳失敗取消了本機打卡"); assertUsableLayout();
  syncReply = "wait"; const queuedCount = syncRequests.length; click("[data-check-in-sync]"); await pause();
  assert(document.getElementById("check-in-sync-action").disabled && syncRequests.length === queuedCount, "連按略過排隊等候");
  await until(() => Boolean(releaseSync), 35000);
  assert(document.getElementById("check-in-sync-action").disabled && controller.getPageSnapshot().sync.busy, "等待時未鎖住連按"); assertUsableLayout();
  const count = syncRequests.length; click("[data-check-in-sync]"); await pause(); assert(syncRequests.length === count, "連按重啟工作");
  syncReply = "normal"; releaseSync(); await until(() => controller.getPageSnapshot().sync.status === "已上傳");
  assert((await syncRepository.read()).pending.length === 0, "收到確認後未移除待傳"); assertUsableLayout();
});
if (syncTesting) await check("Google 回報截止：停用同步操作、顯示截止日期，不清已保存打卡和相片", async () => {
  const savedPhotos = records.size;
  click(`[data-checkin-undo="${ids[0]}"]`); await until(() => document.querySelector('#confirm-dialog[open]')); click("#confirm-button");
  await until(() => !controller.getPageSnapshot().checkIns[ids[0]]); await until(() => controller.getPageSnapshot().sync.pending === 0 && !controller.getPageSnapshot().sync.busy);
  await until(() => Boolean(document.querySelector(`[data-checkin="${ids[0]}"]`)));
  syncReply = "closed"; click(`[data-checkin="${ids[0]}"]`); await until(() => document.querySelector('#confirm-dialog[open]')); click("#confirm-button");
  await until(() => controller.getPageSnapshot().sync.closed);
  assert(controller.getPageSnapshot().checkIns[ids[0]] && (await syncRepository.read()).pending.length === 1, "截止刪除了打卡或待傳資料");
  assert(records.size === savedPhotos, "截止改動相片");
  assert(document.getElementById("check-in-sync-action").disabled && document.getElementById("check-in-sync-action").textContent === "已截止", "截止仍可提交");
  assert(document.getElementById("check-in-sync-cutoff").textContent.includes("11月9日晚上11:59"), "日期不正確"); assertUsableLayout();
});
await check("同步使用真實 IndexedDB：跨分頁交易不覆寫、離線重開、同時自動／手動、停止後不恢復", async () => {
  const dbName = `fixture-check-in-sync-${crypto.randomUUID()}`;
  const isolatedDB = { open(name, version) { assert(name === SYNC_DATABASE_NAME, "讀取非測試佇列"); return indexedDB.open(dbName, version); } };
  const repository = createSyncRepository(isolatedDB), requests = [];
  let online = true, session, release, waiting = false;
  const profile = { studentName: "合成學生", className: "測試班", studentNumber: "007" };
  const environment = { document, window, Math: { random: () => 0 }, Date: SyncFixtureDate, crypto, navigator: { get onLine() { return online; }, locks: navigator.locks }, indexedDB: isolatedDB,
    fetch: async (_url, options) => {
      assert(options.mode === "cors" && options.credentials === "omit", "錯誤網絡模式");
      const body = JSON.parse(options.body); requests.push(body);
      if (body.action === "enable") { session = body.sessionId; return { ok: true, text: async () => JSON.stringify({ version: 1, activityId: SYNC_ACTIVITY_ID, ok: true, sessionId: session, ticket: "fixture", expiresAt: SYNC_UPLOAD_CUTOFF }) }; }
      if (waiting) await new Promise(resolve => { release = resolve; });
      return { ok: true, text: async () => JSON.stringify({ version: 1, activityId: SYNC_ACTIVITY_ID, ok: true, sessionId: session, accepted: body.events.map(item => item.eventId) }) };
    } };
  const options = { environment, repository, getIdentity: () => profile, endpoint: "https://script.google.com/macros/s/fixture/exec" };
  const first = createCheckInSync(options), second = createCheckInSync(options);
  await first.start(); assert(await first.enable(), "啟用失敗"); online = false; await second.start();
  const stamp = id => ({ attractionId: id, checkedInAt: "2026-11-05T04:00:00.000Z", method: "manual", verified: false });
  await Promise.all([first.enqueue(stamp(ids[0])), second.enqueue(stamp(ids[1]))]);
  const queued = await repository.read(); assert(queued.pending.length === 2 && queued.pending[1].sequence === 2, "跨分頁覆寫了待傳紀錄");
  await second.enqueue(stamp(ids[0]), "cancel"); assert((await repository.read()).pending[2].checkInId === queued.pending[0].eventId, "取消失去原打卡關聯");
  await first.stop(); await second.stop(); const reopened = createCheckInSync(options); await reopened.start();
  assert(reopened.getState().pending === 3 && reopened.getState().disabled, "離線重開丟失佇列");
  online = true; waiting = true; const upload = reopened.upload(); await until(() => Boolean(release));
  assert(reopened.upload() === upload && reopened.getState().busy, "連按未共用同一工作");
  await reopened.stop({ clear: true }); release(); await upload;
  assert((await repository.read()).pending.length === 0 && !(await repository.read()).enrollment, "遲來回覆恢復已清除的資料");
  assert(requests.filter(item => item.action === "submit").length === 1, "重複啟動上傳");
  assert(!JSON.stringify(requests).includes("latitude") && !JSON.stringify(requests).includes("blob"), "上傳了不需要的資料");
});
const summary = document.getElementById("test-summary"); summary.textContent = `${passed} 通過，${failed} 失敗`; summary.dataset.done = "true"; summary.dataset.failed = String(failed);
