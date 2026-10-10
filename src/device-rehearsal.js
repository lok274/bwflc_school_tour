import { createAppController } from "./controller.js";
import { createViews } from "./views.js";
import { createFeedback } from "./feedback.js";
import { CHECK_IN_LOCATIONS } from "./data.js";
import { gcj02ToWgs84 } from "./geo.js";
import { STORAGE_KEY } from "./state.js";
import * as photoFunctions from "./photos.js";
import { createWorkbookRepository } from "./workbook-storage.js";
import { createWorkbookPDF } from "./workbook-pdf.js";

// Never read, migrate or clear the real App or the earlier hardware diagnostic data.
export const REHEARSAL_STORAGE_KEY = "outdoorLearningDay.rehearsal.v1";
export const REHEARSAL_PHOTO_DATABASE = "outdoorLearningDay.rehearsal.photos";
export const REHEARSAL_WORKBOOK_DATABASE = "outdoorLearningDay.rehearsal.workbook.v1";
export const REHEARSAL_SCENARIOS = Object.freeze(["within", "too-far", "inaccurate", "denied", "timeout"]);

export function createRehearsalStorage(storage) {
  const key = candidate => {
    if (candidate !== STORAGE_KEY) throw new Error("測試頁拒絕存取非測試旅程資料。");
    return REHEARSAL_STORAGE_KEY;
  };
  return Object.freeze({
    getItem: candidate => storage.getItem(key(candidate)),
    setItem: (candidate, value) => storage.setItem(key(candidate), value),
    removeItem: candidate => storage.removeItem(key(candidate))
  });
}

// Synthetic fixes go through the same geofence and confirmation code as production.
// No call is forwarded to the browser's real geolocation service.
export function createRehearsalGeolocation({ getHash, getScenario, schedule = callback => setTimeout(callback, 250) }) {
  let epoch = 0;
  return Object.freeze({
    invalidate() { epoch++; },
    getCurrentPosition(success, failure) {
      const token = epoch;
      const match = /^#attraction\/([^/]+)$/.exec(getHash());
      const attraction = CHECK_IN_LOCATIONS.find(item => item.id === match?.[1]);
      const scenario = getScenario();
      schedule(() => {
        if (token !== epoch) return;
        if (!attraction || !REHEARSAL_SCENARIOS.includes(scenario)) { failure({ code: 2 }); return; }
        if (scenario === "denied" || scenario === "timeout") { failure({ code: scenario === "denied" ? 1 : 3 }); return; }
        const centre = attraction.geo.coordSystem === "GCJ02" ? gcj02ToWgs84(attraction.geo) : attraction.geo;
        success({ coords: { latitude: centre.lat + (scenario === "too-far" ? .03 : 0), longitude: centre.lng, accuracy: scenario === "inaccurate" ? 600 : 15 } });
      });
    }
  });
}

export function createRehearsalController({ environment = globalThis, photoService, workbookRepository, workbookPDFService, feedbackService, scenario = "within", schedule } = {}) {
  if (!REHEARSAL_SCENARIOS.includes(scenario)) throw new Error("未知測試定位情況。");
  const geolocation = createRehearsalGeolocation({ getHash: () => environment.location.hash, getScenario: () => scenario, schedule });
  const navigator = environment.navigator;
  // Copy only required capabilities; native Navigator methods keep their receiver.
  const testNavigator = {
    get onLine() { return navigator.onLine; }, get standalone() { return navigator.standalone; },
    mediaDevices: navigator.mediaDevices,
    ...(navigator.serviceWorker ? { serviceWorker: navigator.serviceWorker } : {}),
    geolocation,
    ...(navigator.share ? { share: navigator.share.bind(navigator) } : {}),
    ...(navigator.canShare ? { canShare: navigator.canShare.bind(navigator) } : {})
  };
  const basePhotos = photoService || { ...photoFunctions, ...photoFunctions.createPhotoRepository({ databaseName: REHEARSAL_PHOTO_DATABASE, indexedDB: environment.indexedDB }) };
  const photos = { ...basePhotos,
    createTravelCard: options => basePhotos.createTravelCard({ ...options, testOnly: true, tripTitle: `測試預演 · ${options.tripTitle}` }),
    createTripAIKit: options => basePhotos.createTripAIKit({ ...options, testOnly: true })
  };
  const baseFeedback = feedbackService || createFeedback({ document: environment.document, window: environment.window, requestAnimationFrame: environment.requestAnimationFrame, stampLabel: "測試完成" });
  const feedback = { ...baseFeedback,
    showToast: (message, ...args) => baseFeedback.showToast(`測試預演：${message}`, ...args),
    askConfirmation: options => baseFeedback.askConfirmation({ ...options, title: `測試預演：${options.title}` }),
    celebrateStamp: attraction => baseFeedback.celebrateStamp({ ...attraction, name: `測試：${attraction.name}` })
  };
  const testEnvironment = {
    document: environment.document, window: environment.window, navigator: testNavigator,
    location: environment.location, localStorage: createRehearsalStorage(environment.localStorage),
    URL: environment.URL, requestAnimationFrame: environment.requestAnimationFrame,
    indexedDB: environment.indexedDB, crypto: environment.crypto,
    matchMedia: environment.matchMedia?.bind(environment),
    isSecureContext: environment.isSecureContext
  };
  const app = createAppController({ environment: testEnvironment, photoService: photos, feedbackService: feedback,
    viewsFactory: () => createViews({ testOnly: true }), testKind: "rehearsal",
    workbookRepository: workbookRepository || createWorkbookRepository({ indexedDB: environment.indexedDB, databaseName: REHEARSAL_WORKBOOK_DATABASE }),
    workbookPDFService: options => (workbookPDFService || createWorkbookPDF)({ ...options, testOnly: true }),
    pushClientFactory: () => ({
      getSnapshot: () => Object.freeze({ canEnable: false, canDisable: false, statusMessage: "測試預演不連接正式通知服務，也不建立通知訂閱。" }),
      initialize: async () => {}, refresh: async () => {}
    })
  });
  function setScenario(next) {
    if (!REHEARSAL_SCENARIOS.includes(next)) return false;
    scenario = next; geolocation.invalidate(); app.render(); return true;
  }
  const select = environment.document.getElementById("rehearsal-scenario");
  if (select) select.value = scenario;
  select?.addEventListener("change", () => setScenario(select.value));
  environment.window.addEventListener("hashchange", () => geolocation.invalidate());
  environment.window.addEventListener("pagehide", () => geolocation.invalidate());
  return Object.freeze({ ...app, setScenario, getScenario: () => scenario });
}
