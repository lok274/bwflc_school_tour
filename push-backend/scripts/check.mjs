import { configureAdminRotation } from "./configure-admin-rotation.mjs";
import { bundleWorker } from "./bundle-worker.mjs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
await configureAdminRotation();
const [built, rotation] = await Promise.all([bundleWorker(), bundleWorker("admin-rotation/wrangler.jsonc")]);
if (!rotation.includes("AdminRotation")) throw new Error("Rotation Worker build did not export the Durable Object.");
if (!built.includes("PushService")) throw new Error("Worker build did not export the Durable Object.");
for (const file of ["admin.html", "admin.js", "admin.css"]) await readFile(path.join(root, "public", file));
console.log("Wrangler 已完成推送及憑證兩個 Worker 的部署組態與 bundle dry-run，管理頁資產齊備；没有部署、連接推送服務或載入正式密鑰。");
