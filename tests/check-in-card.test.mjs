import test from "node:test";
import assert from "node:assert/strict";
import { createCheckInCompletionCard, checkInCardRecords, checkInCardLabel } from "../src/check-in-card.js";
import { createCheckInCardController, renderCheckInCard } from "../src/check-in-card-controller.js";
import { REQUIRED_CHECK_IN_LOCATIONS, DEPARTURE_LOCATION } from "../src/data.js";
import { appHarness, checkedState } from "./helpers/browser-environment.js";
import { pngBytes } from "./helpers/image-fixtures.js";

const identity = { studentName: "合成測試同學", className: "測試班", studentNumber: "007" };
const complete = (verified = false, testKind = null) => ({ ready: true, testKind,
  records: REQUIRED_CHECK_IN_LOCATIONS.map(({ id }) => ({ ...checkedState([id]).checkIns[id], method: verified ? "gps" : "manual", verified })) });

test("只有完整有效的五站可製卡，學校不能代替；輸入順序依正式行程重排", () => {
  const valid = complete(); valid.records.reverse();
  assert.deepEqual(checkInCardRecords(valid).map(item => item.attractionId), REQUIRED_CHECK_IN_LOCATIONS.map(item => item.id));
  assert.ok(Object.isFrozen(checkInCardRecords(valid)[0]));
  for (const value of [{ ...complete(), ready: false }, { ...complete(), records: [] }, { ...complete(), testKind: "diagnostics" }]) assert.throws(() => checkInCardRecords(value), /五個/);
  for (const mutate of [records => records[0] = records[1], records => records[0].attractionId = DEPARTURE_LOCATION.id,
    records => records[0].checkedInAt = "invalid", records => records[0].verified = true]) {
    const invalid = complete(); mutate(invalid.records); assert.throws(() => checkInCardRecords(invalid));
  }
});
test("總結區分全 GPS、混合手動及預演，測試不聲稱正式 GPS 核實", () => {
  assert.match(checkInCardLabel(complete(true)), /5／5.*五站 GPS 已核實/);
  const mixed = complete(true); mixed.records[1] = complete().records[1]; assert.match(checkInCardLabel(mixed), /含未核實手動記錄/);
  for (const verified of [true, false]) {
    assert.match(checkInCardLabel(complete(verified, "rehearsal")), /測試/);
    assert.doesNotMatch(checkInCardLabel(complete(verified, "rehearsal")), /GPS 已核實|五站打卡完成紀錄/);
  }
});

async function canvasFixture(action) {
  const previous = { document: globalThis.document, FontFace: globalThis.FontFace };
  const texts = [], panels = [], canvases = []; let pending, fail = false;
  globalThis.FontFace = class { async load() { return this; } };
  globalThis.document = { fonts: { add() {} }, createElement() {
    const ctx = { fillRect() {}, strokeRect(...args) { panels.push(args); }, beginPath() {}, arc() {}, stroke() {},
      fillText(text, x, y) { texts.push({ text, x, y, size: parseInt(this.font) }); },
      measureText(text) { return { width: Array.from(text).length * parseInt(this.font) }; } };
    const canvas = { getContext: () => ctx, toBlob(callback) { if (pending) pending(callback); else callback(fail ? null : new Blob([pngBytes(this.width, this.height)], { type: "image/png" })); } };
    canvases.push(canvas); return canvas;
  } };
  try { await action({ texts, panels, canvases, setPending(value) { pending = value; }, setFail() { fail = true; } }); }
  finally { Object.assign(globalThis, previous); }
}

for (const [verified, testKind] of [[true, null], [false, null], [true, "rehearsal"], [false, "rehearsal"]]) {
  test(`1080px 五張縱向完成卡：${verified ? "GPS" : "手動"}／${testKind || "正式"}，身份、年份及順序完整`, () => canvasFixture(async fixture => {
    const blob = await createCheckInCompletionCard({ completion: complete(verified, testKind), identity, tripTitle: "合成活動", dateLabel: "2026年11月5日至7日" });
    assert.equal(blob.type, "image/png"); assert.equal(fixture.canvases[0].width, 1080); assert.ok(fixture.canvases[0].height > 1700);
    assert.equal(fixture.panels.length, 5); assert.ok(fixture.panels.every((panel, index) => !index || panel[1] > fixture.panels[index - 1][1] + fixture.panels[index - 1][3]));
    assert.deepEqual(fixture.texts.filter(item => REQUIRED_CHECK_IN_LOCATIONS.some(station => station.name === item.text)).map(item => item.text), REQUIRED_CHECK_IN_LOCATIONS.map(item => item.name));
    assert.ok(fixture.texts.some(item => item.text === "學號：007"));
    const output = fixture.texts.map(item => item.text).join("");
    assert.match(output, /2026年11月5日/); assert.match(output, /香港時間/);
    if (testKind) { assert.doesNotMatch(output, /GPS 已核實|五站打卡完成紀錄/); assert.match(output, /不作課業或出席證明/); }
    else assert.match(output, /不代表校方核實出席或學生身份/);
    for (const item of fixture.texts) assert.ok(item.y + item.size <= fixture.canvases[0].height && item.x + Array.from(item.text).length * item.size <= 1080, item.text);
  }));
}
test("長姓名、班別及學號完整換行，不截斷；缺字指出身份欄位且不繪製", () => canvasFixture(async fixture => {
  const personal = { studentName: "名".repeat(40), className: "班".repeat(20), studentNumber: "0".repeat(20) };
  await createCheckInCompletionCard({ completion: complete(), identity: personal });
  const output = fixture.texts.map(item => item.text).join("");
  for (const value of Object.values(personal)) assert.ok(output.includes(value));
  const count = fixture.canvases.length;
  await assert.rejects(createCheckInCompletionCard({ completion: complete(), identity: { ...identity, studentName: "名🙂" } }), /姓名.*不支援/);
  assert.equal(fixture.canvases.length, count);
  for (const key of Object.keys(identity)) await assert.rejects(createCheckInCompletionCard({ completion: complete(), identity: { ...identity, [key]: "" } }), /請填寫/);
}));
test("生成期間失效、PNG 編碼失敗及編碼完成後取消都不返回結果", () => canvasFixture(async fixture => {
  let relevant = true, release;
  fixture.setPending(callback => { release = callback; });
  const pending = createCheckInCompletionCard({ completion: complete(), identity, isRelevant: () => relevant });
  while (!release) await new Promise(resolve => setImmediate(resolve));
  relevant = false; release(new Blob(["old"], { type: "image/png" })); await assert.rejects(pending, /已取消/);
  fixture.setPending(null); fixture.setFail(); await assert.rejects(createCheckInCompletionCard({ completion: complete(), identity }), /未能生成/);
  await assert.rejects(createCheckInCompletionCard({ completion: complete(), identity, isRelevant: () => false }), /已取消/);
}));

function harness() {
  let completion = complete(), allowed = true, accept = true, service;
  const live = new Map(), downloads = [], calls = [];
  const app = appHarness({ urlService: { createObjectURL(blob) { const url = `blob:card-${calls.length}-${live.size}`; live.set(url, blob); return url; }, revokeObjectURL(url) { live.delete(url); } },
    controllerFactory: options => createCheckInCardController({ ...options, getCompletion: () => completion, canUse: () => allowed,
      cardService: async options => { calls.push(options); return service ? service(options) : new Blob(["card"], { type: "image/png" }); },
      askConfirmation: async options => typeof accept === "function" ? accept(options) : accept, showToast() {} }) });
  app.element("a").click = function () { downloads.push({ name: this.download, url: this.href }); };
  function fill(key, value = identity[key]) { app.controller.input({ dataset: { checkinCardField: key }, value }); }
  async function ready() { assert.ok(app.controller.open()); Object.keys(identity).forEach(key => fill(key)); await app.controller.preview(); }
  return { ...app, fill, ready, live, downloads, calls, setCompletion(value) { completion = value; }, setAllowed(value) { allowed = value; }, setAccept(value) { accept = value; }, setService(value) { service = value; } };
}
test("無照片也能製卡，身份必填且 model 唯讀無 Blob；關閉保留草稿但不能下載", async () => {
  const app = harness(); assert.ok(app.controller.open()); assert.equal(app.controller.getModel().canPreview, false);
  Object.keys(identity).forEach(key => app.fill(key)); await app.controller.preview();
  const model = app.controller.getModel(); assert.ok(Object.isFrozen(model.identity)); assert.ok(model.canDownload);
  assert.equal(Object.values(model).some(value => value instanceof Blob), false);
  app.controller.close(); assert.equal(app.live.size, 0); assert.equal(app.controller.getModel().identity.studentNumber, "007");
  await app.controller.download(); assert.equal(app.downloads.length, 0);
  app.controller.open(); await app.controller.download(); assert.equal(app.downloads.length, 1);
  assert.doesNotMatch(app.downloads[0].name, /合成測試同學|測試班|007/); assert.deepEqual(app.savedState().checkIns, {});
});
test("取消下載確認保留身份及預覽，確認例外也返回草稿；測試檔名有標示", async () => {
  const app = harness(); app.setCompletion(complete(true, "rehearsal")); await app.ready();
  app.setAccept(false); await app.controller.download(); assert.equal(app.downloads.length, 0); assert.ok(app.controller.getModel().previewUrl);
  app.setAccept(() => { throw Error("確認失敗"); }); await app.controller.download(); assert.match(app.controller.getModel().status, /確認失敗/);
  app.setAccept(true); await app.controller.download(); assert.match(app.downloads[0].name, /^測試-/);
});
test("中文組字不修改草稿，完成後超限保留原文並停用；身份修改失效舊预覽", async () => {
  const app = harness(); await app.ready();
  app.controller.input({ dataset: { checkinCardField: "studentName" }, value: "名".repeat(41) }, true);
  assert.equal(app.controller.getModel().identity.studentName, identity.studentName);
  app.fill("studentName", "名".repeat(41)); assert.equal(app.controller.getModel().identity.studentName.length, 41);
  assert.equal(app.controller.getModel().previewUrl, null); assert.equal(app.controller.getModel().canPreview, false); assert.equal(app.controller.getModel().canDownload, false);
  assert.doesNotMatch(renderCheckInCard({ ...app.controller.getModel(), identity: { ...identity, studentName: '"><img src=x>' } }), /<img src=x>/);
});
for (const action of ["close", "clear", "leave", "undo", "edit"]) {
  test(`生成中 ${action} 不恢復過期卡片`, async () => {
    const app = harness(); await app.ready(); let release;
    app.setService(() => new Promise(resolve => { release = resolve; })); const pending = app.controller.preview();
    if (action === "close") app.controller.close();
    if (action === "clear") app.controller.clear();
    if (action === "leave") app.setAllowed(false);
    if (action === "undo") app.setCompletion({ ...complete(), ready: false });
    if (action === "edit") app.fill("studentName", "另一合成同學");
    release(new Blob(["obsolete"], { type: "image/png" })); await pending;
    assert.equal(app.controller.getModel().canDownload, false); assert.equal(app.controller.getModel().previewUrl, null);
    if (action === "clear") assert.equal(app.controller.getModel().identity.studentNumber, "");
  });
}
test("生成及確認期間五站時間或核實狀態變動使結果失效，不留下收起的視窗", async () => {
  const app = harness(); await app.ready();
  app.setAccept(() => { app.setCompletion(complete(true)); app.controller.reconcile(); return true; }); await app.controller.download();
  assert.equal(app.downloads.length, 0); assert.equal(app.controller.getModel().canDownload, false); assert.ok(app.element("#checkin-card-dialog").open);
  await app.controller.preview(); assert.ok(app.controller.getModel().canDownload);
  const next = complete(true); next.records[0].checkedInAt = "2026-11-05T05:00:00.000Z"; app.setCompletion(next); app.controller.reconcile();
  assert.equal(app.controller.getModel().previewUrl, null); assert.match(app.controller.getModel().status, /打卡紀錄已改動/);
});
test("字型或生成失敗保留可重試草稿，清除後不保存身份", async () => {
  const app = harness(); await app.ready(); app.setService(() => { throw Error("本機字型載入失敗"); }); await app.controller.preview();
  assert.match(app.controller.getModel().status, /字型載入失敗/); assert.equal(app.controller.getModel().identity.studentNumber, "007");
  assert.equal(app.controller.getModel().canDownload, false); app.setService(null); await app.controller.preview(); assert.ok(app.controller.getModel().canDownload);
  app.controller.clear(); assert.equal(app.controller.getModel().identity.studentNumber, "");
});
test("正式 UI 唯一入口在回憶；行程及詳情純文字提示，零相片與讀取失敗不阻擋", async () => {
  const app = appHarness({ initialState: checkedState(REQUIRED_CHECK_IN_LOCATIONS.map(item => item.id)), hash: "#memories" });
  app.photoService.getAllPhotoRecords = async () => { throw Error("合成讀取失敗"); }; await app.controller.start();
  const memories = app.element("#app").innerHTML; assert.equal((memories.match(/data-memory-checkin-card-open/g) || []).length, 1);
  assert.ok(app.controller.getPageSnapshot().checkInCardAvailable); assert.match(memories, /不需要相片/);
  await app.click("memory-checkin-card-open", ""); assert.ok(app.element("#checkin-card-dialog").open);
  app.navigate("#itinerary"); assert.equal(app.element("#checkin-card-dialog").open, false);
  for (const hash of ["#itinerary", "#attraction/future-school"]) {
    app.navigate(hash); const html = app.element("#app").innerHTML;
    assert.match(html, /已完成五站打卡，可到『旅途回憶』/); assert.doesNotMatch(html, /data-memory-checkin-card-open/);
  }
  const incomplete = appHarness({ initialState: checkedState(REQUIRED_CHECK_IN_LOCATIONS.slice(1).map(item => item.id)), hash: "#memories" }); await incomplete.controller.start();
  assert.equal(incomplete.controller.getPageSnapshot().checkInCardAvailable, false); assert.doesNotMatch(incomplete.element("#app").innerHTML, /data-memory-checkin-card-open/);
  await incomplete.click("memory-checkin-card-open", ""); assert.equal(incomplete.element("#checkin-card-dialog").open, false);
});
