import test from "node:test";
import assert from "node:assert/strict";
import { countReflectionCharacters, limitCardReflection, normalizeCardReflection, wrapCardReflection } from "../src/card-reflection.js";
import { appHarness, checkedState } from "./helpers/browser-environment.js";

test("感想可留空，80 字完整保留，超長拒絕且清理空白及控制字元", () => {
  assert.equal(normalizeCardReflection(), "");
  assert.equal(normalizeCardReflection(" \n\t "), "");
  assert.equal(normalizeCardReflection("今天\n  很開心\u0000"), "今天 很開心");
  assert.equal(normalizeCardReflection("學".repeat(80)), "學".repeat(80));
  assert.throws(() => normalizeCardReflection("學".repeat(81)), /80 字/);
  assert.equal(normalizeCardReflection("🙂".repeat(80)), "🙂".repeat(80));
  assert.throws(() => normalizeCardReflection("🙂".repeat(81)), /80 字/);
  assert.equal(countReflectionCharacters("學🙂𠀀"), 3);
  assert.equal(limitCardReflection("學".repeat(79) + "🙂多"), "學".repeat(79) + "🙂");
  const text = "觀察學習👨‍👩‍👧‍👦再思考";
  const lines = wrapCardReflection({ measureText: text => ({ width: Array.from(text).length * 30 }) }, text, 240);
  assert.equal(lines.join(""), text);
  assert.ok(lines.includes("👨‍👩‍👧‍👦再"));
});

test("同頁重畫保留每張草稿，下載加入感想，離頁及相片替換使草稿失效", async () => {
  const id = "future-school", photoId = "first";
  const record = { attractionId: id, photoId, writeId: "write-1", blob: new Blob(["pixels"]), width: 100, height: 80 };
  const app = appHarness({ initialState: checkedState(), initialPhotos: [record], hash: "#memories" });
  await app.controller.start();
  await app.click("memory-album", "future-school"); await app.click("memory-photo", "first"); await app.click("memory-card-toggle");
  const text = "今天學到仔細觀察，也更珍惜和同學一起探索的機會。";
  const target = { value: text, dataset: { cardReflection: photoId }, isConnected: true,
    matches: query => query === "[data-card-reflection]", getAttribute: () => "hint" };
  app.events.get("document:input")({ target });
  app.controller.render();
  assert.equal(app.controller.getPageSnapshot().albums[0].cover.reflection, text);
  assert.ok(app.element("#memory-content").innerHTML.includes(text));
  let generated;
  app.photoService.createTravelCard = async options => { generated = options; return new Blob(["card"]); };
  app.confirmation.handler = async ({ message }) => { assert.match(message, /感想亦會印在卡上/); return true; };
  const button = { dataset: { cardDownload: id, photoId }, isConnected: true, closest() { return this; },
    matches: query => query === "[data-card-download]" };
  await app.events.get("document:click")({ target: button });
  assert.equal(generated.reflection, text);
  app.photoData.set(id, { ...record, writeId: "write-2" });
  await app.controller.start();
  await app.click("memory-album", "future-school"); await app.click("memory-photo", "first"); await app.click("memory-card-toggle");
  assert.equal(app.controller.getPageSnapshot().albums[0].cover.reflection, "");
  app.events.get("document:input")({ target });
  app.navigate("#itinerary"); app.navigate("#memories");
  assert.equal(app.controller.getPageSnapshot().albums[0].cover.reflection, "");
});

test("感想是文字而非 HTML，關閉標籤亦須跳脫", async () => {
  const id = "future-school";
  const app = appHarness({ initialState: checkedState(), initialPhotos: [{ attractionId: id, photoId: "first", writeId: "1", blob: new Blob(["pixels"]), width: 1, height: 1 }], hash: "#memories" });
  await app.controller.start();
  await app.click("memory-album", "future-school"); await app.click("memory-photo", "first"); await app.click("memory-card-toggle");
  app.events.get("document:input")({ target: { value: '</textarea><img src=x>', dataset: { cardReflection: "first" },
    isConnected: true, matches: query => query === "[data-card-reflection]", getAttribute: () => "hint" } });
  app.controller.render();
  assert.match(app.element("#memory-content").innerHTML, /&lt;\/textarea&gt;&lt;img src=x&gt;/);
  assert.doesNotMatch(app.element("#memory-content").innerHTML, /<img src=x>/);
});

async function reflectionHarness() {
  const id = "future-school", photoId = "first";
  const app = appHarness({ initialState: checkedState(), initialPhotos: [{
    attractionId: id, photoId, writeId: "write-1", blob: new Blob(["pixels"]), width: 100, height: 80
  }], hash: "#memories" });
  await app.controller.start();
  await app.click("memory-album", "future-school"); await app.click("memory-photo", "first"); await app.click("memory-card-toggle");
  const field = { value: "", dataset: { cardReflection: photoId }, isConnected: true,
    selectionStart: 0, selectionEnd: 0, selectionDirection: "none",
    matches: query => query === "[data-card-reflection]", getAttribute: () => "hint",
    setSelectionRange(start, end, direction) { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; } };
  return { app, field };
}

test("貼上超長感想同步限制欄位及草稿，80 個 emoji 可完整輸入及匯出", async () => {
  const { app, field } = await reflectionHarness();
  field.value = "🙂".repeat(81);
  field.selectionStart = field.selectionEnd = field.value.length;
  app.events.get("document:input")({ target: field });
  const expected = "🙂".repeat(80);
  assert.equal(field.value, expected);
  assert.equal(field.selectionStart, expected.length);
  assert.equal(field.selectionEnd, expected.length);
  assert.equal(app.controller.getPageSnapshot().albums[0].cover.reflection, expected);
  assert.match(app.element("#hint").textContent, /^80 \/ 80 字/);
  app.controller.render();
  assert.doesNotMatch(app.element("#memory-content").innerHTML, /maxlength=/);
  let generated;
  app.photoService.createTravelCard = async options => { generated = options; return new Blob(["card"]); };
  app.confirmation.handler = async () => true;
  const button = { dataset: { cardDownload: "future-school", photoId: "first" }, isConnected: true,
    closest() { return this; }, matches: query => query === "[data-card-download]" };
  await app.events.get("document:click")({ target: button });
  assert.equal(generated.reflection, expected);
});

test("同頁重畫按相片恢復感想欄焦點及反向選取範圍", async () => {
  const { app, field } = await reflectionHarness();
  field.value = "今天學習仔細觀察";
  field.selectionStart = 2; field.selectionEnd = 5; field.selectionDirection = "backward";
  app.events.get("document:input")({ target: field });
  app.environment.document.activeElement = field;
  const replacement = { dataset: { cardReflection: "first" },
    focus(options) { assert.equal(options.preventScroll, true); app.environment.document.activeElement = this; },
    setSelectionRange(start, end, direction) { this.selection = { start, end, direction }; } };
  app.element("#memory-content").querySelectorAll = selector => selector.includes("textarea")
    ? [{ dataset: { cardReflection: "other" }, focus() { assert.fail("不能移到另一張相片"); } }, replacement] : [];
  app.controller.render();
  assert.equal(app.environment.document.activeElement, replacement);
  assert.deepEqual(replacement.selection, { start: 2, end: 5, direction: "backward" });
});

test("中文組字期間延後重畫及截短，組字完成再更新草稿", async () => {
  const { app, field } = await reflectionHarness();
  app.events.get("document:compositionstart")({ target: field });
  field.value = "學".repeat(79) + "🙂多";
  app.events.get("document:input")({ target: field, isComposing: true });
  assert.equal(field.value, "學".repeat(79) + "🙂多");
  assert.equal(app.controller.getPageSnapshot().albums[0].cover.reflection, "");
  app.element("#memory-content").innerHTML = "正在組字的欄位";
  app.controller.render();
  assert.equal(app.element("#memory-content").innerHTML, "正在組字的欄位");
  app.events.get("document:compositionend")({ target: field });
  assert.equal(field.value, "學".repeat(79) + "🙂");
  assert.equal(app.controller.getPageSnapshot().albums[0].cover.reflection, field.value);
  assert.notEqual(app.element("#memory-content").innerHTML, "正在組字的欄位");
});

test("離頁使待重畫與舊組字事件失效，不恢復感想草稿", async () => {
  const { app, field } = await reflectionHarness();
  app.events.get("document:compositionstart")({ target: field });
  field.value = "離頁前仍在組字";
  app.controller.render();
  app.navigate("#itinerary");
  const itinerary = app.element("#memory-content").innerHTML;
  field.isConnected = false;
  app.events.get("document:compositionend")({ target: field });
  assert.equal(app.element("#memory-content").innerHTML, itinerary);
  app.navigate("#memories");
  assert.equal(app.controller.getPageSnapshot().albums[0].cover.reflection, "");
});
