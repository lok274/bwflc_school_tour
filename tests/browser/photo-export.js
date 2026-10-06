import { createAppController } from "../../src/controller.js";
import { createPhotoRepository, compressPhoto, createPhotoExport, createTravelCard } from "../../src/photos.js";
import { createDefaultState, STORAGE_KEY } from "../../src/state.js";

const summary=document.querySelector("#test-summary"),results=document.querySelector("#test-results");
const require=(value,message)=>{if(!value)throw new Error(message);};
const pause=()=>new Promise(resolve=>setTimeout(resolve,10));
async function until(condition){const end=Date.now()+10000;while(!condition()){if(Date.now()>end)throw new Error("等待操作逾時");await pause();}}
let passed=0,failed=0;
async function check(label,run){const item=document.createElement("li");try{await run();passed++;item.textContent=`通過：${label}`;}catch(error){failed++;item.textContent=`失敗：${label} — ${error.message}`;}results.append(item);}
const databaseName=`photo-export-fixture-${crypto.randomUUID()}`;
const repository=createPhotoRepository({databaseName});
const data=new Map(),state=createDefaultState();
const id="future-school";
state.checkIns[id]={attractionId:id,method:"manual",verified:false,checkedInAt:new Date().toISOString()};
data.set(STORAGE_KEY,JSON.stringify(state));
const storage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
const canvas=document.createElement("canvas");canvas.width=2000;canvas.height=1500;canvas.getContext("2d").fillRect(0,0,2000,1500);
const source=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
for(const photoId of ["first","second","third"]){const record=await compressPhoto(source,id);await repository.savePhotoRecord({...record,photoId,writeId:photoId});}
await repository.savePhotoRecord({...await compressPhoto(source,"sun-yat-sen"),photoId:"foreign",writeId:"foreign"});
let converted=[],convertOverride=null,shareMode="success",shares=[],activation=[];
const shareNavigator={onLine:true,canShare:()=>true,share:({files})=>{
  shares.push(files);activation.push(navigator.userActivation.isActive);
  return shareMode==="success"?Promise.resolve():Promise.reject(Object.assign(new Error("fixture"),{name:shareMode}));
}};
const photoService={...repository,compressPhoto,createTravelCard,createPhotoExport:async (...args)=>{
  const file=await (convertOverride||createPhotoExport)(...args);converted.push(file);return file;
}};
location.hash=`#attraction/${id}`;
const controller=createAppController({environment:{document,window,location,localStorage:storage,URL,requestAnimationFrame,indexedDB,navigator:shareNavigator},photoService,
  feedbackService:{showToast(){},askConfirmation:async options=>options.isRelevant(),celebrateStamp(){}}});
await controller.start();
const dialog=document.querySelector("#photo-export-dialog");
function click(selector){const target=document.querySelector(selector);require(target,`沒有按鈕 ${selector}`);target.click();}
async function ready(){await until(()=>dialog.open && document.querySelector("#photo-export-content").dataset.status==="ready");}
const close=()=>click("[data-photo-export-close]");
const trustedClick=async selector=>{if(globalThis.clickTrusted)await globalThis.clickTrusted(selector);else click(selector);};
await check("逐張儲存保留 App 相片，純 JPEG 的尺寸及檔名正確",async()=>{
  require(document.querySelector("[data-photo-export-selected]").disabled,"空選取仍可匯出");
  click('[data-photo-export][data-photo-id="first"]');await ready();
  require(converted.length===1,"沒有逐張準備");
  const file=converted[0],bytes=new Uint8Array(await file.arrayBuffer()),image=await createImageBitmap(file);
  require(file instanceof File && file.type==="image/jpeg" && bytes[0]===255 && bytes[1]===216,"輸出不是 JPEG");
  require(image.width===1600 && image.height===1200,"圖片尺寸被修改");image.close();
  require(file.name.includes("first") && file.name.endsWith(".jpg"),"檔名缺少獨立 ID");
  require(document.querySelectorAll("[data-photo-export-download]").length===1,"下載入口錯誤");
  require((await repository.getAllPhotoRecords()).length===4,"App 內照片被刪除");
  require(document.documentElement.scrollWidth<=innerWidth,"手機畫面橫向溢出");
  if(globalThis.captureExportPreview)await globalThis.captureExportPreview();
  close();
});
await check("逐張選取、全選、取消選取及多選匯出只包含本站",async()=>{
  click('[data-photo-select="first"]');require(controller.getPageSnapshot().photos.filter(photo=>photo.selected).length===1,"逐張選取失敗");
  click('[data-photo-select-all]');require(controller.getPageSnapshot().photos.every(photo=>photo.selected),"全選失敗");
  click('[data-photo-select-none]');require(document.querySelector('[data-photo-export-selected]').disabled,"取消選取失敗");
  click('[data-photo-select="first"]');click('[data-photo-select="second"]');
  converted=[];click('[data-photo-export-selected]');await ready();
  require(converted.length===2 && converted.every(file=>!file.name.includes("foreign")),"多選混入其他景點");
  require(document.querySelectorAll('[data-photo-export-download]').length===2,"多張下載入口錯誤");
});
await check("最終分享按鈕保留真正 user activation，成功提示不聲稱已存入相簿",async()=>{
  await trustedClick('[data-photo-export-share]');await until(()=>document.querySelector('#photo-export-status').textContent.includes("交由系統處理"));
  require(shares.at(-1).length===2,"分享檔案數量錯誤");
  if(globalThis.clickTrusted)require(activation.at(-1),"分享失去使用者操作權限");
  require(!document.querySelector('#photo-export-status').textContent.includes("已存入相簿"),"虚報相簿儲存");
});
await check("分享取消與失敗保留重試及下載，沒有自動下載",async()=>{
  for(const mode of ["AbortError","NotAllowedError"]){shareMode=mode;await trustedClick('[data-photo-export-share]');await ready();
    require(document.querySelectorAll('[data-photo-export-download]').length===2,"分享失敗丟失下載入口");
    require(document.querySelector('#photo-export-status').textContent.includes(mode==="AbortError"?"取消分享":"重試"),"分享錯誤提示不正確");
  }
  shareMode="success";close();
});
await check("不支援分享仍可下載實際 JPEG，檔案能重新解碼",async()=>{
  shareNavigator.canShare=()=>false;
  click('[data-photo-export][data-photo-id="first"]');await ready();
  require(!document.querySelector('[data-photo-export-share]'),"不支援卻顯示分享");
  const before=shares.length;
  if(globalThis.downloadExportFixture)await globalThis.downloadExportFixture('[data-photo-export-download="0"]');
  else await trustedClick('[data-photo-export-download="0"]');
  require(shares.length===before,"下載錯誤開啟分享");close();shareNavigator.canShare=()=>true;
});
await check("第二張轉換失敗時沒有部分下載入口",async()=>{
  let count=0;convertOverride=async (...args)=>{if(++count===2)throw new Error("測試損壞圖片");return createPhotoExport(...args);};
  click('[data-photo-export-selected]');await until(()=>document.querySelector('#photo-export-content').dataset.status==="error");
  require(document.querySelector('#photo-export-status').textContent.includes("第 2 張"),"錯誤未指出相片");
  require(!document.querySelector('[data-photo-export-download]'),"留下部分下載");close();convertOverride=null;
});
await check("準備中原生取消及離頁，延遲回覆不能重新開啟視窗；選取清除",async()=>{
  for(const leave of [false,true]){
    let release;convertOverride=()=>new Promise(resolve=>{release=()=>resolve(new File(["pixels"],"pending.jpg",{type:"image/jpeg"}));});
    click('[data-photo-export][data-photo-id="first"]');await until(()=>release);
    if(leave){location.hash="#prepare";controller.render();}
    else dialog.requestClose();
    release();await pause();require(!dialog.open,"延遲回覆重新開啟匯出");
    location.hash=`#attraction/${id}`;controller.render();await pause();
  }
  require(controller.getPageSnapshot().photos.every(photo=>!photo.selected),"離頁仍保留選取");convertOverride=null;
});
await check("準備中刪照，匯出即時失效且其他照片保留",async()=>{
  let release;convertOverride=()=>new Promise(resolve=>{release=()=>resolve(new File(["pixels"],"pending.jpg",{type:"image/jpeg"}));});
  click('[data-photo-export][data-photo-id="first"]');await until(()=>release);
  // Programmatic click models a concurrent deletion while the modal is preparing.
  click('[data-photo-delete][data-photo-id="first"]');await until(()=>!dialog.open);
  release();await pause();require(!dialog.open,"刪照後恢復匯出");
  await until(()=>controller.getPageSnapshot().photos.length===2);require((await repository.getAllPhotoRecords()).length===3,"其他照片受影響");convertOverride=null;
});
await repository.clearPhotoRecords();indexedDB.deleteDatabase(databaseName);
summary.textContent=`${passed} 通過，${failed} 失敗`;summary.dataset.done="true";summary.dataset.failed=String(failed);
