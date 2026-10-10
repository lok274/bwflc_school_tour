import { createWorkbookRepository } from "../../src/workbook-storage.js";
import { createPhotoRepository } from "../../src/photos.js";
import { emptyWorkbook, WORKBOOK_FIELDS, WORKBOOK_RATINGS } from "../../src/workbook-data.js";
import { createDefaultState, STORAGE_KEY } from "../../src/state.js";
import { CHECK_IN_LOCATIONS } from "../../src/data.js";

document.getElementById("seed-offline-workbook").addEventListener("click", async event => {
  const message = document.getElementById("offline-seed-result"); event.target.disabled = true;
  try {
    const repository = createWorkbookRepository(), photoRepository = createPhotoRepository();
    const current = await repository.read(), existingPhotos = await photoRepository.getAllPhotoRecords();
    if (localStorage.getItem(STORAGE_KEY) || existingPhotos.length || current.draft.photoIds.length || Object.values(current.draft.answers).some(Boolean) || Object.values(current.draft.ratings).some(value => value !== null)) throw Error("此 origin 已有資料，已停止，未有改動。");
    const draft = emptyWorkbook(), state = createDefaultState();
    for (const [index, item] of CHECK_IN_LOCATIONS.entries()) {
      const canvas = document.createElement("canvas"); canvas.width = index % 2 ? 240 : 400; canvas.height = index % 2 ? 400 : 240;
      const context = canvas.getContext("2d"); context.fillStyle = ["#286b67", "#c16335", "#56698e", "#91722e", "#755082", "#3e7748"][index]; context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "white"; context.font = "22px sans-serif"; context.fillText(`SYNTHETIC ${index + 1}`, 14, 60);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", .92));
      const photoId = `offline-workbook-${index}`;
      await photoRepository.savePhotoRecord({ photoId, writeId: crypto.randomUUID(), attractionId: item.id, width: canvas.width, height: canvas.height, blob, mime: "image/jpeg", version: 1, createdAt: "2026-11-05T04:00:00.000Z" });
      draft.photoIds.push(photoId);
      state.checkIns[item.id] = { attractionId: item.id, method: "manual", verified: false, checkedInAt: "2026-11-05T04:00:00.000Z" };
    }
    for (const field of WORKBOOK_FIELDS) draft.answers[field.id] = "合成資料：在旅程中觀察及學習，這是功能驗證的示例。";
    draft.answers['essay-title'] = "合成測試：嶺南文化旅程";
    draft.answers['essay-body'] = "這是一段合成資料，測試嶺南文化交流的文字課業。".repeat(30);
    for (const [index, field] of WORKBOOK_RATINGS.entries()) draft.ratings[field.id] = index % 5 + 1;
    await repository.write(draft, current.revision); localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    const registration = await navigator.serviceWorker.register(new URL('../../sw.js', import.meta.url));
    if (!registration.active) await new Promise((resolve, reject) => {
      const worker = registration.installing || registration.waiting;
      worker.addEventListener('statechange', () => { if (worker.state === 'activated') resolve(); if (worker.state === 'redundant') reject(Error('離線快取失敗')); });
    });
    const cache = await caches.open('outdoor-learning-day-v85');
    const expected = ['index.html', 'src/app-settings.js', 'src/ai-artwork-controller.js', 'src/local-font.js', 'src/workbook-pdf.js', 'src/vendor/noto-sans-hk-regular.js', 'src/vendor/pdf-lib-1.17.1.js', 'src/vendor/fontkit-1.1.1.js', 'src/vendor/pako-1.0.11.js'];
    for (const asset of expected) if (!await cache.match(new URL('../../' + asset, import.meta.url))) throw Error('離線快取缺少 ' + asset);
    message.textContent = '已準備六張合成相片、完整文字與評分；v85 PDF 程式及字型已全部快取。可開啟手冊，再停止本機伺服器測試離線重載、暫存和下載。';
    message.dataset.complete = 'true';
  } catch (cause) { message.textContent = cause.message; }
});
