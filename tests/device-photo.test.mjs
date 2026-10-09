import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { appHarness, checkedState } from "./helpers/browser-environment.js";
import { createDeviceTestController } from "../src/device-test-controller.js";
import { DEVICE_TEST_LOCATION as place } from "../src/device-test-data.js";

const id = place.id;
const tick = () => new Promise(setImmediate);
function fillAI(app, field, value) {
  const target = { dataset: { deviceAiField: field }, value, isConnected: true };
  app.events.get("document:input")({ target });
  return target;
}
async function aiHarness(count = 5) {
  const app = harness();
  for (let index = 1; index < count; index++) app.data.set(`ai-${index}`, record(`ai-${index}`));
  await app.controller.start(); await app.click("photo-select-all", id);
  const generated = [], downloads = [];
  app.photoService.createDeviceAIKit = async options => { generated.push(options); return new File(["archive"], `AI融合圖片素材包-${options.photoRecords.length}張.zip`, { type: "application/zip" }); };
  app.element("a").click = function () { downloads.push(this.download); };
  app.confirmation.handler = async options => options.isRelevant();
  return { app, generated, downloads };
}

test("測試頁五／六張 AI 素材包、三項必填與學號前置零，不改正式資料或建立假打卡", async () => {
  for (const count of [5, 6]) {
    const { app, generated, downloads } = await aiHarness(count), original = app.savedState();
    assert.equal(app.controller.getPageSnapshot().aiWork.canDownload, false);
    for (const [field, value] of Object.entries({ studentName: "測試同學", className: "測試班", studentNumber: "07" })) fillAI(app, field, value);
    assert.equal(app.controller.getPageSnapshot().aiWork.canDownload, true);
    await app.click("device-ai-download");
    assert.equal(generated[0].photoRecords.length, count); assert.equal(generated[0].studentNumber, "07");
    assert.ok(generated[0].photoRecords.every(item => item.attractionId === id));
    assert.deepEqual(downloads, [`裝置測試-AI融合圖片素材包-${count}張.zip`]);
    assert.equal(app.controller.getPageSnapshot().checkIn, null); assert.deepEqual(app.savedState(), original);
  }
});

test("測試 AI 素材包取消保留三項草稿、缺欄及超過六张不能下載", async () => {
  const { app, generated } = await aiHarness();
  for (const field of ["studentName", "className", "studentNumber"]) fillAI(app, field, "測試");
  for (const field of ["studentName", "className", "studentNumber"]) {
    fillAI(app, field, "  "); await app.click("device-ai-download"); assert.equal(generated.length, 0); fillAI(app, field, "測試");
  }
  app.confirmation.handler = async () => false; await app.click("device-ai-download");
  assert.equal(app.controller.getPageSnapshot().aiWork.studentNumber, "測試"); assert.equal(generated.length, 0);
  fillAI(app, "studentNumber", "0".repeat(21)); assert.equal(app.controller.getPageSnapshot().aiWork.studentNumber.length, 20);
  app.data.set("six", record("six")); app.data.set("seven", record("seven"));
  app.events.get("window:pageshow")(); await tick(); await app.click("photo-select-all", id);
  assert.equal(app.controller.getPageSnapshot().aiWork.canDownload, false);
});

test("測試 AI 草稿中文組字不中斷，HTML 正確跳脫，離頁清除", async () => {
  const { app } = await aiHarness(); const target = fillAI(app, "studentName", "");
  app.events.get("document:compositionstart")({ target }); target.value = "學".repeat(39) + "🙂多";
  app.events.get("document:input")({ target, isComposing: true }); assert.equal(app.controller.getPageSnapshot().aiWork.studentName, "");
  app.events.get("document:compositionend")({ target }); assert.equal(Array.from(app.controller.getPageSnapshot().aiWork.studentName).length, 40);
  fillAI(app, "studentName", '\"><img src=x>'); app.controller.render();
  assert.match(app.element("#app").innerHTML, /&quot;&gt;&lt;img src=x&gt;/); assert.doesNotMatch(app.element("#app").innerHTML, /<img src=x>/);
  app.events.get("window:pagehide")(); assert.equal(app.controller.getPageSnapshot().aiWork.studentName, "");
});

for (const action of ["leave", "replace", "reset"]) test(`測試 AI 素材包生成期間 ${action} 不下載過期結果`, async () => {
  const { app, downloads } = await aiHarness();
  for (const field of ["studentName", "className", "studentNumber"]) fillAI(app, field, "測試");
  let release; app.photoService.createDeviceAIKit = () => new Promise(resolve => { release = () => resolve(new File(["old"], "old.zip")); });
  const pending = app.click("device-ai-download"); await tick(); assert.ok(release);
  if (action === "leave") app.events.get("window:pagehide")();
  if (action === "replace") { app.data.set("legacy", record("legacy")); app.events.get("window:pageshow")(); await tick(); }
  if (action === "reset") await app.click("reset-test");
  release(); await pending; assert.deepEqual(downloads, []);
});
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
  async function selectMany(count = 2) {
    for (let index = 0; index < count; index++) await app.selectPhoto(new Blob(["fixture"]), id);
  }
  return { ...app, data, converted, photoClick, selectMany };
}

test("兩頁只有一個多選儲存按鈕，沒有逐張匯出、刪照或相簿輸入", async () => {
  for (const file of ["index.html", "device-test.html", "tests/browser/device-lab.integration.html"]) {
    const html = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(html, /id="photo-input"/);
    assert.match(html, /id="photo-export-dialog"/);
  }
  const app = harness(); await app.controller.start();
  const html = app.element("#app").innerHTML;
  assert.equal((html.match(/data-photo-export-selected=/g) || []).length, 1);
  assert.match(html, /data-photo-export-selected[^>]*disabled[^>]*>儲存到手機/);
  assert.doesNotMatch(html, /data-gallery-open|data-photo-delete|data-photo-export=/);
});

test("測試頁連續拍攝及重複拍照追加獨立相片，保留舊照且不建立打卡", async () => {
  const app = harness(); await app.controller.start();
  await app.selectMany(2); await app.selectMany(1, "native"); await app.selectMany(1, "native");
  const snapshot = app.controller.getPageSnapshot();
  assert.equal(snapshot.photos.length, 5); assert.ok(app.data.has("legacy"));
  assert.equal(new Set(snapshot.photos.map(item => item.photoId)).size, 5);
  assert.ok(snapshot.photos.every(item => Object.isFrozen(item) && !("blob" in item)));
  assert.equal(snapshot.checkIn, null); assert.ok(app.savedState().checkIns["future-school"]);
});

test("測試頁拍攝其中一張失敗仍保留其他成功相片及原照", async () => {
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
  await app.controller.start(); await app.click("photo-select", "legacy"); await app.click("photo-export-selected", id);
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

test("測試頁準備中清除、原生取消及離頁後回覆均不能恢復匯出", async () => {
  for (const action of ["reset", "cancel", "leave"]) {
    const app = harness(); await app.controller.start(); app.confirmation.handler = async () => true;
    let release; app.photoService.createPhotoExport = () => new Promise(resolve => { release = () => resolve(new File(["jpeg"], "fixture.jpg", { type: "image/jpeg" })); });
    await app.click("photo-select", "legacy");
    const preparing = app.click("photo-export-selected", id); await tick();
    if (action === "reset") {
      app.element("#photo-export-dialog").requestClose(); await app.click("reset-test");
    } else if (action === "cancel") app.element("#photo-export-dialog").requestClose();
    else app.events.get("window:pagehide")();
    release(); await preparing;
    assert.equal(app.element("#photo-export-dialog").open, false);
    assert.equal(app.element("#photo-export-content").innerHTML, "");
  }
});

test("測試頁拍攝處理中離頁或清除，不保存過期相片", async () => {
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


test("旅途回憶只有一個多選儲存按鈕，舊儲存、刪照及相簿控制項均無效", async () => {
  const app = appHarness({ hash: "#memories", initialState: checkedState() });
  const records = [record("first", "future-school"), record("second", "future-school")];
  app.photoService.getAllPhotoRecords = async () => records;
  let deleted = 0, converted = 0, pickers = 0;
  app.photoService.deletePhotoRecord = async () => { deleted++; };
  app.photoService.createPhotoExport = async () => { converted++; };
  app.element("#native-camera-input").click = () => { pickers++; };
  await app.controller.start();
  const html = app.element("#app").innerHTML;
  assert.equal((html.match(/data-photo-export-selected=/g) || []).length, 1);
  assert.match(html, /data-photo-export-selected[^>]*disabled[^>]*>下載已選/);
  assert.doesNotMatch(html, /data-gallery-open|data-photo-delete|data-photo-export=/);
  assert.doesNotMatch(html, /data-card-download/);
  for (const action of ["gallery-open", "photo-delete", "photo-export"]) await app.click(action, "future-school");
  assert.deepEqual([deleted, converted, pickers], [0, 0, 0]);
  assert.equal(app.controller.getPageSnapshot().photoCount, 2);
  assert.ok(app.controller.getPageSnapshot().albums[0].attraction);
});

for (const scope of ["formal", "device"]) {
  test(`${scope === "formal" ? "正式頁" : "測試頁"}下載後保留檔名與手機位置提示，重試失敗及取消分享不顯示成功`, async () => {
    for (const platform of ["iphone", "android"]) {
      const candidate = scope === "formal" ? "future-school" : id;
      const app = scope === "device" ? harness() : appHarness({
        hash: "#memories", initialState: checkedState(), initialPhotos: [record("legacy", candidate)],
        urlService: { createObjectURL: () => "blob:formal-notice", revokeObjectURL() {} }
      });
      if (scope === "formal") app.photoService.createPhotoExport = async (item, name) => new File([item.blob], name, { type: "image/jpeg" });
      app.environment.navigator.userAgent = platform === "iphone"
        ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"
        : "Mozilla/5.0 (Linux; Android 15) Chrome/129.0";
      const downloaded = [];
      app.environment.document.createElement = () => ({ click() { downloaded.push(this.download); }, remove() {} });
      await app.controller.start();
      if (scope === "formal") {
        await app.click("memory-album", candidate);
        app.events.get("document:change")({ target: { dataset: { photoSelect: "legacy" }, checked: true,
          isConnected: true, matches: query => query === "[data-photo-select]" } });
        const selector = "[data-photo-export-selected]";
        const target = { dataset: { photoExportSelected: candidate }, isConnected: true,
          matches: query => query.split(",").some(item => item.trim() === selector), closest() { return this; } };
        await app.events.get("document:click")({ target });
      } else {
        await app.click("photo-select", "legacy"); await app.click("photo-export-selected", candidate);
      }
      const content = app.element("#photo-export-content");
      assert.doesNotMatch(content.innerHTML, /class="photo-export-notice"/);
      await app.click("photo-export-download", "0");
      assert.equal(downloaded.length, 1); assert.equal(app.element("#photo-export-dialog").open, true);
      assert.match(content.innerHTML, /class="photo-export-notice"/); if (scope === "device") assert.match(content.innerHTML, /aria-label="下載與儲存位置"/);
      assert.ok(content.innerHTML.includes(downloaded[0])); assert.match(downloaded[0], /legacy\.jpg$/);
      assert.match(content.innerHTML, /已開始下載第 1 張/); assert.match(content.innerHTML, /下載列表.*確認/);
      assert.match(content.innerHTML, platform === "iphone" ? /下載項目/ : /我的檔案/);
      assert.doesNotMatch(content.innerHTML, /已完成下載|已存入相簿/);
      assert.equal((scope === "formal" ? app.controller.getPageSnapshot().photoCount : app.controller.getPageSnapshot().photos.length) >= 1, true);
      app.environment.document.createElement = () => ({ click() { throw Error("browser blocked"); }, remove() {} });
      await app.click("photo-export-download", "0");
      assert.match(content.innerHTML, /未能開始下載/); assert.doesNotMatch(content.innerHTML, /class="photo-export-notice"/);
      assert.equal(downloaded.length, 1);
      app.environment.document.createElement = () => ({ click() { downloaded.push(this.download); }, remove() {} });
      await app.click("photo-export-download", "0"); assert.match(content.innerHTML, /class="photo-export-notice"/);
      app.environment.navigator.canShare = () => true;
      app.environment.navigator.share = async () => { throw Object.assign(Error("cancel"), { name: "AbortError" }); };
      await app.click("photo-export-share");
      assert.match(content.innerHTML, /已取消分享/); assert.doesNotMatch(content.innerHTML, /class="photo-export-notice"/);
      assert.equal(downloaded.length, 2);
      app.environment.navigator.share = async () => {};
      await app.click("photo-export-share");
      assert.match(content.innerHTML, /交由系統處理/); assert.match(content.innerHTML, /儲存影像/);
      assert.match(content.innerHTML, /儲存到檔案/); assert.doesNotMatch(content.innerHTML, /已完成下載|已存入相簿/);
      if (scope === "formal") app.navigate("#home");
      else app.events.get("window:pagehide")();
      assert.equal(app.element("#photo-export-dialog").open, false); assert.equal(content.innerHTML, "");
      assert.equal(downloaded.length, 2);
    }
  });
}
