import { escapeHtml, formatDateTime } from "./formatting.js";
import { createViewComponents, renderCheckInCompletion, renderIcon } from "./view-components.js";
import { createHomeViews } from "./home-views.js";

const stopPresentation = {
  "departure-school": { label: "出發站" },
  "future-school": { label: "姊妹學校", cover: true },
  "sun-yat-sen": { label: "歷史文化", cover: true },
  "lunjiao-cake": { label: "非遺體驗", cover: true },
  "shawan-town": { label: "嶺南古鎮" },
  "liugeng-hall": { label: "宗祠建築" }
};

export function createItineraryViews({ testOnly = false } = {}) {
  const { checkInBadge, renderSummaryEntry } = createViewComponents({ testOnly });
  const { renderBooklet, renderDeviceSettings } = createHomeViews({ testOnly });
  function renderItinerary(model) {
    const { days, checkIns, allCheckInsComplete, requiredCount, introduction, introductionOpen, checkInProgress, trip, booklet } = model;
    const verified = Object.entries(checkIns || {}).filter(([id, record]) => id !== "departure-school" && record.verified).length;
    const filled = checkInProgress?.filled || 0, total = checkInProgress?.total || requiredCount;
    return `
      <section class="page-shell itinerary-page">
        <div class="itinerary-topline"><div class="itinerary-title"><h1>行程</h1>${trip?.duration ? `<span class="status-badge status-optional">${escapeHtml(trip.duration)}</span>` : ""}</div>${introduction ? `<details id="itinerary-introduction" class="itinerary-introduction" data-ui-disclosure ${introductionOpen ? "open" : ""}><summary id="itinerary-introduction-heading">${renderIcon("FileText")}<span>${escapeHtml(introduction.title)}</span></summary><div class="disclosure-content">${trip ? `<p class="itinerary-activity-note">${escapeHtml(trip.title)} · ${escapeHtml(trip.dateLabel)} · ${escapeHtml(trip.duration)}</p>` : ""}${renderIntroduction({ introduction })}</div></details>` : ""}</div>
        ${!introduction && trip ? `<p class="itinerary-activity-note">${escapeHtml(trip.title)} · ${escapeHtml(trip.dateLabel)} · ${escapeHtml(trip.duration)}</p>` : ""}<div class="itinerary-progress"><div class="itinerary-progress-heading"><span class="itinerary-progress-icon" aria-hidden="true">${renderIcon("MapPin")}</span><div><p class="task-progress" role="status">五站打卡：${filled}／${total}</p><p class="privacy-note">學校打卡選填。</p></div></div><progress max="${total}" value="${filled}" aria-label="五站打卡進度"></progress><p class="itinerary-progress-state" ${filled || testOnly ? "" : "hidden"}>${testOnly ? "測試紀錄，未核實到訪。" : `已核實 ${verified} · 未核實 ${filled - verified}`}</p></div>
        ${renderBooklet(booklet)}
        <nav class="itinerary-day-nav" aria-label="按日期定位">${days.map(day => `<button type="button" class="itinerary-day-link" data-itinerary-day="${day.day}" aria-controls="itinerary-day-${day.day}"><span>第 ${day.day} 日</span><span>${escapeHtml(day.theme)}</span></button>`).join("")}</nav>
        ${model.attraction ? "" : renderCheckInCompletion(allCheckInsComplete, testOnly, renderSummaryEntry(allCheckInsComplete, requiredCount))}
        <div class="itinerary-list">
          ${days.map((day) => `
            <article id="itinerary-day-${day.day}" class="day-panel" tabindex="-1" aria-labelledby="itinerary-date-${day.day}">
              <div class="day-content">
                <header class="day-heading"><span class="day-label">第 ${day.day} 日</span><h2 id="itinerary-date-${day.day}">${escapeHtml(day.date)} · ${escapeHtml(day.theme)}</h2></header>
                <p>${escapeHtml(day.summary)}</p>
                <ol class="route-line" role="list">
                  ${day.route.map((stop, index) => {
                    if (!stop.attractionId) return `<li class="itinerary-rest"><span class="stop-number" aria-hidden="true">${index + 1}</span><span class="rest-label">${escapeHtml(stop.label)}</span><span class="status-badge status-optional">${stop.label === "香港" ? "返程" : stop.label === "酒店" ? index === 0 ? "出發" : "休息" : "行程"}</span></li>`;
                    const id = stop.attractionId, expanded = model.attraction?.id === id;
                    const visual = stopPresentation[id] || { label: "景點" }, preview = model.stopPreviews?.find(item => item.id === id);
                    return `<li class="itinerary-stop" data-stop-id="${id}"><header class="itinerary-stop-heading"><span class="stop-number" aria-hidden="true">${index + 1}</span><div class="itinerary-stop-copy"><small class="stop-category">${visual.label}</small><h3 class="stop-label">${escapeHtml(stop.label)}</h3></div><span class="itinerary-stop-state">${id === "departure-school" ? '<span class="status-badge status-optional">選填</span>' : ""}${checkInBadge(checkIns[id])}</span></header>${visual.cover && preview?.image && !expanded ? `<figure class="stop-cover"><img src="${escapeHtml(preview.image)}" alt="${escapeHtml(preview.alt)}" width="1200" height="800" loading="lazy" decoding="async"><figcaption>${renderIcon("Images")}插畫</figcaption></figure>` : ""}<button id="itinerary-stop-${id}" class="button button-primary itinerary-stop-toggle" data-attraction-toggle="${id}" aria-label="${expanded ? "收起本站操作" : "打卡與拍照"}：${escapeHtml(stop.label)}" aria-expanded="${expanded}" aria-controls="itinerary-details-${id}">${expanded ? "收起本站操作" : "打卡與拍照"}</button><div id="itinerary-details-${id}" class="itinerary-stop-details" ${expanded ? "" : "hidden"}>${expanded ? renderAttraction(model, { showTitle: stop.label !== model.attraction.name }) : ""}</div></li>`;
                  }).join("")}
                </ol>
              </div>
            </article>`).join("")}
        </div>
        ${renderDeviceSettings(model)}
      </section>`;
  }

  function renderIntroduction({ introduction }) {
    const imageMarkup = image => `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt)}" width="${image.width}" height="${image.height}" loading="lazy" decoding="async">`;
    return `<div class="introduction-source">
        ${introduction.pages.map((page, index) => {
            const showHeading = page.heading && index !== 0;
            const headingLevel = 2;
            const topicLevel = showHeading ? 3 : 2;
            const labelId = showHeading ? `introduction-page-${index}` : `introduction-topic-${index}-0`;
            return `<article class="introduction-panel" aria-labelledby="${labelId}">
              ${showHeading ? `<h${headingLevel} class="introduction-heading" id="introduction-page-${index}">${escapeHtml(page.heading)}</h${headingLevel}>` : ""}
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
      </div>`;
  }

  function photoPanel({ attraction, checkIn, photos = [] }) {
    if (!checkIn) return `<section class="photo-panel photo-locked"><div><h2>紀念相片</h2><p>完成景點打卡後即可拍攝相片。</p></div></section>`;
    return `
      <section class="photo-panel">
        <div><h2>${photos.length ? `已保存 ${photos.length} 張相片` : "紀念相片"}</h2>
          <p class="privacy-note">相片不會上傳；拍到同學前請先取得同意。</p>
        </div>
        <div>
          <div class="photo-actions">
            <button id="itinerary-camera-native-${attraction.id}" class="button button-primary" data-native-camera-open="${attraction.id}">用手機相機拍攝</button>
            <button id="itinerary-camera-web-${attraction.id}" class="button button-secondary" data-camera-open="${attraction.id}">使用網頁相機</button>
          </div>
          <p class="privacy-note">查看及下載相片，請按底部的「旅途回憶」。</p>
        </div>
      </section>`;
  }

  function renderAttraction(model, { showTitle = true } = {}) {
    const { attraction, checkIn } = model;
    const checkInAction = checkIn
      ? `<div class="checked-in-panel">
           <div><h2>${testOnly ? "測試打卡完成" : "已完成本站打卡"}</h2><p class="checkin-record">${checkInBadge(checkIn)}<time>${formatDateTime(checkIn.checkedInAt)}</time></p><p class="privacy-note">${testOnly ? "測試紀錄未核實到訪，不作課業或出席證明。" : "個人紀錄，不作校方出席證明。"}</p></div>
           <button id="itinerary-checkin-${attraction.id}" class="button button-secondary button-small" data-checkin-undo="${attraction.id}">取消打卡</button>
         </div>`
      : `<div class="checkin-panel">
           <div><h2>${testOnly ? "預演景點打卡" : "在景點附近打卡"}</h2><p>${testOnly ? "使用上方的模擬位置，不讀取實際位置。" : "只讀取一次位置，不保存座標。"}</p></div>
           <button id="itinerary-checkin-${attraction.id}" class="button button-primary" data-checkin="${attraction.id}">到埗打卡</button>
         </div>`;

    return `
      <article class="attraction-inline" aria-label="${escapeHtml(attraction.name)}">
        <div class="detail-hero${attraction.id === "departure-school" ? " school-hero" : ""}">
          <header class="detail-hero-overlay">
            ${showTitle ? `<h3>${escapeHtml(attraction.name)}</h3>` : ""}<p class="detail-address">${escapeHtml(attraction.city)} · ${escapeHtml(attraction.address)}</p>
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
