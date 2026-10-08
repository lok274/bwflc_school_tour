import { createDeviceTestController } from "../../src/device-test-controller.js";
import { createDeviceTestStore } from "../../src/device-test-store.js";
import { DEVICE_TEST_LOCATION as place, DEVICE_TEST_DATABASE, DEVICE_TEST_STORAGE_KEY } from "../../src/device-test-data.js";
import { createPhotoRepository, compressPhoto } from "../../src/photos.js";
import { STORAGE_KEY, createDefaultState } from "../../src/state.js";

const summary = document.querySelector("#test-summary");
const results = document.querySelector("#test-results");
const testPhotos = createPhotoRepository({ databaseName: DEVICE_TEST_DATABASE });
const realPhotos = createPhotoRepository();
const streams = [];
const frameTimers = new Set();
const preview = new URL(location.href).searchParams.has("preview");
let passed = 0;
let gpsCalls = 0;
let cameraCalls = 0;
let nativeRequests = 0;
let cameraWidth = 1080;
let cameraHeight = 1920;
let delayCamera = false;
let resolveCamera;
let gpsMode = "near";
let fixtureState;
const fixtureId = "device-lab-integration-sentinel";
const nativeInput = document.querySelector("#native-camera-input");
nativeInput.click = () => { nativeRequests += 1; };
const assert = (value, message) => { if (!value) throw Error(message); };
async function waitFor(condition) {
  const limit = Date.now() + 12_000;
  while (!condition()) {
    if (Date.now() > limit) throw Error("等待條件逾時");
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}
async function check(label, action) {
  const item = document.createElement("li");
  try { await action(); passed += 1; item.textContent = `✓ ${label}`; }
  catch (error) { item.textContent = `✗ ${label}：${error.message}`; throw error; }
  finally { results.append(item); }
}
function click(selector) {
  const control = document.querySelector(selector);
  assert(control && !control.disabled, `找不到可用控制項 ${selector}`);
  control.click();
}
function notice(controller, expected) {
  assert(controller.getPageSnapshot().allCheckInsComplete === expected, "完成快照不符");
  assert(document.querySelectorAll("#app .checkin-completion").length === Number(expected), "完成提示數目不符");
  if (!expected) return;
  const element = document.querySelector(".checkin-completion");
  assert(element.querySelector("p").textContent === "已完成所有打卡行程", "提示文字不符");
  assert(element.getAttribute("role") === "status" && element.getAttribute("aria-live") === "polite", "缺少輔助閱讀狀態");
  assert(element.closest(".device-completion-preview")?.textContent.includes("不代表正式六站行程已完成"), "缺少測試預覽說明");
}
function makeCanvas(width = 640, height = 480) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#2f7a68";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#f2b85b";
  context.fillRect(60, 60, 300, 200);
  return canvas;
}

try {
  assert(!localStorage.getItem(STORAGE_KEY) && !localStorage.getItem(DEVICE_TEST_STORAGE_KEY), "只可在空白獨立 origin 執行，不會清除現有紀錄");
  assert(!(await realPhotos.getAllPhotoRecords()).length && !(await testPhotos.getAllPhotoRecords()).length, "相片資料庫已有紀錄，已停止測試");
  if (preview) {
    createDeviceTestStore({ storage: localStorage }).recordCheckIn({ attractionId: place.id,
      checkedInAt: "2026-11-05T04:00:00.000Z", method: "manual", verified: false });
    const controller = createDeviceTestController({ environment: { document, window, navigator, URL,
      localStorage, indexedDB, crypto, isSecureContext, requestAnimationFrame } });
    await controller.start();
    notice(controller, true);
    await navigator.serviceWorker.register(new URL("../../sw.js", import.meta.url));
    await navigator.serviceWorker.ready;
    summary.textContent = "合成測試紀錄預覽：單一測試點完成，不代表正式六站已完成。";
  } else {
  const state = createDefaultState();
  state.checkIns["future-school"] = { attractionId: "future-school", checkedInAt: "2026-11-05T04:00:00Z", method: "manual", verified: false };
  fixtureState = JSON.stringify(state);
  localStorage.setItem(STORAGE_KEY, fixtureState);
  const blob = await new Promise((resolve) => makeCanvas().toBlob(resolve, "image/png"));
  await realPhotos.savePhotoRecord({ attractionId: "future-school", blob, width: 640, height: 480, mime: "image/png", writeId: fixtureId });
  const testNavigator = {
    serviceWorker: navigator.serviceWorker,
    geolocation: { getCurrentPosition(success, failure) {
      gpsCalls += 1;
      setTimeout(() => gpsMode === "denied" ? failure({ code: 1 }) : success({ coords: {
        latitude: gpsMode === "far" ? 22.2798431 : place.geo.lat,
        longitude: gpsMode === "far" ? 114.176307 : place.geo.lng, accuracy: 20
      } }), 20);
    } },
    mediaDevices: { async getUserMedia(options) {
      cameraCalls += 1;
      assert(options.audio === false, "不可要求麥克風");
      assert(options.video.width?.ideal === 1920 && options.video.height?.ideal === 1080, "未要求高清影像");
      const canvas = makeCanvas(cameraWidth, cameraHeight);
      const stream = canvas.captureStream(5);
      streams.push(stream);
      // captureStream only emits when the canvas changes. Keep frames arriving
      // after a reopened video attaches instead of relying on its initial frame.
      let frame = 0;
      const timer = setInterval(() => {
        if (stream.getTracks().every((track) => track.readyState === "ended")) {
          clearInterval(timer);
          frameTimers.delete(timer);
          return;
        }
        const context = canvas.getContext("2d");
        context.fillStyle = frame++ % 2 ? "#2f7a68" : "#f2b85b";
        context.fillRect(0, 0, 2, 2);
      }, 100);
      frameTimers.add(timer);
      if (delayCamera) return new Promise((resolve) => { resolveCamera = () => resolve(stream); });
      return stream;
    } }
  };
  const controller = createDeviceTestController({ environment: { document, window, navigator: testNavigator, URL, localStorage, indexedDB, crypto, isSecureContext, requestAnimationFrame } });
  await check("載入不要求 GPS 或相機權限", async () => {
    await controller.start();
    assert(gpsCalls === 0 && cameraCalls === 0, "載入時要求了權限");
    notice(controller, false);
  });
  await check("範圍內打卡，只改測試紀錄", async () => {
    click("[data-checkin]");
    await waitFor(() => controller.getPageSnapshot().checkIn?.verified === true);
    assert(localStorage.getItem(STORAGE_KEY) === fixtureState, "正式清單／打卡被改動");
    const record = JSON.parse(localStorage.getItem(DEVICE_TEST_STORAGE_KEY));
    assert(!("latitude" in record) && !("longitude" in record), "保存了原始座標");
    notice(controller, true);
  });
  await check("Google 搜尋視角中心被判定為範圍外", async () => {
    gpsMode = "far";
    click("[data-checkin]");
    await waitFor(() => controller.getPageSnapshot().gpsResult?.status === "too-far");
    assert(!document.querySelector("#confirm-dialog").open, "範圍外仍可手動繞過");
  });
  await check("原生關閉請求取消手動打卡並保留已核實紀錄", async () => {
    await waitFor(() => !controller.getPageSnapshot().gpsBusy);
    const before = localStorage.getItem(DEVICE_TEST_STORAGE_KEY);
    gpsMode = "denied";
    click("[data-checkin]");
    const dialog = document.querySelector("#confirm-dialog");
    await waitFor(() => dialog.open);
    assert(typeof dialog.requestClose === "function", "瀏覽器不支援原生 requestClose，需另用 Android 真機驗證");
    dialog.requestClose();
    await waitFor(() => !dialog.open && !controller.getPageSnapshot().gpsBusy);
    assert(localStorage.getItem(DEVICE_TEST_STORAGE_KEY) === before, "取消後改動了打卡");
    notice(controller, true);
  });
  await check("拒絕定位只可另作未核實手動記錄", async () => {
    await waitFor(() => !controller.getPageSnapshot().gpsBusy);
    gpsMode = "denied";
    click("[data-checkin]");
    await waitFor(() => document.querySelector("#confirm-dialog").open);
    click("#confirm-button");
    await waitFor(() => controller.getPageSnapshot().checkIn?.method === "manual");
    assert(controller.getPageSnapshot().checkIn.verified === false, "手動紀錄被核實");
    notice(controller, true);
    assert(document.querySelector("#app").textContent.includes("未核實"), "手動標示丟失");
  });
  await check("手機拍攝入口不開網頁串流，4:3 回覆等比例保存成 1600 × 1200", async () => {
    const blob = await new Promise((resolve) => makeCanvas(2000, 1500).toBlob(resolve, "image/png"));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], "native-fixture.png", { type: blob.type }));
    click("[data-native-camera-open]");
    assert(nativeRequests === 1 && cameraCalls === 0, "手機入口開啟了網頁串流");
    assert(nativeInput.getAttribute("capture") === "environment" && !document.querySelector("#photo-input"), "拍攝與相簿混用輸入");
    nativeInput.files = transfer.files;
    nativeInput.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => !controller.getPageSnapshot().photoBusy && controller.getPageSnapshot().photo?.width === 1600);
    const saved = await testPhotos.getPhotoRecord(place.id);
    const decoded = await createImageBitmap(saved.blob);
    assert(saved.width === 1600 && saved.height === 1200 && decoded.width === 1600 && decoded.height === 1200, "4:3 相片被裁切或拉伸");
    decoded.close();
  });
  await check("取消手機拍攝後的延遲檔案不覆蓋原照", async () => {
    const before = await testPhotos.getPhotoRecord(place.id);
    click("[data-native-camera-open]");
    nativeInput.dispatchEvent(new Event("cancel"));
    const transfer = new DataTransfer();
    transfer.items.add(new File([before.blob], "late-native.webp", { type: before.blob.type }));
    nativeInput.files = transfer.files;
    nativeInput.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => !controller.getPageSnapshot().photoBusy);
    assert((await testPhotos.getPhotoRecord(place.id)).writeId === before.writeId, "取消仍覆蓋原照");
  });
  await check("高清直向串流可拍攝、重拍，壓縮後 900 × 1600 從 IndexedDB 讀回", async () => {
    click("[data-camera-open]");
    await waitFor(() => document.querySelector("#camera-video").videoWidth > 0 && document.querySelector("#camera-loading").hidden);
    assert(controller.getPageSnapshot().cameraResult.width === 1080 && controller.getPageSnapshot().cameraResult.height === 1920, "未回報真實直向影像尺寸");
    assert(document.querySelector("#camera-result").textContent.includes("1080 × 1920"), "畫面未顯示影像尺寸");
    assert(getComputedStyle(document.querySelector("#camera-video")).objectFit === "contain", "直向預覽仍會裁切");
    click("[data-camera-capture]");
    await waitFor(() => !document.querySelector("#camera-preview").hidden);
    click("[data-camera-retake]");
    assert(document.querySelector("#camera-preview").hidden, "重拍未清除預覽");
    click("[data-camera-capture]");
    await waitFor(() => !document.querySelector("#camera-preview").hidden);
    click("[data-camera-save]");
    await waitFor(() => Boolean(controller.getPageSnapshot().photo) && !controller.getPageSnapshot().photoBusy);
    const saved = await testPhotos.getPhotoRecord(place.id);
    assert(saved.width === 900 && saved.height === 1600 && saved.blob.size > 0, "照片未按原比例壓縮至 1600 像素");
    const decoded = await createImageBitmap(saved.blob);
    assert(decoded.width === 900 && decoded.height === 1600, "保存檔案的真實像素與紀錄不符");
    decoded.close();
    assert(streams.every((stream) => stream.getTracks().every((track) => track.readyState === "ended")), "保存後鏡頭仍運作");
    assert((await realPhotos.getPhotoRecord("future-school")).writeId === fixtureId, "正式相片被改動");
    const stored = createDeviceTestStore({ storage: localStorage }).getCheckIn();
    assert(stored.method === "manual" && !stored.verified, "重新讀取打卡不符");
  });
  await check("低解像相機仍可啟動，回報實際尺寸及建議，原有高清相片保留", async () => {
    cameraWidth = 640;
    cameraHeight = 480;
    click("[data-camera-open]");
    await waitFor(() => document.querySelector("#camera-video").videoWidth > 0 && document.querySelector("#camera-loading").hidden);
    assert(document.querySelector("#camera-result").textContent.includes("640 × 480"), "低解像尺寸被誤報為高清");
    assert(document.querySelector("#app").textContent.includes("解像度較低"), "未顯示低解像建議");
    click("[data-camera-close]");
    await waitFor(() => !document.querySelector("#camera-dialog").open);
    const saved = await testPhotos.getPhotoRecord(place.id);
    assert(saved.width === 900 && saved.height === 1600, "開啟低解像相機便改動原照");
  });
  await check("關閉相機停止串流", async () => {
    click("[data-camera-open]");
    await waitFor(() => document.querySelector("#camera-loading").hidden);
    click("[data-camera-close]");
    await waitFor(() => !document.querySelector("#camera-dialog").open);
    assert(streams.every((stream) => stream.getTracks().every((track) => track.readyState === "ended")), "關閉後仍有串流");
  });
  await check("原生取消相機停止串流、丟棄未保存照片且保留原照與網址", async () => {
    const original = await testPhotos.getPhotoRecord(place.id);
    const originalUrl = location.href;
    click("[data-camera-open]");
    await waitFor(() => document.querySelector("#camera-video").videoWidth > 0 && document.querySelector("#camera-loading").hidden);
    click("[data-camera-capture]");
    await waitFor(() => !document.querySelector("#camera-preview").hidden);
    document.querySelector("#camera-dialog").requestClose();
    await waitFor(() => !document.querySelector("#camera-dialog").open);
    assert(streams.every((stream) => stream.getTracks().every((track) => track.readyState === "ended")), "取消後相機仍運作");
    assert(document.querySelector("#camera-preview").hidden && !document.querySelector("#camera-preview").hasAttribute("src"), "未釋放拍攝預覽");
    assert((await testPhotos.getPhotoRecord(place.id)).writeId === original.writeId, "取消後覆寫了原照");
    assert(location.href === originalUrl, "取消視窗消耗了頁面歷史");
  });
  await check("原生取消等待權限的相機後，延遲串流會停止", async () => {
    delayCamera = true;
    click("[data-camera-open]");
    await waitFor(() => document.querySelector("#camera-dialog").open && Boolean(resolveCamera));
    document.querySelector("#camera-dialog").requestClose();
    resolveCamera();
    delayCamera = false;
    await waitFor(() => streams.every((stream) => stream.getTracks().every((track) => track.readyState === "ended")));
    assert(document.querySelector("#camera-video").srcObject === null, "延遲串流重新接上畫面");
    assert(!document.querySelector("#camera-dialog").open, "相機重新開啟");
  });
  await check("原生取消清除的任一確認階段均保留測試及正式資料", async () => {
    const originalCheckIn = localStorage.getItem(DEVICE_TEST_STORAGE_KEY);
    const originalPhoto = await testPhotos.getPhotoRecord(place.id);
    const dialog = document.querySelector("#confirm-dialog");
    for (const stage of [1, 2]) {
      click("[data-reset-test]");
      await waitFor(() => dialog.open);
      if (stage === 2) {
        click("#confirm-button");
        await waitFor(() => dialog.open && document.querySelector("#confirm-title").textContent === "最後確認");
      }
      dialog.requestClose();
      await waitFor(() => !dialog.open);
      assert(!controller.getPageSnapshot().resetting, "取消後仍開始清除");
      assert(localStorage.getItem(DEVICE_TEST_STORAGE_KEY) === originalCheckIn, "取消後清除了測試打卡");
      assert((await testPhotos.getPhotoRecord(place.id)).writeId === originalPhoto.writeId, "取消後清除了測試相片");
      assert(localStorage.getItem(STORAGE_KEY) === fixtureState, "正式紀錄被改動");
      notice(controller, true);
    }
  });
  await check("逐張刪照及相簿控制項已移除，原照保留", async () => {
    assert(!document.querySelector("[data-photo-delete], [data-gallery-open], [data-photo-export], #photo-input"), "舊控制項仍存在");
    assert(await testPhotos.getPhotoRecord(place.id), "原照被刪除");
  });
  await check("兩次確認清除只刪測試紀錄，保留正式紀錄與相片", async () => {
    click("[data-reset-test]");
    await waitFor(() => document.querySelector("#confirm-dialog").open);
    click("#confirm-button");
    await waitFor(() => document.querySelector("#confirm-dialog").open && document.querySelector("#confirm-title").textContent === "最後確認");
    click("#confirm-button");
    await waitFor(() => !controller.getPageSnapshot().resetting && !controller.getPageSnapshot().checkIn && !controller.getPageSnapshot().photo);
    assert(!(await testPhotos.getAllPhotoRecords()).length, "測試相片仍存在");
    notice(controller, false);
    assert(localStorage.getItem(STORAGE_KEY) === fixtureState, "正式紀錄被清除");
    assert((await realPhotos.getPhotoRecord("future-school")).writeId === fixtureId, "正式相片被清除");
  });
  await check("v44 快取含獨立測試頁，正式首頁保持正確", async () => {
    await navigator.serviceWorker.register(new URL("../../sw.js", import.meta.url));
    await navigator.serviceWorker.ready;
    const cache = await caches.open("outdoor-learning-day-v44");
    const base = new URL("../../", import.meta.url);
    const cachedTest = await cache.match(new URL("device-test.html", base));
    const cachedHome = await cache.match(new URL("index.html", base));
    assert(cachedTest && cachedHome, "離線文件缺失");
    assert((await cachedTest.text()).includes("打卡與相機實機測試"), "快取不是測試頁");
    assert((await cachedHome.text()).includes("戶外學習日旅程助手"), "正式首頁被測試頁取代");
  });
  summary.textContent = `全部 ${passed} 項通過；GPS 與影像來源為模擬，真機須另行測試。`;
  }
} catch (error) {
  summary.textContent = `測試停止：${error.message}（已通過 ${passed} 項）`;
} finally {
  for (const timer of frameTimers) clearInterval(timer);
  streams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
  if (fixtureState) {
    const sentinel = await realPhotos.getPhotoRecord("future-school");
    if (sentinel?.writeId === fixtureId) await realPhotos.deletePhotoRecord("future-school");
    if (localStorage.getItem(STORAGE_KEY) === fixtureState) localStorage.removeItem(STORAGE_KEY);
  }
}
