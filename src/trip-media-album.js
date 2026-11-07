import { escapeHtml } from "./formatting.js";
import { PHOTO_UPLOAD_DEADLINE, createSchoolPhotoUpload } from "./school-photo-upload.js";
import { MEDIA_EXTENSIONS, MAX_TRIP_MEDIA_BATCH, isOriginalMedia, mediaKind, validateTripMedia } from "./trip-media-types.js";
import { createTripMediaStorage } from "./trip-media-storage.js";

const PAGE_SIZE = 12;
const describeError = error => error.name === "QuotaExceededError" ? "儲存空間不足，請先騰出空間再試。" : error.message || "未能完成操作。";
const displaySize = size => size < 1024 ** 2 ? `${Math.ceil(size / 1024)} KB` : `${(size / 1024 ** 2).toFixed(1)} MB`;

export function createTripMediaAlbum({ environment, photoService, isActive, askConfirmation, uploadFactory = createSchoolPhotoUpload, storage = createTripMediaStorage(environment) }) {
  const { document, window, URL, navigator } = environment;
  let root, items = [], page = 0, generation, task, preview, upload, report = [], message = "", ready = false;
  const selected = new Set();
  const current = operation => task === operation && !operation.signal.aborted && isActive();
  const begin = () => task = new AbortController();
  const canUpload = () => Date.now() < PHOTO_UPLOAD_DEADLINE && navigator.onLine !== false;

  function closePreview() {
    if (preview) URL.revokeObjectURL(preview.url);
    preview = null;
  }
  function closeUpload() {
    upload?.client.cancel();
    upload = null;
  }
  function leave() {
    task?.abort();
    task = null;
    closePreview();
    closeUpload();
    root = null;
    items = [];
    selected.clear();
    generation = undefined;
    page = 0;
    ready = false;
    message = "";
    report = [];
  }
  function render() {
    if (!root || !isActive()) return;
    const focusId = root.contains(document.activeElement) ? document.activeElement.id : "";
    const disabled = task || upload ? "disabled" : "";
    const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    page = Math.min(page, pageCount - 1);
    root.innerHTML = `<h2>獨立相簿</h2><p>毋須打卡。匯入的檔案先儲存在此裝置。</p>
      <div class="trip-media-drop" data-trip-drop role="group" aria-label="匯入檔案">
        <p>將相片及影片拖放到這裏，或用下方按鈕選取。</p>
        <button id="trip-media-import" class="button button-primary" data-trip-media="pick" ${ready ? disabled : "disabled"}>匯入相片及影片</button></div>
      <button id="trip-media-upload" class="button button-secondary" data-trip-media="upload" ${!selected.size || !canUpload() ? "disabled" : disabled}>上傳所選檔案</button>
      <input id="trip-media-input" type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,video/webm,video/3gpp,.jpg,.jpeg,.png,.webp,.heic,.heif,.mp4,.mov,.webm,.3gp,.3gpp" hidden />
      <p>每批最多 30 項。相片每張最多 20 MB，影片每段最多 2 GB。</p>
      <p id="trip-media-selection" role="status">已選 ${selected.size} 項</p>
      <p role="status">${escapeHtml(message)}</p>
      ${!ready && !task ? '<button class="button button-secondary" data-trip-media="refresh">重新讀取相簿</button>' : ""}
      ${report.length ? `<ul aria-label="匯入結果">${report.map(result => `<li>${escapeHtml(result)}</li>`).join("")}</ul>` : ""}
      ${ready && !items.length ? "<p>尚未匯入相片或影片。</p>" : ""}
      <ul class="trip-media-list">${items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(item => {
        const label = escapeHtml(item.label);
        return `<li><label><input id="trip-select-${item.id}" type="checkbox" data-trip-select="${item.id}" ${selected.has(item.id) ? "checked" : ""} ${disabled} /> ${label}</label>
          <p>${MEDIA_EXTENSIONS[item.mime].toUpperCase()} · ${displaySize(item.size)}</p>
          <div class="photo-actions">${item.kind === "video" || !isOriginalMedia(item.mime) ? `<button id="trip-preview-${item.id}" class="button button-secondary button-small" data-trip-media="preview" data-id="${item.id}" ${disabled}>${item.kind === "video" ? "播放" : "預覽"}</button>` : "<span>HEIC／HEIF 原檔</span>"}
          <button id="trip-download-${item.id}" class="button button-secondary button-small" data-trip-media="download" data-id="${item.id}" ${disabled}>下載</button>
          <button id="trip-remove-${item.id}" class="button button-secondary button-small" data-trip-media="remove" data-id="${item.id}" ${disabled}>刪除</button></div></li>`;
      }).join("")}</ul>
      ${pageCount > 1 ? `<div class="memory-pagination"><button id="trip-media-prev" class="button button-secondary button-small" data-trip-media="prev" ${!page ? "disabled" : disabled}>上一頁</button><p>第 ${page + 1}／${pageCount} 頁</p><button id="trip-media-next" class="button button-secondary button-small" data-trip-media="next" ${page + 1 >= pageCount ? "disabled" : disabled}>下一頁</button></div>` : ""}
      ${preview ? `<section aria-label="檔案預覽"><button id="trip-media-close-preview" class="button button-secondary" data-trip-media="close-preview">關閉預覽</button>
        ${preview.item.kind === "video" ? `<video controls playsinline preload="metadata" src="${escapeHtml(preview.url)}" aria-label="${escapeHtml(preview.item.label)}"></video>` : `<img src="${escapeHtml(preview.url)}" alt="${escapeHtml(preview.item.label)}" />`}
        <p role="status" data-trip-preview-error hidden>此瀏覽器未能預覽此格式；仍可下載或上傳。</p></section>` : ""}
      ${upload ? '<section id="trip-upload-panel" aria-label="上傳至學校"></section>' : ""}
      <p>${Date.now() >= PHOTO_UPLOAD_DEADLINE ? "學校收相已截止。相簿仍可匯入和播放。" : "收相截止：香港時間 2026-11-09 23:59。"}</p>`;
    if (upload) renderUpload();
    if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  }
  function renderUpload() {
    const panel = root?.querySelector("#trip-upload-panel");
    if (!panel || !upload) return;
    const { rows, running } = upload.client.getModel();
    const done = rows.length > 0 && rows.every(row => row.state === "saved");
    const labels = { queued: "等候上傳", uploading: "正在上傳", saved: "已儲存", failed: "未能確認儲存" };
    panel.innerHTML = `<h3 id="trip-upload-title" tabindex="-1">上傳至學校</h3><p>收相人：bwc-ykl@bwflc.edu.hk · ${upload.items.length} 項</p>
      ${upload.items.some(item => isOriginalMedia(item.mime)) ? "<p><strong>原檔可能包含拍攝地點或日期。</strong>確認後會連原檔內的資料一併傳送。</p>" : ""}
      <p>App 不會附加姓名、班別、學號或打卡資料。離頁會停止傳送，已存入 Drive 的副本會保留。</p>
      <p role="status">${escapeHtml(upload.message || (done ? "全部檔案已獲確認儲存。" : ""))}</p>
      <ul>${rows.map(row => `<li>${escapeHtml(row.name)}：${labels[row.state]}（${Math.floor(100 * row.offset / row.size)}%）${row.error ? `<p>${escapeHtml(row.error)}</p>` : ""}</li>`).join("")}</ul>
      ${upload.preparing && !running && !rows.length ? '<p role="status">正在準備檔案…</p>' : ""}
      ${done || running || upload.preparing ? "" : `<label for="trip-upload-code">固定上傳碼</label><input id="trip-upload-code" type="password" autocomplete="off" spellcheck="false" />
        <button class="button button-primary" data-trip-media="confirm-upload">${rows.length ? "重試未完成檔案" : "確認上傳"}</button>`}
      <button class="button button-secondary" data-trip-media="close-upload">${running ? "停止上傳" : "關閉"}</button>`;
  }
  async function refresh() {
    const operation = begin();
    try {
      const snapshot = await storage.list();
      if (!current(operation)) return;
      items = snapshot.items;
      generation = snapshot.generation;
      ready = true;
      if (message === "正在讀取獨立相簿…") message = "";
      const ids = new Set(items.map(item => item.id));
      for (const id of selected) if (!ids.has(id)) selected.delete(id);
    } catch (error) {
      if (current(operation)) { ready = false; message = describeError(error); }
    } finally {
      if (current(operation)) { task = null; render(); }
    }
  }
  async function importFiles(files) {
    if (task || upload || !ready || !files.length) return;
    if (files.length > MAX_TRIP_MEDIA_BATCH) { message = "每批最多匯入 30 項，請重新選取。"; render(); return; }
    const operation = begin();
    const expectedGeneration = generation;
    report = [];
    closePreview();
    for (const [index, file] of files.entries()) {
      if (!current(operation)) return;
      message = `正在匯入第 ${index + 1}／${files.length} 項…`;
      render();
      const label = file.name.slice(0, 180);
      try {
        const sourceMime = await validateTripMedia(file);
        const blob = isOriginalMedia(sourceMime) ? file : (await photoService.compressPhoto(file.slice(0, file.size, sourceMime))).blob;
        const mime = isOriginalMedia(sourceMime) ? sourceMime : blob.type;
        await storage.save({ label, mime, kind: mediaKind(mime) }, blob, expectedGeneration, operation.signal);
        if (!current(operation)) return;
        report.push(`${label}：已匯入`);
      } catch (error) {
        if (!current(operation)) return;
        report.push(`${label}：${describeError(error)}`);
      }
    }
    if (current(operation)) { message = "匯入處理完成。"; page = 0; await refresh(); }
  }
  async function openFile(action, item) {
    const operation = begin();
    try {
      const stored = await storage.get(item.id);
      if (!current(operation)) return;
      const blob = stored.type === item.mime ? stored : stored.slice(0, stored.size, item.mime);
      const url = URL.createObjectURL(blob);
      if (action === "preview") {
        closePreview();
        preview = { item, url };
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = `${item.kind}-${item.id}.${MEDIA_EXTENSIONS[item.mime]}`;
        root.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
        message = "已開啟下載，請在裝置的下載項目確認。";
      }
    } catch (error) { if (current(operation)) message = describeError(error); }
    finally {
      if (current(operation)) {
        task = null;
        render();
        if (action === "preview" && preview) document.getElementById("trip-media-close-preview")?.focus();
      }
    }
  }
  async function remove(item) {
    const operation = begin();
    const accepted = await askConfirmation({ title: "刪除這個本機檔案？", message: "檔案會從獨立相簿移除。已下載或上傳到 Drive 的副本會保留。", confirmText: "刪除", danger: true, isRelevant: () => current(operation) });
    if (!current(operation)) return;
    if (!accepted) { task = null; return; }
    try {
      if (preview?.item.id === item.id) closePreview();
      await storage.remove(item.id);
      if (current(operation)) message = "已移除本機檔案。";
    } catch (error) { if (current(operation)) message = describeError(error); }
    if (current(operation)) await refresh();
  }
  async function confirmUpload() {
    const session = upload;
    const input = root.querySelector("#trip-upload-code");
    const code = input?.value.trim();
    if (!session || session.preparing || !input) return;
    input.value = "";
    if (!code) { session.message = "請輸入固定上傳碼。"; renderUpload(); return; }
    session.message = "";
    session.preparing = true;
    renderUpload();
    try {
      if (session.client.getModel().rows.length) await session.client.retry(code);
      else {
        const files = [];
        for (const [index, item] of session.items.entries()) {
          const blob = await storage.get(item.id);
          if (upload !== session || !isActive()) return;
          const original = isOriginalMedia(item.mime);
          const mime = original ? item.mime : "image/jpeg";
          const name = `${item.kind}-${index + 1}.${MEDIA_EXTENSIONS[mime]}`;
          files.push({ mime, name, blob: original ? blob : await photoService.createPhotoExport({ blob }, name) });
        }
        if (upload === session && isActive()) await session.client.start(files, code);
      }
    } catch (error) { session.message = describeError(error); }
    finally { session.preparing = false; if (upload === session) renderUpload(); }
  }
  async function click(event) {
    const button = event.target.closest("[data-trip-media]");
    if (!button || !isActive()) return;
    const { tripMedia: action, id } = button.dataset;
    if (action === "close-upload") {
      if (upload?.client.getModel().rows.some(row => row.state !== "saved")) {
        message = "如有檔案未確認儲存，請先向收相人核對 Drive，再重新選取，避免重複。";
      }
      closeUpload(); render(); return;
    }
    if (action === "confirm-upload") { await confirmUpload(); return; }
    if (task || upload) return;
    if (action === "pick") root.querySelector("#trip-media-input").click();
    else if (action === "refresh") { message = ""; await refresh(); }
    else if (action === "close-preview") { closePreview(); render(); }
    else if (action === "prev" || action === "next") { page += action === "prev" ? -1 : 1; render(); }
    else if (action === "upload" && canUpload() && selected.size) {
      closePreview();
      const session = { items: items.filter(item => selected.has(item.id)), message: "" };
      session.client = uploadFactory({ environment, mediaEnabled: true, isCurrent: () => upload === session && isActive(), onChange: renderUpload });
      upload = session;
      render();
      document.getElementById("trip-upload-title")?.focus();
    } else {
      const item = items.find(item => item.id === id);
      if (!item) return;
      if (action === "remove") await remove(item);
      if (action === "preview" || action === "download") await openFile(action, item);
    }
  }
  function change(event) {
    const input = event.target;
    if (!isActive() || !root) return;
    if (input.id === "trip-media-input") {
      const files = [...input.files];
      input.value = "";
      void importFiles(files);
    } else if (input.dataset.tripSelect) {
      const id = input.dataset.tripSelect;
      if (!input.checked) selected.delete(id);
      else if (selected.size < MAX_TRIP_MEDIA_BATCH) selected.add(id);
      else input.checked = false;
      root.querySelector("#trip-media-selection").textContent = `已選 ${selected.size} 項${selected.size === MAX_TRIP_MEDIA_BATCH ? "（已達上限）" : ""}`;
      root.querySelector("#trip-media-upload").disabled = !selected.size || !canUpload();
    }
  }
  function mount(host) {
    if (!host) return;
    if (root) { host.replaceChildren(root); return; }
    root = document.createElement("div");
    root.className = "trip-media-album";
    root.addEventListener("click", click);
    root.addEventListener("change", change);
    root.addEventListener("dragover", event => {
      if (!event.target.closest("[data-trip-drop]") || !Array.from(event.dataTransfer.types).includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = ready && !task && !upload ? "copy" : "none";
    });
    root.addEventListener("drop", event => {
      if (!event.target.closest("[data-trip-drop]") || !event.dataTransfer.files.length) return;
      event.preventDefault();
      if (isActive()) void importFiles([...event.dataTransfer.files]);
    });
    root.addEventListener("error", event => {
      if (["VIDEO", "IMG"].includes(event.target.tagName)) root?.querySelector("[data-trip-preview-error]")?.removeAttribute("hidden");
    }, true);
    host.replaceChildren(root);
    message = "正在讀取獨立相簿…";
    void refresh();
    render();
  }
  return { mount, leave, clear: async () => { leave(); await storage.clear(); } };
}
