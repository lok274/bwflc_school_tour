import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { appHarness, FIXTURE_IDENTITY, fillStudentIdentity, submitStudentIdentity } from "./helpers/browser-environment.js";
import { createRehearsalController, createRehearsalStorage, REHEARSAL_IDENTITY_KEY, REHEARSAL_SIGNED_OUT_KEY, REHEARSAL_INSTALL_KEY, REHEARSAL_STORAGE_KEY, REHEARSAL_SYNC_DATABASE } from "../src/device-rehearsal.js";
import { STUDENT_SIGNED_OUT_STORAGE_KEY } from "../src/student-login-controller.js";
import { STUDENT_IDENTITY_STORAGE_KEY } from "../src/student-identity.js";
import { createCheckInSync, createSyncRepository, SYNC_DATABASE_NAME, SYNC_UPLOAD_CUTOFF } from "../src/check-in-sync.js";
import { createRehearsalUpload } from "../src/rehearsal-upload.js";
import { STORAGE_KEY } from "../src/state.js";

const tick = () => new Promise(setImmediate);
async function until(condition) {
  const end = Date.now() + 3000;
  while (!condition()) { if (Date.now() > end) throw Error("等待模擬操作逾時"); await new Promise(resolve => setTimeout(resolve, 10)); }
}
function repository() {
  let data = null;
  return { read: async () => structuredClone(data), update: async change => {
    data = change(structuredClone(data)); return structuredClone(data);
  }, reset: async value => { data = structuredClone(value); return structuredClone(data); } };
}
function rehearsal({ remembered = false, failStorage = false } = {}) {
  const db = repository(), gps = [];
  let app;
  app = appHarness({ initialIdentity: FIXTURE_IDENTITY, hash: "#itinerary", controllerFactory: options => {
    const environment = options.environment;
    if (remembered) environment.localStorage.setItem(REHEARSAL_IDENTITY_KEY, JSON.stringify({ version: 1, ...FIXTURE_IDENTITY }));
    if (failStorage) environment.localStorage.setItem = () => { throw Error("合成容量錯誤"); };
    environment.crypto = { randomUUID };
    environment.Date = { now: () => Date.parse("2026-10-17T00:00:00Z") };
    environment.navigator.onLine = true;
    environment.Math = { random: () => 0 };
    environment.window.setTimeout = (callback, ms) => { if (ms > 120000) return null; const timer = setTimeout(callback, ms); timer.unref(); return timer; };
    environment.window.clearTimeout = clearTimeout;
    environment.fetch = () => assert.fail("測試上傳不可呼叫 fetch");
    environment.window.dispatchEvent = event => app.events.get(`window:${event.type}`)?.(event);
    return createRehearsalController({ ...options, syncRepository: db, schedule: callback => gps.push(callback) });
  } });
  return { ...app, db, gps };
}

test("測試身份、安裝及進度有精確獨立鍵，原生儲存事件只翻譯測試來源", () => {
  const values = new Map([[STUDENT_IDENTITY_STORAGE_KEY, "正式身份"], ["outdoorLearningDay.install.v1", "installed"], [STORAGE_KEY, "正式進度"]]);
  const raw = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const isolated = createRehearsalStorage(raw);
  for (const [logical, actual] of [[STORAGE_KEY, REHEARSAL_STORAGE_KEY], [STUDENT_IDENTITY_STORAGE_KEY, REHEARSAL_IDENTITY_KEY], [STUDENT_SIGNED_OUT_STORAGE_KEY, REHEARSAL_SIGNED_OUT_KEY], ["outdoorLearningDay.install.v1", REHEARSAL_INSTALL_KEY]]) {
    assert.equal(isolated.getItem(logical), undefined); isolated.setItem(logical, "測試"); assert.equal(values.get(actual), "測試");
    const mapped = isolated.mapEvent({ storageArea: raw, key: actual, newValue: "新測試", oldValue: null, url: "https://example.test/device-test.html" });
    assert.deepEqual(mapped, { key: logical, storageArea: isolated, newValue: "新測試", oldValue: null, url: "https://example.test/device-test.html" });
    assert.equal(isolated.mapEvent({ storageArea: raw, key: logical }), null);
    isolated.removeItem(logical);
  }
  assert.equal(values.get(STUDENT_IDENTITY_STORAGE_KEY), "正式身份"); assert.equal(values.get(STORAGE_KEY), "正式進度");
  assert.equal(values.get("outdoorLearningDay.install.v1"), "installed");
  assert.equal(isolated.mapEvent({ storageArea: {}, key: REHEARSAL_IDENTITY_KEY }), null);
  assert.equal(isolated.mapEvent({ key: REHEARSAL_IDENTITY_KEY }), null);
  assert.equal(isolated.mapEvent({ storageArea: raw, key: null }).key, null);
  assert.throws(() => isolated.removeItem("outdoorLearningDay.push.v1"));
});

test("正式身份不會登入測試，唯讀身份與登出登入都保留原紀錄且獨立", async () => {
  const app = rehearsal(); await app.controller.start();
  assert.equal(app.controller.getPageSnapshot().view, "login"); assert.match(app.element("#app").innerHTML, /虛構姓名/);
  await app.click("install-dismiss"); fillStudentIdentity(app); await submitStudentIdentity(app); await app.click("sync-dismiss");
  const original = app.environment.localStorage.getItem(STUDENT_IDENTITY_STORAGE_KEY);
  const remembered = app.environment.localStorage.getItem(REHEARSAL_IDENTITY_KEY);
  await app.click("student-profile-open"); assert.equal(app.controller.getPageSnapshot().mode, "profile");
  fillStudentIdentity(app, { ...FIXTURE_IDENTITY, studentNumber: "002" }); await submitStudentIdentity(app);
  await app.click("student-identity-return"); assert.equal(app.controller.getPageSnapshot().view, "itinerary");
  await app.click("student-profile-open"); app.confirmation.handler = async () => true; await app.click("student-identity-logout");
  assert.equal(app.controller.getPageSnapshot().mode, "signedOut");
  assert.equal(app.environment.localStorage.getItem(REHEARSAL_SIGNED_OUT_KEY), "1");
  assert.equal(app.environment.localStorage.getItem(STUDENT_SIGNED_OUT_STORAGE_KEY), null);
  assert.equal(app.environment.localStorage.getItem(REHEARSAL_IDENTITY_KEY), remembered);
  await app.click("student-identity-login"); assert.equal(app.controller.getPageSnapshot().view, "itinerary");
  assert.equal(app.environment.localStorage.getItem(REHEARSAL_SIGNED_OUT_KEY), null);
  assert.equal(app.environment.localStorage.getItem(STUDENT_IDENTITY_STORAGE_KEY), original);
});

test("測試身份保存失敗沿用本次使用流程，沒有偷偷保存身份到同步佇列", async () => {
  const app = rehearsal({ failStorage: true }); await app.controller.start(); await app.click("install-dismiss");
  fillStudentIdentity(app); await submitStudentIdentity(app);
  assert.equal(app.controller.getPageSnapshot().saveFailed, true);
  await app.click("student-identity-temporary");
  assert.equal(app.controller.getPageSnapshot().view, "itinerary"); assert.equal(app.controller.getPageSnapshot().sync.disabled, true);
  assert.equal(await app.db.read(), null);
});

test("正式及其他 storageArea 事件不關閉測試流程，測試身份跨分頁改動要求重新確認", async () => {
  const app = rehearsal({ remembered: true }); await app.controller.start(); await app.click("sync-dismiss");
  const dispatch = app.events.get("window:storage");
  await dispatch({ key: STUDENT_IDENTITY_STORAGE_KEY, storageArea: app.environment.localStorage });
  await dispatch({ key: REHEARSAL_IDENTITY_KEY, storageArea: {} });
  assert.equal(app.controller.getPageSnapshot().view, "itinerary");
  app.environment.localStorage.setItem(REHEARSAL_IDENTITY_KEY, JSON.stringify({ version: 1, ...FIXTURE_IDENTITY, studentNumber: "003" }));
  await dispatch({ key: REHEARSAL_IDENTITY_KEY, storageArea: app.environment.localStorage });
  assert.equal(app.controller.getPageSnapshot().view, "login"); assert.match(app.controller.getPageSnapshot().status, /已暫停操作/);
});

test("共用佇列可模擬啟用、離線保存、失敗、重試及清除，正式身份與進度保留", async () => {
  const app = rehearsal({ remembered: true }); await app.controller.start();
  assert.match(app.element("dialog").innerHTML, /在裝置內模擬/);
  await app.events.get("document:submit")({ target: { id: "check-in-sync-form", isConnected: true }, preventDefault() {} });
  await until(() => app.controller.getPageSnapshot().sync.enabled);
  app.controller.setUploadScenario("offline"); await app.click("checkin", "future-school"); app.gps.shift()(); await tick();
  await until(() => app.controller.getPageSnapshot().sync.pending === 1);
  const queued = (await app.db.read()).pending;
  app.controller.setUploadScenario("failure");
  await until(() => app.controller.getPageSnapshot().sync.reason.includes("未能連接模擬接收器"));
  assert.deepEqual((await app.db.read()).pending, queued);
  app.controller.setUploadScenario("success");
  await until(() => app.controller.getPageSnapshot().sync.status === "模擬已上傳");
  assert.equal(app.controller.getPageSnapshot().sync.pending, 0);
  app.confirmation.handler = async () => true; await app.click("reset-all");
  assert.equal(app.controller.getPageSnapshot().view, "login"); assert.equal((await app.db.read()).enrollment, null);
  assert.equal(app.environment.localStorage.getItem(REHEARSAL_STORAGE_KEY), null); assert.equal(app.environment.localStorage.getItem(REHEARSAL_IDENTITY_KEY), null);
  assert.ok(app.environment.localStorage.getItem(STUDENT_IDENTITY_STORAGE_KEY));
});

test("待傳交易提交後情境切換不會把同一紀錄重複計算", async () => {
  const saved = repository(), receiver = createRehearsalUpload(), sent = [];
  let pauseSave = false, committed, release;
  const commit = new Promise(resolve => { committed = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const db = { ...saved, update: async change => {
    const value = await saved.update(change);
    if (pauseSave && value.pending.length) { committed(); await gate; }
    return value;
  } };
  const environment = { crypto: { randomUUID }, navigator: { onLine: true } };
  const sync = createCheckInSync({ environment, repository: db, transport: (body, signal) => {
    if (body.action === "submit") sent.push(...body.events);
    return receiver.send(body, signal);
  },
    getIdentity: () => FIXTURE_IDENTITY, now: () => Date.parse("2026-10-17T00:00:00Z") });
  await sync.start(); await sync.enable(); environment.navigator.onLine = false; pauseSave = true;
  const pending = sync.enqueue({ attractionId: "future-school", checkedInAt: "2026-11-05T04:00:00.000Z", method: "manual", verified: false });
  await commit; sync.networkChanged(); release(); await pending; await sync.start();
  assert.equal((await saved.read()).pending.length, 1);
  assert.equal(sync.getState().pending, 1);
  assert.equal(sync.getState().unsaved, 0);
  environment.navigator.onLine = true; await sync.upload();
  assert.equal(sent.length, 1); assert.equal((await saved.read()).pending.length, 0);
});

test("模擬接收器的舊成功不越過情境切換或 Abort，重載後票證仍符合共用驗證", async () => {
  const receiver = createRehearsalUpload(), abort = new AbortController(), sessionId = randomUUID();
  const work = receiver.send({ action: "enable", sessionId }, abort.signal);
  receiver.setScenario("failure"); await assert.rejects(work, { name: "AbortError" });
  receiver.setScenario("success"); const cancelled = receiver.send({ action: "enable", sessionId }, abort.signal);
  abort.abort(); await assert.rejects(cancelled, { name: "AbortError" });
  const db = repository(), locks = [], channels = [];
  const environment = { crypto: { randomUUID }, navigator: { onLine: true, locks: { request: async (name, task) => { locks.push(name); return task(); } } },
    fetch: () => assert.fail("不可連線"), BroadcastChannel: class { constructor(name) { channels.push(name); } postMessage() {} } };
  const create = receiver => createCheckInSync({ environment, repository: db, databaseName: REHEARSAL_SYNC_DATABASE,
    transport: receiver.send, getIdentity: () => FIXTURE_IDENTITY, now: () => Date.parse("2026-10-17T00:00:00Z") });
  const first = create(receiver); await first.start(); assert.equal(await first.enable(), true); environment.navigator.onLine = false;
  await first.enqueue({ attractionId: "future-school", checkedInAt: "2026-11-05T04:00:00.000Z", method: "manual", verified: false });
  environment.navigator.onLine = true;
  const staleUpload = first.upload(); await tick(); receiver.setScenario("failure"); first.networkChanged(); await staleUpload;
  await until(() => !first.getState().busy && first.getState().reason.includes("模擬接收器"));
  assert.equal((await db.read()).pending.length, 1, "遲來成功不得清除失敗情境的待傳紀錄");
  first.invalidate();
  const reloaded = create(createRehearsalUpload()); await reloaded.start(); await reloaded.upload();
  assert.equal((await db.read()).pending.length, 0); assert.equal(reloaded.getState().status, "模擬已上傳");
  assert.ok(locks.every(name => name === REHEARSAL_SYNC_DATABASE)); assert.deepEqual(channels, [REHEARSAL_SYNC_DATABASE, REHEARSAL_SYNC_DATABASE]);
  assert.notEqual(REHEARSAL_SYNC_DATABASE, SYNC_DATABASE_NAME);
});

test("模擬傳輸仍核對回條，不完整確認不丟待傳；截止與逾時同用正式限制", async () => {
  const receiver = createRehearsalUpload(), db = repository(), environment = { crypto: { randomUUID }, navigator: { onLine: true } };
  let broken = false;
  const sync = createCheckInSync({ environment, repository: db, getIdentity: () => FIXTURE_IDENTITY,
    now: () => SYNC_UPLOAD_CUTOFF - 1000, transport: async (body, signal) => {
      const response = await receiver.send(body, signal);
      return broken ? { ok: true, text: async () => JSON.stringify({ version: 1, activityId: "wrong", ok: true, accepted: [] }) } : response;
    } });
  await sync.start(); await sync.enable(); environment.navigator.onLine = false;
  await sync.enqueue({ attractionId: "future-school", checkedInAt: "2026-11-05T04:00:00.000Z", method: "manual", verified: false });
  broken = true; environment.navigator.onLine = true; await sync.upload();
  assert.equal((await db.read()).pending.length, 1); assert.match(sync.getState().reason, /模擬接收器回覆不符/);
  const closed = createCheckInSync({ environment, repository: db, transport: receiver.send, getIdentity: () => FIXTURE_IDENTITY, now: () => SYNC_UPLOAD_CUTOFF });
  await closed.start(); assert.equal(closed.getState().closed, true); assert.equal(await closed.enable(), false);
  const timeout = createCheckInSync({ environment, repository: repository(), transport: receiver.send, getIdentity: () => FIXTURE_IDENTITY, requestTimeout: 1, now: () => SYNC_UPLOAD_CUTOFF - 1000 });
  await timeout.start(); assert.equal(await timeout.enable(), false); assert.match(timeout.getState().reason, /逾時/);
});

test("測試同步庫、manifest 啟動頁及離線白名單均獨立，CSP 禁止資料連線", async () => {
  let opened;
  const db = createSyncRepository({ open(name) { opened = name; const request = {}; queueMicrotask(() => request.onerror()); return request; } }, REHEARSAL_SYNC_DATABASE);
  await assert.rejects(db.read(), /未能開啟同步儲存/); assert.equal(opened, REHEARSAL_SYNC_DATABASE);
  const read = file => readFile(new URL(`../${file}`, import.meta.url), "utf8");
  const manifest = JSON.parse(await read("rehearsal.webmanifest"));
  assert.equal(manifest.id, "./device-test.html"); assert.equal(manifest.start_url, "./device-test.html#itinerary");
  assert.match(await read("device-test.html"), /connect-src 'none'/); assert.match(await read("device-test.html"), /href="\.\/rehearsal.webmanifest"/);
  for (const file of ["sw.js", "scripts/build-pages.mjs"]) { const source = await read(file); assert.match(source, /rehearsal\.webmanifest/); assert.match(source, /src\/rehearsal-upload\.js/); }
});
