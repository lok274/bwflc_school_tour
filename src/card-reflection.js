export const MAX_REFLECTION_LENGTH = 80;

export function normalizeCardReflection(value) {
  if (typeof value !== "string") return "";
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/gu, " ").trim();
  if (Array.from(text).length > MAX_REFLECTION_LENGTH) throw new Error("感想文字最多 80 字，請縮短後再下載。");
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
