import { STUDENT_IDENTITY_LIMITS, STUDENT_IDENTITY_LABELS, validateStudentIdentity } from "./student-identity.js";
import { TRIP_DATA, REQUIRED_CHECK_IN_LOCATIONS } from "./data.js";
import { PHOTO_PAGE_SIZE } from "./app-settings.js";
import { escapeHtml, getDownloadLocationHint } from "./formatting.js";
import { createCheckInCompletionCard, checkInCardLabel } from "./check-in-card.js";
import { decorateInterface } from "./view-components.js";

function renderPicker(picker) {
  return `<section aria-labelledby="checkin-card-picker-title"><h3 id="checkin-card-picker-title" tabindex="-1">${escapeHtml(picker.name)}選相片</h3><p>只顯示本站已保存的相片。相片會裁成圓形，不會修改原相片。</p>
    <button class="button button-secondary" data-checkin-card-picker-cancel>返回紀錄卡</button>${picker.selected ? '<button class="button button-secondary" data-checkin-card-photo-clear>使用完成標記</button>' : ''}
    ${picker.message ? `<p role="status">${escapeHtml(picker.message)}</p>` : ''}
    <div class="memory-thumbnails">${picker.photos.map(photo => `<article class="memory-thumbnail"><button type="button" data-checkin-card-photo="${escapeHtml(photo.photoId)}" aria-label="使用${escapeHtml(picker.name)}第 ${photo.number} 張相片" aria-pressed="${photo.selected}">${photo.url ? `<img src="${escapeHtml(photo.url)}" alt="${escapeHtml(picker.name)}第 ${photo.number} 張相片" />` : '<span>預覽未能顯示</span>'}<span>第 ${photo.number} 張${photo.selected ? ' · 已選' : ''}</span></button></article>`).join('')}</div>
    ${picker.pages > 1 ? `<nav class="memory-pagination" aria-label="本站選圖分頁"><button class="button button-secondary" data-checkin-card-photo-page="${picker.page - 1}" ${picker.page ? '' : 'disabled'}>上一頁</button><p>第 ${picker.page + 1}／${picker.pages} 頁</p><button class="button button-secondary" data-checkin-card-photo-page="${picker.page + 1}" ${picker.page + 1 < picker.pages ? '' : 'disabled'}>下一頁</button></nav>` : ''}</section>`;
}

export function renderCheckInCard(model) {
  return `<div class="memory-dialog-content"><header class="memory-dialog-heading"><h2 id="checkin-card-title" tabindex="-1">製作五站打卡紀錄卡</h2><button type="button" class="icon-button" data-checkin-card-close aria-label="關閉紀錄卡視窗，保留草稿">×</button></header>
    <div class="memory-dialog-body checkin-card-editor">${model.picker ? renderPicker(model.picker) : `${model.recordLabel.startsWith("五站打卡完成紀錄：") ? "" : `<p>${escapeHtml(model.recordLabel.replace("GPS", "定位"))}</p>`}
    <div class="summary-identity">${Object.entries(STUDENT_IDENTITY_LABELS).map(([key, label]) => `<div><label for="checkin-card-${key}">${label}（必填）</label><input id="checkin-card-${key}" type="text" required data-checkin-card-field="${key}" value="${escapeHtml(model.identity[key])}" autocomplete="off" aria-describedby="checkin-card-${key}-hint" /><p id="checkin-card-${key}-hint">${Array.from(model.identity[key]).length}／${STUDENT_IDENTITY_LIMITS[key]} 字</p></div>`).join("")}</div>
    ${model.profilePrefilled ? "" : '<p class="privacy-note">身份資料只用於此卡，不保存或上傳；離開旅途回憶或重新載入後清除。此卡不代表校方核實出席或身份。</p>'}
    <p id="checkin-card-status" role="status" aria-live="polite" ${model.status ? "" : "hidden"}>${escapeHtml(model.status)}</p>
    <button id="checkin-card-preview-button" class="button button-accent" data-checkin-card-preview ${model.canPreview ? "" : "disabled"}>${model.busy ? "正在製作…" : "預覽五站紀錄卡"}</button>
    ${!model.previewUrl && model.canPreview ? model.selectedStations.map(station => `<button id="checkin-card-circle-${escapeHtml(station.attractionId)}" type="button" class="button button-secondary" data-checkin-card-circle="${escapeHtml(station.attractionId)}">重新選擇${escapeHtml(station.name)}相片</button>`).join('') : ''}
    ${model.previewUrl ? `<figure class="artwork-result"><div class="checkin-card-canvas"><img class="artwork-preview" src="${escapeHtml(model.previewUrl)}" alt="五站打卡紀錄卡預覽，包含學生資料、五站打卡狀態及已選相片" />${model.layout ? `<svg class="checkin-card-targets" viewBox="0 0 ${model.layout.width} ${model.layout.height}" aria-label="按圓圈選擇本站相片">${model.layout.circles.map(circle => `<foreignObject x="${circle.cx - circle.r}" y="${circle.cy - circle.r}" width="${circle.r * 2}" height="${circle.r * 2}"><button xmlns="http://www.w3.org/1999/xhtml" id="checkin-card-circle-${escapeHtml(circle.attractionId)}" type="button" class="checkin-card-circle" data-checkin-card-circle="${escapeHtml(circle.attractionId)}" aria-label="${escapeHtml(circle.name)}，${circle.selected ? '更換已選相片' : '選擇相片'}"></button></foreignObject>`).join('')}</svg>` : ''}</div><figcaption>按圓圈可選擇本站相片；不選相片也可下載。</figcaption></figure>` : ""}
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
  let identitySeeded = false, profilePrefilled = false, picker = null, pickerReturn = null;
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
      photos.push(photo);
    }
    return photos;
  }
  const task = () => ({ epoch, version, completion: stamp(), photos: (selectedPhotos() || []).map(photo => ({ ...photo, photoVersion: getPhotoVersion(photo.attractionId) })) });
  function current(token) {
    if (!token || !opened || !eligible() || epoch !== token.epoch || version !== token.version || stamp() !== token.completion) return false;
    const photos = selectedPhotos();
    return photos && photos.length === token.photos.length && token.photos.every(photo => getPhotoVersion(photo.attractionId) === photo.photoVersion
      && photos.some(item => item.attractionId === photo.attractionId && item.photoId === photo.photoId && item.writeId === photo.writeId && item.blob === photo.blob));
  }
  function pickerModel() {
    if (!picker) return null;
    const readState = getPhotoReadState(), all = readState === "ready" ? [...getPhotos(picker.attractionId)].reverse() : [];
    const pages = Math.ceil(all.length / PHOTO_PAGE_SIZE); picker.page = Math.min(picker.page, Math.max(0, pages - 1));
    const visible = all.slice(picker.page * PHOTO_PAGE_SIZE, (picker.page + 1) * PHOTO_PAGE_SIZE), needed = new Set();
    const photos = visible.map((photo, index) => {
      needed.add(photo.photoId); let value = pickerUrls.get(photo.photoId);
      if (value && value.blob !== photo.blob) { URL.revokeObjectURL(value.url); pickerUrls.delete(photo.photoId); value = null; }
      if (!value) { try { value = { blob: photo.blob, url: URL.createObjectURL(photo.blob) }; pickerUrls.set(photo.photoId, value); } catch {} }
      return Object.freeze({ photoId: photo.photoId, url: value?.url || null, number: picker.page * PHOTO_PAGE_SIZE + index + 1, selected: selected.get(picker.attractionId)?.photoId === photo.photoId });
    });
    for (const [id, value] of pickerUrls) if (!needed.has(id)) { URL.revokeObjectURL(value.url); pickerUrls.delete(id); }
    return Object.freeze({ ...picker, name: REQUIRED_CHECK_IN_LOCATIONS.find(item => item.id === picker.attractionId).name, photos: Object.freeze(photos), pages,
      selected: selected.has(picker.attractionId), message: readState === "loading" ? "正在讀取相片…" : readState === "error" ? "相片讀取失敗，不代表相片已刪除。可返回紀錄卡，使用完成標記製卡。" : !all.length ? "本站尚未保存相片。可返回紀錄卡，使用完成標記製卡。" : "" });
  }
  function getModel() {
    const valid = eligible(); let personal = false;
    try { validateStudentIdentity(identity); personal = true; } catch { /* Draft remains editable. */ }
    const ready = Boolean(result && current(resultToken));
    if (opened && !suspended && !picker && ready && !previewUrl) previewUrl = URL.createObjectURL(result);
    return Object.freeze({ identity: Object.freeze({ ...identity }), profilePrefilled, busy, status, previewUrl: ready && !picker ? previewUrl : null,
      selectedStations: Object.freeze(REQUIRED_CHECK_IN_LOCATIONS.filter(station => selected.has(station.id)).map(station => Object.freeze({ attractionId: station.id, name: station.name }))),
      layout: ready && layout ? Object.freeze({ ...layout, circles: Object.freeze(layout.circles.map(circle => Object.freeze({ ...circle, selected: selected.has(circle.attractionId) }))) }) : null,
      picker: opened && !suspended ? pickerModel() : null, recordLabel: valid ? checkInCardLabel(getCompletion()) : "請先完成五個必需景點打卡。",
      canPreview: opened && !suspended && !picker && valid && personal && selectedPhotos() !== null && !busy,
      canDownload: opened && !suspended && !picker && valid && ready && !busy });
  }
  function render() {
    if (!opened || suspended || composing) return;
    const focus = document.activeElement, focusId = dialog.contains(focus) ? focus?.id : null;
    const scroll = dialog.querySelector?.(".memory-dialog-body")?.scrollTop || 0;
    dialog.innerHTML = renderCheckInCard(getModel()); decorateInterface(dialog);
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
    opened = suspended = busy = false; picker = pickerReturn = null; downloadToken = null; releasePicker();
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
    if (changed) { version++; invalidate(); status = "所選相片已改動或未能讀取，請重新選取；仍可使用完成標記製卡。"; }
    if (!opened) return;
    if (!eligible()) { invalidate(); close(); return; }
    if (resultToken && !current(resultToken)) { invalidate(); status = "打卡紀錄已改動或相片已更新，請重新預覽。"; changed = true; }
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
  function openPicker(id) {
    const model = getModel();
    if (!(model.canDownload && layout?.circles.some(circle => circle.attractionId === id)) && !(model.canPreview && selected.has(id))) return;
    captureInput(); pickerReturn = { id: `checkin-card-circle-${id}`, scroll: dialog.querySelector?.(".memory-dialog-body")?.scrollTop || 0 };
    picker = { attractionId: id, page: 0 }; releasePreview(); render();
    const body = dialog.querySelector?.(".memory-dialog-body"); if (body) body.scrollTop = 0;
    document.getElementById("checkin-card-picker-title")?.focus({ preventScroll: true });
  }
  function restoreCircle() {
    const body = dialog.querySelector?.(".memory-dialog-body"); if (body) body.scrollTop = pickerReturn?.scroll || 0;
    document.getElementById(pickerReturn?.id)?.focus({ preventScroll: true }); pickerReturn = null;
  }
  function cancelPicker() { if (!picker) return; picker = null; releasePicker(); render(); restoreCircle(); }
  async function choosePhoto(photoId) {
    if (!picker || suspended || getPhotoReadState() !== "ready") return;
    const id = picker.attractionId;
    const photo = photoId ? getPhotos(id).find(item => item.attractionId === id && item.photoId === photoId) : null;
    if (photoId && (!photo || !(photo.blob instanceof Blob))) return;
    if (photo) selected.set(id, { photoId: photo.photoId, writeId: photo.writeId }); else selected.delete(id);
    picker = null; releasePicker(); version++; invalidate(); await preview(); if (opened && !suspended) restoreCircle();
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
  dialog.addEventListener("cancel", event => { if (event.target && event.target !== dialog) return; event.preventDefault(); if (picker) cancelPicker(); else close(); });
  dialog.addEventListener("input", event => input(event.target, event.isComposing || composing === event.target));
  dialog.addEventListener("compositionstart", event => { if (event.target.dataset?.checkinCardField) composing = event.target; });
  dialog.addEventListener("compositionend", event => { composing = null; input(event.target); });
  dialog.addEventListener("click", async event => {
    const target = event.target.closest?.("button"); if (!target || target.disabled) return;
    if (target.matches("[data-checkin-card-close]")) close();
    if (target.matches("[data-checkin-card-preview]")) await preview();
    if (target.matches("[data-checkin-card-download]")) await download();
    if (target.matches("[data-checkin-card-circle]")) openPicker(target.dataset.checkinCardCircle);
    if (target.matches("[data-checkin-card-picker-cancel]")) cancelPicker();
    if (target.matches("[data-checkin-card-photo]")) await choosePhoto(target.dataset.checkinCardPhoto);
    if (target.matches("[data-checkin-card-photo-clear]")) await choosePhoto(null);
    if (target.matches("[data-checkin-card-photo-page]")) {
      const page = Number(target.dataset.checkinCardPhotoPage);
      if (picker && Number.isInteger(page) && page >= 0 && page < Math.ceil(getPhotos(picker.attractionId).length / PHOTO_PAGE_SIZE)) {
        picker.page = page; releasePicker(); render(); document.getElementById("checkin-card-picker-title")?.focus({ preventScroll: true });
      }
    }
  });
  return Object.freeze({ open, close, pause, clear, reconcile, getModel, input, preview, download });
}
