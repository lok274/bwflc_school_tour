import { PHOTO_PAGE_SIZE } from "./app-settings.js";
import { CHECK_IN_LOCATIONS, REQUIRED_CHECK_IN_LOCATIONS, TRIP_DATA, TRIP_BOOKLET } from "./data.js";
import { getAttraction } from "./formatting.js";
import { readonlyCopy } from "./store.js";

// View snapshots never expose the store, a Map, a Blob, or an install event.
export function createPageModels({ store, canInstall = () => false, getInstallState = () => ({ mode: canInstall() ? "native" : "none", helpOpen: false }), getPhotoPreview, getSelectedPhotoIds = () => [], getCardReflection = () => "", getPhotoReadError = () => false, getPhotoReadState = () => getPhotoReadError() ? "error" : "ready", getSummaryDraft = () => ({ photos: [], busy: false }), getMemoryState = () => null, getPushSnapshot = () => ({ statusMessage: "訊息通知暫未開放。" }), getWorkbookModel }) {
  function getPageModel(route) {
    if (route.view === "workbook") return readonlyCopy(getWorkbookModel(route.section));
    if (route.view === "home") {
      const install = getInstallState();
      return readonlyCopy({ view: "home", trip: { title: TRIP_DATA.title, year: TRIP_DATA.year, dateLabel: TRIP_DATA.dateLabel, duration: TRIP_DATA.duration }, booklet: TRIP_BOOKLET, canInstall: install.mode !== "none", install, push: getPushSnapshot() });
    }
    if (route.view === "itinerary") return readonlyCopy({
      view: "itinerary", checkIns: store.getCheckInBadges(), allCheckInsComplete: store.hasCompletedAllCheckIns(), requiredCount: REQUIRED_CHECK_IN_LOCATIONS.length,
      introductionTitle: TRIP_DATA.itineraryIntroduction.title,
      days: TRIP_DATA.itinerary.map((day) => ({ ...day, route: day.route.map((label) => {
        const attraction = CHECK_IN_LOCATIONS.find((item) => label.includes(item.name.replace("歡姐", "")) || label.includes(item.name));
        return { label, attractionId: attraction?.id || null };
      }) }))
    });
    if (route.view === "introduction") return readonlyCopy({ view: "introduction", introduction: TRIP_DATA.itineraryIntroduction });
    if (route.view === "memories") {
      const readState = getPhotoReadState();
      const ready = readState === "ready";
      const state = getMemoryState();
      const visible = state && !state.suspended;
      const selected = getSelectedPhotoIds().filter(id => { const photo = store.getPhotoById(id); return photo && store.hasCheckIn(photo.attractionId); });
      const describe = (item, preview = true) => item ? ({ photoId: item.photoId,
        url: preview ? getPhotoPreview(item.attractionId, item.photoId) : null, width: item.width, height: item.height,
        createdAt: item.createdAt, selected: selected.includes(item.photoId), reflection: getCardReflection(item.attractionId, item.photoId) }) : null;
      const albums = ready ? CHECK_IN_LOCATIONS.filter(item => store.hasCheckIn(item.id) && store.hasPhoto(item.id)).map(attraction => {
        const photos = store.getPhotos(attraction.id);
        return { attraction: { id: attraction.id, name: attraction.name, day: attraction.day, city: attraction.city },
          photoCount: photos.length, selectedCount: photos.filter(item => selected.includes(item.photoId)).length,
          cover: describe(photos.at(-1)) };
      }) : [];
      let summaryCard = null;
      if (store.hasCompletedAllCheckIns()) {
        const draft = getSummaryDraft();
        const stations = CHECK_IN_LOCATIONS.map(attraction => {
          const selectedId = draft.photos.find(item => item.attractionId === attraction.id)?.photoId;
          const photos = ready && store.hasCheckIn(attraction.id) ? store.getPhotos(attraction.id) : [];
          const chosen = photos.find(item => item.photoId === selectedId);
          return { attraction: { id: attraction.id, name: attraction.name }, photoCount: ready ? photos.length : null,
            required: REQUIRED_CHECK_IN_LOCATIONS.some(item => item.id === attraction.id), checkedIn: store.hasCheckIn(attraction.id),
            selectedPhotoId: chosen?.photoId || null,
            selectedPhoto: describe(chosen, visible && state.mode === "summary") };
        });
        const requiredStations = stations.filter(item => item.required);
        summaryCard = { stations, readState, busy: draft.busy,
          requiredCount: requiredStations.length,
          photoStationCount: ready ? requiredStations.filter(item => item.photoCount).length : null,
          requiredSelectedCount: ready ? requiredStations.filter(item => item.selectedPhotoId).length : null,
          selectedCount: ready ? stations.filter(item => item.selectedPhotoId).length : null,
          canDownload: ready && !draft.busy && requiredStations.every(item => item.selectedPhotoId) };
      }
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
        memoryOverlay = { mode: state.mode, depth: state.depth, readState, busy: state.busy,
          albumSelectionActive: state.albumSelectionActive, selectionChanged: state.selectionChanged,
          confirmedSelectedCount: selected.length,
          attraction: attraction ? { id: attraction.id, name: attraction.name } : null,
          checkIn: attraction ? store.getCheckIn(attraction.id) : null,
          photoCount: photos.length, page, pageCount, selectedCount: overlaySelected.length,
          albumSelectedCount: photos.filter(item => overlaySelected.includes(item.photoId)).length,
          photos: ["album", "picker"].includes(state.mode) ? photos.slice(page * PHOTO_PAGE_SIZE, page * PHOTO_PAGE_SIZE + PHOTO_PAGE_SIZE).map(item => ({ ...describe(item), selected: overlaySelected.includes(item.photoId),
            summarySelected: summaryCard?.stations.find(station => station.attraction.id === attraction.id)?.selectedPhotoId === item.photoId })) : [],
          photo: state.mode === "photo" ? describe(photos[index]) : null,
          photoIndex: index, previousPhotoId: photos[index - 1]?.photoId || null, nextPhotoId: photos[index + 1]?.photoId || null,
          cardOpen: Boolean(state.cardOpen), summaryCard: state.mode === "summary" ? summaryCard : null };
      }
      return readonlyCopy({ view: "memories", albums, memoryOverlay, selectedPhotoIds: selected,
        checkInCardAvailable: store.hasCompletedAllCheckIns(),
        selectedCount: selected.length, readError: getPhotoReadError(), readState, summaryCard,
        photoCount: ready ? albums.reduce((count, album) => count + album.photoCount, 0) : null });
    }
    if (route.view === "attraction") {
      const record = store.getPhoto(route.attractionId);
      const photos = store.hasCheckIn(route.attractionId) ? store.getPhotos(route.attractionId).map((item) => ({
        photoId: item.photoId, width: item.width, height: item.height
      })) : [];
      return readonlyCopy({
        view: "attraction", attraction: getAttraction(route.attractionId), checkIn: store.getCheckIn(route.attractionId),
        photos, allCheckInsComplete: store.hasCompletedAllCheckIns(), requiredCount: REQUIRED_CHECK_IN_LOCATIONS.length,
        photo: record && store.hasCheckIn(route.attractionId) ? photos.at(-1) : null
      });
    }
    throw new Error("未支援的頁面資料要求。");
  }
  return { getPageModel };
}
