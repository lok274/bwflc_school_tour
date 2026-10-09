import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { appHarness } from "./helpers/browser-environment.js";
import { CHECK_IN_LOCATIONS, REQUIRED_CHECK_IN_LOCATIONS } from "../src/data.js";
import { STORAGE_KEY, createDefaultState } from "../src/state.js";
import { evaluateGeofence } from "../src/geo.js";
import { createRehearsalController, createRehearsalGeolocation, createRehearsalStorage, REHEARSAL_STORAGE_KEY } from "../src/device-rehearsal.js";
import { createViews } from "../src/views.js";

const tick = () => new Promise(setImmediate);
function rehearsal(hash = '#attraction/future-school') {
  const callbacks = [];
  const nativeCalls = { gps: 0, camera: 0 };
  const app = appHarness({ hash, initialState: { ...createDefaultState(), checkIns: { 'departure-school': { attractionId: 'departure-school', method: 'manual', verified: false, checkedInAt: '2026-11-05T01:00:00Z' } } },
    controllerFactory: options => {
      options.environment.navigator.geolocation = { getCurrentPosition() { nativeCalls.gps++; } };
      options.environment.navigator.mediaDevices = { getUserMedia: async () => { nativeCalls.camera++; return { getTracks: () => [] }; } };
      return createRehearsalController({ ...options, schedule: callback => callbacks.push(callback) });
    } });
  app.callbacks = callbacks;
  app.nativeCalls = nativeCalls;
  return app;
}

test('預演儲存拒絕其他鍵，寫入／清除只操作獨立鍵而保留正式及舊診斷資料', () => {
  const values = new Map([[STORAGE_KEY, 'real'], ['outdoorLearningDay.deviceTest.v1', 'old']]);
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const isolated = createRehearsalStorage(storage);
  assert.equal(isolated.getItem(STORAGE_KEY), undefined);
  isolated.setItem(STORAGE_KEY, 'rehearsal'); assert.equal(values.get(REHEARSAL_STORAGE_KEY), 'rehearsal');
  for (const method of ['getItem', 'setItem', 'removeItem']) assert.throws(() => isolated[method]('unexpected', 'x'));
  isolated.removeItem(STORAGE_KEY); assert.equal(values.get(STORAGE_KEY), 'real'); assert.equal(values.get('outdoorLearningDay.deviceTest.v1'), 'old');
});

test('六站模擬定位均通過真正地理判定，包括GCJ02；太遠和低準確度依原判定', () => {
  for (const attraction of CHECK_IN_LOCATIONS) for (const scenario of ['within', 'too-far', 'inaccurate']) {
    const location = createRehearsalGeolocation({ getHash: () => `#attraction/${attraction.id}`, getScenario: () => scenario, schedule: cb => cb() });
    let status; location.getCurrentPosition(position => { status = evaluateGeofence(position.coords, attraction.geo).status; }, () => assert.fail('Unexpected failure'));
    assert.equal(status, scenario === 'within' ? 'verified' : scenario);
  }
});

test('模擬拒絕／逾時、錯誤路由及過期請求，不呼叫真正GPS', () => {
  for (const [scenario, code] of [['denied', 1], ['timeout', 3]]) {
    const geo = createRehearsalGeolocation({ getHash: () => '#attraction/future-school', getScenario: () => scenario, schedule: cb => cb() });
    geo.getCurrentPosition(() => assert.fail(), error => assert.equal(error.code, code));
  }
  let next, calls = 0;
  const geo = createRehearsalGeolocation({ getHash: () => '#attraction/unknown', getScenario: () => 'within', schedule: cb => { next = cb; } });
  geo.getCurrentPosition(() => calls++, () => calls++); geo.invalidate(); next(); assert.equal(calls, 0);
  geo.getCurrentPosition(() => assert.fail(), error => assert.equal(error.code, 2)); next();
});

test('預演使用正式打卡入口，未打卡不能開相機，成功後才解鎖且禁止重複打卡', async () => {
  const app = rehearsal();
  await app.controller.start();
  const real = JSON.stringify(app.savedState());
  await app.click('camera-open', 'future-school'); assert.equal(app.nativeCalls.camera, 0);
  await app.click('checkin', 'future-school'); assert.equal(app.nativeCalls.gps, 0); app.callbacks.shift()(); await tick();
  assert.equal(app.controller.getPageSnapshot().checkIn.verified, true);
  assert.match(app.element('#app').innerHTML, /模擬定位通過/); assert.doesNotMatch(app.element('#app').innerHTML, /GPS 已核實/);
  await app.click('checkin', 'future-school'); assert.equal(app.callbacks.length, 0);
  assert.equal(JSON.stringify(app.savedState()), real);
  await app.click('camera-open', 'future-school'); assert.equal(app.nativeCalls.camera, 1);
  await app.click('camera-close');
  app.element('#camera-dialog').close(); // The real form's default dialog action.
  const saved = JSON.parse(app.environment.localStorage.getItem(REHEARSAL_STORAGE_KEY)); assert.deepEqual(Object.keys(saved.checkIns['future-school']).sort(), ['attractionId','checkedInAt','method','verified']);
  let compressed = 0;
  app.photoService.compressPhoto = async () => { compressed++; return { attractionId: 'future-school', width: 10, height: 10, blob: new Blob(['test']) }; };
  await app.selectPhoto(); assert.equal(compressed, 1);
});

test('距離太遠不能手動繞過；低準確度及拒絕可確認未核實記錄，取消不保存', async () => {
  for (const scenario of ['too-far', 'inaccurate', 'denied', 'timeout']) {
    const app = rehearsal(); app.controller.setScenario(scenario); let prompts = 0;
    app.confirmation.handler = async () => { prompts++; return true; };
    await app.click('checkin', 'future-school'); app.callbacks.shift()(); await tick();
    assert.equal(prompts, scenario === 'too-far' ? 0 : 1);
    assert.equal(Boolean(app.controller.getPageSnapshot().checkIn), scenario !== 'too-far');
    if (scenario !== 'too-far') assert.equal(app.controller.getPageSnapshot().checkIn.verified, false);
  }
  const app = rehearsal(); app.controller.setScenario('denied'); app.confirmation.handler = async () => false;
  await app.click('checkin', 'future-school'); app.callbacks.shift()(); await tick(); assert.equal(app.controller.getPageSnapshot().checkIn, null);
});

test('離頁或轉換定位情況後晚到的GPS回覆不打卡；重新定位可完成', async () => {
  const app = rehearsal(); await app.click('checkin', 'future-school');
  const stale = app.callbacks.shift(); app.navigate('#itinerary'); await tick(); stale(); await tick();
  assert.equal(app.environment.localStorage.getItem(REHEARSAL_STORAGE_KEY), null);
  app.navigate('#attraction/future-school'); await tick(); await app.click('checkin', 'future-school'); const previous = app.callbacks.shift();
  app.controller.setScenario('too-far'); previous(); await tick(); assert.equal(app.controller.getPageSnapshot().checkIn, null);
  app.controller.setScenario('within'); await app.click('checkin', 'future-school'); app.callbacks.shift()(); await tick(); assert.ok(app.controller.getPageSnapshot().checkIn);
});

test('只完成五個必需景點已顯示正式進度，學校選填；取消打卡先確認、刪本站照片，失敗仍保留紀錄', async () => {
  const app = rehearsal('#itinerary'); await app.controller.start();
  for (const place of REQUIRED_CHECK_IN_LOCATIONS) {
    app.navigate(`#attraction/${place.id}`); await tick(); await app.click('checkin', place.id); app.callbacks.shift()(); await tick();
  }
  app.navigate('#itinerary'); await tick(); assert.equal(app.controller.getPageSnapshot().allCheckInsComplete, true);
  assert.match(app.element('#app').innerHTML, /已完成所有測試打卡行程/);
  app.navigate('#attraction/future-school'); await tick(); app.confirmation.handler = async () => false;
  await app.click('checkin-undo', 'future-school'); assert.ok(app.controller.getPageSnapshot().checkIn);
  app.photoData.set('future-school', { attractionId: 'future-school', photoId: 'fixture', writeId: 'fixture', width: 10, height: 10, blob: new Blob(['fixture']) });
  await app.controller.start();
  app.confirmation.handler = async () => true; app.photoService.deletePhotoRecord = async () => { throw Error('failed'); };
  await app.click('checkin-undo', 'future-school'); assert.ok(app.controller.getPageSnapshot().checkIn);
  app.photoService.deletePhotoRecord = async () => {}; await app.click('checkin-undo', 'future-school'); assert.equal(app.controller.getPageSnapshot().checkIn, null);
});

test('兩次確認清除預演只移除測試進度，正式資料和正式照片從不交給此控制器', async () => {
  const app = rehearsal(); await app.controller.start(); const real = JSON.stringify(app.savedState());
  await app.click('checkin', 'future-school'); app.callbacks.shift()(); await tick();
  app.navigate('#home'); await tick(); let prompts = 0;
  app.confirmation.handler = async () => { prompts++; return true; };
  await app.click('reset-all'); assert.equal(prompts, 2);
  assert.equal(app.environment.localStorage.getItem(REHEARSAL_STORAGE_KEY), null); assert.equal(JSON.stringify(app.savedState()), real);
});

test('真正正式頁保持原核實文字；測試HTML四導航、定位選項、硬體診斷及嚴格CSP', async () => {
  const html = await readFile(new URL('../device-test.html', import.meta.url), 'utf8');
  assert.equal((html.match(/data-nav=/g)||[]).length, 4); assert.match(html, /rehearsal-scenario/); assert.match(html, /connect-src 'none'/); assert.match(html, /mode=diagnostics/);
  const model = { attraction: CHECK_IN_LOCATIONS[0], checkIn: { verified: true, checkedInAt: '2026-11-05T01:00:00Z' }, photo: null, photos: [], allCheckInsComplete: false };
  assert.match(createViews().renderAttraction(model), /GPS 已核實/); assert.doesNotMatch(createViews().renderAttraction(model), /模擬定位通過/);
});
