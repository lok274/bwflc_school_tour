import { createAppController } from "../../src/controller.js";
import { createDeviceTestController } from "../../src/device-test-controller.js";
import { DEPARTURE_LOCATION } from "../../src/data.js";
import { DEVICE_TEST_LOCATION } from "../../src/device-test-data.js";
import { STORAGE_KEY, createDefaultState } from "../../src/state.js";
import { createPhotoRepository, compressPhoto, createPhotoExport } from "../../src/photos.js";

// Each page owns only this randomly named repository and Map-backed storage.
// No reads, writes, clearing, permission requests or service workers on user storage.
const query = new URL(location.href).searchParams;
const preview = query.has("preview");
const mode = query.get("mode") || (query.get("preview") === "device" ? "device" : "formal");
const platform = query.get("platform") || "android";
const place = mode === "device" ? DEVICE_TEST_LOCATION : DEPARTURE_LOCATION;
const summary = document.querySelector("#test-summary");
const results = document.querySelector("#test-results");
const assert = (condition, message) => { if (!condition) throw Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
let passed = 0, failed = 0;
async function until(condition) {
  const end = Date.now() + 10000;
  while (!await condition()) { if (Date.now() > end) throw Error("等待逾時"); await pause(); }
}
async function check(label, action) {
  const item = document.createElement("li");
  try { await action(); passed++; item.textContent = `通過：${label}`; }
  catch (error) { failed++; item.textContent = `失敗：${label} — ${error.message}`; }
  results.append(item);
}
function click(selector) {
  const element = document.querySelector(selector);
  assert(element && !element.disabled, `找不到可用控制項 ${selector}`);
  element.click();
}
if (!["localhost", "127.0.0.1"].includes(location.hostname)) {
  summary.textContent = "停止：此測試只可在 localhost 執行。";
  summary.dataset.done = "true";
  summary.dataset.failed = "1";
  throw Error("Non-local fixture origin");
}
const storageData = new Map();
const storage = {
  getItem: key => storageData.get(key) || null,
  setItem: (key, value) => storageData.set(key, String(value)),
  removeItem: key => storageData.delete(key)
};
if (mode === "formal") {
  const state = createDefaultState();
  state.checkIns[place.id] = { attractionId: place.id, checkedInAt: "2026-11-05T00:00:00.000Z", method: "manual", verified: false };
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
  location.hash = `#attraction/${place.id}`;
} else {
  document.body.classList.add("device-test-body");
  document.querySelector(".brand-mark").textContent = "測";
  document.querySelector(".brand strong").textContent = "裝置測試";
  document.querySelector(".brand small").textContent = "GPS 與相機";
  document.querySelector(".bottom-nav").hidden = true;
}
const repository = createPhotoRepository({ databaseName: `download-notice-${mode}-${crypto.randomUUID()}` });
const canvas = document.createElement("canvas");
canvas.width = 640; canvas.height = 480;
const context = canvas.getContext("2d");
context.fillStyle = "#0b3b46"; context.fillRect(0, 0, 640, 480);
context.fillStyle = "#f5bf62"; context.fillRect(70, 80, 500, 310);
context.fillStyle = "#0b3b46"; context.font = "bold 26px sans-serif";
context.fillText("SYNTHETIC TEST PHOTO", 120, 235);
const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
assert(blob, "未能生成合成相片");
for (const [index, photoId] of ["notice-first", "notice-second"].entries()) {
  await repository.savePhotoRecord({ ...await compressPhoto(blob, place.id), photoId, writeId: photoId,
    createdAt: `2026-10-08T01:00:0${index}.000Z` });
}
let converted = [], shareMode = "success", sharingSupported = false, pendingShare = null;
let downloads = [], failingDownload = false, hostileFilename = false, shareCalls = 0;
const hostileName = '測試 "引號" & <img src=x onerror=alert(1)>.jpg';
const mockedNavigator = {
  onLine: true,
  userAgent: platform === "ios" ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1"
    : platform === "ipad" ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15"
    : platform === "android" ? "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36"
    : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0 Safari/537.36",
  platform: platform === "ipad" ? "MacIntel" : platform === "ios" ? "iPhone" : platform === "android" ? "Linux armv8l" : "Win32",
  maxTouchPoints: ["ios", "ipad", "android"].includes(platform) ? 5 : 0,
  canShare: () => sharingSupported,
  share: () => {
    shareCalls++;
    if (shareMode === "pending") return new Promise(resolve => { pendingShare = resolve; });
    return shareMode === "success" ? Promise.resolve()
      : Promise.reject(Object.assign(Error("Fixture sharing result"), { name: shareMode }));
  }
};
const photoService = { ...repository, compressPhoto,
  createPhotoExport: async (...args) => {
    const output = await createPhotoExport(...args);
    const file = hostileFilename ? new File([output], hostileName, { type: output.type }) : output;
    converted.push(file);
    return file;
  }
};
const feedback = { showToast() {}, askConfirmation: async options => options.isRelevant(),
  cancelConfirmations() {}, celebrateStamp() {} };
const environment = { document, window, location, localStorage: storage, URL, requestAnimationFrame,
  navigator: mockedNavigator, indexedDB, crypto, isSecureContext, matchMedia: window.matchMedia.bind(window) };
const inertPushClientFactory = () => ({ getSnapshot: () => ({ statusMessage: "獨立測試環境", canEnable: false, canDisable: false }),
  initialize: async () => {}, refresh: async () => {}, enable: async () => {}, disable: async () => {} });
const controller = mode === "device" ? createDeviceTestController({ environment, photoService, feedbackService: feedback })
  : createAppController({ environment, photoService, feedbackService: feedback, pushClientFactory: inertPushClientFactory });
const originalAnchorClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function () {
  if (!this.download) return originalAnchorClick.call(this);
  assert(this.href.startsWith("blob:"), "下載不是本機 Blob");
  if (failingDownload) throw Error("Fixture download failure");
  downloads.push({ filename: this.download, url: this.href });
  if (preview) return originalAnchorClick.call(this);
};
const exportDialog = document.querySelector("#photo-export-dialog");
const content = document.querySelector("#photo-export-content");
const exportStatus = () => document.querySelector("#photo-export-status")?.textContent || "";
const receipt = () => document.querySelector(".photo-export-notice");
const ready = () => exportDialog.open && content.dataset.status === "ready";
async function prepareAll() {
  click("[data-photo-select-all]"); converted = [];
  click("[data-photo-export-selected]"); await until(ready);
}
async function close() { click("[data-photo-export-close]"); await pause(); }
function assertNoFalseCompletion(text) {
  assert(!/已完成下載|下載完成|已下載完成|已存入相簿/.test(text), "網頁虛報完成下載或存入相簿");
}
function assertLocation() {
  const notice = receipt(), locationText = document.querySelector("#photo-export-location")?.textContent || "";
  assert(notice?.getAttribute("aria-label") === "下載與儲存位置", "位置提示缺少輔助閱讀標示");
  if (platform === "ios" || platform === "ipad") {
    for (const word of ["檔案", "下載", "iCloud", "iPhone"]) assert(locationText.includes(word), `iPhone/iPad 指南缺少 ${word}`);
  } else if (platform === "android") {
    for (const word of ["檔案", "下載", "Chrome"]) assert(locationText.includes(word), `Android 指南缺少 ${word}`);
  } else {
    assert(locationText.includes("瀏覽器") && locationText.includes("下載"), "桌面指南沒有指出瀏覽器下載位置");
  }
  assertNoFalseCompletion(notice.textContent);
}
await controller.start();
await pause();
if (preview) {
  document.querySelector("#test-runner").hidden = true;
  await prepareAll();
  summary.textContent = `${mode}/${platform} 下載提示預覽：合成相片、記憶體進度及獨立資料庫；按下載會真正下載測試 JPEG。`;
  summary.dataset.done = "preview";
} else {
  await check("正式或測試控制器讀取兩張獨立合成相片，未下載不顯示回執", async () => {
    assert(controller.getPageSnapshot().photos.length === 2, "兩张相片未載入");
    assert(!receipt() && !exportDialog.open, "未操作已有成功回執");
    assert(!mockedNavigator.geolocation && !mockedNavigator.mediaDevices && !mockedNavigator.serviceWorker, "測試可要求實際權限");
  });
  await check("多選準備為真正 JPEG，保持尺寸且不自動下載", async () => {
    await prepareAll();
    assert(converted.length === 2 && downloads.length === 0, "沒有準備兩張或自動下載");
    assert(!receipt() && !document.querySelector("[data-photo-export-share]"), "準備時已有成功回執或不支援仍提供分享");
    assert(document.querySelectorAll("[data-photo-export-download]").length === 2, "逐張下載入口不足");
    for (const file of converted) {
      const bytes = new Uint8Array(await file.arrayBuffer()), bitmap = await createImageBitmap(file);
      assert(file.type === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216, "不是 JPEG");
      assert(bitmap.width === 640 && bitmap.height === 480, "匯出改變尺寸"); bitmap.close();
    }
    assertNoFalseCompletion(content.textContent);
  });
  await check("下載一張只觸發一次，提示確認下載並顯示實際 JPEG 檔名及平台位置", async () => {
    document.querySelector('[data-photo-export-download="0"]').focus();
    click('[data-photo-export-download="0"]');
    assert(downloads.length === 1 && downloads[0].filename === converted[0].name, "一次下載處理多張或檔名不符");
    assert(exportStatus().includes("已開始下載第 1 張相片") && exportStatus().includes("確認是否完成"), "下載啟動與確認說明不符");
    assert(receipt()?.textContent.includes(converted[0].name), "回執沒有實際檔名");
    assertLocation();
    assert(document.querySelector("#photo-export-status") === document.activeElement, "更新提示沒有聚焦下載狀態");
    assert(document.activeElement.getAttribute("aria-describedby") === "photo-export-location", "下載狀態沒有關聯儲存位置");
    const bounds = document.activeElement.getBoundingClientRect();
    assert(bounds.bottom > 0 && bounds.top < innerHeight, "下載狀態不在畫面可見範圍");
  });
  await check("下一張下載替換當次檔名與張數，沒有自動連續下載", async () => {
    // Safari touch does not necessarily focus the clicked button.
    document.activeElement?.blur();
    click('[data-photo-export-download="1"]');
    assert(document.activeElement.id === "photo-export-status", "未聚焦按鈕時下載提示沒有取得焦點");
    assert(downloads.length === 2 && downloads[1].filename === converted[1].name, "第二次下載數量錯誤");
    assert(exportStatus().includes("第 2 張") && receipt().textContent.includes(converted[1].name), "没有更新最近下載");
    assert(!receipt().textContent.includes(converted[0].name), "留下上一張回執");
  });
  await check("下載啟動失敗清除舊成功回執，保留準備結果供重試", async () => {
    failingDownload = true;
    try { click('[data-photo-export-download="0"]'); }
    finally { failingDownload = false; }
    assert(downloads.length === 2 && !receipt(), "下載失敗仍有成功回執");
    assert(exportStatus().includes("未能開始下載") && document.querySelectorAll("[data-photo-export-download]").length === 2, "失敗沒有重試結果");
    click('[data-photo-export-download="0"]'); assert(downloads.length === 3 && receipt(), "失敗後不能重試");
  });
  await check("分享取消清除先前下載回執，沒有另行下載或更改 App 相片", async () => {
    await close(); sharingSupported = true; await prepareAll();
    click('[data-photo-export-download="0"]'); const before = downloads.length;
    shareMode = "AbortError"; click("[data-photo-export-share]");
    await until(() => ready() && exportStatus().includes("取消分享"));
    assert(!receipt() && downloads.length === before, "取消分享留下回執或自動下載");
    assert((await repository.getAllPhotoRecords()).length === 2, "取消分享刪除 App 相片");
  });
  await check("分享失敗保留 JPEG 及重試入口，沒有成功回執", async () => {
    shareMode = "NotAllowedError"; click("[data-photo-export-share]");
    await until(() => ready() && exportStatus().includes("重試"));
    assert(!receipt() && document.querySelectorAll("[data-photo-export-download]").length === 2, "失敗留下回執或丟失準備相片");
  });
  await check("分享成功指出各個儲存選項與自行確認，不推斷相簿已保存", async () => {
    shareMode = "success"; click("[data-photo-export-share]");
    await until(() => ready() && receipt());
    const text = receipt().textContent;
    for (const word of ["儲存影像", "相片", "儲存到檔案", "確認"]) assert(text.includes(word), `分享位置指南缺少 ${word}`);
    assertNoFalseCompletion(exportStatus() + text);
    assert(shareCalls === 3, "分享重試次數錯誤");
  });
  await check("分享後再次下載回執轉為當次檔名及下載位置", async () => {
    const before = downloads.length; click('[data-photo-export-download="1"]');
    assert(downloads.length === before + 1 && receipt().textContent.includes(converted[1].name), "再次下載沒有新回執");
    assertLocation();
  });
  await check("動態下載檔名在回執正確跳脫，不建立圖片或事件屬性", async () => {
    await close(); hostileFilename = true; await prepareAll();
    click('[data-photo-export-download="0"]');
    assert(receipt().textContent.includes(hostileName), "特殊檔名不能完整显示");
    assert(!receipt().querySelector("img, script, [onerror], [onclick]"), "特殊檔名被當成 HTML");
    hostileFilename = false;
  });
  await check("關閉再準備匯出清除回執，不把回執写入進度或相片資料", async () => {
    await close(); assert(!content.textContent && !exportDialog.open, "關閉留下回執");
    await prepareAll(); assert(!receipt(), "新準備沿用之前回執");
    assert([...storageData.values()].every(value => !value.includes("locationHint") && !value.includes("delivery")), "回執寫入進度");
    assert((await repository.getAllPhotoRecords()).every(record => !Object.hasOwn(record, "delivery")), "回執寫入相片");
  });
  await check("離頁清除下載回執，返回需重新選取與準備", async () => {
    click('[data-photo-export-download="0"]'); assert(receipt(), "離頁前没有回執");
    window.dispatchEvent(new Event("pagehide"));
    assert(!content.textContent && !exportDialog.open, "離頁保留下載回執");
    window.dispatchEvent(new Event("pageshow"));
    // Device pageshow awaits IndexedDB before replacing the old, enabled DOM.
    await until(() => controller.getPageSnapshot().photos.length === 2
      && controller.getPageSnapshot().photos.every(photo => !photo.selected)
      && document.querySelector("[data-photo-export-selected]")?.disabled === true);
    assert(!receipt() && document.querySelector("[data-photo-export-selected]").disabled, "返回恢復了選取或回執");
  });
  await check("離頁後分享晚回覆不重建成功提示", async () => {
    await prepareAll(); shareMode = "pending"; pendingShare = null;
    click("[data-photo-export-share]"); await until(() => pendingShare);
    window.dispatchEvent(new Event("pagehide")); pendingShare(); await pause();
    assert(!content.textContent && !exportDialog.open, "晚回覆重新開啟分享回執");
    window.dispatchEvent(new Event("pageshow"));
    await until(() => controller.getPageSnapshot().photos.length === 2
      && controller.getPageSnapshot().photos.every(photo => !photo.selected)
      && document.querySelector("[data-photo-export-selected]")?.disabled === true);
    shareMode = "success";
  });
  await check("清除本頁資料使待匯出提示失效且只清除自有資料庫", async () => {
    await prepareAll(); click('[data-photo-export-download="0"]'); await close();
    if (mode === "formal") { location.hash = "#home"; controller.render(); await pause(); }
    click(mode === "device" ? "[data-reset-test]" : "[data-reset-all]");
    await until(() => !controller.getPageSnapshot().resetting && !content.textContent);
    await until(async () => (await repository.getAllPhotoRecords()).length === 0);
    assert((await repository.getAllPhotoRecords()).length === 0, "資料未清除");
    assert(!receipt() && !exportDialog.open, "清除後保留回執");
  });
  window.dispatchEvent(new Event("pagehide"));
  await repository.clearPhotoRecords();
  HTMLAnchorElement.prototype.click = originalAnchorClick;
  summary.textContent = `${mode}／${platform}：${passed} 項通過，${failed} 項失敗。合成 JPEG、獨立資料庫與模擬分享；沒有確認真機下載完成或相簿儲存。`;
  summary.dataset.passed = String(passed); summary.dataset.failed = String(failed); summary.dataset.done = "true";
}
