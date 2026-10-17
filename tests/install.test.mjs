import test from "node:test";
import assert from "node:assert/strict";
import { createAppController } from "../src/controller.js";
import { STORAGE_KEY } from "../src/state.js";
import { appHarness, checkedState, FIXTURE_IDENTITY, fillStudentIdentity, submitStudentIdentity } from "./helpers/browser-environment.js";

const iphone = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", platform: "iPhone", maxTouchPoints: 5 };
const android = { userAgent: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36", platform: "Linux armv8l", maxTouchPoints: 5 };

const installStorageKey = "outdoorLearningDay.install.v1";
function installation({ navigator = iphone, standalone = false, hash = "#home", initialIdentity = FIXTURE_IDENTITY,
  rememberedInstall = null, failInstallStorage = false, testKind = null } = {}) {
  const calls = { storage: [], share: 0, gps: 0, camera: 0, notification: 0 };
  const app = appHarness({ hash, initialState: checkedState(), initialIdentity,
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
      if (rememberedInstall !== null) storage.setItem(installStorageKey, rememberedInstall);
      environment.localStorage = {
        getItem: (key) => storage.getItem(key),
        setItem: (key, value) => {
          calls.storage.push({ operation: "set", key });
          if (failInstallStorage && key === installStorageKey) throw Error("fixture storage failure");
          storage.setItem(key, value);
        },
        removeItem: (key) => { calls.storage.push({ operation: "remove", key }); storage.removeItem(key); }
      };
      return createAppController({ ...options, testKind });
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
  assert.equal(model.view, "itinerary");
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
  test(`${label} 沒有原生安裝事件時提供安裝方法，不假稱可直接安裝`, async () => {
    const app = installation({ navigator });
    await app.controller.start();
    state(app, "manual");
    await clickInstall(app);
    state(app, "manual", true);
    assert.match(app.element("#app").innerHTML, /Chrome/);
    assert.match(app.element("#app").innerHTML, /Safari/);
    assert.doesNotMatch(app.element("#app").innerHTML, /data-install-start/);
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
  assert.equal("push" in app.controller.getPageSnapshot(), false);
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

test("離開行程及 pagehide 清除手動說明，重新開啟時收合", async () => {
  const app = installation();
  await app.controller.start();
  await clickInstall(app);
  state(app, "ios", true);
  app.navigate("#memories");
  assert.equal("install" in app.controller.getPageSnapshot(), false);
  app.navigate("#home");
  state(app, "ios");
  await clickInstall(app);
  state(app, "ios", true);
  app.events.get("window:pagehide")();
  await app.events.get("window:pageshow")();
  state(app, "ios");
  assert.deepEqual(app.calls.storage, []);
});

test("展開景點後仍可開啟安裝指引，不啟動定位或相機", async () => {
  const app = installation({ hash: "#attraction/future-school" }); await app.controller.start();
  await clickInstall(app); state(app, "ios", true);
  assert.equal(app.controller.getPageSnapshot().attraction.id, "future-school");
  assert.equal(app.calls.gps + app.calls.camera, 0);
  assert.deepEqual(app.calls.storage, []);
});

test("非行程及已離開畫面的舊按鈕不能開啟 iOS 說明或原生安裝", async () => {
  for (const navigator of [iphone, android]) {
    const app = installation({ navigator });
    await app.controller.start();
    const offer = offerInstall(app);
    await clickInstall(app, { detached: true });
    assert.equal(offer.calls.prompt, 0);
    app.navigate("#memories");
    await clickInstall(app);
    assert.equal(offer.calls.prompt, 0);
    app.navigate("#memories/ai");
    await clickInstall(app);
    assert.equal(offer.calls.prompt, 0);
    app.navigate("#home");
    state(app, "native");
  }
  const ios = installation();
  await ios.controller.start();
  await clickInstall(ios, { detached: true });
  state(ios, "ios");
  ios.navigate("#memories");
  await clickInstall(ios);
  ios.navigate("#home");
  state(ios, "ios");
});

for (const outcome of ["accepted", "dismissed"]) {
  test(`原生安裝 ${outcome} 同步開啟 prompt，完成選擇後不再重用事件`, async () => {
    const app = installation({ navigator: android });
    await app.controller.start();
    state(app, "manual");
    const offer = offerInstall(app);
    assert.equal(offer.calls.preventDefault, 1);
    state(app, "native");
    const click = clickInstall(app);
    assert.equal(offer.calls.prompt, 1, "prompt 必須在 click 的同步部分執行，保留使用者操作資格");
    offer.choose({ outcome, platform: "web" });
    await click;
    state(app, "manual");
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
  state(app, "manual");
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
  assert.deepEqual(app.calls.storage, [{ operation: "set", key: installStorageKey }]);
  assert.equal(app.environment.localStorage.getItem(installStorageKey), "installed");
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
  state(app, "manual");
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
    state(app, "manual");
    assert.match(app.element("#toast").textContent, /未能開啟安裝提示/);
    await clickInstall(app);
    assert.equal(offer.calls.prompt, 1);
    const retry = offerInstall(app);
    const next = clickInstall(app);
    assert.equal(retry.calls.prompt, 1);
    retry.choose({ outcome: "dismissed", platform: "web" });
    await next;
    state(app, "manual");
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
  assert.deepEqual(app.calls.storage, [{ operation: "set", key: installStorageKey }]);
});

test("登入前顯示 iPhone 安裝提示，入口在裝置設定第一項且不要求其他權限", async () => {
  const app = installation({ initialIdentity: null }); await app.controller.start();
  assert.equal(app.controller.getPageSnapshot().view, "login");
  assert.equal(app.element("#install-invitation").open, true);
  assert.match(app.element("#install-invitation").innerHTML, /從主畫面開啟 App 再登入/);
  assert.match(app.element("#install-invitation").innerHTML, /加至主畫面/);
  assert.equal(app.element("#student-login-install").hidden, false);
  assert.equal(app.element(".bottom-nav").hidden, true);
  await app.click("install-dismiss");
  fillStudentIdentity(app); await submitStudentIdentity(app);
  assert.equal(app.controller.getPageSnapshot().view, "itinerary");
  assert.match(app.element("#app").innerHTML, /class="disclosure-content">\s*<section class="install-section"/);
  assert.equal(app.calls.notification + app.calls.gps + app.calls.camera + app.calls.share, 0);
  assert.ok(app.calls.storage.every(call => call.key !== STORAGE_KEY));
});

test("稍後或 Escape 關閉不視作完成；再次開啟保留登入輸入和焦點", async () => {
  const app = installation({ initialIdentity: null }); await app.controller.start();
  await app.click("install-dismiss");
  fillStudentIdentity(app, { ...FIXTURE_IDENTITY, studentName: "仍在填寫" });
  const field = app.element("#student-login-studentName"), html = app.element("#app").innerHTML;
  let focused = 0; field.focus = () => focused++; app.environment.document.activeElement = field;
  await app.click("install-open");
  assert.equal(app.element("#install-invitation").open, true);
  app.element("#install-invitation").requestClose();
  assert.equal(focused, 1);
  assert.equal(app.controller.getPageSnapshot().identity.studentName, "仍在填寫");
  assert.equal(app.element("#app").innerHTML, html);
  assert.equal(app.environment.localStorage.getItem(installStorageKey), null);
  app.controller.render(); offerInstall(app);
  assert.equal(app.element("#install-invitation").open, false, "同一次使用不反覆彈出");
  assert.deepEqual(app.calls.storage, []);
});

test("從主畫面啟動不顯示安裝提示或入口", async () => {
  for (const options of [{ standalone: true }, { navigator: { ...iphone, standalone: true } }]) {
    const app = installation({ ...options, initialIdentity: null }); await app.controller.start();
    assert.equal(app.element("#install-invitation").open, false);
    assert.equal(app.element("#student-login-install").hidden, true);
    await app.click("install-open");
    assert.equal(app.element("#install-invitation").open, false);
  }
});

test("登入前的原生事件開啟邀請；安裝按鈕同步 prompt 且不先登入", async () => {
  const app = installation({ navigator: android, initialIdentity: null }); await app.controller.start();
  const offer = offerInstall(app);
  assert.equal(app.element("#install-invitation").open, true);
  const pending = app.click("install-start");
  assert.equal(offer.calls.prompt, 1);
  assert.equal(app.element("#install-invitation").open, false);
  assert.equal(app.controller.getPageSnapshot().view, "login");
  offer.choose({ outcome: "accepted" }); await pending;
  assert.equal(app.environment.localStorage.getItem(installStorageKey), null, "選擇接受不等於已完成安裝");
  app.events.get("window:appinstalled")();
  assert.equal(app.element("#student-login-install").hidden, true);
  assert.equal(app.environment.localStorage.getItem(installStorageKey), "installed");
});

test("已開始填寫或中文組字時，遲來的安裝事件只更新入口，不搶走焦點或重畫欄位", async () => {
  for (const composing of [false, true]) {
    const app = installation({ navigator: android, initialIdentity: null }); await app.controller.start();
    await app.click("install-dismiss");
    const field = app.element("#student-login-studentName");
    Object.assign(field, { value: "中文組字", dataset: { studentIdentityField: "studentName" }, matches: () => false });
    const html = app.element("#app").innerHTML;
    app.events.get(composing ? "document:compositionstart" : "document:input")({ target: field });
    offerInstall(app);
    assert.equal(app.element("#install-invitation").open, false);
    assert.equal(app.element("#student-login-install").hidden, false);
    assert.equal(app.element("#app").innerHTML, html);
    if (composing) app.events.get("document:compositionend")({ target: field });
    assert.equal(app.controller.getPageSnapshot().identity.studentName, "中文組字");
    assert.deepEqual(app.calls.storage, []);
  }
});

test("唯讀學生資料不自動彈出安裝邀請，離頁與返回不重開", async () => {
  const app = installation(); await app.controller.start();
  await app.click("student-profile-open");
  assert.equal(app.controller.getPageSnapshot().mode, "profile");
  offerInstall(app);
  assert.equal(app.element("#install-invitation").open, false);
  assert.equal(app.element("#student-login-install").hidden, true);
  const fresh = installation({ initialIdentity: null }); await fresh.controller.start();
  fresh.events.get("window:pagehide")(); fresh.events.get("window:pageshow")(); offerInstall(fresh);
  assert.equal(fresh.element("#install-invitation").open, false);
});

test("安裝提示開啟時，背景登入與舊按鈕不能啟動工作；關閉後可登入原網址", async () => {
  const app = installation({ initialIdentity: null, hash: "#memories/ai" }); await app.controller.start();
  fillStudentIdentity(app); await submitStudentIdentity(app);
  assert.equal(app.controller.getPageSnapshot().view, "login");
  const offer = offerInstall(app);
  await clickInstall(app); await app.click("install-start", "", { detached: true });
  assert.equal(offer.calls.prompt, 0);
  await app.click("install-dismiss"); await submitStudentIdentity(app);
  assert.equal(app.controller.getPageSnapshot().view, "memories");
  assert.equal(app.controller.getPageSnapshot().section, "albums");
  assert.equal(app.element("#install-invitation").open, false);
});

test("只有有效完成標記才隱藏，下次開啟仍不顯示且不改旅程紀錄", async () => {
  for (const rememberedInstall of ["installed", "accepted", "{}", ""]) {
    const app = installation({ initialIdentity: null, rememberedInstall }); await app.controller.start();
    assert.equal(app.element("#install-invitation").open, rememberedInstall !== "installed");
    assert.equal(app.savedState().checkIns["future-school"].method, "manual");
    assert.deepEqual(app.calls.storage, []);
  }
});

test("完成偏好保存失敗仍隱藏本次提示，登入與旅程資料不受影響", async () => {
  const app = installation({ initialIdentity: null, failInstallStorage: true }); await app.controller.start();
  app.events.get("window:appinstalled")();
  assert.equal(app.element("#install-invitation").open, false);
  assert.equal(app.element("#student-login-install").hidden, true);
  fillStudentIdentity(app); await submitStudentIdentity(app);
  state(app, "none");
  assert.equal(app.savedState().checkIns["future-school"].method, "manual");
});

test("其他分頁完成安裝只關閉提示，不改登入輸入或旅程資料", async () => {
  const app = installation({ initialIdentity: null }); await app.controller.start();
  await app.click("install-dismiss"); fillStudentIdentity(app);
  await app.click("install-open");
  app.environment.localStorage.setItem(installStorageKey, "installed");
  await app.events.get("window:storage")({ key: installStorageKey });
  assert.equal(app.element("#install-invitation").open, false);
  assert.equal(app.element("#student-login-install").hidden, true);
  assert.deepEqual(app.controller.getPageSnapshot().identity, FIXTURE_IDENTITY);
  assert.equal(app.savedState().checkIns["future-school"].method, "manual");
});

test("已完成安裝或離頁後，遲來的 prompt 失敗不產生過時警告", async () => {
  for (const finish of [app => app.events.get("window:appinstalled")(), app => app.events.get("window:pagehide")()]) {
    const app = installation({ navigator: android, initialIdentity: null }); await app.controller.start();
    const offer = offerInstall(app); const pending = app.click("install-start");
    await Promise.resolve(); finish(app); offer.rejectChoice(Error("late failure")); await pending;
    assert.doesNotMatch(app.element("#toast").textContent || "", /未能開啟安裝提示/);
    assert.equal(app.element("#install-invitation").open, false);
  }
});

test("測試標示不會停用共用安裝流程", async () => {
  const app = installation({ initialIdentity: null, testKind: "rehearsal" }); await app.controller.start();
  assert.equal(app.element("#install-invitation").open, true); const offer = offerInstall(app);
  assert.equal(offer.calls.preventDefault, 1);
  app.events.get("window:appinstalled")();
  assert.equal(app.element("#student-login-install").hidden, true);
  assert.equal(app.element("#install-invitation").open, false);
});

test("內嵌或未知瀏覽器沒有原生安裝事件，登入前仍顯示完整指引", async () => {
  for (const navigator of [android, { userAgent: "Codex In-app Browser", platform: "Win32" }, {}]) {
    const app = installation({ navigator, initialIdentity: null }); await app.controller.start();
    assert.equal(app.element("#install-invitation").open, true);
    const html = app.element("#install-invitation").innerHTML;
    assert.match(html, /安裝方法/);
    assert.match(html, /Safari/); assert.match(html, /Chrome/);
    assert.doesNotMatch(html, /data-install-start/);
    const form = app.element("#app").innerHTML;
    await app.click("install-dismiss");
    assert.equal(app.element("#student-login-install").hidden, false);
    const offered = offerInstall(app);
    assert.equal(app.element("#install-invitation").open, false, "稍後之後不自動重開");
    assert.equal(app.element("#app").innerHTML, form);
    await app.click("install-open");
    assert.match(app.element("#install-invitation").innerHTML, /data-install-start/);
    const pending = app.click("install-start"); assert.equal(offered.calls.prompt, 1);
    offered.choose({ outcome: "dismissed" }); await pending;
    assert.deepEqual(app.calls.storage, []);
  }
});
