import test from "node:test";
import assert from "node:assert/strict";
import { createPhotoActions } from "../src/photo-actions.js";
import { createOperationGuard } from "../src/operations.js";
import { createDataStore } from "../src/store.js";
import { createViews } from "../src/views.js";
import { createPhotoExport } from "../src/photos.js";
import { getDownloadLocationHint } from "../src/formatting.js";
import { jpegHeader } from "./helpers/image-fixtures.js";
import { checkedState } from "./helpers/browser-environment.js";

test("一鍵下載只產生一個檔案：單張 JPEG、多張 ZIP；取消後不能下載", async () => {
  for (const ids of [["first"], ["first", "second"]]) {
    const app = setup();
    await app.actions.preparePhotoExport(id, ids);
    assert.equal(app.downloads.length, 0);
    const html = createViews().renderPhotoExport(app.actions.getPhotoExportModel());
    assert.match(html, /data-photo-export-download-all/);
    app.actions.downloadAllPhotoExport();
    assert.equal(app.downloads.length, 1);
    assert.ok(app.downloads[0].endsWith(ids.length === 1 ? ".jpg" : ".zip"));
    if (ids.length > 1) assert.match(app.actions.getPhotoExportModel().delivery.locationHint, /解壓 ZIP/);
    app.actions.cancelPhotoExport();
    app.actions.downloadAllPhotoExport();
    assert.equal(app.downloads.length, 1);
  }
});

test("打包途中取消不得恢復匯出結果或觸發下載", async () => {
  const app = setup();
  let release;
  const convert = app.services.createPhotoExport;
  app.services.createPhotoExport = async (...args) => {
    const file = await convert(...args);
    file.arrayBuffer = () => new Promise(resolve => { release = () => resolve(new ArrayBuffer(0)); });
    return file;
  };
  const preparing = app.actions.preparePhotoExport(id, ["first", "second"]);
  while (!release) await new Promise(resolve => setTimeout(resolve, 0));
  app.actions.cancelPhotoExport();
  // The archive retains its own file list; finish both pending reads.
  release();
  const firstRelease = release;
  while (release === firstRelease) await new Promise(resolve => setTimeout(resolve, 0));
  release();
  await preparing;
  assert.equal(app.actions.getPhotoExportModel(), null);
  app.actions.downloadAllPhotoExport();
  assert.equal(app.downloads.length, 0);
});

const id = "future-school";
const fixture = photoId => ({ attractionId:id, photoId, writeId:photoId,
  blob:new Blob([jpegHeader(100, 80)],{type:"image/jpeg"}), width:100,height:80 });
function setup() {
  let current = true, resetting = false;
  const store = createDataStore({storage:{getItem:()=>JSON.stringify(checkedState()),setItem(){}},onSaveError(){}});
  const records = new Map(["first","second"].map(key=>[key,fixture(key)]));
  const refreshPhotos = async () => { store.replacePhotos([...records.values()]); return true; };
  store.replacePhotos([...records.values()]);
  const operations = createOperationGuard({isResetting:()=>resetting});
  const models = [], files = [], urls = [], revoked = [], downloads = [], toasts = [];
  const navigator = {}, services = {
    createPhotoExport:async (record, name) => { const file = new File([record.blob],name,{type:"image/jpeg"});files.push(file);return file; },
    deletePhotoRecord:async (attractionId, photoId) => { for (const [key,record] of records) if (record.attractionId===attractionId && (!photoId || key===photoId)) records.delete(key); },
    getPhotoRecord:async (_,key)=>records.get(key),
    createTravelCard:async () => new Blob(["card"], { type: "image/png" })
  };
  const document = { createElement:()=>({click(){downloads.push(this.download);},remove(){}}),body:{append(){}} };
  let hidden = 0;
  const actions = createPhotoActions({
    getCheckIn:store.getCheckIn,getPhoto:store.getPhoto,getPhotoVersion:store.getPhotoVersion,
    canUseAttraction:candidate=>current && candidate===id && !resetting,operations,
    capturePageToken:()=>({}),isPageCurrent:()=>current,photoService:services,refreshPhotos,
    render(){},showToast:(message,tone)=>toasts.push({message,tone}),askConfirmation:async ()=>true,navigator,
    showPhotoExport:model=>models.push(model),hidePhotoExport:()=>{hidden++;},
    document,
    window:{setTimeout:()=>1,clearTimeout(){}},URL:{createObjectURL:file=>{urls.push(file);return `blob:test-${urls.length}`;},revokeObjectURL:url=>revoked.push(url)}
  });
  return {actions,store,records,services,navigator,models,files,operations,downloads,revoked,document,toasts,
    hidden:()=>hidden,leave:()=>{current=false;actions.validatePhotoExport();},
    reset:()=>{resetting=true;operations.invalidateAllOperations();actions.validatePhotoExport();},
    replace:async()=>{await refreshPhotos();actions.validatePhotoExport();}};
}
test("逐張與多選匯出依選取順序製作 JPEG，model 不含 File 或 Blob", async () => {
  const app = setup();
  await app.actions.preparePhotoExport(id,["second","first","second"]);
  const model = app.actions.getPhotoExportModel();
  assert.equal(model.status,"ready"); assert.equal(model.count,2);
  assert.match(model.files[0].name,/second\.jpg$/);assert.match(model.files[1].name,/first\.jpg$/);
  assert.ok(app.files.every(file=>file.type==="image/jpeg"));
  assert.ok(model.files.every(file=>!(file instanceof Blob) && Object.isFrozen(file)));
  assert.equal(app.downloads.length,0);
  await app.actions.preparePhotoExport(id,["first"]);
  assert.equal(app.actions.getPhotoExportModel().count,1);
  assert.equal(app.records.size,2);
});
test("空選取、缺失 ID、跨景點及離頁不能準備匯出", async () => {
  const app=setup();
  app.records.set("foreign",{...fixture("foreign"),attractionId:"sun-yat-sen"});await app.replace();
  for (const ids of [[],[undefined],[""],["missing"],["first","foreign"]]) await app.actions.preparePhotoExport(id,ids);
  await app.actions.preparePhotoExport("sun-yat-sen",["foreign"]);
  assert.equal(app.files.length,0);assert.equal(app.actions.getPhotoExportModel(),null);
  app.leave();await app.actions.preparePhotoExport(id,["first"]);assert.equal(app.files.length,0);
});
test("第二張轉換失敗時整組失效，不保留第一張下載入口", async () => {
  const app=setup();let calls=0;
  const convert=app.services.createPhotoExport;
  app.services.createPhotoExport=async (...args)=>{if(++calls===2)throw new Error("圖片損壞");return convert(...args);};
  await app.actions.preparePhotoExport(id,["first","second"]);
  const model=app.actions.getPhotoExportModel();
  assert.equal(model.status,"error");assert.deepEqual(model.files,[]);assert.match(model.message,/第 2 張.*圖片損壞/);
  app.actions.downloadPhotoExport(0);await app.actions.sharePhotoExport();assert.equal(app.downloads.length,0);
});
test("分享在最終按鈕的同步操作內呼叫，重複點擊不開第二個選單", async () => {
  const app=setup();let insideClick=false,resolve,calls=0;
  app.navigator.canShare=({files})=>files.length===2;
  app.navigator.share=({files})=>{assert.equal(insideClick,true);assert.equal(files.length,2);calls++;return new Promise(done=>{resolve=done;});};
  await app.actions.preparePhotoExport(id,["first","second"]);
  insideClick=true;const sharing=app.actions.sharePhotoExport();insideClick=false;
  assert.equal(calls,1);assert.equal(app.actions.getPhotoExportModel().status,"sharing");
  await app.actions.sharePhotoExport();app.actions.downloadPhotoExport(0);assert.equal(calls,1);assert.equal(app.downloads.length,0);
  resolve();await sharing;
  assert.match(app.actions.getPhotoExportModel().message,/交由系統處理/);
  assert.doesNotMatch(app.actions.getPhotoExportModel().message,/相片已儲存|已存入相簿/);assert.equal(app.records.size,2);
});
test("分享取消或失敗不自動下載，保留準備結果以便重試", async () => {
  for(const name of ["AbortError","NotAllowedError","DataError"]) {
    const app=setup();app.navigator.canShare=()=>true;
    app.navigator.share=async ()=>{throw Object.assign(new Error("failure"),{name});};
    await app.actions.preparePhotoExport(id,["first","second"]);await app.actions.sharePhotoExport();
    const model=app.actions.getPhotoExportModel();assert.equal(model.status,"ready");assert.equal(model.files.length,2);
    assert.match(model.message,name==="AbortError"?/取消分享/:/重試/);assert.equal(app.downloads.length,0);assert.equal(app.records.size,2);
    app.navigator.share=async ()=>{};await app.actions.sharePhotoExport();assert.equal(app.actions.getPhotoExportModel().status,"ready");
  }
});
test("不支援分享或 canShare 拒絕時提供逐張下載，只有點擊才下載", async () => {
  for(const capability of [undefined,()=>false,()=>{throw new Error("unsupported");}]) {
    const app=setup();let shares=0;app.navigator.share=async ()=>{shares++;};app.navigator.canShare=capability;
    await app.actions.preparePhotoExport(id,["first","second"]);
    assert.equal(app.actions.getPhotoExportModel().canShare,false);await app.actions.sharePhotoExport();assert.equal(shares,0);
    assert.equal(app.downloads.length,0);
    for(const index of [-1,1.2,99,NaN])app.actions.downloadPhotoExport(index);
    assert.equal(app.downloads.length,0);app.actions.downloadPhotoExport(1);
    assert.equal(app.downloads.length,1);assert.match(app.downloads[0],/second\.jpg$/);
    assert.match(app.actions.getPhotoExportModel().message,/已開始下載/);
    assert.match(app.actions.getPhotoExportModel().delivery.locationHint,/下載/);
    app.actions.cancelPhotoExport();assert.equal(app.revoked.length,1);
  }
});
test("準備途中取消、刪照、離頁及清除資料，晚回覆不能重新開啟匯出", async () => {
  for(const cancel of [app=>app.actions.cancelPhotoExport(),app=>app.leave(),app=>app.reset(),async app=>{app.records.delete("first");await app.replace();}]) {
    const app=setup();let release;
    app.services.createPhotoExport=()=>new Promise(resolve=>{release=()=>resolve(new File(["pixels"],"fixture.jpg",{type:"image/jpeg"}));});
    const preparing=app.actions.preparePhotoExport(id,["first","second"]);
    await cancel(app);release();await preparing;
    assert.equal(app.actions.getPhotoExportModel(),null);assert.equal(app.downloads.length,0);
    assert.ok(!app.models.some(model=>model.status==="ready"));
  }
});
test("相片版本變更令已準備匯出失效；延遲分享回覆不能恢復視窗", async () => {
  const app=setup();let resolve;
  app.navigator.canShare=()=>true;app.navigator.share=()=>new Promise(done=>{resolve=done;});
  await app.actions.preparePhotoExport(id,["first"]);const sharing=app.actions.sharePhotoExport();
  app.records.set("first",{...fixture("first"),writeId:"replacement"});await app.replace();resolve();await sharing;
  assert.equal(app.actions.getPhotoExportModel(),null);assert.equal(app.downloads.length,0);
});
test("匯出畫面跳脫檔名及錯誤，不在未就緒時提供有效下載", () => {
  const views=createViews();
  const html=views.renderPhotoExport({status:"sharing",message:"<script>bad</script>",canShare:false,files:[{index:0,name:'<img src=x>.jpg'}]});
  assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img/);assert.match(html,/data-photo-export-download="0" disabled/);
});

test("下載位置指引分辨 iPhone、iPad、Android 及其他裝置，不宣稱精確儲存路徑", () => {
  for (const device of [
    { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" },
    { userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)" },
    { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)", platform: "MacIntel", maxTouchPoints: 5 }
  ]) {
    const hint = getDownloadLocationHint(device);
    assert.equal(typeof hint, "string");
    assert.match(hint, /檔案/); assert.match(hint, /瀏覽/); assert.match(hint, /下載項目/);
    assert.match(hint, /iCloud Drive/); assert.match(hint, /iPhone|iPad/);
    assert.doesNotMatch(hint, /已存入|已完成下載|Mozilla/);
  }
  const android = getDownloadLocationHint({ userAgent: "Mozilla/5.0 (Linux; Android 15) Chrome/129.0" });
  assert.match(android, /我的檔案|檔案/); assert.match(android, /下載/); assert.match(android, /Chrome/);
  for (const device of [{}, { userAgent: "Mozilla/5.0 (Windows NT 10.0)" }, { userAgent: '<img src=x onerror="bad">' }]) {
    const hint = getDownloadLocationHint(device);
    assert.match(hint, /下載/); assert.match(hint, /瀏覽器/);
    assert.doesNotMatch(hint, /iCloud|Chrome|<img|已存入|已完成下載/);
  }
});

test("逐張下載保留凍結的檔名與位置提示，沒有宣稱已完成或已存入相簿", async () => {
  const app = setup();
  app.navigator.userAgent = "Mozilla/5.0 (Linux; Android 15) Chrome/129.0";
  await app.actions.preparePhotoExport(id, ["first", "second"]);
  assert.equal(app.actions.getPhotoExportModel().delivery, null);
  app.actions.downloadPhotoExport(0);
  let model = app.actions.getPhotoExportModel();
  assert.deepEqual(model.delivery, { kind: "download", filename: app.downloads[0], locationHint: getDownloadLocationHint(app.navigator) });
  assert.ok(Object.isFrozen(model.delivery));
  assert.throws(() => { model.delivery.filename = "modified.jpg"; }, TypeError);
  assert.match(model.message, /已開始下載第 1 張/); assert.match(model.message, /瀏覽器下載列表.*確認/);
  assert.equal(model.status, "ready"); assert.equal(model.files.length, 2); assert.equal(app.records.size, 2);
  const html = createViews().renderPhotoExport(model);
  assert.match(html, /class="photo-export-notice"/); assert.match(html, /aria-label="下載與儲存位置"/);
  assert.match(html, /id="photo-export-location"/); assert.match(html, /aria-describedby="photo-export-location"/);
  assert.ok(html.includes(model.delivery.filename)); assert.match(html, /我的檔案|檔案/);
  assert.match(html, /不能確認|無法確認/); assert.doesNotMatch(html, /已完成下載|已存入相簿/);
  app.actions.downloadPhotoExport(1);
  model = app.actions.getPhotoExportModel();
  assert.equal(app.downloads.length, 2); assert.equal(model.delivery.filename, app.downloads[1]);
  assert.match(model.message, /已開始下載第 2 張/);
});

test("下載失敗清除上次提示，不產生成功紀錄；重新點擊可再下載", async () => {
  const app = setup();
  await app.actions.preparePhotoExport(id, ["first", "second"]);
  app.actions.downloadPhotoExport(0);
  assert.ok(app.actions.getPhotoExportModel().delivery);
  app.document.createElement = () => ({ click() { throw Error("blocked"); }, remove() {} });
  app.actions.downloadPhotoExport(1);
  let model = app.actions.getPhotoExportModel();
  assert.equal(model.delivery, null); assert.match(model.message, /未能開始下載/);
  assert.equal(app.downloads.length, 1); assert.equal(model.files.length, 2);
  assert.doesNotMatch(createViews().renderPhotoExport(model), /class="photo-export-notice"/);
  app.document.createElement = () => ({ click() { app.downloads.push(this.download); }, remove() {} });
  app.actions.downloadPhotoExport(1);
  model = app.actions.getPhotoExportModel();
  assert.equal(app.downloads.length, 2); assert.match(model.delivery.filename, /second\.jpg$/);
});

test("分享成功顯示由使用者選擇的儲存位置，取消及失敗沒有成功位置提示", async () => {
  const app = setup();
  app.navigator.canShare = () => true;
  await app.actions.preparePhotoExport(id, ["first", "second"]);
  for (const errorName of ["AbortError", "NotAllowedError"]) {
    app.actions.downloadPhotoExport(0);
    assert.ok(app.actions.getPhotoExportModel().delivery);
    app.navigator.share = async () => { throw Object.assign(Error("cancelled or failed"), { name: errorName }); };
    await app.actions.sharePhotoExport();
    const model = app.actions.getPhotoExportModel();
    assert.equal(model.delivery, null);
    assert.match(model.message, errorName === "AbortError" ? /取消分享/ : /重試/);
  }
  const downloadCount = app.downloads.length;
  app.navigator.share = async () => {};
  await app.actions.sharePhotoExport();
  const model = app.actions.getPhotoExportModel();
  assert.equal(model.delivery.kind, "share"); assert.ok(Object.isFrozen(model.delivery));
  assert.equal("filename" in model.delivery, false);
  assert.match(model.delivery.locationHint, /儲存影像/); assert.match(model.delivery.locationHint, /儲存到檔案/);
  assert.match(model.delivery.locationHint, /選擇|所選/); assert.match(model.delivery.locationHint, /確認/);
  assert.match(model.message, /交由系統處理/);
  assert.doesNotMatch(createViews().renderPhotoExport(model), /已完成下載|已存入相簿/);
  assert.equal(app.downloads.length, downloadCount);
});

test("重新準備及取消、離頁、重設或相片替換清除下載位置提示", async () => {
  for (const invalidate of [
    app => app.actions.cancelPhotoExport(), app => app.leave(), app => app.reset(),
    async app => { app.records.set("first", { ...fixture("first"), writeId: "replacement" }); await app.replace(); }
  ]) {
    const app = setup(); await app.actions.preparePhotoExport(id, ["first"]);
    app.actions.downloadPhotoExport(0); assert.ok(app.actions.getPhotoExportModel().delivery);
    await invalidate(app); assert.equal(app.actions.getPhotoExportModel(), null);
    assert.equal(app.downloads.length, 1);
  }
  const app = setup(); await app.actions.preparePhotoExport(id, ["first"]);
  app.actions.downloadPhotoExport(0); await app.actions.preparePhotoExport(id, ["second"]);
  assert.equal(app.actions.getPhotoExportModel().delivery, null); assert.equal(app.downloads.length, 1);
});

test("位置提示中的動態檔名及內容均以文字跳脫", () => {
  const html = createViews().renderPhotoExport({
    status: "ready", message: "已開始下載", canShare: false, files: [],
    delivery: { kind: "download", filename: '<img src=x onerror="bad">.jpg', locationHint: '<script>bad()</script>' }
  });
  assert.match(html, /&lt;img/); assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<img|<script/);
});

test("旅程卡提示包含 PNG 檔名及手機位置指引，只稱下載已開始", async () => {
  const app = setup(); app.navigator.userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)";
  await app.actions.downloadTravelCard(id, "first");
  assert.equal(app.downloads.length, 1); assert.match(app.downloads[0], /旅程卡\.png$/);
  const toast = app.toasts.at(-1);
  assert.ok(toast.message.includes(app.downloads[0])); assert.match(toast.message, /已開始/);
  assert.match(toast.message, /檔案/); assert.match(toast.message, /下載項目/);
  assert.doesNotMatch(toast.message, /已完成下載|已存入相簿/);
});
test("JPEG 匯出以 92% 重繪、保留尺寸、清除解碼物件且不保留原檔", async () => {
  const oldDocument=globalThis.document,oldBitmap=globalThis.createImageBitmap;
  let closed=0,outputType="image/jpeg",canvas,quality,type,drawn=0;
  globalThis.createImageBitmap=async ()=>({width:100,height:80,close(){closed++;}});
  globalThis.document={createElement:()=>canvas={getContext:()=>({fillRect(){},drawImage(){drawn++;}}),toBlob(callback,mime,value){type=mime;quality=value;callback(new Blob(["new pixels"],{type:outputType}));}}};
  try {
    const file=await createPhotoExport(fixture("first"),'景點/first.jpg');
    assert.equal(file.type,"image/jpeg");assert.equal(file.name,"景點-first.jpg");
    assert.equal(await file.text(),"new pixels");assert.equal(type,"image/jpeg");assert.equal(quality,0.92);
    assert.deepEqual([canvas.width,canvas.height],[100,80]);assert.equal(drawn,1);assert.equal(closed,1);
    outputType="image/png";await assert.rejects(createPhotoExport(fixture("first"),"bad.jpg"),/未能輸出 JPEG/);assert.equal(closed,2);
    globalThis.createImageBitmap=async ()=>({width:1601,height:100,close(){closed++;}});
    await assert.rejects(createPhotoExport(fixture("first"),"bad.jpg"),/尺寸無效/);assert.equal(closed,3);
  } finally {globalThis.document=oldDocument;globalThis.createImageBitmap=oldBitmap;}
});
