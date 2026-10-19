// Shared UI rules. Activity content and persistent identifiers stay in their own data modules.
// Entry modules wait for a complete shell before importing application controllers.
// School-authorized test receiver; only enable after readable browser write receipts are verified.
export const CHECK_IN_SYNC_ENDPOINT = "https://script.google.com/macros/s/AKfycbxlkThys-ZGSMkGP9RgXhrCrWJsg9yVoC3XWIF_lFa-gxUWNzGmsW3pzpojqO9Wz1b4iA/exec";

export async function updateOfflineShell({ navigator, caches } = globalThis) {
  if (!("serviceWorker" in navigator)) return;
  const previous = navigator.serviceWorker.controller;
  let registration, failure;
  try {
    registration = await navigator.serviceWorker.register(new URL("../sw.js", import.meta.url), { updateViaCache: "none" });
    // Register can resolve before the browser's update check exposes an installing worker.
    if (previous && registration.active === previous && !registration.installing && !registration.waiting) await registration.update();
  } catch (error) {
    if (!navigator.serviceWorker.controller) return;
    failure = error;
  }
  if (!navigator.serviceWorker.controller && !registration?.installing && !registration?.waiting) return;
  const worker = registration?.installing || registration?.waiting || registration?.active;
  if (!worker) {
    if (!previous) return;
  } else {
    await new Promise((resolve, reject) => {
      let timeout;
      function finish(error) {
        clearTimeout(timeout);
        worker.removeEventListener("statechange", changed);
        navigator.serviceWorker.removeEventListener("controllerchange", changed);
        error ? reject(error) : resolve();
      }
      function changed() {
        if (worker.state === "redundant") finish(Error("worker update failed"));
        else if (worker.state === "activated") {
          if (navigator.serviceWorker.controller === worker) finish();
          else if (timeout === undefined) timeout = setTimeout(() => finish(Error("worker control timeout")), 3000);
        }
      }
      worker.addEventListener("statechange", changed);
      navigator.serviceWorker.addEventListener("controllerchange", changed);
      changed();
    });
  }
  // Continue offline only with the current shell, never mixed old/new modules.
  const cacheName = `outdoor-learning-day-${new URL(import.meta.url).searchParams.get("v") || "v153"}`;
  const names = await caches.keys();
  if (!names.includes(cacheName) || names.some(name => name.startsWith("outdoor-learning-day-") && name !== cacheName)) throw failure || Error("worker update required");
  const cache = await caches.open(cacheName);
  for (const file of ["./controller.js", "./app-settings.js", "./student-identity.js", "./student-login-controller.js", "./student-login-view.js", "./check-in-sync.js", "../styles.css"]) {
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
