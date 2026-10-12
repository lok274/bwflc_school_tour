// Owns inline album/viewer and AI selection frames; no storage writes.
export function createMemoryController({ document, window, app, memoryDialog, memoryContent, store,
  finishComposition, render, cancelWork, getBusy, isSelected, isPhotoReady, canUsePhotoActions, canUse, isExportOpen }) {
  let memoryFrames = [], memoryEpoch = 0, memorySuspended = false, memoryEntry = null, albumSelection = null;
  const memoryFrame = () => memoryFrames.at(-1) || null;
  const isInline = frame => ["album", "photo", "summary", "picker"].includes(frame?.mode);
  function getMemoryState() {
    const frame = memoryFrame();
    return frame ? { ...frame, depth: memoryFrames.length, suspended: memorySuspended,
      albumSelectionActive: Boolean(albumSelection && albumSelection.attractionId === frame.attractionId),
      draftSelectedPhotoIds: albumSelection ? [...albumSelection.selected] : [],
      selectionChanged: albumSelectionChanged(),
      busy: getBusy(memoryEpoch) } : null;
  }

  function rememberMemoryPosition() {
    const frame = memoryFrame();
    if (frame) {
      if (isInline(frame)) frame.scrollY = window.scrollY || 0;
      else frame.scrollTop = document.getElementById("memory-body")?.scrollTop || 0;
      frame.focusId = document.activeElement?.id || "";
    }
  }

  function restoreMemoryPosition(frame) {
    if (isInline(frame)) window.scrollTo?.({ left: 0, top: frame.scrollY || 0, behavior: "instant" });
    else {
      const body = document.getElementById("memory-body");
      if (body) body.scrollTop = frame.scrollTop || 0;
    }
    (document.getElementById(frame.focusId) || document.getElementById("memory-title"))?.focus({ preventScroll: true });
  }

  function scrollMemoryStart(moveFocus = true) {
    const title = document.getElementById("memory-title");
    if (moveFocus) title?.focus({ preventScroll: true });
    if (isInline(memoryFrame())) document.getElementById(["summary", "picker"].includes(memoryFrame().mode) ? "memory-ai-inline" : "memory-inline")?.scrollIntoView?.({ block: "start", behavior: "instant" });
    else {
      const body = document.getElementById("memory-body");
      if (body) body.scrollTop = 0;
    }
  }

  function changeMemory(frame, push = false) {
    finishComposition();
    if (push) { rememberMemoryPosition(); memoryFrames.push(frame); }
    else {
      memoryEntry = { focusId: frame.mode === "album" ? `memory-album-${frame.attractionId}` : frame.mode === "summary" ? "memory-summary-open" : document.activeElement?.id || "", scrollY: window.scrollY || 0 };
      memoryFrames = [frame];
      albumSelection = frame.mode === "album" ? createAlbumSelection(frame.attractionId) : null;
    }
    memoryEpoch++;
    memorySuspended = false;
    cancelWork();
    render();
    scrollMemoryStart();
  }

  function closeMemory({ restore = true } = {}) {
    finishComposition();
    const entry = memoryEntry;
    memoryFrames = [];
    albumSelection = null;
    memoryEntry = null;
    memoryEpoch++;
    memorySuspended = false;
    cancelWork();
    if (memoryDialog.open) memoryDialog.close();
    if (memoryContent) memoryContent.innerHTML = "";
    if (restore) {
      render();
      window.scrollTo?.({ left: 0, top: entry?.scrollY || 0, behavior: "instant" });
      (document.getElementById(entry?.focusId) || app).focus({ preventScroll: true });
    }
  }

  function backMemory() {
    if (memoryFrames.length <= 1) { closeMemory(); return; }
    finishComposition();
    memoryFrames.pop();
    memoryEpoch++;
    cancelWork();
    render();
    restoreMemoryPosition(memoryFrame());
  }

  function suspendMemory() {
    if (!memoryFrames.length || memorySuspended) return;
    finishComposition();
    rememberMemoryPosition();
    memorySuspended = true;
    if (memoryDialog.open) memoryDialog.close();
    render();
  }

  function resumeMemory() {
    if (!memoryFrames.length || !memorySuspended || !canUse() || isExportOpen()) return;
    memorySuspended = false;
    render();
    restoreMemoryPosition(memoryFrame());
  }

  function validateMemory() {
    const frame = memoryFrame();
    if (!frame) return;
    if (frame.mode === "summary" || frame.mode === "picker") {
      if (!store.hasCompletedAllCheckIns()) { closeMemory({ restore: false }); return; }
    }
    if (frame.attractionId && (!store.hasCheckIn(frame.attractionId) || !store.hasPhoto(frame.attractionId))) {
      if (frame.mode === "picker") backMemory(); else closeMemory({ restore: false });
    } else if (frame.mode === "photo" && !store.getPhoto(frame.attractionId, frame.photoId)) {
      backMemory();
    }
  }

  function createAlbumSelection(attractionId) {
    return { attractionId, version: store.getPhotoVersion(attractionId),
      selected: new Set(store.getPhotos(attractionId).filter(photo => isSelected(photo.photoId)).map(photo => photo.photoId)) };
  }

  function albumSelectionChanged() {
    if (!albumSelection) return false;
    const confirmed = store.getPhotos(albumSelection.attractionId).filter(photo => isSelected(photo.photoId));
    return confirmed.length !== albumSelection.selected.size || confirmed.some(photo => !albumSelection.selected.has(photo.photoId));
  }

  function canChangeAlbumSelection() {
    return memoryFrame()?.mode === "album" && albumSelection?.attractionId === memoryFrame().attractionId
      && isPhotoReady() && canUsePhotoActions(albumSelection.attractionId)
      && albumSelection.version === store.getPhotoVersion(albumSelection.attractionId);
  }

  memoryDialog.addEventListener("cancel", event => { event.preventDefault(); backMemory(); });
  return { getState: getMemoryState, frame: () => memoryFrame() ? { ...memoryFrame() } : null, change: changeMemory, close: closeMemory,
    back: backMemory, suspend: suspendMemory, resume: resumeMemory, validate: validateMemory, scrollStart: scrollMemoryStart,
    selectionChanged: albumSelectionChanged, canChangeSelection: canChangeAlbumSelection,
    resetSelection(id) { albumSelection = createAlbumSelection(id); },
    selectPhoto(id, selected) { if (!canChangeAlbumSelection()) return; selected ? albumSelection.selected.add(id) : albumSelection.selected.delete(id); },
    selectAlbum(mode) { if (canChangeAlbumSelection()) for (const photo of store.getPhotos(albumSelection.attractionId)) this.selectPhoto(photo.photoId, mode === "all"); },
    selectedInAlbum(id) { return Boolean(albumSelection?.selected.has(id)); },
    updateFrame(patch) { if (memoryFrame()) Object.assign(memoryFrame(), patch); },
    invalidate() { memoryEpoch++; },
    get epoch() { return memoryEpoch; }, get depth() { return memoryFrames.length; },
    get suspended() { return memorySuspended; },
    get inline() { return isInline(memoryFrame()); },
    get selection() { return albumSelection ? { attractionId: albumSelection.attractionId, version: albumSelection.version } : null; }
  };
}
