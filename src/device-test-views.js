import { DEVICE_TEST_LOCATION } from "./device-test-data.js";
import { escapeHtml, formatDateTime } from "./formatting.js";
import { formatDistance } from "./geo.js";
import { renderCheckInCompletion } from "./views.js";
import { SUMMARY_IDENTITY_LIMITS } from "./card-reflection.js";

export function renderDeviceTest({ secure, gpsSupported, cameraSupported, checkIn, allCheckInsComplete, gpsResult, gpsBusy, cameraResult, photo, photos = [], photoBusy, resetting, storageWarning, booklet, aiWork = { studentName: "", className: "", studentNumber: "", selectedCount: 0, missingIdentity: ["姓名", "班別", "學號"] } }) {
  const { id, address, geo, mapUrl, sourceUrl } = DEVICE_TEST_LOCATION;
  const gpsLabels = { verified: "GPS 在範圍內", "too-far": "尚未進入打卡範圍", inaccurate: "定位誤差太大，未能核實", error: "未能取得位置", unsupported: "位置功能不支援" };
  const cameraLabels = { native: "已要求手機拍攝介面；確認照片後才會保存。", opening: "正在要求網頁相機權限…", ready: "網頁相機已啟動，可拍攝、重拍及保存", unsupported: "網頁相機功能不支援，請使用手機相機拍攝", error: "網頁相機未能開啟，請檢查權限或使用手機相機拍攝" };
  const hasCameraSize = cameraResult?.status === "ready" && Number.isSafeInteger(cameraResult.width) && cameraResult.width > 0 && Number.isSafeInteger(cameraResult.height) && cameraResult.height > 0;
  const cameraSize = hasCameraSize ? `；實際影像 ${cameraResult.width} × ${cameraResult.height} 像素` : "";
  const lowResolution = hasCameraSize && Math.max(cameraResult.width, cameraResult.height) < 1280;
  const resultText = gpsResult ? gpsLabels[gpsResult.status] : "尚未要求位置權限";
  const measured = Number.isFinite(gpsResult?.distance) ? `距離測試點約 ${formatDistance(gpsResult.distance)}；定位誤差約 ${Number.isFinite(gpsResult.accuracy) ? Math.round(gpsResult.accuracy) + " 米" : "未提供"}。` : gpsResult?.reason || "";
  return `<section class="page-shell device-test-page">
    <header class="view-heading"><p class="eyebrow">真實裝置測試</p><h1>打卡與相機測試</h1><p>先在測試點附近按下打卡，再試拍相片。可連續拍攝多張相片，相機也可獨立測試，毋須先打卡。</p></header>
    <section class="device-test-location" aria-labelledby="test-location-title"><p class="eyebrow">測試位置</p><h2 id="test-location-title">${escapeHtml(address)}</h2>
      <p>基本範圍 ${geo.radiusM} 米；沿用正式打卡的定位誤差判定。室內定位可能不準，可移至戶外再試。</p>
      <details><summary>查看目標座標及來源</summary><p>WGS84：${geo.lat}, ${geo.lng}。此座標是地址位置，與 Google Maps 搜尋網址的地圖中心不同。</p><a href="${sourceUrl}" target="_blank" rel="noopener noreferrer">政府地址來源</a></details>
      <a class="text-link" href="${mapUrl}" target="_blank" rel="noopener noreferrer">在 Google Maps 查看測試點 ↗</a>
    </section>
    ${!secure ? `<p class="device-test-warning" role="alert">目前連線不安全，請用 HTTPS 網址或本機 localhost 開啟。手機不能透過一般 HTTP 區域網絡網址使用 GPS 或相機。</p>` : ""}
    ${storageWarning ? `<p class="device-test-warning" role="alert">${escapeHtml(storageWarning)}</p>` : ""}
    <div class="device-test-grid">
      <section class="device-test-panel" aria-labelledby="gps-test-title"><p class="eyebrow">01 · 位置權限與範圍</p><h2 id="gps-test-title">實際打卡</h2>
        <p id="gps-result" role="status">${gpsBusy ? "正在取得位置…" : escapeHtml(resultText)}</p><p>${escapeHtml(measured)}</p>
        ${checkIn ? `<p class="status-badge ${checkIn.verified ? "status-verified" : "status-manual"}">${checkIn.verified ? "GPS 已核實" : "手動記錄 · 未核實"}</p><p>上次打卡：${escapeHtml(formatDateTime(checkIn.checkedInAt))}</p>` : ""}
        <button type="button" class="button button-primary" id="test-gps-button" data-checkin="${id}" ${!secure || gpsBusy || resetting ? "disabled" : ""} ${gpsBusy ? 'aria-busy="true"' : ""}>${checkIn ? "重新定位並打卡" : "測試 GPS 打卡"}</button>
        <p class="privacy-note">${gpsSupported ? "每次按鈕只取得一次位置；再次打卡會更新這個測試紀錄。" : "此瀏覽器不支援 GPS；手動記錄不能證明定位成功。"} 定位不準或未獲權限時，可另作未核實手動記錄。</p>
        ${allCheckInsComplete ? `<div class="device-completion-preview">${renderCheckInCompletion(true)}<p class="privacy-note">測試預覽：只代表此測試點打卡完成，不代表正式五個景點行程已完成。</p></div>` : ""}
      </section>
      <section class="device-test-panel" aria-labelledby="camera-test-title"><p class="eyebrow">02 · 拍攝與本機保存</p><h2 id="camera-test-title">實際相機</h2>
        <p id="camera-result" role="status">${escapeHtml((cameraLabels[cameraResult?.status] || "尚未要求相機權限") + cameraSize)}</p>
        ${lowResolution ? "<p>目前相機影像解像度較低。若需要較清晰的照片，可改用「用手機相機拍攝」。</p>" : ""}
        ${cameraResult?.errorName === "NotAllowedError" ? "<p>請在瀏覽器的網站設定允許相機，然後再試。</p>" : ""}
        <div class="photo-actions"><button type="button" class="button button-primary" id="test-native-camera-button" data-native-camera-open="${id}" ${resetting || photoBusy ? "disabled" : ""}>用手機相機拍攝</button>
          <button type="button" class="button button-secondary" id="test-camera-button" data-camera-open="${id}" ${!secure || resetting || photoBusy ? "disabled" : ""}>測試網頁相機</button></div>
        <p class="privacy-note">手機拍攝的比例由手機相機設定；瀏覽器可能先顯示拍攝或選相介面。${cameraSupported ? "網頁相機優先要求高清後置鏡頭，不使用麥克風。" : "此瀏覽器不支援網頁相機，可用手機相機拍攝。"} 保存照片維持原比例，最長邊 1600 像素，不會放大小圖。保存成功不代表網頁相機權限已獲准。</p>
        <p id="photo-result" role="status">${photoBusy ? "正在壓縮及保存測試相片…" : photo ? `已從測試資料庫讀回：${escapeHtml(photo.width)} × ${escapeHtml(photo.height)}，${escapeHtml(photo.mime)}。` : "尚未保存測試相片。"}</p>
        <p class="privacy-note">支援靜態 JPEG、PNG、WebP；HEIC／HEIF 請先轉成 JPEG。每張最多 20MB、寬高 8192px、5000 萬像素；超限請先縮小。</p>
        ${photos.length ? `<p>已保存 ${photos.length} 張測試相片。匯出後 App 內副本仍會保留。</p>
          <div class="photo-actions">
            <button type="button" class="button button-secondary" id="test-photo-select-all" data-photo-select-all="${id}" ${resetting || photoBusy || aiWork.busy ? "disabled" : ""}>選取全部</button>
            <button type="button" class="button button-secondary" id="test-photo-select-none" data-photo-select-none="${id}" ${resetting || photoBusy || aiWork.busy ? "disabled" : ""}>取消選取</button>
            <button type="button" class="button button-primary" id="test-photo-export-selected" data-photo-export-selected="${id}" ${resetting || photoBusy || !photos.some(item => item.selected) ? "disabled" : ""}>儲存到手機</button>
          </div>
          <p class="privacy-note">「儲存到手機」會先準備 JPEG，再由你開啟系統分享選單選擇儲存。也可一鍵下載（多張合成 ZIP，解壓後可加入相簿）；下載檔可能在「下載」或「檔案」，不一定直接進入相簿。</p>
          <div class="photo-gallery">${photos.map((item, index) => `<article class="photo-entry">
            <label class="photo-selection"><input type="checkbox" id="test-photo-select-${escapeHtml(item.photoId)}" data-photo-select="${escapeHtml(item.photoId)}" ${item.selected ? "checked" : ""} ${resetting || photoBusy || aiWork.busy ? "disabled" : ""}>選取第 ${index + 1} 張相片</label>
            <img class="device-test-photo" src="${escapeHtml(item.url)}" alt="已保存的第 ${index + 1} 張測試相片" />
          </article>`).join("")}</div>` : ""}
      </section>
    </div>
    <section class="device-test-location" aria-labelledby="device-ai-heading"><p class="eyebrow">03 · AI 融合圖片作品</p><h2 id="device-ai-heading">測試 AI 素材包</h2>
      <p>先在上方相片區勾選 5 或 6 張不同測試相片，填妥姓名、班別及學號，再下載 JPEG 相片及中文生成指令。解壓 ZIP 後，到你使用、支援多張參考相片的 AI 工具製作融合圖片。</p>
      <p class="privacy-note">相片來自獨立測試資料庫，毋須 GPS 打卡；這不是正式五景點的課業素材或到訪證明。</p>
      <p>已選 ${aiWork.selectedCount} 張測試相片</p>
      <div class="summary-identity">${[["studentName", "姓名"], ["className", "班別"], ["studentNumber", "學號"]].map(([field, label]) => `<div><label for="device-ai-${field}">${label}（必填）</label><input id="device-ai-${field}" type="text" required data-device-ai-field="${field}" value="${escapeHtml(aiWork[field] || "")}" autocomplete="off" aria-describedby="device-ai-${field}-hint device-ai-draft" ${aiWork.busy || resetting ? "disabled" : ""} /><p id="device-ai-${field}-hint">${Array.from(aiWork[field] || "").length}／${SUMMARY_IDENTITY_LIMITS[field]} 字</p></div>`).join("")}</div>
      <p id="device-ai-draft" class="privacy-note">三項資料會加入生成指令。網站只在目前頁面保留草稿，不寫入儲存或上傳；你把素材交給 AI 工具時，該工具會收到。離頁、重載或清除測試資料後，草稿會清除。</p>
      <p id="device-ai-requirements" aria-live="polite">${aiWork.missingIdentity.length ? `請填寫${aiWork.missingIdentity.map(escapeHtml).join("、")}。` : [5, 6].includes(aiWork.selectedCount) ? "資料已齊全，可以下載測試素材包。" : "請先勾選 5 或 6 張不同的測試相片。"}</p>
      <button id="device-ai-download" class="button button-accent" data-device-ai-download aria-describedby="device-ai-requirements" ${aiWork.canDownload ? "" : "disabled"}>${aiWork.busy ? "正在準備…" : "下載測試 AI 素材包 ZIP"}</button>
      ${booklet ? `<p><a class="text-link" href="${escapeHtml(booklet.url)}" download="${escapeHtml(booklet.filename)}">下載團刊 PDF</a></p>` : ""}
    </section>
    <section class="device-test-location"><h2>只清除測試紀錄</h2><p>這個頁面的打卡與相片分開保存，不會影響正式景點的打卡紀錄及相片。原始座標不會保存，相片不會上傳；相機關閉或離頁便會停止。</p>
      <button type="button" class="button button-danger" id="test-reset-button" data-reset-test ${resetting ? "disabled" : ""}>${resetting ? "正在清除…" : "清除測試打卡與相片"}</button><p class="privacy-note">測試資料仍使用同一網站的瀏覽器儲存邊界，沒有額外加密。正式 App 的清除功能不會清除這裡的測試資料。</p>
    </section>
    <a class="text-link" href="./#home">返回旅程首頁 →</a>
  </section>`;
}
