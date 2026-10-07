import { createAppController } from "../../src/controller.js";
import { createPushClient, PUSH_STORAGE_KEY } from "../../src/push-client.js";
import { STORAGE_KEY } from "../../src/state.js";

// Isolated synthetic data only; no actual permission dialog or push provider call.
if (localStorage.getItem(PUSH_STORAGE_KEY) || localStorage.getItem(STORAGE_KEY)) throw new Error("請使用空白測試 origin，沒有清除既有資料。");
const scope = new URL("../../", import.meta.url).href;
const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const hash = async value => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2,"0")).join("");
const vapid = await crypto.subtle.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveBits"]);
const publicKey = encode(new Uint8Array(await crypto.subtle.exportKey("raw",vapid.publicKey)));
const keyId = await hash(publicKey);
const recipient = await crypto.subtle.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveBits"]);
const p256dh = encode(new Uint8Array(await crypto.subtle.exportKey("raw",recipient.publicKey)));
const auth = encode(crypto.getRandomValues(new Uint8Array(16)));
const requests = [];
const calls = [];
let native = null;
let sequence = 0;
let offline = false;
let permissionCalls = 0;
let clickedWithActivation = false;
let announcementTitle = "<img src=x onerror=alert(1)>";
const notification = {permission:"default",requestPermission() {
  permissionCalls += 1;
  clickedWithActivation = navigator.userActivation.isActive;
  notification.permission = "granted";
  return Promise.resolve("granted");
}};
const registration = {scope,active:{},pushManager:{
  getSubscription:async()=>native,
  subscribe:async()=>{
    const endpoint = "https://fcm.googleapis.com/fcm/send/generated-browser-fixture-" + (++sequence);
    native = { endpoint, toJSON:()=>({endpoint,expirationTime:null,keys:{p256dh,auth}}),
      unsubscribe:async()=>{ calls.push("native-unsubscribe"); native=null; return true; }};
    return native;
  }
}};
const environment = { document, window, location, localStorage, URL, requestAnimationFrame,
  Notification:notification, PushManager:class {}, crypto, isSecureContext,
  navigator:{onLine:true,serviceWorker:{register:async()=>registration,ready:Promise.resolve(registration)}},
  matchMedia:window.matchMedia.bind(window),
  async fetch(url, options={}) {
    const parsed=new URL(url);
    const body=options.body?JSON.parse(options.body):null;
    requests.push({path:parsed.pathname,method:options.method,body});
    if(offline)throw new Error("synthetic offline");
    if(parsed.pathname==="/v1/config")return Response.json({enabled:true,publicKey,keyId,appUrl:scope});
    if(parsed.pathname==="/v1/messages")return Response.json({messages:[{id:"fixture-announcement",title:announcementTitle,body:"行程更新\n請查看老師的最新公告。",route:"itinerary",createdAt:Date.now()}]});
    if(parsed.pathname==="/v1/subscriptions")return Response.json({id:await hash(body.subscription.endpoint),keyId,registered:true,expiresAt:Date.now()+86400000},{status:201});
    if(options.method==="DELETE"){calls.push("backend-delete");return new Response(null,{status:204});}
    if(parsed.pathname.endsWith("/test"))return Response.json({status:"queued"},{status:202});
    throw new Error("unexpected fixture request");
  }
};
const photoService={getAllPhotoRecords:async()=>[],clearPhotoRecords:async()=>{},deletePhotoRecord:async()=>{}};
const application = createAppController({environment,photoService,
  pushClientFactory:options=>createPushClient({...options,config:{apiBaseUrl:"https://push.example.test/"}})});
await application.start();
window.pushFixture = { getSnapshot:application.getPageSnapshot,
  getResults:()=>({requests,calls,permissionCalls,clickedWithActivation}),
  setOffline:value=>{offline=value;},
  setTitle:value=>{announcementTitle=value;},
  savedSubscription:()=>localStorage.getItem(PUSH_STORAGE_KEY)
};
