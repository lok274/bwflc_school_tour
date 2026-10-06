// Public address coordinates from the Government Address Lookup Service, checked 2026-10-06.
// The @ coordinate in the supplied Google search URL is the map viewport, not this address.
export const DEVICE_TEST_LOCATION = Object.freeze({
  id: "eastern-hospital-road-test",
  name: "東院道 11 號測試點",
  address: "香港銅鑼灣東院道 11 號",
  geo: Object.freeze({ lat: 22.27579, lng: 114.19044, radiusM: 100, coordSystem: "WGS84" }),
  sourceUrl: "https://www.als.gov.hk/lookup?q=11%20Eastern%20Hospital%20Road&n=10",
  mapUrl: "https://www.google.com/maps/search/?api=1&query=22.27579%2C114.19044"
});

export const DEVICE_TEST_STORAGE_KEY = "outdoorLearningDay.deviceTest.v1";
export const DEVICE_TEST_DATABASE = "outdoorLearningDay.deviceTest.photos";

export function getTestLocation(id) {
  return id === DEVICE_TEST_LOCATION.id ? DEVICE_TEST_LOCATION : undefined;
}
