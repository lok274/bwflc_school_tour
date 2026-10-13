import test from "node:test";
import assert from "node:assert/strict";
import { activityDateLabels } from "../src/app-settings.js";
import { TRIP_DATA, TRIP_BOOKLET } from "../src/data.js";
import { createViews } from "../src/views.js";

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
