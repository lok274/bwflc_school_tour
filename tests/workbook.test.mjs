import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { WORKBOOK_PARTS, WORKBOOK_RATINGS, WORKBOOK_FIELDS, WORKBOOK_INSTRUCTIONS, emptyWorkbook, validateWorkbook, workbookProgress, missingWorkbookFields, createWorkbookBackup, parseWorkbookBackup, WORKBOOK_ACTIVITY } from "../src/workbook-data.js";
import { createWorkbookSession, WorkbookConflict } from "../src/workbook-storage.js";
import { createWorkbookPDF, loadWorkbookPDFResources, validateWorkbookIdentity, fitWorkbookImage } from "../src/workbook-pdf.js";
import { memoryWorkbookRepository } from "./helpers/workbook-repository.js";
import { appHarness } from "./helpers/browser-environment.js";

const tick = () => new Promise(setImmediate);
const identity = { studentName: "合成測試學生", className: "測試班", studentNumber: "007" };
test("手冊原文與團刊順序14–19頁獨立擷取基準一致，日記7／6／6、自評八項", async () => {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/booklet-workbook.json", import.meta.url), "utf8"));
  const compact = text => text.replace(/\s+/g, "");
  const source = index => fixture.pages[index].text;
  for (const line of [...WORKBOOK_INSTRUCTIONS.essay, ...WORKBOOK_INSTRUCTIONS.share]) assert.ok(source(0).includes(compact(line)), line);
  for (const line of [...WORKBOOK_INSTRUCTIONS.video, ...WORKBOOK_INSTRUCTIONS.ai, WORKBOOK_INSTRUCTIONS.upload, WORKBOOK_INSTRUCTIONS.uploadUrl]) assert.ok(source(1).includes(compact(line)), line);
  for (const [index, id, count] of [[2, "day1", 7], [3, "day2", 6], [4, "day3", 6]]) {
    const part = WORKBOOK_PARTS.find(part => part.id === id); assert.equal(part.fields.length, count);
    for (const field of part.fields) assert.ok(source(index).includes(compact(field.label)), field.label);
  }
  assert.equal(WORKBOOK_RATINGS.length, 8);
  for (const field of [...WORKBOOK_PARTS.find(part => part.id === "reflection").fields, ...WORKBOOK_RATINGS]) assert.ok(source(5).includes(compact(field.label)), field.label);
  assert.ok(source(5).includes(compact(WORKBOOK_INSTRUCTIONS.rating)));
});
test("初始答案全空、自評不預選，進度只計是否填寫", () => {
  const draft = emptyWorkbook();
  assert.equal(WORKBOOK_FIELDS.length, 26);
  assert.ok(Object.values(draft.answers).every(text => text === ""));
  assert.ok(Object.values(draft.ratings).every(score => score === null));
  assert.equal(missingWorkbookFields(draft).length, 34);
  draft.answers['essay-body'] = "   "; assert.equal(workbookProgress(draft)[0].filled, 0);
  draft.answers['essay-body'] = "一"; assert.equal(workbookProgress(draft)[0].filled, 1);
  draft.ratings['rating-1'] = 1; assert.equal(workbookProgress(draft).find(part => part.id === 'reflection').filled, 1);
});
test("备份白名單、版本、活動、大小及欄位驗證，還原必須重新選圖", () => {
  const draft = emptyWorkbook(); draft.photoIds = ["private-photo-id"]; draft.answers['essay-title'] = "測試";
  const backup = createWorkbookBackup(draft), parsed = JSON.parse(backup);
  assert.deepEqual(Object.keys(parsed).sort(), ["activity", "answers", "format", "ratings"]);
  assert.equal(parsed.activity, WORKBOOK_ACTIVITY);
  assert.doesNotMatch(backup, /private-photo-id|studentName|className|studentNumber|photoIds|checkIns|Blob/);
  assert.deepEqual(parseWorkbookBackup(backup).photoIds, []);
  for (const invalid of ["{}", "{broken", " ".repeat(1024 * 1024 + 1), JSON.stringify({ ...parsed, format: 2 }), JSON.stringify({ ...parsed, activity: "another" }), JSON.stringify({ ...parsed, studentName: "不可匯入" })]) assert.throws(() => parseWorkbookBackup(invalid));
  const long = structuredClone(parsed); long.answers['essay-body'] = "中".repeat(10001); assert.throws(() => parseWorkbookBackup(JSON.stringify(long)), /超過/);
  const invalidRating = structuredClone(parsed); invalidRating.ratings['rating-1'] = 0; assert.throws(() => parseWorkbookBackup(JSON.stringify(invalidRating)), /評分/);
  const unknown = emptyWorkbook(); unknown.answers.unknown = ""; assert.throws(() => validateWorkbook(unknown));
});
test("保存排隊且只有交易完成才顯示已保存；重開讀回文字與選圖", async () => {
  const base = memoryWorkbookRepository(); let complete;
  const session = createWorkbookSession({ repository: { ...base, write: (...args) => new Promise(resolve => { complete = async () => resolve(await base.write(...args)); }) } });
  await session.load(); const first = session.snapshot().draft; first.answers['essay-body'] = "初稿"; session.replace(first); await tick();
  assert.equal(session.snapshot().status, "saving");
  const second = session.snapshot().draft; second.answers['essay-body'] = "最新中文草稿"; second.photoIds = ['photo-1']; session.replace(second);
  await complete(); await tick(); assert.equal(session.snapshot().status, "saving");
  await complete(); await session.flush(); assert.equal(session.snapshot().status, "saved");
  const reopened = createWorkbookSession({ repository: base }); await reopened.load();
  assert.equal(reopened.snapshot().draft.answers['essay-body'], "最新中文草稿"); assert.deepEqual(reopened.snapshot().draft.photoIds, ['photo-1']);
});
test("儲存失敗保留輸入並可備份重試；舊分頁不能覆蓋新版本", async () => {
  const base = memoryWorkbookRepository(); let fail = true;
  const session = createWorkbookSession({ repository: { ...base, write: (...args) => { if (fail) return Promise.reject(new Error('容量不足')); return base.write(...args); } } });
  await session.load(); const draft = session.snapshot().draft; draft.answers['essay-body'] = '不能丟失'; session.replace(draft);
  await assert.rejects(session.flush(), /容量/); assert.equal(session.snapshot().draft.answers['essay-body'], '不能丟失');
  assert.match(createWorkbookBackup(session.snapshot().draft), /不能丟失/);
  fail = false; await session.retry(); assert.equal(session.snapshot().status, 'saved');
  const old = createWorkbookSession({ repository: base }); await old.load();
  const current = session.snapshot().draft; current.answers['essay-body'] = '新分頁'; session.replace(current); await session.flush();
  const stale = old.snapshot().draft; stale.answers['essay-body'] = '舊分頁'; old.replace(stale);
  await assert.rejects(old.flush(), /另一分頁/); assert.equal(old.snapshot().status, 'conflict');
  assert.equal((await base.read()).draft.answers['essay-body'], '新分頁'); assert.equal(old.snapshot().draft.answers['essay-body'], '舊分頁');
});
test("清除等待已開始交易、停止待存工作，舊分頁不會復活草稿", async () => {
  const base = memoryWorkbookRepository(); let release;
  const delayed = createWorkbookSession({ repository: { ...base, write: (...args) => new Promise(resolve => { release = async () => resolve(await base.write(...args)); }) } });
  const stale = createWorkbookSession({ repository: base }); await delayed.load(); await stale.load();
  const draft = delayed.snapshot().draft; draft.answers['essay-title'] = '清除前'; delayed.replace(draft); await tick();
  const clearing = delayed.clear(); await release(); await clearing;
  assert.equal((await base.read()).draft.answers['essay-title'], '');
  const old = stale.snapshot().draft; old.answers['essay-title'] = '不應復活'; stale.replace(old);
  await assert.rejects(stale.flush(), /另一分頁/);
  assert.equal((await base.read()).draft.answers['essay-title'], '');
});
test("清除失敗保持停止狀態並如實報告，載入或版本檢查錯誤不虛報已保存", async () => {
  const base = memoryWorkbookRepository(); const session = createWorkbookSession({ repository: { ...base, clear: async () => { throw new Error('locked'); } } });
  await session.load(); await assert.rejects(session.clear()); assert.equal(session.snapshot().status, 'error');
  assert.equal(session.replace(emptyWorkbook()), true);
  assert.equal(session.snapshot().status, 'error');
  const bad = createWorkbookSession({ repository: { read: async () => { throw new Error('無法讀取'); } } }); await bad.load(); assert.equal(bad.snapshot().initialized, false); assert.equal(bad.snapshot().status, 'error');
});
test("路由及不可變手冊模型不含 Blob，身份跨手冊分頁保留、離開後清除", async () => {
  const app = appHarness({ hash: '#workbook/essay' }); await app.controller.start();
  const model = app.controller.getPageSnapshot(); assert.equal(model.view, 'workbook'); assert.equal(Object.isFrozen(model.answers), true); assert.deepEqual(model.selectedPhotos, []);
  const target = { dataset: { workbookIdentity: 'studentName' }, value: '身份測試', matches: query => query === '[data-workbook-identity]', isConnected: true };
  await app.events.get('document:input')({ target });
  app.navigate('#workbook/day1'); await tick(); assert.equal(app.controller.getPageSnapshot().identity.studentName, '身份測試');
  app.navigate('#home'); await tick(); app.navigate('#workbook'); await tick(); assert.equal(app.controller.getPageSnapshot().identity.studentName, '');
  app.navigate('#workbook/unknown'); await tick(); assert.equal(app.controller.getPageSnapshot().part, null);
});
test("PDF 身份必填、字數限40／20／20且學號保留零，圖片完整等比例", () => {
  assert.equal(validateWorkbookIdentity(identity).studentNumber, '007');
  for (const key of Object.keys(identity)) assert.throws(() => validateWorkbookIdentity({ ...identity, [key]: '' }));
  assert.throws(() => validateWorkbookIdentity({ ...identity, studentName: '名'.repeat(41) }));
  assert.deepEqual(fitWorkbookImage(1200, 600, 500, 280), { width: 500, height: 250 });
  assert.deepEqual(fitWorkbookImage(600, 1200, 500, 280), { width: 140, height: 280 });
});
test("真正 PDF 為 A4、中文嵌入、空項及評分、長文自動分頁，不以字數限制下载", async () => {
  const blank = emptyWorkbook(); const bytes = await createWorkbookPDF({ draft: blank, identity });
  const { pdf } = await loadWorkbookPDFResources(); const document = await pdf.PDFDocument.load(bytes);
  assert.ok(document.getPageCount() >= 3); assert.ok(Math.abs(document.getPages()[0].getWidth() - 595.28) < .1);
  const font = document.context.lookup(document.getPages()[0].node.Resources().lookup(pdf.PDFName.of('Font')).values()[0]);
  assert.equal(font.lookup(pdf.PDFName.of('Subtype')).toString(), '/Type0');
  const partial = emptyWorkbook(); partial.answers['essay-body'] = '中文測試長文。'.repeat(1200); partial.ratings['rating-1'] = 5;
  const long = await pdf.PDFDocument.load(await createWorkbookPDF({ draft: partial, identity }));
  assert.ok(long.getPageCount() > document.getPageCount());
});
test("不支援字元、缺圖、解碼失敗及生成取消都停止輸出並指出位置", async () => {
  const unsupported = emptyWorkbook(); unsupported.answers['day1-1'] = '😀';
  await assert.rejects(createWorkbookPDF({ draft: unsupported, identity }), /姊妹學校.*U\+1F600/);
  const photoDraft = emptyWorkbook(); photoDraft.photoIds = ['one'];
  await assert.rejects(createWorkbookPDF({ draft: photoDraft, identity }), /配圖已失效/);
  await assert.rejects(createWorkbookPDF({ draft: photoDraft, identity, photos: [{ record: { photoId: 'one' }, title: '測試景點' }], exportPhoto: async () => { throw new Error('broken'); } }), /配圖 1.*測試景點/);
  await assert.rejects(createWorkbookPDF({ draft: emptyWorkbook(), identity, isRelevant: () => false }), /取消/);
  let valid = true; const draft = emptyWorkbook(); draft.answers['essay-body'] = '長文'.repeat(3000);
  await assert.rejects(createWorkbookPDF({ draft, identity, isRelevant: () => valid, onProgress: message => { if (message.includes('圖文文章')) valid = false; } }), /取消/);
});

test("PDF 完成後最後相片核對期間的跨分頁修改仍阻止下載", async () => {
  const repository = memoryWorkbookRepository();
  const initial = await repository.read(); initial.draft.photoIds = ['photo-one']; await repository.write(initial.draft, initial.revision);
  const app = appHarness({ hash: '#workbook/essay', workbookRepository: repository,
    initialPhotos: [{ photoId: 'photo-one', attractionId: 'future-school', width: 10, height: 10, writeId: 'first', blob: new Blob(['synthetic']), createdAt: '2026-11-05T04:00:00Z' }],
    initialState: { version: 3, checkIns: { 'future-school': { attractionId: 'future-school', checkedInAt: '2026-11-05T04:00:00Z', verified: false, method: 'manual' } } },
    workbookPDFService: async () => new Uint8Array([1, 2, 3]) });
  let hashes = 0, downloaded = false;
  app.environment.crypto = { subtle: { digest: async (...args) => {
    if (++hashes === 2) { const external = await repository.read(); external.draft.answers['essay-title'] = '最後核對途中修改'; await repository.write(external.draft, external.revision); }
    return crypto.subtle.digest(...args);
  } } };
  app.environment.document.createElement = tag => ({ click() { if (tag === 'a') downloaded = true; }, remove() {} });
  await app.controller.start();
  await app.click('workbook-export-open');
  for (const [key, value] of Object.entries(identity)) await app.events.get('document:input')({ target: { dataset: { workbookIdentity: key }, value, isConnected: true, matches: selector => selector === '[data-workbook-identity]' } });
  app.confirmation.handler = async () => true;
  await app.click('workbook-pdf');
  assert.equal(hashes, 2); assert.equal(downloaded, false); assert.equal(app.controller.getPageSnapshot().status, 'conflict');
});

test("手冊清除失敗如實顯示部分完成，打卡仍保留且可備份", async () => {
  const base = memoryWorkbookRepository(); const record = await base.read(); record.draft.answers['essay-title'] = '應保留'; await base.write(record.draft, record.revision);
  const repository = { ...base, clear: async () => { throw Error('fixture clear failure'); } };
  const app = appHarness({ workbookRepository: repository, initialState: { version: 3, checkIns: { 'future-school': { attractionId: 'future-school', checkedInAt: '2026-11-05T04:00:00Z', verified: false, method: 'manual' } } } });
  await app.controller.start(); app.confirmation.handler = async () => true; await app.click('reset-all');
  assert.match(app.element('#toast').textContent, /學習手冊未能清除.*打卡紀錄仍保留/);
  assert.equal((await base.read()).draft.answers['essay-title'], '應保留');
  app.navigate('#workbook'); await tick(); assert.equal(app.controller.getPageSnapshot().answers['essay-title'], '應保留');
  assert.equal(app.controller.getPageSnapshot().status, 'error');
});
