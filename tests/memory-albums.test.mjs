import test from "node:test";
import assert from "node:assert/strict";
import { appHarness, checkedState } from "./helpers/browser-environment.js";
import { CHECK_IN_LOCATIONS } from "../src/data.js";

const ids = CHECK_IN_LOCATIONS.map(item => item.id);
const photo = (index, id = ids[1]) => ({ photoId: `${id}-${index}`, attractionId: id, writeId: `write-${index}`,
  createdAt: new Date(Date.UTC(2026, 10, 5, 4, 0, index)).toISOString(), width: 120, height: 90, blob: new Blob([String(index)]) });
async function setup(records) {
  let serial = 0;
  const live = new Set(), revoked = [], downloads = [], converted = [];
  const app = appHarness({ hash: "#memories", initialState: checkedState(ids), urlService: {
    createObjectURL() { const url = `blob:fixture-${++serial}`; live.add(url); return url; },
    revokeObjectURL(url) { live.delete(url); revoked.push(url); }
  } });
  const data = new Map(records.map(record => [record.photoId, record]));
  app.photoService.getAllPhotoRecords = async () => [...data.values()];
  app.photoService.createPhotoExport = async (record, name) => { converted.push(record.photoId); return new File([record.blob], name, { type: "image/jpeg" }); };
  app.element("a").click = function () { downloads.push(this.download); };
  app.confirmation.handler = async () => true;
  await app.controller.start();
  return { app, data, live, revoked, downloads, converted };
}
function select(app, photoId, checked = true) {
  app.events.get("document:change")({ target: { dataset: { photoSelect: photoId }, checked, isConnected: true,
    matches: selector => selector === "[data-photo-select]" } });
}
const overlay = app => app.controller.getPageSnapshot().memoryOverlay;
const escape = (app, isComposing = false) => app.events.get("document:keydown")({ key: "Escape", isComposing, preventDefault() {} });

test("確定才套用本站勾選；× 撤銷新增及取消勾選，保留之前及他站的已確定選取", async () => {
  const { app, converted } = await setup([photo(0), photo(1), photo(0, ids[2])]);
  await app.click("memory-album", ids[2]); select(app, `${ids[2]}-0`);
  assert.equal(app.controller.getPageSnapshot().selectedCount, 0);
  await app.click("memory-selection-confirm"); assert.equal(overlay(app), null);
  await app.click("memory-album", ids[1]); select(app, `${ids[1]}-0`);
  assert.doesNotMatch(app.element("#app").innerHTML, /memory-selection-hint|勾選後請按「確定」保留/);
  assert.equal(overlay(app).selectedCount, 2);
  assert.equal(overlay(app).confirmedSelectedCount, 1);
  assert.match(app.element("#app").innerHTML, /data-memory-selection-confirm>確定/);
  await app.click("memory-close");
  assert.deepEqual(app.controller.getPageSnapshot().selectedPhotoIds, [`${ids[2]}-0`]);
  await app.click("memory-album", ids[1]); select(app, `${ids[1]}-0`); await app.click("memory-selection-confirm");
  await app.click("memory-album", ids[1]); select(app, `${ids[1]}-0`, false); select(app, `${ids[1]}-1`);
  await app.click("memory-photo", `${ids[1]}-1`); await app.click("memory-close");
  assert.deepEqual(app.controller.getPageSnapshot().selectedPhotoIds.toSorted(), [`${ids[1]}-0`, `${ids[2]}-0`]);
  await app.click("memory-album", ids[1]); await app.click("memory-album-select", "none"); await app.click("memory-selection-confirm");
  assert.deepEqual(app.controller.getPageSnapshot().selectedPhotoIds, [`${ids[2]}-0`], "確定空勾選只清本站");
});

test("讀取期間不能確定；不變的索引保留草稿，相片版本更新撤銷未確定選取", async () => {
  const { app, data } = await setup([photo(0), photo(1)]);
  await app.click("memory-album", ids[1]); select(app, `${ids[1]}-0`); await app.click("memory-selection-confirm");
  await app.click("memory-album", ids[1]); select(app, `${ids[1]}-1`);
  let release; app.photoService.getAllPhotoRecords = () => new Promise(resolve => { release = () => resolve([...data.values()]); });
  const reading = app.controller.start();
  await app.click("memory-selection-confirm"); assert.equal(app.controller.getPageSnapshot().selectedCount, 1);
  release(); await reading; assert.equal(overlay(app).selectedCount, 2);
  app.photoService.getAllPhotoRecords = async () => [...data.values()];
  data.set(`${ids[1]}-1`, { ...data.get(`${ids[1]}-1`), writeId: "replacement" });
  await app.controller.start();
  assert.equal(overlay(app).selectionChanged, false); assert.equal(overlay(app).selectedCount, 1);
  await app.click("memory-selection-confirm");
  assert.deepEqual(app.controller.getPageSnapshot().selectedPhotoIds, [`${ids[1]}-0`]);
});

test("離頁、相片失效及讀取失敗不容許舊確認套用；重開相簿不恢復已取消草稿", async () => {
  const { app, data } = await setup([photo(0)]);
  await app.click("memory-album", ids[1]); select(app, `${ids[1]}-0`);
  await app.click("memory-selection-confirm", undefined, { detached: true }); assert.equal(app.controller.getPageSnapshot().selectedCount, 0);
  app.navigate("#home"); app.navigate("#memories"); await app.click("memory-selection-confirm");
  await app.click("memory-album", ids[1]); assert.equal(overlay(app).selectedCount, 0);
  select(app, `${ids[1]}-0`); data.clear(); await app.controller.start(); await app.click("memory-selection-confirm");
  assert.equal(overlay(app), null); assert.equal(app.controller.getPageSnapshot().selectedCount, 0);
  data.set(`${ids[1]}-0`, photo(0)); await app.controller.start(); await app.click("memory-album", ids[1]); select(app, `${ids[1]}-0`);
  app.photoService.getAllPhotoRecords = async () => { throw Error("read failure"); }; await app.controller.start();
  await app.click("memory-selection-confirm"); assert.equal(overlay(app), null); assert.equal(app.controller.getPageSnapshot().selectedCount, 0);
});

for (const count of [0, 1, 12, 13, 120]) test(`${count} 張：主頁只建立封面，分頁最多十二張，由新至舊且預覽網址有限`, async () => {
  const records = Array.from({ length: count }, (_, index) => photo(index));
  const { app, live, revoked } = await setup(records);
  const model = app.controller.getPageSnapshot();
  assert.equal(model.photoCount, count);
  assert.equal(model.albums.length, count ? 1 : 0);
  assert.equal(model.memoryOverlay, null);
  assert.equal(live.size, count ? 1 : 0);
  assert.doesNotMatch(app.element("#app").innerHTML, /data-photo-select=|textarea|data-summary-field|data-card-download/);
  assert.match(app.element("#app").innerHTML, /data-section-view="memories" data-section-id="checkins"/);
  if (!count) { app.navigate("#memories/checkins"); assert.match(app.element("#app").innerHTML, /data-memory-checkin-card-open/); return; }
  assert.equal(model.albums[0].cover.photoId, records.at(-1).photoId);
  await app.click("memory-album", ids[1]);
  assert.equal(app.element("#memory-dialog").open, false);
  assert.doesNotMatch(app.element("#app").innerHTML, /id="memory-dialog"|id="memory-content"/);
  assert.match(app.element("#app").innerHTML, /id="memory-inline" class="memory-inline" aria-labelledby="memory-title"/);
  assert.match(app.element("#app").innerHTML, /aria-expanded="true" aria-controls="memory-inline"/);
  assert.doesNotMatch(app.element("#app").innerHTML, /id="memory-download-all"/);
  assert.equal(overlay(app).photos.length, Math.min(12, count));
  assert.equal(overlay(app).photos[0].photoId, records.at(-1).photoId);
  assert.ok(overlay(app).photos.every(item => !item.blob && !item.writeId));
  assert.equal(overlay(app).pageCount, Math.ceil(count / 12));
  if (count > 12) {
    const firstPageUrl = overlay(app).photos[1].url;
    await app.click("memory-page", "1");
    assert.equal(overlay(app).photos[0].photoId, records[count - 13].photoId);
    assert.equal(overlay(app).photos.length, Math.min(12, count - 12));
    assert.ok(revoked.includes(firstPageUrl));
    assert.ok(live.size <= 13);
  }
  await app.click("memory-close");
  assert.equal(live.size, 1);
  app.navigate("#home"); assert.equal(live.size, 0);
});

test("頁內相簿可再次收起及直接換站，取消未確定勾選，保留他站已確定選取", async () => {
  const { app } = await setup([photo(0), photo(1), photo(0, ids[2])]);
  await app.click("memory-album", ids[2]); select(app, `${ids[2]}-0`); await app.click("memory-selection-confirm");
  await app.click("memory-album", ids[1]); select(app, `${ids[1]}-0`);
  await app.click("memory-album", ids[2]);
  assert.equal(overlay(app).attraction.id, ids[2]); assert.equal(overlay(app).selectionChanged, false);
  assert.deepEqual(app.controller.getPageSnapshot().selectedPhotoIds, [`${ids[2]}-0`]);
  await app.click("memory-album", ids[1]); assert.equal(overlay(app).albumSelectedCount, 0);
  await app.click("memory-photo", `${ids[1]}-1`);
  assert.match(app.element("#app").innerHTML, /data-memory-back>返回相簿/);
  assert.equal(app.element("#memory-dialog").open, false);
  await app.click("memory-album", ids[1]); assert.equal(overlay(app), null);
  assert.match(app.element("#app").innerHTML, /id="memory-inline" class="memory-inline" hidden/);
  assert.match(app.element("#app").innerHTML, /id="memory-download-all"/);
});

test("120 張分散六站只顯示六個封面；跨頁跨景點選取，全選／清除相簿不影響他站", async () => {
  const records = ids.flatMap(id => Array.from({ length: 20 }, (_, index) => photo(index, id)));
  const { app, live } = await setup(records);
  assert.equal(app.controller.getPageSnapshot().albums.length, 6);
  assert.equal(live.size, 6);
  await app.click("memory-album", ids[1]);
  select(app, `${ids[1]}-19`); await app.click("memory-page", "1"); select(app, `${ids[1]}-0`);
  select(app, `${ids[2]}-0`); assert.equal(overlay(app).selectedCount, 2, "拒絕他站控制項");
  assert.equal(app.controller.getPageSnapshot().selectedCount, 0, "未確定勾選不加入主頁");
  await app.click("memory-selection-confirm"); await app.click("memory-album", ids[2]); select(app, `${ids[2]}-19`);
  await app.click("memory-album-select", "all"); assert.equal(overlay(app).selectedCount, 22);
  assert.equal(app.controller.getPageSnapshot().selectedCount, 2);
  await app.click("memory-album-select", "none"); assert.deepEqual(app.controller.getPageSnapshot().selectedPhotoIds.toSorted(), [`${ids[1]}-0`, `${ids[1]}-19`]);
  await app.click("memory-close"); await app.click("memory-album", ids[1]);
  assert.equal(overlay(app).photos[0].selected, true);
  await app.click("memory-page", "1"); assert.equal(overlay(app).photos.at(-1).selected, true);
});

test("解碼失敗無部分下載，重新準備可重試；關閉匯出使晚回覆失效", async () => {
  const { app, downloads } = await setup([photo(0), photo(1)]);
  const convert = app.photoService.createPhotoExport;
  app.photoService.createPhotoExport = async () => { throw Error("decode failed"); };
  await app.click("memory-download-all"); await app.click("photo-export-prepare");
  assert.match(app.element("#photo-export-content").innerHTML, /data-export-retry/);
  app.photoService.createPhotoExport = convert; await app.click("export-retry");
  assert.equal(app.element("#photo-export-content").dataset.status, "ready");
  await app.click("photo-export-close");
  let release; app.photoService.createPhotoExport = (record, name) => new Promise(resolve => { release = () => resolve(new File([record.blob], name)); });
  await app.click("memory-download-all"); const preparing = app.click("photo-export-prepare"); await app.click("photo-export-close");
  release(); await preparing; assert.equal(app.element("#photo-export-dialog").open, false); assert.deepEqual(downloads, []);
});
