import { CHECK_IN_LOCATIONS } from "./data.js";

const htmlEscapeMap = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => htmlEscapeMap[character]);

export function getAttraction(id) {
  return CHECK_IN_LOCATIONS.find((item) => item.id === id);
}

// Guidance only: the download attribute cannot confirm a saved file or its path.
// Apple: support.apple.com/zh-hk/102440; Chrome: support.google.com/chrome/answer/95759
export function getDownloadLocationHint(navigator = {}) {
  const appleMobile = /iPhone|iPad|iPod/.test(navigator?.userAgent || "")
    || (navigator?.platform === "MacIntel" && navigator?.maxTouchPoints > 1);
  if (appleMobile) return "iPhone／iPad：開啟「檔案」App →「瀏覽」→「下載項目」。可能在 iCloud Drive、「我的 iPhone／iPad」或你設定的其他位置；亦可查看 Safari 的下載列表。";
  if (/Android/.test(navigator?.userAgent || "")) return "Android：開啟「檔案」或「我的檔案」→「下載」（Download）。使用 Chrome 時亦可到選單 →「下載」查看；實際位置以手機或瀏覽器設定為準。";
  return "請到瀏覽器的下載列表查看；檔案通常在「下載」資料夾，若曾選擇其他儲存位置，請到該位置查找。";
}

export function formatDateTime(iso) {
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(iso));
}
