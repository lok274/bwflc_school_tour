import test from "node:test";
import assert from "node:assert/strict";
import { appHarness, checkedState } from "./helpers/browser-environment.js";
import { parseRoute } from "../src/routes.js";
import { CHECK_IN_LOCATIONS, REQUIRED_CHECK_IN_LOCATIONS, TRIP_DATA } from "../src/data.js";

const ids = REQUIRED_CHECK_IN_LOCATIONS.map(item => item.id);
const records = ids.map(id => ({ attractionId: id, photoId: id, writeId: id, blob: new Blob([id]),
  width: 80, height: 60, createdAt: "2026-11-05T04:00:00.000Z" }));
const tick = () => new Promise(setImmediate);
const setup = options => appHarness({ initialState: checkedState(ids), initialPhotos: records, hash: "#memories", ...options });
const html = app => app.element("#app").innerHTML;
function change(app, data, checked = true) {
  app.events.get("document:change")({ target: { dataset: data, checked, isConnected: true,
    matches: query => query === `[data-${data.photoSelect ? "photo-select" : "summary-select"}]` } });
}

test("回憶子路由及舊網址有明確預設，不接受未知功能", () => {
  for (const [hash, section] of [["#memories", "albums"], ["#memories/ai", "ai"], ["#memories/checkins", "checkins"], ["#memories/unknown", "albums"]])
    assert.deepEqual(parseRoute(hash), { view: "memories", section });
  assert.deepEqual(parseRoute("#prepare"), { view: "home" });
  assert.deepEqual(parseRoute("#attraction/unknown"), { view: "itinerary" });
});

test("學生主頁有進度和行程操作；團刊保留，設定收起，不增加手冊入口", async () => {
  const app = setup({ hash: "#home" }); await app.controller.start();
  assert.deepEqual(app.controller.getPageSnapshot().checkInProgress, { filled: 5, total: 5 });
  assert.match(html(app), /五站打卡：5／5/);
  assert.match(html(app), /href="#itinerary">查看行程/);
  assert.match(html(app), /查看團刊 PDF/); assert.match(html(app), /下載團刊 PDF/);
  assert.match(html(app), /<details id="home-settings"[^>]*><summary>通知與裝置設定/);
  assert.doesNotMatch(html(app), /href="#workbook|活動課業與反思重點|酒店資料|隨身團刊/);
});

test("景點主要操作先於可展開原文問題，所有原題與相機入口仍存在", async () => {
  const app = setup(); await app.controller.start();
  for (const place of CHECK_IN_LOCATIONS) {
    app.navigate(`#attraction/${place.id}`);
    const text = html(app), action = text.indexOf(place.id === "departure-school" ? "checkin-panel" : "checked-in-panel");
    assert.ok(action < text.indexOf("learning-disclosure"));
    if (ids.includes(place.id)) {
      assert.ok(text.indexOf("data-native-camera-open") < text.indexOf("learning-disclosure"));
      assert.match(text, /data-camera-open=/);
    }
    for (const question of place.questions || []) assert.ok(text.includes(question));
    assert.doesNotMatch(text, /查看旅途回憶|景點簡介/);
  }
});

test("行程 ID 明確對應原路線，不以景點名稱推測，選填學校仍顯示", async () => {
  const app = setup({ hash: "#itinerary" }); await app.controller.start();
  const model = app.controller.getPageSnapshot();
  assert.deepEqual(model.checkInProgress, { filled: 5, total: 5 });
  model.days.forEach((day, index) => {
    assert.deepEqual(day.route.map(stop => stop.label), TRIP_DATA.itinerary[index].route);
    for (const stop of day.route) if (stop.attractionId) assert.ok(CHECK_IN_LOCATIONS.some(item => item.id === stop.attractionId));
  });
  assert.match(html(app), /status-optional">選填/);
});

test("三分頁只呈現目前操作，隱藏分頁不持有相片預覽，讀取錯誤不阻擋紀錄卡", async () => {
  const live = new Set(), app = setup({ urlService: { createObjectURL() { const url = `blob:${live.size}`; live.add(url); return url; }, revokeObjectURL(url) { live.delete(url); } } });
  await app.controller.start(); assert.equal(live.size, ids.length);
  assert.match(html(app), /data-memory-download-all/); assert.doesNotMatch(html(app), /data-memory-summary-open|data-memory-checkin-card-open/);
  app.navigate("#memories/ai"); assert.equal(live.size, 0);
  assert.match(html(app), /data-memory-summary-open/); assert.doesNotMatch(html(app), /data-memory-album=|data-memory-checkin-card-open/);
  app.photoService.getAllPhotoRecords = async () => { throw Error("read failure"); };
  await app.controller.start(); assert.doesNotMatch(html(app), /仍欠 \d+ 個景點的相片/);
  assert.match(html(app), /data-memory-artwork-open/);
  app.navigate("#memories/checkins"); assert.match(html(app), /data-memory-checkin-card-open/);
  assert.doesNotMatch(html(app), /data-memory-summary-open|data-memory-download-all/);
});

test("分頁切換保留已確定勾選及 AI 選圖，取消未確定勾選；離開回憶清除", async () => {
  const app = setup(); await app.controller.start();
  await app.click("memory-album", ids[0]); change(app, { photoSelect: ids[0] }); await app.click("memory-selection-confirm");
  await app.click("memory-album", ids[1]); change(app, { photoSelect: ids[1] });
  app.navigate("#memories/ai"); assert.equal(app.controller.getPageSnapshot().selectedCount, 1);
  await app.click("memory-summary-open"); await app.click("memory-pick", ids[0]);
  change(app, { summarySelect: ids[0], summaryPhotoId: ids[0] });
  app.navigate("#memories/checkins"); app.navigate("#memories/ai");
  assert.equal(app.controller.getPageSnapshot().summaryCard.requiredSelectedCount, 1);
  app.navigate("#memories"); await app.click("memory-album", ids[1]);
  assert.equal(app.controller.getPageSnapshot().memoryOverlay.albumSelectedCount, 0);
  app.navigate("#home"); app.navigate("#memories/ai");
  assert.equal(app.controller.getPageSnapshot().selectedCount, 0);
  assert.equal(app.controller.getPageSnapshot().summaryCard.requiredSelectedCount, 0);
});

test("身份草稿在回憶分頁之間保留，舊預覽失效，離開回憶後清空", async () => {
  const app = setup({ hash: "#memories/checkins" }); await app.controller.start();
  await app.click("memory-checkin-card-open");
  const dialog = app.element("#checkin-card-dialog");
  dialog.listeners.input[0].callback({ target: { dataset: { checkinCardField: "studentNumber" }, value: "007" }, isComposing: false });
  app.navigate("#memories/ai"); app.navigate("#memories/checkins"); await app.click("memory-checkin-card-open");
  assert.match(dialog.innerHTML, /value="007"/);
  app.navigate("#home"); app.navigate("#memories/checkins"); await app.click("memory-checkin-card-open");
  assert.doesNotMatch(dialog.innerHTML, /value="007"/);
  assert.ok(!JSON.stringify(app.savedState()).includes("007"));
});

test("下載轉換期間切分頁停止舊結果，同時保留已確定勾選", async () => {
  const app = setup(); await app.controller.start(); await app.click("photo-select-all", "memories");
  let release, downloads = 0;
  app.photoService.createPhotoExport = (record, name) => new Promise(resolve => { release = () => resolve(new File([record.blob], name)); });
  app.element("a").click = () => { downloads++; };
  const preparing = app.click("photo-export-selected", "memories"); await tick();
  app.navigate("#memories/ai"); release(); await preparing;
  await app.click("photo-export-download-all");
  assert.equal(downloads, 0); assert.equal(app.element("#photo-export-dialog").open, false);
  assert.equal(app.controller.getPageSnapshot().selectedCount, ids.length);
});

test("另一分頁的過期入口不能開啟署名或選圖", async () => {
  const app = setup(); await app.controller.start();
  await app.click("memory-summary-open"); await app.click("memory-artwork-open"); await app.click("memory-checkin-card-open");
  assert.equal(app.element("#memory-dialog").open, false); assert.equal(app.element("#ai-artwork-dialog").open, false);
  assert.equal(app.element("#checkin-card-dialog").open, false);
});

test("手冊工具列只有一個 PDF 入口，分頁切換仍保存輸入且不清除身份", async () => {
  const app = setup({ hash: "#workbook/day1" }); await app.controller.start();
  const text = html(app); assert.equal((text.match(/data-workbook-export-open/g) || []).length, 1);
  assert.ok(text.indexOf("data-workbook-export-open") < text.indexOf("data-workbook-field"));
  assert.match(text, /下一部分/); assert.match(text, /href="#workbook\/share"/);
  const target = { dataset: { workbookField: "day1-feeling" }, value: "分次填寫的合成內容", isConnected: true,
    matches: query => query.includes("[data-workbook-field]") };
  const field = app.controller.getPageSnapshot().part.fields[0].id; target.dataset.workbookField = field;
  app.events.get("document:input")({ target }); app.navigate("#workbook/day2"); await tick(); await tick();
  assert.equal(app.controller.getPageSnapshot().answers[field], target.value);
});
