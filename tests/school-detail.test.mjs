import test from "node:test";
import assert from "node:assert/strict";
import { ATTRACTIONS, CHECK_IN_LOCATIONS, DEPARTURE_LOCATION } from "../src/data.js";
import { getAttraction } from "../src/formatting.js";
import { createDataStore } from "../src/store.js";
import { appHarness, checkedState } from "./helpers/browser-environment.js";

const school = DEPARTURE_LOCATION;
const otherId = ATTRACTIONS[0].id;
const hash = `#attraction/${school.id}`;
const tick = () => new Promise(setImmediate);
const record = (photoId, attractionId = school.id) => ({
  attractionId, photoId, writeId: photoId, blob: new Blob([photoId], { type: "image/webp" }), width: 40, height: 30
});

function photoHarness({ photos = [record("school-first"), record("school-second"), record("foreign", otherId)], initialState = checkedState(CHECK_IN_LOCATIONS.map(place => place.id)), ...options } = {}) {
  const app = appHarness({ hash, initialState, ...options });
  const data = new Map(photos.map(item => [item.photoId, item]));
  app.photoService.getAllPhotoRecords = async () => [...data.values()];
  app.photoService.getPhotoRecord = async (attractionId, photoId) => [...data.values()].find(item => item.attractionId === attractionId && item.photoId === photoId);
  app.photoService.savePhotoRecord = async (item, { canBegin = () => true } = {}) => {
    if (!canBegin()) return null;
    data.set(item.photoId, item);
    return item.photoId;
  };
  app.photoService.deletePhotoRecord = async (attractionId, photoId) => {
    for (const [key, item] of data) if (item.attractionId === attractionId && (!photoId || key === photoId)) data.delete(key);
  };
  app.photoService.clearPhotoRecords = async () => data.clear();
  app.photoService.compressPhoto = async (_input, id) => record("compressed", id);
  return { app, data };
}

function changeSelection(app, photoId, checked = true) {
  return app.events.get("document:change")({ target: {
    dataset: { photoSelect: photoId }, checked, isConnected: true,
    matches: selector => selector === "[data-photo-select]"
  } });
}

// Match selector lists as an actual DOM button does; the basic harness targets only single selectors.
function clickPhotoControl(app, attribute, value) {
  const selector = `[data-${attribute}]`;
  const key = attribute.replace(/-([a-z])/g, (_, character) => character.toUpperCase());
  const target = { dataset: { [key]: value }, isConnected: true, disabled: false,
    closest() { return this; }, setAttribute() {},
    matches: query => query.split(",").some(part => part.trim() === selector)
  };
  return app.events.get("document:click")({ target });
}

test("學校使用景點詳情共用資料及畫面，保留地圖、校舍圖片來源與授權", async () => {
  const app = appHarness({ hash });
  await app.controller.start();
  const model = app.controller.getPageSnapshot();
  assert.equal(getAttraction(school.id), school);
  assert.equal(getAttraction("unknown"), undefined);
  assert.equal(model.view, "attraction");
  assert.equal(model.attraction.name, "佛教黃鳳翎中學");
  assert.equal(model.attraction.day, 1);
  assert.equal(model.attraction.city, "香港");
  for (const field of ["intro", "observe", "prompt", "source"]) assert.ok(model.attraction[field]);
  assert.ok(model.attraction.geo.sourceUrl);
  assert.ok(Object.isFrozen(model.attraction));
  const html = app.element("#app").innerHTML;
  assert.match(html, /href="#itinerary" class="back-link">← 返回行程/);
  assert.equal(model.attraction.mapUrl, school.mapUrl);
  assert.doesNotMatch(html, /src="undefined"|data-gallery-open|data-photo-delete|data-photo-export="/);
  assert.match(html, /data-checkin="departure-school"/);
});

test("已有學校打卡的使用者重開詳情，可連拍多張，舊照及其他站不受影響", async () => {
  const { app, data } = photoHarness();
  let opened = 0;
  app.element("#native-camera-input").click = () => { opened++; };
  await app.controller.start();
  assert.equal(app.controller.getPageSnapshot().photos.length, 2);
  assert.equal(app.controller.getPageSnapshot().checkIn.method, "manual");
  await app.click("gallery-open", school.id);
  await app.click("photo-delete", school.id);
  assert.equal(data.size, 3);
  for (let index = 0; index < 2; index++) await app.selectPhoto(new Blob(["synthetic input"]), school.id);
  const model = app.controller.getPageSnapshot();
  assert.equal(opened, 2);
  assert.equal(model.photos.length, 4);
  assert.equal(new Set(model.photos.map(photo => photo.photoId)).size, 4);
  assert.ok(model.photos.every(photo => !photo.blob && Object.isFrozen(photo)));
  assert.ok(data.has("school-first"));
  assert.ok(data.has("school-second"));
  assert.equal(data.get("foreign").attractionId, otherId);
  const html = app.element("#app").innerHTML;
  assert.equal((html.match(/data-photo-export-selected=/g) || []).length, 1);
  assert.match(html, /data-native-camera-open="departure-school"/);
  assert.match(html, /data-camera-open="departure-school"/);
  assert.doesNotMatch(html, /data-gallery-open|data-photo-delete|data-photo-export="/);
  const reopened = photoHarness({ initialState: app.savedState(), photos: [...data.values()] }).app;
  await reopened.controller.start();
  assert.equal(reopened.controller.getPageSnapshot().photos.length, 4);
});

test("保存層接受學校多照、拒絕未知站，版本及跨站查找仍受限制", () => {
  const store = createDataStore({ storage: { getItem: () => null }, onSaveError() {} });
  const photos = [record("school-first"), record("school-second"), record("foreign", otherId), record("unknown-photo", "unknown")];
  store.replacePhotos(photos);
  assert.equal(store.photoCount, 3);
  assert.equal(store.getPhotos(school.id).length, 2);
  assert.equal(store.getPhoto(school.id, "foreign"), null);
  assert.equal(store.getPhoto(otherId, "school-first"), null);
  assert.equal(store.getPhoto("unknown", "unknown-photo"), null);
  const version = store.getPhotoVersion(school.id);
  store.replacePhotos(photos);
  assert.equal(store.getPhotoVersion(school.id), version);
  store.replacePhotos(photos.map(item => item.photoId === "school-first" ? { ...item, writeId: "replacement" } : item));
  assert.ok(store.getPhotoVersion(school.id) > version);
});

test("學校只匯出本站已選多照，JPEG 檔名使用校名，跨站相片不能混入", async () => {
  const { app, data } = photoHarness();
  const exported = [];
  app.photoService.createPhotoExport = async (photo, filename) => {
    exported.push({ photo, filename });
    return new File([photo.blob], filename, { type: "image/jpeg" });
  };
  await app.controller.start();
  changeSelection(app, "foreign");
  assert.ok(app.controller.getPageSnapshot().photos.every(photo => !photo.selected));
  await clickPhotoControl(app, "photo-export-selected", school.id);
  assert.equal(exported.length, 0);
  await clickPhotoControl(app, "photo-select-all", school.id);
  await clickPhotoControl(app, "photo-export-selected", school.id);
  assert.deepEqual(exported.map(item => item.photo.photoId), ["school-first", "school-second"]);
  assert.ok(exported.every(item => item.filename.startsWith(`${school.name}-`) && item.filename.endsWith(".jpg")));
  assert.equal(app.element("#photo-export-content").dataset.status, "ready");
  assert.match(app.element("#photo-export-content").innerHTML, /下載第 2 張/);
  assert.equal(data.size, 3);
  await app.click("photo-export-close");
  app.navigate(`#attraction/${otherId}`);
  assert.ok(app.controller.getPageSnapshot().photos.every(photo => !photo.selected));
});

test("學校旅程卡使用共用查找及私隱確認，不能借其他詳情下載校照", async () => {
  const { app } = photoHarness();
  let generated = 0;
  let downloaded = 0;
  app.element("a").click = () => { downloaded++; };
  app.photoService.createTravelCard = async ({ attraction, photoRecord, checkIn }) => {
    generated++;
    assert.equal(attraction.id, school.id);
    assert.equal(attraction.name, school.name);
    assert.equal(photoRecord.attractionId, school.id);
    assert.equal(checkIn.attractionId, school.id);
    return new Blob(["synthetic card"], { type: "image/png" });
  };
  await app.controller.start();
  app.confirmation.handler = async () => false;
  await app.click("card-download", school.id);
  assert.equal(generated, 0);
  app.confirmation.handler = async ({ message }) => {
    assert.match(message, /分享前|保存及分享/);
    return true;
  };
  await app.click("card-download", school.id);
  assert.equal(generated, 1);
  assert.equal(downloaded, 1);
  app.navigate(`#attraction/${otherId}`);
  await app.click("card-download", school.id);
  assert.equal(generated, 1);
});

test("學校照片刪除失敗保留打卡、六站完成提示及其他站，重試只刪本站多照", async () => {
  const { app, data } = photoHarness();
  await app.controller.start();
  app.confirmation.handler = async () => true;
  const remove = app.photoService.deletePhotoRecord;
  app.photoService.deletePhotoRecord = async () => { throw Error("blocked"); };
  await app.click("checkin-undo", school.id);
  assert.equal(app.controller.getPageSnapshot().allCheckInsComplete, true);
  assert.equal(app.controller.getPageSnapshot().photos.length, 2);
  assert.ok(app.savedState().checkIns[school.id]);
  assert.match(app.element("#toast").textContent, /打卡紀錄會暫時保留/);
  app.photoService.deletePhotoRecord = remove;
  await app.click("checkin-undo", school.id);
  assert.equal(app.controller.getPageSnapshot().allCheckInsComplete, false);
  assert.equal(app.controller.getPageSnapshot().checkIn, null);
  assert.equal(app.controller.getPageSnapshot().photos.length, 0);
  assert.deepEqual([...data.keys()], ["foreign"]);
  assert.ok(app.savedState().checkIns[otherId]);
});

for (const stage of ["compression", "transaction"]) {
  test(`學校取消打卡等待 ${stage} 晚回覆，不能恢復照片或影響其他站`, async () => {
    const { app, data } = photoHarness();
    let release;
    if (stage === "compression") {
      app.photoService.compressPhoto = (_input, id) => new Promise(resolve => { release = () => resolve(record("pending", id)); });
    } else {
      app.photoService.savePhotoRecord = (photo, { canBegin }) => {
        assert.ok(canBegin());
        return new Promise(resolve => { release = () => { data.set(photo.photoId, photo); resolve(photo.photoId); }; });
      };
    }
    await app.controller.start();
    app.confirmation.handler = async () => true;
    const capture = app.selectPhoto(new Blob(["synthetic input"]), school.id);
    await tick();
    assert.equal(typeof release, "function");
    const undo = app.click("checkin-undo", school.id);
    await tick();
    release();
    await Promise.all([capture, undo]);
    assert.equal(app.controller.getPageSnapshot().checkIn, null);
    assert.equal(app.controller.getPageSnapshot().photos.length, 0);
    assert.deepEqual([...data.keys()], ["foreign"]);
    assert.equal(app.savedState().checkIns[school.id], undefined);
    assert.ok(app.savedState().checkIns[otherId]);
  });
}

test("學校網頁相機與其他站相同，離開詳情必須停止所有鏡頭 tracks", async () => {
  const { app } = photoHarness();
  let stopped = 0;
  app.environment.navigator.mediaDevices = { getUserMedia: async constraints => {
    assert.equal(constraints.audio, false);
    return { getTracks: () => [{ stop() { stopped++; } }] };
  } };
  await app.controller.start();
  await app.click("camera-open", school.id);
  assert.equal(app.element("#camera-dialog").open, true);
  assert.equal(app.element("#camera-title").textContent, `在${school.name}影相`);
  app.navigate("#itinerary");
  assert.equal(stopped, 1);
  assert.equal(app.element("#camera-dialog").open, false);
});

test("學校 JPEG 準備後離頁，晚回覆不能再次開啟匯出", async () => {
  const { app } = photoHarness();
  let release;
  app.photoService.createPhotoExport = (_photo, filename) => new Promise(resolve => {
    release = () => resolve(new File(["synthetic jpeg"], filename, { type: "image/jpeg" }));
  });
  await app.controller.start();
  await clickPhotoControl(app, "photo-select-all", school.id);
  const preparing = clickPhotoControl(app, "photo-export-selected", school.id);
  assert.equal(app.element("#photo-export-dialog").open, true);
  app.navigate("#itinerary");
  release();
  await preparing;
  assert.equal(app.element("#photo-export-dialog").open, false);
  assert.equal(app.element("#photo-export-content").innerHTML, "");
  assert.ok(app.savedState().checkIns[school.id]);
});
