import { normalizeCardReflection, wrapCardReflection, normalizeSummaryIdentity } from "./card-reflection.js";
import { CHECK_IN_LOCATIONS, REQUIRED_CHECK_IN_LOCATIONS } from "./data.js";
import { createPhotoArchive } from "./photo-archive.js";
import { DEVICE_TEST_LOCATION } from "./device-test-data.js";
const DATABASE_NAME = "outdoorLearningDay.photos";
const STORE_NAME = "photoEntries";
const DATABASE_VERSION = 2;
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_EDGE = 1600;
const MAX_SOURCE_EDGE = 8192;
const MAX_SOURCE_PIXELS = 50_000_000;
const MAX_HEADER_PARTS = 4096;
const WEBP_QUALITY = 0.82;
const PHOTO_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

// Encoded bytes, source pixels and output pixels have separate budgets.
export async function validatePhotoInput(input) {
  if (!(input instanceof Blob) || !input.size) throw new Error("未選取有效相片。 ");
  if (input.size > MAX_INPUT_BYTES) throw new Error("相片超過 20MB，請選擇較小的檔案。 ");
  if (input.type && !PHOTO_MIME_TYPES.has(input.type)) {
    throw new Error("只接受靜態 JPEG、PNG 或 WebP 點陣相片；不接受 SVG，HEIC／HEIF 請先轉成 JPEG。 ");
  }
  const bytes = new Uint8Array(await input.slice(0, 512).arrayBuffer());
  const matches = (offset, signature) => signature.every((value, index) => bytes[offset + index] === value);
  const ascii = (offset, count) => String.fromCharCode(...bytes.slice(offset, offset + count));
  let mime;
  if (matches(0, [0xff, 0xd8, 0xff])) mime = "image/jpeg";
  else if (matches(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) mime = "image/png";
  else if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") mime = "image/webp";
  else if (bytes.length >= 16 && ascii(4, 4) === "ftyp") {
    const boxSize = new DataView(bytes.buffer).getUint32(0);
    const brands = [ascii(8, 4)];
    for (let offset = 16; offset + 4 <= Math.min(boxSize, bytes.length); offset += 4) {
      brands.push(ascii(offset, 4));
    }
    const heifBrands = ["heic", "heix", "hevc", "hevx", "mif1", "msf1"];
    if (boxSize >= 16 && boxSize <= bytes.length && boxSize <= input.size && boxSize % 4 === 0 && !brands.some((brand) => ["avif", "avis"].includes(brand)) && brands.some((brand) => heifBrands.includes(brand))) {
      mime = "image/heif";
    }
  }
  const isHeif = mime === "image/heif" && ["image/heic", "image/heif"].includes(input.type);
  if (!mime || (input.type && input.type !== mime && !isHeif)) {
    throw new Error("檔案內容不是支援的點陣相片，或與宣告格式不符。請改用靜態 JPEG、PNG 或 WebP。 ");
  }
  if (mime === "image/heif") {
    throw new Error("暫不直接支援 HEIC／HEIF。請先在手機轉成 JPEG，再加入相片。");
  }
  inspectPhotoDimensions(new Uint8Array(await input.arrayBuffer()), mime);
  return mime;
}

function assertSourceDimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error("未能安全核對相片尺寸。請改用靜態 JPEG、PNG 或 WebP。");
  }
  if (Math.max(width, height) > MAX_SOURCE_EDGE || width * height > MAX_SOURCE_PIXELS) {
    throw new Error("相片尺寸過大：寬高不可超過 8192px，總像素不可超過 5000 萬。請先縮小相片。");
  }
  return { width, height };
}

// Walk the entire bounded container: a small first header must not hide another frame.
function inspectPhotoDimensions(bytes, mime) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const invalid = () => { throw new Error("未能安全核對相片尺寸或檔案結構。請改用靜態 JPEG、PNG 或 WebP。"); };
  const text = (offset, count) => String.fromCharCode(...bytes.subarray(offset, offset + count));
  const dimensions = (width, height) => assertSourceDimensions(width, height);
  const animation = () => { throw new Error("只接受靜態相片；請先將動畫圖片轉成靜態 JPEG 或 PNG。"); };
  let parts = 0;
  const nextPart = () => { if (++parts > MAX_HEADER_PARTS) invalid(); };
  let size;
  if (mime === "image/png") {
    let offset = 8, hasPixels = false;
    while (offset + 12 <= bytes.length) {
      nextPart();
      const length = view.getUint32(offset), kind = text(offset + 4, 4);
      const end = offset + 12 + length;
      if (end > bytes.length) invalid();
      if (kind === "IHDR") {
        if (offset !== 8 || length !== 13 || size) invalid();
        size = dimensions(view.getUint32(offset + 8), view.getUint32(offset + 12));
      } else if (!size) invalid();
      if (["acTL", "fcTL", "fdAT"].includes(kind)) animation();
      if (kind === "IDAT" && length) hasPixels = true;
      if (kind === "IEND") {
        if (length || end !== bytes.length || !hasPixels) invalid();
        return size;
      }
      offset = end;
    }
    invalid();
  }
  if (mime === "image/webp") {
    if (bytes.length < 20 || view.getUint32(4, true) + 8 !== bytes.length) invalid();
    let offset = 12, canvas;
    const uint24 = (start) => bytes[start] | (bytes[start + 1] << 8) | (bytes[start + 2] << 16);
    while (offset + 8 <= bytes.length) {
      nextPart();
      const kind = text(offset, 4), length = view.getUint32(offset + 4, true), data = offset + 8;
      const end = data + length + (length & 1);
      if (end > bytes.length || (offset === 12 && !["VP8X", "VP8 ", "VP8L"].includes(kind))) invalid();
      if (["ANIM", "ANMF"].includes(kind)) animation();
      if (kind === "VP8X") {
        if (offset !== 12 || length !== 10 || canvas) invalid();
        if (bytes[data] & 2) animation();
        canvas = dimensions(uint24(data + 4) + 1, uint24(data + 7) + 1);
      } else if (kind === "VP8 " || kind === "VP8L") {
        if (size) invalid();
        if (kind === "VP8 ") {
          if (length < 10 || (bytes[data] & 1) || text(data + 3, 3) !== "\u009d\u0001\u002a") invalid();
          const width = view.getUint16(data + 6, true), height = view.getUint16(data + 8, true);
          if ((width | height) & 0xc000) invalid();
          size = dimensions(width, height);
        } else {
          if (length < 5 || bytes[data] !== 0x2f) invalid();
          const packed = view.getUint32(data + 1, true);
          if (packed >>> 29) invalid();
          size = dimensions((packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1);
        }
      }
      offset = end;
    }
    if (offset !== bytes.length || !size || (canvas && (canvas.width !== size.width || canvas.height !== size.height))) invalid();
    return size;
  }
  if (mime === "image/jpeg") {
    let offset = 2, inScan = false, sawScan = false;
    while (offset < bytes.length) {
      if (inScan && bytes[offset] !== 0xff) { offset++; continue; }
      if (bytes[offset++] !== 0xff) invalid();
      while (bytes[offset] === 0xff) offset++;
      if (offset >= bytes.length) invalid();
      const marker = bytes[offset++];
      if (inScan && (marker === 0 || (marker >= 0xd0 && marker <= 0xd7))) continue;
      inScan = false;
      nextPart();
      if (marker === 0xd9) {
        if (!size || !sawScan || offset !== bytes.length) invalid();
        return size;
      }
      if (marker === 0 || marker === 0xd8 || marker === 0xdc || marker === 0xde || marker === 0xdf
        || (marker >= 0xd0 && marker <= 0xd7)) invalid();
      if (marker === 1) continue;
      if (offset + 2 > bytes.length) invalid();
      const length = view.getUint16(offset), end = offset + length;
      if (length < 2 || end > bytes.length) invalid();
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        if (![0xc0, 0xc1, 0xc2].includes(marker) || size || length < 11 || bytes[offset + 2] !== 8) invalid();
        const components = bytes[offset + 7];
        if (![1, 3, 4].includes(components) || length !== 8 + 3 * components) invalid();
        size = dimensions(view.getUint16(offset + 5), view.getUint16(offset + 3));
      }
      if (marker === 0xe2 && text(offset + 2, 4) === "MPF\u0000") invalid();
      if (marker === 0xda) {
        if (!size || length < 6 || length !== 6 + 2 * bytes[offset + 2]) invalid();
        inScan = true; sawScan = true;
      }
      offset = end;
    }
    invalid();
  }
  invalid();
}

// Version 2 copies existing photos into a store with an independent key per photo.
export function createPhotoRepository({ databaseName = DATABASE_NAME } = {}) {
  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new Error("此瀏覽器不支援本機相片資料庫。"));
        return;
      }

      const request = indexedDB.open(databaseName, DATABASE_VERSION);
      request.onerror = () => reject(request.error || new Error("未能開啟相片資料庫。"));
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: "photoId" });
          store.createIndex("attractionId", "attractionId");
          if (database.objectStoreNames.contains("photos")) {
            const cursor = request.transaction.objectStore("photos").openCursor();
            cursor.onsuccess = () => {
              if (cursor.result) {
                store.put({ ...cursor.result.value, photoId: cursor.result.value.attractionId });
                cursor.result.continue();
              } else database.deleteObjectStore("photos");
            };
          }
        }
      };
      let blocked = false;
      request.onblocked = () => {
        blocked = true;
        reject(new Error("請關閉其他已開啟的旅程 App 頁面，再重新開啟以更新相片儲存。"));
      };
      request.onsuccess = () => {
        if (blocked) { request.result.close(); return; }
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
    });
  }

  async function runTransaction(mode, operation, { canBegin = () => true } = {}) {
    const database = await openDatabase();
    try {
      if (!canBegin()) {
        database.close();
        return null;
      }
    } catch (error) {
      database.close();
      throw error;
    }
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      let request;
      try {
        request = operation(store);
      } catch (error) {
        database.close();
        reject(error);
        return;
      }

      transaction.oncomplete = () => {
        const result = request?.result;
        database.close();
        resolve(result);
      };
      transaction.onerror = () => {
        const error = transaction.error || new Error("相片資料庫操作失敗。可檢查裝置儲存空間後再試。");
        database.close();
        reject(error);
      };
      transaction.onabort = transaction.onerror;
    });
  }

  function getAllPhotoRecords() {
    return runTransaction("readonly", (store) => store.getAll());
  }

  async function getPhotoRecord(attractionId, photoId) {
    if (photoId) {
      const record = await runTransaction("readonly", (store) => store.get(photoId));
      return record?.attractionId === attractionId ? record : undefined;
    }
    const records = await runTransaction("readonly", (store) => store.index("attractionId").getAll(attractionId));
    return records.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || "")).at(-1);
  }

  function savePhotoRecord(record, options) {
    return runTransaction("readwrite", (store) => store.put({ ...record, photoId: record.photoId || record.attractionId }), options);
  }

  function deletePhotoRecord(attractionId, photoId) {
    return runTransaction("readwrite", (store) => {
      const request = store.index("attractionId").openCursor(attractionId);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (!photoId || cursor.value.photoId === photoId) cursor.delete();
        cursor.continue();
      };
      return request;
    });
  }

  function clearPhotoRecords() {
    return runTransaction("readwrite", (store) => store.clear());
  }

  return { getAllPhotoRecords, getPhotoRecord, savePhotoRecord, deletePhotoRecord, clearPhotoRecords };
}

export const { getAllPhotoRecords, getPhotoRecord, savePhotoRecord, deletePhotoRecord, clearPhotoRecords } = createPhotoRepository();

function decodeWithImageElement(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("未能讀取這張相片。請改用 JPEG、PNG 或 WebP。"));
    };
    image.src = url;
  });
}

async function decodeImage(blob) {
  // Keep this outside the fallback catch: rejected inputs must never reach either decoder.
  const mime = await validatePhotoInput(blob);
  const input = blob.type ? blob : blob.slice(0, blob.size, mime);
  let decoded;
  if (globalThis.createImageBitmap) {
    try {
      decoded = await createImageBitmap(input, { imageOrientation: "from-image" });
    } catch {
      decoded = await decodeWithImageElement(input);
    }
  } else decoded = await decodeWithImageElement(input);
  try {
    assertSourceDimensions(decoded.width || decoded.naturalWidth, decoded.height || decoded.naturalHeight);
    return decoded;
  } catch (error) { decoded.close?.(); throw error; }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("未能壓縮相片。")),
      type,
      quality
    );
  });
}

export async function compressPhoto(input, attractionId) {
  const decoded = await decodeImage(input);
  const sourceWidth = decoded.width || decoded.naturalWidth;
  const sourceHeight = decoded.height || decoded.naturalHeight;
  if (!Number.isSafeInteger(sourceWidth) || !Number.isSafeInteger(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    decoded.close?.();
    throw new Error("相片尺寸無效。 ");
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#f7f1e6";
  context.fillRect(0, 0, width, height);
  context.drawImage(decoded, 0, 0, width, height);
  decoded.close?.();

  const blob = await canvasToBlob(canvas, "image/webp", WEBP_QUALITY);
  if (!blob.size || !["image/webp", "image/png"].includes(blob.type)) {
    throw new Error("此瀏覽器未能輸出安全支援的相片格式，照片未被保存。 ");
  }
  return {
    attractionId,
    blob,
    mime: blob.type,
    width,
    height,
    createdAt: new Date().toISOString(),
    version: 1
  };
}

// Exports only the stored pixels; source files and EXIF are never copied.
export async function createPhotoExport(record, filename) {
  const decoded = await decodeImage(record?.blob);
  try {
    const width = decoded.width || decoded.naturalWidth;
    const height = decoded.height || decoded.naturalHeight;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
      || Math.max(width, height) > MAX_EDGE) throw new Error("已保存相片的尺寸無效，未能匯出。");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("此瀏覽器未能製作 JPEG 相片。");
    context.fillStyle = "#f7f1e6";
    context.fillRect(0, 0, width, height);
    context.drawImage(decoded, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, "image/jpeg", 0.92);
    if (!blob.size || blob.type !== "image/jpeg") throw new Error("此瀏覽器未能輸出 JPEG，請改用其他瀏覽器。");
    const name = String(filename || "紀念相片").replace(/\.jpe?g$/i, "")
      .replace(/[\\/<>:"|?*\u0000-\u001f\u007f]/g, "-").slice(0, 180) + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } finally {
    decoded.close?.();
  }
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function drawCoverImage(context, image, x, y, width, height) {
  const sourceRatio = image.width / image.height;
  const targetRatio = width / height;
  let sourceWidth = image.width;
  let sourceHeight = image.height;
  let sourceX = 0;
  let sourceY = 0;

  if (sourceRatio > targetRatio) {
    sourceWidth = image.height * targetRatio;
    sourceX = (image.width - sourceWidth) / 2;
  } else {
    sourceHeight = image.width / targetRatio;
    sourceY = (image.height - sourceHeight) / 2;
  }
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

export async function createTravelCard({ photoRecord, attraction, checkIn, tripTitle, reflection = "", testOnly = false }) {
  const cardReflection = normalizeCardReflection(reflection);
  const photoHeight = cardReflection ? 620 : 826;
  const metadataOffset = cardReflection ? -206 : 0;
  const image = await decodeImage(photoRecord.blob);
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const context = canvas.getContext("2d");

  const gradient = context.createLinearGradient(0, 0, 1080, 1350);
  gradient.addColorStop(0, "#0b3b46");
  gradient.addColorStop(1, "#145c62");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 1080, 1350);

  context.fillStyle = "rgba(247, 241, 230, 0.08)";
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 7; col += 1) {
      context.beginPath();
      context.arc(82 + col * 160, 68 + row * 170, 5, 0, Math.PI * 2);
      context.fill();
    }
  }

  context.save();
  roundedRect(context, 72, 72, 936, photoHeight, 42);
  context.clip();
  drawCoverImage(context, image, 72, 72, 936, photoHeight);
  const photoShade = context.createLinearGradient(0, photoHeight - 206, 0, photoHeight + 74);
  photoShade.addColorStop(0, "rgba(11,59,70,0)");
  photoShade.addColorStop(1, "rgba(11,59,70,0.58)");
  context.fillStyle = photoShade;
  context.fillRect(72, photoHeight - 286, 936, 358);
  context.restore();
  image.close?.();

  context.strokeStyle = "#f2b85b";
  context.lineWidth = 8;
  roundedRect(context, 72, 72, 936, photoHeight, 42);
  context.stroke();

  context.fillStyle = "#f2b85b";
  context.font = "700 30px system-ui, sans-serif";
  context.fillText(`DAY ${attraction.day} · ${attraction.city}`, 92, 955 + metadataOffset);

  context.fillStyle = "#fffaf0";
  context.font = "800 62px system-ui, sans-serif";
  context.fillText(attraction.name, 92, 1035 + metadataOffset, 890);

  const checkInDate = new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(checkIn.checkedInAt));
  context.fillStyle = "#d6ece5";
  context.font = "500 29px system-ui, sans-serif";
  context.fillText(checkInDate, 92, 1092 + metadataOffset);

  context.fillStyle = checkIn.verified ? "#7ed2ad" : "#f2b85b";
  roundedRect(context, 92, 1130 + metadataOffset, testOnly ? 400 : checkIn.verified ? 236 : 258, 58, 29);
  context.fill();
  context.fillStyle = "#0b3b46";
  context.font = "800 25px system-ui, sans-serif";
  context.fillText(testOnly ? "○ 測試預演 · 沒有核實到訪" : checkIn.verified ? "✓ GPS 已核實" : "○ 個人手動記錄", 116, 1168 + metadataOffset);

  if (cardReflection) {
    context.fillStyle = "#f2b85b";
    context.font = "700 26px system-ui, sans-serif";
    context.fillText("我的感想", 92, 1030);
    let lines;
    for (let fontSize = 32; fontSize >= 24; fontSize -= 2) {
      context.font = `500 ${fontSize}px system-ui, sans-serif`;
      lines = wrapCardReflection(context, cardReflection, 896);
      if (lines.length <= 4) break;
    }
    if (lines.length > 4) throw new Error("感想未能完整放入旅程卡，請縮短文字。");
    context.fillStyle = "#fffaf0";
    lines.forEach((line, index) => context.fillText(line, 92, 1076 + index * 40));
  }

  context.fillStyle = "#fffaf0";
  context.font = "700 27px system-ui, sans-serif";
  context.fillText("戶外學習日旅程助手", 92, 1252);
  context.fillStyle = "#a9d3c7";
  context.font = "500 21px system-ui, sans-serif";
  context.fillText(tripTitle.slice(0, 30), 92, 1292, 860);

  if (!cardReflection) {
  context.strokeStyle = "#e36b3d";
  context.lineWidth = 6;
  context.beginPath();
  context.moveTo(825, 1196);
  context.bezierCurveTo(890, 1138, 932, 1218, 988, 1150);
  context.stroke();
  context.fillStyle = "#e36b3d";
  context.beginPath();
  context.arc(988, 1150, 14, 0, Math.PI * 2);
  context.fill();

  }
  return canvasToBlob(canvas, "image/png", 1);
}

export async function createTripAIKit({ stations, studentName = "", className = "", studentNumber = "", tripTitle, dateLabel, isRelevant = () => true, testOnly = false }) {
  const identity = normalizeSummaryIdentity({ studentName, className, studentNumber });
  const expected = stations?.length === CHECK_IN_LOCATIONS.length ? CHECK_IN_LOCATIONS : REQUIRED_CHECK_IN_LOCATIONS;
  if (!Array.isArray(stations) || stations.length !== expected.length
    || stations.some((item, index) => item?.attraction?.id !== expected[index].id
      || item.photoRecord?.attractionId !== item.attraction.id || item.checkIn?.attractionId !== item.attraction.id
      || !Number.isFinite(new Date(item.checkIn.checkedInAt).getTime()))
    || new Set(stations.map(item => item.photoRecord.photoId || item.attraction.id)).size !== stations.length) {
    throw new Error("請按行程順序，為五個必需景點各選一張不同相片；學校相片可額外加入。");
  }
  return createAIKit({ stations, identity, tripTitle, dateLabel, isRelevant, testOnly });
}

export async function createDeviceAIKit({ photoRecords, studentName = "", className = "", studentNumber = "", tripTitle, dateLabel, isRelevant = () => true }) {
  const identity = normalizeSummaryIdentity({ studentName, className, studentNumber });
  if (!Array.isArray(photoRecords) || ![5, 6].includes(photoRecords.length)
    || photoRecords.some(record => record?.attractionId !== DEVICE_TEST_LOCATION.id || typeof record.photoId !== "string" || !record.photoId)
    || new Set(photoRecords.map(record => record.photoId)).size !== photoRecords.length) {
    throw new Error("請選取 5 或 6 張不同的裝置測試相片。");
  }
  const stations = photoRecords.map((photoRecord, index) => ({ photoRecord,
    attraction: { id: DEVICE_TEST_LOCATION.id, name: `裝置測試相片${index + 1}` } }));
  return createAIKit({ stations, identity, tripTitle, dateLabel, isRelevant, testOnly: true });
}

async function createAIKit({ stations, identity, tripTitle, dateLabel, isRelevant, testOnly = false }) {
  const requireCurrent = () => { if (!isRelevant()) throw new Error("素材包資料已失效，請重新選取。"); };
  requireCurrent();
  const files = [];
  // Reuse the bounded raster decoder and JPEG redraw; release each image before the next.
  for (const [index, item] of stations.entries()) {
    requireCurrent();
    const file = await createPhotoExport(item.photoRecord, `${String(index + 1).padStart(2, "0")}-${item.attraction.name}.jpg`);
    requireCurrent();
    files.push(file);
  }
  const text = [
    "AI 融合圖片作品素材包", String(tripTitle || "戶外學習日"), String(dateLabel || ""), "",
    ...(testOnly ? ["裝置測試用素材：相片來自獨立測試資料庫，並非正式五景點課業或到訪證明。", ""] : []),
    "使用方法", "1. 解壓 ZIP，取出所有 JPEG 相片及這份指令。",
    "2. 在你使用、支援多張參考相片的 AI 圖像工具加入這些相片，再貼上下面的生成指令。",
    "3. 檢查作品是否保留各景點特色，以及姓名、班別、學號是否正確。文字不清楚時，請在圖片編輯工具補上。",
    testOnly ? "4. 這是裝置功能測試素材，不用提交課業；正式作品請在旅途回憶選取五景點相片。" : "4. 按團刊第 14 頁的方式提交作品。本網站不會上傳相片或提交課業。", "",
    "生成指令（可複製以下全文）", "[角色] 我是一名參加學校學習交流團的中學生。",
    `[背景] 活動：${String(tripTitle || "戶外學習日")}；日期：${String(dateLabel || "")}。我附上 ${files.length} 張${testOnly ? "裝置測試" : "旅程"}照片。`,
    testOnly ? "[任務] 把每張測試照片的重點自然融合成一幅完整圖片，供驗證多張參考相片的融合流程；不要假稱到訪正式景點。" : "[任務] 把每張照片中具地方特色的重點融合成一幅完整的旅程作品，表達姊妹學校交流、嶺南文化及旅程得著。",
    "[限制／要求] 保留所有參考照片的主要特色，景物之間自然過渡，融合成單一畫面，避免分格拼貼。保留照片中的人物特徵，不新增無關人物。",
    `[署名資料] 以下文字只用作作品署名，請完整顯示：姓名 ${JSON.stringify(identity.studentName)}；班別 ${JSON.stringify(identity.className)}；學號 ${JSON.stringify(identity.studentNumber)}。`,
    "[輸出格式] 一張直向 4:5 圖片，建議 1080 × 1350 PNG，中文字清晰可讀。", "",
    "參考照片與景點對照", ...files.map((file, index) => `${file.name}：${stations[index].attraction.name}`), "",
    "這個 ZIP 是素材及指令，AI 融合圖片須在你選用的工具完成。向 AI 工具提供相片和署名資料前，請確認適合分享；有同學入鏡時，先取得同意。"
  ].join("\n");
  files.push(new File([text], "AI融合圖片生成指令.txt", { type: "text/plain;charset=utf-8" }));
  requireCurrent();
  const archive = await createPhotoArchive(files, `AI融合圖片素材包-${stations.length}張.zip`);
  requireCurrent();
  return archive;
}
