import { TRIP_DATA } from "./data.js";
import { getAttraction } from "./formatting.js";

export function createPhotoActions({
  getCheckIn, getPhoto, getPhotoVersion, canUseAttraction, operations,
  capturePageToken, isPageCurrent, photoService, refreshPhotos, render,
  showToast, askConfirmation, document, window, URL
}) {
  const { operationToken, isCurrentOperation, invalidateAttractionOperations, isCurrentDataGeneration, trackPhotoTask, waitForPhotoTasks } = operations;
  const { compressPhoto, savePhotoRecord, getPhotoRecord, deletePhotoRecord, createTravelCard } = photoService;
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
    const accepted = await askConfirmation({ title: "刪除紀念照？", message: "照片只存在這部裝置，刪除後無法復原。", confirmText: "刪除照片", danger: true, isRelevant: relevant });
    if (!accepted || !relevant()) return;
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
    const attraction = getAttraction(attractionId);
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

  return { processPhoto, removePhoto, downloadTravelCard };
}
