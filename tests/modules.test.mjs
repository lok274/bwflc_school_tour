import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createOperationGuard } from "../src/operations.js";
import { createDataStore } from "../src/store.js";
import { STORAGE_KEY } from "../src/state.js";
import { ATTRACTIONS } from "../src/data.js";
import { gcj02ToWgs84 } from "../src/geo.js";
import { appHarness, checkedState, FIXTURE_IDENTITY, fillStudentIdentity, submitStudentIdentity } from "./helpers/browser-environment.js";
import { STUDENT_IDENTITY_STORAGE_KEY } from "../src/student-identity.js";
import { createAppController } from "../src/controller.js";
import { createCheckInSync, SYNC_ACTIVITY_ID, isGoogleReceiverUrl } from "../src/check-in-sync.js";
import { randomUUID, createHmac } from "node:crypto";
import vm from "node:vm";

const tick = () => new Promise(setImmediate);
const checkedInApp = (options = {}) => appHarness({ hash: "#attraction/future-school", initialState: checkedState(), ...options });
const selectPhoto = (app) => app.selectPhoto();

function syncFixture({ repo, profile, now = () => Date.now(), timeout = 10000 } = {}) {
  let data = null, writing = Promise.resolve(), blockWrite = false, handler;
  const repository = repo || { read: async () => structuredClone(data), update(change) {
    const next = writing.then(() => { if (blockWrite) throw Error("合成儲存失敗"); const changed = change(structuredClone(data)); data = changed; return structuredClone(data); });
    writing = next.catch(() => {}); return next;
  } };
  let identity = profile || { studentName: "合成學生", className: "測試班", studentNumber: "007" };
  const requests = [], navigator = { onLine: true };
  const environment = { navigator, crypto: { randomUUID }, fetch: async (_url, options) => {
    assert.equal(options.mode, "cors"); assert.equal(options.credentials, "omit"); assert.equal(options.cache, "no-store");
    assert.equal(options.headers["Content-Type"], "text/plain;charset=UTF-8");
    const body = JSON.parse(options.body); requests.push(body);
    if (handler) return handler(body, options);
    const result = body.action === "enable" ? { ticket: "synthetic-ticket", sessionId: body.sessionId, expiresAt: now() + 86400000 }
      : { sessionId: data.enrollment.sessionId, accepted: body.events.map(item => item.eventId) };
    return { ok: true, text: async () => JSON.stringify({ version: 1, activityId: SYNC_ACTIVITY_ID, ok: true, ...result }) };
  } };
  const sync = createCheckInSync({ environment, repository, getIdentity: () => identity, now, requestTimeout: timeout,
    endpoint: "https://script.google.com/macros/s/synthetic-fixture/exec" });
  const record = (id = "future-school", time = "2026-11-05T04:00:00.000Z") => ({ attractionId: id, checkedInAt: time, method: "manual", verified: false });
  return { sync, environment, requests, record, repository, get data() { return data; }, set handler(value) { handler = value; }, set blocked(value) { blockWrite = value; }, set identity(value) { identity = value; } };
}
const receipt = value => ({ ok: true, text: async () => JSON.stringify({ version: 1, activityId: SYNC_ACTIVITY_ID, ok: true, ...value }) });

test("只在本次使用的學生資料不經同步佇列偷偷保存，仍可離線打卡", async () => {
  let reads = 0, writes = 0;
  const app = appHarness({ initialIdentity: null, hash: "#itinerary", controllerFactory: options => createAppController({ ...options,
    syncEndpoint: "https://script.google.com/macros/s/fixture/exec", syncRepository: {
      read() { reads++; throw Error("不得讀取"); }, update() { writes++; throw Error("不得保存身份"); }
    } }) });
  await app.controller.start(); await app.click("install-dismiss");
  const set = app.environment.localStorage.setItem;
  app.environment.localStorage.setItem = (key, value) => { if (key === STUDENT_IDENTITY_STORAGE_KEY) throw Error("quota"); return set(key, value); };
  fillStudentIdentity(app); await submitStudentIdentity(app); await app.click("student-identity-temporary");
  app.confirmation.handler = async () => true; await app.click("checkin", "future-school"); await tick();
  assert.ok(app.savedState().checkIns["future-school"]); assert.equal(reads, 0); assert.equal(writes, 0);
  assert.equal(app.controller.getPageSnapshot().sync.disabled, true); assert.match(app.controller.getPageSnapshot().sync.reason, /先記住學生資料/);
  assert.equal(app.environment.localStorage.getItem(STUDENT_IDENTITY_STORAGE_KEY), null);
});


test("移除舊驗證票證只清帳戶及票證，待傳事件、身份和順序保留，可無碼重啟同步", async () => {
  const f = syncFixture(); await f.sync.start(); await f.sync.enable(); f.environment.navigator.onLine = false;
  await f.sync.enqueue(f.record()); await f.sync.enqueue(f.record(), "cancel");
  const original = structuredClone(f.data);
  await f.repository.update(value => { value.enrollment.account = { subject: "retired-test-account" }; value.enrollment.ticket = "retired-ticket"; return value; });
  await f.sync.stop(); f.environment.navigator.onLine = true; f.requests.length = 0; await f.sync.start();
  assert.equal(f.sync.getState().enabled, false); assert.equal(f.sync.getState().pending, 2); assert.equal(f.sync.getState().needsEnable, true);
  assert.equal(f.requests.length, 0); assert.deepEqual(f.data.pending, original.pending); assert.deepEqual(f.data.links, original.links);
  assert.equal(f.data.epoch, original.epoch); assert.equal(f.data.enrollment.sessionId, original.enrollment.sessionId);
  assert.deepEqual(f.data.enrollment.identity, original.enrollment.identity); assert.ok(!("account" in f.data.enrollment));
  assert.equal(f.data.enrollment.ticket, ""); assert.equal(f.data.enrollment.expiresAt, 0);
  await f.sync.enable(); await f.sync.upload();
  assert.equal(f.data.pending.length, 0); assert.deepEqual(f.requests.at(-1).events, original.pending);
  assert.equal(f.requests[0].action, "enable"); assert.equal(f.requests[0].version, 1);
});

test("舊驗證票證移除保存失敗不發上傳，不丟待傳；重試及過期空佇列仍可無碼啟用", async () => {
  const f = syncFixture(); await f.sync.start(); await f.sync.enable(); f.environment.navigator.onLine = false;
  await f.sync.enqueue(f.record());
  await f.repository.update(value => { value.enrollment.account = { subject: "retired-account" }; return value; });
  const queued = structuredClone(f.data.pending); await f.sync.stop(); f.environment.navigator.onLine = true; f.requests.length = 0;
  f.blocked = true; await f.sync.start(); assert.equal(await f.sync.upload(), false); assert.equal(f.requests.length, 0);
  assert.deepEqual(f.data.pending, queued); assert.equal(f.sync.getState().enabled, false);
  f.blocked = false; await f.sync.start(); await f.sync.enable(); await f.sync.upload(); assert.equal(f.data.pending.length, 0);
  await f.repository.update(value => { value.enrollment.expiresAt = 0; return value; });
  await f.sync.stop(); await f.sync.start();
  assert.equal(f.sync.getState().needsEnable, true); assert.equal(f.sync.getState().disabled, false);
});

test("學生頁及發布模組已移除 Google 登入及活動碼，保留手動上傳", async () => {
  const { access } = await import("node:fs/promises");
  await assert.rejects(access(new URL("../src/google-upload-auth.js", import.meta.url)));
  for (const file of ["src/controller.js", "src/check-in-sync.js", "src/home-views.js", "google/check-in-receiver.gs", "sw.js", "scripts/build-pages.mjs"]) {
    const source = await readFile(new URL("../" + file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /google-upload-auth|googleAuth|googleUploadCallback|GOOGLE_CLIENT_SECRET|OAuth2|needsSignIn|使用 Google 帳戶登入|sync-activity-code|needsCode|ACTIVITY_CODE|generateActivityCode|configureActivityCode/);
  }
});


test("同步未接通及預演均不讀正式佇列，不發 Google 請求", async () => {
  for (const testKind of [null, "rehearsal", "diagnostics"]) {
    const sync = createCheckInSync({ endpoint: testKind ? "https://script.google.com/macros/s/test/exec" : "", testKind,
      repository: { read() { throw Error("不得讀取"); } }, environment: { fetch() { throw Error("不得連線"); } } });
    await sync.start(); assert.equal(await sync.enable(), false); await sync.upload(); await sync.stop({ clear: true });
    assert.equal(sync.getState()?.disabled ?? true, true);
  }
  for (const value of ["https://evil.example/exec", "http://script.google.com/macros/s/id/exec", "https://script.google.com/macros/s/id/exec?secret=x", "https://script.google.com/macros/s/id/dev"]) assert.equal(isGoogleReceiverUrl(value), false);
});

test("無碼啟用失敗、連按、關閉及身份變更不保存舊許可，重新啟用可重試", async () => {
  const f = syncFixture(); await f.sync.start();
  f.handler = () => receipt({ ok: false, error: "FORMAT" });
  assert.equal(await f.sync.enable(), false); assert.equal(f.data, null);
  assert.match(f.sync.getState().reason, /核對接收程式是否已更新/);
  for (const change of ["close", "identity", "clear"]) {
    let release;
    f.handler = body => new Promise(resolve => { release = () => resolve(receipt({ sessionId: body.sessionId, ticket: "stale", expiresAt: Date.now() + 86400000 })); });
    const enabling = f.sync.enable(); await tick(); const count = f.requests.length;
    assert.equal(await f.sync.enable(), false); assert.equal(f.requests.length, count);
    if (change === "clear") await f.sync.stop({ clear: true });
    else if (change === "identity") f.identity = { studentName: "另一合成學生", className: "測試班", studentNumber: "008" };
    else f.sync.invalidate();
    release(); assert.equal(await enabling, false);
    assert.equal(f.data?.enrollment ?? null, null); assert.equal(f.sync.getState().enabled, false);
    await f.sync.start();
  }
  f.handler = null; assert.equal(await f.sync.enable(), true);
  assert.ok(f.requests.every(body => !("code" in body)));
});

test("只排啟用後的新打卡，自動與手動上傳共用鎖；確認後不重傳，不包含位置及相片", async () => {
  const f = syncFixture(); await f.sync.start();
  assert.equal(await f.sync.enqueue(f.record()), false); assert.equal(f.requests.length, 0);
  assert.equal(await f.sync.enable(), true); assert.equal(f.sync.getState().disabled, true);
  let release;
  f.handler = body => new Promise(resolve => { release = () => resolve(receipt({ sessionId: f.data.enrollment.sessionId, accepted: body.events.map(item => item.eventId) })); });
  await f.sync.enqueue({ ...f.record(), latitude: 1, longitude: 2, photo: "not allowed" });
  await tick(); const manual = f.sync.upload(); assert.equal(f.sync.upload(), manual); assert.equal(f.sync.getState().status, "上傳中");
  release(); await manual;
  assert.equal(f.requests.filter(item => item.action === "submit").length, 1);
  assert.equal(f.data.pending.length, 0); assert.equal(f.sync.getState().status, "已上傳");
  assert.equal(f.data.enrollment.identity.studentNumber, "007"); assert.ok(!("code" in f.requests[0]));
  assert.deepEqual(Object.keys(f.requests[1].events[0]).sort(), ["eventId", "sequence", "checkInId", "attractionId", "checkedInAt", "eventAt", "method", "verified", "action"].sort());
  await f.sync.upload(); assert.equal(f.requests.length, 2);
});

test("離線保存及重開补傳維持打卡、取消、重新打卡的先後與對應；舊打卡不能補傳取消", async () => {
  const f = syncFixture(); await f.sync.start(); await f.sync.enable(); f.environment.navigator.onLine = false;
  assert.equal(await f.sync.enqueue(f.record("sun-yat-sen"), "cancel"), true);
  assert.equal(f.data.pending.length, 0);
  await f.sync.enqueue(f.record()); await f.sync.enqueue(f.record(), "cancel"); await f.sync.enqueue(f.record("future-school", "2026-11-05T05:00:00.000Z"));
  assert.deepEqual(f.data.pending.map(item => item.sequence), [1, 2, 3]);
  assert.equal(f.data.pending[1].checkInId, f.data.pending[0].eventId);
  assert.equal(f.sync.getState().disabled, true); await f.sync.stop();
  f.environment.navigator.onLine = true; await f.sync.start(); await f.sync.upload();
  assert.equal(f.data.pending.length, 0); assert.deepEqual(f.requests.at(-1).events.map(item => item.action), ["checkin", "cancel", "checkin"]);
});

test("不明、錯誤、逾時或偽造確認保持相同事件 ID 待傳；只接受按順序的確認前綴", async () => {
  for (const kind of ["html", "opaque", "wrong-id", "wrong-session", "network", "timeout", "ticket"]) {
    const f = syncFixture({ timeout: 10 }); await f.sync.start(); await f.sync.enable();
    f.environment.navigator.onLine = false; await f.sync.enqueue(f.record()); f.environment.navigator.onLine = true;
    const id = f.data.pending[0].eventId;
    f.handler = (body, options) => {
      if (kind === "html") return { ok: true, text: async () => "<html>Google login</html>" };
      if (kind === "opaque") return { ok: true, type: "opaque" };
      if (kind === "network") throw new TypeError("Failed to fetch");
      if (kind === "timeout") return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(Object.assign(Error(), { name: "AbortError" }))));
      if (kind === "ticket") return receipt({ ok: false, error: "TICKET" });
      return receipt({ sessionId: kind === "wrong-session" ? "invalid" : f.data.enrollment.sessionId, accepted: [kind === "wrong-id" ? "invalid" : id] });
    };
    assert.equal(await f.sync.upload(), false, kind); assert.equal(f.data.pending[0].eventId, id, kind);
    assert.equal(f.sync.getState().status, "需要重試", kind);
    f.handler = null; await f.sync.upload(); assert.equal(f.data.pending.length, 0, kind);
  }
  const f = syncFixture(); await f.sync.start(); await f.sync.enable(); f.environment.navigator.onLine = false;
  await f.sync.enqueue(f.record()); await f.sync.enqueue(f.record("sun-yat-sen")); f.environment.navigator.onLine = true;
  f.handler = body => receipt({ sessionId: f.data.enrollment.sessionId, accepted: [body.events[0].eventId] });
  await f.sync.upload(); assert.equal(f.data.pending.length, 1); assert.match(f.sync.getState().reason, /部分紀錄已上傳/);
  f.handler = null; await f.sync.upload(); assert.equal(f.data.pending.length, 0);
});

test("本機保存失敗與 Google 失敗分開，重試不改事件；身份停止及清除後遲來回覆不恢復資料", async () => {
  const f = syncFixture(); await f.sync.start(); await f.sync.enable();
  f.environment.navigator.onLine = false; f.blocked = true;
  assert.equal(await f.sync.enqueue(f.record()), false); assert.match(f.sync.getState().reason, /未能保存待傳/); assert.equal(f.data.pending.length, 0);
  f.blocked = false; await f.sync.enqueue(f.record()); f.environment.navigator.onLine = true;
  f.blocked = true; await f.sync.upload(); assert.match(f.sync.getState().reason, /Google 已確認寫入.*裝置未能保存確認/); assert.equal(f.data.pending.length, 1);
  f.blocked = false;
  let release; f.handler = body => new Promise(resolve => { release = () => resolve(receipt({ sessionId: f.data.enrollment?.sessionId, accepted: body.events.map(item => item.eventId) })); });
  const uploading = f.sync.upload(); await tick();
  assert.match(await f.sync.pendingWarning(), /1 筆待傳/);
  await f.sync.stop({ clear: true }); release(); await uploading;
  assert.equal(f.data.pending.length, 0); assert.equal(f.data.enrollment, null);
  f.handler = null; f.identity = { studentName: "另一合成學生", className: "測試班", studentNumber: "008" };
  await f.sync.start(); assert.equal(f.sync.getState().enabled, false);
  await f.sync.enable(); assert.equal(f.data.enrollment.identity.studentNumber, "008");
  f.blocked = true; await assert.rejects(f.sync.stop({ clear: true })); assert.match(f.sync.getState().reason, /未能清除/);
});

async function receiverFixture() {
  const source = await readFile(new URL("../google/check-in-receiver.gs", import.meta.url), "utf8");
  let rows, failAppend = false, busy = false, signingFailure = false, appends = 0, failAt = 0, releases = 0;
  const properties = new Map([["ENABLED", "true"], ["SPREADSHEET_ID", "private-test-sheet"], ["SIGNING_KEY", "synthetic-secret-only-for-this-test-000"]]);
  const context = vm.createContext({ Date, Set, Array, Object, JSON, Number, Error,
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => {
      assert.ok(!/ACTIVITY_CODE/.test(key), "不得讀取已移除的活動碼設定"); return properties.get(key);
    } }) },
    LockService: { getScriptLock: () => ({ tryLock: timeout => { assert.equal(timeout, 10000); return !busy; }, releaseLock() { releases++; } }) },
    Utilities: { Charset: { UTF_8: "utf8" },
      computeHmacSha256Signature: (text, key) => {
        if (signingFailure) throw Error("API failure " + key);
        return [...createHmac("sha256", key).update(text).digest()];
      },
      base64EncodeWebSafe: text => Buffer.from(text).toString("base64url"),
      base64DecodeWebSafe: text => Buffer.from(text, "base64url"), newBlob: bytes => ({ getDataAsString: () => Buffer.from(bytes).toString("utf8") }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }) },
    Sheets: { Spreadsheets: { Values: { get: () => ({ values: rows }), append: (body, sheet, _range, options) => {
      assert.equal(sheet, "private-test-sheet"); assert.equal(options.valueInputOption, "RAW");
      appends++; if (failAppend || appends === failAt) throw Error("合成 Google 失敗"); rows.push(body.values[0]);
    } } } } });
  vm.runInContext(source, context);
  rows = JSON.parse(vm.runInContext("JSON.stringify([HEADERS_])", context));
  const send = body => context.doPost({ postData: { contents: JSON.stringify({ version: 1, activityId: SYNC_ACTIVITY_ID, ...body }) } });
  const identity = { studentName: '=IMPORTXML("https://invalid.example")', className: "測試班", studentNumber: "007" }, sessionId = randomUUID();
  const eventId = randomUUID(), parent = { eventId, checkInId: eventId, sequence: 1, attractionId: "future-school",
    checkedInAt: "2026-11-05T04:00:00.000Z", eventAt: "2026-11-05T04:00:00.000Z", method: "manual", verified: false, action: "checkin" };
  return { source, context, properties, rows, send, identity, sessionId, parent, get releases() { return releases; },
    set failAppend(value) { failAppend = value; }, set failAt(value) { failAt = value; },
    set busy(value) { busy = value; }, set signingFailure(value) { signingFailure = value; } };
}

test("Google 無碼啟用保留票證、順序及取消關聯；RAW 保留前置零並阻止公式，重試只寫一次", async () => {
  const r = await receiverFixture(), { send, identity, sessionId, parent, rows, properties } = r;
  const before = [...properties], enabled = send({ action: "enable", identity, sessionId });
  assert.equal(enabled.ok, true); assert.deepEqual([...properties], before); assert.equal(rows.length, 1);
  assert.ok(enabled.expiresAt > Date.now() + 6 * 86400000 && enabled.expiresAt <= Date.now() + 7 * 86400000);
  assert.equal(r.context.ticket_(enabled.ticket, r.context.PropertiesService.getScriptProperties()).expiresAt, enabled.expiresAt);
  const submit = events => send({ action: "submit", ticket: enabled.ticket, events });
  assert.equal(send({ action: "submit", ticket: enabled.ticket + "x", events: [parent] }).error, "TICKET");
  const tampered = JSON.parse(Buffer.from(enabled.ticket.split(".")[0], "base64url"));
  tampered.identity.studentNumber = "008";
  assert.equal(send({ action: "submit", ticket: Buffer.from(JSON.stringify(tampered)).toString("base64url") + "." + enabled.ticket.split(".")[1], events: [parent] }).error, "TICKET");
  assert.equal(submit([{ ...parent, latitude: 1 }]).error, "FORMAT");
  assert.equal(submit([{ ...parent, sequence: 2 }]).error, "ORDER");
  assert.equal(submit([parent]).ok, true); assert.equal(submit([parent]).ok, true); assert.equal(rows.length, 2);
  assert.equal(rows[1][0], identity.studentName); assert.equal(rows[1][2], "007");
  const cancel = { ...parent, eventId: randomUUID(), sequence: 2, action: "cancel" };
  assert.equal(submit([{ ...cancel, checkInId: randomUUID() }]).error, "ORDER");
  r.failAppend = true; assert.equal(submit([cancel]).error, "WRITE"); assert.equal(rows.length, 2);
  r.failAppend = false; assert.equal(submit([cancel]).ok, true); assert.equal(submit([cancel]).ok, true); assert.equal(rows.length, 3);
  assert.equal(rows[2][8], "取消"); assert.equal(rows[2][11], parent.eventId);
  assert.deepEqual([...properties], before);
  assert.ok(!/function doGet|no-cors|console\.|Logger\./.test(r.source));
});

test("無碼啟用仍核對身份、活動、欄位和簽章設定；不提供查詢或更改私人設定接口", async () => {
  const r = await receiverFixture(), { send, identity, sessionId, properties } = r, before = [...properties];
  assert.doesNotMatch(r.source, /ACTIVITY_CODE|activityCode|generateActivityCode|configureActivityCode|body\.code/);
  assert.equal(send({ action: "enable", identity: { ...identity, studentNumber: 7 }, sessionId }).error, "FORMAT");
  assert.equal(send({ action: "enable", identity: { ...identity, studentName: "x".repeat(41) }, sessionId }).error, "FORMAT");
  assert.equal(send({ action: "enable", identity: { ...identity, className: "測試\n班" }, sessionId }).error, "FORMAT");
  assert.equal(send({ action: "enable", identity, sessionId: "wrong" }).error, "FORMAT");
  assert.equal(send({ action: "enable", identity, sessionId, code: "unused" }).error, "FORMAT");
  assert.equal(send({ action: "enable", identity, sessionId, activityId: "other" }).error, "ACTIVITY");
  for (const action of ["generateActivityCode", "configureActivityCode", "getActivityCode", "query", "clear"]) {
    assert.equal(send({ action }).error, "FORMAT"); assert.deepEqual([...properties], before); assert.equal(r.rows.length, 1);
  }
  for (const key of ["", "short"]) {
    properties.set("SIGNING_KEY", key); assert.equal(send({ action: "enable", identity, sessionId }).error, "CONFIG");
  }
  properties.set("SIGNING_KEY", before.find(([key]) => key === "SIGNING_KEY")[1]);
  r.signingFailure = true;
  const failed = send({ action: "enable", identity, sessionId }); assert.equal(failed.error, "WRITE");
  assert.ok(!JSON.stringify(failed).includes(properties.get("SIGNING_KEY"))); assert.ok(!("ticket" in failed));
  r.signingFailure = false; properties.set("ENABLED", "false");
  assert.equal(send({ action: "enable", identity, sessionId }).error, "DISABLED"); assert.equal(r.rows.length, 1);
});

test("無碼上傳仍受操作鎖與去重保護；部分成功或欄位表錯誤不重寫既有紀錄", async () => {
  const r = await receiverFixture(), { send, identity, sessionId, parent, rows } = r;
  const enabled = send({ action: "enable", identity, sessionId });
  const submit = events => send({ action: "submit", ticket: enabled.ticket, events });
  r.busy = true; assert.equal(submit([parent]).error, "BUSY"); assert.equal(rows.length, 1); assert.equal(r.releases, 0);
  r.busy = false;
  const cancel = { ...parent, eventId: randomUUID(), sequence: 2, action: "cancel" };
  r.failAt = 2; assert.equal(submit([parent, cancel]).error, "WRITE"); assert.equal(rows.length, 2); assert.equal(r.releases, 1);
  r.failAt = 0; assert.equal(submit([parent, cancel]).ok, true); assert.equal(rows.length, 3);
  assert.equal(submit([parent, cancel]).ok, true); assert.equal(rows.length, 3);
  assert.equal(submit([{ ...cancel, eventId: randomUUID(), sequence: 3 }]).error, "ORDER");
  rows[0] = ["wrong"];
  assert.equal(submit([parent]).error, "CONFIG"); assert.equal(rows.length, 3);
});

test("應用接線：本機打卡後才排隊，取消另記事件；取消修改保留待傳，確認登出只清身份及佇列", async () => {
  const f = syncFixture({ profile: FIXTURE_IDENTITY }); await f.sync.start(); await f.sync.enable();
  const app = appHarness({ hash: "#itinerary", controllerFactory: options => {
    options.environment.crypto = { randomUUID }; options.environment.navigator.onLine = false;
    return createAppController({ ...options, syncEndpoint: "https://script.google.com/macros/s/fixture/exec", syncRepository: f.repository });
  } });
  app.confirmation.handler = async () => true; await app.controller.start();
  await app.click("checkin", "future-school"); await tick();
  assert.ok(app.savedState().checkIns["future-school"]); assert.equal(f.data.pending.length, 1);
  await app.click("checkin-undo", "future-school"); assert.equal(f.data.pending.length, 2); assert.equal(f.data.pending[1].action, "cancel");
  await app.click("checkin", "sun-yat-sen"); await tick(); assert.equal(f.data.pending.length, 3);
  await app.click("student-profile-open"); fillStudentIdentity(app, { ...FIXTURE_IDENTITY, studentName: "另一學生" });
  let warning; app.confirmation.handler = async options => { warning = options.message; return false; };
  await submitStudentIdentity(app); assert.match(warning, /3 筆待傳.*丟棄/); assert.equal(f.data.pending.length, 3);
  await app.click("student-identity-cancel"); assert.equal(f.data.pending.length, 3);
  await app.click("student-profile-open"); app.confirmation.handler = async options => { warning = options.message; return true; };
  await app.click("student-identity-logout"); assert.match(warning, /相片與打卡會保留.*3 筆待傳/);
  assert.equal(app.environment.localStorage.getItem(STUDENT_IDENTITY_STORAGE_KEY), null);
  assert.ok(app.savedState().checkIns["sun-yat-sen"]); assert.equal(f.data.pending.length, 0); assert.equal(f.data.enrollment, null);
});

test("待傳儲存失敗暫留記憶體，立即上傳可重新保存；票證到期再啟用不清佇列或改事件 ID", async () => {
  let clock = Date.now(); const f = syncFixture({ now: () => clock }); await f.sync.start(); await f.sync.enable();
  f.blocked = true; assert.equal(await f.sync.enqueue(f.record()), false);
  assert.equal(f.sync.getState().unsaved, 1); assert.equal(f.sync.getState().disabled, false); assert.match(f.sync.getState().reason, /離開或重載會遺失/);
  f.blocked = false; await f.sync.upload(); assert.equal(f.sync.getState().unsaved, 0); assert.equal(f.data.pending.length, 0);
  f.environment.navigator.onLine = false; await f.sync.enqueue(f.record("sun-yat-sen")); const eventId = f.data.pending[0].eventId;
  clock += 2 * 86400000; f.environment.navigator.onLine = true;
  assert.equal(await f.sync.upload(), false); assert.equal(f.sync.getState().needsEnable, true);
  const session = f.data.enrollment.sessionId; assert.equal(await f.sync.enable(), true); await f.sync.upload();
  assert.equal(f.data.enrollment.sessionId, session); assert.equal(f.data.pending.length, 0);
  assert.equal(f.requests.at(-1).events[0].eventId, eventId);
});

test("清除同步失敗不清旅程，仍需兩次確認；成功後清身份及佇列，警告 Google 紀錄保留", async () => {
  const f = syncFixture({ profile: FIXTURE_IDENTITY }); await f.sync.start(); await f.sync.enable();
  f.environment.navigator.onLine = false; await f.sync.enqueue(f.record());
  const app = appHarness({ initialState: checkedState(), hash: "#itinerary", controllerFactory: options => {
    options.environment.crypto = { randomUUID }; options.environment.navigator.onLine = false;
    return createAppController({ ...options, syncEndpoint: "https://script.google.com/macros/s/fixture/exec", syncRepository: f.repository });
  } });
  await app.controller.start(); const confirmations = [];
  app.confirmation.handler = async options => { confirmations.push(options.message); return true; };
  f.blocked = true; await app.click("reset-all"); assert.equal(confirmations.length, 2); assert.match(confirmations[0], /Google 已保存的紀錄.*保留/);
  assert.ok(app.savedState().checkIns["future-school"]); assert.equal(f.data.pending.length, 1);
  f.blocked = false; confirmations.length = 0; await app.click("reset-all");
  assert.equal(confirmations.length, 2); assert.deepEqual(app.savedState().checkIns, {}); assert.equal(f.data.pending.length, 0);
});

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
  app.navigate("#itinerary");
  resolvePermission({ getTracks: () => [{ stop() { stopped += 1; } }] });
  await opening;
  assert.equal(stopped, 1);
  assert.equal(app.element("#camera-video").srcObject, null);
});

test("相機要求後置鏡頭且不開音訊；權限拒絕不自動開啟選檔", async () => {
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
  assert.equal(selected, false);
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
  const app = checkedInApp({ hash: "#memories", urlService: {
    createObjectURL: () => "blob:fixture",
    revokeObjectURL: (url) => revoked.push(url)
  } });
  app.photoService.getAllPhotoRecords = async () => [
    { attractionId: "future-school", blob: new Blob(["pixels"]) }
  ];
  await app.controller.start();
  assert.equal(Boolean(app.controller.getPageSnapshot().albums[0]?.cover.url), true);
  app.photoService.getAllPhotoRecords = async () => { throw new Error("storage failed"); };
  await app.controller.start();
  assert.deepEqual(revoked, ["blob:fixture"]);
  assert.equal(Boolean(app.controller.getPageSnapshot().albums[0]?.cover.url), false);
});

for (const pending of [false, true]) test(`相片${pending ? "等待讀取" : "讀取失敗"}時取消打卡仍警告刪除相片，取消確認不刪資料`, async () => {
  const app = checkedInApp({ initialPhotos: [{ attractionId: "future-school", blob: new Blob(["saved"]) }] });
  app.environment.indexedDB = {};
  let release;
  app.photoService.getAllPhotoRecords = pending
    ? () => new Promise(resolve => { release = resolve; })
    : async () => { throw Error("read failure"); };
  const starting = app.controller.start();
  if (!pending) await starting;
  let message;
  app.confirmation.handler = async options => { message = options.message; return false; };
  await app.click("checkin-undo", "future-school");
  assert.match(message, /刪除本站全部紀念照.*無法復原.*已下載或分享的相片會保留/);
  assert.equal(app.photoData.size, 1);
  assert.ok(app.savedState().checkIns["future-school"]);
  if (pending) { release([...app.photoData.values()]); await starting; }
});

test("資料層拒絕以過期進度寫入，儲存未變或讀取失敗則保留未保存打卡", () => {
  let value = JSON.stringify(checkedState()), blocked = false;
  const storage = { getItem(key) { assert.equal(key, STORAGE_KEY); return value; },
    setItem(key, next) { if (blocked) throw Error("quota"); value = next; }, removeItem() { value = null; } };
  const store = createDataStore({ storage, onSaveError() {} });
  value = null;
  assert.equal(store.removeCheckIn("future-school"), false);
  assert.equal(value, null); assert.equal(store.hasCheckIn("future-school"), false);
  const record = checkedState(["sun-yat-sen"]).checkIns["sun-yat-sen"];
  blocked = true;
  assert.deepEqual(store.recordCheckIn("sun-yat-sen", record), { accepted: true, saved: false });
  assert.equal(store.syncProgress(), false); assert.equal(store.hasCheckIn("sun-yat-sen"), true);
  storage.getItem = () => { throw Error("blocked"); };
  assert.equal(store.syncProgress(), false); assert.equal(store.hasCheckIn("sun-yat-sen"), true);
  storage.getItem = () => value;
  value = JSON.stringify(checkedState(["shawan-town"]));
  assert.deepEqual(store.recordCheckIn("future-school", checkedState().checkIns["future-school"]), { accepted: false, saved: false });
  assert.equal(store.hasCheckIn("shawan-town"), true);
  assert.equal(store.hasCheckIn("sun-yat-sen"), false);
  assert.deepEqual(Object.keys(JSON.parse(value).checkIns), ["shawan-town"]);
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
    const version = worker.match(/CACHE_NAME[^\n]*v(\d+)/)[1];
    for (const name of ["index.html", "device-test.html", "src/app.js", "src/device-lab.js"]) {
      const text = await readFile(new URL(`../${name}`, import.meta.url), "utf8");
      const references = [...text.matchAll(/\?v=v(\d+)/g)].map(match => match[1]);
      assert.ok(references.length && references.every(value => value === version), `啟動版本不一致：${name}`);
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
