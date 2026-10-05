import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { ATTRACTIONS, BUILTIN_CHECKLIST, TRIP_DATA } from "../src/data.js";
import { evaluateGeofence, formatDistance } from "../src/geo.js";
import * as stateHelpers from "../src/state.js";

function appHarness() {
  const elements = new Map();
  const events = new Map();
  function element(key) {
    if (!elements.has(key)) elements.set(key, {
      dataset: {}, listeners: {}, hidden: false, open: false, returnValue: "",
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute() {}, removeAttribute() {}, focus() {}, append() {}, remove() {},
      contains() { return false; }, querySelectorAll() { return []; },
      addEventListener(name, callback, options) {
        (this.listeners[name] ??= []).push({ callback, once: options?.once });
      },
      showModal() { this.open = true; },
      close(value = "") {
        this.open = false;
        this.returnValue = value;
        const listeners = this.listeners.close || [];
        this.listeners.close = listeners.filter((item) => !item.once);
        for (const item of listeners) item.callback();
      }
    });
    return elements.get(key);
  }
  const ctx = vm.createContext({
    ATTRACTIONS, BUILTIN_CHECKLIST, TRIP_DATA, evaluateGeofence, formatDistance, ...stateHelpers,
    document: {
      querySelector: element, querySelectorAll() { return []; }, getElementById: element,
      body: { dataset: {}, append() {} }, createElement: element,
      addEventListener(name, callback) { events.set(`document:${name}`, callback); }
    },
    window: {
      setTimeout() { return 1; }, clearTimeout() {}, scrollTo() {},
      addEventListener(name, callback) { events.set(`window:${name}`, callback); }
    },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() { ctx.localRemoved = true; } },
    navigator: {}, location: { hash: "#info" }, URL, console,
    requestAnimationFrame(callback) { callback(); },
    getAllPhotoRecords: async () => [], getPhotoRecord: async () => null,
    savePhotoRecord: async () => {},
    deletePhotoRecord: async () => { throw new Error("IndexedDB unavailable"); },
    clearPhotoRecords: async () => { throw new Error("IndexedDB unavailable"); },
    compressPhoto: async () => {}, createTravelCard: async () => {}
  });
  const source = fs.readFileSync(new URL("../src/app.js", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?from\s+"[^"\n]+";\s*/gm, "")
    .replace(/import\.meta\.url/g, '"http://localhost/src/app.js"')
    .replace(/start\(\);\s*$/, "");
  vm.runInContext(source, ctx);
  return { ctx, element, events, run: (code) => vm.runInContext(code, ctx) };
}

test("首頁及活動摘要不再顯示費用或名額欄位", () => {
  const app = appHarness();
  for (const view of ["renderHome()", "renderInfo()"] ) {
    const html = app.run(view);
    assert.doesNotMatch(html, /<(?:dt|span)>費用<\//);
    assert.doesNotMatch(html, /名額|undefined/);
    assert.match(html, /2026年11月5日至7日/);
  }
});

test("路由切換與 pagehide 會停止鏡頭", () => {
  const app = appHarness();
  let stopped = 0;
  app.ctx.testStream = { getTracks: () => [{ stop() { stopped += 1; } }] };
  app.run("cameraStream = testStream; cameraDialog.open = true");
  app.events.get("window:hashchange")();
  assert.equal(stopped, 1);
  assert.equal(app.element("#camera-dialog").open, false);
  app.run("cameraStream = testStream");
  app.events.get("window:pagehide")();
  assert.equal(stopped, 2);
});

test("每個確認要求必須獲得獨立回應", async () => {
  const app = appHarness();
  const first = app.run('askConfirmation({title:"第一個",message:"A"})');
  const second = app.run('askConfirmation({title:"第二個",message:"B"})');
  await new Promise(setImmediate);
  assert.equal(app.element("#confirm-title").textContent, "第一個");
  app.element("#confirm-dialog").close("confirm");
  assert.equal(await first, true);
  await new Promise(setImmediate);
  assert.equal(app.element("#confirm-title").textContent, "第二個");
  app.element("#confirm-dialog").close("cancel");
  assert.equal(await second, false);
});

test("没有照片且不支援 IndexedDB 時仍可取消打卡及清除清單", async () => {
  const app = appHarness();
  app.run('askConfirmation = async () => true; state.checkIns["future-school"] = {attractionId:"future-school",checkedInAt:new Date().toISOString(),method:"manual",verified:false}');
  await app.run('undoCheckIn("future-school")');
  assert.equal(app.run('Boolean(state.checkIns["future-school"])'), false);
  await app.run("resetAllData()");
  assert.equal(app.ctx.localRemoved, true);
});

test("勾選清單後會把焦點移到同一個新控制項", () => {
  const app = appHarness();
  const oldInput = { dataset: { checkItem: "copies" } };
  let restored = false;
  const newInput = { dataset: { checkItem: "copies" }, focus() { restored = true; } };
  app.ctx.document.activeElement = oldInput;
  const main = app.element("#app");
  main.contains = () => true;
  main.querySelectorAll = () => [newInput];
  app.ctx.location.hash = "#prepare";
  app.run("render()");
  assert.equal(restored, true);
});

test("404 或其他文件不會覆蓋離線首頁", async () => {
  const events = {};
  const writes = [];
  const ctx = vm.createContext({
    URL, Response, Promise,
    self: { registration: { scope: "https://example.test/trip/" }, addEventListener(type, handler) { events[type] = handler; } },
    caches: { open: async () => ({ put: async (key) => writes.push(key) }), match: async () => null },
    fetch: async () => new Response("not found", { status: 404 })
  });
  vm.runInContext(fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8"), ctx);
  async function navigate(url) {
    let response;
    const pending = [];
    events.fetch({ request: { method: "GET", url, mode: "navigate" }, respondWith(p) { response = p; }, waitUntil(p) { pending.push(p); } });
    await response;
    await Promise.all(pending);
  }
  await navigate("https://example.test/trip/missing");
  ctx.fetch = async () => new Response("other", { headers: { "content-type": "text/html" } });
  await navigate("https://example.test/trip/other.html");
  assert.equal(writes.length, 0);
  await navigate("https://example.test/trip/");
  assert.deepEqual(writes, ["https://example.test/trip/index.html"]);
});
