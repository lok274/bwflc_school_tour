import test from "node:test";
import assert from "node:assert/strict";
import { activityDateLabels, REHEARSAL_SCENARIO_OPTIONS, REHEARSAL_SCENARIOS, normalizeRehearsalScenario, rehearsalPageHref,
  updateOfflineShell } from "../src/app-settings.js";
import { STUDENT_IDENTITY_STORAGE_KEY, createStudentIdentityStore, studentIdentityErrors } from "../src/student-identity.js";
import { TRIP_DATA, TRIP_BOOKLET } from "../src/data.js";
import { createViews } from "../src/views.js";

test("學生資料獨立保存，嚴格讀取版本與欄位，保留前置零且不碰旅程資料", () => {
  const values = new Map([["outdoorLearningDay.v3", "journey-sentinel"]]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const profile = createStudentIdentityStore(storage);
  assert.equal(profile.read(), null);
  assert.deepEqual(profile.save({ studentName: " 測試學生 ", className: " 3A ", studentNumber: "007" }), { studentName: "測試學生", className: "3A", studentNumber: "007" });
  const good = values.get(STUDENT_IDENTITY_STORAGE_KEY);
  assert.deepEqual(Object.keys(JSON.parse(good)), ["version", "studentName", "className", "studentNumber"]);
  for (const invalid of ["{", "null", "[]", "x".repeat(4097), good.replace('"version":1', '"version":2'), good.replace('"007"', '7'), good.replace('"007"', '""'), good.replace('"007"', '"\\u202e"'), good.replace('"007"', `"${"9".repeat(21)}"`), good.replace('"version":1', '"version":1,"other":true')]) {
    values.set(STUDENT_IDENTITY_STORAGE_KEY, invalid);
    assert.equal(profile.read(), null); assert.equal(values.get(STUDENT_IDENTITY_STORAGE_KEY), invalid, "讀取不修改儲存");
  }
  profile.clear(); assert.equal(values.has(STUDENT_IDENTITY_STORAGE_KEY), false);
  assert.equal(values.get("outdoorLearningDay.v3"), "journey-sentinel");
});

test("身份儲存不能假稱寫入或清除成功，錯誤不截斷姓名", () => {
  const data = { studentName: "學生", className: "3A", studentNumber: "001" };
  assert.equal(Object.keys(studentIdentityErrors({ ...data, studentName: "文".repeat(40) })).length, 0);
  assert.match(studentIdentityErrors({ ...data, studentName: "文".repeat(41) }).studentName, /最多 40/);
  for (const storage of [
    { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); }, removeItem() { throw Error("blocked"); } },
    { getItem: () => "unchanged", setItem() {}, removeItem() {} }
  ]) {
    const profile = createStudentIdentityStore(storage);
    assert.throws(() => profile.save(data)); assert.throws(() => profile.clear());
  }
});

test("舊 worker 更新失敗或只剩部分新版快取時，不能載入混合版本", async () => {
  for (const names of [["outdoor-learning-day-v123"], ["outdoor-learning-day-v123", "outdoor-learning-day-v155"], ["outdoor-learning-day-v155"]]) {
    let opened = 0;
    const worker = { state: "redundant", addEventListener() {}, removeEventListener() {} };
    await assert.rejects(updateOfflineShell({ navigator: { serviceWorker: { controller: {}, register: async () => ({ installing: worker }),
      addEventListener() {}, removeEventListener() {} } },
      caches: { keys: async () => names, open: async () => { opened++; return { match: async () => null }; } } }), /worker update failed/);
    assert.equal(opened, 0);
  }
});

test("網絡斷線仍可用完整新版快取；不支援 worker 的首次瀏覽不阻止登入", async () => {
  const reads = [];
  await updateOfflineShell({ navigator: { serviceWorker: { controller: {}, register: async () => { throw Error("offline"); } } },
    caches: { keys: async () => ["outdoor-learning-day-v155", "other-project"], open: async name => {
      assert.equal(name, "outdoor-learning-day-v155"); return { match: async url => { reads.push(url); return true; } };
    } } });
  assert.equal(reads.length, 7); assert.ok(reads.every(url => !new URL(url).search));
  assert.ok(!reads.some(url => new URL(url).pathname.endsWith("/google-upload-auth.js")));
  for (const file of ["student-identity.js", "student-login-controller.js", "student-login-view.js", "check-in-sync.js"]) {
    assert.ok(reads.some(url => new URL(url).pathname.endsWith("/" + file)));
    await assert.rejects(updateOfflineShell({ navigator: { serviceWorker: { controller: {}, register: async () => { throw Error("offline"); } } },
      caches: { keys: async () => ["outdoor-learning-day-v155"], open: async () => ({ match: async url => !new URL(url).pathname.endsWith("/" + file) }) } }));
  }
  await updateOfflineShell({ navigator: {} });
});

function shellUpdateFixture({ initial = "installing", controlled = true } = {}) {
  function observable(values) {
    const target = new EventTarget(), listeners = new Set();
    return { ...values,
      addEventListener(type, listener) { listeners.add(listener); target.addEventListener(type, listener); },
      removeEventListener(type, listener) { listeners.delete(listener); target.removeEventListener(type, listener); },
      emit(type) { target.dispatchEvent(new Event(type)); },
      get listenerCount() { return listeners.size; }
    };
  }
  const previous = controlled ? { state: "activated" } : null;
  const worker = observable({ state: initial });
  const registration = { installing: initial === "installing" ? worker : null, waiting: null,
    active: initial === "installing" ? previous : worker, update: async () => registration };
  const serviceWorker = observable({ controller: previous, register: async () => registration });
  const fixture = { worker, registration, serviceWorker, names: ["outdoor-learning-day-v123"], missing: "", reads: [] };
  fixture.environment = { navigator: { serviceWorker }, caches: {
    keys: async () => fixture.names,
    open: async () => ({ match: async url => { fixture.reads.push(url); return !new URL(url).pathname.endsWith("/" + fixture.missing); } })
  } };
  fixture.activate = () => { registration.installing = null; registration.active = worker; worker.state = "activated"; worker.emit("statechange"); };
  fixture.claim = () => { fixture.names = ["outdoor-learning-day-v155", "other-project"]; serviceWorker.controller = worker; serviceWorker.emit("controllerchange"); };
  return fixture;
}

const settleShellUpdate = () => new Promise(resolve => setImmediate(resolve));

test("註冊先回覆舊 active worker，完成更新檢查及新版接管後首次載入繼續", async () => {
  const f = shellUpdateFixture();
  f.registration.installing = null;
  let finishUpdate;
  f.registration.update = () => new Promise(resolve => { finishUpdate = () => { f.registration.installing = f.worker; resolve(f.registration); }; });
  let status = "pending";
  const work = updateOfflineShell(f.environment).then(() => { status = "ready"; }, error => { status = error.message; });
  await settleShellUpdate();
  try {
    assert.equal(status, "pending", "更新檢查未完成時不能宣告載入失敗");
    finishUpdate(); await settleShellUpdate();
    f.activate(); await settleShellUpdate();
    assert.equal(status, "pending", "舊 controller 未交接時不能啟動控制器");
    f.claim(); await work;
    assert.equal(status, "ready"); assert.equal(f.reads.length, 7);
    assert.equal(f.worker.listenerCount + f.serviceWorker.listenerCount, 0);
  } finally { finishUpdate?.(); f.activate(); f.claim(); await work; }
});

test("完整離線資產安裝超過二十秒仍等待，接管後同一次載入成功", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = shellUpdateFixture();
  let status = "pending";
  const work = updateOfflineShell(f.environment).then(() => { status = "ready"; }, error => { status = error.message; });
  await settleShellUpdate(); t.mock.timers.tick(25_000); await settleShellUpdate();
  try {
    assert.equal(status, "pending", "仍在安裝的新版不能因二十秒期限失敗");
    f.activate(); await settleShellUpdate();
    assert.equal(status, "pending");
    f.claim(); await work;
    assert.equal(status, "ready"); assert.equal(f.worker.listenerCount + f.serviceWorker.listenerCount, 0);
  } finally { f.activate(); f.claim(); await work; }
});

for (const state of ["activating", "activated"]) test(`新版 ${state} 但尚未接管時，不能以三秒期限假稱完成`, async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = shellUpdateFixture({ initial: state });
  f.names = ["outdoor-learning-day-v155"];
  let status = "pending";
  const work = updateOfflineShell(f.environment).then(() => { status = "ready"; }, error => { status = error.message; });
  await settleShellUpdate(); f.activate(); t.mock.timers.tick(3001); await settleShellUpdate();
  try {
    assert.equal(status, "worker control timeout", "新版未接管時必須回報失敗");
    assert.equal(f.worker.listenerCount + f.serviceWorker.listenerCount, 0);
  } finally { f.claim(); await work; }
});

test("新版已啟用並在接管期限內取得頁面後才繼續", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = shellUpdateFixture({ initial: "activated" });
  let status = "pending";
  const work = updateOfflineShell(f.environment).then(() => { status = "ready"; }, error => { status = error.message; });
  await settleShellUpdate(); t.mock.timers.tick(2500); await settleShellUpdate();
  try {
    assert.equal(status, "pending");
    f.claim(); await work;
    assert.equal(status, "ready"); assert.equal(f.worker.listenerCount + f.serviceWorker.listenerCount, 0);
  } finally { f.claim(); await work; }
});

test("首次安裝接管後核對快取，更新後部分快取及真正安裝失敗仍拒絕載入", async () => {
  const first = shellUpdateFixture({ controlled: false });
  const installing = updateOfflineShell(first.environment);
  await settleShellUpdate(); first.activate(); first.claim(); await installing;
  assert.equal(first.reads.length, 7);
  assert.equal(first.worker.listenerCount + first.serviceWorker.listenerCount, 0);
  const partial = shellUpdateFixture(); partial.missing = "check-in-sync.js";
  const incomplete = assert.rejects(updateOfflineShell(partial.environment));
  await settleShellUpdate(); partial.activate(); partial.claim(); await incomplete;
  assert.equal(partial.worker.listenerCount + partial.serviceWorker.listenerCount, 0);
  const failed = shellUpdateFixture();
  const rejected = assert.rejects(updateOfflineShell(failed.environment));
  await settleShellUpdate(); failed.worker.state = "redundant"; failed.worker.emit("statechange"); await rejected;
  assert.equal(failed.worker.listenerCount + failed.serviceWorker.listenerCount, 0);
  await updateOfflineShell({ navigator: { serviceWorker: { controller: null, register: async () => { throw Error("unavailable"); } } } });
  await updateOfflineShell({ navigator: { serviceWorker: { controller: null, register: async () => ({ active: { state: "activated" } }) } } });
});

test("預演入口只接受五種定位情境，未知值不能改變連結目的地", () => {
  assert.deepEqual(REHEARSAL_SCENARIOS, ["within", "too-far", "inaccurate", "denied", "timeout"]);
  assert.deepEqual(REHEARSAL_SCENARIO_OPTIONS.map(option => option.value), REHEARSAL_SCENARIOS);
  assert.ok(Object.isFrozen(REHEARSAL_SCENARIO_OPTIONS) && REHEARSAL_SCENARIO_OPTIONS.every(Object.isFrozen));
  for (const value of REHEARSAL_SCENARIOS) {
    assert.equal(normalizeRehearsalScenario(value), value);
    assert.equal(rehearsalPageHref(value), `./device-test.html?scenario=${value}#itinerary`);
  }
  for (const value of [null, undefined, "", "unknown", "Within", "within&mode=diagnostics", "https://example.test", "<script>"]) {
    assert.equal(normalizeRehearsalScenario(value), "within");
    assert.equal(rehearsalPageHref(value), "./device-test.html?scenario=within#itinerary");
  }
});

test("活動日期、年份及下載檔名可跨月跨年，與裝置當前年份無關", () => {
  assert.deepEqual(activityDateLabels("2027-12-30T00:00:00+08:00", "2028-01-02T23:59:59+08:00"), {
    year: "2027", dateLabel: "2027年12月30日至2028年1月2日", filenamePrefix: "2027-12-30至2028-01-02"
  });
  assert.equal(activityDateLabels("2027-11-30T00:00:00+08:00", "2027-12-02T23:59:59+08:00").filenamePrefix, "2027-11-30至12-02");
  assert.equal(TRIP_DATA.dateLabel, "2026年11月5日至7日");
  assert.equal("filename" in TRIP_BOOKLET, false);
  for (const dates of [["invalid", TRIP_DATA.endAt], ["2027-02-29T00:00:00+08:00", "2027-03-01T00:00:00+08:00"], [TRIP_DATA.endAt, TRIP_DATA.startAt]]) {
    assert.throws(() => activityDateLabels(...dates));
  }
});

test("首頁活動日期及完成提示隨提供的活動／景點資料變更", () => {
  const views = createViews();
  const home = views.renderItinerary({ days: [], checkIns: {}, trip: { title: "合成測試", year: "2028", dateLabel: "2028年11月5日至7日", duration: "三天兩夜" } });
  assert.match(home, /2028年11月5日至7日/); assert.doesNotMatch(home, /2026年|2028 戶外學習日/);
  const itinerary = views.renderItinerary({ days: [], checkIns: {}, allCheckInsComplete: true, requiredCount: 4 });
  assert.match(itinerary, /<progress max="4" value="0"/); assert.match(itinerary, /製作五站打卡紀錄卡/);
  assert.doesNotMatch(itinerary, /AI 作品|素材包/);
});
