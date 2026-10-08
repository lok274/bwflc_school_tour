import test from "node:test";
import assert from "node:assert/strict";
import { ATTRACTIONS, TRIP_DATA } from "../src/data.js";
import { evaluateGeofence, gcj02ToWgs84, haversineDistance } from "../src/geo.js";
import { loadState, normalizeState, saveState, STORAGE_KEY } from "../src/state.js";

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
  assert.equal(Object.hasOwn(TRIP_DATA, "fee"), false);
  assert.equal(Object.hasOwn(TRIP_DATA, "capacity"), false);
  assert.equal(TRIP_DATA.itinerary.length, 3);
});

test("五個景點都有完整導覽及地理設定", () => {
  assert.equal(ATTRACTIONS.length, 5);
  for (const attraction of ATTRACTIONS) {
    assert.ok(attraction.intro.length >= 85, `${attraction.name} 簡介過短`);
    assert.ok(attraction.observe.length > 12);
    assert.ok(attraction.prompt.length > 12);
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

test("舊準備資料被忽略，打卡沿用原儲存鍵且載入不改寫紀錄", () => {
  const storage = memoryStorage();
  const record = { attractionId: "future-school", checkedInAt: "2026-11-05T04:00:00.000Z", method: "manual", verified: false };
  const legacy = JSON.stringify({ version: 3, checklist: { health: true }, customItems: [{ id: "old", label: "舊提醒", done: true }], checkIns: { "future-school": record } });
  storage.setItem(STORAGE_KEY, legacy);
  const loaded = loadState(storage);
  assert.deepEqual(loaded.checkIns, { "future-school": record });
  assert.equal(Object.hasOwn(loaded, "checklist"), false);
  assert.equal(Object.hasOwn(loaded, "customItems"), false);
  assert.equal(storage.getItem(STORAGE_KEY), legacy);
  saveState(loaded, storage);
  const restored = loadState(storage);
  assert.deepEqual(restored.checkIns, loaded.checkIns);
  assert.equal(Object.hasOwn(JSON.parse(storage.getItem(STORAGE_KEY)), "checklist"), false);
  assert.equal(Object.hasOwn(JSON.parse(storage.getItem(STORAGE_KEY)), "customItems"), false);
});

test("損壞的本機紀錄安全回復，仍可儲存及載入打卡", () => {
  const storage = memoryStorage();
  storage.setItem(STORAGE_KEY, "{broken");
  assert.deepEqual(loadState(storage).checkIns, {});
  const normalized = normalizeState({ checkIns: { bad: { attractionId: "different" } }, updatedAt: "invalid" });
  assert.deepEqual(normalized.checkIns, {});
  assert.equal(normalized.updatedAt, "1970-01-01T00:00:00.000Z");
  saveState(normalized, storage);
  assert.deepEqual(loadState(storage).checkIns, {});
});
