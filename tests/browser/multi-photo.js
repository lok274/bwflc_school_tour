import { createAppController } from "../../src/controller.js";
import { createPhotoRepository, compressPhoto, createTravelCard } from "../../src/photos.js";
import { createDefaultState, STORAGE_KEY } from "../../src/state.js";

const summary = document.querySelector("#test-summary");
const results = document.querySelector("#test-results");
const databaseName = `multi-photo-test-${crypto.randomUUID()}`;
const repository = createPhotoRepository({ databaseName });
const data = new Map();
const storage = { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
const state = createDefaultState();
state.checkIns["future-school"] = { attractionId: "future-school", method: "manual", verified: false, checkedInAt: new Date().toISOString() };
storage.setItem(STORAGE_KEY, JSON.stringify(state));
const canvas = document.createElement("canvas");
canvas.width = 2000; canvas.height = 1500;
canvas.getContext("2d").fillRect(0, 0, canvas.width, canvas.height);
const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
const assert = (value, message) => { if (!value) throw new Error(message); };
const waitFor = async condition => {
  const end = Date.now() + 10000;
  while (!condition()) {
    if (Date.now() > end) throw new Error("等待操作逾時");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};
let failed = 0, passed = 0;
async function check(label, action) {
  const item = document.createElement("li");
  try { await action(); passed++; item.textContent = `通過：${label}`; }
  catch (error) { failed++; item.textContent = `失敗：${label} — ${error.message}`; }
  results.append(item);
}
await check("版本 1 的相片原封保留至版本 2，重新開啟可讀回", async () => {
  const legacy = await compressPhoto(blob, "future-school");
  legacy.writeId = "legacy-photo";
  await new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("photos", { keyPath: "attractionId" });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("photos", "readwrite");
      transaction.objectStore("photos").put(legacy);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
  });
  const records = await repository.getAllPhotoRecords();
  assert(records.length === 1 && records[0].photoId === "future-school" && records[0].writeId === "legacy-photo", "舊照遺失");
  assert(records[0].blob.size === legacy.blob.size && records[0].width === 1600, "舊照內容改變");
});
location.hash = "#attraction/future-school";
let cardPhotoId;
const controller = createAppController({
  environment: { document, window, location, localStorage: storage, URL, requestAnimationFrame, indexedDB, navigator: { onLine: true } },
  photoService: { ...repository, compressPhoto, createTravelCard: async options => {
    cardPhotoId = options.photoRecord.photoId;
    return createTravelCard(options);
  } },
  feedbackService: { showToast() {}, askConfirmation: async options => options.isRelevant(), celebrateStamp() {} }
});
await controller.start();
// Prevent the generated fixture test from opening the operating-system file picker.
for (const id of ["photo-input", "native-camera-input"]) document.getElementById(id).click = () => {};
async function select(count, native = false) {
  document.querySelector(native ? "[data-native-camera-open]" : "[data-gallery-open]").click();
  const transfer = new DataTransfer();
  for (let index = 0; index < count; index++) transfer.items.add(new File([blob], `fixture-${index}.png`, { type: "image/png" }));
  const input = document.getElementById(native ? "native-camera-input" : "photo-input");
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
await check("相簿一次加入兩張，舊相片仍在；照片尺寸、DOM 預覽及手機版面正確", async () => {
  assert(document.getElementById("photo-input").multiple, "相簿未開啟多選");
  await select(2);
  await waitFor(() => controller.getPageSnapshot().photos.length === 3);
  const records = await repository.getAllPhotoRecords();
  assert(records.length === 3 && new Set(records.map(record => record.photoId)).size === 3, "新照覆蓋舊照");
  assert(records.some(record => record.writeId === "legacy-photo"), "舊照被刪除");
  assert(records.every(record => record.width === 1600 && record.height === 1200), "壓縮尺寸錯誤");
  const images = [...document.querySelectorAll(".has-photo img")];
  // Off-screen lazy images need not load until scrolled into view on a phone.
  for (const image of images) { image.loading = "eager"; await image.decode(); }
  assert(images.every(image => image.naturalWidth === 1600), "照片預覽未正確解碼");
  assert(document.querySelectorAll("[data-photo-delete]").length === 3, "沒有逐張刪相按鈕");
  assert(document.documentElement.scrollWidth <= window.innerWidth, "手機版面橫向溢出");
});
await check("原生相機再次拍照會新增一張，舊照片不受影響", async () => {
  await select(1, true);
  await waitFor(() => controller.getPageSnapshot().photos.length === 4);
  assert((await repository.getAllPhotoRecords()).length === 4, "再次拍攝覆蓋照片");
});
await check("重新開啟資料庫及重新整理控制器後讀回全部照片", async () => {
  const reopened = createPhotoRepository({ databaseName });
  assert((await reopened.getAllPhotoRecords()).length === 4, "資料未持久保存");
  await controller.start();
  assert(controller.getPageSnapshot().photos.length === 4, "讀回遺失照片");
});
await check("指定非最新相片製作旅程卡，仍使用選定相片", async () => {
  const first = document.querySelector("[data-card-download]");
  const expected = first.dataset.photoId;
  first.click();
  await waitFor(() => cardPhotoId);
  assert(cardPhotoId === expected, "旅程卡使用了其他相片");
});
await check("逐張刪除只刪選中的相片，其他三張和打卡仍保留", async () => {
  const button = document.querySelector("[data-photo-delete]");
  const id = button.dataset.photoId;
  button.click();
  await waitFor(() => controller.getPageSnapshot().photos.length === 3);
  assert(!(await repository.getPhotoRecord("future-school", id)), "指定相片未刪除");
  assert((await repository.getAllPhotoRecords()).length === 3 && controller.getPageSnapshot().checkIn, "其他紀錄受影響");
});
await check("指定相片 ID 不可刪除其他景點的照片", async () => {
  const record = (await repository.getAllPhotoRecords())[0];
  await repository.deletePhotoRecord("sun-yat-sen", record.photoId);
  assert(await repository.getPhotoRecord("future-school", record.photoId), "跨景點刪除成功");
});
await check("取消打卡清除本站全部相片", async () => {
  document.querySelector("[data-checkin-undo]").click();
  await waitFor(() => !controller.getPageSnapshot().checkIn);
  assert(!(await repository.getAllPhotoRecords()).length, "取消打卡後仍有相片");
});
await repository.clearPhotoRecords();
indexedDB.deleteDatabase(databaseName);
summary.textContent = `${passed} 通過，${failed} 失敗`;
summary.dataset.done = "true";
summary.dataset.failed = String(failed);
