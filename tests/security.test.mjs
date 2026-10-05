import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { validatePhotoInput, compressPhoto } from "../src/photos.js";

const root = new URL("../", import.meta.url);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webp = new TextEncoder().encode("RIFFxxxxWEBPVP8 ");
const heif = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode("ftypheic"), 0, 0, 0, 0, ...new TextEncoder().encode("mif1heic")]);

test("CSP 在資產前載入並拒絕內嵌程式、資料連線及表單", () => {
  const html = fs.readFileSync(new URL("index.html", root), "utf8");
  const match = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.ok(match);
  const directives = Object.fromEntries(match[1].split(";").map((entry) => {
    const [name, ...values] = entry.trim().split(/\s+/);
    return [name, values.join(" ")];
  }));
  assert.equal(directives["script-src"], "'self'");
  assert.equal(directives["style-src"], "'self'");
  for (const name of ["script-src-attr", "style-src-attr", "connect-src", "form-action", "base-uri", "object-src", "frame-src"]) {
    assert.equal(directives[name], "'none'");
  }
  assert.equal(directives["worker-src"], "'self'");
  assert.equal(directives["img-src"], "'self' blob:");
  assert.doesNotMatch(match[1], /unsafe-inline|unsafe-eval|\*/);
  assert.ok(html.indexOf(match[0]) < html.indexOf("<link"));
  const fixture = fs.readFileSync(new URL("tests/browser/security.html", root), "utf8");
  assert.equal(fixture.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1], match[1]);
  assert.match(html, /name="referrer" content="no-referrer"/);
  const source = fs.readFileSync(new URL("src/app.js", root), "utf8");
  assert.doesNotMatch(source, /\bstyle=|\.style\./);
});

test("JPEG、PNG、WebP、HEIF 的 MIME 和檔頭須相符；無 MIME 可辨識", async () => {
  for (const [bytes, mime, detected] of [[jpeg, "image/jpeg", "image/jpeg"], [png, "image/png", "image/png"], [webp, "image/webp", "image/webp"], [heif, "image/heic", "image/heif"], [heif, "image/heif", "image/heif"]]) {
    assert.equal(await validatePhotoInput(new Blob([bytes], { type: mime })), detected);
    assert.equal(await validatePhotoInput(new Blob([bytes])), detected);
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
