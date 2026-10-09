import test from "node:test";
import assert from "node:assert/strict";
import { appHarness, checkedState } from "./helpers/browser-environment.js";
import { ATTRACTIONS } from "../src/data.js";
import { gcj02ToWgs84 } from "../src/geo.js";
import { savePhotoRecord } from "../src/photos.js";

const tick = () => new Promise(setImmediate);
const detail = "#attraction/future-school";
const fixture = (writeId = "original") => ({ attractionId: "future-school", blob: new Blob([writeId]), width: 20, height: 10, writeId });
const checkedApp = (options = {}) => appHarness({ hash: detail, initialState: checkedState(), ...options });
const coords = () => { const centre = gcj02ToWgs84(ATTRACTIONS[0].geo); return { coords: { latitude: centre.lat, longitude: centre.lng, accuracy: 10 } }; };

function containsBinary(value) {
  if (value instanceof Blob || value instanceof Map) return true;
  return value && typeof value === "object" && Object.values(value).some(containsBinary);
}

test("每頁快照只包含所需資料，沒有 Blob、Map 或共用可變引用", async () => {
  const app = checkedApp({ initialPhotos: [fixture()] });
  await app.controller.start();
  assert.equal(app.controller.getSnapshot, undefined);
  const fields = {
    "#home": ["view", "trip", "booklet", "learning", "canInstall", "install", "push"],
    "#itinerary": ["view", "days", "checkIns", "allCheckInsComplete", "hotels"],
    "#attractions": ["view", "days", "checkIns", "allCheckInsComplete", "hotels"],
    [detail]: ["view", "attraction", "checkIn", "photo", "photos", "allCheckInsComplete"],
    "#memories": ["view", "albums", "memoryOverlay", "selectedPhotoIds", "selectedCount", "photoCount", "readError", "readState", "summaryCard"],
    "#prepare": ["view", "trip", "booklet", "learning", "canInstall", "install", "push"]
  };
  for (const [hash, expected] of Object.entries(fields)) {
    app.navigate(hash);
    const snapshot = app.controller.getPageSnapshot();
    assert.deepEqual(Object.keys(snapshot).sort(), expected.sort());
    assert.equal(Boolean(containsBinary(snapshot)), false);
    assert.equal(Object.isFrozen(snapshot), true);
    if (hash === "#attractions") assert.equal(snapshot.view, "itinerary");
  }
  const snapshot = app.controller.getPageSnapshot();
  assert.throws(() => { snapshot.trip.title = "changed"; }, TypeError);
  app.navigate(detail);
  assert.throws(() => { app.controller.getPageSnapshot().checkIn.verified = true; }, TypeError);
  assert.equal(app.savedState().checkIns["future-school"].verified, false);
});

test("錯頁、錯景點及已移除的控制項不能啟動操作", async () => {
  const app = checkedApp();
  let requests = 0;
  app.environment.navigator.geolocation = { getCurrentPosition() { requests += 1; } };
  app.environment.navigator.mediaDevices = { getUserMedia() { requests += 1; } };
  app.navigate("#itinerary");
  await app.click("checkin", "sun-yat-sen");
  await app.click("camera-open", "future-school");
  await app.click("reset-all");
  app.navigate(detail);
  await app.click("checkin", "sun-yat-sen");
  await app.click("camera-open", "sun-yat-sen");
  await app.click("native-camera-open", "sun-yat-sen");
  await app.click("checkin-undo", "future-school", { detached: true });
  assert.equal(requests, 0);
  assert.ok(app.savedState().checkIns["future-school"]);
  assert.equal(app.environment.localRemoved, undefined);
  assert.equal(app.element("#confirm-dialog").open, false);
  assert.equal(app.element("#native-camera-input").dataset.attractionId, undefined);
});

test("已移除的清單、提醒控制項不能再寫入旅程資料", async () => {
  const app = checkedApp();
  const before = app.savedState();
  for (const hash of ["#home", "#prepare", detail]) {
    app.navigate(hash);
    for (const [key, selector] of [["checkItem", "[data-check-item]"], ["customCheck", "[data-custom-check]"]]) {
      app.events.get("document:change")({ target: { dataset: { [key]: "health" }, checked: true, isConnected: true, matches: query => query === selector } });
    }
    await app.click("custom-delete", "old-reminder");
    assert.deepEqual(app.savedState(), before);
  }
  assert.equal(app.events.has("document:submit"), false);
});

test("離頁再返回時，舊 GPS 成功和錯誤回覆均不能打卡或開確認", async () => {
  for (const outcome of ["success", "error"]) {
    const app = appHarness({ hash: detail });
    let success, error;
    app.environment.navigator.geolocation = { getCurrentPosition(s, e) { success = s; error = e; } };
    await app.click("checkin", "future-school");
    app.navigate("#itinerary");
    app.navigate(detail);
    if (outcome === "success") await success(coords());
    else await error({ code: 1 });
    assert.equal(app.controller.getPageSnapshot().checkIn, null);
    assert.equal(app.element("#confirm-dialog").open, false);
  }
});

test("同頁重畫不會取消有效 GPS", async () => {
  const app = appHarness({ hash: detail });
  let success;
  app.environment.navigator.geolocation = { getCurrentPosition(s) { success = s; } };
  await app.click("checkin", "future-school");
  app.controller.render();
  app.controller.getPageSnapshot();
  await success(coords());
  assert.equal(app.controller.getPageSnapshot().checkIn.verified, true);
});

test("離頁關閉正在顯示及排隊的確認，舊確認不能執行刪除", async () => {
  const app = checkedApp();
  const first = app.click("checkin-undo", "future-school");
  const second = app.click("checkin-undo", "future-school");
  await tick();
  assert.equal(app.element("#confirm-dialog").open, true);
  app.navigate("#itinerary");
  await Promise.all([first, second]);
  assert.equal(app.element("#confirm-dialog").open, false);
  assert.ok(app.savedState().checkIns["future-school"]);
});

test("離頁後延遲手機拍攝選取無效，返回原景點仍不能沿用舊選取", async () => {
  const app = checkedApp();
  let compressed = 0;
  app.photoService.compressPhoto = async () => { compressed += 1; return fixture("new"); };
  await app.click("native-camera-open", "future-school");
  const input = app.element("#native-camera-input");
  app.navigate("#attraction/sun-yat-sen");
  app.navigate(detail);
  input.files = [new Blob(["late"])];
  await input.listeners.change[0].callback();
  assert.equal(compressed, 0);
});

test("離頁只釋放當前照片預覽；行程及舊景點網址仍可讀完成摘要", async () => {
  const revoked = [];
  let created = 0;
  const app = checkedApp({ hash: "#memories", initialPhotos: [fixture()], urlService: { createObjectURL: () => `blob:${++created}`, revokeObjectURL: (url) => revoked.push(url) } });
  await app.controller.start();
  assert.equal(app.controller.getPageSnapshot().albums[0].cover.url, "blob:1");
  app.controller.render();
  assert.equal(created, 1);
  app.navigate("#itinerary");
  assert.deepEqual(revoked, ["blob:1"]);
  assert.deepEqual(app.controller.getPageSnapshot().checkIns["future-school"], { verified: false });
  assert.match(app.element("#app").innerHTML, /手動記錄/);
  app.navigate("#attractions");
  assert.equal(app.controller.getPageSnapshot().view, "itinerary");
  assert.deepEqual(app.controller.getPageSnapshot().checkIns["future-school"], { verified: false });
  assert.equal(created, 1);
});

test("照片壓縮未完成時離頁，不寫入也不刪原照", async () => {
  const original = fixture();
  const app = checkedApp({ initialPhotos: [original] });
  await app.controller.start();
  let resolve;
  app.photoService.compressPhoto = () => new Promise((done) => { resolve = done; });
  const processing = app.selectPhoto();
  await tick();
  app.navigate("#itinerary");
  resolve(fixture("replacement"));
  await processing;
  assert.equal(app.photoData.get("future-school"), original);
  assert.equal(app.element("#toast").hidden, true);
});

test("相片資料庫開啟後、寫入交易開始前，必須再次核對離頁", async () => {
  const app = checkedApp({ initialPhotos: [fixture()] });
  app.photoService.compressPhoto = async () => fixture("replacement");
  let open;
  let written = false;
  app.photoService.savePhotoRecord = async (record, { canBegin }) => {
    await new Promise((resolve) => { open = resolve; });
    if (!canBegin()) return null;
    written = true;
    app.photoData.set(record.attractionId, record);
    return record.attractionId;
  };
  const processing = app.selectPhoto();
  await tick();
  app.navigate("#itinerary");
  open();
  await processing;
  assert.equal(written, false);
  assert.equal(app.photoData.get("future-school").writeId, "original");
});

test("真正相片服務在資料庫開啟後取消，不建立交易並關閉連線", async () => {
  const previous = globalThis.indexedDB;
  let opening, closed = 0, transactions = 0;
  let current = true;
  globalThis.indexedDB = { open() { opening = {}; return opening; } };
  try {
    const saving = savePhotoRecord(fixture(), { canBegin: () => current });
    current = false;
    opening.result = { close() { closed += 1; }, transaction() { transactions += 1; } };
    opening.onsuccess();
    assert.equal(await saving, null);
    assert.equal(closed, 1);
    assert.equal(transactions, 0);
  } finally { globalThis.indexedDB = previous; }
});

test("交易已開始後換頁，照片完成保存而且不顯示舊頁成功提示", async () => {
  const app = checkedApp({ initialPhotos: [fixture()] });
  app.photoService.compressPhoto = async () => fixture("replacement");
  let finish;
  app.photoService.savePhotoRecord = (record, { canBegin }) => {
    assert.ok(canBegin());
    app.photoData.set(record.attractionId, record);
    return new Promise((resolve) => { finish = () => resolve(record.attractionId); });
  };
  const processing = app.selectPhoto();
  await tick();
  app.navigate("#attractions");
  finish();
  await processing;
  assert.notEqual(app.photoData.get("future-school").writeId, "original");
  assert.equal(app.controller.getPageSnapshot().view, "itinerary");
  assert.equal(app.element("#toast").hidden, true);
});

test("清除全部資料等待已開始的照片寫入，重設期間拒絕新打卡", async () => {
  const app = checkedApp();
  app.environment.indexedDB = {};
  app.photoService.compressPhoto = async () => fixture("new");
  let finish;
  app.photoService.savePhotoRecord = (record, { canBegin }) => {
    assert.ok(canBegin());
    app.photoData.set(record.attractionId, record);
    return new Promise((resolve) => { finish = () => resolve(record.attractionId); });
  };
  const processing = app.selectPhoto();
  await tick();
  app.navigate("#home");
  app.confirmation.handler = async () => true;
  const resetting = app.click("reset-all");
  await tick();
  let requests = 0;
  app.environment.navigator.geolocation = { getCurrentPosition() { requests += 1; } };
  app.navigate("#attraction/sun-yat-sen");
  await app.click("checkin", "sun-yat-sen");
  finish();
  await Promise.all([processing, resetting]);
  assert.equal(app.photoData.size, 0);
  assert.equal(requests, 0);
  assert.deepEqual(app.savedState().checkIns, {});
});

test("旅程卡生成後離頁禁止下載；同頁快照重建不會誤判照片替換", async () => {
  for (const leave of [true, false]) {
    const app = checkedApp({ hash: "#memories", initialPhotos: [fixture()] });
    await app.controller.start();
    let finish, downloads = 0;
    app.confirmation.handler = async () => true;
    app.photoService.createTravelCard = () => new Promise((resolve) => { finish = resolve; });
    app.element("a").click = () => { downloads += 1; };
    await app.click("memory-album", "future-school"); await app.click("memory-photo", "future-school"); await app.click("memory-card-toggle");
    const downloading = app.click("card-download", "future-school", { dataset: { photoId: "future-school" } });
    await tick();
    if (leave) app.navigate("#itinerary");
    else { app.controller.getPageSnapshot(); app.controller.render(); }
    finish(new Blob(["card"]));
    await downloading;
    assert.equal(downloads, leave ? 0 : 1);
  }
});

test("清除相片成功但進度刪除失敗時保留進度並回報部分完成", async () => {
  const app = checkedApp({ initialPhotos: [fixture()] });
  await app.controller.start();
  app.navigate("#home");
  app.confirmation.handler = async () => true;
  app.environment.localStorage.removeItem = () => { throw new Error("blocked"); };
  await app.click("reset-all");
  assert.equal(app.photoData.size, 0);
  assert.ok(app.savedState().checkIns["future-school"]);
  assert.match(app.element("#toast").textContent, /紀念照已清除.*未能清除/);
});
