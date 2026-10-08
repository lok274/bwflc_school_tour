import { createAppController } from "../../src/controller.js";
import { ATTRACTIONS, CHECK_IN_LOCATIONS, DEPARTURE_LOCATION } from "../../src/data.js";
import * as photos from "../../src/photos.js";
import { STORAGE_KEY, createDefaultState } from "../../src/state.js";

// Fixture-only wiring: no real permission prompts or public backend requests.
const summary = document.querySelector("#test-summary");
const results = document.querySelector("#test-results");
const preview = new URL(location.href).searchParams.has("preview");
const school = DEPARTURE_LOCATION.id;
const detail = `#attraction/${school}`;
const foreign = ATTRACTIONS[0].id;
const originalTime = "2026-11-05T00:00:00.000Z";
const require = (condition, message) => { if (!condition) throw Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
let passed = 0;
let failed = 0;
async function until(condition) {
  const end = Date.now() + 5000;
  while (!condition()) { if (Date.now() > end) throw Error("等待操作完成逾時"); await pause(); }
}
async function check(label, run) {
  const item = document.createElement("li");
  try { await run(); passed++; item.textContent = `通過：${label}`; }
  catch (error) { failed++; item.textContent = `失敗：${label} — ${error.message}`; }
  results.append(item);
}
function click(selector) {
  const target = document.querySelector(selector);
  require(target, `沒有控制項 ${selector}`);
  target.click();
}
async function navigate(hash) {
  location.hash = hash;
  application.render();
  // Drain hashchange before starting work that depends on its page token.
  await pause();
}
async function confirm() {
  await until(() => document.querySelector("#confirm-dialog").open);
  click("#confirm-button");
  await pause();
}

if (!["localhost", "127.0.0.1"].includes(location.hostname)) {
  summary.textContent = "停止：此測試只可在 localhost 的獨立空白 origin 執行。";
  throw Error("Non-local fixture origin");
}
const originalPhotos = await photos.getAllPhotoRecords();
if (localStorage.length || originalPhotos.length) {
  summary.textContent = "停止：此 origin 已有資料。請改用空白測試 origin；沒有改動或清除原資料。";
  throw Error("Non-empty test origin");
}

const state = createDefaultState();
for (const place of CHECK_IN_LOCATIONS) {
  state.checkIns[place.id] = { attractionId: place.id, checkedInAt: originalTime,
    method: place.id === school ? "manual" : "gps", verified: place.id !== school };
}
localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
const sourceCanvas = document.createElement("canvas");
sourceCanvas.width = 2000;
sourceCanvas.height = 1500;
const context = sourceCanvas.getContext("2d");
context.fillStyle = "#0b3b46";
context.fillRect(0, 0, 2000, 1500);
context.fillStyle = "#f5bf62";
context.fillRect(240, 240, 1520, 1020);
context.fillStyle = "#0b3b46";
context.font = "bold 90px sans-serif";
context.fillText("SYNTHETIC TEST PHOTO", 340, 780);
const fixtureBlob = await new Promise(resolve => sourceCanvas.toBlob(resolve, "image/png"));
require(fixtureBlob, "未能生成合成相片");
const foreignPhoto = { ...await photos.compressPhoto(fixtureBlob, foreign),
  photoId: "school-fixture-foreign", writeId: "school-fixture-foreign" };
await photos.savePhotoRecord(foreignPhoto);

let shareMode = "success";
let nativeOpened = 0;
let downloadCount = 0;
let converted = [];
let convertOverride = null;
let pendingMediaRequest = null;
let mediaConstraints;
const sharedFiles = [];
const mockedNavigator = { onLine: true, canShare: () => true,
  share: ({ files }) => {
    sharedFiles.push(files);
    return shareMode === "success" ? Promise.resolve()
      : Promise.reject(Object.assign(Error("Fixture sharing result"), { name: shareMode }));
  },
  mediaDevices: { getUserMedia: constraints => {
    mediaConstraints = constraints;
    return new Promise(resolve => { pendingMediaRequest = resolve; });
  } }
};
const photoService = { ...photos,
  createPhotoExport: async (...args) => {
    const file = await (convertOverride || photos.createPhotoExport)(...args);
    converted.push(file);
    return file;
  }
};
const proxyPhotos = Object.fromEntries(Object.keys(photoService).map(name => [name, (...args) => photoService[name](...args)]));
const pushClientFactory = () => ({
  getSnapshot: () => ({ statusMessage: "獨立測試環境", canEnable: false, canDisable: false }),
  initialize: async () => {}, refresh: async () => {}, enable: async () => {}, disable: async () => {}
});
location.hash = detail;
const application = createAppController({
  environment: { document, window, location, localStorage, URL, requestAnimationFrame, indexedDB,
    navigator: mockedNavigator, matchMedia: window.matchMedia.bind(window) },
  photoService: proxyPhotos, pushClientFactory
});
const nativeInput = document.querySelector("#native-camera-input");
const originalNativeClick = nativeInput.click;
nativeInput.click = () => { nativeOpened++; };
const exportDialog = document.querySelector("#photo-export-dialog");
const exportReady = () => exportDialog.open && document.querySelector("#photo-export-content").dataset.status === "ready";
async function takePhoto() {
  click(`[data-native-camera-open="${school}"]`);
  const transfer = new DataTransfer();
  transfer.items.add(new File([fixtureBlob], "school-fixture.png", { type: fixtureBlob.type }));
  nativeInput.files = transfer.files;
  nativeInput.dispatchEvent(new Event("change", { bubbles: true }));
}
async function prepareAll() {
  click("[data-photo-select-all]");
  click("[data-photo-export-selected]");
  await until(exportReady);
}
const originalAnchorClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function () {
  if (this.download) { downloadCount++; require(this.href.startsWith("blob:"), "下載沒有使用本機 Blob"); }
  else originalAnchorClick.call(this);
};
await application.start();
await pause();

if (preview) {
  for (const expected of [1, 2]) { await takePhoto(); await until(() => application.getPageSnapshot().photos?.length === expected); }
  document.querySelector("#test-runner").hidden = true;
  summary.textContent = "學校操作頁預覽：六站虛構打卡及兩張合成相片。";
  summary.dataset.done = "preview";
} else {
  await check("行程學校連結進入共用詳情，舊手動打卡及六站完成提示保留", async () => {
    await navigate("#itinerary");
    const link = document.querySelector(`.route-line a[href="${detail}"]`);
    require(link?.textContent === DEPARTURE_LOCATION.name, "學校仍連到外部地圖");
    require(!document.querySelector("#departure-checkin, .route-line [data-checkin], .route-line [data-checkin-undo]"), "行程仍有學校專用打卡按鈕");
    link.click();
    await until(() => location.hash === detail);
    application.render();
    await pause();
    const model = application.getPageSnapshot();
    require(model.view === "attraction" && model.attraction.id === school, "未使用共用景點路由");
    require(model.checkIn.checkedInAt === originalTime && model.checkIn.method === "manual" && !model.checkIn.verified, "舊學校記錄被改寫");
    require(document.querySelector(".checked-in-panel").textContent.includes("未核實手動記錄"), "手動紀錄沒有未核實標示");
    require(model.allCheckInsComplete && document.querySelector(".checkin-completion"), "六站完成提示沒有保留");
    require(document.querySelector(`.source-link a[href="${DEPARTURE_LOCATION.mapUrl}"]`), "詳情內沒有提供原地圖連結");
    require(document.querySelector(`[data-native-camera-open="${school}"]`) && document.querySelector(`[data-camera-open="${school}"]`), "學校缺少共用拍攝控制項");
    require(!("state" in model) && !("checkIns" in model), "詳情取得完整保存資料");
    require(!document.querySelector('.detail-hero img[src="undefined"]'), "沒有學校圖片卻產生失效圖片");
  });

  await check("連續兩次手機相機回覆追加學校相片，真實壓縮、IndexedDB 及預覽正常", async () => {
    for (const expected of [1, 2]) { await takePhoto(); await until(() => application.getPageSnapshot().photos?.length === expected); }
    const records = (await photos.getAllPhotoRecords()).filter(record => record.attractionId === school);
    require(nativeOpened === 2 && records.length === 2 && records[0].photoId !== records[1].photoId, "多張相片被覆蓋或沒有開啟共用相機入口");
    require(records.every(record => record.blob instanceof Blob && record.width === 1600 && record.height === 1200), "學校相片壓縮格式或尺寸錯誤");
    const images = [...document.querySelectorAll(".has-photo img")];
    for (const image of images) { image.loading = "eager"; await image.decode(); require(image.naturalWidth === 1600, "學校預覽未解碼"); }
    require(application.getPageSnapshot().photos.every(record => !Object.hasOwn(record, "blob")), "畫面取得相片 Blob");
    require(document.querySelectorAll("[data-photo-export-selected]").length === 1, "不是一個多選儲存按鈕");
    require(!document.querySelector("[data-gallery-open], [data-photo-delete], [data-photo-export]"), "恢復了已移除的相簿或逐張操作");
    require(document.documentElement.scrollWidth <= innerWidth, "畫面橫向溢出");
  });

  await check("學校多選匯出真實 JPEG，維持尺寸及獨立檔名，不混入別站", async () => {
    require(document.querySelector("[data-photo-export-selected]").disabled, "未選相片時可匯出");
    converted = [];
    await prepareAll();
    require(converted.length === 2 && document.querySelectorAll("[data-photo-export-download]").length === 2, "沒有完整準備兩張相片");
    const ids = application.getPageSnapshot().photos.map(record => record.photoId);
    for (const file of converted) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const bitmap = await createImageBitmap(file);
      require(file instanceof File && file.type === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216, "輸出不是 JPEG File");
      require(bitmap.width === 1600 && bitmap.height === 1200, "匯出更改尺寸");
      bitmap.close();
      require(file.name.includes(DEPARTURE_LOCATION.name) && ids.some(id => file.name.includes(id)), "檔名缺少學校名稱及相片 ID");
      require(!file.name.includes(foreignPhoto.photoId), "匯出混入其他站");
    }
  });

  await check("學校分享取消和失敗保留 JPEG、重試及下載，不自動下載或刪照", async () => {
    const beforeDownloads = downloadCount;
    for (const mode of ["AbortError", "NotAllowedError"]) {
      shareMode = mode;
      click("[data-photo-export-share]");
      await until(exportReady);
      require(document.querySelector("#photo-export-status").textContent.includes(mode === "AbortError" ? "取消分享" : "重試"), "分享結果提示不正確");
      require(document.querySelectorAll("[data-photo-export-download]").length === 2, "取消或失敗丟失已準備相片");
    }
    require(sharedFiles.length === 2 && sharedFiles.every(files => files.length === 2), "分享錯誤的相片集合");
    require(downloadCount === beforeDownloads && (await photos.getAllPhotoRecords()).length === 3, "分享取消自動下載或刪照");
    shareMode = "success";
    click("[data-photo-export-close]");
    await pause();
  });

  await check("學校不支援檔案分享時提供逐張下載，按一次只下載一張", async () => {
    mockedNavigator.canShare = () => false;
    try {
      await prepareAll();
      require(!document.querySelector("[data-photo-export-share]") && document.querySelectorAll("[data-photo-export-download]").length === 2, "分享後備入口不正確");
      const before = downloadCount;
      click('[data-photo-export-download="0"]');
      require(downloadCount === before + 1, "下載自動處理全部相片");
      require(document.querySelector("#photo-export-status").textContent.includes("已開始下載第 1 張相片"), "下載結果沒有指出目前張數");
      const receipt = document.querySelector("#photo-export-location");
      require(receipt?.textContent.includes(converted[0].name) && receipt.textContent.includes("下載"), "下載結果沒有提供檔名及位置指引");
      click("[data-photo-export-close]");
      await pause();
    } finally { mockedNavigator.canShare = () => true; }
  });

  await check("共用旅程卡使用學校相片並生成真實 1080 × 1350 PNG", async () => {
    let card;
    const original = photoService.createTravelCard;
    photoService.createTravelCard = async options => {
      require(options.attraction.id === school && options.photoRecord.attractionId === school, "旅程卡使用了別站資料");
      card = await photos.createTravelCard(options);
      return card;
    };
    try {
      const downloads = downloadCount;
      click(`[data-card-download="${school}"]`);
      await confirm();
      await until(() => downloadCount === downloads + 1);
      const bitmap = await createImageBitmap(card);
      require(card.type === "image/png" && bitmap.width === 1080 && bitmap.height === 1350, "旅程卡輸出錯誤");
      bitmap.close();
    } finally { photoService.createTravelCard = original; }
  });

  await check("學校網頁相機共用標題與關閉生命週期，離頁後停止延遲回覆的 tracks", async () => {
    pendingMediaRequest = null;
    click(`[data-camera-open="${school}"]`);
    await until(() => pendingMediaRequest);
    require(document.querySelector("#camera-dialog").open && document.querySelector("#camera-title").textContent.includes(DEPARTURE_LOCATION.name), "學校網頁相機未開啟");
    require(mediaConstraints.audio === false && mediaConstraints.video.facingMode.ideal === "environment", "相機要求不是共用後置鏡頭設定");
    await navigate("#itinerary");
    let stopped = 0;
    pendingMediaRequest({ getTracks: () => [{ stop() { stopped++; } }] });
    await until(() => stopped === 1);
    require(!document.querySelector("#camera-dialog").open, "離頁後相機仍開啟");
    await navigate(detail);
  });

  await check("離頁使學校匯出準備及選取失效，延遲轉換不重開視窗", async () => {
    let release;
    convertOverride = () => new Promise(resolve => { release = () => resolve(new File(["fixture"], "stale.jpg", { type: "image/jpeg" })); });
    try {
      click("[data-photo-select-all]");
      click("[data-photo-export-selected]");
      await until(() => release);
      await navigate("#itinerary");
      release();
      await pause();
      require(!exportDialog.open, "延遲轉換恢復離頁匯出");
      await navigate(detail);
      require(application.getPageSnapshot().photos.every(record => !record.selected), "離頁仍保留勾選");
    } finally { convertOverride = null; }
  });

  await check("離頁後手機相機的延遲壓縮不新增學校照片或污染其他站", async () => {
    let release;
    let processed = false;
    const original = photoService.compressPhoto;
    photoService.compressPhoto = async (...args) => {
      await new Promise(resolve => { release = resolve; });
      const record = await original(...args);
      processed = true;
      return record;
    };
    try {
      await takePhoto();
      await until(() => release);
      await navigate(`#attraction/${foreign}`);
      release();
      await until(() => processed);
      require((await photos.getAllPhotoRecords()).length === 3, "過期相機回覆仍寫入資料");
      require(application.getPageSnapshot().photos.length === 1 && application.getPageSnapshot().photos[0].photoId === foreignPhoto.photoId, "跨站詳情混入學校照片");
      await navigate(detail);
    } finally { photoService.compressPhoto = original; }
  });

  await check("學校刪照失敗保留打卡、完成提示及相片，別站資料不受影響", async () => {
    const original = photoService.deletePhotoRecord;
    photoService.deletePhotoRecord = async id => {
      require(id === school, "刪除了其他站的相片");
      throw Error("Fixture deletion failure");
    };
    try {
      click(`[data-checkin-undo="${school}"]`);
      await confirm();
      await until(() => document.querySelector("#toast").textContent.includes("打卡紀錄會暫時保留"));
      require(application.getPageSnapshot().checkIn?.checkedInAt === originalTime && application.getPageSnapshot().allCheckInsComplete, "刪照失敗仍移除學校打卡");
      require(application.getPageSnapshot().photos.length === 2 && (await photos.getPhotoRecord(foreign, foreignPhoto.photoId)).writeId === foreignPhoto.writeId, "刪照失敗損壞照片");
    } finally { photoService.deletePhotoRecord = original; }
  });

  await check("準備中取消學校打卡立即關閉匯出，只刪學校兩張相片並移除完成提示", async () => {
    let release;
    convertOverride = () => new Promise(resolve => { release = () => resolve(new File(["fixture"], "cancelled.jpg", { type: "image/jpeg" })); });
    try {
      click("[data-photo-select-all]");
      click("[data-photo-export-selected]");
      await until(() => release);
      // Model a concurrent cancellation while JPEG preparation is pending.
      click(`[data-checkin-undo="${school}"]`);
      await confirm();
      await until(() => !application.getPageSnapshot().checkIn && document.querySelector(`[data-checkin="${school}"]`));
      release();
      await pause();
      const remaining = await photos.getAllPhotoRecords();
      require(!exportDialog.open && application.getPageSnapshot().photos.length === 0, "取消打卡恢復過期匯出或照片");
      require(remaining.length === 1 && remaining[0].attractionId === foreign, "取消學校打卡刪掉別站照片");
      require(!application.getPageSnapshot().allCheckInsComplete && !document.querySelector(".checkin-completion"), "學校取消後完成提示仍在");
      await navigate("#itinerary");
      require(ATTRACTIONS.every(place => application.getPageSnapshot().checkIns[place.id]), "取消學校打卡影響原五站");
      await navigate(detail);
    } finally { convertOverride = null; }
  });

  await check("學校 GPS 打卡立即恢復六站完成提示，取消確認不更改紀錄", async () => {
    mockedNavigator.geolocation = { getCurrentPosition: success => success({ coords: {
      latitude: DEPARTURE_LOCATION.geo.lat, longitude: DEPARTURE_LOCATION.geo.lng, accuracy: 5
    } }) };
    click(`[data-checkin="${school}"]`);
    await until(() => Boolean(application.getPageSnapshot().checkIn));
    require(application.getPageSnapshot().checkIn.verified && application.getPageSnapshot().allCheckInsComplete && document.querySelector(".checkin-completion"), "學校 GPS 沒有立即計入六站完成");
    const saved = localStorage.getItem(STORAGE_KEY);
    click(`[data-checkin-undo="${school}"]`);
    await until(() => document.querySelector("#confirm-dialog").open);
    click('#confirm-dialog button[value="cancel"]');
    await pause();
    require(localStorage.getItem(STORAGE_KEY) === saved && application.getPageSnapshot().checkIn.verified, "取消確認仍更改打卡");
  });

  await check("學校再次使用共用手動確認，六站完成但保持未核實標示", async () => {
    click(`[data-checkin-undo="${school}"]`);
    await confirm();
    // The record disappears before the asynchronous photo refresh re-renders.
    // Wait for the visible shared check-in control before starting the next action.
    await until(() => !application.getPageSnapshot().checkIn && document.querySelector(`[data-checkin="${school}"]`));
    delete mockedNavigator.geolocation;
    click(`[data-checkin="${school}"]`);
    await confirm();
    await until(() => Boolean(application.getPageSnapshot().checkIn));
    require(application.getPageSnapshot().checkIn.method === "manual" && !application.getPageSnapshot().checkIn.verified, "手動學校打卡被核實");
    require(application.getPageSnapshot().allCheckInsComplete && document.querySelector(".checked-in-panel").textContent.includes("未核實手動記錄"), "手動完成規則或標示不一致");
  });

  await check("首頁兩次確認清除測試資料，重新進入學校顯示未打卡及鎖定相片區", async () => {
    await navigate("#home");
    click("[data-reset-all]");
    await confirm();
    await confirm();
    await until(() => localStorage.getItem(STORAGE_KEY) === null);
    require((await photos.getAllPhotoRecords()).length === 0, "測試照片仍保存");
    await navigate(detail);
    require(!application.getPageSnapshot().checkIn && !application.getPageSnapshot().allCheckInsComplete, "清除後學校打卡仍在");
    require(document.querySelector(".photo-locked") && !document.querySelector(`[data-native-camera-open="${school}"]`), "未打卡時仍能拍照");
  });

  // The guard above established that every record on this origin belongs to us.
  await photos.clearPhotoRecords();
  localStorage.removeItem(STORAGE_KEY);
  nativeInput.click = originalNativeClick;
  HTMLAnchorElement.prototype.click = originalAnchorClick;
  summary.textContent = `${passed} 項通過，${failed} 項失敗`;
  summary.dataset.done = "true";
  summary.dataset.passed = String(passed);
  summary.dataset.failed = String(failed);
}
