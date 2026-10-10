import { ensureSummary, selectSummaryPhoto } from "../helpers/memory-controls.js";
import { createAppController } from "../../src/controller.js";
import { createPhotoRepository, compressPhoto, createPhotoExport, createTravelCard, createTripAIKit } from "../../src/photos.js";
import { createDefaultState, STORAGE_KEY } from "../../src/state.js";
import { CHECK_IN_LOCATIONS } from "../../src/data.js";
import { createFeedback } from "../../src/feedback.js";

if (document.readyState === "loading") await new Promise(resolve => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
const preview = new URLSearchParams(location.search).get("preview");
const offlinePreview = preview === "offline" || preview === "offline-five";
const databaseName = offlinePreview ? "outdoorLearningDay.photos" : `trip-summary-fixture-${crypto.randomUUID()}`;
const repository = createPhotoRepository({ databaseName });
const values = new Map();
const storage = offlinePreview ? localStorage : {
  getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)
};
const assert = (condition, message) => { if (!condition) throw Error(message); };
assert(!storage.getItem(STORAGE_KEY) && !(await repository.getAllPhotoRecords()).length, "離線預覽只可在空白本機 origin 使用，不能覆蓋既有資料。");
const ids = CHECK_IN_LOCATIONS.map(item => item.id);
const state = createDefaultState();
ids.forEach((id, index) => { if (index === 0 && (!preview || preview === "five" || preview === "offline-five")) return;
  state.checkIns[id] = { attractionId: id, checkedInAt: "2026-11-05T04:00:00.000Z",
  method: index === 0 ? "gps" : "manual", verified: index === 0 }; });
storage.setItem(STORAGE_KEY, JSON.stringify(state));
const colors = ["#b44a43", "#d49727", "#419d8b", "#667bb5", "#9c66a6", "#356253"];
const dimensions = [[1200, 900], [600, 1200], [900, 900], [1200, 600], [800, 1200], [1200, 900]];
async function makeRecord(index, suffix = "a") {
  const canvas = document.createElement("canvas"); [canvas.width, canvas.height] = dimensions[index];
  const context = canvas.getContext("2d"); context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = colors[index]; context.fillRect(18, 18, canvas.width - 36, canvas.height - 36);
  context.fillStyle = "#ffffff"; context.font = "bold 30px sans-serif"; context.fillText(`SYNTHETIC PHOTO ${index + 1}`, 40, canvas.height - 60);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  return { ...await compressPhoto(blob, ids[index]), photoId: `${ids[index]}-${suffix}`, writeId: `${ids[index]}-${suffix}` };
}
async function add(index, suffix = "a") { await repository.savePhotoRecord(await makeRecord(index, suffix)); }
if (preview) {
  for (let index = preview === "five" || preview === "offline-five" ? 1 : 0; index < (preview === "missing" ? 2 : 6); index++) await add(index);
  if (!["missing", "five", "offline-five"].includes(preview)) await add(0, "b");
}
let readFailure = false, readDelay = null, generationOverride = null;
let generated = [], downloads = [], confirmationMessages = [];
const photoService = { ...repository, compressPhoto, createPhotoExport, createTravelCard,
  getAllPhotoRecords: async () => { if (readFailure) throw Error("Fixture read failure"); if (readDelay) await readDelay; return repository.getAllPhotoRecords(); },
  createTripAIKit: async options => {
    const blob = await (generationOverride || createTripAIKit)(options);
    generated.push({ options, blob }); return blob;
  }
};
const feedback = createFeedback({ document, window, requestAnimationFrame });
const feedbackService = { ...feedback, askConfirmation: options => { confirmationMessages.push(options.message); return feedback.askConfirmation(options); } };
const urlBlobs = new Map();
class FixtureURL extends URL {
  static createObjectURL(blob) { const url = URL.createObjectURL(blob); urlBlobs.set(url, blob); return url; }
  static revokeObjectURL(url) { urlBlobs.delete(url); URL.revokeObjectURL(url); }
}
const fixtureNavigator = { onLine: true, userAgent: "Android fixture", ...(offlinePreview ? { serviceWorker: navigator.serviceWorker } : {}) };
const pushClientFactory = () => ({ getSnapshot: () => ({ statusMessage: "本機測試", canEnable: false, canDisable: false }), initialize: async () => {}, refresh: async () => {} });
location.hash = "#memories";
const controller = createAppController({ environment: { document, window, location, localStorage: storage, URL: FixtureURL,
  requestAnimationFrame, indexedDB, navigator: fixtureNavigator }, photoService, pushClientFactory, feedbackService });
const nativeClick = HTMLAnchorElement.prototype.click;
if (!preview) HTMLAnchorElement.prototype.click = function () {
  if (this.download) downloads.push({ name: this.download, blob: urlBlobs.get(this.href) }); else nativeClick.call(this);
};
const pause = () => new Promise(resolve => setTimeout(resolve, 15));
async function until(condition) {
  const deadline = Date.now() + 15000;
  while (!condition()) { if (Date.now() > deadline) throw Error("等待操作逾時"); await pause(); }
}
async function navigate(hash) { location.hash = hash; controller.render(); await pause(); }
function click(selector) { const target = document.querySelector(selector); assert(target, `缺少 ${selector}`); target.click(); }
function select(index, suffix = "a") { selectSummaryPhoto(ids[index], `${ids[index]}-${suffix}`); }
const selectAll = () => ids.forEach((_id, index) => select(index));
function fill() { ensureSummary(); }
const snapshot = () => controller.getPageSnapshot().summaryCard;
const confirmDialog = document.querySelector("#confirm-dialog");
async function beginDownload(accept = true) {
  click("[data-summary-download]"); await until(() => confirmDialog.open);
  if (accept) click("#confirm-button"); else click('#confirm-dialog [value="cancel"]');
}
async function archiveEntries(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer), entries = [];
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true), length = view.getUint16(offset + 26, true), extra = view.getUint16(offset + 28, true);
    const start = offset + 30 + length + extra;
    entries.push({ name: new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + length)), bytes: bytes.slice(start, start + size) });
    offset = start + size;
  }
  return entries;
}
let passed = 0, failed = 0;
async function check(label, action) {
  const item = document.createElement("li");
  try { await action(); passed++; item.textContent = `通過：${label}`; }
  catch (error) { failed++; item.textContent = `失敗：${label} — ${error.message}`; }
  document.querySelector("#test-results").append(item);
}
await controller.start();
if (preview) {
  document.querySelector("#test-runner").hidden = true;
  if (preview === "card" || preview === "five") {
    ids.forEach((_id, index) => { if (preview !== "five" || index > 0) select(index); }); fill("studentName", "合成測試同學"); fill("className", "測試班"); fill("studentNumber", "07");
    const stations = await Promise.all(CHECK_IN_LOCATIONS.filter(attraction => state.checkIns[attraction.id]).map(async attraction => ({ attraction,
      photoRecord: await repository.getPhotoRecord(attraction.id, `${attraction.id}-a`), checkIn: state.checkIns[attraction.id] })));
    const blob = await createTripAIKit({ stations, studentName: "合成測試同學", className: "測試班", studentNumber: "07", tripTitle: "戶外學習日 · 合成測試", dateLabel: "2026年11月5日至7日" });
    const output = document.createElement("section"); output.className = "memory-empty";
    const heading = document.createElement("h2"); heading.textContent = "AI 融合圖片素材包（合成測試資料）";
    const link = document.createElement("a"); link.id = "fixture-card-download"; link.href = URL.createObjectURL(blob);
    link.download = blob.name; link.className = "button button-secondary"; link.textContent = "下載素材包";
    output.append(heading, link); document.querySelector("#app").prepend(output);
  }
} else {
  await check("學校未打卡，五景點已打卡但零相片，只要求五站補拍", async () => {
    assert(snapshot().photoStationCount === 0 && snapshot().stations.length === 6, "製作區被空頁隱藏");
    assert(document.querySelector(".summary-warning").textContent.includes("仍欠 5 個景點"), "缺少補拍總提示");
    ensureSummary();
    assert([...document.querySelectorAll("#memory-content .summary-missing a")].filter(link => link.textContent.includes("返回景點補拍")).length === 5 && document.querySelector("[data-summary-download]").disabled, "補拍入口或停用錯誤");
    assert(!document.querySelector("#summary-requirements").textContent.includes("佛教黃鳳翎中學"), "學校仍是必需");
  });
  await check("已有相片未選取與缺照不同，圖片可解碼", async () => {
    await add(1); await controller.start();
    assert(snapshot().photoStationCount === 1 && snapshot().selectedCount === 0, "計數錯誤");
    assert(document.querySelector(".summary-warning").textContent.includes("仍欠 4 個景點"), "缺照数錯誤");
    assert(document.querySelector("#summary-requirements").textContent.includes("東莞松山湖未來學校：請選取一張相片"), "誤提示已拍站補拍");
    for (const image of document.querySelectorAll(".summary-photo-option img")) { image.loading = "eager"; await image.decode(); assert(image.naturalWidth > 0, "預覽不可解碼"); }
  });
  await check("補拍入口可返回正確景點，離頁清除選取及姓名草稿", async () => {
    select(1); fill("studentName", "測試草稿");
    click(`.summary-missing a[href="#attraction/${ids[2]}"]`); await until(() => document.querySelector(`[data-native-camera-open="${ids[2]}"]`));
    assert(controller.currentRoute().attractionId === ids[2], "補拍入口去了另一景點");
    await navigate("#memories"); assert(snapshot().selectedCount === 0 && !snapshot().studentName, "離頁草稿殘留");
  });
  await check("學校未打卡、沒有相片，五張已可下載並按五景點順序輸出", async () => {
    for (let index = 2; index < 6; index++) await add(index); await controller.start();
    for (let index = 1; index < 6; index++) select(index);
    fill("studentName", "合成測試同學"); fill("className", "測試班"); fill("studentNumber", "07");
    assert(snapshot().selectedCount === 5 && snapshot().requiredSelectedCount === 5 && !document.querySelector("[data-summary-download]").disabled, "五張仍停用");
    await beginDownload(); await until(() => downloads.length === 1);
    assert(generated[0].options.stations.map(item => item.attraction.id).join() === ids.slice(1).join(), "五景點順序錯誤");
    assert(confirmationMessages.at(-1).includes("包含 5 張相片"), "確認仍寫六張");
    const entries = await archiveEntries(downloads[0].blob);
    assert(entries.length === 6 && entries.slice(0, 5).every(entry => entry.name.endsWith(".jpg")), "五張素材或指令缺失");
    for (const entry of entries.slice(0, 5)) { const bitmap = await createImageBitmap(new Blob([entry.bytes], { type: "image/jpeg" })); assert(bitmap.width > 0, "JPEG 不可解碼"); bitmap.close(); }
    assert(!JSON.parse(storage.getItem(STORAGE_KEY)).checkIns[ids[0]], "自動建立了學校打卡");
    generated = []; downloads = [];
  });
  await check("學校已有相片仍不自動加入，選填第六張可撤回，普通下載勾選分開", async () => {
    await navigate(`#attraction/${ids[0]}`); click(`[data-checkin="${ids[0]}"]`); await until(() => confirmDialog.open); click("#confirm-button");
    await until(() => controller.getPageSnapshot().checkIn);
    await add(0); await add(0, "b"); await navigate("#memories"); await controller.start();
    for (let index = 1; index < 6; index++) select(index);
    fill("studentName", "合成測試同學"); fill("className", "測試班"); fill("studentNumber", "07");
    assert(snapshot().selectedCount === 5 && !document.querySelector("[data-summary-download]").disabled, "學校已有照片被強制加入");
    select(0); click("[data-memory-summary-omit]"); assert(snapshot().selectedCount === 5 && snapshot().canDownload, "不能撤回學校相片");
    select(0, "b");
    assert(snapshot().selectedCount === 6 && snapshot().stations[0].selectedPhotoId.endsWith("-b"), "同站擇一失敗");
    assert(snapshot().selectedCount === 6 && !document.querySelector("[data-summary-download]").disabled, "下載仍停用");
    assert(!document.querySelector(".summary-warning") && ![...document.querySelectorAll("[data-photo-select]")].some(item => item.checked), "錯誤缺照或影響匯出勾選");
  });
  await check("素材包沒有身份欄位，成品署名入口獨立於選圖", async () => {
    assert(!document.querySelector("[data-summary-field]"),"素材包仍要求身份");
    assert(!("studentName" in snapshot()),"model 仍有身份");
  });  await check("原生確認取消保留草稿，姓名班別不寫進兩種儲存", async () => {
    fill("studentName", "合成測試同學"); fill("className", "測試班"); fill("studentNumber", "07");
    await beginDownload(false); await until(() => !snapshot().busy);
    assert(!downloads.length && snapshot().selectedCount === 6, "取消後遺失草稿");
    assert(!storage.getItem(STORAGE_KEY).includes("合成測試同學"), "姓名寫入進度");
    assert(!(await repository.getAllPhotoRecords()).some(record => JSON.stringify(record).includes("合成測試同學")), "姓名寫入相片");
  });
  await check("六張 ZIP 包含完整 JPEG 及無身份中文指令", async () => {
    select(0); await beginDownload(); await until(() => downloads.length === 1);
    assert(downloads[0].name === "AI融合圖片素材包-6張.zip" && downloads[0].blob.type === "application/zip", "檔名或格式錯誤");
    const entries = await archiveEntries(downloads[0].blob);
    assert(entries.length === 7 && entries[0].name.includes("佛教黃鳳翎中學"), "六站數量或次序錯誤");
    const instruction = new TextDecoder().decode(entries.at(-1).bytes);
    assert(!instruction.includes("合成測試同學") && !instruction.includes("測試班") && instruction.includes("返回 App") && instruction.includes("自然過渡"), "指令或署名缺失");
    assert(confirmationMessages.at(-1).includes("不含身份資料"), "缺少個資確認");
    for (const [index, entry] of entries.slice(0, 6).entries()) {
      const bitmap = await createImageBitmap(new Blob([entry.bytes], { type: "image/jpeg" }));
      assert(bitmap.width === dimensions[index][0] && bitmap.height === dimensions[index][1], "相片被裁切或放大"); bitmap.close();
    }
  });
  await check("無身份也可重新下載，ZIP 不接收身份", async () => {
    assert(snapshot().canDownload,"無身份不能下載"); await beginDownload(); await until(()=>downloads.length===2);
    assert(!storage.getItem(STORAGE_KEY).includes("合成測試同學"),"個資寫入儲存");
  });  await check("一張圖片無法解碼，整組不下載，草稿仍可重試", async () => {
    generationOverride = options => createTripAIKit({ ...options, stations: options.stations.map((item, index) => index === 3
      ? { ...item, photoRecord: { ...item.photoRecord, blob: new Blob(["not a raster"], { type: "image/webp" }) } } : item) });
    await beginDownload(); await until(() => !snapshot().busy);
    assert(downloads.length === 2 && snapshot().selectedCount === 6, "失敗仍下載或清空選取"); generationOverride = null;
  });
  await check("確認期間離頁，晚回覆不能下載", async () => {
    click("[data-summary-download]"); await until(() => confirmDialog.open); await navigate("#itinerary");
    assert(!confirmDialog.open && downloads.length === 2, "過期确认仍有效");
    await navigate("#memories"); selectAll(); fill("studentName", "合成測試同學"); fill("className", "測試班"); fill("studentNumber", "07");
  });
  await check("生成期間離頁，回到本頁可做新卡，舊回覆不能下載", async () => {
    let release; generationOverride = options => new Promise(resolve => { release = async () => resolve(await createTripAIKit({ ...options, isRelevant: () => true })); });
    await beginDownload(); await until(() => release); await navigate("#itinerary"); await navigate("#memories");
    generationOverride = null; selectAll(); fill("studentName", "合成測試同學"); fill("className", "測試班"); fill("studentNumber", "07"); await beginDownload(); await until(() => downloads.length === 3);
    await release(); await pause(); assert(downloads.length === 3, "舊生成亦被下載");
  });
  await check("相片替換使舊選取失效，重新選取後可繼續", async () => {
    const record = await repository.getPhotoRecord(ids[2], `${ids[2]}-a`);
    await repository.savePhotoRecord({ ...record, writeId: "fixture-replacement" }); await controller.start();
    assert(snapshot().selectedCount === 5 && document.querySelector("[data-summary-download]").disabled, "替換仍沿用舊選取"); select(2);
  });
  await check("讀取中及失敗顯示獨立狀態，不能誤報缺照，重試恢復", async () => {
    let release; readDelay = new Promise(resolve => { release = resolve; }); const reading = controller.start();
    assert(snapshot().readState === "loading" && !document.querySelector(".summary-warning"), "讀取中誤報缺照"); release(); await reading; readDelay = null;
    readFailure = true; await controller.start();
    assert(snapshot().readState === "error" && !document.querySelector(".summary-warning"), "讀取失敗誤報缺照");
    readFailure = false; click("[data-photos-retry]"); await until(() => snapshot().readState === "ready");
    assert(snapshot().photoStationCount === 5, "重試未恢復");
  });
  HTMLAnchorElement.prototype.click = nativeClick;
  await repository.clearPhotoRecords(); indexedDB.deleteDatabase(databaseName);
  document.querySelector("#test-summary").textContent = `${passed} 通過，${failed} 失敗`;
  document.querySelector("#test-summary").dataset.done = "true";
  document.querySelector("#test-summary").dataset.failed = String(failed);
}
