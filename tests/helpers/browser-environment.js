import { createAppController } from "../../src/controller.js";
import { createViews } from "../../src/views.js";
import { createFeedback } from "../../src/feedback.js";
import { createDefaultState, STORAGE_KEY } from "../../src/state.js";
import { STUDENT_IDENTITY_STORAGE_KEY } from "../../src/student-identity.js";

export const FIXTURE_IDENTITY = Object.freeze({ studentName: "合成登入學生", className: "測試班", studentNumber: "001" });

// Controllers may retire old drafts, but fixtures must never open real draft databases.
export function createFixtureIndexedDB(indexedDB) {
  const prefix = `outdoorLearningDay.fixture.${globalThis.crypto.randomUUID()}`;
  const databases = new Map([
    ["outdoorLearningDay.workbook.v1", `${prefix}.workbook.v1`],
    ["outdoorLearningDay.rehearsal.workbook.v1", `${prefix}.rehearsal.workbook.v1`]
  ]);
  return Object.freeze({
    open(name, ...options) {
      if (!databases.has(name)) throw Error("測試控制器不可開啟其他資料庫。");
      return indexedDB.open(databases.get(name), ...options);
    }
  });
}

export function seedStudentIdentityForFixture(storage) {
  if (storage.getItem(STUDENT_IDENTITY_STORAGE_KEY) != null) throw Error("已有學生資料，只可在空白測試儲存執行。");
  storage.setItem(STUDENT_IDENTITY_STORAGE_KEY, JSON.stringify({ version: 1, ...FIXTURE_IDENTITY }));
}
export function fillStudentIdentity(app, identity = FIXTURE_IDENTITY) {
  for (const [key, value] of Object.entries(identity)) {
    const target = app.element(`#student-login-${key}`);
    Object.assign(target, { value, dataset: { studentIdentityField: key }, matches: () => false });
    app.events.get("document:input")({ target });
  }
}
export function submitStudentIdentity(app) {
  return app.events.get("document:submit")({ target: { id: "student-login-form", isConnected: true }, preventDefault() {} });
}
export async function loginStudentForFixture(document) {
  const form = document.getElementById("student-login-form");
  if (!form) return;
  for (const [key, value] of Object.entries(FIXTURE_IDENTITY)) {
    const field = document.getElementById(`student-login-${key}`);
    field.value = value; field.dispatchEvent(new Event("input", { bubbles: true }));
  }
  form.requestSubmit();
  const end = Date.now() + 5000;
  while (document.body.dataset.view === "login") {
    if (Date.now() > end) throw Error("合成學生登入逾時。");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

export function checkedState(ids = ["future-school"]) {
  const state = createDefaultState();
  for (const id of ids) state.checkIns[id] = { attractionId: id, checkedInAt: "2026-11-05T04:00:00.000Z", method: "manual", verified: false };
  return state;
}

// Fixtures seed storage/services before constructing the real controller.
export function appHarness({ urlService = URL, initialState, initialPhotos = [], hash = "#home", controllerFactory = createAppController,
  initialIdentity = FIXTURE_IDENTITY } = {}) {
  const elements = new Map();
  const events = new Map();
  const storageData = new Map(initialState ? [[STORAGE_KEY, JSON.stringify(initialState)]] : []);
  if (initialIdentity) storageData.set(STUDENT_IDENTITY_STORAGE_KEY, JSON.stringify({ version: 1, ...initialIdentity }));
  const photoData = new Map(initialPhotos.map((record) => [record.attractionId, record]));
  function element(key) {
    if (!elements.has(key)) elements.set(key, {
      dataset: {}, listeners: {}, hidden: false, open: false, returnValue: "", isConnected: true,
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute() {}, removeAttribute(name) { delete this[name]; }, focus() {}, append() {}, remove() {}, click() {},
      play: async () => {},
      contains(target) { return target?.isConnected !== false; }, querySelectorAll() { return []; },
      querySelector(selector) { return selector === 'input[name="photo-export-scope"]:checked' ? { value: this.scope || "all" } : null; },
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
      querySelector: element, querySelectorAll() { return []; }, getElementById: id => element(`#${id}`),
      body: { dataset: {}, append() {} }, createElement: element,
      addEventListener(name, callback) { events.set(`document:${name}`, callback); }
    },
    window: {
      setTimeout() { return 1; }, clearTimeout() {}, scrollTo() {},
      history: { replaceState(_state, _title, hash) { environment.location.hash = hash; } },
      addEventListener(name, callback) {
        const key = `window:${name}`, previous = events.get(key);
        events.set(key, previous ? event => Promise.all([previous(event), callback(event)]) : callback);
      }
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
    compressPhoto: async () => {}, createPhotoExport: async () => {}
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
  for (const [name, route] of [["renderHome", "home"], ["renderItinerary", "itinerary"]]) {
    views[name] = () => { navigate(`#${route}`); return element("#app").innerHTML; };
  }
  views.renderAttraction = (id) => { navigate(`#attraction/${id}`); return element("#app").innerHTML; };
  async function click(attribute, value, { detached = false, dataset = {} } = {}) {
    const selector = `[data-${attribute}]`;
    const key = attribute.replace(/-([a-z])/g, (_, character) => character.toUpperCase());
    const target = { dataset: { [key]: value, ...dataset }, isConnected: !detached,
      matches: (query) => query.split(",").some(item => item.trim() === selector), closest() { return this; }, setAttribute() {}, disabled: false };
    return events.get("document:click")({ target });
  }
  async function selectPhoto(file = new Blob(["fixture"]), id = "future-school") {
    await click("native-camera-open", id);
    const input = element("#native-camera-input");
    input.files = [file];
    return input.listeners.change[0].callback();
  }
  const savedState = () => JSON.parse(storageData.get(STORAGE_KEY) || JSON.stringify(createDefaultState()));
  return { controller, views, environment, photoService, confirmation, element, events, click, navigate, selectPhoto, savedState, photoData };
}
