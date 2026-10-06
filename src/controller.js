import * as defaultPhotoService from "./photos.js";
import { getAttraction } from "./formatting.js";
import { createDataStore } from "./store.js";
import { createPageModels } from "./page-models.js";
import { createViews } from "./views.js";
import { createFeedback } from "./feedback.js";
import { createOperationGuard } from "./operations.js";
import { createCameraController } from "./camera.js";
import { createCheckInController } from "./check-in.js";
import { createPhotoActions } from "./photo-actions.js";

// The controller owns permissions and lifecycle; modules receive narrow capabilities.
export function createAppController({ environment = globalThis, photoService = defaultPhotoService, feedbackService } = {}) {
  const { document, window, navigator, location, localStorage, URL, requestAnimationFrame } = environment;
  const { clearPhotoRecords, deletePhotoRecord, getAllPhotoRecords } = photoService;
  const app = document.querySelector("#app");
  const networkStatus = document.querySelector("#network-status");
  const cameraDialog = document.querySelector("#camera-dialog");
  const photoInput = document.querySelector("#photo-input");
  const feedback = feedbackService || createFeedback({ document, window, requestAnimationFrame });
  const { showToast, askConfirmation, celebrateStamp } = feedback;
  const store = createDataStore({ storage: localStorage, onSaveError: () => showToast("未能保存進度，可能是瀏覽器儲存空間不足。", "warning") });
  let installPrompt = null;
  let isResetting = false;
  let pageGeneration = 0;
  let activeRouteKey = routeKey(currentRoute());
  let renderedRouteKey = null;
  let gallerySelection = null;
  let preview = null;
  let photoReadGeneration = 0;
  let camera = null;
  const operations = createOperationGuard({ isResetting: () => isResetting });
  const { invalidateAttractionOperations, invalidateAllOperations, isCurrentDataGeneration, waitForPhotoTasks } = operations;
  const views = createViews();
  const pages = createPageModels({ store, canInstall: () => Boolean(installPrompt), getPhotoPreview });
  const photoActions = createPhotoActions({
    getCheckIn: store.getCheckIn, getPhoto: store.getPhoto, getPhotoVersion: store.getPhotoVersion,
    canUseAttraction, operations, capturePageToken, isPageCurrent,
    photoService, refreshPhotos, render, showToast, askConfirmation, document, window, URL
  });
  const { processPhoto, removePhoto, downloadTravelCard } = photoActions;
  const operationToken = (id) => ({ data: operations.operationToken(id), page: capturePageToken() });
  const isCurrentOperation = (id, token) => canUseAttraction(id) && isPageCurrent(token?.page) && operations.isCurrentOperation(id, token?.data);
  camera = createCameraController({
    document, navigator, URL, hasCheckIn: store.hasCheckIn, canUseAttraction,
    isResetting: () => isResetting, operationToken, isCurrentOperation, showToast, processPhoto, beginGallerySelection
  });
  const { startCheckIn } = createCheckInController({
    hasCheckIn: store.hasCheckIn, canUseAttraction, operationToken, isCurrentOperation,
    commitCheckIn: (id, record, token) => isCurrentOperation(id, token) ? store.recordCheckIn(id, record) : { accepted: false, saved: false },
    render, showToast, askConfirmation, celebrateStamp, navigator
  });

  function currentRoute() {
    const route = location.hash.replace(/^#/, "") || "home";
    if (route.startsWith("attraction/")) {
      const attractionId = route.split("/")[1];
      return getAttraction(attractionId) ? { view: "attraction", attractionId } : { view: "attractions" };
    }
    const allowed = ["home", "itinerary", "attractions", "prepare"];
    return { view: allowed.includes(route) ? route : "home" };
  }
  function routeKey(route) { return route.view === "attraction" ? `attraction/${route.attractionId}` : route.view; }
  function releasePreview() {
    if (preview) URL.revokeObjectURL(preview.url);
    preview = null;
  }
  function leavePage() {
    pageGeneration += 1;
    camera?.stopCamera();
    if (cameraDialog.open) cameraDialog.close();
    gallerySelection = null;
    delete photoInput.dataset.attractionId;
    photoInput.value = "";
    releasePreview();
    feedback.cancelConfirmations?.();
  }
  function syncRoute() {
    const route = currentRoute();
    const key = routeKey(route);
    if (key !== activeRouteKey) {
      activeRouteKey = key;
      leavePage();
    }
    return route;
  }
  function capturePageToken() {
    syncRoute();
    return { generation: pageGeneration, route: activeRouteKey };
  }
  function isPageCurrent(token) {
    syncRoute();
    return Boolean(token && token.generation === pageGeneration && token.route === activeRouteKey);
  }
  function canUseAttraction(id) {
    const route = syncRoute();
    return !isResetting && route.view === "attraction" && route.attractionId === id && Boolean(getAttraction(id));
  }
  function canUsePage(view) { return !isResetting && syncRoute().view === view; }
  function getPhotoPreview(id) {
    if (syncRoute().attractionId !== id) return null;
    const record = store.getPhoto(id);
    if (!record) return null;
    const version = store.getPhotoVersion(id);
    if (preview?.id === id && preview.version === version) return preview.url;
    releasePreview();
    try {
      const url = URL.createObjectURL(record.blob);
      preview = { id, version, url };
      return url;
    } catch { return null; }
  }
  function getPageSnapshot() { return pages.getPageModel(syncRoute()); }
  function beginGallerySelection(id) {
    if (!canUseAttraction(id) || !store.hasCheckIn(id)) return;
    gallerySelection = { attractionId: id, pageToken: capturePageToken(), dataToken: operations.operationToken(id) };
    photoInput.dataset.attractionId = id;
    photoInput.value = "";
  }

  function setActiveNavigation(route) {
    const active = route.view === "attraction" ? "attractions" : route.view;
    document.querySelectorAll("[data-nav]").forEach((item) => {
      const selected = item.dataset.nav === active;
      item.classList.toggle("is-active", selected);
      if (selected) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
  }
  function render({ moveFocus = false } = {}) {
    const route = syncRoute();
    const focused = document.activeElement;
    const hadFocus = focused && app.contains(focused);
    const focusId = focused?.id;
    const focusData = ["checkItem", "customCheck", "customDelete"].find((key) => focused?.dataset?.[key]);
    const focusValue = focusData ? focused.dataset[focusData] : null;
    const key = routeKey(route);
    const model = pages.getPageModel(route);
    setActiveNavigation(route);
    document.body.dataset.view = route.view;
    const renderers = { home: views.renderHome, itinerary: views.renderItinerary, attractions: views.renderAttractions, attraction: views.renderAttraction, prepare: views.renderPrepare };
    app.innerHTML = renderers[route.view](model);
    if (moveFocus && key !== renderedRouteKey) app.focus({ preventScroll: true });
    else if (hadFocus) {
      const replacement = focusId ? document.getElementById(focusId)
        : [...app.querySelectorAll("input, button")].find((item) => focusData && item.dataset[focusData] === focusValue);
      replacement?.focus({ preventScroll: true });
    }
    renderedRouteKey = key;
  }
  async function refreshPhotos() {
    const request = ++photoReadGeneration;
    const dataGeneration = operations.generation;
    try {
      const records = await getAllPhotoRecords();
      if (request !== photoReadGeneration || dataGeneration !== operations.generation) return false;
      store.replacePhotos(records);
      releasePreview();
      return true;
    } catch {
      if (request === photoReadGeneration && dataGeneration === operations.generation) {
        store.replacePhotos([]);
        releasePreview();
      }
      return false;
    }
  }

  async function undoCheckIn(id) {
    const attraction = getAttraction(id);
    if (!canUseAttraction(id) || !attraction || !store.hasCheckIn(id)) return;
    const pageToken = capturePageToken();
    const token = operations.operationToken(id);
    const relevant = () => isPageCurrent(pageToken) && canUseAttraction(id) && operations.isCurrentOperation(id, token) && store.hasCheckIn(id);
    const accepted = await askConfirmation({
      title: "取消這次打卡？",
      message: store.hasPhoto(id) ? "取消後，這個景點的紀念照亦會一併刪除，無法復原。" : "取消後會移除時間及核實狀態。",
      confirmText: "取消打卡", danger: true, isRelevant: relevant
    });
    if (!accepted || !relevant()) return;
    const dataToken = operations.generation;
    invalidateAttractionOperations(id);
    await waitForPhotoTasks(id);
    if (!isCurrentDataGeneration(dataToken) || !isPageCurrent(pageToken) || !canUseAttraction(id)) return;
    try {
      if (environment.indexedDB || store.hasPhoto(id)) await deletePhotoRecord(id);
    } catch {
      if (!isCurrentDataGeneration(dataToken)) return;
      await refreshPhotos();
      render();
      if (isPageCurrent(pageToken)) showToast("未能刪除這個景點的紀念照；打卡紀錄會暫時保留，請再試一次。", "warning");
      return;
    }
    if (!isCurrentDataGeneration(dataToken)) return;
    const saved = store.removeCheckIn(id);
    await refreshPhotos();
    if (!isCurrentDataGeneration(dataToken)) return;
    render();
    if (isPageCurrent(pageToken)) showToast(saved ? "打卡紀錄及相關紀念照已取消。" : "紀念照已刪除，但未能保存打卡更新。", saved ? "default" : "warning");
  }

  async function resetAllData() {
    if (!canUsePage("home")) return;
    const pageToken = capturePageToken();
    const relevant = () => isPageCurrent(pageToken) && canUsePage("home");
    const first = await askConfirmation({ title: "清除所有本機資料？", message: "這會移除準備清單、所有打卡和五個景點的紀念照。", confirmText: "繼續", danger: true, isRelevant: relevant });
    if (!first || !relevant()) return;
    const second = await askConfirmation({ title: "最後確認", message: "資料一經清除便無法復原。你確定要重新開始嗎？", confirmText: "永久清除", danger: true, isRelevant: relevant });
    if (!second || !relevant()) return;
    isResetting = true;
    invalidateAllOperations();
    camera.stopCamera();
    gallerySelection = null;
    releasePreview();
    showToast("正在安全清除本機資料…");
    await waitForPhotoTasks();
    try {
      if (environment.indexedDB || store.photoCount) await clearPhotoRecords();
    } catch {
      isResetting = false;
      await refreshPhotos();
      render();
      showToast("未能清除所有紀念照；其他本機資料仍保留，請再試一次。", "warning");
      return;
    }
    try { store.clearProgress(); }
    catch {
      isResetting = false;
      await refreshPhotos();
      render();
      showToast("紀念照已清除，但未能清除行程紀錄；請檢查瀏覽器儲存設定後再試。", "warning");
      return;
    }
    await refreshPhotos();
    isResetting = false;
    render();
    showToast("所有本機旅程資料已清除。", "success");
  }

  const isCurrentControl = (target) => target?.isConnected !== false && app.contains(target);
  document.addEventListener("change", (event) => {
    const target = event.target;
    if (!isCurrentControl(target) || !canUsePage("prepare")) return;
    let changed = false;
    if (target.matches("[data-check-item]")) changed = store.setBuiltinDone(target.dataset.checkItem, target.checked);
    else if (target.matches("[data-custom-check]")) changed = store.setCustomDone(target.dataset.customCheck, target.checked);
    if (changed) render();
  });
  document.addEventListener("submit", (event) => {
    if (event.target.id !== "custom-item-form") return;
    event.preventDefault();
    if (!isCurrentControl(event.target) || !canUsePage("prepare")) return;
    if (store.addReminder(event.target.elements.label.value)) render();
  });
  document.addEventListener("click", async (event) => {
    const target = event.target.closest("button, a");
    if (!target) return;
    if (target.matches(".skip-link")) { event.preventDefault(); app.focus(); return; }
    if (target.matches("[data-camera-close]")) { camera.stopCamera(); return; }
    const inCamera = target.isConnected !== false && cameraDialog.open && cameraDialog.contains(target)
      && canUseAttraction(cameraDialog.dataset.attractionId);
    if (inCamera) {
      if (target.matches("[data-camera-capture]")) camera.captureCameraFrame();
      if (target.matches("[data-camera-retake]")) camera.clearPendingCapture();
      if (target.matches("[data-camera-save]")) await camera.saveCameraPhoto();
      return;
    }
    if (!isCurrentControl(target)) return;
    if (target.matches("[data-checkin]")) await startCheckIn(target.dataset.checkin, target);
    if (target.matches("[data-checkin-undo]")) await undoCheckIn(target.dataset.checkinUndo);
    if (target.matches("[data-camera-open]")) await camera.openCamera(target.dataset.cameraOpen);
    if (target.matches("[data-gallery-open]")) camera.openGallery(target.dataset.galleryOpen);
    if (target.matches("[data-photo-delete]")) await removePhoto(target.dataset.photoDelete);
    if (target.matches("[data-card-download]")) await downloadTravelCard(target.dataset.cardDownload);
    if (target.matches("[data-reset-all]")) await resetAllData();
    if (target.matches("[data-custom-delete]") && canUsePage("prepare")) {
      if (store.removeReminder(target.dataset.customDelete)) render();
    }
    if (target.id === "install-button" && canUsePage("home") && installPrompt) {
      const prompt = installPrompt;
      prompt.prompt();
      await prompt.userChoice;
      if (installPrompt === prompt) installPrompt = null;
      render();
    }
  });
  photoInput.addEventListener("change", async () => {
    const selection = gallerySelection;
    gallerySelection = null;
    const file = photoInput.files?.[0];
    if (!selection || !file || !isPageCurrent(selection.pageToken) || !canUseAttraction(selection.attractionId)
      || !operations.isCurrentOperation(selection.attractionId, selection.dataToken)) return;
    await processPhoto(file, selection.attractionId, selection);
  });
  cameraDialog.addEventListener("close", () => {
    // A queued close from the previous opening must not stop a reopened camera.
    if (!cameraDialog.open) camera.stopCamera();
  });
  window.addEventListener("hashchange", () => {
    syncRoute();
    render({ moveFocus: true });
    const reduceMotion = environment.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  });
  window.addEventListener("online", updateNetworkStatus);
  window.addEventListener("offline", updateNetworkStatus);
  window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); installPrompt = event; render(); });
  window.addEventListener("beforeunload", leavePage);
  window.addEventListener("pagehide", leavePage);
  window.addEventListener("pageshow", () => render());
  function updateNetworkStatus() {
    const online = navigator.onLine;
    networkStatus.textContent = online ? "已連線" : "離線可用";
    networkStatus.classList.toggle("is-offline", !online);
  }
  async function start() {
    updateNetworkStatus();
    await refreshPhotos();
    render();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register(new URL("../sw.js", import.meta.url)).catch(() => showToast("離線功能暫時未能啟用。", "warning"));
  }
  return { start, render, currentRoute, getPageSnapshot };
}
