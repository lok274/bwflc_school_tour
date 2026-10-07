import { bundleWorker } from "./bundle-worker.mjs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const built = await bundleWorker();
if (!built.includes("PushService")) throw new Error("Worker build did not export the Durable Object.");
for (const file of ["admin.html", "admin.js", "admin.css"]) await readFile(path.join(root, "public", file));
console.log("Wrangler 已完成實際部署組態及 bundle 的 dry-run，管理頁資產齊備；没有部署、連接推送服務或載入正式密鑰。");
