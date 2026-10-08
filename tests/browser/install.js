import { createAppController } from "../../src/controller.js";
import { STORAGE_KEY } from "../../src/state.js";
import { getAllPhotoRecords } from "../../src/photos.js";
const preview = new URL(location.href).searchParams.has("preview");
const summary = document.querySelector("#test-summary");
const results = document.querySelector("#test-results");
let passed = 0;
const assert = (value, message) => { if (!value) throw Error(message); };
async function until(test) {
  const end = Date.now() + 5000;
  while (!test()) { if (Date.now() > end) throw Error("等待完成逾時"); await new Promise(resolve => setTimeout(resolve, 10)); }
}
async function check(label, action) {
  const item = document.createElement("li");
  try { await action(); passed++; item.textContent = `✓ ${label}`; }
  catch (error) { item.textContent = `✗ ${label}：${error.message}`; throw error; }
  finally { results.append(item); }
}
const fakeNavigator = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", platform: "iPhone", maxTouchPoints: 5, onLine: navigator.onLine };
let standalone = false;
const environment = { document, window, location, localStorage, indexedDB, URL, requestAnimationFrame,
  navigator: fakeNavigator, matchMedia: query => query === "(display-mode: standalone)" ? { matches: standalone } : window.matchMedia(query) };
const pushClientFactory = () => ({ getSnapshot: () => ({statusMessage:"獨立安裝指引測試，沒有訂閱或發送通知。",canEnable:false,canDisable:false}), initialize:async()=>{},refresh:async()=>{},enable:async()=>{},disable:async()=>{} });
function dispatchPrompt(prompt = () => Promise.resolve(), userChoice = Promise.resolve({outcome:"dismissed"})) {
  const event = new Event("beforeinstallprompt", {cancelable:true});
  Object.assign(event,{prompt,userChoice}); window.dispatchEvent(event);
  return event;
}
function clickInstall() { const button=document.querySelector("#install-button"); assert(button && !button.hidden,"找不到安裝入口"); button.focus(); button.click(); }
function navigate(hash) { location.hash=hash; window.dispatchEvent(new Event("hashchange")); }
try {
  assert(!localStorage.getItem(STORAGE_KEY) && !(await getAllPhotoRecords()).length,"已有旅程資料，已停止；請使用空白獨立 origin。");
  const controller = createAppController({environment,pushClientFactory});
  await controller.start();
  if (!preview) {
    document.querySelector("#test-output").hidden=false;
    await check("iPhone 沒有原生事件仍有安裝方法入口，不自動開啟指引",async()=>{
      assert(controller.getPageSnapshot().install.mode==="ios","沒有 iPhone 後備");
      assert(document.querySelector("#install-button").textContent==="iPhone／iPad 安裝方法","錯誤按鈕文字");
      assert(document.querySelector("#ios-install-guide").hidden,"自動展開指引");
    });
    await check("按鈕展開 Safari 指引、保留焦點與 aria-expanded，再按可收起",async()=>{
      clickInstall();
      assert(!document.querySelector("#ios-install-guide").hidden,"指引未展開");
      assert(document.querySelector("#install-button").getAttribute("aria-expanded")==="true","ARIA 狀態錯誤");
      assert(document.activeElement.id==="install-button","重畫遺失焦點");
      const text=document.querySelector("#ios-install-guide").textContent;
      assert(text.includes("分享") && text.includes("加至主畫面") && text.includes("開啟為網頁 App"),"缺少安裝步驟");
      clickInstall(); assert(document.querySelector("#ios-install-guide").hidden,"指引未收起");
    });
    await check("切換行程或離頁後指引收起，資料没有新增",async()=>{
      clickInstall(); navigate("#itinerary"); navigate("#home");
      assert(!controller.getPageSnapshot().install.helpOpen,"離開首頁仍保留指引");
      clickInstall(); window.dispatchEvent(new Event("pagehide")); window.dispatchEvent(new Event("pageshow"));
      assert(document.querySelector("#ios-install-guide").hidden,"返回頁面仍保留指引");
      assert(!localStorage.getItem(STORAGE_KEY),"寫入了旅程資料");
    });
    await check("iPad 桌面 user agent 仍提供指引，普通 Mac 不顯示",async()=>{
      fakeNavigator.userAgent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)"; fakeNavigator.platform="MacIntel"; controller.render();
      assert(controller.getPageSnapshot().install.mode==="ios","iPad 桌面模式漏判");
      fakeNavigator.maxTouchPoints=0; controller.render(); assert(document.querySelector("#install-button").hidden,"普通 Mac 出現 iOS 指引");
    });
    await check("從主畫面啟動時不顯示安裝入口",async()=>{
      fakeNavigator.userAgent="iPhone"; fakeNavigator.standalone=true; controller.render();
      assert(document.querySelector("#install-button").hidden,"已安裝仍有入口");
      fakeNavigator.standalone=false; standalone=true; controller.render();
      assert(document.querySelector("#install-button").hidden,"standalone 未隱藏");
      standalone=false;
    });
    await check("原生事件優先，立即呼叫 prompt；未完成時連按只呼叫一次",async()=>{
      let calls=0, finish;
      const event=dispatchPrompt(()=>{calls++;return Promise.resolve();},new Promise(resolve=>{finish=resolve;}));
      assert(event.defaultPrevented,"沒有保存原生事件");
      assert(controller.getPageSnapshot().install.mode==="native","沒有優先原生事件");
      clickInstall(); clickInstall(); assert(calls===1,"原生事件重複呼叫");
      finish({outcome:"dismissed"}); await until(()=>controller.getPageSnapshot().install.mode==="ios" && document.querySelector("#install-button").textContent.includes("iPhone"));
    });
    await check("Android 原生取消後隱藏，失敗有提示且不重用事件",async()=>{
      fakeNavigator.userAgent="Android"; fakeNavigator.platform="Linux armv8l"; fakeNavigator.maxTouchPoints=5;
      dispatchPrompt(); clickInstall(); await until(()=>document.querySelector("#install-button").hidden);
      let calls=0; dispatchPrompt(()=>{calls++;throw Error("synthetic failure");}); clickInstall();
      await until(()=>document.querySelector("#toast").textContent.includes("未能開啟安裝提示"));
      assert(calls===1 && document.querySelector("#install-button").hidden,"失敗仍可重用事件");
    });
    await check("appinstalled 隱藏入口，所有檢查沒有寫入旅程或相片",async()=>{
      fakeNavigator.userAgent="iPhone"; dispatchPrompt(); window.dispatchEvent(new Event("appinstalled"));
      assert(controller.getPageSnapshot().install.mode==="none" && document.querySelector("#install-button").hidden,"已安裝仍有入口");
      assert(!localStorage.getItem(STORAGE_KEY) && !(await getAllPhotoRecords()).length,"測試修改了旅程資料");
    });
    summary.textContent=`全部 ${passed} 項通過；平台與安裝事件為模擬，未執行真實 iPhone 安裝。`;
  }
} catch (error) {
  document.querySelector("#test-output").hidden=false;
  summary.textContent=`測試停止：${error.message}（${passed} 項通過）`;
}
