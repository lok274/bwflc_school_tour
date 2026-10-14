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
import { randomUUID, createHash, createHmac } from "node:crypto";
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

test("同步未接通及預演均不讀正式佇列，不發 Google 請求", async () => {
  for (const testKind of [null, "rehearsal", "diagnostics"]) {
    const sync = createCheckInSync({ endpoint: testKind ? "https://script.google.com/macros/s/test/exec" : "", testKind,
      repository: { read() { throw Error("不得讀取"); } }, environment: { fetch() { throw Error("不得連線"); } } });
    await sync.start(); assert.equal(await sync.enable("test"), false); await sync.upload(); await sync.stop({ clear: true });
    assert.equal(sync.getState()?.disabled ?? true, true);
  }
  for (const value of ["https://evil.example/exec", "http://script.google.com/macros/s/id/exec", "https://script.google.com/macros/s/id/exec?secret=x", "https://script.google.com/macros/s/id/dev"]) assert.equal(isGoogleReceiverUrl(value), false);
});

test("只排啟用後的新打卡，自動與手動上傳共用鎖；確認後不重傳，不包含位置及相片", async () => {
  const f = syncFixture(); await f.sync.start();
  assert.equal(await f.sync.enqueue(f.record()), false); assert.equal(f.requests.length, 0);
  assert.equal(await f.sync.enable("synthetic-code"), true); assert.equal(f.sync.getState().disabled, true);
  let release;
  f.handler = body => new Promise(resolve => { release = () => resolve(receipt({ sessionId: f.data.enrollment.sessionId, accepted: body.events.map(item => item.eventId) })); });
  await f.sync.enqueue({ ...f.record(), latitude: 1, longitude: 2, photo: "not allowed" });
  await tick(); const manual = f.sync.upload(); assert.equal(f.sync.upload(), manual); assert.equal(f.sync.getState().status, "上傳中");
  release(); await manual;
  assert.equal(f.requests.filter(item => item.action === "submit").length, 1);
  assert.equal(f.data.pending.length, 0); assert.equal(f.sync.getState().status, "已上傳");
  assert.equal(f.data.enrollment.identity.studentNumber, "007"); assert.ok(!JSON.stringify(f.data).includes("synthetic-code"));
  assert.deepEqual(Object.keys(f.requests[1].events[0]).sort(), ["eventId", "sequence", "checkInId", "attractionId", "checkedInAt", "eventAt", "method", "verified", "action"].sort());
  await f.sync.upload(); assert.equal(f.requests.length, 2);
});

test("離線保存及重開补傳維持打卡、取消、重新打卡的先後與對應；舊打卡不能補傳取消", async () => {
  const f = syncFixture(); await f.sync.start(); await f.sync.enable("test"); f.environment.navigator.onLine = false;
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
  for (const kind of ["html", "opaque", "wrong-id", "wrong-session", "network", "timeout", "code"]) {
    const f = syncFixture({ timeout: 10 }); await f.sync.start(); await f.sync.enable("test");
    f.environment.navigator.onLine = false; await f.sync.enqueue(f.record()); f.environment.navigator.onLine = true;
    const id = f.data.pending[0].eventId;
    f.handler = (body, options) => {
      if (kind === "html") return { ok: true, text: async () => "<html>Google login</html>" };
      if (kind === "opaque") return { ok: true, type: "opaque" };
      if (kind === "network") throw new TypeError("Failed to fetch");
      if (kind === "timeout") return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(Object.assign(Error(), { name: "AbortError" }))));
      if (kind === "code") return receipt({ ok: false, error: "TICKET" });
      return receipt({ sessionId: kind === "wrong-session" ? "invalid" : f.data.enrollment.sessionId, accepted: [kind === "wrong-id" ? "invalid" : id] });
    };
    assert.equal(await f.sync.upload(), false, kind); assert.equal(f.data.pending[0].eventId, id, kind);
    assert.equal(f.sync.getState().status, "需要重試", kind);
    f.handler = null; await f.sync.upload(); assert.equal(f.data.pending.length, 0, kind);
  }
  const f = syncFixture(); await f.sync.start(); await f.sync.enable("test"); f.environment.navigator.onLine = false;
  await f.sync.enqueue(f.record()); await f.sync.enqueue(f.record("sun-yat-sen")); f.environment.navigator.onLine = true;
  f.handler = body => receipt({ sessionId: f.data.enrollment.sessionId, accepted: [body.events[0].eventId] });
  await f.sync.upload(); assert.equal(f.data.pending.length, 1); assert.match(f.sync.getState().reason, /部分紀錄已上傳/);
  f.handler = null; await f.sync.upload(); assert.equal(f.data.pending.length, 0);
});

test("本機保存失敗與 Google 失敗分開，重試不改事件；身份停止及清除後遲來回覆不恢復資料", async () => {
  const f = syncFixture(); await f.sync.start(); await f.sync.enable("test");
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
  await f.sync.enable("test"); assert.equal(f.data.enrollment.identity.studentNumber, "008");
  f.blocked = true; await assert.rejects(f.sync.stop({ clear: true })); assert.match(f.sync.getState().reason, /未能清除/);
});

test("Google 接收程式驗證票證、順序及取消關聯；RAW 保留前置零並阻止公式，重試只寫一次", async () => {
  const source = await readFile(new URL("../google/check-in-receiver.gs", import.meta.url), "utf8");
  let rows, failAppend = false;
  const properties = new Map([["ENABLED", "true"], ["SPREADSHEET_ID", "private-test-sheet"], ["SIGNING_KEY", "synthetic-secret-only-for-this-test-000"], ["ACTIVITY_CODE_HASH", createHash("sha256").update("synthetic-code").digest("hex")]]);
  const context = vm.createContext({ Date, Set, Array, Object, JSON, Number, Error,
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties.get(key), setProperty: (key, value) => properties.set(key, value),
      setProperties: (values, deleteAllOthers) => { assert.equal(deleteAllOthers, false); for (const [key, value] of Object.entries(values)) properties.set(key, value); },
      deleteProperty: key => properties.delete(key) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: { getUuid: randomUUID, Charset: { UTF_8: "utf8" }, DigestAlgorithm: { SHA_256: "sha256" },
      computeDigest: (algorithm, text) => [...createHash(algorithm).update(text).digest()],
      computeHmacSha256Signature: (text, key) => [...createHmac("sha256", key).update(text).digest()],
      base64EncodeWebSafe: text => Buffer.from(typeof text === "string" ? text : text).toString("base64url"),
      base64DecodeWebSafe: text => Buffer.from(text, "base64url"), newBlob: bytes => ({ getDataAsString: () => Buffer.from(bytes).toString("utf8") }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }) },
    Sheets: { Spreadsheets: { Values: { get: () => ({ values: rows }), append: (body, sheet, _range, options) => {
      assert.equal(sheet, "private-test-sheet"); assert.equal(options.valueInputOption, "RAW"); if (failAppend) throw Error("合成 Google 失敗"); rows.push(body.values[0]);
    } } } } });
  vm.runInContext(source, context);
  rows = JSON.parse(vm.runInContext("JSON.stringify([HEADERS_])", context));
  const send = body => context.doPost({ postData: { contents: JSON.stringify({ version: 1, activityId: SYNC_ACTIVITY_ID, ...body }) } });
  const sessionId = randomUUID(), identity = { studentName: "=IMPORTXML(\"https://invalid.example\")", className: "測試班", studentNumber: "007" };
  assert.equal(send({ action: "enable", code: "wrong", identity, sessionId }).error, "CODE");
  const enabled = send({ action: "enable", code: "synthetic-code", identity, sessionId }); assert.equal(enabled.ok, true);
  const signingKey = properties.get("SIGNING_KEY"), issuedCodes = new Set(["synthetic-code"]);
  let oldCode = "synthetic-code";
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.equal(context.generateActivityCode(), undefined);
    const code = properties.get("CURRENT_ACTIVITY_CODE");
    assert.match(code, /^BW-[A-Za-z0-9_-]{20}$/); assert.ok(!issuedCodes.has(code)); issuedCodes.add(code);
    assert.equal(properties.get("ACTIVITY_CODE_HASH"), createHash("sha256").update(code).digest("hex"));
    assert.equal(send({ action: "enable", code: oldCode, identity, sessionId }).error, "CODE");
    const response = send({ action: "enable", code, identity, sessionId }); assert.equal(response.ok, true);
    assert.ok(!JSON.stringify(response).includes(code)); assert.equal(response.expiresAt, JSON.parse(Buffer.from(response.ticket.split(".")[0], "base64url")).expiresAt);
    for (const action of ["generateActivityCode", "configureActivityCode", "getActivityCode"]) {
      const before = [...properties]; const rejected = send({ action });
      assert.equal(rejected.error, "FORMAT"); assert.deepEqual([...properties], before); assert.ok(!JSON.stringify(rejected).includes(code));
    }
    assert.equal(properties.get("SIGNING_KEY"), signingKey); assert.equal(properties.get("SPREADSHEET_ID"), "private-test-sheet");
    assert.equal(properties.get("ENABLED"), "true"); assert.equal(rows.length, 1); oldCode = code;
  }
  assert.equal(context.ticket_(enabled.ticket, context.PropertiesService.getScriptProperties()).expiresAt, enabled.expiresAt);
  const id = randomUUID(), parent = { eventId: id, checkInId: id, sequence: 1, attractionId: "future-school", checkedInAt: "2026-11-05T04:00:00.000Z", eventAt: "2026-11-05T04:00:00.000Z", method: "manual", verified: false, action: "checkin" };
  const submit = events => send({ action: "submit", ticket: enabled.ticket, events });
  assert.equal(send({ action: "submit", ticket: enabled.ticket + "x", events: [parent] }).error, "TICKET");
  assert.equal(submit([{ ...parent, latitude: 1 }]).error, "FORMAT");
  assert.equal(submit([{ ...parent, sequence: 2 }]).error, "ORDER");
  assert.equal(submit([parent]).ok, true); assert.equal(submit([parent]).ok, true); assert.equal(rows.length, 2);
  assert.equal(rows[1][0], identity.studentName); assert.equal(rows[1][2], "007");
  const cancel = { ...parent, eventId: randomUUID(), sequence: 2, action: "cancel" };
  assert.equal(submit([{ ...cancel, checkInId: randomUUID() }]).error, "ORDER");
  failAppend = true; assert.equal(submit([cancel]).error, "WRITE"); assert.equal(rows.length, 2);
  failAppend = false; assert.equal(submit([cancel]).ok, true); assert.equal(submit([cancel]).ok, true); assert.equal(rows.length, 3);
  assert.equal(rows[2][8], "取消"); assert.equal(rows[2][11], id);
  properties.set("ENABLED", "false"); assert.equal(submit([parent]).error, "DISABLED");
  assert.equal(send({ action: "configureActivityCode" }).error, "DISABLED");
  properties.set("ENABLED", "true"); assert.equal(send({ action: "configureActivityCode" }).error, "FORMAT");
  properties.set("ACTIVITY_CODE", "新的合成活動碼"); context.configureActivityCode();
  assert.equal(properties.has("ACTIVITY_CODE"), false);
  assert.equal(properties.get("CURRENT_ACTIVITY_CODE"), "新的合成活動碼");
  assert.equal(properties.get("ACTIVITY_CODE_HASH"), createHash("sha256").update("新的合成活動碼").digest("hex"));
  assert.equal(send({ action: "enable", code: "synthetic-code", identity, sessionId }).error, "CODE");
  assert.equal(send({ action: "enable", code: oldCode, identity, sessionId }).error, "CODE");
  assert.equal(send({ action: "enable", code: "新的合成活動碼", identity, sessionId }).ok, true);
  assert.equal(submit([parent]).ok, true); assert.equal(rows.length, 3); assert.equal(properties.get("SIGNING_KEY"), signingKey);
  assert.ok(!/function doGet|no-cors|console\.|Logger\./.test(source));
});

test("產生及手動設定活動碼受同一鎖保護，保存或核對失敗還原，無法還原時不冒稱成功", async () => {
  const source = await readFile(new URL("../google/check-in-receiver.gs", import.meta.url), "utf8");
  const initial = [["ACTIVITY_CODE_HASH", createHash("sha256").update("old-synthetic-code").digest("hex")],
    ["CURRENT_ACTIVITY_CODE", "old-synthetic-code"], ["ACTIVITY_CODE", "manual-synthetic-code"],
    ["SIGNING_KEY", "unchanged-synthetic-secret"], ["SPREADSHEET_ID", "unchanged-sheet"], ["ENABLED", "true"]];
  for (const entrypoint of ["generateActivityCode", "configureActivityCode"]) {
    for (const fault of ["busy", "save", "partial", "readback", "delete", "rollback"]) {
      const properties = new Map(initial); let releases = 0, uuidCalls = 0, saved = false, failed = false;
      const privateError = () => Error("API failure: manual-synthetic-code unchanged-synthetic-secret");
      const context = vm.createContext({
        PropertiesService: { getScriptProperties: () => ({
          getProperty: key => {
            if (fault === "readback" && saved && !failed && key === "CURRENT_ACTIVITY_CODE") { failed = true; return "wrong"; }
            return properties.get(key);
          },
          setProperties: (values, deleteAllOthers) => {
            assert.equal(deleteAllOthers, false); saved = true;
            if (!failed && fault === "save") { failed = true; throw privateError(); }
            for (const [key, value] of Object.entries(values)) {
              properties.set(key, value);
              if (!failed && ["partial", "rollback"].includes(fault)) { failed = true; throw privateError(); }
            }
          },
          setProperty: (key, value) => { if (fault === "rollback" && failed) throw privateError(); properties.set(key, value); },
          deleteProperty: key => {
            if (fault === "delete" && saved && !failed) { failed = true; throw privateError(); }
            if (fault === "rollback" && failed) throw privateError(); properties.delete(key);
          }
        }) },
        LockService: { getScriptLock: () => ({ tryLock: timeout => { assert.equal(timeout, 10000); return fault !== "busy"; }, releaseLock: () => releases++ }) },
        Utilities: { getUuid: () => { uuidCalls++; return randomUUID(); }, Charset: { UTF_8: "utf8" }, DigestAlgorithm: { SHA_256: "sha256" },
          computeDigest: (algorithm, text) => [...createHash(algorithm).update(text).digest()], base64EncodeWebSafe: bytes => Buffer.from(bytes).toString("base64url") }
      });
      vm.runInContext(source, context);
      assert.throws(() => context[entrypoint](), error => {
        assert.match(error.message, fault === "busy" ? /稍後重試/ : fault === "rollback" ? /亦未能確認還原.*不要派發新碼/ : /已還原原有設定/);
        assert.ok(!error.message.includes("manual-synthetic-code")); assert.ok(!error.message.includes("unchanged-synthetic-secret")); return true;
      });
      assert.equal(releases, fault === "busy" ? 0 : 1); if (fault === "busy") assert.equal(uuidCalls, 0);
      if (fault !== "rollback") assert.deepEqual(properties, new Map(initial));
      for (const key of ["SIGNING_KEY", "SPREADSHEET_ID", "ENABLED"]) assert.equal(properties.get(key), new Map(initial).get(key));
    }
  }
});

test("亂數產生失敗或重複活動碼不更換設定，首次保存失敗不留下新屬性", async () => {
  const source = await readFile(new URL("../google/check-in-receiver.gs", import.meta.url), "utf8");
  for (const fault of ["random", "duplicate", "first-save"]) {
    const fixedUuid = randomUUID(), properties = new Map([["ACTIVITY_CODE_HASH", "previous-hash"]]); let releases = 0, saving = 0;
    const context = vm.createContext({
      PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties.get(key),
        setProperties: values => { saving++; for (const [key, value] of Object.entries(values)) { properties.set(key, value); if (fault === "first-save") throw Error("partial save"); } },
        setProperty: (key, value) => properties.set(key, value), deleteProperty: key => properties.delete(key) }) },
      LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => releases++ }) },
      Utilities: { getUuid: () => { if (fault === "random") throw Error("random failure"); return fixedUuid; },
        Charset: { UTF_8: "utf8" }, DigestAlgorithm: { SHA_256: "sha256" }, computeDigest: (algorithm, text) => [...createHash(algorithm).update(text).digest()],
        base64EncodeWebSafe: bytes => Buffer.from(bytes).toString("base64url") }
    });
    vm.runInContext(source, context);
    if (fault === "duplicate") context.generateActivityCode();
    const before = [...properties], previousSaves = saving;
    assert.throws(() => context.generateActivityCode(), error => { assert.match(error.message, fault === "first-save" ? /已還原/ : /未能產生.*原有設定不變/); return true; });
    assert.deepEqual([...properties], before); assert.equal(saving, previousSaves + (fault === "first-save" ? 1 : 0));
    assert.equal(releases, fault === "duplicate" ? 2 : 1);
  }
});

test("應用接線：本機打卡後才排隊，取消另記事件；取消修改保留待傳，確認登出只清身份及佇列", async () => {
  const f = syncFixture({ profile: FIXTURE_IDENTITY }); await f.sync.start(); await f.sync.enable("test");
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
  let clock = Date.now(); const f = syncFixture({ now: () => clock }); await f.sync.start(); await f.sync.enable("test");
  f.blocked = true; assert.equal(await f.sync.enqueue(f.record()), false);
  assert.equal(f.sync.getState().unsaved, 1); assert.equal(f.sync.getState().disabled, false); assert.match(f.sync.getState().reason, /離開或重載會遺失/);
  f.blocked = false; await f.sync.upload(); assert.equal(f.sync.getState().unsaved, 0); assert.equal(f.data.pending.length, 0);
  f.environment.navigator.onLine = false; await f.sync.enqueue(f.record("sun-yat-sen")); const eventId = f.data.pending[0].eventId;
  clock += 2 * 86400000; f.environment.navigator.onLine = true;
  assert.equal(await f.sync.upload(), false); assert.equal(f.sync.getState().needsCode, true);
  const session = f.data.enrollment.sessionId; assert.equal(await f.sync.enable("test"), true); await f.sync.upload();
  assert.equal(f.data.enrollment.sessionId, session); assert.equal(f.data.pending.length, 0);
  assert.equal(f.requests.at(-1).events[0].eventId, eventId);
});

test("清除同步失敗不清旅程，仍需兩次確認；成功後清身份及佇列，警告 Google 紀錄保留", async () => {
  const f = syncFixture({ profile: FIXTURE_IDENTITY }); await f.sync.start(); await f.sync.enable("test");
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
