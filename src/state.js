import { ATTRACTIONS, BUILTIN_CHECKLIST, TRIP_DATA } from "./data.js";

export const STORAGE_KEY = "outdoorLearningDay.v3";

export function createDefaultState() {
  return {
    version: 3,
    checklist: Object.fromEntries(BUILTIN_CHECKLIST.map((item) => [item.id, false])),
    customItems: [],
    checkIns: {},
    updatedAt: new Date(0).toISOString()
  };
}

const ATTRACTION_IDS = new Set(ATTRACTIONS.map((attraction) => attraction.id));

function canonicalCheckIn(value, attractionId) {
  if (!value || value.attractionId !== attractionId || !ATTRACTION_IDS.has(attractionId)) return null;
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

  const checklist = { ...base.checklist };
  for (const key of Object.keys(checklist)) checklist[key] = Boolean(raw.checklist?.[key]);

  const customItems = Array.isArray(raw.customItems)
    ? raw.customItems
        .filter((item) => item && typeof item.id === "string" && typeof item.label === "string")
        .map((item) => ({ id: item.id.slice(0, 80), label: item.label.trim().slice(0, 120), done: Boolean(item.done) }))
        .filter((item) => item.label)
        .slice(0, 30)
    : [];

  const checkIns = {};
  if (raw.checkIns && typeof raw.checkIns === "object") {
    for (const [key, value] of Object.entries(raw.checkIns)) {
      const checkIn = canonicalCheckIn(value, key);
      if (checkIn) checkIns[key] = checkIn;
    }
  }

  return {
    version: 3,
    checklist,
    customItems,
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

export function getTripPhase(now = new Date(), trip = TRIP_DATA) {
  const start = new Date(trip.startAt);
  const end = new Date(trip.endAt);
  const current = now instanceof Date ? now : new Date(now);

  if (current < start) {
    return {
      phase: "before",
      days: Math.max(1, Math.ceil((start.getTime() - current.getTime()) / 86_400_000)),
      label: "距離出發"
    };
  }
  if (current <= end) return { phase: "during", days: 0, label: "旅程進行中" };
  return { phase: "after", days: 0, label: "旅程已完成" };
}

export function checklistProgress(state) {
  const builtIn = Object.values(state.checklist);
  const custom = state.customItems.map((item) => item.done);
  const all = [...builtIn, ...custom];
  const done = all.filter(Boolean).length;
  return { done, total: all.length, percent: all.length ? Math.round((done / all.length) * 100) : 0 };
}
