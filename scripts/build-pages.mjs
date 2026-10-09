import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPushPolicy } from "./configure-push.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
// Only this user-approved original booklet may enter the public document directory.
const bookletFile = "public/documents/trip-booklet-2026.pdf";
const files = ["index.html", "device-test.html", "styles.css", "manifest.webmanifest", "sw.js",
  "src/app.js", "src/workbook-data.js", "src/workbook-storage.js", "src/workbook-controller.js", "src/workbook-views.js", "src/workbook-pdf.js", "src/vendor/fontkit-1.1.1.js", "src/vendor/fontkit-LICENSE.txt", "src/vendor/noto-sans-hk-regular.js", "src/vendor/NotoSansHK-LICENSE.txt", "src/vendor/pako-1.0.11.js", "src/vendor/pako-LICENSE.txt", "src/vendor/pdf-lib-1.17.1.js", "src/vendor/pdf-lib-LICENSE.txt", "src/vendor/README.txt", "src/data.js", "src/geo.js", "src/state.js", "src/photos.js",
  "src/controller.js", "src/store.js", "src/page-models.js", "src/formatting.js", "src/views.js", "src/operations.js",
  "src/device-lab.js", "src/device-rehearsal.js", "src/device-test-data.js", "src/device-test-store.js", "src/device-test-views.js", "src/device-test-controller.js",
  "src/feedback.js", "src/camera.js", "src/check-in.js", "src/photo-actions.js", "src/photo-archive.js", "src/card-reflection.js", "src/push-client.js", "src/push-config.js", bookletFile];

async function assetFiles(directory) {
  const result = [];
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const relative = path.posix.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`不能發布符號連結：${relative}`);
    if (relative === bookletFile && entry.isFile()) continue; // Already in the exact file whitelist.
    if (entry.isDirectory()) result.push(...await assetFiles(relative));
    else if (entry.isFile() && /\.(png|jpg|webp|svg)$/.test(entry.name)) result.push(relative);
    else throw new Error(`未批准的網站資產：${relative}`);
  }
  return result;
}

// Refuse stale output rather than accidentally publishing leftovers or secrets.
export async function buildPages(destination = path.join(root, "_site")) {
  await verifyPushPolicy(root);
  await mkdir(destination, { recursive: true });
  if ((await readdir(destination)).length) {
    throw new Error("發布目錄必須為空；請先移走先前產生的 _site，再重新執行。原有檔案未被覆蓋。");
  }
  const approved = [...files, ...await assetFiles("public")];
  for (const relative of approved) {
    const source = path.join(root, relative);
    if (!(await lstat(source)).isFile()) throw new Error(`不能發布非一般檔案：${relative}`);
    const target = path.join(destination, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target, constants.COPYFILE_EXCL);
  }
  return approved;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const published = await buildPages();
  console.log(`已準備 ${published.length} 個網站資產至 _site，包含使用者批准公開的原版團刊；未包含其他通告、測試、伺服器或個人旅程紀錄。`);
}
