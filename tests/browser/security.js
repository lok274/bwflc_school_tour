import { compressPhoto, savePhotoRecord, getPhotoRecord, deletePhotoRecord, createTravelCard } from "../../src/photos.js";
import { ATTRACTIONS, TRIP_DATA } from "../../src/data.js";
import { appHarness } from "../helpers/browser-environment.js";

const results = document.querySelector("#results");
const summary = document.querySelector("#summary");
let passed = 0;
let failed = 0;
let photo;
const fixtureId = "security-browser-fixture";
const violations = [];
document.addEventListener("securitypolicyviolation", (event) => violations.push(event.effectiveDirective));

function require(condition, message) { if (!condition) throw new Error(message); }
async function check(label, run) {
  const item = document.createElement("li");
  try { await run(); passed += 1; item.textContent = `通過：${label}`; }
  catch (error) { failed += 1; item.textContent = `失敗：${label} — ${error.message}`; }
  results.append(item);
}
const pause = () => new Promise((resolve) => setTimeout(resolve, 50));
const canvas = document.createElement("canvas");
canvas.width = 2000;
canvas.height = 1500;
const context = canvas.getContext("2d");
context.fillStyle = "#145c62";
context.fillRect(0, 0, canvas.width, canvas.height);
const canvasBlob = (type) => new Promise((resolve) => canvas.toBlob(resolve, type));

await check("CSP 拒絕外部資料連線", async () => {
  let blocked = false;
  try { await fetch("https://example.invalid/security-fixture"); } catch { blocked = true; }
  await pause();
  require(blocked && violations.includes("connect-src"), "外部連線未被政策拒絕");
});
await check("CSP 拒絕內嵌 script 及 eval", async () => {
  const script = document.createElement("script");
  script.textContent = "globalThis.__inlineSecurityFixture = true";
  document.body.append(script);
  let evalBlocked = false;
  try { eval("1 + 1"); } catch { evalBlocked = true; }
  await pause();
  require(globalThis.__inlineSecurityFixture !== true && evalBlocked && violations.some((name) => name.startsWith("script-src")), "內嵌程式未被拒絕");
  script.remove();
});
await check("禁止表單網絡提交時，dialog 確認仍可完成", async () => {
  const dialog = document.createElement("dialog");
  const form = document.createElement("form");
  form.method = "dialog";
  const button = document.createElement("button");
  button.value = "confirm";
  button.textContent = "確認";
  form.append(button);
  dialog.append(form);
  document.body.append(dialog);
  try {
    dialog.showModal();
    form.requestSubmit(button);
    require(!dialog.open && dialog.returnValue === "confirm", "dialog 確認被政策阻擋");
  } finally { dialog.remove(); }
});
await check("PNG 及 WebP 在本機解碼並縮至 1600px", async () => {
  for (const type of ["image/png", "image/webp"]) {
    const record = await compressPhoto(await canvasBlob(type), fixtureId);
    require(record.width === 1600 && record.height === 1200, "縮放尺寸錯誤");
    require(["image/webp", "image/png"].includes(record.mime), "輸出 MIME 錯誤");
    photo = record;
  }
});
await check("JPEG 重新編碼不保留 EXIF 測試標記", async () => {
  const jpeg = await canvasBlob("image/jpeg");
  const bytes = new Uint8Array(await jpeg.arrayBuffer());
  const payload = new Uint8Array([69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...new TextEncoder().encode("PRIVATE-GPS-fixture")]);
  const length = payload.length + 2;
  const input = new Blob([bytes.slice(0, 2), new Uint8Array([0xff, 0xe1, length >> 8, length & 255]), payload, bytes.slice(2)], { type: "image/jpeg" });
  const record = await compressPhoto(input, fixtureId);
  const output = new TextDecoder().decode(await record.blob.arrayBuffer());
  require(!output.includes("Exif") && !output.includes("PRIVATE-GPS-fixture"), "原始中繼資料仍在輸出");
});
await check("偽装 SVG 及損壞 PNG 會被拒絕", async () => {
  for (const input of [new Blob(["<svg></svg>"], { type: "image/png" }), new Blob([new Uint8Array([137,80,78,71,13,10,26,10])], { type: "image/png" })]) {
    let rejected = false;
    try { await compressPhoto(input, fixtureId); } catch { rejected = true; }
    require(rejected, "非法圖片未被拒絕");
  }
});
await check("本機 Blob 相片在 CSP 下正常預覽", async () => {
  require(photo, "缺少測試照片");
  const preview = document.querySelector("#preview");
  const url = URL.createObjectURL(photo.blob);
  try {
    preview.src = url;
    await preview.decode();
    require(preview.naturalWidth === 1600, "Blob 圖片被政策阻擋");
  } finally { URL.revokeObjectURL(url); }
});
await check("IndexedDB 只保存重新編碼的 Blob，可讀回及清理測試資料", async () => {
  require(photo, "缺少測試照片");
  try {
    await savePhotoRecord(photo);
    const stored = await getPhotoRecord(fixtureId);
    require(stored.blob instanceof Blob && stored.width === 1600 && stored.mime === photo.mime, "照片未成功保存");
  } finally { await deletePhotoRecord(fixtureId); }
});
await check("旅程卡於本機產生 1080×1350 PNG", async () => {
  const blob = await createTravelCard({ photoRecord: photo, attraction: ATTRACTIONS[0], checkIn: { checkedInAt: "2026-11-05T04:00:00.000Z", verified: false }, tripTitle: TRIP_DATA.title });
  require(blob.type === "image/png", "旅程卡不是 PNG");
  const image = await createImageBitmap(blob);
  require(image.width === 1080 && image.height === 1350, "旅程卡尺寸錯誤");
  image.close();
});
await check("真正 ES Modules 能接線並顯示全部頁面，不修改實際使用者資料", async () => {
  const app = appHarness();
  await app.controller.start();
  for (const route of ["home", "itinerary", "attractions", "prepare", "info", "attraction/future-school"]) {
    app.environment.location.hash = `#${route}`;
    app.controller.render();
    require(app.element("#app").innerHTML.includes("<"), `頁面未顯示：${route}`);
    require(!app.element("#app").innerHTML.includes("undefined"), `頁面資料缺失：${route}`);
  }
  app.controller.getSnapshot().state.customItems.push({ id: "fixture", label: "<script>test</script>", done: false });
  require(app.views.renderPrepare().includes("&lt;script&gt;"), "提醒沒有跳脫");
});
await check("嚴格文件 CSP 下仍可註冊離線 Service Worker", async () => {
  const registration = await navigator.serviceWorker.register("../../sw.js", { scope: "../../" });
  await navigator.serviceWorker.ready;
  require(registration.active, "Service Worker 未啟用");
});
summary.textContent = `${passed} 項通過，${failed} 項失敗`;
summary.dataset.passed = String(passed);
summary.dataset.failed = String(failed);
