import { PHOTO_PAGE_SIZE } from "./app-settings.js";
import { CHECK_IN_LOCATIONS, REQUIRED_CHECK_IN_LOCATIONS, TRIP_DATA, TRIP_BOOKLET } from "./data.js";
import { getAttraction } from "./formatting.js";
import { readonlyCopy } from "./store.js";

export function createPageModels({ store, getSyncState = () => null, getPhotoPreview, getSelectedPhotoIds = () => [], getPhotoReadError = () => false, getPhotoReadState = () => getPhotoReadError() ? "error" : "ready", getMemoryState = () => null, getCheckInBusy = () => false }) {
  function getCheckInProgress(includeStations = false) {
    const stations = REQUIRED_CHECK_IN_LOCATIONS.map(item => ({ id: item.id, name: item.name, checkIn: store.getCheckIn(item.id) }));
    return { filled: stations.filter(item => item.checkIn).length, total: stations.length, ...(includeStations ? { stations } : {}) };
  }
  function getPageModel(route) {
    if (route.view === "itinerary") {
      const stops = CHECK_IN_LOCATIONS.map(attraction => {
        const checked = store.hasCheckIn(attraction.id);
        const photos = checked ? store.getPhotos(attraction.id).map(item => ({ photoId: item.photoId, width: item.width, height: item.height })) : [];
        return { attraction, checkIn: store.getCheckIn(attraction.id), photos, photo: photos.at(-1) || null, checkInBusy: getCheckInBusy(attraction.id) };
      });
      const selected = stops.find(stop => stop.attraction.id === route.attractionId);
      return readonlyCopy({ view: "itinerary", checkInProgress: getCheckInProgress(), trip: { title: TRIP_DATA.title, year: TRIP_DATA.year, dateLabel: TRIP_DATA.dateLabel, duration: TRIP_DATA.duration }, booklet: TRIP_BOOKLET,
        checkIns: store.getCheckInBadges(), allCheckInsComplete: store.hasCompletedAllCheckIns(), requiredCount: REQUIRED_CHECK_IN_LOCATIONS.length,
        introduction: TRIP_DATA.itineraryIntroduction, introductionOpen: route.section === "introduction",
        stops, sync: getSyncState(),
        days: TRIP_DATA.itinerary.map(day => ({ ...day, route: day.route.map((label, index) => ({ label, attractionId: day.attractionIds[index] })) })),
        ...(selected ? { attraction: selected.attraction, checkIn: selected.checkIn, photos: selected.photos, photo: selected.photo } : {}) });
    }
    if (route.view === "memories") {
      const section = route.section === undefined ? "albums" : route.section;
      const readState = getPhotoReadState();
      const ready = readState === "ready";
      const state = getMemoryState();
      const visible = state && !state.suspended;
      const selected = getSelectedPhotoIds().filter(id => { const photo = store.getPhotoById(id); return photo && store.hasCheckIn(photo.attractionId); });
      const describe = (item, preview = true) => item ? ({ photoId: item.photoId,
        url: preview ? getPhotoPreview(item.attractionId, item.photoId) : null, width: item.width, height: item.height,
        createdAt: item.createdAt, selected: selected.includes(item.photoId) }) : null;
      const albums = ready ? CHECK_IN_LOCATIONS.filter(item => store.hasCheckIn(item.id) && store.hasPhoto(item.id)).map(attraction => {
        const photos = store.getPhotos(attraction.id);
        return { attraction: { id: attraction.id, name: attraction.name, day: attraction.day, city: attraction.city },
          photoCount: photos.length, selectedCount: photos.filter(item => selected.includes(item.photoId)).length,
          cover: describe(photos.at(-1), section === "albums") };
      }) : [];
      let memoryOverlay = null;
      if (visible) {
        const attraction = getAttraction(state.attractionId);
        const photos = ready && attraction && store.hasCheckIn(attraction.id) ? [...store.getPhotos(attraction.id)].reverse() : [];
        const pageCount = Math.max(1, Math.ceil(photos.length / PHOTO_PAGE_SIZE));
        const page = Math.max(0, Math.min(state.page || 0, pageCount - 1));
        const index = photos.findIndex(item => item.photoId === state.photoId);
        const overlaySelected = state.albumSelectionActive ? [
          ...selected.filter(id => store.getPhotoById(id)?.attractionId !== attraction?.id),
          ...photos.filter(item => state.draftSelectedPhotoIds.includes(item.photoId)).map(item => item.photoId)
        ] : selected;
        memoryOverlay = { mode: state.mode, depth: state.depth, readState,
          albumSelectionActive: state.albumSelectionActive, selectionChanged: state.selectionChanged,
          confirmedSelectedCount: selected.length,
          attraction: attraction ? { id: attraction.id, name: attraction.name } : null,
          checkIn: attraction ? store.getCheckIn(attraction.id) : null,
          photoCount: photos.length, page, pageCount, selectedCount: overlaySelected.length,
          albumSelectedCount: photos.filter(item => overlaySelected.includes(item.photoId)).length,
          photos: state.mode === "album" ? photos.slice(page * PHOTO_PAGE_SIZE, page * PHOTO_PAGE_SIZE + PHOTO_PAGE_SIZE).map(item => ({ ...describe(item), selected: overlaySelected.includes(item.photoId) })) : [],
          photo: state.mode === "photo" ? describe(photos[index]) : null,
          photoIndex: index, previousPhotoId: photos[index - 1]?.photoId || null, nextPhotoId: photos[index + 1]?.photoId || null };
      }
      return readonlyCopy({ view: "memories", section, checkInProgress: getCheckInProgress(true), albums, memoryOverlay, selectedPhotoIds: selected,
        checkInCardAvailable: store.hasCompletedAllCheckIns(),
        selectedCount: selected.length, readError: getPhotoReadError(), readState,
        photoCount: ready ? albums.reduce((count, album) => count + album.photoCount, 0) : null });
    }
    throw new Error("未支援的頁面資料要求。");
  }
  return { getPageModel };
}
