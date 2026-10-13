import test from "node:test";
import assert from "node:assert/strict";
import { appHarness, checkedState, fillStudentIdentity, submitStudentIdentity, FIXTURE_IDENTITY } from "./helpers/browser-environment.js";
import { parseRoute } from "../src/routes.js";
import { CHECK_IN_LOCATIONS, REQUIRED_CHECK_IN_LOCATIONS, TRIP_DATA } from "../src/data.js";
import { gcj02ToWgs84 } from "../src/geo.js";
import { renderIcon } from "../src/view-components.js";
import { createItineraryViews } from "../src/itinerary-views.js";
import { createAppController } from "../src/controller.js";
import { createStudentLoginController } from "../src/student-login-controller.js";
import { REHEARSAL_SCENARIOS, rehearsalPageHref } from "../src/app-settings.js";
import { STUDENT_IDENTITY_STORAGE_KEY } from "../src/student-identity.js";
import { STORAGE_KEY } from "../src/state.js";

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

test("登入模組建構不觸發旅程操作，身份與畫面模型隔離，普通按鈕同步放行", () => {
  let reads = 0;
  const unexpected = () => { throw Error("建構不得觸發畫面或旅程操作"); };
  const options = { document: {}, app: {}, renderLogin: unexpected, isResetting: unexpected,
    isCurrentControl: unexpected, getPageGeneration: unexpected, pauseJourney: unexpected,
    leaveJourney: unexpected, enterJourney: unexpected, render: unexpected, formRendered: unexpected,
    askConfirmation: unexpected, showToast: unexpected };
  const login = createStudentLoginController({ ...options, storage: {
    getItem(key) { reads++; assert.equal(key, STUDENT_IDENTITY_STORAGE_KEY); return JSON.stringify({ version: 1, ...FIXTURE_IDENTITY }); },
    setItem: unexpected, removeItem: unexpected
  } });
  assert.equal(reads, 1); assert.equal(login.isReady(), true); assert.ok(Object.isFrozen(login));
  const identity = login.getIdentity(); identity.studentName = "不回寫";
  assert.deepEqual(login.getIdentity(), FIXTURE_IDENTITY);
  const model = login.getModel(); assert.ok(Object.isFrozen(model));
  assert.ok(Object.isFrozen(model.identity)); assert.ok(Object.isFrozen(model.errors));
  assert.equal(login.handleClick({ matches: () => false }), false);
  for (const testKind of ["rehearsal", "diagnostics"]) {
    const isolated = createStudentLoginController({ ...options, testKind,
      storage: { getItem: unexpected, setItem: unexpected, removeItem: unexpected } });
    assert.equal(isolated.isReady(), true); assert.equal(isolated.getIdentity(), null);
    assert.equal(isolated.handleClick({ matches: () => false }), false);
    isolated.clear(); isolated.reconcileStorage();
  }
});

test("未登入不顯示旅程或讀相片，填妥後回到原網址，重開可沿用資料", async () => {
  for (const hash of ["#itinerary", "#attraction/future-school", "#memories/ai", "#workbook"]) {
    const app = setup({ hash, initialIdentity: null }); let reads = 0, gps = 0;
    app.photoService.getAllPhotoRecords = async () => { reads++; return records; };
    app.environment.navigator.geolocation = { getCurrentPosition() { gps++; } };
    const before = app.savedState(); await app.controller.start();
    assert.equal(app.controller.getPageSnapshot().view, "login"); assert.equal(reads, 0);
    assert.match(html(app), /登入|student-login-form/); assert.doesNotMatch(html(app), /data-checkin=|data-memory-/);
    assert.equal(app.element(".bottom-nav").hidden, true);
    await app.click("install-dismiss");
    await app.click("checkin", "departure-school"); await app.click("native-camera-open", "future-school");
    assert.equal(gps, 0); assert.deepEqual(app.savedState(), before);
    fillStudentIdentity(app, { ...FIXTURE_IDENTITY, studentNumber: "007" }); await submitStudentIdentity(app);
    assert.equal(app.environment.location.hash, hash); assert.equal(reads, 1);
    assert.equal(app.element(".bottom-nav").hidden, false);
    const remembered = JSON.parse(app.environment.localStorage.getItem(STUDENT_IDENTITY_STORAGE_KEY));
    assert.equal(remembered.studentNumber, "007"); assert.deepEqual(app.savedState(), before);
    const reload = setup({ hash, initialIdentity: remembered }); await reload.controller.start();
    assert.notEqual(reload.controller.getPageSnapshot().view, "login");
  }
});

test("必填、超限及控制字元有逐欄錯誤；中文組字不重畫或提前登入", async () => {
  const app = setup({ initialIdentity: null }); await app.controller.start();
  await app.click("install-dismiss");
  await submitStudentIdentity(app);
  assert.equal(Object.keys(app.controller.getPageSnapshot().errors).length, 3);
  const input = app.element("#student-login-studentName"); let focused = 0; input.focus = () => { focused++; };
  Object.assign(input, { value: "文".repeat(41), dataset: { studentIdentityField: "studentName" }, matches: () => false });
  app.events.get("document:compositionstart")({ target: input });
  const markup = html(app); app.events.get("document:input")({ target: input, isComposing: true });
  app.controller.render(); await submitStudentIdentity(app);
  assert.equal(html(app), markup); assert.equal(app.environment.localStorage.getItem(STUDENT_IDENTITY_STORAGE_KEY), null);
  app.events.get("document:compositionend")({ target: input });
  fillStudentIdentity(app, { ...FIXTURE_IDENTITY, studentName: input.value, className: "A\u202e" }); await submitStudentIdentity(app);
  assert.equal(app.controller.getPageSnapshot().identity.studentName.length, 41);
  assert.match(app.controller.getPageSnapshot().errors.studentName, /40/); assert.match(app.controller.getPageSnapshot().errors.className, /控制字元/);
  assert.ok(focused > 0); assert.equal(app.environment.localStorage.getItem(STUDENT_IDENTITY_STORAGE_KEY), null);
});

test("保存失敗保留輸入及重試；明確選擇只在本次使用後不寫身份", async () => {
  const app = setup({ initialIdentity: null }); await app.controller.start();
  await app.click("install-dismiss");
  const set = app.environment.localStorage.setItem;
  app.environment.localStorage.setItem = (key, value) => { if (key === STUDENT_IDENTITY_STORAGE_KEY) throw Error("quota"); return set(key, value); };
  fillStudentIdentity(app); await submitStudentIdentity(app);
  assert.deepEqual(app.controller.getPageSnapshot().identity, FIXTURE_IDENTITY);
  assert.equal(app.controller.getPageSnapshot().saveFailed, true); assert.match(html(app), /只在本次使用/);
  await app.click("student-identity-temporary");
  assert.equal(app.controller.getPageSnapshot().view, "memories");
  assert.equal(app.environment.localStorage.getItem(STUDENT_IDENTITY_STORAGE_KEY), null);
  assert.match(app.element("#toast").textContent, /重新整理/);
  const reload = setup({ initialIdentity: null }); await reload.controller.start(); assert.equal(reload.controller.getPageSnapshot().view, "login");
});

test("學生資料可取消或保存修改，署名帶入新資料且作品修改不回寫登入", async () => {
  const app = setup({ hash: "#memories/checkins" }); await app.controller.start();
  const before = app.environment.localStorage.getItem(STUDENT_IDENTITY_STORAGE_KEY), journey = app.savedState();
  await app.click("student-profile-open"); fillStudentIdentity(app, { ...FIXTURE_IDENTITY, studentName: "取消這次" });
  await app.click("student-identity-cancel"); assert.equal(app.environment.localStorage.getItem(STUDENT_IDENTITY_STORAGE_KEY), before);
  await app.click("student-profile-open"); fillStudentIdentity(app, { ...FIXTURE_IDENTITY, studentName: "修改學生", studentNumber: "009" }); await submitStudentIdentity(app);
  await app.click("memory-checkin-card-open"); const dialog = app.element("#checkin-card-dialog");
  assert.match(dialog.innerHTML, /value="修改學生"/); assert.match(dialog.innerHTML, /value="009"/);
  assert.doesNotMatch(dialog.innerHTML, /已帶入登入資料|不改動已記住的資料|此卡不代表校方核實出席或身份/);
  dialog.listeners.input[0].callback({ target: { dataset: { checkinCardField: "studentNumber" }, value: "008" } });
  dialog.listeners.cancel[0].callback({ preventDefault() {} }); await app.click("memory-checkin-card-open");
  assert.match(dialog.innerHTML, /value="008"/);
  assert.equal(JSON.parse(app.environment.localStorage.getItem(STUDENT_IDENTITY_STORAGE_KEY)).studentNumber, "009");
  app.navigate("#itinerary"); app.navigate("#memories/ai"); await app.click("memory-artwork-open");
  assert.doesNotMatch(html(app), /已帶入登入資料|不改動已記住的資料|署名不代表校方核實出席、身份或圖片內容/);
  assert.match(html(app), /value="修改學生"/); assert.match(html(app), /value="009"/); assert.deepEqual(app.savedState(), journey);
});

test("登出需確認，只清身份；失敗或取消保留姓名、相片與打卡", async () => {
  const app = setup(); await app.controller.start(); const before = app.savedState(), photos = [...app.photoData.values()];
  await app.click("student-profile-open"); app.confirmation.handler = async () => false;
  await app.click("student-identity-logout"); assert.ok(app.environment.localStorage.getItem(STUDENT_IDENTITY_STORAGE_KEY));
  app.confirmation.handler = async options => { assert.match(options.message, /相片與打卡會保留/); return true; };
  const remove = app.environment.localStorage.removeItem;
  app.environment.localStorage.removeItem = () => { throw Error("blocked"); };
  await app.click("student-identity-logout"); assert.match(app.controller.getPageSnapshot().status, /未能確認/);
  assert.ok(app.environment.localStorage.getItem(STUDENT_IDENTITY_STORAGE_KEY));
  app.environment.localStorage.removeItem = remove; await app.click("student-identity-logout");
  assert.equal(app.environment.localStorage.getItem(STUDENT_IDENTITY_STORAGE_KEY), null);
  assert.equal(app.controller.getPageSnapshot().view, "login"); assert.deepEqual(app.savedState(), before); assert.deepEqual([...app.photoData.values()], photos);
});

test("另一分頁更換身份或登出會關閉操作，遲來的定位不保存；其他儲存事件不影響登入", async () => {
  const app = setup({ hash: "#itinerary" }); await app.controller.start(); let success;
  app.environment.navigator.geolocation = { getCurrentPosition(callback) { success = callback; } };
  await app.click("checkin", "departure-school"); const before = app.savedState();
  app.events.get("window:storage")({ key: "other-project", storageArea: app.environment.localStorage });
  assert.equal(app.controller.getPageSnapshot().view, "itinerary");
  app.environment.localStorage.setItem(STUDENT_IDENTITY_STORAGE_KEY, JSON.stringify({ version: 1, ...FIXTURE_IDENTITY, studentName: "另一學生" }));
  app.events.get("window:storage")({ key: STUDENT_IDENTITY_STORAGE_KEY, storageArea: app.environment.localStorage });
  assert.equal(app.controller.getPageSnapshot().view, "login"); assert.equal(app.controller.getPageSnapshot().identity.studentName, "另一學生");
  success({ coords: { latitude: 22, longitude: 114, accuracy: 15 } }); await tick(); assert.deepEqual(app.savedState(), before);
  fillStudentIdentity(app); await submitStudentIdentity(app);
  app.environment.localStorage.removeItem(STUDENT_IDENTITY_STORAGE_KEY);
  app.events.get("window:storage")({ key: STUDENT_IDENTITY_STORAGE_KEY, storageArea: app.environment.localStorage });
  assert.equal(app.controller.getPageSnapshot().view, "login"); assert.deepEqual(app.savedState(), before);
});

for (const notify of [false, true]) test(`另一分頁清除旅程後重新登入不恢復舊打卡（${notify ? "收到" : "未收到"}進度事件）`, async () => {
  const app = setup({ hash: "#attraction/future-school" }); await app.controller.start();
  app.environment.localStorage.removeItem(STORAGE_KEY);
  app.photoData.clear();
  if (notify) app.events.get("window:storage")({ key: STORAGE_KEY, storageArea: app.environment.localStorage });
  app.environment.localStorage.removeItem(STUDENT_IDENTITY_STORAGE_KEY);
  app.events.get("window:storage")({ key: STUDENT_IDENTITY_STORAGE_KEY, storageArea: app.environment.localStorage });
  assert.equal(app.controller.getPageSnapshot().view, "login");
  fillStudentIdentity(app); await submitStudentIdentity(app); await tick();
  assert.equal(app.controller.getPageSnapshot().checkIn, null);
  app.confirmation.handler = async () => true;
  app.environment.navigator.geolocation = { getCurrentPosition(success, error) { error({ code: 1 }); } };
  await app.click("checkin", "future-school"); await tick();
  assert.deepEqual(Object.keys(app.savedState().checkIns), ["future-school"]);
  assert.equal(app.photoData.size, 0);
});

for (const notify of [false, true]) test(`跨分頁更新拒絕遲來定位，不覆寫新紀錄（${notify ? "收到" : "未收到"}事件）`, async () => {
  const app = setup({ hash: "#itinerary", initialState: checkedState([]), initialPhotos: [] });
  await app.controller.start(); let success;
  app.environment.navigator.geolocation = { getCurrentPosition(callback) { success = callback; } };
  await app.click("checkin", "future-school");
  const next = JSON.stringify(checkedState(["sun-yat-sen"]));
  app.environment.localStorage.setItem(STORAGE_KEY, next);
  if (notify) app.events.get("window:storage")({ key: STORAGE_KEY, storageArea: app.environment.localStorage });
  const centre = gcj02ToWgs84(CHECK_IN_LOCATIONS.find(item => item.id === "future-school").geo);
  await success({ coords: { latitude: centre.lat, longitude: centre.lng, accuracy: 10 } }); await tick();
  assert.equal(app.environment.localStorage.getItem(STORAGE_KEY), next);
  assert.doesNotMatch(html(app), /正在定位/);
  assert.match(html(app), /五站打卡：1／5/);
});

test("跨分頁清除進度會取消等待中的紀錄卡，不產生過期下載", async () => {
  let release, previews = 0;
  const app = setup({ hash: "#memories/checkins", urlService: { createObjectURL() { previews++; return "blob:obsolete"; }, revokeObjectURL() {} },
    controllerFactory: options => createAppController({ ...options, completionCardService: () => new Promise(resolve => { release = resolve; }) }) });
  await app.controller.start(); await app.click("memory-checkin-card-open");
  const dialog = app.element("#checkin-card-dialog");
  const target = { disabled: false, matches: query => query === "[data-checkin-card-preview]", closest() { return this; } };
  const generating = dialog.listeners.click[0].callback({ target }); await tick();
  app.environment.localStorage.removeItem(STORAGE_KEY);
  app.events.get("window:storage")({ key: STORAGE_KEY });
  release(new Blob(["obsolete"], { type: "image/png" })); await generating; await tick();
  assert.equal(previews, 0); assert.equal(dialog.open, false);
  assert.equal(app.environment.localStorage.getItem(STORAGE_KEY), null);
});

test("清除仍需兩次確認，身份清除失敗如實說明，重試成功後回登入", async () => {
  const app = setup({ hash: "#itinerary" }); await app.controller.start(); let prompts = 0;
  app.confirmation.handler = async () => { prompts++; return true; };
  const remove = app.environment.localStorage.removeItem;
  app.environment.localStorage.removeItem = key => { if (key === STUDENT_IDENTITY_STORAGE_KEY) throw Error("blocked"); return remove(key); };
  await app.click("reset-all"); assert.equal(prompts, 2); assert.equal(app.photoData.size, 0); assert.equal(Object.keys(app.savedState().checkIns).length, 0);
  assert.match(app.element("#toast").textContent, /未能清除學生資料/); assert.ok(app.environment.localStorage.getItem(STUDENT_IDENTITY_STORAGE_KEY));
  app.environment.localStorage.removeItem = remove; await app.click("reset-all"); assert.equal(prompts, 4);
  assert.equal(app.environment.localStorage.getItem(STUDENT_IDENTITY_STORAGE_KEY), null); assert.equal(app.controller.getPageSnapshot().view, "login");
});

test("瀏覽器禁止讀取儲存物件時仍顯示登入，保存失敗可明確選擇本次使用", async () => {
  const app = setup({ controllerFactory: options => {
    Object.defineProperty(options.environment, "localStorage", { get() { throw Error("SecurityError"); } });
    return createAppController(options);
  } });
  await app.controller.start(); assert.equal(app.controller.getPageSnapshot().view, "login");
  await app.click("install-dismiss");
  fillStudentIdentity(app); await submitStudentIdentity(app); assert.equal(app.controller.getPageSnapshot().saveFailed, true);
  await app.click("student-identity-temporary"); assert.equal(app.controller.getPageSnapshot().view, "memories");
});

test("跨分頁登出停止等待中的相機，晚到的串流全部停止且不改相片", async () => {
  const app = setup({ hash: "#itinerary" }); await app.controller.start(); let release, stopped = 0;
  app.environment.navigator.mediaDevices = { getUserMedia: () => new Promise(resolve => { release = resolve; }) };
  const before = [...app.photoData.values()], opening = app.click("camera-open", "future-school"); await tick();
  assert.equal(app.element("#camera-dialog").open, true);
  app.environment.localStorage.removeItem(STUDENT_IDENTITY_STORAGE_KEY);
  app.events.get("window:storage")({ key: STUDENT_IDENTITY_STORAGE_KEY });
  release({ getTracks: () => [{ stop() { stopped++; } }, { stop() { stopped++; } }] }); await opening;
  assert.equal(stopped, 2); assert.equal(app.element("#camera-dialog").open, false);
  assert.equal(app.controller.getPageSnapshot().view, "login"); assert.deepEqual([...app.photoData.values()], before);
});

test("跨分頁登出取消在途紀錄卡，晚到結果不能恢復預覽或下載", async () => {
  let release, previews = 0, downloads = 0;
  const app = setup({ hash: "#memories/checkins", urlService: { createObjectURL() { previews++; return "blob:obsolete"; }, revokeObjectURL() {} },
    controllerFactory: options => createAppController({ ...options, completionCardService: () => new Promise(resolve => { release = resolve; }) }) });
  await app.controller.start(); await app.click("memory-checkin-card-open");
  const dialog = app.element("#checkin-card-dialog"); app.element("a").click = () => { downloads++; };
  const target = action => ({ disabled: false, matches: query => query === `[data-checkin-card-${action}]`, closest() { return this; } });
  const generating = dialog.listeners.click[0].callback({ target: target("preview") }); await tick();
  app.environment.localStorage.removeItem(STUDENT_IDENTITY_STORAGE_KEY);
  app.events.get("window:storage")({ key: STUDENT_IDENTITY_STORAGE_KEY });
  release(new Blob(["obsolete"], { type: "image/png" })); await generating;
  await dialog.listeners.click[0].callback({ target: target("download") });
  assert.equal(previews, 0); assert.equal(downloads, 0); assert.equal(dialog.open, false);
  assert.equal(app.controller.getPageSnapshot().view, "login");
});

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

test("正式行程底部預設收起測試入口，選情境只改預演連結並跨重畫及返回保留", async () => {
  const app = setup({ hash: "#itinerary" });
  let gpsCalls = 0;
  app.environment.navigator.geolocation = { getCurrentPosition() { gpsCalls++; } };
  await app.controller.start();
  const before = app.savedState(), photos = [...app.photoData.values()];
  const footer = html(app).match(/<details id="itinerary-test-controls"([^>]*)>([\s\S]*?)<\/details>/);
  assert.ok(footer); assert.doesNotMatch(footer[1], /\bopen\b/);
  assert.match(footer[1], /data-ui-disclosure/);
  assert.ok(html(app).indexOf('id="home-settings"') < html(app).indexOf('id="itinerary-test-controls"'));
  assert.match(footer[2], /<summary[^>]*><span aria-hidden="true">⚙️<\/span> 模擬定位與測試控制<\/summary>/);
  assert.match(footer[2], /<label for="itinerary-rehearsal-scenario">模擬定位情境<\/label>/);
  assert.deepEqual([...footer[2].matchAll(/<option value="([^"]+)"/g)].map(match => match[1]), REHEARSAL_SCENARIOS);
  assert.match(footer[2], /只用於預演，不影響正式打卡或相片/);
  assert.match(footer[2], /\.\/device-test\.html\?mode=diagnostics/);
  assert.equal((footer[2].match(/target="_blank" rel="noopener noreferrer"/g) || []).length, 2);
  const select = app.element("#itinerary-rehearsal-scenario");
  Object.assign(select, { matches: query => query === "[data-rehearsal-scenario]" });
  for (const value of [...REHEARSAL_SCENARIOS, "unknown", "within&mode=diagnostics", "too-far"]) {
    select.value = value;
    app.events.get("document:change")({ target: select });
    assert.equal(app.element("#itinerary-rehearsal-open").href, rehearsalPageHref(value));
    app.controller.render();
    assert.equal(select.value, value === "unknown" || value.includes("&") ? "within" : value);
  }
  app.navigate("#memories"); assert.doesNotMatch(html(app), /itinerary-test-controls/);
  app.navigate("#itinerary"); assert.equal(select.value, "too-far");
  assert.equal(app.element("#itinerary-rehearsal-open").href, rehearsalPageHref("too-far"));
  assert.equal(gpsCalls, 0); assert.deepEqual(app.savedState(), before); assert.deepEqual([...app.photoData.values()], photos);
  app.navigate("#memories"); select.value = "denied";
  app.events.get("document:change")({ target: select });
  app.navigate("#itinerary"); assert.equal(select.value, "too-far", "隱藏入口不能修改情境");
  const school = CHECK_IN_LOCATIONS.find(place => place.id === "departure-school");
  const centre = school.geo.coordSystem === "GCJ02" ? gcj02ToWgs84(school.geo) : school.geo;
  app.environment.navigator.geolocation.getCurrentPosition = success => {
    gpsCalls++;
    success({ coords: { latitude: centre.lat, longitude: centre.lng, accuracy: 15 } });
  };
  await app.click("checkin", school.id); await tick();
  assert.equal(gpsCalls, 1, "正式打卡必須呼叫裝置定位");
  assert.equal(app.savedState().checkIns[school.id].verified, true, "預演情境不能取代正式位置");
  const testMarkup = createItineraryViews({ testOnly: true }).renderItinerary({ days: [], checkIns: {} });
  assert.doesNotMatch(testMarkup, /itinerary-test-controls/, "預演不重複正式啟動入口");
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

test("保留五個景點圖片並移除校舍照片，同頁日期定位不改網址或打卡", async () => {
  const app = setup({ hash: "#itinerary" }); await app.controller.start();
  const markup = html(app);
  assert.equal((markup.match(/data-itinerary-day=/g) || []).length, TRIP_DATA.itinerary.length);
  assert.equal((markup.match(/class="detail-hero"/g) || []).length, 6);
  assert.equal((markup.match(/class="stop-number"/g) || []).length, TRIP_DATA.itinerary.reduce((count, day) => count + day.route.length, 0));
  for (const place of REQUIRED_CHECK_IN_LOCATIONS) {
    assert.ok(markup.includes(place.image)); assert.ok(markup.includes(place.alt));
  }
  assert.doesNotMatch(markup, /departure-school\.jpg|image-credit|src="undefined"/);
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
