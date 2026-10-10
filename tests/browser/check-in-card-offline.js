import { createWorkbookRepository } from "../../src/workbook-storage.js";
import { createPhotoRepository } from "../../src/photos.js";
import { createDefaultState, STORAGE_KEY } from "../../src/state.js";
import { REQUIRED_CHECK_IN_LOCATIONS } from "../../src/data.js";

document.getElementById("seed-checkin-offline").addEventListener("click", async event => {
  const result = document.getElementById("seed-result"); event.target.disabled = true;
  try {
    const current = await createWorkbookRepository().read(), photos = await createPhotoRepository().getAllPhotoRecords();
    if (localStorage.getItem(STORAGE_KEY) || photos.length || current.draft.photoIds.length || Object.values(current.draft.answers).some(Boolean)
      || Object.values(current.draft.ratings).some(value => value !== null)) throw Error("此 origin 已有資料，已停止，未改動原稿。");
    const state = createDefaultState();
    for (const [index, { id }] of REQUIRED_CHECK_IN_LOCATIONS.entries()) state.checkIns[id] = { attractionId: id, checkedInAt: `2026-11-0${index < 2 ? 5 : index < 4 ? 6 : 7}T04:00:00.000Z`, method: "manual", verified: false };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    const registration = await navigator.serviceWorker.register(new URL("../../sw.js", import.meta.url));
    if (!registration.active) await new Promise((resolve, reject) => {
      const worker = registration.installing || registration.waiting;
      worker.addEventListener("statechange", () => { if (worker.state === "activated") resolve(); if (worker.state === "redundant") reject(Error("離線快取失敗")); });
    });
    const cache = await caches.open("outdoor-learning-day-v85");
    for (const asset of ["index.html", "src/check-in-card.js", "src/check-in-card-controller.js", "src/local-font.js", "src/vendor/noto-sans-hk-regular.js", "src/vendor/fontkit-1.1.1.js"]) {
      if (!await cache.match(new URL("../../" + asset, import.meta.url))) throw Error("快取缺少 " + asset);
    }
    result.textContent = "已準備五站合成手動紀錄、零相片及 v85 離線快取。可前往旅途回憶，再停止本機伺服器驗證。";
    result.dataset.complete = "true";
  } catch (error) { result.textContent = error.message; }
});
