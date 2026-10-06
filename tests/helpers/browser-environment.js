import { createAppController } from "../../src/controller.js";
import { createViews } from "../../src/views.js";
import { createFeedback } from "../../src/feedback.js";
import { createDefaultState, STORAGE_KEY } from "../../src/state.js";

export function checkedState(ids = ["future-school"]) {
  const state = createDefaultState();
  for (const id of ids) state.checkIns[id] = { attractionId: id, checkedInAt: "2026-11-05T04:00:00.000Z", method: "manual", verified: false };
  return state;
}

// Fixtures seed storage/services before constructing the real controller.
export function appHarness({ urlService = URL, initialState, initialPhotos = [], hash = "#home", controllerFactory = createAppController } = {}) {
  const elements = new Map();
  const events = new Map();
  const storageData = new Map(initialState ? [[STORAGE_KEY, JSON.stringify(initialState)]] : []);
  const photoData = new Map(initialPhotos.map((record) => [record.attractionId, record]));
  function element(key) {
    if (!elements.has(key)) elements.set(key, {
      dataset: {}, listeners: {}, hidden: false, open: false, returnValue: "", isConnected: true,
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute() {}, removeAttribute(name) { delete this[name]; }, focus() {}, append() {}, remove() {}, click() {},
      play: async () => {},
      contains(target) { return target?.isConnected !== false; }, querySelectorAll() { return []; },
      addEventListener(name, callback, options) { (this.listeners[name] ??= []).push({ callback, once: options?.once }); },
      showModal() { this.open = true; },
      requestClose() {
        if (!this.open) return;
        const event = { cancelable: true, defaultPrevented: false,
          preventDefault() { this.defaultPrevented = true; } };
        for (const item of this.listeners.cancel || []) item.callback(event);
        if (!event.defaultPrevented) this.close();
      },
      close(value) {
        if (!this.open) return;
        this.open = false;
        if (value !== undefined) this.returnValue = value;
        const listeners = this.listeners.close || [];
        this.listeners.close = listeners.filter((item) => !item.once);
        for (const item of listeners) item.callback();
      }
    });
    return elements.get(key);
  }
  const environment = {
    document: {
      querySelector: element, querySelectorAll() { return []; }, getElementById: element,
      body: { dataset: {}, append() {} }, createElement: element,
      addEventListener(name, callback) { events.set(`document:${name}`, callback); }
    },
    window: {
      setTimeout() { return 1; }, clearTimeout() {}, scrollTo() {},
      addEventListener(name, callback) { events.set(`window:${name}`, callback); }
    },
    localStorage: {
      getItem(key) { return storageData.get(key) ?? null; },
      setItem(key, value) { storageData.set(key, value); },
      removeItem(key) { environment.localRemoved = true; storageData.delete(key); }
    },
    navigator: {}, location: { hash }, URL: urlService,
    requestAnimationFrame(callback) { callback(); }
  };
  const photoService = {
    getAllPhotoRecords: async () => [...photoData.values()], getPhotoRecord: async (id) => photoData.get(id),
    savePhotoRecord: async (record, { canBegin = () => true } = {}) => {
      if (!canBegin()) return null;
      photoData.set(record.attractionId, record);
      return record.attractionId;
    },
    deletePhotoRecord: async (id) => { photoData.delete(id); },
    clearPhotoRecords: async () => { photoData.clear(); },
    compressPhoto: async () => {}, createTravelCard: async () => {}, createPhotoExport: async () => {}
  };
  const actualFeedback = createFeedback(environment);
  const confirmation = { handler: null };
  const feedbackService = { ...actualFeedback,
    askConfirmation: (options) => confirmation.handler ? confirmation.handler(options) : actualFeedback.askConfirmation(options)
  };
  const injectedPhotoService = Object.fromEntries(Object.keys(photoService).map((name) => [name, (...args) => photoService[name](...args)]));
  const controller = controllerFactory({ environment, photoService: injectedPhotoService, feedbackService });
  function navigate(nextHash) { environment.location.hash = nextHash; events.get("window:hashchange")(); }
  const renderers = createViews();
  const views = { ...renderers };
  for (const [name, route] of [["renderHome", "home"], ["renderItinerary", "itinerary"], ["renderAttractions", "attractions"], ["renderPrepare", "prepare"]]) {
    views[name] = () => { navigate(`#${route}`); return element("#app").innerHTML; };
  }
  views.renderAttraction = (id) => { navigate(`#attraction/${id}`); return element("#app").innerHTML; };
  async function click(attribute, value, { detached = false } = {}) {
    const selector = `[data-${attribute}]`;
    const key = attribute.replace(/-([a-z])/g, (_, character) => character.toUpperCase());
    const target = { dataset: { [key]: value }, isConnected: !detached,
      matches: (query) => query === selector, closest() { return this; }, setAttribute() {}, disabled: false };
    return events.get("document:click")({ target });
  }
  async function selectPhoto(file = new Blob(["fixture"]), id = "future-school") {
    await click("gallery-open", id);
    const input = element("#photo-input");
    input.files = [file];
    return input.listeners.change[0].callback();
  }
  const savedState = () => JSON.parse(storageData.get(STORAGE_KEY) || JSON.stringify(createDefaultState()));
  return { controller, views, environment, photoService, confirmation, element, events, click, navigate, selectPhoto, savedState, photoData };
}
