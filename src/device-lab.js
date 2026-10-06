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

// An offline registration error is harmless when the complete v24 shell is already cached.
await updateOfflineShell().catch(() => {});
try {
  const { createDeviceTestController } = await import("./device-test-controller.js");
  await createDeviceTestController().start();
} catch {
  document.querySelector("#app").textContent = "測試頁未能載入。請在有網絡時重新載入此頁，更新離線快取後再試。";
}
