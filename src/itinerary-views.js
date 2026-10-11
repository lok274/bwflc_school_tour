import { escapeHtml, formatDateTime } from "./formatting.js";
import { createViewComponents, renderCheckInCompletion } from "./view-components.js";

export function createItineraryViews({ testOnly = false } = {}) {
  const { viewHeading, checkInBadge, renderSummaryEntry } = createViewComponents({ testOnly });
  function renderItinerary({ days, checkIns, allCheckInsComplete, requiredCount, introductionTitle, checkInProgress }) {
    return `
      <section class="page-shell">
        ${viewHeading("行程")}<p class="task-progress" role="status">五站打卡：${checkInProgress?.filled || 0}／${checkInProgress?.total || requiredCount}</p>
        ${introductionTitle ? `<p class="itinerary-intro-entry"><a class="button button-secondary" href="#introduction">${escapeHtml(introductionTitle)}</a></p>` : ""}
        ${renderCheckInCompletion(allCheckInsComplete, testOnly, renderSummaryEntry(allCheckInsComplete, requiredCount))}
        <div class="itinerary-list">
          ${days.map((day) => `
            <article class="day-panel">
              <div class="day-content">
                <header class="day-heading"><h2>第 ${day.day} 日 · ${escapeHtml(day.date)} · ${escapeHtml(day.theme)}</h2></header>
                <p>${escapeHtml(day.summary)}</p>
                <ol class="route-line">
                  ${day.route.map((stop) => {
                    return `<li>${stop.attractionId ? `<a href="#attraction/${stop.attractionId}">${escapeHtml(stop.label)}</a>${stop.attractionId === "departure-school" ? `<span class="status-badge status-optional">選填</span>` : ""}${checkInBadge(checkIns[stop.attractionId])}` : `<span>${escapeHtml(stop.label)}</span>`}</li>`;
                  }).join("")}
                </ol>
              </div>
            </article>`).join("")}
        </div>
      </section>`;
  }

  function renderIntroduction({ introduction }) {
    const imageMarkup = image => `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt)}" width="${image.width}" height="${image.height}" loading="lazy" decoding="async">`;
    return `<section class="page-shell">
      <a class="text-link introduction-back" href="#itinerary">← 返回行程</a>
      <div class="introduction-source">
        ${introduction.pages.map((page, index) => {
            const headingLevel = index === 0 ? 1 : 2;
            const topicLevel = page.heading ? headingLevel + 1 : 2;
            const labelId = page.heading ? `introduction-page-${index}` : `introduction-topic-${index}-0`;
            return `<article class="introduction-panel" aria-labelledby="${labelId}">
              ${page.heading ? `<h${headingLevel} class="introduction-heading" id="introduction-page-${index}">${escapeHtml(page.heading)}</h${headingLevel}>` : ""}
              ${page.sections.map((section, topicIndex) => `<section class="introduction-topic">
                <h${topicLevel} class="introduction-topic-heading" id="introduction-topic-${index}-${topicIndex}">${escapeHtml(section.title)}</h${topicLevel}>
                <div class="introduction-topic-body">
                  ${section.image ? `<figure class="introduction-illustration">${imageMarkup(section.image)}</figure>` : ""}
                  ${section.paragraphs.map(text => `<p>${escapeHtml(text)}</p>`).join("")}
                </div>
                ${section.gallery?.length ? `<div class="introduction-gallery">${section.gallery.map(image => `<figure>${imageMarkup(image)}</figure>`).join("")}</div>` : ""}
            </section>`).join("")}
          </article>`;
        }).join("")}
      </div>
    </section>`;
  }

  function photoPanel({ attraction, checkIn, photos = [] }) {
    if (!checkIn) return `<section class="photo-panel photo-locked"><div><h2>紀念相片</h2><p>完成景點打卡後即可拍攝相片。</p></div></section>`;
    return `
      <section class="photo-panel">
        <div><h2>${photos.length ? `已保存 ${photos.length} 張相片` : "留下旅程紀念照"}</h2>
          <p>打卡後拍攝的相片會自動加入「旅途回憶」。新增相片會保留之前的照片；不影相亦不影響打卡。</p>
          <p class="privacy-note">相片會縮小及移除 EXIF 位置資料；人樣、校服及背景仍可能透露身份，請避免拍攝敏感內容。</p>
          <details class="photo-help" id="photo-help-${attraction.id}" data-ui-disclosure><summary>拍攝及格式說明</summary><p class="privacy-note">支援靜態 JPEG、PNG、WebP；HEIC／HEIF 請先轉成 JPEG。每張最多 20MB、寬高 8192px、5000 萬像素；超限請先縮小。</p></details>
        </div>
        <div>
          <div class="photo-actions">
            <button class="button button-primary" data-native-camera-open="${attraction.id}">用手機相機拍攝</button>
            <button class="button button-secondary" data-camera-open="${attraction.id}">使用網頁相機</button>
          </div>
          <p class="privacy-note">查看及下載相片，請按底部的「旅途回憶」。</p>
        </div>
      </section>`;
  }

  function renderAttraction(model) {
    const { attraction, checkIn } = model;
    const checkInAction = checkIn
      ? `<div class="checked-in-panel">
           <div><h2>${testOnly ? "測試打卡完成" : "已完成本站打卡"}</h2><p class="checkin-record">${checkInBadge(checkIn)}<time>${formatDateTime(checkIn.checkedInAt)}</time></p><p class="privacy-note">${testOnly ? "這是流程預演，沒有核實真正到訪，不作課業或出席證明。" : "這是個人旅程記錄，不作校方出席證明。"}</p></div>
           <button class="button button-secondary button-small" data-checkin-undo="${attraction.id}">取消打卡</button>
         </div>`
      : `<div class="checkin-panel">
           <div><h2>${testOnly ? "預演景點打卡" : "在景點附近打卡"}</h2><p>${testOnly ? "使用上方選擇的模擬定位作距離判定，不讀取真實 GPS、不保存座標。" : "只會讀取一次位置作距離核對，不保存你的座標。"}</p></div>
           <button class="button button-primary" data-checkin="${attraction.id}">到埗打卡</button>
         </div>`;

    return `
      <article class="attraction-detail">
        <div class="detail-hero${attraction.id === "departure-school" ? " school-hero" : ""}">
          <header class="detail-hero-overlay">
            <a href="#itinerary" class="back-link">← 返回行程</a>
            ${viewHeading(attraction.name, `第 ${attraction.day} 日 · ${attraction.city}`)}<p class="detail-address">${escapeHtml(attraction.address)}</p>
          </header>
          ${attraction.image ? `<img src="${escapeHtml(attraction.image)}" alt="${escapeHtml(attraction.alt)}" width="1200" height="800" />` : ""}
        </div>
        <div class="detail-content">
          ${attraction.imageCredit ? `<p class="image-credit">校舍照片：<a href="${escapeHtml(attraction.imageCredit.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(attraction.imageCredit.author)}（${escapeHtml(attraction.imageCredit.year)}）／Wikimedia Commons</a> · <a href="${escapeHtml(attraction.imageCredit.licenseUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(attraction.imageCredit.license)}</a> · 按版面裁切顯示</p>` : ""}
          ${checkInAction}
          ${renderCheckInCompletion(model.allCheckInsComplete, testOnly, renderSummaryEntry(model.allCheckInsComplete, model.requiredCount))}
          ${photoPanel(model)}
          <details id="learning-questions-${attraction.id}" class="disclosure-panel learning-disclosure" data-ui-disclosure><summary>學習問題${attraction.questions?.length ? `（${attraction.questions.length} 題）` : ""}</summary>
          <div class="learning-grid">
            ${attraction.questions?.length ? attraction.questions.map((question, index) => {
              const number = attraction.questionNumbers?.[index] ?? index + 1;
              return `<section><h2 class="question-label">問題 ${escapeHtml(number)}</h2><p>${escapeHtml(question)}</p></section>`;
            }).join("") : `
            <section><h2 class="question-label">現場觀察</h2><p>${escapeHtml(attraction.observe)}</p></section>
            <section><h2 class="question-label">學習提示</h2><p>${escapeHtml(attraction.prompt)}</p></section>
            `}
          </div>
          </details>
          <p class="source-link">資料來源：<a href="${escapeHtml(attraction.source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(attraction.source.label)} <span aria-hidden="true">↗</span></a> · <a href="${escapeHtml(attraction.mapUrl || attraction.geo.sourceUrl)}" target="_blank" rel="noopener noreferrer">${attraction.mapUrl ? "在 Google Maps 查看地點" : "位置資料"} <span aria-hidden="true">↗</span></a></p>

        </div>
      </article>`;
  }

  return { renderItinerary, renderIntroduction, renderAttraction, photoPanel };
}
