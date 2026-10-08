import test from "node:test";
import assert from "node:assert/strict";
import { ATTRACTIONS, CHECK_IN_LOCATIONS, DEPARTURE_LOCATION, TRIP_DATA } from "../src/data.js";
import { evaluateGeofence } from "../src/geo.js";
import { normalizeState } from "../src/state.js";
import { appHarness, checkedState } from "./helpers/browser-environment.js";

const school = DEPARTURE_LOCATION;
const schoolHash = `#attraction/${school.id}`;
const fiveIds = ATTRACTIONS.map(place => place.id);
const sixIds = CHECK_IN_LOCATIONS.map(place => place.id);
const fix = { latitude: school.geo.lat, longitude: school.geo.lng, accuracy: 10 };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function schoolChecked(app) { return Boolean(app.savedState().checkIns[school.id]); }

test("DAY 1 校名進入學校詳情，行程不再直接操作打卡，DAY 3 香港及原五景點不變", async () => {
  const app = appHarness({ hash: "#itinerary" });
  await app.controller.start();
  const model = app.controller.getPageSnapshot();
  assert.equal(ATTRACTIONS.length, 5);
  assert.equal(CHECK_IN_LOCATIONS.length, 6);
  assert.equal(new Set(sixIds).size, 6);
  assert.deepEqual(model.days[0].route[0], { label: school.name, attractionId: school.id });
  assert.equal(model.days[2].route.at(-1).label, "香港");
  assert.equal(model.days[2].route.at(-1).attractionId, null);
  const html = app.element("#app").innerHTML;
  assert.match(html, /href="#attraction\/departure-school"/);
  assert.doesNotMatch(html, /data-checkin(?:-undo)?="departure-school"/);
  assert.match(TRIP_DATA.itinerary[0].summary, /由佛教黃鳳翎中學出發/);
  app.navigate(schoolHash);
  assert.deepEqual(app.controller.currentRoute(), { view: "attraction", attractionId: school.id });
  assert.match(app.element("#app").innerHTML, /data-checkin="departure-school"/);
});

test("學校使用 WGS84 地址點；Google 地圖畫面中心不符合打卡範圍", () => {
  assert.equal(school.geo.coordSystem, "WGS84");
  assert.equal(school.geo.radiusM, 100);
  assert.equal(evaluateGeofence(fix, school.geo).status, "verified");
  assert.equal(evaluateGeofence({ latitude: 22.2775222, longitude: 114.1844574, accuracy: 10 }, school.geo).status, "too-far");
});

test("原五站及相片保留，在學校詳情完成 GPS 打卡後才完成六站", async () => {
  const oldState = checkedState(fiveIds);
  const photo = { attractionId: fiveIds[0], photoId: "kept", writeId: "kept", blob: new Blob(["fixture"]), width: 4, height: 3 };
  const app = appHarness({ initialState: oldState, initialPhotos: [photo], hash: schoolHash });
  await app.controller.start();
  assert.equal(app.controller.getPageSnapshot().allCheckInsComplete, false);
  assert.deepEqual(normalizeState(oldState).checkIns, oldState.checkIns);
  let requests = 0;
  app.environment.navigator.geolocation = { getCurrentPosition(success) { requests++; success({ coords: fix }); } };
  await app.click("checkin", school.id);
  await app.click("checkin", school.id);
  assert.equal(requests, 1);
  assert.equal(app.controller.getPageSnapshot().allCheckInsComplete, true);
  assert.equal(app.savedState().checkIns[school.id].verified, true);
  assert.deepEqual(Object.keys(app.savedState().checkIns[school.id]).sort(), ["attractionId", "checkedInAt", "method", "verified"]);
  assert.deepEqual(app.savedState().checkIns[fiveIds[0]], oldState.checkIns[fiveIds[0]]);
  assert.equal(app.photoData.get(fiveIds[0]).writeId, "kept");
  app.navigate("#itinerary");
  assert.equal(app.controller.getPageSnapshot().allCheckInsComplete, true);
  const reload = appHarness({ initialState: app.savedState(), hash: schoolHash });
  await reload.controller.start();
  assert.equal(reload.controller.getPageSnapshot().allCheckInsComplete, true);
});

test("學校詳情定位拒絕時可取消或手動記錄，明確顯示未核實", async () => {
  const app = appHarness({ hash: schoolHash });
  await app.controller.start();
  app.environment.navigator.geolocation = { getCurrentPosition(success, error) { error({ code: 1 }); } };
  app.confirmation.handler = async () => false;
  await app.click("checkin", school.id);
  await tick();
  assert.equal(schoolChecked(app), false);
  app.confirmation.handler = async () => true;
  await app.click("checkin", school.id);
  await tick();
  assert.equal(schoolChecked(app), true);
  assert.equal(app.savedState().checkIns[school.id].verified, false);
  assert.match(app.element("#app").innerHTML, /未核實手動記錄/);
});

test("明確遠離學校不提供手動繞過", async () => {
  const app = appHarness({ hash: schoolHash });
  await app.controller.start();
  let confirmations = 0;
  app.confirmation.handler = async () => { confirmations++; return true; };
  app.environment.navigator.geolocation = { getCurrentPosition(success) { success({ coords: { latitude: 0, longitude: 0, accuracy: 10 } }); } };
  await app.click("checkin", school.id);
  assert.equal(confirmations, 0);
  assert.equal(schoolChecked(app), false);
  assert.match(app.element("#toast").textContent, /尚未進入打卡範圍/);
});

test("學校只可在自己的詳情操作；行程、首頁、其他詳情及分離控制項不能越權", async () => {
  const app = appHarness({ hash: "#itinerary" });
  await app.controller.start();
  app.confirmation.handler = async () => true;
  for (const hash of ["#itinerary", "#home", `#attraction/${fiveIds[0]}`]) {
    app.navigate(hash);
    await app.click("checkin", school.id);
    assert.equal(schoolChecked(app), false);
  }
  app.navigate(schoolHash);
  await app.click("checkin", fiveIds[0]);
  await app.click("checkin", "unknown");
  await app.click("checkin", school.id, { detached: true });
  assert.deepEqual(app.savedState().checkIns, {});
  const completed = appHarness({ initialState: checkedState(sixIds), hash: "#itinerary" });
  await completed.controller.start();
  completed.confirmation.handler = async () => true;
  for (const nextHash of ["#itinerary", "#home", `#attraction/${fiveIds[0]}`]) {
    completed.navigate(nextHash);
    await completed.click("checkin-undo", school.id);
    assert.equal(schoolChecked(completed), true);
  }
});

test("學校詳情未打卡前照片及相機仍鎖定", async () => {
  const app = appHarness({ hash: schoolHash });
  await app.controller.start();
  let opened = 0;
  app.element("#native-camera-input").click = () => { opened++; };
  app.environment.navigator.mediaDevices = { getUserMedia: async () => { opened++; throw Error("must not open"); } };
  await app.click("native-camera-open", school.id);
  await app.click("camera-open", school.id);
  await app.click("photo-export-selected", school.id);
  await app.click("card-download", school.id);
  assert.equal(opened, 0);
  assert.equal(app.element("#camera-dialog").open, false);
  assert.equal(app.photoData.size, 0);
});

for (const [name, leave] of [["離頁", app => app.navigate("#home")], ["進入背景", app => app.events.get("window:pagehide")()]]) {
  test(`${name}後的學校定位回覆不得保存打卡`, async () => {
    const app = appHarness({ hash: schoolHash });
    await app.controller.start();
    let reply;
    app.environment.navigator.geolocation = { getCurrentPosition(success) { reply = success; } };
    await app.click("checkin", school.id);
    leave(app);
    await reply({ coords: fix });
    assert.equal(schoolChecked(app), false);
  });
}

test("學校取消確認保留六站；成功取消只移除學校打卡及本站相片", async () => {
  const schoolPhoto = { attractionId: school.id, photoId: "school", writeId: "school", blob: new Blob(["school fixture"]) };
  const otherPhoto = { attractionId: fiveIds[0], photoId: "kept", writeId: "kept", blob: new Blob(["other fixture"]) };
  const app = appHarness({ initialState: checkedState(sixIds), initialPhotos: [schoolPhoto, otherPhoto], hash: schoolHash });
  await app.controller.start();
  const deletedIds = [];
  const remove = app.photoService.deletePhotoRecord;
  app.photoService.deletePhotoRecord = async id => { deletedIds.push(id); await remove(id); };
  app.confirmation.handler = async () => false;
  await app.click("checkin-undo", school.id);
  assert.equal(app.controller.getPageSnapshot().allCheckInsComplete, true);
  assert.deepEqual(deletedIds, []);
  app.confirmation.handler = async () => true;
  await app.click("checkin-undo", school.id);
  assert.equal(app.controller.getPageSnapshot().allCheckInsComplete, false);
  assert.deepEqual(deletedIds, [school.id]);
  assert.equal(schoolChecked(app), false);
  assert.equal(app.photoData.has(school.id), false);
  assert.equal(app.photoData.get(fiveIds[0]).writeId, "kept");
  assert.deepEqual(Object.keys(app.savedState().checkIns).sort(), [...fiveIds].sort());
});

test("學校打卡寫入失敗沿用警告，重載以保存的五站為準", async () => {
  const app = appHarness({ initialState: checkedState(fiveIds), hash: schoolHash });
  await app.controller.start();
  app.confirmation.handler = async () => true;
  app.environment.localStorage.setItem = () => { throw Error("quota"); };
  await app.click("checkin", school.id);
  assert.equal(app.controller.getPageSnapshot().allCheckInsComplete, true);
  assert.match(app.element("#toast").textContent, /打卡只暫存於目前頁面/);
  const reload = appHarness({ initialState: app.savedState(), hash: schoolHash });
  await reload.controller.start();
  assert.equal(reload.controller.getPageSnapshot().allCheckInsComplete, false);
});
