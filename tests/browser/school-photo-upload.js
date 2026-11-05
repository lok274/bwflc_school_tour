import { seedStudentIdentityForFixture, createFixtureIndexedDB } from "../helpers/browser-environment.js";
import { createAppController } from "../../src/controller.js";
import { createSchoolPhotoUpload, PHOTO_UPLOAD_DEADLINE } from "../../src/school-photo-upload.js";
import { createDefaultState, STORAGE_KEY } from "../../src/state.js";
import { CHECK_IN_LOCATIONS } from "../../src/data.js";
import { createPhotoExport } from "../../src/photos.js";
import { configureMemoryControls, openMemoryAlbum } from "../helpers/memory-controls.js";

if (document.readyState === "loading") await new Promise(resolve => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
const preview = new URLSearchParams(location.search).get("preview");
const values = new Map(), offsets = new Map(), calls = [];
const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
seedStudentIdentityForFixture(storage);
const id = CHECK_IN_LOCATIONS[1].id;
const state = createDefaultState();
state.checkIns[id] = { attractionId: id, method: "manual", verified: false, checkedInAt: "2026-11-05T04:00:00.000Z" };
storage.setItem(STORAGE_KEY, JSON.stringify(state));
const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 480;
const ctx = canvas.getContext("2d"); ctx.fillStyle = "#356253"; ctx.fillRect(0, 0, 640, 480);
ctx.fillStyle = "#fff"; ctx.font = "bold 32px sans-serif"; ctx.fillText("SYNTHETIC ALBUM", 70, 240);
const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg"));
const records = [1, 2, 3].map(n => ({ attractionId: id, photoId: `fixture-${n}`, writeId: `fixture-${n}`, width: 640, height: 480, blob, createdAt: `2026-11-05T04:00:0${n}.000Z` }));
let fail = true;
async function transport(method, args) {
  calls.push(method);
  await new Promise(resolve => setTimeout(resolve, 60));
  if (args[0] !== "fixture-code") throw Error("wrong code");
  if (method === "prepareUpload") return { ...args[1], fileId: "synthetic-file-0001", signature: "fake-only", expiresAt: PHOTO_UPLOAD_DEADLINE };
  const ticket = args[1];
  if (method === "uploadChunk") {
    offsets.set(ticket.uploadKey, args[2] + atob(args[3]).length);
    if (fail) { fail = false; throw Error("synthetic lost acknowledgement"); }
  }
  const offset = offsets.get(ticket.uploadKey) || 0;
  return { status: offset === ticket.size ? "saved" : "uploading", offset };
}
location.hash = "#memories";
const controller = createAppController({ environment: { document, window, location, localStorage: storage, URL,
  requestAnimationFrame, indexedDB: createFixtureIndexedDB(indexedDB), navigator: { onLine: true }, crypto },
  photoService: { getAllPhotoRecords: async () => records, createPhotoExport },
  photoUploadFactory: options => createSchoolPhotoUpload({ ...options, transport }) });
const assert = (value, message) => { if (!value) throw Error(message); };
const click = selector => { const node = document.querySelector(selector); assert(node, `Missing ${selector}`); node.click(); };
async function until(fn) { const end = Date.now() + 10000; while (!fn()) { if (Date.now() >= end) throw Error("timeout"); await new Promise(resolve => setTimeout(resolve, 15)); } }
await controller.start(); configureMemoryControls(controller);
if (preview === "album") document.querySelector("#test-runner").hidden = true;
else {
  try {
    openMemoryAlbum(id); click('[data-photo-select="fixture-2"]'); click("[data-memory-selection-confirm]");
    click("[data-memory-upload]");
    assert(document.querySelector('[value="selected"]').disabled === false, "confirmed selection unavailable");
    document.querySelector('[value="selected"]').checked = true;
    click("[data-photo-export-prepare]");
    await until(() => document.querySelector("#photo-upload-code"));
    assert(calls.length === 0, "sent before consent");
    assert(document.querySelector("#photo-export-content").textContent.includes("1 張相片"), "wrong selected count");
    assert(document.querySelector("#photo-upload-code").value === "", "code was retained");
    if (preview) document.querySelector("#test-runner").hidden = true;
    else {
      document.querySelector("#photo-upload-code").value = "fixture-code"; click("[data-photo-upload-confirm]");
      await until(() => document.querySelector("[data-photo-upload-confirm]")?.textContent.includes("重試"));
      assert(document.querySelector("#photo-upload-code").value === "", "code leaked after run");
      assert(calls.length === 3, "automatic retry happened");
      document.querySelector("#photo-upload-code").value = "fixture-code"; click("[data-photo-upload-confirm]");
      await until(() => !document.querySelector("[data-photo-upload-confirm]"));
      assert(calls[3] === "getUploadStatus" && calls.length === 4, "retry replayed saved data");
      assert(document.querySelector("#photo-export-content").textContent.includes("已儲存"), "missing receipt");
      assert(records.length === 3, "local photos changed");
      click("[data-photo-export-close]");
      click("[data-memory-upload]"); click("[data-photo-export-prepare]");
      await until(() => document.querySelector("#photo-upload-code"));
      assert(document.querySelector("#photo-export-content").textContent.includes("3 張相片"), "all scope lost photos");
      assert(calls.length === 4, "preparation sent data");
      document.querySelector("#test-results").textContent = "通過：真實相簿、確定勾選、全部相片、空白固定碼、明確確認、進度、手動核對重試；無網絡或使用者儲存。";
      document.body.dataset.testResult = "passed";
      document.querySelector("#test-summary").textContent = "模擬收相測試全部通過；沒有連線至實際收相服務。";
    }
  } catch (error) {
    document.querySelector("#test-results").textContent = "失敗：" + error.message;
    document.body.dataset.testResult = "failed";
    document.querySelector("#test-summary").textContent = "模擬收相測試失敗。";
    throw error;
  }
}
