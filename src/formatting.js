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
  if (appleMobile) return "iPhone／iPad：到「檔案」→「瀏覽」→「下載項目」，或 Safari 下載列表查看。";
  if (/Android/.test(navigator?.userAgent || "")) return "Android：到「檔案」或「我的檔案」→「下載」，或 Chrome 下載列表查看。";
  return "請到瀏覽器下載列表或「下載」資料夾查看；如曾另選位置，請到該處查找。";
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

// Preserve familiar Chinese counts for small groups; larger counts remain readable as digits.
export const formatSmallCount = value => Number.isInteger(value) && value >= 0 && value <= 10 ? "〇一二三四五六七八九十"[value] : String(value);
