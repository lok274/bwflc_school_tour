import test from "node:test";
import assert from "node:assert/strict";
import { appHarness, checkedState, createFixtureIndexedDB, FIXTURE_IDENTITY } from "./helpers/browser-environment.js";
import { ATTRACTIONS } from "../src/data.js";
import { gcj02ToWgs84 } from "../src/geo.js";
import { savePhotoRecord } from "../src/photos.js";
import { createRehearsalController, REHEARSAL_STORAGE_KEY, REHEARSAL_IDENTITY_KEY } from "../src/device-rehearsal.js";
import { createAppController } from "../src/controller.js";

const tick = () => new Promise(setImmediate);
const detail = "#attraction/future-school";
const fixture = (writeId = "original") => ({ attractionId: "future-school", blob: new Blob([writeId]), width: 20, height: 10, writeId });
const checkedApp = (options = {}) => appHarness({ hash: detail, initialState: checkedState(), ...options });
const coords = () => { const centre = gcj02ToWgs84(ATTRACTIONS[0].geo); return { coords: { latitude: centre.lat, longitude: centre.lng, accuracy: 10 } }; };

function containsBinary(value) {
  if (value instanceof Blob || value instanceof Map) return true;
  return value && typeof value === "object" && Object.values(value).some(containsBinary);
}

function retiredDraftFixture(failure = null) {
  const calls = [], original = { draft: { answers: { "essay-title": "合成舊稿" } }, revision: 3 };
  let record = original, closed = 0;
  const db = {
    close() { closed++; },
    transaction(store, mode) {
      calls.push([store, mode]);
      if (failure === "transaction") throw Error("交易無法開啟");
      let pending;
      const tx = { objectStore: () => ({
        clear() { calls.push("clear"); pending = undefined; },
        put(value, key) { calls.push(["put", value, key]); pending = value; }
      }) };
      queueMicrotask(() => {
        if (failure === "abort") tx.onabort();
        else { record = pending; tx.oncomplete(); }
      });
      return tx;
    }
  };
  const indexedDB = { open(name) {
    calls.push(name);
    if (failure === "open") throw Error("無法開啟");
    const request = { result: db };
    queueMicrotask(() => {
      if (failure === "request") request.onerror();
      else if (failure === "blocked") { request.onblocked(); queueMicrotask(() => request.onsuccess()); }
      else request.onsuccess();
    });
    return request;
  } };
  return { indexedDB, calls, original, get record() { return record; }, get closed() { return closed; } };
}

test("測試草稿能力只接受兩個已知名稱，保持 request、版本及每頁獨立命名", () => {
  const calls = [], request = {};
  const factory = { open(...args) { assert.equal(this, factory); calls.push(args); return request; } };
  const first = createFixtureIndexedDB(factory), second = createFixtureIndexedDB(factory);
  assert.equal(first.open("outdoorLearningDay.workbook.v1", 2), request);
  first.open("outdoorLearningDay.workbook.v1");
  first.open("outdoorLearningDay.rehearsal.workbook.v1");
  second.open("outdoorLearningDay.workbook.v1");
  assert.equal(calls[0][1], 2);
  assert.equal(calls[0][0], calls[1][0]);
  assert.equal(new Set(calls.map(call => call[0])).size, 3);
  for (const [name] of calls) assert.match(name, /^outdoorLearningDay\.fixture\.[\da-f-]+\.(?:rehearsal\.)?workbook\.v1$/);
  assert.deepEqual(Object.keys(first), ["open"]);
  assert.equal(Object.isFrozen(first), true);
  for (const name of [null, undefined, 0, "", "outdoorLearningDay.photos", "outdoorLearningDay.rehearsal.photos",
    "./outdoorLearningDay.workbook.v1", "outdoorLearningDay%2Eworkbook%2Ev1", "OUTDOORLEARNINGDAY.workbook.v1",
    { toString: () => "outdoorLearningDay.workbook.v1" }]) {
    assert.throws(() => first.open(name), /不可開啟其他資料庫/);
  }
  assert.equal(calls.length, 4);
});

for (const rehearsal of [false, true]) test(`測試控制器${rehearsal ? "預演" : "正式"}清除只退休自有草稿，真實兩個草稿庫均保留`, async () => {
  const formal = retiredDraftFixture(), realRehearsal = retiredDraftFixture(), synthetic = retiredDraftFixture();
  const scoped = createFixtureIndexedDB({ open(name) {
    if (name === "outdoorLearningDay.workbook.v1") return formal.indexedDB.open(name);
    if (name === "outdoorLearningDay.rehearsal.workbook.v1") return realRehearsal.indexedDB.open(name);
    assert.match(name, /^outdoorLearningDay\.fixture\./);
    return synthetic.indexedDB.open(name);
  } });
  const app = checkedApp({ hash: "#itinerary", initialPhotos: [fixture()],
    controllerFactory: options => {
      options.environment.indexedDB = scoped;
      if (!rehearsal) return createAppController(options);
      options.environment.localStorage.setItem(REHEARSAL_STORAGE_KEY, JSON.stringify(checkedState()));
      options.environment.crypto = globalThis.crypto;
      options.environment.localStorage.setItem(REHEARSAL_IDENTITY_KEY, JSON.stringify({ version: 1, ...FIXTURE_IDENTITY }));
      return createRehearsalController({ ...options, syncRepository: { read: async () => null, reset: async value => value } });
    } });
  let confirmations = 0;
  app.confirmation.handler = async () => { confirmations++; return true; };
  await app.controller.start(); if (rehearsal) await app.click("sync-dismiss"); await app.click("reset-all");
  assert.equal(confirmations, 2);
  assert.deepEqual(formal.calls, []); assert.deepEqual(realRehearsal.calls, []);
  assert.equal(formal.record, formal.original); assert.equal(realRehearsal.record, realRehearsal.original);
  assert.deepEqual(synthetic.record, { retired: true });
  assert.equal(synthetic.closed, 1);
  assert.equal(app.photoData.size, 0);
});

test("舊手冊網址及重新啟動只顯示行程，不讀寫草稿或改動打卡相片", async () => {
  const app = checkedApp({ initialPhotos: [fixture()] }), legacy = retiredDraftFixture();
  app.environment.indexedDB = legacy.indexedDB;
  const before = app.savedState();
  for (const hash of ["#workbook", ...["essay", "share", "day1", "day2", "day3", "reflection", "works", "unknown"].map(id => `#workbook/${id}`)]) {
    app.navigate(hash); await app.controller.start();
    assert.equal(app.controller.currentRoute().view, "itinerary");
    assert.equal(app.environment.location.hash, hash);
    assert.doesNotMatch(app.element("#app").innerHTML, /data-workbook-|href="#workbook|workbook-page/);
    assert.deepEqual(app.savedState(), before);
    assert.equal(app.photoData.size, 1);
  }
  assert.deepEqual(legacy.calls, []);
  assert.equal(legacy.record, legacy.original);
  for (const event of ["window:focus", "document:visibilitychange"]) assert.equal(app.events.has(event), false);
  await app.click("workbook-pdf"); await app.click("workbook-backup");
  assert.deepEqual(legacy.calls, []);
});

for (const accepted of [[false], [true, false]]) test(`清除第 ${accepted.length} 次確認取消，舊草稿、打卡及相片全部保留`, async () => {
  const app = checkedApp({ hash: "#itinerary", initialPhotos: [fixture()] }), legacy = retiredDraftFixture();
  app.environment.indexedDB = legacy.indexedDB;
  app.confirmation.handler = async () => accepted.shift();
  await app.controller.start(); await app.click("reset-all");
  assert.deepEqual(legacy.calls, []);
  assert.equal(legacy.record, legacy.original);
  assert.ok(app.savedState().checkIns["future-school"]);
  assert.equal(app.photoData.size, 1);
});

for (const rehearsal of [false, true]) test(`${rehearsal ? "預演" : "正式"}兩次確認後才清除舊草稿，留下阻止舊分頁回寫的標記`, async () => {
  const legacy = retiredDraftFixture();
  const app = checkedApp({ hash: "#itinerary", initialPhotos: [fixture()],
    ...(rehearsal ? { controllerFactory: options => {
      options.environment.indexedDB = legacy.indexedDB;
      options.environment.localStorage.setItem(REHEARSAL_STORAGE_KEY, JSON.stringify(checkedState()));
      options.environment.crypto = globalThis.crypto;
      options.environment.localStorage.setItem(REHEARSAL_IDENTITY_KEY, JSON.stringify({ version: 1, ...FIXTURE_IDENTITY }));
      return createRehearsalController({ ...options, syncRepository: { read: async () => null, reset: async value => value } });
    } } : {}) });
  app.environment.indexedDB = legacy.indexedDB;
  app.confirmation.handler = async () => true;
  await app.controller.start(); if (rehearsal) await app.click("sync-dismiss"); await app.click("reset-all");
  assert.deepEqual(legacy.calls, [rehearsal ? "outdoorLearningDay.rehearsal.workbook.v1" : "outdoorLearningDay.workbook.v1",
    ["drafts", "readwrite"], "clear", ["put", { retired: true }, "bwflc-2026-11-05"]]);
  assert.deepEqual(legacy.record, { retired: true });
  assert.equal(legacy.closed, 1);
  assert.equal(app.photoData.size, 0);
  if (rehearsal) {
    assert.equal(app.environment.localStorage.getItem(REHEARSAL_STORAGE_KEY), null);
    assert.ok(app.savedState().checkIns["future-school"]);
  } else assert.deepEqual(app.savedState().checkIns, {});
});

for (const failure of ["open", "request", "blocked", "transaction", "abort"]) test(`舊草稿清除 ${failure} 失敗如實報告，保留打卡及可重試`, async () => {
  const app = checkedApp({ hash: "#itinerary", initialPhotos: [fixture()] }), legacy = retiredDraftFixture(failure);
  app.environment.indexedDB = legacy.indexedDB;
  app.confirmation.handler = async () => true;
  await app.controller.start(); await app.click("reset-all"); await tick();
  assert.equal(legacy.record, legacy.original);
  assert.equal(app.photoData.size, 0);
  assert.ok(app.savedState().checkIns["future-school"]);
  assert.match(app.element("#toast").textContent, /舊版草稿未能清除.*打卡紀錄仍保留.*重試/);
  assert.match(app.element("#app").innerHTML, /data-reset-all/);
  if (["blocked", "transaction", "abort"].includes(failure)) assert.equal(legacy.closed, 1);
});

test("每頁快照只包含所需資料，沒有 Blob、Map 或共用可變引用", async () => {
  const app = checkedApp({ initialPhotos: [fixture()] });
  await app.controller.start();
  assert.equal(app.controller.getSnapshot, undefined);
  const itineraryFields = ["view", "checkInProgress", "trip", "booklet", "canInstall", "install", "days", "checkIns", "allCheckInsComplete", "requiredCount", "introduction", "introductionOpen", "stops", "sync"];
  const fields = {
    "#home": [...itineraryFields],
    "#itinerary": [...itineraryFields],
    "#attractions": [...itineraryFields],
    "#introduction": [...itineraryFields],
    [detail]: [...itineraryFields, "attraction", "checkIn", "photo", "photos"],
    "#memories": ["view", "section", "checkInProgress", "albums", "memoryOverlay", "selectedPhotoIds", "selectedCount", "photoCount", "readError", "readState", "checkInCardAvailable"],
    "#prepare": [...itineraryFields]
  };
  for (const [hash, expected] of Object.entries(fields)) {
    app.navigate(hash);
    const snapshot = app.controller.getPageSnapshot();
    assert.deepEqual(Object.keys(snapshot).sort(), expected.sort());
    assert.equal(Boolean(containsBinary(snapshot)), false);
    assert.equal(Object.isFrozen(snapshot), true);
    if (snapshot.sync) assert.ok(!/ticket|studentName|studentNumber|latitude|longitude/.test(JSON.stringify(snapshot.sync)));
    if (snapshot.stops) for (const stop of snapshot.stops) {
      assert.deepEqual(Object.keys(stop).sort(), ["attraction", "checkIn", "checkInBusy", "photo", "photos"]);
      assert.equal(Object.isFrozen(stop), true);
      assert.equal(Object.isFrozen(stop.photos), true);
      for (const photo of stop.photos) assert.deepEqual(Object.keys(photo).sort(), ["height", "photoId", "width"]);
    }
    if (hash === "#attractions") assert.equal(snapshot.view, "itinerary");
  }
  const snapshot = app.controller.getPageSnapshot();
  assert.throws(() => { snapshot.trip.title = "changed"; }, TypeError);
  app.navigate(detail);
  assert.throws(() => { app.controller.getPageSnapshot().checkIn.verified = true; }, TypeError);
  assert.equal(app.savedState().checkIns["future-school"].verified, false);
});

test("行程以外、未知景點及已移除的控制項不能啟動操作", async () => {
  const app = checkedApp();
  let requests = 0;
  app.environment.navigator.geolocation = { getCurrentPosition() { requests += 1; } };
  app.environment.navigator.mediaDevices = { getUserMedia() { requests += 1; } };
  app.navigate("#memories");
  await app.click("checkin", "sun-yat-sen");
  await app.click("camera-open", "future-school");
  app.navigate("#memories");
  await app.click("reset-all");
  app.navigate(detail);
  await app.click("checkin", "unknown");
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
  await app.events.get("document:submit")({ target: { id: "removed-custom-reminder", isConnected: true }, preventDefault() { throw Error("舊表單仍被攔截"); } });
  assert.deepEqual(app.savedState(), before);
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
  assert.match(app.element("#toast").textContent, /紀念照及舊版草稿已清除.*未能清除/);
});
