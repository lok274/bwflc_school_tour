import { readonlyCopy } from "./store.js";

export const WORKBOOK_ACTIVITY = "bwflc-2026-11-05";
export const WORKBOOK_FORMAT = 1;
export const MAX_WORKBOOK_TEXT = 1000;
// Preserve previously saved text for recovery, without accepting it for new writes.
export const MAX_LEGACY_WORKBOOK_TEXT = 10000;
export const MAX_BACKUP_BYTES = 1024 * 1024;
export const WORKBOOK_IDENTITY_LIMITS = Object.freeze({ studentName: 40, className: 20, studentNumber: 20 });
export const WORKBOOK_IDENTITY_LABELS = Object.freeze({ studentName: "姓名", className: "班別", studentNumber: "學號" });
// Transcribed from physical PDF pages 14–19. Original punctuation and source typo retained.
export const WORKBOOK_INSTRUCTIONS = readonlyCopy({
  essay: ["在整個學習交流團中，同學必定有深刻體會與得益。請配合以下元素，撰寫文章，配以圖片完成此部份，字數約600字，題目自擬。", "1.姊妹學校交流", "2.嶺南文化", "3.國家情懷"],
  share: ["活動期間會進行分組分享，內容包括：", "1.介紹景點", "2.回顧整天行程", "3.簡單問答", "同學請留意交流團的行程及活動，以準備分享。"],
  video: ["每組於活動中拍攝活動花絮，並剪輯成約2分鐘片段。", "內容包括：景點介紹、組員感想"],
  ai: ["每位同學於活動期間拍攝數張具當地特色的照片，照片中須包括自己或同學。完成旅程後利用AI工具把數張照片的特點合成為一張圖片。", "小提示：萬用 Prompt 組合公式", "[角色] + [背景] + [任務] + [限制/要求] + [輸出格式]", "例子：我是一名中學生，參加學校舉辦往東莞、中山及順德的交流團，當中到訪東莞的姊妹學校、體驗製作倫教糕及參觀歷史文化景點。我現在把5張交流團期間拍攝的照片上傳，請幫我就照片內具特色的地方合成為一張圖片。合成的圖片須包括每張相片的重點部分，相片間過渡要流暢。圖片中要顯示我的姓名 (XXX)。"],
  upload: "請把片段及生成的圖片上傳到以下的網頁。",
  uploadUrl: "https://driveuploader.com/upload/VR0KPpgHvk/",
  rating: "在整個境外學習之旅中，我覺得自己（5為最好）"
});
const fields = (prefix, labels) => labels.map((label, index) => ({ id: `${prefix}-${index + 1}`, label }));
const dayCommon = ["今天行程", "今天，我認識了....", "參觀了各項考察點後，我覺得....", "今天，我做得好的是", "今天，我要改善的是"];
export const WORKBOOK_PARTS = readonlyCopy([
  { id: "essay", title: "圖文文章", fields: [{ id: "essay-title", label: "自擬題目" }, { id: "essay-body", label: "正文" }], instructions: WORKBOOK_INSTRUCTIONS.essay },
  { id: "share", title: "分組分享", fields: fields("share", ["介紹景點", "回顧整天行程", "簡單問答"]), instructions: WORKBOOK_INSTRUCTIONS.share },
  { id: "day1", title: "第一日日記", fields: fields("day1", ["今天，我在姊妹學校參與的活動是", "今天，我認識了....", "參與松山湖未來學校的課堂後, 我認為...", "今天我認識了幾位新朋友，他們是", "參與松山湖未來學校的活動後，令我印象最深刻的是...", "今天，我做得好的是", "今天，我要改善的是"]) },
  { id: "day2", title: "第二日日記", fields: fields("day2", [...dayCommon, "孫中山先生當年為了拯救國家，毅然放棄個人的舒適生活，甚至遠赴海外尋求救國道路。身為現代的青年，你在參觀故居後，認為『愛國』在今天有甚麼新的時代意義？我們又能如何在日常生活中，將這種對國家與社會的責任感落實出來？"]) },
  { id: "day3", title: "第三日日記", fields: fields("day3", [...dayCommon, "你認為這些世代相傳的『非物質文化遺產與傳統習俗』，如何形塑我們的文化根基與國民身份認同？在面對全球化與現代化的衝擊時，身為年輕一代，我們應該如何兼顧傳統文化的保護與創新？"]) },
  { id: "reflection", title: "活動反思", fields: fields("reflection", ["這三天內，我最大的得著是....", "這三天有甚麼事物是令你印象最深刻的？"]) },
  { id: "works", title: "作品指引", fields: [] }
]);
export const WORKBOOK_RATINGS = readonlyCopy(fields("rating", ["我有實踐｢鳳翎精神｣。", "我仔細閱讀有關考寫點介紹的資料。", "我盡力整理及組織所搜集的資料。", "我能根據資料，認識及瞭解考察景點。", "在每項活動中，我都主動參與。", "遇到困難時，我嘗試找方法去解決。", "我盡力完成這份學習手冊。", "當導師及老師講解時，我用心聆聽。"]));
export const WORKBOOK_FIELDS = readonlyCopy(WORKBOOK_PARTS.flatMap(part => part.fields));
export function emptyWorkbook() {
  return { answers: Object.fromEntries(WORKBOOK_FIELDS.map(field => [field.id, ""])), ratings: Object.fromEntries(WORKBOOK_RATINGS.map(field => [field.id, null])), photoIds: [] };
}
export function validateWorkbook(value, { backup = false, allowLegacyText = false } = {}) {
  const plain = object => object && typeof object === "object" && !Array.isArray(object);
  if (!plain(value) || !plain(value.answers) || !plain(value.ratings)) throw new Error("手冊內容格式無效。");
  const expected = backup ? ["answers", "ratings"] : ["answers", "ratings", "photoIds"];
  if (Object.keys(value).some(key => !expected.includes(key))) throw new Error("手冊包含不允許的資料。");
  const result = emptyWorkbook();
  if (Object.keys(value.answers).length !== WORKBOOK_FIELDS.length || Object.keys(value.ratings).length !== WORKBOOK_RATINGS.length) throw new Error("手冊欄位不相容。");
  for (const field of WORKBOOK_FIELDS) {
    const text = value.answers[field.id];
    const maximum = allowLegacyText ? MAX_LEGACY_WORKBOOK_TEXT : MAX_WORKBOOK_TEXT;
    if (typeof text !== "string" || text.length > maximum) throw new Error(`「${field.label}」格式無效或超過 ${maximum.toLocaleString("en-US")} 字元。`);
    result.answers[field.id] = text;
  }
  for (const field of WORKBOOK_RATINGS) {
    const rating = value.ratings[field.id];
    if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) throw new Error(`「${field.label}」評分無效。`);
    result.ratings[field.id] = rating;
  }
  if (!backup) {
    if (!Array.isArray(value.photoIds) || value.photoIds.length > 6 || new Set(value.photoIds).size !== value.photoIds.length || value.photoIds.some(id => typeof id !== "string" || !id || id.length > 200)) throw new Error("選圖資料無效。");
    result.photoIds = [...value.photoIds];
  }
  return result;
}
export function workbookProgress(draft) {
  return WORKBOOK_PARTS.map(part => {
    const checks = part.fields.map(field => Boolean(draft.answers[field.id].trim()));
    if (part.id === "reflection") checks.push(...WORKBOOK_RATINGS.map(field => draft.ratings[field.id] !== null));
    return { id: part.id, title: part.title, filled: checks.filter(Boolean).length, total: checks.length };
  });
}
export function workbookResumePart(draft) {
  const oversized = WORKBOOK_PARTS.find(part => part.fields.some(field => draft.answers[field.id].length > MAX_WORKBOOK_TEXT));
  if (oversized) return oversized.id;
  const progress = workbookProgress(draft);
  if (!progress.some(part => part.filled)) return null;
  return progress.find(part => part.total && part.filled < part.total)?.id || "essay";
}
export function missingWorkbookFields(draft) {
  return [...WORKBOOK_FIELDS.filter(field => !draft.answers[field.id].trim()), ...WORKBOOK_RATINGS.filter(field => draft.ratings[field.id] === null)].map(field => field.label);
}
export function workbookTextLimitError(draft) {
  const fields = WORKBOOK_PARTS.flatMap(part => part.fields.filter(field => draft.answers[field.id].length > MAX_WORKBOOK_TEXT).map(field => `${part.title}：${field.label}`));
  return fields.length ? `以下欄位超過 ${MAX_WORKBOOK_TEXT.toLocaleString("en-US")} 字元：${fields.join("；")}。原文已保留，可先下載備份；請縮短至上限後再保存或下載 PDF。` : "";
}
export function createWorkbookBackup(draft) {
  const checked = validateWorkbook(draft, { allowLegacyText: true });
  return JSON.stringify({ format: WORKBOOK_FORMAT, activity: WORKBOOK_ACTIVITY, answers: checked.answers, ratings: checked.ratings }, null, 2);
}
export function parseWorkbookBackup(text, { allowLegacyText = false } = {}) {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw new Error("備份不可超過 1 MiB。");
  let value;
  try { value = JSON.parse(text); } catch { throw new Error("未能讀取這份備份檔，請選取由學習手冊保存的備份。"); }
  if (!value || value.format !== WORKBOOK_FORMAT || value.activity !== WORKBOOK_ACTIVITY || Object.keys(value).some(key => !["format", "activity", "answers", "ratings"].includes(key))) throw new Error("備份版本或活動不相容，或含有不允許的資料。");
  return validateWorkbook({ answers: value.answers, ratings: value.ratings }, { backup: true, allowLegacyText });
}
