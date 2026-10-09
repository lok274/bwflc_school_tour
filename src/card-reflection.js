export const MAX_REFLECTION_LENGTH = 80;
export const SUMMARY_IDENTITY_LIMITS = Object.freeze({ studentName: 40, className: 20, studentNumber: 20 });
export const SUMMARY_IDENTITY_LABELS = Object.freeze({ studentName: "姓名", className: "班別", studentNumber: "學號" });

function cleanSummaryField(value, trim = true) {
  const text = (typeof value === "string" ? value : "").replace(/\s+/gu, " ")
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "");
  return trim ? text.trim() : text;
}

export function limitSummaryField(value, field) {
  const maximum = SUMMARY_IDENTITY_LIMITS[field];
  return maximum ? Array.from(cleanSummaryField(value, false)).slice(0, maximum).join("") : "";
}

export function missingSummaryIdentity(identity = {}) {
  return Object.keys(SUMMARY_IDENTITY_LIMITS).filter(field => !cleanSummaryField(identity[field])).map(field => SUMMARY_IDENTITY_LABELS[field]);
}

export function normalizeSummaryIdentity({ studentName = "", className = "", studentNumber = "" } = {}) {
  return Object.fromEntries(Object.entries({ studentName, className, studentNumber }).map(([field, value]) => {
    const text = cleanSummaryField(value);
    if (!text) throw new Error(`請填寫${SUMMARY_IDENTITY_LABELS[field]}，才能下載 AI 融合圖片素材包。`);
    if (Array.from(text).length > SUMMARY_IDENTITY_LIMITS[field]) {
      throw new Error(`${SUMMARY_IDENTITY_LABELS[field]}最多 ${SUMMARY_IDENTITY_LIMITS[field]} 字，請縮短後再下載。`);
    }
    return [field, text];
  }));
}

export function countReflectionCharacters(value) {
  return Array.from(typeof value === "string" ? value : "").length;
}

export function limitCardReflection(value) {
  return Array.from(typeof value === "string" ? value : "").slice(0, MAX_REFLECTION_LENGTH).join("");
}

export function normalizeCardReflection(value) {
  if (typeof value !== "string") return "";
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/gu, " ").trim();
  if (countReflectionCharacters(text) > MAX_REFLECTION_LENGTH) throw new Error(`感想文字最多 ${MAX_REFLECTION_LENGTH} 字，請縮短後再下載。`);
  return text;
}

export function wrapCardReflection(context, text, width) {
  const lines = [];
  const segments = typeof Intl.Segmenter === "function"
    ? [...new Intl.Segmenter("zh-HK", { granularity: "grapheme" }).segment(text)].map(item => item.segment)
    : Array.from(text);
  let line = "";
  for (const character of segments) {
    if (line && context.measureText(line + character).width > width) {
      lines.push(line); line = "";
    }
    line += character;
  }
  if (line) lines.push(line);
  return lines;
}
