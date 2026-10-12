import { STUDENT_IDENTITY_LIMITS, STUDENT_IDENTITY_LABELS } from "./app-settings.js";
import { TRIP_DATA } from "./data.js";
import { escapeHtml, getDownloadLocationHint } from "./formatting.js";
import { prepareAIArtwork, createSignedAIArtwork, artworkRecordLabel, validateArtworkIdentity } from "./photos.js";
import { decorateInterface } from "./view-components.js";

export function renderAIArtwork(model, { inline = false } = {}) {
  const disabled = model.busy ? "disabled" : "";
  const heading = inline ? "h3" : "h2";
  return `<div class="${inline ? "memory-inline-content" : "memory-dialog-content"}"><header class="memory-dialog-heading"><${heading} id="artwork-title" tabindex="-1">為 AI 成品加上署名</${heading}><button id="artwork-close" type="button" class="icon-button" data-artwork-close aria-label="${inline ? "收起署名，保留草稿" : "關閉署名視窗，保留草稿"}">${inline ? "−" : "×"}</button></header>
    <div class="${inline ? "memory-inline-body" : "memory-dialog-body"} artwork-editor"><p>${escapeHtml(model.recordLabel.replace("本機打卡紀錄", "打卡紀錄").replace("GPS", "定位"))}</p>
    <button type="button" class="button button-secondary" data-artwork-choose ${disabled}>${model.hasArtwork ? "更換 AI 成品" : "選取 AI 成品"}</button><input id="artwork-file" type="file" accept="image/jpeg,image/png,image/webp" data-artwork-file hidden ${disabled} /><p class="privacy-note">圖片只在這部裝置處理，不會上傳或加入相簿。</p>
    ${model.sourceUrl ? `<img class="artwork-preview" src="${escapeHtml(model.sourceUrl)}" alt="已選取的 AI 成品，完整圖片" />` : ""}
    <div class="summary-identity">${Object.entries(STUDENT_IDENTITY_LABELS).map(([key, label]) => `<div><label for="artwork-${key}">${label}（必填）</label><input id="artwork-${key}" data-artwork-field="${key}" type="text" required value="${escapeHtml(model.identity[key])}" autocomplete="off" aria-describedby="artwork-${key}-hint" /><p id="artwork-${key}-hint">${Array.from(model.identity[key]).length}／${STUDENT_IDENTITY_LIMITS[key]} 字</p></div>`).join("")}</div>
    <p class="privacy-note">身份資料只用於署名，不保存或上傳；離開旅途回憶或重新載入後清除。署名不代表校方核實出席、身份或圖片內容。</p>
    <p id="artwork-status" role="status" aria-live="polite">${escapeHtml(model.status)}</p>
    <button id="artwork-preview-button" class="button button-accent" data-artwork-preview ${model.canPreview ? "" : "disabled"}>${model.busy ? "正在處理…" : "預覽署名作品"}</button>
    ${model.resultUrl ? `<figure class="artwork-result"><img class="artwork-preview" src="${escapeHtml(model.resultUrl)}" alt="署名作品預覽，完整圖片及下方署名條" /><figcaption>請確認圖片及署名正確，再下載。</figcaption></figure>` : ""}
    <button id="artwork-download" class="button button-primary" data-artwork-download ${model.canDownload ? "" : "disabled"}>下載署名作品</button></div></div>`;
}

// Owns private image capabilities; views receive only immutable text and preview URLs.
export function createAIArtworkController({ environment = globalThis, photoService = {}, getCompletion, canUse, askConfirmation, showToast, inlineRoot = null, requestRender = () => {} }) {
  const { document, window, URL, navigator } = environment;
  let dialog = document.querySelector("#ai-artwork-dialog");
  if (!dialog) { dialog = document.createElement("dialog"); dialog.id = "ai-artwork-dialog"; document.body.append(dialog); }
  dialog.className = "memory-dialog"; dialog.setAttribute("aria-labelledby", "artwork-title");
  dialog.setAttribute("closedby", "closerequest");
  let opened = false, suspended = false, busy = false, composing = null, epoch = 0, inputVersion = 0;
  let artwork = null, result = null, resultStamp = null, sourceUrl = null, resultUrl = null, entry = null;
  let identity = emptyIdentity(), status = "先選取成品，填妥資料後預覽。";
  const surface = () => inlineRoot ? document.getElementById("memory-artwork-inline") : dialog;
  const currentControl = target => target?.isConnected !== false && opened && !suspended && canUse() && surface()?.contains(target);
  function emptyIdentity() { return { studentName: "", className: "", studentNumber: "" }; }
  const completionKey = () => JSON.stringify(getCompletion());
  function eligible() { try { return Boolean(canUse() && getCompletion()?.ready && artworkRecordLabel(getCompletion())); } catch { return false; } }
  function releaseUrls() { for (const url of [sourceUrl, resultUrl]) if (url) URL.revokeObjectURL(url); sourceUrl = resultUrl = null; }
  function invalidate() { epoch++; busy = false; result = resultStamp = null; if (resultUrl) URL.revokeObjectURL(resultUrl); resultUrl = null; }
  function getModel() {
    const valid = eligible(); let personal = false;
    try { validateArtworkIdentity(identity); personal = true; } catch { /* Draft remains editable. */ }
    if (opened && !suspended) {
      if (artwork && !sourceUrl) sourceUrl = URL.createObjectURL(artwork.blob);
      if (result && !resultUrl) resultUrl = URL.createObjectURL(result);
    }
    let recordLabel = "請先完成五個必需景點打卡（學校選填）。";
    try { if (valid) recordLabel = artworkRecordLabel(getCompletion()); } catch { /* Guard closed by reconcile. */ }
    return Object.freeze({ visible: opened && !suspended, identity: Object.freeze({ ...identity }), hasArtwork: Boolean(artwork), sourceUrl, resultUrl,
      busy, status, recordLabel, canPreview: valid && Boolean(artwork) && personal && !busy,
      canDownload: valid && Boolean(result) && resultStamp === completionKey() && !busy });
  }
  function render() {
    if (!opened || suspended || composing) return;
    if (inlineRoot) { requestRender(); return; }
    const focus = document.activeElement, focusId = dialog.contains(focus) ? focus?.id : null;
    const body = dialog.querySelector?.(".memory-dialog-body"), scroll = body?.scrollTop || 0;
    dialog.innerHTML = renderAIArtwork(getModel());
    decorateInterface(dialog);
    if (!dialog.open) dialog.showModal();
    const nextBody = dialog.querySelector?.(".memory-dialog-body"); if (nextBody) nextBody.scrollTop = scroll;
    if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  }
  function open(opener = document.activeElement) {
    if (!eligible() || opened) return false;
    entry = { element: opener, id: opener?.id, scroll: window.scrollY || 0 };
    opened = true; suspended = false;
    if (resultStamp !== completionKey()) invalidate();
    render(); document.getElementById("artwork-title")?.focus({ preventScroll: true });
    if (inlineRoot) surface()?.scrollIntoView?.({ block: "start", behavior: "instant" });
    return true;
  }
  function captureInput() {
    for (const target of surface()?.querySelectorAll?.("[data-artwork-field]") || []) input(target, false);
    composing = null;
  }
  function close({ restore = true, notify = true } = {}) {
    captureInput(); epoch++; if (busy) status = "處理已取消，成品及文字草稿仍保留。";
    busy = false; opened = suspended = false;
    if (dialog.open) dialog.close(); releaseUrls();
    dialog.innerHTML = "";
    if (inlineRoot && notify) requestRender();
    if (restore) {
      (document.getElementById(entry?.id) || (entry?.element?.isConnected ? entry.element : document.querySelector("#app")))?.focus?.({ preventScroll: true });
      window.scrollTo?.({ left: 0, top: entry?.scroll || 0, behavior: "instant" });
    }
  }
  function clear() { close({ restore: false, notify: false }); artwork = result = resultStamp = null; identity = emptyIdentity(); inputVersion++; status = "先選取成品，填妥資料後預覽。"; }
  function pause() { close({ restore: false, notify: false }); invalidate(); }
  function reconcile({ notify = true } = {}) {
    if (!opened) return;
    if (!eligible()) { invalidate(); close({ restore: notify, notify }); return; }
    if (resultStamp && resultStamp !== completionKey()) { invalidate(); status = "打卡紀錄已改動，請重新預覽。"; if (notify) render(); }
  }
  function input(target, isComposing = false) {
    const key = target?.dataset?.artworkField;
    if (!opened || suspended || !Object.hasOwn(STUDENT_IDENTITY_LIMITS, key) || isComposing) return;
    const text = String(target.value || "");
    if (identity[key] !== text) { identity[key] = text; inputVersion++; invalidate(); status = "資料已改動，請重新預覽。"; }
    // No re-render: keep cursor and Chinese composition intact; never silently truncate.
    const counter = document.getElementById(`artwork-${key}-hint`); if (counter) counter.textContent = `${Array.from(text).length}／${STUDENT_IDENTITY_LIMITS[key]} 字${Array.from(text).length > STUDENT_IDENTITY_LIMITS[key] ? "，請縮短" : ""}`;
    const model = getModel();
    const preview = document.getElementById("artwork-preview-button"); if (preview) preview.disabled = !model.canPreview;
    const download = document.getElementById("artwork-download"); if (download) download.disabled = !model.canDownload;
    const oldPreview = surface()?.querySelector?.(".artwork-result"); if (!result) oldPreview?.remove();
    const message = document.getElementById("artwork-status"); if (message) message.textContent = status;
  }
  function taskCurrent(token) { return opened && eligible() && epoch === token.epoch && inputVersion === token.version && completionKey() === token.completion; }
  function task() { return { epoch, version: inputVersion, completion: completionKey() }; }
  async function selectFile(file) {
    if (!file || !opened || !eligible()) return;
    captureInput(); epoch++; const token = task(); busy = true; status = "正在讀取 AI 成品…"; render();
    try {
      const candidate = await (photoService.prepareAIArtwork || prepareAIArtwork)(file, () => taskCurrent(token));
      if (!taskCurrent(token)) return;
      releaseUrls(); result = resultStamp = null; artwork = candidate; inputVersion++; status = "成品已選取，填妥資料後預覽。";
    } catch (error) { if (taskCurrent(token)) status = `未能選取成品：${error.message || "圖片解碼失敗"}。原有成品及文字仍保留。`; }
    finally { if (epoch === token.epoch) { busy = false; render(); } }
  }
  async function preview() {
    captureInput(); if (!getModel().canPreview) return;
    invalidate(); const token = task(); busy = true; status = "正在製作署名預覽…"; render();
    try {
      const blob = await (photoService.createSignedAIArtwork || createSignedAIArtwork)({ artwork: artwork.blob, identity: { ...identity }, completion: getCompletion(),
        tripTitle: TRIP_DATA.title, dateLabel: TRIP_DATA.dateLabel, isRelevant: () => taskCurrent(token) });
      if (!taskCurrent(token)) return;
      result = blob; resultStamp = token.completion; status = "預覽已完成，請確認署名及圖片。";
    } catch (error) { if (taskCurrent(token)) status = `未能生成署名：${error.message || "圖片解碼失敗"}。草稿仍保留，請修改或重試。`; }
    finally { if (epoch === token.epoch) { busy = false; render(); } }
  }
  async function download() {
    if (suspended) return;
    captureInput(); if (!getModel().canDownload) return;
    const token = task(), blob = result;
    const scrollY = window.scrollY || 0;
    suspended = true; if (dialog.open) dialog.close(); releaseUrls();
    if (inlineRoot) requestRender();
    try {
      const accepted = await askConfirmation({ title: "下載署名作品？", message: "姓名、班別及學號會印在圖片上，請確認適合保存或分享。這不是校方出席證明。", confirmText: "下載作品", isRelevant: () => taskCurrent(token) });
      if (!accepted || !taskCurrent(token) || result !== blob) return;
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      try { link.href = url; link.download = `${getCompletion().testKind ? "測試-" : ""}${TRIP_DATA.filenamePrefix}-AI融合圖片署名.png`; document.body.append(link); link.click(); link.remove(); }
      finally { window.setTimeout(() => URL.revokeObjectURL(url), 10000); }
      showToast(`署名作品下載已開始。${getDownloadLocationHint(navigator)}`, "default", 15000);
    } catch (error) { if (taskCurrent(token)) status = `未能下載，草稿仍保留：${error.message || "請重試"}`; }
    finally { if (opened && taskCurrent(token)) {
      suspended = false; render();
      if (inlineRoot) window.scrollTo?.({ left: 0, top: scrollY, behavior: "instant" });
      document.getElementById("artwork-download")?.focus({ preventScroll: true });
    } }
  }
  dialog.addEventListener("cancel", event => {
    // A file input's cancel event bubbles too; cancelling its chooser keeps this draft open.
    if (event.target && event.target !== dialog) return;
    event.preventDefault(); close();
  });
  const root = inlineRoot || dialog;
  root.addEventListener("input", event => { if (currentControl(event.target)) input(event.target, event.isComposing || composing === event.target); });
  root.addEventListener("compositionstart", event => { if (currentControl(event.target) && event.target.dataset?.artworkField) composing = event.target; });
  root.addEventListener("compositionend", event => {
    if (composing !== event.target || !currentControl(event.target)) return;
    composing = null; input(event.target); if (inlineRoot) render();
  });
  root.addEventListener("change", event => { if (currentControl(event.target) && event.target.matches?.("[data-artwork-file]")) { const file = event.target.files?.[0]; event.target.value = ""; void selectFile(file); } });
  root.addEventListener("click", async event => {
    const target = event.target.closest?.("button"); if (!target || target.disabled || !currentControl(target)) return;
    if (target.matches("[data-artwork-close]")) close();
    if (target.matches("[data-artwork-choose]")) document.getElementById("artwork-file")?.click();
    if (target.matches("[data-artwork-preview]")) await preview();
    if (target.matches("[data-artwork-download]")) await download();
  });
  return Object.freeze({ open, close, pause, clear, reconcile, getModel, input, selectFile, preview, download,
    get opened() { return opened; }, get suspended() { return suspended; }, get composing() { return Boolean(composing); } });
}
