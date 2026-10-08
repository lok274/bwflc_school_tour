import { createAppController } from "../../src/controller.js";
import { createPushClient, PUSH_STORAGE_KEY } from "../../src/push-client.js";
import { STORAGE_KEY } from "../../src/state.js";

if (document.readyState === "loading") await new Promise(resolve => document.addEventListener("DOMContentLoaded", resolve, { once: true }));

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
const workerMessages = new Set();
let native = null;
let sequence = 0;
let offline = false;
let permissionCalls = 0;
let clickedWithActivation = false;
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
  navigator:{onLine:true,serviceWorker:{register:async()=>registration,ready:Promise.resolve(registration),
    addEventListener(type,listener){if(type==="message")workerMessages.add(listener);},
    removeEventListener(type,listener){if(type==="message")workerMessages.delete(listener);}}},
  matchMedia:window.matchMedia.bind(window),
  async fetch(url, options={}) {
    const parsed=new URL(url);
    const body=options.body?JSON.parse(options.body):null;
    requests.push({path:parsed.pathname,method:options.method,body});
    if(offline)throw new Error("synthetic offline");
    if(parsed.pathname==="/v1/config")return Response.json({enabled:true,publicKey,keyId,appUrl:scope,registrationProofRequired:true});
    if(parsed.pathname==="/v1/subscriptions"){
      const id=await hash(body.subscription.endpoint);
      if(!body.registrationProof){
        const proof=`1.${Date.now()+300000}.00000000-0000-0000-0000-000000000001.${"a".repeat(64)}.${keyId}.${encode(new Uint8Array(32).fill(8))}`;
        const ownerHash=await hash(body.managementToken);
        for(const listener of workerMessages)listener({source:registration.active,data:{type:"push-registration-proof",id,ownerHash,proof}});
        return Response.json({id,keyId,registered:false,verificationRequired:true},{status:202});
      }
      if(JSON.parse(localStorage.getItem(PUSH_STORAGE_KEY)).active.registrationProof!==body.registrationProof)throw new Error("Receipt not persisted before confirmation");
      return Response.json({id,keyId,registered:true,expiresAt:Date.now()+86400000},{status:201});
    }
    if(options.method==="DELETE"){calls.push("backend-delete");return new Response(null,{status:204});}
    if(parsed.pathname.endsWith("/test"))return Response.json({status:"queued"},{status:202});
    throw new Error("unexpected fixture request");
  }
};
const photoService={getAllPhotoRecords:async()=>[],clearPhotoRecords:async()=>{},deletePhotoRecord:async()=>{}};
// Expose only non-secret evidence through DOM controls for browser verification.
const panel=document.createElement("section");
panel.setAttribute("aria-label","隔離本機測試");
panel.innerHTML='<h2>隔離本機測試</h2><button type="button" data-fixture-offline>模擬離線</button><button type="button" data-fixture-online>恢復連線</button><pre data-fixture-results></pre>';
document.body.append(panel);
function updateResults(){
  const saved=JSON.parse(localStorage.getItem(PUSH_STORAGE_KEY)||'{"active":null,"pending":[]}');
  panel.querySelector("[data-fixture-results]").textContent=JSON.stringify({offline,permissionCalls,clickedWithActivation,
    challengeRequests:requests.filter(item=>item.method==="POST"&&item.path==="/v1/subscriptions"&&!item.body.registrationProof).length,
    confirmationRequests:requests.filter(item=>item.method==="POST"&&item.path==="/v1/subscriptions"&&item.body.registrationProof).length,
    cancellationsWithProof:requests.filter(item=>item.method==="DELETE"&&item.body?.registrationProof).length,
    nativeActive:Boolean(native),confirmedVersion:saved.active?.proofVersion||0,pendingCleanup:saved.pending.length,
    nativeStoppedBeforeDelete:calls.includes("backend-delete")?calls.indexOf("native-unsubscribe")<calls.indexOf("backend-delete"):null},null,2);
}
panel.querySelector("[data-fixture-offline]").addEventListener("click",()=>{offline=true;updateResults();});
panel.querySelector("[data-fixture-online]").addEventListener("click",()=>{offline=false;updateResults();window.dispatchEvent(new Event("online"));});
const application = createAppController({environment,photoService,
  pushClientFactory:options=>createPushClient({...options,config:{apiBaseUrl:"https://push.example.test/"},onChange:snapshot=>{options.onChange(snapshot);updateResults();}})});
await application.start();
updateResults();
window.pushFixture = { getSnapshot:application.getPageSnapshot,
  getResults:()=>({requests,calls,permissionCalls,clickedWithActivation}),
  setOffline:value=>{offline=value;},
  savedSubscription:()=>localStorage.getItem(PUSH_STORAGE_KEY)
};
