import test from "node:test";
import assert from "node:assert/strict";
import { ATTRACTIONS, CHECK_IN_LOCATIONS } from "../src/data.js";
import { gcj02ToWgs84 } from "../src/geo.js";
import { createDataStore } from "../src/store.js";
import { STORAGE_KEY } from "../src/state.js";
import { createDeviceTestStore } from "../src/device-test-store.js";
import { DEVICE_TEST_LOCATION } from "../src/device-test-data.js";
import { appHarness, checkedState } from "./helpers/browser-environment.js";

const ids = CHECK_IN_LOCATIONS.map(place => place.id);
const lastId = ids.at(-1);
const record = (id, method = "manual") => ({ attractionId: id, checkedInAt: "2026-11-05T04:00:00.000Z", method, verified: method === "gps" });
function stored(state = checkedState([])) {
  const entries = new Map([[STORAGE_KEY, JSON.stringify(state)]]);
  const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) };
  return { storage, store: createDataStore({ storage, onSaveError() {} }) };
}
function complete(app, value) {
  assert.equal(app.controller.getPageSnapshot().allCheckInsComplete, value);
  assert.equal(app.element("#app").innerHTML.includes("已完成所有打卡行程"), value);
}

for (const count of [0, 1, 4, 5, 6]) {
  test(`逐一核對正式打卡站：${count} 站`, () => {
    const { store, storage } = stored(checkedState(ids.slice(0, count)));
    const before = storage.getItem(STORAGE_KEY);
    assert.equal(store.hasCompletedAllCheckIns(), count === 6);
    assert.equal(storage.getItem(STORAGE_KEY), before, "查詢不可寫入完成旗標");
  });
}
test("GPS 與手動混合有效紀錄都計算，手動仍未核實", () => {
  const state = checkedState(ids);
  state.checkIns[ids[0]] = record(ids[0], "gps");
  const { store } = stored(state);
  assert.equal(store.hasCompletedAllCheckIns(), true);
  assert.equal(store.getCheckIn(ids[1]).verified, false);
});
test("未知與裝置測試紀錄不能湊成第六站", () => {
  const state = checkedState(ids.slice(0, -1));
  for (const id of ["unknown", DEVICE_TEST_LOCATION.id]) state.checkIns[id] = record(id);
  const { store, storage } = stored(state);
  const device = createDeviceTestStore({ storage });
  device.recordCheckIn(record(DEVICE_TEST_LOCATION.id));
  assert.ok(device.getCheckIn());
  assert.equal(store.hasCompletedAllCheckIns(), false);
  assert.equal(createDataStore({ storage, onSaveError() {} }).hasCompletedAllCheckIns(), false);
});
for (const invalid of [null, { ...record(lastId), attractionId: ids[0] }, { ...record(lastId), checkedInAt: "broken" }, { ...record(lastId), method: "other" }, { ...record(lastId), verified: true }]) {
  test(`損壞紀錄不計算：${JSON.stringify(invalid)}`, () => {
    const state = checkedState(ids);
    state.checkIns[lastId] = invalid;
    assert.equal(stored(state).store.hasCompletedAllCheckIns(), false);
  });
}
test("完成第六站即更新兩頁，重新載入也顯示，快照不暴露完整資料", async () => {
  const app = appHarness({ initialState: checkedState(ids.slice(0, -1)), hash: `#attraction/${lastId}` });
  await app.controller.start();
  complete(app, false);
  const centre = gcj02ToWgs84(ATTRACTIONS[4].geo);
  app.environment.navigator.geolocation = { getCurrentPosition(success) { success({ coords: { latitude: centre.lat, longitude: centre.lng, accuracy: 10 } }); } };
  await app.click("checkin", lastId);
  complete(app, true);
  assert.equal(app.controller.getPageSnapshot().checkIn.verified, true);
  assert.equal("state" in app.controller.getPageSnapshot(), false);
  app.navigate("#itinerary");
  complete(app, true);
  assert.equal("checkIns" in app.controller.getPageSnapshot(), true);
  assert.equal(app.controller.getPageSnapshot().checkIns[ids[0]].verified, false);
  const reload = appHarness({ initialState: app.savedState(), hash: "#itinerary" });
  await reload.controller.start();
  complete(reload, true);
});
test("取消確認保留提示；刪除失敗保留；成功取消及重新完成會更新", async () => {
  const app = appHarness({ initialState: checkedState(ids), hash: `#attraction/${lastId}` });
  app.environment.indexedDB = {};
  await app.controller.start();
  app.confirmation.handler = async () => false;
  await app.click("checkin-undo", lastId);
  complete(app, true);
  app.confirmation.handler = async () => true;
  app.photoService.deletePhotoRecord = async () => { throw Error("blocked"); };
  await app.click("checkin-undo", lastId);
  complete(app, true);
  assert.match(app.element("#toast").textContent, /打卡紀錄會暫時保留/);
  app.photoService.deletePhotoRecord = async () => {};
  await app.click("checkin-undo", lastId);
  complete(app, false);
  app.navigate("#itinerary"); complete(app, false);
  app.navigate(`#attraction/${lastId}`);
  await app.click("checkin", lastId); complete(app, true);
});
test("清除取消與相片刪除／儲存清除失敗保留提示；成功清除後及重載不顯示", async () => {
  const app = appHarness({ initialState: checkedState(ids) });
  app.environment.indexedDB = {};
  await app.controller.start();
  app.confirmation.handler = async () => false;
  await app.click("reset-all");
  app.navigate("#itinerary"); complete(app, true);
  app.navigate("#home");
  app.confirmation.handler = async () => true;
  app.photoService.clearPhotoRecords = async () => { throw Error("blocked"); };
  await app.click("reset-all"); app.navigate("#itinerary"); complete(app, true);
  app.navigate("#home"); app.photoService.clearPhotoRecords = async () => {};
  const remove = app.environment.localStorage.removeItem;
  app.environment.localStorage.removeItem = () => { throw Error("blocked"); };
  await app.click("reset-all"); app.navigate("#itinerary"); complete(app, true);
  app.navigate("#home"); app.environment.localStorage.removeItem = remove;
  await app.click("reset-all"); app.navigate("#itinerary"); complete(app, false);
  const reload = appHarness({ initialState: app.savedState(), hash: "#itinerary" });
  await reload.controller.start(); complete(reload, false);
});
test("第六站儲存失敗沿用警告；當前記憶體完成，重載只計實際五站", async () => {
  const app = appHarness({ initialState: checkedState(ids.slice(0, -1)), hash: `#attraction/${lastId}` });
  await app.controller.start();
  app.confirmation.handler = async () => true;
  app.environment.localStorage.setItem = () => { throw Error("quota"); };
  await app.click("checkin", lastId); complete(app, true);
  assert.match(app.element("#toast").textContent, /打卡只暫存於目前頁面/);
  const reload = appHarness({ initialState: app.savedState(), hash: "#itinerary" });
  await reload.controller.start(); complete(reload, false);
});
test("取消打卡更新儲存失敗：當前提示消失，重載仍以六站保存紀錄為準", async () => {
  const app = appHarness({ initialState: checkedState(ids), hash: `#attraction/${lastId}` });
  await app.controller.start(); app.confirmation.handler = async () => true;
  app.environment.localStorage.setItem = () => { throw Error("quota"); };
  await app.click("checkin-undo", lastId); complete(app, false);
  assert.match(app.element("#toast").textContent, /未能保存打卡更新/);
  const reload = appHarness({ initialState: app.savedState(), hash: "#itinerary" });
  await reload.controller.start(); complete(reload, true);
});
