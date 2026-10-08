import { ATTRACTIONS, DEPARTURE_LOCATION, TRIP_DATA } from "./data.js";
import { getAttraction } from "./formatting.js";
import { readonlyCopy } from "./store.js";

// View snapshots never expose the store, a Map, a Blob, or an install event.
export function createPageModels({ store, canInstall, getPhotoPreview, getSelectedPhotoIds = () => [], getPushSnapshot = () => ({ statusMessage: "訊息通知暫未開放。" }) }) {
  function getPageModel(route) {
    if (route.view === "home") return readonlyCopy({ view: "home", trip: { title: TRIP_DATA.title }, canInstall: canInstall(), push: getPushSnapshot() });
    if (route.view === "itinerary") return readonlyCopy({
      view: "itinerary", checkIns: store.getCheckInBadges(), allCheckInsComplete: store.hasCompletedAllCheckIns(),
      days: TRIP_DATA.itinerary.map((day) => ({ ...day, route: day.route.map((label) => {
        if (day.day === 1 && label === DEPARTURE_LOCATION.name) {
          return { label, attractionId: null, checkInId: DEPARTURE_LOCATION.id, mapUrl: DEPARTURE_LOCATION.mapUrl };
        }
        const attraction = ATTRACTIONS.find((item) => label.includes(item.name.replace("歡姐", "")) || label.includes(item.name));
        return { label, attractionId: attraction?.id || null };
      }) }))
    });
    if (route.view === "attraction") {
      const record = store.getPhoto(route.attractionId);
      const selected = getSelectedPhotoIds(route.attractionId);
      const photos = store.hasCheckIn(route.attractionId) ? store.getPhotos(route.attractionId).map((item) => ({
        photoId: item.photoId, url: getPhotoPreview(route.attractionId, item.photoId), width: item.width, height: item.height,
        selected: selected.includes(item.photoId)
      })) : [];
      return readonlyCopy({
        view: "attraction", attraction: getAttraction(route.attractionId), checkIn: store.getCheckIn(route.attractionId),
        photos, allCheckInsComplete: store.hasCompletedAllCheckIns(),
        photo: record && store.hasCheckIn(route.attractionId) ? photos.at(-1) : null
      });
    }
    throw new Error("未支援的頁面資料要求。");
  }
  return { getPageModel };
}
