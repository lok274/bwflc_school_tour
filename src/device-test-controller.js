import { createCheckInController } from "./check-in.js";
import { createCameraController } from "./camera.js";
import { createFeedback } from "./feedback.js";
import { createOperationGuard } from "./operations.js";
import { compressPhoto, createPhotoExport, createPhotoRepository } from "./photos.js";
import { createPhotoActions } from "./photo-actions.js";
import { createViews } from "./views.js";
import { createDeviceTestStore } from "./device-test-store.js";
import { renderDeviceTest } from "./device-test-views.js";
import { DEVICE_TEST_LOCATION, DEVICE_TEST_DATABASE, getTestLocation } from "./device-test-data.js";

export function createDeviceTestController({ environment = globalThis, photoService, feedbackService } = {}) {
  const { document, window, navigator, URL, requestAnimationFrame } = environment;
  const id = DEVICE_TEST_LOCATION.id;
  const app = document.querySelector("#app");
  const nativeInput = document.querySelector("#native-camera-input");
  const cameraDialog = document.querySelector("#camera-dialog");
  const photoExportDialog = document.querySelector("#photo-export-dialog");
  const views = createViews();
  const feedback = feedbackService || createFeedback({ document, window, requestAnimationFrame });
  const photos = photoService || { compressPhoto, createPhotoExport, ...createPhotoRepository({ databaseName: DEVICE_TEST_DATABASE }) };
  let storageWarning = "";
  const store = createDeviceTestStore({ storage: {
    getItem: (key) => environment.localStorage.getItem(key),
    setItem: (key, value) => environment.localStorage.setItem(key, value),
    removeItem: (key) => environment.localStorage.removeItem(key)
  }, onError: (message) => { storageWarning = message; } });
  let active = true;
  let pageGeneration = 0;
  let resetting = false;
  let gpsBusy = false;
  let gpsResult = null;
  let cameraResult = null;
  let photoBusy = false;
  let photoRecords = [];
  let photoVersion = 0;
  const previews = new Map();
  const selectedPhotoIds = new Set();
  let readGeneration = 0;
  let photoSelection = null;
  let started = false;
  const operations = createOperationGuard({ isResetting: () => resetting });
  const canUseAttraction = (candidate) => active && !resetting && candidate === id;
  const capturePageToken = () => pageGeneration;
  const isPageCurrent = (token) => active && token === pageGeneration;
  const operationToken = (candidate) => ({ page: capturePageToken(), data: operations.operationToken(candidate) });
  const isCurrentOperation = (candidate, token) => canUseAttraction(candidate) && isPageCurrent(token?.page) && operations.isCurrentOperation(candidate, token?.data);
  const getPhoto = (candidate, photoId) => candidate === id ? photoRecords.find(record => record.photoId === photoId) : null;
  const photoActions = createPhotoActions({
    // Test camera/export eligibility is independent of GPS; no fake check-in is stored.
    getCheckIn: candidate => canUseAttraction(candidate), getPhoto, getPhotoVersion: () => photoVersion,
    canUseAttraction, operations, capturePageToken, isPageCurrent, photoService: photos,
    refreshPhotos: refreshPhoto, render, showToast: feedback.showToast, askConfirmation: feedback.askConfirmation,
    document, window, URL, navigator, lookupAttraction: getTestLocation, showPhotoExport, hidePhotoExport
  });
  function showPhotoExport(model) {
    const content = document.querySelector("#photo-export-content");
    if (!photoExportDialog || !content || !model) return;
    const oldStatus = content.dataset.status;
    const focused = document.activeElement;
    const focusedIndex = focused?.dataset?.photoExportDownload;
    const focusedShare = focused?.matches?.("[data-photo-export-share]");
    content.innerHTML = views.renderPhotoExport(model);
    content.dataset.status = model.status;
    if (!photoExportDialog.open) photoExportDialog.showModal();
    if (model.status === "ready" && oldStatus === "preparing") {
      content.querySelector?.("[data-photo-export-share], [data-photo-export-download]")?.focus();
    } else if (focusedIndex !== undefined) {
      [...content.querySelectorAll("[data-photo-export-download]")].find(item => item.dataset.photoExportDownload === focusedIndex)?.focus();
    } else if (focusedShare) content.querySelector?.("[data-photo-export-share]")?.focus();
  }
  function hidePhotoExport() {
    if (photoExportDialog?.open) photoExportDialog.close();
    const content = document.querySelector("#photo-export-content");
    if (content) { content.innerHTML = ""; delete content.dataset.status; }
  }
  const gpsKey = `gps:${id}`;
  const isCurrentGps = (candidate, token) => canUseAttraction(candidate) && isPageCurrent(token?.page) && operations.isCurrentOperation(gpsKey, token?.data);
  const camera = createCameraController({ document, navigator, URL, canUseAttraction,
    hasCheckIn: (candidate) => candidate === id, isResetting: () => resetting,
    operationToken, isCurrentOperation, processPhoto, beginPhotoSelection,
    lookupAttraction: getTestLocation, showToast: feedback.showToast,
    onCameraStatus: (result) => { cameraResult = result; render(); }
  });
  const { startCheckIn } = createCheckInController({
    // Each explicit click is a fresh test and may replace the previous test result.
    hasCheckIn: () => false, canUseAttraction, lookupAttraction: getTestLocation,
    operationToken: () => ({ page: capturePageToken(), data: operations.operationToken(gpsKey) }),
    isCurrentOperation: isCurrentGps,
    commitCheckIn: (candidate, record, token) => isCurrentGps(candidate, token) ? store.recordCheckIn(record) : { accepted: false, saved: false },
    render: () => { gpsBusy = false; render(); }, showToast: feedback.showToast,
    askConfirmation: feedback.askConfirmation, celebrateStamp: feedback.celebrateStamp, navigator,
    onLocationResult: (result) => { gpsResult = result; render(); }
  });

  function releasePreview() {
    for (const url of previews.values()) URL.revokeObjectURL(url);
    previews.clear();
  }
  function getPageSnapshot() {
    const photoModels = [];
    if (active) for (const record of photoRecords) {
      try {
        if (!previews.has(record.photoId)) previews.set(record.photoId, URL.createObjectURL(record.blob));
        photoModels.push(Object.freeze({ photoId: record.photoId, url: previews.get(record.photoId),
          width: record.width, height: record.height, mime: record.mime, selected: selectedPhotoIds.has(record.photoId) }));
      } catch { storageWarning = "相片已保存，但暫時未能顯示預覽。"; }
    }
    return Object.freeze({
      secure: environment.isSecureContext === true, gpsSupported: Boolean(navigator.geolocation),
      cameraSupported: Boolean(navigator.mediaDevices?.getUserMedia),
      checkIn: store.getCheckIn(), allCheckInsComplete: Boolean(store.getCheckIn()), gpsResult: gpsResult ? Object.freeze({ ...gpsResult }) : null,
      cameraResult: cameraResult ? Object.freeze({ ...cameraResult }) : null,
      photos: Object.freeze(photoModels), photo: photoModels.at(-1) || null,
      gpsBusy, photoBusy: photoBusy, resetting, storageWarning
    });
  }
  function render() {
    if (!active) return;
    const focusId = app.contains(document.activeElement) ? document.activeElement?.id : null;
    app.innerHTML = renderDeviceTest(getPageSnapshot());
    if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  }
  async function refreshPhoto() {
    const request = ++readGeneration;
    const generation = operations.generation;
    try {
      const records = await photos.getAllPhotoRecords();
      if (request !== readGeneration || generation !== operations.generation) return false;
      photoRecords = records.filter(record => record?.attractionId === id && record.blob instanceof Blob)
        .map(record => Object.freeze({ ...record, photoId: record.photoId || id }))
        .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
      photoVersion += 1;
      for (const photoId of selectedPhotoIds) if (!getPhoto(id, photoId)) selectedPhotoIds.delete(photoId);
      photoActions.validatePhotoExport();
      releasePreview();
      return true;
    } catch {
      if (request === readGeneration && generation === operations.generation) {
        storageWarning = "未能讀取測試相片資料庫；打卡仍可測試。";
        photoRecords = [];
        photoVersion += 1;
        selectedPhotoIds.clear();
        photoActions.cancelPhotoExport();
        releasePreview();
      }
      return false;
    }
  }
  function beginPhotoSelection(candidate) {
    if (!canUseAttraction(candidate) || photoBusy) return false;
    photoSelection = { page: capturePageToken(), data: operations.operationToken(id) };
    nativeInput.value = "";
    return true;
  }
  function processPhoto(file, candidate, selection) {
    if (!canUseAttraction(candidate) || photoBusy) return Promise.resolve();
    const token = selection || { page: capturePageToken(), data: operations.operationToken(id) };
    const mayBegin = () => isCurrentOperation(id, token);
    if (!mayBegin()) return Promise.resolve();
    photoBusy = true;
    render();
    const task = (async () => {
      try {
        const record = await photos.compressPhoto(file, id);
        record.writeId = environment.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
        record.photoId = record.writeId;
        if (!mayBegin()) return;
        const saved = await photos.savePhotoRecord(record, { canBegin: mayBegin });
        if (saved === null) return;
        // Page departure preserves a started transaction; an explicit reset cancels its data.
        if (!operations.isCurrentOperation(id, token.data)) {
          const current = await photos.getPhotoRecord(id, record.photoId);
          if (current?.writeId === record.writeId) await photos.deletePhotoRecord(id, record.photoId);
          return;
        }
        const loaded = await refreshPhoto();
        if (mayBegin()) feedback.showToast(loaded ? "測試相片已保存，並已從資料庫讀回。" : "已保存，但未能讀回預覽。請重新開啟測試頁。", loaded ? "success" : "warning");
      } catch (error) {
        if (mayBegin()) feedback.showToast(error?.message || "未能保存測試相片。", "warning");
      } finally {
        photoBusy = false;
        render();
      }
    })();
    return operations.trackPhotoTask(id, task);
  }
  function stopCamera() {
    camera.stopCamera();
    if (cameraDialog.open) cameraDialog.close();
  }
  function leavePage() {
    active = false;
    pageGeneration += 1;
    gpsBusy = false;
    gpsResult = null;
    cameraResult = null;
    selectedPhotoIds.clear();
    photoActions.cancelPhotoExport();
    photoSelection = null;
    nativeInput.value = "";
    stopCamera();
    releasePreview();
    feedback.cancelConfirmations?.();
  }
  async function resetTestData() {
    if (!canUseAttraction(id)) return;
    const page = capturePageToken();
    const relevant = () => isPageCurrent(page) && !resetting;
    const first = await feedback.askConfirmation({ title: "清除測試打卡與相片？", message: "只會清除此測試頁的紀錄，正式景點的打卡紀錄及相片不會改動。", confirmText: "繼續", danger: true, isRelevant: relevant });
    if (!first || !relevant()) return;
    const second = await feedback.askConfirmation({ title: "最後確認", message: "App 內所有測試相片與打卡紀錄會永久刪除，清除後可以重新測試；已匯出的相片不會被刪除。", confirmText: "清除測試資料", danger: true, isRelevant: relevant });
    if (!second || !relevant()) return;
    resetting = true;
    photoActions.cancelPhotoExport();
    selectedPhotoIds.clear();
    gpsBusy = false;
    operations.invalidateAllOperations();
    readGeneration += 1;
    stopCamera();
    photoSelection = null;
    nativeInput.value = "";
    render();
    await operations.waitForPhotoTasks();
    let photosCleared = false;
    try {
      if (environment.indexedDB || photoRecords.length) await photos.clearPhotoRecords();
      photosCleared = true;
      photoRecords = [];
      photoVersion += 1;
      releasePreview();
      store.clearCheckIn();
      gpsResult = null;
      cameraResult = null;
      storageWarning = "";
      if (isPageCurrent(page)) feedback.showToast("測試資料已清除；正式旅程資料沒有改動。", "success");
    } catch {
      if (isPageCurrent(page)) feedback.showToast(photosCleared ? "測試相片已清除，但打卡紀錄未能清除，請再試一次。" : "未能清除測試相片；測試打卡仍保留。", "warning");
    } finally { resetting = false; render(); }
  }

  document.addEventListener("click", async (event) => {
    const target = event.target.closest("button, a, input[type=checkbox]");
    if (!target || target.isConnected === false) return;
    if (photoExportDialog?.open && photoExportDialog.contains(target)) {
      if (target.matches("[data-photo-export-close]")) photoActions.cancelPhotoExport();
      if (target.matches("[data-photo-export-share]")) await photoActions.sharePhotoExport();
      if (target.matches("[data-photo-export-download]")) {
        const index = target.dataset.photoExportDownload;
        if (/^(0|[1-9]\d*)$/.test(index)) photoActions.downloadPhotoExport(Number(index));
      }
      return;
    }
    if (target.matches(".skip-link")) { event.preventDefault(); app.focus(); return; }
    if (target.matches("[data-camera-close]")) { camera.stopCamera(); return; }
    if (cameraDialog.open && cameraDialog.contains(target) && canUseAttraction(id)) {
      if (target.matches("[data-camera-capture]")) camera.captureCameraFrame();
      if (target.matches("[data-camera-retake]")) camera.clearPendingCapture();
      if (target.matches("[data-camera-save]")) await camera.saveCameraPhoto();
      return;
    }
    if (!app.contains(target) || !canUseAttraction(id)) return;
    if (target.matches("[data-photo-select]") && getPhoto(id, target.dataset.photoSelect)) {
      if (selectedPhotoIds.has(target.dataset.photoSelect)) selectedPhotoIds.delete(target.dataset.photoSelect);
      else selectedPhotoIds.add(target.dataset.photoSelect);
      render();
    }
    if (target.matches("[data-photo-select-all]") && target.dataset.photoSelectAll === id) {
      photoRecords.forEach(record => selectedPhotoIds.add(record.photoId)); render();
    }
    if (target.matches("[data-photo-select-none]") && target.dataset.photoSelectNone === id) { selectedPhotoIds.clear(); render(); }
    if (!photoBusy) {
      if (target.matches("[data-photo-export-selected]") && target.dataset.photoExportSelected === id) await photoActions.preparePhotoExport(id, [...selectedPhotoIds]);
    }
    if (target.matches("[data-checkin]") && target.dataset.checkin === id && !gpsBusy && environment.isSecureContext) {
      operations.invalidateAttractionOperations(gpsKey);
      gpsBusy = true;
      gpsResult = null;
      render();
      await startCheckIn(id, target);
    }
    if (target.matches("[data-camera-open]") && target.dataset.cameraOpen === id && !photoBusy && environment.isSecureContext) await camera.openCamera(id);
    if (target.matches("[data-native-camera-open]") && target.dataset.nativeCameraOpen === id && !photoBusy) camera.openNativeCamera(id);
    if (target.matches("[data-reset-test]")) await resetTestData();
  });
  nativeInput.addEventListener("cancel", () => {
    photoSelection = null;
    nativeInput.value = "";
  });
  nativeInput.addEventListener("change", async () => {
    const selection = photoSelection;
    photoSelection = null;
    const file = nativeInput.files?.[0];
    nativeInput.value = "";
    if (file && selection && isCurrentOperation(id, selection)) await processPhoto(file, id, selection);
  });
  cameraDialog.addEventListener("close", () => {
    if (!cameraDialog.open) camera.stopCamera();
  });
  photoExportDialog?.addEventListener("cancel", () => photoActions.cancelPhotoExport());
  photoExportDialog?.addEventListener("close", () => {
    if (!photoExportDialog.open) photoActions.cancelPhotoExport();
  });
  window.addEventListener("pagehide", leavePage);
  window.addEventListener("beforeunload", leavePage);
  window.addEventListener("pageshow", async () => {
    active = true;
    await refreshPhoto();
    render();
  });
  async function start() {
    if (started) return;
    started = true;
    render();
    await refreshPhoto();
    render();
  }
  return { start, render, getPageSnapshot };
}
