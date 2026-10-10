import { createRehearsalController, REHEARSAL_STORAGE_KEY, REHEARSAL_PHOTO_DATABASE, REHEARSAL_WORKBOOK_DATABASE } from "../../src/device-rehearsal.js";
import * as photos from "../../src/photos.js";
import { createWorkbookRepository } from "../../src/workbook-storage.js";
import { CHECK_IN_LOCATIONS, REQUIRED_CHECK_IN_LOCATIONS } from "../../src/data.js";
import { STORAGE_KEY, createDefaultState } from "../../src/state.js";
import { DEVICE_TEST_DATABASE, DEVICE_TEST_STORAGE_KEY } from "../../src/device-test-data.js";
import { openMemoryPhoto, selectSummaryPhoto, closeMemory } from "../helpers/memory-controls.js";
import { getAppShellCache } from "../helpers/offline-cache.js";

// This fixture is deliberately not published. All input is synthetic, and it
// refuses an origin with existing data before creating its own sentinels.
const assert = (value, message) => { if (!value) throw Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(condition) { const end = Date.now() + 20000; while (!condition()) { if (Date.now() > end) throw Error("等待條件逾時"); await pause(); } }
const click = selector => { const control = document.querySelector(selector); assert(control && !control.disabled, `控制項無效：${selector}`); control.click(); };
const input = (selector, value) => { const control = document.querySelector(selector); assert(control, selector); control.value = value; control.dispatchEvent(new InputEvent("input", { bubbles: true })); };
const realPhotos = photos.createPhotoRepository();
const oldPhotos = photos.createPhotoRepository({ databaseName: DEVICE_TEST_DATABASE });
const testPhotos = photos.createPhotoRepository({ databaseName: REHEARSAL_PHOTO_DATABASE });
const realWorkbook = createWorkbookRepository();
const testWorkbook = createWorkbookRepository({ databaseName: REHEARSAL_WORKBOOK_DATABASE });
const pendingGPS = [], streams = [], timers = [], downloads = [], live = new Map();
let controller, nativeGPS = 0, cameraCalls = 0, nativeCameraCalls = 0, failDelete = false, passed = 0;
let realState, oldState, realDraft, sentinelPhoto;
const sentinel = "rehearsal-integration-synthetic";
class FixtureURL extends URL {
  static createObjectURL(blob) { const url = URL.createObjectURL(blob); live.set(url, blob); return url; }
  static revokeObjectURL(url) { live.delete(url); URL.revokeObjectURL(url); }
}
const nativeClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function () { if (this.download) downloads.push({ name: this.download, blob: live.get(this.href) }); else nativeClick.call(this); };
document.getElementById("native-camera-input").click = () => { nativeCameraCalls++; };
function canvas(width = 640, height = 480) {
  const item = document.createElement("canvas"); item.width = width; item.height = height;
  const context = item.getContext("2d"); context.fillStyle = "#2f7a68"; context.fillRect(0, 0, width, height);
  context.fillStyle = "#fff"; context.font = "32px sans-serif"; context.fillText("SYNTHETIC REHEARSAL", 24, 90); return item;
}
const syntheticFile = async () => { const blob = await new Promise(resolve => canvas().toBlob(resolve, "image/jpeg", .92)); return new File([blob], "synthetic.jpg", { type: blob.type }); };
async function navigate(route) {
  closeMemory(); location.hash = route; await pause(); controller.render();
  await until(() => document.body.dataset.view === controller.currentRoute().view && (route.startsWith("#attraction/") ? document.querySelector("[data-checkin], [data-checkin-undo]")?.dataset[controller.getPageSnapshot().checkIn ? "checkinUndo" : "checkin"] === route.split("/")[1] : true));
}
async function confirm(accepted = true) {
  await until(() => document.getElementById("confirm-dialog").open);
  assert(document.getElementById("confirm-title").textContent.startsWith("測試預演："), "確認沒有測試標示");
  click(accepted ? "#confirm-button" : '#confirm-dialog [value="cancel"]'); await pause();
}
async function fix(id, scenario = "within") {
  await navigate(`#attraction/${id}`); controller.setScenario(scenario); click(`[data-checkin="${id}"]`);
  assert(pendingGPS.length === 1, "並非一次性定位"); pendingGPS.shift()(); await pause();
}
async function addPhoto(id) {
  click(`[data-native-camera-open="${id}"]`);
  const transfer = new DataTransfer(); transfer.items.add(await syntheticFile());
  const control = document.getElementById("native-camera-input"); control.files = transfer.files; control.dispatchEvent(new Event("change", { bubbles: true }));
  await until(() => controller.getPageSnapshot().photos.length > 0); await pause();
}
async function check(label, action) {
  const item = document.createElement("li");
  try { await action(); passed++; item.textContent = `通過：${label}`; }
  catch (error) { item.textContent = `失敗：${label} — ${error.message}`; throw error; }
  finally { document.getElementById("test-results").append(item); }
}
function zipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), entries = []; let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    assert(view.getUint16(offset + 8, true) === 0, "非預期 ZIP 壓縮方式");
    const size = view.getUint32(offset + 18, true), nameLength = view.getUint16(offset + 26, true), extraLength = view.getUint16(offset + 28, true);
    const start = offset + 30 + nameLength + extraLength;
    entries.push({ name: new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + nameLength)), bytes: bytes.slice(start, start + size) }); offset = start + size;
  }
  return entries;
}
document.getElementById("run-rehearsal").addEventListener("click", async event => {
  event.target.disabled = true;
  try {
    assert(![STORAGE_KEY, DEVICE_TEST_STORAGE_KEY, REHEARSAL_STORAGE_KEY].some(key => localStorage.getItem(key)), "已有旅程資料；只可在空白測試 origin 執行");
    for (const repository of [realPhotos, oldPhotos, testPhotos]) assert(!(await repository.getAllPhotoRecords()).length, "已有相片，停止測試");
    assert((await realWorkbook.read()).revision === 0 && (await testWorkbook.read()).revision === 0, "已有手冊草稿，停止測試");
    const state = createDefaultState(); state.checkIns['departure-school'] = { attractionId: 'departure-school', checkedInAt: '2026-11-05T04:00:00Z', method: 'manual', verified: false };
    realState = JSON.stringify(state); oldState = JSON.stringify({ fixture: sentinel }); localStorage.setItem(STORAGE_KEY, realState); localStorage.setItem(DEVICE_TEST_STORAGE_KEY, oldState);
    const record = await photos.compressPhoto(await syntheticFile(), 'departure-school'); record.photoId = record.writeId = sentinel;
    await realPhotos.savePhotoRecord(record); sentinelPhoto = true;
    const draft = (await realWorkbook.read()).draft; draft.answers['essay-title'] = sentinel; realDraft = await realWorkbook.write(draft, 0);
    const fakeNavigator = { onLine: true, serviceWorker: navigator.serviceWorker,
      geolocation: { getCurrentPosition() { nativeGPS++; throw Error("不應呼叫真實 GPS"); } },
      mediaDevices: { async getUserMedia(options) {
        cameraCalls++; assert(options.audio === false, "要求了音訊"); const frame = canvas(), stream = frame.captureStream(10); streams.push(stream);
        let tick = 0; timers.push(setInterval(() => { const context = frame.getContext('2d'); context.fillStyle = tick++ % 2 ? '#f2b85b' : '#2f7a68'; context.fillRect(0, 200, 640, 100); }, 50)); return stream;
      } }
    };
    controller = createRehearsalController({ environment: { document, window, navigator: fakeNavigator, location, localStorage, URL: FixtureURL, indexedDB, crypto, isSecureContext, requestAnimationFrame, matchMedia: matchMedia.bind(window) },
      schedule: callback => pendingGPS.push(callback), photoService: { ...photos, ...testPhotos,
        deletePhotoRecord: (...args) => failDelete ? Promise.reject(Error("合成刪除失敗")) : testPhotos.deletePhotoRecord(...args) } });
    await check("六站正式內容、四項導航、獨立資料，載入不要求定位或相機", async () => {
      await navigate('#itinerary'); await controller.start();
      assert(document.querySelectorAll('.bottom-nav a').length === 4 && document.querySelectorAll('#app a[href^="#attraction/"]').length >= 6, "缺少正式景點或導航");
      assert(!controller.getPageSnapshot().allCheckInsComplete && nativeGPS === 0 && cameraCalls === 0, "讀取正式進度或要求了權限");
      assert(!document.querySelector('[data-push-enable]'), "可以訂閱正式通知");
      await navigate('#attraction/future-school'); assert(!document.querySelector('[data-camera-open]'), "未打卡已解鎖相機");
    });
    await check("距離太遠拒絕打卡且沒有手動繞過，定位情況切換可重試", async () => {
      await fix('future-school', 'too-far'); assert(!controller.getPageSnapshot().checkIn && !document.getElementById('confirm-dialog').open, "範圍外仍可打卡");
      assert(!document.querySelector('[data-checkin]').disabled, "失敗後未恢復按鈕");
    });
    await check("低精確度、拒絕及逾時均需確認未核實，取消不保存", async () => {
      for (const scenario of ['inaccurate', 'denied', 'timeout']) {
        await fix('future-school', scenario); await confirm(false); assert(!controller.getPageSnapshot().checkIn, "取消仍新增紀錄");
      }
      await fix('future-school', 'denied'); await confirm(); await until(()=>controller.getPageSnapshot().checkIn); assert(controller.getPageSnapshot().checkIn?.verified === false, "手動記錄假稱核實");
      assert(document.getElementById('app').textContent.includes('測試手動記錄'), "沒有測試標示");
      click('[data-checkin-undo]'); await confirm(); await until(() => !controller.getPageSnapshot().checkIn);
    });
    await check("範圍內模擬定位通過、重複打卡保護，不保存原始座標", async () => {
      await fix('future-school'); assert(controller.getPageSnapshot().checkIn?.verified, "未完成");
      assert(document.getElementById('app').textContent.includes('模擬定位通過') && !document.getElementById('app').textContent.includes('GPS 已核實'), "誤稱到訪核實");
      assert(!document.querySelector('[data-checkin]'), "可以重複打卡");
      const saved = JSON.parse(localStorage.getItem(REHEARSAL_STORAGE_KEY)); assert(!JSON.stringify(saved).match(/latitude|longitude|accuracy|coords/), "保存了原始位置");
    });
    await check("正式相機拍攝、Canvas壓縮及手機相機入口累積照片，關閉停止串流", async () => {
      click('[data-camera-open]'); await until(() => document.getElementById('camera-loading').hidden && document.getElementById('camera-video').videoWidth > 0);
      click('[data-camera-capture]'); await until(() => !document.getElementById('camera-preview').hidden); click('[data-camera-save]');
      await until(() => controller.getPageSnapshot().photos.length === 1); assert(streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')), "保存後串流未停");
      await addPhoto('future-school'); await until(() => controller.getPageSnapshot().photos.length === 2);
      const entries = await testPhotos.getAllPhotoRecords(); assert(entries.length === 2 && entries.every(item => item.blob.type === 'image/webp' && item.width === 640 && item.height === 480), "未使用正式重繪或覆蓋了舊相片");
      assert(nativeCameraCalls === 1, "手機相機入口不符");
      click('[data-camera-open]'); await until(() => document.getElementById('camera-loading').hidden); document.getElementById('camera-dialog').requestClose();
      await until(() => streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')));
    });
    await check("取消打卡確認、取消及刪照失敗保留，成功移除本站照片", async () => {
      click('[data-checkin-undo]'); await confirm(false); assert((await testPhotos.getAllPhotoRecords()).length === 2, "取消確認仍刪照");
      failDelete = true; click('[data-checkin-undo]'); await confirm(); await until(() => document.getElementById('toast').textContent.includes('未能刪除'));
      assert(controller.getPageSnapshot().checkIn && (await testPhotos.getAllPhotoRecords()).length === 2, "失敗遺失資料");
      failDelete = false; click('[data-checkin-undo]'); await confirm(); await until(() => !controller.getPageSnapshot().checkIn); assert(!(await testPhotos.getAllPhotoRecords()).length, "本站相片未刪");
    });
    await check("離頁及更改定位情況使延遲回覆失效，回頁可重新打卡", async () => {
      controller.setScenario('within'); click('[data-checkin]'); const stale = pendingGPS.shift(); await navigate('#itinerary'); stale(); await pause();
      await navigate('#attraction/future-school'); assert(!controller.getPageSnapshot().checkIn, "離頁回覆仍打卡");
      click('[data-checkin]'); const changed = pendingGPS.shift(); controller.setScenario('too-far'); changed(); await pause(); assert(!controller.getPageSnapshot().checkIn, "變更情況後仍保存舊定位");
    });
    await check("五個必需景點完成即顯示測試完成；學校選填，零相片仍有補拍入口", async () => {
      for (const place of REQUIRED_CHECK_IN_LOCATIONS) { await fix(place.id); assert(controller.getPageSnapshot().checkIn, `${place.id} 未完成`); }
      await navigate('#itinerary'); assert(controller.getPageSnapshot().allCheckInsComplete && document.querySelector('.checkin-completion').textContent.includes('所有測試打卡'), "完成規則不符");
      assert(!JSON.parse(localStorage.getItem(REHEARSAL_STORAGE_KEY)).checkIns['departure-school'], "學校被自動打卡");
      await navigate('#memories'); assert(document.querySelectorAll('[data-memory-album]').length === 0 && document.querySelectorAll('.summary-missing a').length === 5, "零相片時沒有補拍指引");
    });
    await check("旅途回憶單張測試旅程卡，以及五／六張真正AI素材ZIP，明確標示測試", async () => {
      for (const place of CHECK_IN_LOCATIONS) { if (place.id === 'departure-school') await fix(place.id); else await navigate(`#attraction/${place.id}`); await addPhoto(place.id); }
      await navigate('#memories'); assert(document.querySelectorAll('[data-memory-album]').length === 6, "六站相簿不符");
      const records = await testPhotos.getAllPhotoRecords(); const first = records.find(item => item.attractionId === 'future-school');
      openMemoryPhoto('future-school', first.photoId, true); const count = downloads.length; click('[data-card-download]'); await confirm(); await until(() => downloads.length > count);
      const bitmap = await createImageBitmap(downloads.at(-1).blob); assert(bitmap.width === 1080 && bitmap.height === 1350, "PNG 尺寸錯誤"); bitmap.close();
      closeMemory();
      for (const place of REQUIRED_CHECK_IN_LOCATIONS) selectSummaryPhoto(place.id, records.find(item => item.attractionId === place.id).photoId);
      for (const size of [5, 6]) {
        if (size === 6) selectSummaryPhoto('departure-school', records.find(item => item.attractionId === 'departure-school').photoId);
        const before = downloads.length; click('[data-summary-download]'); await confirm(); await until(() => downloads.length > before);
        const file = downloads.at(-1), entries = zipEntries(new Uint8Array(await file.blob.arrayBuffer()));
        assert(entries.filter(item => item.name.endsWith('.jpg')).length === size && entries.length === size + 1, "ZIP 相片數不符");
        const text = new TextDecoder().decode(entries.find(item => item.name.endsWith('.txt')).bytes);
        assert(text.includes('測試用素材') && text.includes('不要假稱到訪正式景點') && !text.includes('合成學生') && text.includes('返回 App'), "指令未標示測試或仍含身份");
        assert(!file.name.includes('合成學生') && !localStorage.getItem(REHEARSAL_STORAGE_KEY).includes('合成學生'), "身份進入儲存／檔名");
      }
    });
    await check("AI 成品署名共用正式流程，輸出測試標示及保留前置零", async () => {
      closeMemory(); click('[data-memory-artwork-open]');
      const transfer=new DataTransfer(); transfer.items.add(await syntheticFile()); const field=document.getElementById('artwork-file');field.files=transfer.files;field.dispatchEvent(new Event('change',{bubbles:true}));
      await until(()=>!document.getElementById('artwork-status').textContent.includes('正在讀取'));
      for(const [key,value] of Object.entries({studentName:'合成學生',className:'測試班',studentNumber:'007'})) input('[data-artwork-field="'+key+'"]',value);
      assert(document.getElementById('ai-artwork-dialog').textContent.includes('完整行程預演 · 模擬紀錄'), '沒有測試標示');
      click('[data-artwork-preview]'); await until(()=>document.querySelector('.artwork-result img'));
      assert(document.getElementById('artwork-studentNumber').value==='007','前置零遺失');
      const before=downloads.length;click('[data-artwork-download]');await confirm();await until(()=>downloads.length>before);
      assert(downloads.at(-1).name.startsWith('測試-')&&!downloads.at(-1).name.includes('合成學生'),'檔名沒有測試或含身份');
      const bitmap=await createImageBitmap(downloads.at(-1).blob);assert(bitmap.width===1080&&bitmap.height>1080*480/640,'署名 PNG 無效');bitmap.close();click('[data-artwork-close]');
    });
    await check("五站打卡紀錄卡共用正式流程，印測試標示，身份不進入儲存", async () => {
      click('[data-memory-checkin-card-open]');
      for (const [key, value] of Object.entries({ studentName: '合成學生', className: '測試班', studentNumber: '007' })) input('[data-checkin-card-field="' + key + '"]', value);
      const text = document.getElementById('checkin-card-dialog').textContent;
      assert(text.includes('五站測試打卡完成') && !text.includes('GPS 已核實'), '測試紀錄假稱正式核實');
      click('[data-checkin-card-preview]'); await until(() => document.querySelector('#checkin-card-dialog .artwork-preview'));
      const before = downloads.length; click('[data-checkin-card-download]'); await confirm(); await until(() => downloads.length > before);
      const file = downloads.at(-1), bitmap = await createImageBitmap(file.blob);
      assert(file.name.startsWith('測試-') && !file.name.includes('合成學生') && bitmap.width === 1080 && bitmap.height > 1800, '五站測試卡或檔名錯誤');
      assert(!localStorage.getItem(REHEARSAL_STORAGE_KEY).includes('合成學生') && document.getElementById('checkin-card-studentNumber').value === '007', '身份儲存或前置零丟失');
      bitmap.close(); click('[data-checkin-card-close]');
    });
    await check("手冊使用獨立草稿庫，PDF帶測試標示，身份不進入草稿", async () => {
      await navigate('#workbook/essay'); input('#wb-essay-title', '預演合成文章'); await until(() => controller.getPageSnapshot().status === 'saved');
      assert((await testWorkbook.read()).draft.answers['essay-title'] === '預演合成文章', "草稿未保存");
      click('[data-workbook-export-open]'); input('[data-workbook-identity="studentName"]', '合成學生'); input('[data-workbook-identity="className"]', '測試班'); input('[data-workbook-identity="studentNumber"]', '007');
      const before = downloads.length; click('[data-workbook-pdf]'); await confirm(); await until(() => downloads.length > before);
      assert((await downloads.at(-1).blob.slice(0, 5).text()) === '%PDF-' && !JSON.stringify(await testWorkbook.read()).includes('合成學生'), "PDF 或草稿身份不符");
    });
    await check("清除需兩次確認，只清預演資料，正式及舊診斷哨兵保持不變", async () => {
      await navigate('#home'); click('[data-reset-all]'); await confirm(false); assert(localStorage.getItem(REHEARSAL_STORAGE_KEY), "取消仍清除");
      click('[data-reset-all]'); await confirm(); await until(() => document.getElementById('confirm-dialog').open && document.getElementById('confirm-title').textContent.includes('最後確認')); await confirm();
      await until(() => !localStorage.getItem(REHEARSAL_STORAGE_KEY)); assert(!(await testPhotos.getAllPhotoRecords()).length && (await testWorkbook.read()).draft.answers['essay-title'] === '', "預演未全部清除");
      assert(localStorage.getItem(STORAGE_KEY) === realState && localStorage.getItem(DEVICE_TEST_STORAGE_KEY) === oldState, "正式／舊診斷進度被改動");
      assert((await realPhotos.getAllPhotoRecords())[0].writeId === sentinel && JSON.stringify(await realWorkbook.read()) === JSON.stringify(realDraft), "正式相片／手冊被改動");
      assert(nativeGPS === 0, "呼叫了真實 GPS");
    });
    await check("離線白名單包含預演控制器及測試頁，正式首頁沒有被取代", async () => {
      await navigator.serviceWorker.ready; const cache = await getAppShellCache(); const base = new URL('../../', import.meta.url);
      assert((await (await cache.match(new URL('device-test.html', base))).text()).includes('正式流程預演'), "缺少預演 shell");
      assert(await cache.match(new URL('src/device-rehearsal.js', base)), "缺少預演模組");
      assert((await (await cache.match(new URL('index.html', base))).text()).includes('戶外學習日旅程助手'), "正式首頁被取代");
    });
    document.getElementById('test-summary').textContent = `全部 ${passed} 項通過。GPS 與相機來源為合成；DOM、Canvas、IndexedDB、PNG、ZIP、PDF及離線快取為真實瀏覽器功能。`;
  } catch (error) { document.getElementById('test-summary').textContent = `測試停止：${error.message}（已通過 ${passed} 項）`; }
  finally {
    timers.forEach(clearInterval); streams.forEach(stream => stream.getTracks().forEach(track => track.stop()));
    // Only remove the sentinels created by this fixture, never existing data.
    if (realState && localStorage.getItem(STORAGE_KEY) === realState) localStorage.removeItem(STORAGE_KEY);
    if (oldState && localStorage.getItem(DEVICE_TEST_STORAGE_KEY) === oldState) localStorage.removeItem(DEVICE_TEST_STORAGE_KEY);
    if (sentinelPhoto && (await realPhotos.getAllPhotoRecords()).every(record => record.writeId === sentinel)) await realPhotos.deletePhotoRecord('departure-school');
    // Keep the formal workbook sentinel: clearing would leave a versioned tombstone.
    // This named synthetic origin is never reused for ordinary user data.
  }
});
