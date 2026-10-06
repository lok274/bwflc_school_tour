import { DEVICE_TEST_LOCATION, DEVICE_TEST_STORAGE_KEY } from "./device-test-data.js";

function normalizeRecord(record) {
  if (!record || record.attractionId !== DEVICE_TEST_LOCATION.id ||
      typeof record.checkedInAt !== "string" || !["gps", "manual"].includes(record.method) || !Number.isFinite(Date.parse(record.checkedInAt))) return null;
  return Object.freeze({
    attractionId: DEVICE_TEST_LOCATION.id, checkedInAt: new Date(record.checkedInAt).toISOString(),
    method: record.method, verified: record.method === "gps" && record.verified === true
  });
}

// No reads, writes or clears of the real trip's storage key.
export function createDeviceTestStore({ storage, onError = () => {} }) {
  let checkIn = null;
  try { checkIn = normalizeRecord(JSON.parse(storage.getItem(DEVICE_TEST_STORAGE_KEY))); }
  catch { onError("未能讀取測試打卡；正式旅程資料沒有改動。"); }
  return {
    getCheckIn: () => checkIn,
    recordCheckIn(record) {
      const normalized = normalizeRecord(record);
      if (!normalized) return { accepted: false, saved: false };
      checkIn = normalized;
      try {
        storage.setItem(DEVICE_TEST_STORAGE_KEY, JSON.stringify(checkIn));
        return { accepted: true, saved: true };
      } catch { return { accepted: true, saved: false }; }
    },
    clearCheckIn() {
      storage.removeItem(DEVICE_TEST_STORAGE_KEY);
      checkIn = null;
    }
  };
}
