import { openMemoryPhoto, selectAllMemoryPhotos, closeMemory } from "../helpers/memory-controls.js";
import { createAppController } from "../../src/controller.js";
import { createPhotoRepository, compressPhoto, createPhotoExport, createTravelCard } from "../../src/photos.js";
import { createDefaultState, STORAGE_KEY } from "../../src/state.js";

if (document.readyState === "loading") await new Promise(resolve => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
const summary = document.querySelector("#test-summary"), results = document.querySelector("#test-results");
const preview = new URLSearchParams(location.search).has("preview");
const databaseName = preview ? "outdoorLearningDay.photos" : `memories-fixture-${crypto.randomUUID()}`;
const repository = createPhotoRepository({ databaseName });
const values = new Map();
const storage = preview ? localStorage : { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
const assert = (value, message) => { if (!value) throw Error(message); };
assert(!storage.getItem(STORAGE_KEY) && !(await repository.getAllPhotoRecords()).length, "須在空白的本機測試 origin 使用，不能覆蓋既有旅程資料。");
const state = createDefaultState();
for (const id of ["departure-school", "future-school", "sun-yat-sen"]) state.checkIns[id] = {
  attractionId: id, checkedInAt: "2026-11-05T04:00:00.000Z", method: "manual", verified: false
};
storage.setItem(STORAGE_KEY, JSON.stringify(state));
const canvas = document.createElement("canvas"); canvas.width = 1200; canvas.height = 900;
const context = canvas.getContext("2d");
context.fillStyle = "#b8d2c5"; context.fillRect(0, 0, 1200, 900);
context.fillStyle = "#f4bc5f"; context.beginPath(); context.arc(930, 190, 90, 0, Math.PI * 2); context.fill();
context.fillStyle = "#0b3b46"; context.beginPath(); context.moveTo(0, 800); context.lineTo(420, 280); context.lineTo(850, 800); context.fill();
context.fillStyle = "#40685a"; context.beginPath(); context.moveTo(360, 900); context.lineTo(850, 420); context.lineTo(1200, 900); context.fill();
context.fillStyle = "#fff"; context.font = "bold 48px sans-serif"; context.fillText("SYNTHETIC TEST PHOTO", 100, 820);
const source = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
for (const [photoId, id] of [["legacy", "departure-school"], ["future", "future-school"], ["sun", "sun-yat-sen"]]) {
  await repository.savePhotoRecord({ ...await compressPhoto(source, id), photoId, writeId: photoId });
}
let passed = 0, failed = 0, converted = [], cards = [], downloads = [], conversionOverride;
let shareMode = "success", shareCalls = 0;
const photoService = { ...repository, compressPhoto,
  createPhotoExport: async (...args) => {
    const file = await (conversionOverride || createPhotoExport)(...args); converted.push(file); return file;
  },
  createTravelCard: async options => { const blob = await createTravelCard(options); cards.push({ options, blob }); return blob; }
};
const navigatorFixture = { onLine: true, canShare: () => true, share: ({ files }) => {
  shareCalls++; assert(files.length > 0, "空分享");
  return shareMode === "success" ? Promise.resolve() : Promise.reject(Object.assign(Error("Fixture cancellation"), { name: shareMode }));
} };
const pushClientFactory = () => ({ getSnapshot: () => ({ statusMessage: "本機測試", canEnable: false, canDisable: false }), initialize: async () => {}, refresh: async () => {} });
const exportedBlobs = new Map();
class FixtureURL extends URL {
  static createObjectURL(blob) { const url = URL.createObjectURL(blob); exportedBlobs.set(url, blob); return url; }
  static revokeObjectURL(url) { exportedBlobs.delete(url); URL.revokeObjectURL(url); }
}
location.hash = "#memories";
const controller = createAppController({ environment: { document, window, location, localStorage: storage, URL: FixtureURL, requestAnimationFrame, indexedDB, navigator: navigatorFixture },
  photoService, pushClientFactory, feedbackService: { showToast() {}, askConfirmation: async options => options.isRelevant(), celebrateStamp() {} }
});
const pause = () => new Promise(resolve => setTimeout(resolve, 15));
async function until(condition) {
  const end = Date.now() + 10000;
  while (!condition()) { if (Date.now() > end) throw Error("等待操作逾時"); await pause(); }
}
async function navigate(hash) { location.hash = hash; controller.render(); await pause(); }
function click(selector) { if (selector === "[data-photo-select-all]") { selectAllMemoryPhotos(); return; } const target = document.querySelector(selector); assert(target, `缺少 ${selector}`); target.click(); }
const allPhotos = () => controller.getPageSnapshot().albums.map(album => album.cover);
const dialog = document.querySelector("#photo-export-dialog");
const ready = () => dialog.open && document.querySelector("#photo-export-content").dataset.status === "ready";
const originalAnchorClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function () {
  if (this.download) downloads.push({ name: this.download, url: this.href });
  else originalAnchorClick.call(this);
};
document.querySelector("#native-camera-input").click = () => {};
async function check(label, action) {
  const item = document.createElement("li");
  try { await action(); passed++; item.textContent = `通過：${label}`; }
  catch (error) { failed++; item.textContent = `失敗：${label} — ${error.message}`; }
  results.append(item);
}
await controller.start();
if (preview) {
  document.querySelector("#test-runner").hidden = true;
  summary.dataset.done = "preview";
  HTMLAnchorElement.prototype.click = originalAnchorClick;
} else {
  await check("三站相片集中顯示，圖片可解碼、所有感想提示 ID 唯一", async () => {
    assert(controller.getPageSnapshot().photoCount === 3, "缺少已保存相片");
    assert(document.querySelectorAll("[data-photo-export-selected]").length === 1, "重複匯出入口");
    const ids = [...document.querySelectorAll(".card-reflection-field p")].map(item => item.id);
    assert(new Set(ids).size === ids.length, "提示 ID 跨景點重複");
    for (const image of document.querySelectorAll(".memory-album img")) { image.loading = "eager"; await image.decode(); assert(image.naturalWidth === 1200, "預覽尺寸錯誤"); }
    assert(document.querySelector('[data-nav="memories"]').getAttribute("aria-current") === "page", "導航狀態錯誤");
    assert(document.documentElement.scrollWidth <= innerWidth, "版面橫向溢出");
  });
  await check("跨景點勾選後重畫保留焦點及草稿，全選三張 JPEG 加一個 ZIP", async () => {
    openMemoryPhoto("sun-yat-sen", "sun", true);
    const field = document.querySelector('[data-card-reflection="sun"]');
    field.focus(); field.value = "這次旅程讓我學會仔細觀察。"; field.dispatchEvent(new Event("input", { bubbles: true }));
    field.setSelectionRange(2, 5, "backward"); controller.render();
    assert(document.activeElement.dataset.cardReflection === "sun" && document.activeElement.selectionStart === 2, "草稿焦點遺失");
    click("[data-photo-select-all]"); assert(allPhotos().every(photo => photo.selected), "跨站全選失敗");
    click("[data-photo-export-selected]"); await until(ready);
    assert(converted.length === 3, "沒有全部轉換");
    for (const file of converted) {
      const bitmap = await createImageBitmap(file); assert(file.type === "image/jpeg" && bitmap.width === 1200 && bitmap.height === 900, "JPEG 尺寸錯誤"); bitmap.close();
    }
    click("[data-photo-export-download-all]");
    assert(downloads.length === 1 && downloads[0].name === "旅途回憶-相片-3張.zip", "沒有一次下載 ZIP");
    const archive = await exportedBlobs.get(downloads[0].url).arrayBuffer();
    assert(new DataView(archive).getUint32(0, true) === 0x04034b50, "ZIP 檔頭錯誤");
  });
  await check("取消分享不下載、不刪照，之後仍可重試", async () => {
    shareMode = "AbortError"; click("[data-photo-export-share]"); await until(ready);
    assert(shareCalls === 1 && downloads.length === 1 && (await repository.getAllPhotoRecords()).length === 3, "取消分享改變資料");
    assert(document.querySelector("#photo-export-status").textContent.includes("取消分享"), "缺少取消提示");
    click("[data-photo-export-close]");
  });
  await check("指定另一站相片及感想生成真實 1080 × 1350 PNG", async () => {
    openMemoryPhoto("sun-yat-sen", "sun", true); click('[data-card-download="sun-yat-sen"]'); await until(() => cards.length === 1 && downloads.length === 2);
    const bitmap = await createImageBitmap(cards[0].blob);
    assert(bitmap.width === 1080 && bitmap.height === 1350 && cards[0].blob.type === "image/png", "旅程卡格式錯誤"); bitmap.close();
    assert(cards[0].options.photoRecord.photoId === "sun" && cards[0].options.reflection.includes("仔細觀察"), "相片或感想用錯");
  });
  await check("景點只提供拍攝及回憶入口，拍照保存後重新開回憶可見", async () => {
    await navigate("#attraction/future-school");
    assert(!document.querySelector("[data-card-download], [data-photo-select]"), "景點仍提供後續相片功能");
    click("[data-native-camera-open]");
    const input = document.querySelector("#native-camera-input"), transfer = new DataTransfer();
    transfer.items.add(new File([source], "fixture.png", { type: "image/png" })); input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await until(() => controller.getPageSnapshot().photos.length === 2);
    await navigate("#memories"); assert(controller.getPageSnapshot().photoCount === 4, "拍照後沒有加入回憶");
    assert(allPhotos().every(photo => !photo.selected && !photo.reflection), "離頁未清除選取與感想草稿");
  });
  await check("跨景點轉換中離頁，晚回覆不能恢復視窗或下載", async () => {
    let release; conversionOverride = (_record, name) => new Promise(resolve => { release = () => resolve(new File(["fixture"], name)); });
    click("[data-photo-select-all]"); click("[data-photo-export-selected]"); await until(() => release);
    await navigate("#itinerary"); release(); await pause();
    assert(!dialog.open && downloads.length === 2, "過期匯出仍有效"); conversionOverride = null;
  });
  await check("取消一站只刪本站回憶，清除全部後回憶頁顯示空狀態", async () => {
    await navigate("#attraction/future-school"); click("[data-checkin-undo]"); await until(() => !controller.getPageSnapshot().checkIn);
    await navigate("#memories"); await until(() => controller.getPageSnapshot().readState === "ready"); assert(controller.getPageSnapshot().photoCount === 2, "取消影響其他站");
    await navigate("#home"); click("[data-reset-all]"); await until(() => !storage.getItem(STORAGE_KEY));
    await navigate("#memories"); assert(controller.getPageSnapshot().photoCount === 0 && document.querySelector(".memory-empty"), "清除後沒有空頁");
  });
  await repository.clearPhotoRecords(); indexedDB.deleteDatabase(databaseName);
  HTMLAnchorElement.prototype.click = originalAnchorClick;
  summary.textContent = `${passed} 通過，${failed} 失敗`;
  summary.dataset.done = "true"; summary.dataset.failed = String(failed);
}
