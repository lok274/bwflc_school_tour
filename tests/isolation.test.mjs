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
    "#home": ["view", "trip", "canInstall", "push"],
    "#itinerary": ["view", "days", "checkIns"],
    "#attractions": ["view", "days", "checkIns"],
    [detail]: ["view", "attraction", "checkIn", "photo", "photos"],
    "#prepare": ["view", "items", "checklist", "customItems", "progress"]
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
  assert.throws(() => { snapshot.checklist.health = true; }, TypeError);
  assert.throws(() => snapshot.customItems.push({ id: "bad", label: "bad" }), TypeError);
  assert.throws(() => { snapshot.items[0].label = "changed"; }, TypeError);
  assert.equal(app.savedState().checklist.health, false);
  app.navigate(detail);
  assert.throws(() => { app.controller.getPageSnapshot().checkIn.verified = true; }, TypeError);
  assert.equal(app.savedState().checkIns["future-school"].verified, false);
});

test("錯頁、錯景點及已移除的控制項不能啟動操作", async () => {
  const app = checkedApp();
  let requests = 0;
  app.environment.navigator.geolocation = { getCurrentPosition() { requests += 1; } };
  app.environment.navigator.mediaDevices = { getUserMedia() { requests += 1; } };
  app.navigate("#prepare");
  await app.click("checkin", "sun-yat-sen");
  await app.click("camera-open", "future-school");
  await app.click("reset-all");
  app.navigate(detail);
  await app.click("checkin", "sun-yat-sen");
  await app.click("camera-open", "sun-yat-sen");
  await app.click("gallery-open", "sun-yat-sen");
  await app.click("checkin-undo", "future-school", { detached: true });
  assert.equal(requests, 0);
  assert.ok(app.savedState().checkIns["future-school"]);
  assert.equal(app.environment.localRemoved, undefined);
  assert.equal(app.element("#confirm-dialog").open, false);
  assert.equal(app.element("#photo-input").dataset.attractionId, undefined);
});

test("清單修改只在準備頁有效並拒絕未知鍵", () => {
  const app = checkedApp();
  const input = (id) => ({ dataset: { checkItem: id }, checked: true, isConnected: true, matches: (selector) => selector === "[data-check-item]" });
  app.events.get("document:change")({ target: input("health") });
  assert.equal(app.savedState().checklist.health, false);
  app.navigate("#prepare");
  app.events.get("document:change")({ target: input("unknown") });
  assert.equal(app.savedState().checklist.unknown, undefined);
  app.events.get("document:change")({ target: input("health") });
  assert.equal(app.controller.getPageSnapshot().checklist.health, true);
  assert.ok(app.savedState().checkIns["future-school"]);
});

test("新增刪除提醒及勾選自訂項目經指定操作，保存失敗仍顯示暫存變更", async () => {
  const app = checkedApp();
  const form = { id: "custom-item-form", elements: { label: { value: "帶充電器" } }, isConnected: true };
  const submit = () => app.events.get("document:submit")({ target: form, preventDefault() {} });
  submit();
  assert.equal(app.savedState().customItems.length, 0);
  app.navigate("#prepare");
  submit();
  const id = app.controller.getPageSnapshot().customItems[0].id;
  app.events.get("document:change")({ target: { dataset: { customCheck: id }, checked: true, matches: (selector) => selector === "[data-custom-check]" } });
  assert.equal(app.savedState().customItems[0].done, true);
  await app.click("custom-delete", id);
  assert.equal(app.savedState().customItems.length, 0);
  app.environment.localStorage.setItem = () => { throw new Error("quota"); };
  submit();
  assert.equal(app.controller.getPageSnapshot().customItems[0].label, "帶充電器");
  assert.equal(app.savedState().customItems.length, 0);
  assert.match(app.element("#toast").textContent, /未能保存/);
});

test("離頁再返回時，舊 GPS 成功和錯誤回覆均不能打卡或開確認", async () => {
  for (const outcome of ["success", "error"]) {
    const app = appHarness({ hash: detail });
    let success, error;
    app.environment.navigator.geolocation = { getCurrentPosition(s, e) { success = s; error = e; } };
    await app.click("checkin", "future-school");
    app.navigate("#prepare");
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
  app.navigate("#prepare");
  await Promise.all([first, second]);
  assert.equal(app.element("#confirm-dialog").open, false);
  assert.ok(app.savedState().checkIns["future-school"]);
});

test("離頁後延遲相簿選取無效，返回原景點仍不能沿用舊選取", async () => {
  const app = checkedApp();
  let compressed = 0;
  app.photoService.compressPhoto = async () => { compressed += 1; return fixture("new"); };
  await app.click("gallery-open", "future-school");
  const input = app.element("#photo-input");
  app.navigate("#attraction/sun-yat-sen");
  app.navigate(detail);
  input.files = [new Blob(["late"])];
  await input.listeners.change[0].callback();
  assert.equal(compressed, 0);
});

test("離頁只釋放當前照片預覽；行程及舊景點網址仍可讀完成摘要", async () => {
  const revoked = [];
  let created = 0;
  const app = checkedApp({ initialPhotos: [fixture()], urlService: { createObjectURL: () => `blob:${++created}`, revokeObjectURL: (url) => revoked.push(url) } });
  await app.controller.start();
  assert.equal(app.controller.getPageSnapshot().photo.url, "blob:1");
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
  app.navigate("#prepare");
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
  app.navigate("#prepare");
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

test("清除全部資料等待已開始的照片寫入，重設期間拒絕清單操作", async () => {
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
  app.navigate("#prepare");
  const target = { dataset: { checkItem: "health" }, checked: true, matches: (selector) => selector === "[data-check-item]" };
  app.events.get("document:change")({ target });
  finish();
  await Promise.all([processing, resetting]);
  assert.equal(app.photoData.size, 0);
  assert.equal(app.savedState().checklist.health, false);
  assert.deepEqual(app.savedState().checkIns, {});
});

test("旅程卡生成後離頁禁止下載；同頁快照重建不會誤判照片替換", async () => {
  for (const leave of [true, false]) {
    const app = checkedApp({ initialPhotos: [fixture()] });
    await app.controller.start();
    let finish, downloads = 0;
    app.confirmation.handler = async () => true;
    app.photoService.createTravelCard = () => new Promise((resolve) => { finish = resolve; });
    app.element("a").click = () => { downloads += 1; };
    const downloading = app.click("card-download", "future-school");
    await tick();
    if (leave) app.navigate("#prepare");
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
