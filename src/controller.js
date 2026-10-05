import { STORAGE_KEY, createDefaultState, loadState, saveState } from "./state.js";
import * as defaultPhotoService from "./photos.js";
import { getAttraction } from "./formatting.js";
import { createViews } from "./views.js";
import { createFeedback } from "./feedback.js";
import { createOperationGuard } from "./operations.js";
import { createCameraController } from "./camera.js";
import { createCheckInController } from "./check-in.js";
import { createPhotoActions } from "./photo-actions.js";

// Importing modules has no DOM side effects. Construct once per document.
export function createAppController({
  environment = globalThis,
  photoService = defaultPhotoService,
  feedbackService
} = {}) {
  const { document, window, navigator, location, localStorage, URL, requestAnimationFrame } = environment;
  const { clearPhotoRecords, deletePhotoRecord, getAllPhotoRecords } = photoService;
  const app = document.querySelector("#app");
  const networkStatus = document.querySelector("#network-status");
  const cameraDialog = document.querySelector("#camera-dialog");
  const photoInput = document.querySelector("#photo-input");

  let state = loadState(localStorage);
  let photoRecords = new Map();
  let photoUrls = new Map();
  let installPrompt = null;
  let isResetting = false;
  let renderedRouteKey = null;

  const getModel = () => ({ state, photoRecords, photoUrls, installPrompt });
  const feedback = feedbackService || createFeedback({ document, window, requestAnimationFrame });
  const { showToast, askConfirmation, celebrateStamp } = feedback;
  const operations = createOperationGuard({ isResetting: () => isResetting });
  const { invalidateAttractionOperations, invalidateAllOperations, isCurrentDataGeneration, waitForPhotoTasks } = operations;
  const views = createViews({ getModel });
  const { renderHome, renderItinerary, renderAttractions, renderAttraction, renderPrepare } = views;
  const photoActions = createPhotoActions({
    getModel, isResetting: () => isResetting, operations, photoService,
    refreshPhotos, render, showToast, askConfirmation, document, window, URL
  });
  const { processPhoto, removePhoto, downloadTravelCard } = photoActions;
  const camera = createCameraController({
    document, navigator, URL, getState: () => state, isResetting: () => isResetting,
    operationToken: operations.operationToken,
    isCurrentOperation: operations.isCurrentOperation,
    showToast, processPhoto
  });
  const { clearPendingCapture, stopCamera, openGallery, openCamera, captureCameraFrame, saveCameraPhoto } = camera;
  const { startCheckIn } = createCheckInController({
    getState: () => state, isResetting: () => isResetting,
    operationToken: operations.operationToken,
    isCurrentOperation: operations.isCurrentOperation,
    persist, render, showToast, askConfirmation, celebrateStamp, navigator
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

  function setActiveNavigation(route) {
    const active = route.view === "attraction" ? "attractions" : route.view;
    document.querySelectorAll("[data-nav]").forEach((item) => {
      const selected = item.dataset.nav === active;
      item.classList.toggle("is-active", selected);
      if (selected) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
  }

  function persist() {
    try {
      state = saveState(state, localStorage);
      return true;
    } catch {
      showToast("未能保存進度，可能是瀏覽器儲存空間不足。", "warning");
      return false;
    }
  }

  function render({ moveFocus = false } = {}) {
    const focused = document.activeElement;
    const hadFocus = focused && app.contains(focused);
    const focusId = focused?.id;
    const focusData = ["checkItem", "customCheck", "customDelete"].find((key) => focused?.dataset?.[key]);
    const focusValue = focusData ? focused.dataset[focusData] : null;
    const route = currentRoute();
    const routeKey = route.view === "attraction" ? `attraction/${route.attractionId}` : route.view;
    setActiveNavigation(route);
    document.body.dataset.view = route.view;

    if (route.view === "home") app.innerHTML = renderHome();
    if (route.view === "itinerary") app.innerHTML = renderItinerary();
    if (route.view === "attractions") app.innerHTML = renderAttractions();
    if (route.view === "attraction") app.innerHTML = renderAttraction(route.attractionId);
    if (route.view === "prepare") app.innerHTML = renderPrepare();
    if (moveFocus && routeKey !== renderedRouteKey) app.focus({ preventScroll: true });
    else if (hadFocus) {
      const replacement = focusId ? document.getElementById(focusId)
        : [...app.querySelectorAll("input, button")].find((item) => focusData && item.dataset[focusData] === focusValue);
      replacement?.focus({ preventScroll: true });
    }
    renderedRouteKey = routeKey;
  }

  async function refreshPhotos() {
    try {
      const records = await getAllPhotoRecords();
      for (const url of photoUrls.values()) URL.revokeObjectURL(url);
      photoRecords = new Map(records.map((record) => [record.attractionId, record]));
      photoUrls = new Map(records.map((record) => [record.attractionId, URL.createObjectURL(record.blob)]));
    } catch {
      for (const url of photoUrls.values()) URL.revokeObjectURL(url);
      photoRecords = new Map();
      photoUrls = new Map();
    }
  }

  async function undoCheckIn(attractionId) {
    const attraction = getAttraction(attractionId);
    if (isResetting || !attraction || !state.checkIns[attractionId]) return;
    const hasPhoto = photoRecords.has(attractionId);
    const accepted = await askConfirmation({
      title: "取消這次打卡？",
      message: hasPhoto ? "取消後，這個景點的紀念照亦會一併刪除，無法復原。" : "取消後會移除時間及核實狀態。",
      confirmText: "取消打卡",
      danger: true
    });
    if (!accepted) return;

    const dataToken = operations.generation;
    invalidateAttractionOperations(attractionId);
    await waitForPhotoTasks(attractionId);
    if (!isCurrentDataGeneration(dataToken)) return;
    try {
      if (environment.indexedDB || photoRecords.has(attractionId)) await deletePhotoRecord(attractionId);
    } catch {
      if (!isCurrentDataGeneration(dataToken)) return;
      await refreshPhotos();
      render();
      showToast("未能刪除這個景點的紀念照；打卡紀錄會暫時保留，請再試一次。", "warning");
      return;
    }

    if (!isCurrentDataGeneration(dataToken)) return;

    delete state.checkIns[attractionId];
    const saved = persist();
    await refreshPhotos();
    render();
    showToast(saved ? "打卡紀錄及相關紀念照已取消。" : "紀念照已刪除，但未能保存打卡更新。", saved ? "default" : "warning");
  }

  async function resetAllData() {
    if (isResetting) return;
    const first = await askConfirmation({ title: "清除所有本機資料？", message: "這會移除準備清單、所有打卡和五個景點的紀念照。", confirmText: "繼續", danger: true });
    if (!first) return;
    const second = await askConfirmation({ title: "最後確認", message: "資料一經清除便無法復原。你確定要重新開始嗎？", confirmText: "永久清除", danger: true });
    if (!second) return;

    isResetting = true;
    invalidateAllOperations();
    stopCamera();
    showToast("正在安全清除本機資料…");
    await waitForPhotoTasks();

    try {
      if (environment.indexedDB || photoRecords.size) await clearPhotoRecords();
    } catch {
      isResetting = false;
      await refreshPhotos();
      render();
      showToast("未能清除所有紀念照；其他本機資料仍保留，請再試一次。", "warning");
      return;
    }

    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      isResetting = false;
      await refreshPhotos();
      render();
      showToast("紀念照已清除，但未能清除行程紀錄；請檢查瀏覽器儲存設定後再試。", "warning");
      return;
    }

    state = createDefaultState();
    await refreshPhotos();
    isResetting = false;
    render();
    showToast("所有本機旅程資料已清除。", "success");
  }

  function handleChecklistChange(target) {
    if (target.matches("[data-check-item]")) {
      state.checklist[target.dataset.checkItem] = target.checked;
    } else if (target.matches("[data-custom-check]")) {
      const item = state.customItems.find((entry) => entry.id === target.dataset.customCheck);
      if (item) item.done = target.checked;
    } else return;
    persist();
    render();
  }

  document.addEventListener("change", (event) => handleChecklistChange(event.target));

  document.addEventListener("submit", (event) => {
    if (event.target.id !== "custom-item-form") return;
    event.preventDefault();
    const input = event.target.elements.label;
    const label = input.value.trim();
    if (!label) return;
    const id = globalThis.crypto?.randomUUID?.() || `custom-${Date.now()}`;
    state.customItems.push({ id, label: label.slice(0, 120), done: false });
    persist();
    render();
  });

  document.addEventListener("click", async (event) => {
    const target = event.target.closest("button, a");
    if (!target) return;
    if (target.matches(".skip-link")) {
      event.preventDefault();
      app.focus();
      return;
    }
    if (target.matches("[data-checkin]")) await startCheckIn(target.dataset.checkin, target);
    if (target.matches("[data-checkin-undo]")) await undoCheckIn(target.dataset.checkinUndo);
    if (target.matches("[data-camera-open]")) await openCamera(target.dataset.cameraOpen);
    if (target.matches("[data-gallery-open]")) openGallery(target.dataset.galleryOpen);
    if (target.matches("[data-photo-delete]")) await removePhoto(target.dataset.photoDelete);
    if (target.matches("[data-card-download]")) await downloadTravelCard(target.dataset.cardDownload);
    if (target.matches("[data-reset-all]")) await resetAllData();
    if (target.matches("[data-custom-delete]")) {
      state.customItems = state.customItems.filter((item) => item.id !== target.dataset.customDelete);
      persist();
      render();
    }
    if (target.matches("[data-camera-close]")) stopCamera();
    if (target.matches("[data-camera-capture]")) captureCameraFrame();
    if (target.matches("[data-camera-retake]")) clearPendingCapture();
    if (target.matches("[data-camera-save]")) await saveCameraPhoto();
    if (target.id === "install-button" && installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      render();
    }
  });

  photoInput.addEventListener("change", async () => {
    const file = photoInput.files?.[0];
    const attractionId = photoInput.dataset.attractionId;
    if (file && attractionId) await processPhoto(file, attractionId);
  });

  cameraDialog.addEventListener("close", stopCamera);
  window.addEventListener("hashchange", () => {
    stopCamera();
    if (cameraDialog.open) cameraDialog.close();
    render({ moveFocus: true });
    const reduceMotion = environment.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  });
  window.addEventListener("online", updateNetworkStatus);
  window.addEventListener("offline", updateNetworkStatus);
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    render();
  });
  window.addEventListener("beforeunload", () => {
    stopCamera();
    for (const url of photoUrls.values()) URL.revokeObjectURL(url);
  });
  window.addEventListener("pagehide", stopCamera);

  function updateNetworkStatus() {
    const online = navigator.onLine;
    networkStatus.textContent = online ? "已連線" : "離線可用";
    networkStatus.classList.toggle("is-offline", !online);
  }

  async function start() {
    updateNetworkStatus();
    await refreshPhotos();
    render();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register(new URL("../sw.js", import.meta.url)).catch(() => {
        showToast("離線功能暫時未能啟用。", "warning");
      });
    }
  }

  return { start, render, currentRoute, getSnapshot: getModel };
}
