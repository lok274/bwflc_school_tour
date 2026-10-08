import { createDeviceTestController } from "../../src/device-test-controller.js";
import { createPhotoRepository, compressPhoto, createPhotoExport } from "../../src/photos.js";
import { DEVICE_TEST_LOCATION as place, DEVICE_TEST_STORAGE_KEY } from "../../src/device-test-data.js";

const summary = document.querySelector("#test-summary"), results = document.querySelector("#test-results");
const assert = (condition, message) => { if (!condition) throw Error(message); };
async function until(condition) {
  const end = Date.now() + 10000;
  while (!condition()) { if (Date.now() > end) throw Error("等待逾時"); await new Promise(resolve => setTimeout(resolve, 15)); }
}
let passed = 0, failed = 0;
async function check(label, action) {
  const item = document.createElement("li");
  try { await action(); passed++; item.textContent = `通過：${label}`; }
  catch (error) { failed++; item.textContent = `失敗：${label} — ${error.message}`; }
  results.append(item);
}
const repository = createPhotoRepository({ databaseName: `device-photo-fixture-${crypto.randomUUID()}` });
const data = new Map(), storage = { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
async function image(width, height) {
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d"); context.fillStyle = "#126571"; context.fillRect(0, 0, width, height);
  context.fillStyle = "#ffbd63"; context.fillRect(width / 5, height / 5, width / 2, height / 2);
  return new File([await new Promise(resolve => canvas.toBlob(resolve, "image/png"))], "synthetic.png", { type: "image/png" });
}
const source = await image(640, 480), portrait = await image(480, 640);
await repository.savePhotoRecord({ ...await compressPhoto(source, place.id), photoId: place.id, writeId: "legacy" });
await repository.savePhotoRecord({ ...await compressPhoto(source, "future-school"), photoId: "foreign", writeId: "foreign" });
let converted = [], conversion = createPhotoExport, shareMode = "success", shares = 0, nativeRequests = 0, reads = 0;
const testNavigator = { canShare: () => true, share: ({ files }) => {
  shares++;
  document.querySelector("#activation-result").textContent = `分享 ${files.length} 張；使用者點擊權限：${navigator.userActivation.isActive}`;
  return shareMode === "success" ? Promise.resolve() : Promise.reject(Object.assign(Error("fixture"), { name: shareMode }));
} };
const controller = createDeviceTestController({ environment: { document, window, navigator: testNavigator, URL, localStorage: storage, indexedDB, crypto, isSecureContext, requestAnimationFrame },
  photoService: { ...repository, compressPhoto, getAllPhotoRecords: async () => { const records = await repository.getAllPhotoRecords(); reads++; return records; },
    createPhotoExport: async (...args) => { const file = await conversion(...args); converted.push(file); return file; } },
  feedbackService: { showToast() {}, askConfirmation: async options => options.isRelevant(), cancelConfirmations() {} } });
const native = document.querySelector("#native-camera-input"), dialog = document.querySelector("#photo-export-dialog");
native.click = () => { nativeRequests++; };
function click(selector) { const target = document.querySelector(selector); assert(target && !target.disabled, `找不到可用控制項 ${selector}`); target.click(); }
async function add(files) {
  for (const file of files) {
    click("[data-native-camera-open]");
    const transfer = new DataTransfer(); transfer.items.add(file); native.files = transfer.files;
    native.dispatchEvent(new Event("change", { bubbles: true }));
    await until(() => !controller.getPageSnapshot().photoBusy);
  }
}
function exportPhoto(photoId = place.id) {
  click("[data-photo-select-none]");
  click(`[data-photo-select="${photoId}"]`);
  click("[data-photo-export-selected]");
}
const ready = () => until(() => dialog.open && document.querySelector("#photo-export-content").dataset.status === "ready");
const close = () => click("[data-photo-export-close]");
await check("載入保留舊照，隔離其他景點且沒有建立測試打卡", async () => {
  await controller.start(); assert(controller.getPageSnapshot().photos.length === 1, "舊照沒有保留或混入其他景點");
  assert(!controller.getPageSnapshot().checkIn && !data.has(DEVICE_TEST_STORAGE_KEY), "相機建立了打卡");
});
await check("連續拍攝兩張，保持比例及舊照", async () => {
  assert(!document.querySelector("#photo-input") && !document.querySelector("[data-gallery-open], [data-photo-delete], [data-photo-export]"), "移除的控制項仍存在");
  assert(document.querySelectorAll("[data-photo-export-selected]").length === 1 && document.querySelector("[data-photo-export-selected]").textContent === "儲存到手機", "不是單一多選儲存按鈕");
  await add([source, portrait]); const photos = controller.getPageSnapshot().photos;
  assert(photos.length === 3 && photos.some(item => item.photoId === place.id), "沒有追加兩張或覆蓋舊照");
  assert(photos.some(item => item.width === 480 && item.height === 640), "直向圖被改變比例");
  assert(photos.every(item => !("blob" in item)), "畫面取得原始相片");
});
await check("重複手機拍攝追加兩張，沒有覆蓋原有相片", async () => {
  await add([source], native); await add([portrait], native);
  assert(nativeRequests === 4 && controller.getPageSnapshot().photos.length === 5, "重複拍攝沒有累積");
});
await check("選取全部、取消及逐張選取；JPEG 格式與原尺寸正確", async () => {
  click("[data-photo-select-all]"); assert(controller.getPageSnapshot().photos.every(item => item.selected), "全選失敗");
  click("[data-photo-select-none]"); assert(document.querySelector("[data-photo-export-selected]").disabled, "空選取可以匯出");
  click(`[data-photo-select="${place.id}"]`); converted = []; click("[data-photo-export-selected]"); await ready();
  assert(converted.length === 1 && converted[0].name.includes(place.id), "匯出相片錯誤");
  const file = converted[0], bytes = new Uint8Array(await file.arrayBuffer()), bitmap = await createImageBitmap(file);
  assert(file.type === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216, "不是 JPEG");
  assert(bitmap.width === 640 && bitmap.height === 480, "尺寸改變"); bitmap.close(); close();
});
await check("多選匯出只含測試相片，分享取消或失敗保留重試及下載", async () => {
  click("[data-photo-select-all]"); converted = []; click("[data-photo-export-selected]"); await ready();
  assert(converted.length === 5 && converted.every(file => !file.name.includes("foreign")), "多選混入正式相片");
  for (const mode of ["AbortError", "NotAllowedError"]) {
    shareMode = mode; click("[data-photo-export-share]"); await ready();
    assert(document.querySelectorAll("[data-photo-export-download]").length === 5, "取消後丟失相片");
    assert(document.querySelector("#photo-export-status").textContent.includes(mode === "AbortError" ? "取消分享" : "重試"), "錯誤提示不符");
  }
  close(); shareMode = "success";
});
await check("不支援分享時僅提供逐張下載，不自行開分享", async () => {
  testNavigator.canShare = () => false; const before = shares;
  exportPhoto(); await ready();
  assert(!document.querySelector("[data-photo-export-share]") && document.querySelector("[data-photo-export-download]"), "沒有下載後備");
  assert(shares === before, "自動開了分享"); close(); testNavigator.canShare = () => true;
});
await check("第二張轉換失敗沒有不完整的下載結果", async () => {
  let count = 0; conversion = async (...args) => { if (++count === 2) throw Error("損壞圖片"); return createPhotoExport(...args); };
  click("[data-photo-select-all]");
  click("[data-photo-export-selected]"); await until(() => document.querySelector("#photo-export-content").dataset.status === "error");
  assert(!document.querySelector("[data-photo-export-download]"), "留下部分匯出"); close(); conversion = createPhotoExport;
});
await check("準備中取消及離頁，晚回覆不能重新開啟匯出，返回重新讀取多照", async () => {
  for (const leave of [false, true]) {
    let release; conversion = () => new Promise(resolve => { release = () => resolve(new File(["jpeg"], "pending.jpg", { type: "image/jpeg" })); });
    exportPhoto(); await until(() => release);
    if (leave) window.dispatchEvent(new Event("pagehide")); else dialog.requestClose();
    release(); await new Promise(resolve => setTimeout(resolve, 30));
    assert(!dialog.open && !document.querySelector("#photo-export-content").textContent, "晚回覆恢復了視窗");
    if (leave) { const before = reads; window.dispatchEvent(new Event("pageshow")); await until(() => reads > before && controller.getPageSnapshot().photos.length === 5); }
  }
  conversion = createPhotoExport;
});
summary.textContent = `全部 ${passed} 項通過，${failed} 項失敗。使用合成相片及模擬分享；手機相簿須另行實測。`;
click("[data-photo-select-all]"); click("[data-photo-export-selected]"); await ready();
