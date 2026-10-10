import test from "node:test";
import assert from "node:assert/strict";
import { appHarness, checkedState } from "./helpers/browser-environment.js";
import { CHECK_IN_LOCATIONS, REQUIRED_CHECK_IN_LOCATIONS, TRIP_DATA } from "../src/data.js";
import { createTripAIKit } from "../src/photos.js";
import { jpegHeader } from "./helpers/image-fixtures.js";

const ids = CHECK_IN_LOCATIONS.map(item => item.id);
const requiredIds = REQUIRED_CHECK_IN_LOCATIONS.map(item => item.id);
const photo = (id, suffix = "a") => ({ attractionId: id, photoId: `${id}-${suffix}`, writeId: `${id}-${suffix}`,
  width: 1200, height: 900, createdAt: "2026-11-05T04:00:00.000Z", blob: new Blob([jpegHeader(1200, 900)], { type: "image/jpeg" }) });
function setup(records = ids.map(id => photo(id)), checkIns = ids) {
  const app = appHarness({ hash: "#memories", initialState: checkedState(checkIns) });
  const data = new Map(records.map(record => [record.photoId, record]));
  const generated = [], downloads = [];
  app.photoService.getAllPhotoRecords = async () => [...data.values()];
  app.photoService.deletePhotoRecord = async id => { for (const [key, record] of data) if (record.attractionId === id) data.delete(key); };
  app.photoService.clearPhotoRecords = async () => data.clear();
  app.photoService.createTripAIKit = async options => { generated.push(options); return new Blob(["card"], { type: "image/png" }); };
  app.element("a").click = function () { downloads.push(this.download); };
  app.confirmation.handler = async () => true;
  return { app, data, generated, downloads };
}
const model = app => app.controller.getPageSnapshot().summaryCard;
function select(app, id, photoId = `${id}-a`, { detached = false } = {}) {
  if (!app.controller.getPageSnapshot().memoryOverlay) void app.click("memory-summary-open");
  void app.click("memory-pick", id);
  app.events.get("document:change")({ target: { dataset: { summarySelect: id, summaryPhotoId: photoId }, checked: true,
    isConnected: !detached, matches: query => query === "[data-summary-select]" } });
  if (app.controller.getPageSnapshot().memoryOverlay?.mode === "picker") void app.click("memory-back");
}
const selectAll = app => { ids.forEach(id => select(app, id)); };
function omitSchool(app, id = ids[0], { detached = false } = {}) {
  void app.click("memory-summary-omit", id, { detached });
}

test("尚未完成五個必需景點不提供合成卡，學校不能代替必需景點", async () => {
  const { app } = setup([], ids.slice(0, -1)); await app.controller.start();
  assert.equal(model(app), null);
  app.navigate("#itinerary"); assert.doesNotMatch(app.element("#app").innerHTML, /如要準備 AI 融合圖片作品/);
  const complete = setup([]).app; await complete.controller.start(); complete.navigate("#itinerary");
  assert.match(complete.element("#app").innerHTML, /已完成所有打卡行程/);
  assert.match(complete.element("#app").innerHTML, /如要準備 AI 融合圖片作品，請按底部的「旅途回憶」。/);
  assert.doesNotMatch(complete.element("#app").innerHTML, /href="#memories"/);
  assert.match(complete.element("#app").innerHTML, /缺相片時須先補拍/);
  for (const place of CHECK_IN_LOCATIONS) {
    complete.navigate(`#attraction/${place.id}`);
    const html = complete.element("#app").innerHTML;
    assert.doesNotMatch(html, /href="#memories"|查看旅途回憶/);
    assert.match(html, /查看及下載相片，請按底部的「旅途回憶」。/);
    assert.match(html, new RegExp(`data-native-camera-open="${place.id}"`));
    assert.match(html, new RegExp(`data-camera-open="${place.id}"`));
  }
});

test("五個景點打卡但零相片仍顯示製作區，只列五個必需補拍入口", async () => {
  const { app, generated } = setup([], requiredIds); await app.controller.start();
  const card = model(app), html = app.element("#app").innerHTML;
  assert.equal(card.stations.length, 6); assert.equal(card.photoStationCount, 0); assert.equal(card.selectedCount, 0); assert.equal(card.canDownload, false);
  assert.match(html, /仍欠 5 個景點的相片/);
  assert.match(html, /每個必需景點須有一張相片，請先補拍，才能準備完整/);
  assert.match(html, /已有相片的景點：0／5/); assert.match(html, /已選取：0／5/);
  for (const id of requiredIds) assert.match(html, new RegExp(`href="#attraction/${id}">返回景點補拍`));
  assert.doesNotMatch(html, /佛教黃鳳翎中學：尚未拍照/);
  await app.click("memory-summary-open");
  assert.match(app.element("#memory-content").innerHTML, /前往學校打卡拍照（選填）/);
  assert.match(app.element("#memory-content").innerHTML, /data-summary-download[^>]*disabled/);
  await app.click("summary-download"); assert.equal(generated.length, 0);
});

test("部分缺相片與有相片未選取顯示不同原因，普通匯出仍可用", async () => {
  const { app } = setup([photo(ids[0]), photo(ids[1])]); await app.controller.start();
  const html = app.element("#app").innerHTML;
  assert.equal(model(app).photoStationCount, 1); assert.equal(model(app).selectedCount, 0);
  assert.match(html, /仍欠 4 個景點的相片/);
  await app.click("memory-summary-open");
  assert.match(app.element("#memory-content").innerHTML, /東莞松山湖未來學校：請選取一張相片/);
  assert.doesNotMatch(html, /佛教黃鳳翎中學：請選取一張相片/);
  assert.match(app.element("#memory-content").innerHTML, /孫中山故居紀念館：尚未拍照，請先補拍/);
  assert.match(html, /data-photo-export-selected/);
});

test("學校未打卡、沒有相片也可用五景點相片製卡，仍保留學校操作入口", async () => {
  const { app, generated, downloads } = setup(requiredIds.map(id => photo(id)), requiredIds);
  await app.controller.start();
  assert.equal(model(app).canDownload, false);
  assert.equal(model(app).photoStationCount, 5);
  assert.doesNotMatch(app.element("#app").innerHTML, /仍欠 .*個景點的相片/);
  await app.click("memory-summary-open");
  assert.match(app.element("#memory-content").innerHTML, /請選取一張/);
  requiredIds.forEach(id => select(app, id));
  assert.equal(model(app).requiredSelectedCount, 5); assert.equal(model(app).selectedCount, 5);
  assert.equal(model(app).canDownload, true);
  app.confirmation.handler = async options => { assert.match(options.message, /包含 5 張相片/); return options.isRelevant(); };
  await app.click("summary-download");
  assert.deepEqual(generated[0].stations.map(item => item.attraction.id), requiredIds);
  assert.deepEqual(downloads, ["AI融合圖片素材包-5張.zip"]);
  assert.equal(app.savedState().checkIns[ids[0]], undefined);
});

test("學校已有相片也不自動加入；選填第六張可撤回而不取消五站選取", async () => {
  const { app, generated } = setup(); await app.controller.start();
  requiredIds.forEach(id => select(app, id));
  assert.equal(model(app).selectedCount, 5); assert.equal(model(app).canDownload, true);
  select(app, ids[0]); assert.equal(model(app).selectedCount, 6);
  omitSchool(app, ids[0], { detached: true }); omitSchool(app, ids[1]);
  assert.equal(model(app).selectedCount, 6, "不能用分離控制項或必需景點取消選取");
  await app.click("summary-download"); assert.deepEqual(generated[0].stations.map(item => item.attraction.id), ids);
  omitSchool(app); assert.equal(model(app).selectedCount, 5);
  assert.equal(model(app).requiredSelectedCount, 5); assert.equal(model(app).canDownload, true);
  assert.doesNotMatch(app.element("#memory-content").innerHTML, /data-memory-summary-omit/);
  await app.click("summary-download"); assert.deepEqual(generated[1].stations.map(item => item.attraction.id), requiredIds);
  assert.equal(app.savedState().checkIns[ids[0]].attractionId, ids[0], "撤回卡片相片不取消打卡");
});

test("沒有學校打卡的孤立舊照片不能被加入合成卡", async () => {
  const { app, generated } = setup(ids.map(id => photo(id)), requiredIds); await app.controller.start();
  assert.equal(model(app).stations[0].photoCount, 0);
  selectAll(app); assert.equal(model(app).selectedCount, 5);
  await app.click("summary-download"); assert.deepEqual(generated[0].stations.map(item => item.attraction.id), requiredIds);
});

test("五張卡生成時學校相片更新不會使五個已選景點失效", async () => {
  const { app, data, downloads } = setup(); await app.controller.start();
  requiredIds.forEach(id => select(app, id));
  let release;
  app.photoService.createTripAIKit = () => new Promise(resolve => { release = () => resolve(new Blob(["five"])); });
  const downloading = app.click("summary-download"); await Promise.resolve(); await Promise.resolve();
  data.set(`${ids[0]}-a`, { ...data.get(`${ids[0]}-a`), writeId: "optional-replacement" });
  await app.controller.start(); release(); await downloading;
  assert.deepEqual(downloads, ["AI融合圖片素材包-5張.zip"]);
});

test("已加入的學校相片失效時停止舊六張卡，仍可改用五張重新製作", async () => {
  const { app, data, downloads } = setup(); await app.controller.start(); selectAll(app);
  let release;
  app.photoService.createTripAIKit = () => new Promise(resolve => { release = () => resolve(new Blob(["six"])); });
  const downloading = app.click("summary-download"); await Promise.resolve(); await Promise.resolve();
  data.delete(`${ids[0]}-a`); await app.controller.start(); release(); await downloading;
  assert.deepEqual(downloads, []); assert.equal(model(app).selectedCount, 5); assert.equal(model(app).canDownload, true);
  app.photoService.createTripAIKit = async options => {
    assert.deepEqual(options.stations.map(item => item.attraction.id), requiredIds);
    return new Blob(["five"], { type: "image/png" });
  };
  await app.click("summary-download"); assert.deepEqual(downloads, ["AI融合圖片素材包-5張.zip"]);
});

test("每站只能選一張，不接受他站、未知、過期控制項；与普通匯出分開", async () => {
  const { app } = setup([...ids.map(id => photo(id)), photo(ids[0], "b")]); await app.controller.start();
  selectAll(app); select(app, ids[0], `${ids[0]}-b`);
  assert.equal(model(app).selectedCount, 6); assert.equal(model(app).stations[0].selectedPhotoId, `${ids[0]}-b`);
  assert.ok(app.controller.getPageSnapshot().selectedCount === 0);
  select(app, ids[0], `${ids[1]}-a`); select(app, "unknown", `${ids[1]}-a`); select(app, ids[0], `${ids[0]}-a`, { detached: true });
  assert.equal(model(app).stations[0].selectedPhotoId, `${ids[0]}-b`);
  assert.equal(model(app).canDownload, true);
  assert.doesNotMatch(app.element("#app").innerHTML, /仍欠 .*個景點的相片/);
  const snapshot = model(app);
  assert.ok(Object.isFrozen(snapshot.stations[0].selectedPhoto));
  assert.ok(snapshot.stations.every(item => !item.selectedPhoto.blob && !item.selectedPhoto.writeId));
});

test("相片讀取中及失敗不顯示虛假的缺照數量，重試恢復", async () => {
  const { app } = setup(); let release;
  const load = app.photoService.getAllPhotoRecords;
  app.photoService.getAllPhotoRecords = () => new Promise(resolve => { release = resolve; });
  const starting = app.controller.start();
  assert.equal(model(app).readState, "loading"); assert.equal(model(app).photoStationCount, null);
  assert.match(app.element("#app").innerHTML, /正在讀取相片/);
  assert.doesNotMatch(app.element("#app").innerHTML, /仍欠|尚未拍照|已有相片的景點：0/);
  release(await load()); await starting;
  app.photoService.getAllPhotoRecords = async () => { throw Error("IDB unavailable"); };
  await app.controller.start();
  assert.equal(model(app).readState, "error"); assert.equal(model(app).selectedCount, null);
  assert.match(app.element("#app").innerHTML, /無法確認哪些景點需要補拍/);
  assert.doesNotMatch(app.element("#app").innerHTML, /仍欠|尚未拍照/);
  app.photoService.getAllPhotoRecords = load; await app.click("photos-retry");
  assert.equal(model(app).photoStationCount, 5);
});


test("素材包沒有身份欄位，選取不寫入儲存，離頁清除", async () => {
  const { app } = setup(); await app.controller.start(); const before=app.savedState(); selectAll(app);
  assert.doesNotMatch(app.element("#memory-content").innerHTML,/data-summary-field/);
  assert.ok(!("studentName" in model(app))); assert.deepEqual(app.savedState(), before);
  app.navigate("#home"); app.navigate("#memories"); assert.equal(model(app).selectedCount,0);
});
test("五景點打卡但原照讀取失敗，仍可開啟成品署名", async () => {
  const { app } = setup([], requiredIds); app.photoService.getAllPhotoRecords=async()=>{throw Error("read failure")}; await app.controller.start();
  await app.click("memory-artwork-open"); assert.ok(app.element("#ai-artwork-dialog").open);
  assert.match(app.element("#ai-artwork-dialog").innerHTML,/含未核實手動記錄/);
});
test("取消素材包確認保留選取，六站 ZIP 不接收身份", async () => {
  const { app, generated, downloads }=setup(); await app.controller.start(); selectAll(app);
  app.confirmation.handler=async options=>{assert.match(options.message,/不含身份資料/);return false};
  await app.click("summary-download"); assert.equal(generated.length,0); assert.equal(model(app).selectedCount,6);
  app.confirmation.handler=async options=>options.isRelevant(); await app.click("summary-download");
  assert.deepEqual(generated[0].stations.map(item=>item.attraction.id),ids); assert.ok(!("studentName" in generated[0]));
  assert.deepEqual(downloads,["AI融合圖片素材包-6張.zip"]);
});
test("選齊五景點即可以下載，不需要姓名班別學號", async () => {
  const { app, generated }=setup(); await app.controller.start(); requiredIds.forEach(id=>select(app,id));
  assert.equal(model(app).canDownload,true); await app.click("summary-download"); assert.equal(generated.length,1);
  for(const field of ["studentName","className","studentNumber"]) assert.ok(!(field in generated[0]));
});
test("資料更新移除被替換相片的選取，仍保存其他站選取", async () => {
  const { app, data } = setup(); await app.controller.start(); selectAll(app);
  const record = data.get(`${ids[2]}-a`); data.set(record.photoId, { ...record, writeId: "replaced" });
  await app.controller.start(); assert.equal(model(app).selectedCount, 5); assert.equal(model(app).stations[2].selectedPhotoId, null);
  assert.match(app.element("#memory-content").innerHTML, /孫中山故居紀念館：請選取一張相片/);
});

for (const phase of ["confirm", "generate"]) for (const action of ["leave", "replace", "remove", "undo", "reset"]) {
  test(`六站卡${phase}期間 ${action} 不下載過期結果`, async () => {
    const { app, data, downloads } = setup(); await app.controller.start(); selectAll(app);
    let release;
    if (phase === "confirm") app.confirmation.handler = () => new Promise(resolve => { release = () => resolve(true); });
    else app.photoService.createTripAIKit = () => new Promise(resolve => { release = () => resolve(new Blob(["old"])); });
    const downloading = app.click("summary-download");
    if (phase === "generate") { await Promise.resolve(); await Promise.resolve(); }
    assert.ok(release);
    if (action === "leave") app.navigate("#itinerary");
    else if (action === "undo" || action === "reset") {
      app.confirmation.handler = async options => options.isRelevant();
      if (action === "undo") { app.navigate(`#attraction/${ids[0]}`); await app.click("checkin-undo", ids[0]); }
      else { app.navigate("#home"); await app.click("reset-all"); }
    } else {
      if (action === "replace") data.set(`${ids[1]}-a`, { ...data.get(`${ids[1]}-a`), writeId: "replacement" });
      else data.delete(`${ids[1]}-a`);
      await app.controller.start();
    }
    release(); await downloading; assert.deepEqual(downloads, []);
  });
}

test("離頁後可重新製卡，舊生成完成不能影響新工作；失敗也不下載", async () => {
  const { app, downloads } = setup(); await app.controller.start(); selectAll(app);
  let release;
  app.photoService.createTripAIKit = () => new Promise(resolve => { release = () => resolve(new Blob(["old"])); });
  const old = app.click("summary-download"); await Promise.resolve(); await Promise.resolve();
  app.navigate("#itinerary"); app.navigate("#memories"); selectAll(app);
  app.photoService.createTripAIKit = async () => new Blob(["new"]);
  await app.click("summary-download"); release(); await old;
  assert.deepEqual(downloads, ["AI融合圖片素材包-6張.zip"]);
  app.photoService.createTripAIKit = async () => { throw Error("decode failed"); };
  await app.click("summary-download"); assert.equal(downloads.length, 1); assert.equal(model(app).busy, false);
});
