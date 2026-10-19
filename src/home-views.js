import { escapeHtml } from "./formatting.js";
import { SYNC_CUTOFF_LABEL } from "./check-in-sync.js";

export function createHomeViews({ testOnly = false } = {}) {
  function renderSyncInvitation() {
    return `<form id="check-in-sync-form" class="dialog-shell"><h2 id="sync-dialog-title">啟用打卡同步</h2><p>${testOnly ? "在裝置內模擬接收測試姓名、班別、學號及新打卡／取消紀錄。不會傳送到老師的 Google 試算表或其他服務。" : "將姓名、班別、學號及新打卡／取消紀錄傳至老師的 Google 試算表。不傳相片或座標。"}</p><p class="privacy-note">同步設定及待傳紀錄會在這部裝置保存，連線後補傳。</p><p id="sync-dialog-cutoff">上傳截止：${escapeHtml(SYNC_CUTOFF_LABEL)}。</p><p id="sync-dialog-error" class="form-error" role="alert" hidden></p><div class="photo-actions"><button class="button button-primary" id="sync-enable" type="submit" aria-describedby="sync-dialog-cutoff sync-dialog-error">啟用同步</button><button class="button button-secondary" type="button" data-sync-dismiss>稍後</button></div></form>`;
  }
  function renderBooklet(booklet) {
    if (!booklet) return "";
    return `<section class="content-section booklet-section" aria-label="團刊">
      <div class="booklet-actions"><a class="button button-secondary" href="${escapeHtml(booklet.url)}" target="_blank" rel="noopener noreferrer">查看團刊<span class="sr-only">（另開分頁）</span> <span aria-hidden="true">↗</span></a></div>
    </section>`;
  }

  function renderDeviceSettings() {
    return `<details id="home-settings" class="disclosure-panel home-settings" data-ui-disclosure><summary>裝置設定</summary><div class="disclosure-content">
        <section class="content-section data-control-section"><div><h2>這部裝置的資料</h2><p>清除後無法復原；已下載檔案會保留。</p></div><button class="button button-danger" data-reset-all>${testOnly ? "清除測試旅程資料" : "清除所有旅程資料"}</button></section>
      </div></details>`;
  }
  return { renderBooklet, renderDeviceSettings, renderSyncInvitation };
}
