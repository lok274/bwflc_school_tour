import { createCameraController } from "../../src/camera.js";
import { compressPhoto } from "../../src/photos.js";

// Node tests check these templates against production HTML, without weakening
// the production server's connect-src policy for this standalone fixture.
const mode = new URLSearchParams(location.search).get("page") === "app" ? "app" : "device";
const source = document.querySelector(`#${mode}-fixture`).content;
for (const selector of ["#camera-dialog", "#photo-input", "#native-camera-input"]) {
  const element = source.querySelector(selector);
  if (!element) throw Error(`正式頁缺少 ${selector}`);
  document.body.append(element.cloneNode(true));
}
const dialog = document.querySelector("#camera-dialog");
const video = document.querySelector("#camera-video");
const preview = document.querySelector("#camera-preview");
const canvas = document.createElement("canvas");
const summary = document.querySelector("#test-summary");
const saveResult = document.querySelector("#save-result");
const id = "orientation-fixture";
const streams = [];
let generation = 0;
let capturedSize = null;
let ready = false;
function drawFrame() {
  const portrait = innerHeight >= innerWidth;
  const width = portrait ? 1080 : 1920;
  const height = portrait ? 1920 : 1080;
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const context = canvas.getContext("2d");
  context.fillStyle = "#145c62";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#f2b85b";
  context.lineWidth = 20;
  context.strokeRect(20, 20, width - 40, height - 40);
  context.fillStyle = "#fffdf8";
  context.font = "bold 100px sans-serif";
  context.textAlign = "center";
  context.fillText(portrait ? "直向 ↑" : "橫向 →", width / 2, height / 2 - 60);
  context.font = "60px sans-serif";
  context.fillText(`${width} × ${height}`, width / 2, height / 2 + 50);
}
const camera = createCameraController({ document, URL,
  navigator: { mediaDevices: { async getUserMedia() {
    drawFrame();
    const stream = canvas.captureStream(10);
    streams.push(stream);
    return stream;
  } } },
  lookupAttraction: () => ({ id, name: mode === "app" ? "東莞松山湖未來學校" : "東院道 11 號測試點" }),
  hasCheckIn: (candidate) => candidate === id, canUseAttraction: (candidate) => candidate === id,
  isResetting: () => false, operationToken: () => generation,
  isCurrentOperation: (candidate, token) => candidate === id && token === generation,
  beginPhotoSelection: () => false,
  showToast: (message) => { summary.textContent = `失敗：${message}`; },
  onCameraStatus: ({ status }) => { ready = status === "ready"; },
  processPhoto: async (blob) => {
    const record = await compressPhoto(blob, id);
    const scale = Math.min(1, 1600 / Math.max(capturedSize.width, capturedSize.height));
    const expectedWidth = Math.round(capturedSize.width * scale);
    const expectedHeight = Math.round(capturedSize.height * scale);
    if (record.width !== expectedWidth || record.height !== expectedHeight) throw Error("保存比例不符");
    saveResult.textContent = `保存驗證通過：${record.width} × ${record.height}；只在記憶體驗證，未寫入個人資料。`;
  }
});
dialog.addEventListener("close", () => { if (!dialog.open) camera.stopCamera(); });
document.querySelector("#open-fixture").addEventListener("click", () => {
  generation += 1;
  capturedSize = null;
  camera.openCamera(id);
});
document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (button?.matches("[data-camera-capture]")) {
    capturedSize = { width: video.videoWidth, height: video.videoHeight };
    camera.captureCameraFrame();
  }
  if (button?.matches("[data-camera-retake]")) { capturedSize = null; camera.clearPendingCapture(); }
  if (button?.matches("[data-camera-save]")) camera.saveCameraPhoto();
});
function validateLayout() {
  if (!dialog.open || !ready) return;
  const portrait = innerHeight >= innerWidth;
  const expectedWidth = portrait ? 1080 : 1920;
  const expectedHeight = portrait ? 1920 : 1080;
  if (video.videoWidth !== expectedWidth || video.videoHeight !== expectedHeight) {
    summary.textContent = "等待轉向後影格…";
    return;
  }
  const failures = [];
  let checks = 0;
  const assert = (value, message) => { checks += 1; if (!value) failures.push(message); };
  const bounds = (element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1;
  };
  assert(bounds(dialog), "相機視窗超出螢幕");
  assert(dialog.scrollHeight <= dialog.clientHeight + 1, "視窗需要捲動");
  assert(bounds(document.querySelector(".dialog-heading")), "標題超出螢幕");
  assert(bounds(document.querySelector("[data-camera-close]")), "關閉按鈕超出螢幕");
  const stage = document.querySelector(".camera-stage").getBoundingClientRect();
  assert(portrait ? stage.height > stage.width : stage.width > stage.height, "相機框方向與螢幕不符");
  assert(bounds(document.querySelector(".camera-stage")), "相機框超出螢幕");
  const image = preview.hidden ? video : preview;
  assert(getComputedStyle(image).objectFit === "contain", "影像被裁切");
  for (const button of document.querySelectorAll(".camera-actions button:not([hidden])")) {
    assert(bounds(button), "拍攝／重拍／保存按鈕超出螢幕");
  }
  if (!preview.hidden) {
    const shot = document.querySelector("#camera-canvas");
    assert(shot.width === capturedSize.width && shot.height === capturedSize.height, "轉向改動已拍照片");
    assert(preview.naturalWidth === capturedSize.width && preview.naturalHeight === capturedSize.height, "預覽比例與快門不符");
  }
  summary.textContent = failures.length ? `失敗：${failures.join("；")}` : `${mode} ${innerWidth} × ${innerHeight} ${preview.hidden ? "即時" : "已拍"}：${checks} 項通過；影格 ${video.videoWidth} × ${video.videoHeight}`;
}
const timer = setInterval(() => { drawFrame(); validateLayout(); }, 100);
window.addEventListener("pagehide", () => { clearInterval(timer); camera.stopCamera(); streams.forEach((stream) => stream.getTracks().forEach((track) => track.stop())); });
document.querySelector("#open-fixture").disabled = false;
summary.textContent = `${mode} 已準備；開啟相機後調整 viewport，檢查即時、已拍、重拍及保存狀態。`;
