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

for (const count of [0, 1, 12, 13, 120]) test(`${count} 張：主頁只建立封面，分頁最多十二張，由新至舊且預覽網址有限`, async () => {
  const records = Array.from({ length: count }, (_, index) => photo(index));
  const { app, live, revoked } = await setup(records);
  const model = app.controller.getPageSnapshot();
  assert.equal(model.photoCount, count);
  assert.equal(model.albums.length, count ? 1 : 0);
  assert.equal(model.memoryOverlay, null);
  assert.equal(live.size, count ? 1 : 0);
  assert.doesNotMatch(app.element("#app").innerHTML, /data-photo-select=|textarea|data-summary-field|data-card-download/);
  assert.match(app.element("#app").innerHTML, /準備 AI 融合圖片作品/);
  if (!count) { assert.match(app.element("#app").innerHTML, /仍欠 5 個景點/); return; }
  assert.equal(model.albums[0].cover.photoId, records.at(-1).photoId);
  await app.click("memory-album", ids[1]);
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

test("120 張分散六站只顯示六個封面；跨頁跨景點選取，全選／清除相簿不影響他站", async () => {
  const records = ids.flatMap(id => Array.from({ length: 20 }, (_, index) => photo(index, id)));
  const { app, live } = await setup(records);
  assert.equal(app.controller.getPageSnapshot().albums.length, 6);
  assert.equal(live.size, 6);
  await app.click("memory-album", ids[1]);
  select(app, `${ids[1]}-19`); await app.click("memory-page", "1"); select(app, `${ids[1]}-0`);
  select(app, `${ids[2]}-0`); assert.equal(app.controller.getPageSnapshot().selectedCount, 2, "拒絕他站控制項");
  await app.click("memory-close"); await app.click("memory-album", ids[2]); select(app, `${ids[2]}-19`);
  await app.click("memory-album-select", "all"); assert.equal(app.controller.getPageSnapshot().selectedCount, 22);
  await app.click("memory-album-select", "none"); assert.deepEqual(app.controller.getPageSnapshot().selectedPhotoIds.toSorted(), [`${ids[1]}-0`, `${ids[1]}-19`]);
  await app.click("memory-close"); await app.click("memory-album", ids[1]);
  assert.equal(overlay(app).photos[0].selected, true);
  await app.click("memory-page", "1"); assert.equal(overlay(app).photos.at(-1).selected, true);
});

test("大圖切換及返回不影響勾選，Escape 一層一層返回；關閉保留感想草稿，離頁清除", async () => {
  const { app } = await setup([photo(0), photo(1)]);
  await app.click("memory-album", ids[1]); select(app, `${ids[1]}-0`);
  await app.click("memory-photo", `${ids[1]}-1`);
  assert.equal(overlay(app).mode, "photo"); assert.equal(overlay(app).cardOpen, false);
  assert.doesNotMatch(app.element("#memory-content").innerHTML, /textarea/);
  await app.click("memory-card-toggle");
  const field = { dataset: { cardReflection: `${ids[1]}-1` }, value: "合成感想", isConnected: true,
    matches: selector => selector === "[data-card-reflection]", getAttribute: () => "hint" };
  app.events.get("document:input")({ target: field });
  await app.click("memory-photo-step", "next"); assert.equal(overlay(app).photo.photoId, `${ids[1]}-0`);
  await app.click("memory-photo-step", "previous"); await app.click("memory-card-toggle");
  assert.equal(overlay(app).photo.reflection, "合成感想");
  app.element("#memory-dialog").requestClose(); assert.equal(overlay(app).mode, "album");
  app.element("#memory-dialog").requestClose(); assert.equal(overlay(app), null);
  await app.click("memory-album", ids[1]); await app.click("memory-photo", `${ids[1]}-1`); await app.click("memory-card-toggle");
  assert.equal(overlay(app).photo.reflection, "合成感想");
  app.navigate("#home"); app.navigate("#memories");
  assert.equal(app.controller.getPageSnapshot().albums[0].cover.reflection, "");
});

test("全部、相簿、單張及已選下載各用正確照片，匯出暫時收起回憶視窗，更多選項每頁十二項", async () => {
  const records = [...Array.from({ length: 13 }, (_, index) => photo(index)), photo(0, ids[2])];
  const { app, converted, downloads } = await setup(records);
  await app.click("memory-download-all");
  assert.equal(converted.length, 14); assert.equal(app.controller.getPageSnapshot().selectedCount, 0);
  assert.match(app.element("#photo-export-content").innerHTML, /下載 ZIP（14 張）|解壓/);
  assert.doesNotMatch(app.element("#photo-export-content").innerHTML, /data-photo-export-download=/);
  await app.click("export-more"); assert.equal((app.element("#photo-export-content").innerHTML.match(/data-photo-export-download=/g) || []).length, 12);
  await app.click("export-page", "1"); assert.equal((app.element("#photo-export-content").innerHTML.match(/data-photo-export-download=/g) || []).length, 2);
  await app.click("photo-export-download-all"); assert.deepEqual(downloads, ["旅途回憶-相片-14張.zip"]);
  assert.match(app.element("#photo-export-content").innerHTML, /下載檔案的位置/);
  await app.click("photo-export-close"); converted.length = 0;
  await app.click("memory-album", ids[1]); await app.click("memory-download-album");
  assert.equal(app.element("#memory-dialog").open, false); assert.equal(converted.length, 13);
  await app.click("photo-export-close"); assert.equal(overlay(app).mode, "album");
  await app.click("memory-photo", `${ids[1]}-12`); converted.length = 0; await app.click("memory-download-photo");
  assert.deepEqual(converted, [`${ids[1]}-12`]); assert.match(app.element("#photo-export-content").innerHTML, /下載 JPEG/);
  await app.click("photo-export-close"); assert.equal(overlay(app).photo.photoId, `${ids[1]}-12`);
});

test("解碼失敗無部分下載，重新準備可重試；關閉匯出使晚回覆失效", async () => {
  const { app, downloads } = await setup([photo(0), photo(1)]);
  const convert = app.photoService.createPhotoExport;
  app.photoService.createPhotoExport = async () => { throw Error("decode failed"); };
  await app.click("memory-download-all");
  assert.match(app.element("#photo-export-content").innerHTML, /data-export-retry/);
  app.photoService.createPhotoExport = convert; await app.click("export-retry");
  assert.equal(app.element("#photo-export-content").dataset.status, "ready");
  await app.click("photo-export-close");
  let release; app.photoService.createPhotoExport = (record, name) => new Promise(resolve => { release = () => resolve(new File([record.blob], name)); });
  const preparing = app.click("memory-download-all"); await app.click("photo-export-close");
  release(); await preparing; assert.equal(app.element("#photo-export-dialog").open, false); assert.deepEqual(downloads, []);
});

test("合成卡選圖也分頁，只提供六個位置；关閉保留選圖及姓名班別，離頁清除", async () => {
  const records = [...ids.map(id => photo(0, id)), ...Array.from({ length: 13 }, (_, index) => photo(index + 1))];
  const { app } = await setup(records);
  await app.click("memory-summary-open"); assert.equal(overlay(app).mode, "summary");
  assert.equal((app.element("#memory-content").innerHTML.match(/class="summary-slot"/g) || []).length, 6);
  assert.doesNotMatch(app.element("#memory-content").innerHTML, /data-summary-select/);
  await app.click("memory-pick", ids[1]); assert.equal(overlay(app).photos.length, 12);
  await app.click("memory-page", "1");
  app.events.get("document:change")({ target: { dataset: { summarySelect: ids[1], summaryPhotoId: `${ids[1]}-0` }, checked: true, isConnected: true,
    matches: selector => selector === "[data-summary-select]" } });
  assert.equal(overlay(app).mode, "summary"); assert.equal(overlay(app).summaryCard.requiredSelectedCount, 1);
  assert.equal(app.controller.getPageSnapshot().selectedCount, 0);
  app.events.get("document:input")({ target: { dataset: { summaryField: "studentName" }, value: "虛構同學", isConnected: true,
    matches: selector => selector === "[data-summary-field]" } });
  await app.click("memory-close"); await app.click("memory-summary-open");
  assert.equal(overlay(app).summaryCard.studentName, "虛構同學"); assert.equal(overlay(app).summaryCard.requiredSelectedCount, 1);
  assert.ok(!JSON.stringify(app.savedState()).includes("虛構同學"));
  app.navigate("#home"); app.navigate("#memories"); assert.equal(app.controller.getPageSnapshot().summaryCard.studentName, "");
});

for (const action of ["close", "switch", "replace"]) test(`單張卡生成期間 ${action} 不輸出過期結果`, async () => {
  const { app, data, downloads } = await setup([photo(0), photo(1)]);
  await app.click("memory-album", ids[1]); await app.click("memory-photo", `${ids[1]}-1`); await app.click("memory-card-toggle");
  let release; app.photoService.createTravelCard = () => new Promise(resolve => { release = () => resolve(new Blob(["old card"])); });
  const downloading = app.click("card-download", ids[1], { dataset: { photoId: `${ids[1]}-1` } });
  await new Promise(setImmediate); assert.ok(release);
  if (action === "close") await app.click("memory-close");
  if (action === "switch") await app.click("memory-photo-step", "next");
  if (action === "replace") { data.set(`${ids[1]}-1`, { ...data.get(`${ids[1]}-1`), writeId: "new write" }); await app.controller.start(); }
  release(); await downloading; assert.deepEqual(downloads, []);
});

test("關閉合成卡後可保留草稿開新工作，舊完成不能下載或解除新工作的忙碌狀態", async () => {
  const { app, downloads } = await setup(ids.map(id => photo(0, id)));
  await app.click("memory-summary-open");
  for (const id of ids.slice(1)) {
    await app.click("memory-pick", id);
    app.events.get("document:change")({ target: { dataset: { summarySelect: id, summaryPhotoId: `${id}-0` }, checked: true,
      isConnected: true, matches: selector => selector === "[data-summary-select]" } });
  }
  for (const [field, value] of Object.entries({ studentName: "虛構同學", className: "測試班", studentNumber: "07" })) {
    app.events.get("document:input")({ target: { dataset: { summaryField: field }, value, isConnected: true,
      matches: selector => selector === "[data-summary-field]" } });
  }
  let releaseOld, releaseNew;
  app.photoService.createTripAIKit = () => new Promise(resolve => { releaseOld = () => resolve(new Blob(["old"])); });
  const old = app.click("summary-download"); await new Promise(setImmediate);
  await app.click("memory-close"); await app.click("memory-summary-open");
  assert.equal(overlay(app).summaryCard.requiredSelectedCount, 5);
  app.photoService.createTripAIKit = () => new Promise(resolve => { releaseNew = () => resolve(new Blob(["new"])); });
  const fresh = app.click("summary-download"); await new Promise(setImmediate);
  releaseOld(); await old; assert.equal(overlay(app).summaryCard.busy, true); assert.deepEqual(downloads, []);
  releaseNew(); await fresh; assert.equal(overlay(app).summaryCard.busy, false); assert.deepEqual(downloads, ["AI融合圖片素材包-5張.zip"]);
});
