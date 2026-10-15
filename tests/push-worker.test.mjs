import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../sw.js", import.meta.url), "utf8");
const base = "https://example.test/trip/";
function harness(pushManager) {
  const events = {}, calls = [];
  const context = vm.createContext({ URL, Request, Response, Promise,
    self: { registration: { scope: base, pushManager }, addEventListener: (type, handler) => { events[type] = handler; },
      clients: { claim: async () => { calls.push("claim"); } }, skipWaiting: async () => {} },
    caches: { keys: async () => ["outdoor-learning-day-v123", "outdoor-learning-day-v135", "other-project"],
      delete: async key => { calls.push(key); }, open: async () => ({ put() {} }), match: async () => null },
    fetch: async () => { calls.push("network"); return new Response("unused"); }
  });
  vm.runInContext(source, context);
  return { events, calls, context, activate: async () => {
    const pending = [];
    events.activate({ waitUntil: task => { pending.push(task); } });
    await Promise.all(pending);
  } };
}

test("Service Worker 沒有通知接收、點擊、訂閱或公告程式，仍保留离線事件", () => {
  const app = harness();
  assert.deepEqual(Object.keys(app.events).sort(), ["activate", "fetch", "install"]);
  assert.doesNotMatch(source, /showNotification|notificationclick|registrationProof|notificationPayload|\bsubscribe\s*\(/);
  const shell = Array.from(vm.runInContext("APP_SHELL", app.context));
  assert.equal(shell.length, 70);
  assert.ok(!shell.some(file => file.includes("google-upload-auth")));
  assert.ok(shell.includes("./src/check-in-sync.js"));
  assert.ok(!shell.some(file => file.startsWith("./google/") || file.includes("script.google")));
  for (const file of ["./src/student-identity.js", "./src/student-login-controller.js", "./src/student-login-view.js"]) assert.ok(shell.includes(file));
  assert.equal(shell.includes("./public/images/task-complete.jpg"), false);
  assert.equal(shell.includes("./public/images/attractions/departure-school.jpg"), false);
  assert.equal(shell.some(file => /workbook-|vendor\/pdf-lib/.test(file)), false);
  assert.equal(shell.some(file => /push-client|push-config|push-backend/.test(file)), false);
});

test("更新時取消本站舊訂閱，只清理舊 App 快取，保留其他網站快取", async () => {
  let unsubscribe = 0;
  const app = harness({ getSubscription: async () => ({ unsubscribe: async () => { unsubscribe++; return true; } }) });
  await app.activate();
  assert.equal(unsubscribe, 1);
  assert.deepEqual(app.calls, ["outdoor-learning-day-v123", "claim"]);
});

for (const [name, manager] of [
  ["不支援通知", undefined],
  ["沒有舊訂閱", { getSubscription: async () => null }],
  ["查詢失敗", { getSubscription: async () => { throw Error("offline"); } }],
  ["取消失敗", { getSubscription: async () => ({ unsubscribe: async () => { throw Error("offline"); } }) }]
]) test(name + "也不阻止離線啟用，不對外發送資料", async () => {
  const app = harness(manager);
  await app.activate();
  assert.deepEqual(app.calls, ["outdoor-learning-day-v123", "claim"]);
});

test("移除通知後仍不攔截 API、外部請求、查詢網址及非 GET", () => {
  const app = harness();
  for (const request of [
    { method: "POST", url: base + "index.html" },
    { method: "GET", url: base + "v1/subscriptions" },
    { method: "GET", url: "https://outside.test/index.html" },
    { method: "GET", url: base + "src/push-client.js" },
    { method: "GET", url: base + "src/controller.js?private=1" }
  ]) {
    let handled = false;
    app.events.fetch({ request, respondWith() { handled = true; }, waitUntil() {} });
    assert.equal(handled, false);
  }
});
