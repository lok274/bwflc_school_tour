import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCardReflection, wrapCardReflection } from "../src/card-reflection.js";
import { appHarness, checkedState } from "./helpers/browser-environment.js";

test("感想可留空，80 字完整保留，超長拒絕且清理空白及控制字元", () => {
  assert.equal(normalizeCardReflection(), "");
  assert.equal(normalizeCardReflection(" \n\t "), "");
  assert.equal(normalizeCardReflection("今天\n  很開心\u0000"), "今天 很開心");
  assert.equal(normalizeCardReflection("學".repeat(80)), "學".repeat(80));
  assert.throws(() => normalizeCardReflection("學".repeat(81)), /80 字/);
  const text = "觀察學習👨‍👩‍👧‍👦再思考";
  const lines = wrapCardReflection({ measureText: text => ({ width: Array.from(text).length * 30 }) }, text, 240);
  assert.equal(lines.join(""), text);
  assert.ok(lines.includes("👨‍👩‍👧‍👦再"));
});

test("同頁重畫保留每張草稿，下載加入感想，離頁及相片替換使草稿失效", async () => {
  const id = "future-school", photoId = "first";
  const record = { attractionId: id, photoId, writeId: "write-1", blob: new Blob(["pixels"]), width: 100, height: 80 };
  const app = appHarness({ initialState: checkedState(), initialPhotos: [record], hash: `#attraction/${id}` });
  await app.controller.start();
  const text = "今天學到仔細觀察，也更珍惜和同學一起探索的機會。";
  const target = { value: text, dataset: { cardReflection: photoId }, isConnected: true,
    matches: query => query === "[data-card-reflection]", getAttribute: () => "hint" };
  app.events.get("document:input")({ target });
  app.controller.render();
  assert.equal(app.controller.getPageSnapshot().photos[0].reflection, text);
  assert.ok(app.element("#app").innerHTML.includes(text));
  let generated;
  app.photoService.createTravelCard = async options => { generated = options; return new Blob(["card"]); };
  app.confirmation.handler = async ({ message }) => { assert.match(message, /感想亦會印在卡上/); return true; };
  const button = { dataset: { cardDownload: id, photoId }, isConnected: true, closest() { return this; },
    matches: query => query === "[data-card-download]" };
  await app.events.get("document:click")({ target: button });
  assert.equal(generated.reflection, text);
  app.photoData.set(id, { ...record, writeId: "write-2" });
  await app.controller.start();
  assert.equal(app.controller.getPageSnapshot().photos[0].reflection, "");
  app.events.get("document:input")({ target });
  app.navigate("#itinerary"); app.navigate(`#attraction/${id}`);
  assert.equal(app.controller.getPageSnapshot().photos[0].reflection, "");
});

test("感想是文字而非 HTML，關閉標籤亦須跳脫", async () => {
  const id = "future-school";
  const app = appHarness({ initialState: checkedState(), initialPhotos: [{ attractionId: id, photoId: "first", writeId: "1", blob: new Blob(["pixels"]), width: 1, height: 1 }], hash: `#attraction/${id}` });
  await app.controller.start();
  app.events.get("document:input")({ target: { value: '</textarea><img src=x>', dataset: { cardReflection: "first" },
    isConnected: true, matches: query => query === "[data-card-reflection]", getAttribute: () => "hint" } });
  app.controller.render();
  assert.match(app.element("#app").innerHTML, /&lt;\/textarea&gt;&lt;img src=x&gt;/);
  assert.doesNotMatch(app.element("#app").innerHTML, /<img src=x>/);
});
