import { createAppController } from "../../src/controller.js";
import { createDefaultState, STORAGE_KEY } from "../../src/state.js";
import { CHECK_IN_LOCATIONS } from "../../src/data.js";
import { createPhotoRepository, createPhotoExport, createTravelCard, createTripAIKit } from "../../src/photos.js";
import { openMemoryAlbum, openMemoryPhoto, ensureSummary, selectSummaryPhoto, closeMemory } from "../helpers/memory-controls.js";

if (document.readyState === "loading") await new Promise(resolve => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
const preview = new URLSearchParams(location.search).get("preview");
const offline = preview === "offline";
const ids = CHECK_IN_LOCATIONS.map(item => item.id);
const values = new Map(), records = new Map(), live = new Map();
const storage = offline ? localStorage : { getItem: key => values.get(key) || null,
  setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
const repository = offline ? createPhotoRepository({ databaseName: "outdoorLearningDay.photos" }) : null;
const assert = (condition, message) => { if (!condition) throw Error(message); };
if (offline) assert(!storage.getItem(STORAGE_KEY) && !(await repository.getAllPhotoRecords()).length,
  "離線預覽只可在空白測試 origin 使用，不可覆蓋既有資料。");
const state = createDefaultState();
ids.forEach(id => { state.checkIns[id] = { attractionId: id, method: "manual", verified: false, checkedInAt: "2026-11-05T04:00:00.000Z" }; });
storage.setItem(STORAGE_KEY, JSON.stringify(state));
const colors = ["#b44a43", "#d49727", "#419d8b", "#667bb5", "#9c66a6", "#356253"];
const sources = await Promise.all(ids.map(async (id, index) => {
  const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 480;
  const context = canvas.getContext("2d"); context.fillStyle = colors[index]; context.fillRect(0, 0, 640, 480);
  context.fillStyle = "#fff"; context.font = "bold 30px sans-serif"; context.fillText(`SYNTHETIC ${index + 1}`, 40, 400);
  return new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", .92));
}));
function record(index, station = 1) { return { attractionId: ids[station], photoId: `${ids[station]}-${index}`, writeId: `${ids[station]}-${index}`,
  width: 640, height: 480, createdAt: new Date(Date.UTC(2026, 10, 5, 4, 0, index)).toISOString(), blob: sources[station] }; }
let readFailure = false, conversionOverride = null, generationOverride = null;
const downloads = [], generated = [], converted = [];
class FixtureURL extends URL {
  static createObjectURL(blob) { const url = URL.createObjectURL(blob); live.set(url, blob); return url; }
  static revokeObjectURL(url) { live.delete(url); URL.revokeObjectURL(url); }
}
const photoService = { ...(repository || {}), getAllPhotoRecords: async () => {
  if (readFailure) throw Error("fixture read failure"); return repository ? repository.getAllPhotoRecords() : [...records.values()];
}, createPhotoExport: async (...args) => {
  const file = await (conversionOverride || createPhotoExport)(...args); converted.push(file); return file;
}, createTravelCard: async options => (generationOverride || createTravelCard)(options),
createTripAIKit: async options => { const blob = await createTripAIKit(options); generated.push({ options, blob }); return blob; } };
const navigatorFixture = { onLine: true, userAgent: "Android fixture", ...(offline ? { serviceWorker: navigator.serviceWorker } : {}) };
const pushClientFactory = () => ({ getSnapshot: () => ({ statusMessage: "本機測試" }), initialize: async () => {}, refresh: async () => {} });
location.hash = "#memories";
const controller = createAppController({ environment: { document, window, location, localStorage: storage, URL: FixtureURL,
  requestAnimationFrame, indexedDB, navigator: navigatorFixture }, photoService, pushClientFactory });
const nativeClick = HTMLAnchorElement.prototype.click;
if (!preview) HTMLAnchorElement.prototype.click = function () {
  if (this.download) downloads.push({ name: this.download, blob: live.get(this.href) }); else nativeClick.call(this);
};
const click = selector => { const target = document.querySelector(selector); assert(target, `缺少 ${selector}`); target.click(); };
const pause = () => new Promise(resolve => setTimeout(resolve, 15));
async function until(condition) { const deadline = Date.now() + 15000; while (!condition()) { if (Date.now() > deadline) throw Error("等待操作逾時"); await pause(); } }
const snapshot = () => controller.getPageSnapshot();
const overlay = () => snapshot().memoryOverlay;
async function load(items) {
  closeMemory(); records.clear(); items.forEach(item => records.set(item.photoId, item));
  await controller.start();
}
async function confirm(accept = true) {
  await until(() => document.querySelector("#confirm-dialog").open);
  assert(!document.querySelector("#memory-dialog").open, "確認疊在回憶視窗上");
  click(accept ? "#confirm-button" : '#confirm-dialog [value="cancel"]');
}
const ready = () => document.querySelector("#photo-export-content").dataset.status === "ready";
let passed = 0, failed = 0;
async function check(label, action) {
  const item = document.createElement("li");
  try { await action(); passed++; item.textContent = `通過：${label}`; }
  catch (error) { failed++; item.textContent = `失敗：${label} — ${error.message}`; }
  document.querySelector("#test-results").append(item);
}
if (preview) {
  const items = ids.flatMap((id, station) => Array.from({ length: 20 }, (_, index) => record(index, station)));
  if (repository) for (const item of items) await repository.savePhotoRecord(item);
  else items.forEach(item => records.set(item.photoId, item));
  await controller.start(); document.querySelector("#test-runner").hidden = true;
} else {
  for (const count of [0, 1, 12, 13, 120]) await check(`${count} 張相片：主頁封面固定，最新封面、倒序十二張分頁及預覽釋放`, async () => {
    await load(Array.from({ length: count }, (_, index) => record(index)));
    assert(snapshot().photoCount === count && document.querySelectorAll(".memory-album").length === (count ? 1 : 0), "總數或封面數錯誤");
    assert(!document.querySelector("#app textarea, #app [data-summary-field], #app [data-photo-select]"), "主頁仍重複顯示表單或縮圖");
    assert(live.size === (count ? 1 : 0), "主頁為全部照片建立了網址");
    if (!count) { assert(document.querySelector(".summary-warning").textContent.includes("仍欠 5"), "零相片缺少補拍提示"); return; }
    assert(snapshot().albums[0].cover.photoId === `${ids[1]}-${count - 1}`, "封面不是最新");
    openMemoryAlbum(ids[1]);
    assert(overlay().photos.length === Math.min(12, count) && overlay().photos[0].photoId === `${ids[1]}-${count - 1}`, "分頁或排序錯誤");
    const old = overlay().photos[1]?.url;
    if (count > 12) {
      click("#memory-next-page");
      assert(overlay().page === 1 && overlay().photos[0].photoId === `${ids[1]}-${count - 13}`, "下一頁錯誤");
      assert(!live.has(old) && live.size <= 13, "舊縮圖網址未釋放");
      click("#memory-prev-page");
    }
    for (const image of document.querySelectorAll("#memory-content img")) { await image.decode(); assert(image.naturalWidth === 640, "縮圖不可解碼"); }
    closeMemory(); assert(live.size === 1, "關閉後留下縮圖網址");
  });
  await check("六站共120張只顯示六個相簿，跨頁跨站勾選及本站全選／清除互不干擾", async () => {
    await load(ids.flatMap((id, station) => Array.from({ length: 20 }, (_, index) => record(index, station))));
    assert(document.querySelectorAll(".memory-album").length === 6 && live.size === 6, "主頁相簿超過六個");
    openMemoryAlbum(ids[1]); click(`[data-photo-select="${ids[1]}-19"]`); click("#memory-next-page"); click(`[data-photo-select="${ids[1]}-0"]`);
    openMemoryAlbum(ids[2]); click("[data-memory-album-select]"); assert(snapshot().selectedCount === 22, "相簿全選丟失其他站");
    click("[data-memory-album-select]"); assert(snapshot().selectedCount === 2, "相簿清除影響他站");
    openMemoryAlbum(ids[1]); assert(document.querySelector(`[data-photo-select="${ids[1]}-19"]`).checked, "跨站勾選未保留");
    click("#memory-next-page"); assert(document.querySelector(`[data-photo-select="${ids[1]}-0"]`).checked, "跨頁勾選未保留");
  });
  await check("大圖上一張／下一張，返回保留分頁、焦點及捲動；Escape 逐層退出", async () => {
    const target = document.querySelector(`[data-memory-photo="${ids[1]}-7"]`);
    document.querySelector("#memory-body").scrollTop = 50;
    const scroll = document.querySelector("#memory-body").scrollTop;
    target.focus({ preventScroll: true }); target.click();
    assert(overlay().photo.photoId === `${ids[1]}-7` && !document.querySelector("textarea"), "大圖或延後表單錯誤");
    click("#memory-next-photo"); assert(overlay().photo.photoId === `${ids[1]}-6`, "下一張錯誤");
    click("#memory-prev-photo"); assert(overlay().photo.photoId === `${ids[1]}-7`, "上一張錯誤");
    document.querySelector("#memory-dialog").requestClose();
    assert(overlay().mode === "album" && overlay().page === 1, "未返回原頁");
    assert(document.activeElement.id === target.id && document.querySelector("#memory-body").scrollTop === scroll, "焦點或位置未恢復");
    document.querySelector("#memory-dialog").requestClose(); assert(!overlay(), "第二次關閉沒有返回主頁");
  });
  await check("單張卡按需展開，中文組字不中斷、關閉保留草稿，確認取消回到原畫面", async () => {
    openMemoryPhoto(ids[1], `${ids[1]}-19`, true);
    const field = document.querySelector("#memory-reflection"); field.focus();
    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    field.value = "學".repeat(79) + "🙂多";
    field.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true })); controller.render();
    assert(field.isConnected && field.value.endsWith("多"), "組字被中斷");
    field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    assert(Array.from(overlay().photo.reflection).length === 80, "感想長度錯誤");
    closeMemory(); openMemoryPhoto(ids[1], `${ids[1]}-19`, true);
    assert(Array.from(document.querySelector("#memory-reflection").value).length === 80, "關閉丟失草稿");
    click("[data-card-download]"); await confirm(false); await until(() => overlay() && !overlay().busy);
    assert(overlay().mode === "photo" && overlay().cardOpen && downloads.length === 0, "取消未返回原畫面");
  });
  await check("大圖單張JPEG及整個相簿ZIP，下載後保存位置明確，匯出取消返回原相片", async () => {
    click("[data-memory-download-photo]"); await until(ready);
    assert(!document.querySelector("#memory-dialog").open && document.querySelector("[data-photo-export-download-all]").textContent === "下載 JPEG", "單張主要按鈕不正確");
    click("[data-photo-export-download-all]");
    assert(downloads.length === 1 && downloads[0].blob.type === "image/jpeg" && document.querySelector("#photo-export-location"), "單張輸出或位置提示錯誤");
    click("[data-photo-export-close]"); assert(overlay().photo.photoId === `${ids[1]}-19`, "匯出關閉未返回原相片");
    click("[data-memory-back]"); converted.length = 0; click("[data-memory-download-album]"); await until(ready);
    assert(converted.length === 20 && document.querySelector("[data-photo-export-download-all]").textContent.includes("ZIP（20 張）"), "整個相簿輸出不符");
    assert(!document.querySelector("[data-photo-export-download]"), "逐張下載未收起");
    click("[data-export-more]"); assert(document.querySelectorAll("[data-photo-export-download]").length === 12, "更多選項未分頁");
    click("#export-next-page"); assert(document.querySelectorAll("[data-photo-export-download]").length === 8, "更多選項下一頁錯誤");
    click("[data-photo-export-download-all]");
    const bytes = await downloads.at(-1).blob.arrayBuffer(); assert(new DataView(bytes).getUint32(0, true) === 0x04034b50, "不是真實ZIP");
    assert(document.querySelector("#photo-export-location").textContent.includes("解壓"), "沒有解壓提示"); click("[data-photo-export-close]");
  });
  await check("匯出失敗沒有部分下載、可重新準備；取消後的慢回覆不恢復視窗", async () => {
    closeMemory(); conversionOverride = async () => { throw Error("fixture decode failure"); };
    click("[data-memory-download-all]"); await until(() => document.querySelector("[data-export-retry]"));
    assert(!document.querySelector("[data-photo-export-download-all]"), "失敗留下部分下載");
    conversionOverride = null; click("[data-export-retry]"); await until(ready); click("[data-photo-export-close]");
    let release; conversionOverride = (_record, name) => new Promise(resolve => { release = () => resolve(new File(["fixture"], name)); });
    click("[data-memory-download-all]"); await until(() => release); click("[data-photo-export-close]"); release(); await pause();
    assert(!document.querySelector("#photo-export-dialog").open, "晚回覆恢復視窗"); conversionOverride = null;
  });
  await check("合成卡六個位置、選圖十二張分頁，選取與下載分開，關閉保留姓名班別及五張選圖", async () => {
    ensureSummary(); assert(document.querySelectorAll(".summary-slot").length === 6 && !document.querySelector("[data-summary-select]"), "位置重複列出全部照片");
    for (const id of ids.slice(1)) selectSummaryPhoto(id, `${id}-0`);
    assert(snapshot().summaryCard.requiredSelectedCount === 5 && snapshot().summaryCard.selectedCount === 5 && snapshot().selectedCount === 2, "製卡和下載勾選混合");
    const name = document.querySelector("#summary-studentName"); name.value = "虛構同學"; name.dispatchEvent(new Event("input", { bubbles: true }));
    for (const [field, value] of Object.entries({ className: "測試班", studentNumber: "07" })) {
      const target = document.querySelector("#summary-" + field); target.value = value; target.dispatchEvent(new Event("input", { bubbles: true }));
    }
    closeMemory(); ensureSummary(); assert(document.querySelector("#summary-studentName").value === "虛構同學" && snapshot().summaryCard.canDownload, "關閉未保留草稿");
    click("[data-summary-download]"); await confirm(false); await until(() => !snapshot().summaryCard.busy);
    assert(snapshot().summaryCard.selectedCount === 5 && snapshot().summaryCard.studentName === "虛構同學", "確認取消丟失草稿");
    click("[data-summary-download]"); await confirm(); await until(() => generated.length === 1);
    assert(generated[0].blob.type === "application/zip" && generated[0].blob.name === "AI融合圖片素材包-5張.zip", "五張 ZIP 素材包錯誤");
    selectSummaryPhoto(ids[0], `${ids[0]}-0`); click("[data-summary-download]"); await confirm(); await until(() => generated.length === 2);
    assert(generated[1].options.stations.length === 6 && !storage.getItem(STORAGE_KEY).includes("虛構同學"), "六張卡錯誤或個資寫入儲存");
  });
  await check("相片讀取失敗不誤報缺照，重試恢復；資料失效關閉大圖", async () => {
    readFailure = true; await controller.start(); assert(snapshot().readState === "error" && !document.querySelector(".summary-warning"), "誤報缺照");
    readFailure = false; click("[data-photos-retry]"); await until(() => snapshot().readState === "ready");
    openMemoryPhoto(ids[1], `${ids[1]}-19`); records.delete(`${ids[1]}-19`); await controller.start();
    assert(overlay()?.mode === "album", "大圖仍使用已不存在相片");
  });
  await check("手機／平板／桌面無橫向溢出，視窗有獨立捲動，離開回憶清除草稿及勾選", async () => {
    assert(document.documentElement.scrollWidth <= innerWidth, "主頁橫向溢出");
    const dialog = document.querySelector("#memory-dialog").getBoundingClientRect();
    assert(dialog.width <= innerWidth && dialog.height <= innerHeight && dialog.top >= 0, "視窗超出螢幕");
    location.hash = "#home"; controller.render(); await pause(); location.hash = "#memories"; controller.render(); await pause();
    assert(snapshot().selectedCount === 0 && !snapshot().summaryCard.studentName && !overlay() && [...live.values()].filter(blob => sources.includes(blob)).length <= 6, "離頁殘留草稿或預覽");
  });
  HTMLAnchorElement.prototype.click = nativeClick;
  const result = document.querySelector("#test-summary"); result.textContent = `${passed} 通過，${failed} 失敗`;
  result.dataset.done = "true"; result.dataset.failed = String(failed);
}
