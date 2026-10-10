import { REQUIRED_CHECK_IN_LOCATIONS } from "./data.js";
import { STUDENT_IDENTITY_LABELS, validateStudentIdentity } from "./app-settings.js";
import { loadSignatureFont, assertLocalGlyphs } from "./local-font.js";

export function checkInCardRecords(completion) {
  const source = completion?.records;
  if (!completion?.ready || ![null, undefined, "rehearsal"].includes(completion.testKind)
    || !Array.isArray(source) || source.length !== REQUIRED_CHECK_IN_LOCATIONS.length
    || new Set(source.map(record => record?.attractionId)).size !== source.length) {
    throw new Error("請先完成五個必需景點打卡；學校不列入這張紀錄卡。");
  }
  return Object.freeze(REQUIRED_CHECK_IN_LOCATIONS.map(attraction => {
    const record = source.find(item => item?.attractionId === attraction.id);
    if (!record || typeof record.checkedInAt !== "string" || !Number.isFinite(Date.parse(record.checkedInAt))
      || !["gps", "manual"].includes(record.method) || record.verified !== (record.method === "gps")) {
      throw new Error("五站打卡紀錄已失效，請重新檢查。");
    }
    return Object.freeze({ attractionId: attraction.id, name: attraction.name,
      checkedInAt: new Date(record.checkedInAt).toISOString(), method: record.method, verified: record.verified });
  }));
}

export function checkInCardLabel(completion) {
  const records = checkInCardRecords(completion), count = `${records.length}／${REQUIRED_CHECK_IN_LOCATIONS.length}`;
  if (completion.testKind === "rehearsal") return `五站測試打卡完成：${count} · ${records.every(item => item.verified) ? "五站模擬定位通過" : "含測試手動記錄 · 未核實"}`;
  return `五站打卡完成紀錄：${count} · ${records.every(item => item.verified) ? "五站 GPS 已核實" : "含未核實手動記錄"}`;
}

function wrap(context, text, size, width, family) {
  context.font = `${size}px ${family}`;
  const lines = []; let line = "";
  for (const character of text) {
    if (line && context.measureText(line + character).width > width) { lines.push(line); line = ""; }
    line += character;
  }
  lines.push(line);
  return { lines, size, height: lines.length * Math.ceil(size * 1.5) };
}

export async function createCheckInCompletionCard({ completion, identity, tripTitle, dateLabel, isRelevant = () => true }) {
  const personal = validateStudentIdentity(identity), records = checkInCardRecords(completion);
  const test = completion.testKind === "rehearsal";
  const ensure = () => { if (!isRelevant()) throw new Error("紀錄卡生成已取消或資料已改動，沒有下載舊結果。"); };
  ensure();
  const font = await loadSignatureFont();
  ensure();
  const headerText = [test ? "五站測試打卡紀錄" : "五站打卡完成紀錄", String(tripTitle || "戶外學習日"), String(dateLabel || ""),
    ...Object.entries(personal).map(([key, value]) => `${STUDENT_IDENTITY_LABELS[key]}：${value}`), checkInCardLabel(completion)];
  headerText.forEach((line, index) => assertLocalGlyphs(line, font.characterSet,
    index >= 3 && index <= 5 ? Object.values(STUDENT_IDENTITY_LABELS)[index - 3] : "紀錄卡標題"));
  const disclaimer = test ? "完整行程預演：模擬紀錄，沒有核實真正到訪，不作課業或出席證明。"
    : "此卡為本機打卡紀錄，不代表校方核實出席或學生身份。";
  const dateFormatter = new Intl.DateTimeFormat("zh-HK", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const canvas = document.createElement("canvas"), context = canvas.getContext("2d");
  if (!context) throw new Error("此瀏覽器未能建立紀錄卡圖片，請重試。");
  const width = 1080, margin = 48, gap = 24, sizes = [44, 30, 26, 34, 34, 34, 28];
  const header = headerText.map((line, index) => wrap(context, line, sizes[index], width - margin * 2, font.family));
  const cards = records.map((record, index) => {
    const status = record.verified ? test ? "模擬定位通過" : "GPS 已核實" : test ? "測試手動記錄 · 未核實" : "未核實手動記錄";
    const lines = [`第 ${index + 1} 站`, record.name, `打卡時間（香港時間）：${dateFormatter.format(new Date(record.checkedInAt))}`, status];
    lines.forEach(line => assertLocalGlyphs(line, font.characterSet, record.name));
    const content = lines.map((line, position) => wrap(context, line, [24, 38, 28, 28][position], 744, font.family));
    return { verified: record.verified, content, height: Math.max(210, 64 + content.reduce((sum, item) => sum + item.height + 10, 0)) };
  });
  assertLocalGlyphs(disclaimer, font.characterSet, "紀錄卡說明");
  const footer = wrap(context, disclaimer, 26, width - margin * 2, font.family);
  const headerHeight = 80 + header.reduce((sum, item) => sum + item.height + 12, 0);
  canvas.width = width;
  canvas.height = headerHeight + margin + cards.reduce((sum, item) => sum + item.height + gap, 0) + footer.height + margin * 2;
  context.textBaseline = "top";
  context.fillStyle = "#f8f2e6"; context.fillRect(0, 0, width, canvas.height);
  context.fillStyle = "#0b3b46"; context.fillRect(0, 0, width, headerHeight);
  function drawText(item, x, y, color) {
    context.font = `${item.size}px ${font.family}`; context.fillStyle = color;
    for (const line of item.lines) { context.fillText(line, x, y); y += Math.ceil(item.size * 1.5); }
    return y;
  }
  let y = 40;
  for (const [index, item] of header.entries()) y = drawText(item, margin, y, index === 0 || index === 6 ? "#f3b955" : "#fffaf0") + 12;
  context.fillStyle = "#f3b955"; context.fillRect(0, headerHeight - 8, width, 8);
  y = headerHeight + margin;
  for (const card of cards) {
    ensure();
    context.fillStyle = card.verified ? "#edf8f3" : "#fff7e9"; context.fillRect(margin, y, width - margin * 2, card.height);
    context.strokeStyle = card.verified ? "#25805d" : "#9a6d29"; context.lineWidth = 3;
    context.strokeRect(margin, y, width - margin * 2, card.height);
    context.beginPath(); context.arc(margin + 72, y + 80, 48, 0, Math.PI * 2); context.stroke();
    const stamp = wrap(context, test ? "測試" : "已完成", 24, 96, font.family);
    drawText(stamp, margin + (test ? 48 : 36), y + 64, card.verified ? "#25805d" : "#9a6d29");
    let cardY = y + 32;
    for (const [index, item] of card.content.entries()) cardY = drawText(item, margin + 176, cardY,
      index === 3 ? card.verified ? "#176245" : "#82551d" : "#0b3b46") + 10;
    y += card.height + gap;
  }
  drawText(footer, margin, y + 12, "#0b3b46");
  ensure();
  const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value?.type === "image/png" ? resolve(value) : reject(new Error("未能生成 PNG 紀錄卡，請重試。")), "image/png"));
  ensure();
  return blob;
}
