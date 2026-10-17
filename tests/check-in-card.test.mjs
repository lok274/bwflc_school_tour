import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createCheckInCompletionCard, checkInCardRecords, checkInCardLabel } from "../src/check-in-card.js";
import { createCheckInCardController, renderCheckInCard } from "../src/check-in-card-controller.js";
import { REQUIRED_CHECK_IN_LOCATIONS, DEPARTURE_LOCATION } from "../src/data.js";
import { appHarness, checkedState } from "./helpers/browser-environment.js";
import { getCoverCrop, drawCoverImage } from "../src/photos.js";
import { pngBytes } from "./helpers/image-fixtures.js";

const identity = { studentName: "合成測試同學", className: "測試班", studentNumber: "007" };
const encouragement = "旅程雖然告一段落，探索不會停步。把這次的發現與勇氣，帶進下一段成長旅程！";
const complete = (verified = false, testKind = null) => ({ ready: true, testKind,
  records: REQUIRED_CHECK_IN_LOCATIONS.map(({ id }) => ({ ...checkedState([id]).checkIns[id], method: verified ? "gps" : "manual", verified })) });

for (const failedPath of ["./vendor/fontkit-1.1.1.js", "./vendor/noto-sans-hk-regular.js"]) {
  test(`字型模組載入失敗後使用新網址重試並共用同一次載入：${failedPath}`, async () => {
    const requested = [], failed = new Set();
    const source = readFileSync(new URL("../src/local-font.js", import.meta.url), "utf8")
      .replace(/export /g, "").replace(/\bimport\(/g, "importModule(");
    const context = vm.createContext({ Uint8Array, atob, importModule: async path => {
      requested.push(path);
      // Model the browser's module map: failed URLs keep rejecting.
      if (path === failedPath) failed.add(path);
      if (failed.has(path)) throw Error("network failure");
      return path.includes("fontkit") ? { default: { create: () => ({ characterSet: [65] }) } } : { fontBase64: "QQ==" };
    } });
    vm.runInContext(source, context);
    await assert.rejects(context.loadLocalFont(), /network failure/);
    const firstRetry = context.loadLocalFont(), concurrent = context.loadLocalFont();
    assert.equal(firstRetry, concurrent);
    const result = await firstRetry;
    assert.equal(result.characterSet.has(65), true);
    assert.equal(requested.filter(path => path === failedPath).length, 1);
    assert.equal(requested.filter(path => path === `${failedPath}?font-retry=1`).length, 1);
    assert.equal(requested.filter(path => path.includes("?font-retry=")).length, 1);
    const before = requested.length; await context.loadLocalFont(); assert.equal(requested.length, before);
  });
}

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
  const previous = { document: globalThis.document, FontFace: globalThis.FontFace, Image: globalThis.Image, createImageBitmap: globalThis.createImageBitmap };
  const texts = [], panels = [], canvases = [], drawings = [], circles = []; let pending, fail = false;
  globalThis.FontFace = class { async load() { return this; } };
  globalThis.Image = class { constructor() { throw Error("紀錄卡不應載入裝飾圖片。"); } };
  globalThis.document = { fonts: { add() {} }, createElement() {
    const ctx = { fillRect() {}, strokeRect(...args) { panels.push(args); }, beginPath() {}, arc(...args) { circles.push(args); }, stroke() {}, save() {}, restore() {}, clip() {},
      fillText(text, x, y) { texts.push({ text, x, y, size: parseInt(this.font), color: this.fillStyle }); },
      drawImage(...args) { drawings.push(args); },
      measureText(text) { return { width: Array.from(text).length * parseInt(this.font) }; } };
    const canvas = { getContext: () => ctx, toBlob(callback) { if (pending) pending(callback); else callback(fail ? null : new Blob([pngBytes(this.width, this.height)], { type: "image/png" })); } };
    canvases.push(canvas); return canvas;
  } };
  try { await action({ texts, panels, canvases, drawings, circles,
    setPending(value) { pending = value; }, setFail() { fail = true; } }); }
  finally { Object.assign(globalThis, previous); }
}

for (const [verified, testKind] of [[true, null], [false, null], [true, "rehearsal"], [false, "rehearsal"]]) {
  test(`1080px 五張縱向完成卡：${verified ? "GPS" : "手動"}／${testKind || "正式"}，身份、年份及順序完整`, () => canvasFixture(async fixture => {
    const blob = await createCheckInCompletionCard({ completion: complete(verified, testKind), identity, tripTitle: "合成活動", dateLabel: "2026年11月5日至7日" });
    assert.equal(blob.type, "image/png"); assert.equal(fixture.canvases[0].width, 1080); assert.ok(fixture.canvases[0].height > 1700);
    assert.equal(fixture.drawings.length, 0);
    const title = fixture.texts.filter(item => item.color === "#f3b955");
    assert.equal(title.map(item => item.text).join(""), testKind ? "五站測試打卡紀錄" : encouragement);
    assert.ok(title.every(item => item.x === 48 && item.size === 44));
    const trip = fixture.texts.find(item => item.text === "合成活動");
    assert.equal(trip.x, 48); assert.ok(trip.y >= title.at(-1).y + 66 + 12);
    assert.equal(fixture.panels.length, 5); assert.ok(fixture.panels.every((panel, index) => !index || panel[1] > fixture.panels[index - 1][1] + fixture.panels[index - 1][3]));
    assert.deepEqual(fixture.texts.filter(item => REQUIRED_CHECK_IN_LOCATIONS.some(station => station.name === item.text)).map(item => item.text), REQUIRED_CHECK_IN_LOCATIONS.map(item => item.name));
    assert.ok(fixture.texts.some(item => item.text === "學號：007"));
    const output = fixture.texts.map(item => item.text).join("");
    assert.match(output, /2026年11月5日/); assert.match(output, /香港時間/);
    assert.doesNotMatch(output, /5／5|五站打卡完成紀錄：|五站測試打卡完成：/);
    const stationStatus = verified ? testKind ? "模擬定位通過" : "GPS 已核實" : testKind ? "測試手動記錄 · 未核實" : "未核實手動記錄";
    assert.equal(fixture.texts.filter(item => item.text === stationStatus).length, REQUIRED_CHECK_IN_LOCATIONS.length);
    if (testKind) { assert.doesNotMatch(output, /GPS 已核實|五站打卡完成紀錄|旅程雖然告一段落/); assert.match(output, /不作課業或出席證明/); }
    else {
      assert.ok(title.length > 1); assert.doesNotMatch(output, /五站打卡完成紀錄/);
      assert.doesNotMatch(output, /此卡為本機打卡紀錄|不代表校方核實出席或學生身份/);
      const lastPanel = fixture.panels.at(-1);
      assert.equal(fixture.canvases[0].height - lastPanel[1] - lastPanel[3], 48);
    }
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

test("選填相片只接受五站保存紀錄，放大圓圈與輸出的點選位置相同並釋放解碼圖片", () => canvasFixture(async fixture => {
  const id = REQUIRED_CHECK_IN_LOCATIONS[0].id, photo = { attractionId: id, photoId: "synthetic-1", writeId: "one", blob: new Blob([pngBytes(160, 120)], { type: "image/png" }) };
  let layout, closed = 0;
  globalThis.createImageBitmap = async () => ({ width: 160, height: 120, close() { closed++; } });
  await createCheckInCompletionCard({ completion: complete(), identity, photos: [photo], onLayout: value => { layout = value; } });
  assert.equal(closed, 1); assert.equal(fixture.drawings.length, 1); assert.equal(layout.circles.length, 5);
  for (const circle of layout.circles) {
    assert.equal(circle.r, 140); assert.ok(fixture.circles.some(([cx, cy, r]) => cx === circle.cx && cy === circle.cy && r === circle.r));
    assert.ok(circle.cx - circle.r > 48 && circle.cx + circle.r < 48 + 304);
  }
  assert.deepEqual(fixture.drawings[0].slice(-4), [layout.circles[0].cx - 140, layout.circles[0].cy - 140, 280, 280]);
  for (const photos of [[{ ...photo, attractionId: DEPARTURE_LOCATION.id }], [photo, photo], [{ ...photo, blob: "not a saved photo" }]]) {
    await assert.rejects(createCheckInCompletionCard({ completion: complete(), identity, photos }), /相片與五站景點不符/);
  }
}));
test("圓形裁切共用幾何保留原本置中，橫相直相方相可移到邊界及放大而不露底", () => {
  for (const [width, height] of [[480, 160], [160, 480], [160, 160]]) {
    const image = { width, height }, centered = getCoverCrop(image, 280, 280);
    assert.deepEqual(centered, { sourceX: (width - Math.min(width, height)) / 2, sourceY: (height - Math.min(width, height)) / 2, sourceWidth: Math.min(width, height), sourceHeight: Math.min(width, height) });
    for (const zoom of [1, 2, 3]) for (const x of [0, 0.5, 1]) for (const y of [0, 0.5, 1]) {
      const crop = getCoverCrop(image, 600, 600, { x, y, zoom });
      assert.ok(crop.sourceX >= 0 && crop.sourceY >= 0 && crop.sourceX + crop.sourceWidth <= width && crop.sourceY + crop.sourceHeight <= height);
      assert.equal(crop.sourceWidth, Math.min(width, height) / zoom); assert.equal(crop.sourceHeight, crop.sourceWidth);
      let args; drawCoverImage({ drawImage(...value) { args = value; } }, image, 10, 20, 600, 600, { x, y, zoom });
      assert.deepEqual(args, [image, crop.sourceX, crop.sourceY, crop.sourceWidth, crop.sourceHeight, 10, 20, 600, 600]);
    }
  }
  const destination = getCoverCrop({ width: 160, height: 120 }, 936, 600);
  assert.deepEqual(destination, { sourceX: 0, sourceY: (120 - 160 / (936 / 600)) / 2, sourceWidth: 160, sourceHeight: 160 / (936 / 600) });
  for (const frame of [null, {}, { x: NaN, y: 0.5, zoom: 1 }, { x: 0.5, y: Infinity, zoom: 1 }, { x: -1, y: 0.5, zoom: 1 }, { x: 1.1, y: 0.5, zoom: 1 }, { x: 0.5, y: 0.5, zoom: 0 }, { x: 0.5, y: 0.5, zoom: 3.1 }]) assert.throws(() => getCoverCrop({ width: 480, height: 160 }, 280, 280, frame), /位置無效/);
});
test("紀錄卡按已套用位置繪製，無效裁切不會輸出 PNG", () => canvasFixture(async fixture => {
  globalThis.createImageBitmap = async () => ({ width: 480, height: 160, close() {} });
  const photo = { attractionId: REQUIRED_CHECK_IN_LOCATIONS[0].id, photoId: "framed", blob: new Blob([pngBytes(480, 160)], { type: "image/png" }), frame: { x: 1, y: 0, zoom: 2 } };
  await createCheckInCompletionCard({ completion: complete(), identity, photos: [photo] });
  assert.deepEqual(fixture.drawings[0].slice(1, 5), [400, 0, 80, 80]);
  await assert.rejects(createCheckInCompletionCard({ completion: complete(), identity, photos: [{ ...photo, frame: { ...photo.frame, zoom: NaN } }] }), /位置無效/);
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

const originalBitmap = globalThis.createImageBitmap;
test.afterEach(() => { globalThis.createImageBitmap = originalBitmap; });
function harness(width = 480, height = 160) {
  globalThis.createImageBitmap = async () => ({ width, height, close() {} });
  let completion = complete(), allowed = true, accept = true, service;
  let photos = [], photoVersion = 0, readState = "ready";
  const live = new Map(), downloads = [], calls = [];
  const app = appHarness({ urlService: { createObjectURL(blob) { const url = `blob:card-${calls.length}-${live.size}`; live.set(url, blob); return url; }, revokeObjectURL(url) { live.delete(url); } },
    controllerFactory: options => createCheckInCardController({ ...options, getCompletion: () => completion, canUse: () => allowed,
      getPhotos: id => photos.filter(photo => photo.attractionId === id), getPhotoVersion: () => photoVersion, getPhotoReadState: () => readState,
      cardService: async options => { calls.push(options); options.onLayout({ width: 1080, height: 2500, circles: REQUIRED_CHECK_IN_LOCATIONS.map((item, index) => ({ attractionId: item.id, name: item.name, cx: 200, cy: 900 + index * 320, r: 140 })) }); return service ? service(options) : new Blob(["card"], { type: "image/png" }); },
      askConfirmation: async options => typeof accept === "function" ? accept(options) : accept, showToast() {} }) });
  const canvas = app.element("#checkin-photo-adjust-canvas"), captures = new Set(), released = [];
  canvas.id = "checkin-photo-adjust-canvas";
  let draws = 0;
  canvas.getContext = () => ({ clearRect() {}, save() {}, restore() {}, beginPath() {}, arc() {}, clip() {}, drawImage() { draws++; } });
  canvas.width = canvas.height = 600;
  canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 300, height: 300 });
  canvas.setPointerCapture = id => captures.add(id);
  canvas.releasePointerCapture = id => { captures.delete(id); released.push(id); pointer("lostpointercapture", id); };
  app.element("a").click = function () { downloads.push({ name: this.download, url: this.href }); };
  function fill(key, value = identity[key]) { app.controller.input({ dataset: { checkinCardField: key }, value }); }
  async function ready() { assert.ok(app.controller.open()); Object.keys(identity).forEach(key => fill(key)); await app.controller.preview(); }
  async function cardClick(attribute, value = "") {
    const key = attribute.replace(/-([a-z])/g, (_, character) => character.toUpperCase());
    const target = { dataset: { [key]: value }, matches: selector => selector === `[data-${attribute}]`, closest() { return this; } };
    for (const listener of app.element("#checkin-card-dialog").listeners.click) await listener.callback({ target });
  }
  function keyboard(key, count = 1, extra = {}) {
    let prevented = 0;
    for (let index = 0; index < count; index++) for (const listener of app.element("#checkin-card-dialog").listeners.keydown || []) {
      listener.callback({ target: canvas, key, preventDefault() { prevented++; }, ...extra });
    }
    return prevented;
  }
  function pointer(type, id, x = 160, y = 170, extra = {}) {
    const event = { target: canvas, pointerId: id, pointerType: "touch", button: 0, isPrimary: id === 1, clientX: x, clientY: y, preventDefault() {}, ...extra };
    for (const listener of app.element("#checkin-card-dialog").listeners[type] || []) listener.callback(event);
  }
  return { ...app, fill, ready, cardClick, keyboard, pointer, canvas, captures, released, draws: () => draws, live, downloads, calls, setPhotos(value) { photos = value; photoVersion++; }, setReadState(value) { readState = value; }, setCompletion(value) { completion = value; }, setAllowed(value) { allowed = value; }, setAccept(value) { accept = value; }, setService(value) { service = value; } };
}

async function editing(width = 480, height = 160) {
  const app = harness(width, height), id = REQUIRED_CHECK_IN_LOCATIONS[0].id;
  const photo = { attractionId: id, photoId: "gesture", writeId: "saved", blob: new Blob([pngBytes(width, height)], { type: "image/png" }) };
  app.setPhotos([photo]); await app.ready(); await app.cardClick("checkin-card-circle", id); await app.cardClick("checkin-card-photo", photo.photoId);
  return { ...app, photo, frame: () => app.controller.getModel().adjustment.frame };
}
function near(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`); }

test("選圖及調整不再提供滑桿或完成標記操作，舊清除事件不改動已選相片", async () => {
  const app = await editing(), dialog = app.element("#checkin-card-dialog");
  const absent = () => assert.doesNotMatch(dialog.innerHTML, /type="range"|<output|checkin-photo-controls|data-checkin-card-photo-clear|使用完成標記/);
  absent(); assert.match(dialog.innerHTML, /tabindex="0" role="img"/);
  assert.match(dialog.innerHTML, /方向鍵移動相片，按加號放大、減號縮小/);
  assert.equal((dialog.innerHTML.match(/class="button button-(?:primary|secondary)"/g) || []).length, 4);
  await app.cardClick("checkin-card-frame-apply");
  await app.cardClick("checkin-card-circle", app.photo.attractionId); absent();
  const before = app.calls.length;
  await app.cardClick("checkin-card-photo-clear"); assert.ok(app.controller.getModel().adjustment); assert.equal(app.calls.length, before);
  await app.cardClick("checkin-card-frame-change"); absent();
  await app.cardClick("checkin-card-photo-clear"); assert.ok(app.controller.getModel().picker); assert.equal(app.calls.length, before);
  await app.cardClick("checkin-card-picker-cancel");
  assert.equal(app.controller.getModel().selectedStations.length, 1); assert.equal(app.calls.at(-1).photos[0].photoId, app.photo.photoId);
  app.controller.clear();
});

test("圓形預覽鍵盤只接收方向及縮放鍵，保持裁切邊界並保留其他欄位及瀏覽器快捷鍵", async () => {
  const app = await editing(), initial = app.frame(), html = app.element("#checkin-card-dialog").innerHTML;
  for (const key of ["Tab", "Escape", "a", "__proto__"]) assert.equal(app.keyboard(key), 0);
  for (const modifier of ["ctrlKey", "metaKey", "altKey"]) assert.equal(app.keyboard("+", 1, { [modifier]: true }), 0);
  assert.equal(app.keyboard("ArrowLeft", 1, { target: { id: "checkin-card-studentName" } }), 0);
  assert.deepEqual(app.frame(), initial);
  const draws = app.draws(); assert.equal(app.keyboard("ArrowRight"), 1); assert.equal(app.draws() - draws, 1);
  assert.equal(app.frame().x, 0.49); app.keyboard("ArrowDown"); assert.equal(app.frame().y, 0.49);
  app.keyboard("ArrowLeft", 100); app.keyboard("ArrowUp", 100); app.keyboard("=", 100);
  assert.deepEqual(app.frame(), { x: 1, y: 1, zoom: 3 });
  app.keyboard("ArrowRight", 200); app.keyboard("ArrowDown", 200); app.keyboard("-", 100);
  assert.deepEqual(app.frame(), { x: 0, y: 0, zoom: 1 });
  assert.equal(app.element("#checkin-card-dialog").innerHTML, html);
  app.setReadState("loading"); assert.equal(app.keyboard("+"), 0); assert.equal(app.frame().zoom, 1);
  app.setReadState("ready"); app.setPhotos([]); assert.equal(app.keyboard("+"), 0); assert.equal(app.frame().zoom, 1);
  app.controller.clear();
});

for (const [width, height] of [[480, 160], [160, 480], [300, 300]]) {
  test(`${width}×${height} 雙指縮放保留偏心取景，移動中點可平移，套用後 PNG 使用同一位置`, async () => {
    const app = await editing(width, height); app.keyboard("+", 10);
    const sourceAt = (x, y) => {
      const crop = getCoverCrop({ width, height }, 1, 1, app.frame());
      return [crop.sourceX + (x - 10) / 300 * crop.sourceWidth, crop.sourceY + (y - 20) / 300 * crop.sourceHeight];
    };
    const anchor = sourceAt(150, 100), html = app.element("#checkin-card-dialog").innerHTML, draws = app.draws();
    app.pointer("pointerdown", 1, 100, 100); app.pointer("pointerdown", 2, 200, 100);
    app.pointer("pointermove", 1, 80, 100); app.pointer("pointermove", 2, 220, 100);
    near(app.frame().zoom, 2.1); sourceAt(150, 100).forEach((value, index) => near(value, anchor[index]));
    assert.equal(app.draws() - draws, 2); assert.equal(app.element("#checkin-card-dialog").innerHTML, html);
    app.pointer("pointermove", 1, 95, 110); app.pointer("pointermove", 2, 235, 110);
    near(app.frame().zoom, 2.1); sourceAt(165, 110).forEach((value, index) => near(value, anchor[index]));
    const frame = { ...app.frame() };
    await app.cardClick("checkin-card-frame-apply"); assert.deepEqual(app.calls.at(-1).photos[0].frame, frame); assert.equal(app.captures.size, 0);
    await app.cardClick("checkin-card-circle", app.photo.attractionId); assert.deepEqual(app.frame(), frame); app.controller.clear();
  });
}

test("雙指縮放到 1／3 倍及拖動邊界後反向立即回應，不需補回超出距離", async () => {
  const app = await editing();
  app.pointer("pointerdown", 1, 100, 170); app.pointer("pointerdown", 2, 200, 170);
  app.pointer("pointermove", 2, 500, 170); assert.equal(app.frame().zoom, 3);
  app.pointer("pointermove", 2, 480, 170); near(app.frame().zoom, 2.85);
  app.pointer("pointermove", 2, 110, 170); assert.equal(app.frame().zoom, 1);
  app.pointer("pointermove", 2, 120, 170); assert.equal(app.frame().zoom, 2);
  app.pointer("pointerup", 2); app.pointer("pointermove", 1, -1000, 170); assert.equal(app.frame().x, 1);
  app.pointer("pointermove", 1, -990, 170); assert.ok(app.frame().x < 1);
  app.pointer("pointermove", 1, 1000, 170); assert.equal(app.frame().x, 0);
  app.pointer("pointermove", 1, 990, 170); assert.ok(app.frame().x > 0); app.controller.clear();
});

test("一指轉雙指再回一指無跳動，第三指、混合裝置及非主滑鼠不介入；重疊手指不產生無效位置", async () => {
  const app = await editing(); app.keyboard("+", 20);
  app.pointer("pointerdown", 9, 100, 100, { pointerType: "mouse", isPrimary: false });
  app.pointer("pointerdown", 9, 100, 100, { pointerType: "mouse", isPrimary: true, button: 2 }); assert.equal(app.captures.size, 0);
  app.pointer("pointerdown", 1, 100, 100); const first = app.frame();
  app.pointer("pointerdown", 9, 200, 100, { pointerType: "pen", isPrimary: true }); assert.equal(app.captures.size, 1);
  app.pointer("pointerdown", 2, 200, 100); app.pointer("pointerdown", 3, 250, 100); assert.equal(app.captures.size, 2);
  app.pointer("pointermove", 3, 1000, 1000); assert.deepEqual(app.frame(), first);
  app.pointer("pointermove", 1, 100, 100); assert.deepEqual(app.frame(), first);
  app.pointer("pointermove", 2, 220, 100); const two = app.frame(); app.pointer("pointerup", 2);
  app.pointer("pointermove", 1, 100, 100); assert.deepEqual(app.frame(), two);
  app.pointer("pointermove", 1, 110, 100); assert.ok(app.frame().x < two.x); assert.equal(app.frame().zoom, two.zoom);
  app.pointer("pointercancel", 1); assert.equal(app.captures.size, 0);
  app.pointer("pointerdown", 1, 150, 150); app.pointer("pointerdown", 2, 150, 150);
  app.pointer("pointermove", 2, 150.5, 150); assert.ok(Object.values(app.frame()).every(Number.isFinite)); near(app.frame().zoom, two.zoom);
  app.pointer("pointermove", 2, 170, 150); assert.ok(Object.values(app.frame()).every(Number.isFinite));
  app.pointer("lostpointercapture", 1); assert.equal(app.captures.size, 1); app.pointer("pointermove", 2, 170, 150); app.controller.clear();
  assert.equal(app.captures.size, 0); assert.equal(new Set(app.released).size, 2);
});

for (const action of ["keyboard", "reset", "cancel", "close", "change", "clear", "replace", "delete", "loading", "undo", "staleMove"]) {
  test(`兩指調整期間 ${action} 釋放全部捕捉，舊事件不再改動相片`, async () => {
    const app = await editing(); app.keyboard("+", 20);
    app.pointer("pointerdown", 1, 100, 100); app.pointer("pointerdown", 2, 200, 100);
    if (action === "keyboard") app.keyboard("ArrowLeft", 30);
    if (action === "reset") await app.cardClick("checkin-card-frame-reset");
    if (action === "cancel") app.element("#checkin-card-dialog").requestClose();
    if (action === "close") app.controller.close();
    if (action === "change") await app.cardClick("checkin-card-frame-change");
    if (action === "clear") app.controller.clear();
    if (action === "replace") app.setPhotos([{ ...app.photo, writeId: "replacement" }]);
    if (action === "delete") app.setPhotos([]);
    if (action === "loading") app.setReadState("loading");
    if (action === "undo") app.setCompletion({ ...complete(), ready: false });
    if (action === "staleMove") { app.setPhotos([]); app.pointer("pointermove", 1, 80, 100); }
    else app.controller.reconcile();
    assert.equal(app.captures.size, 0); assert.deepEqual(app.released, [1, 2]);
    const frame = app.controller.getModel().adjustment?.frame;
    app.pointer("pointermove", 1, -1000, -1000); app.pointer("pointermove", 2, 1000, 1000);
    assert.deepEqual(app.controller.getModel().adjustment?.frame, frame);
    if (action === "keyboard") assert.equal(frame.x, 0.8);
    if (action === "reset") assert.deepEqual(frame, { x: 0.5, y: 0.5, zoom: 1 });
    app.controller.clear();
  });
}

test("圓圈只選本站相片，取消不改選圖，分頁只保留可見網址，替換或讀取失敗不下載舊卡", async () => {
  const app = harness(), id = REQUIRED_CHECK_IN_LOCATIONS[0].id, otherId = REQUIRED_CHECK_IN_LOCATIONS[1].id;
  const photos = Array.from({ length: 13 }, (_, index) => ({ attractionId: id, photoId: `photo-${index}`, writeId: `write-${index}`, blob: new Blob([pngBytes(480, 160)], { type: "image/png" }) }));
  app.setPhotos([...photos, { ...photos[0], attractionId: otherId, photoId: "other-station" }]); await app.ready();
  await app.cardClick("checkin-card-circle", id); assert.equal(app.controller.getModel().picker.photos.length, 12); assert.equal(app.live.size, 12);
  assert.ok(app.controller.getModel().picker.photos.every(photo => !Object.hasOwn(photo, "blob")));
  await app.cardClick("checkin-card-photo-page", "1"); assert.equal(app.live.size, 1);
  await app.cardClick("checkin-card-photo", "other-station"); assert.ok(app.controller.getModel().picker);
  await app.cardClick("checkin-card-photo", "photo-0"); await app.cardClick("checkin-card-frame-apply"); assert.equal(app.calls.at(-1).photos[0].photoId, "photo-0"); assert.equal(app.live.size, 1);
  await app.cardClick("checkin-card-circle", id); app.element("#checkin-card-dialog").requestClose();
  assert.equal(app.controller.getModel().picker, null); assert.ok(app.controller.getModel().canDownload); assert.equal(app.calls.at(-1).photos[0].photoId, "photo-0");
  app.setAccept(options => { assert.match(options.message, /已選相片/); app.setPhotos(photos.map(photo => ({ ...photo, writeId: "replaced" }))); return true; });
  await app.controller.download(); assert.equal(app.downloads.length, 0); assert.equal(app.controller.getModel().canDownload, false);
  app.controller.reconcile(); await app.controller.preview(); assert.equal(app.calls.at(-1).photos.length, 0);
  await app.cardClick("checkin-card-circle", id); await app.cardClick("checkin-card-photo", "photo-0"); await app.cardClick("checkin-card-frame-apply");
  app.setReadState("error"); app.controller.reconcile(); assert.equal(app.controller.getModel().canDownload, false);
  await app.controller.preview(); assert.equal(app.calls.at(-1).photos.length, 0); assert.ok(app.controller.getModel().canDownload);
  app.controller.clear(); assert.equal(app.live.size, 0);
});
test("PNG 生成失敗後可改選相片，保留其他站相片且不能下載舊卡", async () => {
  const app = harness(), [station, other] = REQUIRED_CHECK_IN_LOCATIONS;
  const good = { attractionId: station.id, photoId: "good", writeId: "good", blob: new Blob([pngBytes(480, 160)], { type: "image/png" }) };
  const bad = { ...good, photoId: "bad", writeId: "bad", blob: new Blob([pngBytes(480, 160)], { type: "image/png" }) };
  const otherPhoto = { ...good, attractionId: other.id, photoId: "other" };
  app.setPhotos([good, bad, otherPhoto]);
  app.setService(options => {
    if (options.photos.some(photo => photo.photoId === "bad")) throw Error("相片解碼失敗");
    return new Blob(["current card"], { type: "image/png" });
  });
  await app.ready();
  await app.cardClick("checkin-card-circle", other.id); await app.cardClick("checkin-card-photo", "other"); await app.cardClick("checkin-card-frame-apply");
  await app.cardClick("checkin-card-circle", station.id); if (app.controller.getModel().adjustment) await app.cardClick("checkin-card-frame-change"); await app.cardClick("checkin-card-photo", "bad"); await app.cardClick("checkin-card-frame-apply");
  const model = app.controller.getModel(), html = renderCheckInCard(model);
  assert.match(model.status, /相片解碼失敗/); assert.equal(model.previewUrl, null); assert.equal(model.layout, null);
  assert.equal(model.canDownload, false); await app.controller.download(); assert.equal(app.downloads.length, 0);
  assert.ok(Object.isFrozen(model.selectedStations) && model.selectedStations.every(Object.isFrozen));
  assert.deepEqual(model.selectedStations.map(item => Object.keys(item)), [["attractionId", "name"], ["attractionId", "name"]]);
  assert.ok(html.includes(`重新選擇${station.name}相片`) && html.includes(`重新選擇${other.name}相片`));
  app.controller.close(); app.controller.open();
  await app.cardClick("checkin-card-circle", REQUIRED_CHECK_IN_LOCATIONS[2].id); assert.equal(app.controller.getModel().picker, null);
  await app.cardClick("checkin-card-circle", station.id); assert.ok(app.controller.getModel().adjustment); await app.cardClick("checkin-card-frame-change"); assert.equal(app.controller.getModel().picker.attractionId, station.id);
  await app.cardClick("checkin-card-photo", "good"); await app.cardClick("checkin-card-frame-apply");
  assert.ok(app.controller.getModel().canDownload && app.controller.getModel().previewUrl);
  assert.deepEqual(app.calls.at(-1).photos.map(photo => photo.photoId).sort(), ["good", "other"]);
});

test("相片位置是獨立待套用草稿，鍵盤不重畫整個視窗，重設及取消保留已套用結果", async () => {
  const app = harness(), [station, other] = REQUIRED_CHECK_IN_LOCATIONS;
  const photo = { attractionId: station.id, photoId: "first", writeId: "saved", blob: new Blob([pngBytes(480, 160)], { type: "image/png" }) };
  app.setPhotos([photo, { ...photo, attractionId: other.id, photoId: "second" }]); await app.ready(); const before = app.calls.length;
  await app.cardClick("checkin-card-circle", station.id); await app.cardClick("checkin-card-photo", "first");
  assert.equal(app.calls.length, before); assert.equal(app.controller.getModel().canDownload, false);
  const html = app.element("#checkin-card-dialog").innerHTML; app.keyboard("+", 20); app.keyboard("ArrowLeft", 50); app.keyboard("ArrowDown", 50);
  assert.equal(app.element("#checkin-card-dialog").innerHTML, html); assert.ok(Object.isFrozen(app.controller.getModel().adjustment.frame));
  await app.cardClick("checkin-card-frame-apply"); assert.deepEqual(app.calls.at(-1).photos[0].frame, { x: 1, y: 0, zoom: 2 });
  await app.cardClick("checkin-card-circle", other.id); await app.cardClick("checkin-card-photo", "second"); await app.cardClick("checkin-card-frame-apply");
  assert.deepEqual(app.calls.at(-1).photos.map(item => item.frame), [{ x: 1, y: 0, zoom: 2 }, { x: 0.5, y: 0.5, zoom: 1 }]);
  await app.cardClick("checkin-card-circle", station.id); assert.deepEqual(app.controller.getModel().adjustment.frame, { x: 1, y: 0, zoom: 2 });
  await app.cardClick("checkin-card-frame-reset"); assert.deepEqual(app.controller.getModel().adjustment.frame, { x: 0.5, y: 0.5, zoom: 1 });
  app.element("#checkin-card-dialog").requestClose(); assert.ok(app.controller.getModel().canDownload);
  await app.cardClick("checkin-card-circle", station.id); assert.deepEqual(app.controller.getModel().adjustment.frame, { x: 1, y: 0, zoom: 2 });
  app.keyboard("ArrowRight", 200); app.keyboard("ArrowUp", 200); assert.equal(app.keyboard("Infinity"), 0);
  assert.deepEqual(app.controller.getModel().adjustment.frame, { x: 0, y: 1, zoom: 2 });
  app.controller.close(); app.controller.open(); await app.cardClick("checkin-card-circle", station.id);
  assert.deepEqual(app.controller.getModel().adjustment.frame, { x: 1, y: 0, zoom: 2 }); app.controller.clear(); assert.equal(app.live.size, 0);
});
for (const action of ["cancel", "close", "clear", "replace", "delete", "loading", "error", "undo", "time"]) {
  test(`位置預覽解碼期間 ${action} 釋放遲到圖片，不恢復調整視窗或套用過期相片`, async () => {
    const app = harness(), station = REQUIRED_CHECK_IN_LOCATIONS[0], photo = { attractionId: station.id, photoId: "late", writeId: "saved", blob: new Blob([pngBytes(480, 160)], { type: "image/png" }) };
    app.setPhotos([photo]); await app.ready(); await app.cardClick("checkin-card-circle", station.id);
    let release, closed = 0; globalThis.createImageBitmap = () => new Promise(resolve => { release = resolve; });
    const pending = app.cardClick("checkin-card-photo", "late"); while (!release) await new Promise(resolve => setImmediate(resolve));
    if (action === "cancel") app.element("#checkin-card-dialog").requestClose();
    if (action === "close") app.controller.close();
    if (action === "clear") app.controller.clear();
    if (action === "replace") app.setPhotos([{ ...photo, writeId: "replacement" }]);
    if (action === "delete") app.setPhotos([]);
    if (action === "loading" || action === "error") app.setReadState(action);
    if (action === "time") { const next = complete(); next.records[0].checkedInAt = "2026-11-05T05:00:00.000Z"; app.setCompletion(next); }
    if (action === "undo") app.setCompletion({ ...complete(), ready: false });
    app.controller.reconcile(); release({ width: 480, height: 160, close() { closed++; } }); await pending;
    assert.equal(closed, 1); assert.equal(app.controller.getModel().adjustment, null); await app.cardClick("checkin-card-frame-apply"); assert.equal(app.calls.at(-1).photos.length, 0);
  });
}
test("已解碼調整圖片取消、更換、套用及清除各釋放一次，解碼失敗不能套用且取消保留原卡", async () => {
  const app = harness(), station = REQUIRED_CHECK_IN_LOCATIONS[0], good = { attractionId: station.id, photoId: "good", writeId: "saved", blob: new Blob([pngBytes(480, 160)], { type: "image/png" }) };
  app.setPhotos([good, { ...good, photoId: "bad", blob: new Blob(["bad"], { type: "image/png" }) }]); await app.ready(); let closed = 0;
  globalThis.createImageBitmap = async () => ({ width: 480, height: 160, close() { closed++; } });
  await app.cardClick("checkin-card-circle", station.id); await app.cardClick("checkin-card-photo", "good"); await app.cardClick("checkin-card-frame-apply"); assert.equal(closed, 1);
  await app.cardClick("checkin-card-circle", station.id); await app.cardClick("checkin-card-frame-change"); assert.equal(closed, 2);
  await app.cardClick("checkin-card-photo", "bad"); assert.match(app.controller.getModel().adjustment.message, /未能讀取/); assert.equal(app.controller.getModel().adjustment.ready, false);
  const calls = app.calls.length; await app.cardClick("checkin-card-frame-apply"); assert.equal(app.calls.length, calls);
  app.element("#checkin-card-dialog").requestClose(); assert.ok(app.controller.getModel().canDownload); assert.equal(app.calls.at(-1).photos[0].photoId, "good");
  await app.cardClick("checkin-card-circle", station.id); app.controller.close(); assert.equal(closed, 3);
  app.controller.open(); await app.cardClick("checkin-card-circle", station.id); app.controller.clear(); assert.equal(closed, 4);
});

test("無照片也能製卡，身份必填且 model 唯讀無 Blob；關閉保留草稿但不能下載", async () => {
  const app = harness(); assert.ok(app.controller.open()); assert.equal(app.controller.getModel().canPreview, false);
  assert.equal(app.controller.getModel().status, "");
  assert.doesNotMatch(renderCheckInCard(app.controller.getModel()), /五站打卡完成紀錄：|填妥姓名、班別及學號後，預覽紀錄卡/);
  Object.keys(identity).forEach(key => app.fill(key)); await app.controller.preview();
  const model = app.controller.getModel(); assert.ok(Object.isFrozen(model.identity)); assert.ok(model.canDownload);
  const html = renderCheckInCard(model);
  assert.doesNotMatch(html, /請核對學生資料、五站時間及核實狀態。|請核對學生資料及五站紀錄。/);
  assert.match(html, /按圓圈可選擇本站相片及調整位置；不選相片也可下載。/);
  assert.equal((html.match(/data-checkin-card-circle=/g) || []).length, REQUIRED_CHECK_IN_LOCATIONS.length);
  assert.equal(model.status, "預覽已完成，可按圓圈選相片。");
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
    if (action === "time") { const next = complete(); next.records[0].checkedInAt = "2026-11-05T05:00:00.000Z"; app.setCompletion(next); }
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
  const app = appHarness({ initialState: checkedState(REQUIRED_CHECK_IN_LOCATIONS.map(item => item.id)), hash: "#memories/checkins" });
  app.photoService.getAllPhotoRecords = async () => { throw Error("合成讀取失敗"); }; await app.controller.start();
  const memories = app.element("#app").innerHTML; assert.equal((memories.match(/data-memory-checkin-card-open/g) || []).length, 1);
  assert.ok(app.controller.getPageSnapshot().checkInCardAvailable);
  assert.equal(app.controller.getPageSnapshot().photoCount, null);
  assert.equal(app.controller.getPageSnapshot().readState, "error");
  assert.match(memories, /data-memory-checkin-card-open/);
  await app.click("memory-checkin-card-open", ""); assert.ok(app.element("#checkin-card-dialog").open);
  app.navigate("#itinerary"); assert.equal(app.element("#checkin-card-dialog").open, false);
  for (const hash of ["#itinerary", "#attraction/future-school"]) {
    app.navigate(hash); const html = app.element("#app").innerHTML;
    assert.match(html, /到『旅途回憶』製作五站打卡紀錄卡/); assert.doesNotMatch(html, /data-memory-checkin-card-open/);
  }
  const incomplete = appHarness({ initialState: checkedState(REQUIRED_CHECK_IN_LOCATIONS.slice(1).map(item => item.id)), hash: "#memories/checkins" }); await incomplete.controller.start();
  assert.equal(incomplete.controller.getPageSnapshot().checkInCardAvailable, false); assert.doesNotMatch(incomplete.element("#app").innerHTML, /data-memory-checkin-card-open/);
  await incomplete.click("memory-checkin-card-open", ""); assert.equal(incomplete.element("#checkin-card-dialog").open, false);
});
