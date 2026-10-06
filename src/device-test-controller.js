import { createCheckInController } from "./check-in.js";
import { createCameraController } from "./camera.js";
import { createFeedback } from "./feedback.js";
import { createOperationGuard } from "./operations.js";
import { compressPhoto, createPhotoRepository } from "./photos.js";
import { createDeviceTestStore } from "./device-test-store.js";
import { renderDeviceTest } from "./device-test-views.js";
import { DEVICE_TEST_LOCATION, DEVICE_TEST_DATABASE, getTestLocation } from "./device-test-data.js";

export function createDeviceTestController({ environment = globalThis, photoService, feedbackService } = {}) {
  const { document, window, navigator, URL, requestAnimationFrame } = environment;
  const id = DEVICE_TEST_LOCATION.id;
  const app = document.querySelector("#app");
  const input = document.querySelector("#photo-input");
  const nativeInput = document.querySelector("#native-camera-input");
  const cameraDialog = document.querySelector("#camera-dialog");
  const feedback = feedbackService || createFeedback({ document, window, requestAnimationFrame });
  const photos = photoService || { compressPhoto, ...createPhotoRepository({ databaseName: DEVICE_TEST_DATABASE }) };
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
  let photoDeleting = false;
  let photoRecord = null;
  let preview = null;
  let readGeneration = 0;
  let photoSelection = null;
  let started = false;
  const operations = createOperationGuard({ isResetting: () => resetting });
  const canUseAttraction = (candidate) => active && !resetting && candidate === id;
  const capturePageToken = () => pageGeneration;
  const isPageCurrent = (token) => active && token === pageGeneration;
  const operationToken = (candidate) => ({ page: capturePageToken(), data: operations.operationToken(candidate) });
  const isCurrentOperation = (candidate, token) => canUseAttraction(candidate) && isPageCurrent(token?.page) && operations.isCurrentOperation(candidate, token?.data);
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
    if (preview) URL.revokeObjectURL(preview.url);
    preview = null;
  }
  function getPageSnapshot() {
    if (active && photoRecord && !preview) {
      try { preview = { url: URL.createObjectURL(photoRecord.blob) }; }
      catch { storageWarning = "相片已保存，但暫時未能顯示預覽。"; }
    }
    return Object.freeze({
      secure: environment.isSecureContext === true, gpsSupported: Boolean(navigator.geolocation),
      cameraSupported: Boolean(navigator.mediaDevices?.getUserMedia),
      checkIn: store.getCheckIn(), gpsResult: gpsResult ? Object.freeze({ ...gpsResult }) : null,
      cameraResult: cameraResult ? Object.freeze({ ...cameraResult }) : null,
      photo: preview ? Object.freeze({ url: preview.url, width: photoRecord.width, height: photoRecord.height, mime: photoRecord.mime }) : null,
      gpsBusy, photoBusy: photoBusy || photoDeleting, resetting, storageWarning
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
      const record = await photos.getPhotoRecord(id);
      if (request !== readGeneration || generation !== operations.generation) return false;
      photoRecord = record?.attractionId === id && record.blob instanceof Blob ? record : null;
      releasePreview();
      return true;
    } catch {
      if (request === readGeneration && generation === operations.generation) storageWarning = "未能讀取測試相片資料庫；打卡仍可測試。";
      return false;
    }
  }
  function beginPhotoSelection(candidate, source) {
    if (!["native", "gallery"].includes(source) || !canUseAttraction(candidate) || photoBusy || photoDeleting) return false;
    photoSelection = { source, page: capturePageToken(), data: operations.operationToken(id) };
    (source === "native" ? nativeInput : input).value = "";
    return true;
  }
  function processPhoto(file, candidate, selection) {
    if (!canUseAttraction(candidate) || photoBusy || photoDeleting) return Promise.resolve();
    const token = selection || { page: capturePageToken(), data: operations.operationToken(id) };
    const mayBegin = () => isCurrentOperation(id, token);
    if (!mayBegin()) return Promise.resolve();
    photoBusy = true;
    render();
    const task = (async () => {
      try {
        const record = await photos.compressPhoto(file, id);
        record.writeId = environment.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
        if (!mayBegin()) return;
        const saved = await photos.savePhotoRecord(record, { canBegin: mayBegin });
        if (saved === null) return;
        // Page departure preserves a started transaction; an explicit reset cancels its data.
        if (!operations.isCurrentOperation(id, token.data)) {
          const current = await photos.getPhotoRecord(id);
          if (current?.writeId === record.writeId) await photos.deletePhotoRecord(id);
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
    photoSelection = null;
    input.value = "";
    nativeInput.value = "";
    stopCamera();
    releasePreview();
    feedback.cancelConfirmations?.();
  }
  async function deletePhoto() {
    if (!canUseAttraction(id) || photoBusy || photoDeleting || !photoRecord) return;
    const token = operationToken(id);
    const accepted = await feedback.askConfirmation({ title: "刪除測試相片？", message: "只刪除此測試頁保存的相片，無法復原。", confirmText: "刪除測試相片", danger: true, isRelevant: () => isCurrentOperation(id, token) });
    if (!accepted || !isCurrentOperation(id, token)) return;
    photoDeleting = true;
    operations.invalidateAttractionOperations(id);
    stopCamera();
    photoSelection = null;
    input.value = "";
    nativeInput.value = "";
    render();
    try {
      await photos.deletePhotoRecord(id);
      await refreshPhoto();
      if (isPageCurrent(token.page)) feedback.showToast("測試相片已刪除。");
    } catch { if (isPageCurrent(token.page)) feedback.showToast("未能刪除測試相片，請再試一次。", "warning"); }
    finally { photoDeleting = false; render(); }
  }
  async function resetTestData() {
    if (!canUseAttraction(id) || photoDeleting) return;
    const page = capturePageToken();
    const relevant = () => isPageCurrent(page) && !resetting;
    const first = await feedback.askConfirmation({ title: "清除測試打卡與相片？", message: "只會清除此測試頁的紀錄，正式旅程及準備清單不會改動。", confirmText: "繼續", danger: true, isRelevant: relevant });
    if (!first || !relevant()) return;
    const second = await feedback.askConfirmation({ title: "最後確認", message: "測試相片與打卡紀錄會永久刪除，清除後可以重新測試。", confirmText: "清除測試資料", danger: true, isRelevant: relevant });
    if (!second || !relevant()) return;
    resetting = true;
    gpsBusy = false;
    operations.invalidateAllOperations();
    readGeneration += 1;
    stopCamera();
    photoSelection = null;
    input.value = "";
    nativeInput.value = "";
    render();
    await operations.waitForPhotoTasks();
    let photosCleared = false;
    try {
      if (environment.indexedDB || photoRecord) await photos.clearPhotoRecords();
      photosCleared = true;
      photoRecord = null;
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
    const target = event.target.closest("button, a");
    if (!target || target.isConnected === false) return;
    if (target.matches(".skip-link")) { event.preventDefault(); app.focus(); return; }
    if (target.matches("[data-camera-close]")) { camera.stopCamera(); return; }
    if (cameraDialog.open && cameraDialog.contains(target) && canUseAttraction(id)) {
      if (target.matches("[data-camera-capture]")) camera.captureCameraFrame();
      if (target.matches("[data-camera-retake]")) camera.clearPendingCapture();
      if (target.matches("[data-camera-save]")) await camera.saveCameraPhoto();
      return;
    }
    if (!app.contains(target) || !canUseAttraction(id)) return;
    if (target.matches("[data-checkin]") && target.dataset.checkin === id && !gpsBusy && environment.isSecureContext) {
      operations.invalidateAttractionOperations(gpsKey);
      gpsBusy = true;
      gpsResult = null;
      render();
      await startCheckIn(id, target);
    }
    if (target.matches("[data-camera-open]") && target.dataset.cameraOpen === id && !photoBusy && !photoDeleting && environment.isSecureContext) await camera.openCamera(id);
    if (target.matches("[data-native-camera-open]") && target.dataset.nativeCameraOpen === id && !photoBusy && !photoDeleting) camera.openNativeCamera(id);
    if (target.matches("[data-gallery-open]") && target.dataset.galleryOpen === id && !photoBusy && !photoDeleting) camera.openGallery(id);
    if (target.matches("[data-photo-delete]") && target.dataset.photoDelete === id) await deletePhoto();
    if (target.matches("[data-reset-test]")) await resetTestData();
  });
  for (const [source, picker] of [["native", nativeInput], ["gallery", input]]) {
    picker.addEventListener("cancel", () => {
      if (photoSelection?.source === source) photoSelection = null;
      picker.value = "";
    });
    picker.addEventListener("change", async () => {
      const selection = photoSelection?.source === source ? photoSelection : null;
      if (selection) photoSelection = null;
      const file = picker.files?.[0];
      picker.value = "";
      if (file && selection && isCurrentOperation(id, selection)) await processPhoto(file, id, selection);
    });
  }
  cameraDialog.addEventListener("close", () => {
    if (!cameraDialog.open) camera.stopCamera();
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
