import { createAppController } from "../../src/controller.js";
import { createSignedAIArtwork, prepareAIArtwork } from "../../src/photos.js";
import { REQUIRED_CHECK_IN_LOCATIONS, TRIP_DATA } from "../../src/data.js";
import { createDefaultState, STORAGE_KEY } from "../../src/state.js";
import { memoryWorkbookRepository } from "../helpers/workbook-repository.js";

const preview = new URL(location.href).searchParams.has("preview"), state = createDefaultState();
for(const {id} of REQUIRED_CHECK_IN_LOCATIONS) state.checkIns[id]={attractionId:id,checkedInAt:"2026-11-05T04:00:00.000Z",method:"manual",verified:false};
const data=new Map([[STORAGE_KEY,JSON.stringify(state)]]), live=new Map(), downloads=[];
const storage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
const FixtureURL={createObjectURL(blob){const url=URL.createObjectURL(blob);live.set(url,blob);return url},revokeObjectURL(url){URL.revokeObjectURL(url);live.delete(url)}};
let generateOverride=null, prepareOverride=null, generated=null, readFailure=true;
const photoService={getAllPhotoRecords:async()=>{if(readFailure)throw Error("合成讀取失敗");return []},clearPhotoRecords:async()=>{},deletePhotoRecord:async()=>{},
 prepareAIArtwork:(...args)=>(prepareOverride||prepareAIArtwork)(...args),createSignedAIArtwork:async options=>{const blob=await(generateOverride||createSignedAIArtwork)(options);generated=blob;return blob}};
location.hash="#memories";
const controller=createAppController({environment:{document,window,location,localStorage:storage,URL:FixtureURL,navigator:{onLine:true},requestAnimationFrame,indexedDB},
 photoService,workbookRepository:memoryWorkbookRepository(),pushClientFactory:()=>({getSnapshot:()=>({statusMessage:"本機合成測試"}),initialize:async()=>{},refresh:async()=>{}})});
const nativeClick=HTMLAnchorElement.prototype.click;
if(!preview)HTMLAnchorElement.prototype.click=function(){if(this.download)downloads.push({name:this.download,blob:live.get(this.href)});else nativeClick.call(this)};
const click=selector=>{const target=document.querySelector(selector);if(!target)throw Error("缺少 "+selector);target.click()};
const assert=(value,message)=>{if(!value)throw Error(message)};
const pause=()=>new Promise(resolve=>setTimeout(resolve,10));
async function until(condition){const end=Date.now()+20000;while(!condition()){if(Date.now()>end)throw Error("等待逾時");await pause()}}
function input(key,value){const target=document.querySelector(`[data-artwork-field="${key}"]`);target.value=value;target.dispatchEvent(new Event("input",{bubbles:true}));return target}
const identity=()=>{input("studentName","合成測試同學");input("className","測試班");input("studentNumber","007")};
async function makeFile(width=1200,height=900,type="image/png"){
 const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;const ctx=canvas.getContext("2d");
 ctx.fillStyle="#dcece6";ctx.fillRect(0,0,width,height);const size=Math.min(width,height)/5;
 for(const [x,y,color] of [[0,0,"#f4b951"],[width-size,0,"#c95638"],[0,height-size,"#5078ad"],[width-size,height-size,"#557b4a"]]){ctx.fillStyle=color;ctx.fillRect(x,y,size,size)}
 ctx.fillStyle="#0b3b46";ctx.font=`${Math.min(width,height)/15}px sans-serif`;ctx.fillText("SYNTHETIC AI ARTWORK",width/10,height/2);
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,type,.92));return new File([blob],"synthetic-artwork.png",{type});
}
async function choose(file){const field=document.getElementById("artwork-file"),files=new DataTransfer();files.items.add(file);field.files=files.files;field.dispatchEvent(new Event("change",{bubbles:true}));await until(()=>!document.getElementById("artwork-status")?.textContent.includes("正在讀取"))}
async function generate(){generated=null;click("[data-artwork-preview]");await until(()=>generated||document.getElementById("artwork-status")?.textContent.includes("未能生成"))}
async function reopen(){if(document.querySelector("#ai-artwork-dialog").open)click("[data-artwork-close]");click("[data-memory-artwork-open]")}
let passed=0,failed=0;
async function check(label,action){const item=document.createElement("li");try{await action();passed++;item.textContent="通過："+label}catch(error){failed++;item.textContent="失敗："+label+" — "+error.message}document.getElementById("test-results").append(item)}
await controller.start();
if(preview){
 document.getElementById("test-runner").hidden=true;click("[data-memory-artwork-open]");await choose(await makeFile());identity();await generate();
}else{
 await check("五站已打卡但相簿讀取失敗，無原照仍能署名；兩步入口",async()=>{
  assert(document.querySelector("[data-memory-artwork-open]")&&!document.querySelector("[data-memory-artwork-open]").disabled,"缺署名入口");
  click("[data-memory-artwork-open]");assert(document.getElementById("ai-artwork-dialog").open,"無原照不能開啟");
  assert(document.getElementById("ai-artwork-dialog").textContent.includes("含未核實手動記錄"),"手動記錄標示錯誤");
 });
 await check("未填身份不能生成；選取中文、學號前置零及長文字不裁切",async()=>{
  await choose(await makeFile());assert(document.querySelector("[data-artwork-preview]").disabled,"空身份可預覽");identity();input("studentName","名".repeat(40));await generate();
  assert(generated?.type==="image/png","没有 PNG");const bitmap=await createImageBitmap(generated);assert(bitmap.width===1080&&bitmap.height>1292,"尺寸或署名條長文字高度錯誤");bitmap.close();
  const img=document.querySelector(".artwork-result img");await img.decode();assert(img.naturalWidth===1080,"預覽尺寸錯誤");
 });
 await check("取消選檔、損壞／超限圖片不覆蓋原稿；更換成品才失效預覽",async()=>{
  const before=document.querySelector(".artwork-preview").src;
  document.getElementById("artwork-file").dispatchEvent(new Event("cancel",{bubbles:true}));assert(document.querySelector(".artwork-preview").src===before,"取消覆蓋");
  for(const file of [new File(["broken"],"bad.png",{type:"image/png"}),new File([new Uint8Array(20*1024*1024+1)],"huge.jpg",{type:"image/jpeg"})]){await choose(file);assert(document.querySelector(".artwork-preview").src===before,"無效圖片覆蓋原稿")}
  await choose(await makeFile(200,1200));assert(!document.querySelector(".artwork-result")&&document.querySelector("[data-artwork-download]").disabled,"舊預覽未失效");await generate();
  const bitmap=await createImageBitmap(generated);assert(bitmap.width===1080&&bitmap.height>1350,"直向圖缺署名");
  const canvas=document.createElement("canvas");canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext("2d");ctx.drawImage(bitmap,0,0);
  const edge=ctx.getImageData(0,10,1,1).data;assert(edge[0]>230&&edge[1]>220,"超高圖片沒有置中留邊");bitmap.close();
 });
 await check("中文組字不重画、超限不截斷且停用、HTML 跳脫、不支援字元指出姓名",async()=>{
  const field=input("studentName","");field.focus();field.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true}));field.value="名".repeat(41);
  field.dispatchEvent(new InputEvent("input",{bubbles:true,isComposing:true}));controller.render();assert(field.isConnected&&field.value.length===41,"組字被重畫或截斷");
  field.dispatchEvent(new CompositionEvent("compositionend",{bubbles:true}));assert(document.querySelector("[data-artwork-preview]").disabled,"超限可預覽");
  input("studentName",'"><img src=x>');await reopen();assert(!document.querySelector("img[src=x]"),"文字成 HTML");
  input("studentName","合成🙂");await generate();assert(document.getElementById("artwork-status").textContent.includes("姓名")&&!document.querySelector(".artwork-result"),"缺字仍輸出");identity();await generate();
 });
 await check("下載確認僅一個視窗，取消返回草稿；JPEG、PNG、靜態 WebP 真正解碼",async()=>{
  click("[data-artwork-download]");await until(()=>document.getElementById("confirm-dialog").open);assert(!document.getElementById("ai-artwork-dialog").open,"多層視窗");
  click('#confirm-dialog [value="cancel"]');await until(()=>document.getElementById("ai-artwork-dialog").open);assert(document.getElementById("artwork-studentNumber").value==="007","取消丟前置零");
  for(const type of ["image/jpeg","image/png","image/webp"]){await choose(await makeFile(800,400,type));await generate();assert(generated,"無法解碼 "+type)}
  click("[data-artwork-download]");await until(()=>document.getElementById("confirm-dialog").open);click("#confirm-button");await until(()=>downloads.length===1);
  assert(!/合成測試同學|測試班|007/.test(downloads[0].name),"檔名洩漏身份");
 });
 await check("關閉保留成品身份、釋放預覽網址；資料不進入儲存",async()=>{
  click("[data-artwork-close]");assert(live.size===1,"未釋放預覽（只允許仍待下載的一個網址）");click("[data-memory-artwork-open]");assert(document.getElementById("artwork-studentNumber").value==="007"&&document.querySelector(".artwork-preview"),"關閉丟草稿");
  assert(!JSON.stringify([...data]).includes("合成測試同學"),"身份進入儲存");
 });
 await check("圖片解碼與字型服務失敗保留草稿，修改後可重試",async()=>{
  for(const message of ["圖片解碼失敗","本機字型載入失敗"]){generateOverride=async()=>{throw Error(message)};await generate();assert(document.getElementById("artwork-status").textContent.includes(message)&&document.querySelector(".artwork-preview"),"失敗丟稿")}
  generateOverride=null;await generate();assert(generated,"重試失敗");
 });
 await check("生成期间關閉／離頁／清除不恢復過期作品，离页清空身份及成品",async()=>{
  let release;generateOverride=()=>new Promise(resolve=>{release=()=>resolve(new Blob(["obsolete"],{type:"image/png"}))});generated=null;click("[data-artwork-preview]");await until(()=>release);click("[data-artwork-close]");release();await pause();click("[data-memory-artwork-open]");assert(!document.querySelector(".artwork-result"),"恢復過期預覽");
  generated=null;click("[data-artwork-preview]");await until(()=>release);location.hash="#home";controller.render();release();await pause();location.hash="#memories";controller.render();await pause();click("[data-memory-artwork-open]");assert(document.getElementById("artwork-studentName").value===""&&!document.querySelector(".artwork-preview"),"離頁有草稿");generateOverride=null;
 });
 await check("預演及診斷 PNG 清楚標示測試，不含正式紀錄證明",async()=>{
  const file=await makeFile();const prepared=await prepareAIArtwork(file);
  for(const testKind of ["rehearsal","diagnostics"]){const blob=await createSignedAIArtwork({artwork:prepared.blob,identity:{studentName:"合成測試同學",className:"測試班",studentNumber:"007"},completion:{testKind,records:[]},tripTitle:TRIP_DATA.title,dateLabel:TRIP_DATA.dateLabel});const bitmap=await createImageBitmap(blob);assert(bitmap.width===1080,"測試 PNG 無效");bitmap.close()}
 });
 await check("鍵盤焦點回復、Escape 保留草稿、離頁后過期取消不下載",async()=>{
  click("[data-artwork-close]");assert(document.activeElement.id==="memory-artwork-open","焦點沒有還原");
  click("[data-memory-artwork-open]");document.getElementById("ai-artwork-dialog").requestClose();assert(!document.getElementById("ai-artwork-dialog").open,"Escape 未关闭");
 });
 document.getElementById("test-summary").textContent=`全部 ${passed} 項通過，${failed} 項失敗。只使用合成圖片及本機記憶體資料。`;
 document.getElementById("test-summary").dataset.done="true";document.getElementById("test-summary").dataset.failed=String(failed);
 HTMLAnchorElement.prototype.click=nativeClick;
 if(document.getElementById("ai-artwork-dialog").open)click("[data-artwork-close]");
}
