import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { appHarness, checkedState } from "./helpers/browser-environment.js";
import { createDeviceTestController } from "../src/device-test-controller.js";
import { DEVICE_TEST_LOCATION } from "../src/device-test-data.js";

const tick = () => new Promise(setImmediate);
const formalId = "future-school";
const photo = (id) => ({ attractionId: id, blob: new Blob(["original"]), width: 20, height: 10, writeId: "original" });
function formal(options = {}) {
  return appHarness({ hash: `#attraction/${formalId}`, initialState: checkedState(), ...options });
}
function lab(options = {}) {
  const app = appHarness({ controllerFactory: createDeviceTestController, initialState: checkedState(), ...options });
  app.environment.isSecureContext = true;
  return app;
}

test("正式與測試頁的相機及確認視窗允許原生關閉請求", async () => {
  for (const file of ["index.html", "device-test.html"]) {
    const html = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    for (const id of ["camera-dialog", "confirm-dialog"]) {
      const tag = html.match(new RegExp(`<dialog\\b[^>]*id="${id}"[^>]*>`))?.[0];
      assert.match(tag, /closedby="closerequest"/);
    }
  }
});

for (const [label, makeApp, id] of [["正式頁", formal, formalId], ["測試頁", lab, DEVICE_TEST_LOCATION.id]]) {
  test(`${label}取消相機立即停止串流、釋放未保存預覽且保留原照與路由`, async () => {
    let stopped = 0, urls = 0, compressions = 0;
    const revoked = [];
    const app = makeApp({ initialPhotos: [photo(id)], urlService: {
      createObjectURL: () => `blob:preview-${++urls}`, revokeObjectURL: (url) => revoked.push(url)
    } });
    await app.controller.start();
    const originalUrl = app.controller.getPageSnapshot().photo.url;
    const hash = app.environment.location.hash;
    app.environment.navigator.mediaDevices = { getUserMedia: async () => ({ getTracks: () => [{ stop() { stopped += 1; } }] }) };
    Object.assign(app.element("#camera-video"), { videoWidth: 640, videoHeight: 480 });
    Object.assign(app.element("#camera-canvas"), { getContext: () => ({ drawImage() {} }), toBlob: (callback) => callback(new Blob(["capture"])) });
    app.photoService.compressPhoto = async () => { compressions += 1; return photo(id); };
    await app.click("camera-open", id);
    await app.click("camera-capture");
    const pendingUrl = app.element("#camera-preview").src;
    const dialog = app.element("#camera-dialog");
    // Observe cleanup during cancel, before the native default close action.
    dialog.addEventListener("cancel", () => {
      assert.equal(dialog.open, true);
      assert.equal(stopped, 1);
      assert.equal(app.element("#camera-video").srcObject, null);
      assert.ok(revoked.includes(pendingUrl));
    });
    dialog.requestClose();
    await app.click("camera-save");
    assert.equal(dialog.open, false);
    assert.equal(compressions, 0);
    assert.equal(app.photoData.get(id).writeId, "original");
    assert.equal(app.controller.getPageSnapshot().photo.url, originalUrl);
    assert.equal(app.environment.location.hash, hash);
    assert.equal(revoked.includes(originalUrl), false);
  });

  test(`${label}重新開啟相機後，舊 close 事件不能停止新串流`, async () => {
    const app = makeApp();
    let stopped = 0;
    app.environment.navigator.mediaDevices = { getUserMedia: async () => ({ getTracks: () => [{ stop() { stopped += 1; } }] }) };
    await app.click("camera-open", id);
    app.element("#camera-dialog").requestClose();
    await app.click("camera-open", id);
    const currentStream = app.element("#camera-video").srcObject;
    // Native close is queued; it can arrive after the same dialog reopens.
    for (const listener of app.element("#camera-dialog").listeners.close) listener.callback();
    assert.equal(stopped, 1);
    assert.equal(app.element("#camera-dialog").open, true);
    assert.equal(app.element("#camera-video").srcObject, currentStream);
    app.element("#camera-dialog").requestClose();
    assert.equal(stopped, 2);
  });

  test(`${label}取消等待權限的相機後，舊成功回覆不能覆蓋新相機`, async () => {
    const app = makeApp();
    const resolvers = [];
    const stopped = [0, 0];
    app.environment.navigator.mediaDevices = { getUserMedia: () => new Promise((resolve) => resolvers.push(resolve)) };
    const oldOpening = app.click("camera-open", id);
    app.element("#camera-dialog").requestClose();
    const newOpening = app.click("camera-open", id);
    const stream = (index) => ({ getTracks: () => [{ stop() { stopped[index] += 1; } }] });
    const currentStream = stream(1);
    resolvers[1](currentStream);
    await newOpening;
    resolvers[0](stream(0));
    await oldOpening;
    assert.deepEqual(stopped, [1, 0]);
    assert.equal(app.element("#camera-video").srcObject, currentStream);
    assert.equal(app.element("#camera-dialog").open, true);
    app.element("#camera-dialog").requestClose();
    assert.deepEqual(stopped, [1, 1]);
  });

  test(`${label}取消相機後的延遲拒絕不能開啟相簿`, async () => {
    const app = makeApp();
    let reject, gallery = 0;
    app.element("#photo-input").click = () => { gallery += 1; };
    app.environment.navigator.mediaDevices = { getUserMedia: () => new Promise((resolve, fail) => { reject = fail; }) };
    const opening = app.click("camera-open", id);
    app.element("#camera-dialog").requestClose();
    reject(Object.assign(Error("denied"), { name: "NotAllowedError" }));
    await opening;
    assert.equal(gallery, 0);
    assert.equal(app.element("#camera-dialog").open, false);
    assert.equal(app.element("#toast").textContent, undefined);
  });

  test(`${label}取消相機後的 Canvas 回覆不建立預覽或保存`, async () => {
    const app = makeApp();
    let completeCapture;
    app.environment.navigator.mediaDevices = { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) };
    Object.assign(app.element("#camera-video"), { videoWidth: 640, videoHeight: 480 });
    Object.assign(app.element("#camera-canvas"), { getContext: () => ({ drawImage() {} }), toBlob: (callback) => { completeCapture = callback; } });
    await app.click("camera-open", id);
    await app.click("camera-capture");
    app.element("#camera-dialog").requestClose();
    completeCapture(new Blob(["late"]));
    assert.equal(app.element("#camera-preview").hidden, true);
    assert.equal(app.element("#camera-preview").src, undefined);
    assert.equal(app.photoData.size, 0);
  });

  for (const stage of [1, 2]) {
    test(`${label}清除的第 ${stage} 次確認按返回會保留全部紀錄`, async () => {
      const app = makeApp({ initialPhotos: [photo(id)] });
      await app.controller.start();
      if (label === "正式頁") app.navigate("#home");
      else {
        app.environment.navigator.geolocation = { getCurrentPosition: (success) => success({ coords: {
          latitude: DEVICE_TEST_LOCATION.geo.lat, longitude: DEVICE_TEST_LOCATION.geo.lng, accuracy: 10
        } }) };
        await app.click("checkin", id);
      }
      const originalState = app.savedState();
      const oldCheckIn = app.controller.getPageSnapshot().checkIn;
      let clears = 0;
      app.photoService.clearPhotoRecords = async () => { clears += 1; };
      const reset = app.click(label === "正式頁" ? "reset-all" : "reset-test");
      await tick();
      const dialog = app.element("#confirm-dialog");
      assert.equal(dialog.open, true);
      if (stage === 2) { dialog.close("confirm"); await tick(); assert.equal(dialog.open, true); }
      dialog.requestClose();
      await reset;
      assert.equal(clears, 0);
      assert.equal(app.photoData.get(id).writeId, "original");
      assert.deepEqual(app.savedState(), originalState);
      assert.deepEqual(app.controller.getPageSnapshot().checkIn, oldCheckIn);
      assert.equal(dialog.returnValue, "cancel");
    });
  }

  test(`${label}返回取消未核實手動打卡，不新增紀錄`, async () => {
    const app = makeApp(label === "正式頁" ? { initialState: undefined } : {});
    // With no geolocation service the shared controller offers a manual prompt.
    const checkIn = app.click("checkin", id);
    await tick();
    assert.equal(app.element("#confirm-dialog").open, true);
    app.element("#confirm-dialog").requestClose();
    await checkIn;
    assert.equal(app.controller.getPageSnapshot().checkIn, null);
    assert.equal(app.element("#confirm-dialog").open, false);
  });
}

test("返回取消目前與排隊確認，不刪照或生成下載；新確認仍可使用", async () => {
  const app = formal({ initialPhotos: [photo(formalId)] });
  await app.controller.start();
  let generated = 0;
  app.photoService.createTravelCard = async () => { generated += 1; return new Blob(["card"]); };
  const deleting = app.click("photo-delete", formalId);
  const downloading = app.click("card-download", formalId);
  const undoing = app.click("checkin-undo", formalId);
  await tick();
  app.element("#confirm-dialog").requestClose();
  await Promise.all([deleting, downloading, undoing]);
  assert.equal(generated, 0);
  assert.equal(app.photoData.get(formalId).writeId, "original");
  assert.ok(app.savedState().checkIns[formalId]);
  assert.equal(app.element("#confirm-dialog").open, false);
  const fresh = app.click("photo-delete", formalId);
  await tick();
  assert.equal(app.element("#confirm-dialog").open, true);
  app.element("#confirm-dialog").close("confirm");
  await fresh;
  assert.equal(app.photoData.has(formalId), false);
  assert.ok(app.savedState().checkIns[formalId]);
});
