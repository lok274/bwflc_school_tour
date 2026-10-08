import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { appHarness, checkedState } from "./helpers/browser-environment.js";
import { createDeviceTestController } from "../src/device-test-controller.js";
import { DEVICE_TEST_LOCATION as place } from "../src/device-test-data.js";

const id = place.id;
const tick = () => new Promise(setImmediate);
const record = (photoId, attractionId = id) => ({ attractionId, photoId, writeId: photoId,
  blob: new Blob([photoId], { type: "image/png" }), mime: "image/png", width: 20, height: 10 });
function harness() {
  const app = appHarness({ controllerFactory: createDeviceTestController, initialState: checkedState(),
    urlService: { createObjectURL: () => "blob:fixture", revokeObjectURL() {} } });
  app.environment.isSecureContext = true;
  let serial = 0;
  app.environment.crypto = { randomUUID: () => `test-${++serial}` };
  const data = new Map([["legacy", record("legacy")], ["foreign", record("foreign", "future-school")]]);
  app.photoService.getAllPhotoRecords = async () => [...data.values()];
  app.photoService.getPhotoRecord = async (candidate, photoId) => [...data.values()].find(item => item.attractionId === candidate && item.photoId === photoId);
  app.photoService.savePhotoRecord = async (item, { canBegin = () => true } = {}) => {
    if (!canBegin()) return null;
    data.set(item.photoId, item); return item.photoId;
  };
  app.photoService.deletePhotoRecord = async (candidate, photoId) => {
    for (const [key, item] of data) if (item.attractionId === candidate && (!photoId || key === photoId)) data.delete(key);
  };
  app.photoService.clearPhotoRecords = async () => { for (const [key, item] of data) if (item.attractionId === id) data.delete(key); };
  app.photoService.compressPhoto = async () => record("compressed");
  const converted = [];
  app.photoService.createPhotoExport = async (item, name) => {
    converted.push(item.photoId); return new File([item.blob], name, { type: "image/jpeg" });
  };
  function photoClick(attribute, photoId, candidate = id) {
    const selector = `[data-${attribute}]`;
    const key = attribute.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const target = { dataset: { [key]: candidate, photoId }, isConnected: true,
      matches: query => query === selector, closest() { return this; } };
    return app.events.get("document:click")({ target });
  }
  async function selectMany(count = 2, source = "gallery") {
    await app.click(source === "gallery" ? "gallery-open" : "native-camera-open", id);
    const input = app.element(source === "gallery" ? "#photo-input" : "#native-camera-input");
    input.files = Array.from({ length: count }, () => new Blob(["fixture"]));
    await input.listeners.change[0].callback();
  }
  return { ...app, data, converted, photoClick, selectMany };
}

test("兩頁相簿輸入可多選，測試頁提供逐張及多選手機匯出", async () => {
  for (const file of ["index.html", "device-test.html", "tests/browser/device-lab.integration.html"]) {
    const html = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(html, /<input[^>]*id="photo-input"[^>]*multiple/);
    assert.match(html, /id="photo-export-dialog"/);
  }
  const app = harness(); await app.controller.start();
  assert.match(app.element("#app").innerHTML, /從相簿加入多張圖片/);
  assert.match(app.element("#app").innerHTML, /data-photo-export-selected[^>]*disabled/);
  assert.match(app.element("#app").innerHTML, /data-photo-export=/);
});

test("測試頁一次多選及重複拍照追加獨立相片，保留舊照且不建立打卡", async () => {
  const app = harness(); await app.controller.start();
  await app.selectMany(2); await app.selectMany(1, "native"); await app.selectMany(1, "native");
  const snapshot = app.controller.getPageSnapshot();
  assert.equal(snapshot.photos.length, 5); assert.ok(app.data.has("legacy"));
  assert.equal(new Set(snapshot.photos.map(item => item.photoId)).size, 5);
  assert.ok(snapshot.photos.every(item => Object.isFrozen(item) && !("blob" in item)));
  assert.equal(snapshot.checkIn, null); assert.ok(app.savedState().checkIns["future-school"]);
});

test("測試頁相簿其中一張失敗仍保留其他成功相片及原照", async () => {
  const app = harness(); let count = 0;
  app.photoService.compressPhoto = async () => { if (++count === 1) throw Error("圖片損壞"); return record("valid"); };
  await app.controller.start(); await app.selectMany();
  assert.equal(app.controller.getPageSnapshot().photos.length, 2); assert.ok(app.data.has("legacy"));
});

test("測試頁全選、取消、逐張選取及匯出不能混入正式景點照片", async () => {
  const app = harness(); await app.controller.start(); await app.selectMany();
  await app.click("photo-select-all", id);
  assert.ok(app.controller.getPageSnapshot().photos.every(item => item.selected));
  await app.click("photo-select-none", id);
  assert.ok(app.controller.getPageSnapshot().photos.every(item => !item.selected));
  await app.click("photo-select", "foreign");
  await app.photoClick("photo-export", "foreign");
  await app.photoClick("photo-export", "legacy", "future-school");
  assert.equal(app.converted.length, 0);
  await app.click("photo-select", "legacy"); await app.click("photo-export-selected", id);
  assert.deepEqual(app.converted, ["legacy"]);
  assert.match(app.element("#photo-export-content").innerHTML, /東院道 11 號測試點-1-legacy.jpg/);
});

test("測試頁分享同步呼叫，取消及失敗保留重試；下載後備由個別點擊觸發", async () => {
  const downloads = [], revoked = [];
  const app = harness();
  app.environment.document.createElement = () => ({ click() { downloads.push(this.download); }, remove() {} });
  app.environment.URL.createObjectURL = blob => `blob:${blob.size}`;
  app.environment.URL.revokeObjectURL = url => revoked.push(url);
  let inClick = false, calls = 0;
  app.environment.navigator.canShare = () => true;
  app.environment.navigator.share = () => { assert.ok(inClick); calls++; return Promise.reject(Object.assign(Error("cancel"), { name: "AbortError" })); };
  await app.controller.start(); await app.photoClick("photo-export", "legacy");
  inClick = true; const sharing = app.click("photo-export-share"); inClick = false; await sharing;
  assert.equal(calls, 1); assert.equal(downloads.length, 0);
  assert.match(app.element("#photo-export-content").innerHTML, /已取消分享/);
  app.environment.navigator.share = () => Promise.reject(Error("failed"));
  await app.click("photo-export-share"); assert.match(app.element("#photo-export-content").innerHTML, /重試/);
  app.environment.navigator.canShare = () => false;
  await app.click("photo-export-share"); assert.match(app.element("#photo-export-content").innerHTML, /逐張下載/);
  await app.click("photo-export-download", "0"); assert.equal(downloads.length, 1);
  assert.match(downloads[0], /legacy.jpg$/); assert.ok(app.data.has("legacy"));
  await app.click("photo-export-close"); assert.equal(revoked.length, 1);
});

test("測試頁多選匯出任一張轉換失敗，整組沒有下載入口", async () => {
  const app = harness(); await app.controller.start(); await app.selectMany();
  let count = 0; app.photoService.createPhotoExport = async () => {
    if (++count === 2) throw Error("圖片損壞"); return new File(["jpeg"], "fixture.jpg", { type: "image/jpeg" });
  };
  await app.click("photo-select-all", id); await app.click("photo-export-selected", id);
  assert.equal(app.element("#photo-export-content").dataset.status, "error");
  assert.match(app.element("#photo-export-content").innerHTML, /第 2 張/);
  assert.doesNotMatch(app.element("#photo-export-content").innerHTML, /data-photo-export-download/);
});

test("測試頁準備中刪照、清除、原生取消及離頁後回覆均不能恢復匯出", async () => {
  for (const action of ["delete", "reset", "cancel", "leave"]) {
    const app = harness(); await app.controller.start(); app.confirmation.handler = async () => true;
    let release; app.photoService.createPhotoExport = () => new Promise(resolve => { release = () => resolve(new File(["jpeg"], "fixture.jpg", { type: "image/jpeg" })); });
    const preparing = app.photoClick("photo-export", "legacy"); await tick();
    if (action === "delete") {
      // A modal normally blocks this UI action; close first as a user would.
      app.element("#photo-export-dialog").requestClose(); await app.photoClick("photo-delete", "legacy");
    } else if (action === "reset") {
      app.element("#photo-export-dialog").requestClose(); await app.click("reset-test");
    } else if (action === "cancel") app.element("#photo-export-dialog").requestClose();
    else app.events.get("window:pagehide")();
    release(); await preparing;
    assert.equal(app.element("#photo-export-dialog").open, false);
    assert.equal(app.element("#photo-export-content").innerHTML, "");
  }
});

test("測試頁批次處理中離頁或清除，不繼續保存其他相片", async () => {
  for (const reset of [false, true]) {
    const app = harness(); await app.controller.start(); let release;
    app.photoService.compressPhoto = () => new Promise(resolve => { release = () => resolve(record("pending")); });
    const importing = app.selectMany(); await tick();
    let clearing;
    if (reset) { app.confirmation.handler = async () => true; clearing = app.click("reset-test"); await tick(); }
    else app.events.get("window:pagehide")();
    release(); await importing; if (clearing) await clearing;
    assert.equal(app.data.size, reset ? 1 : 2); assert.ok(app.data.has("foreign"));
    assert.ok(app.savedState().checkIns["future-school"]);
  }
});
