import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { validatePhotoInput, compressPhoto, createPhotoExport, createTravelCard } from "../src/photos.js";
import { jpegHeader, pngBytes, pngChunk, webpBytes, webpChunk } from "./helpers/image-fixtures.js";

test("真正小型壓縮大尺寸 PNG 在所有解碼入口及 Image 後備前拒絕", async () => {
  const input = new Blob([pngBytes(16384, 16384, deflateSync(new Uint8Array(2049 * 16384)))], { type: "image/png" });
  assert.ok(input.size < 100000);
  const previousBitmap = globalThis.createImageBitmap, previousImage = globalThis.Image;
  let calls = 0;
  globalThis.Image = class { constructor() { calls++; throw new Error("native decoder reached"); } };
  try {
    for (const bitmap of [async () => { calls++; throw new Error("native decoder reached"); }, undefined]) {
      globalThis.createImageBitmap = bitmap;
      for (const run of [() => compressPhoto(input, "future-school"),
        () => createPhotoExport({ blob: input }, "photo"),
        () => createTravelCard({ photoRecord: { blob: input } })]) {
        await assert.rejects(run(), /尺寸|像素/);
      }
    }
    assert.equal(calls, 0);
  } finally { globalThis.createImageBitmap = previousBitmap; globalThis.Image = previousImage; }
});

test("邊長與總像素的邊界、無 MIME 及各靜態編碼均受限制", async () => {
  for (const [make, type] of [[jpegHeader, "image/jpeg"], [pngBytes, "image/png"],
    [webpBytes, "image/webp"], [(w, h) => webpBytes(w, h, { lossless: true }), "image/webp"]]) {
    for (const mime of [type, ""]) {
      for (const [width, height] of [[8192, 1], [8000, 6000], [1, 1]]) {
        assert.equal(await validatePhotoInput(new Blob([make(width, height)], { type: mime })), type);
      }
      for (const [width, height] of [[8193, 1], [8000, 6251], [0, 10]]) {
        await assert.rejects(validatePhotoInput(new Blob([make(width, height)], { type: mime })));
      }
    }
  }
  assert.equal(await validatePhotoInput(new Blob([pngBytes(8000, 6250)], { type: "image/png" })), "image/png");
});

test("JPEG 長 EXIF 後的 SOF、progressive 多 scan 可用；後段覆寫與多影像拒絕", async () => {
  const jpeg = jpegHeader(4000, 3000, 0xc2);
  const metadata = new Uint8Array(1204); metadata.set([0xff, 0xe1, 4, 178]);
  const longExif = new Uint8Array([...jpeg.slice(0, 2), ...metadata, ...jpeg.slice(2)]);
  assert.equal(await validatePhotoInput(new Blob([longExif], { type: "image/jpeg" })), "image/jpeg");
  const anotherScan = jpeg.slice(15, -2);
  const progressive = new Uint8Array([...jpeg.slice(0, -2), 12, 0xff, 0, 20, 0xff, 0xd0, ...anotherScan, 0xff, 0xd9]);
  assert.equal(await validatePhotoInput(new Blob([progressive], { type: "image/jpeg" })), "image/jpeg");
  for (const bytes of [jpeg.slice(0, -1), new Uint8Array([...jpeg, ...jpeg]),
    new Uint8Array([...jpeg.slice(0, -2), ...jpegHeader(65535, 65535).slice(2)]),
    new Uint8Array([...jpeg.slice(0, -2), 0xff, 0xdc, 0, 4, 0xff, 0xff, 0xff, 0xd9]),
    new Uint8Array([...jpeg.slice(0, 2), 0xff, 0xe2, 0, 6, 77, 80, 70, 0, ...jpeg.slice(2)]),
    jpegHeader(4000, 3000, 0xc3)]) {
    await assert.rejects(validatePhotoInput(new Blob([bytes], { type: "image/jpeg" })));
  }
});

test("PNG 隱藏動畫、重複尺寸、越界及截斷不能繞過尺寸核對", async () => {
  const png = pngBytes(100, 80);
  for (const bytes of [png.slice(0, -1), new Uint8Array([...png, 0]),
    new Uint8Array([...png.slice(0, -12), ...pngChunk("acTL", new Uint8Array(8)), ...png.slice(-12)]),
    new Uint8Array([...png.slice(0, -12), ...png.slice(8, 33), ...png.slice(-12)])]) {
    await assert.rejects(validatePhotoInput(new Blob([bytes], { type: "image/png" })));
  }
  const overflow = png.slice(); new DataView(overflow.buffer).setUint32(33, 0xffffffff);
  await assert.rejects(validatePhotoInput(new Blob([overflow], { type: "image/png" })));
});

test("WebP 同時檢查 canvas 及壓縮影像尺寸，拒絕動畫與多影像", async () => {
  for (const bytes of [webpBytes(100, 80, { canvas: [100, 80] }),
    webpBytes(100, 80, { lossless: true, canvas: [100, 80] })]) {
    assert.equal(await validatePhotoInput(new Blob([bytes], { type: "image/webp" })), "image/webp");
  }
  const duplicate = new Uint8Array([...webpBytes(100, 80), ...webpBytes(100, 80).slice(12)]);
  new DataView(duplicate.buffer).setUint32(4, duplicate.length - 8, true);
  const animated = new Uint8Array([...webpBytes(100, 80), ...webpChunk("ANMF", new Uint8Array(16))]);
  new DataView(animated.buffer).setUint32(4, animated.length - 8, true);
  for (const bytes of [duplicate, animated, webpBytes(100, 80, { canvas: [100, 80], animation: true }),
    webpBytes(100, 80, { canvas: [8193, 80] }), webpBytes(8193, 80, { canvas: [100, 80] }),
    webpBytes(100, 80, { canvas: [101, 80] }), webpBytes(100, 80).slice(0, -1)]) {
    await assert.rejects(validatePhotoInput(new Blob([bytes], { type: "image/webp" })));
  }
});

test("HEIC／HEIF 在三個入口明確拒絕，無 MIME 也不能繞過", async () => {
  const bytes = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode("ftypheic"),
    0, 0, 0, 0, ...new TextEncoder().encode("mif1heic")]);
  const previousBitmap = globalThis.createImageBitmap;
  let calls = 0;
  globalThis.createImageBitmap = async () => { calls++; };
  try {
    for (const type of ["image/heic", "image/heif", ""]) {
      const blob = new Blob([bytes], { type });
      for (const run of [() => compressPhoto(blob, "fixture"), () => createPhotoExport({ blob }, "fixture"),
        () => createTravelCard({ photoRecord: { blob } })]) await assert.rejects(run(), /轉成 JPEG/);
    }
    assert.equal(calls, 0);
  } finally { globalThis.createImageBitmap = previousBitmap; }
});

test("合法圖片可用 Image 後備、保留方向處理；解碼後超限不重試", async () => {
  const saved = { bitmap: globalThis.createImageBitmap, image: globalThis.Image, document: globalThis.document };
  let images = 0, closed = 0, options;
  globalThis.Image = class {
    constructor() { images++; this.naturalWidth = 3000; this.naturalHeight = 4000; }
    set src(value) { queueMicrotask(() => this.onload()); }
  };
  globalThis.document = { createElement: () => ({ getContext: () => ({ fillRect() {}, drawImage() {} }),
    toBlob: (done) => done(new Blob(["safe pixels"], { type: "image/webp" })) }) };
  const blob = new Blob([jpegHeader(4000, 3000)]);
  try {
    for (const bitmap of [undefined, async () => { throw new Error("unsupported"); }]) {
      globalThis.createImageBitmap = bitmap;
      const record = await compressPhoto(blob, "fixture");
      assert.equal(record.width, 1200); assert.equal(record.height, 1600);
    }
    globalThis.createImageBitmap = async (input, config) => {
      assert.equal(input.type, "image/jpeg"); options = config;
      return { width: 16384, height: 16384, close() { closed++; } };
    };
    await assert.rejects(compressPhoto(blob, "fixture"), /尺寸過大/);
    assert.equal(closed, 1); assert.equal(images, 2); assert.equal(options.imageOrientation, "from-image");
  } finally { globalThis.createImageBitmap = saved.bitmap; globalThis.Image = saved.image; globalThis.document = saved.document; }
});

test("超長 JPEG 及像素總數過大的 PNG 不進入原生解碼器", async () => {
  const previousBitmap = globalThis.createImageBitmap;
  let calls = 0;
  globalThis.createImageBitmap = async () => { calls++; throw new Error("native decoder reached"); };
  try {
    for (const [bytes, type] of [[jpegHeader(65535, 1), "image/jpeg"], [pngBytes(8000, 8000), "image/png"]]) {
      await assert.rejects(compressPhoto(new Blob([bytes], { type }), "future-school"), /尺寸|像素/);
    }
    assert.equal(calls, 0);
  } finally { globalThis.createImageBitmap = previousBitmap; }
});
