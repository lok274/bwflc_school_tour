import { CHECK_IN_LOCATIONS } from "./data.js";

export const STORAGE_KEY = "outdoorLearningDay.v3";

export function createDefaultState() {
  return {
    version: 3,
    checkIns: {},
    updatedAt: new Date(0).toISOString()
  };
}

const CHECK_IN_IDS = new Set(CHECK_IN_LOCATIONS.map((attraction) => attraction.id));

function canonicalCheckIn(value, attractionId) {
  if (!value || value.attractionId !== attractionId || !CHECK_IN_IDS.has(attractionId)) return null;
  if (typeof value.checkedInAt !== "string" || !["gps", "manual"].includes(value.method)) return null;

  const checkedInAt = new Date(value.checkedInAt);
  if (Number.isNaN(checkedInAt.getTime())) return null;

  const verified = value.method === "gps";
  if (value.verified !== verified) return null;

  return {
    attractionId,
    checkedInAt: checkedInAt.toISOString(),
    method: value.method,
    verified
  };
}

function canonicalIso(value, fallback) {
  if (typeof value !== "string") return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

export function normalizeState(raw) {
  const base = createDefaultState();
  if (!raw || typeof raw !== "object") return base;

  const checkIns = {};
  if (raw.checkIns && typeof raw.checkIns === "object") {
    for (const [key, value] of Object.entries(raw.checkIns)) {
      const checkIn = canonicalCheckIn(value, key);
      if (checkIn) checkIns[key] = checkIn;
    }
  }

  return {
    version: 3,
    checkIns,
    updatedAt: canonicalIso(raw.updatedAt, base.updatedAt)
  };
}

export function loadState(storage = globalThis.localStorage) {
  try {
    const saved = storage?.getItem(STORAGE_KEY);
    return saved ? normalizeState(JSON.parse(saved)) : createDefaultState();
  } catch {
    return createDefaultState();
  }
}

export function saveState(state, storage = globalThis.localStorage) {
  const normalized = normalizeState({ ...state, updatedAt: new Date().toISOString() });
  storage?.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}
