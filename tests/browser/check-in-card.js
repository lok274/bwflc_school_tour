import { seedStudentIdentityForFixture, createFixtureIndexedDB } from "../helpers/browser-environment.js";
import { createAppController } from "../../src/controller.js";
import { createCheckInCompletionCard } from "../../src/check-in-card.js";
import { REQUIRED_CHECK_IN_LOCATIONS, TRIP_DATA } from "../../src/data.js";
import { createDefaultState, STORAGE_KEY } from "../../src/state.js";

const preview = new URL(location.href).searchParams.has("preview");
const photoPreview = new URL(location.href).searchParams.get("preview") === "photos";
const state = createDefaultState();
for (const [index, { id }] of REQUIRED_CHECK_IN_LOCATIONS.entries()) {
  if (!preview && !index) continue;
  state.checkIns[id] = { attractionId: id, checkedInAt: `2026-11-0${index < 2 ? 5 : index < 4 ? 6 : 7}T04:00:00.000Z`, method: "gps", verified: true };
}
const data = new Map([[STORAGE_KEY, JSON.stringify(state)]]), urls = new Map(), downloads = [];
const storage = { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
seedStudentIdentityForFixture(storage);
const FixtureURL = { createObjectURL(blob) { const url = URL.createObjectURL(blob); urls.set(url, blob); return url; }, revokeObjectURL(url) { URL.revokeObjectURL(url); urls.delete(url); } };
const photoColors = ["#e53935", "#1976d2", "#388e3c", "#f9a825", "#8e24aa"];
const syntheticPhotos = [];
for (const [station, { id }] of REQUIRED_CHECK_IN_LOCATIONS.entries()) {
  const canvas = document.createElement("canvas"); canvas.width = station ? 160 : 480; canvas.height = 160;
  const context = canvas.getContext("2d"); context.fillStyle = photoColors[station]; context.fillRect(0, 0, canvas.width, 160);
  if (!station) { context.fillStyle = "#1976d2"; context.fillRect(0, 0, 160, 160); context.fillStyle = "#388e3c"; context.fillRect(320, 0, 160, 160); }
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  for (let index = 0; index < (station ? 1 : 13); index++) syntheticPhotos.push(Object.freeze({ attractionId: id, photoId: `${id}-synthetic-${index}`, writeId: `saved-${index}`, blob, width: canvas.width, height: canvas.height, createdAt: `2026-11-05T04:${String(index).padStart(2, "0")}:00.000Z` }));
}
let generated, override, readFailure = !photoPreview, photoRecords = photoPreview ? syntheticPhotos : [];
location.hash = "#memories/checkins";
const controller = createAppController({
  environment: { document, window, location, localStorage: storage, URL: FixtureURL, navigator: { onLine: true,
    geolocation: { getCurrentPosition(_success, failure) { failure({ code: 1, message: "合成定位拒絕" }); } } }, requestAnimationFrame, indexedDB: createFixtureIndexedDB(indexedDB) },
  photoService: { getAllPhotoRecords: async () => { if (readFailure) throw Error("合成讀取失敗"); return photoRecords; }, deletePhotoRecord: async () => {}, clearPhotoRecords: async () => {} },
  completionCardService: async options => { const blob = await (override || createCheckInCompletionCard)(options); generated = blob; return blob; },
});
const nativeClick = HTMLAnchorElement.prototype.click;
if (!preview) HTMLAnchorElement.prototype.click = function () { if (this.download) downloads.push({ name: this.download, blob: urls.get(this.href) }); else nativeClick.call(this); };
const assert = (value, message) => { if (!value) throw Error(message); };
const click = selector => { const element = document.querySelector(selector); if (!element) throw Error("缺少 " + selector); element.click(); };
const pause = () => new Promise(resolve => setTimeout(resolve, 10));
async function until(condition) { const end = Date.now() + 20000; while (!condition()) { if (Date.now() > end) throw Error("等待逾時"); await pause(); } }
async function navigate(hash) { location.hash = hash; controller.render(); await pause(); }
function input(key, value) { const field = document.querySelector(`[data-checkin-card-field="${key}"]`); field.value = value; field.dispatchEvent(new Event("input", { bubbles: true })); return field; }
function fill() { input("studentName", "合成測試同學"); input("className", "測試班"); input("studentNumber", "007"); }
async function generate() { generated = null; click("[data-checkin-card-preview]"); await until(() => generated || document.getElementById("checkin-card-status")?.textContent.includes("未能製作")); }
async function open() { if (!document.getElementById("checkin-card-dialog").open) click("[data-memory-checkin-card-open]"); }
async function adjustmentReady() { await until(() => document.querySelector("[data-checkin-card-frame-apply]") && !document.querySelector("[data-checkin-card-frame-apply]").disabled); }
async function usePhoto(photoId) { click(`[data-checkin-card-photo="${photoId}"]`); await adjustmentReady(); generated = null; click("[data-checkin-card-frame-apply]"); await until(() => generated); }
function keyboard(key, count = 1) {
  const canvas = document.getElementById("checkin-photo-adjust-canvas"); canvas.focus();
  for (let index = 0; index < count; index++) canvas.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}
async function captureCardDrawing(action, width = 1080) {
  const prototype = CanvasRenderingContext2D.prototype, drawImage = prototype.drawImage, fillText = prototype.fillText;
  const images = [], texts = [];
  prototype.drawImage = function (image, ...position) {
    const result = drawImage.call(this, image, ...position);
    if (this.canvas.width === width) images.push({ source: image.src, position, context: this });
    return result;
  };
  prototype.fillText = function (text, ...position) {
    if (this.canvas.width === 1080) texts.push({ text, position, font: this.font });
    return fillText.call(this, text, ...position);
  };
  try { await action(); return { images, texts }; }
  finally { prototype.drawImage = drawImage; prototype.fillText = fillText; }
}
let passed = 0, failed = 0;
async function check(label, action) { const item = document.createElement("li"); try { await action(); passed++; item.textContent = "通過：" + label; } catch (error) { failed++; item.textContent = "失敗：" + label + " — " + error.message; } document.getElementById("test-results").append(item); }
await controller.start();
if (preview) {
  document.getElementById("test-runner").hidden = true; await open(); fill(); await generate();
} else {
  await check("未完成五站沒有入口，補齊手動打卡後才顯示；學校不必打卡", async () => {
    assert(!document.querySelector("[data-memory-checkin-card-open]"), "未完成也有入口");
    await navigate("#attraction/future-school"); click('[data-checkin="future-school"]');
    await until(() => document.getElementById("confirm-dialog").open); click("#confirm-button");
    await until(() => controller.getPageSnapshot().checkIn); await navigate("#memories/checkins");
    assert(document.querySelector("[data-memory-checkin-card-open]") && controller.getPageSnapshot().checkInProgress.filled === 5 && controller.getPageSnapshot().checkInProgress.total === 5, "五站未解鎖或要求學校");
  });
  await check("唯一製卡入口在回憶，行程及詳情只有文字提示；相片讀取失敗可製卡", async () => {
    for (const hash of ["#itinerary", "#attraction/future-school"]) {
      await navigate(hash); assert(document.getElementById("app").textContent.includes("到『旅途回憶』製作五站打卡紀錄卡"), "缺少文字指引");
      assert(!document.querySelector("[data-memory-checkin-card-open]"), "多出製卡入口");
    }
    await navigate("#memories/checkins"); await open(); assert(document.getElementById("checkin-card-dialog").open, "读取失敗阻擋製卡");
    assert(!document.getElementById("checkin-card-dialog").textContent.includes("五站打卡完成紀錄："), "已移除的完成紀錄說明仍顯示");
    assert(controller.getPageSnapshot().checkInProgress.stations.some(station => station.checkIn?.method === "manual" && !station.checkIn.verified), "未核實手動紀錄遺失");
  });
  await check("身份必填，中文與學號前置零保留；實際 PNG 為 1080px 並含五張卡", async () => {
    assert(document.getElementById("checkin-card-studentNumber").value === "001", "未帶入登入資料");
    input("studentName", ""); assert(document.querySelector("[data-checkin-card-preview]").disabled, "空身份可製卡"); fill();
    const NativeImage = window.Image;
    let drawing;
    window.Image = class { constructor() { throw Error("紀錄卡不應載入圖片"); } };
    try { drawing = await captureCardDrawing(generate); }
    finally { window.Image = NativeImage; }
    const bitmap = await createImageBitmap(generated); assert(bitmap.width === 1080 && bitmap.height > 1800, "PNG 尺寸錯誤"); bitmap.close();
    const image = document.querySelector("#checkin-card-dialog .artwork-preview"); await image.decode(); assert(image.naturalWidth === 1080, "預覽不是完整圖片");
    const title = drawing.texts.filter(item => item.font.startsWith("44px "));
    assert(title.map(item => item.text).join("") === "旅程雖然告一段落，探索不會停步。把這次的發現與勇氣，帶進下一段成長旅程！", "鼓勵句不完整");
    assert(title.length > 1 && title.every(item => item.position[0] === 48), "鼓勵句沒有換行或仍預留圖片空間");
    const output = drawing.texts.map(item => item.text).join("");
    for (const text of [TRIP_DATA.title, TRIP_DATA.dateLabel, "合成測試同學", "測試班", "007", ...REQUIRED_CHECK_IN_LOCATIONS.map(item => item.name)]) assert(output.includes(text), "紀錄卡缺少 " + text);
    assert(drawing.texts.filter(item => item.text === "GPS 已核實").length === 4 && drawing.texts.filter(item => item.text === "未核實手動記錄").length === 1, "五站核實狀態有變");
    assert(drawing.images.length === 0, "紀錄卡仍繪製已移除的圖片");
  });
  await check("中文組字不重畫，40字長姓名換行；超限保留文字但停用，不支援字元指出位置", async () => {
    const field = input("studentName", ""); field.focus(); field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    field.value = "名".repeat(40); field.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true })); controller.render();
    assert(field.isConnected && field.value.length === 40, "組字被重畫"); field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })); await generate();
    const bitmap = await createImageBitmap(generated); assert(bitmap.height > 2100, "長文字沒有換行加高"); bitmap.close();
    input("studentName", "名".repeat(41)); assert(document.querySelector("[data-checkin-card-preview]").disabled && !document.querySelector("#checkin-card-dialog .artwork-preview"), "超限或修改後未失效");
    input("studentName", "合成🙂"); await generate(); assert(document.getElementById("checkin-card-status").textContent.includes("姓名") && !generated, "缺字仍輸出"); fill(); await generate();
  });
  await check("放大圓圈與實際 PNG 對齊，只選本站已保存相片；分頁、取消及鍵盤焦點保留", async () => {
    readFailure = false; photoRecords = syntheticPhotos; await controller.start(); await generate();
    const id = REQUIRED_CHECK_IN_LOCATIONS[0].id, circleSelector = `[data-checkin-card-circle="${id}"]`;
    const image = document.querySelector("#checkin-card-dialog .artwork-preview"); await image.decode();
    const button = document.querySelector(circleSelector), target = button.getBoundingClientRect(), imageBox = image.getBoundingClientRect();
    assert(button instanceof HTMLButtonElement && Math.abs(target.width - imageBox.width * 280 / 1080) < 1, "圓圈不是原生按鈕或未隨 PNG 縮放");
    assert(Math.abs(target.left - imageBox.left - imageBox.width * 60 / 1080) < 1, "圓圈點選範圍未對齊圖片");
    button.focus(); click(circleSelector); assert(document.querySelectorAll("[data-checkin-card-photo]").length === 12 && urls.size === 12, "沒有只建立目前 12 張縮圖");
    controller.render(); assert([...document.querySelectorAll("[data-checkin-card-photo] img")].every(img => urls.has(img.src)), "主畫面重畫使選圖網址失效");
    click('[data-checkin-card-photo-page="1"]'); assert(document.querySelectorAll("[data-checkin-card-photo]").length === 1 && urls.size === 1, "換頁未釋放縮圖");
    generated = null;
    const drawing = await captureCardDrawing(async () => { await usePhoto(`${id}-synthetic-0`); });
    assert(drawing.images.length === 1 && urls.size === 1, "選圖未畫入 PNG 或仍留縮圖網址");
    assert(document.activeElement.id === `checkin-card-circle-${id}`, "選圖後焦點沒有返回圓圈");
    const bitmap = await createImageBitmap(generated), canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext("2d"); context.drawImage(bitmap, 0, 0); bitmap.close();
    const position = drawing.images[0].position, pixels = context.getImageData(position.at(-4) + 140, position.at(-3) + 140, 1, 1).data;
    assert(pixels[0] === 229 && pixels[1] === 57 && pixels[2] === 53, "所選本站相片沒有成為圓圈像素");
    const card = generated; click(circleSelector); document.getElementById("checkin-card-dialog").requestClose();
    assert(document.getElementById("checkin-card-dialog").open && !document.querySelector("[data-checkin-card-photo]") && generated === card, "取消選圖改動紀錄卡或關閉整個視窗");
    assert(document.activeElement.id === `checkin-card-circle-${id}` && document.querySelector(circleSelector).getAttribute("aria-label").includes("調整"), "取消沒有保留選圖及焦點");
    click(`[data-checkin-card-circle="${REQUIRED_CHECK_IN_LOCATIONS[1].id}"]`);
    assert(document.querySelectorAll("[data-checkin-card-photo]").length === 1 && document.querySelector("[data-checkin-card-photo]").dataset.checkinCardPhoto.startsWith(REQUIRED_CHECK_IN_LOCATIONS[1].id), "混入另一站相片");
    click("[data-checkin-card-picker-cancel]"); click(circleSelector); await adjustmentReady();
    assert(!document.querySelector('[data-checkin-card-photo-clear], .checkin-photo-controls, #checkin-card-dialog input[type="range"], #checkin-card-dialog output'), "調整仍有已刪除控制項");
    click("[data-checkin-card-frame-change]"); assert(!document.querySelector("[data-checkin-card-photo-clear]"), "選圖仍有完成標記操作");
    await usePhoto(`${id}-synthetic-12`);
  });
  await check("相片可拖動及放大，圓圈鍵盤操作保留焦點，取消／重設／再次開啟保留已套用位置，編輯與 PNG 像素相同", async () => {
    const station = REQUIRED_CHECK_IN_LOCATIONS[0], circle = `[data-checkin-card-circle="${station.id}"]`;
    click(circle); await adjustmentReady();
    const canvas = document.getElementById("checkin-photo-adjust-canvas"), before = generated, context = canvas.getContext("2d"), drawImage = context.drawImage;
    let crop;
    context.drawImage = function (...args) { crop = args.slice(1, 5); return drawImage.apply(this, args); };
    try {
      keyboard("ArrowLeft", 50); assert(document.activeElement === canvas && canvas.tabIndex === 0 && canvas.getAttribute("aria-describedby").includes("checkin-photo-keyboard-hint"), "圓圈未能保留鍵盤焦點或缺少操作提示");
      controller.render(); assert(document.getElementById("checkin-photo-adjust-canvas") === canvas, "主畫面更新替換拖動中的 canvas");
      assert(canvas.getContext("2d").getImageData(300, 300, 1, 1).data[1] === 142, "編輯預覽沒有移到右方綠色區");
      click("[data-checkin-card-frame-reset]"); assert(crop.join() === "160,0,160,160", "重設未回到置中");
      const captured = []; canvas.setPointerCapture = id => captured.push(id); canvas.releasePointerCapture = id => captured.push(-id);
      canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse", pointerId: 71, isPrimary: true, button: 0, clientX: 200, clientY: 100 }));
      canvas.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse", pointerId: 72, clientX: 0, clientY: 0 }));
      assert(crop.join() === "160,0,160,160", "其他手指改動裁切");
      canvas.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse", pointerId: 71, clientX: -1000, clientY: 100 }));
      assert(crop[0] === 320, "拖動未限制在右邊界");
      canvas.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerType: "mouse", pointerId: 71 })); assert(captured.join(",") === "71,-71", "取消拖動未釋放捕捉");
      keyboard("+", 20); keyboard("ArrowDown", 50);
    } finally { context.drawImage = drawImage; }
    click("[data-checkin-card-picker-cancel]");
    assert(generated === before, "取消裁切改動已確定卡片");
    const cancelled = await captureCardDrawing(async () => { click(circle); await adjustmentReady(); }, 600);
    assert(cancelled.images.at(-1).position.slice(0, 4).join() === "160,0,160,160", "取消仍保存未套用裁切");
    keyboard("ArrowLeft", 50); keyboard("+", 20); const editorPixel = [...document.getElementById("checkin-photo-adjust-canvas").getContext("2d").getImageData(300, 300, 1, 1).data];
    const drawing = await captureCardDrawing(async () => { generated = null; click("[data-checkin-card-frame-apply]"); await until(() => generated); });
    const bitmap = await createImageBitmap(generated), output = document.createElement("canvas"); output.width = bitmap.width; output.height = bitmap.height;
    const outputContext = output.getContext("2d"); outputContext.drawImage(bitmap, 0, 0); bitmap.close();
    const position = drawing.images[0].position, resultPixel = [...outputContext.getImageData(position.at(-4) + 140, position.at(-3) + 140, 1, 1).data];
    assert(editorPixel.join(",") === resultPixel.join(",") && resultPixel[1] === 142, "輸出 PNG 裁切與編輯預覽不符");
    const reopened = await captureCardDrawing(async () => { click(circle); await adjustmentReady(); }, 600);
    assert(reopened.images.at(-1).position.slice(0, 4).join() === "400,40,80,80", "再次開啟遺失已套用位置");
    click("[data-checkin-card-picker-cancel]");
  });
  await check("合成雙指事件可縮放及平移，手指數目切換及取消不跳動，套用的 PNG 保留相同取景", async () => {
    const circle = `[data-checkin-card-circle="${REQUIRED_CHECK_IN_LOCATIONS[0].id}"]`;
    click(circle); await adjustmentReady();
    const canvas = document.getElementById("checkin-photo-adjust-canvas"), context = canvas.getContext("2d"), rect = canvas.getBoundingClientRect(), captures = new Set();
    assert(getComputedStyle(canvas).touchAction === "none", "圓形預覽未攔截瀏覽器觸控手勢");
    canvas.setPointerCapture = id => captures.add(id); canvas.releasePointerCapture = id => captures.delete(id);
    const pointer = (type, id, x, y) => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: "touch", pointerId: id, isPrimary: id === 1, button: 0, clientX: rect.left + x * rect.width, clientY: rect.top + y * rect.height }));
    let crop, draws = 0;
    const drawImage = context.drawImage;
    context.drawImage = function (...args) { crop = args.slice(1, 5); draws++; return drawImage.apply(this, args); };
    const near = (actual, expected, message) => assert(Math.abs(actual - expected) < 1e-7, message);
    let editorPixel, editorCrop;
    try {
      click("[data-checkin-card-frame-reset]"); keyboard("+", 10);
      const anchor = [crop[0] + 0.45 * crop[2], crop[1] + 0.3 * crop[3]];
      pointer("pointerdown", 1, 0.25, 0.3); pointer("pointerdown", 2, 0.65, 0.3);
      const before = [...crop]; pointer("pointermove", 1, 0.25, 0.3); assert(crop.join() === before.join(), "加入第二指後零移動改變裁切");
      const count = draws; pointer("pointermove", 1, 0.2, 0.3); pointer("pointermove", 2, 0.7, 0.3);
      assert(draws - count === 2 && captures.size === 2, "每次手勢不是一次重繪或沒有捕捉兩指");
      near(crop[2], 160 / 1.875, "雙指張開沒有按距離放大");
      near(crop[0] + 0.45 * crop[2], anchor[0], "偏心縮放移動橫向焦點"); near(crop[1] + 0.3 * crop[3], anchor[1], "偏心縮放移動縱向焦點");
      pointer("pointermove", 1, 0.25, 0.325); pointer("pointermove", 2, 0.75, 0.325);
      near(crop[0] + 0.5 * crop[2], anchor[0], "雙指移動中點未橫向平移"); near(crop[1] + 0.325 * crop[3], anchor[1], "雙指移動中點未縱向平移");
      pointer("pointerdown", 3, 0.8, 0.5); const pair = [...crop]; pointer("pointermove", 3, 0.9, 0.8);
      assert(captures.size === 2 && crop.join() === pair.join(), "第三指介入取景");
      pointer("pointerup", 2, 0.75, 0.325); pointer("pointermove", 1, 0.25, 0.325); assert(crop.join() === pair.join(), "返回單指後零移動改變裁切");
      pointer("pointermove", 1, 0.28, 0.325); assert(crop[0] < pair[0] && crop[2] === pair[2], "剩餘單指不能拖動");
      pointer("pointerdown", 2, 0.75, 0.325); pointer("pointermove", 2, 2, 0.325); near(crop[2], 160 / 3, "放大超出三倍");
      pointer("pointermove", 2, 1.9, 0.325); assert(crop[2] > 160 / 3, "到達放大上限後反向沒有立即縮小");
      keyboard("-"); assert(captures.size === 0, "鍵盤未中止雙指手勢");
      pointer("pointerdown", 1, 0.5, 0.5); pointer("pointerdown", 2, 0.5, 0.5); pointer("pointermove", 2, 0.501, 0.5);
      assert(crop.every(Number.isFinite), "重疊手指造成無效裁切");
      pointer("lostpointercapture", 1, 0.5, 0.5); pointer("pointercancel", 2, 0.501, 0.5); assert(captures.size === 0, "取消或失去捕捉遺留手勢");
      click("[data-checkin-card-frame-reset]"); keyboard("+", 10); pointer("pointerdown", 1, 0.3, 0.5); pointer("pointerdown", 2, 0.7, 0.5); pointer("pointermove", 2, 0.8, 0.5);
      editorCrop = [...crop]; editorPixel = [...context.getImageData(300, 300, 1, 1).data];
    } finally { context.drawImage = drawImage; }
    const drawing = await captureCardDrawing(async () => { generated = null; click("[data-checkin-card-frame-apply]"); await until(() => generated); });
    assert(captures.size === 0, "套用未釋放全部手指"); drawing.images[0].position.slice(0, 4).forEach((value, index) => near(value, editorCrop[index], "PNG 未使用手勢調整的裁切"));
    const bitmap = await createImageBitmap(generated), output = document.createElement("canvas"); output.width = bitmap.width; output.height = bitmap.height;
    const outputContext = output.getContext("2d"); outputContext.drawImage(bitmap, 0, 0); bitmap.close();
    const position = drawing.images[0].position, pixel = [...outputContext.getImageData(position.at(-4) + 140, position.at(-3) + 140, 1, 1).data];
    assert(pixel.join() === editorPixel.join(), "PNG 與手勢預覽像素不同");
  });
  await check("損壞相片不能套用，取消保留原卡；PNG 生成失敗可重新選圖，保留其他站相片", async () => {
    const [station, other] = REQUIRED_CHECK_IN_LOCATIONS, badId = `${station.id}-malformed`;
    photoRecords = [...syntheticPhotos, { ...syntheticPhotos[0], photoId: badId, writeId: "malformed", createdAt: "2026-11-05T05:00:00.000Z", blob: new Blob(["not a photo"], { type: "image/png" }) }];
    await controller.start(); await generate(); click(`[data-checkin-card-circle="${other.id}"]`); await usePhoto(`${other.id}-synthetic-0`);
    const card = generated; click(`[data-checkin-card-circle="${station.id}"]`); await adjustmentReady(); click("[data-checkin-card-frame-change]"); click(`[data-checkin-card-photo="${badId}"]`);
    await until(() => document.getElementById("checkin-photo-adjust-status")?.textContent.includes("未能讀取"));
    assert(document.querySelector("[data-checkin-card-frame-apply]").disabled && generated === card, "損壞相片可套用或改動原卡");
    document.getElementById("checkin-card-dialog").requestClose(); assert(document.querySelector("[data-checkin-card-download]") && !document.querySelector("[data-checkin-card-download]").disabled && generated === card, "取消解碼失敗未返回原卡");
    click(`[data-checkin-card-circle="${station.id}"]`); await adjustmentReady();
    override = () => { throw Error("合成 PNG 生成失敗"); }; generated = null; click("[data-checkin-card-frame-apply]");
    await until(() => document.getElementById("checkin-card-status")?.textContent.includes("未能製作")); override = null;
    assert(!generated && !document.querySelector("#checkin-card-dialog .artwork-preview") && document.querySelector("[data-checkin-card-download]").disabled, "PNG 失敗仍可下載舊卡");
    const recovery = document.querySelector(`[data-checkin-card-circle="${station.id}"]`);
    assert(recovery instanceof HTMLButtonElement && recovery.textContent.includes("重新選擇"), "沒有原生重新選圖按鈕");
    click("[data-checkin-card-close]"); await open(); click(`[data-checkin-card-circle="${station.id}"]`); await adjustmentReady();
    const drawing = await captureCardDrawing(async () => {
      click("[data-checkin-card-frame-change]"); await usePhoto(`${station.id}-synthetic-12`);
    });
    await document.querySelector("#checkin-card-dialog .artwork-preview").decode();
    assert(drawing.images.length === 2 && !document.querySelector("[data-checkin-card-download]").disabled, "未重新生成實際預覽或其他站相片丟失");
  });
  await check("下載確認暫時收起視窗；取消保留草稿，下載檔名不含身份", async () => {
    click("[data-checkin-card-download]"); await until(() => document.getElementById("confirm-dialog").open);
    assert(!document.getElementById("checkin-card-dialog").open, "多層視窗重疊"); click('#confirm-dialog [value="cancel"]');
    await until(() => document.getElementById("checkin-card-dialog").open); assert(document.getElementById("checkin-card-studentNumber").value === "007", "取消丟草稿");
    click("[data-checkin-card-download]"); await until(() => document.getElementById("confirm-dialog").open); click("#confirm-button"); await until(() => downloads.length === 1);
    assert(downloads[0].blob.type === "image/png" && !/合成測試同學|測試班|007/.test(downloads[0].name), "身份洩漏到檔名");
  });
  await check("關閉保留身份及釋放網址，Escape 和按鈕焦點還原；草稿不寫入儲存", async () => {
    click("[data-checkin-card-close]"); assert(document.activeElement.id === "memory-checkin-card-open", "焦點未還原");
    assert(urls.size === 1, "預覽網址未釋放"); await open(); assert(document.getElementById("checkin-card-studentNumber").value === "007", "關閉丟草稿");
    document.getElementById("checkin-card-dialog").requestClose(); assert(!document.getElementById("checkin-card-dialog").open, "Escape 未關閉");
    assert(!JSON.stringify([...data]).includes("合成測試同學"), "身份寫入儲存"); await open();
  });
  await check("生成與字型錯誤保留草稿，修正後可重試", async () => {
    override = async () => { throw Error("本機字型載入失敗"); }; await generate();
    assert(document.getElementById("checkin-card-status").textContent.includes("字型載入失敗") && document.getElementById("checkin-card-studentNumber").value === "007", "錯誤丟草稿");
    override = null; await generate(); assert(generated, "不能重試");
  });
  await check("生成途中關閉、離頁及清除不恢復過期結果；離頁清空身份", async () => {
    let release;
    override = () => new Promise(resolve => { release = resolve; }); generated = null; click("[data-checkin-card-preview]"); await until(() => release);
    click("[data-checkin-card-close]"); release(new Blob(["old"], { type: "image/png" })); await pause(); await open();
    assert(!document.querySelector("#checkin-card-dialog .artwork-preview"), "關閉恢復舊卡");
    release = null; click("[data-checkin-card-preview]"); await until(() => release); await navigate("#home"); release(new Blob(["old"], { type: "image/png" }));
    await pause(); await navigate("#memories/checkins"); await open(); assert(document.getElementById("checkin-card-studentName").value === "合成登入學生" && !document.querySelector("#checkin-card-dialog .artwork-preview"), "新草稿未帶入登入資料或殘留舊預覽"); override = null;
  });
  await check("取消必需景點後入口失效，五站卡不能繼續下載", async () => {
    click("[data-checkin-card-close]"); await navigate("#attraction/future-school"); click('[data-checkin-undo="future-school"]');
    await until(() => document.getElementById("confirm-dialog").open); click("#confirm-button"); await until(() => !controller.getPageSnapshot().checkIn);
    await navigate("#memories/checkins"); assert(!document.querySelector("[data-memory-checkin-card-open]"), "取消打卡仍可製卡");
  });
  readFailure = false;
  document.getElementById("test-summary").textContent = `全部 ${passed} 項通過，${failed} 項失敗。只使用合成身份及五站本機記憶體紀錄。`;
  document.getElementById("test-summary").dataset.done = "true"; document.getElementById("test-summary").dataset.failed = String(failed);
  HTMLAnchorElement.prototype.click = nativeClick;
}
