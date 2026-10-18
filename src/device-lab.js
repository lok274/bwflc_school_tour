import { updateOfflineShell } from "./app-settings.js?v=v149";

try {
  await updateOfflineShell();
  if (new URL(location.href).searchParams.get("mode") === "diagnostics") {
    document.body.dataset.testMode = "diagnostics";
    document.querySelector("#rehearsal-controls").hidden = true;
    document.querySelector("#rehearsal-notice").hidden = true;
    document.querySelector(".bottom-nav").hidden = true;
    document.querySelector(".brand").href = "./#home";
    document.querySelector(".brand").setAttribute("aria-label", "返回正式旅程首頁");
    document.querySelector(".brand strong").textContent = "裝置診斷";
    document.querySelector(".brand small").textContent = "定位與相機測試";
    document.title = "定位與相機測試 · 旅程測試頁";
    document.querySelector("#network-status").textContent = navigator.onLine ? "已連線" : "離線可用";
    const { createDeviceTestController } = await import("./device-test-controller.js");
    await createDeviceTestController().start();
  } else {
    if (!location.hash) location.hash = "#itinerary";
    const { normalizeRehearsalScenario } = await import("./app-settings.js");
    const { createRehearsalController } = await import("./device-rehearsal.js");
    const scenario = normalizeRehearsalScenario(new URL(location.href).searchParams.get("scenario"));
    await createRehearsalController({ scenario }).start();
  }
} catch {
  document.querySelector("#app").textContent = "測試頁未能載入，請連線後重新載入。";
}
