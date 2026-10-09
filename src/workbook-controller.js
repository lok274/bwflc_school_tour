import { WORKBOOK_PARTS, WORKBOOK_RATINGS, WORKBOOK_FIELDS, WORKBOOK_INSTRUCTIONS, WORKBOOK_IDENTITY_LIMITS, MAX_WORKBOOK_TEXT, MAX_BACKUP_BYTES, workbookProgress, missingWorkbookFields, createWorkbookBackup, parseWorkbookBackup } from "./workbook-data.js";
import { createWorkbookRepository, createWorkbookSession } from "./workbook-storage.js";
import { createWorkbookPDF, validateWorkbookIdentity } from "./workbook-pdf.js";
import { workbookStatusText } from "./workbook-views.js";
import { getAttraction } from "./formatting.js";
import { CHECK_IN_LOCATIONS } from "./data.js";

export function createWorkbookController({ environment, repository = createWorkbookRepository({ indexedDB: environment.indexedDB }), pdfService = createWorkbookPDF,
  store, getPhotoPreview, getPhotoReadState, refreshPhotos, currentRoute, capturePageToken, isPageCurrent, render, askConfirmation, showToast }) {
  const { document, window, URL } = environment;
  let identity = { studentName: "", className: "", studentNumber: "" }, exportOpen = false;
  let pickerOpen = false, photoPage = 0, busy = false, pdfMessage = "", epoch = 0, backupEdit = null;
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
    const pages = Math.max(1, Math.ceil(records.length / 12)); photoPage = Math.min(photoPage, pages - 1);
    return { view: "workbook", part, progress: workbookProgress(data.draft), answers: data.draft.answers, ratings: data.draft.ratings,
      status: data.status, error: data.error, initialized: data.initialized, busy, backedUp: backupEdit === data.edit,
      selectedPhotos: part?.id === "essay" ? data.draft.photoIds.map((id, index) => describe(id, true, index)) : [],
      pickerPhotos: records.slice(photoPage * 12, photoPage * 12 + 12).map(photo => describe(photo.photoId, true)),
      photoCount: records.length, photoPage, photoPages: pages, photoReadState: readState, pickerOpen,
      ratingInstruction: WORKBOOK_INSTRUCTIONS.rating, ratingFields: WORKBOOK_RATINGS, works: WORKBOOK_INSTRUCTIONS,
      identity: { ...identity }, exportOpen, pdfMessage, missing: missingWorkbookFields(data.draft) };
  }
  function input(target, composing = false, finishingRoute = false) {
    if ((!active() && !finishingRoute) || composing || busy) return;
    const field = target.dataset.workbookField, personal = target.dataset.workbookIdentity;
    if (field && WORKBOOK_FIELDS.some(item => item.id === field)) {
      const draft = session.snapshot().draft, text = String(target.value).slice(0, MAX_WORKBOOK_TEXT);
      if (target.value !== text) target.value = text;
      draft.answers[field] = text; session.replace(draft);
      const counter = document.getElementById(`wb-count-${field}`);
      if (counter) counter.textContent = `${Array.from(text).length} 字${field === "essay-body" ? "；目標約 600 字，字數不限制下載。" : "；最多 10,000 字元。"}`;
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
    download(new Blob([createWorkbookBackup(data.draft)], { type: "application/json" }), "2026-11-05至07-學習手冊備份.json");
    backupEdit = data.edit; updateStatus(); showToast("已開啟備份下載；請自行保存檔案。備份不包含身份及相片。");
  }
  async function restore(file) {
    if (!file || !active() || busy) return;
    const token = capturePageToken(), generation = epoch;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error("備份不可超過 1 MiB。");
      const next = parseWorkbookBackup(await file.text());
      if (!isPageCurrent(token) || generation !== epoch) return;
      await session.flush();
      const edit = session.snapshot().edit;
      const relevant = () => active() && isPageCurrent(token) && epoch === generation && session.snapshot().edit === edit;
      const accepted = await askConfirmation({ title: "取代整份手冊草稿？", message: "這會以備份取代目前所有文字和自評，並清除文章選圖；請先保存目前草稿的備份。身份資料不會匯入。", confirmText: "取代草稿", danger: true, isRelevant: relevant });
      if (!accepted || !relevant() || !await session.checkVersion()) return;
      session.replace(next); await session.flush(); render(); showToast("手冊備份已還原；請重新選取文章配圖。");
    } catch (cause) { if (isPageCurrent(token)) showToast(cause.message, "warning"); }
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
      download(new Blob([data], { type: "application/pdf" }), "2026-11-05至07-學習手冊.pdf");
      pdfMessage = "已開啟 PDF 下載；請查看瀏覽器下載列表並自行保存。網頁無法確認裝置是否已完成儲存。";
    } catch (cause) { if (relevant()) { pdfMessage = cause.message; showToast(cause.message, "warning"); } }
    finally { if (task === epoch && active()) { busy = false; render(); document.getElementById("wb-pdf-download")?.focus({ preventScroll: true }); } }
  }
  function cancel() { epoch++; busy = false; pdfMessage = "生成已取消，草稿仍保留。"; }
  function leave(nextView) {
    cancel(); exportOpen = false; pickerOpen = false; photoPage = 0;
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
    if (Object.hasOwn(data, "workbookLoadLatest")) {
      const before = session.snapshot(), token = capturePageToken();
      const relevant = () => isPageCurrent(token) && session.snapshot().edit === before.edit && backupEdit === before.edit;
      if (!relevant()) return true;
      if (await askConfirmation({ title: "載入另一分頁版本？", message: "目前內容會被取代。請確認已自行保存剛才下載的備份。", confirmText: "載入版本", isRelevant: relevant }) && relevant()) { await session.load(); backupEdit = null; render(); }
    } else if (Object.hasOwn(data, "workbookExportOpen")) { exportOpen = true; pdfMessage = ""; render(); document.getElementById("workbook-export-title")?.focus({ preventScroll: true }); }
    else if (Object.hasOwn(data, "workbookPdf")) await exportPDF();
    else if (Object.hasOwn(data, "workbookPicker")) { pickerOpen = !pickerOpen; photoPage = 0; render(); document.getElementById("wb-picker-open")?.focus({ preventScroll: true }); }
    else if (Object.hasOwn(data, "workbookPhotosRetry")) { await refreshPhotos(); render(); }
    else if (Object.hasOwn(data, "workbookPhotoPage")) { const page = Number(data.workbookPhotoPage); if (Number.isInteger(page) && page >= 0 && page < Math.ceil(allPhotos().length / 12)) { photoPage = page; render(); document.querySelector("[data-workbook-photo-page]")?.focus({ preventScroll: true }); } }
    else if (Object.hasOwn(data, "workbookRemovePhoto")) { const draft = session.snapshot().draft; draft.photoIds = draft.photoIds.filter(id => id !== data.workbookRemovePhoto); session.replace(draft); render(); }
    else if (Object.hasOwn(data, "workbookClearRating") && WORKBOOK_RATINGS.some(field => field.id === data.workbookClearRating)) { const draft = session.snapshot().draft; draft.ratings[data.workbookClearRating] = null; session.replace(draft); render(); }
    return true;
  }
  async function change(target) {
    if (!active() || busy) return;
    const draft = session.snapshot().draft;
    if (Object.hasOwn(target.dataset, "workbookRestore")) { const file = target.files?.[0]; target.value = ""; await restore(file); }
    else if (target.dataset.workbookRating && WORKBOOK_RATINGS.some(item => item.id === target.dataset.workbookRating)) {
      const value = Number(target.value); if (Number.isInteger(value) && value >= 1 && value <= 5) { draft.ratings[target.dataset.workbookRating] = value; session.replace(draft); }
    } else if (target.dataset.workbookPhoto && currentRoute().section === "essay" && pickerOpen && getPhotoReadState() === "ready") {
      const id = target.dataset.workbookPhoto, visible = allPhotos().slice(photoPage * 12, photoPage * 12 + 12);
      if (!visible.some(photo => photo.photoId === id)) return;
      if (target.checked && !draft.photoIds.includes(id) && draft.photoIds.length < 6) draft.photoIds.push(id);
      if (!target.checked) draft.photoIds = draft.photoIds.filter(photoId => photoId !== id);
      session.replace(draft); render();
    }
  }
  return { getModel, input, click, change, leave, flush: session.flush, initialize: session.load,
    checkVersion: session.checkVersion, stop: async () => { cancel(); await session.stop(); },
    clear: async () => { identity = { studentName: "", className: "", studentNumber: "" }; backupEdit = null; await session.clear(); } };
}
