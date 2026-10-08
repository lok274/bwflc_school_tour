import test from "node:test";
import assert from "node:assert/strict";
import { createDeviceTestController } from "../src/device-test-controller.js";
import { DEVICE_TEST_LOCATION as place, DEVICE_TEST_STORAGE_KEY } from "../src/device-test-data.js";
import { CHECK_IN_LOCATIONS } from "../src/data.js";
import { appHarness, checkedState } from "./helpers/browser-environment.js";

const formalIds=CHECK_IN_LOCATIONS.map(place=>place.id);
const position={coords:{latitude:place.geo.lat,longitude:place.geo.lng,accuracy:10}};
const record={attractionId:place.id,checkedInAt:"2026-10-08T04:00:00.000Z",method:"gps",verified:true};
function lab({testRecord,storage}={}) {
  return appHarness({initialState:checkedState(formalIds),controllerFactory:options=>{
    options.environment.isSecureContext=true;
    if(storage)options.environment.localStorage=storage;
    if(testRecord!==undefined)options.environment.localStorage.setItem(DEVICE_TEST_STORAGE_KEY,typeof testRecord==="string"?testRecord:JSON.stringify(testRecord));
    return createDeviceTestController(options);
  }});
}
function complete(app,value) {
  assert.equal(app.controller.getPageSnapshot().allCheckInsComplete,value);
  assert.equal(app.element("#app").innerHTML.includes("已完成所有打卡行程"),value);
  if(value)assert.match(app.element("#app").innerHTML,/測試預覽：只代表此測試點打卡完成，不代表正式六站行程已完成/);
}

test("正式六站完成不冒充測試點完成；載入不要求位置權限",async()=>{
  const app=lab();let requests=0;
  app.environment.navigator.geolocation={getCurrentPosition(){requests++;}};
  await app.controller.start();complete(app,false);assert.equal(requests,0);
  assert.equal(Object.keys(app.savedState().checkIns).length,6);
});
test("測試 GPS 打卡後即顯示預覽，snapshot 只增加布林值",async()=>{
  const app=lab();await app.controller.start();
  const before=app.savedState();
  app.environment.navigator.geolocation={getCurrentPosition(success){success(position);}};
  await app.click("checkin",place.id);complete(app,true);
  assert.equal(app.controller.getPageSnapshot().checkIn.verified,true);
  assert.match(app.element("#app").innerHTML,/role="status" aria-live="polite" aria-atomic="true"/);
  assert.deepEqual(app.savedState(),before);
  assert.equal("state" in app.controller.getPageSnapshot(),false);
});
test("手動取消不顯示；接受手動後顯示預覽並保留未核實",async()=>{
  const app=lab();await app.controller.start();
  app.confirmation.handler=async()=>false;
  await app.click("checkin",place.id);complete(app,false);
  app.confirmation.handler=async()=>true;
  await app.click("checkin",place.id);complete(app,true);
  assert.equal(app.controller.getPageSnapshot().checkIn.verified,false);
  assert.match(app.element("#app").innerHTML,/手動記錄 · 未核實/);
});
test("沒有有效測試紀錄時，範圍外定位不顯示完成預覽",async()=>{
  const app=lab();await app.controller.start();
  app.environment.navigator.geolocation={getCurrentPosition(success){success({coords:{latitude:0,longitude:0,accuracy:10}});}};
  await app.click("checkin",place.id);complete(app,false);
  assert.equal(app.controller.getPageSnapshot().gpsResult.status,"too-far");
});
test("有效測試紀錄重開後仍顯示；錯 ID 及損壞資料不顯示",async()=>{
  for(const testRecord of [record,{...record,method:"manual",verified:false}]){
    const app=lab({testRecord});await app.controller.start();complete(app,true);
  }
  for(const testRecord of ["broken",null,{...record,attractionId:"departure-school"},{...record,checkedInAt:"broken"}]){
    const app=lab({testRecord});await app.controller.start();complete(app,false);
  }
});
test("取消清除及清除相片失敗保留預覽；成功清除後消失且正式六站保留",async()=>{
  const app=lab({testRecord:record});app.environment.indexedDB={};await app.controller.start();
  const before=app.savedState();
  app.confirmation.handler=async()=>false;
  await app.click("reset-test");complete(app,true);
  app.confirmation.handler=async()=>true;
  app.photoService.clearPhotoRecords=async()=>{throw Error("blocked");};
  await app.click("reset-test");complete(app,true);
  app.photoService.clearPhotoRecords=async()=>{};
  await app.click("reset-test");complete(app,false);
  assert.deepEqual(app.savedState(),before);
  const reload=lab({storage:app.environment.localStorage});await reload.controller.start();complete(reload,false);
});
test("未能清除測試儲存鍵時保留預覽及警告",async()=>{
  const app=lab({testRecord:record});await app.controller.start();
  app.confirmation.handler=async()=>true;
  app.environment.localStorage.removeItem=()=>{throw Error("blocked");};
  await app.click("reset-test");complete(app,true);
  assert.match(app.element("#toast").textContent,/打卡紀錄未能清除/);
});
test("測試打卡保存失敗只在目前頁面預覽，重開後以實際保存紀錄為準",async()=>{
  const app=lab();await app.controller.start();
  app.confirmation.handler=async()=>true;
  app.environment.localStorage.setItem=()=>{throw Error("quota");};
  await app.click("checkin",place.id);complete(app,true);
  assert.match(app.element("#toast").textContent,/打卡只暫存於目前頁面/);
  const reload=lab({storage:app.environment.localStorage});await reload.controller.start();complete(reload,false);
});
