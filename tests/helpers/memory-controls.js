let renderCurrentPage;
export function configureMemoryControls(controller) { renderCurrentPage = () => controller.render(); }
function visitMemorySection(hash) {
  closeMemory();
  if (location.hash !== hash) { location.hash = hash; renderCurrentPage(); }
}
// Browser fixtures use the same album and viewer controls as students.
const click = selector => {
  const target = document.querySelector(selector);
  if (!target) throw Error(`缺少控制項 ${selector}`);
  const details = target.closest("details"); if (details && !details.open) details.querySelector("summary").click();
  target.click();
};
export function closeMemory() {
  if (document.querySelector("#memory-inline:not([hidden])")) click("[data-memory-close]");
}
export function openMemoryAlbum(id) {
  visitMemorySection("#memories");
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
  visitMemorySection("#memories");
  const ids = [...document.querySelectorAll("[data-memory-album]")].map(item => item.dataset.memoryAlbum);
  for (const id of ids) {
    openMemoryAlbum(id);
    const select = document.querySelector("[data-memory-album-select]");
    if (select.dataset.memoryAlbumSelect === "all") select.click();
    click("[data-memory-selection-confirm]");
  }
}
