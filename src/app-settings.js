// Shared UI rules. Activity content and persistent identifiers stay in their own data modules.
// Entry modules wait for a complete shell before importing application controllers.
export async function updateOfflineShell({ navigator, caches } = globalThis) {
  if (!("serviceWorker" in navigator)) return;
  const previous = navigator.serviceWorker.controller;
  let failure;
  try {
    const registration = await navigator.serviceWorker.register(new URL("../sw.js", import.meta.url), { updateViaCache: "none" });
    const worker = registration.installing || registration.waiting;
    if (!worker) {
      if (!previous) return;
    } else {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => finish(Error("worker timeout")), 20_000);
        function finish(error) {
          clearTimeout(timeout);
          worker.removeEventListener("statechange", changed);
          error ? reject(error) : resolve();
        }
        function changed() {
          if (worker.state === "activated") finish();
          else if (worker.state === "redundant") finish(Error("worker update failed"));
        }
        worker.addEventListener("statechange", changed);
        changed();
      });
      if (previous && navigator.serviceWorker.controller === previous) {
        await new Promise(resolve => {
          const timeout = setTimeout(finish, 3000);
          function finish() { clearTimeout(timeout); navigator.serviceWorker.removeEventListener("controllerchange", finish); resolve(); }
          navigator.serviceWorker.addEventListener("controllerchange", finish);
          if (navigator.serviceWorker.controller !== previous) finish();
        });
      }
      return;
    }
  } catch (error) {
    if (!navigator.serviceWorker.controller) return;
    failure = error;
  }
  // Continue offline only with the current shell, never mixed old/new modules.
  const cacheName = `outdoor-learning-day-${new URL(import.meta.url).searchParams.get("v") || "v112"}`;
  const names = await caches.keys();
  if (!names.includes(cacheName) || names.some(name => name.startsWith("outdoor-learning-day-") && name !== cacheName)) throw failure || Error("worker update required");
  const cache = await caches.open(cacheName);
  for (const file of ["./controller.js", "./app-settings.js", "../styles.css"]) {
    if (!await cache.match(new URL(file, import.meta.url).href)) throw failure || Error("shell incomplete");
  }
}

export const PHOTO_PAGE_SIZE = 12;
export const REHEARSAL_SCENARIO_OPTIONS = Object.freeze([
  { value: "within", label: "在打卡範圍內" },
  { value: "too-far", label: "距離太遠" },
  { value: "inaccurate", label: "定位誤差太大" },
  { value: "denied", label: "拒絕位置權限" },
  { value: "timeout", label: "定位逾時" }
].map(Object.freeze));
export const REHEARSAL_SCENARIOS = Object.freeze(REHEARSAL_SCENARIO_OPTIONS.map(option => option.value));
export function normalizeRehearsalScenario(value) {
  return REHEARSAL_SCENARIOS.includes(value) ? value : "within";
}
export function rehearsalPageHref(scenario) {
  return `./device-test.html?scenario=${normalizeRehearsalScenario(scenario)}#itinerary`;
}
export const STUDENT_IDENTITY_LIMITS = Object.freeze({ studentName: 40, className: 20, studentNumber: 20 });
export const STUDENT_IDENTITY_LABELS = Object.freeze({ studentName: "姓名", className: "班別", studentNumber: "學號" });
export const STUDENT_IDENTITY_STORAGE_KEY = "outdoorLearningDay.identity.v1";

export function studentIdentityErrors(identity) {
  return Object.fromEntries(Object.entries(STUDENT_IDENTITY_LIMITS).flatMap(([key, max]) => {
    const text = typeof identity?.[key] === "string" ? identity[key].trim() : "";
    const message = !text || Array.from(text).length > max ? `請填寫${STUDENT_IDENTITY_LABELS[key]}（最多 ${max} 字）。`
      : /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(text) ? `「${STUDENT_IDENTITY_LABELS[key]}」有不支援的控制字元，請修改。` : "";
    return message ? [[key, message]] : [];
  }));
}

export function createStudentIdentityStore(storage) {
  return Object.freeze({
    read() {
      const raw = storage.getItem(STUDENT_IDENTITY_STORAGE_KEY);
      if (!raw) return null;
      if (raw.length > 4096) return null;
      try {
        const data = JSON.parse(raw);
        if (!data || Array.isArray(data) || data.version !== 1 || Object.keys(data).length !== 4
          || !Object.keys(STUDENT_IDENTITY_LIMITS).every(key => Object.hasOwn(data, key))) return null;
        return validateStudentIdentity(data);
      } catch { return null; }
    },
    save(identity) {
      const valid = validateStudentIdentity(identity);
      const value = JSON.stringify({ version: 1, ...valid });
      storage.setItem(STUDENT_IDENTITY_STORAGE_KEY, value);
      if (storage.getItem(STUDENT_IDENTITY_STORAGE_KEY) !== value) throw Error("未能記住學生資料。");
      return valid;
    },
    clear() {
      storage.removeItem(STUDENT_IDENTITY_STORAGE_KEY);
      if (storage.getItem(STUDENT_IDENTITY_STORAGE_KEY) != null) throw Error("未能清除學生資料。");
    }
  });
}

// Profile storage and local image exports share validation, never silent truncation.
export function validateStudentIdentity(identity) {
  const errors = studentIdentityErrors(identity);
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
  return Object.fromEntries(Object.keys(STUDENT_IDENTITY_LIMITS).map(key => {
    const text = typeof identity?.[key] === "string" ? identity[key].trim() : "";
    return [key, text];
  }));
}

// Use the activity's written local dates, independent of the device's time zone or current year.
export function activityDateLabels(startAt, endAt) {
  const dateParts = value => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("活動日期無效。");
    const date = value.slice(0, 10);
    if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("活動日期無效。");
    return { date, year: date.slice(0, 4), month: date.slice(5, 7), day: date.slice(8, 10) };
  };
  const start = dateParts(startAt), end = dateParts(endAt);
  if (Date.parse(endAt) < Date.parse(startAt) || end.date < start.date) throw new Error("活動結束日期不能早於開始日期。");
  const sameYear = start.year === end.year, sameMonth = sameYear && start.month === end.month;
  const endLabel = `${sameYear ? "" : `${end.year}年`}${sameMonth ? "" : `${Number(end.month)}月`}${Number(end.day)}日`;
  const endFilename = sameMonth ? end.day : sameYear ? `${end.month}-${end.day}` : end.date;
  return Object.freeze({ year: start.year, dateLabel: `${start.year}年${Number(start.month)}月${Number(start.day)}日至${endLabel}`,
    filenamePrefix: `${start.date}至${endFilename}` });
}
