import test from "node:test";
import assert from "node:assert/strict";
import { appHarness, checkedState } from "./helpers/browser-environment.js";
import { createDataStore } from "../src/store.js";
const id = "future-school";
const record = photoId => ({ attractionId: id, photoId, writeId: photoId, blob: new Blob([photoId]), width: 20, height: 10 });
function harness() {
  const app = appHarness({ hash: `#attraction/${id}`, initialState: checkedState() });
  const data = new Map([["legacy", record("legacy")]]);
  app.photoService.getAllPhotoRecords = async () => [...data.values()];
  app.photoService.getPhotoRecord = async (attractionId, photoId) => [...data.values()].find(item => item.attractionId === attractionId && item.photoId === photoId);
  app.photoService.savePhotoRecord = async (item, { canBegin = () => true } = {}) => {
    if (!canBegin()) return null;
    data.set(item.photoId, item); return item.photoId;
  };
  app.photoService.deletePhotoRecord = async (attractionId, photoId) => {
    for (const [key, item] of data) if (item.attractionId === attractionId && (!photoId || key === photoId)) data.delete(key);
  };
  app.photoService.clearPhotoRecords = async () => data.clear();
  app.photoService.compressPhoto = async () => record("compressed");
  return { app, data };
}
async function selectMany(app, count = 2) {
  for (let index = 0; index < count; index++) await app.selectPhoto(new Blob(["fixture"]), id);
}
test("連續拍攝追加相片保留舊照，快照不含 Blob 並有獨立 ID", async () => {
  const { app, data } = harness();
  await app.controller.start();
  await selectMany(app);
  const photos = app.controller.getPageSnapshot().photos;
  assert.equal(photos.length, 3);
  assert.equal(data.size, 3);
  assert.ok(data.has("legacy"));
  assert.equal(new Set(photos.map(item => item.photoId)).size, 3);
  assert.ok(photos.every(item => !item.blob && Object.isFrozen(item)));
});
test("其中一張壓縮失敗或容量不足，不破壞舊照及其他新照", async () => {
  for (const failure of ["compress", "quota"]) {
    const { app, data } = harness();
    let count = 0;
    if (failure === "compress") app.photoService.compressPhoto = async () => {
      if (++count === 1) throw new Error("decode failed"); return record("ok");
    };
    else {
      const save = app.photoService.savePhotoRecord;
      app.photoService.savePhotoRecord = async (...args) => {
        if (++count === 1) throw Object.assign(new Error("full"), {name:"QuotaExceededError"});
        return save(...args);
      };
    }
    await app.controller.start(); await selectMany(app);
    assert.equal(data.size, 2); assert.ok(data.has("legacy"));
    assert.ok(app.savedState().checkIns[id]);
  }
});
test("連續拍攝處理期間離頁，尚未儲存的照片不再寫入", async () => {
  const { app, data } = harness();
  let release;
  app.photoService.compressPhoto = () => new Promise(resolve => { release = () => resolve(record("pending")); });
  await app.controller.start();
  const selecting = selectMany(app);
  await new Promise(setImmediate);
  app.navigate("#itinerary"); release(); await selecting;
  assert.equal(data.size, 1); assert.ok(data.has("legacy"));
});
test("取消打卡及清除全部資料刪除多張相片", async () => {
  for (const reset of [false, true]) {
    const { app, data } = harness();
    app.confirmation.handler = async () => true;
    await app.controller.start(); await selectMany(app);
    assert.equal(data.size, 3);
    if (reset) { app.navigate("#home"); await app.click("reset-all"); }
    else await app.click("checkin-undo", id);
    assert.equal(data.size, 0); assert.equal(app.savedState().checkIns[id], undefined);
  }
});
test("保存層按景點查找及版本核對，多照不能混入其他景點", () => {
  const store = createDataStore({storage:{getItem:()=>null},onSaveError() {}});
  store.replacePhotos([record("first"),record("second"),{...record("other"),attractionId:"sun-yat-sen"}]);
  assert.equal(store.getPhotos(id).length, 2);
  assert.equal(store.getPhoto(id,"other"), null);
  const version = store.getPhotoVersion(id);
  store.replacePhotos([record("first"),record("second")]);
  assert.equal(store.getPhotoVersion(id), version);
  store.replacePhotos([record("second")]);
  assert.ok(store.getPhotoVersion(id) > version);
});
