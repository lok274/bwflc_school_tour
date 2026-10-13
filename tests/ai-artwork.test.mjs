import test from "node:test";
import assert from "node:assert/strict";
import { createSignedAIArtwork, prepareAIArtwork, validateArtworkIdentity, artworkRecordLabel } from "../src/photos.js";
import { createAIArtworkController, renderAIArtwork } from "../src/ai-artwork-controller.js";
import { REQUIRED_CHECK_IN_LOCATIONS } from "../src/data.js";
import { checkedState, appHarness } from "./helpers/browser-environment.js";
import { jpegHeader, pngBytes, webpBytes } from "./helpers/image-fixtures.js";

const personal = { studentName: "合成同學", className: "測試班", studentNumber: "007" };
const complete = (verified = false) => ({ ready: true, records: REQUIRED_CHECK_IN_LOCATIONS.map(({ id }) => ({ ...checkedState([id]).checkIns[id], method: verified ? "gps" : "manual", verified })) });
const source = (width = 1200, height = 900) => new Blob([jpegHeader(width, height)], { type: "image/jpeg" });
async function withCanvas(width, height, action) {
  const previous = { document: globalThis.document, createImageBitmap: globalThis.createImageBitmap, FontFace: globalThis.FontFace };
  const canvases = [], draws = [], texts = []; let closed = 0;
  globalThis.FontFace = class { async load() { return this; } };
  globalThis.document = { fonts: { add() {} }, createElement() {
    const ctx = { fillRect() {}, drawImage(...args) { draws.push(args); }, fillText(text, x, y) { texts.push({ text, x, y }); },
      measureText(text) { return { width: Array.from(text).length * parseInt(this.font || "34") }; } };
    const canvas = { getContext: () => ctx, toBlob(callback, type) { callback(new Blob([pngBytes(this.width, this.height)], { type })); } };
    canvases.push(canvas); return canvas;
  } };
  globalThis.createImageBitmap = async () => ({ width, height, close() { closed++; } });
  try { await action({ canvases, draws, texts, closed: () => closed }); }
  finally { Object.assign(globalThis, previous); }
}

test("署名身份必填，保留前置零，按字元核對上限，控制字元不被靜默移除", () => {
  assert.deepEqual(validateArtworkIdentity(personal), personal);
  for (const key of Object.keys(personal)) assert.throws(() => validateArtworkIdentity({ ...personal, [key]: " " }), /請填寫/);
  assert.equal(validateArtworkIdentity({ ...personal, studentName: "名".repeat(40) }).studentName.length, 40);
  for (const [key, limit] of [["studentName", 40], ["className", 20], ["studentNumber", 20]]) assert.throws(() => validateArtworkIdentity({ ...personal, [key]: "字".repeat(limit + 1) }), /最多/);
  assert.throws(() => validateArtworkIdentity({ ...personal, studentName: "甲\u202e乙" }), /控制字元/);
});

test("正式五站與核實狀態依有效紀錄；學校不參與，測試作品沒有正式完成標示", () => {
  assert.match(artworkRecordLabel(complete(true)), /本機打卡紀錄：5／5.*GPS 已核實/);
  assert.match(artworkRecordLabel(complete()), /含未核實手動記錄/);
  assert.throws(() => artworkRecordLabel({ records: complete().records.slice(1) }), /失效/);
  const invalid=complete(true); invalid.records[0].verified=false; assert.throws(()=>artworkRecordLabel(invalid),/失效/);
  for(const testKind of ["rehearsal","diagnostics"]) assert.doesNotMatch(artworkRecordLabel({ testKind, records: [] }), /本機打卡紀錄|GPS 已核實/);
});

for (const [width, height] of [[1600, 900], [900, 1600], [200, 3000], [1200, 1200]]) {
  test(`署名 PNG ${width}×${height} 完整等比例置中，獨立署名條與正確輸出寬度`, () => withCanvas(width, height, async fixture => {
    const blob = await createSignedAIArtwork({ artwork: source(width,height), identity: personal, completion: complete(), dateLabel: "2026年11月5日至7日" });
    const canvas=fixture.canvases[0], imageHeight=Math.min(1350,Math.round(1080*height/width));
    assert.equal(blob.type,"image/png"); assert.equal(canvas.width,1080); assert.ok(canvas.height>imageHeight);
    const [,x,y,w,h]=fixture.draws[0]; assert.equal(w/h,width/height);
    assert.ok(x>=0 && y>=0 && x+w<=1080 && y+h<=imageHeight);
    assert.ok(fixture.texts.every(item=>item.y>imageHeight));
    assert.ok(fixture.texts.some(item=>item.text==="學號：007")); assert.equal(fixture.closed(),1);
  }));
}
test("長中文姓名及班別換行，完整字元保留，署名條增加高度", () => withCanvas(1200,900,async fixture=>{
  await createSignedAIArtwork({ artwork: source(), identity: {...personal,studentName:"名".repeat(40),className:"班".repeat(20)},completion:complete(true) });
  const joined=fixture.texts.map(item=>item.text).join(""); assert.ok(joined.includes("姓名："+"名".repeat(40)));
  assert.ok(joined.includes("班別："+"班".repeat(20))); assert.ok(fixture.texts.filter(item=>item.text.includes("名")).length>=2);
  assert.ok(fixture.canvases[0].height>1300);
}));
test("不支援字元指出欄位，未生成缺字圖片；紀錄失效先拒絕", ()=>withCanvas(1200,900,async fixture=>{
  await assert.rejects(createSignedAIArtwork({artwork:source(),identity:{...personal,studentName:"名🙂"},completion:complete()}),/姓名.*不支援.*🙂/);
  await assert.rejects(createSignedAIArtwork({artwork:source(),identity:personal,completion:{records:[]}}),/失效/);
  assert.equal(fixture.canvases.length,0);
}));
test("成品 preflight 拒絕損壞、動態、尺寸及檔案上限；合法成品只回傳記憶體結果", ()=>withCanvas(1200,900,async fixture=>{
  for(const input of [new Blob(["broken"],{type:"image/png"}),source(8193,10),new Blob([new Uint8Array(20*1024*1024+1)],{type:"image/jpeg"}),new Blob([webpBytes(10,10,{canvas:[10,10],animation:true})],{type:"image/webp"})]) await assert.rejects(prepareAIArtwork(input));
  assert.equal(fixture.canvases.length,0);
  const prepared=await prepareAIArtwork(source()); assert.equal(prepared.width,1200); assert.ok(prepared.blob instanceof Blob); assert.equal(fixture.closed(),1);
}));
test("生成途中失效及繪製失敗釋放圖片，不輸出舊作品", ()=>withCanvas(1200,900,async fixture=>{
  let count=0; await assert.rejects(createSignedAIArtwork({artwork:source(),identity:personal,completion:complete(),isRelevant:()=>++count<4}),/已取消/);
  assert.equal(fixture.closed(),1);
}));

function harness() {
  let completion=complete(), allowed=true, accept=true;
  const live=new Map(), revoked=[], downloads=[], calls=[];
  const app=appHarness({urlService:{createObjectURL(blob){const url=`blob:art-${live.size}-${calls.length}`;live.set(url,blob);return url},revokeObjectURL(url){live.delete(url);revoked.push(url)}},
    controllerFactory: options=>createAIArtworkController({...options,getCompletion:()=>completion,canUse:()=>allowed,askConfirmation:async opts=>typeof accept==="function"?accept(opts):accept,showToast(){}})});
  app.photoService.prepareAIArtwork=async file=>({blob:file,width:1200,height:900});
  app.photoService.createSignedAIArtwork=async options=>{calls.push(options);return new Blob(["signed"],{type:"image/png"})};
  app.element("a").click=function(){downloads.push({name:this.download,url:this.href})};
  function fill(key,value=personal[key]) { const target={dataset:{artworkField:key},value};app.controller.input(target);return target; }
  async function ready(){assert.ok(app.controller.open());await app.controller.selectFile(source());Object.keys(personal).forEach(key=>fill(key));await app.controller.preview();}
  return {...app,fill,ready,live,revoked,downloads,calls,setCompletion(value){completion=value},setAllowed(value){allowed=value},setAccept(value){accept=value}};
}
test("成品及身份只有確定署名後下載，model 沒有 Blob，關閉保留草稿與釋放網址",async()=>{
  const app=harness();assert.equal(app.controller.getModel().status,"");await app.ready();const model=app.controller.getModel();assert.ok(model.canDownload);assert.ok(Object.isFrozen(model.identity));assert.equal(JSON.stringify(model).includes("signed"),false);
  assert.doesNotMatch(renderAIArtwork(model), /圖片只在這部裝置處理|先選取成品，填妥資料後預覽/);
  app.controller.close();assert.equal(app.live.size,0);assert.equal(app.controller.getModel().identity.studentNumber,"007");
  app.controller.open();await app.controller.download();assert.equal(app.downloads.length,1);assert.doesNotMatch(app.downloads[0].name,/合成同學|測試班|007/);
  assert.deepEqual(app.savedState().checkIns,{});app.controller.clear();assert.equal(app.controller.getModel().hasArtwork,false);assert.equal(app.controller.getModel().identity.studentName,"");
});
test("選檔取消或錯誤保留原稿及已完成預覽；成功更換才使預覽失效",async()=>{
 const app=harness();await app.ready();const before=app.controller.getModel();await app.controller.selectFile(null);assert.equal(app.controller.getModel().sourceUrl,before.sourceUrl);
 app.photoService.prepareAIArtwork=async()=>{throw Error("損壞圖片")};await app.controller.selectFile(source());assert.equal(app.controller.getModel().sourceUrl,before.sourceUrl);assert.ok(app.controller.getModel().canDownload);assert.match(app.controller.getModel().status,/原有成品/);
 app.photoService.prepareAIArtwork=async blob=>({blob,width:800,height:600});await app.controller.selectFile(source(800,600));assert.equal(app.controller.getModel().canDownload,false);
});
test("身份編輯使舊預覽失效，超限不截斷且停用；HTML 跳脫與中文組字保留輸入框",async()=>{
 const app=harness();await app.ready();const field=app.fill("studentName","名".repeat(41));assert.equal(app.controller.getModel().identity.studentName.length,41);assert.ok(!app.controller.getModel().canPreview);assert.ok(!app.controller.getModel().canDownload);
 app.controller.input({...field,value:"組字中"},true);assert.equal(app.controller.getModel().identity.studentName.length,41);
 app.fill("studentName",'"><img src=x>');assert.doesNotMatch(renderAIArtwork(app.controller.getModel()),/<img src=x>/);assert.match(renderAIArtwork(app.controller.getModel()),/&lt;img src=x&gt;/);
});
test("下载确认暂时收起署名視窗，取消返回草稿；異常亦可重試",async()=>{
 const app=harness();await app.ready();app.setAccept(async()=>{assert.ok(!app.element("#ai-artwork-dialog").open);return false});await app.controller.download();assert.equal(app.downloads.length,0);assert.ok(app.element("#ai-artwork-dialog").open);assert.ok(app.controller.getModel().canDownload);
 app.setAccept(async()=>{throw Error("確認失敗")});await app.controller.download();assert.ok(app.element("#ai-artwork-dialog").open);assert.match(app.controller.getModel().status,/未能下載/);
});
for(const action of ["close","clear","leave","undo","identity","artwork"]) test(`署名生成途中 ${action} 不恢復舊預覽或下載`,async()=>{
 const app=harness();await app.ready();let release;app.photoService.createSignedAIArtwork=()=>new Promise(resolve=>{release=()=>resolve(new Blob(["old"]))});
 const pending=app.controller.preview();await Promise.resolve();assert.ok(release);
 if(action==="close")app.controller.close();if(action==="clear")app.controller.clear();if(action==="leave"){app.setAllowed(false);app.controller.clear()}
 if(action==="undo"){app.setCompletion({ready:false,records:[]});app.controller.reconcile()}
 if(action==="identity")app.fill("studentName","新稿");if(action==="artwork")await app.controller.selectFile(source(900,800));
 release();await pending;assert.equal(app.controller.getModel().canDownload,false);assert.equal(app.downloads.length,0);
});
test("五站重新打卡或核實狀態改動須重做預覽；沒有原照也可署名",async()=>{
 const app=harness();await app.ready();app.setCompletion(complete(true));app.controller.reconcile();assert.equal(app.controller.getModel().canDownload,false);await app.controller.preview();assert.ok(app.controller.getModel().canDownload);
 app.setCompletion({ready:false,records:[]});assert.equal(app.controller.open(),false);app.controller.reconcile();assert.ok(!app.element("#ai-artwork-dialog").open);
});

test("極窄成品接受後不縮圖改變原比例", ()=>withCanvas(1,8192,async fixture=>{
 const file=source(1,8192),prepared=await prepareAIArtwork(file);assert.equal(prepared.blob,file);assert.equal(prepared.width/prepared.height,1/8192);assert.equal(fixture.canvases.length,0);assert.equal(fixture.closed(),1);
}));

async function inlineHarness() {
  let serial = 0;
  const live = new Set(), downloads = [], calls = [];
  const ids = REQUIRED_CHECK_IN_LOCATIONS.map(item => item.id);
  const app = appHarness({ hash: "#memories/ai", initialState: checkedState(ids),
    initialPhotos: ids.map(id => ({ attractionId: id, photoId: id, writeId: id, blob: source(), width: 1200, height: 900 })),
    urlService: { createObjectURL() { const url = `blob:inline-${++serial}`; live.add(url); return url; }, revokeObjectURL(url) { live.delete(url); } } });
  app.photoService.prepareAIArtwork = async file => ({ blob: file, width: 1200, height: 900 });
  app.photoService.createSignedAIArtwork = async options => { calls.push(options); return new Blob(["signed"], { type: "image/png" }); };
  app.element("a").click = function () { downloads.push(this.download); };
  app.confirmation.handler = async options => options.isRelevant();
  const root = app.element("#app"), fields = {};
  for (const key of Object.keys(personal)) {
    const field = app.element(`#artwork-${key}`);
    Object.assign(field, { id: `artwork-${key}`, dataset: { artworkField: key }, value: "", selectionStart: 0, selectionEnd: 0,
      focus() { app.environment.document.activeElement = this; },
      matches: query => query === "[data-artwork-field]",
      setSelectionRange(start, end, direction) { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; } });
    fields[key] = field;
  }
  app.element("#memory-artwork-inline").querySelectorAll = () => Object.values(fields);
  const emit = (type, event) => root.listeners[type][0].callback(event);
  const fill = (key, value = personal[key]) => { fields[key].value = value; emit("input", { target: fields[key] }); return fields[key]; };
  const action = attribute => {
    const target = { isConnected: true, disabled: false, matches: query => query === `[data-artwork-${attribute}]`, closest() { return this; } };
    return emit("click", { target });
  };
  const model = () => app.controller.getPageSnapshot().artwork;
  const escape = isComposing => app.events.get("document:keydown")({ key: "Escape", isComposing, preventDefault() {} });
  async function ready() {
    await app.click("memory-artwork-open");
    emit("change", { target: { isConnected: true, value: "file", files: [source()], matches: query => query === "[data-artwork-file]" } });
    await new Promise(setImmediate);
    Object.keys(personal).forEach(key => fill(key));
    await action("preview");
  }
  await app.controller.start();
  return { app, ids, fields, emit, fill, action, model, escape, ready, live, downloads, calls };
}

test("頁內素材選圖與署名互斥，切換保留兩種草稿，收起不開視窗，離頁清除", async () => {
  const { app, ids, model, ready, live } = await inlineHarness();
  await ready(); assert.equal(model().visible, true); assert.equal(app.element("#ai-artwork-dialog").open, false);
  assert.ok(Object.isFrozen(model().identity)); assert.match(app.element("#app").innerHTML, /aria-expanded="true" aria-controls="memory-artwork-inline"/);
  await app.click("memory-summary-open"); assert.equal(model().visible, false); assert.equal(model().identity.studentNumber, "007"); assert.equal(live.size, 0);
  await app.click("memory-pick", ids[0]);
  app.events.get("document:change")({ target: { isConnected: true, checked: true, dataset: { summarySelect: ids[0], summaryPhotoId: ids[0] }, matches: query => query === "[data-summary-select]" } });
  assert.equal(app.controller.getPageSnapshot().summaryCard.requiredSelectedCount, 1);
  await app.click("memory-artwork-open"); assert.equal(app.controller.getPageSnapshot().memoryOverlay, null); assert.ok(model().canDownload);
  await app.click("memory-artwork-open"); assert.equal(model().visible, false); assert.equal(live.size, 0);
  await app.click("memory-summary-open"); assert.equal(app.controller.getPageSnapshot().summaryCard.requiredSelectedCount, 1);
  await app.click("memory-summary-open"); assert.equal(app.controller.getPageSnapshot().memoryOverlay, null);
  app.navigate("#home"); app.navigate("#memories/ai"); assert.equal(model().identity.studentNumber, ""); assert.equal(model().hasArtwork, false);
});

test("頁內署名組字延後全頁重畫與 Escape，切換擷取組字，過期事件不改寫草稿", async () => {
  const { app, fields, emit, model, escape, ready } = await inlineHarness(); await ready();
  const field = fields.studentName; field.focus(); emit("compositionstart", { target: field }); field.value = "組字中的合成姓名";
  emit("input", { target: field, isComposing: true }); const html = app.element("#app").innerHTML;
  app.controller.render(); escape(false); assert.equal(app.element("#app").innerHTML, html); assert.equal(model().visible, true);
  await app.click("memory-summary-open"); assert.equal(model().identity.studentName, field.value);
  field.value = "已過期的輸入"; field.isConnected = false; emit("compositionend", { target: field });
  assert.equal(model().identity.studentName, "組字中的合成姓名");
  await app.click("memory-artwork-open"); escape(true); assert.equal(model().visible, true); escape(false); assert.equal(model().visible, false);
});

test("頁內署名下載確認暫時收起並保留結果、身份、讀屏狀態；取消不下載或寫身份", async () => {
  const { app, model, action, escape, ready, downloads } = await inlineHarness(); await ready();
  app.confirmation.handler = async options => {
    assert.equal(model().visible, false); assert.equal(model().sourceUrl, null); assert.equal(app.element("#ai-artwork-dialog").open, false);
    assert.match(options.message, /姓名、班別及學號/); escape(false); return false;
  };
  await action("download"); assert.equal(model().visible, true); assert.equal(model().identity.studentNumber, "007"); assert.ok(model().canDownload);
  assert.deepEqual(downloads, []); assert.ok(!JSON.stringify(app.savedState()).includes("合成同學"));
  app.confirmation.handler = async options => options.isRelevant(); await action("download");
  assert.equal(downloads.length, 1); assert.ok(downloads[0].endsWith(".png"));
  assert.doesNotMatch(downloads[0], /合成同學|測試班|007/);
});

test("頁內署名生成時切換到素材選圖，不恢復舊結果；身份及原成品仍可重試", async () => {
  const { app, action, model, ready, downloads } = await inlineHarness(); await ready();
  let release; app.photoService.createSignedAIArtwork = () => new Promise(resolve => { release = () => resolve(new Blob(["old"], { type: "image/png" })); });
  const pending = action("preview"); assert.ok(release);
  await app.click("memory-summary-open"); release(); await pending;
  await app.click("memory-artwork-open"); assert.equal(model().resultUrl, null); assert.ok(model().hasArtwork); assert.equal(model().identity.studentNumber, "007");
  assert.match(model().status, /已取消/); assert.deepEqual(downloads, []);
});
