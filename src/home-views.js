import { escapeHtml } from "./formatting.js";

export function createHomeViews({ testOnly = false } = {}) {
  function renderIOSInstallGuide({ id, hidden = false }) {
    return `<section id="${id}" class="install-guide" aria-labelledby="${id}-title" ${hidden ? "hidden" : ""}>
      <h2 id="${id}-title">加入 iPhone／iPad 主畫面</h2>
      <ol>
        <li>用 Safari 開啟此網站。</li>
        <li>按「分享」（向上箭嘴），選「加至主畫面」。</li>
        <li>如有「開啟為網頁 App」，保持開啟，再按「加入」。</li>
        <li>返回主畫面，按新圖示開啟。</li>
      </ol>
      <p>如找不到「加至主畫面」，到分享列表底部按「編輯動作」，把它加入。</p>
    </section>`;
  }
  function renderInstallInvitation({ mode }) {
    return `<div class="dialog-shell">
      <div class="dialog-heading"><h2 id="install-invitation-title">把 App 加入主畫面</h2><button type="button" class="icon-button" data-install-dismiss aria-label="關閉安裝提示" title="關閉安裝提示"></button></div>
      <p>加入後，請從主畫面開啟 App 再登入。</p>
      ${mode === "ios" ? renderIOSInstallGuide({ id: "install-invitation-guide" }) : ""}
      ${mode === "manual" ? renderManualInstallGuide({ id: "install-invitation-guide" }) : ""}
      <div class="dialog-actions">
        <button type="button" class="button button-secondary" data-install-dismiss>稍後</button>
        ${mode === "native" ? '<button type="button" class="button button-primary" data-install-start>安裝 App</button>' : ""}
      </div>
    </div>`;
  }
  function renderManualInstallGuide({ id, hidden = false }) {
    return `<section id="${id}" class="install-guide" aria-labelledby="${id}-title" ${hidden ? "hidden" : ""}>
      <h2 id="${id}-title">安裝方法</h2>
      <ol>
        <li>iPhone／iPad：用 Safari 開啟，按「分享」→「加至主畫面」。</li>
        <li>Android：用 Chrome 開啟，按瀏覽器選單→「安裝 App」或「加入主畫面」。</li>
      </ol>
      <p>若找不到安裝選項，請改用手機的 Safari 或 Chrome 開啟此網站。</p>
    </section>`;
  }
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
              <button id="install-button" type="button" class="button button-secondary" ${canInstall ? "" : "hidden"} ${install.mode === "ios" || install.mode === "manual" ? `aria-expanded="${install.helpOpen}" aria-controls="ios-install-guide"` : ""}>${install.mode === "ios" ? "iPhone／iPad 安裝方法" : install.mode === "manual" ? "安裝方法" : "安裝 App"}</button>
            </div>
            ${install.mode === "ios" ? renderIOSInstallGuide({ id: "ios-install-guide", hidden: !install.helpOpen }) : ""}
            ${install.mode === "manual" ? renderManualInstallGuide({ id: "ios-install-guide", hidden: !install.helpOpen }) : ""}

        </section>
        <section class="content-section data-control-section"><div><h2>這部裝置的資料</h2><p>清除後無法復原；已下載檔案會保留。</p></div><button class="button button-danger" data-reset-all>${testOnly ? "清除測試旅程資料" : "清除所有旅程資料"}</button></section>
      </div></details>`;
  }
  return { renderBooklet, renderDeviceSettings, renderInstallInvitation };
}
