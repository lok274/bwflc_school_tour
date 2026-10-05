import { TRIP_DATA } from "./data.js";
import { getAttraction } from "./formatting.js";

export function createPhotoActions({
  getModel, isResetting, operations, photoService, refreshPhotos, render,
  showToast, askConfirmation, document, window, URL
}) {
  const { operationToken, isCurrentOperation, invalidateAttractionOperations, isCurrentDataGeneration, trackPhotoTask, waitForPhotoTasks } = operations;
  const { compressPhoto, savePhotoRecord, getPhotoRecord, deletePhotoRecord, createTravelCard } = photoService;
  async function removeStalePhotoRecord(record) {
    try {
      const saved = await getPhotoRecord(record.attractionId);
      if (saved?.writeId === record.writeId) await deletePhotoRecord(record.attractionId);
    } catch {
      // The caller that invalidated this operation will surface a deletion failure
      // or perform the final database clear after this task settles.
    }
  }

  async function processPhotoInternal(input, attractionId) {
    const token = operationToken(attractionId);
    if (!isCurrentOperation(attractionId, token) || !getModel().state.checkIns[attractionId]) return;
    showToast("正在壓縮相片及移除位置資料…");
    try {
      const record = await compressPhoto(input, attractionId);
      record.writeId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      if (!isCurrentOperation(attractionId, token) || !getModel().state.checkIns[attractionId]) return;
      await savePhotoRecord(record);
      if (!isCurrentOperation(attractionId, token) || !getModel().state.checkIns[attractionId]) {
        await removeStalePhotoRecord(record);
        return;
      }
      await refreshPhotos();
      render();
      showToast("紀念照已安全保存在這部裝置。", "success");
    } catch (error) {
      if (!isCurrentOperation(attractionId, token)) return;
      const quotaMessage = error?.name === "QuotaExceededError" ? "裝置儲存空間不足，未能保存相片。" : error?.message;
      showToast(quotaMessage || "未能處理相片，請再試一次。", "warning");
    }
  }

  function processPhoto(input, attractionId) {
    return trackPhotoTask(attractionId, processPhotoInternal(input, attractionId));
  }

  async function removePhoto(attractionId) {
    if (isResetting() || !getModel().state.checkIns[attractionId]) return;
    const accepted = await askConfirmation({ title: "刪除紀念照？", message: "照片只存在這部裝置，刪除後無法復原。", confirmText: "刪除照片", danger: true });
    if (!accepted) return;
    const dataToken = operations.generation;
    invalidateAttractionOperations(attractionId);
    await waitForPhotoTasks(attractionId);
    if (!isCurrentDataGeneration(dataToken)) return;
    try {
      await deletePhotoRecord(attractionId);
    } catch {
      if (!isCurrentDataGeneration(dataToken)) return;
      await refreshPhotos();
      render();
      showToast("未能刪除紀念照；它仍保存在這部裝置，請再試一次。", "warning");
      return;
    }
    if (!isCurrentDataGeneration(dataToken)) return;
    await refreshPhotos();
    render();
    showToast("紀念照已刪除。 ");
  }

  async function downloadTravelCard(attractionId) {
    const record = getModel().photoRecords.get(attractionId);
    const attraction = getAttraction(attractionId);
    const checkIn = getModel().state.checkIns[attractionId];
    if (isResetting() || !record || !attraction || !checkIn) return;
    const token = operationToken(attractionId);
    const accepted = await askConfirmation({
      title: "下載旅程卡？",
      message: "旅程卡包含照片、景點及打卡時間。人樣、校服或背景仍可能透露身份；下載檔案不受 App 的清除資料功能控制。請確認適合保存及分享。",
      confirmText: "下載",
      isRelevant: () => isCurrentOperation(attractionId, token)
    });
    if (!accepted || !isCurrentOperation(attractionId, token) || getModel().photoRecords.get(attractionId) !== record) return;
    showToast("正在製作旅程卡…");
    try {
      const blob = await createTravelCard({ photoRecord: record, attraction, checkIn, tripTitle: TRIP_DATA.title });
      if (!isCurrentOperation(attractionId, token) || getModel().photoRecords.get(attractionId) !== record) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${attraction.name}-旅程卡.png`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("旅程卡已下載。", "success");
    } catch {
      showToast("未能製作旅程卡，請稍後再試。", "warning");
    }
  }

  return { processPhoto, removePhoto, downloadTravelCard };
}
