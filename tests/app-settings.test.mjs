import test from "node:test";
import assert from "node:assert/strict";
import { activityDateLabels } from "../src/app-settings.js";
import { TRIP_DATA, TRIP_BOOKLET } from "../src/data.js";
import { createViews } from "../src/views.js";
import { renderWorkbook } from "../src/workbook-views.js";
import { appHarness } from "./helpers/browser-environment.js";
import { memoryWorkbookRepository } from "./helpers/workbook-repository.js";

test("活動日期、年份及下載檔名可跨月跨年，與裝置當前年份無關", () => {
  assert.deepEqual(activityDateLabels("2027-12-30T00:00:00+08:00", "2028-01-02T23:59:59+08:00"), {
    year: "2027", dateLabel: "2027年12月30日至2028年1月2日", filenamePrefix: "2027-12-30至2028-01-02"
  });
  assert.equal(activityDateLabels("2027-11-30T00:00:00+08:00", "2027-12-02T23:59:59+08:00").filenamePrefix, "2027-11-30至12-02");
  assert.equal(TRIP_DATA.dateLabel, "2026年11月5日至7日");
  assert.equal(TRIP_BOOKLET.filename, "2026-11-05至07-學習交流團團刊.pdf");
  for (const dates of [["invalid", TRIP_DATA.endAt], ["2027-02-29T00:00:00+08:00", "2027-03-01T00:00:00+08:00"], [TRIP_DATA.endAt, TRIP_DATA.startAt]]) {
    assert.throws(() => activityDateLabels(...dates));
  }
});

test("首頁年份及完成提示隨提供的活動／景點資料變更", () => {
  const views = createViews();
  const home = views.renderHome({ trip: { title: "合成測試", year: "2028", dateLabel: "", duration: "" } });
  assert.match(home, /2028 戶外學習日/); assert.doesNotMatch(home, /2026 戶外學習日/);
  const itinerary = views.renderItinerary({ days: [], checkIns: {}, allCheckInsComplete: true, requiredCount: 4 });
  assert.match(itinerary, /四個景點須各選一張/); assert.match(itinerary, /第五張/);
});

test("備份預覽採用模型提供的欄位總數，沒有另寫固定總數", async () => {
  const app = appHarness({ hash: "#workbook", workbookRepository: memoryWorkbookRepository() });
  await app.controller.start();
  const model = { ...app.controller.getPageSnapshot(), backupOpen: true,
    restorePreview: { textCount: 1, totalTextCount: 3, ratingCount: 1, totalRatingCount: 2, limitError: "" } };
  assert.match(renderWorkbook(model), /已填 1／3 個文字欄及 1／2 項自評/);
});
