import { STUDENT_IDENTITY_LIMITS, STUDENT_IDENTITY_LABELS, validateStudentIdentity } from "./student-identity.js";
import { TRIP_DATA } from "./data.js";
import { escapeHtml, getDownloadLocationHint } from "./formatting.js";
import { createCheckInCompletionCard, checkInCardLabel } from "./check-in-card.js";
import { decorateInterface } from "./view-components.js";

export function renderCheckInCard(model) {
  return `<div class="memory-dialog-content"><header class="memory-dialog-heading"><h2 id="checkin-card-title" tabindex="-1">製作五站打卡紀錄卡</h2><button type="button" class="icon-button" data-checkin-card-close aria-label="關閉紀錄卡視窗，保留草稿">×</button></header>
    <div class="memory-dialog-body checkin-card-editor">${model.recordLabel.startsWith("五站打卡完成紀錄：") ? "" : `<p>${escapeHtml(model.recordLabel.replace("GPS", "定位"))}</p>`}
    <div class="summary-identity">${Object.entries(STUDENT_IDENTITY_LABELS).map(([key, label]) => `<div><label for="checkin-card-${key}">${label}（必填）</label><input id="checkin-card-${key}" type="text" required data-checkin-card-field="${key}" value="${escapeHtml(model.identity[key])}" autocomplete="off" aria-describedby="checkin-card-${key}-hint" /><p id="checkin-card-${key}-hint">${Array.from(model.identity[key]).length}／${STUDENT_IDENTITY_LIMITS[key]} 字</p></div>`).join("")}</div>
    ${model.profilePrefilled ? "" : '<p class="privacy-note">身份資料只用於此卡，不保存或上傳；離開旅途回憶或重新載入後清除。此卡不代表校方核實出席或身份。</p>'}
    <p id="checkin-card-status" role="status" aria-live="polite" ${model.status ? "" : "hidden"}>${escapeHtml(model.status)}</p>
    <button id="checkin-card-preview-button" class="button button-accent" data-checkin-card-preview ${model.canPreview ? "" : "disabled"}>${model.busy ? "正在製作…" : "預覽五站紀錄卡"}</button>
    ${model.previewUrl ? `<figure class="artwork-result"><img class="artwork-preview" src="${escapeHtml(model.previewUrl)}" alt="五站打卡紀錄卡預覽，包含學生資料及五站打卡狀態" /><figcaption>請核對學生資料、五站時間及核實狀態。</figcaption></figure>` : ""}
    <button id="checkin-card-download" class="button button-primary" data-checkin-card-download ${model.canDownload ? "" : "disabled"}>下載五站打卡紀錄卡</button></div></div>`;
}

// Private identity and export data never enter a page model or persistent store.
export function createCheckInCardController({ environment = globalThis, cardService = createCheckInCompletionCard, getCompletion, canUse, askConfirmation, showToast, getIdentity = () => null }) {
  const { document, window, URL, navigator } = environment;
  let dialog = document.querySelector("#checkin-card-dialog");
  if (!dialog) { dialog = document.createElement("dialog"); dialog.id = "checkin-card-dialog"; document.body.append(dialog); }
  dialog.className = "memory-dialog"; dialog.setAttribute("aria-labelledby", "checkin-card-title"); dialog.setAttribute("closedby", "closerequest");
  let opened = false, suspended = false, busy = false, composing = null, epoch = 0, version = 0, entry = null, downloadToken = null;
  let identity = emptyIdentity(), result = null, resultStamp = null, previewUrl = null, status = "";
  let identitySeeded = false, profilePrefilled = false;
  function emptyIdentity() { return { studentName: "", className: "", studentNumber: "" }; }
  function stamp() { return JSON.stringify(getCompletion()); }
  function eligible() { try { return Boolean(canUse() && checkInCardLabel(getCompletion())); } catch { return false; } }
  function releasePreview() { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null; }
  function invalidate() { epoch++; busy = false; result = resultStamp = null; releasePreview(); }
  function getModel() {
    const valid = eligible(); let personal = false;
    try { validateStudentIdentity(identity); personal = true; } catch { /* Draft remains editable. */ }
    if (opened && !suspended && result && resultStamp === stamp() && !previewUrl) previewUrl = URL.createObjectURL(result);
    return Object.freeze({ identity: Object.freeze({ ...identity }), profilePrefilled, busy, status, previewUrl,
      recordLabel: valid ? checkInCardLabel(getCompletion()) : "請先完成五個必需景點打卡。",
      canPreview: opened && !suspended && valid && personal && !busy,
      canDownload: opened && !suspended && valid && Boolean(result) && resultStamp === stamp() && !busy });
  }
  function render() {
    if (!opened || suspended || composing) return;
    const focus = document.activeElement, focusId = dialog.contains(focus) ? focus?.id : null;
    const scroll = dialog.querySelector?.(".memory-dialog-body")?.scrollTop || 0;
    dialog.innerHTML = renderCheckInCard(getModel());
    decorateInterface(dialog);
    if (!dialog.open) dialog.showModal();
    const body = dialog.querySelector?.(".memory-dialog-body"); if (body) body.scrollTop = scroll;
    if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  }
  function open(opener = document.activeElement) {
    if (!eligible() || opened || [...document.querySelectorAll("dialog")].some(item => item.open)) return false;
    if (!identitySeeded) {
      identitySeeded = true;
      const saved = getIdentity();
      if (saved) { try { identity = validateStudentIdentity(saved); profilePrefilled = true; version++; invalidate(); } catch { /* Invalid profiles never replace a draft. */ } }
    }
    entry = { element: opener, id: opener?.id, scroll: window.scrollY || 0 }; opened = true;
    if (resultStamp !== stamp()) invalidate();
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
    captureInput(); epoch++; if (busy) status = "製作已取消，文字草稿仍保留。";
    opened = suspended = busy = false; downloadToken = null; if (dialog.open) dialog.close(); releasePreview(); dialog.innerHTML = "";
    if (restore) { (document.getElementById(entry?.id) || (entry?.element?.isConnected ? entry.element : document.querySelector("#app")))?.focus?.({ preventScroll: true }); window.scrollTo?.(0, entry?.scroll || 0); }
  }
  function clear() { close({ restore: false }); identity = emptyIdentity(); identitySeeded = profilePrefilled = false; result = resultStamp = null; version++; status = ""; }
  function pause() { close({ restore: false }); invalidate(); }
  function reconcile() {
    if (!opened) return;
    if (!eligible()) { invalidate(); close(); return; }
    if (resultStamp && resultStamp !== stamp()) { invalidate(); status = "打卡紀錄已改動，請重新預覽。"; render(); }
  }
  const task = () => ({ epoch, version, completion: stamp() });
  const current = token => opened && eligible() && epoch === token.epoch && version === token.version && stamp() === token.completion;
  async function preview() {
    captureInput(); if (!getModel().canPreview) return;
    invalidate(); const token = task(); busy = true; status = "正在製作紀錄卡…"; render();
    try {
      const blob = await cardService({ completion: getCompletion(), identity: { ...identity }, tripTitle: TRIP_DATA.title, dateLabel: TRIP_DATA.dateLabel, isRelevant: () => current(token) });
      if (!current(token)) return;
      result = blob; resultStamp = token.completion; status = "預覽已完成，請核對學生資料及五站紀錄。";
    } catch (error) { if (current(token)) status = `未能製作紀錄卡：${error.message || "請重試"}。文字草稿仍保留。`; }
    finally { if (epoch === token.epoch) { busy = false; if (!current(token)) { status = "打卡紀錄已改動，請重新預覽。"; reconcile(); } render(); } }
  }
  async function download() {
    if (suspended) return;
    captureInput(); if (!getModel().canDownload) return;
    const token = task(), blob = result; downloadToken = token; suspended = true; if (dialog.open) dialog.close(); releasePreview();
    try {
      const accepted = await askConfirmation({ title: "下載五站打卡紀錄卡？", message: "姓名、班別及學號會印在圖片上，請核對並確認適合保存或分享。此卡不代表校方核實出席或身份。", confirmText: "下載紀錄卡", isRelevant: () => current(token) });
      if (!accepted || !current(token) || result !== blob) return;
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      try { link.href = url; link.download = `${getCompletion().testKind ? "測試-" : ""}${TRIP_DATA.filenamePrefix}-五站打卡紀錄.png`; document.body.append(link); link.click(); link.remove(); }
      finally { window.setTimeout(() => URL.revokeObjectURL(url), 10000); }
      showToast(`紀錄卡下載已開始。${getDownloadLocationHint(navigator)}`, "default", 15000);
    } catch (error) { if (current(token)) status = `未能下載，文字草稿仍保留：${error.message || "請重試"}`; }
    finally {
      if (opened && downloadToken === token) {
        downloadToken = null; suspended = false;
        if (!current(token)) { invalidate(); status = "打卡紀錄已改動，請重新預覽。"; reconcile(); }
        render(); if (opened) document.getElementById("checkin-card-download")?.focus({ preventScroll: true });
      }
    }
  }
  dialog.addEventListener("cancel", event => { if (event.target && event.target !== dialog) return; event.preventDefault(); close(); });
  dialog.addEventListener("input", event => input(event.target, event.isComposing || composing === event.target));
  dialog.addEventListener("compositionstart", event => { if (event.target.dataset?.checkinCardField) composing = event.target; });
  dialog.addEventListener("compositionend", event => { composing = null; input(event.target); });
  dialog.addEventListener("click", async event => {
    const target = event.target.closest?.("button"); if (!target || target.disabled) return;
    if (target.matches("[data-checkin-card-close]")) close();
    if (target.matches("[data-checkin-card-preview]")) await preview();
    if (target.matches("[data-checkin-card-download]")) await download();
  });
  return Object.freeze({ open, close, pause, clear, reconcile, getModel, input, preview, download });
}
