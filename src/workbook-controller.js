import { PHOTO_PAGE_SIZE, MAX_WORKBOOK_PHOTOS } from "./app-settings.js";
import { WORKBOOK_PARTS, WORKBOOK_RATINGS, WORKBOOK_FIELDS, WORKBOOK_INSTRUCTIONS, WORKBOOK_IDENTITY_LIMITS, MAX_WORKBOOK_TEXT, MAX_BACKUP_BYTES, workbookProgress, workbookResumePart, workbookTextLimitError, missingWorkbookFields, createWorkbookBackup, parseWorkbookBackup } from "./workbook-data.js";
import { createWorkbookRepository, createWorkbookSession } from "./workbook-storage.js";
import { createWorkbookPDF, validateWorkbookIdentity } from "./workbook-pdf.js";
import { workbookStatusText, workbookFieldHint } from "./workbook-views.js";
import { getAttraction } from "./formatting.js";
import { CHECK_IN_LOCATIONS, TRIP_DATA } from "./data.js";

export function createWorkbookController({ environment, repository = createWorkbookRepository({ indexedDB: environment.indexedDB }), pdfService = createWorkbookPDF,
  store, getPhotoPreview, getPhotoReadState, refreshPhotos, currentRoute, capturePageToken, isPageCurrent, render, askConfirmation, showToast }) {
  const { document, window, URL } = environment;
  let identity = { studentName: "", className: "", studentNumber: "" }, exportOpen = false;
  let pickerOpen = false, photoPage = 0, busy = false, pdfMessage = "", epoch = 0, backupEdit = null;
  let backupOpen = false, backupMessage = "", pendingRestore = null, backupRead = 0;
  const active = () => currentRoute().view === "workbook";
  const session = createWorkbookSession({ repository, onChange: updateStatus });
  const allPhotos = () => CHECK_IN_LOCATIONS.filter(item => store.hasCheckIn(item.id)).flatMap(item => [...store.getPhotos(item.id)].reverse());
  const allowedPhoto = id => { const photo = store.getPhotoById(id); return photo && store.hasCheckIn(photo.attractionId) ? photo : null; };
  function updateStatus() {
    if (!active()) return;
    const model = session.snapshot();
    const status = document.getElementById("workbook-save-status");
    if (status) status.textContent = workbookStatusText(model);
    const conflict = document.getElementById("workbook-conflict");
    if (conflict) conflict.hidden = model.status !== "conflict";
    for (const button of document.querySelectorAll("[data-workbook-retry]")) button.hidden = model.status !== "error";
    const latest = document.querySelector("[data-workbook-load-latest]");
    if (latest) latest.disabled = backupEdit !== model.edit;
    const download = document.getElementById("wb-pdf-download");
    if (download) download.disabled = busy || model.status !== "saved";
    const backupStatus = document.getElementById("wb-backup-message");
    if (backupStatus) backupStatus.textContent = backupMessage;
    const restoreConfirm = document.querySelector("[data-workbook-restore-confirm]");
    if (restoreConfirm) restoreConfirm.disabled = busy || !model.initialized || model.status === "conflict";
    for (const control of document.querySelectorAll("[data-workbook-restore-open], [data-workbook-restore]")) control.disabled = busy || !model.initialized || model.status === "conflict";
  }
  function getModel(section) {
    const data = session.snapshot(), part = WORKBOOK_PARTS.find(item => item.id === section) || null;
    const readState = getPhotoReadState(), ready = readState === "ready";
    const describe = (id, preview, index = 0) => {
      const photo = ready ? allowedPhoto(id) : null, title = photo ? getAttraction(photo.attractionId).name : `文章配圖 ${index + 1}`;
      return { photoId: id, title, width: photo?.width || 1, height: photo?.height || 1,
        reason: !ready ? (readState === "loading" ? "正在讀取" : "讀取失敗，請重試") : !photo ? "已不存在，請移除或重新選圖" : "",
        url: photo && preview ? getPhotoPreview(photo.attractionId, id) : null, selected: data.draft.photoIds.includes(id) };
    };
    const records = ready && pickerOpen && part?.id === "essay" ? allPhotos() : [];
    const pages = Math.max(1, Math.ceil(records.length / PHOTO_PAGE_SIZE)); photoPage = Math.min(photoPage, pages - 1);
    return { view: "workbook", part, progress: workbookProgress(data.draft), answers: data.draft.answers, ratings: data.draft.ratings,
      status: data.status, error: data.error, limitError: data.limitError, initialized: data.initialized, busy, backedUp: backupEdit === data.edit,
      resumePart: workbookResumePart(data.draft), backupOpen, backupMessage,
      restorePreview: pendingRestore ? { textCount: WORKBOOK_FIELDS.filter(field => pendingRestore.draft.answers[field.id].trim()).length,
        totalTextCount: WORKBOOK_FIELDS.length, totalRatingCount: WORKBOOK_RATINGS.length,
        ratingCount: WORKBOOK_RATINGS.filter(field => pendingRestore.draft.ratings[field.id] !== null).length,
        limitError: workbookTextLimitError(pendingRestore.draft) } : null,
      selectedPhotos: part?.id === "essay" ? data.draft.photoIds.map((id, index) => describe(id, true, index)) : [],
      pickerPhotos: records.slice(photoPage * PHOTO_PAGE_SIZE, photoPage * PHOTO_PAGE_SIZE + PHOTO_PAGE_SIZE).map(photo => describe(photo.photoId, true)),
      photoCount: records.length, photoPage, photoPages: pages, photoReadState: readState, pickerOpen,
      ratingInstruction: WORKBOOK_INSTRUCTIONS.rating, ratingFields: WORKBOOK_RATINGS, works: WORKBOOK_INSTRUCTIONS,
      identity: { ...identity }, exportOpen, pdfMessage, missing: missingWorkbookFields(data.draft) };
  }
  function input(target, composing = false, finishingRoute = false) {
    if ((!active() && !finishingRoute) || composing || busy) return;
    const field = target.dataset.workbookField, personal = target.dataset.workbookIdentity;
    if (field && WORKBOOK_FIELDS.some(item => item.id === field)) {
      const draft = session.snapshot().draft, previous = draft.answers[field];
      let text = String(target.value);
      if (previous.length > MAX_WORKBOOK_TEXT && text.length > previous.length) {
        target.value = previous;
        showToast("這欄舊內容已超過 1,000 字元；請先備份並縮短內容，原文未有截斷。", "warning"); return;
      }
      if (previous.length <= MAX_WORKBOOK_TEXT) {
        text = text.slice(0, MAX_WORKBOOK_TEXT);
        if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
      }
      if (target.value !== text) target.value = text;
      if (previous !== text) { draft.answers[field] = text; session.replace(draft); }
      const counter = document.getElementById(`wb-count-${field}`);
      if (counter) counter.textContent = workbookFieldHint(field, text);
    } else if (personal && Object.hasOwn(WORKBOOK_IDENTITY_LIMITS, personal)) {
      const text = Array.from(String(target.value)).slice(0, WORKBOOK_IDENTITY_LIMITS[personal]).join("");
      if (target.value !== text) target.value = text;
      identity[personal] = text;
      const counter = document.getElementById(`wb-id-count-${personal}`);
      if (counter) counter.textContent = `${Array.from(text).length}／${WORKBOOK_IDENTITY_LIMITS[personal]} 字`;
    }
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = name; document.body.append(link);
    try { link.click(); } finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 30000); }
  }
  function backup() {
    const data = session.snapshot();
    if (!data.initialized) return;
    try {
      const date = new Date(), pad = value => String(value).padStart(2, "0");
      const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${String(date.getMilliseconds()).padStart(3, "0")}`;
      download(new Blob([createWorkbookBackup(data.draft)], { type: "application/json" }), `學習手冊備份-${stamp}.json`);
      backupEdit = data.edit;
      backupMessage = "已開啟備份下載。請到手機「下載／檔案」或瀏覽器下載列表查看並自行保存；網頁無法確認檔案是否已存妥。";
      updateStatus(); showToast(backupMessage);
    } catch (cause) { showToast(cause.message, "warning"); }
  }
  async function prepareRestore(file) {
    if (!file || !active() || busy) return;
    const token = capturePageToken(), generation = epoch, read = ++backupRead;
    pendingRestore = null; backupMessage = "正在讀取備份檔…"; updateStatus();
    const preview = document.getElementById("wb-restore-preview");
    if (preview) preview.hidden = true;
    const relevant = () => active() && isPageCurrent(token) && generation === epoch && read === backupRead && backupOpen;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error("備份不可超過 1 MiB。");
      const next = parseWorkbookBackup(await file.text(), { allowLegacyText: true });
      if (!relevant()) return;
      pendingRestore = { draft: next, read }; backupMessage = "備份檔已讀取，確認後才會取代目前內容。";
      render(); document.getElementById("wb-restore-preview")?.focus({ preventScroll: true });
    } catch (cause) { if (relevant()) { backupMessage = cause.message; render(); showToast(cause.message, "warning"); } }
  }
  async function confirmRestore() {
    if (!pendingRestore || busy || !active()) return;
    const source = pendingRestore, token = capturePageToken(), generation = epoch;
    if (!await session.checkVersion()) { updateStatus(); return; }
    const before = session.snapshot();
    const relevant = () => active() && isPageCurrent(token) && epoch === generation && pendingRestore === source && backupRead === source.read && session.snapshot().edit === before.edit;
    if (!relevant()) return;
    const hasContent = workbookResumePart(before.draft) || before.draft.photoIds.length;
    const accepted = await askConfirmation({ title: hasContent ? "用備份取代目前內容？" : "載入備份繼續填寫？",
      message: "確認後會以這份備份取代所有文字及自評，文章配圖需重新選取。若要保留目前內容，請取消並先按「保存備份檔」。姓名、班別及學號不會匯入。",
      confirmText: "載入備份", danger: Boolean(hasContent), isRelevant: relevant });
    if (!accepted || !relevant() || !await session.checkVersion() || !relevant()) return;
    pendingRestore = null; backupEdit = null;
    session.replace(source.draft);
    if (workbookTextLimitError(source.draft)) {
      backupMessage = "備份內容已完整載入，但超過上限的欄位尚未暫存。請縮短至 1,000 字元後保存；文章配圖需重新選取。";
      render(); return;
    }
    await session.retry();
    if (!active() || !isPageCurrent(token) || generation !== epoch) return;
    backupMessage = session.snapshot().status === "saved" ? "備份已載入並自動暫存，可以繼續填寫；文章配圖需重新選取。" : "備份已載入，但暫存失敗；內容仍保留在此頁，請重試或保存備份檔。";
    render(); showToast(backupMessage, session.snapshot().status === "saved" ? "success" : "warning");
  }
  async function photoFingerprints(ids) {
    const result = [];
    for (const [index, id] of ids.entries()) {
      const record = allowedPhoto(id);
      if (!record) throw new Error(`文章配圖 ${index + 1} 已不存在，請移除或重新選圖。`);
      const digest = await environment.crypto.subtle.digest("SHA-256", await record.blob.arrayBuffer());
      result.push({ id, attractionId: record.attractionId, writeId: record.writeId || "", width: record.width, height: record.height,
        digest: Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("") });
    }
    return JSON.stringify(result);
  }
  async function exportPDF() {
    if (!active() || busy || !exportOpen) return;
    const pageToken = capturePageToken(), task = ++epoch;
    let saved, fingerprint;
    const relevant = () => active() && isPageCurrent(pageToken) && task === epoch && (!saved || session.snapshot().edit === saved.edit);
    try {
      const personal = validateWorkbookIdentity(identity);
      saved = await session.flush();
      const missing = missingWorkbookFields(saved.draft);
      const accepted = await askConfirmation({ title: "下載學習手冊 PDF？", message: `姓名、班別及學號會印在 PDF 上，請確認適合保存或分享。${missing.length ? `尚未填寫 ${missing.length} 項：${missing.join("；")}。空項會標示「尚未填寫」，可下載草稿。` : "所有文字及自評欄位已填。"}`, confirmText: missing.length ? "下載草稿 PDF" : "下載 PDF", isRelevant: relevant });
      if (!accepted || !relevant()) return;
      busy = true; pdfMessage = "正在核對草稿及文章配圖…"; render();
      if (!await session.checkVersion() || !relevant()) { pdfMessage = "草稿版本已改動或未能核對，生成已停止；請先處理保存狀態。"; return; }
      if (saved.draft.photoIds.length) { if (!await refreshPhotos()) throw new Error("相片讀取失敗，請重試；未有略過配圖。"); }
      if (!relevant()) return;
      fingerprint = await photoFingerprints(saved.draft.photoIds);
      const photos = saved.draft.photoIds.map(id => { const record = allowedPhoto(id); return { title: getAttraction(record.attractionId).name, record }; });
      const data = await pdfService({ draft: saved.draft, identity: personal, photos, isRelevant: relevant, onProgress: message => {
        if (!relevant()) return; pdfMessage = message; const status = document.getElementById("workbook-pdf-status"); if (status) status.textContent = message;
      } });
      if (!relevant() || !await session.checkVersion()) { pdfMessage = "草稿版本已改動或未能核對，沒有下載舊 PDF。"; return; }
      if (saved.draft.photoIds.length && !await refreshPhotos()) throw new Error("完成時未能核對相片，沒有下載 PDF，請重試。");
      if (!relevant()) return;
      if (fingerprint !== await photoFingerprints(saved.draft.photoIds)) throw new Error("文章配圖已被改動，沒有下載舊 PDF。請重新選圖。");
      // Photo reads/hashing also yield: recheck the draft after that final work.
      if (!relevant() || !await session.checkVersion()) { pdfMessage = "完成時草稿版本已改動或未能核對，沒有下載舊 PDF。"; return; }
      if (!relevant()) return;
      download(new Blob([data], { type: "application/pdf" }), `${TRIP_DATA.filenamePrefix}-學習手冊.pdf`);
      pdfMessage = "已開啟 PDF 下載；請查看瀏覽器下載列表並自行保存。網頁無法確認裝置是否已完成儲存。";
    } catch (cause) { if (relevant()) { pdfMessage = cause.message; showToast(cause.message, "warning"); } }
    finally { if (task === epoch && active()) { busy = false; render(); document.getElementById("wb-pdf-download")?.focus({ preventScroll: true }); } }
  }
  function cancel() { epoch++; busy = false; pdfMessage = "生成已取消，草稿仍保留。"; }
  function leave(nextView) {
    cancel(); exportOpen = false; pickerOpen = false; photoPage = 0;
    backupOpen = false; pendingRestore = null; backupRead++;
    if (nextView !== "workbook") identity = { studentName: "", className: "", studentNumber: "" };
    void session.flush().catch(() => {});
  }
  async function click(target) {
    const data = target.dataset;
    if (!Object.keys(data).some(key => key.startsWith("workbook")) || !active()) return false;
    if (target.disabled) return true;
    if (Object.hasOwn(data, "workbookBackup")) { backup(); return true; }
    if (Object.hasOwn(data, "workbookExportClose")) { cancel(); exportOpen = false; render(); return true; }
    if (Object.hasOwn(data, "workbookRetry")) { await session.retry(); render(); return true; }
    if (busy) return true;
    if (Object.hasOwn(data, "workbookBackupToggle")) {
      backupOpen = !backupOpen;
      if (!backupOpen) { pendingRestore = null; backupRead++; }
      render(); document.getElementById(backupOpen ? "wb-backup-title" : "wb-backup-open")?.focus({ preventScroll: true }); return true;
    }
    if (Object.hasOwn(data, "workbookRestoreOpen")) { document.getElementById("wb-restore")?.click(); return true; }
    if (Object.hasOwn(data, "workbookRestoreConfirm")) { await confirmRestore(); return true; }
    if (Object.hasOwn(data, "workbookRestoreCancel")) { pendingRestore = null; backupRead++; backupMessage = "已取消載入，原有草稿未有改動。"; render(); document.getElementById("wb-restore-open")?.focus({ preventScroll: true }); return true; }
    if (Object.hasOwn(data, "workbookLoadLatest")) {
      const before = session.snapshot(), token = capturePageToken();
      const relevant = () => isPageCurrent(token) && session.snapshot().edit === before.edit && backupEdit === before.edit;
      if (!relevant()) return true;
      if (await askConfirmation({ title: "載入另一分頁版本？", message: "目前內容會被取代。請確認已自行保存剛才下載的備份。", confirmText: "載入版本", isRelevant: relevant }) && relevant()) { await session.load(); backupEdit = null; render(); }
    } else if (Object.hasOwn(data, "workbookExportOpen")) { exportOpen = true; pdfMessage = ""; render(); document.getElementById("workbook-export-title")?.focus({ preventScroll: true }); }
    else if (Object.hasOwn(data, "workbookPdf")) await exportPDF();
    else if (Object.hasOwn(data, "workbookPicker")) { pickerOpen = !pickerOpen; photoPage = 0; render(); document.getElementById("wb-picker-open")?.focus({ preventScroll: true }); }
    else if (Object.hasOwn(data, "workbookPhotosRetry")) { await refreshPhotos(); render(); }
    else if (Object.hasOwn(data, "workbookPhotoPage")) { const page = Number(data.workbookPhotoPage); if (Number.isInteger(page) && page >= 0 && page < Math.ceil(allPhotos().length / PHOTO_PAGE_SIZE)) { photoPage = page; render(); document.querySelector("[data-workbook-photo-page]")?.focus({ preventScroll: true }); } }
    else if (Object.hasOwn(data, "workbookRemovePhoto")) { const draft = session.snapshot().draft; draft.photoIds = draft.photoIds.filter(id => id !== data.workbookRemovePhoto); session.replace(draft); render(); }
    else if (Object.hasOwn(data, "workbookClearRating") && WORKBOOK_RATINGS.some(field => field.id === data.workbookClearRating)) { const draft = session.snapshot().draft; draft.ratings[data.workbookClearRating] = null; session.replace(draft); render(); }
    return true;
  }
  async function change(target) {
    if (!active() || busy) return;
    const draft = session.snapshot().draft;
    if (Object.hasOwn(target.dataset, "workbookRestore")) { const file = target.files?.[0]; target.value = ""; await prepareRestore(file); }
    else if (target.dataset.workbookRating && WORKBOOK_RATINGS.some(item => item.id === target.dataset.workbookRating)) {
      const value = Number(target.value); if (Number.isInteger(value) && value >= 1 && value <= 5) { draft.ratings[target.dataset.workbookRating] = value; session.replace(draft); }
    } else if (target.dataset.workbookPhoto && currentRoute().section === "essay" && pickerOpen && getPhotoReadState() === "ready") {
      const id = target.dataset.workbookPhoto, visible = allPhotos().slice(photoPage * PHOTO_PAGE_SIZE, photoPage * PHOTO_PAGE_SIZE + PHOTO_PAGE_SIZE);
      if (!visible.some(photo => photo.photoId === id)) return;
      if (target.checked && !draft.photoIds.includes(id) && draft.photoIds.length < MAX_WORKBOOK_PHOTOS) draft.photoIds.push(id);
      if (!target.checked) draft.photoIds = draft.photoIds.filter(photoId => photoId !== id);
      session.replace(draft); render();
    }
  }
  function captureInputs() {
    for (const target of document.querySelectorAll("[data-workbook-field]")) input(target, false, true);
  }
  return { getModel, input, click, change, leave, captureInputs, flush: session.flush, initialize: session.load,
    refreshStatus: updateStatus,
    hasUnsaved: () => session.snapshot().dirty,
    hasLegacyEdits: () => { const data = session.snapshot(); return data.status === "error" && Boolean(data.limitError) && data.error === data.limitError; },
    checkVersion: session.checkVersion, stop: async () => { cancel(); await session.stop(); },
    clear: async () => { identity = { studentName: "", className: "", studentNumber: "" }; backupEdit = null; pendingRestore = null; backupRead++; await session.clear(); } };
}
