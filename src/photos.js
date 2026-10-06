const DATABASE_NAME = "outdoorLearningDay.photos";
const STORE_NAME = "photoEntries";
const DATABASE_VERSION = 2;
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_EDGE = 1600;
const WEBP_QUALITY = 0.82;
const PHOTO_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

// MIME/extension is user-controlled. Inspect a bounded prefix before invoking a decoder.
export async function validatePhotoInput(input) {
  if (!(input instanceof Blob) || !input.size) throw new Error("未選取有效相片。 ");
  if (input.size > MAX_INPUT_BYTES) throw new Error("相片超過 20MB，請選擇較小的檔案。 ");
  if (input.type && !PHOTO_MIME_TYPES.has(input.type)) {
    throw new Error("只接受 JPEG、PNG、WebP、HEIC 或 HEIF 點陣相片；不接受 SVG。 ");
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
    throw new Error("檔案內容不是支援的點陣相片，或與宣告格式不符。請改用 JPEG、PNG、WebP、HEIC 或 HEIF。 ");
  }
  return mime;
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
  if (globalThis.createImageBitmap) {
    try {
      return await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch {
      return decodeWithImageElement(blob);
    }
  }
  return decodeWithImageElement(blob);
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
  const inputMime = await validatePhotoInput(input);

  const decoded = await decodeImage(input.type ? input : input.slice(0, input.size, inputMime));
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

export async function createTravelCard({ photoRecord, attraction, checkIn, tripTitle }) {
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
  roundedRect(context, 72, 72, 936, 826, 42);
  context.clip();
  drawCoverImage(context, image, 72, 72, 936, 826);
  const photoShade = context.createLinearGradient(0, 620, 0, 900);
  photoShade.addColorStop(0, "rgba(11,59,70,0)");
  photoShade.addColorStop(1, "rgba(11,59,70,0.58)");
  context.fillStyle = photoShade;
  context.fillRect(72, 540, 936, 358);
  context.restore();
  image.close?.();

  context.strokeStyle = "#f2b85b";
  context.lineWidth = 8;
  roundedRect(context, 72, 72, 936, 826, 42);
  context.stroke();

  context.fillStyle = "#f2b85b";
  context.font = "700 30px system-ui, sans-serif";
  context.fillText(`DAY ${attraction.day} · ${attraction.city}`, 92, 955);

  context.fillStyle = "#fffaf0";
  context.font = "800 62px system-ui, sans-serif";
  context.fillText(attraction.name, 92, 1035, 890);

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
  context.fillText(checkInDate, 92, 1092);

  context.fillStyle = checkIn.verified ? "#7ed2ad" : "#f2b85b";
  roundedRect(context, 92, 1130, checkIn.verified ? 236 : 258, 58, 29);
  context.fill();
  context.fillStyle = "#0b3b46";
  context.font = "800 25px system-ui, sans-serif";
  context.fillText(checkIn.verified ? "✓ GPS 已核實" : "○ 個人手動記錄", 116, 1168);

  context.fillStyle = "#fffaf0";
  context.font = "700 27px system-ui, sans-serif";
  context.fillText("戶外學習日旅程助手", 92, 1252);
  context.fillStyle = "#a9d3c7";
  context.font = "500 21px system-ui, sans-serif";
  context.fillText(tripTitle.slice(0, 30), 92, 1292, 860);

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

  return canvasToBlob(canvas, "image/png", 1);
}
