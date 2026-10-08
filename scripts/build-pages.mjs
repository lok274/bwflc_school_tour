import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPushPolicy } from "./configure-push.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = ["index.html", "device-test.html", "styles.css", "manifest.webmanifest", "sw.js",
  "src/app.js", "src/data.js", "src/geo.js", "src/state.js", "src/photos.js",
  "src/controller.js", "src/store.js", "src/page-models.js", "src/formatting.js", "src/views.js", "src/operations.js",
  "src/device-lab.js", "src/device-test-data.js", "src/device-test-store.js", "src/device-test-views.js", "src/device-test-controller.js",
  "src/feedback.js", "src/camera.js", "src/check-in.js", "src/photo-actions.js", "src/photo-archive.js", "src/card-reflection.js", "src/push-client.js", "src/push-config.js"];

async function assetFiles(directory) {
  const result = [];
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const relative = path.posix.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`不能發布符號連結：${relative}`);
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
  console.log(`已準備 ${published.length} 個網站資產至 _site；未包含通告原檔、測試、伺服器或個人紀錄。`);
}
