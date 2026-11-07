export const MAX_TRIP_MEDIA_BATCH = 30;
export const MAX_TRIP_VIDEO_BYTES = 2 * 1024 ** 3;
export const MEDIA_PREFIX_BYTES = 65536;
const MAX_PHOTO_BYTES = 20 * 1024 ** 2;

export const MEDIA_EXTENSIONS = Object.freeze({
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/3gpp": "3gp"
});

export function mediaKind(mime) { return mime.startsWith("video/") ? "video" : "photo"; }
export function isOriginalMedia(mime) {
  return mediaKind(mime) === "video" || mime === "image/heic" || mime === "image/heif";
}

export function detectMediaType(bytes, fileSize) {
  const text = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  if (text(0, 3) === "\xff\xd8\xff") return "image/jpeg";
  if (text(0, 8) === "\x89PNG\r\n\x1a\n") return "image/png";
  if (text(0, 4) === "RIFF" && text(8, 12) === "WEBP") return "image/webp";
  if (text(0, 4) === "\x1a\x45\xdf\xa3" && bytes.some((byte, i) =>
    byte === 0x42 && bytes[i + 1] === 0x82 && bytes[i + 2] === 0x84 && text(i + 3, i + 7) === "webm")) return "video/webm";
  if (bytes.length < 8) return null;
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  const atom = text(4, 8);
  if (["moov", "mdat", "wide"].includes(atom) && fileSize > 8 && (size === 0 || size >= 8 && size <= fileSize)) return "video/quicktime";
  if (atom !== "ftyp" || size < 16 || size > bytes.length || size % 4) return null;
  const brands = [text(8, 12)];
  for (let offset = 16; offset < size; offset += 4) brands.push(text(offset, offset + 4));
  if (brands.some(brand => ["avif", "avis"].includes(brand))) return null;
  if (brands.some(brand => /^(heic|heix|hevc|hevx|heim|heis|hevm|hevs)$/.test(brand))) return "image/heic";
  if (brands.some(brand => ["mif1", "msf1"].includes(brand))) return "image/heif";
  if (brands.includes("qt  ")) return "video/quicktime";
  if (brands.some(brand => /^3g[pge][0-9a-z]$/.test(brand))) return "video/3gpp";
  if (brands.some(brand => /^(isom|iso[2-6]|mp4[12]|avc1|hvc1|hev1|M4V |MSNV|dash)$/.test(brand))) return "video/mp4";
  return null;
}

export async function validateTripMedia(file) {
  if (!file.size) throw Error("檔案是空的。");
  if (file.size > MAX_TRIP_VIDEO_BYTES) throw Error("檔案超過 2 GB。");
  const mime = detectMediaType(new Uint8Array(await file.slice(0, MEDIA_PREFIX_BYTES).arrayBuffer()), file.size);
  if (!mime) throw Error("檔案格式不支援或內容無效。");
  if (mediaKind(mime) === "photo" && file.size > MAX_PHOTO_BYTES) throw Error("相片超過 20 MB。");
  const extension = file.name?.split(".").pop().toLowerCase();
  const declared = Object.keys(MEDIA_EXTENSIONS).find(type => MEDIA_EXTENSIONS[type] === extension)
    || ({ jpeg: "image/jpeg", "3gpp": "video/3gpp" })[extension];
  if (declared && declared !== mime && !(["image/heic", "image/heif"].includes(declared) && ["image/heic", "image/heif"].includes(mime))) {
    throw Error("副檔名與檔案內容不符。");
  }
  return mime;
}
