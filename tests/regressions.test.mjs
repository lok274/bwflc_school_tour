import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { ATTRACTIONS, TRIP_DATA } from "../src/data.js";
import { appHarness } from "./helpers/browser-environment.js";

test("公開資料及介面不保留費用或名額內容", () => {
  const app = appHarness();
  assert.doesNotMatch(JSON.stringify(TRIP_DATA), /費用|名額/);
  for (const view of [app.views.renderHome, app.views.renderInfo]) {
    const html = view();
    assert.doesNotMatch(html, /費用|名額|undefined/);
  }
  assert.match(app.views.renderInfo(), /2026年11月5日至7日/);
});

test("路由切換與 pagehide 會停止鏡頭", async () => {
  const app = appHarness();
  let stopped = 0;
  const stream = { getTracks: () => [{ stop() { stopped += 1; } }] };
  app.environment.navigator.mediaDevices = { getUserMedia: async () => stream };
  app.controller.getSnapshot().state.checkIns["future-school"] = { verified: false };
  await app.click("camera-open", "future-school");
  app.events.get("window:hashchange")();
  assert.equal(stopped, 1);
  assert.equal(app.element("#camera-dialog").open, false);
  await app.click("camera-open", "future-school");
  app.events.get("window:pagehide")();
  assert.equal(stopped, 2);
});

test("提醒內容保持跳脫；私隱提示不聲稱加密或匿名化", () => {
  const app = appHarness();
  app.controller.getSnapshot().state.customItems = [
    { id: "custom-safe", label: '<img src=x onerror="alert(1)">', done: false }
  ];
  const html = app.views.renderPrepare();
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img/);
  assert.match(app.views.renderInfo(), /沒有由 App 額外加密或密碼保護/);
  assert.match(app.views.renderInfo(), /不按網址子目錄隔離/);
  const ring = app.views.progressRing(40, "進度");
  assert.match(ring, /stroke-dashoffset="/);
  assert.doesNotMatch(ring, /style=/);
});

test("旅程卡拒絕確認或相片已刪除時不生成；確認後仍核對狀態", async () => {
  const app = appHarness();
  let generated = 0;
  let downloaded = 0;
  const record = { blob: new Blob(["photo"]) };
  const model = app.controller.getSnapshot();
  model.photoRecords.set("future-school", record);
  model.state.checkIns["future-school"] = {
    checkedInAt: new Date().toISOString(), method: "manual", verified: false
  };
  app.element("a").click = () => { downloaded += 1; };
  app.photoService.createTravelCard = async () => { generated += 1; return new Blob(["card"]); };
  app.confirmation.handler = async () => false;
  await app.click("card-download", "future-school");
  assert.equal(generated, 0);
  app.confirmation.handler = async () => {
    app.controller.getSnapshot().photoRecords.delete("future-school");
    return true;
  };
  await app.click("card-download", "future-school");
  assert.equal(generated, 0);
  model.photoRecords.set("future-school", record);
  app.confirmation.handler = async () => true;
  app.photoService.createTravelCard = async () => {
    generated += 1;
    app.controller.getSnapshot().photoRecords.delete("future-school");
    return new Blob(["card"]);
  };
  await app.click("card-download", "future-school");
  assert.equal(generated, 1);
  assert.equal(downloaded, 0);
});

test("從 IndexedDB 讀回的相片尺寸文字亦須跳脫", () => {
  const app = appHarness();
  const model = app.controller.getSnapshot();
  model.photoRecords.set("future-school", {
    width: "<img src=x onerror=alert(1)>", height: "<script>bad</script>"
  });
  model.photoUrls.set("future-school", "blob:http://localhost/synthetic");
  const html = app.views.photoPanel(ATTRACTIONS[0], { verified: false });
  assert.doesNotMatch(html, /<img src=x|<script>bad/);
  assert.match(html, /&lt;img src=x/);
});

test("每個確認要求必須獲得獨立回應", async () => {
  const app = appHarness();
  const { createFeedback } = await import("../src/feedback.js");
  const feedback = createFeedback(app.environment);
  const first = feedback.askConfirmation({ title: "第一個", message: "A" });
  const second = feedback.askConfirmation({ title: "第二個", message: "B" });
  await new Promise(setImmediate);
  assert.equal(app.element("#confirm-title").textContent, "第一個");
  app.element("#confirm-dialog").close("confirm");
  assert.equal(await first, true);
  await new Promise(setImmediate);
  assert.equal(app.element("#confirm-title").textContent, "第二個");
  app.element("#confirm-dialog").close("cancel");
  assert.equal(await second, false);
});

test("沒有照片且不支援 IndexedDB 時仍可取消打卡及清除清單", async () => {
  const app = appHarness();
  app.confirmation.handler = async () => true;
  app.controller.getSnapshot().state.checkIns["future-school"] = {
    attractionId: "future-school", checkedInAt: new Date().toISOString(),
    method: "manual", verified: false
  };
  await app.click("checkin-undo", "future-school");
  assert.equal(Boolean(app.controller.getSnapshot().state.checkIns["future-school"]), false);
  await app.click("reset-all");
  assert.equal(app.environment.localRemoved, true);
});

test("勾選清單後會把焦點移到同一個新控制項", () => {
  const app = appHarness();
  const oldInput = { dataset: { checkItem: "health" } };
  let restored = false;
  const newInput = { dataset: { checkItem: "health" }, focus() { restored = true; } };
  app.environment.document.activeElement = oldInput;
  const main = app.element("#app");
  main.contains = () => true;
  main.querySelectorAll = () => [newInput];
  app.environment.location.hash = "#prepare";
  app.controller.render();
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
