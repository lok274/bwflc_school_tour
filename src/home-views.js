import { escapeHtml } from "./formatting.js";

export function createHomeViews({ testOnly = false } = {}) {
  function renderBooklet(booklet) {
    if (!booklet) return "";
    return `<section class="content-section booklet-section" aria-label="團刊">
      <div class="booklet-actions"><a class="button button-secondary" href="${escapeHtml(booklet.url)}" target="_blank" rel="noopener noreferrer">查看團刊<span class="sr-only">（另開分頁）</span> <span aria-hidden="true">↗</span></a></div>
    </section>`;
  }

  function renderDeviceSettings({ canInstall, install = { mode: "native", helpOpen: false } }) {
    return `<details id="home-settings" class="disclosure-panel home-settings" data-ui-disclosure ${install.helpOpen ? "open" : ""}><summary>裝置設定</summary><div class="disclosure-content">
        <section class="install-section" ${canInstall ? "" : "hidden"}><h2>把 App 加入主畫面</h2>
            <div class="hero-actions" ${canInstall ? "" : "hidden"}>
              <button id="install-button" type="button" class="button button-secondary" ${canInstall ? "" : "hidden"} ${install.mode === "ios" ? `aria-expanded="${install.helpOpen}" aria-controls="ios-install-guide"` : ""}>${install.mode === "ios" ? "iPhone／iPad 安裝方法" : "安裝 App"}</button>
            </div>
            ${install.mode === "ios" ? `<section id="ios-install-guide" class="install-guide" aria-labelledby="ios-install-title" ${install.helpOpen ? "" : "hidden"}>
              <h2 id="ios-install-title">加入 iPhone／iPad 主畫面</h2>
              <ol>
                <li>用 Safari 開啟此網站。</li>
                <li>按「分享」（向上箭嘴），選「加至主畫面」。</li>
                <li>如有「開啟為網頁 App」，保持開啟，再按「加入」。</li>
                <li>返回主畫面，按新圖示開啟。</li>
              </ol>
              <p>如找不到「加至主畫面」，到分享列表底部按「編輯動作」，把它加入。</p>
            </section>` : ""}

        </section>
        <section class="content-section data-control-section"><div><h2>這部裝置的資料</h2><p>清除後無法復原；已下載檔案會保留。</p></div><button class="button button-danger" data-reset-all>${testOnly ? "清除測試旅程資料" : "清除所有旅程資料"}</button></section>
      </div></details>`;
  }
  return { renderBooklet, renderDeviceSettings };
}
