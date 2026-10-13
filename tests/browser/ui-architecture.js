import { seedStudentIdentityForFixture, FIXTURE_IDENTITY, createFixtureIndexedDB } from "../helpers/browser-environment.js";
import { STUDENT_IDENTITY_STORAGE_KEY } from "../../src/student-identity.js";
import { createAppController } from "../../src/controller.js";
import { createDefaultState, STORAGE_KEY } from "../../src/state.js";
import { REQUIRED_CHECK_IN_LOCATIONS } from "../../src/data.js";

const assert = (condition, message) => { if (!condition) throw Error(message); };
if (new URLSearchParams(location.search).get("textZoom") === "200") document.documentElement.classList.add("text-zoom");
const ids = REQUIRED_CHECK_IN_LOCATIONS.map(item => item.id);
const state = createDefaultState();
for (const id of ids) state.checkIns[id] = { attractionId: id, checkedInAt: "2026-11-05T04:00:00Z", verified: false, method: "manual" };
const values = new Map([[STORAGE_KEY, JSON.stringify(state)]]), records = new Map(), live = new Set();
seedStudentIdentityForFixture({ getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) });
const canvas = document.createElement("canvas"); canvas.width = 80; canvas.height = 60;
canvas.getContext("2d").fillRect(0, 0, 80, 60);
const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg"));
function photo(index, station = 0) { return { attractionId: ids[station], photoId: `${ids[station]}-${index}`, writeId: `${station}-${index}`,
  width: 80, height: 60, createdAt: new Date(Date.UTC(2026, 10, 5, 4, 0, index)).toISOString(), blob }; }
class FixtureURL extends URL {
  static createObjectURL(value) { const url = URL.createObjectURL(value); live.add(url); return url; }
  static revokeObjectURL(url) { live.delete(url); URL.revokeObjectURL(url); }
}
let readFailure = false, completionOverride, identityWriteBlocked = false;
const controller = createAppController({
  environment: { document, window, location, URL: FixtureURL, requestAnimationFrame, indexedDB: createFixtureIndexedDB(indexedDB),
    localStorage: { getItem: key => values.get(key), setItem: (key, value) => { if (identityWriteBlocked && key === STUDENT_IDENTITY_STORAGE_KEY) throw Error("合成保存失敗"); values.set(key, value); }, removeItem: key => values.delete(key) },
    navigator: { onLine: true } },
  photoService: { getAllPhotoRecords: async () => { if (readFailure) throw Error("fixture error"); return [...records.values()]; } },
  completionCardService: options => completionOverride(options)
});
const pause = () => new Promise(resolve => setTimeout(resolve, 10));
async function until(condition) { const end = Date.now() + 12000; while (!condition()) { if (Date.now() > end) throw Error("等待逾時"); await pause(); } }
const click = selector => { const target = document.querySelector(selector); assert(target, `缺少 ${selector}`); target.click(); };
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
await check("登入門檻、逐欄錯誤及中文組字：不重畫輸入，登入後保留舊網址", async () => {
  const journey = values.get(STORAGE_KEY), hash = location.hash;
  values.delete(STUDENT_IDENTITY_STORAGE_KEY);
  window.dispatchEvent(new StorageEvent("storage", { key: STUDENT_IDENTITY_STORAGE_KEY }));
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
  assert(location.hash === hash && values.get(STORAGE_KEY) === journey && JSON.parse(values.get(STUDENT_IDENTITY_STORAGE_KEY)).studentNumber === "001", "登入改動網址、旅程或前置零");
});
await check("修改可取消，登出只清身份；保存失敗保留输入及本次使用入口", async () => {
  const profile = values.get(STUDENT_IDENTITY_STORAGE_KEY), journey = values.get(STORAGE_KEY);
  click("#student-profile-open"); input('[data-student-identity-field="studentName"]', "取消這次");
  click("[data-student-identity-cancel]"); assert(values.get(STUDENT_IDENTITY_STORAGE_KEY) === profile, "取消保存了修改");
  click("#student-profile-open"); click("[data-student-identity-logout]");
  await until(() => document.getElementById("confirm-dialog").open);
  assert(document.getElementById("confirm-message").textContent.includes("相片與打卡會保留"), "缺少登出提醒");
  click("#confirm-button"); await until(() => !values.has(STUDENT_IDENTITY_STORAGE_KEY));
  assert(controller.getPageSnapshot().view === "login" && values.get(STORAGE_KEY) === journey, "登出刪除旅程");
  identityWriteBlocked = true;
  for (const [key, value] of Object.entries(FIXTURE_IDENTITY)) input(`[data-student-identity-field="${key}"]`, value);
  document.getElementById("student-login-form").requestSubmit(); await until(() => controller.getPageSnapshot().saveFailed);
  assert(document.getElementById("student-login-studentName").value === FIXTURE_IDENTITY.studentName && !values.has(STUDENT_IDENTITY_STORAGE_KEY), "失敗丟輸入或虛報保存");
  assertUsableLayout(); click("[data-student-identity-temporary]"); await until(() => document.body.dataset.view === "memories");
  assert(!values.has(STUDENT_IDENTITY_STORAGE_KEY), "本次使用仍保存身份");
  identityWriteBlocked = false; click("#student-profile-open"); document.getElementById("student-login-form").requestSubmit();
  await until(() => document.body.dataset.view === "memories");
  assert(values.get(STORAGE_KEY) === journey, "重試改動旅程");
});
await check("0、1、12、13、120 張相片：相簿不混入製卡，AI 缺照指引仍可找到，隱藏相簿不保留預覽", async () => {
  for (const count of [0, 1, 12, 13, 120]) {
    await navigate("#memories"); await load(Array.from({ length: count }, (_, index) => photo(index)));
    assert(document.querySelectorAll(".memory-album").length === (count ? 1 : 0), "相簿數量錯誤");
    assert(!document.querySelector("[data-memory-summary-open], [data-memory-checkin-card-open]"), "分頁混入其他操作");
    click("#memory-tab-ai"); await navigate("#memories/ai");
    assert(live.size === 0 && document.querySelectorAll(".summary-missing a").length === (count ? 4 : 5), "補拍或預覽釋放錯誤");
    click("#memory-tab-checkins"); await navigate("#memories/checkins");
    assert(document.querySelector("[data-memory-checkin-card-open]") && !document.querySelector("[data-memory-summary-open]"), "紀錄分頁混亂");
  }
});
await check("確定保留、× 取消；跨分頁保留已確定勾選，更多操作按需展開", async () => {
  await navigate("#memories"); await load(ids.map((_, index) => photo(0, index)));
  click(`[data-memory-album="${ids[0]}"]`); click(`[data-photo-select="${ids[0]}-0"]`); click("[data-memory-selection-confirm]");
  click(`[data-memory-album="${ids[1]}"]`);
  assert(!document.querySelector("[data-memory-download-album]").checkVisibility(), "更多操作預設展開");
  click(`[data-photo-select="${ids[1]}-0"]`); click("[data-memory-close]");
  assert(controller.getPageSnapshot().selectedCount === 1, "× 套用了未確定勾選");
  click("#memory-tab-ai"); await navigate("#memories/ai"); click("#memory-tab-albums"); await navigate("#memories");
  assert(controller.getPageSnapshot().selectedCount === 1, "切分頁清除已確定勾選");
});
await check("AI 選圖及身份跨分頁保留；關閉與離開的規則不同", async () => {
  await navigate("#memories/ai"); click("[data-memory-summary-open]"); click(`[data-memory-pick="${ids[0]}"]`);
  click(`[data-summary-photo-id="${ids[0]}-0"]`); click("[data-memory-close]");
  await navigate("#memories/checkins"); click("[data-memory-checkin-card-open]");
  input('[data-checkin-card-field="studentName"]', "合成學生"); input('[data-checkin-card-field="className"]', "測試班"); input('[data-checkin-card-field="studentNumber"]', "007");
  click("[data-checkin-card-close]"); assert(document.activeElement.id === "memory-checkin-card-open", "關閉未還原焦點");
  await navigate("#memories/ai"); assert(controller.getPageSnapshot().summaryCard.requiredSelectedCount === 1, "AI 選圖遺失");
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
  await navigate("#memories/ai"); release(); await pause(); await navigate("#memories/checkins"); click("[data-memory-checkin-card-open]");
  assert(!document.querySelector("#checkin-card-dialog .artwork-preview") && document.getElementById("checkin-card-studentName").value === "合成學生", "過期預覽恢復或草稿遺失");
  click("[data-checkin-card-close]");
});
await check("AI 讀取失敗有重試入口，紀錄卡仍可開啟，不誤報缺照", async () => {
  await navigate("#memories/ai"); readFailure = true; await controller.start();
  assert(!document.querySelector(".summary-warning") && document.querySelector("[data-photos-retry]"), "失敗誤報或不能重試");
  await navigate("#memories/checkins"); click("[data-memory-checkin-card-open]"); assert(document.getElementById("checkin-card-dialog").open, "讀取失敗阻擋紀錄卡");
  click("[data-checkin-card-close]"); await navigate("#memories/ai"); readFailure = false; click("[data-photos-retry]"); await until(() => controller.getPageSnapshot().readState === "ready");
});
await check("同頁收起、重新展開、進度及瀏覽器返回，不丟輸入或留下隱藏預覽", async () => {
  await navigate("#memories");
  click("#memory-tab-albums"); await until(() => controller.getPageSnapshot().section === null);
  assert(live.size === 0 && document.querySelectorAll('[data-section-view="memories"]').length === 3, "收起後仍有预覽或缺少標題");
  assert(document.activeElement.id === "memory-tab-albums", "收起後焦點丟失");
  click("#memory-tab-albums"); await until(() => document.getElementById("memory-tab-albums").getAttribute("aria-expanded") === "true");
  click("#memory-tab-ai"); await navigate("#memories/ai");
  assert(document.activeElement.id === "memory-tab-ai" && document.querySelectorAll('.section-toggle[aria-expanded="true"]').length === 1, "沒有在原位切換");
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
    if (hash === "#memories") assert(document.querySelectorAll('.memory-tabs > button').length === 3, "回憶不是同頁三項分段按鈕");
    if (hash === "#itinerary") assert(document.querySelector('.itinerary-progress progress').value === controller.getPageSnapshot().checkInProgress.filled, "打卡進度不是實際資料");
  }
});
await check("相簿／大圖／選圖／身份視窗：窄螢幕及放大文字仍可確認與關閉", async () => {
  await navigate("#memories"); click(`[data-memory-album="${ids[0]}"]`); assertUsableLayout();
  click(`[data-memory-photo="${ids[0]}-0"]`); assertUsableLayout(); click("[data-memory-card-toggle]"); assertUsableLayout(); click("[data-memory-close]");
  await navigate("#memories/ai"); click("[data-memory-summary-open]"); assertUsableLayout(); click(`[data-memory-pick="${ids[0]}"]`); assertUsableLayout(); click("[data-memory-close]");
  click("[data-memory-artwork-open]"); assertUsableLayout(); click("[data-artwork-close]");
  await navigate("#memories/checkins"); click("[data-memory-checkin-card-open]"); assertUsableLayout(); click("[data-checkin-card-close]");
});
const summary = document.getElementById("test-summary"); summary.textContent = `${passed} 通過，${failed} 失敗`; summary.dataset.done = "true"; summary.dataset.failed = String(failed);
