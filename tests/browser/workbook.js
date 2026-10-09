import { createAppController } from "../../src/controller.js";
import { createWorkbookRepository, createWorkbookSession, WorkbookConflict } from "../../src/workbook-storage.js";
import { emptyWorkbook, createWorkbookBackup, parseWorkbookBackup, WORKBOOK_ACTIVITY, WORKBOOK_FORMAT } from "../../src/workbook-data.js";
import { createWorkbookPDF } from "../../src/workbook-pdf.js";
import { CHECK_IN_LOCATIONS } from "../../src/data.js";
import { createDefaultState, STORAGE_KEY } from "../../src/state.js";

const assert = (value, label) => { if (!value) throw Error(label); };
const pause = () => new Promise(resolve => setTimeout(resolve, 15));
async function until(condition) { const end = Date.now() + 20000; while (!condition()) { if (Date.now() > end) throw Error("等待逾時"); await pause(); } }
const databaseName = "outdoorLearningDay.workbook.integration.v1";
const repository = createWorkbookRepository({ databaseName });
let failWrite = false, failRead = false, pdfOverride = null;
let photos = [];
const values = new Map(), live = new Map(), downloads = [];
const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
const state = createDefaultState();
for (const item of CHECK_IN_LOCATIONS) state.checkIns[item.id] = { attractionId: item.id, method: "manual", verified: false, checkedInAt: "2026-11-05T04:00:00.000Z" };
storage.setItem(STORAGE_KEY, JSON.stringify(state));
for (let station = 0; station < CHECK_IN_LOCATIONS.length; station++) {
  const canvas = document.createElement("canvas"); canvas.width = station % 2 ? 240 : 400; canvas.height = station % 2 ? 400 : 240;
  const context = canvas.getContext("2d"); context.fillStyle = ["#296974", "#b44a43", "#927224", "#458e66", "#5867a7", "#764c78"][station]; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#fff"; context.font = "20px sans-serif"; context.fillText(`SYNTHETIC ${station + 1}`, 20, 70);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", .92));
  for (let index = 0; index < 13; index++) photos.push({ photoId: `wb-${station}-${index}`, writeId: `wb-${station}-${index}`, attractionId: CHECK_IN_LOCATIONS[station].id, blob, width: canvas.width, height: canvas.height, createdAt: new Date(Date.UTC(2026, 10, 5, 4, 0, index)).toISOString() });
}
class FixtureURL extends URL {
  static createObjectURL(blob) { const url = URL.createObjectURL(blob); live.set(url, blob); return url; }
  static revokeObjectURL(url) { live.delete(url); URL.revokeObjectURL(url); }
}
const nativeClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function () { if (this.download) downloads.push({ name: this.download, blob: live.get(this.href) }); else nativeClick.call(this); };
const workbookRepository = { read: () => repository.read(), clear: () => repository.clear(), write: (...args) => failWrite ? Promise.reject(Error("合成容量錯誤")) : repository.write(...args) };
const photoService = { getAllPhotoRecords: async () => { if (failRead) throw Error("合成讀取錯誤"); return photos; }, clearPhotoRecords: async () => { photos = []; } };
const pushClientFactory = () => ({ getSnapshot: () => ({ statusMessage: "獨立合成測試" }), initialize: async () => {}, refresh: async () => {} });
const controller = createAppController({ environment: { document, window, navigator: { onLine: true }, location, localStorage: storage, URL: FixtureURL, requestAnimationFrame, indexedDB, crypto },
  photoService, pushClientFactory, workbookRepository, workbookPDFService: options => (pdfOverride || createWorkbookPDF)(options) });
await controller.start();
const snapshot = () => controller.getPageSnapshot();
const click = selector => { const element = document.querySelector(selector); assert(element && !element.disabled, `控制項無效 ${selector}`); element.click(); };
const input = (selector, value) => { const element = document.querySelector(selector); assert(element, selector); element.value = value; element.dispatchEvent(new InputEvent("input", { bubbles: true })); };
async function navigate(route) {
  if (location.hash === route) { controller.render(); return; }
  location.hash = route;
  await until(() => document.querySelector("[data-nav][aria-current]")?.dataset.nav === (route.startsWith("#workbook") ? "workbook" : route.slice(1)) &&
    !document.getElementById('app').inert && (route.startsWith("#workbook/") ? snapshot().part?.id === route.slice('#workbook/'.length) && document.querySelector("#app h1")?.textContent === snapshot().part?.title : snapshot().view === route.slice(1)));
  await pause();
}
async function saved() { await until(() => snapshot().status === "saved"); }
async function confirm(accepted = true) { await until(() => document.querySelector("#confirm-dialog").open); click(accepted ? "#confirm-button" : '#confirm-dialog [value="cancel"]'); await pause(); }
function fileChange(file) { const input = document.getElementById("wb-restore"), transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files; input.dispatchEvent(new Event("change", { bubbles: true })); }
function openBackup() { if (!snapshot().backupOpen) click('[data-workbook-backup-toggle]'); }
async function previewBackup(draft) { openBackup(); fileChange(new File([createWorkbookBackup(draft)], 'backup.json', { type: 'application/json' })); await until(() => snapshot().restorePreview); }
async function identity() {
  if (!snapshot().exportOpen) click("[data-workbook-export-open]");
  input('[data-workbook-identity="studentName"]', "合成學生"); input('[data-workbook-identity="className"]', "測試班"); input('[data-workbook-identity="studentNumber"]', "007");
}
let passed = 0, failed = 0;
async function check(label, action) {
  const li = document.createElement("li");
  try { await action(); passed++; li.textContent = `通過：${label}`; }
  catch (cause) { failed++; li.textContent = `失敗：${label} — ${cause.message}`; }
  document.querySelector("#test-results").append(li);
}
document.getElementById("run-workbook").addEventListener("click", async event => {
  event.target.disabled = true;
  await repository.clear(); await controller.start();
  await check("四項底部導航及唯一主入口，所有手冊分頁高亮、初始評分空白", async () => {
    for (const route of ["#home", "#itinerary", "#memories"]) { await navigate(route); assert(document.querySelectorAll('a[href="#workbook"]').length === 1, "多了入口"); }
    assert(document.querySelectorAll(".bottom-nav a").length === 4, "不是四項");
    for (const [id, count] of [["essay", 2], ["share", 3], ["day1", 7], ["day2", 6], ["day3", 6], ["reflection", 2], ["works", 0]]) {
      await navigate(`#workbook/${id}`); assert(document.querySelectorAll("[data-workbook-field]").length === count, `${id} 題數`);
      for (const field of document.querySelectorAll('[data-workbook-field]')) assert(field.maxLength === 1000 && document.getElementById(`wb-count-${field.dataset.workbookField}`).textContent.includes('最多 1,000 字元'), `${id} 上限或提示`);
      assert(document.activeElement === document.getElementById("app") && !document.getElementById("app").inert, "切頁後鍵盤焦點沒有返回主要內容");
      assert(document.querySelector('[data-nav="workbook"]').getAttribute("aria-current") === "page", "導航未高亮");
      assert(!document.getElementById('app').textContent.includes('JSON') && document.querySelectorAll('[data-workbook-backup-toggle]').length === 1, '舊JSON按鈕或重複入口');
      assert(document.querySelector('a[href="#workbook"].back-link'), "沒有返回目錄");
      if (id === "reflection") assert(document.querySelectorAll("input[type=radio]:checked").length === 0 && document.querySelectorAll("fieldset").length === 8, "自評預選或項數");
    }
  });
  await check("備份預設收起，開啟及收起恢復焦點，原輸入保留", async () => {
    await navigate('#workbook/essay'); input('#wb-essay-title', '可稍後繼續的文章'); await saved();
    assert(document.getElementById('wb-backup-panel').hidden, '備份沒有預設收起');
    document.getElementById('wb-backup-open').focus(); openBackup();
    assert(!document.getElementById('wb-backup-panel').hidden && document.activeElement.id === 'wb-backup-title', '開啟焦點錯誤');
    click('[data-workbook-backup-toggle]');
    assert(document.activeElement.id === 'wb-backup-open' && document.getElementById('wb-backup-panel').hidden, '收起未恢復焦點');
    assert(document.getElementById('wb-essay-title').value === '可稍後繼續的文章', '收起丟失輸入');
    await navigate('#workbook'); assert(document.querySelector('a[href="#workbook/essay"]').textContent.includes('繼續填寫'), '未提供繼續');
  });
  await check("中文組字不重畫、完成後保存、切頁待存完成及重讀保留", async () => {
    await navigate("#workbook/essay"); const field = document.getElementById("wb-essay-body"); field.focus();
    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })); field.value = "中文組字";
    field.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true })); controller.render(); assert(field.isConnected, "組字被重畫");
    field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })); await saved();
    input("#wb-essay-title", "嶺南文化合成測試"); await navigate("#workbook/day1");
    const record = await repository.read(); assert(record.draft.answers['essay-body'] === "中文組字" && record.draft.answers['essay-title'].includes("嶺南"), "切頁遺失");
  });
  await check("背景擷取組字及暫存、離開提醒只在未存時，pagehide後可繼續", async () => {
    await navigate('#workbook/essay'); const field = document.getElementById('wb-essay-body');
    field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); field.value = '背景擷取中文';
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    assert(field.isConnected && document.getElementById('wb-essay-body') === field, '背景重畫組字');
    const before = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(before); assert(before.defaultPrevented, '未存時沒有離開提醒');
    await saved(); assert((await repository.read()).draft.answers['essay-body'] === '背景擷取中文', '背景未保存');
    const after = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(after); assert(!after.defaultPrevented, '已存仍提醒');
    delete document.visibilityState; window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('pageshow'));
    assert(document.getElementById('wb-essay-body').value === '背景擷取中文', 'pagehide後丟失草稿');
  });
  await check("1,000字元邊界、中文組字完成套用上限，超過舊上限的備份不改草稿", async () => {
    await navigate('#workbook/essay'); const field = document.getElementById('wb-essay-body');
    field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); field.value = '中'.repeat(1001);
    field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    assert(field.value.length === 1001 && field.isConnected, '組字被截斷或重畫');
    field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })); await saved();
    assert(field.value.length === 1000 && (await repository.read()).draft.answers['essay-body'].length === 1000, '未套用新上限');
    const before = JSON.stringify((await repository.read()).draft), backup = JSON.parse(createWorkbookBackup((await repository.read()).draft));
    openBackup(); backup.answers['essay-body'] = '超'.repeat(10001); fileChange(new File([JSON.stringify(backup)], 'over-limit.json', { type: 'application/json' })); await pause();
    assert(JSON.stringify((await repository.read()).draft) === before && !document.getElementById('confirm-dialog').open, '超限還原改動草稿');
  });
  await check("真正IndexedDB的10,000字元舊稿可讀與備份，不改寫；縮短及清除仍可交易", async () => {
    const legacyName = `${databaseName}.legacy`, legacy = emptyWorkbook(); legacy.answers['essay-body'] = '舊'.repeat(10000);
    async function seedLegacy() {
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open(legacyName, 1); request.onupgradeneeded = () => request.result.createObjectStore('drafts'); request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result); });
      await new Promise((resolve, reject) => { const transaction = db.transaction('drafts', 'readwrite'); transaction.objectStore('drafts').put({ format: WORKBOOK_FORMAT, activity: WORKBOOK_ACTIVITY, revision: 1, draft: legacy }, WORKBOOK_ACTIVITY); transaction.oncomplete = () => { db.close(); resolve(); }; transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error); }; });
    }
    await seedLegacy(); const legacyRepository = createWorkbookRepository({ databaseName: legacyName }), session = createWorkbookSession({ repository: legacyRepository }); await session.load();
    assert(session.snapshot().initialized && session.snapshot().status === 'error' && session.snapshot().draft.answers['essay-body'].length === 10000, '舊稿不可讀或被截斷');
    assert(JSON.parse(createWorkbookBackup(session.snapshot().draft)).answers['essay-body'].length === 10000, '恢復備份被截斷');
    await session.retry(); assert((await legacyRepository.read()).revision === 1 && session.snapshot().status === 'error', '重試寫入超限稿');
    const next = session.snapshot().draft; next.answers['essay-body'] = '舊'.repeat(1000); session.replace(next); await session.flush();
    assert(session.snapshot().status === 'saved' && (await legacyRepository.read()).draft.answers['essay-body'].length === 1000, '縮短不能保存');
    await seedLegacy(); await legacyRepository.clear(); assert((await legacyRepository.read()).draft.answers['essay-body'] === '', '超限舊稿不能清除');
  });
  await check("相片12張分頁、跨站保留、最多六張，僅顯示目前分頁預覽", async () => {
    await navigate("#workbook/essay"); click("[data-workbook-picker]");
    assert(document.querySelectorAll("[data-workbook-photo]").length === 12 && live.size <= 12, "未限制分頁");
    for (let page = 0; page < 6; page++) {
      const photo = document.querySelector("[data-workbook-photo]"); photo.click();
      if (page < 5) click(`[data-workbook-photo-page="${page + 1}"]`);
    }
    await saved(); assert(snapshot().selectedPhotos.length === 6, "選取丟失");
    assert([...document.querySelectorAll("[data-workbook-photo]:not(:checked)")].every(item => item.disabled), "超過六張仍能選");
    assert(live.size <= 18, "舊預覽未釋放");
    for (const image of document.querySelectorAll(".workbook-selected-photos img")) await image.decode();
    click("[data-workbook-picker]"); assert(live.size === 6, "收起仍保留縮圖");
  });
  await check("保存失敗保留輸入、備份不含身份與選圖、重試完成交易", async () => {
    failWrite = true; input("#wb-essay-body", "保存失敗仍保留"); await until(() => snapshot().status === "error");
    assert(document.getElementById("wb-essay-body").value === "保存失敗仍保留", "輸入丟失");
    const field = document.getElementById('wb-essay-body'); location.hash = '#home'; await until(() => location.hash === '#workbook/essay');
    assert(document.getElementById('wb-essay-body') === field && !document.getElementById('app').inert, '失敗切頁未保留原輸入');
    await identity(); openBackup(); click("[data-workbook-backup]"); const backup = downloads.at(-1); const json = await backup.blob.text();
    assert(/^學習手冊備份-\d{8}-\d{6}-\d{3}\.json$/.test(backup.name), '檔名缺日期時間');
    assert(!json.includes('合成學生') && !json.includes('photoIds') && !json.includes('wb-0-'), "備份含身份相片");
    assert(parseWorkbookBackup(json).answers['essay-body'] === "保存失敗仍保留", "備份遺失失敗內容");
    failWrite = false; click("[data-workbook-retry]"); await saved();
  });
  await check("跨分頁版本衝突，備份後才可載入新版本", async () => {
    const external = await repository.read(); external.draft.answers['essay-title'] = "另一分頁版本"; await repository.write(external.draft, external.revision);
    input("#wb-essay-title", "此分頁未存草稿"); await until(() => snapshot().status === "conflict");
    assert(document.querySelector("[data-workbook-load-latest]").disabled, "未備份即可覆蓋草稿");
    openBackup(); click("[data-workbook-backup]"); click("[data-workbook-load-latest]"); await confirm(); await saved();
    assert(snapshot().answers['essay-title'] === "另一分頁版本", "沒有載入新版本");
  });
  await check("備份還原先驗證再確認取代，非法檔案不改動，選圖清空", async () => {
    click("[data-workbook-export-close]"); openBackup(); const before = JSON.stringify((await repository.read()).draft);
    fileChange(new File(['{"format":999}'], 'bad.json', { type: 'application/json' })); await pause();
    assert(JSON.stringify((await repository.read()).draft) === before && !document.querySelector("#confirm-dialog").open, "非法檔案改動草稿");
    const draft = emptyWorkbook(); draft.answers['essay-title'] = "還原測試";
    await previewBackup(draft); assert(snapshot().restorePreview.textCount === 1 && JSON.stringify((await repository.read()).draft) === before, '預覽改草稿或欄數錯誤');
    click('[data-workbook-restore-confirm]'); await confirm(false); assert(JSON.stringify((await repository.read()).draft) === before, "取消仍取代");
    click('[data-workbook-restore-confirm]'); await confirm(); await until(() => snapshot().answers['essay-title'] === "還原測試"); await saved();
    assert(snapshot().selectedPhotos.length === 0, "還原匯入選圖");
  });
  await check("舊備份完整載入，超限欄位可跨部分縮短後才暫存，缺圖需重選", async () => {
    const draft = emptyWorkbook(); draft.answers['essay-body'] = '舊'.repeat(10000); draft.answers['day1-1'] = '文'.repeat(1001);
    const original = JSON.stringify((await repository.read()).draft);
    await previewBackup(draft); assert(snapshot().restorePreview.limitError.includes('圖文文章') && snapshot().restorePreview.limitError.includes('第一日日記'), '未指出超限部分');
    click('[data-workbook-restore-confirm]'); await confirm();
    await until(() => snapshot().answers['essay-body'].length === 10000);
    assert(snapshot().answers['essay-body'].length === 10000 && snapshot().status === 'error', '舊文截斷或誤報已存');
    assert(JSON.stringify((await repository.read()).draft) === original && snapshot().selectedPhotos.length === 0, '提前寫入或匯入選圖');
    await navigate('#workbook/day1'); input('#wb-day1-1', '縮短日記'); await navigate('#workbook/essay'); input('#wb-essay-body', '縮短文章'); await saved();
    assert((await repository.read()).draft.answers['day1-1'] === '縮短日記', '跨部分縮短丟失');
  });
  await check("身份只跨手冊分頁保留，離開清除；必填、中文字數與空項確認", async () => {
    await identity(); await navigate("#workbook/day1"); assert(snapshot().identity.studentName === "合成學生", "分頁丟身份");
    await navigate("#home"); await navigate("#workbook/essay"); assert(snapshot().identity.studentName === "", "離開仍有身份");
    click("[data-workbook-export-open]"); click("[data-workbook-pdf]"); await pause(); assert(downloads.at(-1)?.blob.type !== "application/pdf", "身份未填也下載");
    input('[data-workbook-identity="studentName"]', '名'.repeat(41)); assert(Array.from(snapshot().identity.studentName).length === 40, "姓名上限");
    await identity(); click("[data-workbook-pdf]"); await until(() => document.querySelector("#confirm-dialog").open);
    assert(document.getElementById("confirm-message").textContent.includes("尚未填寫"), "未列空項"); await confirm(false); assert(snapshot().identity.studentName === "合成學生", "取消丟草稿");
  });
  await check("約600中文字及橫直配圖真正PDF、身份學號、正文可選取", async () => {
    click("[data-workbook-export-close]"); input("#wb-essay-body", "嶺南文化交流日記。".repeat(60)); click("[data-workbook-picker]");
    document.querySelector("[data-workbook-photo]").click(); click('[data-workbook-photo-page="1"]'); document.querySelector("[data-workbook-photo]").click();
    await saved(); await identity(); const count = downloads.length; click("[data-workbook-pdf]"); await confirm(); await until(() => downloads.length > count);
    const file = downloads.at(-1); assert(file.blob.type === "application/pdf" && !file.name.includes('合成學生'), "PDF/檔名");
    assert((await file.blob.slice(0, 5).text()) === '%PDF-', "不是PDF"); assert(!snapshot().busy, "完成仍忙碌");
  });
  await check("相片讀取失敗不誤報缺圖，保留選圖並提供重試", async () => {
    click("[data-workbook-export-close]"); failRead = true; await controller.start();
    assert(snapshot().photoReadState === "error" && !snapshot().selectedPhotos.some(item => item.reason.includes('已不存在')), "誤報缺圖");
    if (!snapshot().pickerOpen) click('[data-workbook-picker]'); failRead = false; click('[data-workbook-photos-retry]'); await until(() => snapshot().photoReadState === "ready");
  });
  await check("生成取消、離頁、草稿版本或相片失效均不下載過期結果", async () => {
    for (const invalidation of ['cancel', 'leave', 'revision', 'photo']) {
      await navigate('#workbook/essay'); await identity(); let complete, started = false; const count = downloads.length;
      pdfOverride = async () => { started = true; return new Promise(resolve => { complete = () => resolve(new Uint8Array([1, 2])); }); };
      click('[data-workbook-pdf]'); await confirm(); await until(() => started);
      if (invalidation === 'cancel') click('[data-workbook-export-close]');
      if (invalidation === 'leave') await navigate('#home');
      if (invalidation === 'revision') { const external = await repository.read(); await repository.write(external.draft, external.revision); }
      if (invalidation === 'photo') photos = photos.filter(photo => photo.photoId !== (snapshot().selectedPhotos[0]?.photoId || 'wb-0-12'));
      complete(); await pause(); await pause();
      assert(downloads.length === count, `${invalidation} 仍下載`);
      if (invalidation === 'revision') { await until(() => snapshot().status === 'conflict'); openBackup(); click('[data-workbook-backup]'); click('[data-workbook-load-latest]'); await confirm(); await saved(); }
    }
    pdfOverride = null;
  });
  await check("真正IndexedDB交易並行只有一個成功；清除後舊版本拒絕寫回", async () => {
    const race = createWorkbookRepository({ databaseName: `${databaseName}.race` }); await race.clear(); const before = await race.read();
    const results = await Promise.allSettled([race.write(before.draft, before.revision), race.write(before.draft, before.revision)]);
    assert(results.filter(result => result.status === 'fulfilled').length === 1, "並行都成功");
    assert(results.some(result => result.status === 'rejected' && result.reason instanceof WorkbookConflict), "非衝突拒絕");
    const stale = await race.read(); await race.clear();
    await race.write(stale.draft, stale.revision).then(() => { throw Error('清除後舊稿復活'); }, cause => assert(cause instanceof WorkbookConflict, '版本核對錯誤'));
  });
  await check("全資料清除兩次確認，手冊一併清空且身份不保留", async () => {
    await navigate('#home'); click('[data-reset-all]'); await confirm(); await confirm();
    await until(() => Object.values(controller.getPageSnapshot().view === 'home' ? (values.get(STORAGE_KEY) ? JSON.parse(values.get(STORAGE_KEY)).checkIns : {}) : {}).length === 0);
    const record = await repository.read(); assert(Object.values(record.draft.answers).every(text => !text) && record.draft.photoIds.length === 0, '手冊未清除');
    await navigate('#workbook'); assert(snapshot().identity.studentName === '', '清除身份殘留');
  });
  document.getElementById('test-summary').textContent = `${passed} 項通過，${failed} 項失敗`;
  document.getElementById('test-summary').dataset.complete = 'true';
});
