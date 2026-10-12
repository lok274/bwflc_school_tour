import { escapeHtml, formatSmallCount } from "./formatting.js";
export function renderCheckInCompletion(complete, testOnly = false, extraHint = "") {
  if (!complete) return "";
  return `<div class="checkin-completion" role="status" aria-live="polite" aria-atomic="true">
    <div><p>${testOnly ? "已完成所有測試打卡行程" : "已完成所有打卡行程"}</p><p class="checkin-completion-hint">${testOnly ? "到『旅途回憶』製作五站測試打卡紀錄卡。" : "到『旅途回憶』製作五站打卡紀錄卡。"}</p></div>
    ${extraHint}
  </div>`;
}


export function createViewComponents({ testOnly = false } = {}) {
  function viewHeading(title, description = "") {
    return `
      <header class="view-heading">
        <h1>${escapeHtml(title)}</h1>
        ${description ? `<p>${escapeHtml(description)}</p>` : ""}
      </header>`;
  }

  function checkInBadge(checkIn) {
    if (!checkIn) return `<span class="status-badge status-pending">未打卡</span>`;
    return `<span class="status-badge ${checkIn.verified ? "status-verified" : "status-manual"}">
      ${checkIn.verified ? testOnly ? "模擬定位通過" : "定位已核實" : testOnly ? "測試手動記錄 · 未核實" : "未核實手動記錄"}
    </span>`;
  }

  function renderSummaryEntry(complete, requiredCount) {
    return complete ? `<div class="summary-entry"><p>AI 作品需${formatSmallCount(requiredCount)}個景點各一張相片，缺照請先補拍；學校相片選填。</p></div>` : "";
  }
  return { viewHeading, checkInBadge, renderSummaryEntry };
}
