import { escapeHtml, formatSmallCount } from "./formatting.js";
import { DEPARTURE_LOCATION } from "./data.js";

/* Lucide 1.8.0 icon nodes, ISC License.
 * Copyright (c) 2026 Lucide Icons and Contributors.
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 * Feather-derived icons: Download, Check, ChevronDown, ChevronUp, ChevronLeft,
 * ChevronRight, ArrowRight, RotateCcw, X, Trash2, Share2, Bell, BellOff, Wifi,
 * WifiOff, Eye, Camera, FileText.
 * MIT License: Copyright (c) 2013-present Cole Bemis.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
const iconNodes = {
  School: [["path", { d: "M14 21v-3a2 2 0 0 0-4 0v3" }], ["path", { d: "M18 4.933V21" }], ["path", { d: "m4 6 7.106-3.79a2 2 0 0 1 1.788 0L20 6" }], ["path", { d: "m6 11-3.52 2.147a1 1 0 0 0-.48.854V19a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a1 1 0 0 0-.48-.853L18 11" }], ["path", { d: "M6 4.933V21" }], ["circle", { cx: "12", cy: "9", r: "2" }]],
  MapPin: [["path", { d: "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" }], ["circle", { cx: "12", cy: "10", r: "3" }]],
  Images: [["path", { d: "m22 11-1.296-1.296a2.4 2.4 0 0 0-3.408 0L11 16" }], ["path", { d: "M4 8a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2" }], ["circle", { cx: "13", cy: "7", r: "1", fill: "currentColor" }], ["rect", { x: "8", y: "2", width: "14", height: "14", rx: "2" }]],
  Camera: [["path", { d: "M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z" }], ["circle", { cx: "12", cy: "13", r: "3" }]],
  Download: [["path", { d: "M12 15V3" }], ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }], ["path", { d: "m7 10 5 5 5-5" }]],
  ShieldCheck: [["path", { d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" }], ["path", { d: "m9 12 2 2 4-4" }]],
  Sparkles: [["path", { d: "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" }], ["path", { d: "M20 2v4" }], ["path", { d: "M22 4h-4" }], ["circle", { cx: "4", cy: "20", r: "2" }]],
  FileText: [["path", { d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" }], ["path", { d: "M14 2v5a1 1 0 0 0 1 1h5" }], ["path", { d: "M10 9H8" }], ["path", { d: "M16 13H8" }], ["path", { d: "M16 17H8" }]],
  Check: [["path", { d: "M20 6 9 17l-5-5" }]],
  ChevronDown: [["path", { d: "m6 9 6 6 6-6" }]],
  ChevronUp: [["path", { d: "m18 15-6-6-6 6" }]],
  ChevronLeft: [["path", { d: "m15 18-6-6 6-6" }]],
  ChevronRight: [["path", { d: "m9 18 6-6-6-6" }]],
  ArrowRight: [["path", { d: "M5 12h14" }], ["path", { d: "m12 5 7 7-7 7" }]],
  RotateCcw: [["path", { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" }], ["path", { d: "M3 3v5h5" }]],
  X: [["path", { d: "M18 6 6 18" }], ["path", { d: "m6 6 12 12" }]],
  Trash2: [["path", { d: "M10 11v6" }], ["path", { d: "M14 11v6" }], ["path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" }], ["path", { d: "M3 6h18" }], ["path", { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }]],
  Share2: [["circle", { cx: "18", cy: "5", r: "3" }], ["circle", { cx: "6", cy: "12", r: "3" }], ["circle", { cx: "18", cy: "19", r: "3" }], ["line", { x1: "8.59", x2: "15.42", y1: "13.51", y2: "17.49" }], ["line", { x1: "15.41", x2: "8.59", y1: "6.51", y2: "10.49" }]],
  Wifi: [["path", { d: "M12 20h.01" }], ["path", { d: "M2 8.82a15 15 0 0 1 20 0" }], ["path", { d: "M5 12.859a10 10 0 0 1 14 0" }], ["path", { d: "M8.5 16.429a5 5 0 0 1 7 0" }]],
  WifiOff: [["path", { d: "M12 20h.01" }], ["path", { d: "M8.5 16.429a5 5 0 0 1 7 0" }], ["path", { d: "M5 12.859a10 10 0 0 1 5.17-2.69" }], ["path", { d: "M19 12.859a10 10 0 0 0-2.007-1.523" }], ["path", { d: "M2 8.82a15 15 0 0 1 4.177-2.643" }], ["path", { d: "M22 8.82a15 15 0 0 0-11.288-3.764" }], ["path", { d: "m2 2 20 20" }]],
  CircleCheck: [["circle", { cx: "12", cy: "12", r: "10" }], ["path", { d: "m9 12 2 2 4-4" }]],
  SquareCheck: [["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }], ["path", { d: "m9 12 2 2 4-4" }]],
  ImagePlus: [["path", { d: "M16 5h6" }], ["path", { d: "M19 2v6" }], ["path", { d: "M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5" }], ["path", { d: "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" }], ["circle", { cx: "9", cy: "9", r: "2" }]],
  Eye: [["path", { d: "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" }], ["circle", { cx: "12", cy: "12", r: "3" }]],
};

export function renderIcon(name) {
  if (!Object.hasOwn(iconNodes, name)) return "";
  return `<svg class="ui-icon" data-ui-icon="${name}" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${iconNodes[name].map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([key, value]) => `${key}="${escapeHtml(value)}"`).join(" ")}></${tag}>`).join("")}</svg>`;
}

const actionVisuals = [
  ["[data-checkin], [data-device-gps]", "MapPin", "checkin"],
  ["[data-native-camera-open], [data-camera-open], [data-camera-save]", "Camera", "camera"],
  ["[data-camera-retake]", "RotateCcw", "camera"],
  ["[data-reset-all], [data-device-reset]", "Trash2", "danger"],
  ["[data-checkin-undo], [data-device-checkin-undo]", "RotateCcw", "neutral"],
  ["[data-memory-summary-open], [data-memory-artwork-open], [data-memory-checkin-card-open], [data-memory-card-toggle]", "Sparkles", "memories"],
  ["[data-memory-back], [data-memory-page], [data-export-page], [data-memory-photo-step]", "ChevronRight", "neutral"],
  ["[data-photos-retry], [data-export-retry]", "RotateCcw", "neutral"],
  ["[data-photo-select-none], [data-memory-album-select]", "SquareCheck", "neutral"],
  ["[data-memory-selection-confirm]", "Check", "checkin"],
  ["[data-artwork-choose]", "ImagePlus", "neutral"],
  ["[data-artwork-preview], [data-checkin-card-preview]", "Eye", "memories"],
  ["[data-photo-export-share]", "Share2", "neutral"],
  ["#install-button", "Download", "neutral"],
  ["[data-memory-pick]", "Images", "memories"]
];

// Add presentation without replacing controls, listeners, focus targets or input.
export function decorateInterface(root) {
  const addIcon = (element, name, iconOnly = false) => {
    const previous = element.querySelector("svg[data-ui-icon]");
    if (previous?.getAttribute("data-ui-icon") === name) return;
    previous?.remove();
    if (iconOnly) element.innerHTML = renderIcon(name);
    else element.insertAdjacentHTML("afterbegin", renderIcon(name));
  };
  for (const link of root.querySelectorAll(".bottom-nav [data-nav]")) {
    const name = { itinerary: "MapPin", memories: "Images" }[link.dataset.nav];
    if (name) addIcon(link, name);
  }
  for (const brand of root.querySelectorAll(".app-header .brand")) {
    const mark = brand.querySelector(".brand-mark"), title = brand.querySelector("strong");
    if (mark) addIcon(mark, "School", true);
    if (title?.textContent === "戶外學習日") {
      title.textContent = "港莞非遺文化交流";
      title.insertAdjacentHTML("beforebegin", `<small>${escapeHtml(DEPARTURE_LOCATION.name)}</small>`);
    }
    if (title && !brand.textContent.includes(DEPARTURE_LOCATION.name)) title.insertAdjacentHTML("beforebegin", `<small>${escapeHtml(DEPARTURE_LOCATION.name)}</small>`);
  }
  for (const status of root.querySelectorAll("#network-status")) addIcon(status, status.classList.contains("is-offline") ? "WifiOff" : "Wifi");
  for (const shutter of root.querySelectorAll(".shutter-button")) shutter.setAttribute("title", shutter.getAttribute("aria-label") || "拍攝照片");
  for (const control of root.querySelectorAll(".button, .icon-button, .text-link, .button-text")) {
    if (control.classList.contains("icon-button")) {
      addIcon(control, control.closest(".memory-inline") ? "ChevronUp" : "X", true);
      control.setAttribute("title", control.getAttribute("aria-label") || "關閉");
      continue;
    }
    const visual = actionVisuals.find(([selector]) => control.matches(selector));
    let name = visual?.[1], tone = visual?.[2];
    if (control.matches("[download]") || Object.keys(control.dataset).some(key => /download/i.test(key)) || control.matches("[data-photo-export-selected]")) { name = "Download"; tone = "download"; }
    if (control.matches("[data-memory-back]") || /^(?:previous|-\d)/.test(control.dataset.memoryPhotoStep || control.dataset.memoryPage || control.dataset.exportPage || "") || /^(?:memory-prev|export-prev)/.test(control.id)) name = "ChevronLeft";
    if (!name && control.matches("a")) name = control.getAttribute("href")?.startsWith("#attraction/") ? "MapPin" : control.getAttribute("href")?.startsWith("#itinerary") ? "MapPin" : "FileText";
    if (!name && control.classList.contains("button-danger")) { name = "Trash2"; tone = "danger"; }
    if (!name && control.matches("[data-artwork-close], [data-checkin-card-close], [value=cancel]")) name = "X";
    if (!name && control.classList.contains("button")) name = "ArrowRight";
    if (name) addIcon(control, name);
    if (tone) control.dataset.uiTone = tone;
    else delete control.dataset.uiTone;
  }
}
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
        <span class="view-icon" aria-hidden="true">${renderIcon({ "行程": "MapPin", "旅途回憶": "Images" }[title] || "School")}</span><div><h1>${escapeHtml(title)}</h1>
        ${description ? `<p>${escapeHtml(description)}</p>` : ""}</div>
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
