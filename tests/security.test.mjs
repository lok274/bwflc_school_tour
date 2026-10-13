import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { validatePhotoInput, compressPhoto } from "../src/photos.js";
import { jpegHeader, pngBytes, webpBytes } from "./helpers/image-fixtures.js";

const root = new URL("../", import.meta.url);
const jpeg = jpegHeader();
const png = pngBytes(4000, 3000);
const webp = webpBytes(4000, 3000);
const heif = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode("ftypheic"), 0, 0, 0, 0, ...new TextEncoder().encode("mif1heic")]);

test("CSP 在資產前載入，禁止對外資料連線並拒絕內嵌程式及表單", () => {
  const html = fs.readFileSync(new URL("index.html", root), "utf8");
  const match = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.ok(match);
  const directives = Object.fromEntries(match[1].split(";").map((entry) => {
    const [name, ...values] = entry.trim().split(/\s+/);
    return [name, values.join(" ")];
  }));
  assert.equal(directives["script-src"], "'self'");
  assert.equal(directives["style-src"], "'self'");
  for (const name of ["script-src-attr", "style-src-attr", "form-action", "base-uri", "object-src", "frame-src"]) {
    assert.equal(directives[name], "'none'");
  }
  assert.equal(directives["connect-src"], "'none'");
  assert.equal(directives["worker-src"], "'self'");
  assert.equal(directives["img-src"], "'self' blob:");
  assert.doesNotMatch(match[1], /unsafe-inline|unsafe-eval|\*/);
  assert.ok(html.indexOf(match[0]) < html.indexOf("<link"));
  const fixture = fs.readFileSync(new URL("tests/browser/security.html", root), "utf8");
  assert.equal(fixture.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1], match[1]);
  assert.match(html, /name="referrer" content="no-referrer"/);
  for (const file of fs.readdirSync(new URL("src/", root)).filter((name) => name.endsWith(".js"))) {
    const source = fs.readFileSync(new URL(`src/${file}`, root), "utf8");
    assert.doesNotMatch(source, /\bstyle=|\.style\./, file);
  }
});

test("JPEG、PNG、WebP 的 MIME、檔頭及尺寸須有效；無 MIME 可辨識", async () => {
  for (const [bytes, mime, detected] of [[jpeg, "image/jpeg", "image/jpeg"], [png, "image/png", "image/png"], [webp, "image/webp", "image/webp"]]) {
    assert.equal(await validatePhotoInput(new Blob([bytes], { type: mime })), detected);
    assert.equal(await validatePhotoInput(new Blob([bytes])), detected);
  }
  for (const mime of ["image/heic", "image/heif", ""]) {
    await assert.rejects(validatePhotoInput(new Blob([heif], { type: mime })), /先在手機轉成 JPEG/);
  }
  await assert.rejects(validatePhotoInput(new Blob([jpeg], { type: "image/png" })), /格式不符/);
});

test("解碼前拒絕 SVG、HTML、偽裝格式、空檔、未知格式及超限檔案", async () => {
  for (const [content, mime] of [["<svg xmlns='http://www.w3.org/2000/svg'></svg>", "image/svg+xml"], ["<svg></svg>", "image/png"], ["<html>private</html>", "image/jpeg"], ["unknown", "image/bmp"], ["GIF89a", "image/gif"], ["", "image/jpeg"]]) {
    await assert.rejects(validatePhotoInput(new Blob([content], { type: mime })));
  }
  const oversized = new Blob([new Uint8Array(20 * 1024 * 1024 + 1)], { type: "image/jpeg" });
  await assert.rejects(validatePhotoInput(oversized), /20MB/);
  const avif = heif.slice();
  avif.set(new TextEncoder().encode("avif"), 8);
  await assert.rejects(validatePhotoInput(new Blob([avif], { type: "image/heif" })));
  const excessiveBrandBox = heif.slice();
  new DataView(excessiveBrandBox.buffer).setUint32(0, 1024);
  await assert.rejects(validatePhotoInput(new Blob([excessiveBrandBox, new Uint8Array(1024)], { type: "image/heif" })));
});

test("Canvas 重新編碼記錄實際 MIME、縮放尺寸且拒絕未知輸出", async () => {
  const previousDocument = globalThis.document;
  const previousBitmap = globalThis.createImageBitmap;
  let outputType = "image/png";
  let requestedType;
  let closed = 0;
  globalThis.createImageBitmap = async () => ({ width: 4000, height: 3000, close() { closed += 1; } });
  globalThis.document = { createElement() { return {
    getContext: () => ({ fillRect() {}, drawImage() {} }),
    toBlob(callback, type) { requestedType = type; callback(new Blob(["reencoded pixels"], { type: outputType })); }
  }; } };
  try {
    const record = await compressPhoto(new Blob([jpeg], { type: "image/jpeg" }), "future-school");
    assert.equal(requestedType, "image/webp");
    assert.equal(record.mime, "image/png");
    assert.equal(record.blob.type, "image/png");
    assert.equal(record.width, 1600);
    assert.equal(record.height, 1200);
    assert.deepEqual(Object.keys(record).sort(), ["attractionId", "blob", "createdAt", "height", "mime", "version", "width"]);
    outputType = "image/svg+xml";
    await assert.rejects(compressPhoto(new Blob([jpeg], { type: "image/jpeg" }), "future-school"), /未能輸出/);
    assert.equal(closed, 2);
  } finally {
    globalThis.document = previousDocument;
    globalThis.createImageBitmap = previousBitmap;
  }
});

test("檔頭通過但真正解碼失敗時不產生相片紀錄", async () => {
  const previousBitmap = globalThis.createImageBitmap;
  const previousImage = globalThis.Image;
  globalThis.createImageBitmap = async () => { throw new Error("corrupt image"); };
  globalThis.Image = class { set src(value) { queueMicrotask(() => this.onerror()); } };
  try {
    await assert.rejects(compressPhoto(new Blob([jpeg], { type: "image/jpeg" }), "future-school"), /未能讀取/);
  } finally {
    globalThis.createImageBitmap = previousBitmap;
    globalThis.Image = previousImage;
  }
});

test("離線快取只接受精確靜態白名單，不接受任意 GET 或 query", async () => {
  const events = {};
  const writes = [];
  const ctx = vm.createContext({ URL, Response, Promise,
    self: { registration: { scope: "https://example.test/trip/" }, addEventListener(type, handler) { events[type] = handler; } },
    caches: { open: async () => ({ put: async (key) => writes.push(key) }), match: async () => null },
    fetch: async () => new Response("static", { headers: { "content-type": "text/html" } })
  });
  vm.runInContext(fs.readFileSync(new URL("sw.js", root), "utf8"), ctx);
  async function request(url, mode = "cors", method = "GET") {
    let response;
    const pending = [];
    events.fetch({ request: { method, url, mode }, respondWith(promise) { response = promise; }, waitUntil(promise) { pending.push(promise); } });
    if (response) await response;
    await Promise.all(pending);
    return Boolean(response);
  }
  for (const url of ["https://example.test/trip/private.json", "https://example.test/trip/src/app.js?payload=private", "https://example.test/other/src/app.js", "https://outside.test/trip/src/app.js"]) assert.equal(await request(url), false);
  assert.equal(await request("https://example.test/trip/src/app.js", "cors", "POST"), false);
  await request("https://example.test/trip/?payload=private", "navigate");
  assert.equal(writes.length, 0);
  assert.equal(await request("https://example.test/trip/src/app.js"), true);
  assert.equal(writes.length, 1);
});

test("新版啟動網址只讀同版本的白名單快取，不快取任何查詢網址", async () => {
  const events = {}, reads = [], writes = [], fetched = [];
  const base = "https://example.test/trip/";
  const ctx = vm.createContext({ URL, Promise, self: { registration: { scope: base }, addEventListener(type, handler) { events[type] = handler; } },
    caches: { open: async name => { assert.equal(name, "outdoor-learning-day-v121"); return { match: async url => { reads.push(url); return "current-cached-asset"; }, put: async url => writes.push(url) }; } },
    fetch: async url => { fetched.push(url); return "network"; }
  });
  vm.runInContext(fs.readFileSync(new URL("sw.js", root), "utf8"), ctx);
  async function request(file) {
    let response;
    events.fetch({ request: { method: "GET", mode: "cors", url: new URL(file, base).href }, respondWith(promise) { response = promise; }, waitUntil() {} });
    return response ? await response : null;
  }
  for (const file of ["src/app.js", "src/device-lab.js", "src/app-settings.js", "styles.css"]) {
    assert.equal(await request(`${file}?v=v121`), "current-cached-asset");
    assert.equal(reads.at(-1), new URL(file, base).href);
    for (const suffix of ["?v=v120", "?v=v121&payload=private", "?v=v121&v=v121", "?payload=private"]) assert.equal(await request(file + suffix), null);
  }
  assert.equal(await request("src/state.js?v=v121"), null);
  assert.deepEqual(fetched, []); assert.deepEqual(writes, []);
});

test("字型重試僅對兩個同源字型提供目前快取，缺少時讀標準網址且不寫入查詢網址", async () => {
  const base = "https://example.test/trip/", events = {}, reads = [], fetched = [];
  let cached = true;
  const context = vm.createContext({ URL, Promise,
    self: { registration: { scope: base }, addEventListener(type, handler) { events[type] = handler; } },
    caches: { open: async name => ({ match: async url => { reads.push([name, url]); return cached ? "cached-font" : null; },
      put() { assert.fail("retry must not cache query URLs"); } }) },
    fetch: async (url, options) => { fetched.push([url, options.cache]); return "network-font"; }
  });
  vm.runInContext(fs.readFileSync(new URL("sw.js", root), "utf8"), context);
  async function request(file, method = "GET") {
    let result;
    events.fetch({ request: { method, mode: "cors", url: new URL(file, base).href }, respondWith(promise) { result = promise; }, waitUntil() {} });
    return result ? await result : null;
  }
  for (const file of ["src/vendor/fontkit-1.1.1.js", "src/vendor/noto-sans-hk-regular.js"]) {
    cached = true;
    assert.equal(await request(`${file}?font-retry=1`), "cached-font");
    assert.equal(reads.at(-1)[1], new URL(file, base).href);
    cached = false;
    assert.equal(await request(`${file}?font-retry=2`), "network-font");
    assert.deepEqual(fetched.at(-1), [new URL(file, base).href, "reload"]);
    for (const query of ["?font-retry=0", "?font-retry=-1", "?font-retry=01", "?font-retry=1&private=x", "?font-retry=1&font-retry=2", "?font-retry=x"]) {
      assert.equal(await request(file + query), null);
    }
    assert.equal(await request(`${file}?font-retry=1`, "POST"), null);
  }
  for (const file of ["src/state.js?font-retry=1", "https://outside.test/trip/src/vendor/fontkit-1.1.1.js?font-retry=1", "/other/src/vendor/fontkit-1.1.1.js?font-retry=1"]) {
    assert.equal(await request(file), null);
  }
});
