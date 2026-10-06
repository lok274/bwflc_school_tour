import { getAttraction } from "./formatting.js";

// The camera owns media tracks and pending captures; it never writes to storage.
export function createCameraController({
  document, navigator, URL, hasCheckIn, canUseAttraction, isResetting,
  operationToken, isCurrentOperation, showToast, processPhoto, beginGallerySelection,
  lookupAttraction = getAttraction, onCameraStatus = () => {}
}) {
  const cameraDialog = document.querySelector("#camera-dialog");
  const cameraVideo = document.querySelector("#camera-video");
  const cameraCanvas = document.querySelector("#camera-canvas");
  const cameraPreview = document.querySelector("#camera-preview");
  const cameraLoading = document.querySelector("#camera-loading");
  const photoInput = document.querySelector("#photo-input");
  let cameraStream = null;
  let pendingCapture = null;
  let pendingPreviewUrl = null;
  let cameraRequestGeneration = 0;
  let captureGeneration = 0;
  let cameraToken = null;
  function clearPendingCapture() {
    captureGeneration += 1;
    pendingCapture = null;
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    pendingPreviewUrl = null;
    cameraPreview.removeAttribute("src");
    cameraPreview.hidden = true;
    cameraVideo.hidden = false;
    document.querySelector("[data-camera-retake]").hidden = true;
    document.querySelector("[data-camera-save]").hidden = true;
    document.querySelector("[data-camera-capture]").hidden = false;
  }

  function stopCamera() {
    cameraRequestGeneration += 1;
    cameraStream?.getTracks().forEach((track) => track.stop());
    cameraStream = null;
    cameraToken = null;
    cameraVideo.srcObject = null;
    clearPendingCapture();
  }

  function openGallery(attractionId) {
    if (!canUseAttraction(attractionId) || !hasCheckIn(attractionId)) return;
    beginGallerySelection(attractionId);
    photoInput.click();
  }

  async function openCamera(attractionId) {
    const attraction = lookupAttraction(attractionId);
    if (!canUseAttraction(attractionId) || !hasCheckIn(attractionId) || !attraction) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      onCameraStatus({ status: "unsupported" });
      showToast("這個瀏覽器未能開啟相機，已改用相簿選擇器。", "warning");
      openGallery(attractionId);
      return;
    }

    stopCamera();
    const requestGeneration = ++cameraRequestGeneration;
    const token = operationToken(attractionId);
    cameraToken = token;
    cameraDialog.dataset.attractionId = attractionId;
    cameraDialog.dataset.cameraRequestGeneration = String(requestGeneration);
    document.querySelector("#camera-title").textContent = `在${attraction.name}影相`;
    cameraLoading.hidden = false;
    clearPendingCapture();
    if (!cameraDialog.open) cameraDialog.showModal();
    onCameraStatus({ status: "opening" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      const stillCurrent = !isResetting() &&
        cameraRequestGeneration === requestGeneration &&
        cameraDialog.open &&
        cameraDialog.dataset.attractionId === attractionId &&
        cameraDialog.dataset.cameraRequestGeneration === String(requestGeneration) &&
        isCurrentOperation(attractionId, token);
      if (!stillCurrent) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      cameraStream?.getTracks().forEach((track) => track.stop());
      cameraStream = stream;
      cameraVideo.srcObject = stream;
      await cameraVideo.play();
      if (cameraRequestGeneration !== requestGeneration || !cameraDialog.open) {
        stream.getTracks().forEach((track) => track.stop());
        if (cameraStream === stream) cameraStream = null;
        return;
      }
      cameraLoading.hidden = true;
      onCameraStatus({ status: "ready" });
    } catch (error) {
      if (cameraRequestGeneration !== requestGeneration) return;
      stopCamera();
      cameraDialog.close();
      onCameraStatus({ status: "error", errorName: error?.name });
      showToast("未能開啟相機，已改用相簿選擇器。", "warning");
      openGallery(attractionId);
    }
  }

  function captureCameraFrame() {
    if (!cameraStream || !cameraVideo.videoWidth || !isCurrentOperation(cameraDialog.dataset.attractionId, cameraToken)) return;
    const requestGeneration = cameraRequestGeneration;
    const attractionId = cameraDialog.dataset.attractionId;
    const captureToken = ++captureGeneration;
    cameraCanvas.width = cameraVideo.videoWidth;
    cameraCanvas.height = cameraVideo.videoHeight;
    const context = cameraCanvas.getContext("2d");
    context.drawImage(cameraVideo, 0, 0);
    cameraCanvas.toBlob((blob) => {
      const stillCurrent = blob &&
        cameraRequestGeneration === requestGeneration &&
        captureGeneration === captureToken &&
        cameraDialog.open &&
        cameraDialog.dataset.attractionId === attractionId &&
        cameraStream;
      if (!stillCurrent) return;
      pendingCapture = blob;
      pendingPreviewUrl = URL.createObjectURL(blob);
      cameraPreview.src = pendingPreviewUrl;
      cameraPreview.hidden = false;
      cameraVideo.hidden = true;
      document.querySelector("[data-camera-retake]").hidden = false;
      document.querySelector("[data-camera-save]").hidden = false;
      document.querySelector("[data-camera-capture]").hidden = true;
    }, "image/jpeg", 0.92);
  }

  async function saveCameraPhoto() {
    const attractionId = cameraDialog.dataset.attractionId;
    if (!isCurrentOperation(attractionId, cameraToken)) return;
    const capture = pendingCapture;
    stopCamera();
    cameraDialog.close();
    if (capture) await processPhoto(capture, attractionId);
  }

  return { clearPendingCapture, stopCamera, openGallery, openCamera, captureCameraFrame, saveCameraPhoto };
}
