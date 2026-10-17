import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createCheckInSync, SYNC_ACTIVITY_ID, SYNC_UPLOAD_CUTOFF } from "../src/check-in-sync.js";

const clone = value => structuredClone(value);
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function clock() {
  let now = Date.parse("2026-10-17T12:00:00Z"), id = 0;
  const tasks = new Map(), history = [];
  return { tasks, history, now: () => now, jump: ms => { now += ms; },
    setTimeout(callback, delay) { const task = { callback, at: now + delay, delay }; tasks.set(++id, task); history.push(task); return id; },
    clearTimeout(id) { tasks.delete(id); },
    async advance(ms) {
      const end = now + ms;
      while (true) {
        await flush();
        const next = [...tasks].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; tasks.delete(next[0]); next[1].callback(); await flush();
      }
      now = end; await flush();
    }
  };
}
function fixture({ random = 0 } = {}) {
  const timers = clock(), channels = [], sent = [], rows = new Set();
  let saved = null, identity = { studentName: "合成學生", className: "測試班", studentNumber: "001" }, handler, failWrites = 0;
  const repository = { read: async () => clone(saved), update: async change => {
    if (failWrites) { failWrites--; throw Error("合成保存失敗"); }
    saved = change(clone(saved)); return clone(saved);
  }, reset: async value => { saved = clone(value); return clone(saved); } };
  const environment = { document: {}, window: timers, Math: { random: () => random }, crypto: { randomUUID }, navigator: { onLine: false },
    BroadcastChannel: class { constructor() { channels.push(this); } postMessage() {} },
    fetch: async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.action === "enable") return reply({ sessionId: body.sessionId, ticket: "synthetic", expiresAt: SYNC_UPLOAD_CUTOFF });
      sent.push(clone(body));
      if (handler) return handler(body, options);
      for (const event of body.events) rows.add(event.eventId);
      return reply({ sessionId: saved.enrollment.sessionId, accepted: body.events.map(event => event.eventId) });
    } };
  const create = () => createCheckInSync({ environment, repository, getIdentity: () => identity, now: timers.now,
    endpoint: "https://script.google.com/macros/s/synthetic/exec" });
  const sync = create(), record = (index = 0) => ({ attractionId: "future-school", method: "manual", verified: false,
    checkedInAt: new Date(timers.now() + index * 1000).toISOString() });
  return { timers, environment, sync, create, sent, rows, channels, repository, record,
    get saved() { return clone(saved); }, set handler(value) { handler = value; }, set failWrites(value) { failWrites = value; },
    set identity(value) { identity = value; },
    async ready(count = 1) { await sync.start(); environment.navigator.onLine = true; assert.equal(await sync.enable(), true);
      environment.navigator.onLine = false; for (let i = 0; i < count; i++) await sync.enqueue(record(i)); environment.navigator.onLine = true; }
  };
}
const reply = value => ({ ok: true, status: 200, text: async () => JSON.stringify({ version: 1, activityId: SYNC_ACTIVITY_ID, ok: true, ...value }) });

test("首次上傳分散 0.5 至 30 秒，連按共用已排隊工作，真正計時後自動清空", async () => {
  for (const [random, delay] of [[0, 500], [1, 30000]]) {
    const f = fixture({ random }); await f.ready(); const pending = f.saved.pending;
    const upload = f.sync.upload(); assert.equal(f.sync.upload(), upload); assert.equal(f.sent.length, 0);
    assert.equal(f.sync.getState().status, "排隊上傳"); assert.equal(f.sync.getState().button, "已排隊");
    assert.equal(f.sync.getState().disabled, true);
    await f.timers.advance(delay - 1); assert.equal(f.sent.length, 0);
    await f.timers.advance(1); assert.equal(await upload, true); assert.equal(f.saved.pending.length, 0);
    assert.deepEqual(f.sent[0].events, pending); assert.equal(f.sync.getState().status, "已上傳");
    await f.sync.stop(); assert.equal(f.timers.tasks.size, 0);
  }
});

test("Google 已寫入但回條丟失，自動重試沿用同一事件只入表一次", async () => {
  const f = fixture(); await f.ready(); const original = f.saved.pending;
  f.handler = body => { body.events.forEach(event => f.rows.add(event.eventId)); throw new TypeError("late write, response lost"); };
  const upload = f.sync.upload(); await f.timers.advance(500); assert.equal(await upload, false);
  assert.deepEqual(f.saved.pending, original); assert.match(f.sync.getState().reason, /自動重試/);
  const retry = f.sync.upload(); assert.equal(f.sync.upload(), retry);
  await f.timers.advance(9999); assert.equal(f.sent.length, 1);
  f.handler = null; await f.timers.advance(1); assert.equal(await retry, true);
  assert.equal(f.sent.length, 2); assert.deepEqual(f.sent[0], f.sent[1]); assert.equal(f.rows.size, 1); assert.equal(f.saved.pending.length, 0);
  await f.sync.stop();
});

test("逾時取消請求後自動重試，部分確認只移除正確前綴", async () => {
  const f = fixture(); await f.ready(2); const ids = f.saved.pending.map(event => event.eventId);
  f.handler = (_body, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
  const first = f.sync.upload(); await f.timers.advance(10500); assert.equal(await first, false); assert.match(f.sync.getState().reason, /逾時/);
  f.handler = body => reply({ sessionId: f.saved.enrollment.sessionId, accepted: [body.events[0].eventId] });
  await f.timers.advance(10000); assert.deepEqual(f.saved.pending.map(event => event.eventId), [ids[1]]);
  f.handler = null; await f.timers.advance(20000); assert.equal(f.saved.pending.length, 0);
  assert.deepEqual(f.sent.map(body => body.events.map(event => event.eventId)), [ids, ids, [ids[1]]]);
  await f.sync.stop();
});

test("確認保存失敗後保留原事件，重試不重複寫入；未保存警告不被排隊訊息掩蓋", async () => {
  const f = fixture(); await f.ready(); const original = f.saved.pending;
  f.handler = body => { body.events.forEach(event => f.rows.add(event.eventId)); f.failWrites = 1;
    return reply({ sessionId: f.saved.enrollment.sessionId, accepted: body.events.map(event => event.eventId) }); };
  f.sync.upload(); await f.timers.advance(500); assert.deepEqual(f.saved.pending, original); assert.match(f.sync.getState().reason, /裝置未能保存確認/);
  f.handler = null; await f.timers.advance(10000); assert.equal(f.rows.size, 1); assert.equal(f.saved.pending.length, 0);
  f.environment.navigator.onLine = false; f.failWrites = 1; assert.equal(await f.sync.enqueue(f.record(1)), false);
  assert.equal(f.sync.getState().unsaved, 1); f.environment.navigator.onLine = true; f.sync.upload();
  assert.match(f.sync.getState().reason, /尚未保存在裝置.*重載會遺失/);
  await f.timers.advance(500); assert.equal(f.sync.getState().unsaved, 0); assert.equal(f.rows.size, 2); await f.sync.stop();
});

test("僅暫時錯誤自動重試，永久錯誤及偽造確認停止並保留待傳", async () => {
  for (const kind of ["BUSY", "WRITE", "HTTP429", "HTTP503", "HTML", "CONFIG", "FORMAT", "ACTIVITY", "ORDER", "DISABLED", "TICKET", "CLOSED", "session", "id", "protocol"]) {
    const f = fixture(); await f.ready();
    const transient = ["BUSY", "WRITE", "HTTP429", "HTTP503", "HTML"].includes(kind);
    f.handler = body => {
      if (kind.startsWith("HTTP")) return { ok: false, status: Number(kind.slice(4)) };
      if (kind === "HTML") return { ok: true, text: async () => "<html>quota</html>" };
      if (kind === "session") return reply({ sessionId: "wrong", accepted: [body.events[0].eventId] });
      if (kind === "id") return reply({ sessionId: f.saved.enrollment.sessionId, accepted: [randomUUID()] });
      if (kind === "protocol") return reply({ version: 2 });
      return reply({ ok: false, error: kind });
    };
    f.sync.upload(); await f.timers.advance(500); assert.equal(f.saved.pending.length, 1, kind);
    if (!transient) {
      const reason = f.sync.getState().reason; await f.sync.enqueue(f.record(2));
      f.channels[0].onmessage({ data: "refresh" }); await flush();
      assert.equal(f.sync.getState().reason, reason, kind);
    }
    f.handler = null; await f.timers.advance(10000);
    assert.equal(f.sent.length, transient ? 2 : 1, kind); assert.equal(f.saved.pending.length, transient ? 0 : kind === "CLOSED" ? 1 : 2, kind);
    if (kind === "TICKET") assert.equal(f.sync.getState().needsEnable, true);
    await f.sync.stop(); assert.equal(f.timers.tasks.size, 0);
  }
});

test("退避增加至 120 秒上限，八次失敗後停止，只有明確手動才開始新一輪", async () => {
  const f = fixture({ random: 1 }); await f.ready(); f.handler = () => reply({ ok: false, error: "BUSY" });
  f.sync.upload(); await f.timers.advance(900000); assert.equal(f.sent.length, 8); assert.equal(f.saved.pending.length, 1);
  const delays = f.timers.history.filter(task => task.delay <= 120000 && task.delay !== 10000).map(task => task.delay);
  assert.deepEqual(delays, [30000, 20000, 40000, 80000, 120000, 120000, 120000, 120000]);
  assert.match(f.sync.getState().reason, /暫停自動重試/); f.channels[0].onmessage({ data: "refresh" }); await flush();
  await f.sync.enqueue(f.record(2)); await f.timers.advance(900000); assert.equal(f.sent.length, 8); assert.match(f.sync.getState().reason, /暫停自動重試/);
  f.handler = null; const manual = f.sync.upload(); await f.timers.advance(30000); assert.equal(await manual, true); assert.equal(f.saved.pending.length, 0); await f.sync.stop();
});

test("上傳中新增紀錄不開第二個請求，先後順序保留", async () => {
  const f = fixture(); await f.ready(); let release;
  f.handler = body => new Promise(resolve => { release = () => resolve(reply({ sessionId: f.saved.enrollment.sessionId, accepted: body.events.map(event => event.eventId) })); });
  const work = f.sync.upload(); await f.timers.advance(500); assert.equal(f.sync.upload(), work);
  await f.sync.enqueue(f.record(1)); assert.equal(f.sent.length, 1); f.handler = null; release(); await flush();
  assert.equal(await work, true); assert.equal(f.sent.length, 2); assert.equal(f.saved.pending.length, 0);
  assert.deepEqual(f.sent.map(body => body.events[0].sequence), [1, 2]); await f.sync.stop();
});

test("停止、清除及失效會取消排隊，舊計時 callback 不取消新一輪", async () => {
  for (const action of ["stop", "clear", "invalidate", "identity", "cutoff"]) {
    const f = fixture(); await f.ready(); const pending = f.saved.pending;
    const work = f.sync.upload(), stale = [...f.timers.tasks.values()].find(task => task.delay === 500).callback;
    if (action === "stop") await f.sync.stop();
    if (action === "clear") await f.sync.stop({ clear: true });
    if (action === "invalidate") f.sync.invalidate();
    if (action === "identity") { f.identity = { studentName: "另一合成學生", className: "測試班", studentNumber: "002" }; await f.sync.start(); }
    if (action === "cutoff") { f.timers.jump(SYNC_UPLOAD_CUTOFF - f.timers.now()); const [id, deadline] = [...f.timers.tasks].find(([, task]) => task.delay > 120000); f.timers.tasks.delete(id); deadline.callback(); }
    if (action !== "identity") assert.equal(await work, false);
    stale(); await flush(); assert.equal(f.sent.length, 0, action);
    if (!["clear", "identity"].includes(action)) assert.deepEqual(f.saved.pending, pending);
    await f.sync.stop(); assert.equal(f.timers.tasks.size, 0);
  }
  const f = fixture(); await f.ready(); f.sync.upload(); const stale = [...f.timers.tasks.values()].find(task => task.delay === 500).callback;
  f.sync.invalidate(); await f.sync.start(); stale(); await f.timers.advance(500); assert.equal(f.sent.length, 1); assert.equal(f.saved.pending.length, 0); await f.sync.stop();
});

test("連線恢復及重新載入自動補傳，兩分頁 Web Locks 重讀佇列避免多送", async () => {
  const f = fixture(); await f.ready(); f.sync.upload(); f.environment.navigator.onLine = false; f.sync.networkChanged();
  await f.timers.advance(30000); assert.equal(f.sent.length, 0); assert.match(f.sync.getState().reason, /離線/);
  f.environment.navigator.onLine = true; f.sync.networkChanged(); await flush(); await f.timers.advance(500); assert.equal(f.saved.pending.length, 0);
  f.environment.navigator.onLine = false; await f.sync.enqueue(f.record(1)); await f.sync.stop();
  let lock = Promise.resolve(), acquired = 0;
  f.environment.navigator.locks = { request(_name, task) { const next = lock.then(() => { acquired++; return task(); }); lock = next.catch(() => {}); return next; } };
  f.environment.navigator.onLine = true; const second = f.create(), third = f.create(); await second.start(); await third.start(); await f.timers.advance(500);
  assert.equal(acquired, 2); assert.equal(f.sent.length, 2); assert.equal(f.saved.pending.length, 0); await second.stop(); await third.stop();
});


test("在途舊回覆及停止後的 finally 不會重啟計時或清除新資料", async () => {
  for (const clear of [false, true]) {
    const f = fixture(); await f.ready(); const original = f.saved.pending; let release;
    f.handler = body => new Promise(resolve => { release = () => resolve(reply({ sessionId: f.saved.enrollment?.sessionId, accepted: body.events.map(event => event.eventId) })); });
    const work = f.sync.upload(); await f.timers.advance(500); await f.sync.stop({ clear }); release(); await flush();
    assert.equal(await work, false); assert.equal(f.timers.tasks.size, 0); assert.deepEqual(f.saved.pending, clear ? [] : original);
    await f.timers.advance(600000); assert.equal(f.sent.length, 1);
  }
});


test("停止後廣播及新增紀錄不會偷偷恢復，另一分頁確認完成則取消空佇列計時", async () => {
  for (const stop of [false, true]) {
    const f = fixture(); await f.ready(); f.sync.upload();
    if (stop) await f.sync.stop(); else f.sync.invalidate();
    f.channels[0].onmessage({ data: "refresh" }); await flush(); await f.sync.enqueue(f.record(1));
    await f.timers.advance(30000); assert.equal(f.sent.length, 0); assert.equal(f.saved.pending.length, 2);
    const manual = f.sync.upload(); await f.timers.advance(500); assert.equal(await manual, true); assert.equal(f.saved.pending.length, 0); await f.sync.stop();
  }
  const f = fixture(); await f.ready(); const queued = f.sync.upload();
  await f.repository.update(value => { value.pending = []; value.lastUploadedAt = new Date(f.timers.now()).toISOString(); return value; });
  f.channels[0].onmessage({ data: "refresh" }); await flush(); assert.equal(await queued, false);
  assert.equal(f.sync.getState().status, "已上傳"); await f.timers.advance(30000); assert.equal(f.sent.length, 0); await f.sync.stop();
});
