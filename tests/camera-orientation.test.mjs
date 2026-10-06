import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { appHarness, checkedState } from "./helpers/browser-environment.js";
import { createDeviceTestController } from "../src/device-test-controller.js";
import { DEVICE_TEST_LOCATION } from "../src/device-test-data.js";

test("轉向瀏覽器驗證使用兩頁原有相機 HTML，沒有偏離正式控制項", async () => {
  const fixture = await readFile(new URL("./browser/camera-orientation.html", import.meta.url), "utf8");
  for (const [mode, file] of [["app", "index.html"], ["device", "device-test.html"]]) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    const template = fixture.match(new RegExp(`<template id="${mode}-fixture">([\\s\\S]*?)</template>`))[1];
    for (const expression of [/<dialog id="camera-dialog"[\s\S]*?<\/dialog>/, /<input id="photo-input"[^>]*>/, /<input id="native-camera-input"[^>]*>/]) {
      assert.equal(template.match(expression)?.[0].replace(/\r\n/g, "\n"), source.match(expression)?.[0].replace(/\r\n/g, "\n"));
    }
  }
});

for (const deviceTest of [false, true]) {
  test(`${deviceTest ? "測試頁" : "正式頁"}旋轉使用實際影格，已拍預覽保持原比例，關閉後忽略 resize`, async () => {
    const id = deviceTest ? DEVICE_TEST_LOCATION.id : "future-school";
    const app = appHarness({ initialState: checkedState(), hash: "#attraction/future-school",
      ...(deviceTest ? { controllerFactory: createDeviceTestController } : {}) });
    app.environment.isSecureContext = true;
    let stopped = 0;
    app.environment.navigator.mediaDevices = { getUserMedia: async () => ({ getTracks: () => [{ stop() { stopped += 1; } }] }) };
    const video = app.element("#camera-video");
    video.videoWidth = 1080;
    video.videoHeight = 1920;
    const canvas = app.element("#camera-canvas");
    canvas.getContext = () => ({ drawImage(source) { assert.equal(source, video); } });
    canvas.toBlob = (callback) => callback(new Blob(["pixels"], { type: "image/jpeg" }));
    const resize = () => video.listeners.resize.forEach(({ callback }) => callback());
    await app.controller.start();
    await app.click("camera-open", id);
    await app.click("camera-capture", "");
    assert.equal(canvas.width, 1080);
    assert.equal(canvas.height, 1920);
    video.videoWidth = 1920;
    video.videoHeight = 1080;
    resize();
    if (deviceTest) assert.deepEqual(app.controller.getPageSnapshot().cameraResult, { status: "ready", width: 1920, height: 1080 });
    assert.equal(canvas.width, 1080, "轉向不能改動已拍相片");
    assert.equal(canvas.height, 1920);
    assert.equal(app.element("#camera-preview").hidden, false);
    await app.click("camera-retake", "");
    await app.click("camera-capture", "");
    assert.equal(canvas.width, 1920);
    assert.equal(canvas.height, 1080);
    app.element("#camera-dialog").requestClose();
    const resultBefore = deviceTest ? app.controller.getPageSnapshot().cameraResult : null;
    video.videoWidth = 1080;
    video.videoHeight = 1920;
    resize();
    assert.equal(stopped, 1);
    assert.equal(app.element("#camera-dialog").open, false);
    assert.equal(app.element("#camera-preview").hidden, true);
    if (deviceTest) assert.deepEqual(app.controller.getPageSnapshot().cameraResult, resultBefore);
  });
}
