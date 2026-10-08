import { TRIP_DATA } from "./data.js";
import { getAttraction } from "./formatting.js";
import { readonlyCopy } from "./store.js";

export function createPhotoActions({
  getCheckIn, getPhoto, getPhotoVersion, canUseAttraction, operations,
  capturePageToken, isPageCurrent, photoService, refreshPhotos, render,
  showToast, askConfirmation, document, window, URL, navigator,
  showPhotoExport = () => {}, hidePhotoExport = () => {}, lookupAttraction = getAttraction
}) {
  const { operationToken, isCurrentOperation, invalidateAttractionOperations, isCurrentDataGeneration, trackPhotoTask, waitForPhotoTasks } = operations;
  const { compressPhoto, savePhotoRecord, getPhotoRecord, deletePhotoRecord, createTravelCard } = photoService;
  let photoExport = null;

  function isExportCurrent(session) {
    return photoExport === session && isPageCurrent(session.pageToken)
      && canUseAttraction(session.attractionId) && getCheckIn(session.attractionId)
      && isCurrentOperation(session.attractionId, session.token)
      && getPhotoVersion(session.attractionId) === session.version
      && session.records.every(record => {
        const current = getPhoto(session.attractionId, record.photoId);
        return current && (record.writeId ? current.writeId === record.writeId : current.blob === record.blob);
      });
  }
  function canShareFiles(files) {
    try { return Boolean(files.length && navigator?.share && navigator?.canShare?.({ files })); }
    catch { return false; }
  }
  function getPhotoExportModel() {
    if (!photoExport) return null;
    return readonlyCopy({
      status: photoExport.status, message: photoExport.message,
      count: photoExport.records.length, canShare: photoExport.status === "ready" && canShareFiles(photoExport.files),
      files: photoExport.files.map((file, index) => ({ index, name: file.name }))
    });
  }
  function publishPhotoExport() { showPhotoExport(getPhotoExportModel()); }
  function cancelPhotoExport() {
    const session = photoExport;
    photoExport = null;
    if (session) {
      for (const [url, timer] of session.urls) { window.clearTimeout(timer); URL.revokeObjectURL(url); }
      session.urls.clear();
      session.files = [];
      session.records = [];
    }
    hidePhotoExport();
  }
  function validatePhotoExport() {
    if (photoExport && !isExportCurrent(photoExport)) cancelPhotoExport();
  }
  async function preparePhotoExport(attractionId, photoIds) {
    if (!canUseAttraction(attractionId) || !getCheckIn(attractionId) || !Array.isArray(photoIds) || !photoIds.length) return;
    const ids = [...new Set(photoIds)];
    if (ids.some(id => typeof id !== "string" || !id)) return;
    const records = ids.map(id => getPhoto(attractionId, id));
    if (records.some(record => !record)) return;
    const attraction = lookupAttraction(attractionId);
    if (!attraction) return;
    cancelPhotoExport();
    const session = {
      attractionId, records, files: [], urls: new Map(), status: "preparing", message: "正在準備 JPEG 相片…",
      pageToken: capturePageToken(), token: operationToken(attractionId), version: getPhotoVersion(attractionId)
    };
    photoExport = session;
    publishPhotoExport();
    let index = 0;
    try {
      for (const record of records) {
        if (!isExportCurrent(session)) { validatePhotoExport(); return; }
        session.message = `正在準備第 ${index + 1} 張，共 ${records.length} 張…`;
        publishPhotoExport();
        const file = await photoService.createPhotoExport(record, `${attraction.name}-${index + 1}-${record.photoId}.jpg`);
        if (!isExportCurrent(session)) { validatePhotoExport(); return; }
        session.files.push(file);
        index += 1;
      }
      session.status = "ready";
      session.message = "JPEG 相片已準備好。請在手機分享選單選擇儲存；亦可逐張下載。";
      publishPhotoExport();
    } catch (error) {
      if (!isExportCurrent(session)) { validatePhotoExport(); return; }
      session.files = [];
      session.status = "error";
      session.message = `第 ${index + 1} 張相片未能匯出：${error?.message || "圖片處理失敗。"} 這次沒有匯出任何相片；請關閉視窗並重新選取。`;
      publishPhotoExport();
    }
  }
  async function sharePhotoExport() {
    const session = photoExport;
    if (!session || !isExportCurrent(session)) { validatePhotoExport(); return; }
    if (session.status !== "ready") return;
    if (!canShareFiles(session.files)) {
      session.message = "此瀏覽器未能分享這組相片，請使用下方的逐張下載按鈕。";
      publishPhotoExport();
      return;
    }
    try {
      // No awaits before share: this call must retain the final button's user activation.
      const sharing = navigator.share({ files: session.files });
      session.status = "sharing";
      session.message = "手機分享選單正在處理相片…";
      publishPhotoExport();
      await sharing;
      if (!isExportCurrent(session)) { validatePhotoExport(); return; }
      session.status = "ready";
      session.message = "相片已交由系統處理；請自行確認是否已儲存在手機相簿或檔案中。";
      publishPhotoExport();
    } catch (error) {
      if (!isExportCurrent(session)) { validatePhotoExport(); return; }
      session.status = "ready";
      session.message = error?.name === "AbortError" ? "已取消分享，App 內相片仍然保留。"
        : "未能開啟或完成分享。你可以重試，或使用下方的逐張下載按鈕。";
      publishPhotoExport();
    }
  }
  function downloadPhotoExport(index) {
    const session = photoExport;
    if (!session || !isExportCurrent(session)) { validatePhotoExport(); return; }
    if (session.status !== "ready" || !Number.isSafeInteger(index) || index < 0 || !session.files[index]) return;
    let url;
    try {
      const file = session.files[index];
      url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      document.body.append(link);
      link.click();
      link.remove();
      session.urls.set(url, window.setTimeout(() => {
        URL.revokeObjectURL(url); session.urls.delete(url);
      }, 10000));
      session.message = "已開始下載這張相片；檔案可能位於「下載」或「檔案」，請按手機提供的選項移到相簿。";
      publishPhotoExport();
    } catch {
      if (url) URL.revokeObjectURL(url);
      session.message = "未能開始下載，請再試一次。";
      publishPhotoExport();
    }
  }
  async function removeStalePhotoRecord(record) {
    try {
      const saved = await getPhotoRecord(record.attractionId, record.photoId);
      if (saved?.writeId === record.writeId) await deletePhotoRecord(record.attractionId, record.photoId);
    } catch {
      // The coordinating cancellation/reset surfaces failure after waiting for tasks.
    }
  }

  async function processPhotoInternal(input, attractionId, context) {
    const token = context?.dataToken || operationToken(attractionId);
    const pageToken = context?.pageToken || capturePageToken();
    const mayStart = () => isPageCurrent(pageToken) && canUseAttraction(attractionId)
      && isCurrentOperation(attractionId, token) && getCheckIn(attractionId);
    if (!mayStart()) return;
    showToast("正在壓縮相片及移除位置資料…");
    try {
      const record = await compressPhoto(input, attractionId);
      record.writeId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      record.photoId = record.writeId;
      if (!mayStart()) return;
      // The service checks again after opening IndexedDB, immediately before the transaction.
      const savedKey = await savePhotoRecord(record, { canBegin: mayStart });
      if (savedKey === null) return;
      // Leaving a route does not undo a transaction that has already begun.
      if (!isCurrentOperation(attractionId, token) || !getCheckIn(attractionId)) {
        await removeStalePhotoRecord(record);
        return;
      }
      const loaded = await refreshPhotos();
      if (!isCurrentOperation(attractionId, token)) return;
      render();
      if (isPageCurrent(pageToken)) {
        showToast(loaded ? "紀念照已保存在這部裝置。" : "紀念照已保存，但暫時未能讀回預覽，請重新開啟頁面。", loaded ? "success" : "warning");
      }
    } catch (error) {
      if (!isCurrentOperation(attractionId, token) || !isPageCurrent(pageToken)) return;
      const quotaMessage = error?.name === "QuotaExceededError" ? "裝置儲存空間不足，未能保存相片。" : error?.message;
      showToast(quotaMessage || "未能處理相片，請再試一次。", "warning");
    }
  }

  function processPhoto(input, attractionId, context) {
    return trackPhotoTask(attractionId, processPhotoInternal(input, attractionId, context));
  }

  async function removePhoto(attractionId, photoId) {
    if (!canUseAttraction(attractionId) || !getCheckIn(attractionId)) return;
    if (photoId && !getPhoto(attractionId, photoId)) return;
    const pageToken = capturePageToken();
    const token = operationToken(attractionId);
    const relevant = () => isPageCurrent(pageToken) && isCurrentOperation(attractionId, token) && canUseAttraction(attractionId);
    const accepted = await askConfirmation({ title: "刪除紀念照？", message: "這會刪除 App 內的相片副本，無法復原；已匯出到相簿、下載或分享的相片不會被刪除。", confirmText: "刪除照片", danger: true, isRelevant: relevant });
    if (!accepted || !relevant()) return;
    cancelPhotoExport();
    const dataToken = operations.generation;
    invalidateAttractionOperations(attractionId);
    await waitForPhotoTasks(attractionId);
    if (!isCurrentDataGeneration(dataToken) || !isPageCurrent(pageToken) || !canUseAttraction(attractionId)) return;
    try {
      await deletePhotoRecord(attractionId, photoId);
    } catch {
      if (!isCurrentDataGeneration(dataToken)) return;
      await refreshPhotos();
      render();
      if (isPageCurrent(pageToken)) showToast("未能刪除紀念照；它仍保存在這部裝置，請再試一次。", "warning");
      return;
    }
    if (!isCurrentDataGeneration(dataToken)) return;
    await refreshPhotos();
    if (!isCurrentDataGeneration(dataToken)) return;
    render();
    if (isPageCurrent(pageToken)) showToast("紀念照已刪除。 ");
  }

  async function downloadTravelCard(attractionId, photoId) {
    if (!canUseAttraction(attractionId)) return;
    const record = getPhoto(attractionId, photoId);
    const version = getPhotoVersion(attractionId);
    const attraction = lookupAttraction(attractionId);
    const checkIn = getCheckIn(attractionId);
    if (!record || !attraction || !checkIn) return;
    const token = operationToken(attractionId);
    const pageToken = capturePageToken();
    const relevant = () => isPageCurrent(pageToken) && isCurrentOperation(attractionId, token)
      && canUseAttraction(attractionId) && getPhotoVersion(attractionId) === version && getPhoto(attractionId, photoId);
    const accepted = await askConfirmation({
      title: "下載旅程卡？",
      message: "旅程卡包含照片、景點及打卡時間。人樣、校服或背景仍可能透露身份；下載檔案不受 App 的清除資料功能控制。請確認適合保存及分享。",
      confirmText: "下載", isRelevant: relevant
    });
    if (!accepted || !relevant()) return;
    showToast("正在製作旅程卡…");
    try {
      const blob = await createTravelCard({ photoRecord: record, attraction, checkIn, tripTitle: TRIP_DATA.title });
      if (!relevant()) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${attraction.name}-旅程卡.png`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("旅程卡下載已開始。", "success");
    } catch {
      if (relevant()) showToast("未能製作旅程卡，請稍後再試。", "warning");
    }
  }

  return { processPhoto, removePhoto, downloadTravelCard, preparePhotoExport, sharePhotoExport,
    downloadPhotoExport, cancelPhotoExport, validatePhotoExport, getPhotoExportModel };
}
