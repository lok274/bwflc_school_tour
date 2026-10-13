import test from "node:test";
import assert from "node:assert/strict";
import { appHarness, checkedState } from "./helpers/browser-environment.js";
import { parseRoute } from "../src/routes.js";
import { CHECK_IN_LOCATIONS, REQUIRED_CHECK_IN_LOCATIONS, TRIP_DATA } from "../src/data.js";
import { gcj02ToWgs84 } from "../src/geo.js";
import { renderIcon } from "../src/view-components.js";
import { createItineraryViews } from "../src/itinerary-views.js";

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

test("共用 Lucide 圖示只允許固定節點，不重複讀屏名稱或加入外部來源", () => {
  for (const name of ["School", "MapPin", "Images", "Camera", "Download", "ShieldCheck", "Sparkles", "FileText", "Check", "ChevronDown", "ChevronUp", "ChevronLeft", "ChevronRight", "ArrowRight", "RotateCcw", "X", "Trash2", "Share2", "Wifi", "WifiOff", "CircleCheck", "SquareCheck", "ImagePlus", "Eye"]) {
    const markup = renderIcon(name);
    assert.match(markup, /aria-hidden="true" focusable="false"/);
    assert.match(markup, /viewBox="0 0 24 24"/);
    assert.doesNotMatch(markup, /<title|<use|<script|style=|on\w+=/);
  }
  for (const name of ["unknown", "__proto__", "constructor", '<img src=x onerror="alert(1)">']) assert.equal(renderIcon(name), "");
});

test("回憶使用三項同頁分段按鈕，行程進度採實際資料", async () => {
  const app = setup(); await app.controller.start();
  assert.match(html(app), /class="memory-tabs"/);
  assert.equal((html(app).match(/class="section-toggle memory-tab"/g) || []).length, 3);
  assert.equal((html(app).match(/aria-expanded="true"/g) || []).length, 1);
  assert.doesNotMatch(html(app), /class="accordion-part"/);
  app.navigate("#itinerary"); await tick(); await tick();
  assert.match(html(app), /<progress max="5" value="5" aria-label="五站打卡進度"/);
});

test("回憶子路由及舊網址有明確預設，不接受未知功能", () => {
  for (const [hash, section] of [["#memories", "albums"], ["#memories/ai", "ai"], ["#memories/checkins", "checkins"], ["#memories/unknown", "albums"]])
    assert.deepEqual(parseRoute(hash), { view: "memories", section });
  for (const hash of ["", "#home", "#prepare", "#workbook", "#workbook/essay", "#workbook/day1", "#workbook/unknown"]) assert.deepEqual(parseRoute(hash), { view: "itinerary" });
  assert.deepEqual(parseRoute("#introduction"), { view: "itinerary", section: "introduction" });
  assert.deepEqual(parseRoute("#attraction/unknown"), { view: "itinerary" });
  for (const location of CHECK_IN_LOCATIONS) assert.deepEqual(parseRoute(`#attraction/${location.id}`), { view: "itinerary", attractionId: location.id });
});

test("學生主頁有進度和行程操作；團刊保留，設定收起，不增加手冊入口", async () => {
  const app = setup({ hash: "#home" }); await app.controller.start();
  assert.deepEqual(app.controller.getPageSnapshot().checkInProgress, { filled: 5, total: 5 });
  assert.match(html(app), /五站打卡：5／5/);
  assert.doesNotMatch(html(app), /查看行程/);
  assert.equal(app.controller.currentRoute().view, "itinerary");
  assert.match(html(app), /查看團刊/); assert.doesNotMatch(html(app), /下載團刊/);
  assert.doesNotMatch(html(app), />下載[^<]*(?:PDF|JPEG|PNG|ZIP)|EXIF|離線快取|加密金鑰/);
  assert.match(html(app), /<details id="home-settings"[^>]*><summary>裝置設定/);
  assert.match(html(app), /清除後無法復原/); assert.match(html(app), /已下載檔案會保留/);
  assert.doesNotMatch(html(app), /位置與相片不會上傳|privacy-banner|打卡時才讀取一次位置/);
  assert.doesNotMatch(html(app), /href="#workbook|活動課業與反思重點|酒店資料|隨身團刊/);
});

test("六站打卡與相機入口保留，學習問題及提示不再出現", async () => {
  const app = setup(); await app.controller.start();
  for (const place of CHECK_IN_LOCATIONS) {
    app.navigate(`#attraction/${place.id}`);
    const text = html(app), action = text.indexOf(place.id === "departure-school" ? "checkin-panel" : "checked-in-panel");
    assert.ok(action >= 0);
    assert.doesNotMatch(text, /學習問題|現場觀察|學習提示|learning-disclosure|learning-grid|question-label/);
    for (const field of ["questions", "questionNumbers", "observe", "prompt"]) assert.equal(Object.hasOwn(app.controller.getPageSnapshot().attraction, field), false);
    if (ids.includes(place.id)) {
      assert.match(text, /data-native-camera-open=/);
      assert.match(text, /data-camera-open=/);
    }
    assert.doesNotMatch(text, /查看旅途回憶|景點簡介/);
  }
});

test("六站打卡後移除指定說明及相片入口提示，保留拍攝、取消及測試標示", () => {
  for (const testOnly of [false, true]) {
    const views = createItineraryViews({ testOnly });
    for (const attraction of CHECK_IN_LOCATIONS) {
      const markup = views.renderAttraction({ attraction, photos: [], checkIn: {
        attractionId: attraction.id, checkedInAt: "2026-11-05T04:00:00Z", method: "manual", verified: false
      } }, { showCompletion: false });
      assert.doesNotMatch(markup, /個人紀錄，不作校方出席證明。|相片不會上傳；拍到同學前請先取得同意。|查看及下載相片，請按底部的「旅途回憶」。/);
      assert.doesNotMatch(markup, /<p class="privacy-note">\s*<\/p>/);
      for (const action of ["checkin-undo", "native-camera-open", "camera-open"]) assert.ok(markup.includes(`data-${action}="${attraction.id}"`));
      assert.match(markup, /<time>/);
      assert.equal(markup.includes("測試紀錄未核實到訪，不作課業或出席證明。"), testOnly);
    }
  }
});

test("六站未打卡時保留按鈕，不顯示已移除的標題、說明或來源連結列", async () => {
  const app = appHarness({ hash: "#itinerary" }); await app.controller.start();
  for (const place of CHECK_IN_LOCATIONS) {
    app.navigate(`#attraction/${place.id}`);
    const text = html(app);
    assert.match(text, new RegExp(`data-checkin="${place.id}"`));
    assert.doesNotMatch(text, /在景點附近打卡|只讀取一次位置，不保存座標|source-link|資料來源：|位置資料|在 Google Maps 查看地點/);
    assert.doesNotMatch(text, /class="checkin-panel">\s*<div>/);
    assert.doesNotMatch(text, /data-camera-open=/);
  }
  app.navigate("#memories");
  assert.doesNotMatch(html(app), /相片只存在這部裝置，不會上傳或自動加入手機相簿；人樣及背景仍可能透露身份/);
  assert.match(html(app), /取消打卡會刪除本站全部相片，無法復原；已下載或分享的檔案會保留/);
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

test("編號景點卡只用原有圖片，同頁日期定位不改網址、打卡或開啟景點", async () => {
  const app = setup({ hash: "#itinerary" }); await app.controller.start();
  const markup = html(app);
  assert.equal((markup.match(/data-itinerary-day=/g) || []).length, TRIP_DATA.itinerary.length);
  assert.equal((markup.match(/class="detail-hero(?: school-hero)?"/g) || []).length, 6);
  assert.equal((markup.match(/class="stop-number"/g) || []).length, TRIP_DATA.itinerary.reduce((count, day) => count + day.route.length, 0));
  for (const place of CHECK_IN_LOCATIONS) {
    assert.ok(markup.includes(place.image)); assert.ok(markup.includes(place.alt));
  }
  assert.doesNotMatch(markup, /定位已就緒|GPS 定位已就緒/);
  const before = app.savedState();
  await app.click("itinerary-day", "2");
  assert.deepEqual(app.controller.currentRoute(), { view: "itinerary" });
  assert.equal(app.environment.location.hash, "#itinerary");
  assert.deepEqual(app.savedState(), before);
  assert.equal((html(app).match(/data-checkin(?:-undo)?=/g) || []).length, 6);
  assert.equal((html(app).match(/data-camera-open=/g) || []).length, 5);
  app.navigate(`#attraction/${ids[0]}`);
  await app.click("itinerary-day", "3");
  assert.equal(app.controller.getPageSnapshot().attraction.id, ids[0]);
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

test("回憶可全部收起，釋放封面並取消待確定選取，已確定選取仍保留", async () => {
  const live = new Set(); let next = 0;
  const app = setup({ urlService: { createObjectURL() { const url = `blob:${next++}`; live.add(url); return url; }, revokeObjectURL(url) { live.delete(url); } } });
  await app.controller.start();
  await app.click("memory-album", ids[0]); change(app, { photoSelect: ids[0] }); await app.click("memory-selection-confirm");
  await app.click("memory-album", ids[1]); change(app, { photoSelect: ids[1] });
  await app.click("section-view", "memories", { dataset: { sectionId: "albums" } });
  assert.equal(app.controller.getPageSnapshot().section, null);
  assert.equal(app.controller.getPageSnapshot().selectedCount, 1);
  assert.equal(app.element("#memory-dialog").open, false);
  assert.equal(live.size, 0);
  assert.equal((html(app).match(/data-section-view="memories"/g) || []).length, 3);
  assert.doesNotMatch(html(app), /aria-expanded="true"|data-memory-download-all/);
  await app.click("memory-album", ids[0]); assert.equal(app.element("#memory-dialog").open, false);
  app.navigate("#memories");
  assert.equal(app.controller.getPageSnapshot().section, "albums");
  await app.click("memory-album", ids[1]);
  assert.equal(app.controller.getPageSnapshot().memoryOverlay.albumSelectedCount, 0);
});

test("行程六站全部常開，舊景點網址只定位，已移除的收起控制項不再生效", async () => {
  const app = setup({ hash: "#itinerary" }); await app.controller.start();
  const before = app.savedState();
  for (const place of CHECK_IN_LOCATIONS) {
    app.navigate("#attraction/" + place.id);
    assert.equal(app.controller.getPageSnapshot().view, "itinerary");
    assert.equal(app.controller.getPageSnapshot().stops.length, 6);
    assert.equal((html(app).match(/<h1>/g) || []).length, 1);
    assert.equal((html(app).match(/class="itinerary-stop-details"/g) || []).length, 6);
    assert.doesNotMatch(html(app), /data-attraction-toggle|itinerary-stop-toggle|收起本站操作|打卡與拍照/);
    assert.equal((html(app).match(/class="photo-panel(?: photo-locked)?"/g) || []).length, 6);
    assert.equal((html(app).match(/class="checkin-completion"/g) || []).length, 1);
    const markup = html(app);
    await app.click("attraction-toggle", place.id);
    assert.equal(html(app), markup);
    assert.equal(app.controller.currentRoute().attractionId, place.id);
    assert.deepEqual(app.savedState(), before);
  }
});

test("同頁可對不同景點定位；重畫及另一站完成不會重新啟用等待中的按鈕", async () => {
  const app = appHarness({ hash: "#itinerary" }), callbacks = [];
  app.environment.navigator.geolocation = { getCurrentPosition(success, error) { callbacks.push({ success, error }); } };
  await app.controller.start();
  await app.click("checkin", ids[0]); app.controller.render();
  await app.click("checkin", ids[0]); await app.click("checkin", ids[1]);
  assert.equal(callbacks.length, 2);
  assert.equal(app.controller.currentRoute().attractionId, undefined);
  const stop = id => app.controller.getPageSnapshot().stops.find(item => item.attraction.id === id);
  assert.equal(stop(ids[0]).checkInBusy, true); assert.equal(stop(ids[1]).checkInBusy, true);
  assert.match(html(app), new RegExp('data-checkin="' + ids[0] + '" disabled aria-busy="true"'));
  const centre = gcj02ToWgs84(REQUIRED_CHECK_IN_LOCATIONS[0].geo);
  await callbacks[0].success({ coords: { latitude: centre.lat, longitude: centre.lng, accuracy: 10 } });
  assert.equal(stop(ids[0]).checkIn.verified, true);
  assert.equal(stop(ids[0]).checkInBusy, false);
  assert.equal(stop(ids[1]).checkInBusy, true);
  await app.click("checkin", ids[1]); assert.equal(callbacks.length, 2);
  app.confirmation.handler = async () => false;
  await callbacks[1].error({ code: 1 });
  assert.equal(stop(ids[1]).checkInBusy, false); assert.equal(stop(ids[1]).checkIn, null);
  assert.doesNotMatch(JSON.stringify(app.savedState()), /latitude|longitude|coords|accuracy/);
  await app.click("checkin", ids[1]); assert.equal(callbacks.length, 3);
});

test("六站的拍攝與取消打卡在行程頁直接操作，只影響本站", async () => {
  const app = setup({ hash: "#itinerary" }); await app.controller.start();
  let native = 0, chosen;
  app.element("#native-camera-input").click = () => { native++; };
  app.photoService.compressPhoto = async (_blob, id) => { chosen = id; return { attractionId: id, blob: new Blob(["new"]), width: 80, height: 60 }; };
  await app.click("native-camera-open", "departure-school"); assert.equal(native, 0);
  await app.selectPhoto(new Blob(["synthetic"]), ids[1]);
  assert.equal(native, 1); assert.equal(chosen, ids[1]); assert.equal(app.environment.location.hash, "#itinerary");
  app.confirmation.handler = async () => true;
  await app.click("checkin-undo", ids[0]);
  assert.equal(app.savedState().checkIns[ids[0]], undefined);
  assert.ok(app.savedState().checkIns[ids[1]]);
  assert.equal(app.photoData.has(ids[0]), false); assert.equal(app.photoData.has(ids[1]), true);
  assert.equal(app.controller.getPageSnapshot().stops.length, 6);
});

for (const action of ["removed-toggle", "switch", "leave-and-return"]) test("行程 " + action + " 後定位回覆按正確頁面處理", async () => {
  const app = appHarness({ hash: "#attraction/" + ids[0] }); let success;
  app.environment.navigator.geolocation = { getCurrentPosition(callback) { success = callback; } };
  await app.controller.start(); await app.click("checkin", ids[0]);
  if (action === "switch") app.navigate("#attraction/" + ids[1]);
  else if (action === "leave-and-return") { app.navigate("#memories"); app.navigate("#itinerary"); }
  else await app.click("attraction-toggle", ids[0]);
  const centre = gcj02ToWgs84(REQUIRED_CHECK_IN_LOCATIONS[0].geo);
  await success({ coords: { latitude: centre.lat, longitude: centre.lng, accuracy: 10 } });
  assert.equal(Boolean(app.savedState().checkIns[ids[0]]), action === "removed-toggle");
  assert.equal(app.element("#confirm-dialog").open, false);
});

test("舊收起控制項不停止相機；離開行程停止串流並拒絕遲來的權限回覆", async () => {
  const app = setup({ hash: "#itinerary" }); await app.controller.start();
  app.element("#camera-dialog").contains = () => false;
  let stopped = 0;
  app.environment.navigator.mediaDevices = { getUserMedia: async () => ({ getTracks: () => [{ stop() { stopped++; } }] }) };
  await app.click("camera-open", ids[0]); assert.equal(app.element("#camera-dialog").open, true);
  await app.click("attraction-toggle", ids[0]); assert.equal(stopped, 0);
  assert.equal(app.element("#camera-dialog").open, true);
  app.navigate("#memories"); assert.equal(stopped, 1); assert.equal(app.element("#camera-dialog").open, false);
  app.navigate("#itinerary"); let release;
  app.environment.navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { release = resolve; });
  const opening = app.click("camera-open", ids[0]); await tick();
  app.navigate("#memories"); app.navigate("#itinerary");
  release({ getTracks: () => [{ stop() { stopped++; } }] }); await opening;
  assert.equal(stopped, 2); assert.equal(app.element("#camera-dialog").open, false);
});

test("行程離開再返回不保存舊手機相片處理結果，六站原照仍保留", async () => {
  const app = setup({ hash: "#itinerary" }); await app.controller.start(); let release, writes = 0;
  app.photoService.compressPhoto = () => new Promise(resolve => { release = resolve; });
  app.photoService.savePhotoRecord = async () => { writes++; return "new"; };
  const processing = app.selectPhoto(new Blob(["synthetic input"]), ids[0]); await tick();
  await app.click("attraction-toggle", ids[0]);
  app.navigate("#memories"); app.navigate("#itinerary");
  release({ attractionId: ids[0], blob: new Blob(["synthetic result"]), width: 80, height: 60 }); await processing;
  assert.equal(writes, 0); assert.equal(app.photoData.size, records.length);
  assert.equal(app.savedState().checkIns[ids[0]].attractionId, ids[0]);
});
