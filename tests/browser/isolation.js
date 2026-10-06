import { createAppController } from "../../src/controller.js";
import * as photos from "../../src/photos.js";
import { STORAGE_KEY } from "../../src/state.js";

const summary = document.querySelector("#test-summary");
const results = document.querySelector("#test-results");
let passed = 0;
let failed = 0;
const require = (condition, message) => { if (!condition) throw new Error(message); };
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
async function until(condition) {
  const end = Date.now() + 5000;
  while (!condition()) { if (Date.now() > end) throw new Error("等待操作完成逾時"); await pause(); }
}
async function check(label, action) {
  const item = document.createElement("li");
  try { await action(); passed += 1; item.textContent = `通過：${label}`; }
  catch (error) { failed += 1; item.textContent = `失敗：${label} — ${error.message}`; }
  results.append(item);
}
function navigate(hash) { location.hash = hash; application.render(); }
function click(selector) { const target = document.querySelector(selector); require(target, `沒有控制項 ${selector}`); target.click(); }
async function confirm() { await until(() => document.querySelector("#confirm-dialog").open); click("#confirm-button"); }
function selectFile(blob, native = false) {
  click(native ? '[data-native-camera-open="future-school"]' : '[data-gallery-open="future-school"]');
  const input = document.querySelector(native ? "#native-camera-input" : "#photo-input");
  const transfer = new DataTransfer();
  transfer.items.add(new File([blob], "generated-fixture.png", { type: blob.type }));
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
const detail = "#attraction/future-school";
const canvas = document.createElement("canvas");
canvas.width = 2000;
canvas.height = 1500;
canvas.getContext("2d").fillRect(0, 0, 2000, 1500);
const fixtureBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
const environment = { document, window, location, localStorage, URL, requestAnimationFrame,
  navigator: { onLine: navigator.onLine }, matchMedia: window.matchMedia.bind(window), indexedDB };
const originalPhotos = await photos.getAllPhotoRecords();
if (localStorage.getItem(STORAGE_KEY) || originalPhotos.length) {
  summary.textContent = "停止：此 origin 已有旅程資料。請用另一個未使用的測試連接埠；沒有改動或清除原資料。";
  throw new Error("Non-empty test origin");
}
const photoService = { ...photos };
const application = createAppController({ environment, photoService: Object.fromEntries(Object.keys(photoService).map((name) => [name, (...args) => photoService[name](...args)])) });
await application.start();
await check("真實 DOM 換頁及準備清單保存，其他頁不取得清單", async () => {
  navigate("#prepare");
  click('[data-check-item="health"]');
  require(application.getPageSnapshot().checklist.health, "勾選未保存");
  require(JSON.parse(localStorage.getItem(STORAGE_KEY)).checklist.health, "localStorage 未保存");
  navigate("#itinerary");
  require(!("checklist" in application.getPageSnapshot()), "行程洩露清單快照");
  navigate("#attractions");
  require(!("geo" in application.getPageSnapshot().attractions[0]), "列表取得不需要的詳情資料");
  navigate("#prepare");
  require(document.querySelector('[data-check-item="health"]').checked, "換頁後勾選消失");
});
await check("真實確認框完成手動打卡，詳情只取得當站資料", async () => {
  navigate(detail);
  click('[data-checkin="future-school"]');
  await confirm();
  await until(() => Boolean(application.getPageSnapshot().checkIn));
  require(application.getPageSnapshot().checkIn.verified === false, "手動被標成核實");
  require(!("state" in application.getPageSnapshot()), "仍有完整 state");
});
await check("真正 Canvas 壓縮、IndexedDB 保存及 Blob 圖片預覽", async () => {
  selectFile(fixtureBlob);
  await until(() => Boolean(application.getPageSnapshot().photo?.url));
  const stored = await photos.getPhotoRecord("future-school");
  require(stored.blob instanceof Blob && stored.width === 1600 && stored.height === 1200, "相片紀錄錯誤");
  const image = document.querySelector(".photo-panel img");
  await until(() => image.complete && image.naturalWidth > 0);
  require(image.naturalWidth === 1600, "Blob 預覽沒有解碼");
  require(!("blob" in application.getPageSnapshot().photo), "畫面取得 Blob");
});
await check("正式頁手機拍攝回覆保存原比例，詳情顯示完整相片", async () => {
  const input = document.querySelector("#native-camera-input");
  const originalClick = input.click;
  const before = await photos.getPhotoRecord("future-school");
  const beforeUrl = application.getPageSnapshot().photo?.url;
  let opened = false;
  input.click = () => { opened = true; };
  try {
    selectFile(fixtureBlob, true);
    await until(() => Boolean(application.getPageSnapshot().photo?.url) && application.getPageSnapshot().photo.url !== beforeUrl);
    const after = await photos.getPhotoRecord("future-school");
    require(opened && after.writeId !== before.writeId && after.width === 1600 && after.height === 1200, "原生回覆未保存");
    const image = document.querySelector(".photo-panel img");
    await until(() => image.complete && image.naturalWidth > 0);
    require(getComputedStyle(image).objectFit === "contain", "詳情仍裁切相片");
  } finally { input.click = originalClick; }
});
await check("離頁取消延遲壓縮，原有 IndexedDB 相片仍在", async () => {
  const before = await photos.getPhotoRecord("future-school");
  let finish;
  let started = false;
  photoService.compressPhoto = async (...args) => {
    started = true;
    await new Promise((resolve) => { finish = resolve; });
    return photos.compressPhoto(...args);
  };
  selectFile(fixtureBlob);
  await until(() => started);
  navigate("#prepare");
  finish();
  // A rejected pre-write operation cannot alter the already stored record.
  await photos.compressPhoto(fixtureBlob, "future-school");
  await pause();
  const after = await photos.getPhotoRecord("future-school");
  require(after.writeId === before.writeId, "離頁後原照被覆蓋");
  photoService.compressPhoto = photos.compressPhoto;
});
await check("真實寫入交易開始後換頁，保存完成且不顯示舊頁成功提示", async () => {
  const before = await photos.getPhotoRecord("future-school");
  let completed = false;
  let began = false;
  photoService.savePhotoRecord = async (record, { canBegin }) => {
    const key = await photos.savePhotoRecord(record, { canBegin: () => {
      const allowed = canBegin();
      if (allowed) { began = true; queueMicrotask(() => navigate("#attractions")); }
      return allowed;
    } });
    completed = true;
    return key;
  };
  navigate(detail);
  selectFile(fixtureBlob);
  await until(() => completed);
  await until(() => application.getPageSnapshot().photoIds?.includes("future-school"));
  require(began, "交易沒有開始");
  require((await photos.getPhotoRecord("future-school")).writeId !== before.writeId, "交易沒有保存");
  require(document.querySelector("#toast").hidden, "舊頁成功提示仍顯示");
  photoService.savePhotoRecord = photos.savePhotoRecord;
});
await check("真實旅程卡 PNG 生成並觸發本機下載連結", async () => {
  navigate(detail);
  const originalClick = HTMLAnchorElement.prototype.click;
  let downloads = 0;
  let card;
  photoService.createTravelCard = async (...args) => { card = await photos.createTravelCard(...args); return card; };
  HTMLAnchorElement.prototype.click = function () {
    if (this.download.endsWith("旅程卡.png")) { downloads += 1; require(this.href.startsWith("blob:"), "不是本機 Blob 連結"); }
    else originalClick.call(this);
  };
  try {
    click('[data-card-download="future-school"]');
    await confirm();
    await until(() => downloads === 1);
    const decoded = await createImageBitmap(card);
    require(card.type === "image/png" && decoded.width === 1080 && decoded.height === 1350, "卡片格式或尺寸錯誤");
    decoded.close();
    const proof = document.createElement("a");
    proof.id = "fixture-card-download";
    proof.className = "button button-primary";
    proof.textContent = "下載生成的測試旅程卡";
    proof.download = "隔離測試旅程卡.png";
    proof.href = URL.createObjectURL(card);
    summary.after(proof);
    window.addEventListener("beforeunload", () => URL.revokeObjectURL(proof.href), { once: true });
  } finally { HTMLAnchorElement.prototype.click = originalClick; photoService.createTravelCard = photos.createTravelCard; }
});
await check("首頁兩次確認清除測試紀錄，網站快取保留", async () => {
  navigate("#home");
  click("[data-reset-all]");
  await confirm();
  await confirm();
  await until(() => localStorage.getItem(STORAGE_KEY) === null);
  require((await photos.getAllPhotoRecords()).length === 0, "測試照片仍在");
});
await check("v27 離線快取包含新模組及網站首頁", async () => {
  const registration = await navigator.serviceWorker.register("../../sw.js", { scope: "../../" });
  await navigator.serviceWorker.ready;
  await until(() => Boolean(registration.active));
  const cache = await caches.open("outdoor-learning-day-v27");
  for (const path of ["../../index.html", "../../src/store.js", "../../src/page-models.js"]) {
    require(await cache.match(new URL(path, location.href)), `離線缺少 ${path}`);
  }
});
summary.textContent = `${passed} 項通過，${failed} 項失敗`;
summary.dataset.passed = String(passed);
summary.dataset.failed = String(failed);
