import { createAppController } from "../../src/controller.js";
import { createViews } from "../../src/views.js";
import { createFeedback } from "../../src/feedback.js";

// Use real ES-module factories with browser APIs replaced by controlled fakes.
export function appHarness({ urlService = URL } = {}) {
  const elements = new Map();
  const events = new Map();
  function element(key) {
    if (!elements.has(key)) elements.set(key, {
      dataset: {}, listeners: {}, hidden: false, open: false, returnValue: "",
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute() {}, removeAttribute() {}, focus() {}, append() {}, remove() {}, click() {},
      play: async () => {},
      contains() { return false; }, querySelectorAll() { return []; },
      addEventListener(name, callback, options) {
        (this.listeners[name] ??= []).push({ callback, once: options?.once });
      },
      showModal() { this.open = true; },
      close(value = "") {
        this.open = false;
        this.returnValue = value;
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
      getItem() { return null; }, setItem() {},
      removeItem() { environment.localRemoved = true; }
    },
    navigator: {}, location: { hash: "#home" }, URL: urlService,
    requestAnimationFrame(callback) { callback(); }
  };
  const photoService = {
    getAllPhotoRecords: async () => [], getPhotoRecord: async () => null,
    savePhotoRecord: async () => {},
    deletePhotoRecord: async () => { throw new Error("IndexedDB unavailable"); },
    clearPhotoRecords: async () => { throw new Error("IndexedDB unavailable"); },
    compressPhoto: async () => {}, createTravelCard: async () => {}
  };
  const actualFeedback = createFeedback(environment);
  const confirmation = { handler: null };
  const feedbackService = {
    ...actualFeedback,
    askConfirmation: (options) => confirmation.handler
      ? confirmation.handler(options) : actualFeedback.askConfirmation(options)
  };
  // Dispatching API calls via real event handlers also checks module wiring.
  const injectedPhotoService = Object.fromEntries(Object.keys(photoService).map((name) =>
    [name, (...args) => photoService[name](...args)]));
  const controller = createAppController({ environment, photoService: injectedPhotoService, feedbackService });
  const views = createViews({ getModel: controller.getSnapshot });
  async function click(attribute, value) {
    const selector = `[data-${attribute}]`;
    const key = attribute.replace(/-([a-z])/g, (_, character) => character.toUpperCase());
    const target = { dataset: { [key]: value }, matches: (query) => query === selector,
      closest() { return this; }, setAttribute() {}, disabled: false };
    return events.get("document:click")({ target });
  }
  return { controller, views, environment, photoService, confirmation, element, events, click };
}
