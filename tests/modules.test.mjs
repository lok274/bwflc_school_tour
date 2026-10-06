import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createOperationGuard } from "../src/operations.js";
import { ATTRACTIONS } from "../src/data.js";
import { gcj02ToWgs84 } from "../src/geo.js";
import { appHarness, checkedState } from "./helpers/browser-environment.js";

const tick = () => new Promise(setImmediate);
const checkedInApp = (options = {}) => appHarness({ hash: "#attraction/future-school", initialState: checkedState(), ...options });
const selectPhoto = (app) => app.selectPhoto();

test("操作 token 分開控制單一景點、全部資料及重設鎖", async () => {
  let resetting = false;
  const guard = createOperationGuard({ isResetting: () => resetting });
  const first = guard.operationToken("first");
  const second = guard.operationToken("second");
  guard.invalidateAttractionOperations("first");
  assert.equal(guard.isCurrentOperation("first", first), false);
  assert.equal(guard.isCurrentOperation("second", second), true);
  guard.invalidateAllOperations();
  assert.equal(guard.isCurrentOperation("second", second), false);
  const fresh = guard.operationToken("first");
  resetting = true;
  assert.equal(guard.isCurrentOperation("first", fresh), false);
  resetting = false;
  assert.equal(guard.isCurrentOperation("first", fresh), true);
  let resolve;
  const work = guard.trackPhotoTask("first", new Promise((done) => { resolve = done; }));
  let waited = false;
  const waiting = guard.waitForPhotoTasks("first").then(() => { waited = true; });
  await tick();
  assert.equal(waited, false);
  resolve();
  await Promise.all([work, waiting]);
  assert.equal(waited, true);
});

test("相機權限晚於路由離開回覆時立即停止串流", async () => {
  const app = checkedInApp();
  let resolvePermission;
  let stopped = 0;
  app.environment.navigator.mediaDevices = {
    getUserMedia: () => new Promise((resolve) => { resolvePermission = resolve; })
  };
  const opening = app.click("camera-open", "future-school");
  app.navigate("#prepare");
  resolvePermission({ getTracks: () => [{ stop() { stopped += 1; } }] });
  await opening;
  assert.equal(stopped, 1);
  assert.equal(app.element("#camera-video").srcObject, null);
});

test("相機要求後置鏡頭且不開音訊；權限拒絕改用相簿", async () => {
  const app = checkedInApp();
  let constraints;
  let selected = false;
  app.element("#photo-input").click = () => { selected = true; };
  app.environment.navigator.mediaDevices = { getUserMedia: async (options) => {
    constraints = options;
    throw new Error("denied");
  } };
  await app.click("camera-open", "future-school");
  assert.equal(constraints.video.facingMode.ideal, "environment");
  assert.equal(constraints.audio, false);
  assert.equal(selected, true);
  assert.equal(app.element("#camera-dialog").open, false);
});

test("打卡接線只要求一次位置，核實後不保存座標", async () => {
  const app = appHarness({ hash: "#attraction/future-school" });
  let requests = 0;
  const centre = gcj02ToWgs84(ATTRACTIONS[0].geo);
  app.environment.navigator.geolocation = { getCurrentPosition(success, error, options) {
    requests += 1;
    assert.equal(options.timeout, 10000);
    success({ coords: { latitude: centre.lat, longitude: centre.lng, accuracy: 10 } });
  } };
  await app.click("checkin", "future-school");
  await app.click("checkin", "future-school");
  assert.equal(requests, 1);
  const stamp = app.controller.getPageSnapshot().checkIn;
  assert.equal(stamp.verified, true);
  assert.equal(stamp.method, "gps");
  assert.deepEqual(Object.keys(stamp).sort(), ["attractionId", "checkedInAt", "method", "verified"]);
});

test("位置拒絕可手動確認；明確太遠不提供繞過確認", async () => {
  const denied = appHarness({ hash: "#attraction/future-school" });
  denied.confirmation.handler = async () => true;
  denied.environment.navigator.geolocation = {
    getCurrentPosition(success, error) { error({ code: 1 }); }
  };
  await denied.click("checkin", "future-school");
  await tick();
  assert.equal(denied.controller.getPageSnapshot().checkIn.verified, false);
  const distant = appHarness({ hash: "#attraction/future-school" });
  let confirmations = 0;
  distant.confirmation.handler = async () => { confirmations += 1; return true; };
  distant.environment.navigator.geolocation = {
    getCurrentPosition(success) { success({ coords: { latitude: 0, longitude: 0, accuracy: 10 } }); }
  };
  await distant.click("checkin", "future-school");
  assert.equal(confirmations, 0);
  assert.equal(distant.controller.getPageSnapshot().checkIn, null);
});

test("取消打卡會等待正在壓縮的照片；過期照片不寫入", async () => {
  const app = checkedInApp();
  app.confirmation.handler = async () => true;
  let resolveCompression;
  let writes = 0;
  app.photoService.compressPhoto = () => new Promise((resolve) => { resolveCompression = resolve; });
  app.photoService.savePhotoRecord = async () => { writes += 1; };
  const processing = selectPhoto(app);
  await tick();
  const undoing = app.click("checkin-undo", "future-school");
  await tick();
  resolveCompression({ attractionId: "future-school", blob: new Blob(["pixels"]) });
  await Promise.all([processing, undoing]);
  assert.equal(writes, 0);
  assert.equal(app.controller.getPageSnapshot().checkIn, null);
});

test("已開始寫入的照片會在取消後清理，不會恢復已刪資料", async () => {
  const app = checkedInApp();
  app.environment.indexedDB = {};
  app.confirmation.handler = async () => true;
  let saved = null;
  let resolveSave;
  app.photoService.compressPhoto = async () => ({ attractionId: "future-school", blob: new Blob(["pixels"]) });
  app.photoService.savePhotoRecord = (record) => {
    saved = record;
    return new Promise((resolve) => { resolveSave = resolve; });
  };
  app.photoService.getPhotoRecord = async () => saved;
  app.photoService.deletePhotoRecord = async () => { saved = null; };
  const processing = selectPhoto(app);
  await tick();
  assert.ok(saved.writeId);
  const undoing = app.click("checkin-undo", "future-school");
  await tick();
  resolveSave();
  await Promise.all([processing, undoing]);
  assert.equal(saved, null);
  assert.equal(app.controller.getPageSnapshot().checkIn, null);
});

test("清除照片失敗時保留清單及打卡，不宣稱成功", async () => {
  const app = checkedInApp();
  app.environment.indexedDB = {};
  app.confirmation.handler = async () => true;
  app.photoService.clearPhotoRecords = async () => { throw new Error("storage failed"); };
  app.navigate("#home");
  await app.click("reset-all");
  assert.ok(app.savedState().checkIns["future-school"]);
  assert.notEqual(app.environment.localRemoved, true);
  assert.match(app.element("#toast").textContent, /未能清除/);
});

test("相片讀取失敗亦釋放舊 Blob URL", async () => {
  const revoked = [];
  const app = checkedInApp({ urlService: {
    createObjectURL: () => "blob:fixture",
    revokeObjectURL: (url) => revoked.push(url)
  } });
  app.photoService.getAllPhotoRecords = async () => [
    { attractionId: "future-school", blob: new Blob(["pixels"]) }
  ];
  await app.controller.start();
  assert.equal(Boolean(app.controller.getPageSnapshot().photo?.url), true);
  app.photoService.getAllPhotoRecords = async () => { throw new Error("storage failed"); };
  await app.controller.start();
  assert.deepEqual(revoked, ["blob:fixture"]);
  assert.equal(Boolean(app.controller.getPageSnapshot().photo?.url), false);
});

test("全部執行模組都在發布及離線精確白名單", async () => {
  const { readdir, mkdtemp, rm } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { buildPages } = await import("../scripts/build-pages.mjs");
  const temporary = await mkdtemp(path.join(os.tmpdir(), "modular-shell-test-"));
  try {
    const published = await buildPages(temporary);
    const worker = await readFile(new URL("../sw.js", import.meta.url), "utf8");
    for (const file of await readdir(new URL("../src/", import.meta.url))) {
      if (!file.endsWith(".js")) continue;
      assert.ok(published.includes(`src/${file}`), file);
      assert.ok(worker.includes(`"./src/${file}"`), file);
    }
    const entry = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
    assert.ok(entry.split("\n").length < 12);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
