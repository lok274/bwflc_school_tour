import { STUDENT_IDENTITY_LIMITS, STUDENT_IDENTITY_LABELS } from "./app-settings.js";
import { TRIP_DATA } from "./data.js";
import { escapeHtml, getDownloadLocationHint } from "./formatting.js";
import { prepareAIArtwork, createSignedAIArtwork, artworkRecordLabel, validateArtworkIdentity } from "./photos.js";

export function renderAIArtwork(model) {
  const disabled = model.busy ? "disabled" : "";
  return `<div class="memory-dialog-content"><header class="memory-dialog-heading"><h2 id="artwork-title" tabindex="-1">為 AI 成品加上署名</h2><button type="button" class="icon-button" data-artwork-close aria-label="關閉署名視窗，保留草稿">×</button></header>
    <div class="memory-dialog-body artwork-editor"><p>選取 AI 工具已完成的圖片，再填寫資料。署名會放在下方獨立色條，保留整幅圖片。</p><p>${escapeHtml(model.recordLabel)}</p>
    <button type="button" class="button button-secondary" data-artwork-choose ${disabled}>${model.hasArtwork ? "更換 AI 成品" : "選取 AI 成品"}</button><input id="artwork-file" type="file" accept="image/jpeg,image/png,image/webp" data-artwork-file hidden ${disabled} /><p class="privacy-note">只在此裝置處理 JPEG、PNG 或靜態 WebP（最多 20 MiB；邊長最多 8192px、總像素最多 5,000 萬）。不加入景點相簿，不保存至資料庫或上傳。</p>
    ${model.sourceUrl ? `<img class="artwork-preview" src="${escapeHtml(model.sourceUrl)}" alt="已選取的 AI 成品，完整圖片" />` : ""}
    <div class="summary-identity">${Object.entries(STUDENT_IDENTITY_LABELS).map(([key, label]) => `<div><label for="artwork-${key}">${label}（必填）</label><input id="artwork-${key}" data-artwork-field="${key}" type="text" required value="${escapeHtml(model.identity[key])}" autocomplete="off" aria-describedby="artwork-${key}-hint" /><p id="artwork-${key}-hint">${Array.from(model.identity[key]).length}／${STUDENT_IDENTITY_LIMITS[key]} 字</p></div>`).join("")}</div>
    <p class="privacy-note">三項資料只用於本機作品署名，不代表校方核實出席、學生身份或 AI 圖片內容。關閉保留草稿；離開旅途回憶、重載或清除資料後清除。檔名不含身份資料。</p>
    <p id="artwork-status" role="status" aria-live="polite">${escapeHtml(model.status)}</p>
    <button id="artwork-preview-button" class="button button-accent" data-artwork-preview ${model.canPreview ? "" : "disabled"}>${model.busy ? "正在處理…" : "預覽署名作品"}</button>
    ${model.resultUrl ? `<figure class="artwork-result"><img class="artwork-preview" src="${escapeHtml(model.resultUrl)}" alt="署名作品預覽，完整圖片及下方署名條" /><figcaption>請確認圖片及署名正確，再下載。</figcaption></figure>` : ""}
    <button id="artwork-download" class="button button-primary" data-artwork-download ${model.canDownload ? "" : "disabled"}>下載署名作品 PNG</button></div></div>`;
}

// Owns private image capabilities; views receive only immutable text and preview URLs.
export function createAIArtworkController({ environment = globalThis, photoService = {}, getCompletion, canUse, askConfirmation, showToast }) {
  const { document, window, URL, navigator } = environment;
  let dialog = document.querySelector("#ai-artwork-dialog");
  if (!dialog) { dialog = document.createElement("dialog"); dialog.id = "ai-artwork-dialog"; document.body.append(dialog); }
  dialog.className = "memory-dialog"; dialog.setAttribute("aria-labelledby", "artwork-title");
  dialog.setAttribute("closedby", "closerequest");
  let opened = false, suspended = false, busy = false, composing = null, epoch = 0, inputVersion = 0;
  let artwork = null, result = null, resultStamp = null, sourceUrl = null, resultUrl = null, entry = null;
  let identity = emptyIdentity(), status = "先選取成品，填妥資料後預覽。";
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
    return Object.freeze({ identity: Object.freeze({ ...identity }), hasArtwork: Boolean(artwork), sourceUrl, resultUrl,
      busy, status, recordLabel, canPreview: valid && Boolean(artwork) && personal && !busy,
      canDownload: valid && Boolean(result) && resultStamp === completionKey() && !busy });
  }
  function render() {
    if (!opened || suspended || composing) return;
    const focus = document.activeElement, focusId = dialog.contains(focus) ? focus?.id : null;
    const body = dialog.querySelector?.(".memory-dialog-body"), scroll = body?.scrollTop || 0;
    dialog.innerHTML = renderAIArtwork(getModel());
    if (!dialog.open) dialog.showModal();
    const nextBody = dialog.querySelector?.(".memory-dialog-body"); if (nextBody) nextBody.scrollTop = scroll;
    if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  }
  function open(opener = document.activeElement) {
    if (!eligible() || opened) return false;
    entry = { element: opener, id: opener?.id, scroll: window.scrollY || 0 };
    opened = true; suspended = false;
    if (resultStamp !== completionKey()) invalidate();
    render(); document.getElementById("artwork-title")?.focus({ preventScroll: true }); return true;
  }
  function captureInput() {
    for (const target of dialog.querySelectorAll?.("[data-artwork-field]") || []) input(target, false);
    composing = null;
  }
  function close({ restore = true } = {}) {
    captureInput(); epoch++; if (busy) status = "處理已取消，成品及文字草稿仍保留。";
    busy = false; opened = suspended = false;
    if (dialog.open) dialog.close(); releaseUrls();
    dialog.innerHTML = "";
    if (restore) {
      (document.getElementById(entry?.id) || (entry?.element?.isConnected ? entry.element : document.querySelector("#app")))?.focus?.({ preventScroll: true });
      window.scrollTo?.(0, entry?.scroll || 0);
    }
  }
  function clear() { close({ restore: false }); artwork = result = resultStamp = null; identity = emptyIdentity(); inputVersion++; status = "先選取成品，填妥資料後預覽。"; }
  function reconcile() {
    if (!opened) return;
    if (!eligible()) { invalidate(); close(); return; }
    if (resultStamp && resultStamp !== completionKey()) { invalidate(); status = "打卡紀錄已改動，請重新預覽。"; render(); }
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
    const oldPreview = dialog.querySelector?.(".artwork-result"); if (!result) oldPreview?.remove();
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
    invalidate(); const token = task(); busy = true; status = "正在載入本機字型及生成署名預覽…"; render();
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
    suspended = true; if (dialog.open) dialog.close(); releaseUrls();
    try {
      const accepted = await askConfirmation({ title: "下載署名作品？", message: "姓名、班別及學號會印在圖片上。這是作品署名及本機紀錄標示，並非校方出席證明。請確認適合保存或分享。", confirmText: "下載 PNG", isRelevant: () => taskCurrent(token) });
      if (!accepted || !taskCurrent(token) || result !== blob) return;
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      try { link.href = url; link.download = `${getCompletion().testKind ? "測試-" : ""}${TRIP_DATA.filenamePrefix}-AI融合圖片署名.png`; document.body.append(link); link.click(); link.remove(); }
      finally { window.setTimeout(() => URL.revokeObjectURL(url), 10000); }
      showToast(`署名作品下載已開始。${getDownloadLocationHint(navigator)}`, "default", 15000);
    } catch (error) { if (taskCurrent(token)) status = `未能下載，草稿仍保留：${error.message || "請重試"}`; }
    finally { if (opened && taskCurrent(token)) { suspended = false; render(); document.getElementById("artwork-download")?.focus({ preventScroll: true }); } }
  }
  dialog.addEventListener("cancel", event => {
    // A file input's cancel event bubbles too; cancelling its chooser keeps this draft open.
    if (event.target && event.target !== dialog) return;
    event.preventDefault(); close();
  });
  dialog.addEventListener("input", event => input(event.target, event.isComposing || composing === event.target));
  dialog.addEventListener("compositionstart", event => { if (event.target.dataset?.artworkField) composing = event.target; });
  dialog.addEventListener("compositionend", event => { composing = null; input(event.target); });
  dialog.addEventListener("change", event => { if (event.target.matches?.("[data-artwork-file]")) { const file = event.target.files?.[0]; event.target.value = ""; void selectFile(file); } });
  dialog.addEventListener("click", async event => {
    const target = event.target.closest?.("button"); if (!target || target.disabled) return;
    if (target.matches("[data-artwork-close]")) close();
    if (target.matches("[data-artwork-choose]")) document.getElementById("artwork-file")?.click();
    if (target.matches("[data-artwork-preview]")) await preview();
    if (target.matches("[data-artwork-download]")) await download();
  });
  return Object.freeze({ open, close, clear, reconcile, getModel, input, selectFile, preview, download });
}
