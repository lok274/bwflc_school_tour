import test from "node:test";
import assert from "node:assert/strict";
import { ATTRACTIONS, BUILTIN_CHECKLIST, TRIP_DATA } from "../src/data.js";
import { evaluateGeofence, gcj02ToWgs84, haversineDistance } from "../src/geo.js";
import { checklistProgress, getTripPhase, loadState, normalizeState, saveState, STORAGE_KEY } from "../src/state.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

test("活動基本資料與通告一致", () => {
  assert.equal(TRIP_DATA.dateLabel, "2026年11月5日至7日");
  assert.equal(TRIP_DATA.fee, "港幣 700 元");
  assert.equal(TRIP_DATA.capacity, 120);
  assert.equal(TRIP_DATA.itinerary.length, 3);
  assert.deepEqual(TRIP_DATA.leaders, []);
  assert.deepEqual(TRIP_DATA.participants, []);
  assert.deepEqual(TRIP_DATA.cities, ["廣州", "東莞", "佛山", "中山"]);
});

test("五個景點都有完整導覽及地理設定", () => {
  assert.equal(ATTRACTIONS.length, 5);
  for (const attraction of ATTRACTIONS) {
    assert.ok(attraction.intro.length >= 85, `${attraction.name} 簡介過短`);
    assert.ok(attraction.observe.length > 12);
    assert.ok(attraction.prompt.length > 12);
    assert.equal(attraction.highlights.length, 3);
    assert.match(attraction.source.url, /^https:\/\//);
    assert.match(attraction.geo.sourceUrl, /^https:\/\//);
    assert.ok(attraction.geo.radiusM >= 150 && attraction.geo.radiusM <= 500);
  }
});

test("Haversine 距離計算能處理相同位置及一公里距離", () => {
  assert.equal(haversineDistance({ lat: 22.3, lng: 114.1 }, { lat: 22.3, lng: 114.1 }), 0);
  const distance = haversineDistance({ lat: 22.3, lng: 114.1 }, { lat: 22.309, lng: 114.1 });
  assert.ok(distance > 990 && distance < 1015);
});

test("GCJ-02 景點座標會轉成 WGS84 再核實", () => {
  const geo = ATTRACTIONS[0].geo;
  const wgs84 = gcj02ToWgs84(geo);
  const result = evaluateGeofence({ latitude: wgs84.lat, longitude: wgs84.lng, accuracy: 12 }, geo);
  assert.equal(result.status, "verified");
  assert.ok(result.distance < 5);
});

test("GPS 精確度不足會要求手動確認，明確在範圍外會拒絕", () => {
  const geo = { lat: 22.3, lng: 114.1, radiusM: 200, coordSystem: "WGS84" };
  assert.equal(evaluateGeofence({ latitude: 22.3, longitude: 114.1, accuracy: 250 }, geo).status, "inaccurate");
  assert.equal(evaluateGeofence({ latitude: 22.4, longitude: 114.1, accuracy: 10 }, geo).status, "too-far");
});

test("活動倒數可分辨出發前、進行中和完成後", () => {
  assert.equal(getTripPhase(new Date("2026-10-05T12:00:00+08:00")).phase, "before");
  assert.equal(getTripPhase(new Date("2026-11-06T12:00:00+08:00")).phase, "during");
  assert.equal(getTripPhase(new Date("2026-11-08T12:00:00+08:00")).phase, "after");
});

test("損壞的本機狀態會安全回復並限制自訂內容", () => {
  const normalized = normalizeState({
    checklist: { copies: 1 },
    customItems: [
      { id: "a", label: "  準備充電器  ", done: true },
      { id: null, label: "無效", done: false }
    ],
    checkIns: { bad: { attractionId: "different" } }
  });
  assert.equal(normalized.checklist.copies, true);
  assert.equal(normalized.customItems.length, 1);
  assert.equal(normalized.customItems[0].label, "準備充電器");
  assert.deepEqual(normalized.checkIns, {});
});

test("本機狀態能儲存、載入及計算清單進度", () => {
  const storage = memoryStorage();
  let state = loadState(storage);
  assert.equal(Object.keys(state.checklist).length, BUILTIN_CHECKLIST.length);
  state.checklist.copies = true;
  state.customItems.push({ id: "charger", label: "準備充電器", done: true });
  state = saveState(state, storage);
  assert.ok(storage.getItem(STORAGE_KEY));
  const restored = loadState(storage);
  const progress = checklistProgress(restored);
  assert.equal(progress.done, 2);
  assert.equal(progress.total, BUILTIN_CHECKLIST.length + 1);
});
