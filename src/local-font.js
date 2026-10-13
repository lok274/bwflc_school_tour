// Same-origin font resources for local artwork exports.
let resources, canvasFont;
const attempts = new Map();
async function importFont(path) {
  const attempt = attempts.get(path) || 0;
  try {
    // Browsers remember failed module URLs; a fresh URL makes retry possible.
    return await import(attempt ? `${path}?font-retry=${attempt}` : path);
  } catch (error) {
    attempts.set(path, attempt + 1);
    throw error;
  }
}
export function loadLocalFont() {
  resources ||= Promise.all([importFont("./vendor/fontkit-1.1.1.js"), importFont("./vendor/noto-sans-hk-regular.js")])
    .then(([kit, data]) => {
      const bytes = Uint8Array.from(atob(data.fontBase64), char => char.charCodeAt(0));
      return { fontkit: kit.default, bytes, characterSet: new Set(kit.default.create(bytes).characterSet) };
    }).catch(error => { resources = null; throw error; });
  return resources;
}
export function assertLocalGlyphs(text, characterSet, position) {
  for (const char of text) {
    if (["\n", "\r", "\t"].includes(char)) continue;
    if (!characterSet.has(char.codePointAt(0)) || /[\u0000-\u001f\u007f]/.test(char)) throw new Error(`「${position}」含不支援的文字「${char}」，請修改後重試。`);
  }
}
export async function loadSignatureFont() {
  const loaded = await loadLocalFont();
  canvasFont ||= (async () => {
    const face = await new FontFace("JourneySignatureNotoHK", loaded.bytes).load();
    document.fonts.add(face);
    return "JourneySignatureNotoHK";
  })().catch(() => { canvasFont = null; throw new Error("未能準備作品文字，請重試。"); });
  return { ...loaded, family: await canvasFont };
}
