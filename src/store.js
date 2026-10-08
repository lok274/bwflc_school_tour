import { ATTRACTIONS } from "./data.js";
import { STORAGE_KEY, createDefaultState, loadState, saveState } from "./state.js";

// Copies, rather than freezes, the caller's objects. Blob contents are immutable.
export function readonlyCopy(value) {
  if (!value || typeof value !== "object") return value;
  if (typeof Blob !== "undefined" && value instanceof Blob) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(readonlyCopy));
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readonlyCopy(item)])));
}

export function createDataStore({ storage, onSaveError }) {
  let state = loadState(storage);
  let photos = new Map();
  const photoVersions = new Map();
  const attractionIds = new Set(ATTRACTIONS.map((item) => item.id));

  function persist() {
    try {
      state = saveState(state, storage);
      return true;
    } catch {
      onSaveError();
      return false;
    }
  }

  function getCheckIn(id) { return readonlyCopy(state.checkIns[id] || null); }
  function hasCheckIn(id) { return Boolean(state.checkIns[id]); }
  function getCheckInBadges() {
    return readonlyCopy(Object.fromEntries(Object.entries(state.checkIns).map(([id, record]) => [id, { verified: record.verified }])));
  }

  function recordCheckIn(id, record) {
    if (!attractionIds.has(id) || hasCheckIn(id)) return { accepted: false, saved: false };
    if (record.attractionId !== id || typeof record.checkedInAt !== "string" || Number.isNaN(new Date(record.checkedInAt).getTime())
      || !["gps", "manual"].includes(record.method) || record.verified !== (record.method === "gps")) {
      return { accepted: false, saved: false };
    }
    state.checkIns[id] = { ...record };
    return { accepted: true, saved: persist() };
  }
  // Only the coordinating controller can finish an already authorised deletion.
  function removeCheckIn(id) {
    delete state.checkIns[id];
    return persist();
  }
  function clearProgress() {
    storage.removeItem(STORAGE_KEY);
    state = createDefaultState();
  }

  function replacePhotos(records) {
    const next = new Map(records.filter((record) => attractionIds.has(record?.attractionId)).map((record) => {
      const photoId = record.photoId || record.attractionId;
      return [photoId, readonlyCopy({ ...record, photoId })];
    }));
    for (const id of attractionIds) {
      const before = [...photos.values()].filter((record) => record.attractionId === id);
      const after = [...next.values()].filter((record) => record.attractionId === id);
      const equal = before.length === after.length && before.every((record) => {
        const other = next.get(record.photoId);
        return other && (record.writeId ? record.writeId === other.writeId : record.blob === other.blob)
          && record.width === other.width && record.height === other.height;
      });
      if (!equal) photoVersions.set(id, (photoVersions.get(id) || 0) + 1);
    }
    photos = next;
  }
  function getPhotos(id) {
    return Object.freeze([...photos.values()].filter((record) => record.attractionId === id)
      .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || "")));
  }
  function getPhoto(id, photoId) {
    if (!photoId) return getPhotos(id).at(-1) || null;
    const record = photos.get(photoId);
    return record?.attractionId === id ? record : null;
  }

  return {
    getCheckIn, hasCheckIn, getCheckInBadges,
    recordCheckIn, removeCheckIn, clearProgress,
    replacePhotos, getPhoto, getPhotos,
    hasPhoto: (id) => getPhotos(id).length > 0, getPhotoVersion: (id) => photoVersions.get(id) || 0,
    get photoCount() { return photos.size; }
  };
}
