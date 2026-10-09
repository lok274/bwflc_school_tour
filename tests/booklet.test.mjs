import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { TRIP_DATA, CHECK_IN_LOCATIONS } from "../src/data.js";
import { appHarness } from "./helpers/browser-environment.js";

test("行程介紹保留正文、移除頁碼及重複的行程介紹標題，以 HTML 文字顯示", async () => {
  // Independent transcription baseline from the approved PDF, in visible reading order.
  const source = JSON.parse(await readFile(new URL("./fixtures/booklet-introduction.json", import.meta.url), "utf8"));
  const pdf = await readFile(new URL("../public/documents/trip-booklet-2026.pdf", import.meta.url));
  assert.equal(createHash("sha256").update(pdf).digest("hex"), source.sourceSha256);
  assert.deepEqual(source.pages.map(page => page.pdfPage), [8, 9, 10, 11]);
  const app = appHarness({ hash: "#introduction" }); await app.controller.start();
  const html = app.element("#app").innerHTML;
  const pages = [...html.matchAll(/<article class="introduction-panel"[^>]*>([\s\S]*?)<\/article>/g)];
  assert.equal(pages.length, source.pages.length);
  const entities = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#039;": "'" };
  pages.forEach((match, index) => {
    const text = match[1].replace(/<[^>]*>/g, "").replace(/&amp;|&lt;|&gt;|&quot;|&#039;/g, entity => entities[entity]).replace(/\s/g, "");
    const original = source.pages[index];
    assert.ok(original.text.endsWith(original.printedPage));
    const withoutPageNumber = original.text.slice(0, -original.printedPage.length);
    const expected = index > 0 ? withoutPageNumber.replace(/^行程介紹/, "") : withoutPageNumber;
    assert.equal(text, expected, `PDF 第 ${original.pdfPage} 頁正文`);
  });
  assert.equal((html.match(/<h[1-6][^>]*>行程介紹<\/h[1-6]>/g) || []).length, 1);
  assert.match(html, /<h2[^>]*>姊妹學校介紹<\/h2>/);
  assert.equal((html.match(/<p>/g) || []).length, 20);
  assert.doesNotMatch(html, /<iframe\b|<object\b|<embed\b|<canvas\b|#page=|introduction-page-number|<footer\b/);
});

test("團刊查看下載及課業保留，移除住宿、景點簡介及指定頁碼連結", async () => {
  const app = appHarness(); await app.controller.start();
  const home = app.element("#app").innerHTML;
  for (const text of [TRIP_DATA.dateLabel, "查看團刊 PDF", "下載團刊 PDF", "約 600 字", "約 2 分鐘", "姓名、班別及學號", "AI 融合圖片"]) assert.ok(home.includes(text), text);
  assert.match(home, /download="2026-11-05至07-學習交流團團刊.pdf"/);
  assert.doesNotMatch(home, /booklet-shortcuts|團刊章節|頁碼捷徑|#page=/);
  app.navigate("#itinerary");
  assert.doesNotMatch(app.element("#app").innerHTML, /酒店資料|團刊所列住宿|東莞帝豪花園酒店|順德聯塑萬怡酒店/);
  assert.doesNotMatch(app.element("#app").innerHTML, /trip-booklet-2026.pdf|#page=/);
  for (const attraction of CHECK_IN_LOCATIONS) {
    app.navigate(`#attraction/${attraction.id}`);
    const detail = app.element("#app").innerHTML;
    assert.doesNotMatch(detail, /景點簡介|story-panel|story-main|lead-paragraph|trip-booklet-2026.pdf|#page=/);
    assert.equal("intro" in app.controller.getPageSnapshot().attraction, false);
    assert.ok(detail.includes("到埗打卡"));
    if (attraction.questions?.length) {
      if (attraction.id === "future-school") assert.equal(attraction.questions.length, 4);
      assert.equal((detail.match(/class="learning-number"/g) || []).length, attraction.questions.length);
      for (const [index, question] of attraction.questions.entries()) {
        assert.ok(detail.includes(`問題 ${attraction.questionNumbers?.[index] ?? index + 1}`));
        assert.ok(detail.includes(question));
      }
      assert.doesNotMatch(detail, /現場觀察|學習提示/);
      assert.equal("observe" in app.controller.getPageSnapshot().attraction, false);
      assert.equal("prompt" in app.controller.getPageSnapshot().attraction, false);
    } else {
      for (const text of [attraction.observe, attraction.prompt, "現場觀察", "學習提示"]) assert.ok(detail.includes(text), `${attraction.id}: ${text}`);
    }
  }
  const policy = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(policy, /object-src 'none'/); assert.match(policy, /frame-src 'none'/);
  assert.doesNotMatch(home, /<iframe|<object|<embed/);
});

test("團刊 PDF 第 13 頁四題按景點分配，保留原題號、填空線及全文", async () => {
  const source = JSON.parse(await readFile(new URL("./fixtures/booklet-questions.json", import.meta.url), "utf8"));
  const pdf = await readFile(new URL("../public/documents/trip-booklet-2026.pdf", import.meta.url));
  assert.equal(createHash("sha256").update(pdf).digest("hex"), source.sourceSha256);
  assert.equal(source.pdfPage, 13);
  assert.deepEqual(source.questions.map(question => [question.number, question.attractionId]),
    [[1, "sun-yat-sen"], [2, "shawan-town"], [3, "lunjiao-cake"], [4, "shawan-town"]]);
  assert.deepEqual(source.questions.map(question => (question.text.match(/_{11}/g) || []).length), [2, 2, 2, 0]);
  const app = appHarness(); await app.controller.start();
  for (const id of ["sun-yat-sen", "lunjiao-cake", "shawan-town"]) {
    const questions = source.questions.filter(question => question.attractionId === id);
    app.navigate(`#attraction/${id}`);
    const model = app.controller.getPageSnapshot();
    assert.deepEqual(model.attraction.questions, questions.map(question => question.text));
    assert.deepEqual(model.attraction.questionNumbers, questions.map(question => question.number));
    assert.ok(Object.isFrozen(model.attraction.questions));
    assert.ok(Object.isFrozen(model.attraction.questionNumbers));
    const html = app.element("#app").innerHTML;
    const cards = [...html.matchAll(/<section><span class="learning-number" aria-hidden="true">(\d+)<\/span><p class="eyebrow">問題 (\d+)<\/p><h2>(.*?)<\/h2><\/section>/g)];
    assert.deepEqual(cards.map(card => [Number(card[1]), Number(card[2]), card[3]]),
      questions.map(question => [question.number, question.number, question.text]));
    assert.doesNotMatch(html, /現場觀察|學習提示/);
    assert.equal("observe" in model.attraction, false);
    assert.equal("prompt" in model.attraction, false);
    assert.ok(html.includes("到埗打卡"));
    assert.ok(html.includes("紀念相片"));
  }
  // No separate question is assigned to Liugeng Hall or the departure school on that page.
  for (const id of ["liugeng-hall", "departure-school"]) {
    app.navigate(`#attraction/${id}`);
    assert.equal("questions" in app.controller.getPageSnapshot().attraction, false);
    assert.match(app.element("#app").innerHTML, /現場觀察/);
    assert.match(app.element("#app").innerHTML, /學習提示/);
  }
});

test("團刊十張原有圖片對應正確介紹，並全部加入離線白名單", async () => {
  const source = JSON.parse(await readFile(new URL("./fixtures/booklet-introduction-images.json", import.meta.url), "utf8"));
  const app = appHarness({ hash: "#introduction" }); await app.controller.start();
  const html = app.element("#app").innerHTML;
  const sections = [...html.matchAll(/<section class="introduction-topic">([\s\S]*?)<\/section>/g)].map(match => match[1]);
  const sw = await readFile(new URL("../sw.js", import.meta.url), "utf8");
  assert.equal(source.images.length, 10);
  assert.equal((html.match(/<img\b/g) || []).length, 10);
  for (const image of source.images) {
    const section = sections.find(markup => markup.includes(`>${image.title}</h`));
    assert.ok(section, image.title);
    assert.ok(section.includes(image.file), `圖片應在 ${image.title} 介紹`);
    assert.ok(section.includes(`width="${image.width}" height="${image.height}" loading="lazy"`));
    assert.ok(section.includes(`alt="${image.alt}"`));
    assert.ok(sw.includes(`"./${image.file}"`), `離線白名單：${image.file}`);
    const bytes = await readFile(new URL(`../${image.file}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), image.sha256, "圖片保留原 PDF 擷取結果");
  }
});

test("離線 PDF 導覽回傳當前快取的 PDF，不回傳 HTML；範圍及查詢網址保持白名單", async () => {
  const events = {}, requests = [], scope = "https://example.test/tour/", pdfUrl = scope + "public/documents/trip-booklet-2026.pdf";
  let cached = new Response("%PDF-original", { headers: { "content-type": "application/pdf" } }), network = 0;
  const context = vm.createContext({ URL, Response, Request, TextEncoder,
    self: { registration: { scope }, addEventListener: (type, handler) => { events[type] = handler; } },
    caches: { open: async key => { assert.equal(key, "outdoor-learning-day-v75"); return { match: async url => { requests.push(url); return cached?.clone(); } }; },
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
