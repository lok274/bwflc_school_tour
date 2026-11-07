import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { detectMediaType, MAX_TRIP_VIDEO_BYTES, validateTripMedia } from "../src/trip-media-types.js";

const brand = type => Uint8Array.from([0, 0, 0, 16, ...Buffer.from(`ftyp${type}\0\0\0\0`)]);

test("辨認手機相片及影片，不以檔名或宣告 MIME 判定", async () => {
  for (const [type, mime] of [["heic", "image/heic"], ["mif1", "image/heif"], ["isom", "video/mp4"], ["qt  ", "video/quicktime"], ["3gp4", "video/3gpp"]]) {
    assert.equal(detectMediaType(brand(type), 16), mime);
  }
  const webm = Uint8Array.from([26, 69, 223, 163, 66, 130, 132, 119, 101, 98, 109]);
  assert.equal(detectMediaType(webm, webm.length), "video/webm");
  assert.equal(detectMediaType(brand("avif"), 16), null);
  await assert.rejects(validateTripMedia(new File(["<svg/>"], "faked.jpg", { type: "image/jpeg" })), /格式不支援/);
  await assert.rejects(validateTripMedia(new File([brand("qt  ")], "renamed.jpg")), /副檔名/);
  assert.equal(await validateTripMedia(new File([brand("heic")], "camera.HEIF")), "image/heic");
});

test("2 GiB 邊界只讀取前綴，相片仍有 20 MiB 上限", async () => {
  let prefixReads = 0;
  const sample = { name: "large.mp4", size: MAX_TRIP_VIDEO_BYTES, slice(start, end) {
    assert.equal(start, 0); assert.equal(end, 65536); prefixReads++;
    return new Blob([brand("isom")]);
  } };
  assert.equal(await validateTripMedia(sample), "video/mp4");
  await assert.rejects(validateTripMedia({ ...sample, size: MAX_TRIP_VIDEO_BYTES + 1 }), /2 GB/);
  assert.equal(prefixReads, 1);
  const largePhoto = { ...sample, name: "large.heic", size: 20 * 1024 ** 2 + 1, slice: () => new Blob([brand("heic")]) };
  await assert.rejects(validateTripMedia(largePhoto), /20 MB/);
});

test("影片逐段寫入；儲存空間不足時關閉檔案且不報成功", async () => {
  const source = await readFile(new URL("../src/trip-media-writer.js", import.meta.url), "utf8");
  const chunkSize = 4 * 1024 ** 2;
  for (const fail of [false, true]) {
    const writes = [], messages = [];
    let handleMessage, flushed = false, closed = false;
    const writer = {
      write(bytes, { at }) {
        writes.push([bytes.length, at]);
        if (fail && at > 0) throw new DOMException("disk full", "QuotaExceededError");
        return bytes.length;
      },
      flush() { flushed = true; },
      close() { closed = true; }
    };
    const fileHandle = { createSyncAccessHandle: async () => writer };
    const directory = { getFileHandle: async () => fileHandle };
    vm.runInNewContext(source, {
      self: {
        addEventListener(_type, callback) { handleMessage = callback; },
        postMessage(message) { messages.push({ ...message }); }
      },
      navigator: { storage: { getDirectory: async () => ({ getDirectoryHandle: async () => directory }) } }
    });
    await handleMessage({ data: { folderName: "fixture", id: "fixture-video", blob: new Blob([new Uint8Array(chunkSize + 13)]) } });
    assert.deepEqual(writes, [[chunkSize, 0], [13, chunkSize]]);
    assert.equal(closed, true);
    assert.equal(flushed, !fail);
    assert.deepEqual(messages, fail ? [{ error: "QuotaExceededError" }] : [{ saved: true }]);
  }
});
