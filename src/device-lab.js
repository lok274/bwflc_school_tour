// Update the shell before importing modules added after the existing cached app.
// Otherwise an older worker may return photos.js without createPhotoRepository.
async function updateOfflineShell() {
  if (!("serviceWorker" in navigator)) return;
  const previous = navigator.serviceWorker.controller;
  const registration = await navigator.serviceWorker.register(new URL("../sw.js", import.meta.url));
  const worker = registration.installing || registration.waiting;
  if (!worker) return;
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
    await new Promise((resolve) => {
      const timeout = setTimeout(finish, 3000);
      function finish() { clearTimeout(timeout); navigator.serviceWorker.removeEventListener("controllerchange", finish); resolve(); }
      navigator.serviceWorker.addEventListener("controllerchange", finish);
      if (navigator.serviceWorker.controller !== previous) finish();
    });
  }
}

// An offline registration error is harmless when the complete rehearsal shell is cached.
await updateOfflineShell().catch(() => {});
try {
  if (new URL(location.href).searchParams.get("mode") === "diagnostics") {
    document.body.dataset.testMode = "diagnostics";
    document.querySelector("#rehearsal-controls").hidden = true;
    document.querySelector(".bottom-nav").hidden = true;
    document.querySelector(".brand").href = "./#home";
    document.querySelector(".brand").setAttribute("aria-label", "返回正式旅程首頁");
    document.querySelector(".brand strong").textContent = "裝置診斷";
    document.querySelector(".brand small").textContent = "真實 GPS 與相機";
    document.title = "真實 GPS 與相機診斷 · 旅程測試頁";
    document.querySelector("#network-status").textContent = navigator.onLine ? "已連線" : "離線可用";
    const { createDeviceTestController } = await import("./device-test-controller.js");
    await createDeviceTestController().start();
  } else {
    if (!location.hash) location.hash = "#itinerary";
    const { createRehearsalController } = await import("./device-rehearsal.js");
    await createRehearsalController().start();
  }
} catch {
  document.querySelector("#app").textContent = "測試頁未能載入。請在有網絡時重新載入此頁，更新離線快取後再試。";
}
