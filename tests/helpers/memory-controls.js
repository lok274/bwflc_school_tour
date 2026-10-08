// Browser fixtures use the same album / viewer / picker controls as students.
const click = selector => {
  const target = document.querySelector(selector);
  if (!target) throw Error(`缺少控制項 ${selector}`);
  target.click();
};
export function closeMemory() {
  if (document.querySelector("#memory-dialog")?.open) click("[data-memory-close]");
}
export function openMemoryAlbum(id) {
  closeMemory();
  click(`[data-memory-album="${id}"]`);
}
export function openMemoryPhoto(id, photoId, card = false) {
  openMemoryAlbum(id);
  while (!document.querySelector(`[data-memory-photo="${photoId}"]`)) {
    const next = document.querySelector("#memory-next-page");
    if (!next || next.disabled) throw Error(`相簿沒有相片 ${photoId}`);
    next.click();
  }
  click(`[data-memory-photo="${photoId}"]`);
  if (card) click("[data-memory-card-toggle]");
}
export function selectAllMemoryPhotos() {
  closeMemory();
  const ids = [...document.querySelectorAll("[data-memory-album]")].map(item => item.dataset.memoryAlbum);
  for (const id of ids) {
    openMemoryAlbum(id);
    const select = document.querySelector("[data-memory-album-select]");
    if (select.dataset.memoryAlbumSelect === "all") select.click();
    closeMemory();
  }
}
export function ensureSummary() {
  if (document.querySelector("[data-summary-download]")) return;
  closeMemory();
  click("[data-memory-summary-open]");
}
export function selectSummaryPhoto(id, photoId) {
  ensureSummary();
  click(`[data-memory-pick="${id}"]`);
  while (!document.querySelector(`[data-summary-photo-id="${photoId}"]`)) {
    const next = document.querySelector("#memory-next-page");
    if (!next || next.disabled) throw Error(`選圖沒有相片 ${photoId}`);
    next.click();
  }
  const radio = document.querySelector(`[data-summary-photo-id="${photoId}"]`);
  radio.checked = true;
  radio.dispatchEvent(new Event("change", { bubbles: true }));
}
