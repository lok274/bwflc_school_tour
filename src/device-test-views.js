import { DEVICE_TEST_LOCATION } from "./device-test-data.js";
import { escapeHtml, formatDateTime } from "./formatting.js";
import { formatDistance } from "./geo.js";

export function renderDeviceTest({ secure, gpsSupported, cameraSupported, checkIn, gpsResult, gpsBusy, cameraResult, photo, photoBusy, resetting, storageWarning }) {
  const { id, address, geo, mapUrl, sourceUrl } = DEVICE_TEST_LOCATION;
  const gpsLabels = { verified: "GPS 在範圍內", "too-far": "尚未進入打卡範圍", inaccurate: "定位誤差太大，未能核實", error: "未能取得位置", unsupported: "位置功能不支援" };
  const cameraLabels = { opening: "正在要求相機權限…", ready: "相機已啟動，可拍攝、重拍及保存", unsupported: "相機功能不支援，已改用相簿", error: "相機未能開啟，已改用相簿" };
  const resultText = gpsResult ? gpsLabels[gpsResult.status] : "尚未要求位置權限";
  const measured = Number.isFinite(gpsResult?.distance) ? `距離測試點約 ${formatDistance(gpsResult.distance)}；定位誤差約 ${Number.isFinite(gpsResult.accuracy) ? Math.round(gpsResult.accuracy) + " 米" : "未提供"}。` : gpsResult?.reason || "";
  return `<section class="page-shell device-test-page">
    <header class="view-heading"><p class="eyebrow">真實裝置測試</p><h1>打卡與相機測試</h1><p>先在測試點附近按下打卡，再試拍一張相片。相機也可獨立測試，毋須先打卡。</p></header>
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
      </section>
      <section class="device-test-panel" aria-labelledby="camera-test-title"><p class="eyebrow">02 · 拍攝與本機保存</p><h2 id="camera-test-title">實際相機</h2>
        <p id="camera-result" role="status">${escapeHtml(cameraLabels[cameraResult?.status] || "尚未要求相機權限")}</p>
        ${cameraResult?.errorName === "NotAllowedError" ? "<p>請在瀏覽器的網站設定允許相機，然後再試。</p>" : ""}
        <div class="photo-actions"><button type="button" class="button button-primary" id="test-camera-button" data-camera-open="${id}" ${!secure || resetting || photoBusy ? "disabled" : ""}>測試相機</button>
          <button type="button" class="button button-secondary" id="test-gallery-button" data-gallery-open="${id}" ${resetting || photoBusy ? "disabled" : ""}>從相簿測試保存</button></div>
        <p class="privacy-note">${cameraSupported ? "要求後置鏡頭，不使用麥克風。" : "此瀏覽器不支援即時相機，可用相簿測試保存。"} 從相簿選相成功，只能證明保存功能正常。</p>
        <p id="photo-result" role="status">${photoBusy ? "正在壓縮及保存測試相片…" : photo ? `已從測試資料庫讀回：${escapeHtml(photo.width)} × ${escapeHtml(photo.height)}，${escapeHtml(photo.mime)}。` : "尚未保存測試相片。"}</p>
        ${photo ? `<img class="device-test-photo" src="${escapeHtml(photo.url)}" alt="已保存的測試相片" /><button type="button" class="button button-danger" data-photo-delete="${id}" ${resetting || photoBusy ? "disabled" : ""}>刪除測試相片</button>` : ""}
      </section>
    </div>
    <section class="device-test-location"><h2>只清除測試紀錄</h2><p>這個頁面的打卡與相片分開保存，不會加入五站景點或影響準備清單。原始座標不會保存，相片不會上傳；相機關閉或離頁便會停止。</p>
      <button type="button" class="button button-danger" id="test-reset-button" data-reset-test ${resetting ? "disabled" : ""}>${resetting ? "正在清除…" : "清除測試打卡與相片"}</button><p class="privacy-note">測試資料仍使用同一網站的瀏覽器儲存邊界，沒有額外加密。正式 App 的清除功能不會清除這裡的測試資料。</p>
    </section>
    <a class="text-link" href="./#home">返回旅程首頁 →</a>
  </section>`;
}
