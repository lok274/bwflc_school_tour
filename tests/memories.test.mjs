import test from "node:test";
import assert from "node:assert/strict";
import { appHarness, checkedState } from "./helpers/browser-environment.js";
import { CHECK_IN_LOCATIONS } from "../src/data.js";

const photo = (photoId, attractionId = "future-school", createdAt = "2026-11-05T04:00:00.000Z") => ({
  photoId, attractionId, writeId: photoId, createdAt, width: 80, height: 60, blob: new Blob([photoId])
});
function setup(records = [photo("first"), photo("second", "sun-yat-sen")], ids = ["future-school", "sun-yat-sen"]) {
  const app = appHarness({ hash: "#memories", initialState: checkedState(ids) });
  const data = new Map(records.map(record => [record.photoId, record]));
  app.photoService.getAllPhotoRecords = async () => [...data.values()];
  app.photoService.deletePhotoRecord = async id => {
    for (const [photoId, record] of data) if (record.attractionId === id) data.delete(photoId);
  };
  app.photoService.clearPhotoRecords = async () => data.clear();
  const converted = [], downloads = [];
  app.photoService.createPhotoExport = async (record, name) => {
    converted.push(record.photoId); return new File([record.blob], name, { type: "image/jpeg" });
  };
  app.element("a").click = function () { downloads.push(this.download); };
  app.confirmation.handler = async () => true;
  return { app, data, converted, downloads };
}
function click(app, attribute) {
  const selector = `[data-${attribute}]`;
  const key = attribute.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const target = { dataset: { [key]: "memories" }, isConnected: true, closest() { return this; },
    matches: query => query.split(",").some(item => item.trim() === selector) };
  return app.events.get("document:click")({ target });
}
function select(app, photoId) {
  const record = [...app.photoData.values()].find(photo => photo.photoId === photoId);
  const album = app.controller.getPageSnapshot().albums?.find(item => item.cover.photoId === photoId);
  void app.click("memory-album", record?.attractionId || album?.attraction.id);
  app.events.get("document:change")({ target: { dataset: { photoSelect: photoId }, checked: true,
    isConnected: true, matches: query => query === "[data-photo-select]" } });
  void app.click("memory-close");
}
const photos = app => app.controller.getPageSnapshot().albums.map(album => album.cover);

test("回憶頁集齊六站舊照，按行程及拍攝時間排列，不提供 Blob 或儲存能力", async () => {
  const records = CHECK_IN_LOCATIONS.flatMap(place => [photo(`${place.id}-late`, place.id, "2026-11-05T05:00:00.000Z"), photo(place.id, place.id)]);
  const { app } = setup(records, CHECK_IN_LOCATIONS.map(place => place.id));
  await app.controller.start();
  const model = app.controller.getPageSnapshot();
  assert.equal(model.photoCount, 12);
  assert.deepEqual(model.albums.map(group => group.attraction.id), CHECK_IN_LOCATIONS.map(place => place.id));
  for (const group of model.albums) {
    assert.equal(group.cover.photoId, `${group.attraction.id}-late`);
    assert.ok(Object.isFrozen(group.cover));
    assert.ok(group.cover.url && !group.cover.blob && !group.cover.writeId);
  }
  assert.equal((app.element("#app").innerHTML.match(/data-photo-export-selected=/g) || []).length, 1);
  assert.throws(() => { model.albums.push({}); }, TypeError);
});

test("未打卡、未知站相片不進入回憶頁，空頁提供前往行程入口", async () => {
  const { app } = setup([photo("orphan", "sun-yat-sen"), photo("unknown", "unknown")], ["future-school"]);
  await app.controller.start();
  assert.equal(app.controller.getPageSnapshot().photoCount, 0);
  assert.match(app.element("#app").innerHTML, /第一段回憶|前往行程/);
  select(app, "orphan"); await click(app, "photo-export-selected");
  assert.equal(app.element("#photo-export-dialog").open, false);
});

test("景點保留拍攝及回憶入口，匯出、感想與旅程卡只可在回憶頁操作", async () => {
  const { app, converted } = setup(); await app.controller.start();
  app.navigate("#attraction/future-school");
  const html = app.element("#app").innerHTML;
  assert.match(html, /data-native-camera-open|href="#memories"/);
  assert.doesNotMatch(html, /data-photo-select|data-card-reflection|data-card-download/);
  select(app, "first"); await click(app, "photo-select-all"); await click(app, "photo-export-selected");
  let cards = 0;
  app.photoService.createTravelCard = async () => { cards++; return new Blob(); };
  await app.click("card-download", "future-school");
  assert.deepEqual(converted, []); assert.equal(cards, 0);
  app.navigate("#memories");
  assert.equal(photos(app).length, 2);
  assert.ok(photos(app).every(item => !item.selected));
});

test("跨景點全選一次下載 ZIP，取消選取及離頁清空選取", async () => {
  const { app, converted, downloads } = setup(); await app.controller.start();
  await click(app, "photo-select-all");
  assert.ok(photos(app).every(item => item.selected));
  await click(app, "photo-export-selected");
  assert.deepEqual(converted, ["first", "second"]);
  await app.click("photo-export-download-all");
  assert.deepEqual(downloads, ["旅途回憶-相片-2張.zip"]);
  await app.click("photo-export-close");
  await click(app, "photo-select-none");
  assert.ok(photos(app).every(item => !item.selected));
  select(app, "first"); app.navigate("#itinerary"); app.navigate("#memories");
  assert.ok(photos(app).every(item => !item.selected));
});

test("回憶頁不能借舊控制項打卡、取消打卡或啟動相機", async () => {
  const { app, data } = setup(); await app.controller.start();
  let requests = 0;
  app.environment.navigator.geolocation = { getCurrentPosition() { requests++; } };
  app.environment.navigator.mediaDevices = { getUserMedia() { requests++; } };
  app.element("#native-camera-input").click = () => { requests++; };
  const before = app.savedState();
  for (const action of ["checkin", "checkin-undo", "camera-open", "native-camera-open"]) await app.click(action, "future-school");
  assert.equal(requests, 0); assert.equal(data.size, 2);
  assert.deepEqual(app.savedState(), before);
});

test("跨景點只選一張，直接下載該景點 JPEG", async () => {
  const { app, converted, downloads } = setup(); await app.controller.start();
  select(app, "second"); await click(app, "photo-export-selected");
  assert.deepEqual(converted, ["second"]);
  await app.click("photo-export-download-all");
  assert.equal(downloads.length, 1); assert.match(downloads[0], /孫中山.*second\.jpg$/);
});

for (const action of ["leave", "replace", "remove"]) {
  test(`跨景點轉換途中 ${action} 使整組失效，不產生部分下載`, async () => {
    const { app, data, downloads } = setup(); await app.controller.start();
    await click(app, "photo-select-all");
    let release;
    app.photoService.createPhotoExport = (record, name) => new Promise(resolve => { release = () => resolve(new File([record.blob], name)); });
    const preparing = click(app, "photo-export-selected");
    if (action === "leave") app.navigate("#home");
    else {
      if (action === "replace") data.set("second", { ...data.get("second"), writeId: "replacement" });
      else data.delete("second");
      await app.controller.start();
    }
    release(); await preparing;
    await app.click("photo-export-download-all");
    assert.equal(app.element("#photo-export-dialog").open, false);
    assert.deepEqual(downloads, []);
  });
}

test("同時準備兩站匯出，有一張失敗不提供部分相片下載", async () => {
  const { app, downloads } = setup(); await app.controller.start();
  app.photoService.createPhotoExport = async (record, name) => {
    if (record.photoId === "second") throw Error("decode failed");
    return new File([record.blob], name);
  };
  await click(app, "photo-select-all"); await click(app, "photo-export-selected");
  assert.equal(app.element("#photo-export-content").dataset.status, "error");
  assert.doesNotMatch(app.element("#photo-export-content").innerHTML, /data-photo-export-download/);
  assert.deepEqual(downloads, []);
});

test("取消一站打卡只移除該站回憶，清除全部後空頁及重載一致", async () => {
  const { app, data } = setup(); await app.controller.start();
  app.navigate("#attraction/future-school"); await app.click("checkin-undo", "future-school");
  app.navigate("#memories");
  assert.deepEqual(photos(app).map(item => item.photoId), ["second"]);
  assert.equal(data.size, 1);
  app.navigate("#home"); await app.click("reset-all"); app.navigate("#memories");
  await app.controller.start();
  assert.equal(app.controller.getPageSnapshot().photoCount, 0);
  assert.equal(data.size, 0);
});

test("讀相片失敗顯示重試，不能誤當成未拍照；重試恢復原紀錄", async () => {
  const { app, data } = setup();
  const load = app.photoService.getAllPhotoRecords;
  app.photoService.getAllPhotoRecords = async () => { throw Error("temporarily unavailable"); };
  await app.controller.start();
  assert.equal(app.controller.getPageSnapshot().readError, true);
  assert.match(app.element("#app").innerHTML, /重新讀取相片/);
  assert.doesNotMatch(app.element("#app").innerHTML, /第一段回憶/);
  app.photoService.getAllPhotoRecords = load;
  await app.click("photos-retry");
  assert.equal(app.controller.getPageSnapshot().photoCount, 2);
  assert.equal(data.size, 2);
});
