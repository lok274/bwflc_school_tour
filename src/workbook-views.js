import { MAX_WORKBOOK_PHOTOS } from "./app-settings.js";
import { escapeHtml as e } from "./formatting.js";
import { WORKBOOK_IDENTITY_LABELS, WORKBOOK_IDENTITY_LIMITS, MAX_WORKBOOK_TEXT } from "./workbook-data.js";
import { renderIcon } from "./view-components.js";

const partPresentation = {
  essay: { icon: "NotebookPen", description: "非遺體驗感悟與記錄" },
  share: { icon: "Users", description: "同儕協作與交流" },
  day1: { icon: "CalendarDays", theme: "港莞交流", description: "姊妹學校交流" },
  day2: { icon: "House", theme: "歷史與非遺", description: "孫中山故居與倫教糕" },
  day3: { icon: "School", theme: "嶺南古鎮", description: "沙灣古鎮與留耕堂" },
  reflection: { icon: "MessageCircleQuestion", description: "個人得著與反思" },
  works: { icon: "Palette", description: "作品規格與提交要求" }
};

export const workbookFieldHint = (_id, text) => `${text.length} 字元；最多 ${MAX_WORKBOOK_TEXT.toLocaleString("en-US")} 字元。`;

export const workbookStatusText = model => ({ loading: "正在讀取手冊…", saving: "正在自動暫存…", saved: "已自動暫存，可以稍後繼續", error: model.limitError || `暫存失敗，請重試。${model.error || "輸入仍保留在此頁。"}`, conflict: model.error || "另一個頁面有更新，已暫停暫存以避免覆蓋。" }[model.status]);
export const workbookStatusIcon = model => renderIcon({ saved: "CircleCheck", error: "X", conflict: "ShieldCheck" }[model.status] || "Archive");
export const workbookProgressText = (part, initialized) => initialized ? `已填 ${part.filled}／${part.total}` : "尚未讀取";
const paragraphs = lines => (lines || []).map(line => `<p>${e(line)}</p>`).join("");
function renderSelectedPhotos(model, disabled) {

  return model.selectedPhotos.map(photo => `<figure>${photo.url ? `<img src="${e(photo.url)}" alt="${e(photo.title)}文章配圖" width="${photo.width}" height="${photo.height}" />` : `<p>${e(photo.title)}：${e(photo.reason || "未能顯示預覽")}</p>`}<figcaption>${e(photo.title)}<button type="button" class="button button-secondary" data-workbook-remove-photo="${e(photo.photoId)}" ${disabled ? "disabled" : ""}>移除此配圖</button>
    </figcaption>
    </figure>`).join("");
}

function renderWorkbookPhotos(model, disabled) {
  const section = model.part, selected = renderSelectedPhotos(model, disabled);
  return section?.id === "essay" ? `<section class="workbook-photos" aria-labelledby="workbook-photo-title">
    <h2 id="workbook-photo-title">文章配圖（${model.selectedPhotos.length}／${MAX_WORKBOOK_PHOTOS}）</h2>
    <div class="workbook-selected-photos">${selected}</div>
    <button id="wb-picker-open" type="button" class="button button-secondary" data-workbook-picker ${disabled || model.busy ? "disabled" : ""}>${model.pickerOpen ? "收起選圖" : "選取文章配圖"}</button>${model.pickerOpen ? `<div id="wb-picker">
    <p role="status">${model.photoReadState === "loading" ? "正在讀取相片，暫時不能核對配圖。" : model.photoReadState === "error" ? "相片讀取失敗，暫時不能核對配圖；請重試。" : model.photoCount ? `共有 ${model.photoCount} 張紀念照` : "還沒有紀念照。請先到景點打卡後拍照。"}</p>${model.photoReadState === "error" ? '<button class="button button-secondary" data-workbook-photos-retry>重試讀取相片</button>' : ""}<div class="workbook-photo-grid">${model.pickerPhotos.map(photo => `<label>
    <img src="${e(photo.url || "")}" alt="${e(photo.title)}" width="${photo.width}" height="${photo.height}" />
    <span>
    <input type="checkbox" data-workbook-photo="${e(photo.photoId)}" ${photo.selected ? "checked" : ""} ${!photo.selected && model.selectedPhotos.length >= MAX_WORKBOOK_PHOTOS ? "disabled" : ""} />${e(photo.title)}</span>
    </label>`).join("")}</div>${model.photoReadState === "ready" && model.photoCount ? `<div class="workbook-pagination">
    <button class="button button-secondary" data-workbook-photo-page="${model.photoPage - 1}" ${model.photoPage === 0 ? "disabled" : ""}>上一頁</button>
    <span>第 ${model.photoPage + 1}／${model.photoPages} 頁</span>
    <button class="button button-secondary" data-workbook-photo-page="${model.photoPage + 1}" ${model.photoPage + 1 >= model.photoPages ? "disabled" : ""}>下一頁</button>
    </div>` : ""}</div>` : ""}</section>` : "";
}

function renderWorkbookRatings(model, disabled) {
  const section = model.part;
  return section?.id === "reflection" ? `<section>
    <h2>${e(model.ratingInstruction)}</h2>${model.ratingFields.map(item => `<fieldset class="workbook-rating">
    <legend>${e(item.label)}</legend>
    <div>${[1, 2, 3, 4, 5].map(score => `<label>
    <input type="radio" name="${e(item.id)}" data-workbook-rating="${e(item.id)}" value="${score}" ${model.ratings[item.id] === score ? "checked" : ""} ${disabled ? "disabled" : ""} />${score}</label>`).join("")}<button type="button" class="button-text" data-workbook-clear-rating="${e(item.id)}" ${disabled ? "disabled" : ""}>清除評分</button>
    </div>
    </fieldset>`).join("")}</section>` : "";
}

function renderWorkbookWorks(model) {
  const section = model.part;
  return section?.id === "works" ? `<div class="workbook-instructions">
    <h2>活動花絮短片</h2>${paragraphs(model.works.video)}<h2>AI 融合圖片</h2>${paragraphs(model.works.ai)}<a class="button button-secondary" href="#memories/ai">前往旅途回憶準備 AI 素材包</a>
    <h2>作品上傳</h2>
    <p>${e(model.works.upload)}</p>
    <a href="${e(model.works.uploadUrl)}" target="_blank" rel="noopener noreferrer">${e(model.works.uploadUrl)} ↗</a>
    <p>作品須自行上傳；手冊供保存及列印。</p>
    </div>` : "";
}

function renderBackupPanel(model, disabled) {

  return `<section id="wb-backup-panel" class="workbook-backup" aria-labelledby="wb-backup-title" ${model.backupOpen ? "" : "hidden"}>
    <h2 id="wb-backup-title" tabindex="-1">保存與備份</h2>
    <p>換裝置或清除資料前，先保存備份。</p>
    <p>備份只含文字及自評，不含身份資料或相片；載入後需重新選圖。</p>
    <div class="workbook-toolbar">
    <button class="button button-secondary" data-workbook-backup ${!model.initialized ? "disabled" : ""}>保存備份檔</button>
    <button id="wb-restore-open" class="button button-secondary" data-workbook-restore-open ${disabled || model.status === "conflict" ? "disabled" : ""}>用備份檔繼續</button>
    <input id="wb-restore" type="file" accept="application/json,.json" data-workbook-restore hidden ${disabled || model.status === "conflict" ? "disabled" : ""}/>
    </div>
    <p id="wb-backup-message" role="status">${e(model.backupMessage)}</p>${model.restorePreview ? `<div id="wb-restore-preview" class="workbook-restore-preview" tabindex="-1">
    <h3>備份內容</h3>
    <p>已填 ${model.restorePreview.textCount}／${model.restorePreview.totalTextCount} 個文字欄及 ${model.restorePreview.ratingCount}／${model.restorePreview.totalRatingCount} 項自評。</p>${model.restorePreview.limitError ? `<p>${e(model.restorePreview.limitError)}</p>` : ""}<p>載入會取代目前內容；可先保存備份。</p>
    <div class="workbook-toolbar">
    <button class="button button-primary" data-workbook-restore-confirm ${disabled || model.status === "conflict" ? "disabled" : ""}>載入並繼續填寫</button>
    <button class="button button-secondary" data-workbook-restore-cancel>取消載入</button>
    </div>
    </div>` : ""}</section>`;
}

function renderExportPanel(model, disabled) {

  return model.exportOpen ? `<section class="workbook-export" aria-labelledby="workbook-export-title">
    <h2 id="workbook-export-title" tabindex="-1">下載學習手冊</h2>
    <p>姓名、班別及學號會印在手冊上，不上傳或存入草稿。離開手冊或重新載入後需再填。</p>
    <div class="workbook-identity">${Object.entries(WORKBOOK_IDENTITY_LIMITS).map(([key, max]) => `<label for="wb-id-${key}">${WORKBOOK_IDENTITY_LABELS[key]}（必填）<input id="wb-id-${key}" data-workbook-identity="${key}" value="${e(model.identity[key])}" maxlength="${max * 2}" required autocomplete="off" ${model.busy ? "disabled" : ""}/>
    <small id="wb-id-count-${key}">${Array.from(model.identity[key]).length}／${max} 字</small>
    </label>`).join("")}</div>
    <details ${model.missing.length ? "" : "hidden"}>
    <summary>尚未填寫 ${model.missing.length} 項（可下載草稿）</summary>
    <ul>${model.missing.map(label => `<li>${e(label)}</li>`).join("")}</ul>
    </details>
    <p id="workbook-pdf-status" role="status">${e(model.pdfMessage || "")}</p>
    <div class="workbook-toolbar">
    <button id="wb-pdf-download" class="button button-primary" data-workbook-pdf ${model.busy || disabled || model.status !== "saved" ? "disabled" : ""}>下載手冊</button>
    <button class="button button-secondary" data-workbook-export-close>${model.busy ? "取消生成" : "收起下載"}</button>
    </div>
    </section>` : "";
}

export function renderWorkbook(model) {
  const disabled = model.status === "loading" || !model.initialized || model.busy;
  const section = model.part;
  const field = item => `<div class="workbook-field">
    <label for="wb-${e(item.id)}">${e(item.label)}</label>
    <textarea id="wb-${e(item.id)}" data-workbook-field="${e(item.id)}" maxlength="${MAX_WORKBOOK_TEXT}" aria-describedby="wb-count-${e(item.id)}" rows="${item.id === "essay-body" ? 12 : 4}" ${disabled ? "disabled" : ""}>${e(model.answers[item.id])}</textarea>
    <small id="wb-count-${e(item.id)}">${e(workbookFieldHint(item.id, model.answers[item.id]))}</small>
    </div>`;

  const photos = renderWorkbookPhotos(model, disabled);
  const ratings = renderWorkbookRatings(model, disabled);
  const works = renderWorkbookWorks(model);
  const sections = `<div class="section-accordion">${model.progress.map(part => {
    const visual = partPresentation[part.id] || { icon: "BookOpen", description: "" }, expanded = part.id === section?.id;
    const action = part.id === "works" ? expanded ? "收起指引" : "查看指引" : expanded ? "收起任務" : "開啟任務";
    return `<section class="accordion-part" data-workbook-part="${e(part.id)}" aria-labelledby="wb-title-${e(part.id)}">
      <header class="workbook-task-heading"><span class="part-icon" aria-hidden="true">${renderIcon(visual.icon)}</span><div class="workbook-task-copy"><h2 id="wb-title-${e(part.id)}" class="section-heading">${e(part.title)}${visual.theme ? ` · ${e(visual.theme)}` : ""}</h2><small id="wb-description-${e(part.id)}">${e(visual.description)}</small></div>${part.total ? `<span id="wb-progress-${e(part.id)}" class="workbook-progress-badge">${e(workbookProgressText(part, model.initialized))}</span>` : '<span class="workbook-reference-badge">參考資料</span>'}</header>
      ${part.total ? `<progress id="wb-meter-${e(part.id)}" max="${part.total}" ${model.initialized ? `value="${part.filled}"` : ""} aria-label="${e(part.title)}填寫進度"></progress>` : !expanded ? `<p class="workbook-guide-note">影片與 AI 圖片須自行製作及上傳。</p>` : ""}
      <div class="workbook-task-actions"><button id="wb-section-${e(part.id)}" class="button ${part.id === "works" ? "button-secondary" : "button-primary"} workbook-task-toggle" data-section-view="workbook" data-section-id="${e(part.id)}" aria-label="${action}：${e(part.title)}" aria-describedby="wb-description-${e(part.id)}" aria-expanded="${expanded}" aria-controls="wb-content-${e(part.id)}">${action}</button></div>
      <div id="wb-content-${e(part.id)}" class="section-content" ${expanded ? "" : "hidden"}>${expanded ? `${paragraphs(section.instructions)}${section.fields.map(field).join("")}${photos}${ratings}${works}` : ""}</div>
    </section>`;
  }).join("")}</div>`;
  const backupPanel = renderBackupPanel(model, disabled);
  const exportPanel = renderExportPanel(model, disabled);
  return `<div class="page-shell workbook-page"><h1 class="sr-only">學習手冊</h1>
    <div class="workbook-status" data-save-state="${e(model.status)}">
    <div class="workbook-status-heading"><span id="wb-save-icon" class="workbook-save-icon" data-save-state="${e(model.status)}" aria-hidden="true">${workbookStatusIcon(model)}</span><div><p id="workbook-save-status" role="status">${e(workbookStatusText(model))}</p><p id="wb-save-hint" class="privacy-note" ${model.status === "saved" ? "" : "hidden"}>草稿只存在這部裝置。</p></div></div>
    <div class="workbook-toolbar">
    <button class="button button-secondary" data-workbook-export-open ${disabled ? "disabled" : ""}>下載手冊</button>
    <button class="button button-secondary" data-workbook-retry ${model.status !== "error" ? "hidden" : ""}>重試暫存</button>
    <button id="wb-backup-open" class="button button-secondary" data-workbook-backup-toggle aria-controls="wb-backup-panel" aria-expanded="${Boolean(model.backupOpen)}" ${model.busy ? "disabled" : ""}>保存與備份</button>
    </div>
    <div id="workbook-conflict" ${model.status !== "conflict" ? "hidden" : ""}>
    <p>請先開啟「保存與備份」，保存目前內容的備份檔，再載入另一個頁面的版本；載入會取代此頁草稿。</p>
    <button class="button button-secondary" data-workbook-load-latest ${model.backedUp ? "" : "disabled"}>載入另一個頁面的版本</button>
    </div>
    </div>${backupPanel}<header class="workbook-units-heading"><h2>核心學習單元</h2><span class="workbook-progress-badge">共 ${model.progress.length} 單元</span></header>${sections}${exportPanel}<p class="workbook-progress-note">${renderIcon("CircleHelp")}<span>進度只表示已填，不代表答案正確或已提交。</span></p><details id="workbook-privacy" class="memory-privacy" data-ui-disclosure>
    <summary>${renderIcon("ShieldCheck")}<span>草稿與檔案說明</span><span class="workbook-privacy-chevron" aria-hidden="true">${renderIcon("ChevronDown")}</span></summary>
    <p class="privacy-note">草稿只存在這部裝置，沒有額外加密；同一網站的其他頁面可讀取。離開前請確認已暫存，突然關閉可能遺失未存內容。</p>
    <p class="privacy-note">清除旅程資料會一併清除手冊；已下載的手冊及備份會保留，請自行保存。</p>
    </details>
    </div>`;
}
