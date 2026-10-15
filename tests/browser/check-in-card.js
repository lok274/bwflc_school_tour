import { seedStudentIdentityForFixture, createFixtureIndexedDB } from "../helpers/browser-environment.js";
import { createAppController } from "../../src/controller.js";
import { createCheckInCompletionCard } from "../../src/check-in-card.js";
import { REQUIRED_CHECK_IN_LOCATIONS, TRIP_DATA } from "../../src/data.js";
import { createDefaultState, STORAGE_KEY } from "../../src/state.js";

const preview = new URL(location.href).searchParams.has("preview");
const state = createDefaultState();
for (const [index, { id }] of REQUIRED_CHECK_IN_LOCATIONS.entries()) {
  if (!preview && !index) continue;
  state.checkIns[id] = { attractionId: id, checkedInAt: `2026-11-0${index < 2 ? 5 : index < 4 ? 6 : 7}T04:00:00.000Z`, method: "gps", verified: true };
}
const data = new Map([[STORAGE_KEY, JSON.stringify(state)]]), urls = new Map(), downloads = [];
const storage = { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
seedStudentIdentityForFixture(storage);
const FixtureURL = { createObjectURL(blob) { const url = URL.createObjectURL(blob); urls.set(url, blob); return url; }, revokeObjectURL(url) { URL.revokeObjectURL(url); urls.delete(url); } };
let generated, override, readFailure = true;
location.hash = "#memories/checkins";
const controller = createAppController({
  environment: { document, window, location, localStorage: storage, URL: FixtureURL, navigator: { onLine: true,
    geolocation: { getCurrentPosition(_success, failure) { failure({ code: 1, message: "合成定位拒絕" }); } } }, requestAnimationFrame, indexedDB: createFixtureIndexedDB(indexedDB) },
  photoService: { getAllPhotoRecords: async () => { if (readFailure) throw Error("合成讀取失敗"); return []; }, deletePhotoRecord: async () => {}, clearPhotoRecords: async () => {} },
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
async function captureCardDrawing(action) {
  const prototype = CanvasRenderingContext2D.prototype, drawImage = prototype.drawImage, fillText = prototype.fillText;
  const images = [], texts = [];
  prototype.drawImage = function (image, ...position) {
    const result = drawImage.call(this, image, ...position);
    images.push({ source: image.src, position, context: this });
    return result;
  };
  prototype.fillText = function (text, ...position) {
    texts.push({ text, position, font: this.font });
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
