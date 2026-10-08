import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { appHarness, checkedState } from "./helpers/browser-environment.js";
import { createDeviceTestController } from "../src/device-test-controller.js";
import { DEVICE_TEST_LOCATION } from "../src/device-test-data.js";

const fixture = (id) => ({ attractionId: id, blob: new Blob(["original"]), width: 1600, height: 1200, mime: "image/webp", writeId: "original" });
for (const device of [false, true]) {
  const name = device ? "測試頁" : "正式頁";
  const id = device ? DEVICE_TEST_LOCATION.id : "future-school";
  function harness(options = {}) {
    const app = appHarness({ hash: "#attraction/future-school", initialState: checkedState(),
      ...(device ? { controllerFactory: createDeviceTestController } : {}), ...options });
    app.environment.isSecureContext = true;
    return app;
  }
  async function reply(app, selector = "#native-camera-input") {
    const input = app.element(selector);
    input.files = [new Blob(["new"], { type: "image/jpeg" })];
    await input.listeners.change[0].callback();
  }
  test(`${name}手機相機入口只要求原生拍攝，不開啟網頁鏡頭；回覆沿用本站保存`, async () => {
    const app = harness();
    let native = 0, gallery = 0, stream = 0;
    app.element("#native-camera-input").click = () => { native += 1; };
    app.element("#photo-input").click = () => { gallery += 1; };
    app.environment.navigator.mediaDevices = { getUserMedia: async () => { stream += 1; } };
    app.photoService.compressPhoto = async (blob, candidate) => { assert.equal(candidate, id); return fixture(id); };
    await app.controller.start();
    assert.match(app.element("#app").innerHTML, /data-native-camera-open/);
    await app.click("native-camera-open", id);
    assert.deepEqual([native, gallery, stream], [1, 0, 0]);
    assert.equal(app.element("#camera-dialog").open, false);
    await reply(app);
    assert.notEqual(app.photoData.get(id)?.writeId, "original");
    assert.equal(app.photoData.get(id)?.width, 1600);
    if (device) assert.equal(app.controller.getPageSnapshot().checkIn, null);
  });
  test(`${name}拒絕錯 ID、舊按鈕及無權限頁面的原生拍攝`, async () => {
    const app = harness();
    let requests = 0;
    app.element("#native-camera-input").click = () => { requests += 1; };
    await app.controller.start();
    await app.click("native-camera-open", "unknown");
    await app.click("native-camera-open", id, { detached: true });
    if (device) app.events.get("window:pagehide")(); else app.navigate("#itinerary");
    await app.click("native-camera-open", id);
    assert.equal(requests, 0);
    if (!device) {
      const locked = harness({ initialState: checkedState([]) });
      locked.element("#native-camera-input").click = () => { requests += 1; };
      await locked.click("native-camera-open", id);
      assert.equal(requests, 0);
    }
  });
  test(`${name}取消手機拍攝後的延遲檔案不保存，原照保留且可再拍`, async () => {
    const app = harness({ initialPhotos: [fixture(id)] });
    app.photoService.compressPhoto = async () => fixture(id);
    await app.controller.start();
    await app.click("native-camera-open", id);
    for (const listener of app.element("#native-camera-input").listeners.cancel || []) listener.callback();
    await reply(app);
    assert.equal(app.photoData.get(id).writeId, "original");
    await app.click("native-camera-open", id);
    await reply(app);
    assert.notEqual(app.photoData.get(id).writeId, "original");
  });
  test(`${name}已移除的相簿按鈕不會耗用目前手機拍攝請求`, async () => {
    const app = harness({ initialPhotos: [fixture(id)] });
    app.photoService.compressPhoto = async () => fixture(id);
    await app.controller.start();
    await app.click("gallery-open", id);
    await app.click("native-camera-open", id);
    await app.click("gallery-open", id);
    assert.equal(app.photoData.get(id).writeId, "original");
    await reply(app);
    assert.notEqual(app.photoData.get(id).writeId, "original");
  });
  test(`${name}離頁後返回，同景點的舊手機拍攝回覆仍被拒絕`, async () => {
    const app = harness({ initialPhotos: [fixture(id)] });
    app.photoService.compressPhoto = async () => fixture(id);
    await app.controller.start();
    await app.click("native-camera-open", id);
    if (device) { app.events.get("window:pagehide")(); await app.events.get("window:pageshow")(); }
    else { app.navigate("#itinerary"); app.navigate("#attraction/future-school"); }
    await reply(app);
    assert.equal(app.photoData.get(id).writeId, "original");
  });
}

test("正式與測試 HTML 保留後置拍攝輸入，移除相簿輸入", async () => {
  for (const path of ["index.html", "device-test.html", "tests/browser/isolation.html", "tests/browser/device-lab.integration.html"]) {
    const html = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(html, /<input[^>]+id="native-camera-input"[^>]+type="file"[^>]+accept="image\/\*"[^>]+capture="environment"[^>]+hidden/);
    const gallery = html.match(/<input[^>]+id="photo-input"[^>]*>/)?.[0];
    assert.equal(gallery, undefined);
  }
});
