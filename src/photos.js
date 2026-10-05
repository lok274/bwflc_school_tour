const DATABASE_NAME = "outdoorLearningDay.photos";
const STORE_NAME = "photos";
const DATABASE_VERSION = 1;
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_EDGE = 1600;
const WEBP_QUALITY = 0.82;

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("此瀏覽器不支援本機相片資料庫。"));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error || new Error("未能開啟相片資料庫。"));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "attractionId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function runTransaction(mode, operation) {
  const database = await openDatabase();
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

export function getAllPhotoRecords() {
  return runTransaction("readonly", (store) => store.getAll());
}

export function getPhotoRecord(attractionId) {
  return runTransaction("readonly", (store) => store.get(attractionId));
}

export function savePhotoRecord(record) {
  return runTransaction("readwrite", (store) => store.put(record));
}

export function deletePhotoRecord(attractionId) {
  return runTransaction("readwrite", (store) => store.delete(attractionId));
}

export function clearPhotoRecords() {
  return runTransaction("readwrite", (store) => store.clear());
}

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
  if (!(input instanceof Blob)) throw new Error("未選取有效相片。 ");
  if (input.size > MAX_INPUT_BYTES) throw new Error("相片超過 20MB，請選擇較小的檔案。 ");
  if (!input.type.startsWith("image/") || input.type === "image/svg+xml") {
    throw new Error("只接受 JPEG、PNG、WebP 或裝置可讀取的相片格式。 ");
  }

  const decoded = await decodeImage(input);
  const sourceWidth = decoded.width || decoded.naturalWidth;
  const sourceHeight = decoded.height || decoded.naturalHeight;
  if (!sourceWidth || !sourceHeight) {
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
  return {
    attractionId,
    blob,
    mime: blob.type || "image/webp",
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
