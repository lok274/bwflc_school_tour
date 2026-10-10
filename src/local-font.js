// Same-origin font resources shared by PDF and local artwork exports.
let resources, canvasFont;
export function loadLocalFont() {
  resources ||= Promise.all([import("./vendor/fontkit-1.1.1.js"), import("./vendor/noto-sans-hk-regular.js")])
    .then(([kit, data]) => {
      const bytes = Uint8Array.from(atob(data.fontBase64), char => char.charCodeAt(0));
      return { fontkit: kit.default, bytes, characterSet: new Set(kit.default.create(bytes).characterSet) };
    }).catch(error => { resources = null; throw error; });
  return resources;
}
export function assertLocalGlyphs(text, characterSet, position) {
  for (const char of text) {
    if (["\n", "\r", "\t"].includes(char)) continue;
    if (!characterSet.has(char.codePointAt(0)) || /[\u0000-\u001f\u007f]/.test(char)) throw new Error(`「${position}」有字型不支援的字元「${char}」（U+${char.codePointAt(0).toString(16).toUpperCase()}），請修改後重試。`);
  }
}
export async function loadSignatureFont() {
  const loaded = await loadLocalFont();
  canvasFont ||= (async () => {
    const face = await new FontFace("JourneySignatureNotoHK", loaded.bytes).load();
    document.fonts.add(face);
    return "JourneySignatureNotoHK";
  })().catch(error => { canvasFont = null; throw new Error(`未能載入本機中文字型，請重試。${error.message || ""}`); });
  return { ...loaded, family: await canvasFont };
}
