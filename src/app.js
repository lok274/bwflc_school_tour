import { updateOfflineShell } from "./app-settings.js?v=v151";
try {
  await updateOfflineShell();
  const { createAppController } = await import("./controller.js");
  await createAppController().start();
} catch {
  document.querySelector("#app").textContent = "網站未能載入，請連線後重新載入。";
}
