import { normalizeCardReflection } from "./card-reflection.js";
import { createPhotoArchive } from "./photo-archive.js";
import { TRIP_DATA } from "./data.js";
import { getAttraction, getDownloadLocationHint } from "./formatting.js";
import { readonlyCopy } from "./store.js";

export function createPhotoActions({
  getCheckIn, getPhoto, getPhotoVersion, canUseAttraction, operations,
  capturePageToken, isPageCurrent, photoService, refreshPhotos, render,
  showToast, askConfirmation, document, window, URL, navigator,
  showPhotoExport = () => {}, hidePhotoExport = () => {}, lookupAttraction = getAttraction
}) {
  const { operationToken, isCurrentOperation, trackPhotoTask } = operations;
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
      delivery: photoExport.delivery,
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
      session.downloadFile = null;
      session.files = [];
      session.records = [];
      session.delivery = null;
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
      attractionId, records, files: [], urls: new Map(), delivery: null, status: "preparing", message: "正在準備 JPEG 相片…",
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
      session.downloadFile = session.files.length === 1 ? session.files[0]
        : await createPhotoArchive(session.files, `${attraction.name}-相片-${session.files.length}張.zip`);
      if (!isExportCurrent(session)) { validatePhotoExport(); return; }
      session.status = "ready";
      session.message = "JPEG 相片已準備好。可一鍵下載全部，或在手機分享選單選擇儲存。";
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
    session.delivery = null;
    if (!canShareFiles(session.files)) {
      session.message = "此瀏覽器未能分享這組相片，請使用下方的一鍵下載按鈕。";
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
      session.message = "相片已交由系統處理；請按下方指引確認儲存位置。";
      session.delivery = { kind: "share", locationHint: "若在分享選單選擇「儲存影像」或儲存到相簿，請到「相片」或「相簿」查看；若選擇「儲存到檔案」，請到你選擇的資料夾查看。若傳送到其他 App，請到該 App 查找。分享結束不代表已儲存，請自行確認。" };
      publishPhotoExport();
    } catch (error) {
      if (!isExportCurrent(session)) { validatePhotoExport(); return; }
      session.status = "ready";
      session.message = error?.name === "AbortError" ? "已取消分享，App 內相片仍然保留。"
        : "未能開啟或完成分享。你可以重試，或使用下方的逐張下載按鈕。";
      publishPhotoExport();
    }
  }
  function downloadPhotoExport(index, all = false) {
    const session = photoExport;
    if (!session || !isExportCurrent(session)) { validatePhotoExport(); return; }
    if (session.status !== "ready" || (!all && (!Number.isSafeInteger(index) || index < 0 || !session.files[index])) || (all && !session.downloadFile)) return;
    session.delivery = null;
    let url;
    try {
      const file = all ? session.downloadFile : session.files[index];
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
      session.message = all ? `已開始下載 ${session.files.length} 張相片${session.files.length > 1 ? "（ZIP 檔）" : ""}。請在瀏覽器下載列表確認是否完成。` : `已開始下載第 ${index + 1} 張相片。請在瀏覽器下載列表確認是否完成。`;
      session.delivery = { kind: "download", filename: file.name, locationHint: getDownloadLocationHint(navigator) + (all && session.files.length > 1 ? " 下載後請解壓 ZIP 檔，再把 JPEG 相片加入相簿。" : "") };
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

  async function downloadTravelCard(attractionId, photoId, reflection = "") {
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
    let cardReflection;
    try { cardReflection = normalizeCardReflection(reflection); }
    catch (error) { showToast(error.message, "warning"); return; }
    const accepted = await askConfirmation({
      title: "下載旅程卡？",
      message: `旅程卡包含照片、景點及打卡時間。${cardReflection ? "你填寫的感想亦會印在卡上，請留意是否包含個人資料。" : "這次不加入感想。"}人樣、校服或背景仍可能透露身份；下載檔案不受 App 的清除資料功能控制。請確認適合保存及分享。`,
      confirmText: "下載", isRelevant: relevant
    });
    if (!accepted || !relevant()) return;
    showToast("正在製作旅程卡…");
    try {
      const blob = await createTravelCard({ photoRecord: record, attraction, checkIn, tripTitle: TRIP_DATA.title, reflection: cardReflection });
      if (!relevant()) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${attraction.name}-旅程卡.png`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast(`旅程卡下載已開始：${link.download}。${getDownloadLocationHint(navigator)} 請在下載列表確認是否完成。`, "default", 15000);
    } catch {
      if (relevant()) showToast("未能製作旅程卡，請稍後再試。", "warning");
    }
  }

  return { processPhoto, downloadTravelCard, preparePhotoExport, sharePhotoExport,
    downloadPhotoExport, downloadAllPhotoExport: () => downloadPhotoExport(null, true), cancelPhotoExport, validatePhotoExport, getPhotoExportModel };
}
