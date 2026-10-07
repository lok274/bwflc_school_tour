import test from "node:test";
import assert from "node:assert/strict";
import { Miniflare, convertV4MiniflareOptions, Response as RuntimeResponse } from "miniflare";
import { bundleWorker } from "../scripts/bundle-worker.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { credentials, subscriber, decryptWebPush } from "./helpers.mjs";
import { sha256 } from "../src/security.js";

const root = fileURLToPath(new URL("../", import.meta.url));
let bundlePromise;
function runtimeBundle() { return bundlePromise ??= bundleWorker(); }
test("actual Wrangler bundle+Worker+SQLite local runtime authenticates, persists, encrypts alarms and serves scoped APIs", { timeout: 60000 }, async () => {
  const bundle = await runtimeBundle();
  const env = credentials(); const fixture = subscriber("runtime"); const delivered = [];
  const temporary = await mkdtemp(path.join(os.tmpdir(), "bwflc-push-runtime-"));
  const options = convertV4MiniflareOptions({ name: "push-test", modules: true, script: bundle, compatibilityDate: "2026-06-25", compatibilityFlags: ["nodejs_compat"], bindings: env, durableObjects: { PUSH_SERVICE: { className: "PushService", useSQLite: true } }, durableObjectsPersist: temporary, cf: false, host: "127.0.0.1", outboundService: async (request) => {
    // Every outbound request is intercepted; no real vendor endpoint is contacted.
    assert.equal(new URL(request.url).hostname, "fcm.googleapis.com");
    delivered.push(decryptWebPush(await request.arrayBuffer(), fixture));
    return new RuntimeResponse(null, { status: 201 });
  }, serviceBindings: { ASSETS: () => new RuntimeResponse("admin test asset", { headers: { "Content-Type": "text/html" } }) } });
  options.unsafeInspectDurableObjects = true;
  options.resourcePersistencePath = temporary;
  let mf;
  const invoke = async (route, { method = "GET", token, data, origin = env.APP_ORIGIN, key } = {}) => {
    const headers = { Origin: origin }; if (token) headers.Authorization = `Bearer ${token}`;
    if (data) headers["Content-Type"] = "application/json"; if (key) headers["Idempotency-Key"] = key;
    return mf.dispatchFetch(`https://backend.test${route}`, { method, headers, body: data ? JSON.stringify(data) : undefined, redirect: "manual" });
  };
  try {
    mf = new Miniflare(options); await mf.ready;
    const config = await (await invoke("/v1/config")).json(); assert.equal(config.enabled, true); assert.equal(config.publicKey, env.VAPID_PUBLIC_KEY); assert.equal(Object.hasOwn(config, "privateKey"), false);
    assert.equal((await invoke("/v1/config", { origin: "https://attacker.test" })).status, 403);
    const cors = await invoke("/v1/config"); assert.equal(cors.headers.get("Access-Control-Allow-Origin"), env.APP_ORIGIN); assert.equal(cors.headers.get("Access-Control-Allow-Credentials"), null);
    const preflight = await mf.dispatchFetch("https://backend.test/v1/subscriptions", { method: "OPTIONS", headers: { Origin: env.APP_ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } }); assert.equal(preflight.status, 204);
    assert.equal((await invoke("/admin/", { origin: "https://backend.test" })).status, 307);
    const adminAsset = await invoke("/admin", { origin: "https://backend.test" }); assert.equal(adminAsset.status, 200); assert.match(adminAsset.headers.get("Content-Security-Policy"), /connect-src 'self'/);
    const body = { subscription: fixture.subscription, managementToken: fixture.managementToken };
    const registered = await invoke("/v1/subscriptions", { method: "POST", data: body }); assert.equal(registered.status, 201);
    const sub = await registered.json(); assert.equal(sub.id, await sha256(fixture.subscription.endpoint));
    assert.equal((await invoke("/v1/subscriptions", { method: "POST", data: body })).status, 201);
    assert.equal((await invoke(`/v1/subscriptions/${sub.id}`, { method: "DELETE", token: credentials().ADMIN_TOKEN })).status, 401);
    const message = { title: "公告測試", body: "更新行程", route: "itinerary" }; const key = crypto.randomUUID();
    assert.equal((await invoke("/v1/admin/messages", { method: "POST", data: message, key, token: env.ADMIN_TOKEN })).status, 403); // Public origin is not an admin origin.
    assert.equal((await invoke("/v1/admin/messages", { method: "POST", data: message, key, origin: "https://backend.test" })).status, 401);
    const createdResponse = await invoke("/v1/admin/messages", { method: "POST", data: message, key, token: env.ADMIN_TOKEN, origin: "https://backend.test" });
    assert.equal(createdResponse.status, 202); const created = await createdResponse.json(); assert.equal(created.total, 1);
    const retried = await (await invoke("/v1/admin/messages", { method: "POST", data: message, key, token: env.ADMIN_TOKEN, origin: "https://backend.test" })).json(); assert.equal(retried.jobId, created.jobId);
    let status;
    for (let n = 0; n < 100; n++) { status = await (await invoke(`/v1/admin/messages/${created.jobId}`, { token: env.ADMIN_TOKEN, origin: "https://backend.test" })).json(); if (status.accepted || status.failed) break; await new Promise((resolve) => setTimeout(resolve, 100)); }
    const sql = await mf.unsafeGetDurableObjectStorage("push-test", "PushService", { name: "announcements-v1" });
    const diagnostic = await sql.exec("SELECT state,lastError FROM deliveries WHERE messageId = ?", created.jobId);
    assert.equal(status.accepted, 1, JSON.stringify({ status, intercepted: delivered.length, diagnostic })); assert.equal(delivered.length, 1); assert.equal(delivered[0].body, message.body);
    const messages = await (await invoke("/v1/messages")).json(); assert.equal(messages.messages.length, 1); assert.equal(messages.messages[0].id, created.messageId);
    await mf.dispose(); mf = new Miniflare(options); await mf.ready;
    const restored = await (await invoke(`/v1/admin/messages/${created.jobId}`, { token: env.ADMIN_TOKEN, origin: "https://backend.test" })).json(); assert.equal(restored.accepted, 1, JSON.stringify(restored));
    assert.equal((await invoke(`/v1/subscriptions/${sub.id}`, { method: "DELETE", token: fixture.managementToken })).status, 204);
    assert.equal((await invoke(`/v1/subscriptions/${sub.id}`, { method: "DELETE", token: fixture.managementToken })).status, 204);
    const resurrect = await invoke("/v1/subscriptions", { method: "POST", data: body }); assert.equal(resurrect.status, 409); assert.equal((await resurrect.json()).error.code, "subscription_cancelled");
    assert.equal(delivered.length, 1);
  } finally {
    await mf?.dispose();
    if (!temporary.startsWith(path.join(os.tmpdir(), "bwflc-push-runtime-"))) throw new Error("Invalid cleanup path");
    await rm(temporary, { recursive: true, force: true });
  }
});
test("disabled Worker alarm still clears expired records without sending or retry busy-loop", { timeout: 60000 }, async () => {
  const fixture = subscriber("disabled"); const env = { ...credentials(), ADMIN_TOKEN: "" };
  const options = convertV4MiniflareOptions({ name: "disabled-push-test", modules: true, script: await runtimeBundle(), compatibilityDate: "2026-06-25", compatibilityFlags: ["nodejs_compat"], bindings: env, durableObjects: { PUSH_SERVICE: { className: "PushService", useSQLite: true } }, cf: false, host: "127.0.0.1", outboundService: () => { throw new Error("Disabled Worker must not send"); } });
  options.unsafeInspectDurableObjects = true;
  const mf = new Miniflare(options);
  try {
    await mf.ready;
    const sql = await mf.unsafeGetDurableObjectStorage("disabled-push-test", "PushService", { name: "announcements-v1" });
    const now = Date.now(); const active = "f".repeat(64); const expired = "e".repeat(64); const message = crypto.randomUUID();
    for (const [id, expiry] of [[active, now + 3600000], [expired, now - 1]]) await sql.exec("INSERT INTO subscriptions(id,endpoint,p256dh,auth,ownerHash,keyId,version,createdAt,updatedAt,expiresAt) VALUES (?,?,?,?,?,?,?,?,?,?)", id, fixture.subscription.endpoint + id, fixture.subscription.keys.p256dh, fixture.subscription.keys.auth, "owner-test", "key-test", "version-test", now, now, expiry);
    await sql.exec("INSERT INTO tombstones(id,ownerHash,expiresAt) VALUES (?,?,?)", expired, "owner-test", now - 1);
    await sql.exec("INSERT INTO rate_limits(key,windowStart,count,expiresAt) VALUES (?,?,?,?)", "fixture-abuse-id", now - 60000, 1, now - 1);
    await sql.exec("INSERT INTO messages(id,idempotencyKey,payloadHash,title,body,route,createdAt,expiresAt,isPublic) VALUES (?,?,?,?,?,?,?,?,?)", message, crypto.randomUUID(), "test-hash", "測試", "測試", "home", now, now + 86400000, 0);
    await sql.exec("INSERT INTO deliveries(messageId,subscriptionId,state,nextAttemptAt,updatedAt) VALUES (?,?,'queued',?,?)", message, active, now - 1, now);
    const namespace = await mf.getDurableObjectNamespace("PUSH_SERVICE");
    await namespace.get(namespace.idFromName("announcements-v1")).schedule();
    let rows;
    for (let n = 0; n < 40; n++) { rows = await sql.exec("SELECT id FROM subscriptions WHERE id = ?", expired); if (!rows.length) break; await new Promise((resolve) => setTimeout(resolve, 100)); }
    assert.equal(rows.length, 0); assert.equal((await sql.exec("SELECT * FROM tombstones")).length, 0); assert.equal((await sql.exec("SELECT * FROM rate_limits")).length, 0);
    const pending = await sql.exec("SELECT state,attempts FROM deliveries WHERE messageId = ?", message); assert.equal(pending[0].state, "queued"); assert.equal(pending[0].attempts, 0);
  } finally { await mf.dispose(); }
});
