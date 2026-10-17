import { STUDENT_IDENTITY_LIMITS, STUDENT_IDENTITY_LABELS, validateStudentIdentity } from "./student-identity.js";
import { TRIP_DATA, REQUIRED_CHECK_IN_LOCATIONS } from "./data.js";
import { PHOTO_PAGE_SIZE } from "./app-settings.js";
import { escapeHtml, getDownloadLocationHint } from "./formatting.js";
import { createCheckInCompletionCard, checkInCardLabel } from "./check-in-card.js";
import { decodeImage, drawCoverImage, getCoverCrop } from "./photos.js";
import { decorateInterface } from "./view-components.js";

function renderAdjustment(adjustment) {
  return `<section class="checkin-photo-adjustment" aria-labelledby="checkin-photo-adjust-title"><h3 id="checkin-photo-adjust-title" tabindex="-1">調整${escapeHtml(adjustment.name)}相片</h3>
    <p id="checkin-photo-adjust-hint">在圓圈內單指拖動相片，雙指張開或捏合可放大、縮小。套用後才會更新紀錄卡，原相片不變。</p>
    <p id="checkin-photo-keyboard-hint" class="sr-only">鍵盤可用方向鍵移動相片，按加號放大、減號縮小。</p>
    <canvas id="checkin-photo-adjust-canvas" width="600" height="600" tabindex="${adjustment.ready ? '0' : '-1'}" role="img" aria-label="已選相片的圓形裁切預覽" aria-describedby="checkin-photo-adjust-hint checkin-photo-keyboard-hint"></canvas>
    <p id="checkin-photo-adjust-status" role="status">${escapeHtml(adjustment.message)}</p>
    <div class="photo-actions"><button class="button button-primary" data-checkin-card-frame-apply ${adjustment.ready ? "" : "disabled"}>套用位置</button><button class="button button-secondary" data-checkin-card-frame-reset ${adjustment.ready ? "" : "disabled"}>重設位置</button><button class="button button-secondary" data-checkin-card-frame-change>更換相片</button><button class="button button-secondary" data-checkin-card-picker-cancel>取消</button></div></section>`;
}

function renderPicker(panel) {
  return `<section aria-labelledby="checkin-card-picker-title"><h3 id="checkin-card-picker-title" tabindex="-1">${escapeHtml(panel.name)}選相片</h3><p>只顯示本站已保存的相片。相片會裁成圓形，不會修改原相片。</p>
    <button class="button button-secondary" data-checkin-card-picker-cancel>返回紀錄卡</button>
    ${panel.message ? `<p role="status">${escapeHtml(panel.message)}</p>` : ''}
    <div class="memory-thumbnails">${panel.photos.map(photo => `<article class="memory-thumbnail"><button type="button" data-checkin-card-photo="${escapeHtml(photo.photoId)}" aria-label="使用${escapeHtml(panel.name)}第 ${photo.number} 張相片" aria-pressed="${photo.selected}">${photo.url ? `<img src="${escapeHtml(photo.url)}" alt="${escapeHtml(panel.name)}第 ${photo.number} 張相片" />` : '<span>預覽未能顯示</span>'}<span>第 ${photo.number} 張${photo.selected ? ' · 已選' : ''}</span></button></article>`).join('')}</div>
    ${panel.pages > 1 ? `<nav class="memory-pagination" aria-label="本站選圖分頁"><button class="button button-secondary" data-checkin-card-photo-page="${panel.page - 1}" ${panel.page ? '' : 'disabled'}>上一頁</button><p>第 ${panel.page + 1}／${panel.pages} 頁</p><button class="button button-secondary" data-checkin-card-photo-page="${panel.page + 1}" ${panel.page + 1 < panel.pages ? '' : 'disabled'}>下一頁</button></nav>` : ''}</section>`;
}

export function renderCheckInCard(model) {
  return `<div class="memory-dialog-content"><header class="memory-dialog-heading"><h2 id="checkin-card-title" tabindex="-1">製作五站打卡紀錄卡</h2><button type="button" class="icon-button" data-checkin-card-close aria-label="關閉紀錄卡視窗，保留草稿">×</button></header>
    <div class="memory-dialog-body checkin-card-editor">${model.adjustment ? renderAdjustment(model.adjustment) : model.picker ? renderPicker(model.picker) : `${model.recordLabel.startsWith("五站打卡完成紀錄：") ? "" : `<p>${escapeHtml(model.recordLabel.replace("GPS", "定位"))}</p>`}
    <div class="summary-identity">${Object.entries(STUDENT_IDENTITY_LABELS).map(([key, label]) => `<div><label for="checkin-card-${key}">${label}（必填）</label><input id="checkin-card-${key}" type="text" required data-checkin-card-field="${key}" value="${escapeHtml(model.identity[key])}" autocomplete="off" aria-describedby="checkin-card-${key}-hint" /><p id="checkin-card-${key}-hint">${Array.from(model.identity[key]).length}／${STUDENT_IDENTITY_LIMITS[key]} 字</p></div>`).join("")}</div>
    ${model.profilePrefilled ? "" : '<p class="privacy-note">身份資料只用於此卡，不保存或上傳；離開旅途回憶或重新載入後清除。此卡不代表校方核實出席或身份。</p>'}
    <p id="checkin-card-status" role="status" aria-live="polite" ${model.status ? "" : "hidden"}>${escapeHtml(model.status)}</p>
    <button id="checkin-card-preview-button" class="button button-accent" data-checkin-card-preview ${model.canPreview ? "" : "disabled"}>${model.busy ? "正在製作…" : "預覽五站紀錄卡"}</button>
    ${!model.previewUrl && model.canPreview ? model.selectedStations.map(station => `<button id="checkin-card-circle-${escapeHtml(station.attractionId)}" type="button" class="button button-secondary" data-checkin-card-circle="${escapeHtml(station.attractionId)}">重新選擇${escapeHtml(station.name)}相片</button>`).join('') : ''}
    ${model.previewUrl ? `<figure class="artwork-result"><div class="checkin-card-canvas"><img class="artwork-preview" src="${escapeHtml(model.previewUrl)}" alt="五站打卡紀錄卡預覽，包含學生資料、五站打卡狀態及已選相片" />${model.layout ? `<svg class="checkin-card-targets" viewBox="0 0 ${model.layout.width} ${model.layout.height}" aria-label="按圓圈選擇本站相片">${model.layout.circles.map(circle => `<foreignObject x="${circle.cx - circle.r}" y="${circle.cy - circle.r}" width="${circle.r * 2}" height="${circle.r * 2}"><button xmlns="http://www.w3.org/1999/xhtml" id="checkin-card-circle-${escapeHtml(circle.attractionId)}" type="button" class="checkin-card-circle" data-checkin-card-circle="${escapeHtml(circle.attractionId)}" aria-label="${escapeHtml(circle.name)}，${circle.selected ? '調整已選相片位置' : '選擇相片'}"></button></foreignObject>`).join('')}</svg>` : ''}</div><figcaption>按圓圈可選擇本站相片及調整位置；不選相片也可下載。</figcaption></figure>` : ""}
    <button id="checkin-card-download" class="button button-primary" data-checkin-card-download ${model.canDownload ? "" : "disabled"}>下載五站打卡紀錄卡</button>`}</div></div>`;
}

export function createCheckInCardController({ environment = globalThis, cardService = createCheckInCompletionCard, getCompletion, canUse, askConfirmation, showToast, getIdentity = () => null,
  getPhotos = () => [], getPhotoVersion = () => 0, getPhotoReadState = () => "ready" }) {
  const { document, window, URL, navigator } = environment;
  let dialog = document.querySelector("#checkin-card-dialog");
  if (!dialog) { dialog = document.createElement("dialog"); dialog.id = "checkin-card-dialog"; document.body.append(dialog); }
  dialog.className = "memory-dialog"; dialog.setAttribute("aria-labelledby", "checkin-card-title"); dialog.setAttribute("closedby", "closerequest");
  let opened = false, suspended = false, busy = false, composing = null, epoch = 0, version = 0, entry = null, downloadToken = null;
  let identity = emptyIdentity(), result = null, resultToken = null, previewUrl = null, layout = null, status = "";
  let identitySeeded = false, profilePrefilled = false, panel = null, pickerReturn = null;
  const selected = new Map(), pickerUrls = new Map();
  function emptyIdentity() { return { studentName: "", className: "", studentNumber: "" }; }
  function stamp() { return JSON.stringify(getCompletion()); }
  function eligible() { try { return Boolean(canUse() && checkInCardLabel(getCompletion())); } catch { return false; } }
  function releasePreview() { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null; }
  function releasePicker() { for (const value of pickerUrls.values()) URL.revokeObjectURL(value.url); pickerUrls.clear(); }
  function invalidate() { epoch++; busy = false; result = resultToken = layout = null; releasePreview(); }
  function selectedPhotos() {
    if (selected.size && getPhotoReadState() !== "ready") return null;
    const photos = [];
    for (const [id, choice] of selected) {
      const photo = getPhotos(id).find(item => item.attractionId === id && item.photoId === choice.photoId && item.writeId === choice.writeId);
      if (!photo || !(photo.blob instanceof Blob)) return null;
      photos.push({ ...photo, frame: { ...choice.frame } });
    }
    return photos;
  }
  const task = () => ({ epoch, version, completion: stamp(), photos: (selectedPhotos() || []).map(photo => ({ ...photo, photoVersion: getPhotoVersion(photo.attractionId) })) });
  function current(token) {
    if (!token || !opened || !eligible() || epoch !== token.epoch || version !== token.version || stamp() !== token.completion) return false;
    const photos = selectedPhotos();
    return photos && photos.length === token.photos.length && token.photos.every(photo => getPhotoVersion(photo.attractionId) === photo.photoVersion
      && photos.some(item => item.attractionId === photo.attractionId && item.photoId === photo.photoId && item.writeId === photo.writeId && item.blob === photo.blob && ["x", "y", "zoom"].every(key => item.frame[key] === photo.frame[key])));
  }
  function pickerModel() {
    if (panel?.kind !== "picker") return null;
    const readState = getPhotoReadState(), all = readState === "ready" ? [...getPhotos(panel.attractionId)].reverse() : [];
    const pages = Math.ceil(all.length / PHOTO_PAGE_SIZE); panel.page = Math.min(panel.page, Math.max(0, pages - 1));
    const visible = all.slice(panel.page * PHOTO_PAGE_SIZE, (panel.page + 1) * PHOTO_PAGE_SIZE), needed = new Set();
    const photos = visible.map((photo, index) => {
      needed.add(photo.photoId); let value = pickerUrls.get(photo.photoId);
      if (value && value.blob !== photo.blob) { URL.revokeObjectURL(value.url); pickerUrls.delete(photo.photoId); value = null; }
      if (!value) { try { value = { blob: photo.blob, url: URL.createObjectURL(photo.blob) }; pickerUrls.set(photo.photoId, value); } catch {} }
      return Object.freeze({ photoId: photo.photoId, url: value?.url || null, number: panel.page * PHOTO_PAGE_SIZE + index + 1, selected: selected.get(panel.attractionId)?.photoId === photo.photoId });
    });
    for (const [id, value] of pickerUrls) if (!needed.has(id)) { URL.revokeObjectURL(value.url); pickerUrls.delete(id); }
    return Object.freeze({ ...panel, name: REQUIRED_CHECK_IN_LOCATIONS.find(item => item.id === panel.attractionId).name, photos: Object.freeze(photos), pages,
      message: readState === "loading" ? "正在讀取相片…" : readState === "error" ? "相片讀取失敗，不代表相片已刪除。請返回紀錄卡後重試。" : !all.length ? "本站尚未保存相片；未選相片的位置會顯示完成標記。" : "" });
  }
  function getModel() {
    const valid = eligible(); let personal = false;
    try { validateStudentIdentity(identity); personal = true; } catch { /* Draft remains editable. */ }
    const ready = Boolean(result && current(resultToken));
    if (opened && !suspended && !panel && ready && !previewUrl) previewUrl = URL.createObjectURL(result);
    return Object.freeze({ identity: Object.freeze({ ...identity }), profilePrefilled, busy, status, previewUrl: ready && !panel ? previewUrl : null,
      selectedStations: Object.freeze(REQUIRED_CHECK_IN_LOCATIONS.filter(station => selected.has(station.id)).map(station => Object.freeze({ attractionId: station.id, name: station.name }))),
      layout: ready && layout ? Object.freeze({ ...layout, circles: Object.freeze(layout.circles.map(circle => Object.freeze({ ...circle, selected: selected.has(circle.attractionId) }))) }) : null,
      picker: opened && !suspended ? pickerModel() : null,
      adjustment: opened && !suspended && panel?.kind === "adjust" ? Object.freeze({ name: REQUIRED_CHECK_IN_LOCATIONS.find(item => item.id === panel.attractionId).name,
        frame: Object.freeze({ ...panel.frame }), ready: Boolean(panel.image && !panel.error),
        message: panel.error || (panel.image ? "" : "正在讀取相片…") }) : null, recordLabel: valid ? checkInCardLabel(getCompletion()) : "請先完成五個必需景點打卡。",
      canPreview: opened && !suspended && !panel && valid && personal && selectedPhotos() !== null && !busy,
      canDownload: opened && !suspended && !panel && valid && ready && !busy });
  }
  function render() {
    if (!opened || suspended || composing) return;
    const focus = document.activeElement, focusId = dialog.contains(focus) ? focus?.id : null;
    const scroll = dialog.querySelector?.(".memory-dialog-body")?.scrollTop || 0;
    dialog.innerHTML = renderCheckInCard(getModel()); decorateInterface(dialog); drawAdjustment();
    if (!dialog.open) dialog.showModal();
    const body = dialog.querySelector?.(".memory-dialog-body"); if (body) body.scrollTop = scroll;
    if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  }
  function open(opener = document.activeElement) {
    if (!eligible() || opened || [...document.querySelectorAll("dialog")].some(item => item.open)) return false;
    if (!identitySeeded) {
      identitySeeded = true; const saved = getIdentity();
      if (saved) { try { identity = validateStudentIdentity(saved); profilePrefilled = true; version++; invalidate(); } catch { /* Invalid profiles never replace a draft. */ } }
    }
    entry = { element: opener, id: opener?.id, scroll: window.scrollY || 0 }; opened = true;
    reconcile(); if (resultToken && !current(resultToken)) invalidate();
    render(); document.getElementById("checkin-card-title")?.focus({ preventScroll: true }); return true;
  }
  function input(target, isComposing = false) {
    const key = target?.dataset?.checkinCardField;
    if (!opened || suspended || isComposing || !Object.hasOwn(STUDENT_IDENTITY_LIMITS, key)) return;
    const value = String(target.value || "");
    if (identity[key] !== value) { identity[key] = value; version++; invalidate(); status = "資料已改動，請重新預覽。"; }
    const count = Array.from(value).length, counter = document.getElementById(`checkin-card-${key}-hint`);
    if (counter) counter.textContent = `${count}／${STUDENT_IDENTITY_LIMITS[key]} 字${count > STUDENT_IDENTITY_LIMITS[key] ? "，請縮短" : ""}`;
    const model = getModel(), preview = document.getElementById("checkin-card-preview-button"), download = document.getElementById("checkin-card-download");
    if (preview) preview.disabled = !model.canPreview; if (download) download.disabled = !model.canDownload;
    if (!result) dialog.querySelector?.(".artwork-result")?.remove();
    const message = document.getElementById("checkin-card-status"); if (message) { message.hidden = !status; message.textContent = status; }
  }
  function captureInput() { for (const target of dialog.querySelectorAll("[data-checkin-card-field]")) input(target); composing = null; }
  function close({ restore = true } = {}) {
    captureInput(); epoch++; if (busy) status = "製作已取消，草稿仍保留。";
    if (resultToken) resultToken = { ...resultToken, epoch };
    opened = suspended = busy = false; releaseAdjustment(); panel = pickerReturn = null; downloadToken = null; releasePicker();
    if (dialog.open) dialog.close(); releasePreview(); dialog.innerHTML = "";
    if (restore) { (document.getElementById(entry?.id) || (entry?.element?.isConnected ? entry.element : document.querySelector("#app")))?.focus?.({ preventScroll: true }); window.scrollTo?.(0, entry?.scroll || 0); }
  }
  function clear() { close({ restore: false }); identity = emptyIdentity(); identitySeeded = profilePrefilled = false; selected.clear(); invalidate(); version++; status = ""; }
  function pause() { close({ restore: false }); invalidate(); }
  function reconcile() {
    let changed = false;
    if (getPhotoReadState() !== "loading") for (const [id, choice] of selected) {
      if (getPhotoReadState() !== "ready" || !getPhotos(id).some(photo => photo.attractionId === id && photo.photoId === choice.photoId && photo.writeId === choice.writeId)) { selected.delete(id); changed = true; }
    }
    if (changed) { version++; invalidate(); status = "所選相片已改動或未能讀取，請重新選取。"; }
    if (!opened) return;
    if (!eligible()) { invalidate(); close(); return; }
    if (resultToken && !current(resultToken)) { invalidate(); status = "打卡紀錄已改動或相片已更新，請重新預覽。"; changed = true; }
    if (panel?.kind === "adjust") {
      if (!adjustmentCurrent(panel)) { cancelPicker(); status = "相片已改動，請重新選取。"; render(); }
      return;
    }
    render();
  }
  async function preview() {
    captureInput(); if (!getModel().canPreview) return;
    invalidate(); const token = task(); busy = true; status = "正在製作紀錄卡…"; render();
    try {
      let nextLayout;
      const blob = await cardService({ completion: getCompletion(), identity: { ...identity }, photos: token.photos, tripTitle: TRIP_DATA.title, dateLabel: TRIP_DATA.dateLabel,
        onLayout: value => { nextLayout = value; }, isRelevant: () => current(token) });
      if (!current(token)) return;
      result = blob; resultToken = token; layout = nextLayout || null; status = "預覽已完成，可按圓圈選相片。";
    } catch (error) { if (current(token)) status = `未能製作紀錄卡：${error.message || "請重試"}。草稿仍保留。`; }
    finally { if (epoch === token.epoch) { busy = false; if (!current(token)) { status = "打卡紀錄已改動或相片已更新，請重新預覽。"; reconcile(); } render(); } }
  }
  async function openPicker(id) {
    const model = getModel();
    if (!(model.canDownload && layout?.circles.some(circle => circle.attractionId === id)) && !(model.canPreview && selected.has(id))) return;
    captureInput(); pickerReturn = { id: `checkin-card-circle-${id}`, scroll: dialog.querySelector?.(".memory-dialog-body")?.scrollTop || 0 };
    const choice = selected.get(id), photo = choice && getPhotos(id).find(item => item.photoId === choice.photoId && item.writeId === choice.writeId);
    if (photo) return beginAdjustment(photo, choice.frame);
    panel = { kind: "picker", attractionId: id, page: 0 }; releasePreview(); render();
    const body = dialog.querySelector?.(".memory-dialog-body"); if (body) body.scrollTop = 0;
    document.getElementById("checkin-card-picker-title")?.focus({ preventScroll: true });
  }
  function restoreCircle() {
    const body = dialog.querySelector?.(".memory-dialog-body"); if (body) body.scrollTop = pickerReturn?.scroll || 0;
    document.getElementById(pickerReturn?.id)?.focus({ preventScroll: true }); pickerReturn = null;
  }
  function releaseAdjustment() {
    if (panel?.kind !== "adjust") return;
    const image = panel.image; panel.image = null;
    releasePointers();
    image?.close?.();
  }
  function releasePointers() {
    if (panel?.kind !== "adjust") return;
    const pointers = [...panel.pointers]; panel.pointers.clear();
    for (const [id, pointer] of pointers) { try { pointer.canvas.releasePointerCapture(id); } catch {} }
  }
  function cancelPicker() { if (!panel) return; releaseAdjustment(); panel = null; releasePicker(); render(); restoreCircle(); }
  function adjustmentCurrent(edit) {
    return opened && !suspended && panel === edit && eligible() && getPhotoReadState() === "ready"
      && stamp() === edit.completion && getPhotoVersion(edit.attractionId) === edit.photoVersion
      && getPhotos(edit.attractionId).some(photo => photo.photoId === edit.photoId && photo.writeId === edit.writeId && photo.blob === edit.blob);
  }
  function drawAdjustment() {
    if (panel?.kind !== "adjust" || !panel.image || panel.error) return;
    const canvas = document.getElementById("checkin-photo-adjust-canvas"), context = canvas?.getContext("2d");
    if (!context) throw Error("此瀏覽器未能預覽相片位置，請改用其他瀏覽器。");
    context.clearRect(0, 0, canvas.width, canvas.height); context.save();
    try { context.beginPath(); context.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2, 0, Math.PI * 2); context.clip(); drawCoverImage(context, panel.image, 0, 0, canvas.width, canvas.height, panel.frame); }
    finally { context.restore(); }
  }
  async function beginAdjustment(photo, frame = { x: 0.5, y: 0.5, zoom: 1 }) {
    releaseAdjustment(); releasePicker(); releasePreview();
    const edit = { kind: "adjust", attractionId: photo.attractionId, photoId: photo.photoId, writeId: photo.writeId, blob: photo.blob,
      photoVersion: getPhotoVersion(photo.attractionId), completion: stamp(), frame: { ...frame }, image: null, error: "", pointers: new Map() };
    panel = edit; render();
    const body = dialog.querySelector?.(".memory-dialog-body"); if (body) body.scrollTop = 0;
    document.getElementById("checkin-photo-adjust-title")?.focus({ preventScroll: true });
    try {
      const image = await decodeImage(photo.blob);
      if (!adjustmentCurrent(edit)) { image.close?.(); return; }
      edit.image = image; render();
    } catch (error) {
      if (!adjustmentCurrent(edit)) return;
      releaseAdjustment(); edit.error = `未能讀取相片：${error.message || "請重試"}。請更換相片或取消。`; render();
    }
  }
  function setFrame(frame) {
    panel.frame = frame;
    try { drawAdjustment(); }
    catch (error) { releaseAdjustment(); panel.error = `未能預覽相片位置：${error.message || "請重試"}。請更換相片或取消。`; render(); }
  }
  function endPointer(event) {
    if (panel?.kind !== "adjust") return;
    const pointer = panel.pointers.get(event.pointerId); if (!pointer) return;
    panel.pointers.delete(event.pointerId);
    try { pointer.canvas.releasePointerCapture(event.pointerId); } catch {}
  }
  async function applyAdjustment() {
    const edit = panel;
    if (edit?.kind !== "adjust" || !edit.image || edit.error || !adjustmentCurrent(edit)) return;
    selected.set(edit.attractionId, { photoId: edit.photoId, writeId: edit.writeId, frame: { ...edit.frame } });
    releaseAdjustment(); panel = null; version++; invalidate(); await preview(); if (opened && !suspended) restoreCircle();
  }
  async function choosePhoto(photoId) {
    if (!panel || suspended || getPhotoReadState() !== "ready") return;
    const id = panel.attractionId;
    const photo = getPhotos(id).find(item => item.attractionId === id && item.photoId === photoId);
    if (!photo || !(photo.blob instanceof Blob)) return;
    const choice = selected.get(id);
    await beginAdjustment(photo, choice?.photoId === photo.photoId && choice.writeId === photo.writeId ? choice.frame : undefined);
  }
  async function download() {
    if (suspended) return;
    captureInput(); if (!getModel().canDownload) return;
    const token = task(), blob = result; downloadToken = token; suspended = true; if (dialog.open) dialog.close(); releasePreview(); releasePicker();
    try {
      const accepted = await askConfirmation({ title: "下載五站打卡紀錄卡？", message: `姓名、班別及學號${selected.size ? "和已選相片" : ""}會印在圖片上，請核對並確認適合保存或分享。此卡不代表校方核實出席或身份。`, confirmText: "下載紀錄卡", isRelevant: () => current(token) });
      if (!accepted || !current(token) || result !== blob) return;
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      try { link.href = url; link.download = `${getCompletion().testKind ? "測試-" : ""}${TRIP_DATA.filenamePrefix}-五站打卡紀錄.png`; document.body.append(link); link.click(); link.remove(); }
      finally { window.setTimeout(() => URL.revokeObjectURL(url), 10000); }
      showToast(`紀錄卡下載已開始。${getDownloadLocationHint(navigator)}`, "default", 15000);
    } catch (error) { if (current(token)) status = `未能下載，草稿仍保留：${error.message || "請重試"}`; }
    finally {
      if (opened && downloadToken === token) {
        downloadToken = null; suspended = false;
        if (!current(token)) { invalidate(); status = "打卡紀錄已改動或相片已更新，請重新預覽。"; reconcile(); }
        render(); if (opened) document.getElementById("checkin-card-download")?.focus({ preventScroll: true });
      }
    }
  }
  dialog.addEventListener("cancel", event => { if (event.target && event.target !== dialog) return; event.preventDefault(); if (panel) cancelPicker(); else close(); });
  dialog.addEventListener("input", event => input(event.target, event.isComposing || composing === event.target));
  dialog.addEventListener("keydown", event => {
    if (event.target.id !== "checkin-photo-adjust-canvas" || event.ctrlKey || event.metaKey || event.altKey
      || panel?.kind !== "adjust" || !panel.image || panel.error || !adjustmentCurrent(panel)) return;
    const changes = { ArrowLeft: ["x", 0.01], ArrowRight: ["x", -0.01], ArrowUp: ["y", 0.01], ArrowDown: ["y", -0.01], "+": ["zoom", 0.05], "=": ["zoom", 0.05], "-": ["zoom", -0.05] };
    if (!Object.hasOwn(changes, event.key)) return;
    const [key, step] = changes[event.key], value = Math.round((panel.frame[key] + step) * 100) / 100;
    releasePointers();
    setFrame({ ...panel.frame, [key]: Math.max(key === "zoom" ? 1 : 0, Math.min(key === "zoom" ? 3 : 1, value)) });
    event.preventDefault();
  });
  dialog.addEventListener("pointerdown", event => {
    if (event.target.id !== "checkin-photo-adjust-canvas" || panel?.kind !== "adjust" || !panel.image || panel.error || event.button !== 0 || !adjustmentCurrent(panel)) return;
    const pointers = panel.pointers, type = event.pointerType;
    if (pointers.has(event.pointerId) || pointers.size >= 2 || (type !== "touch" && event.isPrimary === false)
      || (pointers.size && (type !== "touch" || [...pointers.values()][0].type !== "touch"))) return;
    const canvas = event.target;
    pointers.set(event.pointerId, { canvas, type, x: event.clientX, y: event.clientY });
    try { canvas.setPointerCapture(event.pointerId); event.preventDefault(); } catch { pointers.delete(event.pointerId); }
  });
  dialog.addEventListener("pointermove", event => {
    const edit = panel?.kind === "adjust" ? panel : null, pointer = edit?.pointers.get(event.pointerId);
    if (!pointer) return;
    if (!adjustmentCurrent(edit)) { releasePointers(); return; }
    if (pointer.x === event.clientX && pointer.y === event.clientY) return;
    const previous = [...edit.pointers.values()].map(item => ({ x: item.x, y: item.y }));
    pointer.x = event.clientX; pointer.y = event.clientY;
    const next = [...edit.pointers.values()], rect = pointer.canvas.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return;
    const midpoint = points => ({ x: points.reduce((sum, point) => sum + point.x, 0) / points.length, y: points.reduce((sum, point) => sum + point.y, 0) / points.length });
    const before = midpoint(previous), after = midpoint(next), crop = getCoverCrop(edit.image, 1, 1, edit.frame);
    let zoom = edit.frame.zoom;
    if (next.length === 2) {
      const distance = points => Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
      const oldDistance = distance(previous), newDistance = distance(next);
      if (oldDistance > 1 && newDistance > 1) zoom = Math.max(1, Math.min(3, zoom * newDistance / oldDistance));
    }
    const nextCrop = getCoverCrop(edit.image, 1, 1, { ...edit.frame, zoom });
    const frame = { zoom };
    for (const [key, origin, size, dimension, offset, length] of [["x", "sourceX", "sourceWidth", "width", "left", "width"], ["y", "sourceY", "sourceHeight", "height", "top", "height"]]) {
      const anchor = crop[origin] + (before[key] - rect[offset]) / rect[length] * crop[size];
      const travel = edit.image[dimension] - nextCrop[size];
      frame[key] = travel > 0 ? Math.max(0, Math.min(1, (anchor - (after[key] - rect[offset]) / rect[length] * nextCrop[size]) / travel)) : 0.5;
    }
    setFrame(frame);
    event.preventDefault();
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) dialog.addEventListener(type, endPointer);
  dialog.addEventListener("compositionstart", event => { if (event.target.dataset?.checkinCardField) composing = event.target; });
  dialog.addEventListener("compositionend", event => { composing = null; input(event.target); });
  dialog.addEventListener("click", async event => {
    const target = event.target.closest?.("button"); if (!target || target.disabled) return;
    if (target.matches("[data-checkin-card-close]")) close();
    if (target.matches("[data-checkin-card-preview]")) await preview();
    if (target.matches("[data-checkin-card-download]")) await download();
    if (target.matches("[data-checkin-card-circle]")) await openPicker(target.dataset.checkinCardCircle);
    if (target.matches("[data-checkin-card-picker-cancel]")) cancelPicker();
    if (target.matches("[data-checkin-card-frame-apply]")) await applyAdjustment();
    if (target.matches("[data-checkin-card-frame-reset]") && panel?.kind === "adjust" && panel.image && !panel.error && adjustmentCurrent(panel)) { releasePointers(); setFrame({ x: 0.5, y: 0.5, zoom: 1 }); }
    if (target.matches("[data-checkin-card-frame-change]") && panel?.kind === "adjust") {
      const id = panel.attractionId; releaseAdjustment(); panel = { kind: "picker", attractionId: id, page: 0 }; render(); document.getElementById("checkin-card-picker-title")?.focus({ preventScroll: true });
    }
    if (target.matches("[data-checkin-card-photo]")) await choosePhoto(target.dataset.checkinCardPhoto);
    if (target.matches("[data-checkin-card-photo-page]")) {
      const page = Number(target.dataset.checkinCardPhotoPage);
      if (panel?.kind === "picker" && Number.isInteger(page) && page >= 0 && page < Math.ceil(getPhotos(panel.attractionId).length / PHOTO_PAGE_SIZE)) {
        panel.page = page; releasePicker(); render(); document.getElementById("checkin-card-picker-title")?.focus({ preventScroll: true });
      }
    }
  });
  return Object.freeze({ open, close, pause, clear, reconcile, getModel, input, preview, download });
}
