import test from "node:test";
import assert from "node:assert/strict";
import { appHarness, checkedState } from "./helpers/browser-environment.js";
import { CHECK_IN_LOCATIONS, REQUIRED_CHECK_IN_LOCATIONS, TRIP_DATA } from "../src/data.js";
import { normalizeSummaryIdentity, limitSummaryField } from "../src/card-reflection.js";
import { createTripSummaryCard } from "../src/photos.js";
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
  app.photoService.createTripSummaryCard = async options => { generated.push(options); return new Blob(["card"], { type: "image/png" }); };
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
const selectAll = app => ids.forEach(id => select(app, id));
function omitSchool(app, id = ids[0], { detached = false } = {}) {
  void app.click("memory-summary-omit", id, { detached });
}
function input(app, field, value) {
  if (!app.controller.getPageSnapshot().memoryOverlay) void app.click("memory-summary-open");
  const target = { dataset: { summaryField: field }, value, isConnected: true, matches: query => query === "[data-summary-field]",
    selectionStart: value.length, selectionEnd: value.length, selectionDirection: "none", setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; } };
  app.events.get("document:input")({ target });
  return target;
}

test("尚未完成五個必需景點不提供合成卡，學校不能代替必需景點", async () => {
  const { app } = setup([], ids.slice(0, -1)); await app.controller.start();
  assert.equal(model(app), null);
  app.navigate("#itinerary"); assert.doesNotMatch(app.element("#app").innerHTML, /前往旅途回憶製作旅程合成卡/);
  const complete = setup([]).app; await complete.controller.start(); complete.navigate("#itinerary");
  assert.match(complete.element("#app").innerHTML, /已完成所有打卡行程/);
  assert.match(complete.element("#app").innerHTML, /前往旅途回憶製作旅程合成卡/);
  assert.match(complete.element("#app").innerHTML, /缺相片時須先補拍/);
});

test("五個景點打卡但零相片仍顯示製作區，只列五個必需補拍入口", async () => {
  const { app, generated } = setup([], requiredIds); await app.controller.start();
  const card = model(app), html = app.element("#app").innerHTML;
  assert.equal(card.stations.length, 6); assert.equal(card.photoStationCount, 0); assert.equal(card.selectedCount, 0); assert.equal(card.canDownload, false);
  assert.match(html, /仍欠 5 個景點的相片/);
  assert.match(html, /每個必需景點須有一張相片，請先補拍，才能製作完整/);
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
  assert.deepEqual(downloads, ["旅程合成卡.png"]);
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
  app.photoService.createTripSummaryCard = () => new Promise(resolve => { release = () => resolve(new Blob(["five"])); });
  const downloading = app.click("summary-download"); await Promise.resolve(); await Promise.resolve();
  data.set(`${ids[0]}-a`, { ...data.get(`${ids[0]}-a`), writeId: "optional-replacement" });
  await app.controller.start(); release(); await downloading;
  assert.deepEqual(downloads, ["旅程合成卡.png"]);
});

test("已加入的學校相片失效時停止舊六張卡，仍可改用五張重新製作", async () => {
  const { app, data, downloads } = setup(); await app.controller.start(); selectAll(app);
  let release;
  app.photoService.createTripSummaryCard = () => new Promise(resolve => { release = () => resolve(new Blob(["six"])); });
  const downloading = app.click("summary-download"); await Promise.resolve(); await Promise.resolve();
  data.delete(`${ids[0]}-a`); await app.controller.start(); release(); await downloading;
  assert.deepEqual(downloads, []); assert.equal(model(app).selectedCount, 5); assert.equal(model(app).canDownload, true);
  app.photoService.createTripSummaryCard = async options => {
    assert.deepEqual(options.stations.map(item => item.attraction.id), requiredIds);
    return new Blob(["five"], { type: "image/png" });
  };
  await app.click("summary-download"); assert.deepEqual(downloads, ["旅程合成卡.png"]);
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

test("姓名班別選填，清理控制字元，按字元限制且不拆 emoji", () => {
  assert.deepEqual(normalizeSummaryIdentity(), { studentName: "", className: "" });
  assert.deepEqual(normalizeSummaryIdentity({ studentName: " \n 測試\u0000   同學 ", className: " \t測試班\u202e " }), { studentName: "測試 同學", className: "測試班" });
  assert.equal(normalizeSummaryIdentity({ studentName: "🙂".repeat(40) }).studentName.length, 80);
  assert.throws(() => normalizeSummaryIdentity({ studentName: "學".repeat(41) }), /40 字/);
  assert.throws(() => normalizeSummaryIdentity({ className: "班".repeat(21) }), /20 字/);
  assert.equal(limitSummaryField("學".repeat(39) + "🙂多", "studentName"), "學".repeat(39) + "🙂");
  assert.equal(limitSummaryField("Test ", "studentName"), "Test ");
});

test("姓名欄文字安全跳脫，草稿不進入儲存；離頁及重載清除", async () => {
  const { app } = setup(); await app.controller.start(); const before = app.savedState();
  input(app, "studentName", '\"><img src=x>'); input(app, "className", "🙂".repeat(21)); selectAll(app); app.controller.render();
  assert.match(app.element("#memory-content").innerHTML, /&quot;&gt;&lt;img src=x&gt;/); assert.doesNotMatch(app.element("#memory-content").innerHTML, /<img src=x>/);
  assert.equal(Array.from(model(app).className).length, 20); assert.deepEqual(app.savedState(), before);
  app.navigate("#attraction/departure-school"); app.navigate("#memories");
  assert.equal(model(app).studentName, ""); assert.equal(model(app).selectedCount, 0);
  const reloaded = setup().app; await reloaded.controller.start(); assert.equal(model(reloaded).studentName, "");
});

test("中文組字不中斷，完成後限制字數並更新草稿", async () => {
  const { app } = setup(); await app.controller.start();
  const target = input(app, "studentName", ""); app.events.get("document:compositionstart")({ target });
  target.value = "學".repeat(39) + "🙂多";
  app.events.get("document:input")({ target, isComposing: true });
  app.element("#app").innerHTML = "組字中"; app.controller.render(); assert.equal(app.element("#app").innerHTML, "組字中");
  assert.equal(model(app).studentName, "");
  app.events.get("document:compositionend")({ target });
  assert.equal(model(app).studentName, "學".repeat(39) + "🙂"); assert.notEqual(app.element("#app").innerHTML, "組字中");
});

test("取消下載確認保留草稿與選取，成功用正確六站及不含個資的檔名", async () => {
  const { app, generated, downloads } = setup(); await app.controller.start(); selectAll(app);
  input(app, "studentName", "合成測試同學"); input(app, "className", "測試班");
  app.confirmation.handler = async options => { assert.match(options.message, /姓名、班別亦會印在圖片上/); return false; };
  await app.click("summary-download"); assert.equal(generated.length, 0); assert.equal(model(app).selectedCount, 6); assert.equal(model(app).studentName, "合成測試同學");
  app.confirmation.handler = async options => options.isRelevant(); await app.click("summary-download");
  assert.equal(generated.length, 1); assert.deepEqual(generated[0].stations.map(item => item.attraction.id), ids);
  assert.equal(generated[0].studentName, "合成測試同學"); assert.equal(generated[0].className, "測試班");
  assert.equal(generated[0].dateLabel, TRIP_DATA.dateLabel); assert.deepEqual(downloads, ["旅程合成卡.png"]);
  assert.equal(model(app).busy, false);
});

test("姓名班別留空仍可下載，不會自動加入個人資料", async () => {
  const { app, generated } = setup(); await app.controller.start(); selectAll(app);
  app.confirmation.handler = async options => { assert.match(options.message, /不加入姓名、班別/); return true; };
  await app.click("summary-download"); assert.equal(generated[0].studentName, ""); assert.equal(generated[0].className, "");
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
    else app.photoService.createTripSummaryCard = () => new Promise(resolve => { release = () => resolve(new Blob(["old"])); });
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
  app.photoService.createTripSummaryCard = () => new Promise(resolve => { release = () => resolve(new Blob(["old"])); });
  const old = app.click("summary-download"); await Promise.resolve(); await Promise.resolve();
  app.navigate("#itinerary"); app.navigate("#memories"); selectAll(app);
  app.photoService.createTripSummaryCard = async () => new Blob(["new"]);
  await app.click("summary-download"); release(); await old;
  assert.deepEqual(downloads, ["旅程合成卡.png"]);
  app.photoService.createTripSummaryCard = async () => { throw Error("decode failed"); };
  await app.click("summary-download"); assert.equal(downloads.length, 1); assert.equal(model(app).busy, false);
});

function stationInputs() {
  return CHECK_IN_LOCATIONS.map(attraction => ({ attraction, photoRecord: photo(attraction.id), checkIn: checkedState(ids).checkIns[attraction.id] }));
}
async function withCanvasFixture(action) {
  const previous = { document: globalThis.document, bitmap: globalThis.createImageBitmap };
  const texts = [], draws = [], sizes = [[1200, 900], [600, 1200], [900, 900], [1200, 600], [800, 1200], [1200, 900]];
  let decoded = 0, closed = 0, alive = 0, maxAlive = 0;
  const context = { beginPath() {}, moveTo() {}, arcTo() {}, closePath() {}, fill() {}, fillRect() {},
    measureText(text) { return { width: Array.from(text).length * Number.parseInt(this.font.match(/(\d+)px/)[1]) }; },
    fillText(text) { texts.push(text); }, drawImage(...args) { draws.push(args); } };
  const canvas = { getContext: () => context, toBlob(callback) { callback(new Blob(["PNG fixture"], { type: "image/png" })); } };
  globalThis.document = { createElement: () => canvas };
  globalThis.createImageBitmap = async () => {
    const [width, height] = sizes[decoded++]; alive++; maxAlive = Math.max(maxAlive, alive);
    return { width, height, close() { closed++; alive--; } };
  };
  try { await action({ texts, draws, canvas, context, counts: () => ({ decoded, closed, alive, maxAlive }) }); }
  finally { globalThis.document = previous.document; globalThis.createImageBitmap = previous.bitmap; }
}

test("Canvas 六張依序解碼並釋放，完整相片按比例置於兩欄三排", async () => withCanvasFixture(async fixture => {
  const blob = await createTripSummaryCard({ stations: stationInputs(), studentName: "名".repeat(40), className: "班".repeat(20), tripTitle: TRIP_DATA.title, dateLabel: TRIP_DATA.dateLabel });
  assert.equal(blob.type, "image/png"); assert.equal(fixture.canvas.width, 1080); assert.equal(fixture.canvas.height, 1350);
  assert.deepEqual(fixture.counts(), { decoded: 6, closed: 6, alive: 0, maxAlive: 1 });
  const sizes = [[1200, 900], [600, 1200], [900, 900], [1200, 600], [800, 1200], [1200, 900]];
  fixture.draws.forEach((args, index) => {
    assert.equal(args.length, 5, "使用完整影像，沒有來源裁切矩形");
    const [, x, y, width, height] = args, cellX = 60 + index % 2 * 504, cellY = 332 + Math.floor(index / 2) * 320;
    assert.ok(x >= cellX && y >= cellY && x + width <= cellX + 456 && y + height <= cellY + 200);
    assert.ok(Math.abs(width / height - sizes[index][0] / sizes[index][1]) < 0.00001);
  });
  const nameText = fixture.texts.filter(text => text.includes("名"));
  assert.equal(nameText.join(""), "姓名：" + "名".repeat(40));
  assert.ok(fixture.texts.includes("班別：" + "班".repeat(20)));
  assert.equal(fixture.texts.filter(text => text === "未核實手動記錄").length, 6);
}));

test("Canvas 五張依原五景點順序輸出，最後一格是寄語，無學校資料", async () => withCanvasFixture(async fixture => {
  const blob = await createTripSummaryCard({ stations: stationInputs().slice(1) });
  assert.equal(blob.type, "image/png"); assert.equal(fixture.canvas.width, 1080); assert.equal(fixture.canvas.height, 1350);
  assert.deepEqual(fixture.counts(), { decoded: 5, closed: 5, alive: 0, maxAlive: 1 });
  assert.ok(fixture.texts.includes("1. 東莞松山湖未來學校"));
  assert.ok(fixture.texts.includes("5. 留耕堂")); assert.ok(fixture.texts.includes("沿途的每一刻"));
  assert.ok(fixture.texts.includes("戶外學習日旅程助手 · 5 站回憶"));
  assert.ok(fixture.texts.every(text => !text.includes("佛教黃鳳翎中學")));
}));

test("五張卡不能用學校代替任一必需景點、調換順序或重複相片", async () => withCanvasFixture(async fixture => {
  await assert.rejects(() => createTripSummaryCard({ stations: stationInputs().slice(0, -1) }), /五個必需景點/);
  const swapped = stationInputs().slice(1); [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  await assert.rejects(() => createTripSummaryCard({ stations: swapped }), /五個必需景點/);
  const duplicate = stationInputs().slice(1); duplicate[1].photoRecord.photoId = duplicate[0].photoRecord.photoId;
  await assert.rejects(() => createTripSummaryCard({ stations: duplicate }), /五個必需景點/);
  assert.equal(fixture.counts().decoded, 0);
}));

test("Canvas 空欄不印姓名班別，失效立即停解碼，繪圖失敗也釋放影像", async () => withCanvasFixture(async fixture => {
  await createTripSummaryCard({ stations: stationInputs() });
  assert.ok(fixture.texts.every(text => !text.startsWith("姓名：") && !text.startsWith("班別：")));
  await assert.rejects(() => createTripSummaryCard({ stations: stationInputs(), isRelevant: () => false }), /失效/);
  assert.equal(fixture.counts().decoded, 6);
}));

test("Canvas 中途繪圖失敗不輸出，仍關閉已解碼影像", async () => withCanvasFixture(async fixture => {
  fixture.context.drawImage = () => { throw Error("draw failed"); };
  await assert.rejects(() => createTripSummaryCard({ stations: stationInputs() }), /draw failed/);
  assert.deepEqual(fixture.counts(), { decoded: 1, closed: 1, alive: 0, maxAlive: 1 });
}));

test("Canvas 拒絕重複站點及超大來源，解碼前沿用圖片預檢", async () => withCanvasFixture(async fixture => {
  const stations = stationInputs(); stations[1] = stations[0];
  await assert.rejects(() => createTripSummaryCard({ stations }), /五個必需景點/);
  const huge = stationInputs(); huge[0].photoRecord.blob = new Blob([jpegHeader(8193, 100)], { type: "image/jpeg" });
  await assert.rejects(() => createTripSummaryCard({ stations: huge }), /尺寸/);
  assert.equal(fixture.counts().decoded, 0);
}));
