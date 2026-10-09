import * as defaultPhotoService from "./photos.js";
import { getAttraction } from "./formatting.js";
import { CHECK_IN_LOCATIONS, DEPARTURE_LOCATION } from "./data.js";
import { createDataStore } from "./store.js";
import { createPageModels } from "./page-models.js";
import { createViews } from "./views.js";
import { createFeedback } from "./feedback.js";
import { createOperationGuard } from "./operations.js";
import { createCameraController } from "./camera.js";
import { createCheckInController } from "./check-in.js";
import { createPhotoActions } from "./photo-actions.js";
import { createPushClient } from "./push-client.js";
import { MAX_REFLECTION_LENGTH, countReflectionCharacters, limitCardReflection, SUMMARY_IDENTITY_LIMITS, limitSummaryField } from "./card-reflection.js";

// The controller owns permissions and lifecycle; modules receive narrow capabilities.
export function createAppController({ environment = globalThis, photoService = defaultPhotoService, feedbackService, pushClientFactory = createPushClient } = {}) {
  const { document, window, navigator, location, localStorage, URL, requestAnimationFrame } = environment;
  const { clearPhotoRecords, deletePhotoRecord, getAllPhotoRecords } = photoService;
  const app = document.querySelector("#app");
  const networkStatus = document.querySelector("#network-status");
  const cameraDialog = document.querySelector("#camera-dialog");
  const nativeCameraInput = document.querySelector("#native-camera-input");
  const photoExportDialog = document.querySelector("#photo-export-dialog");
  let memoryDialog = document.querySelector("#memory-dialog");
  if (!memoryDialog) {
    memoryDialog = document.createElement("dialog");
    memoryDialog.id = "memory-dialog";
    memoryDialog.className = "memory-dialog";
    memoryDialog.setAttribute("aria-labelledby", "memory-title");
    memoryDialog.setAttribute("closedby", "closerequest");
    memoryDialog.innerHTML = '<div id="memory-content" class="memory-dialog-content"></div>';
    document.body.append(memoryDialog);
  }
  const memoryContent = document.querySelector("#memory-content");
  const feedback = feedbackService || createFeedback({ document, window, requestAnimationFrame });
  const { showToast, celebrateStamp } = feedback;
  const store = createDataStore({ storage: localStorage, onSaveError: () => showToast("未能保存進度，可能是瀏覽器儲存空間不足。", "warning") });
  let installPrompt = null;
  let nativeInstalling = false;
  let installedInSession = false;
  let iosInstallHelpOpen = false;
  let isResetting = false;
  let pageGeneration = 0;
  let activeRouteKey = routeKey(currentRoute());
  let renderedRouteKey = null;
  let photoSelection = null;
  const previews = new Map();
  let previewUse = null;
  let memoryFrames = [];
  let memoryEpoch = 0;
  let memorySuspended = false;
  let memoryEntry = null;
  let cardTask = null;
  let exportOptions = { page: 0, moreOpen: false };
  let exportRequest = null;
  const memoryFrame = () => memoryFrames.at(-1) || null;
  function getMemoryState() {
    const frame = memoryFrame();
    return frame ? { ...frame, depth: memoryFrames.length, suspended: memorySuspended,
      busy: summaryBusy || cardTask?.epoch === memoryEpoch } : null;
  }
  function rememberMemoryPosition() {
    const frame = memoryFrame();
    if (frame) { frame.scrollTop = document.getElementById("memory-body")?.scrollTop || 0; frame.focusId = document.activeElement?.id || ""; }
  }
  function finishComposition() {
    const target = composingReflection;
    composingReflection = null;
    reflectionRenderPending = false;
    if (target) updateCardReflection({ target });
  }
  function changeMemory(frame, push = false) {
    finishComposition();
    if (push) { rememberMemoryPosition(); memoryFrames.push(frame); }
    else {
      if (!memoryFrames.length) memoryEntry = { focusId: document.activeElement?.id || "", scrollY: window.scrollY || 0 };
      memoryFrames = [frame];
    }
    memoryEpoch++;
    memorySuspended = false;
    cardTask = null;
    render();
    document.getElementById("memory-title")?.focus({ preventScroll: true });
    const body = document.getElementById("memory-body");
    if (body) body.scrollTop = frame.scrollTop || 0;
  }
  function closeMemory({ restore = true } = {}) {
    finishComposition();
    const entry = memoryEntry;
    memoryFrames = [];
    memoryEntry = null;
    memoryEpoch++;
    memorySuspended = false;
    cardTask = null;
    summaryBusy = false;
    photoActions.cancelSummaryCard();
    if (memoryDialog.open) memoryDialog.close();
    if (memoryContent) memoryContent.innerHTML = "";
    if (restore) {
      render();
      window.scrollTo?.(0, entry?.scrollY || 0);
      (document.getElementById(entry?.focusId) || app).focus({ preventScroll: true });
    }
  }
  function backMemory() {
    if (memoryFrames.length <= 1) { closeMemory(); return; }
    finishComposition();
    memoryFrames.pop();
    memoryEpoch++;
    cardTask = null;
    summaryBusy = false;
    photoActions.cancelSummaryCard();
    render();
    const frame = memoryFrame(), body = document.getElementById("memory-body");
    if (body) body.scrollTop = frame.scrollTop || 0;
    (document.getElementById(frame.focusId) || document.getElementById("memory-title"))?.focus({ preventScroll: true });
  }
  function suspendMemory() {
    if (!memoryFrames.length || memorySuspended) return;
    finishComposition();
    rememberMemoryPosition();
    memorySuspended = true;
    if (memoryDialog.open) memoryDialog.close();
    render();
  }
  function resumeMemory() {
    if (!memoryFrames.length || !memorySuspended || !canUsePage("memories") || photoExportDialog?.open) return;
    memorySuspended = false;
    render();
    const frame = memoryFrame(), body = document.getElementById("memory-body");
    if (body) body.scrollTop = frame.scrollTop || 0;
    (document.getElementById(frame.focusId) || document.getElementById("memory-title"))?.focus({ preventScroll: true });
  }
  async function askConfirmation(options) {
    const epoch = memoryEpoch, page = capturePageToken();
    if (memoryFrames.length) suspendMemory();
    try { return await feedback.askConfirmation(options); }
    finally { if (epoch === memoryEpoch && isPageCurrent(page)) resumeMemory(); }
  }
  function validateMemory() {
    const frame = memoryFrame();
    if (!frame) return;
    if (frame.mode === "summary" || frame.mode === "picker") {
      if (!store.hasCompletedAllCheckIns()) { closeMemory({ restore: false }); return; }
    }
    if (frame.attractionId && (!store.hasCheckIn(frame.attractionId) || !store.hasPhoto(frame.attractionId))) {
      if (frame.mode === "picker") backMemory(); else closeMemory({ restore: false });
    } else if (frame.mode === "photo" && !store.getPhoto(frame.attractionId, frame.photoId)) {
      backMemory();
    }
  }
  memoryDialog.addEventListener("cancel", (event) => { event.preventDefault(); backMemory(); });
  const selectedPhotoIds = new Set();
  const cardReflections = new Map();
  const summarySelections = new Map();
  let summaryIdentity = { studentName: "", className: "", studentNumber: "" };
  let summaryBusy = false;
  function clearSummaryDraft() {
    summarySelections.clear();
    summaryIdentity = { studentName: "", className: "", studentNumber: "" };
    summaryBusy = false;
    photoActions.cancelSummaryCard();
  }
  function getSummaryDraft() {
    const photos = [];
    for (const [attractionId, selected] of summarySelections) {
      const record = store.getPhoto(attractionId, selected.photoId);
      if (record && store.hasCheckIn(attractionId) && (selected.writeId ? record.writeId === selected.writeId : record.blob === selected.blob)) {
        photos.push({ attractionId, photoId: selected.photoId });
      } else summarySelections.delete(attractionId);
    }
    return { ...summaryIdentity, photos, busy: summaryBusy };
  }
  let composingReflection = null;
  let reflectionRenderPending = false;
  function getCardReflection(id, photoId) {
    const draft = cardReflections.get(photoId);
    const photo = store.getPhoto(id, photoId);
    return draft && photo && draft.writeId === photo.writeId ? draft.text : "";
  }
  let photoReadGeneration = 0;
  let photoReadError = false;
  let photoReadLoading = true;
  let camera = null;
  const operations = createOperationGuard({ isResetting: () => isResetting });
  const { invalidateAttractionOperations, invalidateAllOperations, isCurrentDataGeneration, waitForPhotoTasks } = operations;
  const views = createViews();
  let registrationPromise = null;
  const pushClient = pushClientFactory({ environment,
    getRegistration: () => registrationPromise,
    onChange: () => { if (currentRoute().view === "home") render(); }
  });
  function getInstallState() {
    const standalone = navigator.standalone === true || environment.matchMedia?.("(display-mode: standalone)")?.matches === true;
    const appleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent || "") || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const mode = standalone || installedInSession ? "none" : installPrompt ? "native" : appleMobile ? "ios" : "none";
    return { mode, helpOpen: mode === "ios" && iosInstallHelpOpen };
  }
  const pages = createPageModels({ store, getInstallState, getPhotoPreview,
    getSelectedPhotoIds: () => [...selectedPhotoIds], getCardReflection, getPhotoReadError: () => photoReadError,
    getPhotoReadState: () => photoReadLoading ? "loading" : photoReadError ? "error" : "ready", getSummaryDraft, getMemoryState, getPushSnapshot: pushClient.getSnapshot });
  const photoActions = createPhotoActions({
    getCheckIn: store.getCheckIn, getPhoto: store.getPhoto, getPhotoVersion: store.getPhotoVersion,
    canUseAttraction, canUsePhotoActions, getPhotoById: store.getPhotoById, operations, capturePageToken, isPageCurrent,
    photoService, refreshPhotos, render, showToast, askConfirmation, document, window, URL, navigator,
    photoSavedMessage: "紀念照已保存，可到「旅途回憶」查看。",
    photoReadFailureMessage: "紀念照已保存，但暫時未能讀回，請重新開啟「旅途回憶」。",
    showPhotoExport, hidePhotoExport,
    captureActionContext: () => memoryEpoch, isActionContextCurrent: (epoch) => epoch === memoryEpoch
  });
  const { processPhoto, downloadTravelCard, downloadTripAIKit } = photoActions;
  function showPhotoExport(model) {
    if (!photoExportDialog || !model) return;
    const content = document.querySelector("#photo-export-content");
    if (!content) return;
    const oldStatus = content.dataset.status;
    const focused = document.activeElement;
    const focusedIndex = focused?.dataset?.photoExportDownload;
    const focusedAll = focused?.matches?.("[data-photo-export-download-all]");
    const focusedShare = focused?.matches?.("[data-photo-export-share]");
    const focusedId = focused?.id;
    if (model.status === "preparing" && oldStatus !== "preparing") exportOptions = { page: 0, moreOpen: false };
    suspendMemory();
    content.innerHTML = views.renderPhotoExport(model, exportOptions);
    content.dataset.status = model.status;
    if (!photoExportDialog.open) photoExportDialog.showModal();
    if (model.delivery) {
      content.querySelector?.("#photo-export-status")?.focus();
    } else if (model.status === "ready" && oldStatus === "preparing") {
      content.querySelector?.("[data-photo-export-download-all], [data-photo-export-share], [data-photo-export-download]")?.focus();
    } else if (focusedIndex !== undefined) {
      [...content.querySelectorAll("[data-photo-export-download]")].find(item => item.dataset.photoExportDownload === focusedIndex)?.focus();
    } else if (focusedAll) content.querySelector?.("[data-photo-export-download-all]")?.focus();
    else if (focusedShare) content.querySelector?.("[data-photo-export-share]")?.focus();
    else if (focusedId) document.getElementById(focusedId)?.focus({ preventScroll: true });
  }
  function hidePhotoExport() {
    if (photoExportDialog?.open) photoExportDialog.close();
    const content = document.querySelector("#photo-export-content");
    if (content) { content.innerHTML = ""; delete content.dataset.status; }
    resumeMemory();
  }
  const operationToken = (id) => ({ data: operations.operationToken(id), page: capturePageToken() });
  const isCurrentOperation = (id, token) => canUseAttraction(id) && isPageCurrent(token?.page) && operations.isCurrentOperation(id, token?.data);
  camera = createCameraController({
    document, navigator, URL, hasCheckIn: store.hasCheckIn, canUseAttraction,
    isResetting: () => isResetting, operationToken, isCurrentOperation, showToast, processPhoto, beginPhotoSelection
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
      return getAttraction(attractionId) ? { view: "attraction", attractionId } : { view: "itinerary" };
    }
    if (route === "attractions") return { view: "itinerary" };
    const allowed = ["home", "itinerary", "memories"];
    return { view: allowed.includes(route) ? route : "home" };
  }
  function routeKey(route) { return route.view === "attraction" ? `attraction/${route.attractionId}` : route.view; }
  function releasePreview() {
    for (const preview of previews.values()) URL.revokeObjectURL(preview.url);
    previews.clear();
  }
  function leavePage() {
    iosInstallHelpOpen = false;
    pageGeneration += 1;
    closeMemory({ restore: false });
    selectedPhotoIds.clear();
    cardReflections.clear();
    clearSummaryDraft();
    composingReflection = null;
    reflectionRenderPending = false;
    photoActions.cancelPhotoExport();
    camera?.stopCamera();
    if (cameraDialog.open) cameraDialog.close();
    photoSelection = null;
    nativeCameraInput.value = "";
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
  function canUsePhotoActions(id) { return canUsePage("memories") && !photoReadLoading && !photoReadError && Boolean(getAttraction(id)) && store.hasCheckIn(id); }
  function getPhotoPreview(id, photoId) {
    if (!canUsePhotoActions(id)) return null;
    const record = store.getPhoto(id, photoId);
    if (!record) return null;
    const version = store.getPhotoVersion(id);
    const key = record.photoId;
    previewUse?.add(key);
    const preview = previews.get(key);
    if (preview?.id === id && preview.version === version) return preview.url;
    if (preview) URL.revokeObjectURL(preview.url);
    previews.delete(key);
    try {
      const url = URL.createObjectURL(record.blob);
      previews.set(key, { id, version, url });
      return url;
    } catch { return null; }
  }
  function getPageSnapshot() { return pages.getPageModel(syncRoute()); }
  function beginPhotoSelection(id) {
    if (!canUseAttraction(id) || !store.hasCheckIn(id)) return false;
    photoSelection = { attractionId: id, pageToken: capturePageToken(), dataToken: operations.operationToken(id) };
    nativeCameraInput.value = "";
    return true;
  }

  function setActiveNavigation(route) {
    const active = route.view === "attraction" ? "itinerary" : route.view;
    document.querySelectorAll("[data-nav]").forEach((item) => {
      const selected = item.dataset.nav === active;
      item.classList.toggle("is-active", selected);
      if (selected) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
  }
  function render({ moveFocus = false } = {}) {
    const route = syncRoute();
    const key = routeKey(route);
    if (composingReflection && composingReflection.isConnected !== false
      && (app.contains(composingReflection) || memoryContent?.contains(composingReflection)) && key === renderedRouteKey) {
      reflectionRenderPending = true;
      return;
    }
    const focused = document.activeElement;
    const hadFocus = focused && (app.contains(focused) || memoryDialog.open && memoryContent?.contains(focused));
    const focusId = focused?.id;
    const focusData = ["photoSelect", "photoSelectAll", "photoSelectNone", "photoExportSelected", "cardReflection", "summaryField"].find((key) => focused?.dataset?.[key]);
    const focusValue = focusData ? focused.dataset[focusData] : null;
    const selection = ["cardReflection", "summaryField"].includes(focusData) ? {
      start: focused.selectionStart, end: focused.selectionEnd, direction: focused.selectionDirection
    } : null;
    const neededPreviews = new Set();
    previewUse = neededPreviews;
    let model;
    try { model = pages.getPageModel(route); }
    finally { previewUse = null; }
    for (const [id, preview] of previews) if (!neededPreviews.has(id)) { URL.revokeObjectURL(preview.url); previews.delete(id); }
    setActiveNavigation(route);
    document.body.dataset.view = route.view;
    const renderers = { home: views.renderHome, itinerary: views.renderItinerary, attraction: views.renderAttraction, memories: views.renderMemories };
    app.innerHTML = renderers[route.view](model);
    const memoryScroll = document.getElementById("memory-body")?.scrollTop || 0;
    if (model.memoryOverlay && memoryContent) {
      memoryContent.innerHTML = views.renderMemoryOverlay(model.memoryOverlay);
      if (!memoryDialog.open) memoryDialog.showModal();
      const body = document.getElementById("memory-body");
      if (body) body.scrollTop = memoryScroll;
    } else {
      if (memoryDialog.open) memoryDialog.close();
      if (memoryContent) memoryContent.innerHTML = "";
    }
    if (moveFocus && key !== renderedRouteKey) app.focus({ preventScroll: true });
    else if (hadFocus) {
      const replacement = focusId ? document.getElementById(focusId)
        : [...app.querySelectorAll("input, button, textarea"), ...(memoryContent?.querySelectorAll("input, button, textarea") || [])].find((item) => focusData && item.dataset[focusData] === focusValue);
      replacement?.focus({ preventScroll: true });
      if (selection && Number.isInteger(selection.start) && Number.isInteger(selection.end)) {
        replacement?.setSelectionRange(selection.start, selection.end, selection.direction);
      }
    }
    renderedRouteKey = key;
  }
  async function refreshPhotos() {
    const request = ++photoReadGeneration;
    const dataGeneration = operations.generation;
    photoReadLoading = true;
    render();
    try {
      const records = await getAllPhotoRecords();
      if (request !== photoReadGeneration || dataGeneration !== operations.generation) return false;
      photoReadError = false;
      photoReadLoading = false;
      store.replacePhotos(records);
      validateMemory();
      getSummaryDraft();
      for (const id of selectedPhotoIds) if (!records.some(record => (record.photoId || record.attractionId) === id)) selectedPhotoIds.delete(id);
      photoActions.validatePhotoExport();
      releasePreview();
      return true;
    } catch {
      if (request === photoReadGeneration && dataGeneration === operations.generation) {
        photoReadError = true;
        photoReadLoading = false;
        store.replacePhotos([]);
        closeMemory({ restore: false });
        summarySelections.clear();
        photoActions.cancelSummaryCard();
        selectedPhotoIds.clear();
        photoActions.cancelPhotoExport();
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
      message: store.hasPhoto(id) ? "取消後會刪除這個景點在 App 內的全部紀念照，無法復原；已匯出到相簿、下載或分享的相片不會被刪除。" : "取消後會移除時間及核實狀態。",
      confirmText: "取消打卡", danger: true, isRelevant: relevant
    });
    if (!accepted || !relevant()) return;
    selectedPhotoIds.clear();
    cardReflections.clear();
    clearSummaryDraft();
    photoActions.cancelPhotoExport();
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
    const first = await askConfirmation({ title: "清除所有本機旅程資料？", message: "這會移除所有打卡和 App 內的紀念照；已匯出到相簿、下載或分享的相片不會被刪除。訊息通知須在通知設定另行關閉。", confirmText: "繼續", danger: true, isRelevant: relevant });
    if (!first || !relevant()) return;
    const second = await askConfirmation({ title: "最後確認", message: "資料一經清除便無法復原。你確定要重新開始嗎？", confirmText: "永久清除", danger: true, isRelevant: relevant });
    if (!second || !relevant()) return;
    isResetting = true;
    selectedPhotoIds.clear();
    cardReflections.clear();
    clearSummaryDraft();
    photoActions.cancelPhotoExport();
    invalidateAllOperations();
    camera.stopCamera();
    photoSelection = null;
    nativeCameraInput.value = "";
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

  function updateCardReflection(event) {
    const target = event.target;
    if (isCurrentControl(target) && target.matches("[data-summary-field]")) {
      if (event.isComposing || target === composingReflection || summaryBusy || memoryFrame()?.mode !== "summary" || !canUsePage("memories") || !store.hasCompletedAllCheckIns()) return;
      const field = target.dataset.summaryField;
      if (!Object.hasOwn(SUMMARY_IDENTITY_LIMITS, field)) return;
      const value = String(target.value || "");
      const text = limitSummaryField(value, field);
      if (text !== value) {
        const start = target.selectionStart, end = target.selectionEnd, direction = target.selectionDirection;
        target.value = text;
        if (Number.isInteger(start) && Number.isInteger(end)) target.setSelectionRange(Math.min(start, text.length), Math.min(end, text.length), direction);
      }
      summaryIdentity[field] = text;
      const counter = document.getElementById(`summary-${field}-hint`);
      if (counter) counter.textContent = `${Array.from(text).length}／${SUMMARY_IDENTITY_LIMITS[field]} 字`;
      // Keep the live input and IME intact; only update the requirement message and button.
      const model = pages.getPageModel(syncRoute()).summaryCard;
      const download = document.getElementById("summary-download");
      if (download) {
        download.disabled = !model.canDownload;
        download.textContent = `下載 AI 素材包 ZIP${model.canDownload ? `（${model.selectedCount} 張）` : ""}`;
      }
      const requirements = document.getElementById("summary-requirements");
      if (requirements) requirements.innerHTML = views.renderSummaryRequirements(model);
      return;
    }
    if (!isCurrentControl(target) || !target.matches("[data-card-reflection]")) return;
    if (event.isComposing || target === composingReflection) return;
    const photoId = target.dataset.cardReflection;
    const photo = store.getPhotoById(photoId);
    if (!photo || !canUsePhotoActions(photo.attractionId) || cardTask || memoryFrame()?.mode !== "photo"
      || !memoryFrame().cardOpen || memoryFrame().photoId !== photoId) return;
    const value = String(target.value || "");
    const text = limitCardReflection(value);
    if (text !== value) {
      const start = target.selectionStart, end = target.selectionEnd, direction = target.selectionDirection;
      target.value = text;
      if (Number.isInteger(start) && Number.isInteger(end)) {
        target.setSelectionRange(Math.min(start, text.length), Math.min(end, text.length), direction);
      }
    }
    cardReflections.set(photoId, { text, writeId: photo.writeId });
    const counter = document.getElementById(target.getAttribute("aria-describedby"));
    if (counter) counter.textContent = `${countReflectionCharacters(text)} / ${MAX_REFLECTION_LENGTH} 字。留空不加入感想；只留在目前頁面，離開或重新載入後會清除。`;
  }
  document.addEventListener("input", updateCardReflection);
  document.addEventListener("compositionstart", (event) => {
    if (isCurrentControl(event.target) && (event.target.matches("[data-card-reflection]") || event.target.matches("[data-summary-field]"))) composingReflection = event.target;
  });
  document.addEventListener("compositionend", (event) => {
    if (composingReflection !== event.target) return;
    composingReflection = null;
    const pending = reflectionRenderPending;
    reflectionRenderPending = false;
    updateCardReflection(event);
    if (pending) render();
  });

  const isCurrentControl = (target) => target?.isConnected !== false && !photoExportDialog?.open
    && (memoryDialog.open && !memorySuspended ? memoryContent?.contains(target) : !memoryFrames.length && app.contains(target));
  const currentPagePhotos = () => {
    const frame = memoryFrame();
    const photos = frame ? [...store.getPhotos(frame.attractionId)].reverse() : [];
    const page = Math.min(frame?.page || 0, Math.max(0, Math.ceil(photos.length / 12) - 1));
    return photos.slice(page * 12, page * 12 + 12);
  };
  const allPhotoIds = () => CHECK_IN_LOCATIONS.filter(item => store.hasCheckIn(item.id))
    .flatMap(item => store.getPhotos(item.id).map(photo => photo.photoId));
  async function prepareExport(attractionId, ids) {
    if (!canUsePage("memories") || photoReadLoading || photoReadError || !ids.length) return;
    exportRequest = { attractionId, ids: [...ids], epoch: memoryEpoch };
    await photoActions.preparePhotoExport(attractionId, ids);
  }
  document.addEventListener("change", (event) => {
    const target = event.target;
    if (isCurrentControl(target) && target.matches("[data-summary-select]")) {
      const id = target.dataset.summarySelect;
      if (summaryBusy || !target.checked || !canUsePhotoActions(id) || !store.hasCompletedAllCheckIns()
        || memoryFrame()?.mode !== "picker" || memoryFrame().attractionId !== id
        || !currentPagePhotos().some(photo => photo.photoId === target.dataset.summaryPhotoId)) return;
      const record = store.getPhoto(id, target.dataset.summaryPhotoId);
      if (!record || record.photoId !== target.dataset.summaryPhotoId) return;
      summarySelections.set(id, { photoId: record.photoId, writeId: record.writeId, blob: record.blob });
      backMemory();
      return;
    }
    if (isCurrentControl(target) && target.matches("[data-photo-select]")) {
      const id = target.dataset.photoSelect;
      const photo = store.getPhotoById(id);
      if (!photo || !canUsePhotoActions(photo.attractionId) || memoryFrame()?.mode !== "album"
        || !currentPagePhotos().some(item => item.photoId === id)) return;
      if (target.checked) selectedPhotoIds.add(id); else selectedPhotoIds.delete(id);
      render();
      return;
    }
  });
  document.addEventListener("click", async (event) => {
    const target = event.target.closest("button, a");
    if (!target) return;
    const inPhotoExport = photoExportDialog?.open && target.isConnected !== false && photoExportDialog.contains(target);
    if (inPhotoExport) {
      if (target.matches("[data-photo-export-close]")) photoActions.cancelPhotoExport();
      if (target.matches("[data-photo-export-download-all]")) photoActions.downloadAllPhotoExport();
      if (target.matches("[data-photo-export-share]")) await photoActions.sharePhotoExport();
      if (target.matches("[data-photo-export-download]")) {
        const index = target.dataset.photoExportDownload;
        if (/^(0|[1-9]\d*)$/.test(index)) photoActions.downloadPhotoExport(Number(index));
      }
      if (target.matches("[data-export-more]")) {
        exportOptions.moreOpen = !exportOptions.moreOpen;
        showPhotoExport(photoActions.getPhotoExportModel());
      }
      if (target.matches("[data-export-page]")) {
        const page = Number(target.dataset.exportPage), model = photoActions.getPhotoExportModel();
        if (!target.disabled && Number.isInteger(page) && page >= 0 && page < Math.ceil((model?.files.length || 0) / 12)) {
          exportOptions.page = page;
          showPhotoExport(model);
        }
      }
      if (target.matches("[data-export-retry]") && exportRequest?.epoch === memoryEpoch) {
        await prepareExport(exportRequest.attractionId, exportRequest.ids);
      }
      return;
    }
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
    if (target.matches("[data-memory-close]")) { closeMemory(); return; }
    if (target.matches("[data-memory-back]")) { backMemory(); return; }
    if (target.disabled) return;
    if (canUsePage("memories") && !photoReadLoading && !photoReadError) {
      const frame = memoryFrame();
      if (target.matches("[data-memory-album]")) {
        const id = target.dataset.memoryAlbum;
        if (!frame && canUsePhotoActions(id) && store.hasPhoto(id)) changeMemory({ mode: "album", attractionId: id, page: 0 });
        return;
      }
      if (target.matches("[data-memory-summary-open]")) {
        if (!frame && store.hasCompletedAllCheckIns()) changeMemory({ mode: "summary" });
        return;
      }
      if (target.matches("[data-memory-page]")) {
        const page = Number(target.dataset.memoryPage);
        if (["album", "picker"].includes(frame?.mode) && Number.isInteger(page) && page >= 0 && page < Math.ceil(store.getPhotos(frame.attractionId).length / 12)) {
          frame.page = page;
          memoryEpoch++;
          render();
          document.getElementById("memory-body").scrollTop = 0;
          if (document.getElementById(target.id)?.disabled) document.getElementById("memory-title")?.focus({ preventScroll: true });
        }
        return;
      }
      if (target.matches("[data-memory-photo]")) {
        const id = target.dataset.memoryPhoto;
        if (frame?.mode === "album" && currentPagePhotos().some(photo => photo.photoId === id)) {
          changeMemory({ mode: "photo", attractionId: frame.attractionId, photoId: id, cardOpen: false }, true);
        }
        return;
      }
      if (target.matches("[data-memory-photo-step]")) {
        if (frame?.mode === "photo" && ["previous", "next"].includes(target.dataset.memoryPhotoStep)) {
          finishComposition();
          const photos = [...store.getPhotos(frame.attractionId)].reverse(), index = photos.findIndex(photo => photo.photoId === frame.photoId);
          const next = photos[index + (target.dataset.memoryPhotoStep === "previous" ? -1 : 1)];
          if (next) { frame.photoId = next.photoId; frame.cardOpen = false; frame.scrollTop = 0; memoryEpoch++; cardTask = null; render();
            document.getElementById("memory-body").scrollTop = 0; document.getElementById("memory-title")?.focus({ preventScroll: true }); }
        }
        return;
      }
      if (target.matches("[data-memory-card-toggle]")) {
        if (frame?.mode === "photo" && !cardTask) { frame.cardOpen = !frame.cardOpen; memoryEpoch++; render();
          if (frame.cardOpen) document.getElementById("memory-reflection")?.focus({ preventScroll: true }); }
        return;
      }
      if (target.matches("[data-memory-pick]")) {
        const id = target.dataset.memoryPick;
        if (frame?.mode === "summary" && !summaryBusy && canUsePhotoActions(id) && store.hasPhoto(id)) {
          changeMemory({ mode: "picker", attractionId: id, page: 0 }, true);
        }
        return;
      }
      if (target.matches("[data-memory-summary-omit]")) {
        if (frame?.mode === "summary" && !summaryBusy && target.dataset.memorySummaryOmit === DEPARTURE_LOCATION.id) {
          summarySelections.delete(DEPARTURE_LOCATION.id); render();
          document.getElementById(`memory-pick-${DEPARTURE_LOCATION.id}`)?.focus({ preventScroll: true });
        }
        return;
      }
      if (target.matches("[data-memory-album-select]")) {
        if (frame?.mode === "album") {
          for (const photo of store.getPhotos(frame.attractionId)) {
            if (target.dataset.memoryAlbumSelect === "all") selectedPhotoIds.add(photo.photoId); else selectedPhotoIds.delete(photo.photoId);
          }
          render();
        }
        return;
      }
      if (target.matches("[data-memory-download-all]")) { if (!frame) await prepareExport(null, allPhotoIds()); return; }
      if (target.matches("[data-memory-download-album]")) { if (frame?.mode === "album") await prepareExport(frame.attractionId, store.getPhotos(frame.attractionId).map(photo => photo.photoId)); return; }
      if (target.matches("[data-memory-download-photo]")) { if (frame?.mode === "photo" && !cardTask) await prepareExport(frame.attractionId, [frame.photoId]); return; }
    }
    if (target.matches("[data-summary-download]")) {
      if (summaryBusy || memoryFrame()?.mode !== "summary" || !canUsePage("memories")) return;
      const model = pages.getPageModel(syncRoute()).summaryCard;
      if (!model?.canDownload) return;
      const draft = getSummaryDraft();
      const pageToken = capturePageToken();
      const epoch = memoryEpoch;
      summaryBusy = true;
      render();
      try { await downloadTripAIKit(draft); }
      finally {
        if (isPageCurrent(pageToken) && epoch === memoryEpoch) {
          summaryBusy = false;
          render();
          document.getElementById("summary-download")?.focus({ preventScroll: true });
        }
      }
      return;
    }
    if (target.matches("[data-photos-retry]")) {
      if (canUsePage("memories")) { await refreshPhotos(); render(); }
      return;
    }
    if (target.matches("[data-push-enable]")) {
      if (canUsePage("home") && !target.disabled && pushClient.getSnapshot().canEnable) await pushClient.enable();
      return;
    }
    if (target.matches("[data-push-disable]")) {
      if (canUsePage("home") && !target.disabled && pushClient.getSnapshot().canDisable) await pushClient.disable();
      return;
    }
    if (target.matches("[data-photo-select-all], [data-photo-select-none], [data-photo-export-selected]")) {
      if (!canUsePage("memories")) return;
      if (target.matches("[data-photo-export-selected]")) {
        if (!memoryFrame() || memoryFrame().mode === "album") await prepareExport(null, [...selectedPhotoIds]);
      } else {
        selectedPhotoIds.clear();
        if (target.matches("[data-photo-select-all]")) for (const id of allPhotoIds()) selectedPhotoIds.add(id);
        render();
        if (target.matches("[data-photo-select-none]")) document.getElementById(memoryFrame() ? "memory-album-selection" : "memory-download-all")?.focus({ preventScroll: true });
      }
      return;
    }
    if (target.matches("[data-checkin]")) await startCheckIn(target.dataset.checkin, target);
    if (target.matches("[data-checkin-undo]")) await undoCheckIn(target.dataset.checkinUndo);
    if (target.matches("[data-camera-open]")) await camera.openCamera(target.dataset.cameraOpen);
    if (target.matches("[data-native-camera-open]")) camera.openNativeCamera(target.dataset.nativeCameraOpen);
    if (target.matches("[data-card-download]")) {
      const frame = memoryFrame();
      if (cardTask || frame?.mode !== "photo" || !frame.cardOpen || frame.attractionId !== target.dataset.cardDownload || frame.photoId !== target.dataset.photoId) return;
      const task = { epoch: memoryEpoch, page: capturePageToken() };
      cardTask = task;
      render();
      try { await downloadTravelCard(frame.attractionId, frame.photoId, getCardReflection(frame.attractionId, frame.photoId)); }
      finally { if (cardTask === task) { cardTask = null; if (isPageCurrent(task.page) && task.epoch === memoryEpoch) {
        render(); document.getElementById("memory-download-card")?.focus({ preventScroll: true });
      } } }
    }
    if (target.matches("[data-reset-all]")) await resetAllData();
    if (target.id === "install-button" && canUsePage("home") && !target.disabled && !nativeInstalling) {
      const { mode } = getInstallState();
      if (mode === "ios") {
        iosInstallHelpOpen = !iosInstallHelpOpen;
        render();
      } else if (mode === "native") {
        const prompt = installPrompt;
        installPrompt = null;
        nativeInstalling = true;
        try {
          // Invoke immediately within the click; consume each browser event once.
          await prompt.prompt();
          await prompt.userChoice;
        } catch { showToast("未能開啟安裝提示，請使用瀏覽器選單的安裝功能。", "warning"); }
        finally { nativeInstalling = false; render(); }
      }
    }
  });
  nativeCameraInput.addEventListener("cancel", () => {
    photoSelection = null;
    nativeCameraInput.value = "";
  });
  nativeCameraInput.addEventListener("change", async () => {
    const selection = photoSelection;
    photoSelection = null;
    const file = nativeCameraInput.files?.[0];
    nativeCameraInput.value = "";
    if (!selection || !file || !isPageCurrent(selection.pageToken) || !canUseAttraction(selection.attractionId)
      || !operations.isCurrentOperation(selection.attractionId, selection.dataToken)) return;
    await processPhoto(file, selection.attractionId, selection);
  });
  cameraDialog.addEventListener("close", () => {
    // A queued close from the previous opening must not stop a reopened camera.
    if (!cameraDialog.open) camera.stopCamera();
  });
  photoExportDialog?.addEventListener("cancel", () => photoActions.cancelPhotoExport());
  photoExportDialog?.addEventListener("close", () => {
    if (!photoExportDialog.open) photoActions.cancelPhotoExport();
  });
  window.addEventListener("hashchange", () => {
    syncRoute();
    render({ moveFocus: true });
    const reduceMotion = environment.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  });
  window.addEventListener("online", () => { updateNetworkStatus(); void pushClient.refresh(); });
  window.addEventListener("offline", updateNetworkStatus);
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    if (installedInSession || navigator.standalone === true || environment.matchMedia?.("(display-mode: standalone)")?.matches === true) return;
    installPrompt = event;
    iosInstallHelpOpen = false;
    render();
  });
  window.addEventListener("appinstalled", () => { installedInSession = true; installPrompt = null; iosInstallHelpOpen = false; render(); });
  window.addEventListener("beforeunload", leavePage);
  window.addEventListener("pagehide", leavePage);
  window.addEventListener("pageshow", () => { render(); void pushClient.refresh(); });
  window.addEventListener("focus", () => { void pushClient.refresh(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void pushClient.refresh();
  });
  function updateNetworkStatus() {
    const online = navigator.onLine;
    networkStatus.textContent = online ? "已連線" : "離線可用";
    networkStatus.classList.toggle("is-offline", !online);
  }
  async function start() {
    updateNetworkStatus();
    if (!registrationPromise && "serviceWorker" in navigator) {
      const workerUrl = new URL("../sw.js", import.meta.url);
      registrationPromise = navigator.serviceWorker.register(workerUrl).then((registration) => {
        if (registration.active) return registration;
        const worker = registration.installing || registration.waiting;
        if (!worker) throw new Error("Service Worker 尚未啟用。");
        // ready can resolve to another same-origin app's broader scope.
        return new Promise((resolve, reject) => {
          const finish = (error) => {
            window.clearTimeout(timer);
            worker.removeEventListener("statechange", check);
            error ? reject(error) : resolve(registration);
          };
          const check = () => {
            if (worker.state === "activated" && registration.active) finish();
            else if (worker.state === "redundant") finish(new Error("Service Worker 啟用失敗。"));
          };
          const timer = window.setTimeout(() => finish(new Error("Service Worker 啟用逾時。")), 12000);
          worker.addEventListener("statechange", check);
          check();
        });
      }).catch(() => { showToast("離線功能暫時未能啟用。", "warning"); return null; });
    }
    await refreshPhotos();
    render();
    await pushClient.initialize();
  }
  return { start, render, currentRoute, getPageSnapshot };
}
