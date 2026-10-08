import test from "node:test";
import assert from "node:assert/strict";
import { createAppController } from "../src/controller.js";
import { STORAGE_KEY } from "../src/state.js";
import { appHarness, checkedState } from "./helpers/browser-environment.js";

const iphone = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", platform: "iPhone", maxTouchPoints: 5 };
const android = { userAgent: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36", platform: "Linux armv8l", maxTouchPoints: 5 };

function installation({ navigator = iphone, standalone = false, hash = "#home" } = {}) {
  const calls = { storage: [], push: [], share: 0, gps: 0, camera: 0, notification: 0 };
  const pushState = { canEnable: true, canDisable: false, statusMessage: "尚未啟用通知。" };
  const app = appHarness({ hash, initialState: checkedState(),
    pushClientFactory: () => ({
      getSnapshot: () => structuredClone(pushState),
      initialize: async () => { calls.push.push("initialize"); },
      refresh: async () => { calls.push.push("refresh"); },
      enable: async () => { calls.push.push("enable"); },
      disable: async () => { calls.push.push("disable"); },
      dispose: () => { calls.push.push("dispose"); }
    }),
    controllerFactory: (options) => {
      const environment = options.environment;
      environment.navigator = { ...navigator,
        share: async () => { calls.share += 1; },
        geolocation: { getCurrentPosition() { calls.gps += 1; } },
        mediaDevices: { getUserMedia: async () => { calls.camera += 1; } }
      };
      environment.matchMedia = (query) => ({ matches: query === "(display-mode: standalone)" && standalone });
      environment.Notification = { requestPermission: async () => { calls.notification += 1; return "granted"; } };
      const storage = environment.localStorage;
      environment.localStorage = {
        getItem: (key) => storage.getItem(key),
        setItem: (key, value) => { calls.storage.push({ operation: "set", key }); storage.setItem(key, value); },
        removeItem: (key) => { calls.storage.push({ operation: "remove", key }); storage.removeItem(key); }
      };
      return createAppController(options);
    }
  });
  return { ...app, calls };
}
function clickInstall(app, { detached = false } = {}) {
  const target = { id: "install-button", dataset: {}, isConnected: !detached, disabled: false,
    matches: () => false, closest() { return this; }, setAttribute() {} };
  return app.events.get("document:click")({ target });
}
function offerInstall(app) {
  let choose, rejectChoice;
  const calls = { preventDefault: 0, prompt: 0 };
  const event = {
    preventDefault() { calls.preventDefault += 1; },
    prompt() { calls.prompt += 1; return Promise.resolve(); },
    userChoice: new Promise((resolve, reject) => { choose = resolve; rejectChoice = reject; })
  };
  app.events.get("window:beforeinstallprompt")(event);
  return { calls, choose, rejectChoice, event };
}
function state(app, mode, helpOpen = false) {
  const model = app.controller.getPageSnapshot();
  assert.equal(model.view, "home");
  assert.equal(model.canInstall, mode !== "none");
  assert.deepEqual(model.install, { mode, helpOpen });
  return model;
}

for (const [label, navigator] of [
  ["iPhone", iphone],
  ["iPad", { ...iphone, userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)", platform: "iPad" }],
  ["iPod", { ...iphone, userAgent: "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X)", platform: "iPod" }],
  ["iPad 桌面模式", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 5 }]
]) {
  test(`${label} 沒有原生安裝事件時提供手動安裝方法`, async () => {
    const app = installation({ navigator });
    await app.controller.start();
    state(app, "ios");
    assert.match(app.element("#app").innerHTML, /iPhone／iPad 安裝方法/);
    assert.equal(app.calls.notification + app.calls.gps + app.calls.camera + app.calls.share, 0);
    assert.deepEqual(app.calls.storage, []);
  });
}

for (const [label, navigator] of [
  ["Android Chrome", android],
  ["Mac Safari", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 0 }],
  ["桌面 Chrome", { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36", platform: "Win32", maxTouchPoints: 0 }],
  ["未提供裝置識別", {}]
]) {
  test(`${label} 沒有原生安裝事件時不顯示可安裝入口`, async () => {
    const app = installation({ navigator });
    await app.controller.start();
    state(app, "none");
    await clickInstall(app);
    state(app, "none");
    assert.equal(app.calls.share, 0);
  });
}

for (const [label, options] of [
  ["navigator.standalone", { navigator: { ...iphone, standalone: true } }],
  ["display-mode standalone", { standalone: true }]
]) {
  test(`已安裝模式 ${label} 隱藏安裝入口，不能再次執行原生 prompt`, async () => {
    const app = installation(options);
    await app.controller.start();
    state(app, "none");
    const offer = offerInstall(app);
    await clickInstall(app);
    state(app, "none");
    assert.equal(offer.calls.prompt, 0);
    assert.equal(app.calls.share, 0);
  });
}

test("iOS 手動安裝說明可開關，列出 Safari 步驟且不嘗試 native 或分享", async () => {
  const app = installation();
  await app.controller.start();
  const saved = app.environment.localStorage.getItem(STORAGE_KEY);
  const push = app.controller.getPageSnapshot().push;
  await clickInstall(app);
  state(app, "ios", true);
  const html = app.element("#app").innerHTML;
  assert.match(html, /Safari/);
  assert.match(html, /分享/);
  assert.match(html, /加至主畫面/);
  assert.match(html, /開啟.{0,8}網頁\s*App/);
  assert.match(html, /加入/);
  assert.match(html, /id="install-button"[^>]*aria-expanded="true"/);
  await clickInstall(app);
  state(app, "ios", false);
  assert.match(app.element("#app").innerHTML, /id="install-button"[^>]*aria-expanded="false"/);
  assert.equal(app.environment.localStorage.getItem(STORAGE_KEY), saved);
  assert.deepEqual(app.calls.storage, []);
  assert.deepEqual(app.controller.getPageSnapshot().push, push);
  assert.deepEqual(app.calls.push, ["initialize"]);
  assert.equal(app.calls.notification + app.calls.gps + app.calls.camera + app.calls.share, 0);
  app.navigate("#attraction/future-school");
  assert.equal(app.controller.getPageSnapshot().checkIn.method, "manual");
  assert.equal(app.controller.getPageSnapshot().checkIn.verified, false);
});

test("安裝快照只包含凍結的模式與開關，不洩漏原生事件", async () => {
  const app = installation();
  await app.controller.start();
  const old = state(app, "ios");
  assert.ok(Object.isFrozen(old));
  assert.ok(Object.isFrozen(old.install));
  assert.throws(() => { old.install.helpOpen = true; }, TypeError);
  await clickInstall(app);
  state(app, "ios", true);
  assert.equal(old.install.helpOpen, false);
  offerInstall(app);
  const native = state(app, "native");
  assert.deepEqual(Object.keys(native.install).sort(), ["helpOpen", "mode"]);
  assert.equal("prompt" in native.install, false);
  assert.equal("userChoice" in native.install, false);
});

test("離開首頁及 pagehide 清除手動說明，重新開啟時收合", async () => {
  const app = installation();
  await app.controller.start();
  await clickInstall(app);
  state(app, "ios", true);
  app.navigate("#itinerary");
  assert.equal("install" in app.controller.getPageSnapshot(), false);
  app.navigate("#home");
  state(app, "ios");
  await clickInstall(app);
  state(app, "ios", true);
  app.events.get("window:pagehide")();
  app.events.get("window:pageshow")();
  state(app, "ios");
  assert.deepEqual(app.calls.storage, []);
});

test("非首頁及已離開畫面的舊按鈕不能開啟 iOS 說明或原生安裝", async () => {
  for (const navigator of [iphone, android]) {
    const app = installation({ navigator });
    await app.controller.start();
    const offer = offerInstall(app);
    await clickInstall(app, { detached: true });
    assert.equal(offer.calls.prompt, 0);
    app.navigate("#itinerary");
    await clickInstall(app);
    assert.equal(offer.calls.prompt, 0);
    app.navigate("#attraction/future-school");
    await clickInstall(app);
    assert.equal(offer.calls.prompt, 0);
    app.navigate("#home");
    state(app, "native");
  }
  const ios = installation();
  await ios.controller.start();
  await clickInstall(ios, { detached: true });
  state(ios, "ios");
  ios.navigate("#itinerary");
  await clickInstall(ios);
  ios.navigate("#home");
  state(ios, "ios");
});

for (const outcome of ["accepted", "dismissed"]) {
  test(`原生安裝 ${outcome} 同步開啟 prompt，完成選擇後不再重用事件`, async () => {
    const app = installation({ navigator: android });
    await app.controller.start();
    state(app, "none");
    const offer = offerInstall(app);
    assert.equal(offer.calls.preventDefault, 1);
    state(app, "native");
    const click = clickInstall(app);
    assert.equal(offer.calls.prompt, 1, "prompt 必須在 click 的同步部分執行，保留使用者操作資格");
    offer.choose({ outcome, platform: "web" });
    await click;
    state(app, "none");
    await clickInstall(app);
    assert.equal(offer.calls.prompt, 1);
    assert.equal(app.calls.share, 0);
    assert.deepEqual(app.calls.storage, []);
  });
}

test("真正原生安裝事件優先於 iOS 手動方法", async () => {
  const app = installation();
  await app.controller.start();
  await clickInstall(app);
  state(app, "ios", true);
  const offer = offerInstall(app);
  state(app, "native");
  const click = clickInstall(app);
  assert.equal(offer.calls.prompt, 1);
  offer.choose({ outcome: "dismissed", platform: "web" });
  await click;
  state(app, "ios");
  assert.equal(app.calls.share, 0);
});

test("舊 userChoice 回覆不清除後來的原生安裝事件", async () => {
  const app = installation({ navigator: android });
  await app.controller.start();
  const old = offerInstall(app);
  const click = clickInstall(app);
  const current = offerInstall(app);
  old.choose({ outcome: "dismissed", platform: "web" });
  await click;
  state(app, "native");
  const next = clickInstall(app);
  assert.equal(current.calls.prompt, 1);
  current.choose({ outcome: "dismissed", platform: "web" });
  await next;
  state(app, "none");
});

test("appinstalled 清除保存的原生安裝事件", async () => {
  const app = installation({ navigator: android });
  await app.controller.start();
  const offer = offerInstall(app);
  state(app, "native");
  assert.equal(typeof app.events.get("window:appinstalled"), "function");
  app.events.get("window:appinstalled")();
  state(app, "none");
  await clickInstall(app);
  assert.equal(offer.calls.prompt, 0);
  assert.deepEqual(app.calls.storage, []);
});


test("原生 prompt 等待期間連按不會再次開啟提示", async () => {
  const app = installation({ navigator: android });
  await app.controller.start();
  const offer = offerInstall(app);
  const pending = clickInstall(app);
  await clickInstall(app);
  await clickInstall(app);
  assert.equal(offer.calls.prompt, 1);
  offer.choose({ outcome: "dismissed", platform: "web" });
  await pending;
  state(app, "none");
  assert.deepEqual(app.calls.storage, []);
});

for (const failure of ["synchronous", "prompt-rejection", "choice-rejection"]) {
  test(`原生安裝錯誤 ${failure} 保留可理解警告、不重用失效事件並允許新事件`, async () => {
    const app = installation({ navigator: android });
    await app.controller.start();
    const offer = offerInstall(app);
    if (failure === "synchronous") offer.event.prompt = () => { offer.calls.prompt += 1; throw Error("fixture failure"); };
    if (failure === "prompt-rejection") offer.event.prompt = () => { offer.calls.prompt += 1; return Promise.reject(Error("fixture failure")); };
    const pending = clickInstall(app);
    if (failure === "choice-rejection") offer.rejectChoice(Error("fixture failure"));
    await pending;
    state(app, "none");
    assert.match(app.element("#toast").textContent, /未能開啟安裝提示/);
    await clickInstall(app);
    assert.equal(offer.calls.prompt, 1);
    const retry = offerInstall(app);
    const next = clickInstall(app);
    assert.equal(retry.calls.prompt, 1);
    retry.choose({ outcome: "dismissed", platform: "web" });
    await next;
    state(app, "none");
    assert.equal(app.calls.share + app.calls.notification + app.calls.gps + app.calls.camera, 0);
    assert.deepEqual(app.calls.storage, []);
  });
}

test("iOS appinstalled 收起手動方法，忽略後來的安裝事件", async () => {
  const app = installation();
  await app.controller.start();
  await clickInstall(app);
  state(app, "ios", true);
  app.events.get("window:appinstalled")();
  state(app, "none");
  const late = offerInstall(app);
  await clickInstall(app);
  state(app, "none");
  assert.equal(late.calls.prompt, 0);
  app.navigate("#itinerary");
  app.navigate("#home");
  state(app, "none");
  assert.deepEqual(app.calls.storage, []);
});
