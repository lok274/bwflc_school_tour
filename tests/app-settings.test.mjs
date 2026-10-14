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
  for (const names of [["outdoor-learning-day-v123"], ["outdoor-learning-day-v123", "outdoor-learning-day-v130"], ["outdoor-learning-day-v130"]]) {
    let opened = 0;
    const worker = { state: "redundant", addEventListener() {}, removeEventListener() {} };
    await assert.rejects(updateOfflineShell({ navigator: { serviceWorker: { controller: {}, register: async () => ({ installing: worker }) } },
      caches: { keys: async () => names, open: async () => { opened++; return { match: async () => null }; } } }));
    assert.equal(opened, names.length === 1 && names[0].endsWith("v130") ? 1 : 0);
  }
});

test("網絡斷線仍可用完整新版快取；不支援 worker 的首次瀏覽不阻止登入", async () => {
  const reads = [];
  await updateOfflineShell({ navigator: { serviceWorker: { controller: {}, register: async () => { throw Error("offline"); } } },
    caches: { keys: async () => ["outdoor-learning-day-v130", "other-project"], open: async name => {
      assert.equal(name, "outdoor-learning-day-v130"); return { match: async url => { reads.push(url); return true; } };
    } } });
  assert.equal(reads.length, 7); assert.ok(reads.every(url => !new URL(url).search));
  assert.ok(!reads.some(url => new URL(url).pathname.endsWith("/google-upload-auth.js")));
  for (const file of ["student-identity.js", "student-login-controller.js", "student-login-view.js", "check-in-sync.js"]) {
    assert.ok(reads.some(url => new URL(url).pathname.endsWith("/" + file)));
    await assert.rejects(updateOfflineShell({ navigator: { serviceWorker: { controller: {}, register: async () => { throw Error("offline"); } } },
      caches: { keys: async () => ["outdoor-learning-day-v130"], open: async () => ({ match: async url => !new URL(url).pathname.endsWith("/" + file) }) } }));
  }
  await updateOfflineShell({ navigator: {} });
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
  assert.match(itinerary, /四個景點各一張相片/); assert.match(itinerary, /學校相片選填/);
});
