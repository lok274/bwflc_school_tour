import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { TRIP_DATA } from "../src/data.js";
import { appHarness } from "./helpers/browser-environment.js";

test("團刊查看下載、住宿及課業保留，各頁移除指定頁碼連結", async () => {
  const app = appHarness(); await app.controller.start();
  const home = app.element("#app").innerHTML;
  for (const text of [TRIP_DATA.dateLabel, "查看團刊 PDF", "下載團刊 PDF", "約 600 字", "約 2 分鐘", "姓名、班別及學號", "AI 融合圖片"]) assert.ok(home.includes(text), text);
  assert.match(home, /download="2026-11-05至07-學習交流團團刊.pdf"/);
  assert.doesNotMatch(home, /booklet-shortcuts|團刊章節|頁碼捷徑|#page=/);
  app.navigate("#itinerary");
  const model = app.controller.getPageSnapshot();
  assert.equal(model.hotels.length, 2);
  assert.deepEqual(model.hotels.map(item => item.name), ["東莞帝豪花園酒店", "順德聯塑萬怡酒店"]);
  assert.ok(model.hotels.every(item => !Object.hasOwn(item, "night") && !Object.hasOwn(item, "date")));
  assert.match(app.element("#app").innerHTML, /美景中路769號/); assert.match(app.element("#app").innerHTML, /文華路11號/);
  assert.doesNotMatch(app.element("#app").innerHTML, /trip-booklet-2026.pdf|#page=/);
  app.navigate("#attraction/future-school"); assert.match(app.element("#app").innerHTML, /2024 年/);
  assert.doesNotMatch(app.element("#app").innerHTML, /trip-booklet-2026.pdf|#page=/);
  const policy = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(policy, /object-src 'none'/); assert.match(policy, /frame-src 'none'/);
  assert.doesNotMatch(home, /<iframe|<object|<embed/);
});

test("離線 PDF 導覽回傳當前快取的 PDF，不回傳 HTML；範圍及查詢網址保持白名單", async () => {
  const events = {}, requests = [], scope = "https://example.test/tour/", pdfUrl = scope + "public/documents/trip-booklet-2026.pdf";
  let cached = new Response("%PDF-original", { headers: { "content-type": "application/pdf" } }), network = 0;
  const context = vm.createContext({ URL, Response, Request, TextEncoder,
    self: { registration: { scope }, addEventListener: (type, handler) => { events[type] = handler; } },
    caches: { open: async key => { assert.equal(key, "outdoor-learning-day-v64"); return { match: async url => { requests.push(url); return cached?.clone(); } }; },
      match: async () => new Response("HTML fallback") },
    fetch: async () => { network++; throw Error("offline"); }
  });
  vm.runInContext(await readFile(new URL("../sw.js", import.meta.url), "utf8"), context);
  async function navigate(url, method = "GET") {
    let result; events.fetch({ request: { url, mode: "navigate", method }, respondWith: value => { result = value; } });
    return result;
  }
  const response = await navigate(pdfUrl);
  assert.equal(response.headers.get("content-type"), "application/pdf"); assert.equal(await response.text(), "%PDF-original");
  assert.deepEqual(requests, [pdfUrl]); assert.equal(network, 0);
  for (const url of [pdfUrl + "?private=1", "https://example.test/other/public/documents/trip-booklet-2026.pdf", "https://outside.test/tour/public/documents/trip-booklet-2026.pdf"]) assert.equal(await navigate(url), undefined);
  assert.equal(await navigate(pdfUrl, "POST"), undefined);
  cached = null;
  await assert.rejects(navigate(pdfUrl), /offline/); // Never return the cached App HTML for a missing PDF.
});
