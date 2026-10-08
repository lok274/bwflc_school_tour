import test from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { createPushClient, PUSH_STORAGE_KEY } from "../src/push-client.js";

const appUrl = "https://example.test/trip/";
const apiBaseUrl = "https://push.example.test/";
const b64 = (bytes) => Buffer.from(bytes).toString("base64url");
const key = b64(Uint8Array.from({ length: 65 }, (_, i) => i ? i : 4));
const keyId = createHash("sha256").update(key).digest("hex");
const idFor = (endpoint) => createHash("sha256").update(endpoint).digest("hex");
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const tick = () => new Promise(setImmediate);
const deferred = () => { let resolve; let reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; };
const immediateCrypto = { getRandomValues: (value) => webcrypto.getRandomValues(value),
  subtle: { digest: async (_algorithm, bytes) => Uint8Array.from(createHash("sha256").update(bytes).digest()).buffer } };

function harness({ initialStorage, endpoint = "https://fcm.googleapis.com/fcm/send/private", permission = "default", initialNative = false, config = { apiBaseUrl } } = {}) {
  const values = new Map(initialStorage ? [[PUSH_STORAGE_KEY, JSON.stringify(initialStorage)]] : []);
  const calls = [];
  const control = { offlineDelete: false, permissionReply: "granted", nativeUnsubscribe: true, post: null, getRegistration: null, writeFails: false, key, keyId, appUrl };
  let native = null;
  function makeNative() {
    const record = {
      endpoint, expirationTime: null,
      keys: { p256dh: key, auth: b64(new Uint8Array(16).fill(7)) }
    };
    return { endpoint, toJSON: () => structuredClone(record), async unsubscribe() {
      calls.push({ name: "unsubscribe" });
      if (control.nativeUnsubscribe === "throw") throw new Error("unsubscribe failed");
      if (control.nativeUnsubscribe) native = null;
      return control.nativeUnsubscribe;
    } };
  }
  if (initialNative) native = makeNative();
  const registration = { scope: appUrl, active: {}, pushManager: {
    async getSubscription() { calls.push({ name: "getSubscription" }); return native; },
    async subscribe(options) { calls.push({ name: "subscribe", options }); if (control.nativeCreation) return control.nativeCreation.promise.then((value) => (native = value)); return (native = makeNative()); }
  } };
  const environment = {
    isSecureContext: true, location: { href: `${appUrl}#home`, hostname: "example.test" }, navigator: { serviceWorker: {} },
    PushManager: function () {}, crypto: webcrypto, setTimeout, clearTimeout,
    Notification: { permission, requestPermission() {
      calls.push({ name: "permission" });
      const reply = control.permissionPromise || Promise.resolve(control.permissionReply);
      return reply.then((result) => (environment.Notification.permission = result));
    } },
    localStorage: { getItem: (key) => values.get(key) ?? null, setItem(key, value) {
      calls.push({ name: "persist", value }); if (control.writeFails) throw new Error("full"); values.set(key, value);
    } },
    async fetch(url, options) {
      calls.push({ name: "fetch", url, options });
      const path = new URL(url).pathname;
      if (control.fetch) return control.fetch(url, options);
      if (path === "/v1/config") return json({ enabled: true, publicKey: control.key, keyId: control.keyId, appUrl: control.appUrl });
      if (options.method === "DELETE") { if (control.offlineDelete) throw new Error("offline"); return new Response(null, { status: 204 }); }
      if (path.endsWith("/test")) return json({ id: "test-job", status: "queued" }, 202);
      if (path === "/v1/subscriptions") {
        const body = JSON.parse(options.body);
        const owner = JSON.parse(values.get(PUSH_STORAGE_KEY)).active;
        assert.equal(owner.token, body.managementToken, "ownership must persist before POST");
        if (control.post) return control.post(body);
        return json({ id: idFor(body.subscription.endpoint), keyId: control.keyId, registered: true, expiresAt: Date.now() + 86_400_000 });
      }
      throw new Error(`unexpected path ${path}`);
    }
  };
  const client = createPushClient({ environment, config, getRegistration: () => control.getRegistration ? control.getRegistration() : Promise.resolve(registration), onChange(snapshot) { calls.push({ name: "change", snapshot }); } });
  return { client, environment, control, calls, values, registration, makeNative, native: () => native,
    saved: () => JSON.parse(values.get(PUSH_STORAGE_KEY) || '{"active":null,"pending":[]}') };
}

test("empty default configuration makes no requests or permission prompts", async () => {
  const app = harness({ config: { apiBaseUrl: "" } });
  await app.client.initialize();
  assert.equal(app.calls.filter((item) => ["fetch", "permission", "subscribe"].includes(item.name)).length, 0);
  assert.equal(app.client.getSnapshot().canEnable, false);
  assert.equal(app.client.getSnapshot().statusMessage, "訊息通知暫未開放。");
});

test("initialize is passive, enable requests permission synchronously and registers only minimal fields", async () => {
  const app = harness();
  await app.client.initialize();
  assert.equal(app.calls.some((item) => item.name === "permission"), false);
  assert.equal(app.client.getSnapshot().canEnable, true);
  app.calls.length = 0;
  const opening = app.client.enable();
  assert.equal(app.calls[0].name, "permission");
  assert.equal(app.calls.some((item) => item.name === "fetch"), false, "no await/network before permission request");
  await opening;
  const snapshot = app.client.getSnapshot();
  assert.equal(snapshot.subscribed, true);
  assert.equal(snapshot.serverRegistered, true);
  assert.equal(snapshot.canTest, true);
  const post = app.calls.find((item) => item.name === "fetch" && item.options.method === "POST");
  const body = JSON.parse(post.options.body);
  assert.deepEqual(Object.keys(body).sort(), ["managementToken", "subscription"]);
  assert.equal(Buffer.from(body.managementToken, "base64url").length, 32);
  assert.equal(app.saved().active.id, idFor(body.subscription.endpoint));
  assert.deepEqual(Object.keys(body.subscription).sort(), ["endpoint", "expirationTime", "keys"]);
  for (const item of app.calls.filter((item) => item.name === "fetch")) {
    assert.equal(new URL(item.url).origin, "https://push.example.test");
    assert.equal(item.options.credentials, "omit");
    assert.equal(item.options.redirect, "error");
    assert.equal(item.options.cache, "no-store");
  }
});

test("denied or dismissed permission never creates a subscription", async () => {
  for (const result of ["denied", "default"]) {
    const app = harness(); await app.client.initialize(); app.control.permissionReply = result;
    await app.client.enable();
    assert.equal(app.calls.some((item) => item.name === "subscribe"), false);
    assert.equal(app.client.getSnapshot().serverRegistered, false);
  }
});

test("lost registration response retries the same owner token and native subscription", async () => {
  const app = harness(); await app.client.initialize();
  const bodies = [];
  app.control.post = (body) => { bodies.push(body); throw new Error("response lost after server write"); };
  await app.client.enable();
  const owner = app.saved().active;
  assert.equal(app.client.getSnapshot().subscribed, true);
  assert.equal(app.client.getSnapshot().serverRegistered, false);
  app.control.post = (body) => { bodies.push(body); return json({ id: idFor(body.subscription.endpoint), keyId, registered: true, expiresAt: Date.now() + 86_400_000 }); };
  await app.client.enable();
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[0], bodies[1]);
  assert.equal(app.saved().active.token, owner.token);
  assert.equal(app.calls.filter((item) => item.name === "subscribe").length, 1);
  assert.equal(app.client.getSnapshot().serverRegistered, true);
});

test("native unsubscribe precedes backend delete, and offline cleanup survives a visit", async () => {
  const app = harness(); await app.client.initialize(); await app.client.enable();
  app.control.offlineDelete = true;
  app.calls.length = 0;
  await app.client.disable();
  assert.equal(app.calls[0].name, "change");
  const unsub = app.calls.findIndex((item) => item.name === "unsubscribe");
  const deletion = app.calls.findIndex((item) => item.name === "fetch" && item.options.method === "DELETE");
  assert.ok(unsub >= 0 && deletion > unsub);
  assert.equal(app.client.getSnapshot().subscribed, false);
  assert.equal(app.saved().pending.length, 1);
  assert.equal(app.saved().active, null);
  assert.match(app.client.getSnapshot().statusMessage, /待連線/);
  const next = harness({ initialStorage: { version: 1, ...app.saved() } });
  await next.client.initialize();
  assert.equal(next.saved().pending.length, 0);
  const remove = next.calls.find((item) => item.name === "fetch" && item.options.method === "DELETE");
  assert.match(remove.options.headers.Authorization, /^Bearer [A-Za-z0-9_-]{43}$/);
  assert.equal(next.calls.some((item) => item.name === "permission"), false);
});

test("unsubscribe false or rejected is not described as stopped", async () => {
  for (const result of [false, "throw"]) {
    const app = harness(); await app.client.initialize(); await app.client.enable(); app.control.nativeUnsubscribe = result;
    await app.client.disable();
    assert.equal(app.client.getSnapshot().subscribed, true);
    assert.match(app.client.getSnapshot().statusMessage, /未能確認/);
    assert.equal(app.calls.some((item) => item.name === "fetch" && item.options.method === "DELETE"), false);
  }
});

test("disable during permission prompt prevents late subscribe", async () => {
  const app = harness(); await app.client.initialize();
  const permission = deferred(); app.control.permissionPromise = permission.promise;
  const opening = app.client.enable(); await app.client.disable(); permission.resolve("granted"); await opening;
  assert.equal(app.calls.some((item) => item.name === "subscribe"), false);
  assert.equal(app.client.getSnapshot().serverRegistered, false);
});

test("disable during native creation stops the late subscription", async () => {
  const app = harness(); await app.client.initialize();
  const creation = deferred(); app.control.nativeCreation = creation;
  const opening = app.client.enable();
  while (!app.calls.some((item) => item.name === "subscribe")) await tick();
  const closing = app.client.disable(); creation.resolve(app.makeNative()); await Promise.all([opening, closing]);
  assert.equal(app.native(), null);
  assert.equal(app.calls.some((item) => item.name === "fetch" && item.options.method === "POST"), false);
});

test("late POST success after disable cannot re-enable and retains a deletion to retry", async () => {
  const app = harness(); await app.client.initialize();
  const post = deferred(); app.control.post = () => post.promise;
  const opening = app.client.enable();
  while (!app.saved().active) await tick();
  await tick();
  await app.client.disable();
  post.resolve(json({ id: idFor("https://fcm.googleapis.com/fcm/send/private"), keyId, registered: true, expiresAt: Date.now() + 86_400_000 }));
  await opening;
  assert.equal(app.client.getSnapshot().serverRegistered, false);
  assert.equal(app.client.getSnapshot().subscribed, false);
  assert.equal(app.saved().active, null);
  assert.equal(app.saved().pending.length, 1);
  await app.client.refresh();
  assert.equal(app.saved().pending.length, 0);
});

test("dispose during POST leaves a cleanup record, and ordinary dispose never unsubscribes", async () => {
  const app = harness(); await app.client.initialize(); await app.client.enable();
  app.client.dispose();
  assert.equal(app.calls.some((item) => item.name === "unsubscribe"), false);
  const late = harness(); await late.client.initialize(); const post = deferred(); late.control.post = () => post.promise;
  const opening = late.client.enable(); while (!late.saved().active) await tick(); await tick(); late.client.dispose();
  post.resolve(json({ id: idFor("https://fcm.googleapis.com/fcm/send/private"), keyId, registered: true, expiresAt: Date.now() + 86_400_000 }));
  await opening;
  assert.equal(late.client.getSnapshot().serverRegistered, false);
  assert.equal(late.native(), null);
  assert.equal(late.saved().active, null);
  assert.equal(late.saved().pending.length, 1);
});

test("revoked permission removes native delivery and queues backend removal even when config is offline", async () => {
  const app = harness(); await app.client.initialize(); await app.client.enable();
  app.environment.Notification.permission = "denied";
  app.control.fetch = () => { throw new Error("offline"); };
  await app.client.refresh();
  assert.equal(app.native(), null);
  assert.equal(app.saved().pending.length, 1);
  assert.equal(app.client.getSnapshot().canEnable, false);
});

test("lost ownership or changed key stops an old native subscription before enabling a new one", async () => {
  const unknown = harness({ initialNative: true, permission: "granted" });
  await unknown.client.initialize();
  assert.equal(unknown.native(), null);
  assert.equal(unknown.calls.some((item) => item.name === "permission"), false);
  assert.match(unknown.client.getSnapshot().statusMessage, /尚未啟用|缺少管理/);
  const app = harness(); await app.client.initialize(); await app.client.enable();
  const nextKey = b64(Uint8Array.from({ length: 65 }, (_, i) => i ? (i + 1) % 256 : 4));
  app.control.key = nextKey; app.control.keyId = createHash("sha256").update(nextKey).digest("hex");
  await app.client.refresh();
  assert.equal(app.native(), null);
  assert.equal(app.saved().active, null);
  assert.equal(app.client.getSnapshot().canEnable, true);
});

test("storage write failure stops native delivery and sends no registration POST", async () => {
  const app = harness(); await app.client.initialize(); app.control.writeFails = true;
  await app.client.enable();
  assert.equal(app.native(), null);
  assert.equal(app.calls.some((item) => item.name === "fetch" && item.options.method === "POST"), false);
  assert.equal(app.client.getSnapshot().serverRegistered, false);
});

test("untrusted API URL, different scope, key mismatch, arbitrary endpoint and oversized responses are rejected", async () => {
  for (const value of ["javascript:alert(1)", "http://outside.test/", "https://user:secret@push.example.test/", "https://push.example.test/?other=1"]) {
    const app = harness({ config: { apiBaseUrl: value } }); await app.client.initialize();
    assert.equal(app.calls.some((item) => item.name === "fetch"), false);
    assert.equal(app.client.getSnapshot().canEnable, false);
  }
  for (const scope of ["https://example.test/other/", "https://outside.test/trip/", `${appUrl}#home`, "https://example.test/trip"]) {
    const app = harness(); app.control.appUrl = scope; await app.client.initialize(); assert.equal(app.client.getSnapshot().canEnable, false);
  }
  const mismatch = harness(); mismatch.control.keyId = "0".repeat(64); await mismatch.client.initialize(); assert.equal(mismatch.client.getSnapshot().canEnable, false);
  const arbitrary = harness({ endpoint: "https://attacker.test/collect" }); await arbitrary.client.initialize(); await arbitrary.client.enable();
  assert.equal(arbitrary.calls.some((item) => item.name === "fetch" && item.options.method === "POST"), false);
  const oversized = harness(); oversized.control.fetch = () => json({ enabled: false, padding: "x".repeat(70_000) }); await oversized.client.initialize();
  assert.equal(oversized.client.getSnapshot().canEnable, false);
});

test("notification snapshots expose neither announcement history nor subscription secrets", async () => {
  const app = harness();
  await app.client.initialize(); await app.client.enable();
  const snapshot = app.client.getSnapshot();
  assert.equal(Object.hasOwn(snapshot, "messages"), false);
  assert.ok(Object.isFrozen(snapshot));
  const serialized = JSON.stringify(snapshot);
  for (const secret of [app.saved().active.token, "fcm.googleapis.com", "managementToken", "p256dh", "pushManager"]) assert.equal(serialized.includes(secret), false);
  assert.throws(() => { snapshot.statusMessage = "changed"; }, TypeError);
});

test("test-notification request only targets the owned id with bearer credentials and truthful queued copy", async () => {
  const app = harness(); await app.client.initialize(); await app.client.enable(); await app.client.sendTest();
  const sent = app.calls.find((item) => item.name === "fetch" && item.url.endsWith("/test"));
  assert.equal(sent.url, `${apiBaseUrl}v1/subscriptions/${app.saved().active.id}/test`);
  assert.equal(sent.options.headers.Authorization, `Bearer ${app.saved().active.token}`);
  assert.equal(sent.options.body, undefined);
  assert.match(app.client.getSnapshot().statusMessage, /已安排測試通知/);
  assert.doesNotMatch(app.client.getSnapshot().statusMessage, /已送達|已收到/);
});

test("a registration ready promise that never resolves has a bounded wait", async () => {
  const app = harness(); app.control.getRegistration = () => new Promise(() => {});
  app.environment.setTimeout = (callback) => { queueMicrotask(callback); return 1; };
  const client = createPushClient({ environment: app.environment, config: { apiBaseUrl }, getRegistration: app.control.getRegistration });
  await client.initialize();
  assert.equal(client.getSnapshot().busy, false);
  assert.equal(client.getSnapshot().canEnable, false);
  assert.match(client.getSnapshot().statusMessage, /未能/);
});

test("initialization, refresh and notification operations never fetch announcement history", async () => {
  const app = harness();
  await app.client.initialize();
  assert.equal(app.client.getSnapshot().canEnable, true);
  await app.client.enable();
  await app.client.refresh();
  assert.equal(app.client.getSnapshot().canTest, true);
  await app.client.sendTest();
  await app.client.disable();
  assert.equal(app.client.getSnapshot().subscribed, false);
  assert.equal(app.calls.some(item => item.name === "fetch" && new URL(item.url).pathname === "/v1/messages"), false);
  assert.equal(app.calls.some(item => item.name === "permission"), true);
  for (const item of app.calls.filter(item => item.name === "persist")) {
    const saved = JSON.parse(item.value);
    assert.deepEqual(Object.keys(saved).sort(), ["active", "pending", "version"]);
  }
});

test("HTTP development scope requires secure loopback page and exactly matching origin", async () => {
  const app = harness();
  app.control.appUrl = "http://localhost:4193/";
  app.registration.scope = app.control.appUrl;
  app.environment.location = { href: "http://localhost:4193/#home", hostname: "localhost" };
  const local = createPushClient({ environment: app.environment, config: { apiBaseUrl: "http://localhost:8787/" }, getRegistration: () => app.registration });
  await local.initialize(); assert.equal(local.getSnapshot().canEnable, true);
  for (const scope of ["http://localhost:4194/", "http://outside.test/", "http://localhost:4193/other/"]) {
    app.control.appUrl = scope;
    await local.refresh(); assert.equal(local.getSnapshot().canEnable, false);
  }
  app.control.appUrl = "http://localhost:4193/"; app.environment.isSecureContext = false;
  await local.refresh(); assert.equal(local.getSnapshot().canEnable, false);
});

test("API timeout settles even if an injected fetch ignores its abort signal", async () => {
  const app = harness(); const timers = new Map(); let next = 0;
  app.environment.setTimeout = (callback) => { timers.set(++next, callback); return next; };
  app.environment.clearTimeout = (id) => timers.delete(id);
  app.control.fetch = () => new Promise(() => {});
  const client = createPushClient({ environment: app.environment, config: { apiBaseUrl }, getRegistration: () => app.registration });
  const initialization = client.initialize();
  while (!app.calls.some((item) => item.name === "fetch")) await tick();
  for (const callback of [...timers.values()]) callback();
  await initialization;
  assert.equal(client.getSnapshot().busy, false);
  assert.equal(client.getSnapshot().canEnable, false);
});

test("timed-out subscribe resolving late cannot unsubscribe a newer accepted enable with reused endpoint", async () => {
  const app = harness(); const timers = new Map(); let next = 0;
  app.environment.crypto = immediateCrypto;
  app.environment.setTimeout = (callback) => { timers.set(++next, callback); return next; };
  app.environment.clearTimeout = (id) => timers.delete(id);
  const client = createPushClient({ environment: app.environment, config: { apiBaseUrl }, getRegistration: () => app.registration });
  await client.initialize();
  const oldCreation = deferred(); app.control.nativeCreation = oldCreation;
  const firstEnable = client.enable();
  while (!app.calls.some((item) => item.name === "subscribe")) await tick();
  for (const callback of [...timers.values()]) callback();
  await firstEnable;
  app.control.nativeCreation = null;
  await client.enable();
  assert.equal(client.getSnapshot().serverRegistered, true);
  const owner = app.saved().active;
  const stopCount = app.calls.filter((item) => item.name === "unsubscribe").length;
  oldCreation.resolve(app.makeNative());
  await tick(); await tick();
  assert.ok(app.native());
  assert.equal(client.getSnapshot().subscribed, true);
  assert.equal(client.getSnapshot().serverRegistered, true);
  assert.equal(app.calls.filter((item) => item.name === "unsubscribe").length, stopCount);
  assert.deepEqual(app.saved().active, owner);
});

test("timed-out subscribe still stops its late result when no newer enable owns it", async () => {
  const app = harness(); const timers = new Map(); let next = 0;
  app.environment.crypto = immediateCrypto;
  app.environment.setTimeout = (callback) => { timers.set(++next, callback); return next; };
  app.environment.clearTimeout = (id) => timers.delete(id);
  const client = createPushClient({ environment: app.environment, config: { apiBaseUrl }, getRegistration: () => app.registration });
  await client.initialize(); const creation = deferred(); app.control.nativeCreation = creation;
  const opening = client.enable(); while (!app.calls.some((item) => item.name === "subscribe")) await tick();
  for (const callback of [...timers.values()]) callback(); await opening;
  creation.resolve(app.makeNative()); await tick(); await tick();
  assert.equal(app.native(), null);
  assert.equal(client.getSnapshot().subscribed, false);
});
