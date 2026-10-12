import { AI_PHOTO_COUNTS, REQUIRED_CHECK_IN_LOCATIONS } from "./data.js";
import { DEVICE_TEST_LOCATION } from "./device-test-data.js";
import { escapeHtml, formatSmallCount, formatDateTime } from "./formatting.js";
import { formatDistance } from "./geo.js";
import { createViewComponents } from "./view-components.js";

export function renderDeviceTest({ secure, gpsSupported, cameraSupported, checkIn, allCheckInsComplete, gpsResult, gpsBusy, cameraResult, photo, photos = [], photoBusy, resetting, storageWarning, booklet, aiWork = { selectedCount: 0, busy: false, canDownload: false } }) {
  const { viewHeading } = createViewComponents({ testOnly: true });
  const { id, address, geo, mapUrl, sourceUrl } = DEVICE_TEST_LOCATION;
  const gpsLabels = { verified: "位置在範圍內", "too-far": "尚未進入打卡範圍", inaccurate: "定位誤差太大，未能核實", error: "未能取得位置", unsupported: "位置功能不支援" };
  const cameraLabels = { native: "確認相片後才會保存。", opening: "正在要求相機權限…", ready: "網頁相機已啟動", unsupported: "網頁相機不受支援，請用手機相機。", error: "相機未能開啟，請檢查權限或用手機相機。" };
  const hasCameraSize = cameraResult?.status === "ready" && Number.isSafeInteger(cameraResult.width) && cameraResult.width > 0 && Number.isSafeInteger(cameraResult.height) && cameraResult.height > 0;
  const cameraSize = hasCameraSize ? `；實際影像 ${cameraResult.width} × ${cameraResult.height} 像素` : "";
  const lowResolution = hasCameraSize && Math.max(cameraResult.width, cameraResult.height) < 1280;
  const resultText = gpsResult ? gpsLabels[gpsResult.status] : "尚未要求位置權限";
  const measured = Number.isFinite(gpsResult?.distance) ? `距離測試點約 ${formatDistance(gpsResult.distance)}；定位誤差約 ${Number.isFinite(gpsResult.accuracy) ? Math.round(gpsResult.accuracy) + " 米" : "未提供"}。` : gpsResult?.reason || "";
  return `<section class="page-shell device-test-page">
    ${viewHeading("打卡與相機測試")}
    <section class="device-test-location" aria-labelledby="test-location-title"><h2 id="test-location-title">${escapeHtml(address)}</h2>
      <p>請在 ${geo.radiusM} 米範圍內測試；定位不準時可移至戶外。</p>
      <details><summary>位置來源</summary><p>座標：${geo.lat}, ${geo.lng}</p><a href="${sourceUrl}" target="_blank" rel="noopener noreferrer">政府地址來源</a></details>
      <a class="text-link" href="${mapUrl}" target="_blank" rel="noopener noreferrer">在 Google Maps 查看測試點 ↗</a>
    </section>
    ${!secure ? `<p class="device-test-warning" role="alert">請用 https:// 開頭的網站網址開啟，才能使用定位及網頁相機。</p>` : ""}
    ${storageWarning ? `<p class="device-test-warning" role="alert">${escapeHtml(storageWarning)}</p>` : ""}
    <div class="device-test-grid">
      <section class="device-test-panel" aria-labelledby="gps-test-title"><h2 id="gps-test-title">實際打卡</h2>
        <p id="gps-result" role="status">${gpsBusy ? "正在取得位置…" : escapeHtml(resultText)}</p><p>${escapeHtml(measured)}</p>
        ${checkIn ? `<p class="status-badge ${checkIn.verified ? "status-verified" : "status-manual"}">${checkIn.verified ? "定位已核實" : "手動記錄 · 未核實"}</p><p>上次打卡：${escapeHtml(formatDateTime(checkIn.checkedInAt))}</p>` : ""}
        <button type="button" class="button button-primary" id="test-gps-button" data-checkin="${id}" ${!secure || gpsBusy || resetting ? "disabled" : ""} ${gpsBusy ? 'aria-busy="true"' : ""}>${checkIn ? "重新定位並打卡" : "測試定位打卡"}</button>
        <p class="privacy-note">${gpsSupported ? "每次只讀取一次位置，再次打卡會更新紀錄。" : "定位不受支援，手動記錄會標示未核實。"}</p>
        ${allCheckInsComplete ? `<div class="device-completion-preview"><div class="checkin-completion" role="status" aria-live="polite" aria-atomic="true"><p>已完成這個測試點打卡</p></div><p class="privacy-note">測試紀錄，不代表正式${formatSmallCount(REQUIRED_CHECK_IN_LOCATIONS.length)}個景點行程已完成。</p></div>` : ""}
      </section>
      <section class="device-test-panel" aria-labelledby="camera-test-title"><h2 id="camera-test-title">實際相機</h2>
        <p id="camera-result" role="status">${escapeHtml((cameraLabels[cameraResult?.status] || "尚未要求相機權限") + cameraSize)}</p>
        ${lowResolution ? "<p>影像較模糊，可改用手機相機。</p>" : ""}
        ${cameraResult?.errorName === "NotAllowedError" ? "<p>請在瀏覽器的網站設定允許相機，然後再試。</p>" : ""}
        <div class="photo-actions"><button type="button" class="button button-primary" id="test-native-camera-button" data-native-camera-open="${id}" ${resetting || photoBusy ? "disabled" : ""}>用手機相機拍攝</button>
          <button type="button" class="button button-secondary" id="test-camera-button" data-camera-open="${id}" ${!secure || resetting || photoBusy ? "disabled" : ""}>測試網頁相機</button></div>
        ${!cameraSupported && cameraResult?.status !== "unsupported" ? '<p class="privacy-note">網頁相機不受支援，請用手機相機拍攝。</p>' : ""}
        <p id="photo-result" role="status">${photoBusy ? "正在保存測試相片…" : photo ? `已保存並讀回相片：${escapeHtml(photo.width)} × ${escapeHtml(photo.height)}。` : "尚未保存測試相片。"}</p>
        ${photos.length ? `<p>已保存 ${photos.length} 張測試相片。</p>
          <div class="photo-actions">
            <button type="button" class="button button-secondary" id="test-photo-select-all" data-photo-select-all="${id}" ${resetting || photoBusy || aiWork.busy ? "disabled" : ""}>選取全部</button>
            <button type="button" class="button button-secondary" id="test-photo-select-none" data-photo-select-none="${id}" ${resetting || photoBusy || aiWork.busy ? "disabled" : ""}>取消選取</button>
            <button type="button" class="button button-primary" id="test-photo-export-selected" data-photo-export-selected="${id}" ${resetting || photoBusy || !photos.some(item => item.selected) ? "disabled" : ""}>儲存到手機</button>
          </div>
          <div class="photo-gallery">${photos.map((item, index) => `<article class="photo-entry">
            <label class="photo-selection"><input type="checkbox" id="test-photo-select-${escapeHtml(item.photoId)}" data-photo-select="${escapeHtml(item.photoId)}" ${item.selected ? "checked" : ""} ${resetting || photoBusy || aiWork.busy ? "disabled" : ""}>選取第 ${index + 1} 張相片</label>
            <img class="device-test-photo" src="${escapeHtml(item.url)}" alt="已保存的第 ${index + 1} 張測試相片" />
          </article>`).join("")}</div>` : ""}
      </section>
    </div>
    <section class="device-test-location" aria-labelledby="device-ai-heading"><h2 id="device-ai-heading">測試 AI 素材包</h2>
      <p>下載後解壓，到支援多張相片的 AI 工具製作圖片。</p>
      <p class="privacy-note">只用測試相片，毋須打卡，不作正式課業或到訪證明。</p>
      <p>已選 ${aiWork.selectedCount} 張測試相片</p>
      <p id="device-ai-requirements" aria-live="polite">${AI_PHOTO_COUNTS.includes(aiWork.selectedCount) ? "可以下載。" : `請選 ${AI_PHOTO_COUNTS.join(" 或 ")} 張不同的測試相片。`}</p>
      <button id="device-ai-download" class="button button-accent" data-device-ai-download aria-describedby="device-ai-requirements" ${aiWork.canDownload ? "" : "disabled"}>${aiWork.busy ? "正在準備…" : "下載測試 AI 素材包"}</button>
      <button id="device-artwork-open" class="button button-primary" data-artwork-open ${resetting ? "disabled" : ""}>為 AI 成品加上署名</button>
      ${booklet ? `<p><a class="text-link" href="${escapeHtml(booklet.url)}" download="${escapeHtml(booklet.filename)}">下載團刊</a></p>` : ""}
    </section>
    <section class="device-test-location"><h2>只清除測試紀錄</h2><p>清除後無法復原，正式資料及已下載檔案會保留。</p>
      <button type="button" class="button button-danger" id="test-reset-button" data-reset-test ${resetting ? "disabled" : ""}>${resetting ? "正在清除…" : "清除測試打卡與相片"}</button><p class="privacy-note">測試資料沒有額外加密，同一網站的其他頁面可讀取。位置不保存，相片不會上傳；正式 App 的清除功能不會清除這裏的測試資料。</p>
    </section>
    <a class="text-link" href="./#home">返回旅程首頁 →</a>
  </section>`;
}
