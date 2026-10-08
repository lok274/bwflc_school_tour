import test from "node:test";
import assert from "node:assert/strict";
import { appHarness, checkedState } from "./helpers/browser-environment.js";
import { createViews } from "../src/views.js";

function mockPush() {
  const calls = [];
  const state = { supported: true, permission: "default", busy: false, subscribed: false,
    serverRegistered: false, canEnable: true, canDisable: false, canTest: false,
    statusMessage: "可以開啟通知。" };
  let changed;
  let options;
  const service = {
    getSnapshot: () => structuredClone(state),
    initialize: async () => { calls.push("initialize"); },
    refresh: async () => { calls.push("refresh"); },
    enable: () => { calls.push("enable"); return Promise.resolve(); },
    disable: () => { calls.push("disable"); return Promise.resolve(); },
    sendTest: () => { calls.push("test"); return Promise.resolve(); },
    dispose: () => { calls.push("dispose"); }
  };
  return { calls, state, service, get options() { return options; },
    factory(value) { options = value; changed = value.onChange; return service; },
    notify() { changed(); } };
}

test("通知操作只接受首頁當前有效控制項，開啟同步進入 client", async () => {
  const push = mockPush();
  const app = appHarness({ pushClientFactory: push.factory });
  await app.controller.start();
  const pending = app.click("push-enable");
  assert.equal(push.calls.at(-1), "enable");
  await pending;
  const before = push.calls.length;
  await app.click("push-enable", undefined, { detached: true });
  app.navigate("#itinerary");
  await app.click("push-enable");
  assert.equal(push.calls.length, before);
  app.navigate("#home");
  push.state.canEnable = false;
  await app.click("push-enable");
  assert.equal(push.calls.length, before);
  push.state.canDisable = true;
  push.state.canTest = true;
  await app.click("push-disable");
  await app.click("push-test");
  assert.equal(push.calls.at(-1), "disable");
  assert.equal(push.calls.includes("test"), false);
});

test("離開頁面不取消通知，遲來的狀態不重畫其他頁面", async () => {
  const push = mockPush();
  const app = appHarness({ pushClientFactory: push.factory });
  await app.controller.start();
  app.navigate("#itinerary");
  const current = app.element("#app").innerHTML;
  push.state.statusMessage = "已開啟通知。";
  push.notify();
  assert.equal(app.element("#app").innerHTML, current);
  app.events.get("window:pagehide")();
  assert.equal(push.calls.includes("disable"), false);
  assert.equal(push.calls.includes("dispose"), false);
  app.events.get("window:pageshow")();
  app.events.get("window:online")();
  assert.equal(push.calls.filter(value => value === "refresh").length, 2);
  app.navigate("#home");
  assert.match(app.element("#app").innerHTML, /已開啟通知/);
});

test("清除旅程資料保留獨立通知管理資料，模型只提供凍結結果", async () => {
  const push = mockPush();
  const app = appHarness({ initialState: checkedState(), pushClientFactory: push.factory });
  app.environment.localStorage.setItem("outdoorLearningDay.push.v1", "private management fixture");
  await app.controller.start();
  app.confirmation.handler = async () => true;
  await app.click("reset-all");
  assert.equal(app.environment.localStorage.getItem("outdoorLearningDay.push.v1"), "private management fixture");
  assert.deepEqual(app.savedState().checkIns, {});
  assert.equal(push.calls.includes("disable"), false);
  const model = app.controller.getPageSnapshot();
  assert.equal(Object.isFrozen(model.push), true);
  assert.equal(Object.hasOwn(model.push, "messages"), false);
  assert.throws(() => { model.push.statusMessage = "mutation"; }, TypeError);
  assert.doesNotMatch(JSON.stringify(model), /private management fixture|managementToken|endpoint/);
  assert.deepEqual(Object.keys(push.options).sort(), ["environment", "getRegistration", "onChange"]);
});

test("首頁不呈現公告歷史，保留通知控制與私隱提示", () => {
  const views = createViews();
  const push = mockPush().state;
  push.busy = true;
  push.canEnable = false;
  push.messages = [{ id: "one", title: '<img src=x onerror=alert(1)>', body: 'A <script>bad</script> & B',
    route: "itinerary", createdAt: "2026-10-07T01:00:00.000Z" }];
  const html = views.renderHome({ trip: { title: "旅程" }, canInstall: false, push });
  assert.doesNotMatch(html, /onerror|bad|announcement-list|empty-announcements|data-push-refresh|重新整理公告/);
  assert.doesNotMatch(html, /<script>|<img src=x/);
  assert.match(html, /data-push-enable disabled/);
  assert.match(html, /data-push-disable/);
  assert.doesNotMatch(html, /data-push-test|發送一則測試通知給自己/);
  assert.match(html, /App 不保留公告歷史列表/);
  assert.match(html, /訂閱會向推送服務傳送/);
  assert.match(html, /並不傳送相片、位置或打卡紀錄/);
  assert.match(html, /清除所有本機旅程資料/);
});

test("應用只註冊一次既有 Worker，通知與離線使用同一 registration", async () => {
  const push = mockPush();
  const app = appHarness({ pushClientFactory: push.factory });
  const active = { scope: "https://example.test/tour/", active: {} };
  let registrations = 0;
  app.environment.navigator.serviceWorker = { register: async url => {
    registrations += 1;
    assert.equal(url.pathname.endsWith("/sw.js"), true);
    return active;
  } };
  await app.controller.start();
  await app.controller.start();
  assert.equal(registrations, 1);
  assert.equal(await push.options.getRegistration(), active);
});


test("通知點擊返回首頁時，焦點與可見事件更新訂閱狀態且不要求權限", async () => {
  const push = mockPush();
  const app = appHarness({ pushClientFactory: push.factory });
  await app.controller.start();
  push.service.refresh = async () => {
    push.calls.push("refresh");
    push.state.statusMessage = "已更新通知訂閱狀態。";
    push.notify();
  };
  app.events.get("window:focus")();
  assert.match(app.element("#app").innerHTML, /已更新通知訂閱狀態/);
  app.environment.document.visibilityState = "hidden";
  app.events.get("document:visibilitychange")();
  assert.equal(push.calls.filter(value => value === "refresh").length, 1);
  app.environment.document.visibilityState = "visible";
  app.events.get("document:visibilitychange")();
  assert.equal(push.calls.filter(value => value === "refresh").length, 2);
  assert.equal(push.calls.includes("enable"), false);
});


test("首次安裝等待本 App 的 Worker，不把其他同源 scope 的 ready 當作失敗", async () => {
  const push = mockPush();
  const app = appHarness({ pushClientFactory: push.factory });
  const listeners = new Map();
  const worker = { state: "installing", addEventListener(name, callback) { listeners.set(name, callback); }, removeEventListener(name) { listeners.delete(name); } };
  const registration = { scope: "https://example.test/tour/", active: null, installing: worker };
  app.environment.navigator.serviceWorker = {
    register: async () => registration,
    ready: Promise.resolve({ scope: "https://example.test/", active: {} })
  };
  await app.controller.start();
  assert.equal(listeners.has("statechange"), true);
  worker.state = "activated";
  registration.active = worker;
  listeners.get("statechange")();
  assert.equal(await push.options.getRegistration(), registration);
  assert.equal(listeners.has("statechange"), false);
  assert.doesNotMatch(app.element("#toast").textContent || "", /未能啟用/);
});
