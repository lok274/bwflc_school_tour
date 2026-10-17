import { createMemoryController } from "./memory-controller.js";
import { createPhotoExportController } from "./photo-export-controller.js";
import { createCheckInCardController } from "./check-in-card-controller.js";
import { PHOTO_PAGE_SIZE, normalizeRehearsalScenario, rehearsalPageHref, CHECK_IN_SYNC_ENDPOINT } from "./app-settings.js";
import { createCheckInSync } from "./check-in-sync.js";
import { createStudentLoginController } from "./student-login-controller.js";
import * as defaultPhotoService from "./photos.js";
import { getAttraction } from "./formatting.js";
import { CHECK_IN_LOCATIONS, REQUIRED_CHECK_IN_LOCATIONS, TRIP_DATA } from "./data.js";
import { createDataStore } from "./store.js";
import { createPageModels } from "./page-models.js";
import { createViews } from "./views.js";
import { createFeedback } from "./feedback.js";
import { createOperationGuard } from "./operations.js";
import { createCameraController } from "./camera.js";
import { createCheckInController } from "./check-in.js";
import { createPhotoActions } from "./photo-actions.js";
import { parseRoute, routeKey, MEMORY_SECTIONS } from "./routes.js";
import { decorateInterface } from "./view-components.js";
import { MAX_REFLECTION_LENGTH, countReflectionCharacters, limitCardReflection } from "./card-reflection.js";

// The controller owns permissions and lifecycle; modules receive narrow capabilities.
export function createAppController({ environment = globalThis, photoService = defaultPhotoService, feedbackService, completionCardService, viewsFactory = createViews, testKind = null, onLocationRequest = () => {}, syncEndpoint = environment === globalThis ? CHECK_IN_SYNC_ENDPOINT : "", syncRepository, syncTransport, syncDatabaseName } = {}) {
  const { document, window, navigator, location, URL, requestAnimationFrame } = environment;
  let localStorage;
  try { localStorage = environment.localStorage; }
  catch {
    const unavailable = () => { throw Error("瀏覽器禁止儲存資料。"); };
    localStorage = { getItem: unavailable, setItem: unavailable, removeItem: unavailable };
  }
  const { clearPhotoRecords, deletePhotoRecord, getAllPhotoRecords } = photoService;
  const app = document.querySelector("#app");
  const networkStatus = document.querySelector("#network-status");
  const cameraDialog = document.querySelector("#camera-dialog");
  const nativeCameraInput = document.querySelector("#native-camera-input");
  const photoExportDialog = document.querySelector("#photo-export-dialog");
  let installDialog = document.querySelector("#install-invitation");
  if (!installDialog) {
    installDialog = document.createElement("dialog");
    installDialog.id = "install-invitation";
    installDialog.className = "install-invitation";
    installDialog.setAttribute("aria-labelledby", "install-invitation-title");
    installDialog.setAttribute("closedby", "closerequest");
    document.body.append(installDialog);
  }
  const feedback = feedbackService || createFeedback({ document, window, requestAnimationFrame });
  const { showToast, celebrateStamp } = feedback;
  let sync, pageActive = true;
  let syncDialog = null, syncPromptHandled = false, syncReturnFocus = null;
  const store = createDataStore({ storage: localStorage, onSaveError: () => showToast("未能保存進度，可能是瀏覽器儲存空間不足。", "warning") });
  const login = createStudentLoginController({ document, app, storage: localStorage,
    renderLogin: model => views.renderStudentLogin({ ...model, canInstall: model.mode === "initial" && getInstallState().mode !== "none" }), isResetting: () => isResetting,
    isCurrentControl: target => isCurrentControl(target), getPageGeneration: () => pageGeneration, isPageActive: () => pageActive,
    pauseJourney: pauseForIdentity, leaveJourney: leavePage,
    enterJourney: async () => {
      store.syncProgress();
      await refreshPhotos(); render({ moveFocus: true });
      if (!focusSection(currentRoute())) app.focus({ preventScroll: true });
      maybeInviteSync();
    },
    render, formRendered: () => { renderedRouteKey = null; },
    askConfirmation: options => feedback.askConfirmation(options), showToast,
    prepareEntry: profile => sync.start(profile),
    prepareLogout: () => sync.prepareLogout(),
    pauseIdentity: () => { closeSyncDialog(); sync.invalidate(); },
    resumeIdentity: () => { if (identityReady()) void sync.start(); }
  });
  const { isReady: identityReady, getIdentity } = login;
  sync = createCheckInSync({ environment, endpoint: syncEndpoint, repository: syncRepository, transport: syncTransport, databaseName: syncDatabaseName,
    getIdentity: () => login.isRemembered() ? getIdentity() : null, canRun: identityReady, onChange: updateSyncStatus });
  function updateSyncStatus(model = sync?.getState()) {
    if (!model || !identityReady()) return;
    const status = document.getElementById("check-in-sync-status"), reason = document.getElementById("check-in-sync-reason"), button = document.getElementById("check-in-sync-action");
    if (status) status.textContent = `${model.status}${model.pending ? ` · ${model.pending} 筆` : ""}`;
    if (reason) reason.textContent = model.reason;
    if (button) { button.disabled = model.disabled; button.textContent = model.button; }
    if (model.closed && syncDialog?.open) {
      const enable = document.getElementById("sync-enable"), error = document.getElementById("sync-dialog-error");
      if (enable) { enable.disabled = true; enable.textContent = "已截止"; }
      if (error) { error.textContent = model.reason; error.hidden = false; }
    }
  }
  function closeSyncDialog() {
    if (syncDialog?.open) syncDialog.close();
    if (syncDialog) syncDialog.innerHTML = "";
    syncReturnFocus?.focus?.({ preventScroll: true }); syncReturnFocus = null;
  }
  function openSyncDialog() {
    const model = sync.getState();
    if (!identityReady() || !model || model.closed || model.busy || model.disabled && !model.enabled
      || [...document.querySelectorAll("dialog")].some(item => item.open)) return;
    syncPromptHandled = true;
    if (!syncDialog) {
      syncDialog = document.createElement("dialog"); syncDialog.id = "check-in-sync-dialog";
      syncDialog.className = "sync-dialog"; syncDialog.setAttribute("aria-labelledby", "sync-dialog-title");
      syncDialog.setAttribute("closedby", "closerequest"); document.body.append(syncDialog);
      syncDialog.addEventListener("cancel", event => { event.preventDefault(); sync.invalidate(); closeSyncDialog(); });
      syncDialog.addEventListener("close", () => { if (!syncDialog.open && syncDialog.innerHTML) { sync.invalidate(); closeSyncDialog(); } });
    }
    syncReturnFocus = document.activeElement;
    syncDialog.innerHTML = views.renderSyncInvitation();
    decorateInterface(document); syncDialog.showModal(); document.getElementById("sync-enable")?.focus();
  }
  function maybeInviteSync() {
    if (!syncPromptHandled && identityReady() && !sync.getState()?.enabled) openSyncDialog();
  }
  let installPrompt = null;
  let nativeInstalling = false;
  let installedInSession = false;
  let iosInstallHelpOpen = false;
  const installStorageKey = "outdoorLearningDay.install.v1";
  try { installedInSession = localStorage.getItem(installStorageKey) === "installed"; }
  catch { /* Installation hints must not depend on storage being available. */ }
  let installInvitationHandled = false;
  let loginInputStarted = false;
  let installReturnFocus = null;
  let isResetting = false;
  let pageGeneration = 0;
  let sectionOverride = null;
  let sectionFocus = null;
  let activeRoute = currentRoute();
  let activeRouteKey = routeKey(activeRoute);
  let renderedRouteKey = null;
  const memoryPositions = new Map();
  let pendingMemoryPosition = null;
  let photoSelection = null;
  const previews = new Map();
  const disclosures = new Map();
  let rehearsalScenario = "within";
  let previewUse = null;
  let cardTask = null;
  const memory = createMemoryController({ document, window, app, store,
    finishComposition, render, cancelWork: () => { cardTask = null; },
    getBusy: epoch => cardTask?.epoch === epoch, isSelected: id => selectedPhotoIds.has(id),
    isPhotoReady: () => !photoReadLoading && !photoReadError, canUsePhotoActions,
    canUse: () => canUsePage("memories"), isExportOpen: () => photoExportDialog?.open });
  const { getState: getMemoryState, frame: memoryFrame, change: changeMemory, close: closeMemory,
    back: backMemory, suspend: suspendMemory, resume: resumeMemory, validate: validateMemory,
    selectionChanged: albumSelectionChanged, canChangeSelection: canChangeAlbumSelection } = memory;
  let exportRequest = null;
  function finishComposition() {
    const target = composingReflection;
    composingReflection = null;
    reflectionRenderPending = false;
    if (target) updateCardReflection({ target });
  }
  async function askConfirmation(options) {
    const epoch = memory.epoch, page = capturePageToken();
    if (memory.depth) suspendMemory();
    try { return await feedback.askConfirmation(options); }
    finally { if (epoch === memory.epoch && isPageCurrent(page)) resumeMemory(); }
  }
  const selectedPhotoIds = new Set();
  const cardReflections = new Map();
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
  let checkInController = null;
  const operations = createOperationGuard({ isResetting: () => isResetting });
  const { invalidateAttractionOperations, invalidateAllOperations, isCurrentDataGeneration, waitForPhotoTasks } = operations;
  const views = viewsFactory();
  let registrationPromise = null;
  function getInstallState() {
    const standalone = navigator.standalone === true || environment.matchMedia?.("(display-mode: standalone)")?.matches === true;
    const appleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent || "") || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const mode = standalone || installedInSession ? "none" : installPrompt ? "native" : appleMobile ? "ios" : "manual";
    return { mode, helpOpen: (mode === "ios" || mode === "manual") && iosInstallHelpOpen };
  }
  function closeInstallInvitation({ restore = true } = {}) {
    const focused = installReturnFocus;
    installReturnFocus = null;
    if (installDialog.open) installDialog.close();
    if (restore && focused?.isConnected !== false) focused?.focus({ preventScroll: true });
  }
  function openInstallInvitation() {
    const { mode } = getInstallState();
    if (mode === "none" || identityReady() || login.getModel().mode !== "initial" || nativeInstalling
      || [...document.querySelectorAll("dialog")].some(item => item !== installDialog && item.open)) return;
    installInvitationHandled = true;
    if (!installDialog.open) installReturnFocus = app.contains(document.activeElement)
      ? document.activeElement : document.getElementById("student-login-studentName");
    installDialog.innerHTML = views.renderInstallInvitation({ mode });
    decorateInterface(document);
    if (!installDialog.open) installDialog.showModal();
    document.querySelector(mode === "native" ? "#install-invitation [data-install-start]" : "#install-invitation [data-install-dismiss]")?.focus();
  }
  function maybeInviteInstallation() {
    if (installInvitationHandled || loginInputStarted || identityReady() || login.getModel().mode !== "initial"
      || document.activeElement?.dataset?.studentIdentityField) return;
    openInstallInvitation();
  }
  function refreshLoginInstallEntry() {
    const button = document.getElementById("student-login-install");
    if (button) button.hidden = identityReady() || login.getModel().mode !== "initial" || getInstallState().mode === "none";
  }
  function confirmInstallation({ remember = true } = {}) {
    installedInSession = true;
    installPrompt = null;
    iosInstallHelpOpen = false;
    installInvitationHandled = true;
    closeInstallInvitation();
    if (remember) {
      try { localStorage.setItem(installStorageKey, "installed"); }
      catch { /* Still hide the invitation for this visit if preferences cannot be saved. */ }
    }
    render();
  }
  async function startNativeInstallation() {
    if (nativeInstalling || getInstallState().mode !== "native") return;
    const prompt = installPrompt, generation = pageGeneration;
    installPrompt = null;
    nativeInstalling = true;
    closeInstallInvitation();
    try {
      // Keep the browser prompt in the synchronous part of the user's click.
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      if (!installedInSession && generation === pageGeneration) showToast("未能開啟安裝提示，請使用瀏覽器選單的安裝功能。", "warning");
    } finally {
      nativeInstalling = false;
      if (generation === pageGeneration) render();
    }
  }
  installDialog.addEventListener("cancel", event => { event.preventDefault(); closeInstallInvitation(); });
  installDialog.addEventListener("close", () => {
    if (installDialog.open) return;
    installInvitationHandled = true;
    const focused = installReturnFocus;
    installReturnFocus = null;
    if (focused?.isConnected !== false) focused?.focus({ preventScroll: true });
  });
  const pages = createPageModels({ store, getInstallState, getPhotoPreview, getSyncState: sync.getState,
    getSelectedPhotoIds: () => [...selectedPhotoIds], getCardReflection, getPhotoReadError: () => photoReadError,
    getPhotoReadState: () => photoReadLoading ? "loading" : photoReadError ? "error" : "ready", getMemoryState, getCheckInBusy: id => checkInController?.isPending(id) || false });
  const photoActions = createPhotoActions({
    getCheckIn: store.getCheckIn, getPhoto: store.getPhoto, getPhotoVersion: store.getPhotoVersion,
    canUseAttraction, canUsePhotoActions, getPhotoById: store.getPhotoById, operations, capturePageToken, isPageCurrent,
    photoService, refreshPhotos, render, showToast, askConfirmation, document, window, URL, navigator,
    photoSavedMessage: "紀念照已保存，可到「旅途回憶」查看。",
    photoReadFailureMessage: "紀念照已保存，但暫時未能讀回，請重新開啟「旅途回憶」。",
    showPhotoExport: model => exportUI.show(model), hidePhotoExport: () => exportUI.hide(),
    captureActionContext: () => memory.epoch, isActionContextCurrent: (epoch) => epoch === memory.epoch
  });
  const { processPhoto, downloadTravelCard } = photoActions;
  const exportUI = createPhotoExportController({ document, dialog: photoExportDialog, views, suspendMemory, resumeMemory });
  const operationToken = (id) => ({ data: operations.operationToken(id), page: capturePageToken() });
  const isCurrentOperation = (id, token) => canUseAttraction(id) && isPageCurrent(token?.page) && operations.isCurrentOperation(id, token?.data);
  camera = createCameraController({
    document, navigator, URL, hasCheckIn: store.hasCheckIn, canUseAttraction,
    isResetting: () => isResetting, operationToken, isCurrentOperation, showToast, processPhoto, beginPhotoSelection
  });
  checkInController = createCheckInController({
    hasCheckIn: store.hasCheckIn, canUseAttraction, operationToken, isCurrentOperation,
    commitCheckIn: (id, record, token) => {
      const result = isCurrentOperation(id, token) ? store.recordCheckIn(id, record) : { accepted: false, saved: false };
      if (result.accepted && result.saved) void sync.enqueue(record);
      return result;
    },
    render, showToast, askConfirmation, celebrateStamp, navigator, onLocationRequest
  });
  const { startCheckIn } = checkInController;
  const completionCard = createCheckInCardController({ environment, cardService: completionCardService,
    canUse: () => canUsePage("memories"), getIdentity,
    getPhotos: store.getPhotos, getPhotoVersion: store.getPhotoVersion,
    getPhotoReadState: () => photoReadLoading ? "loading" : photoReadError ? "error" : "ready",
    getCompletion: () => ({ ready: store.hasCompletedAllCheckIns(), testKind,
      records: REQUIRED_CHECK_IN_LOCATIONS.map(item => store.getCheckIn(item.id)) }),
    askConfirmation, showToast });

  function currentRoute(hash = location.hash) {
    const route = parseRoute(hash);
    if (sectionOverride?.hash === hash && sectionOverride.view === route.view) route.section = sectionOverride.section;
    return route;
  }
  function releasePreview() {
    for (const preview of previews.values()) URL.revokeObjectURL(preview.url);
    previews.clear();
  }
  function leavePage() {
    closeSyncDialog();
    checkInController?.cancelPending();
    closeInstallInvitation({ restore: false });
    iosInstallHelpOpen = false;
    pageGeneration += 1;
    closeMemory({ restore: false });
    memoryPositions.clear();
    selectedPhotoIds.clear();
    cardReflections.clear();
    completionCard.clear();
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
  function cancelLocationRequests() {
    if (checkInController.cancelPending()) feedback.cancelConfirmations?.();
    render();
  }
  function syncRoute() {
    const route = currentRoute();
    const key = routeKey(route);
    if (key !== activeRouteKey) {
      const withinMemories = activeRouteKey.startsWith("memories/") && route.view === "memories";
      if (withinMemories) memoryPositions.set(activeRouteKey, { scrollY: window.scrollY || 0, focusId: document.activeElement?.id || "" });
      activeRouteKey = key;
      activeRoute = route;
      if (route.section === "introduction") disclosures.set("itinerary-introduction", true);
      if (withinMemories) {
        pageGeneration++;
        closeMemory({ restore: false });
        completionCard.pause();
        photoActions.cancelPhotoExport(); exportRequest = null;
        feedback.cancelConfirmations?.(); releasePreview();
        pendingMemoryPosition = memoryPositions.get(key) || { scrollY: 0, focusId: "" };
      } else { pendingMemoryPosition = null; leavePage(); }
    }
    return route;
  }
  function capturePageToken() {
    syncRoute();
    return { generation: pageGeneration, route: activeRouteKey };
  }
  function isPageCurrent(token) {
    if (synchronizeProgress()) return false;
    syncRoute();
    return Boolean(identityReady() && token && token.generation === pageGeneration && token.route === activeRouteKey && token.route === routeKey(currentRoute()));
  }
  function canUseAttraction(id) {
    if (synchronizeProgress()) return false;
    const route = syncRoute();
    return identityReady() && !isResetting && route.view === "itinerary" && Boolean(getAttraction(id));
  }
  function canUsePage(view) { return !synchronizeProgress() && identityReady() && !isResetting && syncRoute().view === view; }
  function canUseMemorySection(section) { return canUsePage("memories") && currentRoute().section === section; }
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
  function getPageSnapshot() { return identityReady() ? pages.getPageModel(syncRoute()) : login.getModel(); }
  function pauseForIdentity() {
    closeInstallInvitation({ restore: false });
    pageGeneration++; invalidateAllOperations(); checkInController.cancelPending();
    camera.stopCamera(); if (cameraDialog.open) cameraDialog.close();
    closeMemory({ restore: false }); completionCard.pause();
    photoActions.cancelPhotoExport();
    releasePreview(); photoSelection = null; nativeCameraInput.value = "";
    feedback.cancelConfirmations?.();
  }
  function beginPhotoSelection(id) {
    if (!canUseAttraction(id) || !store.hasCheckIn(id)) return false;
    photoSelection = { attractionId: id, pageToken: capturePageToken(), dataToken: operations.operationToken(id) };
    nativeCameraInput.value = "";
    return true;
  }

  function synchronizeProgress() {
    if (isResetting || !store.syncProgress()) return false;
    // Another tab changed the journey. Invalidate old callbacks before repainting.
    pauseForIdentity();
    leavePage();
    Promise.resolve().then(async () => {
      if (identityReady()) await refreshPhotos();
      render();
    });
    return true;
  }

  function setActiveNavigation(route) {
    const active = route.view;
    document.querySelectorAll("[data-nav]").forEach((item) => {
      const selected = item.dataset.nav === active;
      item.classList.toggle("is-active", selected);
      if (selected) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
  }
  function render({ moveFocus = false } = {}) {
    const route = syncRoute();
    if (getInstallState().mode === "none") closeInstallInvitation();
    if (!identityReady()) { login.showForm(); refreshLoginInstallEntry(); return; }
    installInvitationHandled = true;
    closeInstallInvitation({ restore: false });
    login.resumeJourney();
    const key = routeKey(route);
    if (composingReflection && composingReflection.isConnected !== false
      && app.contains(composingReflection) && key === renderedRouteKey) {
      reflectionRenderPending = true;
      return;
    }
    const focused = document.activeElement;
    const hadFocus = focused && app.contains(focused);
    const focusId = focused?.id;
    const focusData = ["photoSelect", "photoSelectAll", "photoSelectNone", "photoExportSelected", "cardReflection"].find((key) => focused?.dataset?.[key]);
    const focusValue = focusData ? focused.dataset[focusData] : null;
    const selection = focusData === "cardReflection" ? {
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
    const renderers = { itinerary: views.renderItinerary, memories: views.renderMemories };
    for (const item of document.querySelectorAll("details[data-ui-disclosure]")) disclosures.set(item.id, item.open);
    app.innerHTML = renderers[route.view](model);
    completionCard.reconcile();
    decorateInterface(document);
    const rehearsalSelect = document.getElementById("itinerary-rehearsal-scenario");
    if (rehearsalSelect) rehearsalSelect.value = rehearsalScenario;
    const rehearsalLink = document.getElementById("itinerary-rehearsal-open");
    if (rehearsalLink) rehearsalLink.href = rehearsalPageHref(rehearsalScenario);
    for (const item of document.querySelectorAll("details[data-ui-disclosure]")) if (disclosures.has(item.id)) item.open = disclosures.get(item.id);
    if (moveFocus && key !== renderedRouteKey) app.focus({ preventScroll: true });
    else if (hadFocus) {
      const replacement = focusId ? document.getElementById(focusId)
        : [...app.querySelectorAll("input, button, textarea")].find((item) => focusData && item.dataset[focusData] === focusValue);
      replacement?.focus({ preventScroll: true });
      if (selection && Number.isInteger(selection.start) && Number.isInteger(selection.end)) {
        replacement?.setSelectionRange(selection.start, selection.end, selection.direction);
      }
    }
    if (route.section === "introduction" && key !== renderedRouteKey) document.getElementById("itinerary-introduction")?.setAttribute("open", "");
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
      for (const id of selectedPhotoIds) if (!records.some(record => (record.photoId || record.attractionId) === id)) selectedPhotoIds.delete(id);
      if (memory.selection && memory.selection.version !== store.getPhotoVersion(memory.selection.attractionId)) {
        memory.resetSelection(memory.selection.attractionId);
        showToast("相簿相片已更新，未確定的勾選已取消，請重新選取。", "warning");
      }
      photoActions.validatePhotoExport();
      releasePreview();
      return true;
    } catch {
      if (request === photoReadGeneration && dataGeneration === operations.generation) {
        photoReadError = true;
        photoReadLoading = false;
        store.replacePhotos([]);
        closeMemory({ restore: false });
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
      message: photoReadLoading || photoReadError || store.hasPhoto(id) ? "取消後會刪除本站全部紀念照，無法復原；已下載或分享的相片會保留。" : "取消後會移除時間及核實狀態。",
      confirmText: "取消打卡", danger: true, isRelevant: relevant
    });
    if (!accepted || !relevant()) return;
    selectedPhotoIds.clear();
    cardReflections.clear();
    completionCard.clear();
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
    if (synchronizeProgress() || !isCurrentDataGeneration(dataToken)) return;
    const original = store.getCheckIn(id);
    const saved = store.removeCheckIn(id);
    if (saved && original) await sync.enqueue({ ...original, attractionId: id }, "cancel");
    await refreshPhotos();
    if (!isCurrentDataGeneration(dataToken)) return;
    render();
    if (isPageCurrent(pageToken)) showToast(saved ? "打卡紀錄及相關紀念照已取消。" : "紀念照已刪除，但未能保存打卡更新。", saved ? "default" : "warning");
  }

  // Keep retired drafts inaccessible to old tabs after an explicitly confirmed reset.
  function clearRetiredDrafts() {
    if (typeof environment.indexedDB?.open !== "function") return Promise.resolve();
    const name = testKind === "rehearsal" ? "outdoorLearningDay.rehearsal.workbook.v1" : "outdoorLearningDay.workbook.v1";
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = error => {
        if (settled) return;
        settled = true;
        error ? reject(error) : resolve();
      };
      const request = environment.indexedDB.open(name);
      request.onupgradeneeded = () => request.result.createObjectStore("drafts");
      request.onerror = () => finish(new Error("未能清除舊版草稿。"));
      request.onblocked = () => finish(new Error("舊版分頁佔用草稿，請關閉後重試。"));
      request.onsuccess = () => {
        const db = request.result;
        if (settled) { db.close(); return; }
        db.onversionchange = () => db.close();
        try {
          const tx = db.transaction("drafts", "readwrite"), drafts = tx.objectStore("drafts");
          tx.oncomplete = () => { db.close(); finish(); };
          tx.onerror = tx.onabort = () => { db.close(); finish(new Error("未能清除舊版草稿。")); };
          drafts.clear();
          drafts.put({ retired: true }, "bwflc-2026-11-05");
        } catch (error) { db.close(); finish(error); }
      };
    });
  }

  async function resetAllData() {
    if (!canUsePage("itinerary")) return;
    const pageToken = capturePageToken();
    const relevant = () => isPageCurrent(pageToken) && canUsePage("itinerary");
    const first = await askConfirmation({ title: "清除所有旅程資料？", message: `學生資料、待傳紀錄、打卡、相片及舊版手冊草稿會被刪除；已下載檔案${testKind ? "" : "及 Google 已保存的紀錄"}會保留。`, confirmText: "繼續", danger: true, isRelevant: relevant });
    if (!first || !relevant()) return;
    const second = await askConfirmation({ title: "最後確認", message: "資料一經清除便無法復原。你確定要重新開始嗎？", confirmText: "永久清除", danger: true, isRelevant: relevant });
    if (!second || !relevant()) return;
    isResetting = true;
    try { await sync.stop({ clear: true }); }
    catch { isResetting = false; render(); showToast("未能清除裝置同步資料；其餘旅程資料仍保留，請重試。", "warning"); return; }
    checkInController.cancelPending();
    selectedPhotoIds.clear();
    cardReflections.clear();
    completionCard.clear();
    photoActions.cancelPhotoExport();
    invalidateAllOperations();
    camera.stopCamera();
    photoSelection = null;
    nativeCameraInput.value = "";
    releasePreview();
    showToast("正在清除資料…");
    await waitForPhotoTasks();
    try {
      if (environment.indexedDB || store.photoCount) await clearPhotoRecords();
    } catch {
      isResetting = false;
      await refreshPhotos();
      render();
      showToast(`未能清除所有紀念照；${syncEndpoint || syncTransport ? "同步設定及待傳紀錄已清除；" : ""}其他資料仍保留，請再試一次。`, "warning");
      return;
    }
    try { await clearRetiredDrafts(); }
    catch {
      isResetting = false;
      await refreshPhotos(); render();
      showToast(`紀念照已清除，${syncEndpoint || syncTransport ? "同步設定及待傳紀錄亦已清除，" : ""}但舊版草稿未能清除；打卡紀錄仍保留。請關閉其他舊版分頁再重試。`, "warning");
      return;
    }
    try { store.clearProgress(); }
    catch {
      isResetting = false;
      await refreshPhotos();
      render();
      showToast(`紀念照及舊版草稿已清除，${syncEndpoint || syncTransport ? "同步設定及待傳紀錄亦已清除，" : ""}但未能清除行程紀錄；請檢查瀏覽器儲存設定後再試。`, "warning");
      return;
    }
    await refreshPhotos();
    try { login.clear(); }
    catch {
      isResetting = false; render();
      showToast("旅程資料已清除，但未能清除學生資料，請重試。", "warning"); return;
    }
    isResetting = false;
    render();
    showToast("所有旅程資料已清除。", "success");
  }

  function updateCardReflection(event) {
    const target = event.target;
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
  document.addEventListener("input", event => {
    if (event.target.dataset?.studentIdentityField) loginInputStarted = true;
    login.handleInput(event);
    updateCardReflection(event);
  });
  document.addEventListener("submit", async event => {
    if (installDialog.open) { event.preventDefault(); return; }
    if (syncDialog?.open) {
      event.preventDefault();
      if (event.target.id !== "check-in-sync-form" || !identityReady() || sync.getState().busy || sync.getState().closed) return;
      const error = document.getElementById("sync-dialog-error"), button = document.getElementById("sync-enable");
      button.disabled = true; button.textContent = "正在啟用…"; error.hidden = true;
      const accepted = await sync.enable();
      if (!syncDialog.open || !identityReady() || button.isConnected === false || document.getElementById("sync-enable") !== button) return;
      if (accepted) { closeSyncDialog(); updateSyncStatus(); }
      else {
        const model = sync.getState();
        button.disabled = model.closed; button.textContent = model.closed ? "已截止" : "重試啟用";
        error.textContent = model.reason; error.hidden = false;
        (model.closed ? syncDialog.querySelector("[data-sync-dismiss]") : button)?.focus();
      }
      return;
    }
    return login.handleSubmit(event);
  });
  document.addEventListener("compositionstart", (event) => {
    if (event.target.dataset?.studentIdentityField) loginInputStarted = true;
    login.beginComposition(event);
    if (isCurrentControl(event.target) && event.target.matches("[data-card-reflection]")) composingReflection = event.target;
  });
  document.addEventListener("compositionend", (event) => {
    login.endComposition(event);
    if (composingReflection !== event.target) return;
    composingReflection = null;
    const pending = reflectionRenderPending;
    reflectionRenderPending = false;
    updateCardReflection(event);
    if (pending) render();
  });

  const isCurrentControl = (target) => target?.isConnected !== false && !installDialog.open && !syncDialog?.open && !photoExportDialog?.open
    && !memory.suspended && app.contains(target);
  const currentPagePhotos = () => {
    const frame = memoryFrame();
    const photos = frame ? [...store.getPhotos(frame.attractionId)].reverse() : [];
    const page = Math.min(frame?.page || 0, Math.max(0, Math.ceil(photos.length / PHOTO_PAGE_SIZE) - 1));
    return photos.slice(page * PHOTO_PAGE_SIZE, page * PHOTO_PAGE_SIZE + PHOTO_PAGE_SIZE);
  };
  const allPhotoIds = () => CHECK_IN_LOCATIONS.filter(item => store.hasCheckIn(item.id))
    .flatMap(item => store.getPhotos(item.id).map(photo => photo.photoId));
  async function prepareExport(attractionId, ids) {
    if (!canUsePage("memories") || photoReadLoading || photoReadError || !ids.length) return;
    exportRequest = { attractionId, ids: [...ids], epoch: memory.epoch };
    await photoActions.preparePhotoExport(attractionId, ids);
  }
  document.addEventListener("change", (event) => {
    const target = event.target;
    if (isCurrentControl(target) && target.matches("[data-rehearsal-scenario]")) {
      if (testKind || !canUsePage("itinerary")) return;
      rehearsalScenario = normalizeRehearsalScenario(target.value);
      target.value = rehearsalScenario;
      const link = document.getElementById("itinerary-rehearsal-open");
      if (link) link.href = rehearsalPageHref(rehearsalScenario);
      return;
    }
    if (isCurrentControl(target) && target.matches("[data-photo-select]")) {
      const id = target.dataset.photoSelect;
      const photo = store.getPhotoById(id);
      if (!photo || !canChangeAlbumSelection() || photo.attractionId !== memory.selection.attractionId
        || !currentPagePhotos().some(item => item.photoId === id)) return;
      memory.selectPhoto(id, target.checked);
      render();
      return;
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || event.isComposing || composingReflection
      || [...document.querySelectorAll("dialog")].some(item => item.open)) return;
    if (!memory.depth || memory.suspended || !canUseMemorySection("albums")) return;
    event.preventDefault();
    backMemory();
  });
  document.addEventListener("click", async (event) => {
    const target = event.target.closest("button, a");
    if (!target) return;
    if (syncDialog?.open) {
      if (target.isConnected !== false && syncDialog.contains(target) && target.matches("[data-sync-dismiss]")) {
        sync.invalidate(); closeSyncDialog();
      }
      return;
    }
    if (installDialog.open) {
      if (target.isConnected !== false && !target.disabled && installDialog.contains(target)) {
        if (target.matches("[data-install-dismiss]")) closeInstallInvitation();
        else if (target.matches("[data-install-start]")) await startNativeInstallation();
      }
      return;
    }
    if (target.matches("[data-install-open]")) {
      if (!identityReady() && isCurrentControl(target) && !target.disabled) openInstallInvitation();
      return;
    }
    const loginAction = login.handleClick(target);
    if (loginAction) { await loginAction; return; }
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
        exportUI.toggleMore();
        exportUI.show(photoActions.getPhotoExportModel());
      }
      if (target.matches("[data-export-page]")) {
        const page = Number(target.dataset.exportPage), model = photoActions.getPhotoExportModel();
        if (!target.disabled && Number.isInteger(page) && page >= 0 && page < Math.ceil((model?.files.length || 0) / PHOTO_PAGE_SIZE)) {
          exportUI.setPage(page);
          exportUI.show(model);
        }
      }
      if (target.matches("[data-export-retry]") && exportRequest?.epoch === memory.epoch) {
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
    if (target.matches("[data-check-in-sync]") && canUsePage("itinerary")) {
      const model = sync.getState();
      if (!model || model.disabled) return;
      if (!model.enabled || model.needsEnable) openSyncDialog(); else await sync.upload();
      return;
    }
    if (target.matches("[data-itinerary-day]")) {
      if (!canUsePage("itinerary") || !TRIP_DATA.itinerary.some(day => String(day.day) === target.dataset.itineraryDay)) return;
      const day = document.getElementById(`itinerary-day-${target.dataset.itineraryDay}`);
      day?.focus?.({ preventScroll: true });
      day?.scrollIntoView?.({ block: "start", behavior: "auto" });
      return;
    }
    if (target.matches("[data-section-view]")) {
      const { sectionView: view, sectionId: section } = target.dataset;
      const choices = view === "memories" ? MEMORY_SECTIONS : [];
      if (!canUsePage(view) || !choices.some(item => item.id === section)) return;
      sectionFocus = target.id;
      if (activeRoute.section === section) {
        sectionOverride = { hash: location.hash, view, section: null };
        await navigate();
      } else {
        sectionOverride = null;
        const hash = MEMORY_SECTIONS.find(item => item.id === section).hash;
        if (location.hash === hash) await navigate();
        else location.hash = hash;
      }
      return;
    }
    if (target.matches("[data-memory-checkin-card-open]")) {
      if (canUseMemorySection("checkins") && !memory.depth && store.hasCompletedAllCheckIns()) completionCard.open(target);
      return;
    }
    if (canUsePage("memories") && !photoReadLoading && !photoReadError) {
      const frame = memoryFrame();
      if (target.matches("[data-memory-album]")) {
        const id = target.dataset.memoryAlbum;
        if (canUseMemorySection("albums") && canUsePhotoActions(id) && store.hasPhoto(id)) {
          if (frame?.attractionId === id) closeMemory();
          else changeMemory({ mode: "album", attractionId: id, page: 0 });
        }
        return;
      }
      if (target.matches("[data-memory-page]")) {
        const page = Number(target.dataset.memoryPage);
        if (frame?.mode === "album" && Number.isInteger(page) && page >= 0 && page < Math.ceil(store.getPhotos(frame.attractionId).length / PHOTO_PAGE_SIZE)) {
          memory.updateFrame({ page });
          memory.invalidate();
          render();
          memory.scrollStart();
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
          if (next) { memory.updateFrame({ photoId: next.photoId, cardOpen: false }); memory.invalidate(); cardTask = null; render();
            memory.scrollStart(); }
        }
        return;
      }
      if (target.matches("[data-memory-card-toggle]")) {
        if (frame?.mode === "photo" && !cardTask) { memory.updateFrame({ cardOpen: !frame.cardOpen }); memory.invalidate(); render();
          if (!frame.cardOpen) document.getElementById("memory-reflection")?.focus({ preventScroll: true }); }
        return;
      }
      if (target.matches("[data-memory-album-select]")) {
        if (canChangeAlbumSelection() && ["all", "none"].includes(target.dataset.memoryAlbumSelect)) {
          for (const photo of store.getPhotos(frame.attractionId)) {
            memory.selectPhoto(photo.photoId, target.dataset.memoryAlbumSelect === "all");
          }
          render();
        }
        return;
      }
      if (target.matches("[data-memory-selection-confirm]")) {
        if (canChangeAlbumSelection()) {
          for (const photo of store.getPhotos(frame.attractionId)) {
            if (memory.selectedInAlbum(photo.photoId)) selectedPhotoIds.add(photo.photoId); else selectedPhotoIds.delete(photo.photoId);
          }
          closeMemory();
        }
        return;
      }
      if (target.matches("[data-memory-download-all]")) { if (canUseMemorySection("albums") && !frame) await prepareExport(null, allPhotoIds()); return; }
      if (target.matches("[data-memory-download-album]")) { if (frame?.mode === "album") await prepareExport(frame.attractionId, store.getPhotos(frame.attractionId).map(photo => photo.photoId)); return; }
      if (target.matches("[data-memory-download-photo]")) { if (frame?.mode === "photo" && !cardTask) await prepareExport(frame.attractionId, [frame.photoId]); return; }
    }
    if (target.matches("[data-photos-retry]")) {
      if (canUsePage("memories")) { await refreshPhotos(); render(); }
      return;
    }
    if (target.matches("[data-photo-select-all], [data-photo-select-none], [data-photo-export-selected]")) {
      if (!canUseMemorySection("albums")) return;
      if (target.matches("[data-photo-export-selected]")) {
        if (!memoryFrame() || (canChangeAlbumSelection() && !albumSelectionChanged())) await prepareExport(null, [...selectedPhotoIds]);
      } else {
        if (memoryFrame()) return;
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
      const task = { epoch: memory.epoch, page: capturePageToken() };
      cardTask = task;
      render();
      try { await downloadTravelCard(frame.attractionId, frame.photoId, getCardReflection(frame.attractionId, frame.photoId)); }
      finally { if (cardTask === task) { cardTask = null; if (isPageCurrent(task.page) && task.epoch === memory.epoch) {
        render(); document.getElementById("memory-download-card")?.focus({ preventScroll: true });
      } } }
    }
    if (target.matches("[data-reset-all]")) await resetAllData();
    if (target.id === "install-button" && canUsePage("itinerary") && !target.disabled && !nativeInstalling) {
      const { mode } = getInstallState();
      if (mode === "ios" || mode === "manual") {
        iosInstallHelpOpen = !iosInstallHelpOpen;
        render();
      } else if (mode === "native") {
        await startNativeInstallation();
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
  function restoreMemoryPosition() {
    if (!pendingMemoryPosition) return false;
    const position = pendingMemoryPosition; pendingMemoryPosition = null;
    window.scrollTo?.(0, position.scrollY);
    (document.getElementById(position.focusId) || app).focus({ preventScroll: true });
    return true;
  }
  function focusSection(route) {
    const id = sectionFocus || (route.view === "memories" && route.section ? `memory-tab-${route.section}`
      : route.attractionId ? `itinerary-stop-${route.attractionId}`
      : route.section === "introduction" ? "itinerary-introduction-heading" : null);
    sectionFocus = null;
    const control = id && document.getElementById(id);
    if (!control) return false;
    pendingMemoryPosition = null;
    control.focus({ preventScroll: true });
    control.scrollIntoView?.({ block: route.attractionId ? "start" : "nearest", behavior: "auto" });
    return true;
  }
  async function navigate() {
    if (!identityReady()) { syncRoute(); login.showForm(); return; }
    const previousRoute = activeRoute;
    if (routeKey(currentRoute()) === activeRouteKey) {
      app.inert = false;
      if (renderedRouteKey !== activeRouteKey) render({ moveFocus: true });
      if (sectionFocus) focusSection(activeRoute);
      else restoreMemoryPosition();
      return;
    }
    syncRoute();
    app.inert = false;
    const withinSections = previousRoute.view === activeRoute.view && ["memories", "itinerary"].includes(activeRoute.view);
    render({ moveFocus: !withinSections });
    const reduceMotion = environment.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!focusSection(activeRoute) && !restoreMemoryPosition()) window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  }
  window.addEventListener("hashchange", () => { sectionOverride = null; return navigate(); });
  window.addEventListener("storage", event => {
    if (event.key === installStorageKey || event.key === null) {
      try { if (localStorage.getItem(installStorageKey) === "installed") confirmInstallation({ remember: false }); }
      catch { /* A preference read failure does not change journey access. */ }
    }
    login.reconcileStorage(event);
    synchronizeProgress();
  });
  window.addEventListener("online", () => { updateNetworkStatus(); sync.networkChanged(); });
  window.addEventListener("offline", () => { updateNetworkStatus(); sync.networkChanged(); });
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    if (installedInSession || navigator.standalone === true || environment.matchMedia?.("(display-mode: standalone)")?.matches === true) return;
    installPrompt = event;
    iosInstallHelpOpen = false;
    render();
    if (installDialog.open) openInstallInvitation();
    else maybeInviteInstallation();
  });
  window.addEventListener("appinstalled", () => { confirmInstallation(); });
  window.addEventListener("pagehide", () => { pageActive = false; login.pauseEntry(); sync.invalidate(); leavePage(); });
  window.addEventListener("beforeunload", event => {
    if (!sync.getState()?.unsaved) return;
    event.preventDefault(); event.returnValue = "";
  });
  window.addEventListener("pageshow", async () => { pageActive = true; login.reconcileStorage(); if (await login.prepareJourney()) await refreshPhotos(); synchronizeProgress(); render(); if (identityReady()) void sync.start(); });
  function updateNetworkStatus() {
    const online = navigator.onLine;
    networkStatus.textContent = online ? "已連線" : "離線可用";
    networkStatus.classList.toggle("is-offline", !online);
    decorateInterface(document);
  }
  async function start() {
    updateNetworkStatus();
    // Retire only the removed feature's local settings, never journey data.
    try {
      if (localStorage?.getItem("outdoorLearningDay.push.v1") != null) localStorage.removeItem("outdoorLearningDay.push.v1");
    } catch { /* Storage access must not prevent the offline app from starting. */ }
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
    if (await login.prepareJourney()) { await refreshPhotos(); if (identityReady()) void sync.start(); }
    render();
    maybeInviteInstallation();
    maybeInviteSync();
    if (identityReady() && (currentRoute().section === "introduction" || currentRoute().attractionId)) focusSection(currentRoute());
  }
  return { start, render, currentRoute, getPageSnapshot, cancelLocationRequests };
}
