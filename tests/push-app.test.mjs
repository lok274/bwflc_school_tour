import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { createAppController } from "../src/controller.js";
import { STORAGE_KEY } from "../src/state.js";
import { appHarness, checkedState } from "./helpers/browser-environment.js";

const legacyKey = "outdoorLearningDay.push.v1";

test("通知已移除，裝置設定仍保留安裝、私隱及兩次確認清除", async () => {
  const app = appHarness({ initialState: checkedState() });
  await app.controller.start();
  const html = app.element("#app").innerHTML;
  assert.match(html, /<summary>裝置設定<\/summary>/);
  assert.match(html, /位置與相片不會上傳|data-reset-all/);
  assert.doesNotMatch(html, /手機通知|通知與裝置設定|data-push-|push-status|通知須另/);
  assert.equal("push" in app.controller.getPageSnapshot(), false);
  const original = app.environment.localStorage.getItem(STORAGE_KEY);
  let count = 0;
  app.confirmation.handler = async () => { count++; return count === 1; };
  await app.click("reset-all");
  assert.equal(count, 2);
  assert.equal(app.environment.localStorage.getItem(STORAGE_KEY), original);
});

test("只清除舊通知設定，不刪打卡、相片或其他同源資料", async () => {
  const photo = { attractionId: "future-school", photoId: "retirement-photo", writeId: "retirement-write", blob: new Blob(["synthetic"]), createdAt: "2026-11-05T04:00:00.000Z" };
  const app = appHarness({ initialState: checkedState(), initialPhotos: [photo] });
  app.environment.localStorage.setItem(legacyKey, JSON.stringify({ version: 1, active: { id: "synthetic" }, pending: [] }));
  app.environment.localStorage.setItem("unrelated-app", "keep");
  const original = app.environment.localStorage.getItem(STORAGE_KEY);
  await app.controller.start();
  assert.equal(app.environment.localStorage.getItem(legacyKey), null);
  assert.equal(app.environment.localStorage.getItem(STORAGE_KEY), original);
  assert.equal(app.environment.localStorage.getItem("unrelated-app"), "keep");
  assert.equal((await app.photoService.getAllPhotoRecords())[0].photoId, photo.photoId);
  assert.equal(app.savedState().checkIns["future-school"].method, "manual");
});

test("開始、重連、焦點及返回不要求通知權限或對外連線", async () => {
  const calls = [];
  const app = appHarness({ controllerFactory: options => {
    options.environment.fetch = async () => { calls.push("fetch"); throw Error("Unexpected network request"); };
    options.environment.Notification = { requestPermission: async () => { calls.push("permission"); return "granted"; } };
    return createAppController(options);
  } });
  await app.controller.start();
  for (const event of ["window:online", "window:focus", "window:pageshow", "document:visibilitychange"]) app.events.get(event)?.();
  await Promise.resolve();
  assert.deepEqual(calls, []);
});

test("舊通知設定讀取失敗不阻止行程啟動", async () => {
  const app = appHarness({ initialState: checkedState(), controllerFactory: options => {
    const storage = options.environment.localStorage;
    options.environment.localStorage = { ...storage, getItem: key => {
      if (key === legacyKey) throw Error("Storage unavailable");
      return storage.getItem(key);
    } };
    return createAppController(options);
  } });
  await app.controller.start();
  assert.equal(app.savedState().checkIns["future-school"].method, "manual");
});

test("通知模組、後台、設定工具及部署步驟不存在，網站禁止外部資料連線", async () => {
  for (const file of ["src/push-client.js", "src/push-config.js", "scripts/configure-push.mjs", "push-backend/package.json", "push-backend/public/admin.js", "push-backend/admin-rotation/worker.js"]) {
    await assert.rejects(stat(new URL("../" + file, import.meta.url)), { code: "ENOENT" });
  }
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /workers\.dev/);
  const workflow = await readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");
  assert.doesNotMatch(workflow, /push-backend|test:push|Worker bundle/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run build/);
  const controller = await readFile(new URL("../src/controller.js", import.meta.url), "utf8");
  assert.doesNotMatch(controller, /createPushClient|pushClientFactory|data-push-|requestPermission|showNotification/);
});
