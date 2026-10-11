import { escapeHtml, formatSmallCount } from "./formatting.js";
export function renderCheckInCompletion(complete, testOnly = false, extraHint = "") {
  if (!complete) return "";
  return `<div class="checkin-completion" role="status" aria-live="polite" aria-atomic="true">
    <div><p>${testOnly ? "已完成所有測試打卡行程" : "已完成所有打卡行程"}</p><p class="checkin-completion-hint">${testOnly ? "已完成五站測試打卡，可到『旅途回憶』製作並下載五站測試打卡紀錄卡。" : "已完成五站打卡，可到『旅途回憶』製作並下載五站打卡紀錄卡。"}</p></div>
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
      ${checkIn.verified ? testOnly ? "模擬定位通過" : "GPS 已核實" : testOnly ? "測試手動記錄 · 未核實" : "未核實手動記錄"}
    </span>`;
  }

  function renderSummaryEntry(complete, requiredCount) {
    return complete ? `<div class="summary-entry"><p>AI 作品也在「旅途回憶」準備：${formatSmallCount(requiredCount)}個景點須各選一張相片；缺相片時須先補拍。學校相片可額外加入第${formatSmallCount(requiredCount + 1)}張，並非必需。</p></div>` : "";
  }
  return { viewHeading, checkInBadge, renderSummaryEntry };
}
