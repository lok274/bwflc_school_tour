import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { WORKBOOK_PARTS, WORKBOOK_RATINGS, WORKBOOK_FIELDS, WORKBOOK_INSTRUCTIONS, emptyWorkbook, validateWorkbook, workbookProgress, workbookResumePart, missingWorkbookFields, createWorkbookBackup, parseWorkbookBackup, WORKBOOK_ACTIVITY } from "../src/workbook-data.js";
import { createWorkbookSession, WorkbookConflict } from "../src/workbook-storage.js";
import { createWorkbookPDF, loadWorkbookPDFResources, validateWorkbookIdentity, fitWorkbookImage } from "../src/workbook-pdf.js";
import { memoryWorkbookRepository } from "./helpers/workbook-repository.js";
import { appHarness } from "./helpers/browser-environment.js";

const tick = () => new Promise(setImmediate);
const identity = { studentName: "合成測試學生", className: "測試班", studentNumber: "007" };
const fieldTarget = (id, value) => ({ dataset: { workbookField: id }, value, isConnected: true, matches: query => query === '[data-workbook-field]' });
async function chooseBackup(app, text) {
  const target = { dataset: { workbookRestore: '' }, files: [new File([text], 'backup.json', { type: 'application/json' })], value: '', isConnected: true, matches: query => query === '[data-workbook-restore]' };
  app.events.get('document:change')({ target }); await tick();
}

test("繼續填寫優先超限部分、首個未填部分，完成後回文章，空稿不顯示", async () => {
  const draft = emptyWorkbook(); assert.equal(workbookResumePart(draft), null);
  draft.answers['essay-title'] = '題目'; assert.equal(workbookResumePart(draft), 'essay');
  draft.answers['essay-body'] = '正文'; assert.equal(workbookResumePart(draft), 'share');
  draft.answers['day3-2'] = '舊'.repeat(1001); assert.equal(workbookResumePart(draft), 'day3');
  for (const field of WORKBOOK_FIELDS) draft.answers[field.id] = '已填';
  for (const field of WORKBOOK_RATINGS) draft.ratings[field.id] = 3;
  assert.equal(workbookResumePart(draft), 'essay');
  const app = appHarness({ hash: '#workbook', workbookRepository: memoryWorkbookRepository(draft) }); await app.controller.start();
  const html = app.element('#app').innerHTML;
  assert.doesNotMatch(html, /JSON/);
  assert.equal((html.match(/data-workbook-backup-toggle/g) || []).length, 1);
  assert.match(html, /id="wb-backup-panel"[^>]* hidden/);
  assert.match(html, /已自動暫存，可以稍後繼續/);
  assert.match(html, /href="#workbook\/essay">繼續填寫/);
  await app.click('workbook-backup-toggle'); assert.equal(app.controller.getPageSnapshot().backupOpen, true);
  await app.click('workbook-backup-toggle'); assert.equal(app.controller.getPageSnapshot().backupOpen, false);
});

test("暫存失敗切頁留在原頁，保留輸入；重試交易完成才離開", async () => {
  const base = memoryWorkbookRepository(); let fail = true;
  const app = appHarness({ hash: '#workbook/essay', workbookRepository: { ...base, write: (...args) => fail ? Promise.reject(Error('容量不足')) : base.write(...args) } });
  await app.controller.start();
  const target = fieldTarget('essay-body', '仍要保留');
  await app.events.get('document:input')({ target }); await tick();
  const html = app.element('#app').innerHTML;
  app.navigate('#home'); await tick();
  assert.equal(app.environment.location.hash, '#workbook/essay');
  assert.equal(app.element('#app').innerHTML, html);
  assert.equal(app.element('#app').inert, false);
  assert.equal(app.controller.getPageSnapshot().answers['essay-body'], '仍要保留');
  assert.match(app.element('#toast').textContent, /留在原頁/);
  assert.match(app.element('#workbook-save-status').textContent, /暫存失敗/);
  fail = false; await app.click('workbook-retry');
  app.navigate('#home'); await tick();
  assert.equal(app.environment.location.hash, '#home');
  const reopened = appHarness({ hash: '#workbook', workbookRepository: base }); await reopened.controller.start();
  assert.equal(reopened.controller.getPageSnapshot().answers['essay-body'], '仍要保留');
});

test("背景擷取中文組字、未發input的欄值，離開提醒只在未存時；取消離開不清身份", async () => {
  const base = memoryWorkbookRepository(); let release, writes = 0;
  const app = appHarness({ hash: '#workbook/essay', workbookRepository: { ...base, write: (...args) => { writes++; return new Promise(resolve => { release = async () => resolve(await base.write(...args)); }); } } });
  await app.controller.start();
  const target = fieldTarget('essay-body', '背景中文輸入');
  app.environment.document.querySelectorAll = query => query === '[data-workbook-field]' ? [target] : [];
  app.environment.document.visibilityState = 'hidden';
  await app.events.get('document:compositionstart')({ target });
  const html = app.element('#app').innerHTML;
  app.events.get('document:visibilitychange')(); await tick();
  assert.equal(app.element('#app').innerHTML, html);
  assert.equal(app.controller.getPageSnapshot().answers['essay-body'], '背景中文輸入');
  assert.equal(app.controller.getPageSnapshot().status, 'saving');
  const personal = { dataset: { workbookIdentity: 'studentName' }, value: '合成身份', isConnected: true, matches: query => query === '[data-workbook-identity]' };
  await app.events.get('document:input')({ target: personal });
  let prevented = false;
  const event = { preventDefault() { prevented = true; } };
  app.events.get('window:beforeunload')(event);
  assert.equal(prevented, true); assert.equal(event.returnValue, '');
  assert.equal(app.controller.getPageSnapshot().identity.studentName, '合成身份');
  assert.equal(writes, 1);
  await release(); await tick();
  assert.equal(app.controller.getPageSnapshot().status, 'saved');
  prevented = false; app.events.get('window:beforeunload')({ preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  app.events.get('window:pagehide')();
  assert.equal(app.controller.getPageSnapshot().identity.studentName, '');
  const reopened = createWorkbookSession({ repository: base }); await reopened.load();
  assert.equal(reopened.snapshot().draft.answers['essay-body'], '背景中文輸入');
});

test("切頁待存期間的模型讀取不提前離頁，交易失敗仍恢復原頁", async () => {
  const base = memoryWorkbookRepository(); let rejectWrite;
  const app = appHarness({ hash: '#workbook/essay', workbookRepository: { ...base, write: () => new Promise((_resolve, reject) => { rejectWrite = reject; }) } });
  await app.controller.start();
  await app.events.get('document:input')({ target: fieldTarget('essay-body', '待存原稿') }); await tick();
  app.environment.location.hash = '#home';
  assert.equal(app.controller.getPageSnapshot().view, 'workbook');
  app.events.get('window:hashchange')();
  assert.equal(app.controller.getPageSnapshot().view, 'workbook');
  assert.equal(app.controller.getPageSnapshot().part.id, 'essay');
  rejectWrite(Error('測試交易失敗')); await tick();
  assert.equal(app.environment.location.hash, '#workbook/essay');
  assert.equal(app.controller.getPageSnapshot().answers['essay-body'], '待存原稿');
});

test("備份只含文字自評且檔名有時間，載入先預覽確認，取消及失效檔不改草稿", async () => {
  const initial = emptyWorkbook(); initial.answers['essay-body'] = '原稿';
  const base = memoryWorkbookRepository(initial); let blob, name;
  const app = appHarness({ hash: '#workbook/essay', workbookRepository: base, urlService: { createObjectURL(value) { blob = value; return 'blob:fixture'; }, revokeObjectURL() {} } });
  app.environment.document.createElement = () => ({ click() { name = this.download; }, remove() {} });
  await app.controller.start(); await app.click('workbook-backup-toggle'); await app.click('workbook-backup');
  assert.match(name, /^學習手冊備份-\d{8}-\d{6}-\d{3}\.json$/);
  assert.deepEqual(Object.keys(JSON.parse(await blob.text())).sort(), ['activity', 'answers', 'format', 'ratings']);
  const next = emptyWorkbook(); next.answers['day1-1'] = '備份答案'; next.ratings['rating-1'] = 4;
  await chooseBackup(app, createWorkbookBackup(next));
  assert.equal(app.controller.getPageSnapshot().restorePreview.textCount, 1);
  assert.equal(app.controller.getPageSnapshot().restorePreview.ratingCount, 1);
  assert.equal((await base.read()).draft.answers['essay-body'], '原稿');
  app.confirmation.handler = async () => false; await app.click('workbook-restore-confirm');
  assert.equal(app.controller.getPageSnapshot().answers['essay-body'], '原稿');
  app.confirmation.handler = async () => true; await app.click('workbook-restore-confirm');
  assert.equal((await base.read()).draft.answers['day1-1'], '備份答案');
  assert.equal((await base.read()).draft.answers['essay-body'], '');
  await chooseBackup(app, '{broken'); assert.equal(app.controller.getPageSnapshot().restorePreview, null);
  assert.equal((await base.read()).draft.answers['day1-1'], '備份答案');
  let finishRead;
  const file = { size: 20, text: () => new Promise(resolve => { finishRead = resolve; }) };
  app.events.get('document:change')({ target: { dataset: { workbookRestore: '' }, files: [file], value: '', isConnected: true } });
  await app.click('workbook-backup-toggle'); finishRead(createWorkbookBackup(initial)); await tick();
  assert.equal(app.controller.getPageSnapshot().backupOpen, false);
  assert.equal(app.controller.getPageSnapshot().restorePreview, null);
});

test("舊備份全文載入待修改，多部分可切頁縮短；超過舊上限拒絕，不覆蓋其他頁版本", async () => {
  const base = memoryWorkbookRepository(), app = appHarness({ hash: '#workbook/essay', workbookRepository: base });
  await app.controller.start(); await app.click('workbook-backup-toggle');
  const draft = emptyWorkbook(); draft.answers['essay-body'] = '舊'.repeat(10000); draft.answers['day1-1'] = '文'.repeat(1001);
  await chooseBackup(app, createWorkbookBackup(draft)); app.confirmation.handler = async () => true;
  await app.click('workbook-restore-confirm');
  assert.equal(app.controller.getPageSnapshot().answers['essay-body'].length, 10000);
  assert.equal(app.controller.getPageSnapshot().status, 'error');
  assert.equal((await base.read()).draft.answers['essay-body'], '');
  app.navigate('#workbook/day1'); await tick(); assert.equal(app.controller.getPageSnapshot().part.id, 'day1');
  await app.events.get('document:input')({ target: fieldTarget('day1-1', '縮短日記') });
  app.navigate('#workbook/essay'); await tick();
  await app.events.get('document:input')({ target: fieldTarget('essay-body', '縮短文章') }); await tick();
  assert.equal((await base.read()).draft.answers['day1-1'], '縮短日記');
  assert.equal(app.controller.getPageSnapshot().status, 'saved');
  await app.click('workbook-backup-toggle');
  const invalid = JSON.parse(createWorkbookBackup(draft)); invalid.answers['essay-body'] += '超';
  await chooseBackup(app, JSON.stringify(invalid)); assert.equal(app.controller.getPageSnapshot().restorePreview, null);
  assert.equal(app.controller.getPageSnapshot().answers['essay-body'], '縮短文章');
  await chooseBackup(app, createWorkbookBackup(emptyWorkbook()));
  app.confirmation.handler = async () => { const external = await base.read(); external.draft.answers['essay-title'] = '別頁最新'; await base.write(external.draft, external.revision); return true; };
  await app.click('workbook-restore-confirm');
  assert.equal((await base.read()).draft.answers['essay-title'], '別頁最新');
  assert.equal(app.controller.getPageSnapshot().status, 'conflict');
});
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
  const long = structuredClone(parsed); long.answers['essay-body'] = "中".repeat(1001); assert.throws(() => parseWorkbookBackup(JSON.stringify(long)), /超過 1,000/);
  const invalidRating = structuredClone(parsed); invalidRating.ratings['rating-1'] = 0; assert.throws(() => parseWorkbookBackup(JSON.stringify(invalidRating)), /評分/);
  const unknown = emptyWorkbook(); unknown.answers.unknown = ""; assert.throws(() => validateWorkbook(unknown));
});
test("文字欄1,000字元可保存與還原，1,001字元不能保存、還原或生成PDF", async () => {
  const draft = emptyWorkbook();
  for (const field of WORKBOOK_FIELDS) draft.answers[field.id] = '中'.repeat(1000);
  assert.deepEqual(validateWorkbook(draft).answers, draft.answers);
  assert.deepEqual(parseWorkbookBackup(createWorkbookBackup(draft)).answers, draft.answers);
  const repository = memoryWorkbookRepository();
  await repository.write(draft, 0);
  draft.answers['essay-body'] += '超';
  assert.throws(() => validateWorkbook(draft), /正文.*1,000/);
  await assert.rejects(repository.write(draft, 1), /正文.*1,000/);
  assert.equal((await repository.read()).draft.answers['essay-body'].length, 1000);
  assert.throws(() => parseWorkbookBackup(createWorkbookBackup(draft)), /正文.*1,000/);
  await assert.rejects(createWorkbookPDF({ draft, identity }), /正文.*1,000/);
});

test("超限舊草稿讀取和備份保留全文，逐欄縮短後才保存，輸入不截斷舊文", async () => {
  const legacy = emptyWorkbook(); legacy.answers['essay-body'] = '舊'.repeat(1400); legacy.answers['day1-1'] = '文'.repeat(1500);
  const repository = memoryWorkbookRepository(legacy), app = appHarness({ hash: '#workbook/essay', workbookRepository: repository });
  await app.controller.start();
  assert.equal(app.controller.getPageSnapshot().initialized, true);
  assert.equal(app.controller.getPageSnapshot().status, 'error');
  assert.match(app.controller.getPageSnapshot().error, /圖文文章：正文.*第一日日記.*原文已保留/);
  assert.match(app.element('#app').innerHTML, /maxlength="1000"/);
  const input = async (field, text) => {
    const target = { dataset: { workbookField: field }, value: text, matches: query => query === '[data-workbook-field]', isConnected: true };
    await app.events.get('document:input')({ target }); return target;
  };
  const shorter = await input('essay-body', '舊'.repeat(1399));
  assert.equal(shorter.value.length, 1399);
  assert.equal(app.controller.getPageSnapshot().answers['essay-body'].length, 1399);
  const added = await input('essay-body', '舊'.repeat(1400)); assert.equal(added.value.length, 1399);
  assert.equal((await repository.read()).draft.answers['essay-body'].length, 1400);
  const backup = JSON.parse(createWorkbookBackup({ answers: app.controller.getPageSnapshot().answers, ratings: app.controller.getPageSnapshot().ratings, photoIds: [] }));
  assert.equal(backup.answers['essay-body'].length, 1399); assert.equal(backup.answers['day1-1'].length, 1500);
  await input('essay-body', '舊'.repeat(1000)); await tick();
  assert.equal(app.controller.getPageSnapshot().status, 'error');
  assert.equal((await repository.read()).draft.answers['essay-body'].length, 1400);
  await input('day1-1', '文'.repeat(1000)); await tick();
  assert.equal(app.controller.getPageSnapshot().status, 'saved');
  assert.equal((await repository.read()).draft.answers['essay-body'].length, 1000);
  assert.equal((await repository.read()).draft.answers['day1-1'].length, 1000);
});

test("中文組字完成才套用1,000字元上限，字數提示同步且不截斷代理字元", async () => {
  const app = appHarness({ hash: '#workbook/essay' }); await app.controller.start();
  const target = { dataset: { workbookField: 'essay-body' }, value: '中'.repeat(1001), matches: query => query === '[data-workbook-field]', isConnected: true };
  await app.events.get('document:input')({ target, isComposing: true });
  assert.equal(target.value.length, 1001); assert.equal(app.controller.getPageSnapshot().answers['essay-body'], '');
  await app.events.get('document:input')({ target, isComposing: false }); await tick();
  assert.equal(target.value.length, 1000); assert.equal(app.controller.getPageSnapshot().answers['essay-body'].length, 1000);
  assert.match(app.element('#wb-count-essay-body').textContent, /最多 1,000 字元/);
  target.value = '中'.repeat(999) + '\u{20BB7}';
  await app.events.get('document:input')({ target }); await tick();
  assert.equal(target.value, '中'.repeat(999));
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
test("真正 PDF 為 A4、中文嵌入、空項及評分、上限內長文自動分頁，不設最低字數", async () => {
  const blank = emptyWorkbook(); const bytes = await createWorkbookPDF({ draft: blank, identity });
  const { pdf } = await loadWorkbookPDFResources(); const document = await pdf.PDFDocument.load(bytes);
  assert.ok(document.getPageCount() >= 3); assert.ok(Math.abs(document.getPages()[0].getWidth() - 595.28) < .1);
  const font = document.context.lookup(document.getPages()[0].node.Resources().lookup(pdf.PDFName.of('Font')).values()[0]);
  assert.equal(font.lookup(pdf.PDFName.of('Subtype')).toString(), '/Type0');
  const partial = emptyWorkbook(); partial.answers['essay-body'] = '中文測試長文。\n'.repeat(100); partial.ratings['rating-1'] = 5;
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
  let valid = true; const draft = emptyWorkbook(); draft.answers['essay-body'] = '長文'.repeat(500);
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
