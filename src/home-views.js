import { escapeHtml } from "./formatting.js";
import { createViewComponents } from "./view-components.js";

export function createHomeViews({ testOnly = false } = {}) {
  const { viewHeading } = createViewComponents({ testOnly });
  function renderPush(push = {}) {
    return `<section class="content-section push-section" aria-labelledby="push-heading">
      <div class="push-heading"><h2 id="push-heading">手機通知</h2></div>
      <p>開啟後，老師發佈公告時可收到手機通知。App 不保留公告歷史列表。</p>
      <p>通知可顯示在鎖定畫面。iPhone 須先把 App 加入主畫面，再開啟通知。</p>
      <p>訂閱會向推送服務傳送此裝置的通知地址及加密金鑰，並不傳送相片、位置或打卡紀錄。為防止濫用，後台也會短暫保留連線識別資料。</p>
      <p id="push-status" class="push-status" role="status" aria-live="polite">${escapeHtml(push.statusMessage || "訊息通知暫未開放。")}</p>
      <div class="push-actions">
        <button id="push-enable" class="button button-primary" data-push-enable ${push.canEnable ? "" : "disabled"}>${push.subscribed && !push.serverRegistered ? "重試開啟通知" : "開啟手機通知"}</button>
        <button id="push-disable" class="button button-secondary" data-push-disable ${push.canDisable ? "" : "disabled"}>關閉通知</button>
      </div>
    </section>`;
  }

  function renderBooklet(booklet) {
    if (!booklet) return "";
    return `<section class="content-section booklet-section" aria-label="團刊 PDF">
      <div class="booklet-actions"><a class="button button-secondary" href="${escapeHtml(booklet.url)}" target="_blank" rel="noopener noreferrer">查看團刊 PDF<span class="sr-only">（PDF，另開分頁）</span> <span aria-hidden="true">↗</span></a><a class="button button-secondary" href="${escapeHtml(booklet.url)}" download="${escapeHtml(booklet.filename)}">下載團刊 PDF</a></div>
      <p class="privacy-note">PDF 另開分頁。首次連線並完成離線快取後，可離線查看；也可先下載到裝置。</p>
    </section>`;
  }

  function renderHome({ trip, booklet, canInstall, checkInProgress, install = { mode: "native", helpOpen: false }, push }) {
    return `<section class="page-shell home-page">
      ${viewHeading(trip.title, `${trip.dateLabel} · ${trip.duration}`)}
      <section class="home-next-task" aria-labelledby="home-next-title"><h2 id="home-next-title">從行程開始</h2><p class="task-progress" role="status">五站打卡：${checkInProgress?.filled || 0}／${checkInProgress?.total || 0}</p><p>到達景點後打卡，再拍攝紀念照。相片及作品集中在底部「旅途回憶」。</p><a class="button button-primary" href="#itinerary">查看行程</a></section>
      ${renderBooklet(booklet)}
      <details id="home-settings" class="disclosure-panel home-settings" data-ui-disclosure ${install.helpOpen ? "open" : ""}><summary>通知與裝置設定</summary><div class="disclosure-content">
        <section class="install-section" ${canInstall ? "" : "hidden"}><h2>把 App 加入主畫面</h2>
            <div class="hero-actions" ${canInstall ? "" : "hidden"}>
              <button id="install-button" type="button" class="button button-secondary" ${canInstall ? "" : "hidden"} ${install.mode === "ios" ? `aria-expanded="${install.helpOpen}" aria-controls="ios-install-guide"` : ""}>${install.mode === "ios" ? "iPhone／iPad 安裝方法" : "安裝 App"}</button>
            </div>
            ${install.mode === "ios" ? `<section id="ios-install-guide" class="install-guide" aria-labelledby="ios-install-title" ${install.helpOpen ? "" : "hidden"}>
              <h2 id="ios-install-title">加入 iPhone／iPad 主畫面</h2>
              <ol>
                <li>用 Safari 開啟此網站。若從 WhatsApp 等 App 開啟，請先把網址複製到 Safari。</li>
                <li>按 Safari 的「分享」按鈕（正方形向上箭嘴）；部分版面須先按「頁面選單」，再按「分享」。</li>
                <li>向下捲動分享選項，選擇「加至主畫面」（部分版本顯示「加入主畫面」）。</li>
                <li>如有「開啟為網頁 App」選項，保持開啟，再按「加入」。</li>
                <li>返回手機主畫面，按新圖示開啟 App。</li>
              </ol>
              <p>如找不到「加至主畫面」，到分享列表底部按「編輯動作」，把它加入。</p>
            </section>` : ""}

        </section>
        ${renderPush(push)}
        <section class="content-section privacy-banner"><div><h2>位置與相片不會上傳</h2><p>GPS 只在你按下打卡時使用一次；照片移除 EXIF 位置資料後保存在本機，人樣及背景仍可能透露身份。</p></div></section>
        <section class="content-section data-control-section"><div><h2>本機資料</h2><p>打卡、相片及學習手冊草稿存在此裝置，沒有額外加密。清除後無法復原；已下載檔案不會被刪除。通知訂閱由「關閉通知」另行管理。</p></div><button class="button button-danger" data-reset-all>${testOnly ? "清除本機測試旅程資料" : "清除所有本機旅程資料"}</button></section>
      </div></details>
    </section>`;
  }
  return { renderHome };
}
