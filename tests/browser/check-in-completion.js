import { createAppController } from "../../src/controller.js";
import { ATTRACTIONS, CHECK_IN_LOCATIONS, DEPARTURE_LOCATION } from "../../src/data.js";
import { gcj02ToWgs84 } from "../../src/geo.js";
import * as photos from "../../src/photos.js";
import { STORAGE_KEY, createDefaultState } from "../../src/state.js";

const summary = document.querySelector("#test-summary");
const results = document.querySelector("#test-results");
const ids = CHECK_IN_LOCATIONS.map(place => place.id);
const lastId = ids.at(-1);
const preview = new URL(location.href).searchParams.has("preview");
let passed = 0, failed = 0;
const require = (condition, message) => { if (!condition) throw Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
async function until(condition) {
  const end = Date.now() + 5000;
  while (!condition()) { if (Date.now() > end) throw Error("等待操作完成逾時"); await pause(); }
}
async function check(label, action) {
  const item = document.createElement("li");
  try { await action(); passed++; item.textContent = `通過：${label}`; }
  catch (error) { failed++; item.textContent = `失敗：${label} — ${error.message}`; }
  results.append(item);
}
const photoService = { ...photos };
const originalPhotos = await photos.getAllPhotoRecords();
if (localStorage.getItem(STORAGE_KEY) || originalPhotos.length) {
  summary.textContent = "停止：此 origin 已有旅程資料。請改用空白測試 origin；沒有改動原資料。";
  throw Error("Non-empty test origin");
}
if (preview) {
  const state = createDefaultState();
  for (const id of ids) state.checkIns[id] = { attractionId: id, checkedInAt: "2026-11-05T04:00:00.000Z", method: "manual", verified: false };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  location.hash = "#itinerary";
}
const environment = { document, window, location, localStorage, URL, requestAnimationFrame,
  navigator: { onLine: navigator.onLine }, indexedDB, matchMedia: window.matchMedia.bind(window) };
const pushClientFactory = () => ({ getSnapshot: () => ({ statusMessage: "獨立測試環境", canEnable: false, canDisable: false }),
  initialize: async () => {}, refresh: async () => {}, enable: async () => {}, disable: async () => {} });
const application = createAppController({ environment, pushClientFactory,
  photoService: Object.fromEntries(Object.keys(photoService).map(name => [name, (...args) => photoService[name](...args)])) });
function navigate(hash) { location.hash = hash; application.render(); }
function click(selector) { const target = document.querySelector(selector); require(target, `沒有控制項 ${selector}`); target.click(); }
async function confirm() { await until(() => document.querySelector("#confirm-dialog").open); click("#confirm-button"); }
function notice(value) {
  require(application.getPageSnapshot().allCheckInsComplete === value, "完成快照錯誤");
  require(document.querySelectorAll("#app .checkin-completion").length === Number(value), "完成提示數目錯誤");
  if (value) {
    const element = document.querySelector(".checkin-completion");
    require(element.querySelector("p").textContent === "已完成所有打卡行程", "提示文字錯誤");
    require(element.getAttribute("role") === "status" && element.getAttribute("aria-live") === "polite", "沒有輔助閱讀狀態");
  }
}
async function manual(id) {
  navigate(id === DEPARTURE_LOCATION.id ? "#itinerary" : `#attraction/${id}`);
  click(`[data-checkin="${id}"]`); await confirm();
  await until(() => id === DEPARTURE_LOCATION.id ? Boolean(application.getPageSnapshot().checkIns?.[id]) : Boolean(application.getPageSnapshot().checkIn));
}
await application.start();
if (!preview) {
  await check("空白與前五站不顯示完成；五站手動保持未核實", async () => {
    navigate("#itinerary"); notice(false);
    for (const id of ids.slice(0, -1)) {
      await manual(id); notice(false);
      const checkIn = id === DEPARTURE_LOCATION.id ? application.getPageSnapshot().checkIns[id] : application.getPageSnapshot().checkIn;
      require(checkIn.verified === false && document.querySelector("#app").textContent.includes("未核實手動記錄"), "手動未核實標示丟失");
    }
  });
  await check("第六站 GPS 完成即顯示，位於打卡之後及相片之前", async () => {
    navigate(`#attraction/${lastId}`);
    const centre = gcj02ToWgs84(ATTRACTIONS.at(-1).geo);
    environment.navigator.geolocation = { getCurrentPosition(success) { success({ coords: { latitude: centre.lat, longitude: centre.lng, accuracy: 10 } }); } };
    click(`[data-checkin="${lastId}"]`);
    await until(() => application.getPageSnapshot().allCheckInsComplete);
    notice(true);
    require(application.getPageSnapshot().checkIn.verified === true, "GPS 未核實");
    const noticeElement = document.querySelector(".checkin-completion");
    require(noticeElement.previousElementSibling.classList.contains("checked-in-panel"), "不在打卡後");
    require(noticeElement.nextElementSibling.classList.contains("photo-panel"), "不在相片前");
    delete environment.navigator.geolocation;
  });
  await check("行程持續顯示，位置在標題後、日程前；手動徽章保留", async () => {
    navigate("#itinerary"); notice(true);
    require(document.querySelector(".checkin-completion").nextElementSibling.classList.contains("itinerary-list"), "不在日程前");
    require(document.querySelector(".status-manual")?.textContent.includes("手動記錄") && application.getPageSnapshot().checkIns[ids[0]].verified === false, "手動標示丟失");
    require(!("state" in application.getPageSnapshot()), "暴露完整 state");
  });
  await check("取消確認不移除完成提示", async () => {
    navigate(`#attraction/${lastId}`); click(`[data-checkin-undo="${lastId}"]`);
    await until(() => document.querySelector("#confirm-dialog").open);
    document.querySelector("#confirm-dialog").requestClose(); await pause(); notice(true);
  });
  await check("相片刪除失敗保留打卡和完成提示", async () => {
    photoService.deletePhotoRecord = async () => { throw Error("injected failure"); };
    click(`[data-checkin-undo="${lastId}"]`); await confirm();
    await until(() => document.querySelector("#toast").textContent.includes("打卡紀錄會暫時保留"));
    notice(true); photoService.deletePhotoRecord = photos.deletePhotoRecord;
  });
  await check("取消任何一站兩頁提示消失；重打第六站再次出現", async () => {
    click(`[data-checkin-undo="${lastId}"]`); await confirm();
    await until(() => !application.getPageSnapshot().checkIn && Boolean(document.querySelector(`[data-checkin="${lastId}"]`)) && !document.querySelector(".checkin-completion")); notice(false);
    navigate("#itinerary"); notice(false);
    await manual(lastId); notice(true);
  });
  await check("學校校名開地圖；取消學校打卡不刪相片，補打後六站完成", async () => {
    navigate("#itinerary"); notice(true);
    require(document.querySelector(".departure-stop a").getAttribute("href") === DEPARTURE_LOCATION.mapUrl, "出發地圖連結錯誤");
    const deletePhoto = photoService.deletePhotoRecord;
    let deleted = false;
    photoService.deletePhotoRecord = async () => { deleted = true; throw Error("School cannot delete photos"); };
    click(`[data-checkin-undo="${DEPARTURE_LOCATION.id}"]`); await confirm();
    await until(() => !application.getPageSnapshot().checkIns[DEPARTURE_LOCATION.id] && Boolean(document.querySelector(`[data-checkin="${DEPARTURE_LOCATION.id}"]`)));
    notice(false); require(!deleted, "取消學校刪了相片");
    require(Object.keys(application.getPageSnapshot().checkIns).length === 5, "原有五站被移除");
    photoService.deletePhotoRecord = deletePhoto;
    environment.navigator.geolocation = { getCurrentPosition(success) { success({ coords: { latitude: DEPARTURE_LOCATION.geo.lat, longitude: DEPARTURE_LOCATION.geo.lng, accuracy: 10 } }); } };
    click(`[data-checkin="${DEPARTURE_LOCATION.id}"]`);
    await until(() => application.getPageSnapshot().allCheckInsComplete); notice(true);
    require(application.getPageSnapshot().checkIns[DEPARTURE_LOCATION.id].verified === true, "學校 GPS 未核實");
    delete environment.navigator.geolocation;
  });
  await check("清除失敗保持完成，兩次確認成功清除後不顯示", async () => {
    navigate("#home"); photoService.clearPhotoRecords = async () => { throw Error("injected failure"); };
    click("[data-reset-all]"); await confirm(); await confirm();
    await until(() => document.querySelector("#toast").textContent.includes("其他本機資料仍保留"));
    navigate("#itinerary"); notice(true);
    photoService.clearPhotoRecords = photos.clearPhotoRecords; navigate("#home");
    click("[data-reset-all]"); await confirm(); await confirm();
    await until(() => !localStorage.getItem(STORAGE_KEY) && document.querySelector("#toast").textContent.includes("所有本機旅程資料已清除"));
    navigate("#itinerary"); notice(false);
    require((await photos.getAllPhotoRecords()).length === 0, "測試相片未清除");
  });
}
await check("v44 離線應用快取完整，測試 fixture 不進入發布快取", async () => {
  await navigator.serviceWorker.register("../../sw.js");
  await navigator.serviceWorker.ready;
  await until(() => Boolean(navigator.serviceWorker.controller));
  const cache = await caches.open("outdoor-learning-day-v44");
  require(Boolean(await cache.match(new URL("../../src/store.js", location.href).href)), "完成判斷模組未快取");
  require(Boolean(await cache.match(new URL("../../src/views.js", location.href).href)), "畫面模組未快取");
  require(!(await cache.match(location.href)), "測試 fixture 被快取");
});
summary.dataset.passed = passed;
summary.dataset.failed = failed;
summary.textContent = preview ? `預覽：六站虛構手動打卡；離線快取 ${failed ? "失敗" : "通過"}。可另開根目錄檢查重新載入。` : `完成：${passed} 通過，${failed} 失敗。`;
