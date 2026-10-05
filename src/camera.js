import { getAttraction } from "./formatting.js";

// The camera owns media tracks and pending captures; it never writes to storage.
export function createCameraController({
  document, navigator, URL, getState, isResetting,
  operationToken, isCurrentOperation, showToast, processPhoto
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
    cameraVideo.srcObject = null;
    clearPendingCapture();
  }

  function openGallery(attractionId) {
    if (isResetting() || !getState().checkIns[attractionId]) return;
    photoInput.dataset.attractionId = attractionId;
    photoInput.value = "";
    photoInput.click();
  }

  async function openCamera(attractionId) {
    if (isResetting() || !getState().checkIns[attractionId]) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      showToast("這個瀏覽器未能開啟相機，已改用相簿選擇器。", "warning");
      openGallery(attractionId);
      return;
    }

    stopCamera();
    const requestGeneration = ++cameraRequestGeneration;
    const token = operationToken(attractionId);
    cameraDialog.dataset.attractionId = attractionId;
    cameraDialog.dataset.cameraRequestGeneration = String(requestGeneration);
    document.querySelector("#camera-title").textContent = `在${getAttraction(attractionId).name}影相`;
    cameraLoading.hidden = false;
    clearPendingCapture();
    if (!cameraDialog.open) cameraDialog.showModal();
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
    } catch {
      if (cameraRequestGeneration !== requestGeneration) return;
      stopCamera();
      cameraDialog.close();
      showToast("未能開啟相機，已改用相簿選擇器。", "warning");
      openGallery(attractionId);
    }
  }

  function captureCameraFrame() {
    if (!cameraStream || !cameraVideo.videoWidth) return;
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
    const capture = pendingCapture;
    stopCamera();
    cameraDialog.close();
    if (capture) await processPhoto(capture, attractionId);
  }

  return { clearPendingCapture, stopCamera, openGallery, openCamera, captureCameraFrame, saveCameraPhoto };
}
