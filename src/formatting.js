import { ATTRACTIONS } from "./data.js";

const htmlEscapeMap = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => htmlEscapeMap[character]);

export function getAttraction(id) {
  return ATTRACTIONS.find((item) => item.id === id);
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
