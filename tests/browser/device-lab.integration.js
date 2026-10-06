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
let passed = 0;
let gpsCalls = 0;
let cameraCalls = 0;
let delayCamera = false;
let resolveCamera;
let gpsMode = "near";
let fixtureState;
const fixtureId = "device-lab-integration-sentinel";
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
function makeCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 480;
  const context = canvas.getContext("2d");
  context.fillStyle = "#2f7a68";
  context.fillRect(0, 0, 640, 480);
  context.fillStyle = "#f2b85b";
  context.fillRect(60, 60, 300, 200);
  return canvas;
}

try {
  assert(!localStorage.getItem(STORAGE_KEY) && !localStorage.getItem(DEVICE_TEST_STORAGE_KEY), "只可在空白獨立 origin 執行，不會清除現有紀錄");
  assert(!(await realPhotos.getAllPhotoRecords()).length && !(await testPhotos.getAllPhotoRecords()).length, "相片資料庫已有紀錄，已停止測試");
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
      const canvas = makeCanvas();
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
  });
  await check("範圍內打卡，只改測試紀錄", async () => {
    click("[data-checkin]");
    await waitFor(() => controller.getPageSnapshot().checkIn?.verified === true);
    assert(localStorage.getItem(STORAGE_KEY) === fixtureState, "正式清單／打卡被改動");
    const record = JSON.parse(localStorage.getItem(DEVICE_TEST_STORAGE_KEY));
    assert(!("latitude" in record) && !("longitude" in record), "保存了原始座標");
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
  });
  await check("拒絕定位只可另作未核實手動記錄", async () => {
    await waitFor(() => !controller.getPageSnapshot().gpsBusy);
    gpsMode = "denied";
    click("[data-checkin]");
    await waitFor(() => document.querySelector("#confirm-dialog").open);
    click("#confirm-button");
    await waitFor(() => controller.getPageSnapshot().checkIn?.method === "manual");
    assert(controller.getPageSnapshot().checkIn.verified === false, "手動紀錄被核實");
  });
  await check("合成串流可拍攝、重拍及保存，真實 Canvas／IndexedDB 讀回成功", async () => {
    click("[data-camera-open]");
    await waitFor(() => document.querySelector("#camera-video").videoWidth > 0 && document.querySelector("#camera-loading").hidden);
    click("[data-camera-capture]");
    await waitFor(() => !document.querySelector("#camera-preview").hidden);
    click("[data-camera-retake]");
    assert(document.querySelector("#camera-preview").hidden, "重拍未清除預覽");
    click("[data-camera-capture]");
    await waitFor(() => !document.querySelector("#camera-preview").hidden);
    click("[data-camera-save]");
    await waitFor(() => Boolean(controller.getPageSnapshot().photo) && !controller.getPageSnapshot().photoBusy);
    const saved = await testPhotos.getPhotoRecord(place.id);
    assert(saved.width === 640 && saved.height === 480 && saved.blob.size > 0, "照片未寫入獨立資料庫");
    assert(streams.every((stream) => stream.getTracks().every((track) => track.readyState === "ended")), "保存後鏡頭仍運作");
    assert((await realPhotos.getPhotoRecord("future-school")).writeId === fixtureId, "正式相片被改動");
    const stored = createDeviceTestStore({ storage: localStorage }).getCheckIn();
    assert(stored.method === "manual" && !stored.verified, "重新讀取打卡不符");
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
    }
  });
  await check("原生取消目前與排隊刪相，不會再彈出下一個確認", async () => {
    const original = await testPhotos.getPhotoRecord(place.id);
    click("[data-photo-delete]");
    click("[data-photo-delete]");
    const dialog = document.querySelector("#confirm-dialog");
    await waitFor(() => dialog.open);
    const closed = new Promise((resolve) => dialog.addEventListener("close", resolve, { once: true }));
    dialog.requestClose();
    await closed;
    assert((await testPhotos.getPhotoRecord(place.id)).writeId === original.writeId, "取消後刪除了測試相片");
    assert(!dialog.open, "已取消的排隊確認仍被打開");
    assert(localStorage.getItem(STORAGE_KEY) === fixtureState, "正式紀錄被改動");
  });
  await check("兩次確認清除只刪測試紀錄，保留正式紀錄與相片", async () => {
    click("[data-reset-test]");
    await waitFor(() => document.querySelector("#confirm-dialog").open);
    click("#confirm-button");
    await waitFor(() => document.querySelector("#confirm-dialog").open && document.querySelector("#confirm-title").textContent === "最後確認");
    click("#confirm-button");
    await waitFor(() => !controller.getPageSnapshot().resetting && !controller.getPageSnapshot().checkIn && !controller.getPageSnapshot().photo);
    assert(!(await testPhotos.getAllPhotoRecords()).length, "測試相片仍存在");
    assert(localStorage.getItem(STORAGE_KEY) === fixtureState, "正式紀錄被清除");
    assert((await realPhotos.getPhotoRecord("future-school")).writeId === fixtureId, "正式相片被清除");
  });
  await check("v24 快取含獨立測試頁，正式首頁保持正確", async () => {
    await navigator.serviceWorker.register(new URL("../../sw.js", import.meta.url));
    await navigator.serviceWorker.ready;
    const cache = await caches.open("outdoor-learning-day-v24");
    const base = new URL("../../", import.meta.url);
    const cachedTest = await cache.match(new URL("device-test.html", base));
    const cachedHome = await cache.match(new URL("index.html", base));
    assert(cachedTest && cachedHome, "離線文件缺失");
    assert((await cachedTest.text()).includes("打卡與相機實機測試"), "快取不是測試頁");
    assert((await cachedHome.text()).includes("戶外學習日旅程助手"), "正式首頁被測試頁取代");
  });
  summary.textContent = `全部 ${passed} 項通過；GPS 與影像來源為模擬，真機須另行測試。`;
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
