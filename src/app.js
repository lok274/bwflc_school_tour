import { updateOfflineShell } from "./app-settings.js?v=v156";
try {
  if (await updateOfflineShell()) {
    const { createAppController } = await import("./controller.js");
    await createAppController().start();
  }
} catch {
  document.querySelector("#app").textContent = "網站未能載入，請連線後重新載入。已保存的資料仍保留在此裝置。";
}
