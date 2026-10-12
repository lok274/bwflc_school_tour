import { createAppController } from "../../src/controller.js";
import { createDefaultState, STORAGE_KEY } from "../../src/state.js";
import { REQUIRED_CHECK_IN_LOCATIONS } from "../../src/data.js";
import { memoryWorkbookRepository } from "../helpers/workbook-repository.js";

const assert = (condition, message) => { if (!condition) throw Error(message); };
if (new URLSearchParams(location.search).get("textZoom") === "200") document.documentElement.classList.add("text-zoom");
const ids = REQUIRED_CHECK_IN_LOCATIONS.map(item => item.id);
const state = createDefaultState();
for (const id of ids) state.checkIns[id] = { attractionId: id, checkedInAt: "2026-11-05T04:00:00Z", verified: false, method: "manual" };
const values = new Map([[STORAGE_KEY, JSON.stringify(state)]]), records = new Map(), live = new Set();
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
const repository = memoryWorkbookRepository();
const controller = createAppController({
  environment: { document, window, location, URL: FixtureURL, requestAnimationFrame, indexedDB,
    localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    navigator: { onLine: true } },
  photoService: { getAllPhotoRecords: async () => { if (readFailure) throw Error("fixture error"); return [...records.values()]; } },
  workbookRepository: repository,
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
      route.view === "workbook" ? document.querySelector(".workbook-page") && (controller.getPageSnapshot().part?.id ?? null) === route.section : document.body.dataset.view === route.view && (!route.attractionId || document.getElementById(`itinerary-stop-${route.attractionId}`)?.getAttribute("aria-expanded") === "true");
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
  assert(document.getElementById("checkin-card-studentName").value === "", "離開回憶殘留身份"); click("[data-checkin-card-close]");
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
  await navigate("#workbook/essay"); input("#wb-essay-title", "同頁合成文章");
  click("#wb-section-essay"); await until(() => !controller.getPageSnapshot().part && !document.getElementById("app").inert);
  assert((await repository.read()).draft.answers["essay-title"] === "同頁合成文章", "收起前沒有保存");
  assert(document.querySelectorAll('[data-section-view="workbook"]').length === 7 && document.activeElement.id === "wb-section-essay", "手冊標題或焦點錯誤");
  click("#wb-section-essay"); await until(() => document.getElementById("wb-essay-title"));
  assert(document.getElementById("wb-essay-title").value === "同頁合成文章", "重新展開遺失輸入");
  input("#wb-essay-body", "同頁合成正文");
  assert(document.getElementById("wb-progress-essay").textContent.includes("2／2"), "進度沒有即時更新");
  const meter = document.getElementById("wb-meter-essay");
  assert(meter.max === 2 && meter.value === 2, "進度條沒有使用真實填寫數據");
  click("#wb-section-day1"); await navigate("#workbook/day1");
  click("#wb-section-day2"); await navigate("#workbook/day2");
  history.back(); await until(() => location.hash === "#workbook/day1" && document.getElementById("wb-section-day1").getAttribute("aria-expanded") === "true");
  assert(controller.getPageSnapshot().answers["essay-body"] === "同頁合成正文", "返回丟失輸入");
});
await check("行程原位展開、收起及返回景點，焦點和本站操作不混入其他站", async () => {
  await navigate("#itinerary");
  assert(document.querySelectorAll('[data-attraction-toggle]').length === 6 && !document.querySelector('[data-checkin], [data-checkin-undo]'), "收起時仍能打卡");
  for (const id of ["departure-school", ...ids]) {
    click(`#itinerary-stop-${id}`); await navigate(`#attraction/${id}`);
    assert(controller.getPageSnapshot().view === "itinerary" && document.querySelectorAll('#app h1').length === 1 && document.querySelector('#app h1').textContent === "行程", "仍是獨立景點頁");
    assert(document.activeElement.id === `itinerary-stop-${id}` && document.querySelectorAll('.itinerary-stop-toggle[aria-expanded="true"]').length === 1, "焦點或展開數不正確");
    assert(document.querySelector('[data-checkin], [data-checkin-undo]').dataset[id === "departure-school" ? "checkin" : "checkinUndo"] === id, "出現其他站操作");
    assert(!document.querySelector('.back-link'), "仍需返回行程");
    click(`#itinerary-stop-${id}`); await until(() => !controller.getPageSnapshot().attraction);
    assert(document.getElementById(`itinerary-details-${id}`).hidden && !document.querySelector('[data-native-camera-open]'), "收起仍有拍照控制項");
    assert(document.activeElement.id === `itinerary-stop-${id}`, "收起後焦點遺失");
  }
  click(`#itinerary-stop-${ids[0]}`); await navigate(`#attraction/${ids[0]}`);
  click(`#itinerary-stop-${ids[1]}`); await navigate(`#attraction/${ids[1]}`);
  history.back(); await until(() => document.getElementById(`itinerary-stop-${ids[0]}`).getAttribute('aria-expanded') === 'true');
  assert(controller.getPageSnapshot().attraction.id === ids[0], "返回沒有重新展開原景點");
  const beforeHash = location.hash;
  click('[data-itinerary-day="3"]');
  assert(location.hash === beforeHash && controller.getPageSnapshot().attraction.id === ids[0], "日期定位改變了網址或景點");
  assert(document.activeElement.id === "itinerary-day-3", "日期定位沒有移動鍵盤焦點");
  assert(document.querySelectorAll('.stop-cover').length === 2 && document.querySelectorAll('.stop-number').length === 11, "圖片重複或路線編號缺失");
});
await check("景點操作先於完整原題，折疊展開、打卡按鈕及三項底部入口正常", async () => {
  await navigate("#attraction/future-school");
  const questions = document.querySelector(".learning-disclosure"); assert(!questions.open, "題目預設展開");
  assert(document.querySelector(".checked-in-panel").getBoundingClientRect().top < questions.getBoundingClientRect().top, "操作沒有先出現");
  questions.querySelector("summary").click(); assert(questions.querySelectorAll(".learning-grid section").length === 4, "原題缺失");
  assert(document.querySelectorAll('.bottom-nav a').length === 3 && !document.querySelector('#app a[href="#workbook"]'), "主入口重複");
});
await check("手冊頂部 PDF、備份與暫存，中文組字及同頁展開保留文字", async () => {
  await navigate("#workbook/day1"); await until(() => controller.getPageSnapshot().initialized);
  const field = document.querySelector("[data-workbook-field]");
  assert(document.querySelectorAll("[data-workbook-export-open]").length === 1, "PDF 重複入口");
  assert(document.querySelector("[data-workbook-export-open]").getBoundingClientRect().top < field.getBoundingClientRect().top, "PDF 仍在長頁底部");
  field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })); field.value = "中文組字的合成內容";
  field.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true })); controller.render(); assert(field.isConnected, "組字被重畫");
  const meter = document.getElementById("wb-meter-day1");
  assert(meter.isConnected && field.isConnected, "組字期間更新狀態重畫了欄位或進度條");
  field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  assert(document.getElementById("wb-meter-day1").value >= 1, "組字完成後沒有更新填寫進度");
  const id = field.dataset.workbookField; click('#wb-section-day2'); await navigate("#workbook/day2");
  await until(() => document.getElementById("workbook-save-status").textContent.includes("已自動暫存"));
  assert(controller.getPageSnapshot().answers[id] === "中文組字的合成內容", "切頁丟失輸入");
  click("[data-workbook-backup-toggle]"); assert(document.getElementById("wb-backup-panel").checkVisibility(), "備份不能開啟");
  click("[data-workbook-backup-toggle]"); assert(document.activeElement.id === "wb-backup-open", "備份收起未恢復焦點");
});
function assertUsableLayout() {
  const width = document.documentElement.clientWidth;
  assert(document.documentElement.scrollWidth <= width + 1, `頁面橫向溢出：${location.hash}`);
  const roots = [document.getElementById("app"), ...document.querySelectorAll("dialog[open]")];
  for (const root of roots) {
    for (const control of root.querySelectorAll(".button, .itinerary-stop-toggle, .itinerary-day-link, .section-toggle, .icon-button, .text-link, summary, textarea, input:not([type=hidden]):not([type=radio]):not([type=checkbox])")) {
      if (!control.checkVisibility()) continue;
      const rect = control.getBoundingClientRect();
      const minHeight = control.matches(".icon-button, .text-link") ? 48 : control.matches("textarea, input") ? 52 : 56;
      assert(rect.height >= minHeight - .1, `操作太細：${control.textContent || control.id}`);
      assert(rect.right <= width + 1 && rect.left >= -1, `操作超出螢幕：${control.textContent || control.id}`);
      assert(control.scrollWidth <= control.clientWidth + 1, `操作文字被裁切：${control.textContent || control.id}`);
    }
  }
  const links = [...document.querySelectorAll(".bottom-nav a")];
  assert(links.length === 3 && links.every(link => link.querySelectorAll('svg[aria-hidden="true"][focusable="false"]').length === 1), "底部不是三個圖示及文字入口");
  assert(links.map(link => link.textContent.trim()).join("、") === "行程、旅途回憶、學習手冊", "導航名稱改變或圖示重複讀屏名稱");
  assert(!document.querySelector('svg:not([aria-hidden="true"]), svg title'), "裝飾圖示重複讀屏名稱");
  const widths = links.map(link => link.getBoundingClientRect().width);
  assert(Math.max(...widths) - Math.min(...widths) < 1, "導航不等寬");
}
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
await check("所有頁面及正常／未核實狀態：文字對比、觸控尺寸、暖灰背景與三項導航", async () => {
  await load(ids.map((_, index) => photo(0, index)));
  for (const hash of ["#home", "#itinerary", "#introduction", "#attraction/departure-school", ...ids.map(id => `#attraction/${id}`), "#memories", "#memories/ai", "#memories/checkins", "#workbook", ...["essay", "share", "day1", "day2", "day3", "reflection", "works"].map(id => `#workbook/${id}`)]) {
    await navigate(hash); assertUsableLayout();
    assert(getComputedStyle(document.body).backgroundColor === "rgb(247, 248, 245)", "頁面不是近白暖灰背景");
    const heading = document.querySelector("#app h1"); assert(heading && getComputedStyle(heading).fontWeight === "700", "主標題或字重錯誤");
    for (const node of document.querySelectorAll("#app h1, #app h2, #app h3, #app p, #app small, #app label, #app .button, #app .status-badge, .bottom-nav a, .itinerary-stop-toggle, .itinerary-day-link, .section-toggle, .stop-cover figcaption, .stop-number")) {
      if (node.checkVisibility() && !node.disabled) assert(contrastRatio(node) >= 4.5, `文字對比不足：${node.textContent}`);
    }
    assert(!document.querySelector("#app .day-marker, #app .stamp-mark, #app .learning-number, .confirm-icon"), "裝飾仍在頁面");
    if (hash === "#memories") assert(document.querySelectorAll('.memory-tabs > button').length === 3, "回憶不是同頁三項分段按鈕");
    if (hash === "#workbook/essay") assert(document.querySelectorAll('.accordion-part progress').length === 6, "手冊可填寫部分缺少進度條");
    if (hash === "#itinerary") assert(document.querySelector('.itinerary-progress progress').value === controller.getPageSnapshot().checkInProgress.filled, "打卡進度不是實際資料");
  }
});
await check("相簿／大圖／選圖／身份視窗：窄螢幕及放大文字仍可確認與關閉", async () => {
  await navigate("#memories"); click(`[data-memory-album="${ids[0]}"]`); assertUsableLayout();
  click(`[data-memory-photo="${ids[0]}-0"]`); assertUsableLayout(); click("[data-memory-card-toggle]"); assertUsableLayout(); click("[data-memory-close]");
  await navigate("#memories/ai"); click("[data-memory-summary-open]"); assertUsableLayout(); click(`[data-memory-pick="${ids[0]}"]`); assertUsableLayout(); click("[data-memory-close]");
  click("[data-memory-artwork-open]"); assertUsableLayout(); click("[data-artwork-close]");
  await navigate("#memories/checkins"); click("[data-memory-checkin-card-open]"); assertUsableLayout(); click("[data-checkin-card-close]");
  await navigate("#workbook/essay"); click("[data-workbook-export-open]"); assertUsableLayout(); click("[data-workbook-export-close]");
});
const summary = document.getElementById("test-summary"); summary.textContent = `${passed} 通過，${failed} 失敗`; summary.dataset.done = "true"; summary.dataset.failed = String(failed);
