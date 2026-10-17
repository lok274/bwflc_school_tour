import { createRehearsalController, REHEARSAL_STORAGE_KEY, REHEARSAL_PHOTO_DATABASE, REHEARSAL_IDENTITY_KEY, REHEARSAL_INSTALL_KEY, REHEARSAL_SYNC_DATABASE } from "../../src/device-rehearsal.js";
import * as photos from "../../src/photos.js";
import { CHECK_IN_LOCATIONS, REQUIRED_CHECK_IN_LOCATIONS } from "../../src/data.js";
import { STORAGE_KEY, createDefaultState } from "../../src/state.js";
import { DEVICE_TEST_DATABASE, DEVICE_TEST_STORAGE_KEY } from "../../src/device-test-data.js";
import { configureMemoryControls, openMemoryPhoto, closeMemory } from "../helpers/memory-controls.js";
import { loginStudentForFixture, FIXTURE_IDENTITY } from "../helpers/browser-environment.js";
import { STUDENT_IDENTITY_STORAGE_KEY } from "../../src/student-identity.js";
import { createSyncRepository, SYNC_DATABASE_NAME } from "../../src/check-in-sync.js";
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
const realDraftDatabase = "outdoorLearningDay.workbook.v1";
const testDraftDatabase = "outdoorLearningDay.rehearsal.workbook.v1";
// Raw legacy sentinels exercise cleanup/isolation without the removed editor.
async function legacyDraft(name, value) {
  const write = arguments.length > 1;
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () => reject(Error("無法開啟測試草稿庫"));
  });
  return new Promise((resolve, reject) => {
    const tx = db.transaction("drafts", write ? "readwrite" : "readonly");
    const request = write ? tx.objectStore("drafts").put(value, "bwflc-2026-11-05") : tx.objectStore("drafts").get("bwflc-2026-11-05");
    let result;
    request.onsuccess = () => { result = write ? value : request.result; };
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(Error("測試草稿交易失敗")); };
  });
}
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
  await until(() => document.body.dataset.view === controller.currentRoute().view && (route.startsWith("#attraction/") ? document.querySelector('[data-stop-id="' + route.split("/")[1] + '"] .checkin-panel, [data-stop-id="' + route.split("/")[1] + '"] .checked-in-panel')?.checkVisibility() : true));
}
async function confirm(accepted = true) {
  await until(() => document.getElementById("confirm-dialog").open);
  assert(document.getElementById("confirm-title").textContent.startsWith("測試預演："), "確認沒有測試標示");
  click(accepted ? "#confirm-button" : '#confirm-dialog [value="cancel"]'); await pause();
}
async function fix(id, scenario = "within") {
  await navigate(`#attraction/${id}`); controller.setScenario(scenario); click(`[data-checkin="${id}"]`);
  assert(pendingGPS.length === 1, "並非一次性定位"); pendingGPS.shift()(); await pause();
  if (controller.getPageSnapshot().checkIn) {
    assert(!document.querySelector('#app a[href="#memories"]'), "景點仍有旅途回憶按鈕");
    assert(!document.querySelector('[data-stop-id="' + id + '"] .photo-panel').textContent.includes('查看及下載相片，請按底部的「旅途回憶」。'), "仍有已刪除的底部入口提示");
  }
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
document.getElementById("run-rehearsal").addEventListener("click", async event => {
  event.target.disabled = true;
  try {
    assert(![STORAGE_KEY, DEVICE_TEST_STORAGE_KEY, REHEARSAL_STORAGE_KEY, STUDENT_IDENTITY_STORAGE_KEY, REHEARSAL_IDENTITY_KEY, REHEARSAL_INSTALL_KEY].some(key => localStorage.getItem(key)), "已有旅程資料；只可在空白測試 origin 執行");
    for (const name of [SYNC_DATABASE_NAME, REHEARSAL_SYNC_DATABASE]) assert(!(await createSyncRepository(indexedDB, name).read()), "已有同步資料；只可在空白測試 origin 執行");
    for (const repository of [realPhotos, oldPhotos, testPhotos]) assert(!(await repository.getAllPhotoRecords()).length, "已有相片，停止測試");
    assert(!await legacyDraft(realDraftDatabase) && !await legacyDraft(testDraftDatabase), "已有舊版草稿，停止測試");
    const state = createDefaultState(); state.checkIns['departure-school'] = { attractionId: 'departure-school', checkedInAt: '2026-11-05T04:00:00Z', method: 'manual', verified: false };
    realState = JSON.stringify(state); oldState = JSON.stringify({ fixture: sentinel }); localStorage.setItem(STORAGE_KEY, realState); localStorage.setItem(DEVICE_TEST_STORAGE_KEY, oldState);
    const record = await photos.compressPhoto(await syntheticFile(), 'departure-school'); record.photoId = record.writeId = sentinel;
    await realPhotos.savePhotoRecord(record); sentinelPhoto = true;
    realDraft = await legacyDraft(realDraftDatabase, { marker: sentinel, revision: 1, draft: { answers: { "essay-title": sentinel } } });
    await legacyDraft(testDraftDatabase, { marker: sentinel + "-test", revision: 1, draft: { answers: { "essay-title": "預演舊稿" } } });
    const fakeNavigator = { onLine: true, serviceWorker: navigator.serviceWorker,
      geolocation: { getCurrentPosition() { nativeGPS++; throw Error("不應呼叫真實 GPS"); } },
      mediaDevices: { async getUserMedia(options) {
        cameraCalls++; assert(options.audio === false, "要求了音訊"); const frame = canvas(), stream = frame.captureStream(10); streams.push(stream);
        let tick = 0; timers.push(setInterval(() => { const context = frame.getContext('2d'); context.fillStyle = tick++ % 2 ? '#f2b85b' : '#2f7a68'; context.fillRect(0, 200, 640, 100); }, 50)); return stream;
      } }
    };
    controller = createRehearsalController({ environment: { document, window, Math: { random: () => 0 }, navigator: fakeNavigator, location, localStorage, URL: FixtureURL, indexedDB, crypto, isSecureContext, requestAnimationFrame, matchMedia: matchMedia.bind(window) },
      schedule: callback => pendingGPS.push(callback), photoService: { ...photos, ...testPhotos,
        deletePhotoRecord: (...args) => failDelete ? Promise.reject(Error("合成刪除失敗")) : testPhotos.deletePhotoRecord(...args) } });
    await check("測試登入、修改、安裝及同步同用正式流程，身份與正式資料分開", async () => {
      location.hash = '#itinerary'; await controller.start();
      assert(document.body.dataset.view === 'login' && !localStorage.getItem(REHEARSAL_IDENTITY_KEY), "跳過測試登入");
      assert(document.getElementById('install-invitation').open, "沒有安裝指引");
      click('[data-install-dismiss]'); await loginStudentForFixture(document);
      await until(() => document.getElementById('check-in-sync-dialog')?.open);
      assert(document.getElementById('check-in-sync-dialog').textContent.includes('在裝置內模擬'), "上傳同意文字沒有模擬標示");
      assert(!localStorage.getItem(STUDENT_IDENTITY_STORAGE_KEY), "寫入正式身份");
      click('#sync-enable'); await until(() => controller.getPageSnapshot().sync.enabled);
      assert(JSON.parse(localStorage.getItem(REHEARSAL_IDENTITY_KEY)).studentNumber === FIXTURE_IDENTITY.studentNumber, "沒有保存獨立身份");
      click('#student-profile-open'); assert(document.body.dataset.view === 'login', "不能修改身份");
      click('[data-student-identity-cancel]'); await until(() => document.body.dataset.view === 'itinerary');
      assert(controller.getPageSnapshot().sync.enabled, "取消修改遺失同步許可");
    });
    await check("六站正式內容、兩項導航、獨立資料，載入不要求定位或相機", async () => {
      await navigate('#itinerary'); await controller.start(); configureMemoryControls(controller);
      assert(document.querySelectorAll('.bottom-nav a').length === 2 && document.querySelectorAll('#app .itinerary-stop-details').length === 6 && !document.querySelector('[data-attraction-toggle]'), "缺少正式景點或導航");
      assert(!controller.getPageSnapshot().allCheckInsComplete && nativeGPS === 0 && cameraCalls === 0, "讀取正式進度或要求了權限");
      assert(!document.querySelector('[data-push-enable]'), "可以訂閱正式通知");
      await navigate('#attraction/future-school'); assert(!document.querySelector('[data-camera-open="future-school"]'), "未打卡已解鎖相機");
      for (const { id } of CHECK_IN_LOCATIONS) {
        await navigate(`#attraction/${id}`);
        assert(!/學習問題|現場觀察|學習提示/.test(document.getElementById('app').textContent) && !document.querySelector('.learning-disclosure, .learning-grid'), "預演仍有學習問題");
      }
      await navigate('#attraction/future-school');
    });
    await check("模擬離線保存待傳、接收失敗保留及成功重試，沒有正式佇列", async () => {
      await navigate('#itinerary'); controller.setUploadScenario('offline');
      await fix('future-school');
      await until(() => controller.getPageSnapshot().sync.pending === 1);
      controller.setUploadScenario('failure');
      await until(() => !controller.getPageSnapshot().sync.busy && controller.getPageSnapshot().sync.reason.includes('模擬接收器'));
      assert(controller.getPageSnapshot().sync.pending === 1, "失敗丟棄待傳紀錄");
      controller.setUploadScenario('success');
      await until(() => controller.getPageSnapshot().sync.pending === 0 && controller.getPageSnapshot().sync.status === '模擬已上傳');
      assert(!(await createSyncRepository(indexedDB, SYNC_DATABASE_NAME).read()), "寫入正式同步佇列");
      click('[data-checkin-undo="future-school"]'); await confirm();
      await until(() => !controller.getPageSnapshot().checkIn); await navigate('#attraction/future-school');
    });
    await check("測試控制在底部預設收起，切換情境及收起不改動資料，原有測試文字同步移除", async () => {
      const tools = document.getElementById('rehearsal-controls'), select = document.getElementById('rehearsal-scenario');
      assert(tools.tagName === 'DETAILS' && !tools.open && tools.previousElementSibling.id === 'app', '工具沒有在主內容後預設收起');
      assert(document.getElementById('rehearsal-notice').checkVisibility() && !select.checkVisibility(), '測試標示被隱藏或工具仍常開');
      for (const caption of document.querySelectorAll('.checkin-panel > div')) {
        assert(caption.getBoundingClientRect().width >= caption.parentElement.getBoundingClientRect().width - 1 && caption.scrollWidth <= caption.clientWidth + 1, '預演說明被按鈕擠壓');
        assert(!caption.textContent.includes('使用上方'), '定位工具移到底部後仍有舊提示');
      }
      const hash = location.hash, saved = localStorage.getItem(REHEARSAL_STORAGE_KEY);
      tools.querySelector('summary').click();
      assert(select.checkVisibility() && tools.querySelector('a[href$="mode=diagnostics"]'), '缺少定位情境或診斷入口');
      for (const scenario of ['within', 'too-far', 'inaccurate', 'denied', 'timeout']) {
        select.value = scenario; select.dispatchEvent(new Event('change', { bubbles: true }));
        assert(controller.getScenario() === scenario, '切換情境沒有生效');
      }
      controller.render(); tools.querySelector('summary').click();
      assert(!tools.open && !select.checkVisibility() && controller.getScenario() === 'timeout', '收起清除情境或仍顯示控制項');
      tools.querySelector('summary').click();
      assert(select.value === 'timeout', '重新展開遺失情境');
      select.value = 'within'; select.dispatchEvent(new Event('change', { bubbles: true })); tools.querySelector('summary').click();
      assert(location.hash === hash && localStorage.getItem(REHEARSAL_STORAGE_KEY) === saved, '工具操作改動網址或進度');
      assert(!/學習手冊|下載團刊|學習問題|現場觀察|學習提示|個人紀錄，不作校方出席證明。|相片不會上傳；拍到同學前請先取得同意。|查看及下載相片，請按底部的「旅途回憶」。/.test(document.getElementById('app').textContent), '仍有已移除的操作或說明');
    });
    await check("距離太遠拒絕打卡且沒有手動繞過，定位情況切換可重試", async () => {
      await fix('future-school', 'too-far'); assert(!controller.getPageSnapshot().checkIn && !document.getElementById('confirm-dialog').open, "範圍外仍可打卡");
      assert(!document.querySelector('[data-checkin="future-school"]').disabled, "失敗後未恢復按鈕");
    });
    await check("低精確度、拒絕及逾時均需確認未核實，取消不保存", async () => {
      for (const scenario of ['inaccurate', 'denied', 'timeout']) {
        await fix('future-school', scenario); await confirm(false); assert(!controller.getPageSnapshot().checkIn, "取消仍新增紀錄");
      }
      await fix('future-school', 'denied'); await confirm(); await until(()=>controller.getPageSnapshot().checkIn); assert(controller.getPageSnapshot().checkIn?.verified === false, "手動記錄假稱核實");
      assert(document.getElementById('app').textContent.includes('測試手動記錄'), "沒有測試標示");
      click('[data-checkin-undo="future-school"]'); await confirm(); await until(() => !controller.getPageSnapshot().checkIn);
    });
    await check("範圍內模擬定位通過、重複打卡保護，不保存原始座標", async () => {
      await fix('future-school'); assert(controller.getPageSnapshot().checkIn?.verified, "未完成");
      assert(document.getElementById('app').textContent.includes('模擬定位通過') && !/GPS 已核實|定位已核實/.test(document.getElementById('app').textContent), "誤稱到訪核實");
      assert(!document.querySelector('[data-checkin="future-school"]'), "可以重複打卡");
      const saved = JSON.parse(localStorage.getItem(REHEARSAL_STORAGE_KEY)); assert(!JSON.stringify(saved).match(/latitude|longitude|accuracy|coords/), "保存了原始位置");
    });
    await check("正式相機拍攝、Canvas壓縮及手機相機入口累積照片，關閉停止串流", async () => {
      click('[data-camera-open="future-school"]'); await until(() => document.getElementById('camera-loading').hidden && document.getElementById('camera-video').videoWidth > 0);
      click('[data-camera-capture]'); await until(() => !document.getElementById('camera-preview').hidden); click('[data-camera-save]');
      await until(() => controller.getPageSnapshot().photos.length === 1); assert(streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')), "保存後串流未停");
      await addPhoto('future-school'); await until(() => controller.getPageSnapshot().photos.length === 2);
      const entries = await testPhotos.getAllPhotoRecords(); assert(entries.length === 2 && entries.every(item => item.blob.type === 'image/webp' && item.width === 640 && item.height === 480), "未使用正式重繪或覆蓋了舊相片");
      assert(nativeCameraCalls === 1, "手機相機入口不符");
      click('[data-camera-open="future-school"]'); await until(() => document.getElementById('camera-loading').hidden); document.getElementById('camera-dialog').requestClose();
      await until(() => streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')));
    });
    await check("取消打卡確認、取消及刪照失敗保留，成功移除本站照片", async () => {
      click('[data-checkin-undo="future-school"]'); await confirm(false); assert((await testPhotos.getAllPhotoRecords()).length === 2, "取消確認仍刪照");
      failDelete = true; click('[data-checkin-undo="future-school"]'); await confirm(); await until(() => document.getElementById('toast').textContent.includes('未能刪除'));
      assert(controller.getPageSnapshot().checkIn && (await testPhotos.getAllPhotoRecords()).length === 2, "失敗遺失資料");
      failDelete = false; click('[data-checkin-undo="future-school"]'); await confirm(); await until(() => !controller.getPageSnapshot().checkIn); assert(!(await testPhotos.getAllPhotoRecords()).length, "本站相片未刪");
    });
    await check("離頁及更改定位情況使延遲回覆失效，回頁可重新打卡", async () => {
      controller.setScenario('within'); click('[data-checkin="future-school"]'); const stale = pendingGPS.shift(); await navigate('#itinerary'); stale(); await pause();
      await navigate('#attraction/future-school'); assert(!controller.getPageSnapshot().checkIn, "離頁回覆仍打卡");
      click('[data-checkin="future-school"]'); const changed = pendingGPS.shift(); controller.setScenario('too-far'); changed(); await pause(); assert(!controller.getPageSnapshot().checkIn, "變更情況後仍保存舊定位");
    });
    await check("在行程直接完成五個必需景點；學校選填，零相片仍有補拍入口", async () => {
      await navigate('#itinerary'); controller.setScenario('within');
      for (const place of REQUIRED_CHECK_IN_LOCATIONS) {
        click('[data-checkin="' + place.id + '"]');
        assert(pendingGPS.length === 1 && document.querySelector('[data-checkin="' + place.id + '"]').disabled, '等待狀態缺失');
        pendingGPS.shift()();
        await until(() => controller.getPageSnapshot().stops.find(stop => stop.attraction.id === place.id).checkIn);
        assert(location.hash === '#itinerary' && document.querySelector('[data-camera-open="' + place.id + '"]'), '直接操作切頁或未解鎖本站相機');
      }
      await navigate('#itinerary'); assert(controller.getPageSnapshot().allCheckInsComplete && document.querySelector('.checkin-completion').textContent.includes('所有測試打卡'), "完成規則不符");
      assert(!JSON.parse(localStorage.getItem(REHEARSAL_STORAGE_KEY)).checkIns['departure-school'], "學校被自動打卡");
      await navigate('#memories'); assert(document.querySelectorAll('[data-memory-album]').length === 0 && !document.querySelector('#memory-tab-ai'), "零相片相簿或功能移除不符");
    });
    await check("旅途回憶六站相簿及單張測試旅程卡", async () => {
      for (const place of CHECK_IN_LOCATIONS) { if (place.id === 'departure-school') await fix(place.id); else await navigate(`#attraction/${place.id}`); await addPhoto(place.id); }
      await navigate('#memories'); assert(document.querySelectorAll('[data-memory-album]').length === 6, "六站相簿不符");
      const records = await testPhotos.getAllPhotoRecords(); const first = records.find(item => item.attractionId === 'future-school');
      openMemoryPhoto('future-school', first.photoId, true); const count = downloads.length; click('[data-card-download]'); await confirm(); await until(() => downloads.length > count);
      const bitmap = await createImageBitmap(downloads.at(-1).blob); assert(bitmap.width === 1080 && bitmap.height === 1350, "PNG 尺寸錯誤"); bitmap.close();
      closeMemory();
    });
    await check("五站打卡紀錄卡共用正式流程，印測試標示，製卡草稿不改登入資料", async () => {
      const loginIdentity = localStorage.getItem(REHEARSAL_IDENTITY_KEY);
      await navigate('#memories/checkins'); click('[data-memory-checkin-card-open]');
      for (const [key, value] of Object.entries({ studentName: '合成學生', className: '測試班', studentNumber: '007' })) input('[data-checkin-card-field="' + key + '"]', value);
      const text = document.getElementById('checkin-card-dialog').textContent;
      assert(text.includes('五站測試打卡完成') && !text.includes('GPS 已核實'), '測試紀錄假稱正式核實');
      click('[data-checkin-card-preview]'); await until(() => document.querySelector('#checkin-card-dialog .artwork-preview'));
      const before = downloads.length; click('[data-checkin-card-download]'); await confirm(); await until(() => downloads.length > before);
      const file = downloads.at(-1), bitmap = await createImageBitmap(file.blob);
      assert(file.name.startsWith('測試-') && !file.name.includes('合成學生') && bitmap.width === 1080 && bitmap.height > 1800, '五站測試卡或檔名錯誤');
      assert(!localStorage.getItem(REHEARSAL_STORAGE_KEY).includes('合成學生') && document.getElementById('checkin-card-studentNumber').value === '007', '身份儲存或前置零丟失');
      assert(localStorage.getItem(REHEARSAL_IDENTITY_KEY) === loginIdentity, '製卡身份改寫登入資料');
      bitmap.close(); click('[data-checkin-card-close]');
    });
    await check("移除手冊後舊網址開啟行程，載入不改動舊草稿", async () => {
      await navigate("#workbook/essay"); await controller.start();
      assert(controller.getPageSnapshot().view === "itinerary" && !document.querySelector('[data-nav="workbook"], [data-workbook-field]'), "仍有手冊操作");
      assert(JSON.stringify(await legacyDraft(realDraftDatabase)) === JSON.stringify(realDraft), "讀取改動正式草稿");
      assert((await legacyDraft(testDraftDatabase)).draft.answers["essay-title"] === "預演舊稿", "讀取改動預演草稿");
    });
    await check("清除需兩次確認，只清預演資料，正式及舊診斷哨兵保持不變", async () => {
      await navigate('#home'); click('[data-reset-all]'); await confirm(false); assert(localStorage.getItem(REHEARSAL_STORAGE_KEY) && (await legacyDraft(testDraftDatabase)).draft.answers["essay-title"] === "預演舊稿", "取消仍清除");
      click('[data-reset-all]'); await confirm(); await until(() => document.getElementById('confirm-dialog').open && document.getElementById('confirm-title').textContent.includes('最後確認')); await confirm();
      await until(() => !localStorage.getItem(REHEARSAL_STORAGE_KEY)); assert(!(await testPhotos.getAllPhotoRecords()).length && JSON.stringify(await legacyDraft(testDraftDatabase)) === JSON.stringify({ retired: true }), "預演未全部清除");
      assert(!localStorage.getItem(REHEARSAL_IDENTITY_KEY) && !(await createSyncRepository(indexedDB, REHEARSAL_SYNC_DATABASE).read()).enrollment, "測試身份或待傳設定未清除");
      assert(localStorage.getItem(STORAGE_KEY) === realState && localStorage.getItem(DEVICE_TEST_STORAGE_KEY) === oldState, "正式／舊診斷進度被改動");
      assert((await realPhotos.getAllPhotoRecords())[0].writeId === sentinel && JSON.stringify(await legacyDraft(realDraftDatabase)) === JSON.stringify(realDraft), "正式相片／手冊被改動");
      assert(nativeGPS === 0, "呼叫了真實 GPS");
    });
    await check("離線白名單包含預演控制器及測試頁，正式首頁沒有被取代", async () => {
      await navigator.serviceWorker.ready; const cache = await getAppShellCache(); const base = new URL('../../', import.meta.url);
      assert((await (await cache.match(new URL('device-test.html', base))).text()).includes('正式流程預演'), "缺少預演 shell");
      assert(await cache.match(new URL('src/device-rehearsal.js', base)), "缺少預演模組");
      assert((await (await cache.match(new URL('index.html', base))).text()).includes('戶外學習日旅程助手'), "正式首頁被取代");
    });
    document.getElementById('test-summary').textContent = `全部 ${passed} 項通過。GPS 與相機來源為合成；DOM、Canvas、IndexedDB、PNG及離線快取為真實瀏覽器功能。`;
  } catch (error) { document.getElementById('test-summary').textContent = `測試停止：${error.message}（已通過 ${passed} 項）`; }
  finally {
    timers.forEach(clearInterval); streams.forEach(stream => stream.getTracks().forEach(track => track.stop()));
    // Only remove the sentinels created by this fixture, never existing data.
    if (realState && localStorage.getItem(STORAGE_KEY) === realState) localStorage.removeItem(STORAGE_KEY);
    if (oldState && localStorage.getItem(DEVICE_TEST_STORAGE_KEY) === oldState) localStorage.removeItem(DEVICE_TEST_STORAGE_KEY);
    if (sentinelPhoto && (await realPhotos.getAllPhotoRecords()).every(record => record.writeId === sentinel)) await realPhotos.deletePhotoRecord('departure-school');
    // Keep the formal legacy sentinel to avoid altering any unrelated database.
    // This named synthetic origin is never reused for ordinary user data.
  }
});
