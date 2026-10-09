import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { DEVICE_TEST_LOCATION as place, DEVICE_TEST_STORAGE_KEY as key, DEVICE_TEST_DATABASE } from "../src/device-test-data.js";
import { createDeviceTestStore } from "../src/device-test-store.js";
import { createDeviceTestController } from "../src/device-test-controller.js";
import { createPhotoRepository } from "../src/photos.js";
import { evaluateGeofence } from "../src/geo.js";
import { appHarness, checkedState } from "./helpers/browser-environment.js";

const tick = () => new Promise(setImmediate);
const position = (lat = place.geo.lat, lng = place.geo.lng, accuracy = 20) => ({ coords: { latitude: lat, longitude: lng, accuracy } });
const photo = (writeId = "fixture") => ({ attractionId: place.id, blob: new Blob(["fixture"], { type: "image/png" }), width: 16, height: 12, mime: "image/png", writeId });
function lab(options = {}) {
  const app = appHarness({ controllerFactory: createDeviceTestController, initialState: checkedState(), ...options });
  app.environment.isSecureContext = true;
  app.environment.crypto = { randomUUID: () => "test-write" };
  return app;
}

test("測試目標為東院道 11 號 WGS84，Google 搜尋視角中心不會被當成地址", () => {
  assert.equal(place.geo.coordSystem, "WGS84");
  assert.equal(evaluateGeofence(position().coords, place.geo).status, "verified");
  assert.equal(evaluateGeofence(position(22.2798431, 114.176307).coords, place.geo).status, "too-far");
  assert.equal(evaluateGeofence(position(place.geo.lat + 0.004, place.geo.lng, 20).coords, place.geo).status, "too-far");
  assert.equal(evaluateGeofence(position(place.geo.lat, place.geo.lng, 500).coords, place.geo).status, "inaccurate");
});

test("測試打卡讀寫只使用獨立鍵，不保留座標或提供可變紀錄", () => {
  const data = new Map([["outdoorLearningDay.v3", "real-trip"]]);
  const storage = { getItem: (k) => data.get(k) || null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
  const store = createDeviceTestStore({ storage });
  const record = { attractionId: place.id, checkedInAt: "2026-10-06T01:00:00Z", method: "gps", verified: true, latitude: 22, longitude: 114 };
  assert.deepEqual(store.recordCheckIn(record), { accepted: true, saved: true });
  record.verified = false;
  assert.equal(store.getCheckIn().verified, true);
  assert.throws(() => { store.getCheckIn().verified = false; }, TypeError);
  assert.deepEqual(Object.keys(JSON.parse(data.get(key))).sort(), ["attractionId", "checkedInAt", "method", "verified"]);
  assert.equal(store.recordCheckIn({ ...record, attractionId: "future-school" }).accepted, false);
  store.clearCheckIn();
  assert.equal(data.get("outdoorLearningDay.v3"), "real-trip");
  assert.equal(data.has(key), false);
});

test("測試儲存損壞及失敗仍保留暫存；清除失敗保留打卡", () => {
  const errors = [];
  const store = createDeviceTestStore({ storage: { getItem: () => "bad-json", setItem() { throw Error("full"); }, removeItem() { throw Error("blocked"); } }, onError: (m) => errors.push(m) });
  assert.equal(errors.length, 1);
  assert.equal(store.getCheckIn(), null);
  assert.equal(store.recordCheckIn({ attractionId: place.id, checkedInAt: new Date().toISOString(), method: "manual", verified: true }).saved, false);
  assert.equal(store.getCheckIn().verified, false);
  assert.throws(() => store.clearCheckIn());
  assert.ok(store.getCheckIn());
});

test("載入不要求權限，定位成功只寫測試紀錄，重新測試可更新結果", async () => {
  const app = lab();
  const requests = [];
  app.environment.navigator.geolocation = { getCurrentPosition: (...args) => requests.push(args) };
  await app.controller.start();
  assert.equal(requests.length, 0);
  await app.click("checkin", place.id);
  assert.equal(requests.length, 1);
  await requests[0][0](position());
  assert.equal(app.controller.getPageSnapshot().checkIn.verified, true);
  assert.equal(app.savedState().checkIns["future-school"].method, "manual");
  assert.equal(app.controller.getPageSnapshot().gpsResult.status, "verified");
  assert.equal(app.controller.getPageSnapshot().gpsBusy, false);
  await app.click("checkin", place.id);
  await requests[1][0](position());
  assert.equal(requests.length, 2);
});

test("明確太遠拒絕打卡；拒絕定位與誤差太大只可記錄為未核實", async () => {
  const app = lab();
  let success, failure;
  app.environment.navigator.geolocation = { getCurrentPosition: (s, f) => { success = s; failure = f; } };
  let confirmations = 0;
  app.confirmation.handler = async () => { confirmations += 1; return true; };
  await app.click("checkin", place.id);
  await success(position(22.2798431, 114.176307));
  assert.equal(confirmations, 0);
  assert.equal(app.controller.getPageSnapshot().checkIn, null);
  await app.click("checkin", place.id);
  await failure({ code: 1 });
  assert.equal(app.controller.getPageSnapshot().checkIn.verified, false);
  assert.equal(app.controller.getPageSnapshot().gpsResult.reason, "你沒有允許位置權限。");
  await app.click("checkin", place.id);
  await success(position(place.geo.lat, place.geo.lng, 500));
  assert.equal(app.controller.getPageSnapshot().gpsResult.status, "inaccurate");
  assert.equal(app.controller.getPageSnapshot().checkIn.method, "manual");
});

test("錯 ID、舊按鈕及離頁後的 GPS 回覆均被拒絕", async () => {
  const app = lab();
  let success, requests = 0;
  app.environment.navigator.geolocation = { getCurrentPosition: (s) => { success = s; requests += 1; } };
  await app.click("checkin", "future-school");
  await app.click("checkin", place.id, { detached: true });
  assert.equal(requests, 0);
  await app.click("checkin", place.id);
  app.events.get("window:pagehide")();
  await app.events.get("window:pageshow")();
  await success(position());
  assert.equal(app.controller.getPageSnapshot().checkIn, null);
});

test("相機可獨立啟動並在關閉或延遲離頁回覆時停止，不建立打卡", async () => {
  const app = lab();
  let constraints, resolve, stopped = 0;
  app.environment.navigator.mediaDevices = { getUserMedia: (c) => { constraints = c; return new Promise((done) => { resolve = done; }); } };
  const opening = app.click("camera-open", place.id);
  assert.equal(constraints.audio, false);
  assert.equal(constraints.video.facingMode.ideal, "environment");
  app.events.get("window:pagehide")();
  resolve({ getTracks: () => [{ stop: () => { stopped += 1; } }] });
  await opening;
  assert.equal(stopped, 1);
  assert.equal(app.controller.getPageSnapshot().checkIn, null);
});

test("相機拒絕保留診斷，另按手機拍攝仍可保存；測試快照不含 Blob", async () => {
  const app = lab();
  let selected = 0;
  app.element("#native-camera-input").click = () => { selected += 1; };
  app.environment.navigator.mediaDevices = { getUserMedia: async () => { throw Object.assign(Error("denied"), { name: "NotAllowedError" }); } };
  await app.click("camera-open", place.id);
  assert.equal(selected, 0);
  assert.equal(app.controller.getPageSnapshot().cameraResult.errorName, "NotAllowedError");
  app.photoService.compressPhoto = async () => photo();
  await app.click("native-camera-open", place.id);
  app.element("#native-camera-input").files = [new Blob(["fixture"])];
  await app.element("#native-camera-input").listeners.change[0].callback();
  const snapshot = app.controller.getPageSnapshot();
  assert.ok(snapshot.photo.url.startsWith("blob:"));
  assert.equal(snapshot.photo.width, 16);
  assert.equal("blob" in snapshot.photo, false);
  assert.equal(snapshot.checkIn, null);
});

test("延遲手機拍攝回覆及寫入前離頁不保存，也不刪除原照", async () => {
  const app = lab({ initialPhotos: [photo("original")] });
  await app.controller.start();
  let resolve;
  app.photoService.compressPhoto = () => new Promise((done) => { resolve = done; });
  const task = app.selectPhoto(new Blob(["fixture"]), place.id);
  await tick();
  app.events.get("window:pagehide")();
  resolve(photo("new"));
  await task;
  assert.equal(app.photoData.get(place.id).writeId, "original");
  await app.events.get("window:pageshow")();
  await app.click("native-camera-open", place.id);
  app.events.get("window:pagehide")();
  await app.events.get("window:pageshow")();
  app.element("#native-camera-input").files = [new Blob(["late"])];
  await app.element("#native-camera-input").listeners.change[0].callback();
  assert.equal(app.photoData.get(place.id).writeId, "original");
});

test("開始交易後離頁仍保留測試相片；兩次確認清除只影響測試資料", async () => {
  const app = lab({ initialPhotos: [photo("original")] });
  await app.controller.start();
  app.photoService.compressPhoto = async () => photo("new");
  let finish;
  app.photoService.savePhotoRecord = (record, { canBegin }) => {
    assert.equal(canBegin(), true);
    return new Promise((done) => { finish = () => { app.photoData.set(place.id, record); done(place.id); }; });
  };
  const task = app.selectPhoto(new Blob(["fixture"]), place.id);
  await tick();
  app.events.get("window:pagehide")();
  finish();
  await task;
  assert.equal(app.photoData.get(place.id).writeId, "test-write");
  await app.events.get("window:pageshow")();
  let confirmations = 0;
  app.confirmation.handler = async () => { confirmations += 1; return true; };
  await app.click("reset-test", "");
  assert.equal(confirmations, 2);
  assert.equal(app.photoData.size, 0);
  assert.ok(app.savedState().checkIns["future-school"]);
});

test("清除測試相片失敗時保留測試打卡，不虛報成功", async () => {
  const app = lab();
  app.environment.indexedDB = {};
  app.environment.navigator.geolocation = { getCurrentPosition: (success) => success(position()) };
  await app.click("checkin", place.id);
  app.confirmation.handler = async () => true;
  app.photoService.clearPhotoRecords = async () => { throw Error("blocked"); };
  await app.click("reset-test", "");
  assert.ok(app.controller.getPageSnapshot().checkIn);
  assert.match(app.element("#toast").textContent, /打卡仍保留/);
});

test("重設等待已開始的相片工作，並拒絕舊 GPS 回覆恢復紀錄", async () => {
  const app = lab();
  app.environment.indexedDB = {};
  let success, finish;
  app.environment.navigator.geolocation = { getCurrentPosition: (s) => { success = s; } };
  app.photoService.compressPhoto = async () => photo();
  app.photoService.savePhotoRecord = (record) => new Promise((done) => { finish = () => { app.photoData.set(place.id, record); done(place.id); }; });
  const saving = app.selectPhoto(new Blob(["fixture"]), place.id);
  await tick();
  await app.click("checkin", place.id);
  app.confirmation.handler = async () => true;
  const resetting = app.click("reset-test", "");
  await tick();
  assert.equal(app.controller.getPageSnapshot().resetting, true);
  finish();
  await Promise.all([saving, resetting]);
  await success(position());
  assert.equal(app.photoData.size, 0);
  assert.equal(app.controller.getPageSnapshot().checkIn, null);
  assert.ok(app.savedState().checkIns["future-school"]);
});

test("相片 repository 的資料庫名稱互不影響，取消時不啟動交易", async () => {
  const previous = globalThis.indexedDB;
  const opened = [];
  let transactions = 0;
  globalThis.indexedDB = { open(name) {
    opened.push(name);
    const request = { result: { close() {}, objectStoreNames: { contains: () => true }, transaction() {
      transactions += 1;
      const transaction = { objectStore: () => ({ getAll: () => ({ result: [] }) }) };
      queueMicrotask(() => transaction.oncomplete());
      return transaction;
    } } };
    queueMicrotask(() => request.onsuccess());
    return request;
  } };
  try {
    const real = createPhotoRepository();
    const separate = createPhotoRepository({ databaseName: DEVICE_TEST_DATABASE });
    await real.getAllPhotoRecords();
    await separate.getAllPhotoRecords();
    assert.equal(await separate.savePhotoRecord(photo(), { canBegin: () => false }), null);
    assert.deepEqual(opened, ["outdoorLearningDay.photos", DEVICE_TEST_DATABASE, DEVICE_TEST_DATABASE]);
    assert.equal(transactions, 2);
  } finally { globalThis.indexedDB = previous; }
});

test("離線測試頁使用自己的 HTML，不能污染正式離線首頁", async () => {
  const events = {}, cached = [];
  const base = "https://example.github.io/trip/";
  let fail = false;
  const context = vm.createContext({ URL, Request, self: { registration: { scope: base }, addEventListener: (name, callback) => { events[name] = callback; } },
    fetch: async () => { if (fail) throw Error("offline"); return new Response("test-page", { headers: { "content-type": "text/html" } }); },
    caches: { open: async () => ({ put: async (url) => cached.push(url) }), match: async (url) => url }
  });
  vm.runInContext(await readFile(new URL("../sw.js", import.meta.url), "utf8"), context);
  const waits = [];
  let response;
  const request = { url: new URL("device-test.html", base).href, method: "GET", mode: "navigate" };
  events.fetch({ request, waitUntil: (p) => waits.push(p), respondWith: (p) => { response = p; } });
  await response;
  await Promise.all(waits);
  assert.deepEqual(cached, [request.url]);
  fail = true;
  events.fetch({ request, waitUntil() {}, respondWith: (p) => { response = p; } });
  assert.equal(await response, request.url);
  for (const query of ['?mode=diagnostics', '?mode=unknown']) {
    events.fetch({ request: { ...request, url: request.url + query }, waitUntil() {}, respondWith: (p) => { response = p; } });
    assert.equal(await response, request.url, '帶查詢的測試頁離線不可變成正式 App');
  }
  assert.deepEqual(cached, [request.url], '不能快取帶查詢參數的回應');
});

test("已有舊 worker 時，測試頁在新版啟用前不載入功能，啟用後正常顯示", async () => {
  const app = appHarness({ controllerFactory: () => ({}) });
  const workerEvents = new Map();
  const worker = { state: "installing", addEventListener: (name, cb) => workerEvents.set(name, cb), removeEventListener: (name) => workerEvents.delete(name) };
  const serviceWorker = { controller: { version: "old" }, register: async () => ({ installing: worker }) };
  let queries = 0;
  const querySelector = app.environment.document.querySelector;
  app.environment.document.querySelector = (...args) => { queries += 1; return querySelector(...args); };
  const bindings = { document: app.environment.document, window: app.environment.window, navigator: { serviceWorker }, localStorage: app.environment.localStorage, requestAnimationFrame: app.environment.requestAnimationFrame, isSecureContext: true, location: { href: "https://example.test/trip/device-test.html?mode=diagnostics" } };
  const previous = new Map(Object.keys(bindings).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  try {
    for (const [name, value] of Object.entries(bindings)) Object.defineProperty(globalThis, name, { configurable: true, value });
    const loading = import("../src/device-lab.js?bootstrap-lifecycle-test");
    await tick();
    assert.equal(queries, 0, "新版啟用前便開始載入畫面");
    worker.state = "activated";
    serviceWorker.controller = { version: "new" };
    workerEvents.get("statechange")();
    await loading;
    assert.match(app.element("#app").innerHTML, /打卡與相機測試/);
    assert.match(app.element("#app").innerHTML, /尚未要求位置權限/);
  } finally {
    for (const [name, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name];
  }
});
