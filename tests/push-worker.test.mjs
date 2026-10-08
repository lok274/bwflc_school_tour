import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const worker = await readFile(new URL("../sw.js", import.meta.url), "utf8");
const base = "https://example.test/trip/";
function harness() {
  const events = {};
  const calls = [];
  const control = { windows: [], notificationFailure: false };
  const context = vm.createContext({ URL, Request, Response, Promise, TextEncoder,
    self: { registration: { scope: base, async showNotification(title, options) {
      calls.push({ kind: "notification", title, options });
      if (control.notificationFailure) throw new Error("notification denied");
    } }, addEventListener(type, handler) { events[type] = handler; }, clients: {
      async matchAll(options) { calls.push({ kind: "match", options }); return control.windows; },
      async openWindow(url) { calls.push({ kind: "open", url }); }
    } }, caches: { open: async () => ({ put() {} }), match: async () => null }, fetch: async () => new Response("not used")
  });
  vm.runInContext(worker, context);
  async function push(value, raw = false) {
    let waiting;
    events.push({ data: value === undefined ? undefined : { text: () => raw ? value : JSON.stringify(value) }, waitUntil(task) { waiting = task; } });
    assert.ok(waiting instanceof Promise, "push extends worker lifetime");
    await waiting;
  }
  async function click(data) {
    let waiting;
    events.notificationclick({ notification: { data, close() { calls.push({ kind: "close" }); } }, waitUntil(task) { waiting = task; } });
    assert.ok(waiting, "click extends worker lifetime");
    await waiting;
  }
  return { events, calls, control, push, click };
}

test("push displays bounded plain message with a fixed same-scope icon and route only", async () => {
  const app = harness();
  await app.push({ id: "notice-1", title: "集合通知", body: "<b>五分鐘後集合</b>", route: "attraction/future-school", url: "https://attacker.test/", createdAt: Date.now() });
  const item = app.calls[0];
  assert.equal(item.title, "集合通知");
  assert.equal(item.options.body, "<b>五分鐘後集合</b>");
  assert.equal(item.options.tag, "outdoor-learning-day-notice-1");
  assert.equal(item.options.renotify, false);
  assert.equal(item.options.icon, `${base}public/icons/app-icon-192.png`);
  assert.deepEqual(JSON.parse(JSON.stringify(item.options.data)), { route: "attraction/future-school" });
  assert.equal(app.calls.some((entry) => entry.kind === "open"), false);
});

test("malformed, oversized, empty, and unsafe-route payloads use safe local fallback", async () => {
  const invalid = [undefined, [], { id: "notice", title: "title", body: "body", route: "https://attacker.test/" },
    { id: "notice", title: "x".repeat(121), body: "body", route: "home" },
    { id: "notice", title: "title", body: "x".repeat(2001), route: "home" },
    { id: "notice", title: "title", body: "body", route: "attraction/unknown" },
    { id: "notice", title: "title", body: "body", route: "device-test" },
    { id: "notice", title: "title", body: "body", route: "home", padding: "x".repeat(4096) }];
  for (const payload of invalid) {
    const app = harness(); await app.push(payload);
    assert.equal(app.calls[0].title, "戶外學習日");
    assert.equal(app.calls[0].options.data.route, "home");
  }
  const malformed = harness(); await malformed.push("{broken", true); assert.equal(malformed.calls[0].options.data.route, "home");
  const utf8 = harness(); await utf8.push(JSON.stringify({ id: "id", title: "title", body: "body", route: "home", padding: "中".repeat(1500) }), true);
  assert.equal(utf8.calls[0].title, "戶外學習日");
});

test("notification display rejection is the lifetime promise rejection, not a false success", async () => {
  const app = harness(); app.control.notificationFailure = true;
  await assert.rejects(app.push({ id: "id", title: "title", body: "body", route: "home" }), /notification denied/);
});

test("notification click navigates and focuses an existing App window", async () => {
  const app = harness();
  app.control.windows = [{ url: `${base}index.html#home`, async navigate(url) {
    app.calls.push({ kind: "navigate", url }); return this;
  }, async focus() { app.calls.push({ kind: "focus" }); } }];
  await app.click({ route: "itinerary", url: "https://attacker.test/" });
  assert.deepEqual(app.calls.map((item) => item.kind), ["close", "match", "navigate", "focus"]);
  assert.equal(app.calls[2].url, `${base}#itinerary`);
  assert.equal(app.calls[1].options.type, "window");
  assert.equal(app.calls[1].options.includeUncontrolled, true);
});

test("notification click never reuses device lab, another origin/project, or a prefix-lookalike", async () => {
  const app = harness();
  app.control.windows = ["https://outside.test/trip/", "https://example.test/trip-two/", "https://example.test/other/", `${base}device-test.html`, `${base}tests/browser/security.html`]
    .map((url) => ({ url, navigate() { throw new Error("unsafe window reused"); }, focus() { throw new Error("unsafe window focused"); } }));
  await app.click({ route: "attraction/shawan-town" });
  assert.equal(app.calls.at(-1).kind, "open");
  assert.equal(app.calls.at(-1).url, `${base}#attraction/shawan-town`);
});

test("unsafe click data falls back to scoped home and never trusts payload URL", async () => {
  for (const route of ["https://attacker.test/", "../other/", "attraction/unknown", "#itinerary", "device-test", "prepare", null]) {
    const app = harness(); await app.click({ route, url: "https://attacker.test/" });
    assert.equal(app.calls.at(-1).url, `${base}#home`);
  }
});

test("disappearing or un-navigable clients fall back to opening App", async () => {
  for (const navigate of [async () => null, async () => { throw new Error("closed"); }]) {
    const app = harness(); app.control.windows = [{ url: `${base}#home`, navigate, focus() { throw new Error("old window should not focus"); } }];
    await app.click({ route: "itinerary" });
    assert.equal(app.calls.at(-1).url, `${base}#itinerary`);
  }
});

test("push handlers preserve the exact static-fetch and non-GET boundary", async () => {
  const app = harness();
  for (const request of [{ method: "POST", url: `${base}v1/subscriptions` }, { method: "GET", url: `${base}v1/messages` }, { method: "GET", url: "https://push.example.test/v1/messages" }, { method: "GET", url: `${base}src/push-client.js?secret=1` }]) {
    let handled = false; app.events.fetch({ request, respondWith() { handled = true; }, waitUntil() {} }); assert.equal(handled, false);
  }
  for (const path of ["src/push-client.js", "src/push-config.js"]) {
    let handled = false; app.events.fetch({ request: { method: "GET", url: `${base}${path}` }, respondWith() { handled = true; }, waitUntil() {} }); assert.equal(handled, true);
  }
});

test("notification text boundaries use Unicode codepoints and reject forbidden controls", async () => {
  const good = harness();
  await good.push({ id: "emoji", title: "😀".repeat(80), body: "😀".repeat(600), route: "home" });
  assert.equal(good.calls[0].title, "😀".repeat(80));
  for (const change of [{ title: "😀".repeat(81) }, { body: "😀".repeat(601) }, { title: "bad\u0000" }, { body: "bad\u007f" }]) {
    const app = harness(); await app.push({ id: "bad", title: "title", body: "body", route: "home", ...change });
    assert.equal(app.calls[0].title, "戶外學習日");
  }
  const lines = harness(); await lines.push({ id: "lines", title: "集合\n通知", body: "第一行\n第二行", route: "home" });
  assert.equal(lines.calls[0].title, "集合\n通知");
});
