import { WORKBOOK_PARTS, WORKBOOK_RATINGS, WORKBOOK_INSTRUCTIONS, WORKBOOK_IDENTITY_LABELS, WORKBOOK_IDENTITY_LIMITS, validateWorkbook } from "./workbook-data.js";
import { TRIP_DATA } from "./data.js";
import { createPhotoExport } from "./photos.js";

let resources;
export function loadWorkbookPDFResources() {
  resources ||= Promise.all([import("./vendor/pdf-lib-1.17.1.js"), import("./vendor/fontkit-1.1.1.js"), import("./vendor/noto-sans-hk-regular.js")])
    .then(([pdf, kit, data]) => {
      const raw = atob(data.fontBase64), bytes = Uint8Array.from(raw, char => char.charCodeAt(0));
      return { pdf, fontkit: kit.default, bytes, characterSet: new Set(kit.default.create(bytes).characterSet) };
    }).catch(error => { resources = null; throw error; });
  return resources;
}
export function validateWorkbookIdentity(identity) {
  const result = {};
  for (const [key, max] of Object.entries(WORKBOOK_IDENTITY_LIMITS)) {
    const text = typeof identity?.[key] === "string" ? identity[key].trim() : "";
    if (!text || Array.from(text).length > max) throw new Error(`請填寫${WORKBOOK_IDENTITY_LABELS[key]}（最多 ${max} 字）。`);
    result[key] = text;
  }
  return result;
}
export function assertWorkbookGlyphs(text, characterSet, position) {
  for (const char of text) {
    if (["\n", "\r", "\t"].includes(char)) continue;
    if (!characterSet.has(char.codePointAt(0)) || /[\u0000-\u001f\u007f]/.test(char)) throw new Error(`「${position}」有字型不支援的字元「${char}」（U+${char.codePointAt(0).toString(16).toUpperCase()}），請修改後重試。`);
  }
}
export function fitWorkbookImage(width, height, maxWidth, maxHeight) {
  const scale = Math.min(maxWidth / width, maxHeight / height);
  if (![width, height, scale].every(value => Number.isFinite(value) && value > 0)) throw new Error("相片尺寸無效。");
  return { width: width * scale, height: height * scale };
}
export async function createWorkbookPDF({ draft, identity, photos = [], isRelevant = () => true, onProgress = () => {}, exportPhoto = createPhotoExport, testOnly = false }) {
  const checked = validateWorkbook(draft), personal = validateWorkbookIdentity(identity);
  if (photos.length !== checked.photoIds.length || photos.some((photo, i) => photo.record?.photoId !== checked.photoIds[i])) throw new Error("文章配圖已失效，請重新選圖。");
  const ensure = () => { if (!isRelevant()) throw new Error("PDF 生成已取消或資料已改動，沒有下載舊結果。"); };
  ensure(); onProgress("正在載入本機 PDF 程式及中文字型…");
  const { pdf, fontkit, bytes, characterSet } = await loadWorkbookPDFResources();
  ensure();
  for (const field of WORKBOOK_PARTS.flatMap(part => part.fields)) assertWorkbookGlyphs(checked.answers[field.id], characterSet, field.label);
  for (const [key, text] of Object.entries(personal)) assertWorkbookGlyphs(text, characterSet, WORKBOOK_IDENTITY_LABELS[key]);
  const document = await pdf.PDFDocument.create();
  // Static HK Regular TTF: CFF OTF subsets from fontkit 1.1.1 are invalid in
  // some readers. Font build provenance is recorded in vendor/README.txt.
  document.registerFontkit(fontkit);
  const font = await document.embedFont(bytes, { subset: true });
  const green = pdf.rgb(0.043, 0.231, 0.275), muted = pdf.rgb(0.32, 0.39, 0.39), gold = pdf.rgb(0.73, 0.40, 0.15);
  document.setTitle("學習手冊"); document.setAuthor(""); document.setSubject(TRIP_DATA.title); document.setCreator("戶外學習日旅程助手");
  const [width, height] = pdf.PageSizes.A4, margin = 44, available = width - margin * 2;
  let page, y, lineCount = 0;
  const newPage = () => {
    ensure(); page = document.addPage([width, height]); y = height - 58;
    page.drawText(testOnly ? "學習手冊 · 測試預演，沒有核實到訪" : "學習手冊", { x: margin, y: height - 30, size: 9, font, color: muted });
    page.drawLine({ start: { x: margin, y: height - 37 }, end: { x: width - margin, y: height - 37 }, thickness: 0.7, color: green });
  };
  newPage();
  const room = needed => { if (y - needed < 48) newPage(); };
  const paragraph = async (value, { size = 11, color = green, gap = 9, position = "指引" } = {}) => {
    const text = String(value).replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
    assertWorkbookGlyphs(text, characterSet, position);
    const lines = [];
    for (const original of text.split("\n")) {
      let line = "", length = 0;
      for (const char of original) {
        const next = font.widthOfTextAtSize(char, size);
        if (line && length + next > available) { lines.push(line); line = ""; length = 0; }
        line += char; length += next;
      }
      lines.push(line);
    }
    for (const line of lines) {
      ensure(); room(size * 1.6); page.drawText(line, { x: margin, y, size, font, color }); y -= size * 1.6;
      if (++lineCount % 40 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    y -= gap;
  };
  const heading = async text => { room(68); await paragraph(text, { size: 16, color: gold, gap: 13 }); };
  await heading("學習手冊");
  await paragraph(TRIP_DATA.title, { size: 14 });
  await paragraph(TRIP_DATA.dateLabel);
  for (const [key, text] of Object.entries(personal)) await paragraph(`${WORKBOOK_IDENTITY_LABELS[key]}：${text}`, { position: WORKBOOK_IDENTITY_LABELS[key] });
  await paragraph("填寫進度只表示是否已填。此 PDF 用於自行保存及列印。", { size: 9, color: muted });
  for (const part of WORKBOOK_PARTS.filter(part => part.id !== "works")) {
    ensure(); onProgress(`正在排版${part.title}…`); await heading(part.title);
    for (const instruction of part.instructions || []) await paragraph(instruction, { size: 10, color: muted });
    for (const field of part.fields) {
      room(55); await paragraph(field.label, { size: 11, color: gold, gap: 4 });
      await paragraph(checked.answers[field.id].trim() ? checked.answers[field.id] : "尚未填寫", { position: field.label, gap: 17 });
    }
    if (part.id === "essay") {
      if (!photos.length) await paragraph("文章配圖：尚未選取", { size: 10, color: muted });
      for (const [index, photo] of photos.entries()) {
        ensure(); onProgress(`正在處理文章配圖 ${index + 1}／${photos.length}…`);
        try {
          // Shared exporter validates, decodes, redraws and releases each image sequentially.
          const file = await exportPhoto(photo.record, "文章配圖.jpg"); ensure();
          const image = await document.embedJpg(await file.arrayBuffer()); ensure();
          const fitted = fitWorkbookImage(image.width, image.height, available, 280);
          room(fitted.height + 44);
          await paragraph(`文章配圖 ${index + 1}：${photo.title}`, { size: 10, gap: 3 });
          page.drawImage(image, { x: margin + (available - fitted.width) / 2, y: y - fitted.height, ...fitted });
          y -= fitted.height + 22;
        } catch (cause) { ensure(); throw new Error(`文章配圖 ${index + 1}（${photo.title}）未能解碼或加入 PDF：${cause.message}`); }
      }
    }
    if (part.id === "reflection") {
      await paragraph(WORKBOOK_INSTRUCTIONS.rating, { size: 12, color: gold });
      for (const field of WORKBOOK_RATINGS) await paragraph(`${field.label}　${checked.ratings[field.id] === null ? "尚未填寫" : `${checked.ratings[field.id]}／5`}`);
    }
  }
  // Keep the media instructions and upload URL together on their own page.
  newPage();
  await heading("作品指引");
  for (const instruction of [...WORKBOOK_INSTRUCTIONS.video, ...WORKBOOK_INSTRUCTIONS.ai, WORKBOOK_INSTRUCTIONS.upload, WORKBOOK_INSTRUCTIONS.uploadUrl]) await paragraph(instruction, { size: 10, color: muted });
  await paragraph("上傳頁只用於短片與 AI 圖片；文字課業 PDF 請自行保存及列印。", { size: 10, color: muted });
  document.getPages().forEach((item, index) => item.drawText(`${index + 1} / ${document.getPageCount()}`, { x: width - margin - 38, y: 26, size: 9, font, color: muted }));
  ensure(); onProgress("正在完成 PDF…");
  const result = await document.save(); ensure(); return result;
}
