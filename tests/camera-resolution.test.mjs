import test from "node:test";
import assert from "node:assert/strict";
import { appHarness, checkedState } from "./helpers/browser-environment.js";
import { createDeviceTestController } from "../src/device-test-controller.js";
import { DEVICE_TEST_LOCATION } from "../src/device-test-data.js";
import { compressPhoto } from "../src/photos.js";
import { jpegHeader } from "./helpers/image-fixtures.js";

for (const deviceTest of [false, true]) {
  test(`${deviceTest ? "測試頁" : "正式頁"}要求高清後置相機，快門沿用實際直向影格尺寸`, async () => {
    const id = deviceTest ? DEVICE_TEST_LOCATION.id : "future-school";
    const app = appHarness({ initialState: checkedState(), hash: "#attraction/future-school",
      ...(deviceTest ? { controllerFactory: createDeviceTestController } : {}) });
    app.environment.isSecureContext = true;
    let options;
    const stream = { getTracks: () => [{ stop() {} }] };
    app.environment.navigator.mediaDevices = { getUserMedia: async (request) => { options = request; return stream; } };
    const video = app.element("#camera-video");
    video.videoWidth = 1080;
    video.videoHeight = 1920;
    const canvas = app.element("#camera-canvas");
    canvas.getContext = () => ({ drawImage(source) { assert.equal(source, video); } });
    canvas.toBlob = (callback) => callback(new Blob(["pixels"], { type: "image/jpeg" }));
    await app.controller.start();
    await app.click("camera-open", id);
    assert.equal(options.audio, false);
    assert.deepEqual(options.video.facingMode, { ideal: "environment" });
    assert.deepEqual(options.video.width, { ideal: 1920 });
    assert.deepEqual(options.video.height, { ideal: 1080 });
    await app.click("camera-capture", "");
    assert.equal(canvas.width, 1080);
    assert.equal(canvas.height, 1920);
    assert.equal(app.element("#camera-preview").hidden, false);
    if (deviceTest) {
      assert.deepEqual(app.controller.getPageSnapshot().cameraResult, { status: "ready", width: 1080, height: 1920 });
      assert.match(app.element("#app").innerHTML, /1080 × 1920/);
    }
    app.element("#camera-dialog").requestClose();
  });
}

test("只提供 480 × 640 的相機仍能開啟，測試頁顯示真實尺寸及重拍建議", async () => {
  const app = appHarness({ controllerFactory: createDeviceTestController });
  app.environment.isSecureContext = true;
  app.environment.navigator.mediaDevices = { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) };
  app.element("#camera-video").videoWidth = 480;
  app.element("#camera-video").videoHeight = 640;
  await app.controller.start();
  await app.click("camera-open", DEVICE_TEST_LOCATION.id);
  assert.deepEqual(app.controller.getPageSnapshot().cameraResult, { status: "ready", width: 480, height: 640 });
  assert.match(app.element("#app").innerHTML, /480 × 640/);
  assert.match(app.element("#app").innerHTML, /解像度較低/);
  assert.match(app.element("#app").innerHTML, /手機相機/);
  assert.equal(app.element("#camera-dialog").open, true);
  app.element("#camera-dialog").requestClose();
});

test("高清影格按方向縮至最長邊 1600，低解像照片不會被放大冒充高清", async () => {
  const previousDocument = globalThis.document;
  const previousBitmap = globalThis.createImageBitmap;
  let dimensions;
  globalThis.createImageBitmap = async () => ({ ...dimensions, close() {} });
  globalThis.document = { createElement: () => ({
    getContext: () => ({ fillRect() {}, drawImage() {} }),
    toBlob: (callback) => callback(new Blob(["reencoded"], { type: "image/webp" }))
  }) };
  try {
    for (const [width, height, expectedWidth, expectedHeight] of [[1080, 1920, 900, 1600], [1920, 1080, 1600, 900], [480, 640, 480, 640]]) {
      dimensions = { width, height };
      const input = new Blob([jpegHeader(width, height)], { type: "image/jpeg" });
      const record = await compressPhoto(input, "future-school");
      assert.equal(record.width, expectedWidth);
      assert.equal(record.height, expectedHeight);
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.createImageBitmap = previousBitmap;
  }
});
