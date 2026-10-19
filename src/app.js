import { updateOfflineShell } from "./app-settings.js?v=v157";
try {
  if (await updateOfflineShell()) {
    const { createAppController } = await import("./controller.js");
    await createAppController().start();
  }
} catch (error) {
  console.error("旅程載入失敗", error);
  document.querySelector("#app").textContent = "網站未能載入，請連線後重新載入。已保存的資料仍保留在此裝置。";
}
