import { escapeHtml } from "./formatting.js";
import { STUDENT_IDENTITY_LABELS } from "./app-settings.js";

export function createHomeViews({ testOnly = false } = {}) {
  function renderStudentLogin({ identity, errors = {}, editing = false, status = "", saveFailed = false }) {
    return `<section class="page-shell student-login"><h1 id="student-login-title" tabindex="-1">${editing ? "學生資料" : "學生登入"}</h1>
      <form id="student-login-form" novalidate>
        <div class="student-login-fields">${Object.entries(STUDENT_IDENTITY_LABELS).map(([key, label]) => `<div><label for="student-login-${key}">${label}</label><input id="student-login-${key}" data-student-identity-field="${key}" type="text" required autocomplete="off" spellcheck="false" value="${escapeHtml(identity[key])}" aria-invalid="${Boolean(errors[key])}" aria-describedby="student-login-${key}-error"><p id="student-login-${key}-error" class="field-error" ${errors[key] ? "" : "hidden"}>${escapeHtml(errors[key] || "")}</p></div>`).join("")}</div>
        <p id="student-login-status" role="status" class="field-error" ${status ? "" : "hidden"}>${escapeHtml(status)}</p>
        <div class="student-login-actions"><button type="submit" class="button button-primary">${editing ? "保存並返回" : "踏上旅程"}</button>
          ${saveFailed ? '<button type="button" class="button button-secondary" data-student-identity-temporary>只在本次使用</button>' : ""}
          ${editing ? '<button type="button" class="button button-secondary" data-student-identity-cancel>取消修改</button><button type="button" class="button button-secondary" data-student-identity-logout>登出</button>' : ""}
        </div>
      </form>
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
  return { renderStudentLogin, renderBooklet, renderDeviceSettings };
}
