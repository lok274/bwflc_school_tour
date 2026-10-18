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
import { createCheckInSync, SYNC_ACTIVITY_ID, SYNC_UPLOAD_CUTOFF, SYNC_CUTOFF_LABEL, isGoogleReceiverUrl } from "../src/check-in-sync.js";
import { randomUUID, createHmac } from "node:crypto";
import vm from "node:vm";

const tick = () => new Promise(setImmediate);
const checkedInApp = (options = {}) => appHarness({ hash: "#attraction/future-school", initialState: checkedState(), ...options });
const selectPhoto = (app) => app.selectPhoto();

const SYNC_TEST_NOW = Date.parse("2026-10-14T00:00:00Z");
function syncFixture({ repo, profile, now = () => SYNC_TEST_NOW, timeout = 10000, onChange = () => {} } = {}) {
  let data = null, writing = Promise.resolve(), blockWrite = false, handler, allowed = true;
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
    const result = body.action === "enable" ? { ticket: "synthetic-ticket", sessionId: body.sessionId, expiresAt: SYNC_UPLOAD_CUTOFF }
      : { sessionId: data.enrollment.sessionId, accepted: body.events.map(item => item.eventId) };
    return { ok: true, text: async () => JSON.stringify({ version: 1, activityId: SYNC_ACTIVITY_ID, ok: true, ...result }) };
  } };
  const sync = createCheckInSync({ environment, repository, getIdentity: () => identity, canRun: () => allowed, now, onChange, requestTimeout: timeout,
    endpoint: "https://script.google.com/macros/s/synthetic-fixture/exec" });
  const record = (id = "future-school", time = "2026-11-05T04:00:00.000Z") => ({ attractionId: id, checkedInAt: time, method: "manual", verified: false });
  return { sync, environment, requests, record, repository, get data() { return data; }, set handler(value) { handler = value; }, set blocked(value) { blockWrite = value; }, set identity(value) { identity = value; }, set allowed(value) { allowed = value; } };
}
const receipt = value => ({ ok: true, text: async () => JSON.stringify({ version: 1, activityId: SYNC_ACTIVITY_ID, ok: true, ...value }) });

test("只在本次使用的學生資料不經同步佇列偷偷保存，仍可離線打卡", async () => {
  let reads = 0, writes = 0;
  const app = appHarness({ initialIdentity: null, hash: "#itinerary", controllerFactory: options => createAppController({ ...options,
    syncEndpoint: "https://script.google.com/macros/s/fixture/exec", syncRepository: {
      read() { reads++; return null; }, update() { writes++; throw Error("不得保存身份"); }
    } }) });
  await app.controller.start(); await app.click("install-dismiss");
  const set = app.environment.localStorage.setItem;
  app.environment.localStorage.setItem = (key, value) => { if (key === STUDENT_IDENTITY_STORAGE_KEY) throw Error("quota"); return set(key, value); };
  fillStudentIdentity(app); await submitStudentIdentity(app); await app.click("student-identity-temporary");
  app.confirmation.handler = async () => true; await app.click("checkin", "future-school"); await tick();
  assert.ok(app.savedState().checkIns["future-school"]); assert.equal(reads, 1); assert.equal(writes, 0);
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
  await f.sync.upload();
  assert.equal(f.sync.getState().needsEnable, false); assert.equal(f.data.enrollment.expiresAt, SYNC_UPLOAD_CUTOFF);
});

test("學生頁及發布模組已移除 Google 登入及活動碼，保留手動上傳", async () => {
  const { access } = await import("node:fs/promises");
  await assert.rejects(access(new URL("../src/google-upload-auth.js", import.meta.url)));
  for (const file of ["src/controller.js", "src/check-in-sync.js", "src/home-views.js", "google/check-in-receiver.gs", "sw.js", "scripts/build-pages.mjs"]) {
    const source = await readFile(new URL("../" + file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /google-upload-auth|googleAuth|googleUploadCallback|GOOGLE_CLIENT_SECRET|OAuth2|needsSignIn|使用 Google 帳戶登入|sync-activity-code|needsCode|ACTIVITY_CODE|generateActivityCode|configureActivityCode/);
    if (file === "src/home-views.js") {
      assert.doesNotMatch(source, /只作活動參考，不核實身份或出席/);
      assert.match(source, /不傳相片或座標。/);
    }
  }
});


test("同步未接通不讀佇列、不發 Google 請求，網址仍嚴格驗證", async () => {
  const sync = createCheckInSync({ endpoint: "",
    repository: { read() { throw Error("不得讀取"); } }, environment: { fetch() { throw Error("不得連線"); } } });
  await sync.start(); assert.equal(await sync.enable(), false); await sync.upload(); await sync.stop({ clear: true });
  assert.equal(sync.getState().disabled, true);
  for (const value of ["https://evil.example/exec", "http://script.google.com/macros/s/id/exec", "https://script.google.com/macros/s/id/exec?secret=x", "https://script.google.com/macros/s/id/dev"]) assert.equal(isGoogleReceiverUrl(value), false);
});

test("無碼啟用失敗、連按、關閉及身份變更不保存舊許可，重新啟用可重試", async () => {
  const f = syncFixture(); await f.sync.start();
  f.handler = () => receipt({ ok: false, error: "FORMAT" });
  assert.equal(await f.sync.enable(), false); assert.equal(f.data, null);
  assert.match(f.sync.getState().reason, /核對接收程式是否已更新/);
  for (const change of ["close", "identity", "clear"]) {
    let release;
    f.handler = body => new Promise(resolve => { release = () => resolve(receipt({ sessionId: body.sessionId, ticket: "stale", expiresAt: SYNC_UPLOAD_CUTOFF })); });
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
  assert.equal(f.sync.getState().reason, "沒有待傳紀錄。");
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
    f.handler = null; if (kind === "ticket") await f.sync.enable();
    await f.sync.upload(); assert.equal(f.data.pending.length, 0, kind);
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

async function receiverFixture({ cache = true } = {}) {
  const source = await readFile(new URL("../google/check-in-receiver.gs", import.meta.url), "utf8");
  let rows, failAppend = false, busy = false, signingFailure = false, appends = 0, failAt = 0, releases = 0;
  let held = false, failFlush = "", flushes = 0, pendingWrites = [];
  let cacheFailure = "", failRelease = false;
  const reads = [], readLocks = [], writes = [], expansions = [], operations = [], cached = new Map(), cacheGets = [], cachePuts = [];
  const sheets = new Map(), openedIds = [];
  let clock = SYNC_TEST_NOW, onRead = () => {}, onAppend = () => {}, onLock = () => {};
  class ReceiverDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const properties = new Map([["ENABLED", "true"], ["SPREADSHEET_ID", "private-test-sheet"], ["SIGNING_KEY", "synthetic-secret-only-for-this-test-000"]]);
  const context = vm.createContext({ Date: ReceiverDate, Set, Array, Object, JSON, Number, Error,
    PropertiesService: { getScriptProperties: () => ({ getProperties: () => Object.fromEntries(properties), getProperty: key => {
      assert.ok(!/ACTIVITY_CODE/.test(key), "不得讀取已移除的活動碼設定"); return properties.get(key);
    } }) },
    LockService: { getScriptLock: () => ({
      tryLock: timeout => {
        assert.equal(timeout, 10000); assert.equal(held, false); onLock();
        if (busy) return false;
        held = true; operations.push("lock"); return true;
      },
      releaseLock() {
        assert.equal(held, true); operations.push("unlock"); held = false; releases++;
        if (failRelease) throw Error("合成解鎖失敗");
      }
    }) },
    CacheService: { getScriptCache: () => {
      if (!cache || cacheFailure === "service") throw Error("合成快取服務失敗");
      return {
        get(key) {
          assert.equal(held, false); cacheGets.push(key);
          if (cacheFailure === "get") throw Error("合成快取讀取失敗");
          return cached.get(key) ?? null;
        },
        put(key, value, seconds) {
          assert.equal(held, false); assert.match(key, /^[A-Za-z0-9_-]{43}$/);
          assert.equal(value, "1"); assert.equal(seconds, 600);
          if (cacheFailure === "put") throw Error("合成快取寫入失敗");
          cachePuts.push(key); cached.set(key, value);
        }
      };
    } },
    Utilities: { Charset: { UTF_8: "utf8" },
      computeHmacSha256Signature: (text, key) => {
        if (signingFailure) throw Error("API failure " + key);
        if (cacheFailure === "key" && text.startsWith('["submit-v2"')) throw Error("合成快取鍵失敗");
        return [...createHmac("sha256", key).update(text).digest()];
      },
      base64EncodeWebSafe: text => Buffer.from(text).toString("base64url"),
      base64DecodeWebSafe: text => Buffer.from(text, "base64url"), newBlob: bytes => ({ getDataAsString: () => Buffer.from(bytes).toString("utf8") }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }) },
    SpreadsheetApp: {
      openById: id => {
        openedIds.push(id);
        const state = sheets.get(id);
        if (!state) throw Error("合成工作表無法讀取");
        return { getSheetByName: name => {
          assert.equal(name, "打卡紀錄");
          if (state.missingTab) return null;
          return {
            getLastRow: () => state.rows.length,
            getMaxRows: () => { assert.equal(held, true); return state.capacity; },
            insertRowsAfter: (after, count) => {
              assert.equal(held, true); assert.equal(after, state.capacity); assert.ok(count > 0);
              expansions.push([after, count]); state.capacity += count;
            },
            getRange: (row, column, height, width) => {
              assert.equal(column, 1); assert.equal(width, 16);
              assert.ok(row + height - 1 <= state.capacity, "寫入範圍不可超過工作表容量");
              return {
                getValues: () => {
                  assert.equal(row, 1); assert.equal(height, Math.max(1, state.rows.length));
                  reads.push([row, column, height, width]); readLocks.push(held); onRead();
                  return state.rows.slice(0, height).map(values => Array.from({ length: width }, (_, i) => values[i] ?? ""));
                },
                setValues: values => {
                  assert.equal(held, true); assert.equal(height, 1); assert.equal(values.length, 1); assert.equal(values[0].length, width);
                  assert.ok(row >= 2); assert.equal(typeof values[0][10], "number");
                  const literal = Array.from(values[0], cell => {
                    if (typeof cell !== "string") return cell;
                    assert.ok(cell.startsWith("'"), "每個文字欄位必須以引號保留原文"); return cell.slice(1);
                  });
                  appends++; if (failAppend || appends === failAt) throw Error("合成 Google 失敗");
                  writes.push({ sheetId: id, row, values: Array.from(values[0]) }); pendingWrites.push({ state, row, values: literal });
                  operations.push("write"); onAppend();
                }
              };
            }
          };
        } };
      },
      flush: () => {
        assert.equal(held, true); flushes++; operations.push("flush");
        const saved = pendingWrites; pendingWrites = [];
        if (failFlush === "before") throw Error("合成 flush 失敗");
        for (const write of saved) write.state.rows[write.row - 1] = write.values;
        if (failFlush === "after") throw Error("合成 flush 回覆遺失");
      }
    } });
  vm.runInContext(source, context);
  const addSheet = id => {
    const state = { rows: JSON.parse(vm.runInContext("JSON.stringify([HEADERS_])", context)), capacity: 1000, missingTab: false };
    sheets.set(id, state); return state;
  };
  const initialSheet = addSheet("private-test-sheet"); rows = initialSheet.rows;
  const send = body => context.doPost({ postData: { contents: JSON.stringify({ version: 1, activityId: SYNC_ACTIVITY_ID, ...body }) } });
  const identity = { studentName: '=IMPORTXML("https://invalid.example")', className: "測試班", studentNumber: "007" }, sessionId = randomUUID();
  const eventId = randomUUID(), parent = { eventId, checkInId: eventId, sequence: 1, attractionId: "future-school",
    checkedInAt: "2026-11-05T04:00:00.000Z", eventAt: "2026-11-05T04:00:00.000Z", method: "manual", verified: false, action: "checkin" };
  return { source, context, properties, rows, send, identity, sessionId, parent, reads, readLocks, writes, expansions, operations,
    cached, cacheGets, cachePuts, sheets, openedIds, addSheet,
    get releases() { return releases; }, get flushes() { return flushes; }, get held() { return held; },
    set failAppend(value) { failAppend = value; }, set failAt(value) { failAt = value; },
    set missingTab(value) { initialSheet.missingTab = value; }, set failFlush(value) { failFlush = value; },
    set capacity(value) { initialSheet.capacity = value; },
    set cacheFailure(value) { cacheFailure = value; }, set failRelease(value) { failRelease = value; },
    set busy(value) { busy = value; }, set signingFailure(value) { signingFailure = value; },
    set clock(value) { clock = value; }, set onRead(value) { onRead = value; }, set onAppend(value) { onAppend = value; }, set onLock(value) { onLock = value; } };
}

test("成功批次提示仍讀實際表頭與完整內容；重試確認不佔寫入鎖、不寫入或 flush", async () => {
  const r = await receiverFixture(), enabled = r.send({ action: "enable", identity: r.identity, sessionId: r.sessionId });
  const cancel = { ...r.parent, eventId: randomUUID(), sequence: 2, action: "cancel" };
  const submit = events => r.send({ action: "submit", ticket: enabled.ticket, events });
  const accepted = [r.parent.eventId, cancel.eventId];
  assert.deepEqual(submit([r.parent, cancel]).accepted, accepted);
  assert.equal(r.cached.size, 1); assert.equal(r.cachePuts.length, 1);
  assert.deepEqual(r.operations, ["lock", "write", "write", "flush", "unlock"]);
  r.busy = true;
  assert.deepEqual(submit([r.parent, cancel]).accepted, accepted);
  assert.equal(r.rows.length, 3); assert.equal(r.writes.length, 2); assert.equal(r.flushes, 1); assert.equal(r.releases, 1);
  assert.deepEqual(r.readLocks, [true, false]);
  assert.deepEqual(r.reads, [[1, 1, 1, 16], [1, 1, 3, 16]]);
  assert.equal(r.cachePuts.length, 1); assert.equal(r.held, false);
});

test("提示命中後逐欄核對十五個固定值；工作表內容被改動不能直接確認", async () => {
  for (let column = 0; column < 16; column++) {
    if (column === 5) continue;
    const r = await receiverFixture(), enabled = r.send({ action: "enable", identity: r.identity, sessionId: r.sessionId });
    const submit = () => r.send({ action: "submit", ticket: enabled.ticket, events: [r.parent] });
    assert.equal(submit().ok, true);
    r.rows[1][column] = column === 9 ? randomUUID() : column === 10 ? 2 : "已修改";
    const reply = submit();
    assert.equal(reply.error, "ORDER", String(column)); assert.ok(!("accepted" in reply));
    assert.equal(r.rows.length, 2); assert.equal(r.writes.length, 1); assert.equal(r.cachePuts.length, 1);
    assert.deepEqual(r.readLocks, [true, false, true]); assert.equal(r.releases, 2);
  }
});

test("成功批次提示使用固定欄位順序的 HMAC 鍵，僅存短期成功標記", async () => {
  const r = await receiverFixture(), enabled = r.send({ action: "enable", identity: r.identity, sessionId: r.sessionId });
  const event = r.parent, identity = r.identity;
  const submit = value => r.send({ action: "submit", ticket: enabled.ticket, events: [value] });
  assert.equal(submit(event).ok, true);
  const keyFor = (value, sheet = "private-test-sheet", legacy = "") => createHmac("sha256", r.properties.get("SIGNING_KEY"))
    .update(JSON.stringify(["submit-v2", sheet, legacy, "打卡紀錄", SYNC_ACTIVITY_ID,
      identity.studentName, identity.className, identity.studentNumber, r.sessionId,
      [[value.eventId, value.sequence, value.checkInId, value.attractionId, value.checkedInAt, value.eventAt,
        value.method, value.verified, value.action]]])).digest("base64url");
  assert.equal(r.cacheGets[0], keyFor(event)); assert.deepEqual([...r.cached], [[keyFor(event), "1"]]);
  assert.equal(submit(Object.fromEntries(Object.entries(event).reverse())).ok, true);
  assert.equal(r.cacheGets[1], keyFor(event)); assert.deepEqual(r.readLocks, [true, false]);
  const nextId = randomUUID();
  for (const changed of [
    { ...event, eventId: nextId, checkInId: nextId }, { ...event, sequence: 2 },
    { ...event, checkInId: nextId, action: "cancel" }, { ...event, attractionId: "sun-yat-sen" },
    { ...event, checkedInAt: "2026-11-05T04:01:00.000Z" }, { ...event, eventAt: "2026-11-05T04:01:00.000Z" },
    { ...event, method: "gps", verified: true }
  ]) {
    assert.equal(submit(changed).error, "ORDER");
    assert.equal(r.cacheGets.at(-1), keyFor(changed)); assert.notEqual(r.cacheGets.at(-1), keyFor(event));
  }
  r.addSheet("other-private-sheet"); r.properties.set("SPREADSHEET_ID", "other-private-sheet");
  assert.equal(submit(event).ok, true); assert.equal(r.cacheGets.at(-1), keyFor(event, "other-private-sheet"));
  assert.equal(r.readLocks.at(-1), true);
  r.properties.set("LEGACY_SPREADSHEET_ID", "private-test-sheet");
  assert.equal(submit(event).ok, true);
  assert.equal(r.cacheGets.at(-1), keyFor(event, "other-private-sheet", "private-test-sheet"));
});

test("提示不能繞過表頭或缺表設定錯誤；已刪資料須重新在鎖內核對及寫入", async () => {
  for (const changed of ["header", "tab", "deleted"]) {
    const r = await receiverFixture(), enabled = r.send({ action: "enable", identity: r.identity, sessionId: r.sessionId });
    const submit = () => r.send({ action: "submit", ticket: enabled.ticket, events: [r.parent] });
    assert.equal(submit().ok, true);
    if (changed === "header") r.rows[0][0] = "錯誤表頭";
    if (changed === "tab") r.missingTab = true;
    if (changed === "deleted") r.rows.splice(1, 1);
    const reply = submit();
    if (changed === "deleted") {
      assert.equal(reply.ok, true); assert.equal(r.rows.length, 2); assert.equal(r.writes.length, 2);
      assert.deepEqual(r.readLocks, [true, false, true]); assert.equal(r.releases, 2);
    } else {
      assert.equal(reply.error, "CONFIG"); assert.ok(!("accepted" in reply));
      assert.equal(r.writes.length, 1); assert.equal(r.releases, 1); assert.equal(r.cachePuts.length, 1);
    }
  }
});

test("快取未命中、遺失、損壞或服務失敗均沿用鎖內去重；快取寫入失敗不撤銷成功確認", async () => {
  for (const failure of ["service", "get", "key", "put", "evicted", "corrupt"]) {
    const r = await receiverFixture(), enabled = r.send({ action: "enable", identity: r.identity, sessionId: r.sessionId });
    const submit = () => r.send({ action: "submit", ticket: enabled.ticket, events: [r.parent] });
    if (failure === "put") r.cacheFailure = failure;
    assert.equal(submit().ok, true);
    if (failure === "evicted") r.cached.clear();
    else if (failure === "corrupt") r.cached.set(r.cacheGets[0], "invalid");
    else r.cacheFailure = failure;
    assert.equal(submit().ok, true, failure);
    assert.equal(r.rows.length, 2); assert.equal(r.writes.length, 1); assert.equal(r.releases, 2);
    assert.deepEqual(r.readLocks, [true, true]); assert.equal(r.held, false);
    if (failure === "put") assert.equal(r.cached.size, 0);
  }
});

test("部分寫入、flush 或解鎖失敗不能建立成功提示；原事件重試仍只入表一次", async () => {
  for (const failure of ["before", "after", "partial", "unlock"]) {
    const r = await receiverFixture(), enabled = r.send({ action: "enable", identity: r.identity, sessionId: r.sessionId });
    const cancel = { ...r.parent, eventId: randomUUID(), sequence: 2, action: "cancel" };
    const events = failure === "partial" ? [r.parent, cancel] : [r.parent];
    const submit = () => r.send({ action: "submit", ticket: enabled.ticket, events });
    if (failure === "partial") r.failAt = 2;
    else if (failure === "unlock") r.failRelease = true;
    else r.failFlush = failure;
    assert.equal(submit().error, "WRITE"); assert.equal(r.cached.size, 0); assert.equal(r.cachePuts.length, 0);
    assert.equal(r.held, false);
    r.failAt = 0; r.failRelease = false; r.failFlush = "";
    assert.equal(submit().ok, true); assert.equal(r.cached.size, 1);
    assert.equal(submit().ok, true); assert.equal(r.rows.length, events.length + 1);
    assert.deepEqual(r.readLocks, [true, true, false]);
    assert.equal(new Set(r.rows.slice(1).map(row => row[9])).size, events.length);
  }
});

test("提示命中仍驗證許可、活動、設定及截止，讀取跨過截止也不回覆成功", async () => {
  const r = await receiverFixture(), enabled = r.send({ action: "enable", identity: r.identity, sessionId: r.sessionId });
  const body = { action: "submit", ticket: enabled.ticket, events: [r.parent] };
  assert.equal(r.send(body).ok, true); const initialReads = r.reads.length;
  assert.equal(r.send({ ...body, ticket: enabled.ticket + "x" }).error, "TICKET");
  assert.equal(r.send({ ...body, activityId: "wrong" }).error, "ACTIVITY");
  r.properties.set("ENABLED", "false"); assert.equal(r.send(body).error, "DISABLED");
  r.properties.set("ENABLED", "true"); r.properties.set("SPREADSHEET_ID", "bad id");
  assert.equal(r.send(body).error, "CONFIG"); r.properties.set("SPREADSHEET_ID", "private-test-sheet");
  assert.equal(r.reads.length, initialReads);
  r.clock = SYNC_UPLOAD_CUTOFF - 1; r.onRead = () => { r.clock = SYNC_UPLOAD_CUTOFF; };
  assert.equal(r.send(body).error, "CLOSED"); assert.equal(r.readLocks.at(-1), false);
  assert.equal(r.send(body).error, "CLOSED"); assert.equal(r.rows.length, 2); assert.equal(r.releases, 1);
});

test("切換工作表保留舊事件確認、順序和取消關聯，新表由第二列開始且不複製舊列", async () => {
  const r = await receiverFixture(), enabled = r.send({ action: "enable", identity: r.identity, sessionId: r.sessionId });
  const submit = events => r.send({ action: "submit", ticket: enabled.ticket, events });
  const earlier = [r.parent, ...Array.from({ length: 4 }, (_, index) => {
    const eventId = randomUUID(); return { ...r.parent, eventId, checkInId: eventId, sequence: index + 2 };
  })];
  assert.equal(submit(earlier).ok, true);
  const oldRows = structuredClone(r.rows), target = r.addSheet("formal-test-sheet"); target.capacity = 2;
  r.properties.set("LEGACY_SPREADSHEET_ID", "private-test-sheet"); r.properties.set("SPREADSHEET_ID", "formal-test-sheet");
  assert.deepEqual(submit(earlier).accepted, earlier.map(event => event.eventId));
  const lockedReads = r.releases, flushes = r.flushes; r.busy = true;
  assert.equal(submit(earlier).ok, true);
  assert.equal(r.releases, lockedReads); assert.equal(r.flushes, flushes); assert.equal(target.rows.length, 1);
  assert.deepEqual(r.openedIds.slice(-2), ["formal-test-sheet", "private-test-sheet"]);
  assert.deepEqual(r.readLocks.slice(-2), [false, false]); r.busy = false;
  const nextId = randomUUID(), next = { ...r.parent, eventId: nextId, checkInId: nextId, sequence: 6 };
  assert.equal(submit([next]).ok, true); assert.equal(target.rows.length, 2); assert.deepEqual(r.expansions, []);
  const cancel = { ...r.parent, eventId: randomUUID(), sequence: 7, action: "cancel" };
  assert.equal(submit([cancel]).ok, true); assert.equal(target.rows[2][11], r.parent.eventId);
  assert.deepEqual(r.expansions, [[2, 1]]);
  const mixed = [r.parent, next, cancel];
  assert.deepEqual(submit(mixed).accepted, mixed.map(event => event.eventId));
  r.busy = true; assert.equal(submit(mixed).ok, true); r.busy = false;
  assert.equal(submit([{ ...r.parent, eventAt: "2026-11-05T04:01:00.000Z" }]).error, "ORDER");
  assert.equal(submit([{ ...cancel, eventId: randomUUID(), sequence: 8 }]).error, "ORDER");
  const changedOwner = r.send({ action: "enable", identity: { ...r.identity, studentNumber: "008" }, sessionId: r.sessionId });
  const changedId = randomUUID();
  assert.equal(r.send({ action: "submit", ticket: changedOwner.ticket,
    events: [{ ...next, eventId: changedId, checkInId: changedId, sequence: 8 }] }).error, "ORDER");
  assert.deepEqual(r.rows, oldRows);
  assert.deepEqual(r.writes.filter(write => write.sheetId === "formal-test-sheet").map(write => write.row), [2, 3]);
  assert.equal(r.writes.filter(write => write.sheetId === "private-test-sheet").length, earlier.length);
});

test("未設定、空白或與目標相同的舊表設定沿用單表與同一成功提示", async () => {
  const r = await receiverFixture(), enabled = r.send({ action: "enable", identity: r.identity, sessionId: r.sessionId });
  const submit = () => r.send({ action: "submit", ticket: enabled.ticket, events: [r.parent] });
  assert.equal(submit().ok, true); r.busy = true;
  for (const legacy of ["", "private-test-sheet"]) {
    r.properties.set("LEGACY_SPREADSHEET_ID", legacy); assert.equal(submit().ok, true);
    assert.equal(r.cacheGets.at(-1), r.cacheGets[0]);
  }
  assert.deepEqual(r.openedIds, Array(3).fill("private-test-sheet"));
  assert.equal(r.writes.length, 1); assert.equal(r.releases, 1);
  r.properties.set("LEGACY_SPREADSHEET_ID", "bad id"); assert.equal(submit().error, "CONFIG");
  assert.equal(r.openedIds.length, 3);
});

test("舊表不可讀、缺分頁或表頭錯誤時拒絕確認；快取命中也核對兩份表頭", async () => {
  for (const cachedProof of [false, true]) {
    for (const failure of ["unavailable", "missingTab", "legacyHeader", "targetHeader"]) {
      const r = await receiverFixture(), enabled = r.send({ action: "enable", identity: r.identity, sessionId: r.sessionId });
      const submit = () => r.send({ action: "submit", ticket: enabled.ticket, events: [r.parent] });
      assert.equal(submit().ok, true);
      const target = r.addSheet("formal-test-sheet");
      r.properties.set("LEGACY_SPREADSHEET_ID", "private-test-sheet"); r.properties.set("SPREADSHEET_ID", "formal-test-sheet");
      if (cachedProof) assert.equal(submit().ok, true);
      const puts = r.cachePuts.length, releases = r.releases;
      if (failure === "unavailable") r.sheets.delete("private-test-sheet");
      if (failure === "missingTab") r.missingTab = true;
      if (failure === "legacyHeader") r.rows[0][0] = "錯誤表頭";
      if (failure === "targetHeader") target.rows[0][0] = "錯誤表頭";
      const reply = submit();
      assert.equal(reply.error, failure === "unavailable" ? "WRITE" : "CONFIG"); assert.ok(!("accepted" in reply));
      assert.equal(target.rows.length, 1); assert.equal(r.writes.length, 1); assert.equal(r.cachePuts.length, puts);
      assert.equal(r.releases, releases + (cachedProof ? 0 : 1)); assert.equal(r.held, false);
    }
  }
});

test("舊表內容被改動後，已有成功提示也必須重新鎖內核對並拒絕確認", async () => {
  const r = await receiverFixture(), enabled = r.send({ action: "enable", identity: r.identity, sessionId: r.sessionId });
  const submit = () => r.send({ action: "submit", ticket: enabled.ticket, events: [r.parent] });
  assert.equal(submit().ok, true); const target = r.addSheet("formal-test-sheet");
  r.properties.set("LEGACY_SPREADSHEET_ID", "private-test-sheet"); r.properties.set("SPREADSHEET_ID", "formal-test-sheet");
  assert.equal(submit().ok, true); r.rows[1][2] = "008";
  const puts = r.cachePuts.length, releases = r.releases;
  assert.equal(submit().error, "ORDER");
  assert.deepEqual(r.readLocks.slice(-4), [false, false, true, true]);
  assert.equal(r.releases, releases + 1); assert.equal(r.cachePuts.length, puts);
  assert.equal(r.writes.length, 1); assert.equal(target.rows.length, 1);
});

test("取得鎖後重新讀目標與舊表設定，成功提示使用實際寫入設定", async () => {
  const r = await receiverFixture(), enabled = r.send({ action: "enable", identity: r.identity, sessionId: r.sessionId });
  const submit = events => r.send({ action: "submit", ticket: enabled.ticket, events });
  assert.equal(submit([r.parent]).ok, true);
  const oldRows = structuredClone(r.rows), target = r.addSheet("formal-test-sheet");
  r.properties.set("LEGACY_SPREADSHEET_ID", "private-test-sheet");
  r.onLock = () => { r.properties.set("SPREADSHEET_ID", "formal-test-sheet"); };
  const cancel = { ...r.parent, eventId: randomUUID(), sequence: 2, action: "cancel" };
  assert.equal(submit([cancel]).ok, true);
  assert.deepEqual(r.rows, oldRows); assert.equal(target.rows[1][9], cancel.eventId);
  assert.equal(r.writes.at(-1).sheetId, "formal-test-sheet"); assert.equal(r.writes.at(-1).row, 2);
  assert.notEqual(r.cacheGets.at(-1), r.cachePuts.at(-1));
  r.busy = true; const releases = r.releases;
  assert.equal(submit([cancel]).ok, true); assert.equal(r.cacheGets.at(-1), r.cachePuts.at(-1));
  assert.equal(r.releases, releases); assert.deepEqual(r.readLocks.slice(-2), [false, false]);
});

test("持鎖期間更換設定仍完成原目標；後續請求從舊表確認，提示不標成新目標", async () => {
  const r = await receiverFixture(), enabled = r.send({ action: "enable", identity: r.identity, sessionId: r.sessionId });
  const target = r.addSheet("formal-test-sheet"); r.properties.set("LEGACY_SPREADSHEET_ID", "private-test-sheet");
  r.onAppend = () => { r.properties.set("SPREADSHEET_ID", "formal-test-sheet"); };
  const submit = () => r.send({ action: "submit", ticket: enabled.ticket, events: [r.parent] });
  assert.equal(submit().ok, true);
  assert.equal(r.rows[1][9], r.parent.eventId); assert.equal(target.rows.length, 1);
  assert.equal(r.cachePuts[0], r.cacheGets[0]);
  assert.equal(submit().ok, true); assert.notEqual(r.cacheGets[1], r.cacheGets[0]);
  r.busy = true; assert.equal(submit().ok, true);
  assert.equal(r.writes.length, 1); assert.equal(r.releases, 2); assert.equal(target.rows.length, 1);
});

test("鎖內設定變成無效時停止；跨表批次部分寫入仍先 flush 並按目標列重試", async () => {
  const r = await receiverFixture({ cache: false }), enabled = r.send({ action: "enable", identity: r.identity, sessionId: r.sessionId });
  const submit = events => r.send({ action: "submit", ticket: enabled.ticket, events });
  r.onLock = () => { r.properties.set("LEGACY_SPREADSHEET_ID", "bad id"); };
  assert.equal(submit([r.parent]).error, "CONFIG"); assert.equal(r.writes.length, 0); assert.equal(r.held, false);
  r.onLock = () => {}; r.properties.delete("LEGACY_SPREADSHEET_ID");
  assert.equal(submit([r.parent]).ok, true);
  const oldRows = structuredClone(r.rows), target = r.addSheet("formal-test-sheet");
  r.properties.set("LEGACY_SPREADSHEET_ID", "private-test-sheet"); r.properties.set("SPREADSHEET_ID", "formal-test-sheet");
  const cancel = { ...r.parent, eventId: randomUUID(), sequence: 2, action: "cancel" };
  const nextId = randomUUID(), next = { ...r.parent, eventId: nextId, checkInId: nextId, sequence: 3 };
  const events = [r.parent, cancel, next]; r.failAt = 3;
  assert.equal(submit(events).error, "WRITE"); assert.equal(target.rows.length, 2);
  assert.deepEqual(r.operations.slice(-2), ["flush", "unlock"]);
  r.failAt = 0; assert.deepEqual(submit(events).accepted, events.map(event => event.eventId));
  assert.equal(target.rows.length, 3); assert.deepEqual(r.rows, oldRows);
  assert.deepEqual(r.writes.filter(write => write.sheetId === "formal-test-sheet").map(write => write.row), [2, 3]);
});

test("Google 無碼啟用保留票證、順序及取消關聯；原生寫入保留前置零並阻止公式，重試只寫一次", async () => {
  const r = await receiverFixture({ cache: false }), { send, identity, sessionId, parent, rows, properties } = r;
  const before = [...properties], enabled = send({ action: "enable", identity, sessionId });
  assert.equal(enabled.ok, true); assert.deepEqual([...properties], before); assert.equal(rows.length, 1);
  assert.equal(enabled.expiresAt, SYNC_UPLOAD_CUTOFF);
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
  assert.equal(rows[1][10], 1); assert.equal(typeof rows[1][10], "number");
  const cancel = { ...parent, eventId: randomUUID(), sequence: 2, action: "cancel" };
  assert.equal(submit([{ ...cancel, checkInId: randomUUID() }]).error, "ORDER");
  r.failAppend = true; assert.equal(submit([cancel]).error, "WRITE"); assert.equal(rows.length, 2);
  r.failAppend = false; assert.equal(submit([cancel]).ok, true); assert.equal(submit([cancel]).ok, true); assert.equal(rows.length, 3);
  assert.equal(rows[2][8], "取消"); assert.equal(rows[2][11], parent.eventId);
  assert.deepEqual([...properties], before);
  assert.ok(!/function doGet|no-cors|console\.|Logger\./.test(r.source));
});

test("原生接收器只讀十六欄並整行寫入；公式字串、引號、日期和前置零保持原文", async () => {
  for (const name of ["=1+1", "+1", "-1", "@text", "'原文", "''原文", "007", "2026-11-05", "繁體中文"]) {
    const r = await receiverFixture({ cache: false }), identity = { ...r.identity, studentName: name };
    const enabled = r.send({ action: "enable", identity, sessionId: r.sessionId });
    const submit = () => r.send({ action: "submit", ticket: enabled.ticket, events: [r.parent] });
    assert.equal(submit().ok, true); assert.equal(submit().ok, true);
    assert.deepEqual(r.reads, [[1, 1, 1, 16], [1, 1, 2, 16]]);
    assert.equal(r.writes.length, 1); assert.equal(r.writes[0].row, 2);
    assert.equal(r.writes[0].values[0], "'" + name); assert.equal(r.writes[0].values[2], "'007");
    assert.equal(r.rows[1][0], name); assert.equal(r.rows[1][2], "007");
    assert.equal(r.rows[1][4], r.parent.checkedInAt); assert.equal(r.rows[1][9], r.parent.eventId);
    assert.equal(r.rows[1][10], 1); assert.equal(r.flushes, 2); assert.equal(r.releases, 2);
    assert.deepEqual(r.operations, ["lock", "write", "flush", "unlock", "lock", "flush", "unlock"]);
    assert.equal(r.held, false);
  }
});

test("原生接收器 flush 失敗不回覆成功；已提交的相同事件重試不重複入表", async () => {
  for (const failure of ["before", "after"]) {
    const r = await receiverFixture({ cache: false }), enabled = r.send({ action: "enable", identity: r.identity, sessionId: r.sessionId });
    const submit = () => r.send({ action: "submit", ticket: enabled.ticket, events: [r.parent] });
    r.failFlush = failure;
    const failed = submit();
    assert.equal(failed.ok, false); assert.equal(failed.error, "WRITE"); assert.ok(!("accepted" in failed));
    assert.equal(r.rows.length, failure === "after" ? 2 : 1); assert.equal(r.releases, 1); assert.equal(r.held, false);
    r.failFlush = "";
    const retried = submit();
    assert.equal(retried.ok, true); assert.equal(JSON.stringify(retried.accepted), JSON.stringify([r.parent.eventId]));
    assert.equal(submit().ok, true); assert.equal(r.rows.length, 2);
    assert.equal(r.writes.length, failure === "after" ? 1 : 2);
    assert.equal(r.flushes, 3); assert.equal(r.releases, 3);
    for (let i = 0; i < r.operations.length; i++) {
      if (r.operations[i] === "unlock") assert.equal(r.operations[i - 1], "flush");
    }
  }
});

test("原生接收器缺少指定工作表時回覆 CONFIG，仍先 flush 再釋放操作鎖", async () => {
  const r = await receiverFixture({ cache: false }), enabled = r.send({ action: "enable", identity: r.identity, sessionId: r.sessionId });
  r.missingTab = true;
  assert.equal(r.send({ action: "submit", ticket: enabled.ticket, events: [r.parent] }).error, "CONFIG");
  assert.equal(r.rows.length, 1); assert.equal(r.reads.length, 0); assert.equal(r.writes.length, 0);
  assert.deepEqual(r.operations, ["lock", "flush", "unlock"]); assert.equal(r.held, false);
});

test("原生接收器只在寫入超出工作表容量時擴列，重試不再擴列或重寫", async () => {
  for (const capacity of [1, 2, 3]) {
    const r = await receiverFixture({ cache: false }), enabled = r.send({ action: "enable", identity: r.identity, sessionId: r.sessionId });
    r.capacity = capacity;
    const cancel = { ...r.parent, eventId: randomUUID(), sequence: 2, action: "cancel" };
    const submit = () => r.send({ action: "submit", ticket: enabled.ticket, events: [r.parent, cancel] });
    assert.equal(submit().ok, true); assert.equal(r.rows.length, 3); assert.equal(r.writes.length, 2);
    assert.deepEqual(r.expansions, capacity < 3 ? [[capacity, 2]] : []);
    assert.equal(submit().ok, true); assert.equal(r.rows.length, 3); assert.equal(r.writes.length, 2);
    assert.equal(r.expansions.length, capacity < 3 ? 1 : 0);
  }
});

test("無碼啟用仍核對身份、活動、欄位和簽章設定；不提供查詢或更改私人設定接口", async () => {
  const r = await receiverFixture({ cache: false }), { send, identity, sessionId, properties } = r, before = [...properties];
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
  const r = await receiverFixture({ cache: false }), { send, identity, sessionId, parent, rows } = r;
  const enabled = send({ action: "enable", identity, sessionId });
  const submit = events => send({ action: "submit", ticket: enabled.ticket, events });
  r.busy = true; assert.equal(submit([parent]).error, "BUSY"); assert.equal(rows.length, 1); assert.equal(r.releases, 0);
  r.busy = false;
  const cancel = { ...parent, eventId: randomUUID(), sequence: 2, action: "cancel" };
  r.onAppend = () => assert.equal(rows.length, 1, "成功前綴須在仍持鎖的 flush 才提交");
  r.failAt = 2; assert.equal(submit([parent, cancel]).error, "WRITE"); assert.equal(rows.length, 2); assert.equal(r.releases, 1);
  r.onAppend = () => {};
  r.failAt = 0; assert.equal(submit([parent, cancel]).ok, true); assert.equal(rows.length, 3);
  assert.equal(submit([parent, cancel]).ok, true); assert.equal(rows.length, 3);
  assert.equal(submit([{ ...cancel, eventId: randomUUID(), sequence: 3 }]).error, "ORDER");
  rows[0] = ["wrong"];
  assert.equal(submit([parent]).error, "CONFIG"); assert.equal(rows.length, 3);
});

test("應用接線：本機打卡後才排隊，取消另記事件；唯讀資料及登出登入保留身份及整份佇列", async () => {
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
  const original = structuredClone(f.data), identity = app.environment.localStorage.getItem(STUDENT_IDENTITY_STORAGE_KEY);
  await app.click("student-profile-open"); fillStudentIdentity(app, { ...FIXTURE_IDENTITY, studentName: "另一學生" });
  await submitStudentIdentity(app); assert.deepEqual(f.data, original);
  await app.click("student-identity-return"); assert.deepEqual(f.data, original);
  await app.click("student-profile-open"); app.confirmation.handler = async () => true;
  await app.click("student-identity-logout"); assert.equal(app.controller.getPageSnapshot().mode, "signedOut");
  assert.equal(app.environment.localStorage.getItem(STUDENT_IDENTITY_STORAGE_KEY), identity);
  assert.ok(app.savedState().checkIns["sun-yat-sen"]); assert.deepEqual(f.data, original);
  await app.click("student-identity-login"); assert.equal(app.controller.getPageSnapshot().view, "itinerary"); assert.deepEqual(f.data, original);
});

test("待傳儲存失敗可重試；舊七日許可連線後自動更換，不清佇列或改事件 ID", async () => {
  let clock = SYNC_TEST_NOW; const f = syncFixture({ now: () => clock }); await f.sync.start(); await f.sync.enable();
  f.blocked = true; assert.equal(await f.sync.enqueue(f.record()), false); await tick();
  assert.equal(f.sync.getState().unsaved, 1); assert.equal(f.sync.getState().disabled, false); assert.match(f.sync.getState().reason, /離開或重載會遺失/);
  f.blocked = false; await f.sync.upload(); assert.equal(f.sync.getState().unsaved, 0); assert.equal(f.data.pending.length, 0);
  f.environment.navigator.onLine = false; await f.sync.enqueue(f.record("sun-yat-sen")); const eventId = f.data.pending[0].eventId;
  await f.repository.update(value => { value.enrollment.expiresAt = clock + 7 * 86400000; return value; });
  clock += 8 * 86400000; f.environment.navigator.onLine = true;
  const session = f.data.enrollment.sessionId, epoch = f.data.epoch;
  assert.equal(await f.sync.upload(), true);
  assert.equal(f.data.enrollment.expiresAt, SYNC_UPLOAD_CUTOFF); assert.equal(f.data.epoch, epoch);
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

test("固定香港截止包括 23:59 整分鐘；截止後不啟用、不排隊、不補傳，保存紀錄保留", async () => {
  assert.equal(new Date(SYNC_UPLOAD_CUTOFF).toISOString(), "2026-11-09T16:00:00.000Z");
  let clock = SYNC_UPLOAD_CUTOFF - 1;
  const f = syncFixture({ now: () => clock }); await f.sync.start(); assert.equal(await f.sync.enable(), true);
  assert.equal(f.data.enrollment.expiresAt, SYNC_UPLOAD_CUTOFF); assert.match(f.sync.getState().cutoffLabel, /11月9日晚上11:59/);
  f.environment.navigator.onLine = false; await f.sync.enqueue(f.record()); const original = structuredClone(f.data);
  clock = SYNC_UPLOAD_CUTOFF; f.environment.navigator.onLine = true;
  const count = f.requests.length;
  assert.equal(await f.sync.enable(), false); assert.equal(await f.sync.upload(), false);
  assert.equal(await f.sync.enqueue(f.record("sun-yat-sen")), false);
  await f.sync.stop(); await f.sync.start(); await f.sync.upload();
  assert.deepEqual(f.data, original); assert.equal(f.requests.length, count);
  assert.equal(f.sync.getState().status, "上傳已截止"); assert.equal(f.sync.getState().disabled, true);
  assert.equal(f.sync.getState().pending, 1); assert.equal(f.sync.getState().button, "已截止");
});

test("Google CLOSED 優先於慢手機時鐘；沒有寫入確認不清佇列，未保存警告仍準確", async () => {
  const f = syncFixture(); await f.sync.start(); await f.sync.enable(); f.environment.navigator.onLine = false;
  await f.sync.enqueue(f.record()); const original = structuredClone(f.data.pending);
  f.blocked = true; await f.sync.enqueue(f.record("sun-yat-sen")); f.blocked = false;
  f.environment.navigator.onLine = true; f.handler = () => receipt({ ok: false, error: "CLOSED" });
  assert.equal(await f.sync.upload(), false); assert.deepEqual(f.data.pending, original);
  assert.equal(f.sync.getState().closed, true); assert.equal(f.sync.getState().unsaved, 1);
  assert.match(f.sync.getState().reason, /未保存.*離開或重載會遺失/);
  assert.doesNotMatch(f.sync.getState().reason, /立即上傳.*重試/);
  const count = f.requests.length; await f.sync.enable(); await f.sync.upload(); assert.equal(f.requests.length, count);
});

test("舊許可自動續期失敗或裝置保存失敗不改佇列；自動及手動續期共用鎖", async () => {
  for (const kind of ["cloud", "storage", "old-server"]) {
    const f = syncFixture(); await f.sync.start(); await f.sync.enable(); f.environment.navigator.onLine = false;
    await f.sync.enqueue(f.record()); await f.repository.update(value => { value.enrollment.expiresAt = SYNC_TEST_NOW + 7 * 86400000; return value; });
    const original = structuredClone(f.data);
    await f.sync.stop(); f.environment.navigator.onLine = true;
    if (kind === "storage") f.blocked = true;
    else f.handler = body => kind === "cloud" ? receipt({ ok: false, error: "WRITE" }) : receipt({ ticket: "old", sessionId: body.sessionId, expiresAt: SYNC_TEST_NOW + 7 * 86400000 });
    await f.sync.start(); await f.sync.upload(); assert.deepEqual(f.data, original, kind);
    assert.match(f.sync.getState().reason, kind === "storage" ? /未能保存上傳許可/ : /Google 未確認/);
    f.blocked = false; f.handler = null; assert.equal(await f.sync.upload(), true);
    assert.equal(f.data.epoch, original.epoch); assert.equal(f.data.enrollment.sessionId, original.enrollment.sessionId);
    assert.deepEqual(f.requests.at(-1).events, original.pending);
  }
  const f = syncFixture(); await f.sync.start(); await f.sync.enable();
  await f.repository.update(value => { value.enrollment.expiresAt = 0; return value; });
  await f.sync.stop(); let release;
  f.handler = body => new Promise(resolve => { release = () => resolve(receipt({ ticket: "renewed", sessionId: body.sessionId, expiresAt: SYNC_UPLOAD_CUTOFF })); });
  await f.sync.start(); await tick(); const work = f.sync.upload(), count = f.requests.length;
  assert.equal(f.sync.upload(), work); assert.equal(await f.sync.enable(), false); assert.equal(f.requests.length, count);
  release(); assert.equal(await work, true); assert.equal(f.data.enrollment.expiresAt, SYNC_UPLOAD_CUTOFF);
});

test("續期等待期間清除、身份改動或另一分頁更新版本，遲來許可不恢復舊資料", async () => {
  let finishRead;
  const first = syncFixture({ repo: { read: () => new Promise(resolve => { finishRead = resolve; }), update() { throw Error("不得寫入舊身份"); } } });
  const enabling = first.sync.enable(); await tick();
  first.identity = { ...FIXTURE_IDENTITY, studentNumber: "009" }; finishRead(null);
  assert.equal(await enabling, false); assert.equal(first.requests.length, 0);
  for (const change of ["clear", "identity", "epoch"]) {
    const f = syncFixture(); await f.sync.start(); await f.sync.enable(); f.environment.navigator.onLine = false;
    await f.sync.enqueue(f.record()); await f.repository.update(value => { value.enrollment.expiresAt = 0; return value; });
    let release; f.handler = body => new Promise(resolve => { release = () => resolve(receipt({ ticket: "late", sessionId: body.sessionId, expiresAt: SYNC_UPLOAD_CUTOFF })); });
    f.environment.navigator.onLine = true; const work = f.sync.upload(); await tick();
    if (change === "clear") await f.sync.stop({ clear: true });
    else if (change === "identity") f.identity = { ...FIXTURE_IDENTITY, studentNumber: "009" };
    else await f.repository.update(value => { value.epoch = randomUUID(); return value; });
    const snapshot = structuredClone(f.data); release(); assert.equal(await work, false);
    assert.deepEqual(f.data, snapshot, change);
  }
});

test("截止前已寫入的遲來確認仍可保存，但不啟動下一批；等待分頁鎖期間截止不發请求", async () => {
  let clock = SYNC_UPLOAD_CUTOFF - 1000;
  const f = syncFixture({ now: () => clock }); await f.sync.start(); await f.sync.enable(); f.environment.navigator.onLine = false;
  for (let i = 0; i < 21; i++) await f.sync.enqueue(f.record("future-school", new Date(SYNC_TEST_NOW + i * 1000).toISOString()));
  f.environment.navigator.onLine = true; let release;
  f.handler = body => new Promise(resolve => { release = () => resolve(receipt({ sessionId: f.data.enrollment.sessionId, accepted: body.events.map(item => item.eventId) })); });
  const work = f.sync.upload(); await tick(); clock = SYNC_UPLOAD_CUTOFF; release(); await work;
  assert.equal(f.data.pending.length, 1); assert.equal(f.requests.filter(body => body.action === "submit").length, 1);
  assert.equal(f.sync.getState().status, "上傳已截止");
  clock--; const g = syncFixture({ now: () => clock }); await g.sync.start(); await g.sync.enable();
  g.environment.navigator.onLine = false; await g.sync.enqueue(g.record()); g.environment.navigator.onLine = true;
  g.environment.navigator.locks = { request: (_name, task) => new Promise(resolve => { release = () => resolve(task()); }) };
  const waiting = g.sync.upload(), count = g.requests.length; clock++; release(); await waiting;
  assert.equal(g.requests.length, count); assert.equal(g.data.pending.length, 1);
});

test("截止計時使用安全延遲並在離線時更新状态，不中止等待中的寫入確認", async () => {
  let clock = SYNC_TEST_NOW, scheduled, delay, updates = [];
  const f = syncFixture({ now: () => clock, onChange: value => updates.push(value) });
  f.environment.document = {}; f.environment.window = { setTimeout(fn, ms) { scheduled = fn; delay = ms; return 1; }, clearTimeout() {} };
  const timed = createCheckInSync({ environment: f.environment, repository: f.repository, getIdentity: () => FIXTURE_IDENTITY, now: () => clock,
    onChange: value => updates.push(value), endpoint: "https://script.google.com/macros/s/fixture/exec" });
  await timed.start(); assert.equal(delay, 2147483647);
  f.environment.navigator.onLine = false; timed.networkChanged(); clock = SYNC_UPLOAD_CUTOFF - 100;
  scheduled(); assert.equal(delay, 100); clock += 100; scheduled();
  assert.equal(updates.at(-1).closed, true); assert.equal(timed.getState().disabled, true);
});

test("Google 固定截止不信任裝置時間；舊有效許可可用，過期或超出截止的許可不可用", async () => {
  const r = await receiverFixture({ cache: false }), { send, identity, sessionId, parent, properties } = r;
  const fixed = send({ action: "enable", identity, sessionId }); assert.equal(fixed.expiresAt, SYNC_UPLOAD_CUTOFF);
  const sign = expiresAt => {
    const encoded = Buffer.from(JSON.stringify({ version: 1, activityId: SYNC_ACTIVITY_ID, identity, sessionId, expiresAt })).toString("base64url");
    return encoded + "." + createHmac("sha256", properties.get("SIGNING_KEY")).update(encoded).digest("base64url");
  };
  assert.equal(send({ action: "submit", ticket: sign(SYNC_UPLOAD_CUTOFF + 1), events: [parent] }).error, "TICKET");
  const legacy = sign(SYNC_TEST_NOW + 7 * 86400000);
  assert.equal(send({ action: "submit", ticket: legacy, events: [parent] }).ok, true);
  r.clock = SYNC_TEST_NOW + 7 * 86400000;
  assert.equal(send({ action: "submit", ticket: legacy, events: [parent] }).error, "TICKET");
  r.clock = SYNC_UPLOAD_CUTOFF - 1;
  assert.equal(send({ action: "enable", identity, sessionId }).expiresAt, SYNC_UPLOAD_CUTOFF);
  assert.equal(send({ action: "submit", ticket: fixed.ticket, events: [parent] }).ok, true);
  const snapshot = structuredClone(r.rows); r.clock = SYNC_UPLOAD_CUTOFF;
  for (const action of ["enable", "submit"]) {
    assert.equal(send(action === "enable" ? { action, identity, sessionId } : { action, ticket: fixed.ticket, events: [parent] }).error, "CLOSED");
  }
  assert.equal(JSON.stringify(r.rows), JSON.stringify(snapshot));
});

test("Google 操作鎖、讀取及分批寫入跨過截止均停止；已成功紀錄不刪除、不在截止後重試", async () => {
  for (const point of ["lock", "read", "append"]) {
    const r = await receiverFixture({ cache: false }), { send, identity, sessionId, parent } = r;
    r.clock = SYNC_UPLOAD_CUTOFF - 1; const permit = send({ action: "enable", identity, sessionId });
    const close = () => { r.clock = SYNC_UPLOAD_CUTOFF; };
    if (point === "lock") r.onLock = close;
    if (point === "read") r.onRead = close;
    if (point === "append") r.onAppend = close;
    const cancel = { ...parent, eventId: randomUUID(), sequence: 2, action: "cancel" };
    assert.equal(send({ action: "submit", ticket: permit.ticket, events: [parent, cancel] }).error, "CLOSED", point);
    assert.equal(r.rows.length, point === "append" ? 2 : 1); assert.equal(r.releases, 1);
    const snapshot = structuredClone(r.rows);
    assert.equal(send({ action: "submit", ticket: permit.ticket, events: [parent, cancel] }).error, "CLOSED");
    assert.equal(JSON.stringify(r.rows), JSON.stringify(snapshot));
  }
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
  const starting = app.controller.start(); await tick();
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


test("登出等待已接受的儲存，取消傳輸不會丟失原事件或改動 epoch/session", async () => {
  const f = syncFixture(); await f.sync.start(); await f.sync.enable(); f.environment.navigator.onLine = false;
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), began = new Promise(resolve => { entered = resolve; });
  const update = f.repository.update;
  f.repository.update = async change => { entered(); await gate; return update(change); };
  const original = structuredClone(f.data), event = f.sync.enqueue(f.record()); await began;
  f.allowed = false; let settled = false;
  const logout = f.sync.prepareLogout().then(value => { settled = true; return value; });
  await tick(); assert.equal(settled, false); assert.equal(f.sync.getState().unsaved, 1);
  release(); await event; assert.equal(await logout, true);
  assert.equal(f.sync.getState().unsaved, 0); assert.equal(f.data.pending.length, 1);
  assert.equal(f.data.epoch, original.epoch); assert.deepEqual(f.data.enrollment, original.enrollment);
  const saved = structuredClone(f.data); assert.equal(await f.sync.enqueue(f.record("sun-yat-sen")), false);
  assert.equal(await f.sync.enable(), false); await f.sync.upload(); f.sync.networkChanged(); await tick(); assert.deepEqual(f.data, saved);
  f.allowed = true; assert.equal(await f.sync.start(), "ready"); assert.deepEqual(f.data, saved);
});

test("登出保存失敗拒絕完成，重試沿用原事件且不更換身份佇列", async () => {
  const f = syncFixture(); await f.sync.start(); await f.sync.enable(); f.environment.navigator.onLine = false;
  const update = f.repository.update; let fail = true; const attempts = [];
  f.repository.update = change => update(value => { const next = change(value); attempts.push(structuredClone(next.pending)); if (fail) throw Error("quota"); return next; });
  await f.sync.enqueue(f.record()); f.allowed = false;
  assert.equal(await f.sync.prepareLogout(), false); assert.equal(f.sync.getState().unsaved, 1);
  assert.match(f.sync.getState().reason, /離開或重載會遺失/);
  const original = structuredClone(f.data);
  f.identity = { ...FIXTURE_IDENTITY, studentNumber: "另一身份" };
  assert.equal(await f.sync.start(), "conflict"); assert.deepEqual(f.data, original); assert.equal(f.sync.getState().unsaved, 1);
  fail = false; assert.equal(await f.sync.prepareLogout(), true);
  assert.equal(f.data.pending.length, 1); assert.equal(new Set(attempts.flat().map(item => item.eventId)).size, 1);
  assert.equal(f.data.pending[0].sequence, 1); assert.deepEqual(f.data.enrollment, original.enrollment);
});

test("已保存佇列拒絕換學生，保留完整資料；明確清除仍會使遲來寫入失效", async () => {
  const f = syncFixture(); await f.sync.start(); await f.sync.enable(); f.environment.navigator.onLine = false;
  await f.sync.enqueue(f.record()); const original = structuredClone(f.data);
  f.identity = FIXTURE_IDENTITY; assert.equal(await f.sync.start(), "conflict"); assert.deepEqual(f.data, original);
  const other = createCheckInSync({ environment: f.environment, repository: f.repository, getIdentity: () => FIXTURE_IDENTITY,
    endpoint: "https://script.google.com/macros/s/fixture/exec", now: () => SYNC_TEST_NOW });
  assert.equal(await other.start(), "conflict"); assert.equal(await other.enable(), false); assert.deepEqual(f.data, original);
  await f.sync.stop({ clear: true }); assert.equal(f.data.pending.length, 0); assert.equal(f.data.enrollment, null); assert.notEqual(f.data.epoch, original.epoch);
});

test("未收到 storage 事件也拒絕登出後的遲來回條，原事件保持待傳", async () => {
  const f = syncFixture(); await f.sync.start(); await f.sync.enable(); f.environment.navigator.onLine = false;
  await f.sync.enqueue(f.record()); const original = structuredClone(f.data); let release;
  f.handler = body => new Promise(resolve => { release = () => resolve(receipt({ sessionId: original.enrollment.sessionId, accepted: body.events.map(item => item.eventId) })); });
  f.environment.navigator.onLine = true; const work = f.sync.upload(); await tick();
  f.allowed = false; release(); await work; assert.deepEqual(f.data, original);
  assert.equal(await f.sync.prepareLogout(), true); assert.deepEqual(f.data, original);
});


test("明確清除先完成時，舊 epoch 的待傳保存不能恢復事件", async () => {
  const f = syncFixture(); await f.sync.start(); await f.sync.enable(); f.environment.navigator.onLine = false;
  const originalEpoch = f.data.epoch, update = f.repository.update; let release, waiting = true;
  f.repository.update = change => waiting ? new Promise(resolve => { release = () => resolve(update(change)); }) : update(change);
  const event = f.sync.enqueue(f.record()); await tick(); waiting = false;
  await f.sync.stop({ clear: true }); const cleared = structuredClone(f.data);
  release(); await event; assert.notEqual(cleared.epoch, originalEpoch); assert.deepEqual(f.data, cleared); assert.equal(f.sync.getState().unsaved, 0);
});

test("應用拒絕不同學生的既存佇列，首次輸入也不能覆蓋它", async () => {
  const f = syncFixture(); await f.sync.start(); await f.sync.enable(); f.environment.navigator.onLine = false; await f.sync.enqueue(f.record());
  const original = structuredClone(f.data);
  for (const initialIdentity of [FIXTURE_IDENTITY, null]) {
    const app = appHarness({ initialIdentity, controllerFactory: options => createAppController({ ...options,
      syncEndpoint: "https://script.google.com/macros/s/fixture/exec", syncRepository: f.repository }) });
    await app.controller.start();
    if (!initialIdentity) { await app.click("install-dismiss"); fillStudentIdentity(app); await submitStudentIdentity(app); }
    assert.equal(app.controller.getPageSnapshot().mode, "blocked"); assert.doesNotMatch(app.element("#app").innerHTML, /student-login-form|<input/);
    assert.deepEqual(f.data, original);
    if (!initialIdentity) assert.equal(app.environment.localStorage.getItem(STUDENT_IDENTITY_STORAGE_KEY), null);
  }
});

test("首次登入讀不到原學生佇列時不能保存新身份或以臨時身份接管資料", async () => {
  const f = syncFixture(); await f.sync.start(); await f.sync.enable(); f.environment.navigator.onLine = false; await f.sync.enqueue(f.record());
  const original = structuredClone(f.data), read = f.repository.read;
  let reads = 0, identityWrites = 0, photoReads = 0;
  f.repository.read = async () => { if (++reads === 1) throw Error("合成讀取失敗"); return read(); };
  const app = appHarness({ initialIdentity: null, initialState: checkedState(), initialPhotos: [{ attractionId: "future-school", blob: new Blob(["original pixels"]) }],
    controllerFactory: options => {
      const set = options.environment.localStorage.setItem;
      options.environment.localStorage.setItem = (key, value) => { if (key === STUDENT_IDENTITY_STORAGE_KEY) identityWrites++; return set(key, value); };
      options.environment.navigator.onLine = false;
      return createAppController({ ...options, syncEndpoint: "https://script.google.com/macros/s/fixture/exec", syncRepository: f.repository });
    } });
  app.photoService.getAllPhotoRecords = async () => { photoReads++; return [...app.photoData.values()]; };
  const progress = app.environment.localStorage.getItem(STORAGE_KEY), photos = [...app.photoData.values()];
  await app.controller.start(); await app.click("install-dismiss"); fillStudentIdentity(app); await submitStudentIdentity(app);
  assert.equal(app.controller.getPageSnapshot().mode, "blocked"); assert.equal(reads, 1);
  assert.equal(app.controller.getPageSnapshot().saveFailed, false);
  assert.doesNotMatch(app.element("#app").innerHTML, /data-student-identity-temporary|student-login-form/);
  await app.click("student-identity-temporary"); await app.click("checkin", "sun-yat-sen");
  assert.equal(identityWrites, 0); assert.equal(photoReads, 0);
  assert.equal(app.environment.localStorage.getItem(STUDENT_IDENTITY_STORAGE_KEY), null);
  assert.equal(app.environment.localStorage.getItem(STORAGE_KEY), progress);
  assert.deepEqual([...app.photoData.values()], photos); assert.deepEqual(f.data, original);
});

for (const change of ["route", "pagehide", "pageshow", "logout", "identity", "reset"]) test(`等待原學生佇列期間${change}保留登入及取消界線`, async () => {
  const f = syncFixture({ profile: FIXTURE_IDENTITY }); await f.sync.start(); await f.sync.enable(); f.environment.navigator.onLine = false;
  await f.sync.enqueue(f.record()); const original = structuredClone(f.data), read = f.repository.read;
  let release, releaseNew, showing, reads = 0, photoReads = 0;
  f.repository.read = async () => {
    if (++reads === 1) await new Promise(resolve => { release = resolve; });
    else if (change === "pageshow" && reads === 2) await new Promise(resolve => { releaseNew = resolve; });
    return read();
  };
  const photo = { attractionId: "future-school", photoId: "saved-photo", blob: new Blob(["saved pixels"]) };
  const app = appHarness({ initialState: checkedState(), initialPhotos: change === "pageshow" ? [photo] : [],
    hash: change === "pageshow" ? "#memories" : "#home", controllerFactory: options => {
      options.environment.navigator.onLine = false; options.environment.crypto = { randomUUID };
      return createAppController({ ...options, syncEndpoint: "https://script.google.com/macros/s/fixture/exec", syncRepository: f.repository });
    } });
  app.photoService.getAllPhotoRecords = async () => { photoReads++; return [...app.photoData.values()]; };
  let startSettled = false;
  const starting = app.controller.start().finally(() => { startSettled = true; }); await tick();
  assert.equal(app.controller.getPageSnapshot().pending, true);
  if (change === "route") app.navigate("#memories");
  if (change === "pagehide" || change === "pageshow") app.events.get("window:pagehide")();
  if (change === "pageshow") {
    showing = app.events.get("window:pageshow")(); await tick();
    assert.equal(app.controller.getPageSnapshot().pending, true);
  }
  if (change === "logout" || change === "identity") {
    const key = change === "logout" ? "outdoorLearningDay.signedOut.v1" : STUDENT_IDENTITY_STORAGE_KEY;
    app.environment.localStorage.setItem(key, change === "logout" ? "1" : JSON.stringify({ version: 1, ...FIXTURE_IDENTITY, studentName: "別人" }));
    app.events.get("window:storage")({ key });
  }
  if (change === "reset") {
    await f.sync.stop({ clear: true });
    app.environment.localStorage.removeItem(STUDENT_IDENTITY_STORAGE_KEY); app.environment.localStorage.removeItem(STORAGE_KEY);
    app.events.get("window:storage")({ key: null });
  }
  if (change === "pageshow") {
    releaseNew(); await showing;
    const current = app.controller.getPageSnapshot();
    assert.equal(current.view, "memories"); assert.equal(current.readState, "ready");
    assert.equal(current.photoCount, 1); assert.equal(current.albums[0].cover.photoId, photo.photoId);
    assert.equal(photoReads, 1); assert.equal(startSettled, false);
  }
  release(); await starting; await tick();
  if (change === "route" || change === "pageshow") {
    assert.equal(app.controller.getPageSnapshot().view, "memories");
    assert.equal(photoReads, 1);
    if (change === "pageshow") {
      const current = app.controller.getPageSnapshot();
      assert.equal(current.readState, "ready"); assert.equal(current.photoCount, 1);
      assert.equal(current.albums[0].cover.photoId, photo.photoId);
    }
    assert.equal(app.environment.localStorage.getItem("outdoorLearningDay.signedOut.v1"), null);
  } else {
    assert.equal(app.controller.getPageSnapshot().view, "login"); assert.equal(photoReads, 0);
    if (change === "pagehide") {
      assert.equal(app.controller.getPageSnapshot().mode, "journey");
      await app.events.get("window:pageshow")(); assert.equal(app.controller.getPageSnapshot().view, "itinerary");
    }
  }
  if (change !== "reset") assert.deepEqual(f.data, original);
});

test("應用登出遇未存事件會拒絕完成並保留離頁警告，重試後保留原佇列", async () => {
  const f = syncFixture({ profile: FIXTURE_IDENTITY }); await f.sync.start(); await f.sync.enable(); f.environment.navigator.onLine = false;
  const app = appHarness({ hash: "#itinerary", controllerFactory: options => {
    options.environment.crypto = { randomUUID }; options.environment.navigator.onLine = false;
    return createAppController({ ...options, syncEndpoint: "https://script.google.com/macros/s/fixture/exec", syncRepository: f.repository });
  } });
  await app.controller.start(); app.confirmation.handler = async () => true; f.blocked = true;
  await app.click("checkin", "future-school"); await tick(); assert.equal(app.controller.getPageSnapshot().sync.unsaved, 1);
  const identity = app.environment.localStorage.getItem(STUDENT_IDENTITY_STORAGE_KEY), enrollment = structuredClone(f.data.enrollment);
  await app.click("student-profile-open"); await app.click("student-identity-logout");
  assert.equal(app.controller.getPageSnapshot().mode, "profile"); assert.match(app.controller.getPageSnapshot().status, /尚未存妥/);
  let warned = false; app.events.get("window:beforeunload")({ preventDefault() { warned = true; } }); assert.equal(warned, true);
  f.blocked = false; await app.click("student-identity-logout"); assert.equal(app.controller.getPageSnapshot().mode, "signedOut");
  assert.equal(f.data.pending.length, 1); assert.deepEqual(f.data.enrollment, enrollment);
  assert.equal(app.environment.localStorage.getItem(STUDENT_IDENTITY_STORAGE_KEY), identity);
});


test("另一分頁登出時未存事件保留且警告離頁，恢復儲存後重試不遺失紀錄", async () => {
  const f = syncFixture({ profile: FIXTURE_IDENTITY }); await f.sync.start(); await f.sync.enable(); f.environment.navigator.onLine = false;
  const app = appHarness({ hash: "#itinerary", controllerFactory: options => {
    options.environment.crypto = { randomUUID }; options.environment.navigator.onLine = false;
    return createAppController({ ...options, syncEndpoint: "https://script.google.com/macros/s/fixture/exec", syncRepository: f.repository });
  } });
  await app.controller.start(); app.confirmation.handler = async () => true; f.blocked = true;
  await app.click("checkin", "future-school"); await tick();
  app.environment.localStorage.setItem("outdoorLearningDay.signedOut.v1", "1");
  app.events.get("window:storage")({ key: "outdoorLearningDay.signedOut.v1" }); await tick();
  assert.equal(app.controller.getPageSnapshot().mode, "signedOut"); assert.match(app.controller.getPageSnapshot().status, /尚未存妥/);
  let warned = false; app.events.get("window:beforeunload")({ preventDefault() { warned = true; } }); assert.equal(warned, true);
  assert.equal(f.data.pending.length, 0);
  f.blocked = false; await app.click("student-identity-logout"); assert.equal(f.data.pending.length, 1);
  const saved = structuredClone(f.data); await app.click("student-identity-login"); assert.deepEqual(f.data, saved);
});
